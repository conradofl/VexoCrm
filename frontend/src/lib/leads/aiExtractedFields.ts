// frontend/src/lib/leads/aiExtractedFields.ts
// Funções puras e helpers para exibição de campos comerciais e extração de IA (Pilar 4)

export const COMMERCIAL_FIELD_LABELS: Record<string, string> = {
  interesse: "Interesse",
  faixa_valor: "Faixa de Valor",
  tipo_negocio: "Tipo de Negócio",
  cidade_regiao: "Cidade / Região",
  urgencia: "Urgência",
  orcamento: "Orçamento",
  renda: "Renda",
  renda_mensal: "Renda Mensal",
  segmento: "Segmento",
  cargo: "Cargo",
  faturamento_anual: "Faturamento Anual",
};

/**
 * Converte chaves de campos (snake_case) em rótulos amigáveis para exibição.
 */
export function formatCustomFieldLabel(key: string): string {
  if (!key) return "";
  const normalized = key.trim().toLowerCase();
  if (COMMERCIAL_FIELD_LABELS[normalized]) {
    return COMMERCIAL_FIELD_LABELS[normalized];
  }
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Verifica se um determinado campo foi extraído automaticamente pela IA.
 */
export function isFieldAiExtracted(key: string, aiExtractedFields?: any): boolean {
  if (!key) return false;
  if (Array.isArray(aiExtractedFields)) {
    return aiExtractedFields.includes(key);
  }
  if (aiExtractedFields && typeof aiExtractedFields === "object") {
    return Boolean(aiExtractedFields[key]);
  }
  return false;
}

/**
 * Verifica se um campo foi validado ou editado manualmente por um humano.
 */
export function isFieldManuallyEdited(key: string, manualFields?: any): boolean {
  if (!key) return false;
  if (Array.isArray(manualFields)) {
    return manualFields.includes(key);
  }
  return false;
}
