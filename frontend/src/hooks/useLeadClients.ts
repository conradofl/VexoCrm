import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

export interface LeadClient {
  id: string;
  name: string;
  created_at?: string;
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

export function useDeleteLeadClient() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (clientId: string) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/lead-clients/${encodeURIComponent(clientId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        let message = `Erro ${res.status}`;
        try {
          const body = await res.json();
          message = body?.message || body?.error || message;
        } catch {
          // body nao e JSON — nao exibir HTML bruto
        }
        throw new Error(message);
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
    },
  });
}
