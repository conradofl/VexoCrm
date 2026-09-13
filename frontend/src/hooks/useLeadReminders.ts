// frontend/src/hooks/useLeadReminders.ts
// Hooks para Lembretes Pessoais e Agendamento com Estado (WhatsApp / CRM)
// Utiliza React Query e fetchApi conforme as diretrizes do Vexo OS.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { type FollowupItem } from "./useFollowupQueue";

export interface LeadReminder {
  id: string;
  clientId: string;
  leadId: string | null;
  phone: string;
  leadName: string | null;
  title: string;
  notes: string | null;
  remindAt: string;
  assignedToUid: string;
  assignedToName: string | null;
  createdByUid: string;
  createdByName: string | null;
  status: "pending" | "completed" | "cancelled";
  completedAt: string | null;
  completedByUid: string | null;
  createdAt: string;
  updatedAt?: string;
  isDueTodayOrOverdue?: boolean;
  isForCurrentUser?: boolean;
}

export interface InboxSummaryItem {
  phone: string;
  activeSchedule: (FollowupItem & { totalActiveCount?: number; rawPhone?: string }) | null;
  activeReminders: LeadReminder[];
  todayDue: {
    hasScheduledToday: boolean;
    scheduledAt: string | null;
    hasReminderToday: boolean;
    reminderTitle: string | null;
    reminderAt: string | null;
  } | null;
}

export interface InboxRemindersSummary {
  success: boolean;
  todayCount: number;
  scheduledTodayCount: number;
  remindersTodayCount: number;
  itemsByPhone: Record<string, InboxSummaryItem>;
}

export interface CreateLeadReminderPayload {
  clientId?: string;
  leadId?: string | null;
  phone: string;
  leadName?: string | null;
  title: string;
  notes?: string | null;
  remindAt: string;
  assignedToUid?: string | null;
  assignedToName?: string | null;
}

/**
 * Hook para obter o sumário de agendamentos e lembretes do Inbox,
 * mapeando estado ativo e pendências de 'Hoje' por telefone canônico.
 */
export function useInboxRemindersSummary(clientId: string | null | undefined) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["inbox-reminders-summary", clientId],
    enabled: isAuthenticated && Boolean(clientId),
    queryFn: async (): Promise<InboxRemindersSummary> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi(`/api/reminders/inbox-summary?clientId=${encodeURIComponent(clientId || "")}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao carregar sumário de lembretes"));
      }

      return readApiJson<InboxRemindersSummary>(res, "inbox_summary");
    },
    refetchInterval: 15000,
    staleTime: 5000,
  });
}

/**
 * Hook para criar um lembrete pessoal/interno (não envia WhatsApp).
 */
export function useCreateLeadReminder(clientId: string | null | undefined) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateLeadReminderPayload) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi("/api/reminders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...payload, clientId: payload.clientId || clientId }),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao criar lembrete pessoal"));
      }

      return readApiJson<{ success: boolean; reminder: LeadReminder }>(res, "create_reminder");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-reminders-summary"] });
      queryClient.invalidateQueries({ queryKey: ["lead-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

/**
 * Hook para concluir um lembrete pessoal com 1 clique.
 */
export function useCompleteLeadReminder(clientId: string | null | undefined) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reminderId: string) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi(`/api/reminders/${encodeURIComponent(reminderId)}/complete`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId }),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao concluir lembrete"));
      }

      return readApiJson<{ success: boolean; reminder: LeadReminder }>(res, "complete_reminder");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-reminders-summary"] });
      queryClient.invalidateQueries({ queryKey: ["lead-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

/**
 * Hook para excluir fisicamente um lembrete pessoal.
 */
export function useDeleteLeadReminder(clientId: string | null | undefined) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reminderId: string) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi(`/api/reminders/${encodeURIComponent(reminderId)}?clientId=${encodeURIComponent(clientId || "")}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao excluir lembrete"));
      }

      return readApiJson<{ success: boolean; deletedId: string }>(res, "delete_reminder");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-reminders-summary"] });
      queryClient.invalidateQueries({ queryKey: ["lead-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}
