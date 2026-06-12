import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

// Relatórios v1 — envios por dia, por chip. Origem: evolution_instance_daily_usage.
export interface EvolutionUsageRow {
  dia: string; // YYYY-MM-DD
  chip_id: string;
  chip_label: string;
  enviados: number;
}

export interface EvolutionUsageReport {
  days: number;
  items: EvolutionUsageRow[];
}

export function useEvolutionUsageReport(clientId: string | null, days = 14) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["evolution-usage-report", clientId, days],
    enabled: isAuthenticated && !!clientId,
    queryFn: async (): Promise<EvolutionUsageReport> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(
        `/api/reports/evolution-usage?clientId=${encodeURIComponent(clientId!)}&days=${days}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Falha ao carregar relatorio"));
      }

      const payload = await readApiJson<{ days?: number; items?: EvolutionUsageRow[] }>(
        res,
        "evolution_usage_report"
      );
      return {
        days: payload.days ?? days,
        items: Array.isArray(payload.items) ? payload.items : [],
      };
    },
    staleTime: 60_000,
  });
}
