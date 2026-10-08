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

import { classifyTagKind } from "./leadProcedencia.js";

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

/** Quais colunas derivadas uma consulta realmente usa, a partir dos filtros: só estas são montadas (cada uma custa por linha). */
const needsOf = (filters = {}) => [filters.source ? "source" : null, filters.channel && filters.channel !== "all" ? "channel" : null, filters.segment ? "segment" : null].filter(Boolean);

/**
 * Base enriquecida: leads do tenant (no escopo do usuário) + as colunas derivadas PEDIDAS em `needs` ("source", "channel", "segment").
 * Cada consulta paga só pelo que usa. Alias final: e.
 *
 * `OFFSET 0` na camada `t` é uma cerca de propósito: sem ela o planejador do Postgres "achata" a subconsulta e SUBSTITUI `_s`
 * (lower + btrim) em cada uma das ~30 referências da cadeia de canais — 30 vezes por linha. Medido em 25 mil leads: 3,2 s sem a cerca,
 * 0,18 s com ela (o ICU não é o custo: sem collation o tempo era o mesmo, 3,2 s).
 */
function enrichedCte(scopeSql, needs = ["source", "channel", "segment"]) {
  const need = new Set(needs);
  if (need.has("channel")) need.add("source");
  const s0Cols = [need.has("source") ? `${SQL_SOURCE} AS _source` : null, need.has("segment") ? `${SQL_SUMMARY} AS _summary` : null].filter(Boolean);
  const t = need.has("channel")
    ? `SELECT s0.*, btrim(lower(s0._source COLLATE ${ICU}), ${WS}) AS _s FROM s0 OFFSET 0 /* cerca anti-achatamento: NAO REMOVER (3,2 s -> 0,18 s) */`
    : `SELECT s0.* FROM s0`;
  const eCols = [need.has("channel") ? `${SQL_CHANNEL} AS _channel` : null, need.has("segment") ? `${SQL_SEGMENT} AS _segment` : null].filter(Boolean);
  return `WITH s0 AS (
      SELECT s.*${s0Cols.length ? `, ${s0Cols.join(", ")}` : ""}
        FROM public.leads s
       WHERE ${scopeSql}
    ), t AS (
      ${t}
    ), e AS (
      SELECT t.*${eCols.length ? `, ${eCols.join(", ")}` : ""} FROM t
    )`;
}

/**
 * ⚠️ NÃO REMOVA o `OFFSET 0` desta consulta nem o da camada `t` de enrichedCte: não é enfeite, é a CORREÇÃO do timeout de produção.
 * Sem a cerca o planejador do Postgres achata o CTE e copia `btrim(lower(...))` para dentro de cada uma das ~30 comparações da cadeia de
 * canais (30x por linha). Medido em 25 mil leads: 3,2 s sem a cerca, 0,18 s com ela. Em produção (24.655 leads) a parte `channels`
 * estourava os 30 s do pool ("Query read timeout") e o painel ficava sem os cartões de origem.
 * Travado por teste (leadListQueryPostgres.test.js: custo e estrutura) e por mutação. A collation ICU NÃO é o custo (mesmo tempo sem ela);
 * fica porque `lower()` comum diverge do `toLowerCase()` do JavaScript em 2 de 65 valores do corpus.
 *
 * Cartões de origem: classifica cada ORIGEM DISTINTA uma vez (poucas centenas, não 25 mil linhas) e soma as contagens.
 * Mesmo resultado de classificar linha a linha: o canal é função só da origem.
 */
function channelsSql(scopeSql) {
  return `WITH s0 AS (
      SELECT ${SQL_SOURCE} AS _source FROM public.leads s WHERE ${scopeSql}
    ), g AS (
      SELECT _source, count(*)::int AS n FROM s0 GROUP BY 1
    ), t AS (
      SELECT g._source, g.n, btrim(lower(g._source COLLATE ${ICU}), ${WS}) AS _s FROM g OFFSET 0 /* cerca anti-achatamento: NAO REMOVER (3,2 s -> 0,18 s) */
    ) SELECT ${SQL_CHANNEL} AS id, sum(t.n)::int AS n FROM t GROUP BY 1`;
}

/** Só a origem derivada (sem collation, canal nem faixa): é o que a lista de origens precisa, e não herda falha do resto da classificação. */
function sourceCte(scopeSql) {
  return `WITH s0 AS (
      SELECT s.*, ${SQL_SOURCE} AS _source
        FROM public.leads s
       WHERE ${scopeSql}
    )`;
}

export class Params {
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

export const importIdCond = (params, importId, alias = "s") => `${alias}.dados @> jsonb_build_object('import_ids', jsonb_build_array(${params.add(importId)}::text))`;

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
  if (f.importId) c.importId = importIdCond(params, f.importId, "e");
  if (f.stalledDays !== undefined && f.stalledDays !== null) {
    const p = params.add(f.stalledDays);
    c.stalledDays = `(NOW() - COALESCE(e.last_message_at, e.last_interaction_at, e.updated_at, e.created_at)) >= (${p} || ' days')::interval
      AND (e.stage IS NULL OR lower(e.stage) NOT IN ('fechado', 'perdido', 'descartado', 'buyer', 'lost'))`;
  }
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
  if (sort === "stalled" || sort === "days_idle") {
    return `ORDER BY (NOW() - COALESCE(e.last_message_at, e.last_interaction_at, e.updated_at, e.created_at)) DESC, e.id DESC`;
  }
  return "ORDER BY e.created_at DESC, e.id";
}

const stripHelpers = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row)) if (!k.startsWith("_")) out[k] = v;
  return out;
};

const emptyChannelCounts = () => Object.fromEntries(MARKETING_CHANNEL_IDS.map((id) => [id, 0]));

/** A causa de um erro de banco, para dizer QUAL parte falhou e por quê (sem pilha, SQL nem parâmetros). */
function partCause(error) {
  const cause = { message: String(error?.message ?? error) };
  for (const key of ["code", "detail", "hint", "position", "routine", "schema", "table", "column"]) {
    if (error?.[key] !== undefined && error[key] !== null && error[key] !== "") cause[key] = String(error[key]);
  }
  return cause;
}

export const FACET_PARTS = ["summary", "channels", "sources", "tags"];

/**
 * Totais da BASE (escopo do usuário), agregados no banco. As quatro partes — summary, channels, sources, tags — são INDEPENDENTES e
 * degradam por parte: cada uma que responder vai no resultado, cada uma que falhar vem `null` e entra em `failedParts` com a causa.
 * Uma conta quebrada não apaga as outras (a lista de tags, por exemplo, é o que permite montar o público de uma campanha).
 * `tags` e `sources` NÃO dependem do CTE de classificação (canal/faixa): se esse SQL falhar, as duas continuam respondendo.
 * `parts` escolhe o que calcular (o legado só quer o resumo).
 */
export async function queryBaseFacets(pool, scope, { parts = FACET_PARTS } = {}) {
  await useCollation(pool);
  const want = (name) => parts.includes(name);
  const p = new Params();
  const scopeSql = buildScope(p, scope);
  const enriched = enrichedCte(scopeSql, ["segment"]); // o resumo não usa origem nem canal
  const sourceOnly = sourceCte(scopeSql);
  const runEnriched = (sql) => pool.query(`${enriched} ${sql}`, p.values);

  const jobs = {
    summary: () =>
      runEnriched(`SELECT count(*)::int AS total,
              count(*) FILTER (WHERE e.stage = 'buyer')::int AS buyers,
              count(*) FILTER (WHERE e.stage = 'lost')::int AS lost,
              count(*) FILTER (WHERE e._segment = 'in_negotiation')::int AS in_negotiation,
              count(*) FILTER (WHERE e._segment = 'in_conversation')::int AS in_conversation,
              count(*) FILTER (WHERE e._segment = 'never_contacted')::int AS never_contacted,
              COALESCE(sum(e.potential_contract_value) FILTER (WHERE e._segment = 'in_negotiation'), 0)::float8 AS estimated_revenue,
              count(*) FILTER (WHERE e.stage = 'open_budget')::int AS st_open_budget,
              count(*) FILTER (WHERE e.stage = 'inquiry')::int AS st_inquiry,
              count(*) FILTER (WHERE e.stage = 'cold')::int AS st_cold,
              count(*) FILTER (WHERE (e.stage IS NULL OR lower(e.stage) NOT IN ('buyer', 'fechado', 'perdido', 'descartado', 'lost'))
                AND (NOW() - COALESCE(e.last_message_at, e.last_interaction_at, e.updated_at, e.created_at)) >= interval '3 days')::int AS stalled_count
         FROM e`),
    channels: () => pool.query(channelsSql(scopeSql), p.values),
    sources: () => pool.query(`${sourceOnly} SELECT s0._source AS source, count(*)::int AS n FROM s0 GROUP BY 1 ORDER BY n DESC, source`, p.values),
    tags: async () => {
      const res = await pool.query(
        `SELECT tg.tag AS tag, count(*)::int AS n FROM public.leads s CROSS JOIN LATERAL unnest(COALESCE(s.tags, ARRAY[]::text[])) AS tg(tag)
          WHERE ${scopeSql} GROUP BY 1 ORDER BY 1`,
        p.values
      );
      // Nomes de grupo extraído (dados.grupo_nome): é o que permite separar "grupo" de "marcação da pessoa". Consulta à parte, DENTRO desta parte
      // mas isolada: se ela falhar a lista de tags continua saindo (os grupos só caem em "minhas") e o motivo vai em `tagKindsCause`.
      let groupNames = new Set();
      let groupsCause = null;
      try {
        const g = await pool.query(
          `SELECT DISTINCT s.dados->>'grupo_nome' AS g FROM public.leads s WHERE ${scopeSql} AND s.dados ? 'grupo_nome'`,
          p.values
        );
        groupNames = new Set(g.rows.map((r) => r.g).filter(Boolean));
      } catch (err) {
        groupsCause = partCause(err);
        console.error("[leads-facets] nomes de grupo falharam (tags seguem, sem separar grupos):", err?.message || err);
      }
      return { rows: res.rows, groupNames, groupsCause };
    },
  };

  const asked = FACET_PARTS.filter(want);
  const settled = await Promise.allSettled(asked.map((name) => jobs[name]()));

  const out = { summary: null, baseTotal: null, stagesExact: null, channels: null, sources: null, tags: null, failedParts: {} };
  settled.forEach((result, i) => {
    const name = asked[i];
    if (result.status === "rejected") {
      out.failedParts[name] = partCause(result.reason);
      console.error(`[leads-facets] parte "${name}" falhou:`, result.reason?.message || result.reason);
      return;
    }
    const res = result.value;
    if (name === "summary") {
      const r = res.rows[0];
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
        stalledCount: r.stalled_count,
      };
      out.baseTotal = r.total;
      out.stalledCount = r.stalled_count;
      // contagem por estágio EXATA (cada estágio é o seu), para o assistente de campanha; `other` = nulo ou desconhecido
      out.stagesExact = {
        buyer: r.buyers,
        open_budget: r.st_open_budget,
        inquiry: r.st_inquiry,
        cold: r.st_cold,
        lost: r.lost,
        other: r.total - r.buyers - r.st_open_budget - r.st_inquiry - r.st_cold - r.lost,
      };
    } else if (name === "channels") {
      out.channels = emptyChannelCounts();
      for (const row of res.rows) out.channels[row.id] = row.n;
    } else if (name === "sources") {
      out.sources = res.rows.map((x) => ({ source: x.source, count: x.n }));
    } else if (name === "tags") {
      // `kind` separa procedência, rótulo da IA e marcação da pessoa NA TELA; nenhum dado muda e nenhuma tag some
      out.tags = res.rows.map((x) => ({ tag: x.tag, count: x.n, kind: classifyTagKind(x.tag, res.groupNames) }));
      if (res.groupsCause) out.tagKindsCause = res.groupsCause;
    }
  });
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
    return { p, cte: enrichedCte(scopeSql, needsOf(only)), where };
  };
  const ALL_KEYS = ["stage", "temperature", "tag", "search", "source", "channel", "segment", "importId", "stalledDays"];
  const TAB_KEYS = ["temperature", "tag", "search", "importId", "stalledDays"]; // as abas ignoram estágio, origem, canal e faixa

  const total = prepare(ALL_KEYS);
  const pageQ = prepare(ALL_KEYS);
  const limitSql = pageQ.p.add(safeLimit);
  const offsetSql = pageQ.p.add(offset);
  const tabs = prepare(TAB_KEYS);

  const [{ rows: totalRows }, { rows: pageRows }, tabsRes] = await Promise.all([
    pool.query(`${total.cte} SELECT count(*)::int AS n FROM e ${total.where}`, total.p.values),
    pool.query(`${pageQ.cte} SELECT e.*, EXTRACT(DAY FROM (NOW() - COALESCE(e.last_message_at, e.last_interaction_at, e.updated_at, e.created_at)))::int AS days_idle FROM e ${pageQ.where} ${orderBy(sort || (filters.stalledDays !== undefined ? "stalled" : null), dir)} LIMIT ${limitSql} OFFSET ${offsetSql}`, pageQ.p.values),
    withTabs
      ? pool.query(
          `${tabs.cte}
           SELECT count(*)::int AS all_n,
                  count(*) FILTER (WHERE e.stage = 'buyer')::int AS buyer,
                  count(*) FILTER (WHERE e.stage = 'open_budget')::int AS open_budget,
                  count(*) FILTER (WHERE e.stage IS NULL OR e.stage NOT IN ('buyer', 'open_budget', 'lost'))::int AS cold,
                  count(*) FILTER (WHERE e.stage = 'lost')::int AS lost,
                  count(*) FILTER (WHERE (e.stage IS NULL OR lower(e.stage) NOT IN ('buyer', 'fechado', 'perdido', 'descartado', 'lost'))
                    AND (NOW() - COALESCE(e.last_message_at, e.last_interaction_at, e.updated_at, e.created_at)) >= interval '3 days')::int AS stalled
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
    tabs: t ? { all: t.all_n, buyer: t.buyer, open_budget: t.open_budget, cold: t.cold, lost: t.lost, stalled: t.stalled } : null,
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
  const where = whereOf(conds, ["stage", "temperature", "tag", "search", "source", "channel", "segment", "importId", "stalledDays"]);
  const { rows } = await pool.query(
    `${enrichedCte(scopeSql, needsOf(filters))} SELECT e.id${contacts ? ", e.nome, e.telefone, e.phone" : ""} FROM e ${where} ORDER BY e.created_at DESC, e.id LIMIT ${MAX_IDS + 1}`,
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

// ── campanha por planilha: a procedência verdadeira é dados.import_ids ───────────────────────────────────────────────────
/**
 * "Nasceu na importação" × "já existia e foi tocado por ela". O lead guarda o id de TODA importação que o tocou (união em dados.import_ids);
 * o que distingue os dois é a data de criação do lead contra a da abertura da importação (lead_imports.created_at). Os leads de uma importação
 * são gravados depois da abertura; um lead criado antes já existia. A tolerância cobre a diferença entre o relógio do app (que carimba o lead)
 * e o do banco (que carimba a abertura): sem ela, importação de 1 linha (abre e grava no mesmo instante) cairia do lado errado.
 */
export const IMPORT_BORN_TOLERANCE_SECONDS = 10;
const IMPORT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const IMPORT_SCOPES = ["all", "born", "existed"];
/** source_type das importações RECONSTRUÍDAS depois do fato (ops/sql/2026-10-06-reconstruir-importacoes.sql): sem hora de abertura, total é piso, data aproximada. */
export const RECONSTRUCTED_SOURCE_TYPE = "reconstruida";
export const RECONSTRUCTED_SCOPE_REASON =
  "Importação reconstruída depois do fato: não existe a hora de abertura para separar quem nasceu nela de quem já existia. Só o total é conhecido (e é no mínimo esse).";

async function loadImportRow(pool, clientId, importId) {
  if (!IMPORT_ID_RE.test(String(importId))) return null;
  const { rows } = await pool.query(`SELECT id::text AS id, source_name, source_type, total_rows, created_at FROM public.lead_imports WHERE id::text = $1 AND client_id = $2`, [importId, clientId]);
  return rows[0] || null;
}

/** Os dois números que o dono vê antes de confirmar a campanha por planilha. `found: false` = importação inexistente ou de outra empresa. */
export async function queryImportOrigin(pool, { scope, importId }) {
  const imp = await loadImportRow(pool, scope.clientId, importId);
  if (!imp) return { found: false, importId };
  const p = new Params();
  const scopeSql = buildScope(p, scope);
  const ts = p.add(new Date(imp.created_at).toISOString());
  const cond = importIdCond(p, imp.id);
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE s.created_at >= ${ts}::timestamptz - interval '${IMPORT_BORN_TOLERANCE_SECONDS} seconds')::int AS born,
            count(*) FILTER (WHERE s.created_at <  ${ts}::timestamptz - interval '${IMPORT_BORN_TOLERANCE_SECONDS} seconds')::int AS existed
       FROM public.leads s WHERE ${scopeSql} AND ${cond}`,
    p.values
  );
  const { born, existed } = rows[0];
  if (imp.source_type === RECONSTRUCTED_SOURCE_TYPE) {
    // Número que não dá para saber não vira número: sem "nasceram / já existiam"; só o total (piso) e o porquê.
    return {
      found: true, importId: imp.id, sourceName: imp.source_name, reconstructed: true, totalIsFloor: true, approximateDate: true,
      totalRows: Number(imp.total_rows) || 0, createdAt: new Date(imp.created_at).toISOString(),
      born: null, existed: null, total: born + existed, reason: RECONSTRUCTED_SCOPE_REASON,
    };
  }
  return { found: true, importId: imp.id, sourceName: imp.source_name, totalRows: Number(imp.total_rows) || 0, createdAt: new Date(imp.created_at).toISOString(), born, existed, total: born + existed };
}

/**
 * O público do assistente de campanha: estágios (igualdade EXATA, como sempre), tag, regras e — novo — uma PLANILHA registrada (importId) com o
 * recorte `importScope` ("all" padrão, "born", "existed"). Linhas enxutas + o total.
 */
export async function queryCampaignAudience(pool, { scope, stages = [], tag = "", rules = [], importId = null, importScope = "all" }) {
  await useCollation(pool);
  const p = new Params();
  const scopeSql = buildScope(p, scope);
  const where = [];
  const wanted = (Array.isArray(stages) ? stages : []).filter(Boolean);
  if (wanted.length > 0 && !wanted.includes("all")) where.push(`e.stage = ANY(${p.add(wanted)}::text[])`);
  if (tag) where.push(`e.tags @> ARRAY[${p.add(tag)}]::text[]`);
  if (importId) {
    const imp = await loadImportRow(pool, scope.clientId, importId);
    if (!imp) return { items: [], total: 0, truncated: false, importNotFound: true };
    if (imp.source_type === RECONSTRUCTED_SOURCE_TYPE && (importScope === "born" || importScope === "existed")) {
      return { items: [], total: 0, truncated: false, scopeUnavailable: true, reason: RECONSTRUCTED_SCOPE_REASON };
    }
    where.push(importIdCond(p, imp.id, "e"));
    if (importScope === "born" || importScope === "existed") {
      const ts = p.add(new Date(imp.created_at).toISOString()); // só entra como parâmetro quando a SQL o usa
      where.push(`e.created_at ${importScope === "born" ? ">=" : "<"} ${ts}::timestamptz - interval '${IMPORT_BORN_TOLERANCE_SECONDS} seconds'`);
    }
  }
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || !rule.column) continue;
    where.push(ruleCondition(p, rule));
  }
  const { rows } = await pool.query(
    `${enrichedCte(scopeSql, [])}
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
  const { rows } = await pool.query(`${enrichedCte(scopeSql, [])} SELECT e.* FROM e WHERE ${conds.join(" OR ")} ORDER BY e.created_at DESC LIMIT 1`, p.values);
  return rows[0] ? stripHelpers(rows[0]) : null;
}

/** Chaves personalizadas (dados.campos) presentes na combinação de filtros: as colunas extras da exportação. */
export async function queryCustomKeys(pool, { scope, filters = {} }) {
  await useCollation(pool);
  const p = new Params();
  const scopeSql = buildScope(p, scope);
  const conds = buildFilterConditions(p, filters);
  const where = whereOf(conds, ["stage", "temperature", "tag", "search", "source", "channel", "segment", "importId", "stalledDays"]);
  const { rows } = await pool.query(
    `${enrichedCte(scopeSql, needsOf(filters))}
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
    const where = whereOf(conds, ["stage", "temperature", "tag", "search", "source", "channel", "segment", "importId", "stalledDays"]);
    const limitSql = p.add(blockSize);
    const offsetSql = p.add(offset);
    const { rows } = await pool.query(
      `${enrichedCte(scopeSql, needsOf(filters))}
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

/** Filtros de lista vindos da URL ou body. Devolve { filters } ou { problem } (valor fora da lista conhecida vira 400, nunca lista vazia calada). */
export function parseLeadListFilters(query = {}) {
  const norm = (v) => (typeof v === "string" ? v.trim() : "");
  const stalledRaw = query.stalledDays ?? query.stalled;
  let stalledDays = undefined;
  if (stalledRaw !== undefined && stalledRaw !== null && String(stalledRaw).trim() !== "") {
    const parsed = parseInt(String(stalledRaw).trim(), 10);
    if (!isNaN(parsed) && parsed >= 0) {
      stalledDays = parsed;
    }
  }

  const filters = {
    stage: norm(query.stage),
    temperature: norm(query.temperature),
    tag: norm(query.tag),
    search: norm(query.search),
    source: norm(query.source),
    channel: norm(query.channel),
    segment: norm(query.segment),
    importId: norm(query.importId),
    ...(stalledDays !== undefined ? { stalledDays } : {}),
  };
  if (filters.channel && filters.channel !== "all" && !MARKETING_CHANNEL_IDS.includes(filters.channel)) {
    return { problem: `Canal inválido: ${filters.channel}` };
  }
  if (filters.segment && !BASE_POTENTIAL_SEGMENTS.includes(filters.segment)) {
    return { problem: `Faixa inválida: ${filters.segment}` };
  }
  return { filters };
}

/**
 * Consulta de Leads Parados (Pilar 1: Aviso de Lead Parado - Nenhum Lead Esquecido).
 * Retorna leads em etapas ativas sem resposta/interação há pelo menos minDays dias.
 */
export async function queryStalledLeads(pool, { scope, minDays = 3, limit = 50, offset = 0, stage = null }) {
  await useCollation(pool);
  const safeMinDays = Math.max(0, parseInt(minDays, 10) || 3);
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

  const p = new Params();
  const scopeSql = buildScope(p, scope);

  const conds = [
    `(NOW() - COALESCE(s.last_message_at, s.last_interaction_at, s.updated_at, s.created_at)) >= (${p.add(safeMinDays)} || ' days')::interval`,
  ];

  if (stage && stage !== "all") {
    conds.push(`s.stage = ${p.add(stage)}`);
  } else {
    conds.push(`(s.stage IS NULL OR lower(s.stage) NOT IN ('fechado', 'perdido', 'descartado', 'buyer', 'lost'))`);
  }

  const whereSql = `WHERE ${scopeSql} AND ${conds.join(" AND ")}`;

  const countPValues = [...p.values];
  const countSql = `SELECT count(*)::int AS count FROM public.leads s ${whereSql}`;

  const limitParam = p.add(safeLimit);
  const offsetParam = p.add(safeOffset);

  const leadsSql = `
    SELECT
      s.id,
      s.nome,
      s.telefone,
      s.phone,
      s.stage,
      s.temperature,
      s.tags,
      s.raw_chat_summary,
      s.created_at,
      s.updated_at,
      s.last_interaction_at,
      s.last_message_at,
      COALESCE(s.dados->>'sdr_rotation_owner', s.assigned_to) AS sdr_rotation_owner,
      EXTRACT(DAY FROM (NOW() - COALESCE(s.last_message_at, s.last_interaction_at, s.updated_at, s.created_at)))::int AS days_idle
    FROM public.leads s
    ${whereSql}
    ORDER BY days_idle DESC, s.id DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const [{ rows: countRows }, { rows: leadRows }] = await Promise.all([
    pool.query(countSql, countPValues),
    pool.query(leadsSql, p.values),
  ]);

  return {
    count: countRows[0]?.count ?? 0,
    minDays: safeMinDays,
    leads: leadRows,
  };
}

export const queryBaseLeads = queryLeadsPage;

/** Escopo de tenant e operador para queries de leads. Usado por Banco de Dados, Campanhas e Follow-up. */
export function resolveLeadListScope(req, clientId) {
  const norm = (v) => (typeof v === "string" ? v.trim() : "");
  const isInternalOperator = req?.authAccess?.role === "internal" && req?.authAccess?.accessPreset === "operador";
  if (isInternalOperator) {
    const uid = req?.authAccess?.uid || req?.authUser?.uid;
    const email = req?.authAccess?.email || req?.authUser?.email;
    return { clientId, operatorIdentifiers: [uid, email].filter(Boolean) };
  }
  if (req?.authAccess?.role !== "client") {
    const assignedTo = norm(req?.query?.assigned_to || req?.query?.assignedTo || req?.query?.userId);
    return { clientId, assignedTo: assignedTo || null };
  }
  return { clientId };
}
