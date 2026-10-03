// backend/src/services/dashboardAnalysis.js
//
// Dashboard Fase 1.5 — medidas que têm dado no banco hoje e ficaram de fora da Fase 1:
//   1. leadClassification  — leads do período por temperatura e por estágio
//   2. firstReplyOnly      — responderam só o primeiro passo e pararam
//   3. closings            — fechamentos (lead_conversions ganhas)
//   4. topProfiles         — perfil (temperatura × origem) que mais converteu
//   5. baseHealth          — saúde da base (telefone válido / nunca abordado / sem resposta há 90 dias)
//   6. firstHumanResponse  — tempo até a primeira resposta humana
//
// Só dado que já existe. Cada função aqui é um BLOCO: quem chama (calculateDashboardMetrics)
// roda cada uma isolada — se uma cair, vira `null` + nome em unavailableBlocks, nunca zero.

import { SQL_CANONICAL_PHONE } from "./canonicalPhone.js";
import { SQL_LEAD_TEMPERATURE_BUCKET } from "./leadTemperature.js";

// Perfil só entra no ranking com volume mínimo (mesma regra 6 dos rankings da Fase 1).
export const PROFILE_MIN_LEADS = 30;
// "Sem resposta há mais de noventa dias" / "esperando três horas".
export const BASE_SILENCE_DAYS = 90;
export const SLOW_FIRST_RESPONSE_HOURS = 3;
// Mesma lista de normalizeWonStatus (commercial-intelligence.js / analytics.js).
export const WON_CONVERSION_STATUSES = ["won", "closed_won", "convertido", "converted"];

export const TEMPERATURE_KEYS = ["QUENTE", "MORNO", "FRIO", "SEM_CLASSIFICACAO"];

const MSG_TS = "COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at)";
const WON_SQL_LIST = WON_CONVERSION_STATUSES.map((s) => `'${s}'`).join(", ");

// Telefone canônico brasileiro válido: 55 + DDD (sem zero) + celular de 9 dígitos começando em 9
// OU fixo de 8 dígitos começando em 2–5. Número fabricado (DDD 00, "5500…") e LID (@lid) ficam de fora.
export const VALID_CANONICAL_PHONE_REGEX = "^55[1-9]{2}(9[0-9]{8}|[2-5][0-9]{7})$";

const iso = (d) => (d instanceof Date ? d.toISOString() : String(d));

// ── 1. Leads do período por temperatura e estágio ────────────────────────
// 'warm' em leads.temperature é DEFAULT da coluna, não classificação: o bucket canônico
// (SQL_LEAD_TEMPERATURE_BUCKET) lê lead_temperature primeiro e trata 'warm' como sem classificação.
export function foldLeadClassification(rows) {
  const byTemperature = Object.fromEntries(TEMPERATURE_KEYS.map((k) => [k, 0]));
  const stageCounts = new Map();
  let total = 0;
  for (const row of rows) {
    const leads = Number(row.leads) || 0;
    const key = TEMPERATURE_KEYS.includes(row.temperature) ? row.temperature : "SEM_CLASSIFICACAO";
    byTemperature[key] += leads;
    stageCounts.set(row.stage, (stageCounts.get(row.stage) || 0) + leads);
    total += leads;
  }
  const byStage = [...stageCounts.entries()]
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage));
  return { total, byTemperature, byStage };
}

export async function measureLeadClassification(pool, { clientId, currentStart, currentEnd }) {
  const { rows } = await pool.query(
    `
      SELECT
        COALESCE(${SQL_LEAD_TEMPERATURE_BUCKET("l")}, 'SEM_CLASSIFICACAO') AS temperature,
        COALESCE(NULLIF(TRIM(l.stage), ''), 'sem_estagio') AS stage,
        COUNT(*)::int AS leads
      FROM public.leads l
      WHERE l.client_id = $1
        AND l.created_at >= $2 AND l.created_at < $3
      GROUP BY 1, 2;
    `,
    [clientId, iso(currentStart), iso(currentEnd)]
  );
  return foldLeadClassification(rows);
}

// ── 2. Responderam só o primeiro passo e pararam ─────────────────────────
// Leads cujo PRIMEIRO envio de campanha caiu no período. Dos que responderam a ele:
//   - receivedFollowUp: receberam outro envio de campanha depois de responder;
//   - stoppedAfterFirst: receberam e não responderam mais nada depois desse envio.
// Separa interesse de curiosidade: quem para depois do primeiro "oi" respondido.
export function buildFirstReplyOnlyResult(row) {
  const repliedFirst = Number(row?.replied_first) || 0;
  const receivedFollowUp = Number(row?.received_follow_up) || 0;
  const stoppedAfterFirst = Number(row?.stopped_after_first) || 0;
  return {
    repliedFirst,
    receivedFollowUp,
    stoppedAfterFirst,
    // Taxa só existe se alguém recebeu o passo seguinte — sem isso não há o que medir (null, não 0%).
    stoppedRate: receivedFollowUp > 0 ? Number(((stoppedAfterFirst / receivedFollowUp) * 100).toFixed(1)) : null,
  };
}

export async function measureFirstReplyOnly(pool, { clientId, currentStart, currentEnd }) {
  const { rows } = await pool.query(
    `
      WITH camp_msgs AS (
        SELECT ${SQL_CANONICAL_PHONE("lm.phone")} AS cphone, lm.direction, ${MSG_TS} AS ts
        FROM public.lead_messages lm
        WHERE lm.client_id = $1
          AND lm.phone IS NOT NULL AND lm.phone <> ''
          AND lm.is_group IS NOT TRUE
          AND (lm.direction = 'inbound' OR lm.campaign_id IS NOT NULL)
      ),
      first_out AS (
        SELECT cphone, MIN(ts) AS out1
        FROM camp_msgs
        WHERE direction = 'outbound'
        GROUP BY cphone
        HAVING MIN(ts) >= $2 AND MIN(ts) < $3
      ),
      first_reply AS (
        SELECT f.cphone, f.out1, MIN(m.ts) AS reply1
        FROM first_out f
        JOIN camp_msgs m ON m.cphone = f.cphone AND m.direction = 'inbound' AND m.ts > f.out1
        GROUP BY f.cphone, f.out1
      ),
      follow AS (
        SELECT
          r.cphone,
          (SELECT MIN(m.ts) FROM camp_msgs m
            WHERE m.cphone = r.cphone AND m.direction = 'outbound' AND m.ts > r.reply1) AS out2
        FROM first_reply r
      )
      SELECT
        COUNT(*)::int AS replied_first,
        COUNT(*) FILTER (WHERE out2 IS NOT NULL)::int AS received_follow_up,
        COUNT(*) FILTER (
          WHERE out2 IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM camp_msgs m
              WHERE m.cphone = follow.cphone AND m.direction = 'inbound' AND m.ts > follow.out2
            )
        )::int AS stopped_after_first
      FROM follow;
    `,
    [clientId, iso(currentStart), iso(currentEnd)]
  );
  return buildFirstReplyOnlyResult(rows[0]);
}

// ── Disponibilidade das conversões (UMA verificação, consultada pelos blocos que dependem dela) ──
// Fechamentos e "Perfil que mais converteu" leem a mesma tabela, lead_conversions. Tabela inexistente
// = "este cliente não usa o recurso" (não é erro): Fechamentos não se aplica e o Perfil segue sem a
// coluna de fechamentos. A regra mora AQUI, uma vez; quem decide é `conversionsAvailable` no contexto.
// Se a própria verificação falhar (conexão, permissão), devolve true: o dado é desconhecido, então
// os blocos rodam e falham à vista em vez de esconder o problema como "não usa".
export async function checkConversionsAvailable(pool) {
  try {
    const { rows } = await pool.query("SELECT to_regclass('public.lead_conversions') IS NOT NULL AS available");
    return rows[0]?.available !== false;
  } catch {
    return true;
  }
}

// ── 3. Fechamentos ───────────────────────────────────────────────────────
// Sem a tabela de conversões (cliente não usa): null = "não se aplica" (nem zero, nem indisponível).
export async function measureClosings(pool, { clientId, currentStart, currentEnd, previousStart, previousEnd, conversionsAvailable = true }) {
  if (!conversionsAvailable) return null;
  const { rows } = await pool.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE COALESCE(c.closed_at, c.updated_at) >= $2 AND COALESCE(c.closed_at, c.updated_at) < $3)::int AS current_closings,
        COUNT(*) FILTER (WHERE COALESCE(c.closed_at, c.updated_at) >= $4 AND COALESCE(c.closed_at, c.updated_at) < $5)::int AS previous_closings
      FROM public.lead_conversions c
      WHERE c.client_id = $1
        AND lower(c.conversion_status) IN (${WON_SQL_LIST});
    `,
    [clientId, iso(currentStart), iso(currentEnd), iso(previousStart), iso(previousEnd)]
  );
  return { current: rows[0]?.current_closings || 0, previous: rows[0]?.previous_closings || 0 };
}

// ── 4. Perfil que mais converteu (temperatura × origem) ──────────────────
// Coorte: leads criados no período. Para cada grupo (temperatura, origem): quantos responderam,
// quantos agendaram (followup_schedules não cancelado, por telefone) e quantos fecharam
// (lead_conversions ganha). Só grupos com volume mínimo; ordem: fechou, agendou, respondeu (taxas).
const rate = (n, d) => (d > 0 ? Number(((n / d) * 100).toFixed(1)) : 0);

// `withClosings` = false quando o cliente não tem a tabela de conversões: `closed` e `closeRate` ficam
// null (não zero) e a ordem passa a ser agendou → respondeu. O ranking não some por faltar uma coluna.
export function rankProfiles(rows, minLeads = PROFILE_MIN_LEADS, { withClosings = true } = {}) {
  const eligible = rows
    .map((r) => {
      const leads = Number(r.leads) || 0;
      const replied = Number(r.replied) || 0;
      const scheduled = Number(r.scheduled) || 0;
      const closed = Number(r.closed) || 0;
      return {
        temperature: TEMPERATURE_KEYS.includes(r.temperature) ? r.temperature : "SEM_CLASSIFICACAO",
        origin: r.origin,
        leads,
        replied,
        scheduled,
        closed: withClosings ? closed : null,
        replyRate: rate(replied, leads),
        scheduleRate: rate(scheduled, leads),
        closeRate: withClosings ? rate(closed, leads) : null,
      };
    })
    .filter((p) => p.leads >= minLeads);
  eligible.sort(
    (a, b) =>
      (withClosings ? b.closeRate - a.closeRate : 0) ||
      b.scheduleRate - a.scheduleRate ||
      b.replyRate - a.replyRate ||
      b.leads - a.leads
  );
  return { minLeads, eligibleGroups: eligible.length, top: eligible.slice(0, 3), closingsAvailable: withClosings };
}

export async function measureTopProfiles(pool, { clientId, currentStart, currentEnd, conversionsAvailable = true }) {
  // Sem lead_conversions a consulta nem referencia a tabela: a coluna de fechamentos vira 0 só no SQL
  // e rankProfiles a trata como ausente (null).
  const closedSql = conversionsAvailable
    ? `COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM public.lead_conversions lc
          WHERE lc.client_id = $1
            AND lc.lead_id = c.id
            AND lower(lc.conversion_status) IN (${WON_SQL_LIST})
        ))::int AS closed`
    : "0::int AS closed";
  const { rows } = await pool.query(
    `
      WITH cohort AS (
        SELECT
          l.id,
          COALESCE(${SQL_LEAD_TEMPERATURE_BUCKET("l")}, 'SEM_CLASSIFICACAO') AS temperature,
          COALESCE(NULLIF(TRIM(l.lead_origin), ''), 'sem_origem') AS origin,
          ${SQL_CANONICAL_PHONE("COALESCE(l.telefone, l.phone)")} AS cphone
        FROM public.leads l
        WHERE l.client_id = $1
          AND l.created_at >= $2 AND l.created_at < $3
      )
      SELECT
        c.temperature,
        c.origin,
        COUNT(*)::int AS leads,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM public.lead_messages lm
          WHERE lm.client_id = $1
            AND lm.phone IS NOT NULL AND lm.phone <> ''
            AND (lm.direction = 'inbound' OR lm.engagement_signal = 'reply')
            AND ${SQL_CANONICAL_PHONE("lm.phone")} = c.cphone
        ))::int AS replied,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1
          FROM public.followup_schedules fs
          JOIN public.followup_companies fc ON fc.id = fs.company_id
          WHERE fc.tenant_id::text = $1
            AND fs.status <> 'canceled'
            AND fs.phone IS NOT NULL AND fs.phone <> ''
            AND ${SQL_CANONICAL_PHONE("fs.phone")} = c.cphone
        ))::int AS scheduled,
        ${closedSql}
      FROM cohort c
      GROUP BY c.temperature, c.origin;
    `,
    [clientId, iso(currentStart), iso(currentEnd)]
  );
  return rankProfiles(rows, PROFILE_MIN_LEADS, { withClosings: conversionsAvailable });
}

// ── 5. Saúde da base ─────────────────────────────────────────────────────
export function buildBaseHealthResult(row) {
  const total = Number(row?.total) || 0;
  return {
    total,
    validPhone: Number(row?.valid_phone) || 0,
    invalidPhone: total - (Number(row?.valid_phone) || 0),
    neverApproached: Number(row?.never_approached) || 0,
    noReplyOverDays: Number(row?.no_reply_over_days) || 0,
    silenceDays: BASE_SILENCE_DAYS,
  };
}

// Base de leads ATÉ o fim do período (asOf): leads criados depois, mensagens e envios posteriores não entram.
export async function measureBaseHealth(pool, { clientId, currentEnd, asOf = currentEnd }) {
  const { rows } = await pool.query(
    `
      WITH base AS (
        SELECT l.id, ${SQL_CANONICAL_PHONE("COALESCE(l.telefone, l.phone)")} AS cphone
        FROM public.leads l
        WHERE l.client_id = $1 AND l.created_at < $2
      ),
      msg AS (
        SELECT
          ${SQL_CANONICAL_PHONE("lm.phone")} AS cphone,
          MIN(${MSG_TS}) FILTER (WHERE lm.direction = 'outbound') AS first_out,
          MAX(${MSG_TS}) FILTER (WHERE lm.direction = 'inbound' OR lm.engagement_signal = 'reply') AS last_in
        FROM public.lead_messages lm
        WHERE lm.client_id = $1
          AND lm.phone IS NOT NULL AND lm.phone <> ''
          AND lm.is_group IS NOT TRUE
          AND ${MSG_TS} < $2
        GROUP BY 1
      ),
      sent_runs AS (
        SELECT ${SQL_CANONICAL_PHONE("r.phone")} AS cphone, MIN(r.sent_at) AS first_sent
        FROM public.campaign_dispatch_runs r
        WHERE r.client_id = $1 AND r.status = 'sent' AND r.phone <> '' AND r.sent_at IS NOT NULL AND r.sent_at < $2
        GROUP BY 1
      ),
      flags AS (
        SELECT
          b.id,
          (b.cphone ~ '${VALID_CANONICAL_PHONE_REGEX}') AS valid,
          LEAST(m.first_out, s.first_sent) AS first_contact,
          m.last_in
        FROM base b
        LEFT JOIN msg m ON m.cphone = b.cphone
        LEFT JOIN sent_runs s ON s.cphone = b.cphone
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE valid)::int AS valid_phone,
        COUNT(*) FILTER (WHERE valid AND first_contact IS NULL)::int AS never_approached,
        COUNT(*) FILTER (
          WHERE valid
            AND first_contact IS NOT NULL
            AND first_contact < $2::timestamptz - make_interval(days => ${BASE_SILENCE_DAYS})
            AND (last_in IS NULL OR last_in < $2::timestamptz - make_interval(days => ${BASE_SILENCE_DAYS}))
        )::int AS no_reply_over_days
      FROM flags;
    `,
    [clientId, iso(asOf)]
  );
  return buildBaseHealthResult(rows[0]);
}

// ── 6. Tempo até a primeira resposta humana ──────────────────────────────
// Humano = mensagem de saída com sender_type 'agent' (atendente no CRM) ou 'device' (digitada no
// celular). 'bot' é robô e campanha — não conta. Por telefone: primeiro inbound do período e a
// primeira mensagem humana depois dele. Sem resposta humana ainda = "esperando"; esperando há mais
// de SLOW_FIRST_RESPONSE_HOURS = dinheiro saindo pela porta.
export function buildFirstHumanResponseResult(row) {
  const conversations = Number(row?.conversations) || 0;
  const answered = Number(row?.answered) || 0;
  const num = (v) => (v === null || v === undefined ? null : Number(Number(v).toFixed(1)));
  return {
    conversations,
    answered,
    waiting: Number(row?.waiting) || 0,
    waitingOverThreshold: Number(row?.waiting_over_threshold) || 0,
    thresholdHours: SLOW_FIRST_RESPONSE_HOURS,
    medianMinutes: answered > 0 ? num(row?.median_minutes) : null,
    p90Minutes: answered > 0 ? num(row?.p90_minutes) : null,
  };
}

// A resposta humana é buscada sem limite de data (a coorte é quem escreveu no período, mas o tempo
// de resposta real vale mesmo que venha depois); por isso "esperando há mais de X h" conta até AGORA.
export async function measureFirstHumanResponse(pool, { clientId, currentStart, currentEnd, now = currentEnd }) {
  const { rows } = await pool.query(
    `
      WITH m AS (
        SELECT ${SQL_CANONICAL_PHONE("lm.phone")} AS cphone, lm.direction, lm.sender_type, ${MSG_TS} AS ts
        FROM public.lead_messages lm
        WHERE lm.client_id = $1
          AND lm.phone IS NOT NULL AND lm.phone <> ''
          AND lm.is_group IS NOT TRUE
      ),
      first_in AS (
        SELECT cphone, MIN(ts) AS in_at
        FROM m
        WHERE direction = 'inbound' AND ts >= $2 AND ts < $3
        GROUP BY cphone
      ),
      answered AS (
        SELECT
          fi.cphone,
          fi.in_at,
          (SELECT MIN(m2.ts) FROM m m2
            WHERE m2.cphone = fi.cphone
              AND m2.direction = 'outbound'
              AND m2.sender_type IN ('agent', 'device')
              AND m2.ts > fi.in_at) AS human_at
        FROM first_in fi
      )
      SELECT
        COUNT(*)::int AS conversations,
        COUNT(human_at)::int AS answered,
        COUNT(*) FILTER (WHERE human_at IS NULL)::int AS waiting,
        COUNT(*) FILTER (
          WHERE human_at IS NULL
            AND in_at < $4::timestamptz - make_interval(hours => ${SLOW_FIRST_RESPONSE_HOURS})
        )::int AS waiting_over_threshold,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (human_at - in_at)) / 60.0)
          FILTER (WHERE human_at IS NOT NULL))::float AS median_minutes,
        (percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (human_at - in_at)) / 60.0)
          FILTER (WHERE human_at IS NOT NULL))::float AS p90_minutes
      FROM answered;
    `,
    [clientId, iso(currentStart), iso(currentEnd), iso(now)]
  );
  return buildFirstHumanResponseResult(rows[0]);
}
