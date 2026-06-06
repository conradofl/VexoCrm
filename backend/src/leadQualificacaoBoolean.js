// backend/src/leadQualificacaoBoolean.js
// Coerces lead.qualificacao like Supabase Edge `conversation-memory-latest` (obterQualificacaoComoBooleano).

export function parseLeadQualificacaoBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return false;

  let text = String(value).trim();
  if (!text) return false;
  if (text.startsWith("=")) {
    text = text.slice(1).trim();
  }
  return text.toLowerCase() === "true";
}
