import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

export interface LeadClient {
  id: string;
  name: string;
  created_at?: string;
}

export interface CreateLeadClientPayload {
  id: string;
  name: string;
}

type LeadClientDeleteResponse = {
  item?: {
    id: string;
    name?: string;
  };
  error?: {
    message?: string;
    details?: string;
  };
};

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

      const res = await fetch(`${API_BASE_URL}/api/lead-clients`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Lead clients fetch failed: ${res.status} ${errText}`);
      }

      const payload = await res.json();
      return Array.isArray(payload.items) ? payload.items : [];
    },
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

      const res = await fetch(`${API_BASE_URL}/api/lead-clients`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const responsePayload = await res.json().catch(() => null);

      if (!res.ok) {
        const apiMessage =
          responsePayload?.error?.message ||
          responsePayload?.error?.details ||
          `Lead client create failed: ${res.status}`;
        throw new Error(apiMessage);
      }

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

      const parseResponsePayload = async (res: Response): Promise<LeadClientDeleteResponse | null> => {
        const text = await res.text().catch(() => "");
        if (!text) return null;

        try {
          return JSON.parse(text);
        } catch {
          return { error: { message: text } };
        }
      };

      const attempts = [
        {
          url: `${API_BASE_URL}/api/lead-clients/delete`,
          options: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ tenantId }),
          },
        },
        {
          url: `${API_BASE_URL}/api/lead-clients/${encodeURIComponent(tenantId)}`,
          options: {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        },
        {
          url: `${API_BASE_URL}/api/lead-clients/${encodeURIComponent(tenantId)}/delete`,
          options: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ tenantId }),
          },
        },
      ] satisfies Array<{ url: string; options: RequestInit }>;

      let res: Response | null = null;
      let responsePayload: LeadClientDeleteResponse | null = null;

      for (const attempt of attempts) {
        res = await fetch(attempt.url, attempt.options);
        responsePayload = await parseResponsePayload(res);

        if (res.ok || res.status !== 404) {
          break;
        }
      }

      if (!res || !res.ok) {
        const apiMessage =
          responsePayload?.error?.message ||
          responsePayload?.error?.details ||
          (res?.status === 404
            ? "A rota de exclusao de empresas ainda nao esta publicada no backend."
            : `Lead client delete failed: ${res?.status ?? "unknown"}`);
        throw new Error(apiMessage);
      }

      return responsePayload?.item || { id: tenantId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
    },
  });
}
