// backend/src/services/conversationInsightHelper.js
// Helpers compartilhados de análise e formato de resumos de conversas.
// Camada base (services/) para permitir importação por domínios e outros serviços sem violação de hierarquia.

/**
 * Avalia se um lead possui conversa comercial real (não vazia e não classificada com escape 🚫).
 * Helper único centralizado para funil de métricas, filtros e travas de segurança do agente.
 *
 * @param {object|string|null} leadOuSummary Objeto de lead ou string do raw_chat_summary
 * @returns {boolean}
 */
export function temConversaComercial(leadOuSummary) {
  if (!leadOuSummary) return false;
  const summary =
    typeof leadOuSummary === "object"
      ? leadOuSummary.raw_chat_summary || leadOuSummary.chat_summary || leadOuSummary.summary || leadOuSummary.dados?.resumo_chat
      : leadOuSummary;

  if (!summary || typeof summary !== "string") return false;
  const trimmed = summary.trim();
  if (!trimmed) return false;

  // Se começar com 🚫, é conversa pessoal / sem oportunidade comercial
  if (/^🚫/u.test(trimmed)) return false;

  return true;
}
