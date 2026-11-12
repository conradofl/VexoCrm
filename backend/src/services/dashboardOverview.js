// backend/src/services/dashboardOverview.js
//
// Dashboard, Fase 1: as consultas da Visão geral (spec de 11/11/2026).
// Cada função mede UM fato e devolve o que mediu; nenhuma devolve zero no lugar de "não sei".
//
// Regras que valem aqui:
//  - Pessoa é telefone canônico (SQL_CANONICAL_PHONE); gente se conta com COUNT(DISTINCT).
//  - "Sem registro" não é zero: quem não tem nenhuma linha devolve hasRecords = false.
//  - Métrica parcial diz a cobertura (N de M).

import { SQL_CANONICAL_PHONE } from "./canonicalPhone.js";
import { SLOW_FIRST_RESPONSE_HOURS, VALID_CANONICAL_PHONE_REGEX } from "./dashboardAnalysis.js";
import { sqlStalledStageCondition } from "./leadReactivationEngine.js";
import { sqlRunPerson, sqlRunRepliedWithinWindow } from "./messageEffectiveness.js";

const MSG_TS = "COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at)";
const iso = (d) => (d instanceof Date ? d.toISOString() : String(d));
const int = (v) => Number(v) || 0;

// Cortes de cobertura do tempo de primeira resposta (decisão do dono, 11/11/2026).
export const COVERAGE_OK_PCT = 80;
export const COVERAGE_MIN_PCT = 50;

// ── 1. Situação da base: cinco fatias, cada lead em uma só ────────────────
//
// Ordem das regras (a primeira que casa decide):
//   telefone inválido          → não passa em VALID_CANONICAL_PHONE_REGEX (inclui o fabricado "5500…")
//   em conversa                → válido e a pessoa já escreveu para a empresa
//   sem resposta               → válido, nunca escreveu, e já recebeu envio
//   nunca abordados            → válido, nunca escreveu, nunca recebeu envio, estágio aberto
//   encerrados sem abordagem   → o mesmo, com estágio fechado
//
// Quem escreveu e nunca foi respondido NÃO é "nunca abordado": tem mensagem de entrada, cai em
// "em conversa" e é assunto da fila de quem espera resposta. Campanha nunca é oferecida para ele.
//
// O telefone do LEAD é comparado como está gravado (já canônico). A expressão canônica, que é cara, roda só
// nas mensagens e nos envios, uma vez cada, em conjuntos materializados. Aplicá-la nos leads custava de 10 a
// 12 s na maior base (80 mil leads). Telefone de lead fora do padrão não casa com o regex e cai em
// "telefone inválido": o erro possível é conservador, nunca oferece campanha para número torto.
//
// Opt-out tem duas fontes que não se conversam (campaign/queueOptOut.js): a flag do lead e a tabela
// lead_optouts. `optout_recorded` diz quantos opt-outs a empresa TEM gravados; a tela usa isso para não
// afirmar que descontou alguém quando nada é registrado.
export function buildBaseSlicesSql() {
  return `
    WITH msg AS MATERIALIZED (
      SELECT ${SQL_CANONICAL_PHONE("lm.phone")} AS cphone,
             bool_or(lm.direction = 'outbound') AS teve_saida,
             bool_or(lm.direction = 'inbound' OR lm.engagement_signal = 'reply') AS teve_entrada
      FROM public.lead_messages lm
      WHERE lm.client_id = $1
        AND lm.phone IS NOT NULL AND lm.phone <> ''
        AND lm.is_group IS NOT TRUE
        AND ${MSG_TS} < $2
      GROUP BY 1
    ),
    sent_runs AS MATERIALIZED (
      SELECT ${SQL_CANONICAL_PHONE("r.phone")} AS cphone
      FROM public.campaign_dispatch_runs r
      WHERE r.client_id = $1 AND r.status = 'sent' AND r.phone <> '' AND r.sent_at IS NOT NULL AND r.sent_at < $2
      GROUP BY 1
    ),
    optout AS MATERIALIZED (
      SELECT ${SQL_CANONICAL_PHONE("o.phone")} AS cphone
      FROM public.lead_optouts o
      WHERE o.client_id::text = $1 AND COALESCE(o.phone, '') <> ''
      GROUP BY 1
    ),
    f AS (
      SELECT b.tel,
             b.estagio_aberto,
             b.opt_flag,
             COALESCE(b.tel ~ '${VALID_CANONICAL_PHONE_REGEX}', false) AS valido,
             (COALESCE(m.teve_saida, false) OR s.cphone IS NOT NULL) AS com_envio,
             COALESCE(m.teve_entrada, false) AS com_entrada,
             (o.cphone IS NOT NULL) AS opt_tabela
      FROM (
        SELECT COALESCE(l.telefone, l.phone) AS tel,
               (${sqlStalledStageCondition("l")}) AS estagio_aberto,
               COALESCE(l.opt_out IS TRUE OR l.metadata->>'opt_out' = 'true' OR l.dados->>'opt_out' = 'true', false) AS opt_flag
        FROM public.leads l
        WHERE l.client_id = $1 AND l.created_at < $2
      ) b
      LEFT JOIN msg m ON m.cphone = b.tel
      LEFT JOIN sent_runs s ON s.cphone = b.tel
      LEFT JOIN optout o ON o.cphone = b.tel
    )
    SELECT
      COUNT(*)::int AS base_total,
      COUNT(*) FILTER (WHERE NOT valido)::int AS slice_invalid_phone,
      COUNT(*) FILTER (WHERE valido AND com_entrada)::int AS slice_in_conversation,
      COUNT(*) FILTER (WHERE valido AND NOT com_entrada AND com_envio)::int AS slice_no_reply,
      COUNT(*) FILTER (WHERE valido AND NOT com_entrada AND NOT com_envio AND estagio_aberto)::int AS slice_never_approached,
      COUNT(*) FILTER (WHERE valido AND NOT com_entrada AND NOT com_envio AND NOT estagio_aberto)::int AS slice_closed_no_approach,
      COUNT(DISTINCT tel) FILTER (WHERE valido AND NOT com_entrada AND NOT com_envio AND estagio_aberto)::int AS never_approached_phones,
      COUNT(DISTINCT tel) FILTER (
        WHERE valido AND NOT com_entrada AND NOT com_envio AND estagio_aberto AND NOT (opt_flag OR opt_tabela)
      )::int AS reachable_phones,
      COUNT(DISTINCT tel) FILTER (
        WHERE valido AND NOT com_entrada AND NOT com_envio AND estagio_aberto AND (opt_flag OR opt_tabela)
      )::int AS optout_discounted_phones,
      (COUNT(*) FILTER (WHERE opt_flag) + (SELECT COUNT(*) FROM optout))::int AS optout_recorded
    FROM f;
  `;
}

export function buildBaseSlicesResult(row) {
  const total = int(row?.base_total);
  const slices = {
    invalidPhone: int(row?.slice_invalid_phone),
    inConversation: int(row?.slice_in_conversation),
    noReply: int(row?.slice_no_reply),
    neverApproached: int(row?.slice_never_approached),
    closedNoApproach: int(row?.slice_closed_no_approach),
  };
  const reachable = int(row?.reachable_phones);
  return {
    total,
    slices,
    // As cinco fatias somam a base. Se um dia não somarem, a tela mostra o aviso em vez de uma barra torta.
    slicesAddUp: Object.values(slices).reduce((a, b) => a + b, 0) === total,
    neverApproached: {
      // Número do cartão: telefones distintos que dá para abordar (sem quem pediu para sair).
      reachable,
      // Detalhe: todos os nunca abordados, em telefones distintos e em leads.
      totalPhones: int(row?.never_approached_phones),
      totalLeads: slices.neverApproached,
      optOutDiscounted: int(row?.optout_discounted_phones),
      // false = a empresa não tem NENHUM opt-out gravado: o cartão diz "opt-out não é registrado".
      optOutRecorded: int(row?.optout_recorded) > 0,
      shareOfBasePct: total > 0 ? Number(((slices.neverApproached / total) * 100).toFixed(1)) : null,
    },
  };
}

// Base de leads ATÉ o fim do período (asOf): o mesmo recorte de measureBaseHealth.
export async function measureBaseSlices(pool, { clientId, currentEnd, asOf = currentEnd }) {
  const { rows } = await pool.query(buildBaseSlicesSql(), [clientId, iso(asOf)]);
  return buildBaseSlicesResult(rows[0]);
}

// ── 2. Reunião: o Dashboard só LÊ followup_schedules ──────────────────────
//
// Conta PESSOAS que marcaram no período (created_at), sem cancelada e sem linha sem telefone.
// Link de agenda de consultor (crm_consultant_schedules) não é reunião e não entra.
// hasRecords = a empresa tem alguma linha, em qualquer data. Sem linha nenhuma a tela diz "sem registro";
// zero só quando há registro e nenhum caiu no período.
const MEETING_VALID_SQL = (alias = "fs") =>
  `COALESCE(${alias}.status, '') NOT IN ('canceled', 'missing_phone') AND COALESCE(${alias}.phone, '') <> ''`;

export function buildMeetingsSql() {
  const person = SQL_CANONICAL_PHONE("fs.phone");
  return `
    SELECT
      EXISTS (
        SELECT 1 FROM public.followup_schedules x
        JOIN public.followup_companies xc ON xc.id = x.company_id
        WHERE xc.tenant_id::text = $1
      ) AS has_records,
      COUNT(DISTINCT ${person}) FILTER (WHERE fs.created_at >= $2 AND fs.created_at < $3)::int AS meetings_people_current,
      COUNT(DISTINCT ${person}) FILTER (WHERE fs.created_at >= $4 AND fs.created_at < $5)::int AS meetings_people_previous
    FROM public.followup_schedules fs
    JOIN public.followup_companies fc ON fc.id = fs.company_id
    WHERE fc.tenant_id::text = $1
      AND ${MEETING_VALID_SQL("fs")}
      AND fs.created_at >= LEAST($2::timestamptz, $4::timestamptz) AND fs.created_at < GREATEST($3::timestamptz, $5::timestamptz);
  `;
}

export function buildMeetingsResult(row) {
  const hasRecords = row?.has_records === true;
  return {
    hasRecords,
    current: hasRecords ? int(row?.meetings_people_current) : null,
    previous: hasRecords ? int(row?.meetings_people_previous) : null,
  };
}

export async function measureMeetings(pool, { clientId, currentStart, currentEnd, previousStart, previousEnd }) {
  const { rows } = await pool.query(buildMeetingsSql(), [
    clientId,
    iso(currentStart),
    iso(currentEnd),
    iso(previousStart),
    iso(previousEnd),
  ]);
  return buildMeetingsResult(rows[0]);
}

// ── 3. Funil de coorte: quem respondeu a campanha E marcou reunião depois ─
//
// "Marcaram reunião" do funil é subconjunto de "Responderam": mesma pessoa (telefone canônico), reunião
// criada depois do primeiro envio respondido do período. Assim a barra é proporção real de quem recebeu e
// uma etapa nunca sai maior que a anterior. Reunião de quem não recebeu campanha não entra aqui: ela conta
// em measureMeetings ("reuniões no período"), que é outro número, com outro nome.
export function buildFunnelMeetingsSql() {
  return `
    WITH valid_runs AS (
      SELECT ${sqlRunPerson("r")} AS person,
             r.sent_at,
             (r.sent_at >= $2 AND r.sent_at < $3) AS is_current,
             ${sqlRunRepliedWithinWindow("r")} AS replied
      FROM public.campaign_dispatch_runs r
      WHERE r.client_id = $1
        AND r.status = 'sent'
        AND r.phone <> ''
        AND r.sent_at IS NOT NULL
        AND ((r.sent_at >= $2 AND r.sent_at < $3) OR (r.sent_at >= $4 AND r.sent_at < $5))
    ),
    responders AS (
      SELECT person, is_current, MIN(sent_at) AS first_sent
      FROM valid_runs
      WHERE replied
      GROUP BY person, is_current
    ),
    meetings AS MATERIALIZED (
      SELECT ${SQL_CANONICAL_PHONE("fs.phone")} AS person, fs.created_at
      FROM public.followup_schedules fs
      JOIN public.followup_companies fc ON fc.id = fs.company_id
      WHERE fc.tenant_id::text = $1 AND ${MEETING_VALID_SQL("fs")}
    )
    SELECT
      COUNT(DISTINCT p.person) FILTER (WHERE p.is_current)::int AS funnel_meetings_current,
      COUNT(DISTINCT p.person) FILTER (WHERE NOT p.is_current)::int AS funnel_meetings_previous
    FROM responders p
    WHERE EXISTS (SELECT 1 FROM meetings m WHERE m.person = p.person AND m.created_at > p.first_sent);
  `;
}

export async function measureFunnelMeetings(pool, { clientId, currentStart, currentEnd, previousStart, previousEnd }) {
  const { rows } = await pool.query(buildFunnelMeetingsSql(), [
    clientId,
    iso(currentStart),
    iso(currentEnd),
    iso(previousStart),
    iso(previousEnd),
  ]);
  return { current: int(rows[0]?.funnel_meetings_current), previous: int(rows[0]?.funnel_meetings_previous) };
}

// ── 4. Tempo até a primeira resposta humana, com cobertura ────────────────
//
// Conversa = telefone cuja primeira mensagem de entrada do período cai no período (as M conversas).
// Humano = 'device' (digitado no celular) + 'agent' (enviado pela tela do CRM). 'bot' é robô e campanha.
// 'user' é gravado só pelo importador de histórico (services/evolution.js): quer dizer "saiu do nosso
// número", sem dizer se foi gente ou robô. Conversa cuja única saída depois da entrada é 'user' (ou de tipo
// desconhecido) fica INDETERMINADA: fora do numerador e do denominador. N = M − indeterminadas.
// O cartão mostra "medido em N de M". Mediana e p90 saem só das respondidas.
export function buildFirstHumanResponseCoverageSql() {
  return `
    WITH m AS (
      SELECT ${SQL_CANONICAL_PHONE("lm.phone")} AS cphone, lm.direction, lm.sender_type, ${MSG_TS} AS ts
      FROM public.lead_messages lm
      WHERE lm.client_id = $1
        AND lm.phone IS NOT NULL AND lm.phone <> ''
        AND lm.is_group IS NOT TRUE
        AND ${MSG_TS} >= $2
    ),
    first_in AS (
      SELECT cphone, MIN(ts) AS in_at
      FROM m
      WHERE direction = 'inbound' AND ts >= $2 AND ts < $3
      GROUP BY cphone
    ),
    c AS (
      SELECT fi.cphone, fi.in_at,
             MIN(o.ts) FILTER (WHERE o.sender_type IN ('agent', 'device')) AS human_at,
             MIN(o.ts) FILTER (WHERE o.sender_type = 'bot') AS bot_at,
             MIN(o.ts) FILTER (WHERE o.sender_type IS NULL OR o.sender_type NOT IN ('agent', 'device', 'bot')) AS unknown_at
      FROM first_in fi
      LEFT JOIN m o ON o.cphone = fi.cphone AND o.direction = 'outbound' AND o.ts > fi.in_at
      GROUP BY fi.cphone, fi.in_at
    )
    SELECT
      COUNT(*)::int AS coverage_conversations,
      COUNT(*) FILTER (WHERE human_at IS NOT NULL)::int AS coverage_answered,
      COUNT(*) FILTER (WHERE human_at IS NULL AND unknown_at IS NULL)::int AS coverage_waiting,
      COUNT(*) FILTER (WHERE human_at IS NULL AND unknown_at IS NULL AND bot_at IS NOT NULL)::int AS coverage_waiting_bot_only,
      COUNT(*) FILTER (WHERE human_at IS NULL AND unknown_at IS NOT NULL)::int AS coverage_indeterminate,
      COUNT(*) FILTER (WHERE human_at IS NOT NULL AND unknown_at IS NOT NULL AND unknown_at < human_at)::int AS coverage_answered_unknown_first,
      COUNT(*) FILTER (
        WHERE human_at IS NULL AND unknown_at IS NULL
          AND in_at < $4::timestamptz - make_interval(hours => ${SLOW_FIRST_RESPONSE_HOURS})
      )::int AS coverage_waiting_over_threshold,
      -- Faixas de espera de quem FOI respondido por gente. As quatro somam coverage_answered.
      COUNT(*) FILTER (WHERE human_at IS NOT NULL AND human_at - in_at <= interval '10 minutes')::int AS coverage_bucket_10m,
      COUNT(*) FILTER (
        WHERE human_at IS NOT NULL AND human_at - in_at > interval '10 minutes' AND human_at - in_at <= interval '30 minutes'
      )::int AS coverage_bucket_30m,
      COUNT(*) FILTER (
        WHERE human_at IS NOT NULL AND human_at - in_at > interval '30 minutes' AND human_at - in_at <= interval '2 hours'
      )::int AS coverage_bucket_2h,
      COUNT(*) FILTER (WHERE human_at IS NOT NULL AND human_at - in_at > interval '2 hours')::int AS coverage_bucket_over_2h,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (human_at - in_at)) / 60.0)
        FILTER (WHERE human_at IS NOT NULL))::float AS coverage_median_min,
      (percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (human_at - in_at)) / 60.0)
        FILTER (WHERE human_at IS NOT NULL))::float AS coverage_p90_min
    FROM c;
  `;
}

export function coverageLevel(coveragePct) {
  if (coveragePct === null || coveragePct === undefined) return "none";
  if (coveragePct >= COVERAGE_OK_PCT) return "ok";
  if (coveragePct >= COVERAGE_MIN_PCT) return "partial";
  return "insufficient";
}

export function buildFirstHumanResponseCoverageResult(row) {
  const conversations = int(row?.coverage_conversations);
  const indeterminate = int(row?.coverage_indeterminate);
  const measured = conversations - indeterminate;
  const answered = int(row?.coverage_answered);
  const coveragePct = conversations > 0 ? Number(((measured / conversations) * 100).toFixed(1)) : null;
  const num = (v) => (v === null || v === undefined ? null : Number(Number(v).toFixed(1)));
  return {
    conversations,
    measured,
    indeterminate,
    coveragePct,
    coverageLevel: coverageLevel(coveragePct),
    answered,
    waiting: int(row?.coverage_waiting),
    waitingBotOnly: int(row?.coverage_waiting_bot_only),
    waitingOverThreshold: int(row?.coverage_waiting_over_threshold),
    answeredWithUnknownBefore: int(row?.coverage_answered_unknown_first),
    thresholdHours: SLOW_FIRST_RESPONSE_HOURS,
    // Quanto as pessoas esperaram pela primeira resposta de gente. Soma = answered.
    waitBuckets: {
      upTo10m: int(row?.coverage_bucket_10m),
      upTo30m: int(row?.coverage_bucket_30m),
      upTo2h: int(row?.coverage_bucket_2h),
      over2h: int(row?.coverage_bucket_over_2h),
    },
    medianMinutes: answered > 0 ? num(row?.coverage_median_min) : null,
    p90Minutes: answered > 0 ? num(row?.coverage_p90_min) : null,
  };
}

export async function measureFirstHumanResponseCoverage(pool, { clientId, currentStart, currentEnd, now = currentEnd }) {
  const { rows } = await pool.query(buildFirstHumanResponseCoverageSql(), [
    clientId,
    iso(currentStart),
    iso(currentEnd),
    iso(now),
  ]);
  return buildFirstHumanResponseCoverageResult(rows[0]);
}

// ── 5. "Pessoas esperam resposta": depende da tela Conversas ──────────────
//
// A fila de quem espera resposta é da tela Conversas, e o Dashboard NÃO escreve uma segunda consulta para
// o mesmo fato. Enquanto a consulta de lá não estiver no main, este bloco devolve "pending_source" e a tela
// mostra o lugar reservado.
//
// Contrato para ligar sozinho: quando services/inboxWorkState.js exportar
//   countWaitingForDashboard(pool, { clientId, now }) → { waiting, waitingOverThreshold }
// este bloco passa a devolver o número, sem mudança aqui. Qualquer outra forma (arquivo ausente, função
// ausente, retorno fora do contrato) continua "pending_source": nunca um número adivinhado.
export const WAITING_SOURCE_MODULE = "./inboxWorkState.js";

async function defaultLoadWaitingSource() {
  try {
    const mod = await import(/* @vite-ignore */ WAITING_SOURCE_MODULE);
    return typeof mod?.countWaitingForDashboard === "function" ? mod.countWaitingForDashboard : null;
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" || /Cannot find module|Failed to load url|Does the file exist/i.test(String(err?.message))) return null;
    throw err;
  }
}

const isCount = (v) => Number.isInteger(v) && v >= 0;

export async function measureWaiting(pool, { clientId, now }, { loadSource = defaultLoadWaitingSource } = {}) {
  const count = await loadSource();
  if (!count) return { status: "pending_source" };
  const result = await count(pool, { clientId, now });
  if (!isCount(result?.waiting)) return { status: "pending_source" };
  return {
    status: "ready",
    waiting: result.waiting,
    waitingOverThreshold: isCount(result.waitingOverThreshold) ? result.waitingOverThreshold : null,
    thresholdHours: SLOW_FIRST_RESPONSE_HOURS,
  };
}

// ── Aba Atendimento: a fila da tela Conversas, em detalhe ─────────────────
// Não existe segunda conta. Os quatro estados e a lista de quem espera há mais tempo saem das MESMAS
// funções que a tela Conversas usa (contadores da coluna e página da aba "Esperam você"), com o mesmo
// teto de tempo. O Dashboard só escolhe quantas linhas mostrar.
export const QUEUE_OLDEST_LIMIT = 5;

export async function measureQueue(pool, { clientId, now }, { loadModule = () => import("./inboxWorkState.js"), deps = {} } = {}) {
  const queue = await loadModule();
  const { pauseExpiredSql, robotInfo } = await queue.loadWorkStateContext(pool, clientId, deps);
  const options = { clientId, now, robotChips: robotInfo.robotChips, chipAliases: null, pauseExpiredSql };
  const run = async (query) => {
    const counts = await queue.fetchInboxCounts(query, options);
    const oldest =
      counts.work.esperam > 0
        ? await queue.fetchWorkStatePage(query, { ...options, state: "esperam", limit: QUEUE_OLDEST_LIMIT, offset: 0 })
        : [];
    return { counts, oldest };
  };
  const { counts, oldest } =
    typeof pool?.connect === "function"
      ? await queue.withStatementTimeout(pool, queue.WORK_STATE_QUERY_TIMEOUT_MS, run)
      : await run((sql, params) => pool.query(sql, params));
  return {
    states: {
      waiting: int(counts.work.esperam),
      withLead: int(counts.work.com_lead),
      withRobot: int(counts.work.robo),
      cooled: int(counts.work.esfriaram),
    },
    waitingOverThreshold: int(counts.waitingOverThreshold),
    thresholdHours: queue.WAITING_THRESHOLD_HOURS,
    // Quem espera há mais tempo, na ordem da própria aba. Nome do lead quando existe; senão o do contato.
    oldest: oldest.map((row) => ({
      phone: row.phone_number,
      name: row.lead_name || row.contact_name || row.profile_name || null,
      chip: row.lead_chip || null,
      waitingSince: row.last_in_at ? iso(row.last_in_at instanceof Date ? row.last_in_at : new Date(row.last_in_at)) : null,
    })),
  };
}
