import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export type FollowupStatus = "pending" | "replied" | "scheduled" | "discarded" | "converted";

export interface FollowupItem {
  id: string;
  campaignId: string;
  campaignName: string;
  leadId: string;
  leadName: string | null;
  phone: string;
  clientId: string;
  status: FollowupStatus;
  scheduledAt: string | null;
  lastContactAt: string | null;
  createdAt: string;
}

export interface FollowupQueueFilters {
  campaignId?: string;
  status?: FollowupStatus | "";
  dateFrom?: string;
  dateTo?: string;
  clientId?: string;
}

export interface FollowupQueuePage {
  items: FollowupItem[];
  total: number;
}

export function useFollowupQueue(filters: FollowupQueueFilters) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["followup-queue", filters],
    enabled: isAuthenticated,
    queryFn: async (): Promise<FollowupQueuePage | null> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const params = new URLSearchParams();
      if (filters.campaignId) params.set("campaignId", filters.campaignId);
      if (filters.status) params.set("status", filters.status);
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) params.set("dateTo", filters.dateTo);
      if (filters.clientId) params.set("clientId", filters.clientId);

      const res = await fetchApi(`/api/followup-queue?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 404) return null;

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao carregar fila de followup"));
      }

      return readApiJson<FollowupQueuePage>(res, "followup_queue");
    },
    retry: false,
    staleTime: 30 * 1000,
  });
}

export function useRescheduleFollowup() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, scheduledAt }: { id: string; scheduledAt: string }): Promise<FollowupItem> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi(`/api/followup-queue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scheduledAt }),
      });

      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao reagendar"));
      const data = await readApiJson<{ item: FollowupItem }>(res, "reschedule_followup");
      return data.item;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["followup-queue"] }),
  });
}

export function useDiscardFollowup() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi(`/api/followup-queue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: "discarded" }),
      });

      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao descartar"));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["followup-queue"] }),
  });
}

export function useConvertToInbound() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi(`/api/followup-queue/${id}/convert-inbound`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao converter para inbound"));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["followup-queue"] }),
  });
}
