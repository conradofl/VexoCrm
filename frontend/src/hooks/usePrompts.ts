import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export type PromptType = "padrao" | "extrato";

export interface Prompt {
  clientId: string;
  type: PromptType;
  content: string;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

export function usePrompt(clientId: string | null, type: PromptType) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["prompt", clientId, type],
    enabled: isAuthenticated && !!clientId,
    queryFn: async (): Promise<Prompt | null> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi(
        `/api/prompts?clientId=${encodeURIComponent(clientId!)}&type=${type}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.status === 404) return null;

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao carregar prompt"));
      }

      const data = await readApiJson<{ item?: Prompt }>(res, "prompt_fetch");
      return data.item ?? null;
    },
    retry: false,
    staleTime: 2 * 60 * 1000,
  });
}

export function useSavePrompt() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      clientId,
      type,
      content,
    }: {
      clientId: string;
      type: PromptType;
      content: string;
    }): Promise<Prompt> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi("/api/prompts", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId, type, content }),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao salvar prompt"));
      }

      const data = await readApiJson<{ item?: Prompt }>(res, "prompt_save");
      if (!data.item) throw new Error("Resposta inválida da API.");
      return data.item;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["prompt", saved.clientId, saved.type], saved);
    },
  });
}
