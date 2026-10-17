import { describe, expect, it, vi, beforeEach } from "vitest";

const mockInstances = [
  {
    id: "chip-a-batedor-uuid",
    name: "CHIP BATEDOR",
    dispatch_webhook_url: "https://evo.vexo.com.br/message/sendText/chip-batedor",
    dispatch_webhook_token: "token-chip-a",
    is_default: true,
    active: true,
  },
  {
    id: "chip-b-fechador-uuid",
    name: "CHIP FECHADOR",
    dispatch_webhook_url: "https://evo.vexo.com.br/message/sendText/chip-fechador",
    dispatch_webhook_token: "token-chip-b",
    is_default: false,
    active: true,
  },
];

let mockHealthStatus = { state: "open" };
let mockEvolutionPayloads = [];
let mockDispatchedCalls = [];
let mockCampaignData = null;
let mockDispatchData = null;
let mockLeadImportItemData = null;
let mockInsertedLeadMessages = [];
let mockUpdatedLeads = [];
let mockUpdatedProgressPatches = [];

vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLeadClientEvolutionInstances: vi.fn(async () => mockInstances),
    checkEvolutionInstanceHealth: vi.fn(async () => {
      if (mockHealthStatus.shouldThrow) {
        throw new Error(mockHealthStatus.errorMessage || "Instância desconectada");
      }
      return mockHealthStatus;
    }),
    resolveInstanceIdentifier: vi.fn(async ({ identifier }) => {
      const id = String(identifier || "").trim().toLowerCase();
      const matched = mockInstances.find(
        (i) =>
          i.id.toLowerCase() === id ||
          i.name.toLowerCase() === id ||
          actual.extractEvolutionInstanceSlug(i.dispatch_webhook_url)?.toLowerCase() === id
      );
      return {
        canonicalName: matched?.name || identifier,
        aliases: matched ? [matched.id, matched.name, actual.extractEvolutionInstanceSlug(matched.dispatch_webhook_url)] : [identifier],
        chip: matched || null,
      };
    }),
  };
});

vi.mock("../campaign-outbound.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    postEvolutionPayload: vi.fn(async (url, token, payload) => {
      mockEvolutionPayloads.push({ url, token, payload });
      return { ok: true };
    }),
    dispatchCampaignSequence: vi.fn(async (args) => {
      mockDispatchedCalls.push(args);
      return {
        summary: {
          successCount: 1,
          failureCount: 0,
          successPhones: ["5534984400049"],
          failures: [],
          warnings: [],
        },
      };
    }),
  };
});

vi.mock("../services/database.js", () => {
  const createChain = (table) => {
    const chain = {
      eq: () => chain,
      in: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      select: () => chain,
      maybeSingle: async () => {
        if (table === "campaigns") return { data: mockCampaignData, error: null };
        if (table === "campaign_dispatches") return { data: mockDispatchData, error: null };
        if (table === "lead_import_items") return { data: mockLeadImportItemData, error: null };
        return { data: null, error: null };
      },
      update: (data) => {
        if (table === "leads") mockUpdatedLeads.push(data);
        if (table === "lead_import_items") mockUpdatedProgressPatches.push(data);
        return chain;
      },
      insert: (data) => {
        if (table === "lead_messages") {
          if (Array.isArray(data)) mockInsertedLeadMessages.push(...data);
          else mockInsertedLeadMessages.push(data);
        }
        return chain;
      },
    };
    return chain;
  };

  return {
    supabase: {
      from: (table) => {
        return {
          select: () => createChain(table),
          update: (data) => {
            if (table === "leads") mockUpdatedLeads.push(data);
            if (table === "lead_import_items") mockUpdatedProgressPatches.push(data);
            return createChain(table);
          },
          insert: (data) => {
            if (table === "lead_messages") {
              if (Array.isArray(data)) mockInsertedLeadMessages.push(...data);
              else mockInsertedLeadMessages.push(data);
            }
            return createChain(table);
          },
        };
      },
    },
    pgDatabasePool: {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("FROM public.campaign_dispatch_runs")) {
          return { rows: [{ evolution_instance_id: "chip-a-batedor-uuid" }] };
        }
        return { rows: [] };
      }),
    },
  };
});

import { continueCampaignLeadFromReply, executeCampaignChipHandoff } from "../campaign/dispatch.js";

describe("Passagem de Bastão entre Chips na Campanha (Transbordo / Handoff Ativo)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEvolutionPayloads = [];
    mockDispatchedCalls = [];
    mockInsertedLeadMessages = [];
    mockUpdatedLeads = [];
    mockUpdatedProgressPatches = [];
    mockHealthStatus = { state: "open" };

    mockCampaignData = {
      id: "camp-handoff-1",
      name: "Campanha Fria com Handoff",
      client_id: "tenant-vexo",
      status: "running",
      analytics_meta: {
        sequence: [
          { id: "step-1", type: "text", order: 1, text: "Olá! Tudo bem?", triggerMode: "immediate", enabled: true },
          { id: "step-2", type: "text", order: 2, text: "Gostaria de ver as opções?", triggerMode: "after_reply", enabled: true },
        ],
        dispatchOptions: {
          waitForReply: true,
          evolutionInstanceId: "chip-a-batedor-uuid",
          handoffEnabled: true,
          handoffChipId: "chip-b-fechador-uuid",
          handoffBridgingText: "Perfeito, {{nome}}! Vou pedir para o nosso especialista te chamar agora no WhatsApp dele para alinhar todos os detalhes.",
          handoffOpenerText: "Olá {{nome}}! Minha equipe me passou seu contato sobre nosso evento/campanha. Como posso te ajudar?",
        },
      },
    };

    mockDispatchData = {
      evolution_instance_id: "chip-a-batedor-uuid",
    };

    mockLeadImportItemData = {
      id: "item-lead-123",
      normalized_data: {
        nome: "Carlos Silva",
        primeiro_nome: "Carlos",
        telefone: "5534984400049",
        campaign_progress: {
          "camp-handoff-1": {
            status: "aguardando_usuario",
            leadStatus: "aguardando_resposta",
            nextStepIndex: 1,
            sentSteps: [0],
            leadName: "Carlos Silva",
          },
        },
      },
    };
  });

  describe("Teste 1: Conclusão de passos no Chip A -> Disparo de aviso no Chip A -> Abertura no Chip B", () => {
    it("conclui passos, envia mensagem ponte no Chip A e dispara abertura no Chip B com variáveis preenchidas", async () => {
      const campaignMatch = {
        id: "camp-handoff-1",
        leadImportItem: {
          id: "item-lead-123",
          progress: {
            waitForReply: true,
            status: "aguardando_usuario",
            nextStepIndex: 1,
            sentSteps: [0],
            dispatchId: "disp-1",
            leadName: "Carlos Silva",
          },
          normalized_data: {
            nome: "Carlos Silva",
            primeiro_nome: "Carlos",
            telefone: "5534984400049",
          },
        },
      };

      const result = await continueCampaignLeadFromReply({
        clientId: "tenant-vexo",
        phone: "5534984400049",
        campaignMatch,
        replyPayload: {
          instance: "chip-batedor",
          text: "Sim, gostaria de ver!",
        },
        delayMs: 1, // delay mínimo em teste
      });

      expect(result.continued).toBe(true);

      // Verificamos que o postEvolutionPayload foi chamado para os dois chips:
      // 1. Mensagem de transbordo (bridge) do Chip A
      // 2. Mensagem de abertura (opener) do Chip B
      const bridgeCall = mockEvolutionPayloads.find(
        (p) => p.url === "https://evo.vexo.com.br/message/sendText/chip-batedor"
      );
      expect(bridgeCall).toBeDefined();
      expect(bridgeCall.payload.text).toContain("Perfeito, Carlos Silva!");
      expect(bridgeCall.payload.campaign.mode).toBe("campaign_handoff_bridge");

      const openerCall = mockEvolutionPayloads.find(
        (p) => p.url === "https://evo.vexo.com.br/message/sendText/chip-fechador"
      );
      expect(openerCall).toBeDefined();
      expect(openerCall.payload.text).toContain("Olá Carlos Silva! Minha equipe me passou seu contato");
      expect(openerCall.payload.campaign.mode).toBe("campaign_handoff_opener");

      // Verificamos a persistência em lead_messages
      const bridgeMessage = mockInsertedLeadMessages.find(
        (m) => m.meta?.is_handoff_bridge === true
      );
      expect(bridgeMessage).toBeDefined();
      expect(bridgeMessage.instance_name || bridgeMessage.instanceName).toBe("CHIP BATEDOR");
      expect(bridgeMessage.meta.transferred_to_chip).toBe("CHIP FECHADOR");

      const openerMessage = mockInsertedLeadMessages.find(
        (m) => m.meta?.is_handoff_opener === true
      );
      expect(openerMessage).toBeDefined();
      expect(openerMessage.instance_name || openerMessage.instanceName).toBe("CHIP FECHADOR");
      expect(openerMessage.meta.transferred_from_chip).toBe("CHIP BATEDOR");

      // Verificamos a atualização na tabela leads: assigned_chip e temperatura
      const leadUpdate = mockUpdatedLeads.find((u) => u.assigned_chip === "CHIP FECHADOR");
      expect(leadUpdate).toBeDefined();
      expect(leadUpdate.lead_temperature).toBe("QUENTE");

      // Verificamos a atualização do progresso com handoffCompleted: true
      const progressUpdate = mockUpdatedProgressPatches.find(
        (p) => p.normalized_data?.campaign_progress?.["camp-handoff-1"]?.handoffCompleted === true
      );
      expect(progressUpdate).toBeDefined();
    });
  });

  describe("Teste 2: Idempotência: lead respondendo novamente após handoff não redispara a abertura", () => {
    it("não dispara transbordo nem mensagem de abertura se handoffCompleted já for true", async () => {
      const alreadyHandoffProgress = {
        handoffCompleted: true,
        handoffAt: "2026-10-17T09:00:00.000Z",
        handoffTargetChipId: "chip-b-fechador-uuid",
        leadName: "Carlos Silva",
      };

      const handoffResult = await executeCampaignChipHandoff({
        clientId: "tenant-vexo",
        campaign: mockCampaignData,
        lead: { id: "lead-1", nome: "Carlos Silva" },
        phone: "5534984400049",
        chipA: { name: "CHIP BATEDOR" },
        progress: alreadyHandoffProgress,
        leadImportItemId: "item-lead-123",
        delayMs: 1,
      });

      expect(handoffResult.executed).toBe(false);
      expect(handoffResult.reason).toBe("handoff_already_completed");
      expect(mockEvolutionPayloads.length).toBe(0);
      expect(mockInsertedLeadMessages.length).toBe(0);
    });
  });

  describe("Teste 3: Chip B desconectado: sistema trata com segurança sem travar o processo", () => {
    it("captura falha de saúde do Chip B e salva no progresso sem quebrar o fluxo", async () => {
      mockHealthStatus = { shouldThrow: true, errorMessage: "Evolution socket closed" };

      const handoffResult = await executeCampaignChipHandoff({
        clientId: "tenant-vexo",
        campaign: mockCampaignData,
        lead: { id: "lead-1", nome: "Carlos Silva" },
        phone: "5534984400049",
        chipA: { name: "CHIP BATEDOR" },
        progress: { leadName: "Carlos Silva" },
        leadImportItemId: "item-lead-123",
        delayMs: 1,
      });

      expect(handoffResult.executed).toBe(false);
      expect(handoffResult.reason).toBe("chip_b_disconnected");
      expect(handoffResult.error).toContain("Evolution socket closed");

      // Verificamos que o erro foi registrado no progresso para auditoria
      const failureProgressUpdate = mockUpdatedProgressPatches.find(
        (p) => p.normalized_data?.campaign_progress?.["camp-handoff-1"]?.handoffFailed === true
      );
      expect(failureProgressUpdate).toBeDefined();
      expect(
        failureProgressUpdate.normalized_data.campaign_progress["camp-handoff-1"].handoffError
      ).toContain("Evolution socket closed");

      // Nenhuma abertura deve ter sido enviada pelo Chip B
      const openerCall = mockEvolutionPayloads.find(
        (p) => p.url === "https://evo.vexo.com.br/message/sendText/chip-fechador"
      );
      expect(openerCall).toBeUndefined();
    });
  });
});
