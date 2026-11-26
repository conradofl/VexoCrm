import { API_BASE_URL, readApiErrorMessage } from "@/lib/api";

/** Lead que já recebeu OUTRA campanha (backend: campaign/repeatContact.js). */
export type RepeatDecision = "pular" | "enviar";
export const REPEAT_PAUSE_MARKER = "Aguardando sua decisão: leads que já receberam outra campanha";

export type RepeatContactsInfo = {
  pendentes: number;
  jaReceberam: number;
  campanhas: Array<{ campaignId: string; campaignName: string; count: number }>;
  decisao: RepeatDecision | null;
};

export function isRepeatDecisionPause(errorMessage: string | null | undefined) {
  return String(errorMessage || "").startsWith(REPEAT_PAUSE_MARKER);
}

export async function getRepeatContacts(token: string | null | undefined, campaignId: string): Promise<RepeatContactsInfo> {
  const res = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/repeat-contacts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao conferir leads repetidos"));
  return res.json();
}

export async function putRepeatDecision(
  token: string | null | undefined,
  campaignId: string,
  decisao: RepeatDecision
): Promise<{ ok: boolean; decisao: RepeatDecision; lotesLiberados: number }> {
  const res = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/repeat-contacts-decision`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ decisao }),
  });
  if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao gravar a decisão"));
  return res.json();
}
