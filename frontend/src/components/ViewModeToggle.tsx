import { useState } from "react";
import { LayoutGrid, List as ListIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIST_UNAVAILABLE_REASON } from "@/lib/viewMode";
import type { ViewModeControls } from "@/hooks/useViewMode";

interface ViewModeToggleProps {
  view: ViewModeControls;
  className?: string;
}

/**
 * Alternador cartão/lista das abas de registros — o MESMO para as cinco. Dois ícones, e diz qual está ativo.
 * Em tela estreita a lista não existe: o botão de lista fica desabilitado (aria-disabled, para ainda poder ser
 * tocado) e, ao tocar, mostra a razão.
 */
export function ViewModeToggle({ view, className }: ViewModeToggleProps) {
  const [showReason, setShowReason] = useState(false);
  const { mode, narrow, setPreference } = view;
  const activeLabel = mode === "list" ? "lista" : "cartões";

  const base = "px-2.5 py-2 transition-colors";
  const on = "bg-purple-650 text-white";
  const off = "text-slate-600 dark:text-slate-300";

  return (
    <div className={cn("relative shrink-0", className)} data-testid="view-mode-toggle" data-mode={mode}>
      <div
        role="group"
        aria-label={`Modo de exibição: ${activeLabel}`}
        className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden"
      >
        <button
          type="button"
          aria-label="Ver em cartões"
          aria-pressed={mode === "card"}
          title={mode === "card" ? "Cartões (ativo)" : "Ver em cartões"}
          onClick={() => {
            setShowReason(false);
            setPreference("card");
          }}
          className={cn(base, mode === "card" ? on : off)}
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Ver em lista"
          aria-pressed={mode === "list"}
          aria-disabled={narrow}
          title={narrow ? LIST_UNAVAILABLE_REASON : mode === "list" ? "Lista (ativo)" : "Ver em lista"}
          onClick={() => {
            if (narrow) {
              setShowReason((v) => !v);
              return;
            }
            setPreference("list");
          }}
          className={cn(base, mode === "list" ? on : off, narrow && "opacity-40 cursor-not-allowed")}
        >
          <ListIcon className="h-4 w-4" />
        </button>
      </div>
      {narrow && showReason && (
        <p
          role="status"
          data-testid="view-mode-reason"
          className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border bg-popover p-2 text-[11px] text-popover-foreground shadow-md"
        >
          {LIST_UNAVAILABLE_REASON}
        </p>
      )}
    </div>
  );
}
