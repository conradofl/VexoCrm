// frontend/src/hooks/useLeadReactivation.ts
// Hook React Query para gerenciamento das configurações e execução da Reativação Automática (Pilar 2)

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi, readApiJson } from "@/lib/api";

export interface ReactivationCadence {
  id: string;
  name: string;
  status: string;
  company_id?: string;
}

export interface ReactivationSettingsResponse {
  client_id: string;
  reactivation_enabled: boolean;
  reactivation_stalled_days: number;
  reactivation_cadence_id: string | null;
  reactivation_cooldown_days: number;
  eligible_count: number;
  reactivated_last_30_days: number;
  cadences: ReactivationCadence[];
}

export interface UpdateReactivationSettingsInput {
  clientId: string;
  reactivation_enabled?: boolean;
  reactivation_stalled_days?: number;
  reactivation_cadence_id?: string | null;
  reactivation_cooldown_days?: number;
}

export interface RunReactivationResponse {
  success: boolean;
  client_id?: string;
  cadence_id?: string;
  cadence_name?: string;
  reactivated_count: number;
  total_eligible: number;
  leads?: Array<{
    id: string;
    nome?: string;
    telefone?: string;
    days_idle?: number;
    schedule_id?: string;
  }>;
  reason?: string;
  message?: string;
}

/**
 * Consulta as configurações de reativação do tenant, cadências disponíveis e métricas de impacto
 */
export function useLeadReactivationSettings(clientId?: string) {
  return useQuery({
    queryKey: ["lead-reactivation-settings", clientId],
    queryFn: async (): Promise<ReactivationSettingsResponse> => {
      if (!clientId) {
        throw new Error("clientId é obrigatório para consultar configurações de reativação.");
      }
      const res = await fetchApi(`/api/leads/reactivation-settings?clientId=${encodeURIComponent(clientId)}`);
      return readApiJson<ReactivationSettingsResponse>(res, "leads-reactivation-settings");
    },
    enabled: Boolean(clientId),
    staleTime: 30_000,
  });
}

/**
 * Atualiza as configurações de reativação automática
 */
export function useUpdateLeadReactivationSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateReactivationSettingsInput): Promise<ReactivationSettingsResponse> => {
      const res = await fetchApi("/api/leads/reactivation-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return readApiJson<ReactivationSettingsResponse>(res, "leads-reactivation-settings-update");
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lead-reactivation-settings", variables.clientId] });
      queryClient.invalidateQueries({ queryKey: ["crm-client"] });
    },
  });
}

/**
 * Dispara a execução manual da reativação ("Reativar Leads Parados Agora")
 */
export function useRunLeadReactivation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId }: { clientId: string }): Promise<RunReactivationResponse> => {
      const res = await fetchApi("/api/leads/reactivation-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      return readApiJson<RunReactivationResponse>(res, "leads-reactivation-run");
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lead-reactivation-settings", variables.clientId] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["stalled-leads"] });
      queryClient.invalidateQueries({ queryKey: ["followup-queue"] });
    },
  });
}
