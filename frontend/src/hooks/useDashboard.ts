import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import type { DashboardPeriodInfo, PeriodRange } from "@/lib/dashboard/formatters";

// "custom" = intervalo escolhido (data inicial e final); as datas vão à parte, em `range`.
export type DashboardPeriod = "7d" | "30d" | "this_month" | "custom";

export type DashboardRange = PeriodRange;

export interface MetricComparison {
  current: number;
  previous: number;
  delta: number;
}

export interface RepliedMetricComparison extends MetricComparison {
  // null = a taxa não pôde ser calculada (faltou o número de envios) — não é 0%
  rate: number | null;
  previousRate: number | null;
  ruleDeclaration: string;
}

// Cada bloco é calculado isolado. `null` aqui significa "não foi possível calcular agora"
// (o nome do bloco vem em `unavailableBlocks`) — NUNCA zero. Em `proposals`/`contracts`,
// `null` também é "tenant não usa Geração Digital" (ver `hasProposalsAndContracts`).
export interface DashboardSummary {
  sent: MetricComparison | null;
  replied: RepliedMetricComparison | null;
  meetings: MetricComparison | null;
  proposals: MetricComparison | null;
  contracts: MetricComparison | null;
  // Fechamentos (lead_conversions ganhas). Ausente em payload gravado antes de existir.
  closings?: MetricComparison | null;
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
  // Números de telefone distintos entre as ocorrências (o mesmo número pode falhar mais de uma vez)
  distinctNumbers?: number;
}

export type TemperatureKey = "QUENTE" | "MORNO" | "FRIO" | "SEM_CLASSIFICACAO";

export interface LeadClassification {
  total: number;
  byTemperature: Record<TemperatureKey, number>;
  byStage: { stage: string; count: number }[];
}

export interface FirstReplyOnly {
  repliedFirst: number;
  receivedFollowUp: number;
  stoppedAfterFirst: number;
  // null = ninguém recebeu o passo seguinte: não há o que medir (não é 0%)
  stoppedRate: number | null;
}

export interface LeadProfile {
  temperature: TemperatureKey;
  origin: string;
  leads: number;
  replied: number;
  scheduled: number;
  closed: number;
  replyRate: number;
  scheduleRate: number;
  closeRate: number;
}

export interface TopProfiles {
  minLeads: number;
  eligibleGroups: number;
  top: LeadProfile[];
}

export interface BaseHealth {
  total: number;
  validPhone: number;
  invalidPhone: number;
  neverApproached: number;
  noReplyOverDays: number;
  silenceDays: number;
}

export interface FirstHumanResponse {
  conversations: number;
  answered: number;
  waiting: number;
  waitingOverThreshold: number;
  thresholdHours: number;
  medianMinutes: number | null;
  p90Minutes: number | null;
}

// Cada medida pode vir null (bloco indisponível). `analysis` ausente = payload antigo.
export interface DashboardAnalysis {
  leadClassification: LeadClassification | null;
  firstReplyOnly: FirstReplyOnly | null;
  topProfiles: TopProfiles | null;
  baseHealth: BaseHealth | null;
  firstHumanResponse: FirstHumanResponse | null;
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
  // Datas do período e do período anterior, para escrever a comparação por extenso.
  // Ausente em payload gravado antes de existir.
  periodInfo?: DashboardPeriodInfo;
  lastUpdatedAt: string | null;
  cacheStatus: "fresh" | "stale" | "error";
  lastError?: string | null;
  hasProposalsAndContracts: boolean;
  // Blocos que não puderam ser calculados: "summary.sent", "rankings.chips", "alerts"...
  // Ausente em payloads gravados antes desse campo existir.
  unavailableBlocks?: string[];
  summary: DashboardSummary;
  rankings: {
    messages: MessageRankingItem[] | null;
    chips: ChipRankingItem[] | null;
    regions: RegionRankingItem[] | null;
    failureReasons: FailureReasonItem[] | null;
    // Base dos percentuais de falha: total de ocorrências e de números distintos
    failureTotals?: { occurrences: number; distinctNumbers: number } | null;
    // Envios de disparo sem chip registrado (usaram o chip principal/rodízio)
    chipsUnattributedSent?: number | null;
  };
  analysis?: DashboardAnalysis;
  alerts: ActionAlert[];
}

// Parâmetros de período na URL: atalho, ou period=custom&from=…&to=….
export function buildDashboardPeriodQuery(period: DashboardPeriod, range?: DashboardRange | null): string {
  const params = new URLSearchParams({ period });
  if (period === "custom" && range) {
    params.set("from", range.from);
    params.set("to", range.to);
  }
  return params.toString();
}

// Chave do cache da tela: o intervalo faz parte dela, então dois intervalos nunca compartilham resultado.
export function dashboardQueryKey(clientId: string, period: DashboardPeriod, range?: DashboardRange | null) {
  return ["dashboard", clientId, period, range?.from ?? null, range?.to ?? null] as const;
}

export function useDashboard(clientId: string, period: DashboardPeriod = "30d", range?: DashboardRange | null) {
  const { isAuthenticated, getIdToken } = useAuth();
  // "Personalizado" só consulta depois que as datas foram aplicadas
  const hasRange = period !== "custom" || !!range;

  return useQuery({
    queryKey: dashboardQueryKey(clientId, period, range),
    enabled: isAuthenticated && !!clientId && hasRange,
    queryFn: async (): Promise<DashboardPayload> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(`/api/dashboard?clientId=${encodeURIComponent(clientId)}&${buildDashboardPeriodQuery(period, range)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errText = await readApiErrorMessage(res, "Dashboard fetch failed");
        throw new Error(`Dashboard fetch failed: ${res.status} ${errText}`);
      }

      return readApiJson<DashboardPayload>(res, "dashboard");
    },
    // período inválido (400) não melhora tentando de novo
    retry: (failureCount, error) => failureCount < 1 && !/ 400 /.test(String((error as Error)?.message)),
    staleTime: 60 * 1000,
  });
}

export function useRefreshDashboard(clientId: string) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ period = "30d", range }: { period?: DashboardPeriod; range?: DashboardRange | null } = {}) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");
      const res = await fetchApi(`/api/dashboard/refresh`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clientId, period, ...(period === "custom" && range ? { from: range.from, to: range.to } : {}) }),
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
