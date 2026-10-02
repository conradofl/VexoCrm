// frontend/src/lib/dashboard/formatters.ts

export function formatMetricNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number(value).toLocaleString("pt-BR");
}

export function formatDelta(delta: number | null | undefined): {
  text: string;
  isPositive: boolean;
  isNegative: boolean;
  isZero: boolean;
} {
  if (delta == null || !Number.isFinite(delta)) {
    return { text: "—", isPositive: false, isNegative: false, isZero: true };
  }
  const rounded = Math.round(delta);
  if (rounded > 0) {
    return { text: `+${rounded}%`, isPositive: true, isNegative: false, isZero: false };
  }
  if (rounded < 0) {
    return { text: `${rounded}%`, isPositive: false, isNegative: true, isZero: false };
  }
  return { text: "0%", isPositive: false, isNegative: false, isZero: true };
}

export function formatLastUpdatedTime(isoString: string | null | undefined): string {
  if (!isoString) return "Horário indisponível";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "Horário inválido";
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Horário indisponível";
  }
}

// ── Período e comparação por extenso ─────────────────────────────────────

export interface PeriodRange {
  from: string; // AAAA-MM-DD, inclusive
  to: string; // AAAA-MM-DD, inclusive
}

// Descrição do período que o backend calculou (datas no fuso do tenant).
export interface DashboardPeriodInfo {
  key: string;
  isCustom: boolean;
  // Período que ainda não terminou (inclui hoje, ou "este mês"): o atual está incompleto e o anterior
  // é inteiro. Ausente em payload antigo.
  inProgress?: boolean;
  days: number;
  timeZone?: string;
  current: PeriodRange;
  previous: PeriodRange;
}

const MONTHS_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function splitDateKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

function dayAndMonth(key: string, withYear: boolean): string {
  const { y, m, d } = splitDateKey(key);
  return `${d} de ${MONTHS_PT[m - 1]}${withYear ? ` de ${y}` : ""}`;
}

/**
 * "3 a 15 de outubro", "28 de setembro a 5 de outubro", "2 de outubro" (um dia só). O ano aparece
 * quando o intervalo não é do ano corrente ou atravessa a virada do ano.
 */
export function formatDateRange(range: PeriodRange, now: Date = new Date()): string {
  const a = splitDateKey(range.from);
  const b = splitDateKey(range.to);
  const withYear = a.y !== b.y || a.y !== now.getFullYear();

  if (range.from === range.to) return dayAndMonth(range.from, withYear);
  if (a.y === b.y && a.m === b.m) {
    return `${a.d} a ${b.d} de ${MONTHS_PT[b.m - 1]}${withYear ? ` de ${b.y}` : ""}`;
  }
  if (a.y !== b.y) return `${dayAndMonth(range.from, true)} a ${dayAndMonth(range.to, true)}`;
  return `${dayAndMonth(range.from, withYear)} a ${dayAndMonth(range.to, withYear)}`;
}

/**
 * Complemento da linha "vs 85 …": diz COM O QUE o número é comparado.
 *  - atalho de 7 ou 30 dias: "nos 30 dias anteriores"
 *  - este mês: "nos 15 dias anteriores ao início do mês"
 *  - intervalo personalizado: as datas, "em 21 a 30 de setembro"
 *  - sem a informação (payload antigo): "no período anterior"
 */
export function describePreviousPeriod(info: DashboardPeriodInfo | null | undefined, now: Date = new Date()): string {
  if (!info) return "no período anterior";
  if (info.isCustom) return `em ${formatDateRange(info.previous, now)}`;
  if (info.key === "this_month") {
    return info.days <= 1 ? "no dia anterior ao início do mês" : `nos ${info.days} dias anteriores ao início do mês`;
  }
  return info.days <= 1 ? "no dia anterior" : `nos ${info.days} dias anteriores`;
}

/** Frase do cabeçalho: "Comparando 1 a 10 de outubro contra 21 a 30 de setembro". */
export function describeComparison(info: DashboardPeriodInfo | null | undefined, now: Date = new Date()): string {
  if (!info) return "Comparação com o período anterior de mesma duração";
  if (info.isCustom) {
    return `Comparando ${formatDateRange(info.current, now)} contra ${formatDateRange(info.previous, now)}`;
  }
  const previous = describePreviousPeriod(info, now).replace(/^nos /, "os ").replace(/^no /, "o ");
  return `Comparando com ${previous}`;
}

/** Aviso do período em andamento, ao lado da comparação. null quando o período já terminou. */
export const IN_PROGRESS_NOTICE = "Período em andamento — o dia de hoje está incompleto.";

export function describePeriodStatus(info: DashboardPeriodInfo | null | undefined): string | null {
  return info?.inProgress ? IN_PROGRESS_NOTICE : null;
}

/** Valida o intervalo escolhido na tela, antes de pedir ao servidor. Devolve a mensagem ou null. */
export function validateCustomRange(from: string, to: string, today: string): string | null {
  if (!from || !to) return "Escolha a data inicial e a data final.";
  const br = (k: string) => k.split("-").reverse().join("/");
  if (from > to) return `A data inicial (${br(from)}) é depois da data final (${br(to)}). Inverta as datas.`;
  if (from > today) return `A data inicial (${br(from)}) está no futuro. Escolha datas até hoje (${br(today)}).`;
  if (to > today) return `A data final (${br(to)}) está no futuro. Escolha uma data final até hoje (${br(today)}).`;
  return null;
}

/** Data de hoje (AAAA-MM-DD) no relógio do navegador. */
export function todayDateKey(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
