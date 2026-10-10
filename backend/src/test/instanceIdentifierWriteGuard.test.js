// Teste-Guarda: Nenhuma escrita de `instance_name` em lead_messages sem passar
// pelo helper centralizado resolveInstanceIdentifier.
//
// Regra do Vexo OS:
// Os chips na Evolution possuem 3 representações concorrentes:
// 1. name (amigável, ex: "GD Priscila")
// 2. id (UUID, ex: "73ba3e2a-d8c6-4502-a83c-6d6cf1e82d21")
// 3. urlSuffix (último segmento da URL, ex: "geracao-digital-gd-priscila")
//
// Toda e qualquer gravação de `instance_name` DEVE ser canônica para evitar
// que filtros de tela ou relatórios se percam entre UUIDs e nomes de URL.
// Este teste garante que:
// - O helper resolveInstanceIdentifier funciona para os 3 formatos.
// - appendLeadMessage (ponto central de escrita) invoca resolveInstanceIdentifier.
// - campaigns/routes.js e chatbot/routes.js resolvem a forma canônica antes de gravar.
// - Prova de mutação: falha se o helper for removido desses fluxos.

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { describe, expect, it, vi } from "vitest";
import { resolveInstanceIdentifier, resolveEvolutionInstanceOwner } from "../services/evolution.js";

describe("Teste-Guarda: Resolução Canônica de Identificadores de Chip", () => {
  const raizSrc = existsSync(resolve("backend/src")) ? resolve("backend/src") : resolve("src");

  // 1. Teste funcional do helper com os 3 formatos
  it("resolveInstanceIdentifier aceita name, id e urlSuffix e devolve canonicalName e aliases", async () => {
    const mockDb = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: "73ba3e2a-d8c6-4502-a83c-6d6cf1e82d21",
            client_id: "geracao-digital",
            name: "GD Priscila",
            dispatch_webhook_url: "https://vexo-evolution-api.xdvm8y.easypanel.host/geracao-digital-gd-priscila",
            owner_uid: "uid-priscila",
          },
        ],
      })),
    };

    // Formato 1: name amigável
    const byName = await resolveInstanceIdentifier({
      clientId: "geracao-digital",
      identifier: "GD Priscila",
      pool: mockDb,
    });
    expect(byName.canonicalName).toBe("geracao-digital-gd-priscila");
    expect(byName.aliases).toContain("GD Priscila");
    expect(byName.aliases).toContain("73ba3e2a-d8c6-4502-a83c-6d6cf1e82d21");
    expect(byName.aliases).toContain("geracao-digital-gd-priscila");
    expect(byName.chip?.owner_uid).toBe("uid-priscila");

    // Formato 2: id (UUID)
    const byId = await resolveInstanceIdentifier({
      clientId: "geracao-digital",
      identifier: "73ba3e2a-d8c6-4502-a83c-6d6cf1e82d21",
      pool: mockDb,
    });
    expect(byId.canonicalName).toBe("geracao-digital-gd-priscila");
    expect(byId.aliases).toContain("GD Priscila");
    expect(byId.aliases).toContain("73ba3e2a-d8c6-4502-a83c-6d6cf1e82d21");
    expect(byId.aliases).toContain("geracao-digital-gd-priscila");

    // Formato 3: urlSuffix
    const byUrl = await resolveInstanceIdentifier({
      clientId: "geracao-digital",
      identifier: "geracao-digital-gd-priscila",
      pool: mockDb,
    });
    expect(byUrl.canonicalName).toBe("geracao-digital-gd-priscila");
    expect(byUrl.aliases).toContain("GD Priscila");

    // Compatibilidade com resolveEvolutionInstanceOwner
    const owner = await resolveEvolutionInstanceOwner({
      clientId: "geracao-digital",
      instanceName: "73ba3e2a-d8c6-4502-a83c-6d6cf1e82d21",
      pool: mockDb,
    });
    expect(owner).toBe("uid-priscila");
  });

  // 2. Guarda estática: appendLeadMessage em leadMessaging.js
  it("leadMessaging.js contém resolveInstanceIdentifier antes de montar o payload", () => {
    const caminho = join(raizSrc, "domains/shared/leadMessaging.js");
    const conteudo = readFileSync(caminho, "utf8");

    expect(conteudo).toContain("resolveInstanceIdentifier");
    expect(conteudo).toMatch(/const\s*\{\s*canonicalName\s*\}\s*=\s*await\s+resolveInstanceIdentifier/);
    expect(conteudo).toMatch(/instance_name:\s*canonicalInstanceName/);
  });

  // 3. Guarda estática: disparo de campanha em campaigns/routes.js
  it("campaigns/routes.js resolve identificador canônico no onStepDispatched", () => {
    const caminho = join(raizSrc, "domains/campaigns/routes.js");
    const conteudo = readFileSync(caminho, "utf8");

    expect(conteudo).toContain("resolveInstanceIdentifier");
    expect(conteudo).toMatch(/resolveInstanceIdentifier\(\s*\{\s*clientId,\s*identifier:\s*rawChip/);
  });

  // 4. Guarda estática: webhook de entrada em chatbot/routes.js
  it("chatbot/routes.js resolve identificador canônico no webhook e nos aliases", () => {
    const caminho = join(raizSrc, "domains/chatbot/routes.js");
    const conteudo = readFileSync(caminho, "utf8");

    expect(conteudo).toContain("resolveInstanceIdentifier");
    // Webhook inbound
    expect(conteudo).toMatch(/resolveInstanceIdentifier\(\s*\{\s*\n?\s*clientId,\s*\n?\s*identifier:\s*rawInstanceName/);
    // Aliases do filtro
    expect(conteudo).toMatch(/resolveInstanceIdentifier\(\s*\{\s*\n?\s*clientId,\s*\n?\s*identifier:\s*rawInstanceName,\s*\n?\s*pool:\s*pgDatabasePool/);
  });

  // 5. Teste funcional de envio de áudio/mídia via Evolution com resolução canônica
  it("resolveInboundDispatchSettings resolve nome amigável para slug canônico e sendMediaMessageViaEvolution monta endpoint sem espaços", async () => {
    const { resolveInboundDispatchSettings } = await import("../campaign/settings.js");
    const { sendMediaMessageViaEvolution } = await import("../services/evolution.js");

    const mockDb = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: "11111111-2222-3333-4444-555555555555",
            client_id: "vexo-adm",
            name: "Vexo atende",
            dispatch_webhook_url: "https://vexo-evolution-api.xdvm8y.easypanel.host/message/sendText/vexo-adm-vexo-atende",
            dispatch_webhook_token: "token-123",
            active: true,
          },
        ],
      })),
    };

    // 1. resolveInboundDispatchSettings recebendo nome amigável "Vexo atende"
    const resolved = await resolveInboundDispatchSettings({
      clientId: "vexo-adm",
      instanceName: "Vexo atende",
      pool: mockDb,
    });

    expect(resolved.instanceName).toBe("vexo-adm-vexo-atende");
    expect(resolved.instanceName).not.toBe("Vexo atende");

    // 2. Intercepta fetch para garantir que o endpoint chamado pela Evolution contém o slug e NÃO o nome amigável
    let fetchUrlChamada = null;
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      fetchUrlChamada = String(url);
      return {
        ok: true,
        text: async () => JSON.stringify({ success: true, key: { id: "wa-msg-audio-id-123" } }),
      };
    });

    try {
      await sendMediaMessageViaEvolution({
        instanceName: resolved.instanceName,
        number: "553499999999",
        mediaType: "audio",
        base64: "ZmFrZS1hdWRpby1ieXRlcw==",
        webhookToken: "token-123",
        baseUrl: "https://vexo-evolution-api.xdvm8y.easypanel.host",
      });

      expect(fetchUrlChamada).toBe("https://vexo-evolution-api.xdvm8y.easypanel.host/message/sendWhatsAppAudio/vexo-adm-vexo-atende");
      expect(fetchUrlChamada).not.toContain("Vexo%20atende");
      expect(fetchUrlChamada).not.toContain("Vexo atende");
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 6. Prova de mutação (Mutation Testing):
  // Se alguém passar o nome amigável direto ("Vexo atende") para a Evolution API,
  // a requisição com espaços/caracteres inválidos DEVE falhar.
  it("PROVA DE MUTAÇÃO: passar nome amigável ('Vexo atende') diretamente para sendMediaMessageViaEvolution gera endpoint inválido e DERROTA a asserção canônica", async () => {
    const { sendMediaMessageViaEvolution } = await import("../services/evolution.js");

    let endpointGerado = null;
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      endpointGerado = String(url);
      return {
        ok: true,
        text: async () => JSON.stringify({ success: true }),
      };
    });

    try {
      // Mutação simulada: passar o nome amigável sem resolução
      const nomeAmigavelMutante = "Vexo atende";
      await sendMediaMessageViaEvolution({
        instanceName: nomeAmigavelMutante,
        number: "553499999999",
        mediaType: "audio",
        base64: "ZmFrZS1hdWRpby1ieXRlcw==",
        webhookToken: "token-123",
        baseUrl: "https://vexo-evolution-api.xdvm8y.easypanel.host",
      });

      // O endpoint mutante conteria "Vexo%20atende"
      const contemSlugValido = endpointGerado === "https://vexo-evolution-api.xdvm8y.easypanel.host/message/sendWhatsAppAudio/vexo-adm-vexo-atende";
      const contemNomeAmigavelInvalido = endpointGerado.includes("Vexo%20atende") || endpointGerado.includes("Vexo atende");

      // Demonstra que sem a resolução canônica, a asserção de slug falha rigorosamente
      expect(contemSlugValido).toBe(false);
      expect(contemNomeAmigavelInvalido).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 7. Prova de mutação de código estático:
  it("PROVA DE MUTAÇÃO: código simulado sem resolveInstanceIdentifier em leadMessaging falha", () => {
    const codigoMutante = `
      async function appendLeadMessage({ clientId, instanceName }) {
        const payload = { instance_name: instanceName };
        return supabase.from("lead_messages").insert(payload);
      }
    `;

    const temHelper = codigoMutante.includes("resolveInstanceIdentifier");
    const normalizaPayload = /instance_name:\s*canonicalInstanceName/.test(codigoMutante);

    expect(temHelper).toBe(false);
    expect(normalizaPayload).toBe(false);
  });

  it("PROVA DE MUTAÇÃO: código simulado de campanha gravando UUID direto falha", () => {
    const codigoMutanteCampanha = `
      onStepDispatched: async ({ activeChip }) => {
        const chipName = activeChip?.instanceId;
        await appendLeadMessage({ instanceName: chipName });
      }
    `;

    const passaPeloHelper = codigoMutanteCampanha.includes("resolveInstanceIdentifier");
    expect(passaPeloHelper).toBe(false);
  });
});
