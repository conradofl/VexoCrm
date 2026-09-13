// Helper centralizado para canonicalização de telefones em queries PostgreSQL.
// Garante casamento exato no padrão brasileiro com ou sem 9º dígito e DDI 55.

export const SQL_CANONICAL_PHONE = (col) => `
  CASE
    WHEN ${col} LIKE '%@%' THEN ${col}
    WHEN length(regexp_replace(${col}, '\\D', '', 'g')) = 12 AND regexp_replace(${col}, '\\D', '', 'g') ~ '^55[1-9]{2}[6-9]'
      THEN '55' || substr(regexp_replace(${col}, '\\D', '', 'g'), 3, 2) || '9' || substr(regexp_replace(${col}, '\\D', '', 'g'), 5)
    WHEN length(regexp_replace(${col}, '\\D', '', 'g')) = 10 AND regexp_replace(${col}, '\\D', '', 'g') ~ '^[1-9]{2}[6-9]'
      THEN '55' || substr(regexp_replace(${col}, '\\D', '', 'g'), 1, 2) || '9' || substr(regexp_replace(${col}, '\\D', '', 'g'), 3)
    WHEN length(regexp_replace(${col}, '\\D', '', 'g')) = 10 AND regexp_replace(${col}, '\\D', '', 'g') ~ '^[1-9]{2}[2-5]'
      THEN '55' || regexp_replace(${col}, '\\D', '', 'g')
    WHEN length(regexp_replace(${col}, '\\D', '', 'g')) = 11 AND regexp_replace(${col}, '\\D', '', 'g') ~ '^[1-9]{2}9'
      THEN '55' || regexp_replace(${col}, '\\D', '', 'g')
    ELSE regexp_replace(${col}, '\\D', '', 'g')
  END
`;

/**
 * Normaliza um telefone bruto para o formato canônico brasileiro no JavaScript.
 * Espelha fielmente a expressão SQL_CANONICAL_PHONE para garantir paridade exata
 * na escrita, permitindo indexação e busca direta por igualdade (=).
 *
 * Ex.:
 * - "(34) 99109-3607" -> "5534991093607"
 * - "3491093607"      -> "5534991093607"
 * - "553491093607"    -> "5534991093607"
 * - "5534991093607"   -> "5534991093607"
 * - "3432345678"      -> "553432345678"
 */
export function toCanonicalPhone(raw) {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (s.includes("@")) return s;
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";

  // 12 dígitos: 55 + DDD [1-9][1-9] + celular [6-9] (sem o 9) -> 55 + DDD + 9 + restante
  if (digits.length === 12 && /^55[1-9]{2}[6-9]/.test(digits)) {
    return `55${digits.slice(2, 4)}9${digits.slice(4)}`;
  }
  // 10 dígitos: DDD [1-9][1-9] + celular [6-9] (sem 55 e sem o 9) -> 55 + DDD + 9 + restante
  if (digits.length === 10 && /^[1-9]{2}[6-9]/.test(digits)) {
    return `55${digits.slice(0, 2)}9${digits.slice(2)}`;
  }
  // 10 dígitos: fixo com DDD [1-9][1-9] + [2-5] (sem 55) -> 55 + fixo
  if (digits.length === 10 && /^[1-9]{2}[2-5]/.test(digits)) {
    return `55${digits}`;
  }
  // 11 dígitos: celular com DDD [1-9][1-9] + 9 (sem 55) -> 55 + celular
  if (digits.length === 11 && /^[1-9]{2}9/.test(digits)) {
    return `55${digits}`;
  }
  return digits;
}
