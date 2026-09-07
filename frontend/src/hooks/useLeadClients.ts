import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export interface LeadClient {
  id: string;
  name: string;
  created_at?: string;
  leads_table?: LeadClientTableStatus;
  n8n_settings?: LeadClientN8nSettingsSummary;
  n8n_onboarding_status?: string;
}

export interface LeadClientTableStatus {
  tableName: string;
  exists: boolean;
  unavailable?: boolean;
  columns?: string[];
}

export interface CreateLeadClientPayload {
  id: string;
  name: string;
  chatbotModel?: string;
  segmentationConfig?: LeadClientSegmentationConfig;
  n8nSettings?: LeadClientN8nSettingsPayload;
}

export interface LeadClientSegmentationKpi {
  id: string;
  label: string;
  field: string;
  type: "category" | "money" | "number" | "date";
  enabled: boolean;
}

export interface LeadClientSegmentationConfig {
  version: number;
  kpis: LeadClientSegmentationKpi[];
}

export interface LeadClientN8nSettingsPayload {
  dispatchWebhookUrl?: string | null;
  dispatchWebhookToken?: string | null;
  inboundBearerToken?: string | null;
  active?: boolean;
  chatbotEnabled?: boolean;
  chatbotModel?: string;
  chatbotLlmModel?: string;
  chatbotInstances?: string[];
  chatbotInboundScope?: "leads_only" | "all" | string;
  chatbot_inbound_scope?: "leads_only" | "all" | string;
  recontactMessage?: string | null;
  recontact_message?: string | null;
  segmentationConfig?: LeadClientSegmentationConfig;
  sdrWhatsappNumber?: string | null;
  sdrWhatsappNumbers?: string[];
  allowedTabs?: string[] | null;
  plan_tier?: "essencial" | "avancado" | string;
  planTier?: "essencial" | "avancado" | string;
  modulos_avulsos?: string[];
  modulosAvulsos?: string[];
  degustacao_expira_em?: string | null;
  degustacaoExpiraEm?: string | null;
  send_window_start?: string;
  sendWindowStart?: string;
  send_window_end?: string;
  sendWindowEnd?: string;
  send_window_days?: string[];
  sendWindowDays?: string[];
  send_window_timezone?: string;
  sendWindowTimezone?: string;
  send_window_enabled?: boolean;
  sendWindowEnabled?: boolean;
  agent_replies_outside_window?: boolean;
  agentRepliesOutsideWindow?: boolean;
}

export interface LeadClientEvolutionInstancePayload {
  name?: string;
  dispatchWebhookUrl?: string | null;
  dispatchWebhookToken?: string | null;
  inboundBearerToken?: string | null;
  ownerUid?: string | null;
  active?: boolean;
  isDefault?: boolean;
  chipState?: "cold" | "warm";
  dailyLimitOverride?: number | null;
  webhookEnabled?: boolean;
}

export interface LeadClientEvolutionInstance {
  id: string;
  client_id: string;
  name: string;
  dispatch_webhook_url: string | null;
  has_dispatch_webhook_token: boolean;
  inbound_bearer_token_label?: string | null;
  owner_uid?: string | null;
  active: boolean;
  is_default: boolean;
  chip_state: "cold" | "warm";
  connection_state?: string | null;
  daily_limit_override: number | null;
  sent_count_today: number;
  webhook_enabled: boolean;
  /** Preenchido quando a Evolution recusou a configuração do webhook ao salvar. */
  webhook_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  updated_by_email?: string | null;
}

// QR + metadados retornados pela Evolution no provision (server.js:1978-1983).
export interface EvolutionProvisionQr {
  instanceName?: string | null;
  status?: string | null;
  qrcode?: {
    code?: string | null;
    base64?: string | null;
  } | null;
}

// Resposta completa do provision: a instância salva (item) + o QR (evolution).
export interface LeadClientEvolutionProvisionResult {
  item: LeadClientEvolutionInstance;
  evolution: EvolutionProvisionQr | null;
}

export interface LeadClientN8nSettingsSummary {
  client_id?: string;
  dispatch_webhook_url: string | null;
  has_dispatch_webhook_token: boolean;
  has_inbound_bearer_token: boolean;
  active: boolean;
  chatbot_enabled: boolean;
  chatbot_model: string;
  chatbot_llm_model?: string;
  /** Chips que este chatbot atende. Vazio = qualquer chip sem agente inbound. */
  chatbot_instances?: string[];
  chatbot_inbound_scope?: "leads_only" | "all" | string;
  recontact_message?: string | null;
  segmentation_config?: LeadClientSegmentationConfig;
  sdr_whatsapp_number: string | null;
  /** Destinos do briefing. Substitui o campo único; os dois convivem no deploy. */
  sdr_whatsapp_numbers?: string[];
  evolution_instances?: LeadClientEvolutionInstance[];
  send_window_start?: string;
  send_window_end?: string;
  send_window_days?: string[];
  send_window_timezone?: string;
  send_window_enabled?: boolean;
  agent_replies_outside_window?: boolean;
  updated_at: string | null;
  updated_by_email?: string | null;
  allowed_tabs?: string[] | null;
  plan_tier?: string;
  modulos_avulsos?: string[];
  degustacao_expira_em?: string | null;
}

export function useLeadClients() {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["lead-clients"],
    enabled: isAuthenticated,
    queryFn: async (): Promise<LeadClient[]> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi("/api/lead-clients", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errText = await readApiErrorMessage(res, "Lead clients fetch failed");
        throw new Error(`Lead clients fetch failed: ${res.status} ${errText}`);
      }

      const payload = await readApiJson<{ items?: LeadClient[] }>(res, "lead_clients");
      return Array.isArray(payload.items) ? payload.items : [];
    },
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateLeadClient() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateLeadClientPayload): Promise<LeadClient> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi("/api/lead-clients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Lead client create failed"));
      }

      const responsePayload = await readApiJson<{ item?: LeadClient }>(res, "create_lead_client");
      if (!responsePayload?.item) {
        throw new Error("Lead client create failed: missing response payload");
      }

      return responsePayload.item;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
    },
  });
}

export function useDeleteLeadClient() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tenantId: string): Promise<{ id: string; name?: string }> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(
        `/api/lead-clients/${encodeURIComponent(tenantId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        let message = await readApiErrorMessage(res, "Lead client delete failed");
        if (!message || message.includes("<!DOCTYPE") || message.includes("<html")) {
          message =
            res.status === 404
              ? "Endpoint de exclusao nao encontrado. Verifique o deploy do backend."
              : res.status === 403
                ? "Sem permissao para excluir empresas."
                : `Erro ao excluir empresa (${res.status}).`;
        }

        throw new Error(message);
      }

      try {
        const data = await readApiJson<{ item?: { id: string; name?: string } }>(res, "delete_lead_client");
        return data?.item || { id: tenantId };
      } catch {
        return { id: tenantId };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
    },
  });
}

export function useUpdateLeadClientN8nSettings() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tenantId,
      ...payload
    }: LeadClientN8nSettingsPayload & { tenantId: string }): Promise<LeadClientN8nSettingsSummary> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(
        `/api/lead-clients/${encodeURIComponent(tenantId)}/n8n-settings`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Falha ao salvar configurações do cliente"));
      }

      const responsePayload = await readApiJson<{ item?: LeadClientN8nSettingsSummary }>(res, "update_lead_client_n8n_settings");
      if (!responsePayload?.item) {
        throw new Error("Falha ao salvar configurações: resposta vazia do servidor");
      }

      return responsePayload.item;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
    },
  });
}

export function useUpdateLeadClientSegmentationConfig() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tenantId,
      segmentationConfig,
    }: {
      tenantId: string;
      segmentationConfig: LeadClientSegmentationConfig;
    }): Promise<LeadClientN8nSettingsSummary> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(
        `/api/lead-clients/${encodeURIComponent(tenantId)}/segmentation-config`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ segmentationConfig }),
        }
      );

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Segmentation config update failed"));
      }

      const responsePayload = await readApiJson<{ item?: LeadClientN8nSettingsSummary }>(res, "update_lead_client_segmentation_config");
      if (!responsePayload?.item) {
        throw new Error("Segmentation config update failed: missing response payload");
      }

      return responsePayload.item;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
    },
  });
}

export function useSaveLeadClientEvolutionInstance() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tenantId,
      instanceId,
      ...payload
    }: LeadClientEvolutionInstancePayload & {
      tenantId: string;
      instanceId?: string;
    }): Promise<LeadClientEvolutionInstance> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const path = instanceId
        ? `/api/lead-clients/${encodeURIComponent(tenantId)}/evolution-instances/${encodeURIComponent(instanceId)}`
        : `/api/lead-clients/${encodeURIComponent(tenantId)}/evolution-instances`;

      const res = await fetchApi(path, {
        method: instanceId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Evolution instance save failed"));
      }

      const responsePayload = await readApiJson<{ item?: LeadClientEvolutionInstance }>(res, "save_lead_client_evolution_instance");
      if (!responsePayload?.item) {
        throw new Error("Evolution instance save failed: missing response payload");
      }

      return responsePayload.item;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
    },
  });
}

export function useProvisionLeadClientEvolutionInstance() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tenantId,
      ...payload
    }: LeadClientEvolutionInstancePayload & {
      tenantId: string;
      instanceName?: string;
    }): Promise<LeadClientEvolutionProvisionResult> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(
        `/api/lead-clients/${encodeURIComponent(tenantId)}/evolution-instances/provision`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Evolution instance provision failed"));
      }

      const responsePayload = await readApiJson<{
        item?: LeadClientEvolutionInstance;
        evolution?: EvolutionProvisionQr | null;
      }>(res, "provision_lead_client_evolution_instance");
      if (!responsePayload?.item) {
        throw new Error("Evolution instance provision failed: missing response payload");
      }

      // Propaga o QR (evolution.qrcode.base64) além da instância salva.
      return {
        item: responsePayload.item,
        evolution: responsePayload.evolution ?? null,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
    },
  });
}

export function useDeleteLeadClientEvolutionInstance() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tenantId,
      instanceId,
    }: {
      tenantId: string;
      instanceId: string;
    }): Promise<void> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(
        `/api/lead-clients/${encodeURIComponent(tenantId)}/evolution-instances/${encodeURIComponent(instanceId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Evolution instance delete failed"));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
    },
  });
}

export interface EvolutionInstanceStatusResult {
  connected: boolean;
  profileName: string | null;
  ownerJid: string | null;
  error?: string;
}

export function useLeadClientEvolutionInstanceStatus(tenantId: string, instanceId: string) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["lead-clients", tenantId, "evolution-instances", instanceId, "status"],
    enabled: isAuthenticated && !!tenantId && !!instanceId,
    queryFn: async (): Promise<EvolutionInstanceStatusResult> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchApi(
        `/api/lead-clients/${encodeURIComponent(tenantId)}/evolution-instances/${encodeURIComponent(instanceId)}/status`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Falha ao consultar status da Evolution");
      
      return await res.json();
    },
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Importa as conversas de UM chip para a aba Conversas. Explícito: antes o sync
 * só rodava como efeito colateral de salvar o webhook, então não havia como
 * sincronizar um chip específico (o segundo chip nunca puxava as conversas).
 */
export function useSyncLeadClientEvolutionInstance(tenantId: string) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (instanceId: string) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchApi(
        `/api/lead-clients/${encodeURIComponent(tenantId)}/evolution-instances/${encodeURIComponent(instanceId)}/sync`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          // Importar o histórico (chats + mensagens + perfis) passa dos 15s
          // padrão; sem isto o AbortController cortava a resposta e a tela
          // dizia "signal is aborted without reason" mesmo com o sync rodando.
          timeoutMs: 5 * 60 * 1000,
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.message || "Falha ao sincronizar conversas deste chip.");
      }
      return data as {
        instance: string;
        started?: boolean;
        message?: string;
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages"] });
    },
  });
}

export function useVerifyLeadClientTable() {
  const { getIdToken } = useAuth();

  return useMutation({
    mutationFn: async (tenantId: string): Promise<LeadClientTableStatus> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(
        `/api/lead-clients/${encodeURIComponent(tenantId)}/table-status`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel verificar a tabela"));
      }

      const payload = await readApiJson<{ item?: { table?: LeadClientTableStatus } }>(res, "lead_client_table_status");
      if (!payload.item?.table) {
        throw new Error("Resposta sem status da tabela.");
      }

      return payload.item.table;
    },
  });
}
