// Tempo de espera de uma conversa, como o operador lê na lista: "38min", "1h12",
// "4h", "ontem", "3 dias". Função pura: recebe o instante da última mensagem do
// lead e o "agora", nunca lê o relógio nem o fuso da máquina por conta própria.
//
// Regras:
// - menos de 1 minuto: "agora"
// - menos de 1 hora: minutos ("38min")
// - menos de 3 horas: horas e minutos ("1h12"; minuto zero vira "2h")
// - menos de 12 horas: só horas ("4h"), mesmo atravessando a meia-noite. Quem
//   escreveu 23h50 e está parado desde então não está parado "desde ontem" às 0h10.
// - 12 horas ou mais: conta por dia de calendário NO FUSO DO NEGÓCIO. Mesmo dia
//   continua em horas ("13h"), dia anterior é "ontem", antes disso "N dias".

export const WAIT_TIME_ZONE = "America/Sao_Paulo";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function toMs(value: Date | number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// Número do dia de calendário (dias desde 1970) no fuso informado.
function calendarDayNumber(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Math.round(Date.UTC(get("year"), get("month") - 1, get("day")) / (24 * HOUR));
}

export function formatWaitTime(
  since: Date | number | string | null | undefined,
  now: Date | number | string,
  timeZone: string = WAIT_TIME_ZONE,
): string {
  const sinceMs = toMs(since);
  const nowMs = toMs(now);
  if (sinceMs === null || nowMs === null) return "";

  const elapsed = nowMs - sinceMs;
  // Relógio do servidor adiantado em relação ao navegador: não mostrar tempo negativo.
  if (elapsed < MINUTE) return "agora";

  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}min`;

  const hours = Math.floor(elapsed / HOUR);
  if (elapsed < 3 * HOUR) {
    const minutes = Math.floor((elapsed - hours * HOUR) / MINUTE);
    return minutes === 0 ? `${hours}h` : `${hours}h${String(minutes).padStart(2, "0")}`;
  }
  if (elapsed < 12 * HOUR) return `${hours}h`;

  const days = calendarDayNumber(nowMs, timeZone) - calendarDayNumber(sinceMs, timeZone);
  if (days <= 0) return `${hours}h`;
  if (days === 1) return "ontem";
  return `${days} dias`;
}

// Rótulo do item da lista: "4h parada", "desde ontem", "3 dias parada".
export function formatWaitLabel(
  since: Date | number | string | null | undefined,
  now: Date | number | string,
  timeZone: string = WAIT_TIME_ZONE,
): string {
  const text = formatWaitTime(since, now, timeZone);
  if (!text) return "";
  if (text === "agora") return "agora";
  if (text === "ontem") return "desde ontem";
  return `${text} parada`;
}

// Urgência da espera, usada na cor da borda esquerda do item.
// - "fresh": menos de 1 hora
// - "warm": de 1 hora a menos de 24 horas
// - "late": 24 horas ou mais
export type WaitUrgency = "fresh" | "warm" | "late";

export function waitUrgency(
  since: Date | number | string | null | undefined,
  now: Date | number | string,
): WaitUrgency | null {
  const sinceMs = toMs(since);
  const nowMs = toMs(now);
  if (sinceMs === null || nowMs === null) return null;
  const elapsed = nowMs - sinceMs;
  if (elapsed < HOUR) return "fresh";
  if (elapsed < 24 * HOUR) return "warm";
  return "late";
}
