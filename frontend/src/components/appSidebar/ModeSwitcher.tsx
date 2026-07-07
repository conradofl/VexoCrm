import { cn } from "@/lib/utils";
import { type Modo, MODULOS } from "@/lib/appSidebar/constants";

// ─── ModeSwitcher ─────────────────────────────────────────────────────────────
// Alternador visual Vendas | Disparos.
// Não implementa trava de permissão (Passo 2).
function ModeSwitcher({
  modo,
  onModoChange,
  collapsed,
  vendasAllowed,
  disparosAllowed,
}: {
  modo: Modo;
  onModoChange: (m: Modo) => void;
  collapsed: boolean;
  vendasAllowed: boolean;
  disparosAllowed: boolean;
}) {
  if (!vendasAllowed && !disparosAllowed) return null;
  if (vendasAllowed !== disparosAllowed) return null;

  if (collapsed) {
    // Collapsed: duas barras coloridas empilhadas como indicador de modo
    return (
      <div className="mb-3 flex flex-col items-center gap-1.5">
        {(["vendas", "disparos"] as Modo[]).map((m) => {
          const isAllowed = m === "vendas" ? vendasAllowed : disparosAllowed;
          if (!isAllowed) return null;
          return (
            <button
              key={m}
              onClick={() => onModoChange(m)}
              title={MODULOS[m].labelLongo}
              className={cn(
                "h-1.5 w-8 rounded-full transition-all duration-150",
                modo === m ? "opacity-100" : "opacity-20 hover:opacity-50"
              )}
              style={{ backgroundColor: MODULOS[m].cor }}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-slate-200/80 bg-slate-100/60 p-1 dark:border-white/8 dark:bg-white/[0.04]">
      {(["vendas", "disparos"] as Modo[]).map((m) => {
        const isAllowed = m === "vendas" ? vendasAllowed : disparosAllowed;
        if (!isAllowed) return null;
        return (
          <button
            key={m}
            onClick={() => onModoChange(m)}
            title={MODULOS[m].labelLongo}
            className={cn(
              "rounded-lg px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.10em] transition-all duration-150",
              modo === m
                ? "text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700 dark:text-white/40 dark:hover:text-white/70"
            )}
            style={modo === m ? { backgroundColor: MODULOS[m].cor } : {}}
          >
            {MODULOS[m].labelCurto}
          </button>
        );
      })}
    </div>
  );
}

export { ModeSwitcher };
