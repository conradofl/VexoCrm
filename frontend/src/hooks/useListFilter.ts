import { useCallback, useMemo, useState } from "react";
import {
  EMPTY_FILTER_STATE,
  filterList,
  hasActiveFilter,
  resolveFacetOptions,
  type DateRange,
  type FacetOption,
  type ListFilterConfig,
  type ListFilterState,
} from "@/lib/listFilter";

export interface ListFilterFacetView {
  id: string;
  label: string;
  options: FacetOption[];
  selected: string[];
}

export interface ListFilterRangeView {
  id: string;
  label: string;
  value: DateRange;
}

export interface ListFilterControls {
  search: string;
  setSearch: (value: string) => void;
  facets: ListFilterFacetView[];
  toggleFacetValue: (facetId: string, value: string) => void;
  ranges: ListFilterRangeView[];
  setRange: (rangeId: string, value: DateRange) => void;
  /** Há busca, seleção ou período ativos? Só então o contador e o "limpar" aparecem. */
  isFiltered: boolean;
  shown: number;
  total: number;
  clear: () => void;
}

/**
 * Estado + resultado do filtro de uma lista. Tudo em memória: nada vai ao servidor e nada é lembrado
 * entre visitas (busca é momentânea). `config` deve ser estável (declarado fora do componente).
 */
export function useListFilter<T>(items: readonly T[], config: ListFilterConfig<T>) {
  const [state, setState] = useState<ListFilterState>(EMPTY_FILTER_STATE);

  const filtered = useMemo(() => filterList(items, state, config), [items, state, config]);

  const setSearch = useCallback((search: string) => setState((s) => ({ ...s, search })), []);

  const toggleFacetValue = useCallback((facetId: string, value: string) => {
    setState((s) => {
      const current = s.facets[facetId] ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...s, facets: { ...s.facets, [facetId]: next } };
    });
  }, []);

  const setRange = useCallback((rangeId: string, value: DateRange) => {
    setState((s) => ({ ...s, ranges: { ...s.ranges, [rangeId]: value } }));
  }, []);

  const clear = useCallback(() => setState(EMPTY_FILTER_STATE), []);

  const facets = useMemo<ListFilterFacetView[]>(
    () =>
      (config.facets ?? []).map((f) => ({
        id: f.id,
        label: f.label,
        options: resolveFacetOptions(f, items),
        selected: state.facets[f.id] ?? [],
      })),
    [config, items, state.facets]
  );

  const ranges = useMemo<ListFilterRangeView[]>(
    () =>
      (config.ranges ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        value: state.ranges[r.id] ?? { from: "", to: "" },
      })),
    [config, state.ranges]
  );

  const controls: ListFilterControls = {
    search: state.search,
    setSearch,
    facets,
    toggleFacetValue,
    ranges,
    setRange,
    isFiltered: hasActiveFilter(state),
    shown: filtered.length,
    total: items.length,
    clear,
  };

  return { filtered, controls };
}
