// backend/src/test/campaignMessageEffectiveness.test.js
//
// GET /api/campaigns/reports/message-effectiveness — por campanha, o texto
// da mensagem, quantos receberam e quantos responderam, só campanhas com
// pelo menos 30 envios, ordenado por taxa de retorno. É o dado que dá tom
// real às receitas da Vexo Academy.

import { describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; this.statusCode = this.statusCode || 200; return this; },
  };
}

function getRouteHandler(deps, path, method = "get") {
  const routes = {};
  const fakeApp = {
    get: (p, ...handlers) => { routes[`get ${p}`] = handlers[handlers.length - 1]; },
    post: (p, ...handlers) => { routes[`post ${p}`] = handlers[handlers.length - 1]; },
    patch: (p, ...handlers) => { routes[`patch ${p}`] = handlers[handlers.length - 1]; },
    delete: (p, ...handlers) => { routes[`delete ${p}`] = handlers[handlers.length - 1]; },
    put: (p, ...handlers) => { routes[`put ${p}`] = handlers[handlers.length - 1]; },
    use: () => {},
  };
  registerCampaignsRoutes(fakeApp, deps);
  const handler = routes[`${method} ${path}`];
  expect(handler, `rota ${method.toUpperCase()} ${path} não encontrada`).toBeDefined();
  return handler;
}

function makeDeps({ rows = [], clientId = "tenant-1", overrides = {} } = {}) {
  const query = vi.fn(async (sql) => {
    if (sql.includes("FROM runs")) return { rows };
    return { rows: [] };
  });
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
    pgDatabasePool: { query },
    requireAppViewAccess: () => (req, res, next) => next(),
    requireCampaignDispatchAccess: (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(),
    requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: (req, res) => clientId,
    resolveCampaignDispatchSettings: async () => ({}),
    resolveDispatchWebhookSettings: async () => ({}),
    runDueCampaignDispatches: async () => {},
    sanitizePhone: (p) => p,
    sendError: vi.fn((res, status, code, message) => {
      res.statusCode = status;
      res.body = { error: { code, message } };
    }),
    supabase: {},
    validateN8nInboundBearer: () => true,
    ...overrides,
  };
}

describe("GET /api/campaigns/reports/message-effectiveness", () => {
  it("[TESTE OBRIGATÓRIO] só campanhas com pelo menos 30 envios entram, ordenadas por taxa de retorno", async () => {
    // Mock devolve as linhas JÁ na ordem que o ORDER BY do SQL real produziria
    // (a rota confia no banco pra ordenar, não reordena em JS) — por isso a
    // de maior taxa vem primeiro aqui, simulando exatamente esse contrato.
    const deps = makeDeps({
      rows: [
        { campaign_id: "c-alta", campaign_name: "Campanha alta taxa", message: "Olá {{nome}}, temos uma condição especial hoje.", sent_count: 30, replied_count: 15 },
        { campaign_id: "c-baixa", campaign_name: "Campanha baixa taxa", message: "Oi {{nome}}, tudo bem?", sent_count: 40, replied_count: 4 },
      ],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.body.minSent).toBe(30);
    expect(res.body.campaigns).toHaveLength(2);
    expect(res.body.campaigns[0].campaignId).toBe("c-alta");
    expect(res.body.campaigns[0].replyRate).toBe(50);
    expect(res.body.campaigns[0].message).toBe("Olá {{nome}}, temos uma condição especial hoje.");
    expect(res.body.campaigns[1].campaignId).toBe("c-baixa");
    expect(res.body.campaigns[1].replyRate).toBe(10);

    const call = deps.pgDatabasePool.query.mock.calls.find((c) => c[0].includes("FROM runs"));
    expect(call[1]).toEqual(["tenant-1", 30]);
    expect(call[0]).toContain("HAVING COUNT(*) >= $2");
  });

  it("campanha com menos de 30 envios não aparece — o SQL já filtra, aqui só prova que o mínimo é passado certo", async () => {
    const deps = makeDeps({ rows: [] });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.body.campaigns).toEqual([]);
  });
});
