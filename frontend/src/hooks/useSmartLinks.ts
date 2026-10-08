// frontend/src/hooks/useSmartLinks.ts
// Hook do React Query para consultar métricas analíticas de Smart Links & Engajamento

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export interface SmartLinkTopLead {
  leadId: string;
  leadNome: string;
  leadTelefone: string;
  linkCode: string;
  destinationUrl: string;
  linkTitle: string | null;
  clicksCount: number;
  lastClickedAt: string | null;
  campaignId: string | null;
  campaignName: string | null;
}

export interface SmartLinkMetrics {
  totalLinks: number;
  totalClicks: number;
  uniqueLeadsClicked: number;
  ctr: number;
  clicksLast24h: number;
  periodDays: number;
  topLeads: SmartLinkTopLead[];
}

export function smartLinkMetricsQueryKey(
  clientId: string | null | undefined,
  periodDays: number = 30,
  campaignId?: string | null
) {
  return ["smart-links", "metrics", clientId ?? null, periodDays, campaignId ?? null] as const;
}

export function useSmartLinkMetrics(
  clientId: string | null | undefined,
  periodDays: number = 30,
  campaignId?: string | null
) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: smartLinkMetricsQueryKey(clientId, periodDays, campaignId),
    enabled: isAuthenticated && Boolean(clientId),
    queryFn: async (): Promise<SmartLinkMetrics> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuário não autenticado");
      }

      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);
      if (periodDays) params.set("periodDays", String(periodDays));
      if (campaignId) params.set("campaignId", campaignId);

      const res = await fetchApi(`/api/smart-links/metrics?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errText = await readApiErrorMessage(res, "Falha ao carregar métricas de links");
        throw new Error(errText);
      }

      return readApiJson<SmartLinkMetrics>(res, "smart-links-metrics");
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}
