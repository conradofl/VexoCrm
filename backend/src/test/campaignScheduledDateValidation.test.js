// backend/src/test/campaignScheduledDateValidation.test.js
//
// BLOCO 3 — Trava de data vencida no backend
// Prova que o backend recusa agendamentos no passado para:
// - POST /api/campaigns/:id/dispatches
// - PATCH /api/campaigns/dispatches/:dispatchId
// - POST /api/campaigns
// - PATCH /api/campaigns/:id

import { describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

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
      this.statusCode = this.statusCode || 200;
      return this;
    },
  };
}

function makeDeps({ clientId = "tenant-1", overrides = {} } = {}) {
  return {
    CAMPAIGN_SCHEDULER_MAX_BATCH: 10,
    buildDispatchLeads: async () => [],
    canCampaignBeDispatched: () => true,
    checkEvolutionInstanceHealth: async () => ({ state: "open" }),
    continueCampaignLeadFromReply: async () => {},
    ensureDb: () => true,
    executeCampaignDispatch: async () => {},
    findCampaignReplyMatches: async () => [],
    getClientName: async () => "Tenant Teste",
    getLeadClientEvolutionInstances: async () => [],
    getLeadClientN8nSettings: async () => ({}),
    getRequestId: () => "req-1",
    getSafeDispatchSettingsLog: () => ({}),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    isProduction: false,
    logCampaignReplyFlow: () => {},
    logDirectDispatch: () => {},
    maskPhoneForLog: (p) => p,
    normalizeIsoDate: (d) => d,
    leadsTableName: "lead_import_items",
    normalizeString: (s) => String(s || "").trim(),
    normalizeTenantKey: (s) => String(s || "").trim(),
    parseOptionalUuid: (s) => ({ value: s || null, error: null }),
    pgDatabasePool: null,
    requireAppViewAccess: () => (req, res, next) => next(),
    requireCampaignDispatchAccess: (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(),
    requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: (req, res) => clientId,
    resolveRequiredAuthorizedClientId: ({ requestedClientId }) => requestedClientId || clientId,
    resolveCampaignDispatchSettings: async () => ({}),
    resolveDispatchWebhookSettings: async () => ({}),
    resolveTenantTimezone: async () => "America/Sao_Paulo",
    runDueCampaignDispatches: async () => {},
    sanitizePhone: (p) => p,
    sendError: vi.fn((res, status, code, message) => {
      res.statusCode = status;
      res.body = { error: { code, message } };
    }),
    supabase: {
      from: (table) => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: "camp-1",
                client_id: clientId,
                analytics_meta: { sequence: [{ type: "text", text: "Olá {{nome}}" }] },
                campaign_prompt_id: null,
              },
              error: null,
            }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: "disp-new", status: "scheduled", scheduled_at: "2099-01-01T00:00:00.000Z" },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: { id: "disp-1", status: "scheduled" },
                error: null,
              }),
            }),
          }),
        }),
      }),
    },
    validateCampaignAnalyticsMeta: () => ({ valid: true, analyticsMeta: { sequence: [{ type: "text", text: "Olá" }] } }),
    validateN8nInboundBearer: () => true,
    ...overrides,
  };
}

function getRouteHandler(deps, path, method = "get") {
  const routes = {};
  const fakeApp = {
    get: (p, ...handlers) => { routes[`get ${p}`] = handlers[handlers.length - 1]; },
    post: (p, ...handlers) => { routes[`post ${p}`] = handlers[handlers.length - 1]; },
    put: (p, ...handlers) => { routes[`put ${p}`] = handlers[handlers.length - 1]; },
    patch: (p, ...handlers) => { routes[`patch ${p}`] = handlers[handlers.length - 1]; },
    delete: (p, ...handlers) => { routes[`delete ${p}`] = handlers[handlers.length - 1]; },
    use: () => {},
  };
  registerCampaignsRoutes(fakeApp, deps);
  const handler = routes[`${method} ${path}`];
  expect(handler, `rota ${method.toUpperCase()} ${path} não encontrada`).toBeDefined();
  return handler;
}

describe("BLOCO 3 — Trava de data vencida no backend", () => {
  it("(d) o backend recusa data no passado mesmo se a tela mandar (POST /api/campaigns/:id/dispatches)", async () => {
    const deps = makeDeps();
    const handler = getRouteHandler(deps, "/api/campaigns/:id/dispatches", "post");

    const pastIso = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hora atrás
    const req = {
      params: { id: "camp-1" },
      body: {
        name: "Lote Principal",
        triggerType: "scheduled",
        scheduledAt: pastIso,
        steps: [{ type: "text", text: "Olá" }],
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error?.code).toBe("SCHEDULED_DATE_IN_PAST");
    expect(deps.sendError).toHaveBeenCalledWith(
      expect.anything(),
      400,
      "SCHEDULED_DATE_IN_PAST",
      expect.stringContaining("passado")
    );
  });

  it("POST /api/campaigns/:id/dispatches com minuto corrente é aceito (não recusa os segundos decorridos)", async () => {
    const deps = makeDeps();
    const handler = getRouteHandler(deps, "/api/campaigns/:id/dispatches", "post");

    // Minuto corrente (segundos zerados, como o input datetime-local envia)
    const currentMinuteIso = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
    const req = {
      params: { id: "camp-1" },
      body: {
        name: "Lote Principal",
        triggerType: "scheduled",
        scheduledAt: currentMinuteIso,
        steps: [{ type: "text", text: "Olá" }],
      },
    };
    const res = fakeRes();

    await handler(req, res);

    const pastCalls = deps.sendError.mock.calls.filter(c => c[2] === "SCHEDULED_DATE_IN_PAST");
    expect(pastCalls.length).toBe(0);
    expect(res.statusCode).toBe(201);
  });

  it("POST /api/campaigns/:id/dispatches absorve atraso de requisição de 60s dentro da folga de 120s", async () => {
    const deps = makeDeps();
    const handler = getRouteHandler(deps, "/api/campaigns/:id/dispatches", "post");

    // Minuto anterior recente (60s atrás) — simula fronteira onde o usuário enviou no fim do minuto anterior
    const recentMinIso = new Date(Math.floor(Date.now() / 60000) * 60000 - 60000).toISOString();
    const req = {
      params: { id: "camp-1" },
      body: {
        name: "Lote Principal",
        triggerType: "scheduled",
        scheduledAt: recentMinIso,
        steps: [{ type: "text", text: "Olá" }],
      },
    };
    const res = fakeRes();

    await handler(req, res);

    // Deve ser aceito porque está dentro dos 120s de folga
    const pastCalls = deps.sendError.mock.calls.filter(c => c[2] === "SCHEDULED_DATE_IN_PAST");
    expect(pastCalls.length).toBe(0);
    expect(res.statusCode).toBe(201);
  });

  it("POST /api/campaigns/:id/dispatches com data futura é aceito", async () => {
    const deps = makeDeps();
    const handler = getRouteHandler(deps, "/api/campaigns/:id/dispatches", "post");

    const futureIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString(); // amanhã
    const req = {
      params: { id: "camp-1" },
      body: {
        name: "Lote Principal",
        triggerType: "scheduled",
        scheduledAt: futureIso,
        steps: [{ type: "text", text: "Olá" }],
      },
    };
    const res = fakeRes();

    await handler(req, res);

    // Não deve chamar sendError com SCHEDULED_DATE_IN_PAST
    const pastCalls = deps.sendError.mock.calls.filter(c => c[2] === "SCHEDULED_DATE_IN_PAST");
    expect(pastCalls.length).toBe(0);
    expect(res.statusCode).toBe(201);
  });

  it("PATCH /api/campaigns/dispatches/:dispatchId recusa scheduledAt no passado", async () => {
    const deps = makeDeps();
    const handler = getRouteHandler(deps, "/api/campaigns/dispatches/:dispatchId", "patch");

    const pastIso = new Date(Date.now() - 7200 * 1000).toISOString();
    const req = {
      params: { dispatchId: "disp-1" },
      body: {
        triggerType: "scheduled",
        scheduledAt: pastIso,
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error?.code).toBe("SCHEDULED_DATE_IN_PAST");
  });

  it("POST /api/campaigns recusa scheduledFor no passado", async () => {
    const deps = makeDeps();
    const handler = getRouteHandler(deps, "/api/campaigns", "post");

    const pastIso = new Date(Date.now() - 3600 * 1000).toISOString();
    const req = {
      body: {
        name: "Campanha Teste",
        clientId: "tenant-1",
        mode: "disparo",
        scheduledFor: pastIso,
        analyticsMeta: { message: "Oi", sequence: [{ type: "text", text: "Oi" }] },
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error?.code).toBe("SCHEDULED_DATE_IN_PAST");
  });

  it("PATCH /api/campaigns/:id recusa scheduledFor no passado", async () => {
    const deps = makeDeps();
    const handler = getRouteHandler(deps, "/api/campaigns/:id", "patch");

    const pastIso = new Date(Date.now() - 3600 * 1000).toISOString();
    const req = {
      params: { id: "camp-1" },
      body: {
        scheduledFor: pastIso,
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error?.code).toBe("SCHEDULED_DATE_IN_PAST");
  });
});
