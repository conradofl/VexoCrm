// Resolução da Evolution para a resposta do INBOUND do chatbot.
//
// O inbound resolve pelo chip que RECEBEU a mensagem (amigável, ID, ou segmento de URL),
// e cai no default do tenant apenas se não identificar ou se o chip estiver inativo.
//
// Este teste valida a resolução REAL (invocação de resolveInboundDispatchSettings).

import { describe, expect, it, vi } from "vitest";
import { resolveInboundDispatchSettings, _resetInboundChipLastGoodCache } from "../campaign/settings.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";

describe("o inbound resolve pelo chip que recebeu a mensagem", () => {
  const MOCK_INSTANCES = [
    {
      id: "inst-uuid-1",
      client_id: "geracao-digital",
      name: "GD Priscila",
      active: true,
      dispatch_webhook_url: "https://evo.vexo.com/message/sendText/priscila_evo",
      dispatch_webhook_token: "token-priscila",
    },
    {
      id: "inst-uuid-2",
      client_id: "geracao-digital",
      name: "GD Inativo",
      active: false,
      dispatch_webhook_url: "https://evo.vexo.com/message/sendText/inativo_evo",
    },
    {
      id: "inst-uuid-3",
      client_id: "geracao-digital",
      name: "GD Sem Url",
      active: true,
      dispatch_webhook_url: "",
    },
  ];

  function setupMockPool(instances = MOCK_INSTANCES) {
    const fakePool = {
      query: vi.fn().mockImplementation((queryText, params) => {
        const sql = typeof queryText === "string" ? queryText : queryText?.text || "";
        if (sql.includes("lead_client_evolution_instances")) {
          return Promise.resolve({ rows: instances });
        }
        if (sql.includes("lead_client_n8n_settings")) {
          return Promise.resolve({
            rows: [
              {
                client_id: "geracao-digital",
                active: true,
                dispatch_webhook_url: "https://evo.vexo.com/message/sendText/default-tenant",
                dispatch_webhook_token: "token-default",
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
    };
    _setPgDatabasePoolForTesting(fakePool);
  }

  it("resolve pelo nome amigável da instância (name)", async () => {
    _resetInboundChipLastGoodCache();
    setupMockPool();
    try {
      const res = await resolveInboundDispatchSettings({
        clientId: "geracao-digital",
        instanceName: "GD Priscila",
      });
      expect(res.webhookUrl).toBe("https://evo.vexo.com/message/sendText/priscila_evo");
      expect(res.webhookToken).toBe("token-priscila");
      expect(res.source).toBe("inbound_chip");
      expect(res.instanceName).toBe("priscila_evo");
      expect(res.rawInstanceName).toBe("GD Priscila");
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });

  it("resolve pelo ID da instância (id)", async () => {
    _resetInboundChipLastGoodCache();
    setupMockPool();
    try {
      const res = await resolveInboundDispatchSettings({
        clientId: "geracao-digital",
        instanceName: "inst-uuid-1",
      });
      expect(res.webhookUrl).toBe("https://evo.vexo.com/message/sendText/priscila_evo");
      expect(res.webhookToken).toBe("token-priscila");
      expect(res.source).toBe("inbound_chip");
      expect(res.instanceName).toBe("priscila_evo");
      expect(res.rawInstanceName).toBe("GD Priscila");
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });

  it("resolve pelo segmento da URL de disparo (endpoint suffix)", async () => {
    _resetInboundChipLastGoodCache();
    setupMockPool();
    try {
      const res = await resolveInboundDispatchSettings({
        clientId: "geracao-digital",
        instanceName: "priscila_evo",
      });
      expect(res.webhookUrl).toBe("https://evo.vexo.com/message/sendText/priscila_evo");
      expect(res.source).toBe("inbound_chip");
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });

  it("chip inativo não é usado — cai para o default do tenant", async () => {
    _resetInboundChipLastGoodCache();
    setupMockPool();
    try {
      const res = await resolveInboundDispatchSettings({
        clientId: "geracao-digital",
        instanceName: "GD Inativo",
      });
      // Cai para o default do tenant (inst-uuid-1, que é a instância ativa default)
      expect(res.webhookUrl).toBe("https://evo.vexo.com/message/sendText/priscila_evo");
      expect(res.source).toBe("tenant:client_settings");
      expect(res.tentativas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fonte: "chip_do_webhook", resultado: "instancia_inativa" }),
          expect.objectContaining({ fonte: "default_do_tenant" }),
        ])
      );
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });

  it("chip sem URL de disparo não é usado — cai para o default do tenant", async () => {
    _resetInboundChipLastGoodCache();
    setupMockPool();
    try {
      const res = await resolveInboundDispatchSettings({
        clientId: "geracao-digital",
        instanceName: "GD Sem Url",
      });
      expect(res.webhookUrl).toBe("https://evo.vexo.com/message/sendText/priscila_evo");
      expect(res.source).toBe("tenant:client_settings");
      expect(res.tentativas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fonte: "chip_do_webhook", resultado: "sem_url_de_disparo" }),
          expect.objectContaining({ fonte: "default_do_tenant" }),
        ])
      );
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });

  it("sem chip informado no webhook, usa o default do tenant e registra tentativas", async () => {
    _resetInboundChipLastGoodCache();
    setupMockPool();
    try {
      const res = await resolveInboundDispatchSettings({
        clientId: "geracao-digital",
        instanceName: null,
      });
      expect(res.webhookUrl).toBe("https://evo.vexo.com/message/sendText/priscila_evo");
      expect(res.source).toBe("tenant:client_settings");
      expect(res.tentativas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fonte: "chip_do_webhook", resultado: "webhook_sem_instance" }),
          expect.objectContaining({ fonte: "default_do_tenant", temUrl: true }),
        ])
      );
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });
});
