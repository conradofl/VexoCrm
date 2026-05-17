import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

export interface LeadRow {
  id: string;
  client_id: string;
  telefone: string | null;
  nome: string | null;
  // colunas legadas (Infinie)
  tipo_cliente: string | null;
  faixa_consumo: string | null;
  // colunas individuais do chatbot (normalizadas)
  interesse: string | null;
  objetivo: string | null;
  cidade: string | null;
  estado: string | null;
  credito: string | null;
  parcela: string | null;
  prazo: string | null;
  lance_entrada_fgts: string | null;
  melhor_horario: string | null;
  // Infinie-specific
  conta_luz_faixa: string | null;
  tipo: string | null;
  // meta
  spin_fase: string | null;
  status: string | null;
  status_conversa: string | null;
  finalizado: boolean | null;
  dados: Record<string, unknown> | null;
  data_hora: string | null;
  qualificacao: string | null;
  created_at: string;
  updated_at: string;
}

export function useLeads(clientId = "infinie") {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["leads", clientId],
    enabled: isAuthenticated && !!clientId,
    queryFn: async (): Promise<LeadRow[]> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const url = `${API_BASE_URL}/api/leads?clientId=${encodeURIComponent(clientId)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Leads fetch failed: ${res.status} ${errText}`);
      }
      const payload = await res.json();
      return Array.isArray(payload.items) ? payload.items : [];
    },
    staleTime: 30 * 1000,
  });
}
