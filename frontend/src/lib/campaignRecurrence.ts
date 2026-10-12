export type RecurrencePattern = "daily" | "monthly" | "weekly" | "biweekly";
export type RecurrenceEndType = "until_date" | "count" | "never";
export type RecurrenceOriginKind = "crm" | "all_spreadsheets" | "spreadsheet";

export const RECURRENCE_PATTERNS = [
  { value: "daily", label: "Diária (todo dia)" },
  { value: "monthly", label: "Mensal (Dia fixo do mês)" },
  { value: "weekly", label: "Semanal (Dia fixo da semana)" },
  { value: "biweekly", label: "Quinzenal (A cada 2 semanas)" },
] as const;

export const WEEKDAY_OPTIONS = [
  { value: 1, label: "Segunda-feira" },
  { value: 2, label: "Terça-feira" },
  { value: 3, label: "Quarta-feira" },
  { value: 4, label: "Quinta-feira" },
  { value: 5, label: "Sexta-feira" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

export const WEEKDAY_SHORT_LABELS: Record<number, string> = {
  0: "Domingo",
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
};

/**
 * Retorna o texto formatado para o badge de campanha recorrente,
 * ex: "Mensal (Dia 15)" ou "Semanal (Terça)".
 */
export function formatRecurrenceBadge(c: {
  is_recurring?: boolean | null;
  recurrence_pattern?: string | null;
  recurrence_day_of_month?: number | null;
  recurrence_day_of_week?: number | null;
}): string {
  if (!c.is_recurring) return "";
  const pattern = c.recurrence_pattern || "monthly";
  if (pattern === "daily") return "Diária";
  if (pattern === "monthly") {
    return `Mensal (Dia ${c.recurrence_day_of_month || 15})`;
  }
  const dow = c.recurrence_day_of_week ?? 2;
  const dayName = WEEKDAY_SHORT_LABELS[dow] || "Terça";
  if (pattern === "biweekly") {
    return `Quinzenal (${dayName})`;
  }
  return `Semanal (${dayName})`;
}

/**
 * Formata a data/hora para o formato "DD/MM às HH:mm" no fuso DO NAVEGADOR.
 * Para o próximo envio de campanha recorrente use o `next_run_label` que a API devolve: ele já vem no fuso do tenant.
 */
export function formatNextRunDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month} às ${hours}:${minutes}`;
}

/**
 * O que a origem do público significa numa campanha que repete. Duas frases, nenhuma trava: o dono decide com o que é
 * verdade na mão.
 */
export const RECURRENCE_ORIGIN_NOTES: Record<RecurrenceOriginKind, string> = {
  crm: "O público é recalculado a cada envio — quem entrar na base depois também recebe.",
  all_spreadsheets:
    "O público é recalculado a cada envio — quem entrar em qualquer planilha importada depois também recebe.",
  spreadsheet: "O público é sempre o mesmo — as planilhas escolhidas agora. Quem entrar depois não entra.",
};

/** "Hoje seriam 1.482 leads." — recorrente não tem limite por envio: é o público inteiro. */
export function formatAudienceToday(audience?: { total: number } | null): string | null {
  if (!audience) return null;
  const n = audience.total;
  return `Hoje seriam ${n.toLocaleString("pt-BR")} lead${n === 1 ? "" : "s"}.`;
}

/** Texto do campo de lotes/limite quando a campanha repete. */
export const RECURRENCE_NO_LIMIT_REASON =
  "Campanha que repete não usa lotes nem limite por envio: cada envio cobre o público inteiro, e a cota diária do chip é o freio. Desligue a repetição para usar lotes.";

/**
 * O que a linha da campanha diz sobre a repetição, em texto: próximo envio (no fuso do tenant, a API calcula),
 * repetição encerrada, ou parada esperando o dono declarar o fim.
 */
export function recurrenceStatusText(c: {
  is_recurring?: boolean | null;
  recurrence_end_type?: string | null;
  recurrence_ended_label?: string | null;
  next_run_label?: string | null;
  next_run_at?: string | null;
}): string | null {
  if (!c.is_recurring) return null;
  if (!c.recurrence_end_type) return "Parada: salve de novo declarando quando termina";
  if (c.recurrence_ended_label) return `Repetição encerrada em ${c.recurrence_ended_label}`;
  if (c.next_run_label) return `Próximo envio: ${c.next_run_label}`;
  if (c.next_run_at) return `Próximo envio: ${formatNextRunDate(c.next_run_at)}`;
  return null;
}
