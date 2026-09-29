/**
 * Cálculo puro do funil de 3 faixas para o card "Potencial da Base".
 *
 * Faixas mutuamente exclusivas:
 * 1. Em Negociação: inNegotiationCount * ticket
 * 2. Em Conversa: inConversationCount * ticket
 * 3. Nunca Abordados (Destaque): neverContactedCount * ticket
 *
 * Base Ativa Total: activeLeadsCount * ticket (soma das três faixas).
 * Se ticketMedio for nulo/indefinido/não configurado, isConfigured é false
 * e os valores monetários retornam null (sem inventar default no código).
 */

export interface BasePotentialSummary {
  totalLeads: number;
  buyersCount: number;
  lostCount: number;
  inNegotiationCount: number;
  inConversationCount: number;
  neverContactedCount: number;
  activeLeadsCount: number;
}

export interface BasePotentialResult {
  neverContactedCount: number;
  neverContactedValue: number | null;
  inConversationCount: number;
  inConversationValue: number | null;
  inNegotiationCount: number;
  inNegotiationValue: number | null;
  activeLeadsCount: number;
  totalActiveValue: number | null;
  isConfigured: boolean;
}

export function calculateBasePotential(
  summary?: Partial<BasePotentialSummary> | null,
  ticketMedio?: number | null
): BasePotentialResult {
  const neverContactedCount = Math.max(0, summary?.neverContactedCount ?? 0);
  const inConversationCount = Math.max(0, summary?.inConversationCount ?? 0);
  const inNegotiationCount = Math.max(0, summary?.inNegotiationCount ?? 0);
  const activeLeadsCount =
    summary?.activeLeadsCount != null
      ? Math.max(0, summary.activeLeadsCount)
      : neverContactedCount + inConversationCount + inNegotiationCount;

  const isValidTicket =
    ticketMedio != null &&
    !isNaN(Number(ticketMedio)) &&
    Number(ticketMedio) > 0;

  if (!isValidTicket) {
    return {
      neverContactedCount,
      neverContactedValue: null,
      inConversationCount,
      inConversationValue: null,
      inNegotiationCount,
      inNegotiationValue: null,
      activeLeadsCount,
      totalActiveValue: null,
      isConfigured: false,
    };
  }

  const ticket = Number(ticketMedio);
  const neverContactedValue = neverContactedCount * ticket;
  const inConversationValue = inConversationCount * ticket;
  const inNegotiationValue = inNegotiationCount * ticket;
  const totalActiveValue = activeLeadsCount * ticket;

  return {
    neverContactedCount,
    neverContactedValue,
    inConversationCount,
    inConversationValue,
    inNegotiationCount,
    inNegotiationValue,
    activeLeadsCount,
    totalActiveValue,
    isConfigured: true,
  };
}

export type BasePotentialSegmentId = "never_contacted" | "in_conversation" | "in_negotiation";

/**
 * Classifica um lead em uma das três faixas do Potencial da Base.
 * Leads convertidos (buyer) ou descartados (lost) ficam fora das faixas (retorna null).
 */
export function getLeadSegment(lead: any): BasePotentialSegmentId | null {
  if (!lead) return null;
  if (lead.stage === "buyer" || lead.stage === "lost") return null;
  // 1. Em Negociação: stage === 'open_budget' ou status === 'orcamento'
  if (lead.stage === "open_budget" || lead.status === "orcamento") {
    return "in_negotiation";
  }
  // 2. Em Conversa: possui resumo comercial sem escape 🚫
  const summary =
    lead.raw_chat_summary || lead.chat_summary || lead.summary || lead.dados?.resumo_chat;
  const hasCommercialChat =
    typeof summary === "string" && summary.trim().length > 0 && !/^🚫/u.test(summary.trim());
  if (hasCommercialChat) {
    return "in_conversation";
  }
  // 3. Nunca abordados: todo o restante da base ativa
  return "never_contacted";
}
