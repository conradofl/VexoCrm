// backend/src/test/campaignScheduledCascadeDispatches.test.js
//
// Teste de Propagação Automática na Edição (PATCH /api/campaigns/:id):
// Quando scheduled_for é alterado na campanha, todos os lotes pendentes
// (scheduled, draft, paused) devem ser reagendados em cascata com intervalo de 1h.

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

function makeDeps({ clientId = "tenant-1", poolQueries = [], overrides = {} } = {}) {
  const pool = {
    query: vi.fn(async (sql, params) => {
      poolQueries.push({ sql, params });
      if (sql.includes("SELECT id, \"offset\", target_count FROM public.campaign_dispatches")) {
        return {
          rows: [
            { id: "batch-1", offset: 0, target_count: 50 },
            { id: "batch-2", offset: 50, target_count: 50 },
            { id: "batch-3", offset: 100, target_count: 50 },
          ],
        };
      }
      if (sql.includes("FROM public.campaign_dispatches") && sql.includes('"offset" > $3')) {
        return {
          rows: [
            { id: "batch-2" },
            { id: "batch-3" },
          ],
        };
      }
      if (sql.includes("UPDATE public.campaign_dispatches")) {
        return { rowCount: 1 };
      }
      if (sql.includes("UPDATE public.campaigns")) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    }),
  };

  return {
    deps: {
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
      pgDatabasePool: pool,
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
        from: (table) => {
          if (table === "campaign_dispatches") {
            return {
              select: () => ({
                eq: (col, val) => ({
                  single: async () => ({
                    data: {
                      id: val || "batch-1",
                      campaign_id: "camp-1",
                      status: "scheduled",
                      offset: 0,
                      target_count: 50,
                    },
                    error: null,
                  }),
                }),
              }),
              update: (fields) => ({
                eq: (col1, val1) => ({
                  neq: () => ({
                    select: () => Promise.resolve({
                      data: [{ id: val1 }],
                      error: null,
                    }),
                  }),
                  select: () => ({
                    single: async () => ({
                      data: { id: val1, ...fields },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: "camp-1",
                    client_id: clientId,
                    analytics_meta: { sequence: [{ type: "text", text: "Olá" }] },
                  },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: "camp-1",
                        name: "Campanha Atualizada",
                        client_id: clientId,
                        status: "scheduled",
                        scheduled_for: "2099-05-10T14:00:00.000Z",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        },
      },
      validateCampaignAnalyticsMeta: () => ({ valid: true, analyticsMeta: { sequence: [{ type: "text", text: "Olá" }] } }),
      validateN8nInboundBearer: () => true,
      ...overrides,
    },
    pool,
    poolQueries,
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
  return routes[`${method} ${path}`];
}

describe("Propagação Automática na Edição (PATCH /api/campaigns/:id)", () => {
  it("reagenda em cascata todos os lotes pendentes preservando intervalo de 1h quando scheduledFor é atualizado", async () => {
    const { deps, pool, poolQueries } = makeDeps();
    const handler = getRouteHandler(deps, "/api/campaigns/:id", "patch");

    const newSchedule = "2099-05-10T14:00:00.000Z";
    const req = {
      params: { id: "camp-1" },
      body: {
        scheduledFor: newSchedule,
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);

    // Deve ter buscado os lotes pendentes da campanha
    const selectQuery = poolQueries.find((q) => q.sql.includes("SELECT id, \"offset\", target_count FROM public.campaign_dispatches"));
    expect(selectQuery).toBeDefined();
    expect(selectQuery.params).toEqual(["camp-1"]);

    // Deve ter atualizado os 3 lotes com 1h de intervalo
    const updateQueries = poolQueries.filter((q) => q.sql.includes("UPDATE public.campaign_dispatches"));
    expect(updateQueries).toHaveLength(3);

    // Lote 1: 14:00
    expect(updateQueries[0].params[0]).toBe(new Date("2099-05-10T14:00:00.000Z").toISOString());
    expect(updateQueries[0].params[1]).toBe("batch-1");

    // Lote 2: 15:00 (+1h)
    expect(updateQueries[1].params[0]).toBe(new Date("2099-05-10T15:00:00.000Z").toISOString());
    expect(updateQueries[1].params[1]).toBe("batch-2");

    // Lote 3: 16:00 (+2h)
    expect(updateQueries[2].params[0]).toBe(new Date("2099-05-10T16:00:00.000Z").toISOString());
    expect(updateQueries[2].params[1]).toBe("batch-3");
  });

  it("aceita scheduled_for em snake_case e propaga igualmente", async () => {
    const { deps, poolQueries } = makeDeps();
    const handler = getRouteHandler(deps, "/api/campaigns/:id", "patch");

    const newSchedule = "2099-06-01T10:00:00.000Z";
    const req = {
      params: { id: "camp-1" },
      body: {
        scheduled_for: newSchedule,
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);

    const updateQueries = poolQueries.filter((q) => q.sql.includes("UPDATE public.campaign_dispatches"));
    expect(updateQueries).toHaveLength(3);
    expect(updateQueries[0].params[0]).toBe(new Date("2099-06-01T10:00:00.000Z").toISOString());
    expect(updateQueries[1].params[0]).toBe(new Date("2099-06-01T11:00:00.000Z").toISOString());
    expect(updateQueries[2].params[0]).toBe(new Date("2099-06-01T12:00:00.000Z").toISOString());
  });
});

describe("Disparo Manual com Cascata (POST /api/campaigns/dispatches/:dispatchId/trigger)", () => {
  it("reagenda lotes subsequentes com intervalo de 1h e atualiza timestamp da campanha para recontagem do ETA", async () => {
    const { deps, poolQueries } = makeDeps();
    // Janela desligada: este teste é da cascata, não da janela. Com a config vazia a janela padrão (08–20 seg–sex)
    // valeria e o resultado dependeria da hora em que a suíte roda (o botão recusa fora dela desde 30/10/2026).
    deps.getLeadClientN8nSettings = async () => ({ send_window_enabled: false });
    const handler = getRouteHandler(deps, "/api/campaigns/dispatches/:dispatchId/trigger", "post");

    const req = {
      params: { dispatchId: "batch-1" },
      body: {},
    };
    const res = fakeRes();

    const before = Date.now();
    await handler(req, res);
    const after = Date.now();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, status: "running", dispatchId: "batch-1" });

    // Verifica consulta dos lotes subsequentes (offset > 0)
    const subsequentQuery = poolQueries.find(
      (q) => q.sql.includes("FROM public.campaign_dispatches") && q.sql.includes('"offset" > $3')
    );
    expect(subsequentQuery).toBeDefined();
    expect(subsequentQuery.params[0]).toBe("camp-1");
    expect(subsequentQuery.params[1]).toBe("batch-1");
    expect(subsequentQuery.params[2]).toBe(0);

    // Deve ter atualizado os lotes subsequentes (batch-2 e batch-3)
    const updateDispatches = poolQueries.filter((q) => q.sql.includes("UPDATE public.campaign_dispatches"));
    expect(updateDispatches).toHaveLength(2);

    // batch-2: ~now + 1h
    const timeBatch2 = new Date(updateDispatches[0].params[0]).getTime();
    expect(timeBatch2).toBeGreaterThanOrEqual(before + 3600000);
    expect(timeBatch2).toBeLessThanOrEqual(after + 3600000);
    expect(updateDispatches[0].params[1]).toBe("batch-2");

    // batch-3: ~now + 2h
    const timeBatch3 = new Date(updateDispatches[1].params[0]).getTime();
    expect(timeBatch3).toBeGreaterThanOrEqual(before + 7200000);
    expect(timeBatch3).toBeLessThanOrEqual(after + 7200000);
    expect(updateDispatches[1].params[1]).toBe("batch-3");

    // Verifica que a campanha mãe teve seu updated_at atualizado para recalcular o ETA
    const updateCampaign = poolQueries.find((q) => q.sql.includes("UPDATE public.campaigns"));
    expect(updateCampaign).toBeDefined();
    expect(updateCampaign.params[0]).toBe("camp-1");
  });
});

