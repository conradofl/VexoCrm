import type { ComponentType } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

// ─── AdminNavLink ─────────────────────────────────────────────────────────────
// NavLink com badge "Admin" — reutilizado para itens de ADMIN_ITEMS.
function AdminNavLink({
  item,
  collapsed,
  showAdminBadge = false,
}: {
  item: { label: string; url: string; icon: ComponentType<{ className?: string }> };
  collapsed: boolean;
  showAdminBadge?: boolean;
}) {
  return (
    <NavLink
      to={item.url}
      className={({ isActive }) =>
        cn(
          "group relative flex font-medium transition-all",
          collapsed
            ? "h-9 items-center justify-center rounded-xl px-0"
            : "items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-[13px]",
          isActive
            ? "bg-[linear-gradient(90deg,rgba(99,102,241,0.18),rgba(59,130,246,0.10))] text-slate-900 shadow-[inset_0_0_0_1px_rgba(129,140,248,0.24),0_14px_28px_rgba(15,23,42,0.08)] dark:text-white dark:shadow-[inset_0_0_0_1px_rgba(129,140,248,0.34),0_16px_28px_rgba(15,23,42,0.26)]"
            : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-sidebar-foreground dark:hover:bg-white/[0.04] dark:hover:text-foreground"
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon
            className={cn(
              "h-4 w-4 shrink-0",
              isActive
                ? "text-cyan-600 dark:text-cyan-200"
                : "text-slate-500 group-hover:text-slate-900 dark:text-sidebar-foreground dark:group-hover:text-foreground"
            )}
          />
          {!collapsed && <span className="truncate">{item.label}</span>}
          {!collapsed && showAdminBadge && (
            <span className="ml-auto rounded-full border border-violet-400/20 bg-violet-400/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-violet-700 dark:text-violet-200">
              Admin
            </span>
          )}
          {isActive && (
            <span
              className={cn(
                "absolute shadow-[0_0_16px_var(--primary-shadow)]",
                collapsed
                  ? "left-1/2 top-auto h-1 w-6 -translate-x-1/2 rounded-full bottom-0.5"
                  : "left-0 top-2 h-[calc(100%-16px)] w-1 rounded-r-full"
              )}
              style={{ background: `linear-gradient(180deg, var(--primary-from, #8b5cf6), var(--primary-to, #22d3ee))` }}
            />
          )}
        </>
      )}
    </NavLink>
  );
}

export { AdminNavLink };
