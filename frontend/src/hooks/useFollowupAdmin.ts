import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface FupCompany {
  id: string;
  name: string;
  evolution_instance: string;
  /** Todos os números atendidos por este agente. A coluna antiga guarda o primeiro. */
  evolution_instances?: string[];
  /** qualificador = responde quem foi disparado; atendimento = responde quem procurou. */
  inbound_role?: "atendimento" | "qualificador";
  /** Pra que serve o chip: atendimento ou campanha (chip de disparo, não atende espontâneo). Não confundir com inbound_role. */
  agent_kind?: "atendimento" | "campanha";
  /** Quando não-nulo, este agente ignora template e prompt padrão do tenant — ver AgentInstructionAuditPanel. */
  instructions_consolidated_at?: string | null;
  webhook_url: string | null;
  panel_access: boolean;
  auto_pause_on_reply?: boolean;
  auto_pause_on_calendly?: boolean;
  sending_window_start?: string;
  sending_window_end?: string;
  sending_days?: string;
  calendly_webhook_secret?: string;
  livpub_aniversario_prompt?: string;
  livpub_inativo_prompt?: string;
  inbound_enabled?: boolean;
  inbound_model?: string;
  inbound_prompt?: string;
  inbound_spin_fields?: any[];
  inbound_webhook_url?: string;
  sdr_whatsapp_number?: string;
  sdr_transfer_enabled?: boolean;
  engine_scan_interval_hours?: number;
  never_contacted_delay_hours?: number;
  no_reply_delay_hours?: number;
  livpub_inactive_delay_months?: number;
  last_engine_run_at?: string | null;
  activeCampaigns: number;
  created_at: string;
  tenant_id?: string;
}

export interface FupJourney {
  id: string;
  company_id: string;
  trigger_event: string;
  is_active: boolean;
  channel: "whatsapp" | "email";
  delay_value: number;
  delay_unit: "minutes" | "hours" | "days";
  ai_prompt: string | null;
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
  dispatch_jitter_minutes?: number;
  totalLeads: number;
  messagesSent: number;
  created_at: string;
}

export interface FupTemplate {
  id: string;
  campaign_id: string;
  name: string;
  message: string;
  trigger_type:
    | "on_schedule"
    | "after_enrollment"
    | "before_meeting"
    | "after_meeting"
    | "no_reply"
    | "before_anchor"
    | "after_anchor"
    | "fixed_date";
  trigger_value: number;
  trigger_unit: "minutes" | "hours" | "days";
  trigger_direction: "before" | "after" | null;
  scheduled_time: string | null;
  scheduled_date?: string | null;
  anchor_field: string | null;
  media_path?: string | null;
  media_type?: "image" | "audio" | "document" | "video" | null;
  media_mime?: string | null;
  media_filename?: string | null;
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
  status: "active" | "cancelled" | "completed" | "converted" | "missing_phone";
  origin: string | null;
  origin_source: string | null;
  origin_medium: string | null;
  origin_campaign: string | null;
  origin_type: "manual" | "utm" | "default" | null;
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

export function useFupCompanies(tenantId?: string) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["fup-companies", tenantId],
    enabled: isAuthenticated,
    queryFn: () => {
      const url = tenantId ? `/api/followup/companies?tenantId=${tenantId}` : "/api/followup/companies";
      return apiCall<{ companies: FupCompany[] }>(url, getIdToken).then((r) => r.companies);
    },
    staleTime: 30_000,
  });
}

export function useCreateFupCompany() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<FupCompany> & { calendly_webhook_secret?: string; tenant_id?: string }) =>
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
    mutationFn: ({ id, ...body }: Partial<FupCompany> & { id: string; company_id?: string }) =>
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

export interface TemplateMutationResponse {
  template: FupTemplate;
  pendingJobsCount?: number;
  timingChanged?: boolean;
}

export function useCreateFupTemplate() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<FupTemplate, "id" | "created_at">) =>
      apiCall<TemplateMutationResponse>("/api/followup/templates", getIdToken, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => qc.invalidateQueries({ queryKey: ["fup-templates", res.template.campaign_id] }),
  });
}

export function useUpdateFupTemplate() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<FupTemplate> & { id: string }) =>
      apiCall<TemplateMutationResponse>(`/api/followup/templates/${id}`, getIdToken, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => qc.invalidateQueries({ queryKey: ["fup-templates", res.template.campaign_id] }),
  });
}

export function useCloneFupCampaign() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId }: { campaignId: string }) =>
      apiCall<{ success: boolean; campaign: FupCampaign; clonedTemplatesCount: number }>(
        `/api/followup/campaigns/${campaignId}/clone`,
        getIdToken,
        { method: "POST" }
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["fup-campaigns", data.campaign.company_id] });
      qc.invalidateQueries({ queryKey: ["fup-templates", data.campaign.id] });
    },
  });
}

export function useReschedulePendingJobs() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId }: { templateId: string }) =>
      apiCall<{ success: boolean; rescheduledCount: number; sampleScheduledFor: string | null }>(
        `/api/followup/templates/${templateId}/reschedule-pending`,
        getIdToken,
        { method: "POST" }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["followup-queue"] });
    },
  });
}

// ─── Etapa 5 Commit 3: faixa "Próximos N dias" e calendário ──────────────────

export interface UpcomingDay {
  date: string;
  cadencePending: number;
  /** Total de TODAS as cadências que compartilham o mesmo chip — é o que estoura a cota, não cadencePending sozinho. */
  chipPending: number;
  chipLimit: number | null;
  overLimit: boolean;
  /** Quanto de projectLeads caiu neste dia (já somado em cadencePending/chipPending). */
  projected: number;
}

export interface UpcomingWindow {
  campaignId: string;
  days: UpcomingDay[];
  chipInstanceId: string | null;
  chipLimit: number | null;
}

export function useUpcomingWindow(
  campaignId?: string,
  options?: { days?: number; projectLeads?: number }
) {
  const { isAuthenticated, getIdToken } = useAuth();
  const days = options?.days ?? 7;
  const projectLeads = options?.projectLeads ?? 0;
  return useQuery({
    queryKey: ["fup-upcoming", campaignId, days, projectLeads],
    enabled: isAuthenticated && !!campaignId,
    queryFn: () =>
      apiCall<UpcomingWindow>(
        `/api/followup/campaigns/${campaignId}/upcoming?days=${days}${
          projectLeads > 0 ? `&projectLeads=${projectLeads}` : ""
        }`,
        getIdToken
      ),
    staleTime: 15_000,
  });
}

export interface CalendarMonth {
  tenantId: string;
  month: string;
  dayCounts: Record<string, number>;
}

export function useFollowupCalendarMonth(clientId?: string, month?: string) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["fup-calendar-month", clientId, month],
    enabled: isAuthenticated && !!clientId && !!month,
    queryFn: () =>
      apiCall<CalendarMonth>(`/api/followup/calendar?clientId=${clientId}&month=${month}`, getIdToken),
    staleTime: 15_000,
  });
}

export interface CalendarDayItem {
  jobId: string;
  scheduleId: string;
  campaignId: string | null;
  campaignName: string;
  templateName: string | null;
  leadName: string | null;
  phone: string | null;
  scheduledFor: string;
  status: string;
}

export interface CalendarDay {
  tenantId: string;
  date: string;
  items: CalendarDayItem[];
}

export function useFollowupCalendarDay(clientId?: string, date?: string) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["fup-calendar-day", clientId, date],
    enabled: isAuthenticated && !!clientId && !!date,
    queryFn: () =>
      apiCall<CalendarDay>(`/api/followup/calendar/day?clientId=${clientId}&date=${date}`, getIdToken),
    staleTime: 10_000,
  });
}

export interface UploadFollowupMediaResult {
  success: boolean;
  media_path: string;
  media_type: "image" | "audio" | "document" | "video";
  media_mime: string;
  media_filename: string;
  size_bytes: number;
}

export function useUploadFollowupMedia() {
  const { getIdToken } = useAuth();
  return useMutation({
    mutationFn: async ({ file, clientId }: { file: File; clientId: string }): Promise<UploadFollowupMediaResult> => {
      const token = await getIdToken();
      const url = `/api/followup/media/upload?clientId=${encodeURIComponent(clientId)}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
        "x-mime-type": file.type || "application/octet-stream",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: file,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || `Falha no upload: HTTP ${res.status}`);
      }
      return res.json();
    },
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

// ─── Âncoras ──────────────────────────────────────────────────────────────────

export interface AnchorFieldOption {
  key: string;
  label: string;
  source: string;
  recurring: boolean;
  description?: string;
}

export function useAnchorFields() {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["fup-anchor-fields"],
    enabled: isAuthenticated,
    queryFn: () =>
      apiCall<{ fields: AnchorFieldOption[] }>("/api/followup/anchor-fields", getIdToken).then(
        (r) => r.fields || []
      ),
    staleTime: 5 * 60 * 1000,
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

// ─── Journeys ─────────────────────────────────────────────────────────────────

export function useFupJourneys(companyId?: string) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["fup-journeys", companyId],
    enabled: isAuthenticated && !!companyId && companyId !== "all",
    queryFn: () =>
      apiCall<{ journeys: FupJourney[] }>(
        `/api/followup/journeys?companyId=${companyId}`,
        getIdToken
      ).then((r) => r.journeys),
    staleTime: 30_000,
  });
}

export function useUpsertFupJourney() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<FupJourney> & { company_id: string; trigger_event: string }) =>
      apiCall<{ journey: FupJourney }>("/api/followup/journeys", getIdToken, {
        method: "POST",
        body: JSON.stringify(body),
      }).then((r) => r.journey),
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: ["fup-journeys", vars.company_id] }),
  });
}


export function useLivpubHistory(companyId: string) {
  const { getIdToken } = useAuth();
  return useQuery({
    queryKey: ["livpub-history", companyId],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (companyId && companyId !== "all") qs.set("companyId", companyId);
      const url = `/api/followup/suggestions/history?${qs}`;
      const data = await apiCall<any>(url, getIdToken);
      if (!data.success) throw new Error(data.error?.message || "Failed to fetch history");
      return data.items || [];
    }
  });
}

export function usePlaySuggestion() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const data = await apiCall<any>(`/api/followup/suggestions/${id}/play`, getIdToken, { method: "POST" });
      if (!data.success) throw new Error(data.error?.message || "Failed to play suggestion");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["livpub-history"] });
    }
  });
}

export function useCancelSuggestion() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const data = await apiCall<any>(`/api/followup/suggestions/${id}/cancel`, getIdToken, { method: "POST" });
      if (!data.success) throw new Error(data.error?.message || "Failed to cancel suggestion");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["livpub-history"] });
    }
  });
}
