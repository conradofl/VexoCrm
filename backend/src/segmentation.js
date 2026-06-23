// Segmentação unificada (catálogo + filtro único + matcher).
// Substitui, de forma incremental, os 3 mecanismos antigos:
//   1. filterRules client-side (LeadImports.tsx)
//   2. leadMatchesCampaignSegmentation hardcoded (server.js) — vira adapter legado
//   3. segmentation_config por empresa (server.js) — vira CATÁLOGO (fonte da verdade)
//
// Modelo:
//   Catálogo (por empresa):  { version:2, fields:[{field,label,type,aliases?}], featuredKpis:[field,...] }
//   Filtro (campanha/preview): { filters:[{field,operator,value}] }  operator: equals|contains|gt|lt
//
// Compat: lê catálogo v1 (kpis[]) e dispara campanha no shape legado via roteamento
// (ver isFilterShape) — nunca traduz cegamente, então campanha antiga não muda.

import {
  normalizeString,
  normalizeLooseText,
  getNormalizedField,
  parseMoneyLikeValue,
} from "./textNormalize.js";

export const SEGMENTATION_FIELD_TYPES = ["money", "number", "category", "date"];
export const SEGMENTATION_OPERATORS = ["equals", "contains", "gt", "lt"];
export const FEATURED_KPI_CAP = 6;

// Operadores válidos por tipo (enforced no write-path/UI; matcher é tolerante).
export function operatorsForType(type) {
  switch (type) {
    case "money":
    case "number":
      return ["gt", "lt", "equals"];
    case "date":
      return ["gt", "lt"];
    case "category":
    default:
      return ["equals", "contains"];
  }
}

function fieldKey(value) {
  const n = normalizeLooseText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return n.slice(0, 64);
}

// ─── Catálogo: normaliza v1 (kpis[]) e v2 (fields[]+featuredKpis) ───────────────

export function normalizeSegmentationCatalog(input) {
  const source = input && typeof input === "object" ? input : {};

  // v1 → fields = kpis; featuredKpis = kpis habilitados (cap 6)
  const rawFields = Array.isArray(source.fields)
    ? source.fields
    : Array.isArray(source.kpis)
      ? source.kpis
      : [];

  const seen = new Set();
  const fields = [];
  for (let i = 0; i < rawFields.length; i += 1) {
    const item = rawFields[i] || {};
    const field = fieldKey(item.field || item.key || item.label);
    if (!field || seen.has(field)) continue;
    seen.add(field);
    const rawType = normalizeLooseText(item.type);
    const aliases = Array.isArray(item.aliases)
      ? item.aliases.map((a) => normalizeString(a)).filter(Boolean)
      : [];
    fields.push({
      field,
      label: (normalizeString(item.label) || field).slice(0, 60),
      type: SEGMENTATION_FIELD_TYPES.includes(rawType) ? rawType : "category",
      ...(aliases.length ? { aliases } : {}),
    });
  }

  // featuredKpis: explícito (v2) ou derivado dos kpis enabled (v1). Cap 6, só campos existentes.
  let featuredRaw;
  if (Array.isArray(source.featuredKpis)) {
    featuredRaw = source.featuredKpis.map(fieldKey);
  } else if (Array.isArray(source.kpis)) {
    featuredRaw = source.kpis
      .filter((k) => k && k.enabled !== false)
      .map((k) => fieldKey(k.field || k.key || k.label));
  } else {
    featuredRaw = fields.map((f) => f.field);
  }
  const featuredKpis = [];
  for (const f of featuredRaw) {
    if (f && seen.has(f) && !featuredKpis.includes(f)) featuredKpis.push(f);
    if (featuredKpis.length >= FEATURED_KPI_CAP) break;
  }

  return { version: 2, fields, featuredKpis };
}

// Catálogo a partir da linha de settings (segmentation_config). Pura.
export function getSegmentationCatalog(segmentationConfig) {
  return normalizeSegmentationCatalog(segmentationConfig);
}

// ─── Filtros: shape único ──────────────────────────────────────────────────────

// Campanha "nova" usa { filters:[...] }. Shape legado tem keys fixas (gender, productType...).
export function isFilterShape(segmentation) {
  return !!segmentation && typeof segmentation === "object" && Array.isArray(segmentation.filters);
}

export function normalizeFilters(input, catalog = null) {
  const raw = Array.isArray(input)
    ? input
    : Array.isArray(input?.filters)
      ? input.filters
      : [];
  const allowed = catalog && Array.isArray(catalog.fields)
    ? new Map(catalog.fields.map((f) => [f.field, f]))
    : null;

  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const field = fieldKey(r.field);
    if (!field) continue;
    if (allowed && !allowed.has(field)) continue; // descarta campo fora do catálogo
    const operator = SEGMENTATION_OPERATORS.includes(r.operator) ? r.operator : "equals";
    const value = typeof r.value === "number" ? r.value : normalizeString(r.value);
    if (value === null || value === "" || value === undefined) continue; // filtro vazio = sem restrição
    out.push({ field, operator, value });
  }
  return out;
}

// ─── Matcher único ─────────────────────────────────────────────────────────────

function leadValueForField(normalizedData, field, catalogByField) {
  const def = catalogByField ? catalogByField.get(field) : null;
  const keys = def && Array.isArray(def.aliases) ? [field, ...def.aliases] : [field];
  return getNormalizedField(normalizedData, keys);
}

function applyOperator(leadRaw, operator, value, type) {
  if (operator === "gt" || operator === "lt") {
    const target = typeof value === "number" ? value : parseMoneyLikeValue(value);
    const lead = parseMoneyLikeValue(leadRaw);
    if (type === "date" || (lead === null && target === null)) {
      const leadTs = Date.parse(normalizeString(leadRaw) || "");
      const targetTs = Date.parse(normalizeString(value) || "");
      if (Number.isNaN(leadTs) || Number.isNaN(targetTs)) return false;
      return operator === "gt" ? leadTs > targetTs : leadTs < targetTs;
    }
    if (lead === null || target === null) return false;
    return operator === "gt" ? lead > target : lead < target;
  }

  const leadTxt = normalizeLooseText(leadRaw);
  const valTxt = normalizeLooseText(value);
  if (operator === "equals") {
    // money/number: igualdade numérica quando ambos numéricos
    const leadNum = parseMoneyLikeValue(leadRaw);
    const valNum = typeof value === "number" ? value : parseMoneyLikeValue(value);
    if ((type === "money" || type === "number") && leadNum !== null && valNum !== null) {
      return leadNum === valNum;
    }
    return leadTxt === valTxt;
  }
  // contains
  return valTxt ? leadTxt.includes(valTxt) : true;
}

// lead: { normalized_data?, ... }. fields: catálogo.fields. filters: [{field,operator,value}]
export function leadMatchesSegmentation(lead, fields = [], filters = []) {
  if (!filters || filters.length === 0) return true;
  const normalizedData =
    lead && lead.normalized_data && typeof lead.normalized_data === "object"
      ? lead.normalized_data
      : lead || {};
  const catalogByField = new Map((fields || []).map((f) => [f.field, f]));

  for (const filter of filters) {
    const def = catalogByField.get(filter.field);
    const type = def?.type || "category";
    const leadRaw = leadValueForField(normalizedData, filter.field, catalogByField);
    if (!applyOperator(leadRaw, filter.operator, filter.value, type)) return false;
  }
  return true;
}
