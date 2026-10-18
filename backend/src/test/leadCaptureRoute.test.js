// backend/src/test/leadCaptureRoute.test.js
// Testes das rotas HTTP públicas POST /api/public/leads/capture e /api/public/diagnostico

import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerLeadCaptureRoutes } from "../domains/leads/captureRoutes.js";
import { resetCaptureRateLimit } from "../services/leadCapture.js";
import * as evolutionModule from "../services/evolution.js";
import * as leadUpsertModule from "../services/leadUpsert.js";

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) {
      this.statusCode = s;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

function getCaptureHandler(deps, path = "/api/public/leads/capture") {
  const routes = {};
  const fakeApp = {
    post: (p, ...handlers) => {
      routes[`post ${p}`] = handlers[handlers.length - 1];
    },
  };
  registerLeadCaptureRoutes(fakeApp, deps);
  return routes[`post ${path}`];
}

describe("Rotas Públicas de Captura de Leads (/api/public/leads/capture e /api/public/diagnostico)", () => {
  let pool;
  let deps;

  beforeEach(() => {
    resetCaptureRateLimit();
    vi.restoreAllMocks();

    pool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    };

    deps = {
      pgDatabasePool: pool,
      sendError: (res, status, code, message) => {
        res.status(status).json({ error: code, message });
      },
    };
  });

  it("registra ambas as rotas públicas /api/public/leads/capture e /api/public/diagnostico", () => {
    const handler1 = getCaptureHandler(deps, "/api/public/leads/capture");
    const handler2 = getCaptureHandler(deps, "/api/public/diagnostico");
    expect(handler1).toBeDefined();
    expect(handler2).toBeDefined();
  });

  it("recusa requisição com telefone inválido (400 TELEFONE_INVALIDO)", async () => {
    const handler = getCaptureHandler(deps);
    const req = {
      headers: { "x-forwarded-for": "10.0.0.1" },
      body: {
        fullName: "João Silva",
        phone: "123",
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("TELEFONE_INVALIDO");
  });

  it("descarta honeypot silenciosamente respondendo 200 sem gravar lead", async () => {
    const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone");
    const handler = getCaptureHandler(deps);
    const req = {
      headers: { "x-forwarded-for": "10.0.0.2" },
      body: {
        fullName: "Robô de Spam",
        phone: "34991751267",
        website_url: "http://bot.ru",
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("aplica rate limit recusando o 6º envio no mesmo IP (429 RATE_LIMIT_EXCEEDED)", async () => {
    const handler = getCaptureHandler(deps);
    const ip = "10.0.0.50";

    vi.spyOn(leadUpsertModule, "upsertLeadByPhone").mockResolvedValue("inserted");

    // 5 envios permitidos
    for (let i = 1; i <= 5; i++) {
      const req = {
        headers: { "x-forwarded-for": ip },
        body: {
          fullName: `Lead ${i}`,
          phone: "34991751267",
        },
      };
      const res = fakeRes();
      await handler(req, res);
      expect(res.statusCode).toBe(200);
    }

    // 6º envio recusado
    const req6 = {
      headers: { "x-forwarded-for": ip },
      body: {
        fullName: "Lead 6",
        phone: "34991751267",
      },
    };
    const res6 = fakeRes();
    await handler(req6, res6);

    expect(res6.statusCode).toBe(429);
    expect(res6.body.error).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("processa com sucesso lead multi-tenant, salva no banco e retorna confirmação real mascarada", async () => {
    const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone").mockResolvedValue("inserted");
    const evoSendSpy = vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockResolvedValue({
      success: true,
      waMessageId: "WA_123",
    });

    const handler = getCaptureHandler(deps, "/api/public/diagnostico");
    const req = {
      headers: { "x-forwarded-for": "187.12.34.56" },
      body: {
        client_id: "solar-prime",
        fullName: "Carlos Eduardo",
        phone: "(34) 99175-1267",
        email: "carlos@solarprime.com.br",
        company: "Solar Prime",
        teamSize: "3 vendedores",
        baseSize: "10.000 a 50.000 contatos",
        responseTime: "5 a 30 minutos",
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.phoneMasked).toBe("(34) *****-1267");
    expect(res.body.message).toMatch(/Pronto! Te mandamos uma mensagem no WhatsApp \(34\) \*\*\*\*\*-1267/i);

    // Verifica que o lead foi salvo para o tenant especificado (solar-prime)
    expect(upsertSpy).toHaveBeenCalledWith(
      pool,
      "solar-prime",
      "5534991751267",
      expect.objectContaining({
        nome: "Carlos Eduardo",
        tags: ["diagnostico-site"],
        email: "carlos@solarprime.com.br",
      })
    );

    // Aguarda microtask para disparo assíncrono
    await new Promise((r) => setTimeout(r, 10));

    expect(evoSendSpy).toHaveBeenCalled();
  });
});
