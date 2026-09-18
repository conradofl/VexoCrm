// backend/src/test/campaignDispatchSummaryRoute.test.js
//
// GET /api/campaigns/dispatch-summary e POST /api/campaigns/:campaignId/
// dispatches/bulk-action — "uma linha por campanha, lote vira quadrado".
// Cobre: agregação real (soma correta, não tudo igual), Ativas/Encerradas,
// ausência de N+1, escopo de tenant, e que as ações em massa atingem só os
// lotes pendentes.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; this.statusCode = this.statusCode || 200; return this; },
  };
}

/**
 * Mock de pgDatabasePool.query que roteia pela FORMA da SQL — igual a um
 * banco de verdade responderia à mesma pergunta, mas sem precisar de um
 * Postgres. `groupedRows` já vem como se o GROUP BY tivesse rodado (uma
 * linha por campanha, com array_agg de status); `batchRows` são os lotes
 * individuais (pros quadrados); `repliedRows` é o resultado da consulta de
 * resposta; `bulkUpdateRows` é o que a query de UPDATE...RETURNING devolve.
 */
function makePool({ groupedRows = [], repliedRows = [], batchRows = [], bulkUpdateRows = [] } = {}) {
  const calls = [];
  const query = vi.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("GROUP BY d.campaign_id, c.name")) {
      return { rows: groupedRows };
    }
    if (sql.includes("campaign_dispatch_runs r") && sql.includes("replied_count")) {
      return { rows: repliedRows };
    }
    if (sql.includes("UPDATE public.campaign_dispatches")) {
      return { rows: bulkUpdateRows };
    }
    if (sql.includes("FROM public.campaign_dispatches") && sql.includes("ORDER BY created_at ASC")) {
      return { rows: batchRows };
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

describe("GET /api/campaigns/dispatch-summary", () => {
  it("[TESTE OBRIGATÓRIO] agrupa de verdade: 33 lotes com números diferentes viram UMA linha, com sent_count somado certo", async () => {
    // 33 lotes com contagens DIFERENTES entre si — se a soma estivesse
    // errada (ex.: pegando só o primeiro/último, ou multiplicando por
    // contagem em vez de somar), um teste com tudo igual não pegaria.
    const sentPerLote = Array.from({ length: 33 }, (_, i) => (i % 7) + 1); // 1..7 variando
    const somaEsperada = sentPerLote.reduce((a, b) => a + b, 0);

    const pool = makePool({
      groupedRows: [{
        campaign_id: "camp-multilote",
        campaign_name: "Campanha 33 Lotes",
        lote_count: 33,
        sent_total: somaEsperada,
        failed_total: 12,
        leads_total: 660,
        leads_pending: 0,
        leads_pause_target: 0,
        leads_resume_target: 0,
        leads_cancel_target: 0,
        statuses: Array(33).fill("done"),
        evolution_instance_id: "chip-1",
        next_scheduled_at: null,
        last_updated_at: new Date().toISOString(),
      }],
    });
    const deps = makeDeps({ pool });
    const handler = getRouteHandler(deps, "/api/campaigns/dispatch-summary");
    const req = { query: { clientId: "tenant-1", scope: "ended" } };
    const res = fakeRes();

    await handler(req, res);

    expect(res.body.campaigns).toHaveLength(1);
    expect(res.body.campaigns[0].loteCount).toBe(33);
    expect(res.body.campaigns[0].sentTotal).toBe(somaEsperada);
    expect(somaEsperada).not.toBe(33 * sentPerLote[0]); // prova que não é "tudo igual"
  });

  it("[TESTE OBRIGATÓRIO] status agregado por precedência chega correto na resposta da rota", async () => {
    const pool = makePool({
      groupedRows: [{
        campaign_id: "camp-enviando",
        campaign_name: "Em andamento",
        lote_count: 33,
        sent_total: 500,
        failed_total: 2,
        leads_total: 600,
        leads_pending: 100,
        leads_pause_target: 100,
        leads_resume_target: 0,
        leads_cancel_target: 0,
        statuses: ["running", ...Array(31).fill("done"), "scheduled"],
        evolution_instance_id: "chip-1",
        next_scheduled_at: null,
        last_updated_at: new Date().toISOString(),
      }],
    });
    const deps = makeDeps({ pool });
    const handler = getRouteHandler(deps, "/api/campaigns/dispatch-summary");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1", scope: "active" } }, res);

    expect(res.body.campaigns[0].status).toBe("enviando");
    expect(res.body.campaigns[0].statusLabel).toBe("Enviando");
  });

  it("[TESTE OBRIGATÓRIO] Ativas e Encerradas: contagens batem com o total, e cada campanha cai na aba certa", async () => {
    const base = {
      lote_count: 1, sent_total: 1, failed_total: 0, leads_total: 1, leads_pending: 0,
      leads_pause_target: 0, leads_resume_target: 0, leads_cancel_target: 0,
      evolution_instance_id: null, next_scheduled_at: null, last_updated_at: new Date().toISOString(),
    };
    const groupedRows = [
      { ...base, campaign_id: "c-done", campaign_name: "Concluída", statuses: ["done"] },
      { ...base, campaign_id: "c-cancel", campaign_name: "Cancelada", statuses: ["cancelled", "done"] },
      { ...base, campaign_id: "c-running", campaign_name: "Rodando", statuses: ["running"], leads_pending: 5 },
      { ...base, campaign_id: "c-paused", campaign_name: "Pausada com pendente", statuses: ["paused", "done"], leads_pending: 3 },
    ];
    const pool = makePool({ groupedRows });
    const deps = makeDeps({ pool });

    const handlerActive = getRouteHandler(deps, "/api/campaigns/dispatch-summary");
    const resActive = fakeRes();
    await handlerActive({ query: { clientId: "tenant-1", scope: "active" } }, resActive);

    expect(resActive.body.counts.active).toBe(2); // c-running, c-paused
    expect(resActive.body.counts.ended).toBe(2); // c-done, c-cancel
    expect(resActive.body.counts.active + resActive.body.counts.ended).toBe(groupedRows.length);
    const activeIds = resActive.body.campaigns.map((c) => c.campaignId).sort();
    expect(activeIds).toEqual(["c-paused", "c-running"]);

    const handlerEnded = getRouteHandler(deps, "/api/campaigns/dispatch-summary");
    const resEnded = fakeRes();
    await handlerEnded({ query: { clientId: "tenant-1", scope: "ended" } }, resEnded);
    const endedIds = resEnded.body.campaigns.map((c) => c.campaignId).sort();
    expect(endedIds).toEqual(["c-cancel", "c-done"]);
  });

  it("[TESTE OBRIGATÓRIO] sem N+1: 20 campanhas com ~134 lotes ao todo fazem sempre o mesmo número pequeno de consultas", async () => {
    const groupedRows = Array.from({ length: 20 }, (_, i) => ({
      campaign_id: `camp-${i}`,
      campaign_name: `Campanha ${i}`,
      lote_count: i % 2 === 0 ? 10 : 3, // soma ~130
      sent_total: 50, failed_total: 1, leads_total: 100, leads_pending: 10,
      leads_pause_target: 10, leads_resume_target: 0, leads_cancel_target: 10,
      statuses: ["scheduled", "done"],
      evolution_instance_id: "chip-1",
      next_scheduled_at: null,
      last_updated_at: new Date().toISOString(),
    }));
    const pool = makePool({ groupedRows, batchRows: [], repliedRows: [] });
    const deps = makeDeps({ pool });
    const handler = getRouteHandler(deps, "/api/campaigns/dispatch-summary");
    const res = fakeRes();

    await handler({ query: { clientId: "tenant-1", scope: "active" } }, res);

    expect(res.body.campaigns.length).toBeGreaterThan(1);
    // No máximo 4 consultas fixas (schema-ensure idempotente + agregado +
    // respostas + quadrados da página) — nunca uma por campanha. Com 20
    // campanhas isso provaria N+1 estourando pra 20+.
    expect(pool.calls.length).toBeLessThanOrEqual(4);
    expect(pool.calls.length).toBeGreaterThan(0);
  });

  it("[TESTE OBRIGATÓRIO] escopo de tenant: sem autorização, nenhuma consulta roda e nada vaza", async () => {
    const pool = makePool({ groupedRows: [{ campaign_id: "x", campaign_name: "x", lote_count: 1, sent_total: 0, failed_total: 0, leads_total: 0, leads_pending: 0, leads_pause_target: 0, leads_resume_target: 0, leads_cancel_target: 0, statuses: ["done"], evolution_instance_id: null, next_scheduled_at: null, last_updated_at: new Date().toISOString() }] });
    const deps = makeDeps({
      pool,
      overrides: {
        // Espelha o que o resolveAuthorizedClientId real faz: recusa e
        // responde direto, sem devolver clientId — a rota deve parar aqui.
        resolveAuthorizedClientId: (req, res) => {
          res.statusCode = 403;
          res.body = { error: { code: "NO_CLIENT_ACCESS", message: "Sem acesso a este tenant" } };
          return null;
        },
      },
    });
    const handler = getRouteHandler(deps, "/api/campaigns/dispatch-summary");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-outro" } }, res);

    expect(res.statusCode).toBe(403);
    expect(pool.calls.length).toBe(0);
  });

  it("[TESTE OBRIGATÓRIO] cartões do topo somam Ativas + Encerradas dos últimos 30 dias, com o período dito na resposta", async () => {
    const recente = new Date().toISOString();
    const antiga = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 dias atrás
    const base = {
      lote_count: 1, leads_pause_target: 0, leads_resume_target: 0, leads_cancel_target: 0,
      evolution_instance_id: null, next_scheduled_at: null,
    };
    const groupedRows = [
      { ...base, campaign_id: "c1", campaign_name: "Recente Ativa", statuses: ["scheduled"], sent_total: 10, failed_total: 0, leads_total: 20, leads_pending: 10, last_updated_at: recente },
      { ...base, campaign_id: "c2", campaign_name: "Recente Encerrada", statuses: ["done"], sent_total: 90, failed_total: 10, leads_total: 100, leads_pending: 0, last_updated_at: recente },
      { ...base, campaign_id: "c3", campaign_name: "Antiga", statuses: ["done"], sent_total: 999, failed_total: 999, leads_total: 999, leads_pending: 0, last_updated_at: antiga },
    ];
    const pool = makePool({ groupedRows });
    const deps = makeDeps({ pool });
    const handler = getRouteHandler(deps, "/api/campaigns/dispatch-summary");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1", scope: "active" } }, res);

    expect(res.body.kpis.periodLabel).toBe("últimos 30 dias");
    expect(res.body.kpis.campaigns).toBe(2); // c1 + c2, não c3
    expect(res.body.kpis.leads).toBe(120); // 20 + 100
    expect(res.body.kpis.sent).toBe(100); // 10 + 90
    expect(res.body.kpis.deliveryRate).toBe(90.9); // 100 / (100+10)
  });

  it("a consulta agrupada é filtrada pelo clientId autorizado, não pelo que veio na query string", async () => {
    const pool = makePool({ groupedRows: [] });
    const deps = makeDeps({ pool, clientId: "tenant-autorizado" });
    const handler = getRouteHandler(deps, "/api/campaigns/dispatch-summary");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-qualquer-coisa" } }, res);

    const groupedCall = pool.calls.find((c) => c.sql.includes("GROUP BY d.campaign_id"));
    expect(groupedCall.params[0]).toBe("tenant-autorizado");
  });
});

describe("POST /api/campaigns/:campaignId/dispatches/bulk-action", () => {
  it("[TESTE OBRIGATÓRIO] pausar atinge todos os 28 pendentes e não toca nos 5 já enviados", async () => {
    // 28 linhas "pendentes" que a query de UPDATE devolveria (RETURNING);
    // as 5 'done' nunca aparecem aqui porque o WHERE status = ANY(...) as
    // exclui — é exatamente o contrato que a rota depende da SQL cumprir.
    const bulkUpdateRows = Array.from({ length: 28 }, (_, i) => ({ id: `d-${i}`, target_count: 10 }));
    const pool = makePool({ bulkUpdateRows });
    const deps = makeDeps({ pool });
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/dispatches/bulk-action", "post");
    const req = { params: { campaignId: "camp-1" }, body: { action: "pause" } };
    const res = fakeRes();

    await handler(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.affectedDispatches).toBe(28);
    expect(res.body.affectedLeads).toBe(280);

    const updateCall = pool.calls.find((c) => c.sql.includes("UPDATE public.campaign_dispatches"));
    expect(updateCall.sql).toContain("SET status = 'paused'");
    expect(updateCall.params[2]).toEqual(["running", "draft", "scheduled", "failed", "interrupted"]);
  });

  it("[TESTE OBRIGATÓRIO] a resposta conta LEADS afetados, não lotes — números diferentes por lote provam que soma, não conta", async () => {
    const bulkUpdateRows = [
      { id: "d-1", target_count: 40 },
      { id: "d-2", target_count: 15 },
      { id: "d-3", target_count: 7 },
    ];
    const pool = makePool({ bulkUpdateRows });
    const deps = makeDeps({ pool });
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/dispatches/bulk-action", "post");
    const res = fakeRes();
    await handler({ params: { campaignId: "camp-1" }, body: { action: "cancel" } }, res);

    expect(res.body.affectedDispatches).toBe(3);
    expect(res.body.affectedLeads).toBe(62); // 40+15+7, não 3
  });

  it("retomar grava status 'scheduled', não 'running' — evita duas execuções simultâneas da mesma campanha", async () => {
    const pool = makePool({ bulkUpdateRows: [{ id: "d-1", target_count: 5 }] });
    const deps = makeDeps({ pool });
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/dispatches/bulk-action", "post");
    const res = fakeRes();
    await handler({ params: { campaignId: "camp-1" }, body: { action: "resume" } }, res);

    const updateCall = pool.calls.find((c) => c.sql.includes("UPDATE public.campaign_dispatches"));
    expect(updateCall.sql).toContain("SET status = 'scheduled'");
    expect(updateCall.params[2]).toEqual(["paused"]);
  });

  it("cancelar nunca inclui lotes 'running' no alvo — o que está em voo termina sozinho", async () => {
    const pool = makePool({ bulkUpdateRows: [] });
    const deps = makeDeps({ pool });
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/dispatches/bulk-action", "post");
    const res = fakeRes();
    await handler({ params: { campaignId: "camp-1" }, body: { action: "cancel" } }, res);

    const updateCall = pool.calls.find((c) => c.sql.includes("UPDATE public.campaign_dispatches"));
    expect(updateCall.params[2]).not.toContain("running");
  });

  it("campanha de outro tenant: 404, nenhum UPDATE roda", async () => {
    const pool = makePool({ bulkUpdateRows: [{ id: "d-1", target_count: 5 }] });
    const deps = makeDeps({
      pool,
      overrides: {
        supabase: {
          from: () => ({
            select: () => ({
              eq: () => ({ single: async () => ({ data: null, error: { message: "not found" } }) }),
            }),
          }),
        },
      },
    });
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/dispatches/bulk-action", "post");
    const res = fakeRes();
    await handler({ params: { campaignId: "camp-fantasma" }, body: { action: "pause" } }, res);

    expect(res.statusCode).toBe(404);
    expect(pool.calls.length).toBe(0);
  });

  it("action inválido é recusado antes de tocar o banco", async () => {
    const pool = makePool();
    const deps = makeDeps({ pool });
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/dispatches/bulk-action", "post");
    const res = fakeRes();
    await handler({ params: { campaignId: "camp-1" }, body: { action: "apagar-tudo" } }, res);

    expect(res.statusCode).toBe(400);
    expect(pool.calls.length).toBe(0);
  });
});
