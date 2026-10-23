// backend/src/test/campaignWithoutSourceGuard.test.js
//
// Bloco 2 — campanha sem origem não monta lote.
// Em dispatch.js o filtro de import_id só entra quando há valor: origem NULL devolve a base inteira de planilhas do
// tenant. A campanha 0d3e7b15 (público do Banco, 2 leads) montou assim um lote de 504 (21/10/2026).
//
// Testes:
// - público do Banco sem origem: criar lote, disparar e run-pending devolvem 422 CAMPAIGN_WITHOUT_SOURCE e
//   buildDispatchLeads não é chamado
// - "todas as planilhas" legítima (NULL sem público do Banco, ou importSource "__all__") continua montando lote
// - "__crm__" continua montando lote
// - criar campanha do Banco sem origem: 422 e nada gravado em campaigns
// - editar campanha do Banco com importIds: [] mantém o import_id (era assim que a origem se perdia)
// - editar deixando campanha do Banco sem origem: 422
// - próximo da fila (startNextCampaignLeadInQueue) não começa em campanha do Banco sem origem, e campanha __crm__ com
//   público continua (mesma regra dos outros pontos)

import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";
import { startNextCampaignLeadInQueue } from "../campaign/dispatch.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";

const TENANT = "tenant-sem-origem";
const AUDIENCE = { clientId: TENANT, tags: ["VIP"], stages: [], totalCount: 2, description: "2 leads VIP" };
const STEPS = [{ id: "s1", type: "text", text: "Olá", order: 1, enabled: true, delayAfterSeconds: 0 }];

function bancoSemOrigem() {
  return {
    id: "camp-banco",
    name: "Bia do Spazio",
    client_id: TENANT,
    import_id: null,
    limit_per_run: 50,
    analytics_meta: { importIds: [], audienceCriteria: AUDIENCE, sequence: STEPS, message: "Olá" },
  };
}

function createPool(tables) {
  const queries = [];
  return {
    queries,
    query: async (sqlQuery, params) => {
      const sql = typeof sqlQuery === "string" ? sqlQuery : sqlQuery?.text || "";
      queries.push({ sql, params });
      if (sql.includes("campaign_dispatch_runs")) return { rows: [], rowCount: 0 };
      if (sql.includes("campaign_dispatches")) {
        if (/^\s*update/i.test(sql)) return { rows: [{ id: params?.[0] || "disp-1" }], rowCount: 1 };
        const rows = (tables.campaign_dispatches || []).filter((d) => !params?.[0] || d.id === params[0]);
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("campaigns")) {
        if (/^\s*insert/i.test(sql)) return { rows: [{ id: "camp-nova" }], rowCount: 1 };
        if (/^\s*update/i.test(sql)) return { rows: [tables.campaigns?.[0] || {}], rowCount: 1 };
        const rows = (tables.campaigns || []).filter((c) => !params?.[0] || c.id === params[0]);
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

async function setup(tables, { webhookUrl = null } = {}) {
  const pool = createPool(tables);
  _setPgDatabasePoolForTesting(pool);
  const { supabase } = await import("../services/database.js");
  const routes = {};
  const register = (method) => (path, ...handlers) => {
    routes[`${method} ${path}`] = handlers[handlers.length - 1];
  };
  const app = { post: register("POST"), get: register("GET"), patch: register("PATCH"), put() {}, delete() {}, use() {} };
  const buildDispatchLeads = vi.fn(async () => []);
  const registered = registerCampaignsRoutes(app, {
    supabase,
    buildDispatchLeads,
    resolveAuthorizedClientId: () => TENANT,
    resolveCampaignDispatchSettings: async () => ({ webhookUrl }),
    ensureDb: () => true,
    sendError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
    requireAppViewAccess: () => (_req, _res, next) => next(),
    requireFirebaseAuth: (_req, _res, next) => next(),
    requireCampaignDispatchAccess: (_req, _res, next) => next(),
    requireInternalPageAccess: () => (_req, _res, next) => next(),
    normalizeString: (s) => String(s ?? "").trim(),
    pgDatabasePool: pool,
    parseOptionalUuid: (v) => ({ value: v || null }),
    getLeadClientN8nSettings: async () => ({}),
    internalErrorPayloadDetails: () => ({}),
  });
  return { routes, pool, buildDispatchLeads, runCampaignDispatch: registered.runCampaignDispatch };
}

async function call(handler, req) {
  const out = { status: 200, body: null };
  const res = {
    status(code) {
      out.status = code;
      return res;
    },
    json(payload) {
      out.body = payload;
      return res;
    },
  };
  await handler({ authAccess: { uid: "u1", email: "dono@vexo.com" }, params: {}, query: {}, body: {}, ...req }, res);
  return out;
}

const lote = { id: "disp-1", campaign_id: "camp-banco", client_id: TENANT, name: "Lote", status: "scheduled", limit_per_run: 50, offset: 0, steps: STEPS };

describe("Bloco 2 — campanha de público do Banco sem origem não monta lote", () => {
  afterEach(() => _setPgDatabasePoolForTesting(null));

  it("run-pending: 422 CAMPAIGN_WITHOUT_SOURCE e zero chamadas a buildDispatchLeads", async () => {
    const { routes, buildDispatchLeads } = await setup({ campaigns: [bancoSemOrigem()], campaign_dispatches: [lote] });
    const out = await call(routes["POST /api/campaigns/dispatches/:dispatchId/run-pending"], { params: { dispatchId: "disp-1" } });
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe("CAMPAIGN_WITHOUT_SOURCE");
    expect(buildDispatchLeads).not.toHaveBeenCalled();
  });

  it("criar lote: 422 CAMPAIGN_WITHOUT_SOURCE, zero chamadas e nenhum lote gravado", async () => {
    const { routes, pool, buildDispatchLeads } = await setup({ campaigns: [bancoSemOrigem()] });
    const out = await call(routes["POST /api/campaigns/:id/dispatches"], {
      params: { id: "camp-banco" },
      body: { name: "Lote Principal", triggerType: "manual" },
    });
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe("CAMPAIGN_WITHOUT_SOURCE");
    expect(buildDispatchLeads).not.toHaveBeenCalled();
    expect(pool.queries.some((q) => /insert/i.test(q.sql) && q.sql.includes("campaign_dispatches"))).toBe(false);
  });

  it("disparar lote: 422 antes do claim (lote não vira running)", async () => {
    const { routes, pool, buildDispatchLeads } = await setup({ campaigns: [bancoSemOrigem()], campaign_dispatches: [lote] });
    const out = await call(routes["POST /api/campaigns/dispatches/:dispatchId/trigger"], { params: { dispatchId: "disp-1" } });
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe("CAMPAIGN_WITHOUT_SOURCE");
    expect(buildDispatchLeads).not.toHaveBeenCalled();
    expect(pool.queries.some((q) => /^\s*update/i.test(q.sql) && q.sql.includes("campaign_dispatches"))).toBe(false);
  });

  it("executor do lote (agendador e ocorrência recorrente): recusa sem montar fila e sem enviar", async () => {
    const { runCampaignDispatch, buildDispatchLeads, pool } = await setup({}, { webhookUrl: "https://evolution.example/webhook" });
    const { supabase } = await import("../services/database.js");
    await expect(runCampaignDispatch({ dispatch: lote, campaign: bancoSemOrigem(), supabase })).rejects.toMatchObject({
      code: "CAMPAIGN_WITHOUT_SOURCE",
    });
    expect(buildDispatchLeads).not.toHaveBeenCalled();
    expect(pool.queries.some((q) => q.sql.includes("campaign_dispatch_runs"))).toBe(false);
  });
});

describe("Bloco 2 — origens legítimas continuam montando lote", () => {
  afterEach(() => _setPgDatabasePoolForTesting(null));

  const casos = [
    ["'todas as planilhas' legado (NULL, sem público do Banco; a tela manda audienceCriteria: null)", { import_id: null, analytics_meta: { importIds: [], audienceCriteria: null, sequence: STEPS } }, null],
    ["'todas as planilhas' explícito (importSource __all__)", { import_id: null, analytics_meta: { importSource: "__all__", sequence: STEPS } }, null],
    ["__crm__", { import_id: null, analytics_meta: { importSource: "__crm__", sequence: STEPS } }, "__crm__"],
    ["__crm__ com público (audienceCriteria objeto)", { import_id: null, analytics_meta: { importSource: "__crm__", audienceCriteria: AUDIENCE, sequence: STEPS } }, "__crm__"],
    ["público do Banco com a planilha própria em import_id", { import_id: "imp-banco", analytics_meta: { importIds: [], audienceCriteria: AUDIENCE, sequence: STEPS } }, "imp-banco"],
  ];

  for (const [nome, origem, importIdEsperado] of casos) {
    it(`run-pending monta lote: ${nome}`, async () => {
      const campanha = { ...bancoSemOrigem(), ...origem };
      const { routes, buildDispatchLeads } = await setup({ campaigns: [campanha], campaign_dispatches: [lote] });
      const out = await call(routes["POST /api/campaigns/dispatches/:dispatchId/run-pending"], { params: { dispatchId: "disp-1" } });
      expect(out.body?.error?.code).not.toBe("CAMPAIGN_WITHOUT_SOURCE");
      expect(buildDispatchLeads).toHaveBeenCalledTimes(1);
      expect(buildDispatchLeads.mock.calls[0][0].importId).toBe(importIdEsperado);
    });
  }
});

describe("Bloco 2 — o problema não nasce na criação nem na edição", () => {
  afterEach(() => _setPgDatabasePoolForTesting(null));

  const corpoCriacao = {
    name: "Campanha Banco",
    clientId: TENANT,
    mode: "disparo",
    importId: null,
    importIds: [],
    analyticsMeta: { audienceCriteria: AUDIENCE, sequence: STEPS, message: "Olá" },
  };

  it("criar campanha do Banco sem origem: 422 e nada gravado em campaigns", async () => {
    const { routes, pool } = await setup({});
    const out = await call(routes["POST /api/campaigns"], { body: structuredClone(corpoCriacao) });
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe("CAMPAIGN_WITHOUT_SOURCE");
    expect(pool.queries.some((q) => /insert/i.test(q.sql) && q.sql.includes("campaigns"))).toBe(false);
  });

  it("criar campanha de 'todas as planilhas' (sem público do Banco) não é recusada pela trava", async () => {
    const { routes } = await setup({});
    const body = { ...structuredClone(corpoCriacao), importSource: "__all__", analyticsMeta: { audienceCriteria: null, sequence: STEPS, message: "Olá" } };
    const out = await call(routes["POST /api/campaigns"], { body });
    expect(out.body?.error?.code).not.toBe("CAMPAIGN_WITHOUT_SOURCE");
  });

  function updateDeCampanha(pool) {
    return pool.queries.find((q) => /^\s*update/i.test(q.sql) && q.sql.includes("campaigns") && !q.sql.includes("campaign_dispatches"));
  }

  it("editar campanha do Banco com importIds: [] e importId da planilha do Banco mantém o import_id", async () => {
    const atual = { ...bancoSemOrigem(), import_id: "imp-banco", status: "active", is_recurring: false };
    const { routes, pool } = await setup({ campaigns: [atual] });
    const out = await call(routes["PATCH /api/campaigns/:id"], {
      params: { id: "camp-banco" },
      body: { name: "Bia do Spazio", importId: "imp-banco", importIds: [], analyticsMeta: atual.analytics_meta },
    });
    expect(out.body?.error?.code).not.toBe("CAMPAIGN_WITHOUT_SOURCE");
    const update = updateDeCampanha(pool);
    expect(update).toBeDefined();
    expect(update.params).toContain("imp-banco");
  });

  it("campanha JÁ quebrada (0d3e7b15: Banco, import_id NULL) sai do 422 pelo Salvar que manda a origem", async () => {
    // O que a tela manda ao salvar: o público do Banco registrado como planilha nova (imp-novo) em importId,
    // importIds: [] (ver campaignBancoSemOrigemSave.test.tsx). O conserto não pode ficar trancado no próprio bug.
    const atual = { ...bancoSemOrigem(), status: "active", is_recurring: false };
    const { routes, pool } = await setup({ campaigns: [atual] });
    const out = await call(routes["PATCH /api/campaigns/:id"], {
      params: { id: "camp-banco" },
      body: { name: "Bia do Spazio", importId: "imp-novo", importIds: [], analyticsMeta: atual.analytics_meta },
    });
    expect(out.body?.error?.code).not.toBe("CAMPAIGN_WITHOUT_SOURCE");
    const update = updateDeCampanha(pool);
    expect(update).toBeDefined();
    expect(update.params).toContain("imp-novo");
  });

  it("editar deixando campanha do Banco sem origem: 422 e nada atualizado", async () => {
    const atual = { ...bancoSemOrigem(), import_id: "imp-banco", status: "active", is_recurring: false };
    const { routes, pool } = await setup({ campaigns: [atual] });
    const out = await call(routes["PATCH /api/campaigns/:id"], {
      params: { id: "camp-banco" },
      body: { importId: null, importIds: [], analyticsMeta: atual.analytics_meta },
    });
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe("CAMPAIGN_WITHOUT_SOURCE");
    expect(updateDeCampanha(pool)).toBeUndefined();
  });

  it("arquivar campanha antiga sem origem continua possível (a trava só olha edição de origem/conteúdo)", async () => {
    const atual = { ...bancoSemOrigem(), status: "active", is_recurring: false };
    const { routes } = await setup({ campaigns: [atual] });
    const out = await call(routes["PATCH /api/campaigns/:id"], { params: { id: "camp-banco" }, body: { archived: true } });
    expect(out.body?.error?.code).not.toBe("CAMPAIGN_WITHOUT_SOURCE");
  });
});

describe("Bloco 2 — próximo da fila na resposta", () => {
  it("startNextCampaignLeadInQueue não começa campanha do Banco sem origem", async () => {
    _setPgDatabasePoolForTesting(createPool({}));
    try {
      const campaign = bancoSemOrigem();
      campaign.analytics_meta.dispatchOptions = { waitForReply: true };
      const result = await startNextCampaignLeadInQueue({ campaign, clientId: TENANT });
      expect(result).toEqual({ started: false, reason: "campaign_without_source" });
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });

  it("campanha __crm__ com público (audienceCriteria objeto) continua na fila", async () => {
    const pool = createPool({});
    _setPgDatabasePoolForTesting(pool);
    try {
      const campaign = bancoSemOrigem();
      campaign.analytics_meta.importSource = "__crm__";
      campaign.analytics_meta.dispatchOptions = { waitForReply: true };
      const result = await startNextCampaignLeadInQueue({ campaign, clientId: TENANT });
      expect(result.reason).not.toBe("campaign_without_source");
      // passou da trava: chegou a montar a fila
      expect(pool.queries.length).toBeGreaterThan(0);
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });
});
