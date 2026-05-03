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
  image?: {
    name: string;
    type: string;
    size: number;
    dataUrl: string;
  } | null;
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
  webhookUrl?: string;
  webhookToken?: string | null;
  analyticsMeta?: CampaignAnalyticsMeta;
}

export interface UpdateCampaignPayload {
  name?: string;
  status?: CampaignStatus;
  limitPerRun?: number;
  scheduledFor?: string | null;
  archived?: boolean;
  webhookUrl?: string;
  webhookToken?: string | null;
  analyticsMeta?: CampaignAnalyticsMeta;
}

export interface TriggerCampaignResponse {
  success: boolean;
  campaignId: string;
  campaignName: string;
  webhookUrl: string;
  n8nResponse: string | null;
}

export function useCampanhas(clientId?: string) {
  const { isAuthenticated, canAccessInternalPage, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["campaigns", clientId || "all"],
    enabled: isAuthenticated && canAccessInternalPage("planilhas"),
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
