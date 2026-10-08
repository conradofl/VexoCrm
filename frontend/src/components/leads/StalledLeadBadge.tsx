// frontend/src/components/leads/StalledLeadBadge.tsx
// Badge visual na linha do lead: "⚠️ Xd sem resposta" (Pilar 1: Aviso de Lead Parado)

import React from "react";
import { computeLeadDaysIdle, isLeadStalled } from "@/lib/leads/stalledLeads";
import { cn } from "@/lib/utils";

export interface StalledLeadBadgeProps {
  lead: {
    id?: string;
    days_idle?: number | null;
    last_message_at?: string | null;
    last_interaction_at?: string | null;
    updated_at?: string | null;
    created_at?: string | null;
    stage?: string | null;
  };
  minDays?: number;
  className?: string;
}

export function StalledLeadBadge({ lead, minDays = 3, className }: StalledLeadBadgeProps) {
  if (!isLeadStalled(lead, minDays)) return null;
  const daysIdle = computeLeadDaysIdle(lead);

  return (
    <span
      data-testid={lead.id ? `lead-stalled-badge-${lead.id}` : "lead-stalled-badge"}
      className={cn(
        "inline-flex items-center gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10.5px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap",
        className
      )}
      title={`Lead parado há ${daysIdle} dias sem resposta`}
    >
      <span>⚠️</span>
      <span>{daysIdle}d sem resposta</span>
    </span>
  );
}
