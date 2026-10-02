// backend/src/services/dashboardPeriod.js
//
// Período do dashboard: os três atalhos (7d, 30d, este mês) e o intervalo personalizado.
//
// Intervalo personalizado = data inicial e final escolhidas (inclusive as duas), na data do tenant
// (fuso do tenant, America/Sao_Paulo por padrão — o mesmo da cota do chip). O período anterior tem a
// MESMA duração em dias, imediatamente antes da data inicial. Cada intervalo tem chave própria
// (`custom:AAAA-MM-DD:AAAA-MM-DD`) — é ela que separa o cache de um intervalo do cache de outro.

export const DASHBOARD_DEFAULT_TIMEZONE = "America/Sao_Paulo";
export const CUSTOM_PERIOD_PREFIX = "custom:";
// Intervalo maior que isso é recusado: a consulta varre mensagens do período inteiro.
export const MAX_CUSTOM_PERIOD_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dateKeyInTimezone(date, timeZone = DASHBOARD_DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
}

export function isValidDateKey(value) {
  const match = DATE_KEY_RE.exec(String(value ?? ""));
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function keyToUtcMs(key) {
  const [, y, m, d] = DATE_KEY_RE.exec(key).map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDaysToDateKey(key, days) {
  return new Date(keyToUtcMs(key) + days * DAY_MS).toISOString().slice(0, 10);
}

// Quantidade de dias do intervalo, contando as duas pontas (1 a 1 = 1 dia).
export function countDaysInclusive(from, to) {
  return Math.round((keyToUtcMs(to) - keyToUtcMs(from)) / DAY_MS) + 1;
}

// Diferença, em ms, entre o relógio de parede no fuso e o UTC naquele instante.
function timeZoneOffsetMs(instantMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(instantMs / 1000) * 1000;
}

// Instante em que a data (AAAA-MM-DD) começa, à meia-noite, no fuso.
export function startOfDateKeyInTimezone(key, timeZone = DASHBOARD_DEFAULT_TIMEZONE) {
  const wallMidnight = keyToUtcMs(key);
  let instant = wallMidnight;
  for (let i = 0; i < 3; i += 1) instant = wallMidnight - timeZoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

export function buildCustomPeriodKey(from, to) {
  return `${CUSTOM_PERIOD_PREFIX}${from}:${to}`;
}

// Lê uma chave `custom:de:ate`. Só aceita o formato e datas de calendário válidas com de <= ate;
// "no futuro" e "tamanho máximo" são regras do pedido (parseDashboardPeriodRequest), não da chave.
export function parseCustomPeriodKey(key) {
  const text = String(key ?? "");
  if (!text.startsWith(CUSTOM_PERIOD_PREFIX)) return null;
  const [from, to, ...rest] = text.slice(CUSTOM_PERIOD_PREFIX.length).split(":");
  if (rest.length > 0 || !isValidDateKey(from) || !isValidDateKey(to) || from > to) return null;
  return { from, to };
}

// Chave segura para cache e trava: atalho conhecido, intervalo bem formado, ou o padrão (30d).
export function normalizeDashboardPeriodKey(periodKey) {
  if (periodKey === "7d" || periodKey === "this_month") return periodKey;
  if (parseCustomPeriodKey(periodKey)) return periodKey;
  return "30d";
}

function formatKeyBr(key) {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Valida o período pedido pela tela (`period`, `from`, `to`) e devolve a chave a usar.
 * Atalho desconhecido ou ausente → 30d (comportamento de sempre). `period=custom` exige as duas
 * datas e recusa, com mensagem clara: formato inválido, intervalo invertido, data no futuro e
 * intervalo maior que MAX_CUSTOM_PERIOD_DAYS.
 *
 * @returns {{ ok: true, periodKey: string } | { ok: false, message: string }}
 */
export function parseDashboardPeriodRequest({ period, from, to } = {}, { now = new Date(), timeZone = DASHBOARD_DEFAULT_TIMEZONE } = {}) {
  const requested = String(period ?? "").trim();
  if (requested !== "custom") {
    return { ok: true, periodKey: requested === "7d" || requested === "this_month" ? requested : "30d" };
  }

  const fromKey = String(from ?? "").trim();
  const toKey = String(to ?? "").trim();
  if (!fromKey || !toKey) {
    return { ok: false, message: "Informe a data inicial e a data final do período personalizado." };
  }
  if (!isValidDateKey(fromKey) || !isValidDateKey(toKey)) {
    return { ok: false, message: "Datas inválidas: use o formato AAAA-MM-DD, com datas que existem no calendário." };
  }
  if (fromKey > toKey) {
    return {
      ok: false,
      message: `A data inicial (${formatKeyBr(fromKey)}) é depois da data final (${formatKeyBr(toKey)}). Inverta as datas.`,
    };
  }
  const todayKey = dateKeyInTimezone(now, timeZone);
  if (fromKey > todayKey) {
    return {
      ok: false,
      message: `A data inicial (${formatKeyBr(fromKey)}) está no futuro. Escolha datas até hoje (${formatKeyBr(todayKey)}).`,
    };
  }
  if (toKey > todayKey) {
    return {
      ok: false,
      message: `A data final (${formatKeyBr(toKey)}) está no futuro. Escolha uma data final até hoje (${formatKeyBr(todayKey)}).`,
    };
  }
  const days = countDaysInclusive(fromKey, toKey);
  if (days > MAX_CUSTOM_PERIOD_DAYS) {
    return {
      ok: false,
      message: `O período escolhido tem ${days} dias; o máximo é ${MAX_CUSTOM_PERIOD_DAYS} dias. Escolha um intervalo menor.`,
    };
  }
  return { ok: true, periodKey: buildCustomPeriodKey(fromKey, toKey) };
}

/**
 * Calcula os intervalos [currentStart, currentEnd) e [previousStart, previousEnd), garantindo que o
 * período anterior tenha EXATAMENTE a mesma duração do atual.
 *
 * Atalhos (rolantes, a partir de agora): 7d e 30d = as últimas 7/30 × 24 h; "this_month" = do início
 * do mês até agora, e o anterior são os D dias imediatamente antes do início do mês (não o mês
 * calendário anterior inteiro).
 *
 * Intervalo personalizado: da meia-noite da data inicial até a meia-noite seguinte à data final, no
 * fuso do tenant; o anterior são os N dias imediatamente antes da data inicial.
 *
 * `asOf` = "agora" da análise: o fim do período, ou o instante atual se o período ainda não acabou
 * (intervalo que termina hoje). Medidas que dependem de "há quanto tempo" usam `asOf`.
 *
 * `periodInfo` descreve o período para a tela escrever a comparação por extenso:
 * `current`/`previous` em datas (AAAA-MM-DD, inclusive as duas pontas) e `days`.
 *
 * `periodInfo.inProgress` marca o período EM ANDAMENTO: ainda não terminou, então o atual está
 * incompleto e o anterior é inteiro — o número aparece pior do que é. Vale para intervalo que inclui
 * hoje e para "este mês". Atalhos rolantes (7d, 30d) não: os dois lados são janelas de mesma
 * duração terminando agora. O anterior NÃO é encurtado para a mesma fração: a tela só avisa.
 */
export function calculatePeriodDates(periodKey = "30d", referenceDate = new Date(), timeZone = DASHBOARD_DEFAULT_TIMEZONE) {
  const now = new Date(referenceDate);
  const normalizedKey = normalizeDashboardPeriodKey(periodKey);
  const custom = parseCustomPeriodKey(normalizedKey);

  let currentStart;
  let currentEnd;
  let previousStart;
  let previousEnd;
  let nominalDays;

  if (custom) {
    nominalDays = countDaysInclusive(custom.from, custom.to);
    currentStart = startOfDateKeyInTimezone(custom.from, timeZone);
    currentEnd = startOfDateKeyInTimezone(addDaysToDateKey(custom.to, 1), timeZone);
    previousEnd = new Date(currentStart);
    previousStart = startOfDateKeyInTimezone(addDaysToDateKey(custom.from, -nominalDays), timeZone);
  } else if (normalizedKey === "7d") {
    const durationMs = 7 * DAY_MS;
    currentEnd = new Date(now);
    currentStart = new Date(now.getTime() - durationMs);
    previousEnd = new Date(currentStart);
    previousStart = new Date(currentStart.getTime() - durationMs);
    nominalDays = 7;
  } else if (normalizedKey === "this_month") {
    currentEnd = new Date(now);
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const durationMs = currentEnd.getTime() - currentStart.getTime();
    previousEnd = new Date(currentStart);
    previousStart = new Date(currentStart.getTime() - durationMs);
    nominalDays = Math.max(1, Math.ceil(durationMs / DAY_MS - 1e-9));
  } else {
    const durationMs = 30 * DAY_MS;
    currentEnd = new Date(now);
    currentStart = new Date(now.getTime() - durationMs);
    previousEnd = new Date(currentStart);
    previousStart = new Date(currentStart.getTime() - durationMs);
    nominalDays = 30;
  }

  const durationMs = currentEnd.getTime() - currentStart.getTime();
  const asOf = new Date(Math.min(currentEnd.getTime(), now.getTime()));
  const inProgress = custom ? currentEnd.getTime() > now.getTime() : normalizedKey === "this_month";
  const lastDayKey = (end) => dateKeyInTimezone(new Date(end.getTime() - 1), timeZone);

  return {
    periodKey: normalizedKey,
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
    durationMs,
    asOf,
    periodInfo: {
      key: normalizedKey,
      isCustom: Boolean(custom),
      inProgress,
      days: nominalDays,
      timeZone,
      current: custom
        ? { from: custom.from, to: custom.to }
        : { from: dateKeyInTimezone(currentStart, timeZone), to: lastDayKey(currentEnd) },
      previous: custom
        ? { from: addDaysToDateKey(custom.from, -nominalDays), to: addDaysToDateKey(custom.from, -1) }
        : { from: dateKeyInTimezone(previousStart, timeZone), to: lastDayKey(previousEnd) },
    },
  };
}
