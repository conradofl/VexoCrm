import type { ComponentType } from "react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Bot,
  LogOut,
  Megaphone,
  ShieldCheck,
  PanelLeftClose,
  PanelLeft,
  FileSpreadsheet,
  MessageCircle,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { type InternalPage } from "@/lib/access";

const navItems = [
  { title: "Dashboard", url: "/crm/dashboard", icon: LayoutDashboard, page: "dashboard" as const },
  { title: "Leads", url: "/crm/leads", icon: Users, badge: "CRM", page: "leads" as const },
  { title: "Planilhas", url: "/crm/planilhas", icon: FileSpreadsheet, page: "planilhas" as const },
  { title: "WhatsApp", url: "/crm/whatsapp", icon: MessageCircle, page: "whatsapp" as const },
  { title: "Agente", url: "/crm/agente", icon: Bot, page: "agente" as const },
  { title: "Campanhas", url: "/crm/campanhas", icon: Megaphone, page: "campanhas" as const },
  { title: "Empresas", url: "/crm/empresas", icon: Building2, page: "empresas" as const },
  { title: "Usuarios", url: "/crm/usuarios", icon: ShieldCheck, page: "usuarios" as const },
] satisfies Array<{
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  badge?: string;
  page: InternalPage;
}>;

export function AppSidebar() {
  const { logout, canAccessInternalPage, user, accessProfile } = useAuth();
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
        "sticky top-0 flex h-screen flex-col overflow-hidden border-r border-white/[0.06] bg-[rgba(11,14,20,0.4)] backdrop-blur-xl transition-all duration-300",
        collapsed ? "w-[72px]" : "w-[220px]"
      )}
    >
      {/* Logo */}
      <div className="relative shrink-0 border-b border-white/[0.06] px-4 py-5">
        <div className="absolute -left-10 -top-10 h-28 w-28 rounded-full bg-electric-indigo/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-electric-indigo/20 bg-electric-indigo/15 font-mono text-sm font-bold text-white shadow-[0_0_20px_rgba(99,102,241,0.25)]">
            VX
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="text-lg font-bold tracking-tight text-[#F8FAFC]">
                Vexo<span className="text-electric-indigo">.</span>
              </p>
              <p className="inline-flex rounded-full border border-electric-indigo/20 bg-electric-indigo/10 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.24em] text-electric-indigo">
                CRM system
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {!collapsed && (
          <p className="px-3 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-[#E2E8F0]/50">
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
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-300",
                  isActive
                    ? "bg-electric-indigo/12 text-electric-indigo shadow-[inset_0_0_0_1px_rgba(99,102,241,0.18)]"
                    : "text-[#E2E8F0]/60 hover:bg-white/[0.04] hover:text-[#F8FAFC]"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors duration-300",
                      isActive ? "text-electric-indigo" : "text-[#E2E8F0]/50 group-hover:text-[#F8FAFC]"
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.title}</span>}
                  {!collapsed && item.badge && (
                    <span className="ml-auto rounded-sm border border-electric-indigo/20 bg-electric-indigo/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-electric-indigo">
                      {item.badge}
                    </span>
                  )}
                  {isActive && <span className="absolute right-0 top-1.5 h-[calc(100%-12px)] w-0.5 rounded-l bg-electric-indigo shadow-[0_0_12px_rgba(99,102,241,0.8)]" />}
                </>
              )}
            </NavLink>
          ))}
        </div>

        {!collapsed && (
          <p className="px-3 pb-2 pt-5 font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-[#E2E8F0]/50">
            Sistema
          </p>
        )}

        <div className="space-y-1">
          {canSeeAgentNotifications ? <NotificationBell collapsed={collapsed} /> : null}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[#E2E8F0]/60 transition-all duration-300 hover:bg-white/[0.04] hover:text-[#F8FAFC]"
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {!collapsed && <span>Recolher</span>}
          </button>
        </div>
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/[0.06] px-3 py-4">
        <div className={cn("mb-3 flex items-center gap-3", collapsed && "justify-center")}>
          <div className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[rgba(11,14,20,0.6)] text-sm font-bold text-[#F8FAFC]">
            VS
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-deep-navy bg-electric-indigo" />
          </div>
          {!collapsed && (
            <div>
              <p className="text-sm font-semibold text-[#F8FAFC]">{userName}</p>
            </div>
          )}
        </div>

        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="flex w-full items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-sm font-medium text-[#E2E8F0]/60 transition-all duration-300 hover:bg-white/[0.05] hover:text-[#F8FAFC] disabled:pointer-events-none disabled:opacity-60"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>{isLoggingOut ? "Saindo..." : "Sair"}</span>}
        </button>
      </div>
    </aside>
  );
}
