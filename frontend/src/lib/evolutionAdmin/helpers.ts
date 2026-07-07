import { EditForm } from "./types";

export function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("pt-BR");
}

export function shortUrl(value?: string | null) {
  if (!value) return "-";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

export const emptyEditForm: EditForm = {
  name: "",
  dispatchWebhookUrl: "",
  dispatchWebhookToken: "",
  inboundBearerToken: "",
  active: true,
  tenantId: "",
  isDefault: false,
  evolutionInstance: "",
  webhookUrl: "",
};
