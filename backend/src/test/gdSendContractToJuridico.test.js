import { describe, expect, it, vi, beforeEach } from "vitest";
import { sendContractToJuridico } from "../domains/geracaoDigitalContracts/juridicoHandlers.js";
import * as evolutionModule from "../services/evolution.js";
import * as contractHandlersModule from "../domains/geracaoDigitalContracts/contractHandlers.js";
import { generateContractPdf } from "../domains/geracaoDigitalContracts/contractHandlers.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { resolveCampaignImportSelectionStrict } from "../campaign/dispatch.js";

const TENANT_ID = "11111111-2222-3333-4444-555555555555";

describe("sendContractToJuridico e resolveCampaignImportSelectionStrict", () => {
  let mockDb;
  let sentCalls = [];

  beforeEach(() => {
    sentCalls = [];
    vi.restoreAllMocks();
    delete process.env.SLACK_BOT_TOKEN;
    vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockImplementation(async (args) => {
      sentCalls.push(args);
      return { success: true };
    });
    vi.spyOn(contractHandlersModule, "buildContractPdfBuffer").mockResolvedValue({
      dados: {
        razao_social: "Cliente Teste",
        cnpj: "12.345.678/0001-99",
        representante: "Fulano de Tal",
        prazo_dias: 30,
        telefone: "34999999999",
      },
      pdfData: Buffer.from("fake-pdf"),
    });
  });

  function makeReqRes(contractId, userTenant = TENANT_ID) {
    const req = {
      params: { id: contractId },
      query: { client_id: userTenant },
      body: { client_id: userTenant },
      auth: { uid: "user-123", email: "user@test.com" },
      authAccess: {
        role: "internal",
        scopeMode: "all_clients",
        isAdmin: true,
        clientId: userTenant,
      },
      headers: {},
    };
    let statusCode = 200;
    let jsonResult = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonResult = data;
        return this;
      },
      headersSent: false,
    };
    return { req, res, getStatus: () => statusCode, getJson: () => jsonResult };
  }

  it("permite envio ao jurídico sem Slack configurado, notificando diretoria no WhatsApp e atualizando status", async () => {
    const queries = [];
    mockDb = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes("FROM public.tenant_modules")) {
          return {
            rows: [
              {
                config: {
                  gd: {
                    juridico: {
                      slack_channel_id: "",
                      whatsapp_number: "",
                    },
                  },
                },
              },
            ],
          };
        }
        if (sql.includes("FROM public.lead_client_evolution_instances")) {
          return {
            rows: [
              {
                name: "Comercial - Hostery",
                dispatch_webhook_url: "https://evolution.example.com/message/sendText/geracao-digital-comercial-hostery",
                client_id: "geracao-digital",
                connection_state: "open",
                is_default: true,
              },
            ],
          };
        }
        if (sql.includes("UPDATE gd_contracts")) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      }),
    };
    _setPgDatabasePoolForTesting(mockDb);

    const { req, res, getStatus, getJson } = makeReqRes("ct-100");
    await sendContractToJuridico(req, res);

    expect(getStatus()).toBe(200);
    const json = getJson();
    expect(json).toEqual({
      success: true,
      slack: "skipped",
      whatsapp: "sent",
    });

    // Verifica que atualizou status para em_revisao_juridico
    const updateQuery = queries.find((q) => q.sql.includes("UPDATE gd_contracts"));
    expect(updateQuery).toBeDefined();
    expect(updateQuery.sql).toContain("status = 'em_revisao_juridico'");

    // Verifica que Caio e Conrado foram notificados via chip conectado da hostery
    expect(sentCalls.length).toBe(2);
    expect(sentCalls[0].instanceName).toBe("geracao-digital-comercial-hostery");
    expect(sentCalls[0].number).toBe("5534997719779");
    expect(sentCalls[0].text).toContain("https://crm.vexoia.com/api/gd/contracts/ct-100/pdf");
    expect(sentCalls[0].text).toContain("Cliente Teste");

    expect(sentCalls[1].instanceName).toBe("geracao-digital-comercial-hostery");
    expect(sentCalls[1].number).toBe("5534991751267");
    expect(sentCalls[1].text).toContain("https://crm.vexoia.com/api/gd/contracts/ct-100/pdf");
  });

  it("quando channelId e SLACK_BOT_TOKEN existem, tenta enviar ao Slack e reporta slack: sent", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    const queries = [];
    mockDb = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes("FROM public.tenant_modules")) {
          return {
            rows: [
              {
                config: {
                  gd: {
                    juridico: {
                      slack_channel_id: "C12345678",
                      whatsapp_number: "5534988887777",
                    },
                  },
                },
              },
            ],
          };
        }
        if (sql.includes("FROM public.lead_client_evolution_instances")) {
          return {
            rows: [
              {
                name: "Comercial - Hostery",
                dispatch_webhook_url: "https://evolution.example.com/message/sendText/geracao-digital-comercial-hostery",
                client_id: "geracao-digital",
                connection_state: "open",
                is_default: true,
              },
            ],
          };
        }
        if (sql.includes("UPDATE gd_contracts")) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      }),
    };
    _setPgDatabasePoolForTesting(mockDb);

    // Mock fetch para chamadas do Slack
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes("/files.getUploadURLExternal")) {
        return {
          json: async () => ({ ok: true, upload_url: "https://upload.example.com", file_id: "F123" }),
        };
      }
      if (url.includes("https://upload.example.com")) {
        return { ok: true, status: 200 };
      }
      if (url.includes("/files.completeUploadExternal")) {
        return { json: async () => ({ ok: true }) };
      }
      if (url.includes("/chat.postMessage")) {
        return { json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    try {
      const { req, res, getStatus, getJson } = makeReqRes("ct-200");
      await sendContractToJuridico(req, res);

      expect(getStatus()).toBe(200);
      const json = getJson();
      expect(json.success).toBe(true);
      expect(json.slack).toBe("sent");
      expect(json.whatsapp).toBe("sent");

      // Notificou whatsapp_number do jurídico + Caio + Conrado
      expect(sentCalls.length).toBe(3);
      expect(sentCalls[0].number).toBe("5534988887777");
      expect(sentCalls[1].number).toBe("5534997719779");
      expect(sentCalls[2].number).toBe("5534991751267");
    } finally {
      global.fetch = originalFetch;
    }
  });

  describe("resolveCampaignImportSelectionStrict", () => {
    it("retorna campaign.import_id quando tem audienceCriteria do Banco e import_id preenchido", () => {
      const campaign = {
        import_id: "import-sheet-456",
        analytics_meta: {
          audienceCriteria: { minScore: 10 },
        },
      };
      const result = resolveCampaignImportSelectionStrict(campaign);
      expect(result).toBe("import-sheet-456");
    });

    it("retorna __crm__ quando tem audienceCriteria do Banco e import_id ausente", () => {
      const campaign = {
        import_id: null,
        analytics_meta: {
          audienceCriteria: { tag: "quente" },
        },
      };
      const result = resolveCampaignImportSelectionStrict(campaign);
      expect(result).toBe("__crm__");
    });

    it("retorna __all__ para campanha sem audienceCriteria e sem planilha", () => {
      const campaign = {
        import_id: null,
        analytics_meta: {},
      };
      const result = resolveCampaignImportSelectionStrict(campaign);
      expect(result).toBe("__all__");
    });
  });

  describe("generateContractPdf via link público/WhatsApp (sem header Authorization)", () => {
    it("permite visualização direta do PDF sem header Authorization para contratos da GD", async () => {
      const dbMock = {
        query: vi.fn(async (sql, params) => {
          if (sql.includes("SELECT id, tenant_id, owner_company FROM public.gd_contracts")) {
            return {
              rows: [{ id: "ct-123", tenant_id: TENANT_ID, owner_company: "geracao-digital" }],
            };
          }
          if (sql.includes("SELECT * FROM gd_contracts WHERE id = $1")) {
            return {
              rows: [
                {
                  id: "ct-123",
                  tenant_id: TENANT_ID,
                  dados: { texto_final: "Contrato de Prestação de Serviços GD", razao_social: "Cliente Teste" },
                },
              ],
            };
          }
          if (sql.includes("tenant_contratada_config")) {
            return { rows: [] };
          }
          if (sql.includes("UPDATE gd_contracts")) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };
      _setPgDatabasePoolForTesting(dbMock);

      const headers = {};
      let sentData = null;
      const req = {
        params: { id: "ct-123" },
        headers: {},
      };
      const res = {
        setHeader(name, val) {
          headers[name] = val;
        },
        getHeader(name) {
          return headers[name] || null;
        },
        send(data) {
          sentData = data;
          return this;
        },
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      await generateContractPdf(req, res);

      expect(headers["Content-Type"]).toBe("application/pdf");
      expect(sentData).toBeTruthy();
    });

    it("bloqueia contratos restritos à Vexo com 403 mesmo sem header", async () => {
      let statusCode = 200;
      let jsonResult = null;
      const headers = {};
      const dbMock = {
        query: vi.fn(async (sql) => {
          if (sql.includes("SELECT id, tenant_id, owner_company FROM public.gd_contracts")) {
            return {
              rows: [{ id: "ct-vexo", tenant_id: TENANT_ID, owner_company: "vexo" }],
            };
          }
          return { rows: [] };
        }),
      };
      _setPgDatabasePoolForTesting(dbMock);

      const req = {
        params: { id: "ct-vexo" },
        headers: {},
      };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          jsonResult = data;
          return this;
        },
        setHeader(name, val) {
          headers[name] = val;
        },
        getHeader(name) {
          return headers[name] || null;
        },
        send: vi.fn(),
      };

      await generateContractPdf(req, res);

      expect(statusCode).toBe(403);
      expect(jsonResult?.error?.code).toBe("FORBIDDEN");
    });

    it("responde 404 para contrato inexistente sem header", async () => {
      let statusCode = 200;
      let jsonResult = null;
      const headers = {};
      const dbMock = {
        query: vi.fn(async () => ({ rows: [] })),
      };
      _setPgDatabasePoolForTesting(dbMock);

      const req = {
        params: { id: "ct-inexistente" },
        headers: {},
      };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          jsonResult = data;
          return this;
        },
        setHeader(name, val) {
          headers[name] = val;
        },
        getHeader(name) {
          return headers[name] || null;
        },
        send: vi.fn(),
      };

      await generateContractPdf(req, res);

      expect(statusCode).toBe(404);
      expect(jsonResult?.error?.code).toBe("NOT_FOUND");
    });
  });
});

