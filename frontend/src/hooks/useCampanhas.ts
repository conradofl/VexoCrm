import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

const CAMPAIGN_REQUEST_TIMEOUT_MS = 15000;

export interface Campaign {
  id: string;
  name: string;
  client_id: string;
  client_name: string | null;
  import_id: string | null;
  limit_per_run: number;
  webhook_url: string;
  webhook_token: string | null;
  status: CampaignStatus;
  scheduled_for: string | null;
  last_triggered_at: string | null;
  archived_at: string | null;
  created_by_uid: string | null;
  created_by_email: string | null;
  created_at: string;
  analytics_meta?: CampaignAnalyticsMeta;
  starts_at: string | null;
  ends_at: string | null;
  chatbot_prompt_type: string;
  campaign_prompt_id: string | null;
  mode: "disparo" | "agente";
  // ── Campos PRÉ-CABEADOS (Dashboard Fase 1 — desempenho por campanha).
  // O endpoint de campanhas ainda NÃO retorna estes; quando retornar, a tabela
  // do Dashboard preenche sozinha (helper "—" enquanto nulo).
  sent?: number | null;            // mensagens enviadas pela campanha
  replies?: number | null;         // respostas recebidas
  conversionRate?: number | null;  // conversão (%) da campanha
}

export interface CampaignDispatch {
  id: string;
  campaign_id: string;
  client_id: string;
  name: string;
  steps: CampaignSequenceStep[];
  trigger_type: "manual" | "scheduled";
  scheduled_at: string | null;
  status: "draft" | "scheduled" | "running" | "paused" | "done" | "failed" | "cancelled" | "interrupted";
  target_count?: number;
  sent_count: number;
  failed_count: number;
  triggered_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  evolution_instance_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignAnalyticsMeta {
  /** Varias planilhas importadas como origem do disparo. */
  importIds?: string[];
  segmentation?: CampaignSegmentation;
  message?: string;
  image?: CampaignImageAsset | null;
  sequence?: CampaignSequenceStep[];
  dispatchOptions?: CampaignDispatchOptions;
}

export interface CampaignImageAsset {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface CampaignSequenceStep {
  id: string;
  type: "text" | "image";
  order: number;
  text: string;
  textVariants?: string[];
  image: CampaignImageAsset | null;
  enabled: boolean;
  delayAfterSeconds: number;
  /**
   * "with_previous" e LEGADO: nao e mais oferecido na tela porque nunca teve
   * consumidor no backend — o passo caia no filtro de imediato e virava dois
   * envios seguidos, com o atraso normal. O tipo e a normalizacao continuam
   * aceitando o valor para nao reescrever passo ja gravado; a tela o exibe
   * como "Imediato", que e o que ele de fato faz.
   */
  triggerMode?: "immediate" | "after_reply" | "with_previous";
  buttons?: {
    displayText: string;
    type: "url" | "reply";
    url?: string;
    replyText?: string;
  }[];
}

export interface CampaignDispatchOptions {
  leadDelaySeconds: number;
  stopOnStepFailure: boolean;
  aiAssisted: boolean;
  evolutionInstanceId?: string | null;
  templateStrategy?: "single" | "ai_variations";
  templateVariantCount?: number;
  waitForReply?: boolean;
  replyTimeoutSeconds?: number;
  replyPollIntervalSeconds?: number;
  minWaitSeconds?: number;
  maxWaitSeconds?: number;
  dailyQuotaPerChip?: number;
  maxRepetitionsPerTemplate?: number;
  replyAgent?: "passos" | "campanha" | "atendimento";
}

export type SegmentationOperator = "equals" | "contains" | "gt" | "lt";

export interface SegmentationFilter {
  field: string;
  operator: SegmentationOperator;
  value: string | number;
}

// Shape unificado: filters[] dinâmico (campos do catálogo da empresa).
// Keys legadas mantidas opcionais p/ leitura de campanhas antigas (compat).
export interface CampaignSegmentation {
  filters?: SegmentationFilter[];
  // legado (somente leitura de campanhas antigas):
  gender?: string;
  productType?: string;
  ticket?: string;
  ticketThreshold?: number | null;
  interest?: string;
  campaignTag?: string;
}

export type CampaignStatus =
  | "active"
  | "paused"
  | "draft"
  | "scheduled"
  | "processing"
  | "sent"
  | "failed"
  | "cancelled"
  | "interrupted";

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  active: "Ativa",
  paused: "Pausada",
  draft: "Rascunho",
  scheduled: "Agendada",
  processing: "Executando",
  sent: "Enviada",
  failed: "Falhou",
  cancelled: "Cancelada",
  interrupted: "Interrompido",
};

export const CAMPAIGN_STATUS_COLORS: Record<CampaignStatus, string> = {
  active: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  paused: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  draft: "border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
  scheduled: "border-sky-300 bg-sky-50 text-sky-600 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-400",
  processing: "border-cyan-300 bg-cyan-50 text-cyan-600 dark:border-cyan-800 dark:bg-cyan-900/20 dark:text-cyan-400",
  sent: "border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed: "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400",
  cancelled: "border-slate-300 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500",
  interrupted: "border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
};

export interface CampaignLead {
  id: string;
  client_id: string;
  telefone: string | null;
  nome: string | null;
  tipo_cliente: string | null;
  faixa_consumo: string | null;
  cidade: string | null;
  estado: string | null;
  status: string | null;
  data_hora: string | null;
  qualificacao: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCampaignPayload {
  name: string;
  clientId: string;
  importId?: string | null;
  /** Varias planilhas de uma vez. Quando vem preenchido, prevalece sobre importId. */
  importIds?: string[];
  limitPerRun?: number;
  scheduledFor?: string | null;
  mode?: "disparo" | "agente";
  campaignPromptId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  analyticsMeta?: CampaignAnalyticsMeta;
}

export interface DirectDispatchPayload {
  clientId: string;
  phone: string;
  text?: string;
  imageCaption?: string;
  imageFirst?: boolean;
  image?: CampaignImageAsset | null;
}

export interface UpdateCampaignPayload {
  name?: string;
  status?: CampaignStatus;
  importId?: string | null;
  importIds?: string[];
  limitPerRun?: number;
  scheduledFor?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  chatbotPromptType?: string;
  campaignPromptId?: string | null;
  mode?: "disparo" | "agente";
  archived?: boolean;
  analyticsMeta?: CampaignAnalyticsMeta;
}

export interface CreateDispatchPayload {
  name: string;
  steps: CampaignSequenceStep[];
  triggerType?: "manual" | "scheduled";
  scheduledAt?: string | null;
  evolutionInstanceId?: string | null;
}

export interface UpdateDispatchPayload {
  name?: string;
  steps?: CampaignSequenceStep[];
  triggerType?: "manual" | "scheduled";
  scheduledAt?: string | null;
  evolutionInstanceId?: string | null;
  status?: CampaignDispatch["status"];
}

export interface TriggerCampaignResponse {
  success: boolean;
  campaignId: string;
  campaignName: string;
  provider: "evolution";
  successCount: number;
  failureCount: number;
  successPhones: string[];
  failures: Array<{
    phone: string | null;
    stepId: string | null;
    stepType: "text" | "image" | null;
    reason: string;
  }>;
  completedCampaign: boolean;
}

export interface DirectDispatchResponse {
  success: boolean;
  provider: "evolution";
  phone: string;
  successCount: number;
  failureCount: number;
  successPhones: string[];
  failures: TriggerCampaignResponse["failures"];
  completedCampaign: boolean;
}

export interface CampaignAiStatus {
  enabled: boolean;
  provider: "groq";
  model: string;
  reason?: string;
}

export interface CampaignAiSuggestionContext {
  campaignName?: string;
  goal?: string;
  style?: string;
  baseText?: string;
  count?: number;
  /** Variaveis que a campanha realmente tem. A IA nao pode usar nenhuma fora desta lista. */
  availableVariables?: string[];
  segmentation?: CampaignSegmentation;
  sequence?: CampaignSequenceStep[];
  dispatchOptions?: CampaignDispatchOptions;
  step?: CampaignSequenceStep;
}

// Erro da API de campanhas preservando o `error.code` do backend, para que o chamador
// possa tratar UM caso especifico (ex.: CAMPAIGN_NOT_FOUND) sem engolir os demais.
export class CampaignApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "CampaignApiError";
    this.code = code;
    this.status = status;
  }
}

export async function readApiErrorDetails(res: Response, fallback: string): Promise<{ code: string; message: string }> {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = await res.json().catch(() => null);
    const code = typeof data?.error?.code === "string" ? data.error.code : "";
    return { code, message: data?.error?.message || `${fallback}: ${res.status}` };
  }

  const text = await res.text().catch(() => "");
  const isMissingExpressRoute =
    res.status === 404 &&
    (text.includes("Cannot GET") || text.includes("Cannot POST"));

  if (isMissingExpressRoute) {
    return {
      code: "",
      message: "A API de producao ainda nao publicou esta rota. Reimplante o backend e confirme o deployMarker em /health.",
    };
  }

  return {
    code: "",
    message: text ? `${fallback}: ${res.status} ${text.slice(0, 240)}` : `${fallback}: ${res.status}`,
  };
}

async function readApiErrorMessage(res: Response, fallback: string): Promise<string> {
  return (await readApiErrorDetails(res, fallback)).message;
}

async function readCampaignJson<T>(res: Response, context: string): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    console.error("[campaigns-api] invalid_response", {
      context,
      status: res.status,
      contentType,
    });
    throw new Error("Resposta invalida da API de campanhas.");
  }

  return res.json() as Promise<T>;
}

const CAMPAIGN_ERROR_MESSAGES: Record<string, string> = {
  CAMPAIGN_NOT_FOUND: "Campanha nao encontrada.",
  CAMPAIGN_NOT_DISPATCHABLE: "Campanha nao pode ser disparada no status atual.",
  CAMPAIGN_ARCHIVED: "Campanha arquivada nao pode ser disparada.",
  NO_DISPATCH_LEADS: "Nenhum lead encontrado para esta campanha. Verifique a importacao e os filtros de segmentacao.",
  EVOLUTION_SETTINGS_MISSING: "URL de disparo Evolution nao configurada. Acesse as configuracoes da empresa e configure a URL de disparo.",
  EVOLUTION_SETTINGS_SCHEMA_MISSING: "Tabela de configuracao de disparo nao existe. Execute a migracao do banco de dados.",
  EVOLUTION_TRIGGER_FAILED: "Falha no envio via Evolution API. Verifique se a instancia WhatsApp esta conectada.",
  CAMPAIGN_REPLY_FLOW_INVALID: "Campanha com resposta avancada precisa de pelo menos um passo imediato.",
  N8N_TIMEOUT: "Timeout na comunicacao com o servidor de disparo (20s).",
};

async function readTriggerErrorMessage(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = await res.json().catch(() => null);
    const code = data?.error?.code || "";
    const apiMessage = data?.error?.message || data?.message || "";

    // Use friendly message if we have a known error code
    const friendlyMessage = CAMPAIGN_ERROR_MESSAGES[code];
    if (friendlyMessage) {
      // Append API detail if it contains useful info (e.g. Evolution session error)
      const hasUsefulDetail =
        apiMessage &&
        !apiMessage.includes("<!DOCTYPE") &&
        !apiMessage.includes("<html") &&
        apiMessage !== friendlyMessage;
      return hasUsefulDetail
        ? `${friendlyMessage} Detalhe: ${apiMessage.slice(0, 200)}`
        : friendlyMessage;
    }

    // Fallback: use API message if available
    if (apiMessage && !apiMessage.includes("<!DOCTYPE")) {
      return apiMessage.slice(0, 300);
    }

    return `Erro ao disparar campanha (${res.status}).`;
  }

  const text = await res.text().catch(() => "");
  if (text.includes("Cannot POST") || text.includes("Cannot GET")) {
    return "Rota de disparo nao encontrada. Verifique se o backend esta atualizado.";
  }

  return `Erro ao disparar campanha (${res.status}).`;
}

function getCampaignApiCandidates(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const absoluteApiUrl = `${API_BASE_URL}${normalizedPath}`;
  const preferSameOrigin = !import.meta.env.DEV && typeof window !== "undefined";

  return Array.from(new Set(preferSameOrigin ? [normalizedPath, absoluteApiUrl] : [absoluteApiUrl, normalizedPath]));
}

function shouldRetryCampaignResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return false;
  }
  return [502, 503, 504].includes(response.status) || (response.status >= 500 && contentType.includes("text/html"));
}

async function fetchCampaignsApi(path: string, init: RequestInit) {
  let networkError: unknown = null;
  const candidates = getCampaignApiCandidates(path);

  for (const [index, url] of candidates.entries()) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CAMPAIGN_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (shouldRetryCampaignResponse(response) && index < candidates.length - 1) {
        console.warn("[campaigns-api] retryable_response", {
          path,
          attempt: index + 1,
          status: response.status,
        });
        continue;
      }

      if (index > 0) {
        console.info("[campaigns-api] fallback_success", { path, status: response.status });
      }

      return response;
    } catch (error) {
      networkError = error;
      const eventName = error instanceof DOMException && error.name === "AbortError" ? "request_timeout" : "network_error";
      console.warn("[campaigns-api]", eventName, {
        path,
        attempt: index + 1,
        fallbackAvailable: index < candidates.length - 1,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  console.error("[campaigns-api] request_failed", { path });
  throw networkError instanceof Error ? networkError : new Error("Falha de conexao com a API de campanhas.");
}

export function canAccessCampaignsGate(params: {
  isAuthenticated: boolean;
  role: string;
  allowedViews: string[];
  internalPages: string[];
  permissions: string[];
  isAdmin: boolean;
}): boolean {
  if (!params.isAuthenticated) return false;
  if (params.isAdmin) return true;
  if (params.role === "client") {
    return params.allowedViews.includes("planilhas") || params.permissions.includes("campaigns.manage");
  }
  return (
    params.internalPages.includes("planilhas") ||
    params.permissions.includes("campaigns.manage")
  );
}

export function useCanAccessCampaigns() {
  const { isAuthenticated, accessRole, allowedViews, internalPages, permissions, isAdminUser } = useAuth();
  return canAccessCampaignsGate({
    isAuthenticated,
    role: accessRole,
    allowedViews,
    internalPages,
    permissions,
    isAdmin: isAdminUser,
  });
}

function isCampaignClientTerminalError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;
    return msg.includes("404") || msg.includes("403") || msg.includes("401");
  }
  return false;
}

export function useCampanhas(clientId?: string) {
  const { isAuthenticated, getIdToken } = useAuth();
  const canAccess = useCanAccessCampaigns();

  return useQuery({
    queryKey: ["campaigns", clientId || "all"],
    enabled: canAccess && isAuthenticated && !!clientId,
    queryFn: async (): Promise<Campaign[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);

      const res = await fetchCampaignsApi(`/api/campaigns${params.toString() ? `?${params}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await readApiErrorMessage(res, "Erro ao buscar campanhas");
        throw new Error(`Erro ao buscar campanhas: ${res.status} ${err}`);
      }

      const payload = await readCampaignJson<{ items?: Campaign[] }>(res, "list_campaigns");
      return Array.isArray(payload.items) ? payload.items : [];
    },
    retry: (failureCount, error) => !isCampaignClientTerminalError(error) && failureCount < 1,
    staleTime: 30 * 1000,
  });
}

export function useCampaignLeads(campaignId?: string) {
  const { getIdToken } = useAuth();
  const canAccess = useCanAccessCampaigns();

  return useQuery({
    queryKey: ["campaign-leads", campaignId],
    enabled: canAccess && !!campaignId,
    queryFn: async (): Promise<CampaignLead[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchCampaignsApi(`/api/campaigns/${campaignId}/leads`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await readApiErrorMessage(res, "Erro ao buscar leads da campanha");
        throw new Error(`Erro ao buscar leads da campanha: ${res.status} ${err}`);
      }

      const payload = await readCampaignJson<{ items?: CampaignLead[] }>(res, "list_campaign_leads");
      return Array.isArray(payload.items) ? payload.items : [];
    },
    retry: (failureCount, error) => !isCampaignClientTerminalError(error) && failureCount < 1,
    staleTime: 30 * 1000,
  });
}

export function useCreateCampaign() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateCampaignPayload): Promise<Campaign> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchCampaignsApi("/api/campaigns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await readApiErrorMessage(res, "Erro ao criar campanha");
        throw new Error(`Erro ao criar campanha: ${res.status} ${err}`);
      }

      const data = await readCampaignJson<{ item?: Campaign }>(res, "create_campaign");
      if (!data.item) {
        throw new Error("A API nao retornou a campanha criada.");
      }
      return data.item;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaigns", variables.clientId || "all"] });
    },
  });
}

export function useUpdateCampaign() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: UpdateCampaignPayload & { id: string }): Promise<Campaign> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchCampaignsApi(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const { code, message } = await readApiErrorDetails(res, "Erro ao atualizar campanha");
        throw new CampaignApiError(`Erro ao atualizar campanha: ${res.status} ${message}`, code, res.status);
      }

      const data = await readCampaignJson<{ item: Campaign }>(res, "update_campaign");
      return data.item;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}

// Auto-cura do id orfao: o id da campanha em edicao vive no localStorage do navegador e pode
// apontar para uma campanha ja excluida. Nesse caso — e SOMENTE nesse — refaz a operacao como
// criacao. Qualquer outro erro (403, 500, rede) e repassado ao chamador sem tratamento.
export async function saveCampaignWithSelfHeal({
  editingCampaignId,
  payload,
  updateCampaign,
  createCampaign,
  onOrphanRecovered,
}: {
  editingCampaignId: string | null;
  payload: CreateCampaignPayload;
  updateCampaign: (args: UpdateCampaignPayload & { id: string }) => Promise<Campaign>;
  createCampaign: (payload: CreateCampaignPayload) => Promise<Campaign>;
  onOrphanRecovered?: (staleCampaignId: string) => void;
}): Promise<Campaign> {
  if (!editingCampaignId) {
    return createCampaign(payload);
  }

  try {
    return await updateCampaign({ id: editingCampaignId, ...payload });
  } catch (error) {
    if (!(error instanceof CampaignApiError) || error.code !== "CAMPAIGN_NOT_FOUND") {
      throw error;
    }
    console.warn("[campanha] auto-cura: id de edicao orfao, criando campanha nova", {
      staleCampaignId: editingCampaignId,
    });
    onOrphanRecovered?.(editingCampaignId);
    return createCampaign(payload);
  }
}

export function useDeleteCampaign() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchCampaignsApi(`/api/campaigns/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await readApiErrorMessage(res, "Erro ao excluir campanha");
        throw new Error(`Erro ao excluir campanha: ${res.status} ${err}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}

export function useTriggerCampaign() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<TriggerCampaignResponse> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchCampaignsApi(`/api/campaigns/${id}/trigger`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errMsg = await readTriggerErrorMessage(res);
        throw new Error(errMsg);
      }

      return readCampaignJson<TriggerCampaignResponse>(res, "trigger_campaign");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}

export function useDirectDispatch() {
  const { getIdToken } = useAuth();

  return useMutation({
    mutationFn: async (payload: DirectDispatchPayload): Promise<DirectDispatchResponse> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchCampaignsApi("/api/campaigns/direct-dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao disparar mensagem"));
      }

      return readCampaignJson<DirectDispatchResponse>(res, "direct_dispatch");
    },
  });
}

export function useCampaignAiStatus() {
  const { getIdToken } = useAuth();
  const canAccess = useCanAccessCampaigns();

  return useQuery({
    queryKey: ["campaign-ai-status"],
    enabled: canAccess,
    queryFn: async (): Promise<CampaignAiStatus> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchCampaignsApi("/api/campaigns/ai/status", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 404) {
        return {
          enabled: false,
          provider: "groq",
          model: "",
          reason: "backend_route_missing",
        };
      }

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao consultar IA"));
      }

      return readCampaignJson<CampaignAiStatus>(res, "campaign_ai_status");
    },
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
}

function useCampaignAiMutation<TResponse>(
  endpoint: string,
  errorLabel: string,
) {
  const { getIdToken } = useAuth();

  return useMutation({
    mutationFn: async (payload: CampaignAiSuggestionContext): Promise<TResponse> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchCampaignsApi(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, errorLabel));
      }

      const data = await readCampaignJson<{ item: TResponse }>(res, endpoint);
      return data.item;
    },
  });
}

export function useGenerateCampaignCopy() {
  return useCampaignAiMutation<{ copy: string; rationale: string }>(
    "/api/campaigns/ai/generate-copy",
    "Erro ao gerar copy",
  );
}

export function useGenerateCampaignTemplateVariants() {
  return useCampaignAiMutation<{
    variants: string[];
    requested?: number;
    /** Variacoes que a IA gerou e o backend jogou fora por perderem o pedido da mensagem. */
    discarded?: Array<{ texto: string; motivo: string }>;
    discardedCount?: number;
    invariants?: { pedido?: string; elementos?: string[] };
    rationale: string;
  }>("/api/campaigns/ai/generate-template-variants", "Erro ao gerar variacoes");
}

export function useSuggestCampaignSequence() {
  return useCampaignAiMutation<{
    sequence: CampaignSequenceStep[];
    dispatchOptions: CampaignDispatchOptions;
    rationale: string;
  }>("/api/campaigns/ai/suggest-sequence", "Erro ao sugerir sequencia");
}

export function useSuggestCampaignDelays() {
  return useCampaignAiMutation<{
    sequence: CampaignSequenceStep[];
    dispatchOptions: CampaignDispatchOptions;
    rationale: string;
  }>("/api/campaigns/ai/suggest-delays", "Erro ao sugerir atrasos");
}

export function useRewriteCampaignStep() {
  return useCampaignAiMutation<{
    step: CampaignSequenceStep;
    rationale: string;
  }>("/api/campaigns/ai/rewrite-step", "Erro ao reescrever passo");
}

// ── Campaign Dispatches ───────────────────────────────────────────────────────

export function useCampaignDispatches(campaignId: string | null) {
  const { getIdToken } = useAuth();
  return useQuery<CampaignDispatch[]>({
    queryKey: ["campaign-dispatches", campaignId],
    enabled: !!campaignId,
    staleTime: 30_000,
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/dispatches`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao buscar disparos"));
      const data = await res.json();
      return data.dispatches ?? [];
    },
  });
}

export function useCreateDispatch(campaignId: string) {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateDispatchPayload) => {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao criar disparo"));
      const data = await res.json();
      return data.dispatch as CampaignDispatch;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign-dispatches", campaignId] }),
  });
}

export function useUpdateDispatch(campaignId: string) {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dispatchId, patch }: { dispatchId: string; patch: UpdateDispatchPayload }) => {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao atualizar disparo"));
      const data = await res.json();
      return data.dispatch as CampaignDispatch;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign-dispatches", campaignId] }),
  });
}

export function useDeleteDispatch(campaignId: string) {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dispatchId: string) => {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao excluir disparo"));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign-dispatches", campaignId] }),
  });
}

export function useTriggerDispatch(campaignId: string) {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dispatchId: string) => {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}/trigger`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao disparar"));
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-dispatches"] });
      qc.invalidateQueries({ queryKey: ["all-dispatches"] });
    },
  });
}

export function useAllDispatches(clientId: string | null) {
  const { getIdToken } = useAuth();
  return useQuery<CampaignDispatch[]>({
    queryKey: ["all-dispatches", clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/dispatches?clientId=${encodeURIComponent(clientId!)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao buscar disparos"));
      const data = await res.json();
      return data.dispatches ?? [];
    },
  });
}

export function useDispatchPreviewLeads(dispatchId: string | null) {
  const { getIdToken } = useAuth();
  return useQuery<{ leads: { nome: string; telefone: string }[]; total: number }>({
    queryKey: ["dispatch-preview-leads", dispatchId],
    enabled: !!dispatchId,
    queryFn: async () => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}/preview-leads`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao buscar preview de leads"));
      return res.json();
    },
  });
}

export interface DispatchRecipientItem {
  index: number;
  leadId: string | null;
  nome: string;
  telefone: string;
  status: "sent" | "failed" | "invalid_number" | "skipped" | "pending";
  statusLabel: string;
  sentAt: string | null;
  attemptedAt: string | null;
  failureReason: string | null;
  technicalDetails: string | null;
  campaignName: string;
  dispatchName: string;
}

export interface DispatchRecipientsResponse {
  dispatchId: string;
  dispatchName: string;
  campaignName: string;
  total: number;
  sentCount: number;
  failedCount: number;
  invalidCount?: number;
  skippedCount: number;
  pendingCount: number;
  items: DispatchRecipientItem[];
}

export function useDispatchRecipients(dispatchId: string | null, statusFilter?: string) {
  const { getIdToken } = useAuth();
  return useQuery<DispatchRecipientsResponse>({
    queryKey: ["dispatch-recipients", dispatchId, statusFilter],
    enabled: !!dispatchId,
    queryFn: async () => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const url = new URL(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}/recipients`);
      if (statusFilter && statusFilter !== "all") {
        url.searchParams.set("status", statusFilter);
      }
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao buscar destinatários"));
      return res.json();
    },
  });
}

export function useRetryFailedDispatchLeads() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dispatchId: string) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}/retry-failed`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao reenviar falhados"));
      return res.json();
    },
    onSuccess: (_, dispatchId) => {
      qc.invalidateQueries({ queryKey: ["campaign-dispatches"] });
      qc.invalidateQueries({ queryKey: ["all-dispatches"] });
      qc.invalidateQueries({ queryKey: ["dispatch-recipients", dispatchId] });
    },
  });
}

export function useRunPendingDispatchLeads() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dispatchId: string) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}/run-pending`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao disparar não processados"));
      return res.json();
    },
    onSuccess: (_, dispatchId) => {
      qc.invalidateQueries({ queryKey: ["campaign-dispatches"] });
      qc.invalidateQueries({ queryKey: ["all-dispatches"] });
      qc.invalidateQueries({ queryKey: ["dispatch-recipients", dispatchId] });
    },
  });
}

// ─── "Uma linha por campanha, lote vira quadrado" ──────────────────────────
// GET /api/campaigns/dispatch-summary: uma linha agregada por campanha, não
// por lote. batches[] é a faixa de quadrados (só da página atual).

export type DispatchAggregateStatus = "enviando" | "concluida" | "cancelada" | "agendada" | "pausada";

export const DISPATCH_AGGREGATE_STATUS_LABELS: Record<DispatchAggregateStatus, string> = {
  enviando: "Enviando",
  concluida: "Concluída",
  cancelada: "Cancelada",
  agendada: "Agendada",
  pausada: "Pausada",
};

export const DISPATCH_AGGREGATE_STATUS_COLORS: Record<DispatchAggregateStatus, string> = {
  enviando: "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400",
  concluida: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  cancelada: "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
  agendada: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  pausada: "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-400",
};

// Cor de cada quadrado da faixa de lotes, por status do LOTE (não da campanha).
export const DISPATCH_SQUARE_COLORS: Record<CampaignDispatch["status"], string> = {
  done: "bg-emerald-500",
  failed: "bg-rose-500",
  cancelled: "bg-slate-300 dark:bg-slate-700",
  running: "bg-indigo-500 animate-pulse",
  paused: "bg-orange-400",
  draft: "bg-slate-200 dark:bg-slate-800",
  scheduled: "bg-amber-300",
  interrupted: "bg-rose-300",
};

export interface DispatchSummaryBatch {
  id: string;
  status: CampaignDispatch["status"];
  sentCount: number;
  failedCount: number;
  targetCount: number;
  scheduledAt: string | null;
  createdAt: string;
}

export interface DispatchSummaryEta {
  isToday: boolean;
  weekday: string | null;
  label: string;
}

export interface DispatchSummaryCampaign {
  campaignId: string;
  campaignName: string;
  chipName: string | null;
  loteCount: number;
  leadsTotal: number;
  leadsPending: number;
  sentTotal: number;
  failedTotal: number;
  repliedCount: number;
  status: DispatchAggregateStatus;
  statusLabel: string;
  nextScheduledAt: string | null;
  eta: DispatchSummaryEta | null;
  leadsActionable: { pause: number; resume: number; cancel: number };
  batches: DispatchSummaryBatch[];
}

export interface DispatchSummaryKpis {
  periodLabel: string;
  campaigns: number;
  leads: number;
  sent: number;
  deliveryRate: number | null;
}

export interface DispatchSummaryResponse {
  campaigns: DispatchSummaryCampaign[];
  counts: { active: number; ended: number };
  scope: "active" | "ended";
  page: number;
  pageSize: number;
  totalForScope: number;
  kpis: DispatchSummaryKpis;
}

export function useDispatchSummary(
  clientId: string | null,
  scope: "active" | "ended",
  page: number = 1,
  pageSize: number = 20
) {
  const { getIdToken } = useAuth();
  return useQuery<DispatchSummaryResponse>({
    queryKey: ["dispatch-summary", clientId, scope, page, pageSize],
    enabled: !!clientId,
    staleTime: 15_000,
    queryFn: async () => {
      const token = await getIdToken();
      const params = new URLSearchParams({
        clientId: clientId!,
        scope,
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatch-summary?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao buscar o resumo de disparos"));
      return res.json();
    },
  });
}

export interface DispatchBulkActionResult {
  success: boolean;
  action: "pause" | "resume" | "cancel";
  affectedDispatches: number;
  affectedLeads: number;
}

export function useCampaignDispatchBulkAction() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ campaignId, action }: { campaignId: string; action: "pause" | "resume" | "cancel" }) => {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/dispatches/bulk-action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao executar ação em massa"));
      return res.json() as Promise<DispatchBulkActionResult>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-summary"] });
      qc.invalidateQueries({ queryKey: ["all-dispatches"] });
      qc.invalidateQueries({ queryKey: ["campaign-dispatches"] });
    },
  });
}
