// O que cada aba de Disparos procura e por quais filtros dá para estreitar. O COMO (acento, caixa,
// combinação, "vazio não esconde nada") é de lib/listFilter.ts, igual para as três.

import { CAMPAIGN_STATUS_LABELS, type Campaign, type CampaignStatus, type DispatchSummaryCampaign } from "@/hooks/useCampanhas";
import type { LeadImportItem } from "@/hooks/useLeadImports";
import type { FacetOption, ListFilterConfig } from "@/lib/listFilter";

/** Estados que existem para uma campanha (CampaignStatus), na ordem em que a tela os lista. */
const CAMPAIGN_STATE_ORDER: CampaignStatus[] = [
  "active",
  "paused",
  "draft",
  "scheduled",
  "processing",
  "sent",
  "failed",
  "cancelled",
  "interrupted",
];
const OTHER_STATE = "other";

/**
 * Estado da campanha para o filtro. Campanha sem estado conta como Rascunho (como o selo do cartão);
 * valor que a tela não conhece vira "Outros" — assim nenhuma campanha fica fora do alcance dos filtros.
 */
export function campaignStateKey(c: Pick<Campaign, "status">): string {
  if (!c.status) return "draft";
  return c.status in CAMPAIGN_STATUS_LABELS ? c.status : OTHER_STATE;
}

function campaignStateOptions(items: readonly Campaign[]): FacetOption[] {
  const options: FacetOption[] = CAMPAIGN_STATE_ORDER.map((value) => ({ value, label: CAMPAIGN_STATUS_LABELS[value] }));
  if (items.some((c) => campaignStateKey(c) === OTHER_STATE)) options.push({ value: OTHER_STATE, label: "Outros" });
  return options;
}

/** Campanhas: busca por nome da campanha e do último chip; filtros de estado (todos) e de modo. */
export const CAMPAIGNS_FILTER: ListFilterConfig<Campaign> = {
  searchFields: (c) => [c.name, c.chip_name],
  facets: [
    { id: "state", label: "Estado", getValue: campaignStateKey, options: campaignStateOptions },
    {
      id: "mode",
      label: "Modo",
      // o cartão trata tudo que não é agente como disparo direto
      getValue: (c) => (c.mode === "agente" ? "agente" : "disparo"),
      options: [
        { value: "agente", label: "Agente IA" },
        { value: "disparo", label: "Disparo direto" },
      ],
    },
  ],
};

/** Fila de Envios (as abas Ativas/Encerradas continuam): busca por campanha e último chip; filtro por último chip. */
export const DISPATCH_QUEUE_FILTER: ListFilterConfig<DispatchSummaryCampaign> = {
  searchFields: (c) => [c.campaignName, c.chipName],
  facets: [{ id: "chip", label: "Último chip", getValue: (c) => c.chipName, emptyLabel: "Sem chip" }],
};

/** Planilhas Salvas: busca por arquivo e por quem importou; filtros de período e de quem importou. */
export const SAVED_SHEETS_FILTER: ListFilterConfig<LeadImportItem> = {
  searchFields: (i) => [i.source_name, i.uploaded_by_email],
  facets: [{ id: "uploader", label: "Importado por", getValue: (i) => i.uploaded_by_email, emptyLabel: "Não informado" }],
  ranges: [{ id: "period", label: "Período de importação", getDate: (i) => i.created_at }],
};
