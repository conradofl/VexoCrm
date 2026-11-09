import { describe, expect, it, vi, beforeEach } from "vitest";
import { notificarDiretoriaWhatsapp } from "../domains/geracaoDigitalContracts/contractHandlers.js";
import * as evolutionModule from "../services/evolution.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";

const TENANT_ID = "11111111-2222-3333-4444-555555555555";

describe("GD Contratos — Notificação no WhatsApp da Diretoria", () => {
  let mockDb;
  let sentCalls = [];

  beforeEach(() => {
    sentCalls = [];
    vi.restoreAllMocks();
    vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockImplementation(async (args) => {
      sentCalls.push(args);
      return { success: true };
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

  it("retorna 404 se o contrato não for encontrado", async () => {
    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    _setPgDatabasePoolForTesting(mockDb);

    const { req, res, getStatus, getJson } = makeReqRes("contrato-inexistente");
    await notificarDiretoriaWhatsapp(req, res);

    expect(getStatus()).toBe(404);
    expect(getJson().error.code).toBe("NOT_FOUND");
    expect(sentCalls.length).toBe(0);
  });

  it("usa a instância definida nas configurações do módulo do tenant se existir", async () => {
    const contract = {
      id: "ct-001",
      tenant_id: TENANT_ID,
      dados: {
        razao_social: "Acme Solar Ltda",
        cnpj: "12.345.678/0001-90",
        responsavel_nome: "Maria Gestora",
      },
    };

    mockDb = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes("FROM public.gd_contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("FROM public.tenant_modules")) {
          return {
            rows: [
              {
                config: {
                  gd: {
                    juridico: {
                      evolution_instance: "instancia-custom-tenant",
                    },
                  },
                },
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    _setPgDatabasePoolForTesting(mockDb);

    const { req, res, getStatus, getJson } = makeReqRes("ct-001");
    await notificarDiretoriaWhatsapp(req, res);

    expect(getStatus()).toBe(200);
    const json = getJson();
    expect(json.success).toBe(true);
    expect(json.instance).toBe("instancia-custom-tenant");
    expect(sentCalls.length).toBe(2);
    expect(sentCalls[0].instanceName).toBe("instancia-custom-tenant");
    expect(sentCalls[0].number).toBe(process.env.GD_CAIO_WHATSAPP || "5534997719779");
    expect(sentCalls[1].number).toBe(process.env.GD_CONRADO_WHATSAPP || "5534991751267");
    expect(sentCalls[0].text).toContain("Acme Solar Ltda");
    expect(sentCalls[0].text).toContain("12.345.678/0001-90");
    expect(sentCalls[0].text).toContain("Maria Gestora");
    expect(sentCalls[0].text).toContain("https://crm.vexoia.com/api/gd/contracts/ct-001/pdf");
  });

  it("busca instância padrão de lead_client_evolution_instances quando o tenant não especifica", async () => {
    const contract = {
      id: "ct-002",
      tenant_id: TENANT_ID,
      dados: JSON.stringify({
        razao_social: "Solaris Tech",
        cnpj: "98.765.432/0001-10",
        representante: "João Diretor",
      }),
    };

    mockDb = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes("FROM public.gd_contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("FROM public.tenant_modules")) {
          return { rows: [{ config: {} }] };
        }
        if (sql.includes("FROM public.lead_client_evolution_instances")) {
          return { rows: [{ name: "instancia-banco-ativa" }] };
        }
        return { rows: [] };
      }),
    };
    _setPgDatabasePoolForTesting(mockDb);

    const { req, res, getStatus, getJson } = makeReqRes("ct-002");
    await notificarDiretoriaWhatsapp(req, res);

    expect(getStatus()).toBe(200);
    const json = getJson();
    expect(json.instance).toBe("instancia-banco-ativa");
    expect(sentCalls[0].instanceName).toBe("instancia-banco-ativa");
    expect(sentCalls[0].text).toContain("Solaris Tech");
  });

  it("usa fallback vexo-adm (e NUNCA vexo-adm-vexo-atende) quando não há instância configurada", async () => {
    const contract = {
      id: "ct-003",
      tenant_id: TENANT_ID,
      dados: {
        empresa: "Empresa Fallback",
      },
    };

    mockDb = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes("FROM public.gd_contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("FROM public.tenant_modules")) {
          return { rows: [] };
        }
        if (sql.includes("FROM public.lead_client_evolution_instances")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
    _setPgDatabasePoolForTesting(mockDb);

    const { req, res, getStatus, getJson } = makeReqRes("ct-003");
    await notificarDiretoriaWhatsapp(req, res);

    expect(getStatus()).toBe(200);
    const json = getJson();
    expect(json.instance).toBe("vexo-adm");
    expect(json.instance).not.toBe("vexo-adm-vexo-atende");
    expect(sentCalls[0].instanceName).toBe("vexo-adm");
  });

  it("registra erro no array resultados quando falha o envio para um dos números, sem interromper os demais", async () => {
    const contract = {
      id: "ct-004",
      tenant_id: TENANT_ID,
      dados: { razao_social: "Empresa Teste Erro" },
    };

    mockDb = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes("FROM public.gd_contracts")) return { rows: [contract] };
        return { rows: [] };
      }),
    };
    _setPgDatabasePoolForTesting(mockDb);

    let callCount = 0;
    vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Erro simulado Evolution WhatsApp");
      }
      return { success: true };
    });

    const { req, res, getStatus, getJson } = makeReqRes("ct-004");
    await notificarDiretoriaWhatsapp(req, res);

    expect(getStatus()).toBe(200);
    const json = getJson();
    expect(json.success).toBe(true);
    expect(json.resultados).toHaveLength(2);
    expect(json.resultados[0].status).toBe("error");
    expect(json.resultados[0].error).toBe("Erro simulado Evolution WhatsApp");
    expect(json.resultados[1].status).toBe("sent");
  });

  it("registra a rota POST /api/gd/contracts/:id/notificar-diretoria", async () => {
    const { registerContractRoutes } = await import("../domains/geracaoDigitalContracts/contractRoutes.js");
    const registeredRoutes = [];
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      post: vi.fn((path, ...handlers) => {
        registeredRoutes.push({ path, handlers });
      }),
    };

    registerContractRoutes(app);
    const notifRoute = registeredRoutes.find((r) => r.path === "/api/gd/contracts/:id/notificar-diretoria");
    expect(notifRoute).toBeDefined();
    expect(notifRoute.handlers).toContain(notificarDiretoriaWhatsapp);
  });
});
