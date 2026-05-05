import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

export interface LeadClient {
  id: string;
  name: string;
  created_at?: string;
}

export interface CreateLeadClientPayload {
  id: string;
  name: string;
}

export function useLeadClients() {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["lead-clients"],
    enabled: isAuthenticated,
    queryFn: async (): Promise<LeadClient[]> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetch(`${API_BASE_URL}/api/lead-clients`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Lead clients fetch failed: ${res.status} ${errText}`);
      }

      const payload = await res.json();
      return Array.isArray(payload.items) ? payload.items : [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateLeadClient() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateLeadClientPayload): Promise<LeadClient> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetch(`${API_BASE_URL}/api/lead-clients`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const responsePayload = await res.json().catch(() => null);

      if (!res.ok) {
        const apiMessage =
          responsePayload?.error?.message ||
          responsePayload?.error?.details ||
          `Lead client create failed: ${res.status}`;
        throw new Error(apiMessage);
      }

      if (!responsePayload?.item) {
        throw new Error("Lead client create failed: missing response payload");
      }

      return responsePayload.item;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
    },
  });
}

export function useDeleteLeadClient() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tenantId: string): Promise<{ id: string; name?: string }> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetch(
        `${API_BASE_URL}/api/lead-clients/${encodeURIComponent(tenantId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        let message: string;
        try {
          const body = await res.json();
          message = body?.error?.message || body?.error?.details || body?.message || "";
        } catch {
          message = "";
        }

        if (!message || message.includes("<!DOCTYPE") || message.includes("<html")) {
          message =
            res.status === 404
              ? "Endpoint de exclusao nao encontrado. Verifique o deploy do backend."
              : res.status === 403
                ? "Sem permissao para excluir empresas."
                : `Erro ao excluir empresa (${res.status}).`;
        }

        throw new Error(message);
      }

      try {
        const data = await res.json();
        return data?.item || { id: tenantId };
      } catch {
        return { id: tenantId };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
    },
  });
}
