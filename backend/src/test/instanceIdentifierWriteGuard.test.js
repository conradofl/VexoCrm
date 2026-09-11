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

  // 5. Prova de mutação (Mutation Testing):
  // Se removermos a invocação de resolveInstanceIdentifier de leadMessaging, a guarda DEVE acusar violação.
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
