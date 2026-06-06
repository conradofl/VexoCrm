import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export interface HelpDeskMessage {
  role: "user" | "assistant";
  content: string;
}

export interface HelpDeskContext {
  pageTitle: string;
  currentPath: string;
  selectedClientId?: string | null;
  selectedClientName?: string | null;
}

export function useHelpDeskStatus() {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["helpdesk-status"],
    enabled: isAuthenticated,
    queryFn: async (): Promise<{ enabled: boolean; provider?: string; model?: string }> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchApi("/api/helpdesk/status", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel carregar o help desk"));
      }

      return readApiJson(res, "helpdesk_status");
    },
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
}

export function useHelpDeskChat() {
  const { getIdToken } = useAuth();

  return useMutation({
    mutationFn: async ({
      message,
      history,
      context,
    }: {
      message: string;
      history: HelpDeskMessage[];
      context: HelpDeskContext;
    }): Promise<HelpDeskMessage> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchApi("/api/helpdesk/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message,
          history: history.slice(-8),
          context,
        }),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel responder agora"));
      }

      const payload = await readApiJson<{ item?: { answer?: string } }>(res, "helpdesk_chat");
      const answer = payload.item?.answer?.trim();
      if (!answer) {
        throw new Error("O help desk retornou uma resposta vazia.");
      }

      return {
        role: "assistant",
        content: answer,
      };
    },
  });
}
