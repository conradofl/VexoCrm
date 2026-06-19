import type { ComponentType } from "react";
import { useState, useEffect } from "react";
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
  Upload,
  X,
  MessageCircle,
  KanbanSquare,
  BookOpen,
  ListChecks,
  Settings2,
  BarChart3,
  Megaphone,
  Landmark,
  ChevronDown,
  Sparkles,
  UserPlus,
  Wifi,
  Send,
  Flame,
  BarChart2,
  Database,
} from "lucide-react";
import { useFollowupSuggestionCount } from "@/hooks/useFollowupSuggestions";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { type InternalPage, isPathAllowedForClient } from "@/lib/access";

// ═══════════════════════════════════════════════════════════════════════════════
// ESTRUTURA GRANULAR DE MÓDULOS — Máquina de Vendas vs Máquina de Disparos
//
// Cada ferramenta tem `key` própria para filtro de permissão por pacote.
// PASSO 2 (futuro): substituir o filter abaixo por:
//   ferramentas.filter(f => canAccessInternalPage(f.page) && clienteTemAcesso(f.key))
//
// Para adicionar uma ferramenta: inclua o objeto aqui e o InternalPage em access.ts.
// ═══════════════════════════════════════════════════════════════════════════════

type Modo = "vendas" | "disparos";

type Ferramenta = {
  key: string;          // identificador único — usado no Passo 2 para filtro de pacote
  label: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  badge?: string;
  page: InternalPage;   // controla visibilidade via canAccessInternalPage
};

type Modulo = {
  labelCurto: string;   // exibido no pill do switcher
  labelLongo: string;   // exibido em tooltip/collapsed
  cor: string;          // cor de identidade hex
  ferramentas: Ferramenta[];
};

const MODULOS: Record<Modo, Modulo> = {
  vendas: {
    labelCurto: "Vendas",
    labelLongo: "Máquina de Vendas",
    cor: "#6366F1", // Electric Indigo — token oficial (tailwind.config.ts:21, index.css:63)
    ferramentas: [
      // PASSO 2: filtrar esta lista por clienteTemAcesso(f.key) antes de renderizar
      { key: "dashboard",      label: "Dashboard",          url: "/crm/dashboard",              icon: LayoutDashboard, page: "dashboard" },
      { key: "leads",          label: "Leads",              url: "/crm/leads",                  icon: Users,           page: "leads",               badge: "CRM" },
      { key: "conversas",      label: "Conversas",          url: "/crm/whatsapp",               icon: MessageCircle,   page: "whatsapp" },
      { key: "inteligencia",   label: "Int. Comercial",     url: "/crm/inteligencia-comercial", icon: LineChart,       page: "inteligencia-comercial" },
      { key: "chatbot-kanban", label: "Chatbot Kanban",     url: "/crm/chatbot",                icon: KanbanSquare,    page: "chatbot-kanban" },
      { key: "chatbot",        label: "Chatbot",            url: "/crm/chatbot-settings",       icon: Settings2,       page: "chatbot-config" },
      { key: "followup",       label: "Follow-up",          url: "/crm/followup",               icon: ListChecks,      page: "fila-de-followup" },
    ],
  },
  disparos: {
    labelCurto: "Disparos",
    labelLongo: "Máquina de Disparos",
    cor: "#ff7a1a", // Laranja marca — demo-liv-pub.html (--accent, botão primário + logo)
    ferramentas: [
      { key: "conexoes",    label: "Chips WhatsApp", url: "/crm/conexoes",    icon: Wifi,            page: "conexoes" },
      { key: "campanhas",   label: "Envios por Planilha", url: "/crm/planilhas",   icon: FileSpreadsheet, page: "planilhas" },
      { key: "aquecimento", label: "Aquecimento", url: "/crm/aquecimento", icon: Flame,           page: "aquecimento" },
      { key: "relatorios",  label: "Relatórios",  url: "/crm/relatorios",  icon: BarChart2,       page: "relatorios" },
    ],
  },
} satisfies Record<Modo, Modulo>;

// Sistema: FIXO, fora dos modos, não é módulo vendável.
// Visível para quem tiver canAccessInternalPage para a page correspondente.
const SISTEMA_ITEMS = [
  { key: "apresentacao", label: "Demonstração Vexo", url: "/crm/apresentacao", icon: Sparkles,    page: "onboarding-wizard" as InternalPage },
  { key: "onboarding",   label: "Treinamento Vexo",   url: "/crm/onboarding",   icon: ListChecks,  page: "onboarding-wizard" as InternalPage },
  { key: "chatbot-docs", label: "Chatbot Docs",     url: "/crm/chatbot-docs", icon: BookOpen,    page: "chatbot-docs" as InternalPage },
  { key: "empresas",     label: "Empresas",         url: "/crm/empresas",     icon: Building2,   page: "empresas" as InternalPage },
  { key: "usuarios",     label: "Usuários",         url: "/crm/usuarios",     icon: ShieldCheck, page: "usuarios" as InternalPage },
];

// Configuração + admin tools — FIXO, somente para isAdminUser.
const ADMIN_ITEMS = [
  { key: "evolution-admin", label: "Evolution Admin",  url: "/crm/evolution-admin", icon: Database },
];

// ─── NavItem ──────────────────────────────────────────────────────────────────
function NavItem({
  item,
  collapsed,
}: {
  item: { label: string; url: string; icon: ComponentType<{ className?: string }>; badge?: string };
  collapsed: boolean;
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
          {!collapsed && item.badge && (
            <span className="ml-auto rounded-full border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-700 dark:text-cyan-200">
              {item.badge}
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

const COLOR_PRESETS = {
  default: { label: "Padrão", from: "#8b5cf6", to: "#22d3ee", shadow: "rgba(139,92,246,0.3)" },
  emerald: { label: "Esmeralda", from: "#059669", to: "#10b981", shadow: "rgba(5,150,105,0.3)" },
  rose: { label: "Rose", from: "#e11d48", to: "#f43f5e", shadow: "rgba(225,29,72,0.3)" },
  amber: { label: "Âmbar", from: "#d97706", to: "#f59e0b", shadow: "rgba(217,119,6,0.3)" },
  indigo: { label: "Indigo", from: "#4f46e5", to: "#6366f1", shadow: "rgba(79,70,229,0.3)" },
};

// ─── AppSidebar ───────────────────────────────────────────────────────────────
export function AppSidebar() {
  const { logout, canAccessInternalPage, isAdminUser, user, accessProfile } = useAuth();
  const crmClient = useOptionalCrmClient();
  const selectedClientId = crmClient?.selectedClientId || "global";

  const [collapsed, setCollapsed] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isCustomizerOpen, setIsCustomizerOpen] = useState(false);

  const [logo, setLogo] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const loadBrand = () => {
      const savedLogo = localStorage.getItem(`vexocrm_logo_${selectedClientId}`);
      const savedTitle = localStorage.getItem(`vexocrm_title_${selectedClientId}`);
      const savedColor = localStorage.getItem(`vexocrm_color_${selectedClientId}`);
      setLogo(savedLogo);
      setTitle(savedTitle);
      setColor(savedColor);
    };
    loadBrand();
    window.addEventListener("vexo-brand-change", loadBrand);
    return () => {
      window.removeEventListener("vexo-brand-change", loadBrand);
    };
  }, [selectedClientId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => setIsCustomizerOpen(true);
    window.addEventListener("vexo-open-brand-customizer", onOpen);
    return () => {
      window.removeEventListener("vexo-open-brand-customizer", onOpen);
    };
  }, []);

  // Modo ativo: "vendas" por padrão, reseta para "vendas" ao recarregar a página.
  const [modo, setModo] = useState<Modo>("vendas");

  const { data: suggestionCount = 0 } = useFollowupSuggestionCount();

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

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      localStorage.setItem(`vexocrm_logo_${selectedClientId}`, base64);
      setLogo(base64);
      window.dispatchEvent(new Event("vexo-brand-change"));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveBrand = (newTitle: string, newColor: string) => {
    localStorage.setItem(`vexocrm_title_${selectedClientId}`, newTitle);
    localStorage.setItem(`vexocrm_color_${selectedClientId}`, newColor);
    setTitle(newTitle);
    setColor(newColor);
    window.dispatchEvent(new Event("vexo-brand-change"));
    setIsCustomizerOpen(false);
  };

  const handleResetBrand = () => {
    localStorage.removeItem(`vexocrm_logo_${selectedClientId}`);
    localStorage.removeItem(`vexocrm_title_${selectedClientId}`);
    localStorage.removeItem(`vexocrm_color_${selectedClientId}`);
    setLogo(null);
    setTitle(null);
    setColor(null);
    window.dispatchEvent(new Event("vexo-brand-change"));
    setIsCustomizerOpen(false);
  };

  const allowedTabs = crmClient?.selectedClient?.n8n_settings?.allowed_tabs;

  const isModoAllowed = (m: Modo) => {
    const tools = MODULOS[m].ferramentas;
    return tools.some(
      (f) => canAccessInternalPage(f.page) && isPathAllowedForClient(f.url, allowedTabs)
    );
  };

  const vendasAllowed = isModoAllowed("vendas");
  const disparosAllowed = isModoAllowed("disparos");

  useEffect(() => {
    if (!vendasAllowed && disparosAllowed && modo === "vendas") {
      setModo("disparos");
    } else if (vendasAllowed && !disparosAllowed && modo === "disparos") {
      setModo("vendas");
    }
  }, [vendasAllowed, disparosAllowed, modo]);

  const ferramentasVisiveis = MODULOS[modo].ferramentas
    .map((f) => {
      if (f.key === "followup" && suggestionCount > 0) {
        return { ...f, badge: suggestionCount.toString() };
      }
      return f;
    })
    .filter((f) => canAccessInternalPage(f.page) && isPathAllowedForClient(f.url, allowedTabs));

  const visibleSistema = SISTEMA_ITEMS.filter(
    (f) => canAccessInternalPage(f.page) && isPathAllowedForClient(f.url, allowedTabs)
  );

  const selectedPreset = COLOR_PRESETS[(color as keyof typeof COLOR_PRESETS) || "default"] || COLOR_PRESETS.default;

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 flex-col overflow-hidden border-r border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,255,0.98),rgba(237,242,255,0.98))] text-slate-700 backdrop-blur-xl transition-all duration-200 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(8,10,34,0.98),rgba(5,6,24,0.98))] dark:text-slate-100",
        collapsed ? "w-[74px]" : "w-[204px]"
      )}
      style={{
        "--primary-from": selectedPreset.from,
        "--primary-to": selectedPreset.to,
        "--primary-shadow": selectedPreset.shadow,
      } as React.CSSProperties}
    >
      {/* Logo / título */}
      <div
        onClick={() => setIsCustomizerOpen(true)}
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

      <nav className="flex-1 overflow-y-auto px-2 py-3.5">
        {/* ── Alternador de modo: Vendas | Disparos ───────────────────── */}
        <ModeSwitcher
          modo={modo}
          onModoChange={setModo}
          collapsed={collapsed}
          vendasAllowed={vendasAllowed}
          disparosAllowed={disparosAllowed}
        />

        <div className="space-y-1">
          {/* Ferramentas do modo ativo */}
          {ferramentasVisiveis.map((ferramenta) => (
            <NavItem key={ferramenta.key} item={ferramenta} collapsed={collapsed} />
          ))}


        </div>

        {/* ── Sistema — FIXO, fora dos modos ─────────────────────────── */}
        {visibleSistema.length > 0 && (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Sistema
              </p>
            )}
            <div className="space-y-1">
              {visibleSistema.map((item) => (
                <NavItem key={item.key} item={item} collapsed={collapsed} />
              ))}
            </div>
          </>
        )}

        {/* ── Configuração — admin only, FIXO ────────────────────────── */}
        {isAdminUser && (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Configuração
              </p>
            )}
            <div className="space-y-1">
              {ADMIN_ITEMS.map((item, i) => (
                <AdminNavLink
                  key={item.key}
                  item={item}
                  collapsed={collapsed}
                  showAdminBadge={i === 0} // badge "Admin" só no primeiro item
                />
              ))}
            </div>
          </>
        )}

        {/* ── Recolher sidebar ────────────────────────────────────────── */}
        <div className="mt-3 space-y-1">
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

      {/* Footer: usuário + logout */}
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

      {isCustomizerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900/95 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-3">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-500" />
                Personalizar Marca
              </h3>
              <button
                type="button"
                onClick={() => setIsCustomizerOpen(false)}
                className="rounded-full p-1 text-muted-foreground hover:bg-slate-100 dark:hover:bg-white/5 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 py-2">
              {/* Logo Upload */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Logo da Empresa</label>
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5",
                      !logo && "bg-gradient-to-br"
                    )}
                    style={!logo ? { backgroundImage: `linear-gradient(135deg, ${selectedPreset.from}, ${selectedPreset.to})` } : undefined}
                  >
                    {logo ? (
                      <img src={logo} alt="Preview" className="h-full w-full rounded-xl object-cover" />
                    ) : (
                      <span className="text-lg font-black text-white">
                        {(title || "Vexo OS")[0]?.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-grow">
                    <input
                      type="file"
                      id="brand-logo-file"
                      accept="image/png, image/jpeg"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                    <label
                      htmlFor="brand-logo-file"
                      className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      Fazer Upload
                    </label>
                    <p className="mt-1 text-[10px] text-muted-foreground">PNG ou JPEG até 1MB</p>
                  </div>
                </div>
              </div>

              {/* Workspace Title */}
              <div className="space-y-1.5">
                <label htmlFor="brand-title-input" className="text-xs font-semibold text-slate-500 dark:text-slate-400">Nome do Workspace</label>
                <input
                  type="text"
                  id="brand-title-input"
                  placeholder="Vexo OS"
                  defaultValue={title || "Vexo OS"}
                  className="w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-foreground outline-none focus:border-cyan-500 dark:border-white/10 dark:bg-white/5"
                />
              </div>

              {/* Accent Color Presets */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Cor Temática Principal</label>
                <div className="flex gap-2">
                  {Object.entries(COLOR_PRESETS).map(([key, preset]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setColor(key)}
                      className={cn(
                        "h-7 w-7 rounded-full border-2 transition-all hover:scale-105",
                        (color || "default") === key ? "border-slate-800 dark:border-white" : "border-transparent"
                      )}
                      style={{ backgroundImage: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}
                      title={preset.label}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-end border-t border-slate-100 dark:border-white/5 pt-3">
              <button
                type="button"
                onClick={handleResetBrand}
                className="rounded-xl px-3 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                Restaurar Padrão
              </button>
              <button
                type="button"
                onClick={() => {
                  const input = document.getElementById("brand-title-input") as HTMLInputElement;
                  handleSaveBrand(input.value || "Vexo OS", color || "default");
                }}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-white/90"
              >
                Salvar Marca
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
