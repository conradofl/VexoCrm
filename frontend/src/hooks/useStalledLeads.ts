// frontend/src/hooks/useStalledLeads.ts
// Hook React Query para Leads Parados (Pilar 1: Aviso de Lead Parado - Nenhum Lead Esquecido)

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiJson } from "@/lib/api";

export interface StalledLead {
  id: string;
  nome?: string | null;
  telefone?: string | null;
  phone?: string | null;
  stage?: string | null;
  temperature?: string | null;
  tags?: string[] | null;
  raw_chat_summary?: string | null;
  days_idle: number;
  last_interaction_at?: string | null;
  last_message_at?: string | null;
  sdr_rotation_owner?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StalledLeadsData {
  count: number;
  minDays: number;
  leads: StalledLead[];
}

export function useStalledLeads(
  clientId: string,
  minDays: number = 3,
  options?: { limit?: number; offset?: number; stage?: string }
) {
  const { isAuthenticated, getIdToken } = useAuth();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const stage = options?.stage || "";

  return useQuery({
    queryKey: ["stalledLeads", clientId, minDays, limit, offset, stage],
    queryFn: async (): Promise<StalledLeadsData> => {
      const token = await getIdToken();
      const p = new URLSearchParams();
      p.set("clientId", clientId);
      p.set("minDays", String(minDays));
      p.set("limit", String(limit));
      p.set("offset", String(offset));
      if (stage && stage !== "all") p.set("stage", stage);

      const res = await fetchApi(`/api/leads/stalled?${p.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return readApiJson<StalledLeadsData>(res, "Falha ao consultar leads parados.");
    },
    enabled: isAuthenticated && Boolean(clientId),
    staleTime: 30_000,
  });
}
