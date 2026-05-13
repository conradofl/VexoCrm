import type { ComponentType } from "react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Building2,
  LayoutDashboard,
  Users,
  Bot,
  LineChart,
  LogOut,
  Briefcase,
  ShieldCheck,
  PanelLeftClose,
  PanelLeft,
  FileSpreadsheet,
  MessageCircle,
  KanbanSquare,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { type InternalPage } from "@/lib/access";

const navItems = [
  { title: "Dashboard", url: "/crm/dashboard", icon: LayoutDashboard, page: "dashboard" as const },
  { title: "Leads", url: "/crm/leads", icon: Users, badge: "CRM", page: "leads" as const },
  { title: "Campanhas", url: "/crm/planilhas", icon: FileSpreadsheet, page: "planilhas" as const },
  { title: "Inteligencia Comercial", url: "/crm/inteligencia-comercial", icon: LineChart, page: "dashboard" as const },
  { title: "WhatsApp", url: "/crm/whatsapp", icon: MessageCircle, page: "whatsapp" as const },
  { title: "Agente", url: "/crm/agente", icon: Bot, page: "agente" as const },
  { title: "Chatbot Kanban", url: "/crm/chatbot", icon: KanbanSquare, page: "agente" as const },
  { title: "Chatbot Config", url: "/crm/chatbot-config", icon: Bot, page: "empresas" as const },
  { title: "Chatbot Docs", url: "/crm/chatbot-docs", icon: BookOpen, page: "agente" as const },
  { title: "Empresas", url: "/crm/empresas", icon: Building2, page: "empresas" as const },
  { title: "Usuarios", url: "/crm/usuarios", icon: ShieldCheck, page: "usuarios" as const },
] satisfies Array<{
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  badge?: string;
  page: InternalPage;
}>;

const adminNavItems = [
  { title: "Vendas Vexo", url: "/crm/vexo-sales", icon: Briefcase },
] satisfies Array<{
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
}>;

export function AppSidebar() {
  const { logout, canAccessInternalPage, isAdminUser, user, accessProfile } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const visibleNavItems = navItems.filter((item) => canAccessInternalPage(item.page));
  const canSeeAgentNotifications = canAccessInternalPage("agente");
  const userEmail = user?.email || accessProfile?.email || "";
  const userLogin = userEmail.includes("@") ? userEmail.split("@")[0] : userEmail;
  const userName = user?.displayName?.trim() || userLogin || "Usuario";

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 flex-col overflow-hidden border-r border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,255,0.98),rgba(237,242,255,0.98))] text-slate-700 backdrop-blur-xl transition-all duration-200 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(8,10,34,0.98),rgba(5,6,24,0.98))] dark:text-slate-100",
        collapsed ? "w-[74px]" : "w-[204px]"
      )}
    >
      <div
        className={cn(
          "relative shrink-0 border-b border-slate-200/80 dark:border-white/10",
          collapsed ? "px-3 py-3.5" : "px-3.5 py-4"
        )}
      >
        <div className="absolute -left-10 -top-10 h-32 w-32 rounded-full bg-fuchsia-500/10 blur-3xl dark:bg-fuchsia-500/16" />
        <div className={cn("relative flex items-center", collapsed ? "justify-center" : "gap-3")}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white/90 shadow-[0_8px_20px_rgba(34,211,238,0.10)] dark:border-white/10 dark:bg-white/5 dark:shadow-[0_8px_20px_rgba(34,211,238,0.14)]">
            <span className="bg-[linear-gradient(135deg,#8b5cf6,#22d3ee)] bg-clip-text text-base font-black text-transparent">
              V
            </span>
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="text-[17px] font-extrabold tracking-tight text-foreground">Vexo CRM</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-slate-500 dark:text-white/45">
                Control hub
              </p>
            </div>
          )}
        </div>
      </div>

      <nav className={cn("flex-1 overflow-y-auto", collapsed ? "px-2 py-3.5" : "px-2 py-3.5")}>
        {!collapsed && (
          <p className="px-2.5 pb-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
            Principal
          </p>
        )}

        <div className="space-y-1">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.url}
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
                      isActive ? "text-cyan-600 dark:text-cyan-200" : "text-slate-500 group-hover:text-slate-900 dark:text-sidebar-foreground dark:group-hover:text-foreground"
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.title}</span>}
                  {!collapsed && item.badge && (
                    <span className="ml-auto rounded-full border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-700 dark:text-cyan-200">
                      {item.badge}
                    </span>
                  )}
                  {isActive && (
                    <span
                      className={cn(
                        "absolute bg-[linear-gradient(180deg,#8b5cf6,#22d3ee)] shadow-[0_0_16px_rgba(139,92,246,0.8)]",
                        collapsed
                          ? "left-1/2 top-auto h-1 w-6 -translate-x-1/2 rounded-full bottom-0.5"
                          : "left-0 top-2 h-[calc(100%-16px)] w-1 rounded-r-full"
                      )}
                    />
                  )}
                </>
              )}
            </NavLink>
          ))}
          {isAdminUser &&
            adminNavItems.map((item) => (
              <NavLink
                key={item.url}
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
                        isActive ? "text-cyan-600 dark:text-cyan-200" : "text-slate-500 group-hover:text-slate-900 dark:text-sidebar-foreground dark:group-hover:text-foreground"
                      )}
                    />
                    {!collapsed && <span className="truncate">{item.title}</span>}
                    {!collapsed && (
                      <span className="ml-auto rounded-full border border-violet-400/20 bg-violet-400/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-violet-700 dark:text-violet-200">
                        Admin
                      </span>
                    )}
                    {isActive && (
                      <span
                        className={cn(
                          "absolute bg-[linear-gradient(180deg,#8b5cf6,#22d3ee)] shadow-[0_0_16px_rgba(139,92,246,0.8)]",
                          collapsed
                            ? "left-1/2 top-auto h-1 w-6 -translate-x-1/2 rounded-full bottom-0.5"
                            : "left-0 top-2 h-[calc(100%-16px)] w-1 rounded-r-full"
                        )}
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
        </div>

        {!collapsed && (
          <p className="px-2.5 pb-2.5 pt-5 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
            Sistema
          </p>
        )}

        <div className="space-y-1">
          {canSeeAgentNotifications ? <NotificationBell collapsed={collapsed} /> : null}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "flex w-full text-sm font-medium text-slate-600 transition-all hover:bg-slate-100/80 hover:text-slate-900 dark:text-sidebar-foreground dark:hover:bg-white/[0.04] dark:hover:text-foreground",
              collapsed
                ? "h-9 items-center justify-center rounded-xl px-0"
                : "items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-[13px]"
            )}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {!collapsed && <span>Recolher</span>}
          </button>
        </div>
      </nav>

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
          onClick={handleLogout}
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
    </aside>
  );
}
