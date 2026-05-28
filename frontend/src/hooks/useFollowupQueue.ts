import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export type FollowupStatus =
  | "active"
  | "awaiting_reply"
  | "replied"
  | "failed"
  | "cancelled"
  | "converted";

export interface FollowupItem {
  id: string;
  leadName: string | null;
  phone: string;
  origin: string | null;
  companyId: string;
  companyName: string;
  campaignId: string;
  campaignName: string;
  status: FollowupStatus;
  jobsSent: number;
  jobsFailed: number;
  jobsPending: number;
  lastSentAt: string | null;
  meetingDatetime: string | null;
  createdAt: string;
}

export interface FollowupQueueFilters {
  companyId?: string;
  campaignId?: string;
  status?: FollowupStatus | "";
  dateFrom?: string;
  dateTo?: string;
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
    queryFn: async (): Promise<FollowupQueuePage> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const params = new URLSearchParams();
      if (filters.companyId) params.set("companyId", filters.companyId);
      if (filters.campaignId) params.set("campaignId", filters.campaignId);
      if (filters.status)    params.set("status", filters.status);
      if (filters.dateFrom)  params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo)    params.set("dateTo", filters.dateTo);

      const res = await fetchApi(`/api/followup-queue?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

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
    mutationFn: async ({
      id,
      delayMinutes,
      templateId,
    }: {
      id: string;
      delayMinutes: number;
      templateId?: string;
    }): Promise<void> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi(`/api/followup-queue/${id}/reschedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ delayMinutes, templateId }),
      });

      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao reagendar"));
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

      const res = await fetchApi(`/api/followup-queue/${id}/discard`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
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

      const res = await fetchApi(`/api/followup-queue/${id}/convert`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao converter para inbound"));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["followup-queue"] }),
  });
}
