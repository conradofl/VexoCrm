import { useQuery } from "@tanstack/react-query";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export interface GdDashboardStats {
  propostas: number;
  propostas_sem_assinatura: number;
  contratos: number;
  briefings: number;
}

export function useGdDashboard() {
  const { isAuthenticated, getIdToken, clientId } = useAuth();
  return useQuery({
    queryKey: ["gdDashboard", clientId],
    enabled: isAuthenticated,
    queryFn: async (): Promise<GdDashboardStats> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const params = new URLSearchParams();
      if (clientId) params.set("client_id", clientId);
      const url = `/api/gd/dashboard-stats${params.toString() ? `?${params}` : ""}`;
      const res = await fetchApi(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao carregar o dashboard"));
      }
      return readApiJson<GdDashboardStats>(res, "dashboard-stats");
    },
  });
}
