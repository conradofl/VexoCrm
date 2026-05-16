import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export interface TemplateField {
  key: string;
  label: string;
  description: string;
  required: boolean;
}

export interface ChatbotTemplate {
  id: string;
  template_key: string;
  client_id: string | null;
  display_name: string;
  agent_name: string;
  agent_role: string;
  data_fields: TemplateField[];
  required_fields: string[];
  classification: { quente: string; morno: string; frio: string };
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
  updated_by_email: string | null;
}

export function useChatbotTemplates(clientId: string | null) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["chatbot-templates", clientId],
    enabled: isAuthenticated && !!clientId,
    queryFn: async (): Promise<ChatbotTemplate[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi(
        `/api/chatbot-templates?clientId=${encodeURIComponent(clientId!)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao carregar templates"));

      const data = await readApiJson<{ templates: ChatbotTemplate[] }>(res, "templates_fetch");
      return data.templates ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveChatbotTemplate() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      payload: Omit<ChatbotTemplate, "id" | "is_builtin" | "created_at" | "updated_at" | "updated_by_email"> & {
        clientId: string;
      }
    ): Promise<ChatbotTemplate> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi("/api/chatbot-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          clientId: payload.clientId,
          templateKey: payload.template_key,
          displayName: payload.display_name,
          agentName: payload.agent_name,
          agentRole: payload.agent_role,
          dataFields: payload.data_fields,
          requiredFields: payload.required_fields,
          classification: payload.classification,
        }),
      });

      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao salvar template"));

      const data = await readApiJson<{ template: ChatbotTemplate }>(res, "template_save");
      if (!data.template) throw new Error("Resposta inválida da API.");
      return data.template;
    },
    onSuccess: (_saved, vars) => {
      queryClient.invalidateQueries({ queryKey: ["chatbot-templates", vars.clientId] });
    },
  });
}

export function useDeleteChatbotTemplate() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, clientId }: { id: string; clientId: string }): Promise<void> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetchApi(`/api/chatbot-templates/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao deletar template"));
    },
    onSuccess: (_r, vars) => {
      queryClient.invalidateQueries({ queryKey: ["chatbot-templates", vars.clientId] });
    },
  });
}
