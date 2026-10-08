import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { fetchApi, readApiJson } from "@/lib/api";
import type { LeadClient } from "@/hooks/useLeadClients";
import {
  computeOnboardingProgress,
  type OnboardingProgress,
  type OnboardingStep,
} from "@/lib/onboarding/progress";

export type { OnboardingProgress, OnboardingStep };

export interface UseOnboardingProgressOptions {
  baseTotal?: number | null;
  client?: LeadClient | null;
}

export function useOnboardingProgress(
  overrideClientId?: string,
  options?: UseOnboardingProgressOptions
): OnboardingProgress {
  const crmClient = useOptionalCrmClient();
  const { isAuthenticated, getIdToken } = useAuth();

  const effectiveClientId = overrideClientId || crmClient?.selectedClientId || "";
  const client =
    options?.client ??
    (overrideClientId && crmClient?.clients
      ? crmClient.clients.find((c) => c.id === overrideClientId) ?? crmClient.selectedClient
      : crmClient?.selectedClient ?? null);

  const shouldFetchFacets =
    options?.baseTotal === undefined && !!effectiveClientId && Boolean(isAuthenticated);

  const { data: facetsData, isLoading: isFacetsLoading } = useQuery({
    queryKey: ["lead-facets", effectiveClientId],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/leads/facets?clientId=${encodeURIComponent(effectiveClientId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return null;
      return readApiJson<{ baseTotal?: number | null }>(
        res,
        "Falha ao carregar totais de leads"
      );
    },
    enabled: shouldFetchFacets,
    staleTime: 60_000,
  });

  const baseTotal =
    options?.baseTotal !== undefined
      ? options.baseTotal
      : (facetsData?.baseTotal ?? null);

  const isLoading =
    (crmClient?.isLoading ?? false) ||
    (shouldFetchFacets && isFacetsLoading);

  return computeOnboardingProgress(client, baseTotal, isLoading);
}
