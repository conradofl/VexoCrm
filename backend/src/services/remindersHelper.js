// backend/src/services/remindersHelper.js
// Single Source of Truth para cálculos e filtros de pendências ("Hoje" e atrasadas)
// no fuso horário oficial America/Sao_Paulo.
// Usado conjuntamente por domains/reminders/routes.js e domains/chatbot/routes.js.

import { SQL_CANONICAL_PHONE } from "./canonicalPhone.js";

/**
 * Retorna o fragmento WHERE para lembretes pessoais pendentes que vencem hoje ou estão atrasados,
 * calculados no fuso horário 'America/Sao_Paulo'.
 *
 * @param {Object} opts
 * @param {string} opts.clientParam - Parâmetro SQL do client_id (ex: "$1")
 * @param {string} opts.operatorParam - Parâmetro SQL da lista de operadores (ex: "$2" ou "$3")
 */
export function SQL_HOJE_REMINDERS_CONDITION({ clientParam, operatorParam }) {
  return `
    lr.client_id = ${clientParam}
    AND lr.status = 'pending'
    AND (lr.remind_at AT TIME ZONE 'America/Sao_Paulo') < date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day'
    AND (
      lr.assigned_to_uid = ANY(${operatorParam})
      OR (lr.assigned_to_uid IS NULL AND lr.created_by_uid = ANY(${operatorParam}))
    )
  `;
}

/**
 * Retorna o fragmento WHERE para agendamentos de mensagens ativas que vencem hoje ou estão atrasadas,
 * calculados no fuso horário 'America/Sao_Paulo'.
 *
 * @param {Object} opts
 * @param {string} opts.tenantParam - Parâmetro SQL do tenant_id (ex: "$1")
 */
export function SQL_HOJE_SCHEDULES_CONDITION({ tenantParam }) {
  return `
    fco.tenant_id = ${tenantParam}
    AND fs.status = 'active'
    AND fj.status = 'pending'
    AND (fj.scheduled_for AT TIME ZONE 'America/Sao_Paulo') < date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day'
  `;
}

/**
 * Retorna a subquery/filtro WHERE para a lista de chats (m.phone) que possuem pendências hoje/atrasadas,
 * unindo lembretes pessoais e mensagens agendadas.
 *
 * @param {Object} opts
 * @param {string} opts.clientParam - Parâmetro SQL do client_id
 * @param {string} opts.operatorParam - Parâmetro SQL da lista de identificadores do operador
 */
export function SQL_HOJE_CHAT_FILTER({ clientParam, operatorParam }) {
  return `
    (
      m.phone IN (
        SELECT lr.phone
        FROM public.lead_reminders lr
        WHERE ${SQL_HOJE_REMINDERS_CONDITION({ clientParam, operatorParam })}
      )
      OR
      m.phone IN (
        SELECT ${SQL_CANONICAL_PHONE("fs.phone")}
        FROM public.followup_schedules fs
        JOIN public.followup_companies fco ON fco.id = fs.company_id
        JOIN public.followup_jobs fj ON fj.schedule_id = fs.id
        WHERE ${SQL_HOJE_SCHEDULES_CONDITION({ tenantParam: clientParam })}
      )
    )
  `;
}
