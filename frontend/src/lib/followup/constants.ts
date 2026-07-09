// Extraído de src/pages/FollowupQueue.tsx (Onda 4 Run F6) — movimento puro, sem alteração de forma.
// Constantes das abas não renderizadas (Fila/Sugestões/Campanhas) removidas junto com as abas.

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
  engine_scan_interval_hours: 6,
  never_contacted_delay_hours: 2,
  no_reply_delay_hours: 48,
  livpub_inactive_delay_months: 6,
};
