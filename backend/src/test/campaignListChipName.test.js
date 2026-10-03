// backend/src/test/campaignListChipName.test.js
//
// GET /api/campaigns devolve `chip_name` em cada campanha (o chip do lote mais recente), para a busca
// da aba Campanhas achar pelo nome do chip. É enriquecimento: se a consulta falhar, a lista sai igual.

import { describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; },
  };
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
    getLeadClientEvolutionInstances: async () => [
      { id: "chip-1", client_id: clientId, name: "GD Gabriel", chip_state: "warm", active: true, sent_count_today: 10 },
    ],
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
  const handler = routes[`${method} ${path}`];
  expect(handler, `rota ${method.toUpperCase()} ${path} não encontrada`).toBeDefined();
  return handler;
}


function campaignsSupabase(rows) {
  const chain = {
    select: () => chain,
    is: () => chain,
    order: () => chain,
    eq: () => chain,
    or: () => chain,
    in: () => Promise.resolve({ data: [{ id: "tenant-1", name: "Tenant Teste" }], error: null }),
    then: (resolve) => resolve({ data: rows, error: null }),
  };
  return { from: () => chain };
}

const row = (id, name) => ({ id, name, client_id: "tenant-1", status: "active", mode: "disparo", created_at: "2026-10-01T10:00:00Z", analytics_meta: {} });

async function listar({ pool, instances, rows }) {
  const deps = makeDeps({
    pool,
    overrides: {
      supabase: campaignsSupabase(rows),
      getLeadClientEvolutionInstances: async () => instances,
      resolveAuthorizedClientId: () => "tenant-1",
    },
  });
  const handler = getRouteHandler(deps, "/api/campaigns");
  const res = fakeRes();
  await handler({ query: { clientId: "tenant-1" }, authAccess: {} }, res);
  return res;
}

describe("GET /api/campaigns — chip_name", () => {
  it("[TESTE OBRIGATÓRIO] cada campanha leva o nome do chip do seu lote mais recente", async () => {
    const query = vi.fn(async () => ({
      rows: [
        { campaign_id: "c1", evolution_instance_id: "chip-a" },
        { campaign_id: "c2", evolution_instance_id: "chip-b" },
      ],
    }));
    const res = await listar({
      pool: { query },
      instances: [
        { id: "chip-a", name: "GD Gabriel" },
        { id: "chip-b", name: "GD Priscila" },
      ],
      rows: [row("c1", "Black Friday"), row("c2", "Natal"), row("c3", "Sem lote")],
    });

    const porId = Object.fromEntries(res.body.items.map((i) => [i.id, i.chip_name]));
    expect(porId).toEqual({ c1: "GD Gabriel", c2: "GD Priscila", c3: null });
  });

  it("[TESTE OBRIGATÓRIO] uma única consulta para a lista toda (sem N+1), escopada pelo cliente e pelas campanhas listadas", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await listar({ pool: { query }, instances: [], rows: [row("c1", "A"), row("c2", "B"), row("c3", "C")] });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("client_id = $1");
    expect(params).toEqual(["tenant-1", ["c1", "c2", "c3"]]);
  });

  it("[TESTE OBRIGATÓRIO] se a consulta do chip falhar, a lista sai igual, com chip_name nulo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const query = vi.fn(async () => {
      throw new Error("coluna não existe");
    });
    const res = await listar({ pool: { query }, instances: [], rows: [row("c1", "A")] });

    expect(res.statusCode).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].chip_name).toBeNull();
  });

  it("chip apagado (id sem instância) não quebra: nome nulo", async () => {
    const query = vi.fn(async () => ({ rows: [{ campaign_id: "c1", evolution_instance_id: "chip-sumiu" }] }));
    const res = await listar({ pool: { query }, instances: [{ id: "outro", name: "X" }], rows: [row("c1", "A")] });

    expect(res.body.items[0].chip_name).toBeNull();
  });
});
