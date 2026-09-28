// backend/src/test/campaignMessageEffectiveness.test.js
//
// GET /api/campaigns/reports/message-effectiveness — por campanha, o texto
// da mensagem, quantos receberam, quantos responderam e — de quem
// respondeu — quantos ficaram quente/morno/frio, só campanhas com pelo
// menos 30 envios, ordenado por taxa de retorno. É o dado que dá tom real
// às receitas da Vexo Academy.

import { describe, expect, it, vi } from "vitest";
import {
  registerCampaignsRoutes,
  buildMessageEffectivenessSql,
  MESSAGE_EFFECTIVENESS_MIN_SENT,
  MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS,
} from "../domains/campaigns/routes.js";
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
        { campaign_id: "c-alta", campaign_name: "Campanha alta taxa", message: "Olá {{nome}}, temos uma condição especial hoje.", sent_count: 30, replied_count: 15, sent_without_timestamp: 0, quente: 9, morno: 4, frio: 1, sem_classificacao: 1, lead_nao_encontrado: 0 },
        { campaign_id: "c-baixa", campaign_name: "Campanha baixa taxa", message: "Oi {{nome}}, tudo bem?", sent_count: 40, replied_count: 4, sent_without_timestamp: 6, quente: 0, morno: 1, frio: 3, sem_classificacao: 0, lead_nao_encontrado: 0 },
      ],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.body.minSent).toBe(MESSAGE_EFFECTIVENESS_MIN_SENT);
    // quem lê replyRate precisa saber o que ela conta — sem isso, dois
    // relatórios com janela diferente parecem comparáveis e não são.
    expect(res.body.replyWindowDays).toBe(MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS);
    expect(res.body.campaigns).toHaveLength(2);
    expect(res.body.campaigns[0].campaignId).toBe("c-alta");
    expect(res.body.campaigns[0].replyRate).toBe(50);
    expect(res.body.campaigns[0].message).toBe("Olá {{nome}}, temos uma condição especial hoje.");
    expect(res.body.campaigns[0].sentWithoutTimestamp).toBe(0);
    expect(res.body.campaigns[0].repliedByTemperature).toEqual({ quente: 9, morno: 4, frio: 1, semClassificacao: 1, leadNaoEncontrado: 0 });
    expect(res.body.campaigns[1].campaignId).toBe("c-baixa");
    expect(res.body.campaigns[1].replyRate).toBe(10);
    expect(res.body.campaigns[1].sentWithoutTimestamp).toBe(6);
    expect(res.body.campaigns[1].repliedByTemperature).toEqual({ quente: 0, morno: 1, frio: 3, semClassificacao: 0, leadNaoEncontrado: 0 });

    const call = deps.pgDatabasePool.query.mock.calls.find((c) => c[0].includes("FROM runs"));
    expect(call[1]).toEqual(["tenant-1", MESSAGE_EFFECTIVENESS_MIN_SENT]);
    expect(call[0]).toContain("HAVING COUNT(*) >= $2");
    // o cruzamento com leads é por telefone normalizado, e só entre quem
    // respondeu — não recalcula temperatura pra quem nunca respondeu
    expect(call[0]).toContain("l.lead_temperature");
    expect(call[0]).toContain("WHERE runs.replied");
  });

  it("[TESTE OBRIGATÓRIO] a quebra por temperatura soma certo e nunca ultrapassa quem respondeu — agora com 5 baldes", async () => {
    const deps = makeDeps({
      rows: [
        { campaign_id: "c-1", campaign_name: "Campanha", message: "Oi", sent_count: 30, replied_count: 11, quente: 3, morno: 4, frio: 2, sem_classificacao: 1, lead_nao_encontrado: 1 },
      ],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    const { quente, morno, frio, semClassificacao, leadNaoEncontrado } = res.body.campaigns[0].repliedByTemperature;
    expect(quente + morno + frio + semClassificacao + leadNaoEncontrado).toBe(res.body.campaigns[0].repliedCount);
  });

  it("[TESTE OBRIGATÓRIO] telefone sem lead vai pra leadNaoEncontrado, telefone com lead sem temperatura vai pra semClassificacao — nunca o mesmo balde", async () => {
    const deps = makeDeps({
      rows: [
        { campaign_id: "c-1", campaign_name: "Campanha", message: "Oi", sent_count: 30, replied_count: 5, quente: 0, morno: 0, frio: 0, sem_classificacao: 2, lead_nao_encontrado: 3 },
      ],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.body.campaigns[0].repliedByTemperature).toEqual({ quente: 0, morno: 0, frio: 0, semClassificacao: 2, leadNaoEncontrado: 3 });
  });

  it("[TESTE OBRIGATÓRIO] sentWithoutTimestamp sai na resposta e não entra em nenhum dos cinco baldes nem no repliedCount", async () => {
    const deps = makeDeps({
      rows: [
        // 30 enviados, 4 sujos (sent_at NULL) — os 4 nunca podem aparecer
        // como respondido em bucket nenhum, só no total de enviados.
        { campaign_id: "c-1", campaign_name: "Campanha", message: "Oi", sent_count: 30, replied_count: 9, sent_without_timestamp: 4, quente: 3, morno: 2, frio: 1, sem_classificacao: 2, lead_nao_encontrado: 1 },
      ],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    const campaign = res.body.campaigns[0];
    expect(campaign.sentWithoutTimestamp).toBe(4);
    const { quente, morno, frio, semClassificacao, leadNaoEncontrado } = campaign.repliedByTemperature;
    // os 4 sujos não estão escondidos em nenhum dos cinco baldes
    expect(quente + morno + frio + semClassificacao + leadNaoEncontrado).toBe(campaign.repliedCount);
    expect(campaign.repliedCount).toBe(9);
    // nem inflam repliedCount por conta própria
    expect(campaign.sentWithoutTimestamp).not.toBe(campaign.repliedCount);
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
        return { rows: [{ campaign_id: "c-1", campaign_name: "Campanha", message: "Oi", sent_count: 30, replied_count: 5, quente: 2, morno: 1, frio: 0, sem_classificacao: 1, lead_nao_encontrado: 1 }] };
      }
      return { rows: [] };
    });
    const deps = makeDeps({ overrides: { pgDatabasePool: { query }, isMissingSchemaError } });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.statusCode).toBe(200);
    expect(query).toHaveBeenCalledTimes(2);
    expect(res.body.campaigns[0].repliedByTemperature).toEqual({ quente: 2, morno: 1, frio: 0, semClassificacao: 1, leadNaoEncontrado: 1 });
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

  // Os quatro testes abaixo cobrem a rodada 5 (recorte de tempo, sent_at
  // sujo, leadNaoEncontrado vs semClassificacao). Continuam ESTRUTURAIS —
  // provam que a query TEM a cláusula certa no texto, não que o Postgres
  // avalia `interval` e `EXISTS` correlacionado do jeito esperado com dados
  // de verdade. Este ambiente não tem Postgres alcançável (o único binário
  // instalado localmente é x86_64 num Mac arm64, e o Postgres de produção
  // não é acessível daqui) — mesma limitação já registrada no item 2 do
  // comentário acima, herdada pelo item 1. Quem tiver acesso a um Postgres
  // real deveria rodar as quatro afirmações do pedido original com dados
  // (mensagem antes do sent_at, 3 dias depois, 20 dias depois, sent_at
  // NULL) contra a query de verdade — isto aqui é a rede que pega
  // regressão de texto, não a prova comportamental completa.

  it("[TESTE OBRIGATÓRIO] resposta só conta depois do sent_at do run, dentro da janela — não é 'já falou alguma vez'", () => {
    const sql = buildMessageEffectivenessSql(true);
    // teria passado na versão de agora (antes desta rodada) porque a EXISTS
    // não tinha nenhuma das duas linhas abaixo — é o defeito inteiro.
    expect(sql).toMatch(/>\s*r\.sent_at/);
    expect(sql).toMatch(/<=\s*r\.sent_at\s*\+\s*interval\s*'14 days'/);
    expect(sql).toContain(`interval '${MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS} days'`);
  });

  it("[TESTE OBRIGATÓRIO] a janela vem da constante nomeada, não de um número solto no meio da query", () => {
    expect(MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS).toBe(14);
    const sql = buildMessageEffectivenessSql(true);
    // só uma ocorrência do intervalo — se alguém duplicar a lógica em outro
    // lugar com o número escrito na mão, isso aqui não pega, mas pelo menos
    // a origem declarada é uma só
    expect((sql.match(/interval '\d+ days'/g) || []).length).toBe(1);
  });

  it("[TESTE OBRIGATÓRIO] run com status='sent' e sent_at NULL nunca conta como respondido", () => {
    const sql = buildMessageEffectivenessSql(true);
    expect(sql).toMatch(/WHEN\s+r\.sent_at\s+IS\s+NULL\s+THEN\s+false/);
    // a query ainda inclui o run no sent_count (não tem filtro sent_at no
    // WHERE de runs) — só a contagem como respondido é que é bloqueada
    expect(sql).not.toMatch(/WHERE r\.client_id = \$1 AND r\.status = 'sent' AND r\.sent_at IS NOT NULL/);
  });

  it("[TESTE OBRIGATÓRIO] leadNaoEncontrado (LEFT JOIN não achou) é diferente de semClassificacao (achou, sem temperatura)", () => {
    const sql = buildMessageEffectivenessSql(true);
    expect(sql).toContain("(lb.canonical_phone IS NOT NULL) AS lead_found");
    expect(sql).toMatch(/WHERE\s+lead_found\s+AND\s+temp\s+IS\s+NULL/);
    expect(sql).toMatch(/WHERE\s+NOT\s+lead_found/);
    expect(sql).toContain("lead_nao_encontrado");
    expect(sql).toContain("COALESCE(t.lead_nao_encontrado, 0) AS lead_nao_encontrado");
    // GROUP BY tem que carregar a nova coluna, senão a query nem compila
    expect(sql).toMatch(/GROUP BY c\.id, c\.name, c\.analytics_meta,.*t\.lead_nao_encontrado/);
  });

  it("[TESTE OBRIGATÓRIO] sent_without_timestamp é contado à parte — não é o mesmo FILTER de replied", () => {
    const sql = buildMessageEffectivenessSql(true);
    expect(sql).toContain("(r.sent_at IS NULL) AS sent_at_missing");
    expect(sql).toContain("COUNT(*) FILTER (WHERE runs.sent_at_missing)::int AS sent_without_timestamp");
    // não é o mesmo FILTER de replied_count — são duas contagens
    // independentes sobre o mesmo `runs`, uma nunca implica a outra
    expect(sql).toContain("COUNT(*) FILTER (WHERE runs.replied)::int AS replied_count");
    expect(sql.indexOf("AS sent_without_timestamp")).not.toBe(sql.indexOf("AS replied_count"));
  });
});
