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
