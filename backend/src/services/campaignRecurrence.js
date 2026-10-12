import { getPartsInTimezone, createDateInTimezone } from "./sendWindow.js";

export const RECURRENCE_PATTERNS = ["daily", "monthly", "weekly", "biweekly"];

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
 * - daily: todo dia no horário;
 * - monthly: mesmo dia do mês seguinte; dia que não existe no mês (31 em novembro, 29-31 em fevereiro) cai no
 *   ÚLTIMO dia daquele mês, e o mês seguinte volta ao dia pedido;
 * - weekly: próximo dia da semana estipulado (+7 dias a cada ciclo);
 * - biweekly: próximo dia da semana estipulado (+14 dias a cada ciclo);
 *
 * @param {Object} params
 * @param {string} params.pattern - 'daily' | 'monthly' | 'weekly' | 'biweekly'
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

  if (normalizedPattern === "daily") {
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
    const tomorrowParts = getPartsInTimezone(new Date(candidateToday.getTime() + 24 * 60 * 60 * 1000), timezone);
    return createDateInTimezone(
      tomorrowParts.year,
      tomorrowParts.month,
      tomorrowParts.day,
      targetHour,
      targetMinute,
      0,
      timezone
    );
  }

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

// ── Salvar campanha recorrente ───────────────────────────────────────────────────────────────────────────────────
// Uma regra só para criar e editar. Recusa o que mandaria a mesma mensagem para a mesma lista todo mês, exige fim
// declarado (sem fim só com confirmação explícita) e calcula o próximo envio no fuso do tenant.

export const RECURRENCE_END_TYPES = ["until_date", "count", "never"];

const MIN_VARIANTS_FOR_RECURRENCE = 2;

function pick(body, camel, snake) {
  if (!body || typeof body !== "object") return undefined;
  if (camel in body) return body[camel];
  if (snake in body) return body[snake];
  return undefined;
}

/** Passos ativos com texto que não têm variações suficientes (sairiam idênticos a cada envio). */
export function findStepsWithoutVariants(sequence) {
  const steps = Array.isArray(sequence) ? sequence : [];
  const missing = [];
  steps.forEach((step, index) => {
    if (!step || step.enabled === false) return;
    const variants = Array.isArray(step.textVariants)
      ? Array.from(new Set(step.textVariants.map((v) => String(v ?? "").trim()).filter(Boolean)))
      : [];
    const hasText = String(step.text ?? "").trim().length > 0 || variants.length > 0;
    if (!hasText) return;
    if (variants.length < MIN_VARIANTS_FOR_RECURRENCE) missing.push(Number(step.order) || index + 1);
  });
  return missing;
}

export function buildMissingVariantsMessage(stepNumbers, { isCrmSource }) {
  const passos = stepNumbers.length === 1 ? `o passo ${stepNumbers[0]}` : `os passos ${stepNumbers.join(", ")}`;
  if (isCrmSource) {
    return `Sem variações do texto em ${passos}: a cada envio, quem já recebeu recebe a mesma mensagem de novo. Cadastre pelo menos ${MIN_VARIANTS_FOR_RECURRENCE} variações (você pode gerá-las no passo da mensagem). Nada é gerado sem você pedir.`;
  }
  return `Campanha recorrente com público de planilha manda para as mesmas pessoas a cada envio. Sem variações do texto em ${passos}, todas recebem a mensagem idêntica repetida — o padrão que o WhatsApp detecta e que derruba o chip. Cadastre pelo menos ${MIN_VARIANTS_FOR_RECURRENCE} variações antes de salvar.`;
}

const RECURRENCE_BODY_KEYS = [
  ["isRecurring", "is_recurring"], ["recurrencePattern", "recurrence_pattern"],
  ["recurrenceDayOfMonth", "recurrence_day_of_month"], ["recurrenceDayOfWeek", "recurrence_day_of_week"],
  ["recurrenceTime", "recurrence_time"], ["recurrenceEndType", "recurrence_end_type"],
  ["recurrenceEndsOn", "recurrence_ends_on"], ["recurrenceMaxOccurrences", "recurrence_max_occurrences"],
  ["recurrenceNoEndConfirmed", "recurrence_no_end_confirmed"],
];

/** O corpo mexe em algum campo de recorrência? */
export function bodyTouchesRecurrence(body) {
  return RECURRENCE_BODY_KEYS.some(([c, s]) => pick(body, c, s) !== undefined);
}

/**
 * @param {object} p
 * @param {object} p.body          corpo da requisição (camelCase ou snake_case)
 * @param {object|null} p.existing linha atual da campanha (edição) ou null (criação)
 * @param {boolean} p.isCrmSource  origem efetiva depois deste salvamento
 * @param {Array} p.sequence       passos efetivos depois deste salvamento
 * @param {string} p.timezone      fuso do tenant
 * @param {Date} [p.now]
 * @returns {{ ok: true, touched: boolean, fields: object, warnings: string[] } | { ok: false, code: string, message: string }}
 */
export function resolveRecurrenceSave({ body, existing = null, isCrmSource, sequence, timezone = "America/Sao_Paulo", now = new Date() }) {
  const flagFromBody = pick(body, "isRecurring", "is_recurring");
  const isRecurring = flagFromBody !== undefined ? Boolean(flagFromBody) : Boolean(existing?.is_recurring);

  if (!isRecurring) {
    if (flagFromBody === undefined && !existing) return { ok: true, touched: false, fields: { is_recurring: false }, warnings: [] };
    return {
      ok: true,
      touched: flagFromBody !== undefined,
      fields: { is_recurring: false, next_run_at: null },
      warnings: [],
    };
  }

  const pattern = String(pick(body, "recurrencePattern", "recurrence_pattern") ?? existing?.recurrence_pattern ?? "").trim().toLowerCase();
  if (!RECURRENCE_PATTERNS.includes(pattern)) {
    return { ok: false, code: "INVALID_RECURRENCE", message: "Escolha a repetição: diária, semanal ou mensal." };
  }

  const rawDom = pick(body, "recurrenceDayOfMonth", "recurrence_day_of_month") ?? existing?.recurrence_day_of_month;
  const rawDow = pick(body, "recurrenceDayOfWeek", "recurrence_day_of_week") ?? existing?.recurrence_day_of_week;
  const dayOfMonth = pattern === "monthly" ? Number(rawDom) : null;
  const dayOfWeek = pattern === "weekly" || pattern === "biweekly" ? Number(rawDow) : null;
  if (pattern === "monthly" && !(Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31)) {
    return { ok: false, code: "INVALID_RECURRENCE", message: "Dia do mês precisa ser de 1 a 31." };
  }
  if ((pattern === "weekly" || pattern === "biweekly") && !(Number.isInteger(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6)) {
    return { ok: false, code: "INVALID_RECURRENCE", message: "Escolha o dia da semana." };
  }

  const time = String(pick(body, "recurrenceTime", "recurrence_time") ?? existing?.recurrence_time ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return { ok: false, code: "INVALID_RECURRENCE", message: "Horário precisa estar no formato HH:mm." };
  }

  const endType = String(pick(body, "recurrenceEndType", "recurrence_end_type") ?? existing?.recurrence_end_type ?? "").trim();
  if (!RECURRENCE_END_TYPES.includes(endType)) {
    return { ok: false, code: "RECURRENCE_END_REQUIRED", message: "Declare quando a repetição termina: até uma data, depois de N envios, ou sem fim." };
  }

  const firstRun = computeNextRecurrenceDate({ pattern, dayOfMonth, dayOfWeek, timeStr: time, fromDate: now, timezone });

  let endsAt = null;
  let maxOccurrences = null;
  let noEndConfirmedAt = null;
  if (endType === "until_date") {
    const endsOn = String(pick(body, "recurrenceEndsOn", "recurrence_ends_on") ?? "").trim();
    if (endsOn) {
      const m = endsOn.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return { ok: false, code: "INVALID_RECURRENCE", message: "Data de fim inválida." };
      endsAt = createDateInTimezone(Number(m[1]), Number(m[2]), Number(m[3]), 23, 59, 59, timezone);
    } else if (existing?.recurrence_ends_at) {
      endsAt = new Date(existing.recurrence_ends_at);
    } else {
      return { ok: false, code: "RECURRENCE_END_REQUIRED", message: "Informe a data em que a repetição termina." };
    }
    if (endsAt < firstRun) {
      return { ok: false, code: "INVALID_RECURRENCE", message: "A data de fim é antes do primeiro envio: nenhum envio aconteceria." };
    }
  } else if (endType === "count") {
    maxOccurrences = Number(pick(body, "recurrenceMaxOccurrences", "recurrence_max_occurrences") ?? existing?.recurrence_max_occurrences);
    if (!(Number.isInteger(maxOccurrences) && maxOccurrences >= 1 && maxOccurrences <= 1000)) {
      return { ok: false, code: "INVALID_RECURRENCE", message: "Número de envios precisa ser de 1 a 1000." };
    }
  } else {
    const confirmed = pick(body, "recurrenceNoEndConfirmed", "recurrence_no_end_confirmed");
    if (confirmed === true) noEndConfirmedAt = now.toISOString();
    else if (confirmed === undefined && existing?.recurrence_no_end_confirmed_at) noEndConfirmedAt = existing.recurrence_no_end_confirmed_at;
    else {
      return { ok: false, code: "RECURRENCE_NO_END_NOT_CONFIRMED", message: "Repetição sem fim precisa da sua confirmação: ela envia até alguém desligar." };
    }
  }

  const warnings = [];
  const missing = findStepsWithoutVariants(sequence);
  if (missing.length > 0) {
    const message = buildMissingVariantsMessage(missing, { isCrmSource });
    if (!isCrmSource) return { ok: false, code: "RECURRENCE_VARIANTS_REQUIRED", message };
    warnings.push(message);
  }

  return {
    ok: true,
    touched: true,
    warnings,
    fields: {
      is_recurring: true,
      recurrence_pattern: pattern,
      recurrence_day_of_month: dayOfMonth,
      recurrence_day_of_week: dayOfWeek,
      recurrence_time: time,
      recurrence_end_type: endType,
      recurrence_ends_at: endsAt ? endsAt.toISOString() : null,
      recurrence_max_occurrences: maxOccurrences,
      recurrence_no_end_confirmed_at: noEndConfirmedAt,
      recurrence_ended_at: null,
      next_run_at: firstRun.toISOString(),
      // scheduled_for e do agendador ANTIGO (runDueCampaignDispatches). Recorrente nunca o usa: assim aquele caminho
      // nao enxerga campanha que repete, nem se alguem chamar /api/campaigns/run-due.
      scheduled_for: null,
    },
  };
}

/** "15/11 às 09:00" no fuso do tenant. */
export function formatRecurrenceSlot(dateInput, timezone = "America/Sao_Paulo") {
  if (!dateInput) return null;
  const p = getPartsInTimezone(dateInput, timezone);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(p.day)}/${pad(p.month)} às ${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Texto da repetição para a tela, sem ícone para decifrar: "Todo mês, no dia 31, às 09:00" + a regra do mês curto
 * quando ela vale ("Em meses sem dia 31, o envio sai no último dia do mês.").
 */
export function describeRecurrence({ pattern, dayOfMonth, dayOfWeek, time }) {
  const hora = `às ${time}`;
  const p = String(pattern || "").toLowerCase();
  if (p === "daily") return { summary: `Todo dia, ${hora}`, monthEndNote: null };
  if (p === "weekly" || p === "biweekly") {
    const dia = WEEKDAY_NAMES[Number(dayOfWeek)] || "";
    const freq = p === "weekly" ? "Toda semana" : "A cada 2 semanas";
    return { summary: `${freq}, ${dia.toLowerCase()}, ${hora}`, monthEndNote: null };
  }
  const d = Number(dayOfMonth);
  return {
    summary: `Todo mês, no dia ${d}, ${hora}`,
    monthEndNote: d >= 29 ? `Em meses sem dia ${d}, o envio sai no último dia do mês (ex.: 30/11, 28/02).` : null,
  };
}

/** Texto do fim declarado. */
export function describeRecurrenceEnd({ endType, endsAt, maxOccurrences, occurrencesCount = 0, timezone = "America/Sao_Paulo" }) {
  if (endType === "until_date" && endsAt) {
    const p = getPartsInTimezone(endsAt, timezone);
    const pad = (n) => String(n).padStart(2, "0");
    return `Termina em ${pad(p.day)}/${pad(p.month)}/${p.year}`;
  }
  if (endType === "count" && maxOccurrences) {
    return `Termina depois de ${maxOccurrences} envio${maxOccurrences === 1 ? "" : "s"} (${occurrencesCount} feito${occurrencesCount === 1 ? "" : "s"})`;
  }
  if (endType === "never") return "Sem fim — envia até alguém desligar";
  return null;
}

// ── Quanto tempo uma ocorrência leva ─────────────────────────────────────────────────────────────────────────────
// Recorrente não tem limite por envio: cobre o público inteiro e a cota do chip é o freio. Numa base grande isso
// pode levar dias — e, se levar mais que o intervalo da repetição, toda ocorrência seguinte vence com a anterior
// ainda rodando e é pulada. Esta conta existe para o dono ver o número ANTES de salvar.

// Ritmo do envio agendado: o laço espera 30–90 s entre leads (leadDelayProvider de runCampaignDispatch) → 60 s em média.
export const SCHEDULED_LEAD_DELAY_AVG_SECONDS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Dias entre duas ocorrências seguidas desta configuração, no fuso do tenant. */
export function recurrenceIntervalDays({ pattern, dayOfMonth, dayOfWeek, time, timezone = "America/Sao_Paulo", now = new Date() }) {
  const first = computeNextRecurrenceDate({ pattern, dayOfMonth, dayOfWeek, timeStr: time, fromDate: now, timezone });
  const second = computeNextRecurrenceDate({ pattern, dayOfMonth, dayOfWeek, timeStr: time, fromDate: first, timezone, forceNextCycle: true });
  return Math.round((second.getTime() - first.getTime()) / DAY_MS);
}

/**
 * @param {object} p
 * @param {number} p.audienceTotal       leads do público de hoje
 * @param {number} p.messagesPerLead     mensagens por lead (a mesma conta da reserva de cota)
 * @param {number|null} p.dailyQuota     cota diária do chip que envia (null = chip desconhecido)
 * @param {object} p.sendWindow          resolveSendWindowConfig do tenant
 * @param {number} [p.extraSecondsPerLead] esperas entre passos do mesmo lead
 * @returns {{ days: number, leadsPerDay: number, limitedBy: "quota"|"pace", sendDaysPerWeek: number } | null}
 */
export function estimateOccurrenceDuration({ audienceTotal, messagesPerLead, dailyQuota, sendWindow, extraSecondsPerLead = 0 }) {
  if (!(dailyQuota > 0)) return null;
  const total = Math.max(0, Number(audienceTotal) || 0);
  const perLead = Math.max(1, Number(messagesPerLead) || 1);
  const leadsByQuota = Math.floor(dailyQuota / perLead);

  let windowSeconds = 24 * 60 * 60;
  let sendDaysPerWeek = 7;
  if (sendWindow?.enabled) {
    const [sh, sm] = String(sendWindow.start || "00:00").split(":").map(Number);
    const [eh, em] = String(sendWindow.end || "23:59").split(":").map(Number);
    windowSeconds = Math.max(0, (eh * 60 + em - (sh * 60 + sm)) * 60);
    sendDaysPerWeek = Array.isArray(sendWindow.days) && sendWindow.days.length > 0 ? sendWindow.days.length : 7;
  }
  const leadsByPace = Math.floor(windowSeconds / (SCHEDULED_LEAD_DELAY_AVG_SECONDS + Math.max(0, extraSecondsPerLead)));

  const leadsPerDay = Math.max(0, Math.min(leadsByQuota, leadsByPace));
  if (total === 0) return { days: 0, leadsPerDay, limitedBy: leadsByQuota <= leadsByPace ? "quota" : "pace", sendDaysPerWeek };
  if (leadsPerDay === 0) return { days: Infinity, leadsPerDay, limitedBy: leadsByQuota <= leadsByPace ? "quota" : "pace", sendDaysPerWeek };
  const sendDays = Math.ceil(total / leadsPerDay);
  const days = Math.ceil((sendDays * 7) / sendDaysPerWeek);
  return { days, leadsPerDay, limitedBy: leadsByQuota <= leadsByPace ? "quota" : "pace", sendDaysPerWeek };
}

/** O texto que o dono lê antes de confirmar, com os números reais. */
export function describeOccurrenceLoad({ estimate, intervalDays, chipName, dailyQuota, messagesPerLead, audienceTotal }) {
  const fmt = (n) => Number(n).toLocaleString("pt-BR");
  if (!estimate) {
    return {
      overrun: false,
      message: "Não foi possível estimar quanto cada envio leva: o envio não usa um chip cadastrado com cota diária.",
    };
  }
  const dias = estimate.days === Infinity ? "nunca termina" : `leva cerca de ${fmt(estimate.days)} dia${estimate.days === 1 ? "" : "s"}`;
  const freio = estimate.limitedBy === "quota"
    ? `a cota do chip ${chipName ? `"${chipName}" ` : ""}(${fmt(dailyQuota)} mensagens/dia, ${fmt(messagesPerLead)} por lead)`
    : "o ritmo de envio dentro da janela (1 lead a cada ~60 s)";
  const base = `Com ${freio}, cada envio para ${fmt(audienceTotal)} leads ${dias}; sua repetição é a cada ${fmt(intervalDays)} dia${intervalDays === 1 ? "" : "s"}. A conta supõe o chip só com esta campanha: outros envios no mesmo chip deixam mais lento.`;
  const overrun = estimate.days > intervalDays;
  return {
    overrun,
    message: overrun
      ? `${base} A repetição não vai conseguir acontecer como configurada: cada envio ainda estará rodando quando o próximo vencer, e o próximo será pulado — sempre.`
      : base,
  };
}
