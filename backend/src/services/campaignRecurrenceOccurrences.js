// Ocorrências de campanha recorrente pelo caminho da fila (campaign_dispatches).
//
// Cada ocorrência vira um LOTE NOVO em campaign_dispatches, que o agendador de 30 s (runDueIndependentDispatches)
// dispara como qualquer outro lote — janela de envio, cota de chip e retomada de pausa vêm de lá, sem segunda
// implementação. Lote novo por ocorrência é o que faz o excludeDispatchId do buildDispatchLeads trabalhar a favor:
// a ocorrência de novembro não herda os "já tocados" de outubro.
//
// Regras deste módulo:
//   - nunca empilhar: se a campanha tem lote em andamento quando a ocorrência vence, a ocorrência é PULADA e o
//     motivo fica em campaign_recurrence_occurrences (visível ao dono). O agendador ainda trava a campanha no claim
//     (findConcurrentRunningDispatch + índice único parcial) — esta é a primeira barreira, aquela a última.
//   - uma ocorrência por horário: o avanço de next_run_at, o lote e o registro saem num ÚNICO comando SQL, condicionado
//     a next_run_at ainda ser o horário vencido. Dois ticks concorrentes: um cria, o outro não acha a linha.
//   - fim declarado: por data (nenhuma ocorrência depois de recurrence_ends_at), por contagem (puladas não contam) ou
//     sem fim. Ao terminar, next_run_at vira NULL e recurrence_ended_at registra quando.
//   - fuso do tenant: o próximo horário é calculado no fuso da janela de envio do tenant.
//
// Só entra campanha com FIM DECLARADO (recurrence_end_type preenchido). As recorrentes criadas antes deste bloco
// (pilar 3, 08/10) têm o fim NULL e um next_run_at que nunca disparou: sem esta condição, o primeiro tick após o
// deploy enviaria todas de uma vez, sem o dono saber. Elas ficam paradas até o dono salvar de novo declarando o fim.
//
// Antes da migration 20261012120000 as colunas não existem: o módulo devolve schema_pending e não faz nada
// (o deploy pode subir o código antes do schema sem derrubar o agendador).

import { computeNextRecurrenceDate } from "./campaignRecurrence.js";
import { getPartsInTimezone } from "./sendWindow.js";

const MISSING_SCHEMA_CODES = new Set(["42703", "42P01"]); // undefined_column, undefined_table

function isMissingSchema(err) {
  return MISSING_SCHEMA_CODES.has(String(err?.code || ""));
}

const STATUS_PT = {
  running: "enviando",
  paused: "pausado (janela de envio ou cota do chip)",
  scheduled: "aguardando para começar",
};

function formatSlot(date, timezone) {
  const p = getPartsInTimezone(date, timezone);
  const dd = String(p.day).padStart(2, "0");
  const mm = String(p.month).padStart(2, "0");
  const hh = String(p.hour).padStart(2, "0");
  const mi = String(p.minute).padStart(2, "0");
  return `${dd}/${mm} às ${hh}:${mi}`;
}

export function buildSkippedBecauseRunningReason(activeDispatch) {
  const nome = activeDispatch?.name ? `"${activeDispatch.name}"` : "anterior";
  const estado = STATUS_PT[activeDispatch?.status] || activeDispatch?.status || "em andamento";
  return `Pulado: o envio ${nome} ainda estava ${estado} quando este venceu. Enviar os dois juntos mandaria mensagem dobrada para o mesmo cliente.`;
}

// Lote da mesma campanha que impede uma ocorrência nova: rodando, pausado (vai retomar) ou agendado e já vencido
// (esperando a janela abrir). Agendado para o futuro não impede — ainda não começou.
async function findActiveDispatchOfCampaign(pool, campaignId, slot) {
  const { rows } = await pool.query(
    `SELECT id, name, status
       FROM public.campaign_dispatches
      WHERE campaign_id = $1
        AND (status IN ('running', 'paused') OR (status = 'scheduled' AND scheduled_at <= $2::timestamptz))
      ORDER BY created_at ASC
      LIMIT 1`,
    [campaignId, slot]
  );
  return rows[0] || null;
}

/**
 * Outro lote da MESMA campanha em running que impede este de começar agora. A regra vale quando um dos dois é
 * ocorrência recorrente (público inteiro da campanha). Lotes manuais fatiados (offset) entre si seguem como hoje.
 * Antes da migration (coluna ausente) não existe ocorrência: devolve null.
 */
export async function findConcurrentRunningDispatch(pool, dispatchId) {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.status
         FROM public.campaign_dispatches me
         JOIN public.campaign_dispatches o
           ON o.campaign_id = me.campaign_id AND o.id <> me.id
        WHERE me.id = $1
          AND o.status = 'running'
          AND (me.recurrence_occurrence_at IS NOT NULL OR o.recurrence_occurrence_at IS NOT NULL)
        LIMIT 1`,
      [dispatchId]
    );
    return rows[0] || null;
  } catch (err) {
    if (isMissingSchema(err)) return null;
    throw err;
  }
}

/**
 * O lote é ocorrência de campanha recorrente? E qual o deslocamento da variação (ordem da ocorrência)?
 * Ocorrência não usa limite por envio: cobre o público inteiro, e a cota do chip é o freio.
 * Schema antigo (coluna ausente) = nenhum lote é ocorrência.
 */
export async function readOccurrenceInfo(pool, dispatchId) {
  try {
    const { rows } = await pool.query(
      `SELECT recurrence_occurrence_at, recurrence_variant_offset FROM public.campaign_dispatches WHERE id = $1`,
      [dispatchId]
    );
    const row = rows[0];
    const v = row?.recurrence_variant_offset;
    const occurrenceAt = row?.recurrence_occurrence_at
      ? (row.recurrence_occurrence_at instanceof Date
          ? row.recurrence_occurrence_at.toISOString()
          : new Date(row.recurrence_occurrence_at).toISOString())
      : null;
    return {
      isOccurrence: Boolean(row?.recurrence_occurrence_at),
      occurrenceAt,
      variantOffset: Number.isInteger(v) ? v : null,
    };
  } catch (err) {
    if (isMissingSchema(err)) return { isOccurrence: false, occurrenceAt: null, variantOffset: null };
    throw err;
  }
}

async function endRecurrence(pool, campaign, now) {
  const { rows } = await pool.query(
    `UPDATE public.campaigns
        SET next_run_at = NULL, recurrence_ended_at = $3::timestamptz
      WHERE id = $1 AND next_run_at = $2::timestamptz
      RETURNING id`,
    [campaign.id, campaign.next_run_at, now.toISOString()]
  );
  return rows.length > 0;
}

/**
 * Cria (ou pula, com motivo) as ocorrências vencidas das campanhas recorrentes.
 *
 * @param {object}   params
 * @param {object}   params.pool            pool pg (ou compatível: query(sql, params) → { rows })
 * @param {Date}     [params.now]
 * @param {Function} params.resolveTimezone async (clientId) → fuso IANA do tenant
 * @param {Function} params.buildSteps      (campaign) → { steps } | { error }
 * @param {Function} params.countAudience   async (campaign) → { total, toSend } (público recalculado agora, sem limite)
 * @param {number}   [params.limit]
 */
export async function materializeDueRecurringOccurrences({
  pool,
  now = new Date(),
  resolveTimezone,
  buildSteps,
  countAudience,
  limit = 25,
} = {}) {
  if (!pool) return { success: false, reason: "DATABASE_NOT_CONFIGURED", items: [] };

  let campaigns;
  try {
    const res = await pool.query(
      `SELECT id, client_id, name, limit_per_run, import_id, analytics_meta,
              recurrence_pattern, recurrence_day_of_month, recurrence_day_of_week, recurrence_time, next_run_at,
              recurrence_end_type, recurrence_ends_at, recurrence_max_occurrences, recurrence_occurrences_count
         FROM public.campaigns
        WHERE is_recurring = true
          AND archived_at IS NULL
          AND status IN ('active', 'scheduled')
          AND recurrence_end_type IS NOT NULL
          AND next_run_at IS NOT NULL
          AND next_run_at <= $1::timestamptz
        ORDER BY next_run_at ASC
        LIMIT $2`,
      [now.toISOString(), limit]
    );
    campaigns = res.rows;
  } catch (err) {
    if (isMissingSchema(err)) return { success: true, reason: "schema_pending", items: [] };
    throw err;
  }

  const items = [];
  for (const campaign of campaigns) {
    try {
      items.push(await materializeOne({ pool, now, campaign, resolveTimezone, buildSteps, countAudience }));
    } catch (err) {
      console.error("[campaign-recurrence] falha ao materializar ocorrência", { campaignId: campaign.id, error: err?.message || err });
      items.push({ campaignId: campaign.id, status: "error", error: err?.message || String(err) });
    }
  }
  return { success: true, items };
}

async function materializeOne({ pool, now, campaign, resolveTimezone, buildSteps, countAudience }) {
  const slot = new Date(campaign.next_run_at);
  const endType = campaign.recurrence_end_type || null;
  const doneCount = Number(campaign.recurrence_occurrences_count || 0);
  const maxCount = campaign.recurrence_max_occurrences != null ? Number(campaign.recurrence_max_occurrences) : null;
  const endsAt = campaign.recurrence_ends_at ? new Date(campaign.recurrence_ends_at) : null;

  // Fim já alcançado antes desta ocorrência (ex.: o dono mudou a data de fim para trás): encerra sem criar nada.
  if ((endType === "until_date" && endsAt && slot > endsAt) || (endType === "count" && maxCount != null && doneCount >= maxCount)) {
    const ended = await endRecurrence(pool, campaign, now);
    return { campaignId: campaign.id, status: ended ? "ended" : "already_claimed" };
  }

  const timezone = (await resolveTimezone?.(campaign.client_id)) || "America/Sao_Paulo";

  let outcome = "created";
  let reason = null;
  let steps = null;
  let audience = null;

  const active = await findActiveDispatchOfCampaign(pool, campaign.id, slot.toISOString());
  if (active) {
    outcome = "skipped";
    reason = buildSkippedBecauseRunningReason(active);
  } else {
    const built = buildSteps(campaign);
    if (built?.error || !Array.isArray(built?.steps) || built.steps.length === 0) {
      outcome = "skipped";
      reason = `Pulado: a campanha não tem mensagem válida para enviar (${built?.error || "sem passos"}).`;
    } else {
      steps = built.steps;
      try {
        audience = await countAudience(campaign);
      } catch (err) {
        console.warn("[campaign-recurrence] não foi possível contar o público da ocorrência", { campaignId: campaign.id, error: err?.message || err });
      }
    }
  }

  const created = outcome === "created";
  const newCount = doneCount + (created ? 1 : 0);
  const base = now > slot ? now : slot;
  const next = computeNextRecurrenceDate({
    pattern: campaign.recurrence_pattern,
    dayOfMonth: campaign.recurrence_day_of_month,
    dayOfWeek: campaign.recurrence_day_of_week,
    timeStr: campaign.recurrence_time,
    fromDate: base,
    timezone,
    forceNextCycle: true,
  });
  const ended =
    (endType === "count" && maxCount != null && newCount >= maxCount) ||
    (endType === "until_date" && endsAt != null && next > endsAt);

  const audienceCount = audience ? Number(audience.toSend ?? audience.total ?? 0) : null;
  const dispatchName = `Envio recorrente — ${formatSlot(slot, timezone)}`;

  // Um comando só: avança a campanha (condicionado ao horário vencido), cria o lote (se não pulou) e registra a
  // ocorrência. Ou tudo acontece, ou nada — e o segundo tick concorrente não acha a linha em `claimed`.
  let rows;
  try {
    const res = await pool.query(
      `WITH claimed AS (
         UPDATE public.campaigns
            SET next_run_at = $3::timestamptz,
                recurrence_occurrences_count = $4::int,
                recurrence_ended_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE recurrence_ended_at END
          WHERE id = $1 AND next_run_at = $2::timestamptz AND is_recurring = true
          RETURNING id, client_id
       ), disp AS (
         INSERT INTO public.campaign_dispatches
           (campaign_id, client_id, name, steps, dispatch_options, trigger_type, scheduled_at, status, limit_per_run, target_count,
            recurrence_occurrence_at, recurrence_variant_offset)
         SELECT id, client_id, $7, $8::jsonb, $14::jsonb, 'scheduled', $2::timestamptz, 'scheduled', $9::int, COALESCE($10::int, 0),
                $2::timestamptz, $4::int
           FROM claimed
          WHERE $11::boolean
         RETURNING id
       ), occ AS (
         INSERT INTO public.campaign_recurrence_occurrences
           (campaign_id, client_id, occurrence_at, outcome, reason, dispatch_id, audience_count)
         SELECT c.id, c.client_id, $2::timestamptz, $12, $13, (SELECT id FROM disp), $10::int
           FROM claimed c
         RETURNING id, dispatch_id
       )
       SELECT id, dispatch_id FROM occ`,
      [
        campaign.id,
        slot.toISOString(),
        ended ? null : next.toISOString(),
        newCount,
        ended,
        now.toISOString(),
        dispatchName,
        JSON.stringify(steps || []),
        null, // ocorrência não tem limite por envio: público inteiro, cota do chip como freio
        audienceCount,
        created,
        outcome,
        reason,
        JSON.stringify(campaign.analytics_meta?.dispatchOptions || {}),
      ]
    );
    rows = res.rows;
  } catch (err) {
    if (err && (err.code === "42703" || String(err.message || "").includes("dispatch_options"))) {
      // Fallback para schema legado onde campaign_dispatches ainda não possui dispatch_options
      const res = await pool.query(
        `WITH claimed AS (
           UPDATE public.campaigns
              SET next_run_at = $3::timestamptz,
                  recurrence_occurrences_count = $4::int,
                  recurrence_ended_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE recurrence_ended_at END
            WHERE id = $1 AND next_run_at = $2::timestamptz AND is_recurring = true
            RETURNING id, client_id
         ), disp AS (
           INSERT INTO public.campaign_dispatches
             (campaign_id, client_id, name, steps, trigger_type, scheduled_at, status, limit_per_run, target_count,
              recurrence_occurrence_at, recurrence_variant_offset)
           SELECT id, client_id, $7, $8::jsonb, 'scheduled', $2::timestamptz, 'scheduled', $9::int, COALESCE($10::int, 0),
                  $2::timestamptz, $4::int
             FROM claimed
            WHERE $11::boolean
           RETURNING id
         ), occ AS (
           INSERT INTO public.campaign_recurrence_occurrences
             (campaign_id, client_id, occurrence_at, outcome, reason, dispatch_id, audience_count)
           SELECT c.id, c.client_id, $2::timestamptz, $12, $13, (SELECT id FROM disp), $10::int
             FROM claimed c
           RETURNING id, dispatch_id
         )
         SELECT id, dispatch_id FROM occ`,
        [
          campaign.id,
          slot.toISOString(),
          ended ? null : next.toISOString(),
          newCount,
          ended,
          now.toISOString(),
          dispatchName,
          JSON.stringify(steps || []),
          null,
          audienceCount,
          created,
          outcome,
          reason,
        ]
      );
      rows = res.rows;
    } else {
      throw err;
    }
  }

  if (rows.length === 0) return { campaignId: campaign.id, status: "already_claimed" };
  return {
    campaignId: campaign.id,
    status: outcome,
    reason,
    occurrenceAt: slot.toISOString(),
    dispatchId: rows[0].dispatch_id || null,
    audience,
    nextRunAt: ended ? null : next.toISOString(),
    ended,
  };
}
