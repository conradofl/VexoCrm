// Alerta de chip conectado que recebe com atraso ou ficou mudo (19/11/2026).
// Dados: GET /api/whatsapp/chip-alerts (backend/src/services/chipAlerts.js). Atualiza a cada 5 min.
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export interface ChipAlert {
  instancia: string;
  tipo: "atrasado" | "mudo";
  mensagensAtrasadas?: number;
  maiorAtrasoMin?: number;
  minutosSemReceber?: number;
  diasComEntradaNestaHora?: number;
  ultimaChegada?: string | null;
}

export interface ChipAlertsReport {
  alertas: ChipAlert[];
  limiteMin: number;
  verificadoEm: string | null;
}

export const CHIP_ALERTS_REFRESH_MS = 5 * 60 * 1000;

export function useChipAlerts(clientId: string | null | undefined) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["chip-alerts", clientId],
    enabled: isAuthenticated && !!clientId,
    queryFn: async (): Promise<ChipAlertsReport> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");
      const res = await fetchApi(`/api/whatsapp/chip-alerts?clientId=${encodeURIComponent(clientId!)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Falha ao carregar os alertas de chip"));
      const payload = await readApiJson<Partial<ChipAlertsReport>>(res, "chip_alerts");
      return {
        alertas: Array.isArray(payload.alertas) ? payload.alertas : [],
        limiteMin: typeof payload.limiteMin === "number" ? payload.limiteMin : 30,
        verificadoEm: payload.verificadoEm ?? null,
      };
    },
    staleTime: 60_000,
    refetchInterval: CHIP_ALERTS_REFRESH_MS,
  });
}
