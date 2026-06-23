import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface FupCompany {
  id: string;
  name: string;
  evolution_instance: string;
  webhook_url: string | null;
  panel_access: boolean;
  auto_pause_on_reply?: boolean;
  auto_pause_on_calendly?: boolean;
  sending_window_start?: string;
  sending_window_end?: string;
  sending_days?: string;
  webhook_url?: string;
  calendly_webhook_secret?: string;
  panel_access?: boolean;
  inbound_enabled?: boolean;
  inbound_model?: string;
  inbound_prompt?: string;
  inbound_spin_fields?: any[];
  inbound_webhook_url?: string;
  sdr_whatsapp_number?: string;
  sdr_transfer_enabled?: boolean;
  activeCampaigns: number;
  created_at: string;
}

export interface FupCampaign {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused" | "archived";
  default_origin: string | null;
  webhook_trigger_url: string | null;
  webhook_secret: string | null;
  totalLeads: number;
  messagesSent: number;
  created_at: string;
}

export interface FupTemplate {
  id: string;
  campaign_id: string;
  name: string;
  message: string;
  trigger_type: "on_schedule" | "before_meeting" | "after_meeting" | "no_reply";
  trigger_value: number;
  trigger_unit: "minutes" | "hours" | "days";
  trigger_direction: "before" | "after" | null;
  is_active: boolean;
  order_index: number;
  created_at: string;
}

export interface FupSchedule {
  id: string;
  campaign_id: string;
  company_id: string;
  lead_name: string;
  phone: string | null;
  meeting_datetime: string | null;
  status: "active" | "canceled" | "completed" | "missing_phone";
  origin: string | null;
  origin_source: string | null;
  origin_medium: string | null;
  origin_campaign: string | null;
  origin_type: "utm" | "default" | null;
  created_at: string;
}

export interface FupAnalytics {
  kpis: {
    totalLeads: number;
    validPhone: number;
    messagesSent: number;
    replyRate: number;
    failureRate: number;
  };
  byOrigin: { origin: string; total: number; percentage: number }[];
  byDay: { date: string; total: number; byCampaign: Record<string, number> }[];
  conversionByCampaign: { campaignId: string; name: string; leads: number; converted: number; rate: number }[];
  messagesByDay: { date: string; sent: number; failed: number }[];
  topCampaigns: {
    rank: number;
    campaignId: string;
    name: string;
    origin: string;
    leads: number;
    sent: number;
    replyRate: number;
    status: string;
  }[];
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function apiCall<T>(
  path: string,
  getIdToken: () => Promise<string | null>,
  options?: RequestInit
): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new Error("Usuário não autenticado.");
  const res = await fetchApi(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro na requisição"));
  return readApiJson<T>(res, path);
}

// ─── Empresas ─────────────────────────────────────────────────────────────────

export function useFupCompanies() {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["fup-companies"],
    enabled: isAuthenticated,
    queryFn: () =>
      apiCall<{ companies: FupCompany[] }>("/api/followup/companies", getIdToken).then(
        (r) => r.companies
      ),
    staleTime: 30_000,
  });
}

export function useCreateFupCompany() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<FupCompany> & { calendly_webhook_secret?: string }) =>
      apiCall<{ company: FupCompany }>("/api/followup/companies", getIdToken, {
        method: "POST",
        body: JSON.stringify(body),
      }).then((r) => r.company),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fup-companies"] }),
  });
}

export function useUpdateFupCompany() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<FupCompany> & { id: string }) =>
      apiCall<{ company: FupCompany }>(`/api/followup/companies/${id}`, getIdToken, {
        method: "PATCH",
        body: JSON.stringify(body),
      }).then((r) => r.company),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fup-companies"] }),
  });
}

export function useArchiveFupCompany() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiCall<{ success: boolean }>(`/api/followup/companies/${id}`, getIdToken, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fup-companies"] }),
  });
}

// ─── Campanhas ────────────────────────────────────────────────────────────────

export function useFupCampaigns(companyId?: string) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["fup-campaigns", companyId],
    enabled: isAuthenticated && !!companyId,
    queryFn: () =>
      apiCall<{ campaigns: FupCampaign[] }>(
        `/api/followup/campaigns?companyId=${companyId}`,
        getIdToken
      ).then((r) => r.campaigns),
    staleTime: 30_000,
  });
}

export function useCreateFupCampaign() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      company_id: string;
      name: string;
      description?: string;
      default_origin?: string;
    }) =>
      apiCall<{ campaign: FupCampaign }>("/api/followup/campaigns", getIdToken, {
        method: "POST",
        body: JSON.stringify(body),
      }).then((r) => r.campaign),
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: ["fup-campaigns", vars.company_id] }),
  });
}

export function useUpdateFupCampaign() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      company_id,
      ...body
    }: Partial<FupCampaign> & { id: string; company_id: string; regenerate_secret?: boolean }) =>
      apiCall<{ campaign: FupCampaign }>(`/api/followup/campaigns/${id}`, getIdToken, {
        method: "PATCH",
        body: JSON.stringify(body),
      }).then((r) => r.campaign),
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: ["fup-campaigns", vars.company_id] }),
  });
}

export function useDeleteFupCampaign() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; company_id: string }) =>
      apiCall<{ success: boolean }>(`/api/followup/campaigns/${id}`, getIdToken, {
        method: "DELETE",
      }),
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: ["fup-campaigns", vars.company_id] }),
  });
}

// ─── Templates ────────────────────────────────────────────────────────────────

export function useFupTemplates(campaignId?: string) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["fup-templates", campaignId],
    enabled: isAuthenticated && !!campaignId,
    queryFn: () =>
      apiCall<{ templates: FupTemplate[] }>(
        `/api/followup/templates?campaignId=${campaignId}`,
        getIdToken
      ).then((r) => r.templates),
    staleTime: 20_000,
  });
}

export function useCreateFupTemplate() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<FupTemplate, "id" | "created_at">) =>
      apiCall<{ template: FupTemplate }>("/api/followup/templates", getIdToken, {
        method: "POST",
        body: JSON.stringify(body),
      }).then((r) => r.template),
    onSuccess: (t) => qc.invalidateQueries({ queryKey: ["fup-templates", t.campaign_id] }),
  });
}

export function useUpdateFupTemplate() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<FupTemplate> & { id: string }) =>
      apiCall<{ template: FupTemplate }>(`/api/followup/templates/${id}`, getIdToken, {
        method: "PATCH",
        body: JSON.stringify(body),
      }).then((r) => r.template),
    onSuccess: (t) => qc.invalidateQueries({ queryKey: ["fup-templates", t.campaign_id] }),
  });
}

export function useDeleteFupTemplate() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, campaign_id }: { id: string; campaign_id: string }) =>
      apiCall<{ success: boolean }>(`/api/followup/templates/${id}`, getIdToken, {
        method: "DELETE",
      }),
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: ["fup-templates", vars.campaign_id] }),
  });
}

export function useReorderFupTemplates() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ items, campaign_id }: { items: { id: string; order_index: number }[]; campaign_id: string }) =>
      apiCall<{ success: boolean }>("/api/followup/templates/reorder", getIdToken, {
        method: "PATCH",
        body: JSON.stringify({ items }),
      }),
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: ["fup-templates", vars.campaign_id] }),
  });
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface AnalyticsFilters {
  companyId?: string;
  campaignId?: string;
  from?: string;
  to?: string;
}

export function useFupAnalytics(filters: AnalyticsFilters) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["fup-analytics", filters],
    enabled: isAuthenticated,
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.companyId) params.set("companyId", filters.companyId);
      if (filters.campaignId) params.set("campaignId", filters.campaignId);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      return apiCall<FupAnalytics & { success: boolean }>(
        `/api/followup/analytics?${params}`,
        getIdToken
      );
    },
    staleTime: 60_000,
  });
}
