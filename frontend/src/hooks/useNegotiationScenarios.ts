import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { type NegotiationLayers } from "@/lib/geracaoDigital/negotiation";

// Cenários de concessão pré-configurados da Mesa de Negociação (tenant-scoped).
export interface NegotiationScenario {
  id: string;
  nome: string;
  config: Partial<NegotiationLayers>;
  created_at?: string;
}

const QUERY_KEY = "gd-negotiation-scenarios";

export function useNegotiationScenarios() {
  const { isAuthenticated, getIdToken, clientId } = useAuth();
  const queryClient = useQueryClient();

  async function authHeaders(json = false): Promise<HeadersInit> {
    const token = await getIdToken();
    const headers: HeadersInit = json ? { "Content-Type": "application/json" } : {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  const scenariosQuery = useQuery({
    queryKey: [QUERY_KEY, clientId],
    enabled: isAuthenticated,
    queryFn: async (): Promise<NegotiationScenario[]> => {
      const headers = await authHeaders();
      const res = await fetchApi(`/api/gd/negotiation-scenarios?client_id=${clientId || ""}`, { headers });
      if (!res.ok) throw new Error(`Falha ao buscar cenários (Status ${res.status}).`);
      const data = await res.json();
      return data.success ? data.data : [];
    }
  });

  const createScenario = useMutation({
    mutationFn: async ({ nome, config }: { nome: string; config: Partial<NegotiationLayers> }) => {
      const headers = await authHeaders(true);
      const res = await fetchApi(`/api/gd/negotiation-scenarios`, {
        method: "POST",
        headers,
        body: JSON.stringify({ client_id: clientId, nome, config })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erro ao salvar cenário.");
      return data.data as NegotiationScenario;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY, clientId] })
  });

  const deleteScenario = useMutation({
    mutationFn: async (id: string) => {
      const headers = await authHeaders();
      const res = await fetchApi(`/api/gd/negotiation-scenarios/${id}?client_id=${clientId || ""}`, {
        method: "DELETE",
        headers
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erro ao excluir cenário.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY, clientId] })
  });

  return {
    scenarios: scenariosQuery.data || [],
    isLoading: scenariosQuery.isLoading,
    createScenario,
    deleteScenario
  };
}
