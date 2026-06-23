// Helpers puros de normalização de texto/valor.
// Cópia fiel das funções homônimas em server.js (normalizeString, normalizeLooseText,
// getNormalizedField, parseMoneyLikeValue) extraídas para reuso pelo módulo de
// segmentação sem criar dependência circular com server.js.
// Mantê-las idênticas ao server.js: se uma mudar lá, espelhar aqui.

export function normalizeString(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.startsWith("=") ? str.slice(1).trim() : str;
}

export function normalizeLooseText(value) {
  return normalizeString(value)
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim() || "";
}

export function getNormalizedField(data = {}, keys = []) {
  for (const key of keys) {
    const directValue = data[key];
    if (directValue !== undefined && directValue !== null && normalizeString(directValue)) {
      return normalizeString(directValue);
    }
  }

  const entries = Object.entries(data || {});
  for (const [key, value] of entries) {
    const normalizedKey = normalizeLooseText(key).replace(/[^a-z0-9]/g, "");
    if (keys.some((candidate) => normalizeLooseText(candidate).replace(/[^a-z0-9]/g, "") === normalizedKey)) {
      return normalizeString(value);
    }
  }

  return "";
}

export function parseMoneyLikeValue(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const cleaned = normalized
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
