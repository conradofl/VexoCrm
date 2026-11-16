// Gestor de Tráfego (Fase 1): leitura de contas, perfil de metas e desempenho.
// Nenhuma chamada daqui altera campanha, verba ou anúncio em plataforma.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export type TrafficPlatform = "meta" | "google";
export type TrafficDecisionKey = "ESCALAR" | "MANTER" | "MATAR" | "AMOSTRA_INSUFICIENTE" | "SEM_META";
export type TrafficAutonomy = "relatorio" | "sugere" | "aplica_com_limites";
export type TrafficKpiUnit = "currency" | "percent" | "ratio";

export interface TrafficAccess {
  allowed: boolean;
  reason: string | null;
  message: string | null;
}

export interface TrafficAccount {
  id: string;
  platform: TrafficPlatform;
  externalAccountId: string;
  displayName: string | null;
  currency: string | null;
  timezone: string | null;
  status: "active" | "paused";
  lastSyncAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncError: string | null;
}

export interface TrafficAccountsResponse {
  platforms: Record<TrafficPlatform, { available: boolean; connected: boolean }>;
  collector: { enabled: boolean; hours: string[] };
  accounts: TrafficAccount[];
}

export interface TrafficKpiDefinition {
  key: string;
  label: string;
  better: "lower" | "higher";
  unit: TrafficKpiUnit;
}

export interface TrafficProfileKpi {
  key: string;
  target: number | null;
  better: "lower" | "higher";
  scale_at: number;
  kill_at: number;
  min_spend: number | null;
}

export interface TrafficApprover {
  name: string;
  role: "gestor_gd" | "cliente";
}

export interface TrafficProfile {
  exists: boolean;
  objectives: string[];
  kpis: TrafficProfileKpi[];
  primaryKpi: string | null;
  windows: number[];
  minSpendFactor: number;
  dailyBudgetCap: number | null;
  monthlyBudgetCap: number | null;
  maxIncreasePct: number;
  autonomyLevel: TrafficAutonomy;
  approvers: TrafficApprover[];
  updatedAt: string | null;
}

export interface TrafficProfileResponse {
  profile: TrafficProfile;
  catalog: TrafficKpiDefinition[];
  allowedWindows: number[];
  autonomy: { levels: TrafficAutonomy[]; available: TrafficAutonomy[] };
}

export type TrafficProfileInput = Omit<TrafficProfile, "exists" | "updatedAt" | "kpis"> & {
  kpis: Array<Pick<TrafficProfileKpi, "key" | "target" | "scale_at" | "kill_at" | "min_spend">>;
};

export interface TrafficMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  messages_started: number;
  purchases: number;
  purchase_value: number;
}

export interface TrafficDecision {
  decisao: TrafficDecisionKey;
  motivo: string;
}

export interface TrafficAd {
  id: string;
  name: string | null;
  effectiveStatus: string | null;
  metrics: TrafficMetrics;
  kpis: Record<string, number | null>;
  decision: TrafficDecision | null;
}

export interface TrafficAdset {
  id: string | null;
  name: string | null;
  metrics: TrafficMetrics;
  kpis: Record<string, number | null>;
  decision: TrafficDecisionKey | null;
  ads: TrafficAd[];
}

export interface TrafficCampaign {
  id: string | null;
  name: string | null;
  objective: string | null;
  metrics: TrafficMetrics;
  kpis: Record<string, number | null>;
  decision: TrafficDecisionKey | null;
  adsets: TrafficAdset[];
}

export interface TrafficPerformanceAccount {
  platform: TrafficPlatform;
  id: string;
  name: string | null;
  currency: string | null;
  metrics: TrafficMetrics;
  kpis: Record<string, number | null>;
  campaigns: TrafficCampaign[];
}

export interface TrafficTarget {
  key: string;
  label: string;
  unit: TrafficKpiUnit | null;
  better: "lower" | "higher";
  target: number | null;
  value: number | null;
  variacao: number | null;
}

export interface TrafficPerformance {
  window: { days: number; since: string; until: string; timezone: string };
  windows: number[];
  hasProfile: boolean;
  primaryKpi: string | null;
  totals: { metrics: TrafficMetrics; kpis: Record<string, number | null> };
  targets: TrafficTarget[];
  accounts: TrafficPerformanceAccount[];
  adsCount: number;
  vexo: { available: boolean; reason: string | null };
  catalog: TrafficKpiDefinition[];
  accountsStatus: TrafficAccount[];
}

function useTrafficRequest() {
  const { getIdToken } = useAuth();
  return async function request<T>(path: string, context: string, fallback: string, init: RequestInit = {}): Promise<T> {
    const token = await getIdToken();
    if (!token) throw new Error("Usuário não autenticado.");
    const res = await fetchApi(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok) throw new Error(await readApiErrorMessage(res, fallback));
    return readApiJson<T>(res, context);
  };
}

// A tela obedece ao servidor: sem veredito positivo, nenhuma aba carrega.
export function useTrafficAccess(clientId: string | undefined) {
  const { isAuthenticated } = useAuth();
  const request = useTrafficRequest();
  return useQuery({
    queryKey: ["trafficAccess", clientId],
    enabled: isAuthenticated && Boolean(clientId),
    retry: false,
    queryFn: async (): Promise<TrafficAccess> => {
      const params = new URLSearchParams({ clientId: clientId as string });
      const data = await request<Partial<TrafficAccess>>(
        `/api/traffic/access?${params}`,
        "traffic-access",
        "Não foi possível verificar o acesso ao Gestor de Tráfego"
      );
      return { allowed: data.allowed === true, reason: data.reason ?? null, message: data.message ?? null };
    },
  });
}

export function useTrafficAccounts(clientId: string | undefined, enabled = true) {
  const { isAuthenticated } = useAuth();
  const request = useTrafficRequest();
  return useQuery({
    queryKey: ["trafficAccounts", clientId],
    enabled: isAuthenticated && Boolean(clientId) && enabled,
    queryFn: () =>
      request<TrafficAccountsResponse>(
        `/api/traffic/accounts?${new URLSearchParams({ clientId: clientId as string })}`,
        "traffic-accounts",
        "Erro ao carregar as contas de anúncio"
      ),
  });
}

export function useTrafficProfile(clientId: string | undefined, enabled = true) {
  const { isAuthenticated } = useAuth();
  const request = useTrafficRequest();
  return useQuery({
    queryKey: ["trafficProfile", clientId],
    enabled: isAuthenticated && Boolean(clientId) && enabled,
    queryFn: () =>
      request<TrafficProfileResponse>(
        `/api/traffic/profile?${new URLSearchParams({ clientId: clientId as string })}`,
        "traffic-profile",
        "Erro ao carregar metas e regras"
      ),
  });
}

export function useTrafficPerformance(clientId: string | undefined, windowDays: number, enabled = true) {
  const { isAuthenticated } = useAuth();
  const request = useTrafficRequest();
  return useQuery({
    queryKey: ["trafficPerformance", clientId, windowDays],
    enabled: isAuthenticated && Boolean(clientId) && enabled,
    queryFn: () =>
      request<TrafficPerformance>(
        `/api/traffic/performance?${new URLSearchParams({ clientId: clientId as string, window: String(windowDays) })}`,
        "traffic-performance",
        "Erro ao carregar o desempenho"
      ),
  });
}

export function useCreateTrafficAccount(clientId: string | undefined) {
  const request = useTrafficRequest();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { platform: TrafficPlatform; externalAccountId: string; displayName?: string }) =>
      request<{ account: TrafficAccount }>("/api/traffic/accounts", "traffic-account-create", "Não foi possível cadastrar a conta", {
        method: "POST",
        body: JSON.stringify({ clientId, ...input }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trafficAccounts", clientId] }),
  });
}

export function useSetTrafficAccountStatus(clientId: string | undefined) {
  const request = useTrafficRequest();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "paused" }) =>
      request<{ account: TrafficAccount }>(`/api/traffic/accounts/${id}`, "traffic-account-status", "Não foi possível alterar a conta", {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trafficAccounts", clientId] }),
  });
}

export function useSaveTrafficProfile(clientId: string | undefined) {
  const request = useTrafficRequest();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TrafficProfileInput) =>
      request<{ profile: TrafficProfile }>("/api/traffic/profile", "traffic-profile-save", "Não foi possível salvar metas e regras", {
        method: "PUT",
        body: JSON.stringify({ clientId, ...input }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trafficProfile", clientId] });
      queryClient.invalidateQueries({ queryKey: ["trafficPerformance", clientId] });
    },
  });
}

// ─── Formatação compartilhada pelas abas ─────────────────────────────────────

export function formatMoney(value: number | null | undefined, currency: string | null = "BRL") {
  if (value === null || value === undefined) return "sem dado";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(value);
  } catch {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  }
}

export function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined) return "sem dado";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

/** Valor de um KPI na unidade dele. null vira "sem dado", nunca zero. */
export function formatKpi(value: number | null | undefined, unit: TrafficKpiUnit | null, currency: string | null = "BRL") {
  if (value === null || value === undefined) return "sem dado";
  if (unit === "currency") return formatMoney(value, currency);
  const text = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
  if (unit === "percent") return `${text}%`;
  return `${text}x`;
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export const DECISION_LABELS: Record<TrafficDecisionKey, string> = {
  ESCALAR: "Escalar",
  MANTER: "Manter",
  MATAR: "Cortar",
  AMOSTRA_INSUFICIENTE: "Amostra insuficiente",
  SEM_META: "Sem meta",
};
