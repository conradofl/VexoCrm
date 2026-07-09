import { useEffect, useState, type ReactNode } from "react";
import { Building2, ChevronDown, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { HelpDeskWidget } from "@/components/HelpDeskWidget";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { createContext, useContext } from "react";

export const PageShellContext = createContext(false);

interface PageShellProps {
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  children: ReactNode;
  spacing?: string;
  compactHero?: boolean;
  contentClassName?: string;
  showGlobalClientSelector?: boolean;
}

export function PageShell({
  title,
  subtitle,
  headerRight,
  children,
  spacing = "space-y-4",
  compactHero = false,
  contentClassName,
  showGlobalClientSelector = true,
}: PageShellProps) {
  const isNested = useContext(PageShellContext);

  if (isNested) {
    return <div className={cn("space-y-4", spacing, contentClassName)}>{children}</div>;
  }
  const { resolvedTheme, setTheme } = useTheme();
  const { user, accessProfile } = useAuth();
  const crmClient = useOptionalCrmClient();
  const selectedClientId = crmClient?.selectedClientId || "global";
  const [mounted, setMounted] = useState(false);
  const userEmail = user?.email || accessProfile?.email || "";
  const userName =
    user?.displayName?.trim() ||
    (userEmail.includes("@") ? userEmail.split("@")[0] : userEmail) ||
    "Usuario";
  const userInitials = userName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const isDark = resolvedTheme !== "light";
  const shouldShowGlobalClientSelector =
    showGlobalClientSelector &&
    crmClient &&
    (crmClient.clients.length > 1 || crmClient.isLoading || Boolean(crmClient.selectedClientId));
  const selectedClientFallback = crmClient?.selectedClientId
    ? {
        id: crmClient.selectedClientId,
        name: crmClient.selectedClient?.name || crmClient.selectedClientId,
      }
    : null;
  const selectorClients =
    crmClient && selectedClientFallback && !crmClient.clients.some((client) => client.id === selectedClientFallback.id)
      ? [selectedClientFallback, ...crmClient.clients]
      : crmClient?.clients || [];

  const [logo, setLogo] = useState<string | null>(null);
  const [brandTitle, setBrandTitle] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const loadBrand = () => {
      const savedLogo = localStorage.getItem(`vexocrm_logo_${selectedClientId}`);
      const savedTitle = localStorage.getItem(`vexocrm_title_${selectedClientId}`);
      const savedColor = localStorage.getItem(`vexocrm_color_${selectedClientId}`);
      setLogo(savedLogo);
      setBrandTitle(savedTitle);
      setColor(savedColor);
    };
    loadBrand();
    window.addEventListener("vexo-brand-change", loadBrand);
    return () => {
      window.removeEventListener("vexo-brand-change", loadBrand);
    };
  }, [selectedClientId]);

  // Dynamic Browser Tab Favicon
  useEffect(() => {
    if (typeof window === "undefined") return;
    const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement || document.createElement('link');
    link.type = 'image/x-icon';
    link.rel = 'shortcut icon';
    if (logo) {
      link.href = logo;
    } else {
      link.href = '/favicon.ico'; // default fallback
    }
    document.getElementsByTagName('head')[0].appendChild(link);
  }, [logo]);

  // Dynamic Browser Tab Title
  useEffect(() => {
    if (typeof window === "undefined") return;
    document.title = brandTitle ? `${brandTitle} - ${title}` : `Vexo OS - ${title}`;
  }, [brandTitle, title]);

  const COLOR_PRESETS = {
    default: { from: "#8b5cf6", to: "#22d3ee" },
    emerald: { from: "#059669", to: "#10b981" },
    rose: { from: "#e11d48", to: "#f43f5e" },
    amber: { from: "#d97706", to: "#f59e0b" },
    indigo: { from: "#4f46e5", to: "#6366f1" },
  };

  const selectedPreset = COLOR_PRESETS[(color as keyof typeof COLOR_PRESETS) || "default"] || COLOR_PRESETS.default;

  const globalClientSelector = shouldShowGlobalClientSelector ? (
    <div className="flex min-w-[160px] sm:min-w-[210px] items-center gap-2">
      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
      <Select value={crmClient.selectedClientId || undefined} onValueChange={crmClient.setSelectedClientId} disabled={crmClient.isLoading || selectorClients.length === 0}>
        <SelectTrigger className="h-9 rounded-lg border-slate-200 bg-white/85 shadow-[0_10px_20px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.04]">
          <SelectValue placeholder={crmClient.isLoading ? "Carregando empresas" : "Selecionar empresa"} />
        </SelectTrigger>
        <SelectContent>
          {selectorClients.map((client) => (
            <SelectItem key={client.id} value={client.id}>
              {client.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ) : null;

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-[rgba(255,255,255,0.82)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(8,10,34,0.84)]">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <div
            onClick={() => window.dispatchEvent(new Event("vexo-open-brand-customizer"))}
            className="hidden items-center gap-2.5 lg:flex cursor-pointer group/header-brand hover:opacity-80 transition-opacity"
            title="Clique para personalizar a marca do sistema"
          >
            {logo ? (
              <img
                src={logo}
                alt="Logo"
                className="h-6 w-6 rounded-lg object-cover shadow-[0_2px_8px_rgba(0,0,0,0.12)] border border-slate-200/50 dark:border-white/10"
              />
            ) : (
              <div
                className="flex h-6 w-6 items-center justify-center rounded-lg text-[10px] font-black text-white shadow-[0_2px_8px_rgba(6,182,212,0.25)] font-sans"
                style={{ backgroundImage: `linear-gradient(135deg, ${selectedPreset.from}, ${selectedPreset.to})` }}
              >
                {(brandTitle || "Vexo OS")[0]?.toUpperCase()}
              </div>
            )}
            <span className="font-sans text-xs font-extrabold tracking-tight text-foreground group-hover/header-brand:text-cyan-500 transition-colors">
              {brandTitle || "Vexo OS"}
            </span>
            <span className="text-slate-400 dark:text-white/25">/</span>
            <span className="text-xs font-semibold text-foreground">{title}</span>
          </div>

          <div className="flex items-center gap-2">
            {globalClientSelector}
            <HelpDeskWidget pageTitle={title} />
            <button
              type="button"
              onClick={() => mounted && setTheme(isDark ? "light" : "dark")}
              className="hidden h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/85 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:bg-white/[0.08] dark:hover:text-white md:flex"
              aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
              title={isDark ? "Tema claro" : "Tema escuro"}
            >
              {mounted && isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <div className="flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/85 px-1.5 py-1 shadow-[0_12px_24px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[0_12px_24px_rgba(0,0,0,0.20)]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(139,92,246,0.95),rgba(34,211,238,0.95))] text-xs font-bold text-slate-950">
                {userInitials || "UX"}
              </div>
              <div className="hidden min-w-0 lg:block">
                <p className="truncate text-xs font-semibold text-foreground">{userName}</p>
                <p className="text-[10px] text-muted-foreground">Equipe Vexo</p>
              </div>
              <ChevronDown className="mr-1 hidden h-3.5 w-3.5 text-slate-400 dark:text-white/40 lg:block" />
            </div>
          </div>
        </div>
      </header>

      <div className={cn("flex-1 overflow-y-auto px-4 py-3 lg:px-6 lg:py-4", spacing, contentClassName)}>
        <div
          className={
            compactHero
              ? "mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(244,247,255,0.96))] px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(12,14,46,0.84),rgba(7,8,28,0.96))] dark:shadow-[0_12px_30px_rgba(0,0,0,0.20)]"
              : "mb-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(244,247,255,0.96))] px-5 py-4 shadow-[0_16px_46px_rgba(15,23,42,0.09)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(12,14,46,0.84),rgba(7,8,28,0.96))] dark:shadow-[0_16px_46px_rgba(0,0,0,0.24)]"
          }
        >
          <div className="max-w-3xl">
            <h1 className={compactHero ? "text-xl font-extrabold tracking-tight text-foreground" : "text-2xl font-extrabold tracking-tight text-foreground"}>
              {title}
            </h1>
            {subtitle && <p className={compactHero ? "mt-1 text-[11px] text-muted-foreground" : "mt-1.5 text-xs text-muted-foreground"}>{subtitle}</p>}
          </div>
          {headerRight && (
            <div className="flex flex-wrap items-center gap-2">
              {headerRight}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
