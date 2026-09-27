// backend/src/test/campaignMessageEffectiveness.test.js
//
// GET /api/campaigns/reports/message-effectiveness — por campanha, o texto
// da mensagem, quantos receberam, quantos responderam e — de quem
// respondeu — quantos ficaram quente/morno/frio, só campanhas com pelo
// menos 30 envios, ordenado por taxa de retorno. É o dado que dá tom real
// às receitas da Vexo Academy.

import { describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes, buildMessageEffectivenessSql } from "../domains/campaigns/routes.js";
import { isMissingSchemaError } from "../services/analytics.js";

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
        { campaign_id: "c-alta", campaign_name: "Campanha alta taxa", message: "Olá {{nome}}, temos uma condição especial hoje.", sent_count: 30, replied_count: 15, quente: 9, morno: 4, frio: 1, sem_classificacao: 1 },
        { campaign_id: "c-baixa", campaign_name: "Campanha baixa taxa", message: "Oi {{nome}}, tudo bem?", sent_count: 40, replied_count: 4, quente: 0, morno: 1, frio: 3, sem_classificacao: 0 },
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
    expect(res.body.campaigns[0].repliedByTemperature).toEqual({ quente: 9, morno: 4, frio: 1, semClassificacao: 1 });
    expect(res.body.campaigns[1].campaignId).toBe("c-baixa");
    expect(res.body.campaigns[1].replyRate).toBe(10);
    expect(res.body.campaigns[1].repliedByTemperature).toEqual({ quente: 0, morno: 1, frio: 3, semClassificacao: 0 });

    const call = deps.pgDatabasePool.query.mock.calls.find((c) => c[0].includes("FROM runs"));
    expect(call[1]).toEqual(["tenant-1", 30]);
    expect(call[0]).toContain("HAVING COUNT(*) >= $2");
    // o cruzamento com leads é por telefone normalizado, e só entre quem
    // respondeu — não recalcula temperatura pra quem nunca respondeu
    expect(call[0]).toContain("l.lead_temperature");
    expect(call[0]).toContain("WHERE runs.replied");
  });

  it("[TESTE OBRIGATÓRIO] a quebra por temperatura soma certo e nunca ultrapassa quem respondeu", async () => {
    const deps = makeDeps({
      rows: [
        { campaign_id: "c-1", campaign_name: "Campanha", message: "Oi", sent_count: 30, replied_count: 10, quente: 3, morno: 4, frio: 2, sem_classificacao: 1 },
      ],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    const { quente, morno, frio, semClassificacao } = res.body.campaigns[0].repliedByTemperature;
    expect(quente + morno + frio + semClassificacao).toBe(res.body.campaigns[0].repliedCount);
  });

  it("sem nenhum lead classificado, tudo cai em semClassificacao — não quebra, não inventa quente/morno/frio", async () => {
    const deps = makeDeps({
      rows: [
        { campaign_id: "c-1", campaign_name: "Campanha", message: "Oi", sent_count: 30, replied_count: 5, quente: 0, morno: 0, frio: 0, sem_classificacao: 5 },
      ],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.body.campaigns[0].repliedByTemperature).toEqual({ quente: 0, morno: 0, frio: 0, semClassificacao: 5 });
  });

  it("campanha com menos de 30 envios não aparece — o SQL já filtra, aqui só prova que o mínimo é passado certo", async () => {
    const deps = makeDeps({ rows: [] });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.body.campaigns).toEqual([]);
  });

  it("sem a coluna `temperature` no tenant (deriva de schema), cai pra só lead_temperature em vez de derrubar a rota", async () => {
    const columnMissing = Object.assign(new Error('column "temperature" does not exist'), { code: "42703" });
    let attempt = 0;
    const query = vi.fn(async (sql) => {
      if (sql.includes("FROM runs")) {
        attempt += 1;
        if (attempt === 1) throw columnMissing;
        return { rows: [{ campaign_id: "c-1", campaign_name: "Campanha", message: "Oi", sent_count: 30, replied_count: 5, quente: 2, morno: 1, frio: 0, sem_classificacao: 2 }] };
      }
      return { rows: [] };
    });
    const deps = makeDeps({ overrides: { pgDatabasePool: { query }, isMissingSchemaError } });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.statusCode).toBe(200);
    expect(query).toHaveBeenCalledTimes(2);
    expect(res.body.campaigns[0].repliedByTemperature).toEqual({ quente: 2, morno: 1, frio: 0, semClassificacao: 2 });
  });

  it("erro que NÃO é de schema ausente propaga como 500, sem tentar de novo", async () => {
    const realError = new Error("connection terminated");
    const query = vi.fn(async (sql) => {
      if (sql.includes("FROM runs")) throw realError;
      return { rows: [] };
    });
    const deps = makeDeps({ overrides: { pgDatabasePool: { query }, isMissingSchemaError } });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.statusCode).toBe(500);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("buildMessageEffectivenessSql — estrutural (defesa contra regressão dos defeitos já achados)", () => {
  it("[TESTE OBRIGATÓRIO] usa SQL_CANONICAL_PHONE nos dois lados do cruzamento, não regexp_replace cru", () => {
    const sql = buildMessageEffectivenessSql(true);
    // a assinatura de SQL_CANONICAL_PHONE é a checagem de tamanho (10/11/12
    // dígitos) que só ela faz — regexp_replace sozinho nunca produz isso
    expect(sql).toContain("length(regexp_replace(COALESCE(l.telefone, l.phone)");
    expect(sql).toContain("length(regexp_replace(runs.phone");
  });

  it("[TESTE OBRIGATÓRIO] telefone: usa COALESCE(l.telefone, l.phone) — lead com só uma das duas colunas preenchida não fica de fora", () => {
    const sql = buildMessageEffectivenessSql(true);
    expect(sql).toContain("COALESCE(l.telefone, l.phone)");
  });

  it("[TESTE OBRIGATÓRIO] lê as duas colunas de temperatura, com whitelist FECHADA — não UPPER(NULLIF(...)) solto", () => {
    const sql = buildMessageEffectivenessSql(true);
    expect(sql).toContain("l.lead_temperature");
    expect(sql).toContain("l.temperature");
    expect(sql).toContain("'HOT'");
    expect(sql).toContain("'COLD'");
    // CASE com WHEN por valor, não UPPER(NULLIF(...)) devolvido cru (isso
    // deixava um valor sujo, tipo 'NOVO', vazar sem cair em bucket nenhum)
    expect(sql).toMatch(/CASE UPPER\(NULLIF\(l\.lead_temperature, ''\)\)\s*\n\s*WHEN 'QUENTE' THEN 'QUENTE'/);
    expect(sql).toMatch(/WHEN 'MORNO' THEN 'MORNO'/);
    expect(sql).toMatch(/WHEN 'FRIO' THEN 'FRIO'/);
  });

  it("[TESTE OBRIGATÓRIO] 'warm' nunca vira MORNO — é o DEFAULT da coluna `temperature`, não classificação", () => {
    const sql = buildMessageEffectivenessSql(true);
    expect(sql).not.toMatch(/WHEN 'WARM' THEN 'MORNO'/);
    // só lead_temperature='MORNO' pode produzir MORNO na query
    const mornoOccurrences = (sql.match(/THEN 'MORNO'/g) || []).length;
    expect(mornoOccurrences).toBe(1);
  });

  it("a variante de fallback (schema sem `temperature`) não referencia a coluna que falta, e mantém a mesma whitelist fechada", () => {
    const sql = buildMessageEffectivenessSql(false);
    expect(sql).not.toContain("l.temperature");
    expect(sql).toContain("l.lead_temperature");
    expect(sql).toMatch(/WHEN 'MORNO' THEN 'MORNO'/);
  });

  it("[TESTE OBRIGATÓRIO] dedupe o lado do lead ANTES do join — DISTINCT ON por telefone canônico, mais recente primeiro", () => {
    const sql = buildMessageEffectivenessSql(true);
    expect(sql).toMatch(/SELECT DISTINCT ON \(/);
    expect(sql).toContain("ORDER BY");
    expect(sql).toContain("l.updated_at DESC");
    // a tabela deduplicada (lead_by_phone) precisa vir ANTES do LEFT JOIN
    // que usa ela, não o join direto em public.leads
    const leadByPhoneIndex = sql.indexOf("lead_by_phone AS (");
    const leftJoinIndex = sql.indexOf("LEFT JOIN lead_by_phone");
    expect(leadByPhoneIndex).toBeGreaterThan(-1);
    expect(leftJoinIndex).toBeGreaterThan(leadByPhoneIndex);
    expect(sql).not.toMatch(/LEFT JOIN public\.leads\b/);
  });
});
