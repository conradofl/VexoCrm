import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export interface EventoEsteirasStatus {
  esteira1: "aguardando_disparo" | "enviado" | "erro" | string;
  esteira2: "processando_prompts" | "enviado" | "aguardando_vaga" | string;
  esteira5: "aguardando_data" | "cupom_enviado" | string;
  [key: string]: any;
}

export interface EventoItem {
  id: string;
  client_id?: string;
  name: string;
  date: string;
  location?: string | null;
  description?: string | null;
  tickets_sold?: number;
  ticketsSold?: number;
  esteiras_status?: EventoEsteirasStatus;
  esteirasStatus?: EventoEsteirasStatus;
  esteiras?: EventoEsteirasStatus;
  created_at?: string;
  updated_at?: string;
}

export interface CreateEventoInput {
  name: string;
  date: string;
  location?: string | null;
  description?: string | null;
  tickets_sold?: number;
  esteiras_status?: EventoEsteirasStatus;
  clientId?: string;
  client_id?: string;
}

export interface UpdateEventoInput {
  id: string;
  name?: string;
  date?: string;
  location?: string | null;
  description?: string | null;
  tickets_sold?: number;
  esteiras_status?: EventoEsteirasStatus;
  clientId?: string;
  client_id?: string;
}

export function eventosQueryKey(clientId?: string | null) {
  return ["eventos", clientId || "current"] as const;
}

export function useEventos(clientId?: string | null) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: eventosQueryKey(clientId),
    enabled: isAuthenticated,
    queryFn: async (): Promise<EventoItem[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado");

      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);

      const res = await fetchApi(`/api/eventos${params.toString() ? `?${params.toString()}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errText = await readApiErrorMessage(res, "Falha ao carregar eventos");
        throw new Error(errText);
      }

      const list = await readApiJson<EventoItem[]>(res, "eventos-list");
      return (list || []).map((e) => ({
        ...e,
        esteiras: e.esteiras || e.esteiras_status || e.esteirasStatus || {
          esteira1: "aguardando_disparo",
          esteira2: "processando_prompts",
          esteira5: "aguardando_data",
        },
      }));
    },
    staleTime: 15_000,
  });
}

export function useCreateEvento() {
  const queryClient = useQueryClient();
  const { getIdToken } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateEventoInput): Promise<EventoItem> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado");

      const res = await fetchApi("/api/eventos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const errText = await readApiErrorMessage(res, "Falha ao criar evento");
        throw new Error(errText);
      }

      return readApiJson<EventoItem>(res, "create-evento");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eventos"] });
      queryClient.invalidateQueries({ queryKey: ["fup-calendar-month"] });
      queryClient.invalidateQueries({ queryKey: ["fup-calendar-day"] });
    },
  });
}

export function useUpdateEvento() {
  const queryClient = useQueryClient();
  const { getIdToken } = useAuth();

  return useMutation({
    mutationFn: async (input: UpdateEventoInput): Promise<EventoItem> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado");

      const { id, ...payload } = input;
      const res = await fetchApi(`/api/eventos/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await readApiErrorMessage(res, "Falha ao atualizar evento");
        throw new Error(errText);
      }

      return readApiJson<EventoItem>(res, "update-evento");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eventos"] });
      queryClient.invalidateQueries({ queryKey: ["fup-calendar-month"] });
      queryClient.invalidateQueries({ queryKey: ["fup-calendar-day"] });
    },
  });
}

export function useDeleteEvento() {
  const queryClient = useQueryClient();
  const { getIdToken } = useAuth();

  return useMutation({
    mutationFn: async ({ id, clientId }: { id: string; clientId?: string }): Promise<{ success: boolean; id: string }> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado");

      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);

      const res = await fetchApi(`/api/eventos/${id}${params.toString() ? `?${params.toString()}` : ""}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errText = await readApiErrorMessage(res, "Falha ao excluir evento");
        throw new Error(errText);
      }

      return readApiJson<{ success: boolean; id: string }>(res, "delete-evento");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eventos"] });
      queryClient.invalidateQueries({ queryKey: ["fup-calendar-month"] });
      queryClient.invalidateQueries({ queryKey: ["fup-calendar-day"] });
    },
  });
}
