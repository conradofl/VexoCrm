/**
 * Utilitários de serialização do schema de dados do lead no banco.
 * - dados: JSONB com campos coletados pelo chatbot (interesse, cidade, etc.)
 * - historico: JSONB com array de mensagens { role, content }
 */

/**
 * Normaliza o objeto de dados do lead antes de salvar.
 * Aceita tanto { dados: {...} } quanto o objeto plano diretamente.
 * Remove campos undefined/null para não sobrescrever dados válidos.
 */
export function normalizeLeadsOutlierDados(input) {
  const raw = input?.dados ?? input ?? {};
  const result = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined && value !== null && value !== "") {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Converte historico do banco (JSON string ou array) para array de mensagens.
 */
export function parseStoredHistorico(historico) {
  if (!historico) return null;
  if (Array.isArray(historico)) return historico;
  if (typeof historico === "string") {
    try {
      const parsed = JSON.parse(historico);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Serializa array de mensagens para armazenamento no banco (mantém como array para JSONB).
 */
export function serializeHistorico(history) {
  if (!Array.isArray(history)) return [];
  return history;
}
