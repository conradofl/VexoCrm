import { getPartsInTimezone, createDateInTimezone } from "./sendWindow.js";

export const RECURRENCE_PATTERNS = ["monthly", "weekly", "biweekly"];

export const WEEKDAY_NAMES = {
  0: "Domingo",
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
  6: "Sábado",
};

export const WEEKDAY_MAP = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export function parseRecurrenceTime(timeStr) {
  if (!timeStr || typeof timeStr !== "string") {
    return { hour: 9, minute: 0 };
  }
  const [hStr, mStr] = timeStr.trim().split(":");
  const hour = Math.min(23, Math.max(0, parseInt(hStr, 10) || 0));
  const minute = Math.min(59, Math.max(0, parseInt(mStr, 10) || 0));
  return { hour, minute };
}

/**
 * Calcula a próxima data de disparo para uma campanha recorrente.
 *
 * - monthly: mesmo dia do mês seguinte, com tratamento seguro para meses de 28/30/31 dias;
 * - weekly: próximo dia da semana estipulado (+7 dias a cada ciclo);
 * - biweekly: próximo dia da semana estipulado (+14 dias a cada ciclo);
 *
 * @param {Object} params
 * @param {string} params.pattern - 'monthly' | 'weekly' | 'biweekly'
 * @param {number|null} params.dayOfMonth - 1 a 31
 * @param {number|null} params.dayOfWeek - 0 (Dom) a 6 (Sab)
 * @param {string} params.timeStr - 'HH:mm' (ex: '09:00')
 * @param {Date|string} params.fromDate - data base de cálculo
 * @param {string} params.timezone - timezone (default: 'America/Sao_Paulo')
 * @param {boolean} params.forceNextCycle - se true, força avanço para o ciclo seguinte
 * @returns {Date}
 */
export function computeNextRecurrenceDate({
  pattern = "monthly",
  dayOfMonth = null,
  dayOfWeek = null,
  timeStr = "09:00",
  fromDate = new Date(),
  timezone = "America/Sao_Paulo",
  forceNextCycle = false,
} = {}) {
  const from = fromDate instanceof Date ? fromDate : new Date(fromDate);
  if (Number.isNaN(from.getTime())) {
    throw new Error("Data base inválida para cálculo de recorrência");
  }

  const { hour: targetHour, minute: targetMinute } = parseRecurrenceTime(timeStr);
  const currentParts = getPartsInTimezone(from, timezone);
  const currentWeekdayNum = WEEKDAY_MAP[currentParts.weekday] ?? 0;

  const normalizedPattern = String(pattern || "monthly").toLowerCase();

  if (normalizedPattern === "monthly") {
    const rawDay = dayOfMonth != null ? Number(dayOfMonth) : currentParts.day;
    const targetDay = Math.min(31, Math.max(1, rawDay || 1));

    // Candidato no próprio mês corrente
    const daysInCurrentMonth = new Date(Date.UTC(currentParts.year, currentParts.month, 0)).getUTCDate();
    const safeCurrentDay = Math.min(targetDay, daysInCurrentMonth);
    const candidateCurrentMonth = createDateInTimezone(
      currentParts.year,
      currentParts.month,
      safeCurrentDay,
      targetHour,
      targetMinute,
      0,
      timezone
    );

    // Se não for forçado para o próximo ciclo e o candidato deste mês ainda está no futuro (> 1 min de folga)
    if (!forceNextCycle && candidateCurrentMonth.getTime() - from.getTime() > 60 * 1000) {
      return candidateCurrentMonth;
    }

    // Caso contrário, avança para o próximo mês
    let nextMonth = currentParts.month + 1;
    let nextYear = currentParts.year;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }

    const daysInNextMonth = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
    const safeNextDay = Math.min(targetDay, daysInNextMonth);

    return createDateInTimezone(
      nextYear,
      nextMonth,
      safeNextDay,
      targetHour,
      targetMinute,
      0,
      timezone
    );
  }

  if (normalizedPattern === "weekly" || normalizedPattern === "biweekly") {
    const rawDow = dayOfWeek != null ? Number(dayOfWeek) : currentWeekdayNum;
    const targetDow = Math.min(6, Math.max(0, rawDow));

    let daysDiff = (targetDow - currentWeekdayNum + 7) % 7;

    if (daysDiff === 0) {
      const candidateToday = createDateInTimezone(
        currentParts.year,
        currentParts.month,
        currentParts.day,
        targetHour,
        targetMinute,
        0,
        timezone
      );

      if (!forceNextCycle && candidateToday.getTime() - from.getTime() > 60 * 1000) {
        return candidateToday;
      }

      // Se for forçado ou já passou da hora hoje, soma 7 dias (semanal) ou 14 dias (quinzenal)
      daysDiff = normalizedPattern === "biweekly" ? 14 : 7;
    }

    // Calcula a data somando os dias
    const targetDateTimestamp = from.getTime() + daysDiff * 24 * 60 * 60 * 1000;
    const targetParts = getPartsInTimezone(new Date(targetDateTimestamp), timezone);

    return createDateInTimezone(
      targetParts.year,
      targetParts.month,
      targetParts.day,
      targetHour,
      targetMinute,
      0,
      timezone
    );
  }

  throw new Error(`Padrão de recorrência não suportado: ${pattern}`);
}
