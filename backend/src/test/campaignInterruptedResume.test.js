// backend/src/test/campaignInterruptedResume.test.js
//
// Testes para SPEC 13 — Retomada de lotes em 'interrupted', 'failed' e 'paused',
// e prevenção de status 'interrupted' espúrio por falha na query de contagem.
// O caminho completo com Postgres real (Retomar → agendador → envio → 'done', e o boot) está em
// campaignInterruptedResumePostgres.test.js; as provas por mutação rodam contra ele.

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

function makePool({ bulkUpdateRows = [] } = {}) {
  const calls = [];
  const query = vi.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("UPDATE public.campaign_dispatches")) {
      return { rows: bulkUpdateRows };
    }
    return { rows: [] };
  });
  return { query, calls };
}

function makeDeps({ pool, clientId = "tenant-1", overrides = {} } = {}) {
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
    getLeadClientN8nSettings: async () => ({ send_window_enabled: false }),
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
    resolveAuthorizedClientId: () => clientId,
    resolveCampaignDispatchSettings: async () => ({}),
    resolveDispatchWebhookSettings: async () => ({}),
    runDueCampaignDispatches: async () => {},
    sanitizePhone: (p) => p,
    sendError: vi.fn((res, status, code, message) => {
      res.statusCode = status;
      res.body = { error: { code, message } };
    }),
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: { id: "camp-1", client_id: clientId }, error: null }) }),
        }),
      }),
    },
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
  return routes[`${method} ${path}`];
}

describe("SPEC 13 — Retomada de lotes interrupted/failed", () => {
  it("bulk action resume inclui 'paused', 'interrupted' e 'failed' no alvo do UPDATE", async () => {
    const pool = makePool({
      bulkUpdateRows: [
        { id: "disp-interrupted-1", target_count: 7 },
        { id: "disp-failed-1", target_count: 5 },
      ],
    });
    const deps = makeDeps({ pool });
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/dispatches/bulk-action", "post");
    const res = fakeRes();

    await handler({ params: { campaignId: "camp-1" }, body: { action: "resume" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.affectedDispatches).toBe(2);
    expect(res.body.affectedLeads).toBe(12);

    const updateCall = pool.calls.find((c) => c.sql.includes("UPDATE public.campaign_dispatches"));
    expect(updateCall.sql).toContain("SET status = 'scheduled'");
    expect(updateCall.params[2]).toEqual(["paused", "interrupted", "failed"]);
  });

  it("bulk action resume com 0 lotes afetados responde 400 NO_DISPATCHES_RESUMED", async () => {
    const pool = makePool({ bulkUpdateRows: [] });
    const deps = makeDeps({ pool });
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/dispatches/bulk-action", "post");
    const res = fakeRes();

    await handler({ params: { campaignId: "camp-1" }, body: { action: "resume" } }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("NO_DISPATCHES_RESUMED");
    expect(res.body.error.message).toContain("Nenhum lote elegível para retomada");
  });

  describe("fechamento de lote: 7 de 7 enviados termina 'done', nunca 'interrupted'", () => {
    const leads7 = Array.from({ length: 7 }, (_, i) => ({
      id: `lead-${i + 1}`,
      nome: `Lead ${i + 1}`,
      telefone: `551199999000${i + 1}`,
      client_id: "tenant-1",
    }));

    const mockCampaign = {
      id: "camp-7",
      name: "Campanha 7 Leads",
      client_id: "tenant-1",
      mode: "campanha",
      analytics_meta: {
        sequence: [
          { id: "step-1", type: "text", text: "Olá {{nome}}", order: 1, enabled: true, delayAfterSeconds: 0 },
        ],
      },
    };

    function setupDispatchEnv({ countQueryThrows = false, runCounts = { sent: 7, failed: 0, invalid: 0, skipped: 0 } } = {}) {
      const dispatchesTable = {
        "disp-7": {
          id: "disp-7",
          campaign_id: "camp-7",
          client_id: "tenant-1",
          status: "running",
          target_count: 7,
          limit_per_run: 7,
          offset: 0,
        },
      };

      const mockPool = {
        query: vi.fn(async (sql, params) => {
          const text = String(sql || "");
          if (text.includes("FROM public.campaign_dispatch_runs") && text.includes("WHERE dispatch_id = $1")) {
            if (countQueryThrows) {
              throw new Error("Simulated transient connection timeout");
            }
            return {
              rows: [
                {
                  sent: runCounts.sent,
                  failed: runCounts.failed,
                  invalid: runCounts.invalid,
                  skipped: runCounts.skipped,
                },
              ],
            };
          }
          if (text.includes("SELECT") && text.includes("FROM public.campaign_dispatch_runs") && text.includes("claimed")) {
            return { rows: [] };
          }
          if (text.includes("SELECT") && text.includes("FROM public.campaign_dispatch_runs") && text.includes("lead_id = ANY")) {
            return { rows: [] };
          }
          if (text.includes("occurrence_info")) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };

      const mockSupabase = {
        from: (table) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: dispatchesTable["disp-7"], error: null }),
              single: async () => ({ data: dispatchesTable["disp-7"], error: null }),
            }),
          }),
          update: (patch) => ({
            eq: (col, val) => {
              if (table === "campaign_dispatches" && val === "disp-7") {
                Object.assign(dispatchesTable["disp-7"], patch);
              }
              return { data: dispatchesTable["disp-7"], error: null };
            },
          }),
        }),
      };

      const originalFetch = global.fetch;
      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ key: { id: "msg-123" } }),
      }));

      const deps = makeDeps({
        pool: mockPool,
        overrides: {
          buildDispatchLeads: async () => leads7,
          resolveCampaignDispatchSettings: async () => ({
            webhookUrl: "https://evolution.teste/message/sendText/chip-1",
            webhookToken: "secret-token",
            instanceName: "GD Gabriel",
          }),
          getLeadClientEvolutionInstances: async () => [
            { id: "chip-1", client_id: "tenant-1", name: "GD Gabriel", dispatch_webhook_url: "https://evolution.teste/send", active: true },
          ],
        },
      });

      const fakeApp = {
        get: () => {},
        post: () => {},
        put: () => {},
        patch: () => {},
        delete: () => {},
        use: () => {},
      };
      const { runCampaignDispatch } = registerCampaignsRoutes(fakeApp, deps);

      return {
        runCampaignDispatch,
        dispatchesTable,
        mockSupabase,
        restoreFetch: () => { global.fetch = originalFetch; },
      };
    }

    it("lote de 7 leads com 7 envios concluídos termina com status 'done', NUNCA 'interrupted'", async () => {
      const env = setupDispatchEnv({
        countQueryThrows: false,
        runCounts: { sent: 7, failed: 0, invalid: 0, skipped: 0 },
      });

      try {
        await env.runCampaignDispatch({
          dispatch: env.dispatchesTable["disp-7"],
          campaign: mockCampaign,
          supabase: env.mockSupabase,
          ignoreSendWindow: true,
        });

        expect(env.dispatchesTable["disp-7"].status).toBe("done");
        expect(env.dispatchesTable["disp-7"].sent_count).toBe(7);
        expect(env.dispatchesTable["disp-7"].error_message).toBeNull();
      } finally {
        env.restoreFetch();
      }
    });

    it("se a query de contagem falhar, o lote NÃO é marcado como 'interrupted' com pendências falsas", async () => {
      const env = setupDispatchEnv({
        countQueryThrows: true,
      });

      try {
        await env.runCampaignDispatch({
          dispatch: env.dispatchesTable["disp-7"],
          campaign: mockCampaign,
          supabase: env.mockSupabase,
          ignoreSendWindow: true,
        });

        // Com o fix, quando a contagem falha, o status NÃO é 'interrupted'
        // e nenhuma mensagem falsa de '7 lead(s) pendente(s)' é gravada.
        expect(env.dispatchesTable["disp-7"].status).not.toBe("interrupted");
        expect(env.dispatchesTable["disp-7"].error_message ?? "").not.toContain("Interrompido: 7 lead(s) pendente(s)");
      } finally {
        env.restoreFetch();
      }
    });
  });
});
