import type { TemplateField } from "@/hooks/useChatbotTemplates";
import { BACKEND_URL } from "./constants";

export function buildWebhookUrl(clientId: string) {
  return `${BACKEND_URL}/api/hardcoded-chat-webhook?clientId=${encodeURIComponent(clientId)}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "Nunca salvo";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export function emptyTemplate(clientId: string) {
  return {
    clientId,
    client_id: clientId,
    template_key: "",
    display_name: "",
    agent_name: "",
    agent_role: "",
    data_fields: [] as TemplateField[],
    required_fields: [] as string[],
    classification: { quente: "", morno: "", frio: "" },
  };
}

export type EditorState = ReturnType<typeof emptyTemplate>;
