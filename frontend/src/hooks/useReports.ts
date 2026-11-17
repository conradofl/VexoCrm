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

// Diário do chip — quedas e voltas de conexão de cada chip, com o motivo que a Evolution informou e o que o Vexo
// enviou pelo chip antes da queda. Origem: evolution_instance_events (backend/src/services/chipDiary.js).
export interface ChipDiarySnapshot {
  limite_diario?: number | null;
  envios_1h?: number | null;
  envios_24h?: number | null;
  ultimo_envio?: string | null;
  segundos_do_ultimo_envio_ate_a_queda?: number | null;
  invalidos_24h?: number | null;
  cota_usada_no_dia?: number | null;
}

export interface ChipDiaryEvent {
  id: string;
  instance_name: string;
  chip_name: string | null;
  kind: "queda" | "conectado";
  occurred_at: string;
  occurred_at_approx: boolean;
  reason_code: number | null;
  reason_kind: string | null;
  reason_label: string | null;
  snapshot: ChipDiarySnapshot | null;
}

export interface ChipDiaryReport {
  available: boolean;
  items: ChipDiaryEvent[];
}

export function useChipDiary(clientId: string | null) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["chip-diary", clientId],
    enabled: isAuthenticated && !!clientId,
    queryFn: async (): Promise<ChipDiaryReport> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }
      const res = await fetchApi(`/api/reports/chip-diary?clientId=${encodeURIComponent(clientId!)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Falha ao carregar o diário do chip"));
      }
      const payload = await readApiJson<{ available?: boolean; items?: ChipDiaryEvent[] }>(res, "chip_diary");
      return {
        available: payload.available !== false,
        items: Array.isArray(payload.items) ? payload.items : [],
      };
    },
    staleTime: 60_000,
  });
}
