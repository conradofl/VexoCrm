// Serviço centralizado de condições de saída de cadências de follow-up.
// Respeita a hierarquia de camadas: services/ nunca importa de domains/.

import { SQL_CANONICAL_PHONE } from "./canonicalPhone.js";

/**
 * Normaliza estágios de lead para determinar se é Ganho ou Perdido.
 */
export function isWonStage(stage) {
  if (!stage) return false;
  const s = String(stage).trim().toLowerCase();
  return ["won", "ganho", "fechado", "cliente", "buyer"].includes(s);
}

export function isLostStage(stage) {
  if (!stage) return false;
  const s = String(stage).trim().toLowerCase();
  return ["lost", "perdido", "descartado", "cancelado"].includes(s);
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `****${digits.slice(-4)}` : "(sem telefone)";
}

/**
 * Diz se o lead respondeu DEPOIS de `since` (normalmente fs.created_at, a inscrição).
 * Casa pelo tenant (qualquer agente do tenant); agente sem tenant cai no company_id.
 *
 * A janela é obrigatória: sem ela, qualquer resposta antiga do telefone — de outra
 * cadência, de meses atrás — faria o lead pular todos os passos de toda cadência
 * futura, e a reativação de parados (que inscreve justamente quem já conversou)
 * nasceria morta. `since` é parâmetro para o modo "âncora no passo anterior"
 * poder passar o sent_at do passo anterior sem reescrever esta checagem.
 */
export async function hasFollowupReplySince({ tenantId, companyId, phone, since, queryFn }) {
  if (!phone || !queryFn || (!tenantId && !companyId)) return false;
  const { rows } = await queryFn(
    `SELECT 1
       FROM followup_replies fr
       JOIN followup_companies fco ON fco.id = fr.company_id
      WHERE (CASE WHEN $1::text IS NULL THEN fr.company_id = $2::uuid ELSE fco.tenant_id = $1::text END)
        AND ${SQL_CANONICAL_PHONE("fr.phone")} = ${SQL_CANONICAL_PHONE("$3::text")}
        AND fr.received_at >= COALESCE($4::timestamptz, '-infinity'::timestamptz)
      LIMIT 1`,
    [tenantId || null, companyId || null, phone, since || null]
  );
  return rows.length > 0;
}

/**
 * Cancela cadências ativas do tenant quando o lead responde.
 * Executa apenas se a campanha tiver exit_on_reply = true (padrão true).
 *
 * Recebe o slug do tenant. Antes recebia `companyId` e comparava com
 * fs.company_id (uuid), mas todo chamador passava o slug: a consulta quebrava
 * com erro de tipo, o catch engolia, e nenhuma cadência parava por resposta.
 */
export async function cancelFollowupCadenceOnReply({ tenantId, phone, queryFn }) {
  if (!tenantId || !phone || !queryFn) return { cancelledSchedules: 0, cancelledJobs: 0 };

  try {
    const { rows } = await queryFn(
      `SELECT fs.id AS schedule_id
         FROM followup_schedules fs
         JOIN followup_companies fco ON fco.id = fs.company_id
         LEFT JOIN followup_campaigns fc ON fc.id = fs.campaign_id
        WHERE fco.tenant_id = $1::text
          AND ${SQL_CANONICAL_PHONE("fs.phone")} = ${SQL_CANONICAL_PHONE("$2::text")}
          AND fs.status IN ('active', 'pending')
          AND COALESCE(fc.exit_on_reply, TRUE) = TRUE`,
      [tenantId, phone]
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
      `[followup-exit-guard] Cadência cancelada por resposta do lead: ${scheduleIds.length} schedules, ${jobsResult?.rowCount || 0} jobs (tenant: ${tenantId}, fone: ${maskPhone(phone)})`
    );

    return {
      cancelledSchedules: scheduleIds.length,
      cancelledJobs: jobsResult?.rowCount || 0,
    };
  } catch (err) {
    // Não lança (quem chama é o webhook de entrada), mas não esconde: código do
    // Postgres, tenant e fone mascarado vão para o log de erro.
    console.error("[followup-exit-guard] Erro ao cancelar cadência on_reply:", {
      tenantId,
      phone: maskPhone(phone),
      code: err?.code || null,
      message: err?.message || String(err),
    });
    return { cancelledSchedules: 0, cancelledJobs: 0, error: err?.message || String(err), code: err?.code || null };
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
