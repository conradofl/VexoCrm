import { useState, useMemo, type ReactNode } from "react";
import { PageShell } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useDashboard, useRefreshDashboard, type DashboardPeriod } from "@/hooks/useDashboard";
import { DashboardHeader } from "./Dashboard/DashboardHeader";
import { Block1WhatHappened } from "./Dashboard/Block1WhatHappened";
import { Block2Rankings } from "./Dashboard/Block2Rankings";
import { Block3ActionAlerts } from "./Dashboard/Block3ActionAlerts";

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

  // Seletor de período no topo: 7 dias, 30 dias, este mês. Padrão: 30 dias.
  const [period, setPeriod] = useState<DashboardPeriod>("30d");

  const { data, isLoading, error } = useDashboard(effectiveClientId, period);
  const refreshMutation = useRefreshDashboard(effectiveClientId);

  const periodLabel = useMemo(() => {
    switch (period) {
      case "7d":
        return "Últimos 7 dias";
      case "this_month":
        return "Este mês";
      case "30d":
      default:
        return "Últimos 30 dias";
    }
  }, [period]);

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

      {isLoading && !data ? (
        <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground animate-pulse">
          Carregando métricas pré-calculadas...
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Seletor de período e hora da última atualização */}
          <DashboardHeader
            period={period}
            onPeriodChange={setPeriod}
            lastUpdatedAt={data.lastUpdatedAt || new Date().toISOString()}
            cacheStatus={normalizedCacheStatus}
            onRefresh={() => refreshMutation.mutate(period)}
            isRefreshing={refreshMutation.isPending}
          />

          {/* Primeiro bloco: o que aconteceu (5 números ou 3 dependendo dos módulos GD) */}
          <Block1WhatHappened
            summary={data.summary}
            hasProposalsAndContracts={data.hasProposalsAndContracts}
            periodLabel={periodLabel}
            unavailableBlocks={data.unavailableBlocks}
          />

          {/* Segundo bloco: o que está indo bem e o que não está (4 rankings curtos) */}
          <Block2Rankings rankings={data.rankings} />

          {/* Terceiro bloco: o que fazer agora (no máximo 3 frases com ação direta) */}
          <Block3ActionAlerts alerts={data.alerts} incomplete={data.unavailableBlocks?.includes("alerts")} />
        </div>
      ) : null}
    </PageShell>
  );
}
