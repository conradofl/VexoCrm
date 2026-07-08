import { ChatbotTemplate, TemplateField } from "@/hooks/useChatbotTemplates";

export function emptyTemplate(
  clientId: string
): Omit<ChatbotTemplate, "id" | "is_builtin" | "created_at" | "updated_at" | "updated_by_email"> & {
  clientId: string;
} {
  return {
    clientId,
    client_id: clientId,
    template_key: "",
    display_name: "",
    agent_name: "",
    agent_role: "",
    data_fields: [],
    required_fields: [],
    classification: { quente: "", morno: "", frio: "" },
  };
}

export function cloneFromBuiltin(
  source: ChatbotTemplate,
  clientId: string
): ReturnType<typeof emptyTemplate> {
  return {
    clientId,
    client_id: clientId,
    template_key: `${source.template_key}_custom`,
    display_name: `${source.display_name} (cópia)`,
    agent_name: source.agent_name,
    agent_role: source.agent_role,
    data_fields: source.data_fields.map((f) => ({ ...f })),
    required_fields: [...source.required_fields],
    classification: { ...source.classification },
  };
}

export function generateJsonPreview(fields: TemplateField[]): string {
  const obj: Record<string, string> = {};
  for (const f of fields) obj[f.key] = f.description || f.label;
  return JSON.stringify(obj, null, 2);
}
