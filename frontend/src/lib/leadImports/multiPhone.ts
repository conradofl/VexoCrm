import { sanitizePhone } from "../phone";

/**
 * Importação com MAIS DE UMA coluna de telefone. Uma linha vira UM lead: o primeiro telefone válido identifica; os demais ficam em
 * dados.telefones_extras com a coluna de origem. A regra é a do servidor (backend/src/services/leadImport.js, resolveRowPhones); a fixture
 * compartilhada shared/multiPhoneCases.json confere as duas pontas caso a caso. A prévia da tela usa ESTE módulo, então o que ela mostra é
 * o que a importação de fato faz.
 */

export interface PhoneMappingLike {
  column: string;
  target: string;
}

export interface ResolvedRowPhones {
  telefone: string | null;
  colunaPrincipal: string | null;
  brutoPrincipal: string | null;
  extras: Array<{ telefone: string; coluna: string; bruto: string }>;
}

/** Telefone da importação: sanitizado e NUNCA o 5500… que este sistema já fabricou. Só os dígitos (sem "+"), ou null. */
function validImportPhone(raw: string, defaultDdd: string | null): string | null {
  const sanitized = sanitizePhone(raw, defaultDdd);
  if (!sanitized) return null;
  const digits = String(sanitized).replace(/^\+/, "");
  return digits.startsWith("5500") ? null : digits;
}

export function resolveRowPhones(row: Record<string, unknown>, mappings: ReadonlyArray<PhoneMappingLike>, defaultDdd: string | null = null): ResolvedRowPhones {
  const principal = mappings.find((m) => m && m.target === "telefone");
  const adicionais = mappings.filter((m) => m && m.target === "telefone_adicional");
  const colunas = [principal, ...adicionais].filter((m): m is PhoneMappingLike => Boolean(m));
  const candidatas = colunas.map((m) => ({
    coluna: m.column,
    bruto: row?.[m.column] !== undefined && row?.[m.column] !== null ? String(row[m.column]).trim() : "",
  }));
  const validos: Array<{ telefone: string; coluna: string; bruto: string }> = [];
  const vistos = new Set<string>();
  for (const c of candidatas) {
    if (!c.bruto) continue;
    const telefone = validImportPhone(c.bruto, defaultDdd);
    if (!telefone || vistos.has(telefone)) continue;
    vistos.add(telefone);
    validos.push({ telefone, coluna: c.coluna, bruto: c.bruto });
  }
  const [primeiro, ...resto] = validos;
  return {
    telefone: primeiro ? primeiro.telefone : null,
    colunaPrincipal: primeiro ? primeiro.coluna : null,
    brutoPrincipal: primeiro ? primeiro.bruto : (candidatas.find((c) => c.bruto)?.bruto ?? null),
    extras: resto,
  };
}

export interface PhonePreviewSummary {
  total: number;
  /** linhas que viram lead só com o telefone principal */
  onlyPrincipal: number;
  /** linhas que viram lead e guardam pelo menos um telefone adicional */
  withExtras: number;
  /** linhas puladas por não ter nenhum telefone válido (nenhum número é fabricado) */
  skipped: number;
}

/** Os três números da prévia antes de confirmar. onlyPrincipal + withExtras = leads que a importação cria; skipped = linhas puladas. */
export function summarizePhonePreview(rows: ReadonlyArray<Record<string, unknown>>, mappings: ReadonlyArray<PhoneMappingLike>, defaultDdd: string | null = null): PhonePreviewSummary {
  const out: PhonePreviewSummary = { total: rows.length, onlyPrincipal: 0, withExtras: 0, skipped: 0 };
  for (const row of rows) {
    const r = resolveRowPhones(row, mappings, defaultDdd);
    if (!r.telefone) out.skipped += 1;
    else if (r.extras.length > 0) out.withExtras += 1;
    else out.onlyPrincipal += 1;
  }
  return out;
}
