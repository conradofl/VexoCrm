// ─── STATUS & LABELS ─────────────────────────────────────────────────────────

export const FOLLOWUP_STATUS_LABELS: Record<string, string> = {
  active: "Agendado",
  awaiting_reply: "Aguardando Resposta",
  replied: "Respondeu",
  failed: "Falhou",
  cancelled: "Cancelado",
  completed: "Concluído",
  converted: "Convertido",
};

export const FOLLOWUP_STATUS_COLORS: Record<string, string> = {
  active: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800",
  awaiting_reply: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  replied: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800",
  failed: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
  cancelled: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
  converted: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
};

