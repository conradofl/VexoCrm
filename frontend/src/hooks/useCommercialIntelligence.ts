import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

export interface CommercialIntelligenceFilters {
  period: string;
  campaignId: string;
  city: string;
  consultantId: string;
  status: string;
}

export interface CommercialIntelligenceOption {
  id?: string;
  value?: string;
  name?: string;
  label?: string;
}

export interface CommercialKpi {
  key: string;
  title: string;
  value: number | null;
  valueLabel: string;
  delta: number | null;
  kind: string;
  tone: string;
}

export interface CommercialMetricRow {
  key: string;
  name: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  direction: "up" | "down" | "stable";
  kind: string;
  accent: string;
  target: number | null;
  currentLabel: string;
  previousLabel: string;
  deltaLabel: string;
}

export interface CommercialRankingCity {
  id: string;
  name: string;
  qualificationRate: number;
  conversionRate: number;
  volumeLeads: number;
  revenue: number;
  avgCloseHours: number | null;
}

export interface CommercialRankingCampaign {
  id: string;
  name: string;
  qualificationRate: number;
  conversionRate: number;
  responseRate: number;
  qualifiedLeads: number;
  leadsImported: number;
  revenue: number;
  cplq: number | null;
  roiEstimated: number | null;
}

export interface CommercialRankingConsultant {
  id: string;
  name: string;
  leadsReceived: number;
  firstResponseHours: number | null;
  conversionRate: number;
  closings: number;
  revenue: number;
  regionalFit: number;
}

export interface DistributionStrategyItem {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface DistributionRuleItem {
  id: string;
  name: string;
  distributionMode: string;
  prioritizeRegion: boolean;
  prioritizeContractValue: boolean;
  prioritizeLeadType: boolean;
  maxOpenLeadsPerConsultant: number;
  reassignAfterMinutes: number;
  fairnessFloor: number;
  active: boolean;
  config: Record<string, unknown>;
}

export interface DistributionQueueRow {
  id: string;
  receivedAt?: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  campaignId: string | null;
  campaignName: string;
  city: string;
  potentialValue: number;
  consultantId: string | null;
  consultantName: string;
  ruleApplied: string;
  assignedAt: string | null;
  status: string;
  slaStatus: string;
  responseDueAt: string | null;
  actionLocked: boolean;
}

export interface DistributionHistoryRow {
  id: string;
  dateTime: string | null;
  leadName: string;
  previousConsultant: string;
  currentConsultant: string;
  reason: string;
  distributionType: string;
  responsible: string;
}

export interface ConsultantItem {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: string;
  city: string;
  state: string;
  territoryCities: string[];
  territoryStates: string[];
  territoryRegions: string[];
  contractValueMin: number;
  contractValueMax: number;
  leadTypes: string[];
  dailyCapacity: number;
  openLeadLimit: number;
  assignmentWeight: number;
  priorityRank: number;
  conversionRate: number;
  responseTimeHours: number | null;
  leadsReceived: number;
  closings: number;
  revenue: number;
  available: boolean;
  acceptsAutoAssign: boolean;
  position: string;
  availableHours: Record<string, unknown>;
  notes: string;
}

export interface CampaignPerformanceItem {
  id: string;
  name: string;
  status: string;
  period: string;
  leadsImported: number;
  leadsApproached: number;
  leadsResponded: number;
  leadsQualified: number;
  responseRate: number;
  qualificationRate: number;
  closings: number;
  revenue: number;
  cost: number;
  cplq: number | null;
  roiEstimated: number | null;
  topCities: Array<{ city: string; qualificationRate: number }>;
  topConsultants: Array<{ consultantId: string; consultantName: string; converted: number; revenue: number }>;
  funnel: Array<{ stage: string; value: number }>;
  trend: Array<{ date: string; qualificados: number; fechamentos: number }>;
  previewLeads: Array<{
    id: string;
    nome: string;
    telefone: string;
    cidade: string;
    estado: string;
    status: string;
    qualificacao: string;
    createdAt: string | null;
  }>;
}

export interface InsightItem {
  id: string | null;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  impact: string;
  recommendation: string;
  actionLabel: string;
  actionType: string;
  actionTargetId: string | null;
  actionTargetName: string | null;
  scope: string;
  generatedAt: string | null;
}

export interface CommercialIntelligenceSettings {
  qualificationThreshold: number;
  slaMinutes: number;
  defaultPeriod: string;
  distributionStrategy: string;
  rankingRules: Record<string, unknown>;
  metricRules: Record<string, unknown>;
  alertRules: Record<string, unknown>;
  permissions: Record<string, unknown>;
}

export interface CommercialIntelligencePayload {
  client: { id: string; name: string };
  generatedAt: string;
  filters: {
    applied: CommercialIntelligenceFilters;
    options: {
      companies: CommercialIntelligenceOption[];
      campaigns: CommercialIntelligenceOption[];
      cities: CommercialIntelligenceOption[];
      consultants: CommercialIntelligenceOption[];
      statuses: CommercialIntelligenceOption[];
    };
  };
  overview: {
    kpis: CommercialKpi[];
    charts: {
      qualifiedByDay: Array<{ date: string; qualificados: number; respondidos: number; fechamentos: number }>;
      funnel: Array<{ stage: string; value: number }>;
      byCity: Array<{ name: string; leads: number; qualificados: number; receita: number }>;
      byCampaign: Array<{ name: string; leads: number; qualificados: number; receita: number }>;
      statusDonut: Array<{ name: string; value: number }>;
      consultantComparison: Array<{ name: string; conversao: number; receita: number; leads: number }>;
    };
    alerts: InsightItem[];
    rankingSummary: {
      cities: CommercialRankingCity[];
      campaigns: CommercialRankingCampaign[];
      consultants: ConsultantItem[];
    };
  };
  metrics: {
    cards: CommercialMetricRow[];
    items: CommercialMetricRow[];
  };
  rankings: {
    cities: CommercialRankingCity[];
    campaigns: CommercialRankingCampaign[];
    consultants: CommercialRankingConsultant[];
  };
  distribution: {
    strategies: DistributionStrategyItem[];
    rules: DistributionRuleItem[];
    queue: DistributionQueueRow[];
    history: DistributionHistoryRow[];
    summary: {
      totalConsultants: number;
      availableConsultants: number;
      activeRules: number;
    };
  };
  consultants: {
    items: ConsultantItem[];
  };
  campaigns: {
    summary: {
      total: number;
      active: number;
      revenue: number;
      qualifiedLeads: number;
    };
    items: CampaignPerformanceItem[];
  };
  insights: {
    items: InsightItem[];
  };
  settings: CommercialIntelligenceSettings;
}

export interface ConsultantPayload {
  clientId: string;
  name: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  territoryCities?: string[];
  territoryStates?: string[];
  territoryRegions?: string[];
  contractValueMin?: number;
  contractValueMax?: number;
  leadTypes?: string[];
  dailyCapacity?: number;
  openLeadLimit?: number;
  assignmentWeight?: number;
  priorityRank?: number;
  available?: boolean;
  active?: boolean;
  position?: string;
  availableHours?: Record<string, unknown>;
  acceptsAutoAssign?: boolean;
  notes?: string;
}

export interface DistributionRulePayload {
  clientId: string;
  name: string;
  distributionMode: string;
  prioritizeRegion: boolean;
  prioritizeContractValue: boolean;
  prioritizeLeadType: boolean;
  maxOpenLeadsPerConsultant: number;
  reassignAfterMinutes: number;
  fairnessFloor: number;
  active: boolean;
  config: Record<string, unknown>;
}

async function parseApiError(res: Response) {
  const payload = await res.json().catch(() => null);
  return (
    payload?.error?.message ||
    payload?.error?.details ||
    `Falha na operacao (${res.status}).`
  );
}

export function useCommercialIntelligence(clientId: string, filters: CommercialIntelligenceFilters) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["commercial-intelligence", clientId, filters],
    enabled: isAuthenticated && !!clientId,
    queryFn: async (): Promise<CommercialIntelligencePayload> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const params = new URLSearchParams({
        clientId,
        period: filters.period,
      });

      if (filters.campaignId) params.set("campaignId", filters.campaignId);
      if (filters.city) params.set("city", filters.city);
      if (filters.consultantId) params.set("consultantId", filters.consultantId);
      if (filters.status) params.set("status", filters.status);

      const res = await fetch(`${API_BASE_URL}/api/commercial-intelligence?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      return res.json();
    },
    staleTime: 30 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
}

export function useCreateConsultant() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ConsultantPayload) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/commercial-intelligence/consultants`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commercial-intelligence"] }),
  });
}

export function useUpdateConsultant() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...payload }: ConsultantPayload & { id: string }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/commercial-intelligence/consultants/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commercial-intelligence"] }),
  });
}

export function useDeleteConsultant() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/commercial-intelligence/consultants/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commercial-intelligence"] }),
  });
}

export function useCreateDistributionRule() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: DistributionRulePayload) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/commercial-intelligence/distribution-rules`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commercial-intelligence"] }),
  });
}

export function useUpdateDistributionRule() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...payload }: DistributionRulePayload & { id: string }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/commercial-intelligence/distribution-rules/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commercial-intelligence"] }),
  });
}

export function useAssignmentAction() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { id: string; action: string; consultantId?: string; reason?: string }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/commercial-intelligence/assignments/${payload.id}/action`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commercial-intelligence"] }),
  });
}

export function useSaveCommercialIntelligenceSettings() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CommercialIntelligenceSettings & { clientId: string }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/commercial-intelligence/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commercial-intelligence"] }),
  });
}

export function useUpdateInsightStatus() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { id: string; status: string }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/commercial-intelligence/insights/${payload.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commercial-intelligence"] }),
  });
}
