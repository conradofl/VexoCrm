import type { LeadClientEvolutionInstance } from "@/hooks/useLeadClients";

export function getWarmingDay(
  instance: LeadClientEvolutionInstance,
  selectedDays: Record<string, number>
) {
  if (selectedDays[instance.id] !== undefined) {
    return selectedDays[instance.id];
  }
  const currentLimit = instance.daily_limit_override ?? 100;
  return Math.min(10, Math.max(1, Math.round(currentLimit / 10)));
}
