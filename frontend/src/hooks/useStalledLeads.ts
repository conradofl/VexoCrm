// frontend/src/hooks/useStalledLeads.ts
// Hook React Query para Leads Parados (Pilar 1: Aviso de Lead Parado - Nenhum Lead Esquecido)

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiJson } from "@/lib/api";

export interface StalledLead {
  id: string;
  client_id?: string;
  nome?: string | null;
  telefone?: string | null;
  phone?: string | null;
  stage?: string | null;
  temperature?: string | null;
  tags?: string[] | null;
  raw_chat_summary?: string | null;
  last_message?: string | null;
  days_idle: number;
  last_interaction_at?: string | null;
  last_message_at?: string | null;
  sdr_rotation_owner?: string | null;
  assigned_to?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StalledLeadsData {
  count: number;
  minDays: number;
  reactivation_enabled?: boolean;
  reactivation_stalled_days?: number;
  reactivation_cadence_id?: string | null;
  leads: StalledLead[];
}

export function useStalledLeads(
  clientId: string,
  minDays: number | null = null,
  options?: { limit?: number; offset?: number; stage?: string; ownerUid?: string }
) {
  const { isAuthenticated, getIdToken } = useAuth();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const stage = options?.stage || "";
  const ownerUid = options?.ownerUid || "";

  return useQuery({
    queryKey: ["stalledLeads", clientId, minDays, limit, offset, stage, ownerUid],
    queryFn: async (): Promise<StalledLeadsData> => {
      const token = await getIdToken();
      const p = new URLSearchParams();
      p.set("clientId", clientId);
      if (minDays !== null && minDays !== undefined) {
        p.set("minDays", String(minDays));
      }
      p.set("limit", String(limit));
      p.set("offset", String(offset));
      if (stage && stage !== "all") p.set("stage", stage);
      if (ownerUid) p.set("ownerUid", ownerUid);

      const res = await fetchApi(`/api/leads/stalled?${p.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return readApiJson<StalledLeadsData>(res, "Falha ao consultar leads parados.");
    },
    enabled: isAuthenticated && Boolean(clientId),
    staleTime: 30_000,
  });
}

/**
 * Mutation para notificar responsáveis por leads parados (Canal B)
 */
export function useNotifyStalledLeads() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, minDays }: { clientId: string; minDays?: number | null }) => {
      const token = await getIdToken();
      const res = await fetchApi("/api/leads/stalled/notify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId, minDays: minDays ?? undefined }),
      });
      return readApiJson<{ success: boolean; inserted: number }>(res, "Falha ao sincronizar notificações.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
