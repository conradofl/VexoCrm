import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/evolution.js", () => ({
  sendTextMessageViaEvolution: vi.fn().mockResolvedValue({ success: true, waMessageId: "mock-wa-msg-1" }),
  createEvolutionGroup: vi.fn().mockImplementation(async ({ subject }) => ({
    success: true,
    groupJid: subject.includes("PASTA:") ? "120363001@g.us" : "120363002@g.us",
  })),
  getEvolutionGroupInviteCode: vi.fn().mockImplementation(async ({ groupJid }) => ({
    success: true,
    inviteCode: `inv_${groupJid}`,
    inviteUrl: `https://chat.whatsapp.com/inv_${groupJid}`,
  })),
  getBase64FromMediaMessage: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/googleDriveClientSetup.js", () => ({
  setupClientDriveFolders: vi.fn().mockResolvedValue({
    success: true,
    drive_folder_id: "drive-folder-mock-123",
    driveLink: "https://drive.google.com/drive/folders/drive-folder-mock-123",
    subfolders: {
      identidade: { id: "sub-1", link: "https://drive.google.com/drive/folders/sub-1" },
      brutos: { id: "sub-2", link: "https://drive.google.com/drive/folders/sub-2" },
      criativos: { id: "sub-3", link: "https://drive.google.com/drive/folders/sub-3" },
      relatorios: { id: "sub-4", link: "https://drive.google.com/drive/folders/sub-4" },
    },
  }),
}));

import {
  HELOISA_TOOLS,
  executarOnboardingCliente,
  processarMensagemHeloisa,
} from "../domains/goclaw/heloisaEngine.js";
import { createEvolutionGroup, getEvolutionGroupInviteCode, sendTextMessageViaEvolution } from "../services/evolution.js";
import { setupClientDriveFolders } from "../services/googleDriveClientSetup.js";

describe("Heloísa Onboarding Tool (executar_onboarding_cliente)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Definição da tool executar_onboarding_cliente no array HELOISA_TOOLS", () => {
    const tool = HELOISA_TOOLS.find((t) => t.function?.name === "executar_onboarding_cliente");
    expect(tool).toBeDefined();
    expect(tool.type).toBe("function");
    expect(tool.function.description).toContain("onboarding operacional completo");
    expect(tool.function.parameters.required).toContain("cliente_nome");
    expect(tool.function.parameters.properties).toHaveProperty("cliente_nome");
    expect(tool.function.parameters.properties).toHaveProperty("cliente_id");
    expect(tool.function.parameters.properties).toHaveProperty("telefone_cliente");
  });

  it("2. Retorna erro se o cliente não for localizado no CRM", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const res = await executarOnboardingCliente(
      { cliente_nome: "Cliente Inexistente X" },
      mockPool,
      "heloisa",
      { nome: "Conrado Finzi", telefone: "5534997817660" }
    );

    expect(res.sucesso).toBe(false);
    expect(res.erro).toContain("Cliente não localizado no CRM");
  });

  it("3. Executa onboarding completo: cria 4 pastas Drive, 2 grupos WhatsApp, atualiza banco e transiciona estado", async () => {
    const clienteMock = {
      id: "99999999-9999-9999-9999-999999999999",
      nome: "Ótica Visão Prime",
      empresa: "Ótica Visão Prime",
      aprovador_nome: "Roberto Ótica",
      aprovador_telefone: "5534991112222",
      estado_atual: "PROPOSTA_ACEITA",
      drive_url: null,
    };

    const colaboradoresMock = [
      { nome: "Caio Almeida", telefone: "5534997719779", ativo: true },
      { nome: "Conrado Finzi", telefone: "5534997817660", ativo: true },
      { nome: "Santana", telefone: "5516982447360", ativo: true },
    ];

    const queriesExecutadas = [];
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        queriesExecutadas.push({ sql, params });
        const sqlLower = sql.toLowerCase();

        // 1. Busca do cliente
        if (sqlLower.includes("from public.gd_clientes") && sqlLower.includes("where")) {
          return { rows: [clienteMock] };
        }

        // 2. Busca dos colaboradores ativos
        if (sqlLower.includes("from public.gd_colaboradores")) {
          return { rows: colaboradoresMock };
        }

        // 3. Update de gd_clientes
        if (sqlLower.includes("update public.gd_clientes")) {
          return { rows: [{ ...clienteMock, onboarding_concluido_em: new Date() }] };
        }

        // 4. Registrar evento
        if (sqlLower.includes("gd_registrar_evento")) {
          return { rows: [{ id: "evento-123", estado_para: "GRUPOS_CRIADOS" }] };
        }

        // 5. Auditoria heloisa_execucoes
        if (sqlLower.includes("heloisa_execucoes")) {
          return { rows: [{ id: "exec-1" }] };
        }

        return { rows: [] };
      }),
    };

    const diretor = { nome: "Conrado Finzi", telefone: "5534997817660" };
    const res = await executarOnboardingCliente(
      {
        cliente_nome: "Ótica Visão Prime",
        telefone_cliente: "5534999998888",
      },
      mockPool,
      "heloisa",
      diretor
    );

    expect(res.sucesso).toBe(true);
    expect(res.cliente).toBe("Ótica Visão Prime");

    // Verifica chamada ao Google Drive
    expect(setupClientDriveFolders).toHaveBeenCalledWith({
      clientName: "Ótica Visão Prime",
      makePublic: true,
      allowMockFallback: true,
    });

    // Verifica criação dos 2 grupos no WhatsApp
    expect(createEvolutionGroup).toHaveBeenCalledTimes(2);

    // Grupo Interno
    expect(createEvolutionGroup).toHaveBeenNthCalledWith(1, {
      instanceName: "heloisa",
      subject: "PASTA: ÓTICA VISÃO PRIME",
      description: expect.stringContaining("Grupo interno"),
      participants: expect.arrayContaining(["5534997719779", "5534997817660", "5516982447360"]),
    });

    // Grupo Cliente
    expect(createEvolutionGroup).toHaveBeenNthCalledWith(2, {
      instanceName: "heloisa",
      subject: "MÁQUINA DE VENDAS: ÓTICA VISÃO PRIME",
      description: expect.stringContaining("Canal oficial"),
      participants: expect.arrayContaining(["5534997719779", "5534997817660", "5516982447360", "5534999998888"]),
    });

    // Verifica convites obtidos
    expect(getEvolutionGroupInviteCode).toHaveBeenCalledTimes(2);

    // Mensagens de inicialização / boas-vindas
    expect(sendTextMessageViaEvolution).toHaveBeenCalled();

    // Transição de estado para GRUPOS_CRIADOS
    const callEvento = queriesExecutadas.find((q) => q.sql.toLowerCase().includes("gd_registrar_evento"));
    expect(callEvento).toBeDefined();
    expect(callEvento.params[1]).toBe("GRUPOS_CRIADOS");

    // Auditoria em heloisa_execucoes
    const callAuditoria = queriesExecutadas.find((q) => q.sql.toLowerCase().includes("heloisa_execucoes"));
    expect(callAuditoria).toBeDefined();
    expect(callAuditoria.params[7]).toBe("executar_onboarding_cliente");
  });

  it("4. Localiza cliente por cliente_id UUID e usa fallback de colaboradores se tabela estiver vazia", async () => {
    const clienteMock = {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      nome: "Advocacia Silveira",
      aprovador_nome: "Dr. Silveira",
      aprovador_telefone: "5534988887777",
      estado_atual: "BRIEFING_AGENDADO",
      drive_url: "https://drive.google.com/drive/folders/ja-existente",
    };

    const mockPool = {
      query: vi.fn().mockImplementation(async (sql) => {
        const sqlLower = sql.toLowerCase();
        if (sqlLower.includes("where id = $1")) {
          return { rows: [clienteMock] };
        }
        if (sqlLower.includes("from public.gd_colaboradores")) {
          return { rows: [] }; // colaboradores vazio -> usa fallback
        }
        return { rows: [] };
      }),
    };

    const res = await executarOnboardingCliente(
      {
        cliente_nome: "Advocacia Silveira",
        cliente_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      },
      mockPool,
      "heloisa",
      { nome: "Caio Almeida", telefone: "5534997719779" }
    );

    expect(res.sucesso).toBe(true);
    expect(res.cliente_id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(createEvolutionGroup).toHaveBeenCalledTimes(2);
  });
});
