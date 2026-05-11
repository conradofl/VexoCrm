import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export interface LeadClient {
  id: string;
  name: string;
  created_at?: string;
  n8n_settings?: LeadClientN8nSettingsSummary;
  n8n_onboarding_status?: string;
}

export interface CreateLeadClientPayload {
  id: string;
  name: string;
  n8nSettings?: LeadClientN8nSettingsPayload;
}

export interface LeadClientN8nSettingsPayload {
  dispatchWebhookUrl?: string | null;
  dispatchWebhookToken?: string | null;
  inboundBearerToken?: string | null;
  active?: boolean;
}

export interface LeadClientN8nSettingsSummary {
  client_id?: string;
  dispatch_webhook_url: string | null;
  has_dispatch_webhook_token: boolean;
  has_inbound_bearer_token: boolean;
  active: boolean;
  updated_at: string | null;
  updated_by_email?: string | null;
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
        throw new Error(await readApiErrorMessage(res, "N8N settings update failed"));
      }

      const responsePayload = await readApiJson<{ item?: LeadClientN8nSettingsSummary }>(res, "update_lead_client_n8n_settings");
      if (!responsePayload?.item) {
        throw new Error("N8N settings update failed: missing response payload");
      }

      return responsePayload.item;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
    },
  });
}
