import { cn } from "@/lib/utils";
import type { ColorPreset } from "@/lib/appSidebar/constants";

// ─── SidebarHeader ────────────────────────────────────────────────────────────
// Logo / título — clique abre o customizador de marca.
function SidebarHeader({
  collapsed,
  logo,
  title,
  selectedPreset,
  onOpenCustomizer,
}: {
  collapsed: boolean;
  logo: string | null;
  title: string | null;
  selectedPreset: ColorPreset;
  onOpenCustomizer: () => void;
}) {
  return (
    <div
      onClick={onOpenCustomizer}
      className={cn(
        "relative shrink-0 border-b border-slate-200/80 dark:border-white/10 cursor-pointer transition-all hover:bg-slate-100/50 dark:hover:bg-white/[0.03] group/brand",
        collapsed ? "px-3 py-3.5" : "px-3.5 py-4"
      )}
      title="Clique para personalizar a marca do sistema"
    >
      <div className="absolute -left-10 -top-10 h-32 w-32 rounded-full bg-fuchsia-500/10 blur-3xl dark:bg-fuchsia-500/16" />
      <div className={cn("relative flex items-center", collapsed ? "justify-center" : "gap-3")}>
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white/90 shadow-[0_8px_20px_var(--primary-shadow)] dark:border-white/10 dark:bg-white/5",
            !logo && "bg-gradient-to-br"
          )}
          style={!logo ? { backgroundImage: `linear-gradient(135deg, ${selectedPreset.from}, ${selectedPreset.to})` } : undefined}
        >
          {logo ? (
            <img src={logo} alt="Logo" className="h-full w-full rounded-xl object-cover" />
          ) : (
            <span className="text-base font-black text-white">
              {(title || "Vexo OS")[0]?.toUpperCase()}
            </span>
          )}
        </div>
        {!collapsed && (
          <div className="overflow-hidden flex-1">
            <p className="text-[17px] font-extrabold tracking-tight text-foreground truncate group-hover/brand:text-cyan-500 transition-colors">
              {title || "Vexo OS"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export { SidebarHeader };
