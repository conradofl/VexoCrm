import { describe, it, expect, vi } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

function createMockDeps(overrides = {}) {
  const clientId = "bia-do-spazio";
  const instancesInDb = [
    { id: "259a9f78-0000-0000-0000-000000000000", client_id: clientId, name: "Chip 2222" },
    { id: "19f36f2c-0000-0000-0000-000000000000", client_id: clientId, name: "Chip 4343" },
  ];

  const fakeCampaign = {
    id: "camp-uuid-123",
    client_id: clientId,
    name: "Campanha Funil",
    campaign_prompt_id: null,
    limit_per_run: 50,
    evolution_instance_id: "259a9f78-0000-0000-0000-000000000000",
    analytics_meta: {
      sequence: [
        { id: "step-1", type: "text", text: "Olá {{nome}}", triggerMode: "immediate" },
      ],
      dispatchOptions: {},
    },
  };

  const pool = {
    query: vi.fn().mockImplementation(async (sql, params) => {
      if (sql.includes("FROM public.campaigns") || sql.includes("SELECT c.id")) {
        return { rows: [fakeCampaign] };
      }
      return { rows: [] };
    }),
  };

  const supabaseMock = {
    from: (table) => {
      if (table === "campaigns") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: fakeCampaign, error: null }),
                maybeSingle: async () => ({ data: fakeCampaign, error: null }),
              }),
              single: async () => ({ data: fakeCampaign, error: null }),
              maybeSingle: async () => ({ data: fakeCampaign, error: null }),
            }),
          }),
        };
      }
      if (table === "lead_client_evolution_instances") {
        return {
          select: () => ({
            eq: (col, val) => ({
              in: async (col2, ids) => {
                const matched = instancesInDb.filter((inst) => ids.includes(inst.id));
                return { data: matched, error: null };
              },
            }),
          }),
        };
      }
      if (table === "campaign_dispatches") {
        return {
          insert: (payload) => ({
            select: () => ({
              single: async () => ({ data: { id: "disp-new-123", ...payload }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            single: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },
  };

  return {
    app: null,
    supabase: supabaseMock,
    pgDatabasePool: pool,
    ensureDb: () => true,
    normalizeString: (s) => String(s || "").trim(),
    parseOptionalUuid: (s) => ({ value: s || null, error: null }),
    ensureCampaignDispatchEvolutionInstanceColumn: async () => {},
    resolveAuthorizedClientId: (req, res, id) => id || clientId,
    resolveCampaignImportSelectionStrict: () => "import-123",
    refuseCampaignWithoutSource: () => {},
    validateCampaignDispatchEvolutionInstance: async () => true,
    normalizeCampaignAnalyticsMeta: (m) => m,
    validateCampaignAnalyticsMeta: (m) => ({ valid: true, analyticsMeta: m }),
    buildDispatchLeads: async () => [{ phone: "5511999999999" }],
    resolveCampaignImportSelection: () => "import-123",
    requireFirebaseAuth: (req, res, next) => next(),
    requireCampaignDispatchAccess: (req, res, next) => next(),
    requireInternalPageAccess: () => (req, res, next) => next(),
    requireAppViewAccess: () => (req, res, next) => next(),
    resolveCampaignDispatchSettings: async () => ({}),
    resolveDispatchWebhookSettings: async () => ({}),
    runDueCampaignDispatches: async () => {},
    sendError: vi.fn((res, status, code, message, details) => {
      res.statusCode = status;
      res.body = { error: { code, message, details } };
      return res;
    }),
    ...overrides,
  };
}

function getRouteHandler(deps, path, method = "post") {
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

describe("SPEC 1 — Trava no backend contra uuid de chip morto em handoffChipIds", () => {
  it("recusa lote com chip inexistente/morto devolvendo 422 HANDOFF_CHIP_NOT_FOUND com a lista dos inválidos", async () => {
    const deps = createMockDeps();
    const handler = getRouteHandler(deps, "/api/campaigns/:id/dispatches", "post");

    const deadChipUuid = "f7d66677-71e4-4a32-8644-857eb8d95d53";
    const req = {
      params: { id: "camp-uuid-123" },
      body: {
        name: "Lote Teste Handoff",
        triggerType: "manual",
        dispatch_options: {
          handoffEnabled: true,
          handoffChipIds: [deadChipUuid, "19f36f2c-0000-0000-0000-000000000000"],
        },
      },
    };

    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };

    await handler(req, res);

    expect(deps.sendError).toHaveBeenCalledWith(
      res,
      422,
      "HANDOFF_CHIP_NOT_FOUND",
      expect.stringContaining("f7d66677-71e4-4a32-8644-857eb8d95d53"),
      { invalidChipIds: [deadChipUuid] }
    );
    expect(res.statusCode).toBe(422);
  });

  it("recusa lote se handoff estiver ligado mas a lista de chips for vazia (422 HANDOFF_CHIPS_EMPTY)", async () => {
    const deps = createMockDeps();
    const handler = getRouteHandler(deps, "/api/campaigns/:id/dispatches", "post");

    const req = {
      params: { id: "camp-uuid-123" },
      body: {
        name: "Lote Teste Handoff Vazio",
        triggerType: "manual",
        dispatch_options: {
          handoffEnabled: true,
          handoffChipIds: [],
        },
      },
    };

    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };

    await handler(req, res);

    expect(deps.sendError).toHaveBeenCalledWith(
      res,
      422,
      "HANDOFF_CHIPS_EMPTY",
      expect.stringContaining("nenhum chip fechador válido foi selecionado")
    );
    expect(res.statusCode).toBe(422);
  });

  it("permite criação do lote quando todos os chips de handoff existem no tenant", async () => {
    const deps = createMockDeps();
    const handler = getRouteHandler(deps, "/api/campaigns/:id/dispatches", "post");

    const req = {
      params: { id: "camp-uuid-123" },
      body: {
        name: "Lote Válido",
        triggerType: "manual",
        dispatch_options: {
          handoffEnabled: true,
          handoffChipIds: ["19f36f2c-0000-0000-0000-000000000000"],
        },
      },
    };

    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.dispatch).toBeDefined();
    expect(res.body.dispatch.id).toBe("disp-new-123");
  });
});
