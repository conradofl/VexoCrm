import type { CampaignDispatch } from "@/hooks/useCampanhas";

// SPEC 17: o número que a tela mostra é o número que sai. Sem lotes, o envio cobre o público inteiro; o único limite
// possível é o opcional "só os primeiros N", escolhido por quem cria. Nunca um default invisível.

/** Limite opcional digitado: inteiro positivo, ou null (= sem limite). */
export function parseDispatchCap(text: string): number | null {
  const value = Number(String(text ?? "").trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

export type DispatchVolume =
  | { kind: "all"; total: number }
  | { kind: "capped"; sending: number; total: number; left: number }
  | { kind: "batched"; total: number; batches: number; size: number };

export function describeDispatchVolume(input: {
  totalLeads: number;
  batchingEnabled: boolean;
  batchSize: string;
  capText: string;
}): DispatchVolume | null {
  const total = Math.max(Math.trunc(input.totalLeads || 0), 0);
  if (total === 0) return null;

  if (input.batchingEnabled) {
    const size = Math.max(Number.parseInt(input.batchSize, 10) || 100, 1);
    return { kind: "batched", total, batches: Math.ceil(total / size), size };
  }

  const cap = parseDispatchCap(input.capText);
  if (cap !== null && cap < total) return { kind: "capped", sending: cap, total, left: total - cap };
  return { kind: "all", total };
}

export function formatDispatchVolume(volume: DispatchVolume): string {
  if (volume.kind === "batched") {
    return `${volume.total} leads em ${volume.batches} ${volume.batches === 1 ? "lote" : "lotes"} de até ${volume.size}.`;
  }
  if (volume.kind === "capped") {
    return `${volume.sending} de ${volume.total} leads vão sair. Os outros ${volume.left} não saem.`;
  }
  return volume.total === 1 ? "1 lead vai sair neste envio." : `${volume.total} leads vão sair neste envio.`;
}

/** Coluna "Leads" da listagem: vem dos lotes que existem, nunca do limit_per_run da campanha. */
export function describeCampaignLeads(campaignId: string, dispatches: CampaignDispatch[] | undefined): string {
  const lotes = (dispatches ?? []).filter((d) => d.campaign_id === campaignId && d.status !== "cancelled");
  if (lotes.length === 0) return "Sem envio criado";
  const total = lotes.reduce((sum, d) => sum + (Number(d.target_count) || 0), 0);
  if (lotes.length === 1) return total > 0 ? `${total} leads` : "—";
  return `${total} leads em ${lotes.length} lotes`;
}
