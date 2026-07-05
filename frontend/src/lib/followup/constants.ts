// Extraído de src/pages/FollowupQueue.tsx (Onda 4 Run F6) — movimento puro, sem alteração de forma.
import type { FollowupStatus } from "@/hooks/useFollowupQueue";
import type { FupCampaign, FupTemplate } from "@/hooks/useFollowupAdmin";

// ─── FILA OPERACIONAL ─────────────────────────────────────────────────────────

export const QUEUE_STATUS_LABELS: Record<FollowupStatus, string> = {
  active:        "Ativo",
  awaiting_reply:"Aguardando resposta",
  replied:       "Respondeu",
  failed:        "Falhou",
  cancelled:     "Cancelado",
  converted:     "Convertido",
};

export const QUEUE_STATUS_COLORS: Record<FollowupStatus, string> = {
  active:        "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  awaiting_reply:"border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  replied:       "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed:        "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400",
  cancelled:     "border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/20 dark:text-slate-500",
  converted:     "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400",
};

// ─── SUGESTÕES IA ─────────────────────────────────────────────────────────────

export const SUGGESTIONS_TAB_LABELS = {
  pending:  "Pendentes",
  approved: "Aprovadas",
  rejected: "Rejeitadas",
} as const;

// ─── CAMPANHAS & TEMPLATES ────────────────────────────────────────────────────

export const CAMPAIGN_STATUS_LABELS: Record<FupCampaign["status"], string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  archived: "Arquivada",
};

export const CAMPAIGN_STATUS_COLORS: Record<FupCampaign["status"], string> = {
  draft: "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
  active: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  paused: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  archived: "border-slate-300 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500",
};

export const EMPTY_CAMPAIGN_FORM = { name: "", description: "", default_origin: "" };

export const SEGMENT_VARS: Record<string, string[]> = {
  geral: ["{{lead_name}}", "{{meeting_date}}", "{{meeting_time}}"],
  b2b: ["{{lead_name}}", "{{company_name}}", "{{role}}", "{{meeting_date}}", "{{meeting_time}}"],
  restaurante: ["{{lead_name}}", "{{reservation_date}}", "{{number_of_guests}}"],
  turismo: ["{{lead_name}}", "{{destination}}", "{{travel_date}}"],
};

export const TEMPLATE_EXAMPLE_DATA: Record<string, Record<string, string>> = {
  geral: { lead_name: "Maria Silva", meeting_date: "20/06/2026", meeting_time: "14:00" },
  b2b: { lead_name: "João Silva", company_name: "Tech Corp", role: "CEO", meeting_date: "20/06/2026", meeting_time: "14:00" },
  restaurante: { lead_name: "Carlos", reservation_date: "20/06/2026 às 20:00", number_of_guests: "4 pessoas" },
  turismo: { lead_name: "Ana", destination: "Paris", travel_date: "15/08/2026" },
};

export const EMPTY_TEMPLATE_FORM = {
  name: "",
  message: "",
  trigger_type: "no_reply" as FupTemplate["trigger_type"],
  trigger_value: 1,
  trigger_unit: "days" as FupTemplate["trigger_unit"],
  segment: "geral",
  is_active: true,
};

// ─── MÉTRICAS (ANALYTICS) ─────────────────────────────────────────────────────

export const ANALYTICS_COLORS = ["#818cf8", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#a78bfa", "#2dd4bf", "#fb923c"];

// ─── CONFIGURAÇÕES (EMPRESAS) ─────────────────────────────────────────────────

export const EMPTY_COMPANY_FORM = {
  name: "",
  evolution_instance: "",
  webhook_url: "",
  calendly_webhook_secret: "",
  panel_access: false,
  auto_pause_on_reply: false,
  auto_pause_on_calendly: false,
  sending_window_start: "08:00",
  sending_window_end: "18:00",
  sending_days: "1,2,3,4,5",
};
