import { useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChangePasswordDialog } from "@/components/auth/ChangePasswordDialog";

// ─── SidebarFooter ────────────────────────────────────────────────────────────
// Footer: usuário + ações de conta (trocar senha, sair)
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
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

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

      <div className="flex flex-col gap-1.5">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setIsChangePasswordOpen(true)}
                aria-label="Trocar senha"
                className="flex h-9 w-full items-center justify-center rounded-xl border border-slate-200/80 bg-white/80 text-sm font-medium text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/72 dark:hover:bg-white/[0.06] dark:hover:text-white"
              >
                <KeyRound className="h-4 w-4 shrink-0" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Trocar senha</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={() => setIsChangePasswordOpen(true)}
            aria-label="Trocar senha"
            className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-2 text-[13px] font-medium text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/72 dark:hover:bg-white/[0.06] dark:hover:text-white"
          >
            <KeyRound className="h-4 w-4 shrink-0" />
            <span>Trocar senha</span>
          </button>
        )}

        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onLogout}
                disabled={isLoggingOut}
                aria-label={isLoggingOut ? "Saindo..." : "Sair"}
                className="flex h-9 w-full items-center justify-center rounded-xl border border-slate-200/80 bg-white/80 text-sm font-medium text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/72 dark:hover:bg-white/[0.06] dark:hover:text-white"
              >
                <LogOut className="h-4 w-4 shrink-0" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sair</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={onLogout}
            disabled={isLoggingOut}
            aria-label={isLoggingOut ? "Saindo..." : "Sair"}
            className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-2 text-[13px] font-medium text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/72 dark:hover:bg-white/[0.06] dark:hover:text-white"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>{isLoggingOut ? "Saindo..." : "Sair"}</span>
          </button>
        )}
      </div>

      <ChangePasswordDialog
        open={isChangePasswordOpen}
        onOpenChange={setIsChangePasswordOpen}
      />
    </div>
  );
}

export { SidebarFooter };
