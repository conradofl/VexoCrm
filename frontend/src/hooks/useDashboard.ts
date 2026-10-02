import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export type DashboardPeriod = "7d" | "30d" | "this_month";

export interface MetricComparison {
  current: number;
  previous: number;
  delta: number;
}

export interface RepliedMetricComparison extends MetricComparison {
  rate: number;
  previousRate: number;
  ruleDeclaration: string;
}

export interface DashboardSummary {
  sent: MetricComparison;
  replied: RepliedMetricComparison;
  meetings: MetricComparison;
  proposals: MetricComparison | null;
  contracts: MetricComparison | null;
}

export interface MessageRankingItem {
  campaign_id: string;
  campaign_name: string;
  message: string | null;
  sent_count: number;
  replied_count: number;
  reply_rate: number;
}

export interface ChipRankingItem {
  instanceId: string;
  name: string;
  chipState: string;
  sent: number;
  replies: number;
  sentToday: number;
  quotaLimit: number;
  quotaConsumedText: string;
  quotaPercentage: number;
}

export interface RegionRankingItem {
  label: string;
  ddd: string;
  cidade: string | null;
  sent: number;
  replies: number;
  replyRate: number;
}

export interface FailureReasonItem {
  reason: string;
  count: number;
  percentage: number;
}

export interface ActionAlert {
  id: string;
  text: string;
  actionLabel: string;
  actionUrl: string;
  severity?: "warning" | "info" | "urgent";
}

export interface DashboardPayload {
  client: {
    id: string;
    name: string;
  };
  period: DashboardPeriod;
  lastUpdatedAt: string | null;
  cacheStatus: "fresh" | "stale" | "error";
  lastError?: string | null;
  hasProposalsAndContracts: boolean;
  summary: DashboardSummary;
  rankings: {
    messages: MessageRankingItem[];
    chips: ChipRankingItem[];
    regions: RegionRankingItem[];
    failureReasons: FailureReasonItem[];
  };
  alerts: ActionAlert[];
}

export function useDashboard(clientId: string, period: DashboardPeriod = "30d") {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["dashboard", clientId, period],
    enabled: isAuthenticated && !!clientId,
    queryFn: async (): Promise<DashboardPayload> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(`/api/dashboard?clientId=${encodeURIComponent(clientId)}&period=${encodeURIComponent(period)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errText = await readApiErrorMessage(res, "Dashboard fetch failed");
        throw new Error(`Dashboard fetch failed: ${res.status} ${errText}`);
      }

      return readApiJson<DashboardPayload>(res, "dashboard");
    },
    retry: 1,
    staleTime: 60 * 1000,
  });
}

export function useRefreshDashboard(clientId: string) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (period: DashboardPeriod = "30d") => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");
      const res = await fetchApi(`/api/dashboard/refresh`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clientId, period }),
      });
      if (!res.ok) {
        const errText = await readApiErrorMessage(res, "Refresh failed");
        throw new Error(`Refresh failed: ${res.status} ${errText}`);
      }
      return readApiJson<any>(res, "dashboard-refresh");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard", clientId] });
    },
  });
}
