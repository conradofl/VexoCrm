import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ListFilterControls } from "@/hooks/useListFilter";

interface ListFilterBarProps {
  controls: ListFilterControls;
  searchPlaceholder: string;
  /** Aviso mostrado enquanto há filtro (ex.: "o filtro vale só para esta página"). */
  note?: string | null;
  testId?: string;
  className?: string;
}

/**
 * Barra de busca e filtros das listas (Campanhas, Fila de Envios, Planilhas Salvas). Filtra enquanto
 * digita, sem botão. O contador e o "Limpar filtros" só aparecem quando há algo filtrado.
 */
export function ListFilterBar({ controls, searchPlaceholder, note, testId = "list-filter", className }: ListFilterBarProps) {
  const { search, setSearch, facets, toggleFacetValue, ranges, setRange, isFiltered, shown, total, clear } = controls;

  return (
    <div data-testid={testId} className={cn("space-y-2.5", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {(facets.some((f) => f.options.length > 0) || ranges.length > 0) && (
        <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
          {facets.map(
            (facet) =>
              facet.options.length > 0 && (
                <div key={facet.id} role="group" aria-label={facet.label} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground">{facet.label}:</span>
                  {facet.options.map((option) => {
                    const on = facet.selected.includes(option.value);
                    return (
                      <button
                        key={option.value || "__vazio__"}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleFacetValue(facet.id, option.value)}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                          on
                            ? "border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                            : "border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              )
          )}

          {ranges.map((range) => (
            <div key={range.id} role="group" aria-label={range.label} className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-semibold text-muted-foreground">{range.label}:</span>
              <label className="flex items-center gap-1">
                de
                <input
                  type="date"
                  aria-label={`${range.label} — de`}
                  value={range.value.from}
                  max={range.value.to || undefined}
                  onChange={(e) => setRange(range.id, { ...range.value, from: e.target.value })}
                  className="h-7 rounded-lg border border-border bg-background px-1.5 text-[11px]"
                />
              </label>
              <label className="flex items-center gap-1">
                até
                <input
                  type="date"
                  aria-label={`${range.label} — até`}
                  value={range.value.to}
                  min={range.value.from || undefined}
                  onChange={(e) => setRange(range.id, { ...range.value, to: e.target.value })}
                  className="h-7 rounded-lg border border-border bg-background px-1.5 text-[11px]"
                />
              </label>
            </div>
          ))}
        </div>
      )}

      {isFiltered && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span data-testid={`${testId}-count`} role="status" className="font-medium text-foreground">
            Mostrando {shown} de {total}
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={clear}>
            <X className="h-3 w-3" />
            Limpar filtros
          </Button>
          {note && <span className="text-[11px] text-amber-700 dark:text-amber-400">{note}</span>}
        </div>
      )}
    </div>
  );
}
