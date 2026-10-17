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

function makePool() {
  const calls = [];
  const query = vi.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("DELETE FROM public.lead_import_items")) {
      return { rowCount: params[1].length };
    }
    return { rows: [], rowCount: 1 };
  });
  return { query, calls };
}

function makeDeps({ pool, clientId = "client-test-123" } = {}) {
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
    pgDatabasePool: pool,
    requireAppViewAccess: () => (req, res, next) => next(),
    requireCampaignDispatchAccess: (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(),
    requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: (req, res, reqId) => reqId || clientId,
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
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
        delete: () => ({ in: () => ({ eq: () => ({ select: async () => ({ data: [{ id: "1" }], error: null }) }) }) }),
      }),
    },
    validateN8nInboundBearer: () => true,
  };
}

function getRoutes(deps) {
  const routes = {};
  const fakeApp = {
    get: (p, ...handlers) => { routes[`get ${p}`] = handlers[handlers.length - 1]; },
    post: (p, ...handlers) => { routes[`post ${p}`] = handlers[handlers.length - 1]; },
    delete: (p, ...handlers) => { routes[`delete ${p}`] = handlers[handlers.length - 1]; },
    put: (p, ...handlers) => { routes[`put ${p}`] = handlers[handlers.length - 1]; },
    patch: (p, ...handlers) => { routes[`patch ${p}`] = handlers[handlers.length - 1]; },
  };
  registerCampaignsRoutes(fakeApp, deps);
  return routes;
}

describe("Rotas de exclusão e reset de disparos da auditoria de planilha", () => {
  it("DELETE e POST /api/campaigns/reports/delete-import-items estão registradas e executam deleção via pool", async () => {
    const pool = makePool();
    const deps = makeDeps({ pool });
    const routes = getRoutes(deps);

    const deleteHandler = routes["delete /api/campaigns/reports/delete-import-items"];
    const postHandler = routes["post /api/campaigns/reports/delete-import-items"];

    expect(typeof deleteHandler).toBe("function");
    expect(typeof postHandler).toBe("function");

    const itemIds = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];

    // Testar chamada DELETE
    const reqDelete = {
      body: {
        clientId: "client-test-123",
        leadImportItemIds: itemIds,
      },
    };
    const resDelete = fakeRes();
    await deleteHandler(reqDelete, resDelete);

    expect(resDelete.statusCode).toBe(200);
    expect(resDelete.body).toEqual({ success: true, deletedCount: 2 });

    // Verifica que limpou campaign_dispatch_runs e depois lead_import_items
    expect(pool.calls).toHaveLength(2);
    expect(pool.calls[0].sql).toContain("DELETE FROM public.campaign_dispatch_runs");
    expect(pool.calls[0].params).toEqual(["client-test-123", itemIds]);
    expect(pool.calls[1].sql).toContain("DELETE FROM public.lead_import_items");
    expect(pool.calls[1].params).toEqual(["client-test-123", itemIds]);

    // Testar chamada POST com os mesmos parâmetros
    pool.calls.length = 0;
    const reqPost = {
      body: {
        clientId: "client-test-123",
        leadImportItemIds: itemIds,
      },
    };
    const resPost = fakeRes();
    await postHandler(reqPost, resPost);

    expect(resPost.statusCode).toBe(200);
    expect(resPost.body).toEqual({ success: true, deletedCount: 2 });
    expect(pool.calls).toHaveLength(2);
  });

  it("POST /api/campaigns/reports/reset-dispatch-history remove runs e reseta normalized_data/status_conversa", async () => {
    const pool = makePool();
    const deps = makeDeps({ pool });
    const routes = getRoutes(deps);

    const resetHandler = routes["post /api/campaigns/reports/reset-dispatch-history"];
    expect(typeof resetHandler).toBe("function");

    const itemIds = ["33333333-3333-4333-8333-333333333333"];
    const req = {
      body: {
        clientId: "client-test-123",
        leadImportItemIds: itemIds,
      },
    };
    const res = fakeRes();
    await resetHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, resetCount: 1 });

    // Verifica que apagou runs e fez UPDATE em lead_import_items
    expect(pool.calls).toHaveLength(2);
    expect(pool.calls[0].sql).toContain("DELETE FROM public.campaign_dispatch_runs");
    expect(pool.calls[0].params).toEqual(["client-test-123", itemIds]);
    expect(pool.calls[1].sql).toContain("UPDATE public.lead_import_items");
    expect(pool.calls[1].sql).toContain("- 'progress' - 'status_conversa'");
    expect(pool.calls[1].params).toEqual(["client-test-123", itemIds]);
  });

  it("retorna erro 400 se leadImportItemIds for vazio", async () => {
    const pool = makePool();
    const deps = makeDeps({ pool });
    const routes = getRoutes(deps);

    const deleteHandler = routes["delete /api/campaigns/reports/delete-import-items"];
    const resetHandler = routes["post /api/campaigns/reports/reset-dispatch-history"];

    const resDel = fakeRes();
    await deleteHandler({ body: { clientId: "client-123", leadImportItemIds: [] } }, resDel);
    expect(resDel.statusCode).toBe(400);
    expect(resDel.body.error.code).toBe("MISSING_LEAD_IMPORT_ITEM_IDS");

    const resReset = fakeRes();
    await resetHandler({ body: { clientId: "client-123", leadImportItemIds: [] } }, resReset);
    expect(resReset.statusCode).toBe(400);
    expect(resReset.body.error.code).toBe("MISSING_LEAD_IMPORT_ITEM_IDS");
  });
});
