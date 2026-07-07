import { useState, useEffect } from "react";
import { PanelLeftClose, PanelLeft, BarChart3, Megaphone, Landmark, ChevronDown, UserPlus, Send, Database } from "lucide-react";
import { useFollowupSuggestionCount } from "@/hooks/useFollowupSuggestions";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { isPathAllowedForClient } from "@/lib/access";
import { type Modo, MODULOS, CONFIG_ITEMS, AJUDA_ITEMS, GERACAO_DIGITAL_ITEMS, COLOR_PRESETS } from "@/lib/appSidebar/constants";
import { NavItem } from "@/components/appSidebar/NavItem";
import { AdminNavLink } from "@/components/appSidebar/AdminNavLink";
import { ModeSwitcher } from "@/components/appSidebar/ModeSwitcher";
import { SidebarHeader } from "@/components/appSidebar/SidebarHeader";
import { SidebarFooter } from "@/components/appSidebar/SidebarFooter";
import { BrandCustomizer } from "@/components/appSidebar/BrandCustomizer";

// Configuração + admin tools — FIXO, somente para isAdminUser.
const ADMIN_ITEMS = [{ key: "evolution-admin", label: "Evolution Admin",  url: "/crm/evolution-admin", icon: Database }];

export function AppSidebar() {
  const { logout, canAccessInternalPage, isAdminUser, user, accessProfile, isInternalUser } = useAuth();
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
      (f) => canAccessInternalPage(f.page) && (isInternalUser || isPathAllowedForClient(f.url, allowedTabs))
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
    .filter((f) => canAccessInternalPage(f.page) && (isInternalUser || isPathAllowedForClient(f.url, allowedTabs)));

  const visibleConfig = CONFIG_ITEMS.filter(
    (f) => canAccessInternalPage(f.page) && (isInternalUser || isPathAllowedForClient(f.url, allowedTabs))
  );

  const visibleAjuda = AJUDA_ITEMS.filter(
    (f) => canAccessInternalPage(f.page) && (isInternalUser || isPathAllowedForClient(f.url, allowedTabs))
  );

  const visibleGeracaoDigital = GERACAO_DIGITAL_ITEMS.filter(
    (f) => canAccessInternalPage(f.page) && (isInternalUser || isPathAllowedForClient(f.url, allowedTabs))
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
      <SidebarHeader
        collapsed={collapsed}
        logo={logo}
        title={title}
        selectedPreset={selectedPreset}
        onOpenCustomizer={() => setIsCustomizerOpen(true)}
      />

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

        {/* ── Configuração — FIXO, fora dos modos ─────────────────────────── */}
        {visibleConfig.length > 0 && (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Configuração
              </p>
            )}
            <div className="space-y-1">
              {visibleConfig.map((item) => (
                <NavItem key={item.key} item={item} collapsed={collapsed} />
              ))}
            </div>
          </>
        )}

        {/* ── Ajuda & Educação — FIXO ─────────────────────────── */}
        {visibleAjuda.length > 0 && (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Ajuda
              </p>
            )}
            <div className="space-y-1">
              {visibleAjuda.map((item) => (
                <NavItem key={item.key} item={item} collapsed={collapsed} />
              ))}
            </div>
          </>
        )}

        {/* ── Geração Digital — FIXO ─────────────────────────── */}
        {visibleGeracaoDigital.length > 0 && (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Geração Digital
              </p>
            )}
            <div className="space-y-1">
              {visibleGeracaoDigital.map((item) => (
                <NavItem key={item.key} item={item} collapsed={collapsed} />
              ))}
            </div>
          </>
        )}

        {/* ── Admin only, FIXO ────────────────────────── */}
        {isAdminUser && (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Administrador
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
      <SidebarFooter
        collapsed={collapsed}
        userName={userName}
        isLoggingOut={isLoggingOut}
        onLogout={handleLogout}
      />

      {isCustomizerOpen && (
        <BrandCustomizer
          logo={logo}
          title={title}
          color={color}
          selectedPreset={selectedPreset}
          onClose={() => setIsCustomizerOpen(false)}
          onColorSelect={setColor}
          onLogoUpload={handleLogoUpload}
          onSaveBrand={handleSaveBrand}
          onResetBrand={handleResetBrand}
        />
      )}
    </aside>
  );
}
