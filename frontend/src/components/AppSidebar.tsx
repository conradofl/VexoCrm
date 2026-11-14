import { useState, useEffect } from "react";
import { PanelLeftClose, PanelLeft, Users } from "lucide-react";
import { useFollowupSuggestionCount } from "@/hooks/useFollowupSuggestions";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { isPathAllowedForClient, getInheritedPlanPages } from "@/lib/access";
import { resolveTenantPlan } from "@/lib/planTier";
import { isModuleLocked } from "@/lib/moduleAccess";
import { useChipLimits } from "@/hooks/useChipLimits";
import {
  isOperatorModuleAllowed,
  getModuleIdFromSidebarItemKey,
  getModuleIdFromPath,
} from "@/lib/operatorPermissions";
import { 
  OPERACAO_ITEMS, 
  INTELIGENCIA_ITEMS, 
  AGENTE_IA_ITEMS, 
  CANAIS_ITEMS, 
  MODULE_ITEMS,
  GERACAO_DIGITAL_ITEMS, 
  LIVPUB_ITEMS, 
  AJUDA_ITEMS, 
  ADMIN_ITEMS, 
  COLOR_PRESETS 
} from "@/lib/appSidebar/constants";
import { NavItem } from "@/components/appSidebar/NavItem";
import { SidebarHeader } from "@/components/appSidebar/SidebarHeader";
import { SidebarFooter } from "@/components/appSidebar/SidebarFooter";
import { BrandCustomizer } from "@/components/appSidebar/BrandCustomizer";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

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

  const [, setRefreshKey] = useState(0);
  useEffect(() => {
    const handleRefresh = () => setRefreshKey((prev) => prev + 1);
    window.addEventListener("vexo-brand-change", handleRefresh);
    return () => window.removeEventListener("vexo-brand-change", handleRefresh);
  }, []);

  const chipLimits = useChipLimits();
  const allowedTabs = crmClient?.selectedClient?.n8n_settings?.allowed_tabs;
  const planTier = resolveTenantPlan(crmClient?.selectedClient);
  const inheritedPages = getInheritedPlanPages(planTier, crmClient?.selectedClient);

  // Uma implementação só, compartilhada com as telas: lib/moduleAccess.
  // Antes esta função tinha lista própria de páginas universais e um
  // curto-circuito que só avaliava tenant modular; era a segunda implementação
  // da mesma regra, e discordava da tela (menu sem cadeado, tela bloqueada).
  const isSidebarItemModularlyLocked = (item: (typeof OPERACAO_ITEMS)[number]): boolean =>
    isModuleLocked(crmClient?.selectedClient, item.key || item.page, chipLimits);

  const isOperator = isInternalUser && !isAdminUser && (accessProfile?.accessPreset === "operador" || accessProfile?.approvalLevel === "operator");
  const isManager = isInternalUser && (accessProfile?.accessPreset === "gestor" || accessProfile?.approvalLevel === "manager" || accessProfile?.approvalLevel === "director");

  const filterItems = (items: typeof OPERACAO_ITEMS) => {
    return items
      .filter((f) => {
        const modId = getModuleIdFromSidebarItemKey(f.key) || getModuleIdFromPath(f.url);
        if (isOperator && modId) {
          return isOperatorModuleAllowed(modId, accessProfile);
        }
        const hasAccess = isAdminUser || isManager || canAccessInternalPage(f.page) || (!isInternalUser && inheritedPages.includes(f.page));
        return hasAccess && (isInternalUser || isPathAllowedForClient(f.url, allowedTabs));
      });
  };

  const visibleOperacao = filterItems(OPERACAO_ITEMS);
  const visibleInteligencia = filterItems(INTELIGENCIA_ITEMS);
  const visibleAgenteIa = filterItems(AGENTE_IA_ITEMS);
  const visibleCanais = filterItems(CANAIS_ITEMS);
  const visibleModulos = filterItems(MODULE_ITEMS);
  const visibleGeracaoDigital = selectedClientId === "geracao-digital" ? filterItems(GERACAO_DIGITAL_ITEMS) : [];
  const visibleLivpub = (isAdminUser || selectedClientId === "livpub") ? filterItems(LIVPUB_ITEMS) : [];

  const visibleAjuda = AJUDA_ITEMS.filter((f) => {
    const modId = getModuleIdFromSidebarItemKey(f.key) || getModuleIdFromPath(f.url);
    if (isOperator && modId) {
      return isOperatorModuleAllowed(modId, accessProfile);
    }
    return isInternalUser || isPathAllowedForClient(f.url, allowedTabs);
  });
  const visibleAdmin = filterItems(ADMIN_ITEMS);

  const selectedPreset = COLOR_PRESETS[(color as keyof typeof COLOR_PRESETS) || "default"] || COLOR_PRESETS.default;

  return (
    <TooltipProvider delayDuration={150}>
      <aside
        className={cn(
          "print:hidden relative flex h-full shrink-0 flex-col overflow-hidden border-r border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,255,0.98),rgba(237,242,255,0.98))] text-slate-700 backdrop-blur-xl transition-all duration-200 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(8,10,34,0.98),rgba(5,6,24,0.98))] dark:text-slate-100",
          collapsed ? "w-[74px]" : "w-[204px]"
        )}
        style={{
          "--primary-from": selectedPreset.from,
          "--primary-to": selectedPreset.to,
          "--primary-shadow": selectedPreset.shadow,
        } as React.CSSProperties}
      >
        <SidebarHeader
          collapsed={collapsed}
          logo={logo}
          title={title}
          selectedPreset={selectedPreset}
          onOpenCustomizer={() => setIsCustomizerOpen(true)}
        />

      <nav className="flex-1 overflow-y-auto px-2 py-3.5">
        {/* ── OPERAÇÃO ── */}
        {visibleOperacao.length > 0 && (
          <>
            {!collapsed && (
              <p className="mt-2 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Operação
              </p>
            )}
            <div className="space-y-1">
              {visibleOperacao.map((item) => (
                <NavItem
                  key={item.key}
                  item={item}
                  collapsed={collapsed}
                  isLocked={isSidebarItemModularlyLocked(item)}
                />
              ))}
            </div>
          </>
        )}

        {/* ── INTELIGÊNCIA ── */}
        {visibleInteligencia.length > 0 && (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Inteligência
              </p>
            )}
            <div className="space-y-1">
              {visibleInteligencia.map((item) => (
                <NavItem
                  key={item.key}
                  item={item}
                  collapsed={collapsed}
                  isLocked={isSidebarItemModularlyLocked(item)}
                />
              ))}
            </div>
          </>
        )}

        {/* ── AGENTE IA ── */}
        {visibleAgenteIa.length > 0 && (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Agente IA
              </p>
            )}
            <div className="space-y-1">
              {visibleAgenteIa.map((item) => (
                <NavItem
                  key={item.key}
                  item={item}
                  collapsed={collapsed}
                  isLocked={isSidebarItemModularlyLocked(item)}
                />
              ))}
            </div>
          </>
        )}

        {/* ── CANAIS ── */}
        {visibleCanais.length > 0 && (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Canais
              </p>
            )}
            <div className="space-y-1">
              {visibleCanais.map((item) => (
                <NavItem
                  key={item.key}
                  item={item}
                  collapsed={collapsed}
                  isLocked={isSidebarItemModularlyLocked(item)}
                />
              ))}
            </div>
          </>
        )}

        {/* ── MÓDULOS ── */}
        {(visibleModulos.length > 0 || visibleGeracaoDigital.length > 0 || visibleLivpub.length > 0) && (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Módulos
              </p>
            )}
            <div className="space-y-1">
              {visibleModulos.map((item) => (
                <NavItem
                  key={item.key}
                  item={item}
                  collapsed={collapsed}
                  isLocked={isSidebarItemModularlyLocked(item)}
                />
              ))}
              {visibleGeracaoDigital.map((item) => (
                <NavItem key={item.key} item={item} collapsed={collapsed} />
              ))}
              {visibleLivpub.map((item) => (
                <NavItem key={item.key} item={item} collapsed={collapsed} />
              ))}
            </div>
          </>
        )}

        {/* ── AJUDA & SETUP ── */}
        {visibleAjuda.length > 0 && (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Ajuda & Setup
              </p>
            )}
            <div className="space-y-1">
              {visibleAjuda.map((item) => (
                <NavItem key={item.key} item={item} collapsed={collapsed} />
              ))}
            </div>
          </>
        )}

        {/* ── ADMIN (Master) ou EQUIPE (Gestores) ── */}
        {isAdminUser && visibleAdmin.length > 0 ? (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Administrador
              </p>
            )}
            <div className="space-y-1">
              {visibleAdmin.map((item) => (
                <NavItem key={item.key} item={item} collapsed={collapsed} />
              ))}
            </div>
          </>
        ) : (!isOperator && (isAdminUser || accessProfile?.allow_user_management === true || accessProfile?.allowUserManagement === true || accessProfile?.permissions?.includes("users.manage" as any) || accessProfile?.granularPermissions?.includes("users.manage") || accessProfile?.role === "manager" || accessProfile?.role === "admin")) || (isOperator && isOperatorModuleAllowed("admin", accessProfile)) ? (
          <>
            {!collapsed && (
              <p className="mt-4 px-2.5 pb-2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                Equipe
              </p>
            )}
            <div className="space-y-1">
              <NavItem
                item={{
                  label: "Equipe & Usuários",
                  url: "/crm/admin?tab=usuarios",
                  icon: Users,
                }}
                collapsed={collapsed}
              />
            </div>
          </>
        ) : null}

        {/* ── Recolher sidebar ── */}
        <div className="mt-3 space-y-1">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCollapsed(false)}
                  aria-label="Expandir menu lateral"
                  className="flex h-9 w-full items-center justify-center rounded-xl px-0 text-sm font-medium text-slate-600 transition-all hover:bg-slate-100/80 hover:text-slate-900 dark:text-sidebar-foreground dark:hover:bg-white/[0.04] dark:hover:text-foreground"
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={10} className="font-medium">
                Expandir menu lateral
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={() => setCollapsed(true)}
              aria-label="Recolher menu lateral"
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-[13px] font-medium text-slate-600 transition-all hover:bg-slate-100/80 hover:text-slate-900 dark:text-sidebar-foreground dark:hover:bg-white/[0.04] dark:hover:text-foreground"
            >
              <PanelLeftClose className="h-4 w-4" />
              <span>Recolher</span>
            </button>
          )}
        </div>
      </nav>

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
  </TooltipProvider>
  );
}
