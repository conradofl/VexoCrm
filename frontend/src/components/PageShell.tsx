import { useEffect, useState, type ReactNode } from "react";
import { Building2, ChevronDown, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

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
  spacing = "space-y-5",
  compactHero = false,
  contentClassName,
  showGlobalClientSelector = false,
}: PageShellProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { user, accessProfile } = useAuth();
  const crmClient = useOptionalCrmClient();
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

  const globalClientSelector = shouldShowGlobalClientSelector ? (
    <div className="hidden min-w-[230px] items-center gap-2 xl:flex">
      <Building2 className="h-4 w-4 text-muted-foreground" />
      <Select value={crmClient.selectedClientId || undefined} onValueChange={crmClient.setSelectedClientId} disabled={crmClient.isLoading || selectorClients.length === 0}>
        <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white/85 shadow-[0_14px_28px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.04]">
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
        <div className="flex items-center gap-4 px-5 py-4 lg:px-8">
          <div className="hidden items-center gap-2 lg:flex">
            <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-200">
              VEXO
            </span>
            <span className="text-slate-400 dark:text-white/25">/</span>
            <span className="text-sm font-semibold text-foreground">{title}</span>
          </div>

          <div className="relative w-full max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              readOnly
              value=""
              placeholder="Pesquisar..."
              className="h-12 w-full rounded-full border border-slate-200 bg-white/80 pl-11 pr-4 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-cyan-500/30 dark:border-white/10 dark:bg-white/[0.05] dark:focus:border-cyan-300/40"
            />
          </div>

          <div className="flex items-center gap-3">
            {globalClientSelector}
            <button
              type="button"
              onClick={() => mounted && setTheme(isDark ? "light" : "dark")}
              className="hidden h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/85 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:bg-white/[0.08] dark:hover:text-white md:flex"
              aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
              title={isDark ? "Tema claro" : "Tema escuro"}
            >
              {mounted && isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <div className="flex items-center gap-3 rounded-full border border-slate-200/90 bg-white/85 px-2 py-1.5 shadow-[0_18px_34px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[0_18px_34px_rgba(0,0,0,0.24)]">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(139,92,246,0.95),rgba(34,211,238,0.95))] text-sm font-bold text-slate-950">
                {userInitials || "UX"}
              </div>
              <div className="hidden min-w-0 lg:block">
                <p className="truncate text-sm font-semibold text-foreground">{userName}</p>
                <p className="text-xs text-muted-foreground">Equipe Vexo</p>
              </div>
              <ChevronDown className="mr-1 hidden h-4 w-4 text-slate-400 dark:text-white/40 lg:block" />
            </div>
          </div>
        </div>
      </header>

      <div className={cn("flex-1 overflow-y-auto px-5 py-4 lg:px-8 lg:py-5", spacing, contentClassName)}>
        <div
          className={
            compactHero
              ? "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(244,247,255,0.96))] px-5 py-4 shadow-[0_18px_48px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(12,14,46,0.84),rgba(7,8,28,0.96))] dark:shadow-[0_18px_48px_rgba(0,0,0,0.24)]"
              : "mb-6 flex flex-wrap items-start justify-between gap-4 rounded-[30px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(244,247,255,0.96))] px-6 py-6 shadow-[0_24px_80px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(12,14,46,0.84),rgba(7,8,28,0.96))] dark:shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
          }
        >
          <div className="max-w-3xl">
            <p className={compactHero ? "mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-200" : "mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-700 dark:text-cyan-200"}>
              Command center
            </p>
            <h1 className={compactHero ? "text-2xl font-extrabold tracking-[-0.04em] text-foreground" : "text-3xl font-extrabold tracking-[-0.04em] text-foreground"}>
              {title}
            </h1>
            {subtitle && <p className={compactHero ? "mt-1 text-xs text-muted-foreground" : "mt-2 text-sm text-muted-foreground"}>{subtitle}</p>}
          </div>
          {headerRight && (
            <div className="flex flex-wrap items-center gap-3">
              {headerRight}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
