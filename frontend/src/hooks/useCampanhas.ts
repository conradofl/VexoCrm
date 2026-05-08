import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

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
}

export interface CampaignAnalyticsMeta {
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
  image: CampaignImageAsset | null;
  enabled: boolean;
  delayAfterSeconds: number;
  triggerMode?: "immediate" | "after_reply";
}

export interface CampaignDispatchOptions {
  leadDelaySeconds: number;
  stopOnStepFailure: boolean;
  aiAssisted: boolean;
  waitForReply?: boolean;
  replyTimeoutSeconds?: number;
  replyPollIntervalSeconds?: number;
}

export interface CampaignSegmentation {
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
  | "cancelled";

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
  limitPerRun?: number;
  scheduledFor?: string | null;
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
  limitPerRun?: number;
  scheduledFor?: string | null;
  archived?: boolean;
  analyticsMeta?: CampaignAnalyticsMeta;
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
  segmentation?: CampaignSegmentation;
  sequence?: CampaignSequenceStep[];
  dispatchOptions?: CampaignDispatchOptions;
  step?: CampaignSequenceStep;
}

async function readApiErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = await res.json().catch(() => null);
    return data?.error?.message || `${fallback}: ${res.status}`;
  }

  const text = await res.text().catch(() => "");
  const isMissingExpressRoute =
    res.status === 404 &&
    (text.includes("Cannot GET") || text.includes("Cannot POST"));

  if (isMissingExpressRoute) {
    return "A API de producao ainda nao publicou esta rota. Reimplante o backend e confirme o deployMarker em /health.";
  }

  return text ? `${fallback}: ${res.status} ${text.slice(0, 240)}` : `${fallback}: ${res.status}`;
}

export function useCampanhas(clientId?: string) {
  const { isAuthenticated, canAccessInternalPage, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["campaigns", clientId || "all"],
    enabled: isAuthenticated && canAccessInternalPage("planilhas") && !!clientId,
    queryFn: async (): Promise<Campaign[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);

      const res = await fetch(`${API_BASE_URL}/api/campaigns${params.toString() ? `?${params}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Erro ao buscar campanhas: ${res.status} ${err}`);
      }

      const payload = await res.json();
      return Array.isArray(payload.items) ? payload.items : [];
    },
    staleTime: 30 * 1000,
  });
}

export function useCampaignLeads(campaignId?: string) {
  const { isAuthenticated, canAccessInternalPage, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["campaign-leads", campaignId],
    enabled: isAuthenticated && canAccessInternalPage("planilhas") && !!campaignId,
    queryFn: async (): Promise<CampaignLead[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/leads`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Erro ao buscar leads da campanha: ${res.status} ${err}`);
      }

      const payload = await res.json();
      return Array.isArray(payload.items) ? payload.items : [];
    },
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

      const res = await fetch(`${API_BASE_URL}/api/campaigns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Erro ao criar campanha: ${res.status} ${err}`);
      }

      const data = await res.json();
      return data.item;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
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

      const res = await fetch(`${API_BASE_URL}/api/campaigns/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Erro ao atualizar campanha: ${res.status} ${err}`);
      }

      const data = await res.json();
      return data.item;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}

export function useDeleteCampaign() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/campaigns/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await res.text();
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

      const res = await fetch(`${API_BASE_URL}/api/campaigns/${id}/trigger`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Erro ao disparar campanha: ${res.status} ${err}`);
      }

      return res.json();
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

      const res = await fetch(`${API_BASE_URL}/api/campaigns/direct-dispatch`, {
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

      return res.json();
    },
  });
}

export function useCampaignAiStatus() {
  const { isAuthenticated, canAccessInternalPage, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["campaign-ai-status"],
    enabled: isAuthenticated && canAccessInternalPage("planilhas"),
    queryFn: async (): Promise<CampaignAiStatus> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/campaigns/ai/status`, {
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

      return res.json();
    },
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

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error?.message || `${errorLabel}: ${res.status}`);
      }

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
