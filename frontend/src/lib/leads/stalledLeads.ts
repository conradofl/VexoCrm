// frontend/src/lib/leads/stalledLeads.ts
// Regras e formatações do Pilar 1: Aviso de Lead Parado (Nenhum Lead Esquecido)

export const STALLED_MIN_DAYS_DEFAULT = 3;

const CLOSED_STAGES = new Set(["buyer", "fechado", "perdido", "descartado", "lost"]);

export function isLeadStageClosed(stage?: string | null): boolean {
  if (!stage) return false;
  return CLOSED_STAGES.has(stage.toLowerCase().trim());
}

export function computeLeadDaysIdle(lead: {
  days_idle?: number | null;
  last_message_at?: string | null;
  last_interaction_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  stage?: string | null;
}): number {
  if (isLeadStageClosed(lead.stage)) {
    return 0;
  }
  if (typeof lead.days_idle === "number" && !isNaN(lead.days_idle)) {
    return Math.max(0, lead.days_idle);
  }
  const dateStr = lead.last_message_at || lead.last_interaction_at || lead.updated_at || lead.created_at;
  if (!dateStr) return 0;
  const timestamp = new Date(dateStr).getTime();
  if (isNaN(timestamp)) return 0;
  const now = Date.now();
  const diffMs = now - timestamp;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export function isLeadStalled(
  lead: {
    days_idle?: number | null;
    last_message_at?: string | null;
    last_interaction_at?: string | null;
    updated_at?: string | null;
    created_at?: string | null;
    stage?: string | null;
  },
  minDays: number = STALLED_MIN_DAYS_DEFAULT
): boolean {
  if (isLeadStageClosed(lead.stage)) return false;
  const idle = computeLeadDaysIdle(lead);
  return idle >= minDays;
}
