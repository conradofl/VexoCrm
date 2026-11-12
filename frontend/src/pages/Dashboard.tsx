import { useState, useMemo, type ReactNode } from "react";
import { PageShell } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useDashboard, useRefreshDashboard, type DashboardPeriod, type DashboardRange } from "@/hooks/useDashboard";
import { formatDateRange } from "@/lib/dashboard/formatters";
import { DashboardHeader } from "./Dashboard/DashboardHeader";
import { OverviewTab } from "./Dashboard/OverviewTab";
import { OnboardingProgressCard } from "@/components/dashboard/OnboardingProgressCard";

interface DashboardProps {
  fixedClientId?: string;
  fixedClientName?: string;
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
}

export default function Dashboard({
  fixedClientId,
  fixedClientName,
  title = "Central de Comando",
  subtitle = "Respostas estratégicas e indicadores reais de conversão do seu funil",
  headerRight,
}: DashboardProps) {
  const crmClient = useOptionalCrmClient();
  const effectiveClientId = fixedClientId || crmClient?.selectedClientId || "";
  const selectedClient = crmClient?.selectedClient || null;
  const resolvedClientName = fixedClientName || selectedClient?.name || effectiveClientId;

  // Seletor de período no topo: 7 dias, 30 dias, este mês ou intervalo escolhido. Padrão: 30 dias.
  const [period, setPeriod] = useState<DashboardPeriod>("30d");
  // Intervalo personalizado JÁ aplicado (o rascunho das datas fica no cabeçalho)
  const [customRange, setCustomRange] = useState<DashboardRange | null>(null);
  const range = period === "custom" ? customRange : null;

  const { data, isLoading, error } = useDashboard(effectiveClientId, period, range);
  const refreshMutation = useRefreshDashboard(effectiveClientId);

  const periodLabel = useMemo(() => {
    switch (period) {
      case "custom":
        return range ? formatDateRange(range) : "Período personalizado";
      case "7d":
        return "Últimos 7 dias";
      case "this_month":
        return "Este mês";
      case "30d":
      default:
        return "Últimos 30 dias";
    }
  }, [period, range]);

  if (!effectiveClientId) {
    return (
      <PageShell title={title} subtitle={subtitle} compactHero spacing="space-y-4">
        <EmptyState title="Selecione uma empresa" description="Escolha um cliente para ver o painel." />
      </PageShell>
    );
  }

  const normalizedCacheStatus =
    data?.cacheStatus === "error"
      ? "failed"
      : refreshMutation.isPending
      ? "updating"
      : "ready";

  return (
    <PageShell
      title={title}
      subtitle={`${subtitle} · ${resolvedClientName}`}
      compactHero
      spacing="space-y-6"
      headerRight={headerRight}
    >
      <ErrorMessage message={error ? (error as Error).message : null} variant="banner" />

      {/* O seletor de período fica SEMPRE na tela: sem dados ainda, ou com intervalo recusado pelo
          servidor, é por ele que o usuário escolhe outro período. */}
      <div className="space-y-6">
        <OnboardingProgressCard
          clientId={effectiveClientId}
          baseTotal={data?.overview?.base?.total}
        />
        <DashboardHeader
          period={period}
          onPeriodChange={setPeriod}
          lastUpdatedAt={data?.lastUpdatedAt ?? null}
          cacheStatus={normalizedCacheStatus}
          onRefresh={() => refreshMutation.mutate({ period, range })}
          customRange={customRange}
          onCustomRangeApply={setCustomRange}
          isRefreshing={refreshMutation.isPending}
        />

        {period === "custom" && !customRange ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            Escolha a data inicial e a data final e clique em Aplicar.
          </div>
        ) : isLoading && !data ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground animate-pulse">
            Carregando métricas pré-calculadas...
          </div>
        ) : data?.overview ? (
          <OverviewTab data={data} periodLabel={periodLabel} />
        ) : data ? (
          // Payload gravado antes da Visão geral existir: não há o que mostrar até o próximo recálculo.
          <div className="flex h-[200px] flex-col items-center justify-center gap-1 px-4 text-center text-sm text-muted-foreground">
            <p>Os números desta empresa ainda são de um cálculo antigo.</p>
            <p>Clique em “Atualizar agora” para recalcular.</p>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
