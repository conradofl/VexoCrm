// Serviço centralizado de condições de saída de cadências de follow-up.
// Respeita a hierarquia de camadas: services/ nunca importa de domains/.

import { SQL_CANONICAL_PHONE } from "./canonicalPhone.js";

/**
 * Normaliza estágios de lead para determinar se é Ganho ou Perdido.
 */
export function isWonStage(stage) {
  if (!stage) return false;
  const s = String(stage).trim().toLowerCase();
  return ["won", "ganho", "fechado", "cliente"].includes(s);
}

export function isLostStage(stage) {
  if (!stage) return false;
  const s = String(stage).trim().toLowerCase();
  return ["lost", "perdido", "descartado", "cancelado"].includes(s);
}

/**
 * Cancela cadências ativas quando o lead responde.
 * Executa apenas se a campanha tiver exit_on_reply = true (padrão true).
 */
export async function cancelFollowupCadenceOnReply({ companyId, phone, queryFn }) {
  if (!companyId || !phone || !queryFn) return { cancelledSchedules: 0, cancelledJobs: 0 };

  try {
    const { rows } = await queryFn(
      `SELECT fs.id AS schedule_id
         FROM followup_schedules fs
         LEFT JOIN followup_campaigns fc ON fc.id = fs.campaign_id
        WHERE fs.company_id = $1
          AND ${SQL_CANONICAL_PHONE("fs.phone")} = ${SQL_CANONICAL_PHONE("$2::text")}
          AND fs.status IN ('active', 'pending')
          AND COALESCE(fc.exit_on_reply, TRUE) = TRUE`,
      [companyId, phone]
    );

    if (!rows.length) return { cancelledSchedules: 0, cancelledJobs: 0 };

    const scheduleIds = rows.map((r) => r.schedule_id);

    await queryFn(
      `UPDATE followup_schedules
          SET status = 'cancelled'
        WHERE id = ANY($1::uuid[])`,
      [scheduleIds]
    );

    const jobsResult = await queryFn(
      `UPDATE followup_jobs
          SET status = 'cancelled'
        WHERE schedule_id = ANY($1::uuid[])
          AND status = 'pending'`,
      [scheduleIds]
    );

    console.info(
      `[followup-exit-guard] Cadência cancelada por resposta do lead: ${scheduleIds.length} schedules, ${jobsResult?.rowCount || 0} jobs (empresa: ${companyId}, fone: ${phone})`
    );

    return {
      cancelledSchedules: scheduleIds.length,
      cancelledJobs: jobsResult?.rowCount || 0,
    };
  } catch (err) {
    console.error("[followup-exit-guard] Erro ao cancelar cadência on_reply:", err?.message || err);
    return { cancelledSchedules: 0, cancelledJobs: 0, error: err?.message };
  }
}

/**
 * Cancela cadências ativas quando atendimento humano assume o contato (Takeover / Marcar Atendido).
 * Executa se exit_on_human_takeover = true (padrão true).
 */
export async function cancelFollowupCadenceOnTakeover({ clientId, phone, queryFn }) {
  if (!clientId || !phone || !queryFn) return { cancelledSchedules: 0, cancelledJobs: 0 };

  try {
    const { rows } = await queryFn(
      `SELECT fs.id AS schedule_id
         FROM followup_schedules fs
         LEFT JOIN followup_campaigns fc ON fc.id = fs.campaign_id
         JOIN followup_companies fco ON fco.id = fs.company_id
        WHERE (fco.id::text = $1 OR fco.tenant_id = $1)
          AND ${SQL_CANONICAL_PHONE("fs.phone")} = ${SQL_CANONICAL_PHONE("$2::text")}
          AND fs.status IN ('active', 'pending')
          AND COALESCE(fc.exit_on_human_takeover, TRUE) = TRUE`,
      [clientId, phone]
    );

    if (!rows.length) return { cancelledSchedules: 0, cancelledJobs: 0 };

    const scheduleIds = rows.map((r) => r.schedule_id);

    await queryFn(
      `UPDATE followup_schedules
          SET status = 'cancelled'
        WHERE id = ANY($1::uuid[])`,
      [scheduleIds]
    );

    const jobsResult = await queryFn(
      `UPDATE followup_jobs
          SET status = 'cancelled'
        WHERE schedule_id = ANY($1::uuid[])
          AND status = 'pending'`,
      [scheduleIds]
    );

    console.info(
      `[followup-exit-guard] Cadência cancelada por human takeover: ${scheduleIds.length} schedules, ${jobsResult?.rowCount || 0} jobs (client: ${clientId}, fone: ${phone})`
    );

    return {
      cancelledSchedules: scheduleIds.length,
      cancelledJobs: jobsResult?.rowCount || 0,
    };
  } catch (err) {
    console.error("[followup-exit-guard] Erro ao cancelar cadência on_takeover:", err?.message || err);
    return { cancelledSchedules: 0, cancelledJobs: 0, error: err?.message };
  }
}

/**
 * Cancela cadências ativas quando o estágio do lead muda para Ganho ou Perdido.
 */
export async function cancelFollowupCadenceOnStageChange({ clientId, phone, newStage, queryFn }) {
  if (!clientId || !phone || !newStage || !queryFn) return { cancelledSchedules: 0, cancelledJobs: 0 };

  const isWon = isWonStage(newStage);
  const isLost = isLostStage(newStage);

  if (!isWon && !isLost) return { cancelledSchedules: 0, cancelledJobs: 0 };

  try {
    let conditionColumn = isWon ? "exit_on_won" : "exit_on_lost";
    const { rows } = await queryFn(
      `SELECT fs.id AS schedule_id
         FROM followup_schedules fs
         LEFT JOIN followup_campaigns fc ON fc.id = fs.campaign_id
         JOIN followup_companies fco ON fco.id = fs.company_id
        WHERE (fco.id::text = $1 OR fco.tenant_id = $1)
          AND ${SQL_CANONICAL_PHONE("fs.phone")} = ${SQL_CANONICAL_PHONE("$2::text")}
          AND fs.status IN ('active', 'pending')
          AND COALESCE(fc.${conditionColumn}, TRUE) = TRUE`,
      [clientId, phone]
    );

    if (!rows.length) return { cancelledSchedules: 0, cancelledJobs: 0 };

    const scheduleIds = rows.map((r) => r.schedule_id);

    await queryFn(
      `UPDATE followup_schedules
          SET status = 'cancelled'
        WHERE id = ANY($1::uuid[])`,
      [scheduleIds]
    );

    const jobsResult = await queryFn(
      `UPDATE followup_jobs
          SET status = 'cancelled'
        WHERE schedule_id = ANY($1::uuid[])
          AND status = 'pending'`,
      [scheduleIds]
    );

    console.info(
      `[followup-exit-guard] Cadência cancelada por alteração de estágio (${newStage}): ${scheduleIds.length} schedules, ${jobsResult?.rowCount || 0} jobs (client: ${clientId}, fone: ${phone})`
    );

    return {
      cancelledSchedules: scheduleIds.length,
      cancelledJobs: jobsResult?.rowCount || 0,
    };
  } catch (err) {
    console.error("[followup-exit-guard] Erro ao cancelar cadência on_stage_change:", err?.message || err);
    return { cancelledSchedules: 0, cancelledJobs: 0, error: err?.message };
  }
}
