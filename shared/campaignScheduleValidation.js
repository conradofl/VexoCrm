/**
 * Validação de data de agendamento de campanhas compartilhada entre frontend e backend.
 * 
 * Regra:
 * - O input é datetime-local com precisão de MINUTO.
 * - Compara contra o início do minuto corrente (start of minute).
 * - Aceita uma tolerância (graceMs):
 *     - Frontend: 0ms (rejeita apenas o que for anterior ao início do minuto corrente).
 *     - Backend: 120.000ms (120s) para absorver diferença de relógio entre cliente e
 *       servidor e o tempo de requisição/processamento.
 */

export const BACKEND_SCHEDULE_GRACE_MS = 120 * 1000; // 120 segundos

/**
 * Retorna o timestamp do início do minuto corrente (segundos e milissegundos zerados).
 * @param {number|Date} [now]
 * @returns {number}
 */
export function getStartOfMinute(now = Date.now()) {
  const ms = typeof now === "number" ? now : new Date(now).getTime();
  const d = new Date(ms);
  d.setSeconds(0, 0);
  return d.getTime();
}

/**
 * Determina se uma data de agendamento está no passado.
 * 
 * @param {string|number|Date|null|undefined} scheduledAt - Data a ser testada (ISO string, datetime local ou timestamp)
 * @param {object} [options]
 * @param {number} [options.graceMs=0] - Folga em milissegundos (ex: BACKEND_SCHEDULE_GRACE_MS)
 * @param {number|Date} [options.now=Date.now()] - Timestamp de referência (para testes)
 * @returns {boolean} true se a data for considerada no passado (inválida)
 */
export function isScheduledDateInPast(scheduledAt, options = {}) {
  if (!scheduledAt) return false;
  const scheduledMs = typeof scheduledAt === "number" ? scheduledAt : new Date(scheduledAt).getTime();
  if (Number.isNaN(scheduledMs)) return false;

  const { graceMs = 0, now = Date.now() } = options;
  const startOfMinute = getStartOfMinute(now);
  const cutoff = startOfMinute - graceMs;

  return scheduledMs < cutoff;
}
