import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── SidebarFooter ────────────────────────────────────────────────────────────
// Footer: usuário + logout
function SidebarFooter({
  collapsed,
  userName,
  isLoggingOut,
  onLogout,
}: {
  collapsed: boolean;
  userName: string;
  isLoggingOut: boolean;
  onLogout: () => void;
}) {
  return (
    <div
      className={cn(
        "shrink-0 border-t border-slate-200/80 dark:border-sidebar-border/20",
        collapsed ? "px-2 py-2.5" : "px-2.5 py-2.5"
      )}
    >
      <div
        className={cn(
          "mb-2.5 rounded-xl border border-slate-200/80 bg-white/80 p-2.5 dark:border-white/8 dark:bg-white/[0.03]",
          collapsed && "hidden"
        )}
      >
        {!collapsed && (
          <div>
            <p className="text-[13px] font-semibold text-foreground">{userName}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Workspace principal</p>
          </div>
        )}
      </div>

      <button
        onClick={onLogout}
        disabled={isLoggingOut}
        className={cn(
          "flex w-full border border-slate-200/80 bg-white/80 text-sm font-medium text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/72 dark:hover:bg-white/[0.06] dark:hover:text-white",
          collapsed
            ? "h-9 items-center justify-center rounded-xl px-0"
            : "items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-[13px]"
        )}
      >
        <LogOut className="h-4 w-4 shrink-0" />
        {!collapsed && <span>{isLoggingOut ? "Saindo..." : "Sair"}</span>}
      </button>
    </div>
  );
}

export { SidebarFooter };
