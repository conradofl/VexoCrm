import type { LeadListFilters } from "./leadListApi";

export const STAGE_LABELS: Record<string, string> = {
  buyer: "Compradores",
  open_budget: "Orçamento Aberto",
  cold: "Leads Frios",
  lost: "Perdidos",
};

export const SEGMENT_LABELS: Record<string, string> = {
  never_contacted: "Nunca contatados",
  in_conversation: "Em conversa",
  in_negotiation: "Em negociação",
};

export interface AudienceDescriptionOptions {
  sheetName?: string;
  channelName?: string;
  operatorName?: string;
}

/**
 * Monta o nome/rótulo do público da campanha a partir dos filtros aplicados no Banco.
 * Formato padrão: "público: planilha X, estágio Y, 1.482 leads".
 */
export function buildFilterAudienceDescription(
  filters: LeadListFilters,
  totalCount: number,
  options?: AudienceDescriptionOptions
): string {
  const parts: string[] = [];

  if (filters.importId) {
    parts.push(options?.sheetName ? `planilha ${options.sheetName}` : "planilha selecionada");
  }

  const stage = (filters.stage || "").trim();
  if (stage && stage !== "all") {
    const stageLabel = STAGE_LABELS[stage] || stage;
    parts.push(`estágio ${stageLabel}`);
  }

  const tag = (filters.tag || "").trim();
  if (tag) {
    parts.push(`tag "${tag}"`);
  }

  const source = (filters.source || "").trim();
  if (source) {
    parts.push(`origem "${source}"`);
  }

  const channel = (filters.channel || "").trim();
  if (channel && channel !== "all") {
    parts.push(`canal ${options?.channelName || channel}`);
  }

  const search = (filters.search || "").trim();
  if (search) {
    parts.push(`busca "${search}"`);
  }

  const segment = (filters.segment || "").trim();
  if (segment) {
    const segLabel = SEGMENT_LABELS[segment] || segment;
    parts.push(`faixa "${segLabel}"`);
  }

  const formattedCount = Number(totalCount || 0).toLocaleString("pt-BR");
  if (parts.length === 0) {
    return `público: ${formattedCount} leads`;
  }
  return `público: ${parts.join(", ")}, ${formattedCount} leads`;
}

/**
 * Retorna o resumo textual dos filtros ativos para a barra de seleção.
 * Exemplo: "filtro: planilha UDIA 5, estágio Leads Frios"
 */
export function buildFilterCriterionSummary(
  filters: LeadListFilters,
  options?: AudienceDescriptionOptions
): string {
  const parts: string[] = [];

  if (filters.importId) {
    parts.push(options?.sheetName ? `planilha ${options.sheetName}` : "planilha selecionada");
  }

  const stage = (filters.stage || "").trim();
  if (stage && stage !== "all") {
    const stageLabel = STAGE_LABELS[stage] || stage;
    parts.push(`estágio ${stageLabel}`);
  }

  const tag = (filters.tag || "").trim();
  if (tag) {
    parts.push(`tag "${tag}"`);
  }

  const source = (filters.source || "").trim();
  if (source) {
    parts.push(`origem "${source}"`);
  }

  const channel = (filters.channel || "").trim();
  if (channel && channel !== "all") {
    parts.push(`canal ${options?.channelName || channel}`);
  }

  const search = (filters.search || "").trim();
  if (search) {
    parts.push(`busca "${search}"`);
  }

  const segment = (filters.segment || "").trim();
  if (segment) {
    const segLabel = SEGMENT_LABELS[segment] || segment;
    parts.push(`faixa "${segLabel}"`);
  }

  if (options?.operatorName) {
    parts.push(`responsável "${options.operatorName}"`);
  }

  if (parts.length === 0) {
    return "todos os leads";
  }
  return `filtro: ${parts.join(", ")}`;
}

/**
 * Formata o rótulo descritivo exibido na barra de ações.
 * Exemplo: "77.551 leads (filtro: planilha UDIA 5, estágio Leads Frios) − 3 desmarcados"
 */
export function formatSelectionBarLabel(params: {
  totalCount: number;
  filterSummary: string;
  excludedCount?: number;
}): string {
  const countStr = Number(params.totalCount || 0).toLocaleString("pt-BR");
  const base = `${countStr} leads (${params.filterSummary})`;
  if (params.excludedCount && params.excludedCount > 0) {
    return `${base} − ${params.excludedCount} ${params.excludedCount === 1 ? "desmarcado" : "desmarcados"}`;
  }
  return base;
}

