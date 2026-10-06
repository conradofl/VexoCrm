// Lista de leads do Banco de Dados: filtro, ordenação, contagem e paginação NO BANCO.
//
// Antes, GET /api/leads devolvia a lista (ou, quando a consulta principal falhava em silêncio, as 2.000 primeiras linhas SEM
// filtro) e a tela refazia tudo no navegador — abas, contagem por estágio, tag, busca, origem, faixa e paginação — sobre essa
// lista só. Os totais vinham de `select("*")` da tabela inteira contado no Node. Aqui cada regra tem a sua SQL, e as regras
// derivadas (origem, canal, faixa do Potencial) têm UMA implementação em SQL, conferida contra as funções da tela
// (lib/leadChannels.ts, lib/leads/basePotential.ts) e do servidor (temConversaComercial) por teste de paridade.
//
// Semântica (decisão do dono, 05/10/2026):
//  - cartões de origem e Potencial da Base: SEMPRE a base inteira (painel de atribuição, não resultado de filtro);
//  - abas: contam DENTRO do filtro ativo de tag e de busca (cruzamento); sem filtro, abas e base coincidem;
//  - total da lista: a combinação de todos os filtros;
//  - "Leads Frios" = tudo que não é comprador, orçamento aberto nem perdido (o complemento: nada some da tela).
//
// Texto: caixa e acento seguem a ICU — `pt-BR-x-icu` quando o banco a tem (produção tem), senão `und-x-icu` (a raiz; é a que o pglite
// dos testes tem, e o português não tem ajuste próprio sobre ela) —,
// não o `lctype` do banco: com `lc_ctype = C` o lower() só dobraria ASCII. Ordenar por nome com a mesma collation dá a mesma
// ordem do localeCompare do navegador (teste de paridade com nomes com acento, cedilha e caixa variada).

const COLLATION_PREFERENCE = ["pt-BR-x-icu", "und-x-icu"];
const DEFAULT_COLLATION = '"und-x-icu"';
/** Collation em uso na consulta que está sendo montada (atribuída, de forma síncrona, logo depois de resolvida e antes de montar o SQL). */
let ICU = DEFAULT_COLLATION;
const collationByPool = new WeakMap();

/** Qual collation ICU este banco tem. Resolvida uma vez por pool; falha ao perguntar = padrão (a consulta falha alto e a tela avisa "degradado"). */
export async function resolveCollation(pool) {
  const cached = collationByPool.get(pool);
  if (cached) return cached;
  try {
    const { rows } = await pool.query(`SELECT collname FROM pg_collation WHERE collname = ANY($1::text[])`, [COLLATION_PREFERENCE]);
    const have = new Set(rows.map((r) => r.collname));
    const found = COLLATION_PREFERENCE.find((name) => have.has(name));
    if (!found) {
      console.error(`[leads] nenhuma collation ICU encontrada (${COLLATION_PREFERENCE.join(", ")}): busca e ordenação por nome vão falhar; instale o ICU do Postgres.`);
      return DEFAULT_COLLATION;
    }
    const resolved = `"${found}"`;
    collationByPool.set(pool, resolved);
    return resolved;
  } catch (err) {
    console.error("[leads] não foi possível consultar as collations do banco; usando und-x-icu:", err?.message || err);
    return DEFAULT_COLLATION;
  }
}
const useCollation = async (pool) => {
  const c = await resolveCollation(pool);
  ICU = c; // síncrono até o SQL ser montado: nenhuma outra consulta intercala aqui
};
export const activeCollation = () => ICU;
/** Espaços que o String.prototype.trim() do JavaScript remove (o btrim padrão só remove o espaço). */
const WS = "E' \\t\\n\\r\\f\\v\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff'";

export const MARKETING_CHANNEL_IDS = [
  "instagram", "google", "facebook", "tiktok", "indicacao", "whatsapp", "campanha", "organico", "trafego_pago",
  "importacao_planilha", "vendas_fechadas", "texto_avulso", "nao_identificada",
];
export const STAGE_TABS = ["all", "buyer", "open_budget", "cold", "lost"];
export const BASE_POTENTIAL_SEGMENTS = ["never_contacted", "in_conversation", "in_negotiation"];
export const MAX_PAGE_SIZE = 500;
export const MAX_IDS = 100_000;

const tagMatches = (regex) => `EXISTS (SELECT 1 FROM unnest(COALESCE(s.tags, ARRAY[]::text[])) AS tg(tag) WHERE tg.tag ~* '${regex}')`;

/** Mesma regra de getLeadSource (lib/leadChannels.ts): tag de rede social primeiro, depois lead_source/origem_marketing/origem. */
const SQL_SOURCE = `(CASE
    WHEN ${tagMatches("instagram")} THEN 'Instagram Direct'
    WHEN ${tagMatches("facebook|messenger")} THEN 'Facebook Messenger'
    WHEN ${tagMatches("tiktok")} THEN 'TikTok'
    WHEN ${tagMatches("linkedin")} THEN 'LinkedIn'
    ELSE COALESCE(NULLIF(s.lead_source, ''), NULLIF(s.dados->>'origem_marketing', ''), NULLIF(s.dados->>'origem', ''), 'Não informado')
  END)`;

/** O resumo de conversa que a tela e o servidor consideram: raw_chat_summary; se vazio, dados.resumo_chat (só se for texto). */
const SQL_SUMMARY = `(CASE
    WHEN s.raw_chat_summary IS NOT NULL AND s.raw_chat_summary <> '' THEN s.raw_chat_summary
    WHEN jsonb_typeof(s.dados->'resumo_chat') = 'string' THEN s.dados->>'resumo_chat'
  END)`;

const has = (needle) => `position('${needle}' in t._s) > 0`;
/** Mesma cadeia de regras de getLeadMarketingChannelId — a ORDEM importa, do mais específico ao mais geral. */
const SQL_CHANNEL = `(CASE
    WHEN t._s = 'instagram' OR t._s LIKE 'insta%' THEN 'instagram'
    WHEN t._s = 'google ads' OR ${has("google")} OR ${has("gads")} OR ${has("pesquisa")} THEN 'google'
    WHEN t._s = 'facebook ads' OR ${has("facebook")} OR ${has("face")} OR ${has("messenger")} THEN 'facebook'
    WHEN t._s = 'tiktok' OR ${has("tiktok")} OR t._s LIKE 'tt%' THEN 'tiktok'
    WHEN t._s = 'indicacao' OR ${has("indica")} OR ${has("amigo")} OR ${has("referral")} THEN 'indicacao'
    WHEN t._s IN ('importacao_planilha', 'importação de planilha') THEN 'importacao_planilha'
    WHEN t._s IN ('vendas_fechadas', 'importação vendas fechadas') THEN 'vendas_fechadas'
    WHEN t._s = 'ia direct/chat' THEN 'texto_avulso'
    WHEN ${has("campanh")} THEN 'campanha'
    WHEN t._s = 'trafego_pago' OR ${has("trafego")} OR ${has("tráfego")} OR t._s = 'whatsapp_ads' OR ${has("whatsapp ads")} THEN 'trafego_pago'
    WHEN ${has("whatsapp")} OR t._s = 'inbound' OR ${has("zap")} THEN 'whatsapp'
    WHEN t._s = 'organico' OR ${has("orgânico")} OR ${has("organico")} OR ${has("formul")} OR ${has("site")} OR ${has("landing")} THEN 'organico'
    ELSE 'nao_identificada'
  END)`;

/** Mesma regra de getLeadSegment (lib/leads/basePotential.ts) e de temConversaComercial (servidor). */
const SQL_SEGMENT = `(CASE
    WHEN t.stage IN ('buyer', 'lost') THEN NULL
    WHEN t.stage = 'open_budget' OR t.status = 'orcamento' THEN 'in_negotiation'
    WHEN t._summary IS NOT NULL AND btrim(t._summary, ${WS}) <> '' AND btrim(t._summary, ${WS}) NOT LIKE '🚫%' THEN 'in_conversation'
    ELSE 'never_contacted'
  END)`;

/** Base enriquecida: leads do tenant (no escopo do usuário) + origem, canal e faixa derivados. Alias final: e. */
function enrichedCte(scopeSql) {
  return `WITH s0 AS (
      SELECT s.*, ${SQL_SOURCE} AS _source, ${SQL_SUMMARY} AS _summary
        FROM public.leads s
       WHERE ${scopeSql}
    ), t AS (
      SELECT s0.*, btrim(lower(s0._source COLLATE ${ICU}), ${WS}) AS _s FROM s0
    ), e AS (
      SELECT t.*, ${SQL_CHANNEL} AS _channel, ${SQL_SEGMENT} AS _segment FROM t
    )`;
}

class Params {
  constructor() {
    this.values = [];
  }
  add(value) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * O escopo do usuário: operador interno vê os seus e os sem dono; usuário interno pode filtrar por responsável; cliente vê tudo
 * do tenant. Sempre filtra por client_id (multi-tenant).
 */
export function buildScope(params, { clientId, operatorIdentifiers = null, assignedTo = null }) {
  const parts = [`s.client_id = ${params.add(clientId)}`];
  if (operatorIdentifiers && operatorIdentifiers.length > 0) {
    parts.push(`(s.assigned_to = ANY(${params.add(operatorIdentifiers)}::text[]) OR s.assigned_to IS NULL)`);
  } else if (assignedTo) {
    parts.push(`s.assigned_to = ${params.add(assignedTo)}`);
  }
  return parts.join(" AND ");
}

const foldSql = (expr) => `lower(${expr} COLLATE ${ICU})`;

/** Condições de filtro sobre `e` (a base enriquecida). Cada chave é opcional. */
export function buildFilterConditions(params, f = {}) {
  const c = {};
  const stage = (f.stage || "").trim();
  if (stage && stage !== "all") {
    c.stage = stage === "cold"
      ? `(e.stage IS NULL OR e.stage NOT IN ('buyer', 'open_budget', 'lost'))` // Leads Frios = o complemento
      : `e.stage = ${params.add(stage)}`;
  }
  if (f.temperature && f.temperature !== "all") c.temperature = `e.temperature = ${params.add(f.temperature)}`;
  if (f.tag) c.tag = `e.tags @> ARRAY[${params.add(f.tag)}]::text[]`;
  const search = (f.search || "").trim();
  if (search) {
    const p = params.add(`%${escapeLike(search)}%`);
    const pat = foldSql(`${p}::text`);
    c.search = `(${foldSql("COALESCE(NULLIF(e.telefone, ''), e.phone, '')")} LIKE ${pat} ESCAPE '\\'
        OR ${foldSql("COALESCE(e.nome, '')")} LIKE ${pat} ESCAPE '\\'
        OR ${foldSql("COALESCE(e.raw_chat_summary, '')")} LIKE ${pat} ESCAPE '\\')`;
  }
  if (f.source) c.source = `e._source = ${params.add(f.source)}`;
  if (f.channel && f.channel !== "all") c.channel = `e._channel = ${params.add(f.channel)}`;
  if (f.segment) c.segment = `e._segment = ${params.add(f.segment)}`;
  return c;
}

const whereOf = (conds, keys) => {
  const parts = keys.map((k) => conds[k]).filter(Boolean);
  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
};

function orderBy(sort, dir) {
  const direction = dir === "desc" ? "DESC" : "ASC";
  // Direto na collation, SEM lower(): a ICU já trata acento como diferença secundária e caixa como terciária (o critério do localeCompare).
  // Com lower() "Ana" e "ana" virariam a mesma chave e o desempate seria arbitrário. Desempate por data e id para a paginação ser estável.
  if (sort === "contato") return `ORDER BY COALESCE(e.nome, '') COLLATE ${ICU} ${direction}, e.created_at DESC, e.id`;
  if (sort === "ultima_conversa") return `ORDER BY COALESCE(e.last_interaction_at, e.created_at) ${direction}, e.created_at DESC, e.id`;
  return "ORDER BY e.created_at DESC, e.id";
}

const stripHelpers = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row)) if (!k.startsWith("_")) out[k] = v;
  return out;
};

const emptyChannelCounts = () => Object.fromEntries(MARKETING_CHANNEL_IDS.map((id) => [id, 0]));

/**
 * Totais da BASE (escopo do usuário), todos agregados no banco. `parts` escolhe o que calcular (o legado só quer o resumo).
 * Mesmo formato de `summary` de sempre.
 */
export async function queryBaseFacets(pool, scope, { parts = ["summary", "channels", "sources", "tags"] } = {}) {
  await useCollation(pool);
  const want = (name) => parts.includes(name);
  const p = new Params();
  const scopeSql = buildScope(p, scope);
  const cte = enrichedCte(scopeSql);
  const run = (sql) => pool.query(`${cte} ${sql}`, p.values);
  const [summaryRes, channelRes, sourceRes, tagRes] = await Promise.all([
    want("summary")
      ? run(`SELECT count(*)::int AS total,
              count(*) FILTER (WHERE e.stage = 'buyer')::int AS buyers,
              count(*) FILTER (WHERE e.stage = 'lost')::int AS lost,
              count(*) FILTER (WHERE e._segment = 'in_negotiation')::int AS in_negotiation,
              count(*) FILTER (WHERE e._segment = 'in_conversation')::int AS in_conversation,
              count(*) FILTER (WHERE e._segment = 'never_contacted')::int AS never_contacted,
              COALESCE(sum(e.potential_contract_value) FILTER (WHERE e._segment = 'in_negotiation'), 0)::float8 AS estimated_revenue,
              count(*) FILTER (WHERE e.stage = 'open_budget')::int AS st_open_budget,
              count(*) FILTER (WHERE e.stage = 'inquiry')::int AS st_inquiry,
              count(*) FILTER (WHERE e.stage = 'cold')::int AS st_cold
         FROM e`)
      : null,
    want("channels") ? run(`SELECT e._channel AS id, count(*)::int AS n FROM e GROUP BY 1`) : null,
    want("sources") ? run(`SELECT e._source AS source, count(*)::int AS n FROM e GROUP BY 1 ORDER BY n DESC, source`) : null,
    want("tags")
      ? run(`SELECT tg.tag AS tag, count(*)::int AS n FROM e CROSS JOIN LATERAL unnest(COALESCE(e.tags, ARRAY[]::text[])) AS tg(tag) GROUP BY 1 ORDER BY 1`)
      : null,
  ]);
  const out = {};
  if (summaryRes) {
    const r = summaryRes.rows[0];
    out.summary = {
      totalLeads: r.total,
      buyersCount: r.buyers,
      lostCount: r.lost,
      openBudgetsCount: r.in_negotiation,
      inNegotiationCount: r.in_negotiation,
      inConversationCount: r.in_conversation,
      neverContactedCount: r.never_contacted,
      activeLeadsCount: r.in_negotiation + r.in_conversation + r.never_contacted,
      estimatedRevenue: r.estimated_revenue,
    };
    out.baseTotal = r.total;
    // contagem por estágio EXATA (cada estágio é o seu), para o assistente de campanha; `other` = nulo ou desconhecido
    out.stagesExact = {
      buyer: r.buyers,
      open_budget: r.st_open_budget,
      inquiry: r.st_inquiry,
      cold: r.st_cold,
      lost: r.lost,
      other: r.total - r.buyers - r.st_open_budget - r.st_inquiry - r.st_cold - r.lost,
    };
  }
  if (channelRes) {
    out.channels = emptyChannelCounts();
    for (const row of channelRes.rows) out.channels[row.id] = row.n;
  }
  if (sourceRes) out.sources = sourceRes.rows.map((x) => ({ source: x.source, count: x.n }));
  if (tagRes) out.tags = tagRes.rows.map((x) => ({ tag: x.tag, count: x.n }));
  return out;
}

/**
 * Uma página da lista + o total da combinação de filtros + as abas (dentro de tag e busca). Tudo em SQL.
 * `filters`: { stage, temperature, tag, search, source, channel, segment }.
 */
export async function queryLeadsPage(pool, { scope, filters = {}, sort = null, dir = "asc", page = 1, limit = 50, withTabs = true }) {
  await useCollation(pool);
  const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(limit) || 50));
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * safeLimit;

  // Um conjunto de parâmetros por consulta: o Postgres recusa parâmetro que a SQL não usa ("could not determine data type").
  const prepare = (keys) => {
    const p = new Params();
    const scopeSql = buildScope(p, scope);
    const only = Object.fromEntries(keys.map((k) => [k, filters[k]]));
    const where = whereOf(buildFilterConditions(p, only), keys);
    return { p, cte: enrichedCte(scopeSql), where };
  };
  const ALL_KEYS = ["stage", "temperature", "tag", "search", "source", "channel", "segment"];
  const TAB_KEYS = ["temperature", "tag", "search"]; // as abas ignoram estágio, origem, canal e faixa

  const total = prepare(ALL_KEYS);
  const pageQ = prepare(ALL_KEYS);
  const limitSql = pageQ.p.add(safeLimit);
  const offsetSql = pageQ.p.add(offset);
  const tabs = prepare(TAB_KEYS);

  const [{ rows: totalRows }, { rows: pageRows }, tabsRes] = await Promise.all([
    pool.query(`${total.cte} SELECT count(*)::int AS n FROM e ${total.where}`, total.p.values),
    pool.query(`${pageQ.cte} SELECT e.* FROM e ${pageQ.where} ${orderBy(sort, dir)} LIMIT ${limitSql} OFFSET ${offsetSql}`, pageQ.p.values),
    withTabs
      ? pool.query(
          `${tabs.cte}
           SELECT count(*)::int AS all_n,
                  count(*) FILTER (WHERE e.stage = 'buyer')::int AS buyer,
                  count(*) FILTER (WHERE e.stage = 'open_budget')::int AS open_budget,
                  count(*) FILTER (WHERE e.stage IS NULL OR e.stage NOT IN ('buyer', 'open_budget', 'lost'))::int AS cold,
                  count(*) FILTER (WHERE e.stage = 'lost')::int AS lost
             FROM e ${tabs.where}`,
          tabs.p.values
        )
      : Promise.resolve(null),
  ]);
  const count = totalRows[0].n;
  const t = tabsRes?.rows[0];
  return {
    items: pageRows.map(stripHelpers),
    total: count,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(count / safeLimit)),
    tabs: t ? { all: t.all_n, buyer: t.buyer, open_budget: t.open_budget, cold: t.cold, lost: t.lost } : null,
  };
}

/**
 * Todos os ids da combinação de filtros (selecionar todos da faixa, disparo por canal). `contacts` traz nome e telefone junto:
 * os modais de follow-up precisam deles para quem foi selecionado fora da página carregada.
 */
export async function queryLeadIds(pool, { scope, filters = {}, contacts = false }) {
  await useCollation(pool);
  const p = new Params();
  const scopeSql = buildScope(p, scope);
  const conds = buildFilterConditions(p, filters);
  const where = whereOf(conds, ["stage", "temperature", "tag", "search", "source", "channel", "segment"]);
  const { rows } = await pool.query(
    `${enrichedCte(scopeSql)} SELECT e.id${contacts ? ", e.nome, e.telefone, e.phone" : ""} FROM e ${where} ORDER BY e.created_at DESC, e.id LIMIT ${MAX_IDS + 1}`,
    p.values
  );
  const truncated = rows.length > MAX_IDS;
  const kept = truncated ? rows.slice(0, MAX_IDS) : rows;
  const out = { ids: kept.map((r) => r.id), total: kept.length, truncated };
  if (contacts) out.contacts = kept.map((r) => ({ id: r.id, nome: r.nome, telefone: r.telefone, phone: r.phone }));
  return out;
}

// ── regras dinâmicas do assistente de campanha (colunas escalares, lista fechada) ─────────────────────────────────────
/** Colunas escalares que uma regra pode usar. Fora disto (tags, dados…) não existe equivalente: a rota recusa e diz qual. */
export const RULE_COLUMNS = [
  "nome", "telefone", "phone", "stage", "temperature", "status", "lead_source", "lead_origin", "lead_temperature", "cidade", "estado",
  "tipo_cliente", "faixa_consumo", "source_campaign_name", "assigned_to", "potential_contract_value", "lead_score",
];
const RULE_OPERATORS = ["equals", "contains", "gt", "lt"];

export function validateAudienceRules(rules) {
  const problems = [];
  (Array.isArray(rules) ? rules : []).forEach((rule, index) => {
    if (!rule || !rule.column) return; // regra sem coluna não filtra (como sempre)
    if (!RULE_COLUMNS.includes(rule.column)) {
      problems.push({ index, column: rule.column, reason: "COLUMN_NOT_SUPPORTED", message: `A coluna "${rule.column}" não pode ser usada como regra: só campos simples do lead (${RULE_COLUMNS.join(", ")}). Tags e dados guardam listas/objetos, que não têm comparação por texto.` });
    } else if (!RULE_OPERATORS.includes(rule.operator)) {
      problems.push({ index, column: rule.column, reason: "OPERATOR_NOT_SUPPORTED", message: `Operador "${rule.operator}" inválido. Use: ${RULE_OPERATORS.join(", ")}.` });
    }
  });
  return problems;
}

/** A regra, como a tela sempre a aplicou: texto sem espaços das pontas e em minúsculas; gt/lt leem o número como parseFloat. */
export function ruleCondition(params, rule) {
  const col = `COALESCE(e.${rule.column}::text, '')`;
  const val = foldSql(`btrim(${col}, ${WS})`);
  const ruleVal = String(rule.value ?? "").trim();
  const rv = params.add(ruleVal);
  if (rule.operator === "equals") return `${val} = ${foldSql(`${rv}::text`)}`;
  if (rule.operator === "contains") return `position(${foldSql(`${rv}::text`)} in ${val}) > 0`;
  // gt/lt: remove tudo menos dígitos . , - ; troca a PRIMEIRA vírgula por ponto; lê o prefixo numérico (parseFloat)
  const num = `substring(regexp_replace(regexp_replace(${val}, '[^0-9.,-]', '', 'g'), ',', '.') from '^-?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)')::numeric`;
  const ruleNumSql = `substring(${rv}::text from '^-?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)')::numeric`;
  return `(${num} ${rule.operator === "gt" ? ">" : "<"} ${ruleNumSql})`;
}

/** O público do assistente de campanha: estágios (igualdade EXATA, como sempre), tag e regras; linhas enxutas + o total. */
export async function queryCampaignAudience(pool, { scope, stages = [], tag = "", rules = [] }) {
  await useCollation(pool);
  const p = new Params();
  const scopeSql = buildScope(p, scope);
  const where = [];
  const wanted = (Array.isArray(stages) ? stages : []).filter(Boolean);
  if (wanted.length > 0 && !wanted.includes("all")) where.push(`e.stage = ANY(${p.add(wanted)}::text[])`);
  if (tag) where.push(`e.tags @> ARRAY[${p.add(tag)}]::text[]`);
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || !rule.column) continue;
    where.push(ruleCondition(p, rule));
  }
  const { rows } = await pool.query(
    `${enrichedCte(scopeSql)}
     SELECT e.id, e.telefone, e.phone, e.nome, e.stage, e.temperature, e.tags, e.raw_chat_summary
       FROM e ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY e.created_at DESC, e.id LIMIT ${MAX_IDS + 1}`,
    p.values
  );
  const truncated = rows.length > MAX_IDS;
  const items = (truncated ? rows.slice(0, MAX_IDS) : rows);
  return { items, total: items.length, truncated };
}

/** Um lead pelo id ou pelo telefone (abrir pelo ?leadId= da URL, mesmo fora da página carregada). */
export async function lookupLead(pool, { scope, leadId = null, phoneVariants = [] }) {
  await useCollation(pool);
  const p = new Params();
  const scopeSql = buildScope(p, scope);
  const conds = [];
  if (leadId) conds.push(`e.id::text = ${p.add(String(leadId))}`);
  if (phoneVariants.length > 0) {
    const v = p.add(phoneVariants);
    conds.push(`(e.telefone = ANY(${v}::text[]) OR e.phone = ANY(${v}::text[]))`);
  }
  if (conds.length === 0) return null;
  const { rows } = await pool.query(`${enrichedCte(scopeSql)} SELECT e.* FROM e WHERE ${conds.join(" OR ")} ORDER BY e.created_at DESC LIMIT 1`, p.values);
  return rows[0] ? stripHelpers(rows[0]) : null;
}

/** Chaves personalizadas (dados.campos) presentes na combinação de filtros: as colunas extras da exportação. */
export async function queryCustomKeys(pool, { scope, filters = {} }) {
  await useCollation(pool);
  const p = new Params();
  const scopeSql = buildScope(p, scope);
  const conds = buildFilterConditions(p, filters);
  const where = whereOf(conds, ["stage", "temperature", "tag", "search", "source", "channel", "segment"]);
  const { rows } = await pool.query(
    `${enrichedCte(scopeSql)}
     SELECT DISTINCT k.key AS key FROM e
       CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(e.dados->'campos') = 'object' THEN e.dados->'campos' ELSE '{}'::jsonb END) AS k(key)
      ${where} ORDER BY 1`,
    p.values
  );
  return rows.map((r) => r.key);
}

/** Exportação SEM teto: percorre a combinação de filtros em blocos por posição (created_at, id), sem carregar tudo. */
export async function* iterateLeadsForExport(pool, { scope, filters = {}, blockSize = 2000 }) {
  const collation = await resolveCollation(pool);
  let offset = 0;
  for (;;) {
    ICU = collation;
    const p = new Params();
    const scopeSql = buildScope(p, scope);
    const conds = buildFilterConditions(p, filters);
    const where = whereOf(conds, ["stage", "temperature", "tag", "search", "source", "channel", "segment"]);
    const limitSql = p.add(blockSize);
    const offsetSql = p.add(offset);
    const { rows } = await pool.query(
      `${enrichedCte(scopeSql)}
       SELECT e.id, e.nome, e.telefone, e.stage, e.temperature, e.tags, e.raw_chat_summary, e.created_at, e.last_interaction_at, e.dados
         FROM e ${where} ORDER BY e.created_at DESC, e.id LIMIT ${limitSql} OFFSET ${offsetSql}`,
      p.values
    );
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < blockSize) return;
    offset += blockSize;
  }
}
