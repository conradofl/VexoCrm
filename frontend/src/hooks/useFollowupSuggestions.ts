import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export interface FollowupSuggestion {
  id: string;
  companyId: string;
  companyName: string;
  campaignId: string | null;
  campaignName: string | null;
  leadName: string | null;
  phone: string;
  leadSource: string | null;
  reason: string;
  templateId: string | null;
  templateName: string | null;
  templateMessage: string | null;
  suggestedMessage: string | null;
  status: "pending" | "approved" | "rejected";
  approvedBy: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  createdAt: string;
}

// Raw API response uses snake_case — map to camelCase
function mapSuggestion(raw: Record<string, unknown>): FollowupSuggestion {
  return {
    id:               raw.id as string,
    companyId:        raw.company_id as string,
    companyName:      (raw.company_name as string) ?? "",
    campaignId:       (raw.campaign_id as string) ?? null,
    campaignName:     (raw.campaign_name as string) ?? null,
    leadName:         (raw.lead_name as string) ?? null,
    phone:            (raw.phone as string) ?? "",
    leadSource:       (raw.lead_source as string) ?? null,
    reason:           raw.reason as string,
    templateId:       (raw.template_id as string) ?? null,
    templateName:     (raw.template_name as string) ?? null,
    templateMessage:  (raw.template_message as string) ?? null,
    suggestedMessage: (raw.suggested_message as string) ?? null,
    status:           raw.status as FollowupSuggestion["status"],
    approvedBy:       (raw.approved_by as string) ?? null,
    approvedAt:       (raw.approved_at as string) ?? null,
    executedAt:       (raw.executed_at as string) ?? null,
    createdAt:        raw.created_at as string,
  };
}

// ── Fetch list ─────────────────────────────────────────────────────────────────

export function useFollowupSuggestions(companyId?: string, status = "pending") {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["followup-suggestions", companyId, status],
    enabled: isAuthenticated,
    queryFn: async (): Promise<FollowupSuggestion[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const params = new URLSearchParams({ status });
      if (companyId) params.set("companyId", companyId);

      const res = await fetchApi(`/api/followup/suggestions?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao carregar sugestões"));

      const data = await readApiJson<{ suggestions: Record<string, unknown>[] }>(res, "suggestions");
      return (data.suggestions ?? []).map(mapSuggestion);
    },
    staleTime: 30_000,
    retry: false,
  });
}

// ── Count for badge ────────────────────────────────────────────────────────────

export function useFollowupSuggestionCount(companyId?: string) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["followup-suggestions-count", companyId],
    enabled: isAuthenticated,
    queryFn: async (): Promise<number> => {
      const token = await getIdToken();
      if (!token) return 0;

      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);

      const res = await fetchApi(`/api/followup/suggestions/count?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return 0;

      const data = await readApiJson<{ count: number }>(res, "suggestions_count");
      return data.count ?? 0;
    },
    staleTime: 60_000,
    retry: false,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export function useApproveSuggestion() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, message }: { id: string; message?: string }): Promise<void> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi(`/api/followup/suggestions/${id}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao aprovar sugestão"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followup-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["followup-suggestions-count"] });
    },
  });
}

export function useRejectSuggestion() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi(`/api/followup/suggestions/${id}/reject`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao rejeitar sugestão"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followup-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["followup-suggestions-count"] });
    },
  });
}

export function useRunAutomationEngine() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi("/api/followup/engine/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao acionar o motor de reativação"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followup-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["followup-suggestions-count"] });
    },
  });
}

export function useApproveSuggestionBatch() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]): Promise<{ approved: string[]; failed: Array<{ id: string; reason: string }> }> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi("/api/followup/suggestions/approve-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao aprovar em lote"));
      return readApiJson(res, "batch_approve");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followup-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["followup-suggestions-count"] });
    },
  });
}
