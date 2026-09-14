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
  isOverdue?: boolean;
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
    isReminderOverdue?: boolean;
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

/**
 * Hook para listar lembretes pessoais com filtros (ex: status = 'completed' ou 'pending').
 */
export function useLeadReminders(
  clientId: string | null | undefined,
  phone?: string | null,
  status: "pending" | "completed" = "pending"
) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["lead-reminders", clientId, phone, status],
    enabled: isAuthenticated && Boolean(clientId),
    queryFn: async (): Promise<LeadReminder[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const params = new URLSearchParams({
        clientId: clientId || "",
        status,
      });
      if (phone) params.set("phone", phone);

      const res = await fetchApi(`/api/reminders?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao listar lembretes"));
      }

      const json = await readApiJson<{ success: boolean; items: any[] }>(res, "list_reminders");
      return (json.items || []).map((item) => ({
        id: item.id,
        clientId: item.clientId || item.client_id,
        leadId: item.leadId || item.lead_id || null,
        phone: item.phone,
        leadName: item.leadName || item.lead_name || null,
        title: item.title,
        notes: item.notes || null,
        remindAt: item.remindAt || item.remind_at,
        assignedToUid: item.assignedToUid || item.assigned_to_uid,
        assignedToName: item.assignedToName || item.assigned_to_name || null,
        createdByUid: item.createdByUid || item.created_by_uid,
        createdByName: item.createdByName || item.created_by_name || null,
        status: item.status,
        completedAt: item.completedAt || item.completed_at || null,
        completedByUid: item.completedByUid || item.completed_by_uid || null,
        createdAt: item.createdAt || item.created_at,
        updatedAt: item.updatedAt || item.updated_at,
        isDueTodayOrOverdue: Boolean(item.isDueTodayOrOverdue ?? item.is_due_today_or_overdue),
        isOverdue: Boolean(item.isOverdue ?? item.is_overdue),
      }));
    },
    staleTime: 5000,
  });
}

export interface UpdateLeadReminderPayload {
  id: string;
  clientId?: string;
  title?: string;
  notes?: string | null;
  remindAt?: string;
  assignedToUid?: string | null;
  assignedToName?: string | null;
  status?: "pending" | "completed";
}

/**
 * Hook para atualizar título, anotações, data ou status (desfazer/reabrir) de um lembrete.
 */
export function useUpdateLeadReminder(clientId: string | null | undefined) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateLeadReminderPayload) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const { id, ...data } = payload;
      const res = await fetchApi(`/api/reminders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...data, clientId: data.clientId || clientId }),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao atualizar lembrete"));
      }

      return readApiJson<{ success: boolean; reminder: any }>(res, "update_reminder");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-reminders-summary"] });
      queryClient.invalidateQueries({ queryKey: ["lead-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

