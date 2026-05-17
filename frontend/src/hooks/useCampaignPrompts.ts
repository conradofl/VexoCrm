import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export interface CampaignPrompt {
  id: string;
  client_id: string;
  name: string;
  content: string;
  updated_at: string;
  updated_by_email: string | null;
}

export function useCampaignPrompts(clientId: string | null) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["campaign-prompts", clientId],
    enabled: isAuthenticated && !!clientId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CampaignPrompt[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const res = await fetchApi(`/api/campaign-prompts?clientId=${encodeURIComponent(clientId!)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao carregar prompts"));
      const data = await readApiJson<{ prompts: CampaignPrompt[] }>(res, "campaign_prompts_fetch");
      return data.prompts ?? [];
    },
  });
}

export function useSaveCampaignPrompt() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { clientId: string; name: string; content: string }): Promise<CampaignPrompt> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const res = await fetchApi("/api/campaign-prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao salvar prompt"));
      const data = await readApiJson<{ prompt: CampaignPrompt }>(res, "campaign_prompt_save");
      if (!data.prompt) throw new Error("Resposta inválida da API.");
      return data.prompt;
    },
    onSuccess: (_saved, vars) => {
      queryClient.invalidateQueries({ queryKey: ["campaign-prompts", vars.clientId] });
    },
  });
}

export function useDeleteCampaignPrompt() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, clientId }: { id: string; clientId: string }): Promise<void> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const res = await fetchApi(`/api/campaign-prompts/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao remover prompt"));
    },
    onSuccess: (_v, vars) => {
      queryClient.invalidateQueries({ queryKey: ["campaign-prompts", vars.clientId] });
    },
  });
}
