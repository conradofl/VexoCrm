export const RECURRENCE_PATTERNS = [
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
 * Formata a data/hora para o formato "DD/MM às HH:mm".
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
