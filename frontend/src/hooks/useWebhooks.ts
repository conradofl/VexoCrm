import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export interface WebhookSettings {
  inbound_token: string;
  conversion_token: string;
}

export function useWebhookSettings(tenantId: string) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["webhook-settings", tenantId],
    enabled: isAuthenticated && !!tenantId,
    queryFn: async (): Promise<WebhookSettings | null> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchApi(`/api/lead-clients/${encodeURIComponent(tenantId)}/webhooks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Webhooks fetch failed: ${res.status}`);
      }

      const payload = await readApiJson<{ item?: WebhookSettings | null }>(res, "webhook_settings");
      return payload.item || null;
    },
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
}

export function useGenerateWebhookSettings() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tenantId: string): Promise<WebhookSettings> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchApi(`/api/lead-clients/${encodeURIComponent(tenantId)}/webhooks/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Webhooks generate failed"));
      }

      const payload = await readApiJson<{ item?: WebhookSettings }>(res, "generate_webhook_settings");
      if (!payload?.item) {
        throw new Error("Webhooks generate failed: missing response payload");
      }

      return payload.item;
    },
    onSuccess: (_, tenantId) => {
      queryClient.invalidateQueries({ queryKey: ["webhook-settings", tenantId] });
    },
  });
}
