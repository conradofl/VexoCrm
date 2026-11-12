// Reunião marcada pela gaveta da aba Conversas → linha em followup_schedules.
//
// O botão "Reunião" grava os detalhes (link do Meet, resultado, responsável) em lead_reminders,
// que o Dashboard não lê. A contagem de reuniões do Dashboard lê só followup_schedules. Para não
// existir uma segunda conta de reunião, cada reunião da gaveta ganha UMA linha em
// followup_schedules, amarrada ao lembrete por calendly_event_uri = 'lead-reminder:<id>'.
// Reagendar atualiza a mesma linha; cancelar marca a mesma linha como cancelada.
//
// A linha nasce com status 'completed' (nada a enviar) de propósito: schedule 'active' sem
// campanha é cancelado pelo followupExitGuard assim que o lead responde, e a reunião sumiria.
// Não depende de migration: origin_type fica nulo e o cancelamento aceita as duas grafias do
// CHECK de status ('cancelled' e a antiga 'canceled').

export const MEETING_ORIGIN = "reuniao_conversas";
export const meetingLink = (reminderId) => `lead-reminder:${reminderId}`;
export const isMeetingReminder = (reminder) => String(reminder?.activity_type || "").toLowerCase() === "meeting";

async function ensureFollowupCompany(query, tenantId) {
  const found = await query(
    `SELECT id FROM followup_companies WHERE tenant_id::text = $1 ORDER BY created_at ASC NULLS LAST LIMIT 1`,
    [tenantId]
  ).catch(() => query(`SELECT id FROM followup_companies WHERE tenant_id::text = $1 LIMIT 1`, [tenantId]));
  if (found.rows.length) return found.rows[0].id;
  const created = await query(`INSERT INTO followup_companies (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, tenantId]);
  return created.rows[0].id;
}

/**
 * Garante a linha da reunião em followup_schedules. Idempotente: chamar duas vezes para o mesmo
 * lembrete não cria duas reuniões. created_at copia o do lembrete, para a reunião contar no
 * período em que foi marcada (inclusive quando a linha é criada depois, num reagendamento).
 */
export async function registerMeetingSchedule(query, { tenantId, reminder }) {
  if (!reminder?.id || !tenantId) return null;
  const link = meetingLink(reminder.id);
  const leadName = reminder.lead_name || reminder.phone || "Lead";

  const existing = await query(`SELECT id FROM followup_schedules WHERE calendly_event_uri = $1 LIMIT 1`, [link]);
  if (existing.rows.length) {
    await query(`UPDATE followup_schedules SET meeting_datetime = $2, lead_name = $3 WHERE id = $1`, [
      existing.rows[0].id,
      reminder.remind_at,
      leadName,
    ]);
    return existing.rows[0].id;
  }

  const companyId = await ensureFollowupCompany(query, tenantId);
  const { rows } = await query(
    `INSERT INTO followup_schedules
       (campaign_id, company_id, lead_name, phone, meeting_datetime, calendly_event_uri, status, origin, created_at)
     VALUES (NULL, $1, $2, $3, $4, $5, 'completed', $6, COALESCE($7::timestamptz, NOW()))
     RETURNING id`,
    [companyId, leadName, reminder.phone, reminder.remind_at, link, MEETING_ORIGIN, reminder.created_at || null]
  );
  return rows[0].id;
}

/** Cancela a linha da reunião. Devolve quantas linhas foram canceladas (0 quando a reunião nunca teve linha). */
export async function cancelMeetingSchedule(query, { reminderId }) {
  if (!reminderId) return 0;
  const link = meetingLink(reminderId);
  const sql = (status) => `UPDATE followup_schedules SET status = '${status}' WHERE calendly_event_uri = $1`;
  try {
    const result = await query(sql("cancelled"), [link]);
    return result.rowCount || 0;
  } catch (err) {
    // Banco ainda com o CHECK antigo (grafia 'canceled').
    if (err?.code !== "23514") throw err;
    const result = await query(sql("canceled"), [link]);
    return result.rowCount || 0;
  }
}
