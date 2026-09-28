// backend/src/test/campaignMessageEffectiveness.test.js
//
// GET /api/campaigns/reports/message-effectiveness — por campanha, o texto
// da mensagem, quantos receberam, quantos responderam e — de quem
// respondeu — quantos ficaram quente/morno/frio, só campanhas com pelo
// menos 30 envios, ordenado por taxa de retorno. É o dado que dá tom real
// às receitas da Vexo Academy.

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  registerCampaignsRoutes,
  buildMessageEffectivenessSql,
  MESSAGE_EFFECTIVENESS_MIN_SENT,
  MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS,
  __resetMessageEffectivenessIsGroupCacheForTests,
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

// Comentário SQL pode citar "is_group" como texto explicativo — só código
// de verdade importa pra provar "a query não pede essa coluna".
function stripSqlComments(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

// Linha "cheia" com os campos que a query real sempre devolve, pra nenhum
// teste esquecer um campo novo e deixar `undefined` vazar pra resposta.
function baseRow(overrides = {}) {
  return {
    campaign_id: "c-1",
    campaign_name: "Campanha",
    message: "Oi",
    sent_count: 30,
    replied_count: 0,
    sent_without_timestamp: 0,
    casou_so_no_canonico: 0,
    respostas_de_grupo: 0,
    quente: 0,
    morno: 0,
    frio: 0,
    sem_classificacao: 0,
    lead_nao_encontrado: 0,
    telefone_lid: 0,
    sem_lead_id: 0,
    lead_id_apagado: 0,
    lead_id_de_outro_tenant: 0,
    telefone_divergente: 0,
    ...overrides,
  };
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
  // is_group é cacheado a nível de módulo (uma tabela só, não por tenant —
  // ver comentário em routes.js). Sem resetar, o primeiro teste que rodar
  // decide o valor pra todos os outros do arquivo.
  beforeEach(() => {
    __resetMessageEffectivenessIsGroupCacheForTests();
  });

  it("[TESTE OBRIGATÓRIO] só campanhas com pelo menos 30 envios entram, ordenadas por taxa de retorno", async () => {
    // Mock devolve as linhas JÁ na ordem que o ORDER BY do SQL real produziria
    // (a rota confia no banco pra ordenar, não reordena em JS) — por isso a
    // de maior taxa vem primeiro aqui, simulando exatamente esse contrato.
    const deps = makeDeps({
      rows: [
        baseRow({ campaign_id: "c-alta", campaign_name: "Campanha alta taxa", message: "Olá {{nome}}, temos uma condição especial hoje.", sent_count: 30, replied_count: 15, sent_without_timestamp: 0, quente: 9, morno: 4, frio: 1, sem_classificacao: 1, lead_nao_encontrado: 0 }),
        baseRow({ campaign_id: "c-baixa", campaign_name: "Campanha baixa taxa", message: "Oi {{nome}}, tudo bem?", sent_count: 40, replied_count: 4, sent_without_timestamp: 6, quente: 0, morno: 1, frio: 3, sem_classificacao: 0, lead_nao_encontrado: 0 }),
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
      rows: [baseRow({ replied_count: 11, quente: 3, morno: 4, frio: 2, sem_classificacao: 1, lead_nao_encontrado: 1 })],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    const { quente, morno, frio, semClassificacao, leadNaoEncontrado } = res.body.campaigns[0].repliedByTemperature;
    expect(quente + morno + frio + semClassificacao + leadNaoEncontrado).toBe(res.body.campaigns[0].repliedCount);
  });

  it("[TESTE OBRIGATÓRIO] telefone sem lead vai pra leadNaoEncontrado, telefone com lead sem temperatura vai pra semClassificacao — nunca o mesmo balde", async () => {
    const deps = makeDeps({
      rows: [baseRow({ replied_count: 5, sem_classificacao: 2, lead_nao_encontrado: 3 })],
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
        baseRow({ replied_count: 9, sent_without_timestamp: 4, quente: 3, morno: 2, frio: 1, sem_classificacao: 2, lead_nao_encontrado: 1 }),
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
        return { rows: [baseRow({ replied_count: 5, quente: 2, morno: 1, frio: 0, sem_classificacao: 1, lead_nao_encontrado: 1 })] };
      }
      return { rows: [] };
    });
    const deps = makeDeps({ overrides: { pgDatabasePool: { query }, isMissingSchemaError } });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.statusCode).toBe(200);
    // 1 pro probe de is_group (não é "FROM runs") + 2 pro retry de temperature
    const runsCalls = query.mock.calls.filter(([sql]) => sql.includes("FROM runs"));
    expect(runsCalls).toHaveLength(2);
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
    // não tenta de novo — só 1 chamada "FROM runs" (mais a do probe de is_group)
    const runsCalls = query.mock.calls.filter(([sql]) => sql.includes("FROM runs"));
    expect(runsCalls).toHaveLength(1);
  });

  it("[TESTE OBRIGATÓRIO] os cinco motivos de leadNaoEncontrado somam com leadNaoEncontrado, inclusive todos zerados", async () => {
    const deps = makeDeps({
      rows: [
        baseRow({
          campaign_id: "c-cheio",
          replied_count: 11,
          lead_nao_encontrado: 8,
          telefone_lid: 3,
          sem_lead_id: 2,
          lead_id_apagado: 1,
          lead_id_de_outro_tenant: 1,
          telefone_divergente: 1,
        }),
        baseRow({
          campaign_id: "c-zerado",
          replied_count: 4,
          lead_nao_encontrado: 0,
          telefone_lid: 0,
          sem_lead_id: 0,
          lead_id_apagado: 0,
          lead_id_de_outro_tenant: 0,
          telefone_divergente: 0,
        }),
      ],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    for (const campaign of res.body.campaigns) {
      const { telefoneLid, semLeadId, leadIdApagado, leadIdDeOutroTenant, telefoneDivergente } = campaign.leadNaoEncontradoPorMotivo;
      expect(telefoneLid + semLeadId + leadIdApagado + leadIdDeOutroTenant + telefoneDivergente).toBe(
        campaign.repliedByTemperature.leadNaoEncontrado
      );
    }
    expect(res.body.campaigns[1].leadNaoEncontradoPorMotivo).toEqual({
      telefoneLid: 0,
      semLeadId: 0,
      leadIdApagado: 0,
      leadIdDeOutroTenant: 0,
      telefoneDivergente: 0,
    });
  });

  it("[TESTE OBRIGATÓRIO] leadIdApagado (não existe em tenant nenhum) é diferente de leadIdDeOutroTenant (existe, client_id diferente)", async () => {
    const deps = makeDeps({
      rows: [baseRow({ replied_count: 7, lead_nao_encontrado: 5, lead_id_apagado: 3, lead_id_de_outro_tenant: 2 })],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.body.campaigns[0].leadNaoEncontradoPorMotivo).toEqual({
      telefoneLid: 0,
      semLeadId: 0,
      leadIdApagado: 3,
      leadIdDeOutroTenant: 2,
      telefoneDivergente: 0,
    });
  });

  it("[TESTE OBRIGATÓRIO] a resposta não carrega nenhum identificador de outro tenant — só contagem", async () => {
    const deps = makeDeps({
      rows: [baseRow({ replied_count: 5, lead_nao_encontrado: 5, lead_id_apagado: 2, lead_id_de_outro_tenant: 3 })],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    // percorre os VALORES da resposta (não as chaves — "leadIdDeOutroTenant"
    // é nome de categoria aprovado, não um id de verdade) atrás de qualquer
    // coisa que pareça client_id, uuid ou telefone de outro tenant
    const values = [];
    const collect = (v) => {
      if (v && typeof v === "object") Object.values(v).forEach(collect);
      else values.push(v);
    };
    collect(res.body);
    for (const v of values) {
      if (typeof v !== "string") continue;
      expect(v, `valor "${v}" parece um UUID`).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(v, `valor "${v}" parece telefone (8+ dígitos seguidos)`).not.toMatch(/\d{8,}/);
    }
  });

  it("[TESTE OBRIGATÓRIO] leadNaoEncontradoPorMotivo é dimensão irmã de repliedByTemperature, não aninhada nela", async () => {
    const deps = makeDeps({
      rows: [baseRow({ replied_count: 5, lead_nao_encontrado: 5, telefone_lid: 5 })],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    const campaign = res.body.campaigns[0];
    expect(campaign.leadNaoEncontradoPorMotivo).toBeTruthy();
    expect(campaign.repliedByTemperature.leadNaoEncontradoPorMotivo).toBeUndefined();
    expect(campaign.leadNaoEncontradoPorMotivo.telefoneLid).toBe(5);
  });

  it("[TESTE OBRIGATÓRIO] casouSoNoCanonico sai como número — o tamanho medido do ganho do fix de telefone", async () => {
    const deps = makeDeps({
      rows: [baseRow({ replied_count: 20, casou_so_no_canonico: 6 })],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.body.campaigns[0].casouSoNoCanonico).toBe(6);
  });

  it("[TESTE OBRIGATÓRIO] is_group ausente no tenant: respostasDeGrupo sai null, não 0 — e a query nem pede a coluna", async () => {
    const isGroupMissing = Object.assign(new Error('column "is_group" does not exist'), { code: "42703" });
    const query = vi.fn(async (sql) => {
      if (sql.includes("is_group FROM public.lead_messages")) throw isGroupMissing;
      if (sql.includes("FROM runs")) {
        // o que o Postgres devolveria de verdade pra essa variante da query:
        // sem a coluna, respostas_de_grupo nem é selecionado como número.
        return { rows: [baseRow({ replied_count: 8, respostas_de_grupo: null })] };
      }
      return { rows: [] };
    });
    const deps = makeDeps({ overrides: { pgDatabasePool: { query }, isMissingSchemaError } });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.campaigns[0].respostasDeGrupo).toBeNull();
    // a orquestração de verdade: a query "FROM runs" que foi de fato
    // executada não pode ter pedido is_group, porque o probe já sabia que
    // a coluna não existe
    const runsCall = query.mock.calls.find(([sql]) => sql.includes("FROM runs"));
    expect(stripSqlComments(runsCall[0])).not.toContain("is_group");
  });

  it("com is_group disponível, respostasDeGrupo sai como número (0 incluso) — nunca null quando foi medido", async () => {
    const deps = makeDeps({
      rows: [baseRow({ replied_count: 8, respostas_de_grupo: 0 })],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    expect(res.body.campaigns[0].respostasDeGrupo).toBe(0);
    const runsCall = deps.pgDatabasePool.query.mock.calls.find(([sql]) => sql.includes("FROM runs"));
    expect(runsCall[0]).toContain("is_group");
  });

  it("nenhum telefone sai na resposta — só contagens", async () => {
    const deps = makeDeps({
      rows: [baseRow({ replied_count: 3, lead_nao_encontrado: 3, telefone_lid: 3 })],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/message-effectiveness");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1" } }, res);

    // Checa VALORES, não chaves — `telefoneLid`/`telefoneDivergente` são
    // nomes de categoria aprovados pela spec, não telefone de verdade. Um
    // telefone de verdade (mascarado ou cru) apareceria como VALOR: uma
    // sequência de 8+ dígitos, ou um `@` (marca de LID).
    const values = [];
    const collect = (v) => {
      if (v && typeof v === "object") Object.values(v).forEach(collect);
      else values.push(v);
    };
    collect(res.body);
    for (const v of values) {
      if (typeof v !== "string") continue;
      expect(v, `valor "${v}" parece telefone (8+ dígitos seguidos)`).not.toMatch(/\d{8,}/);
      expect(v, `valor "${v}" contém '@' (marca de LID)`).not.toContain("@");
    }
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
    const sql = buildMessageEffectivenessSql(true, true);
    // replied / replied_raw_only / replied_without_group repetem a MESMA
    // janela (as três precisam da mesma referência de tempo pra fazer
    // sentido comparadas entre si) — por isso aparece mais de uma vez, mas
    // sempre o mesmo valor, sempre vindo da constante exportada.
    const occurrences = sql.match(/interval '(\d+) days'/g) || [];
    expect(occurrences.length).toBeGreaterThan(0);
    for (const occ of occurrences) {
      expect(occ).toBe(`interval '${MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS} days'`);
    }
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

  // Os testes abaixo cobrem a quebra de leadNaoEncontrado (rodada 7). Mesma
  // limitação já registrada acima: estruturais, não comportamentais — sem
  // Postgres acessível neste ambiente pra provar a precedência e a definição
  // de respostasDeGrupo com dado de verdade.

  it("[TESTE OBRIGATÓRIO] precedência: telefoneLid vence mesmo com lead_id nulo — CASE para no primeiro WHEN verdadeiro", () => {
    const sql = buildMessageEffectivenessSql(true, true);
    const caseBlock = sql.slice(sql.indexOf("CASE\n          WHEN rt.phone"), sql.indexOf("END AS reason"));
    expect(caseBlock).toBeTruthy();
    const lidIdx = caseBlock.indexOf("telefoneLid");
    const semLeadIdIdx = caseBlock.indexOf("semLeadId");
    const apagadoIdx = caseBlock.indexOf("leadIdApagado");
    const outroTenantIdx = caseBlock.indexOf("leadIdDeOutroTenant");
    const divergenteIdx = caseBlock.indexOf("telefoneDivergente");
    // ordem no texto do CASE é a ordem de avaliação em Postgres — LID
    // primeiro, sem checar lead_id antes; apagado (sem escopo de tenant)
    // antes de outro-tenant (com escopo), porque "existe em algum lugar?" é
    // pré-requisito de "existe NESTE tenant?"
    expect(lidIdx).toBeGreaterThan(-1);
    expect(lidIdx).toBeLessThan(semLeadIdIdx);
    expect(semLeadIdIdx).toBeLessThan(apagadoIdx);
    expect(apagadoIdx).toBeLessThan(outroTenantIdx);
    expect(outroTenantIdx).toBeLessThan(divergenteIdx);
    // o WHEN de telefoneLid não menciona lead_id — vence sozinho, por '@'
    const lidWhenLine = caseBlock.split("\n").find((l) => l.includes("telefoneLid"));
    expect(lidWhenLine).not.toContain("lead_id");
    expect(lidWhenLine).toContain("phone LIKE '%@%'");
  });

  it("[TESTE OBRIGATÓRIO] leadIdApagado não existe em tenant nenhum — EXISTS sem escopo de client_id", () => {
    const sql = buildMessageEffectivenessSql(true, true);
    const caseBlock = sql.slice(sql.indexOf("CASE\n          WHEN rt.phone"), sql.indexOf("END AS reason"));
    const apagadoLine = caseBlock.split("\n").find((l) => l.includes("leadIdApagado"));
    expect(apagadoLine).toBeTruthy();
    expect(apagadoLine).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.leads ll WHERE ll\.id = rt\.lead_id\)/);
    // essa checagem NÃO pode ter client_id — senão vira a mesma de outro-tenant
    expect(apagadoLine).not.toContain("client_id");
  });

  it("[TESTE OBRIGATÓRIO] leadIdDeOutroTenant existe, mas com client_id diferente — a MESMA checagem escopada de antes, intacta", () => {
    const sql = buildMessageEffectivenessSql(true, true);
    const caseBlock = sql.slice(sql.indexOf("CASE\n          WHEN rt.phone"), sql.indexOf("END AS reason"));
    const outroTenantLine = caseBlock.split("\n").find((l) => l.includes("leadIdDeOutroTenant"));
    expect(outroTenantLine).toBeTruthy();
    expect(outroTenantLine).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.leads ll WHERE ll\.id = rt\.lead_id AND ll\.client_id = \$1\)/);
  });

  it("[TESTE OBRIGATÓRIO] os cinco motivos somam com lead_nao_encontrado — mesmo WHERE NOT lead_found do balde original", () => {
    const sql = buildMessageEffectivenessSql(true, true);
    // lead_not_found_reason parte do MESMO replied_temperature filtrado por
    // NOT lead_found que já alimenta lead_nao_encontrado em temperature_agg
    // — não é um recorte diferente que poderia divergir
    const reasonCteIdx = sql.indexOf("lead_not_found_reason AS (");
    expect(reasonCteIdx).toBeGreaterThan(-1);
    const reasonCte = sql.slice(reasonCteIdx, sql.indexOf("lead_not_found_agg AS ("));
    expect(reasonCte).toContain("FROM replied_temperature rt");
    expect(reasonCte).toContain("WHERE NOT rt.lead_found");
  });

  it("[TESTE OBRIGATÓRIO] respostasDeGrupo mede 'sustentaria sem grupo?', não 'tem mensagem de grupo?' — EXISTS separada, is_group IS NOT TRUE", () => {
    const sql = buildMessageEffectivenessSql(true, true);
    // a coluna nova é outra EXISTS correlacionada, com a MESMA janela de
    // tempo e comparação de telefone — não um COUNT sobre is_group solto
    expect(sql).toContain("AS replied_without_group");
    expect(sql).toContain("AND (lm.is_group IS NOT TRUE)");
    // IS NOT TRUE, não "= false" — é isso que faz is_group NULL contar como
    // não-grupo (linha antiga, is_group nunca preenchido)
    expect(sql).not.toMatch(/is_group\s*=\s*false/);
    // o agregado final usa a MESMA semântica (IS NOT TRUE) pra decidir quem
    // entra em respostasDeGrupo — nunca "= false" também aqui
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE runs\.replied AND runs\.replied_without_group IS NOT TRUE\)::int/);
  });

  it("[TESTE OBRIGATÓRIO] casouSoNoCanonico: EXISTS só com igualdade crua, comparada contra a EXISTS de replied", () => {
    const sql = buildMessageEffectivenessSql(true, true);
    expect(sql).toContain("AS replied_raw_only");
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE runs\.replied AND NOT runs\.replied_raw_only\)::int AS casou_so_no_canonico/);
    // a variante "raw_only" não pode ter o OR canônico — senão não mede nada.
    // Checa a ausência da ASSINATURA do canônico (length(regexp_replace(lm.phone...),
    // não " OR " cru — o bloco tem outro OR legítimo (direction/engagement_signal).
    const rawOnlyIdx = sql.indexOf("AS replied_raw_only");
    const rawOnlyDeclIdx = sql.lastIndexOf("CASE WHEN r.sent_at IS NULL THEN false ELSE", rawOnlyIdx);
    const rawOnlyBlock = sql.slice(rawOnlyDeclIdx, rawOnlyIdx);
    expect(rawOnlyBlock).toContain("AND (lm.phone = r.phone)");
    expect(rawOnlyBlock).not.toContain("length(regexp_replace(lm.phone");
  });

  it("[TESTE OBRIGATÓRIO] sem is_group (coluna ausente), respostasDeGrupo é NULL na query — não 0", () => {
    const sqlComIsGroup = buildMessageEffectivenessSql(true, true);
    const sqlSemIsGroup = buildMessageEffectivenessSql(true, false);
    expect(sqlComIsGroup).toMatch(/COUNT\(\*\) FILTER \(WHERE runs\.replied AND runs\.replied_without_group IS NOT TRUE\)::int AS respostas_de_grupo/);
    expect(sqlSemIsGroup).toContain("NULL::int AS respostas_de_grupo");
    expect(stripSqlComments(sqlSemIsGroup)).not.toContain("is_group");
  });

  it("[TESTE OBRIGATÓRIO] as duas variantes de temperature (com e sem a coluna) carregam as contagens novas — nenhuma ganhou só metade", () => {
    for (const includeTemperature of [true, false]) {
      const sql = buildMessageEffectivenessSql(includeTemperature, true);
      expect(sql, `temperature=${includeTemperature}: falta casou_so_no_canonico`).toContain("casou_so_no_canonico");
      expect(sql, `temperature=${includeTemperature}: falta respostas_de_grupo`).toContain("respostas_de_grupo");
      expect(sql, `temperature=${includeTemperature}: falta telefone_lid`).toContain("telefone_lid");
      expect(sql, `temperature=${includeTemperature}: falta sem_lead_id`).toContain("sem_lead_id");
      expect(sql, `temperature=${includeTemperature}: falta lead_id_apagado`).toContain("lead_id_apagado");
      expect(sql, `temperature=${includeTemperature}: falta lead_id_de_outro_tenant`).toContain("lead_id_de_outro_tenant");
      expect(sql, `temperature=${includeTemperature}: falta telefone_divergente`).toContain("telefone_divergente");
      expect(sql, `temperature=${includeTemperature}: GROUP BY não carrega os motivos novos`).toMatch(
        /GROUP BY c\.id, c\.name, c\.analytics_meta,.*n\.telefone_lid, n\.sem_lead_id, n\.lead_id_apagado, n\.lead_id_de_outro_tenant, n\.telefone_divergente/
      );
    }
  });

  it("nenhum telefone aparece no texto da query fora de dentro do próprio SQL (isso é esperado — o telefone nunca sai da query pro JSON)", () => {
    // Este teste documenta a garantia inversa da rota: o SQL PRECISA
    // referenciar telefone pra funcionar (r.phone, lm.phone) — a garantia é
    // que nada disso vira coluna selecionada como valor de retorno de
    // telefone. As colunas de SELECT final são só contagens.
    const sql = buildMessageEffectivenessSql(true, true);
    const selectFinalIdx = sql.lastIndexOf("SELECT\n      c.id AS campaign_id");
    const selectFinal = sql.slice(selectFinalIdx, sql.indexOf("FROM runs\n    JOIN public.campaigns"));
    expect(selectFinal).not.toMatch(/AS\s+\w*phone\w*/i);
  });
});
