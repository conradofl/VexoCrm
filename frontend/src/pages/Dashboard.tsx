import { useState, useMemo, type ReactNode } from "react";
import { PageShell } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useDashboard, useRefreshDashboard, type DashboardPeriod, type DashboardRange } from "@/hooks/useDashboard";
import { formatDateRange } from "@/lib/dashboard/formatters";
import { DashboardHeader } from "./Dashboard/DashboardHeader";
import { Block1WhatHappened } from "./Dashboard/Block1WhatHappened";
import { Block2Rankings } from "./Dashboard/Block2Rankings";
import { Block3ActionAlerts } from "./Dashboard/Block3ActionAlerts";
import { Block4Analysis } from "./Dashboard/Block4Analysis";
import { SmartLinkEngagementCard } from "@/components/dashboard/SmartLinkEngagementCard";
import { StalledLeadsAlertCard } from "@/components/dashboard/StalledLeadsAlertCard";

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

  const periodDays = useMemo(() => {
    if (period === "7d") return 7;
    if (period === "this_month") return 30;
    if (period === "custom" && customRange?.from && customRange?.to) {
      const from = new Date(customRange.from).getTime();
      const to = new Date(customRange.to).getTime();
      const diffDays = Math.round(Math.abs(to - from) / (1000 * 60 * 60 * 24));
      return Math.max(1, diffDays);
    }
    return 30;
  }, [period, customRange]);

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
        ) : data ? (
          <>
            {/* Primeiro bloco: o que aconteceu (5 números ou 3 dependendo dos módulos GD) */}
            <Block1WhatHappened
              summary={data.summary}
              hasProposalsAndContracts={data.hasProposalsAndContracts}
              periodLabel={periodLabel}
              unavailableBlocks={data.unavailableBlocks}
              comparison={data.periodInfo}
            />

            {/* Card de Engajamento de Links & Cliques em Tempo Real */}
            <SmartLinkEngagementCard
              clientId={effectiveClientId}
              periodDays={periodDays}
            />

            {/* Pilar 1: Aviso de Lead Parado (Nenhum Lead Esquecido) */}
            <StalledLeadsAlertCard
              clientId={effectiveClientId}
              minDays={3}
            />

            {/* Segundo bloco: o que está indo bem e o que não está (4 rankings curtos) */}
            <Block2Rankings rankings={data.rankings} />

            {/* Análise: leads por temperatura/estágio, perfil que converte, saúde da base, tempo de resposta */}
            <Block4Analysis analysis={data.analysis} />

            {/* Terceiro bloco: o que fazer agora (no máximo 3 frases com ação direta) */}
            <Block3ActionAlerts alerts={data.alerts} incomplete={data.unavailableBlocks?.includes("alerts")} />
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
