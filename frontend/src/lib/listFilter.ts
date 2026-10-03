// Busca e filtros de listas que já estão inteiras no navegador. Uma implementação só, usada por
// Campanhas, Fila de Envios e Planilhas Salvas (como getStableColor para a cor): cada aba declara O QUE
// procura e quais filtros tem; COMO filtra é sempre este arquivo.
//
// Regras:
//  - busca por texto, sem acento e sem diferenciar maiúscula; pedaço do texto basta;
//  - dentro de um filtro de seleção vale "ou" (ativa OU pausada); entre filtros e a busca vale "e";
//  - filtro sem seleção não esconde nada — a lista nunca começa filtrada.

export interface FacetOption {
  value: string;
  label: string;
}

/** Filtro de seleção (várias opções). `options` ausente = opções tiradas dos próprios itens. */
export interface FacetDef<T> {
  id: string;
  label: string;
  getValue: (item: T) => string | null | undefined;
  /** Opções declaradas, ou função dos itens (para somar uma opção "Outros" quando aparecer valor desconhecido). */
  options?: readonly FacetOption[] | ((items: readonly T[]) => FacetOption[]);
  /** Rótulo de quem não tem valor (ex.: "Sem chip"). Sem isto, itens sem valor não geram opção. */
  emptyLabel?: string;
}

/** Filtro de período (de/até, dias locais, inclusivos). */
export interface RangeDef<T> {
  id: string;
  label: string;
  getDate: (item: T) => string | Date | null | undefined;
}

export interface ListFilterConfig<T> {
  /** Textos em que a busca procura. */
  searchFields: (item: T) => Array<string | null | undefined>;
  facets?: readonly FacetDef<T>[];
  ranges?: readonly RangeDef<T>[];
}

export interface DateRange {
  from: string;
  to: string;
}

export interface ListFilterState {
  search: string;
  facets: Record<string, string[]>;
  ranges: Record<string, DateRange>;
}

export const EMPTY_FILTER_STATE: ListFilterState = { search: "", facets: {}, ranges: {} };

/** minúsculas, sem acento, espaços colapsados: "  CLÍNICA  Sorriso " → "clinica sorriso" */
export function normalizeSearchText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Algum dos campos contém o texto digitado? Texto vazio casa com tudo. */
export function matchesSearch(fields: Array<string | null | undefined>, query: string): boolean {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return fields.some((f) => normalizeSearchText(f).includes(needle));
}

const FACET_EMPTY_KEY = "";

function matchesFacet<T>(item: T, facet: FacetDef<T>, selected: string[] | undefined): boolean {
  if (!selected || selected.length === 0) return true;
  const raw = facet.getValue(item);
  const value = raw === null || raw === undefined ? FACET_EMPTY_KEY : String(raw);
  return selected.includes(value);
}

function startOfLocalDay(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
}

function endOfLocalDay(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999).getTime();
}

function matchesRange<T>(item: T, range: RangeDef<T>, value: DateRange | undefined): boolean {
  if (!value || (!value.from && !value.to)) return true;
  const raw = range.getDate(item);
  const at = raw ? new Date(raw).getTime() : NaN;
  if (Number.isNaN(at)) return false; // sem data não prova que está no período
  const from = value.from ? startOfLocalDay(value.from) : null;
  const to = value.to ? endOfLocalDay(value.to) : null;
  if (from !== null && at < from) return false;
  if (to !== null && at > to) return false;
  return true;
}

export function hasActiveFilter(state: ListFilterState): boolean {
  if (normalizeSearchText(state.search) !== "") return true;
  if (Object.values(state.facets).some((v) => v.length > 0)) return true;
  return Object.values(state.ranges).some((r) => r.from || r.to);
}

export function filterList<T>(items: readonly T[], state: ListFilterState, config: ListFilterConfig<T>): T[] {
  return items.filter((item) => {
    if (!matchesSearch(config.searchFields(item), state.search)) return false;
    for (const facet of config.facets ?? []) {
      if (!matchesFacet(item, facet, state.facets[facet.id])) return false;
    }
    for (const range of config.ranges ?? []) {
      if (!matchesRange(item, range, state.ranges[range.id])) return false;
    }
    return true;
  });
}

/** Opções de um filtro: as declaradas, ou as que existem nos itens (ordem alfabética, sem repetir). */
export function resolveFacetOptions<T>(facet: FacetDef<T>, items: readonly T[]): FacetOption[] {
  if (typeof facet.options === "function") return facet.options(items);
  if (facet.options) return [...facet.options];
  const seen = new Set<string>();
  let hasEmpty = false;
  for (const item of items) {
    const raw = facet.getValue(item);
    const value = raw === null || raw === undefined ? FACET_EMPTY_KEY : String(raw).trim();
    if (value === FACET_EMPTY_KEY) hasEmpty = true;
    else seen.add(value);
  }
  const options = [...seen]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }))
    .map((value) => ({ value, label: value }));
  if (hasEmpty && facet.emptyLabel) options.push({ value: FACET_EMPTY_KEY, label: facet.emptyLabel });
  return options;
}
