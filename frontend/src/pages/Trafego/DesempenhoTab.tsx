// Aba Desempenho: KPIs contra a meta por janela; conta, campanha, conjunto e
// anúncio; decisão sugerida e motivo por anúncio. Só leitura.
//
// Dado velho nunca aparece como dado de agora: conta com erro de coleta mostra
// "sem atualização desde ...". Coluna do Vexo sem origem mostra "sem registro".
import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DECISION_LABELS,
  formatCount,
  formatDateTime,
  formatKpi,
  formatMoney,
  useTrafficPerformance,
  type TrafficAd,
  type TrafficCampaign,
  type TrafficDecisionKey,
  type TrafficKpiDefinition,
  type TrafficPerformance,
} from "@/hooks/useTraffic";

const DECISION_STYLE: Record<TrafficDecisionKey, string> = {
  ESCALAR: "bg-emerald-600 text-white",
  MANTER: "bg-slate-600 text-white",
  MATAR: "bg-red-600 text-white",
  AMOSTRA_INSUFICIENTE: "bg-amber-500 text-black",
  SEM_META: "border bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  CAMPAIGN_PAUSED: "Campanha pausada",
  ADSET_PAUSED: "Conjunto pausado",
  ARCHIVED: "Arquivado",
  DELETED: "Excluído",
  DISAPPROVED: "Reprovado",
  PENDING_REVIEW: "Em análise",
  WITH_ISSUES: "Com problema",
  IN_PROCESS: "Processando",
};

function DecisionBadge({ decision }: { decision: TrafficDecisionKey | null }) {
  if (!decision) return null;
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${DECISION_STYLE[decision]}`}>
      {DECISION_LABELS[decision]}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function AdRow({ ad, primary, currency }: { ad: TrafficAd; primary: TrafficKpiDefinition | null; currency: string | null }) {
  return (
    <li className="space-y-2 p-3" data-testid="anuncio">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{ad.name || `Anúncio ${ad.id}`}</p>
          <p className="text-xs text-muted-foreground">
            {ad.effectiveStatus ? STATUS_LABEL[ad.effectiveStatus] || ad.effectiveStatus : "Estado sem registro"}
          </p>
        </div>
        <DecisionBadge decision={ad.decision?.decisao ?? null} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Gasto" value={formatMoney(ad.metrics.spend, currency)} />
        <Stat label="Impressões" value={formatCount(ad.metrics.impressions)} />
        <Stat label="Cliques" value={formatCount(ad.metrics.clicks)} />
        <Stat label="Leads" value={formatCount(ad.metrics.leads)} />
        <Stat label="Conversas iniciadas" value={formatCount(ad.metrics.messages_started)} />
        {primary && <Stat label={primary.label} value={formatKpi(ad.kpis[primary.key], primary.unit, currency)} />}
        <Stat label="Respostas, reuniões e custo por reunião" value="sem registro" />
      </div>
      {ad.decision && <p className="break-words text-xs text-muted-foreground">{ad.decision.motivo}</p>}
    </li>
  );
}

function CampaignCard({
  campaign,
  primary,
  currency,
  defaultOpen,
}: {
  campaign: TrafficCampaign;
  primary: TrafficKpiDefinition | null;
  currency: string | null;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const adsCount = campaign.adsets.reduce((total, adset) => total + adset.ads.length, 0);

  return (
    <div className="rounded-2xl border bg-card/60" data-testid="campanha">
      <button
        type="button"
        className="flex w-full items-start gap-2 p-4 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words font-medium">{campaign.name || "Campanha sem nome"}</p>
              <p className="text-xs text-muted-foreground">
                {adsCount} {adsCount === 1 ? "anúncio" : "anúncios"}
              </p>
            </div>
            <DecisionBadge decision={campaign.decision} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Stat label="Gasto" value={formatMoney(campaign.metrics.spend, currency)} />
            <Stat label="Leads" value={formatCount(campaign.metrics.leads)} />
            <Stat label="Conversas iniciadas" value={formatCount(campaign.metrics.messages_started)} />
            {primary && <Stat label={primary.label} value={formatKpi(campaign.kpis[primary.key], primary.unit, currency)} />}
          </div>
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t p-3">
          {campaign.adsets.map((adset) => (
            <div key={adset.id || "sem-conjunto"} className="rounded-xl border" data-testid="conjunto">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                <p className="min-w-0 break-words text-sm font-medium">Conjunto: {adset.name || "sem nome"}</p>
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums text-muted-foreground">{formatMoney(adset.metrics.spend, currency)}</span>
                  <DecisionBadge decision={adset.decision} />
                </div>
              </div>
              <ul className="divide-y">
                {adset.ads.map((ad) => (
                  <AdRow key={ad.id} ad={ad} primary={primary} currency={currency} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StaleWarnings({ data }: { data: TrafficPerformance }) {
  const stale = data.accountsStatus.filter((account) => account.lastSyncError || (account.status === "paused" && account.lastSyncAt));
  if (stale.length === 0) return null;
  return (
    <div className="space-y-2">
      {stale.map((account) => (
        <div key={account.id} className="flex items-start gap-2 rounded-2xl border border-amber-500/50 bg-amber-500/5 p-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="min-w-0 break-words">
            <span className="font-medium">{account.displayName || `Conta ${account.externalAccountId}`}:</span>{" "}
            {account.lastSyncAt
              ? `sem atualização desde ${formatDateTime(account.lastSyncAt)}. Os números abaixo são dessa data.`
              : "nenhuma coleta deu certo ainda."}
            {account.lastSyncError ? ` Motivo: ${account.lastSyncError}` : " Coleta pausada."}
          </p>
        </div>
      ))}
    </div>
  );
}

export function DesempenhoTab({ clientId, onGoToTab }: { clientId: string; onGoToTab: (tab: string) => void }) {
  const [windowDays, setWindowDays] = useState(7);
  const { data, isLoading, isError, error, isFetching } = useTrafficPerformance(clientId, windowDays);

  if (isLoading) {
    return <div className="rounded-2xl border bg-card/60 p-8 text-center text-sm text-muted-foreground">Carregando desempenho...</div>;
  }
  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm" role="alert">
        <p className="font-medium text-destructive">Não foi possível carregar o desempenho.</p>
        <p className="mt-1 text-muted-foreground">{(error as Error)?.message}</p>
      </div>
    );
  }

  const primary = data.catalog.find((kpi) => kpi.key === data.primaryKpi) || null;
  const mainCurrency = data.accounts[0]?.currency || "BRL";
  const hasAccounts = data.accountsStatus.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Janela">
          {data.windows.map((days) => (
            <Button
              key={days}
              size="sm"
              variant={days === data.window.days ? "default" : "outline"}
              aria-pressed={days === data.window.days}
              onClick={() => setWindowDays(days)}
            >
              {days} dias
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground" data-testid="periodo">
          {data.window.since.split("-").reverse().join("/")} a {data.window.until.split("-").reverse().join("/")}
          {isFetching ? " · atualizando..." : ""}
        </p>
      </div>

      <StaleWarnings data={data} />

      {!hasAccounts ? (
        <div className="rounded-2xl border bg-card/60 p-8 text-center">
          <p className="font-medium">Nenhuma conta de anúncio cadastrada.</p>
          <p className="mt-1 text-sm text-muted-foreground">Cadastre a conta na aba Conexão para o Vexo começar a ler.</p>
          <Button className="mt-4" variant="outline" onClick={() => onGoToTab("conexao")}>Ir para Conexão</Button>
        </div>
      ) : data.adsCount === 0 ? (
        <div className="rounded-2xl border bg-card/60 p-8 text-center" data-testid="sem-dados">
          <p className="font-medium">Sem dados neste período.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nenhuma métrica coletada entre as datas acima. Confira o estado da coleta na aba Conexão.
          </p>
          <Button className="mt-4" variant="outline" onClick={() => onGoToTab("conexao")}>Ir para Conexão</Button>
        </div>
      ) : (
        <>
          {!data.hasProfile || !primary ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm" role="status">
              <p className="min-w-0">Sem KPI principal com meta, o Vexo mostra os números mas não sugere decisão.</p>
              <Button size="sm" variant="outline" onClick={() => onGoToTab("metas")}>Definir metas</Button>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border bg-card/60 p-4">
              <Stat label="Gasto no período" value={formatMoney(data.totals.metrics.spend, mainCurrency)} />
            </div>
            <div className="rounded-2xl border bg-card/60 p-4">
              <Stat label="Leads" value={formatCount(data.totals.metrics.leads)} />
            </div>
            <div className="rounded-2xl border bg-card/60 p-4">
              <Stat label="Conversas iniciadas" value={formatCount(data.totals.metrics.messages_started)} />
            </div>
            <div className="rounded-2xl border bg-card/60 p-4">
              <Stat label="Cliques" value={formatCount(data.totals.metrics.clicks)} />
            </div>
          </div>

          {data.targets.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.targets.map((target) => {
                const good = target.variacao !== null && target.variacao >= 0;
                return (
                  <div key={target.key} className="rounded-2xl border bg-card/60 p-4" data-testid={`meta-${target.key}`}>
                    <p className="text-xs text-muted-foreground">
                      {target.label}
                      {target.key === data.primaryKpi ? " · principal" : ""}
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{formatKpi(target.value, target.unit, mainCurrency)}</p>
                    <p className="text-xs text-muted-foreground">
                      Meta: {target.target === null ? "sem meta" : formatKpi(target.target, target.unit, mainCurrency)}
                      {target.variacao !== null && (
                        <span className={good ? " text-emerald-600 dark:text-emerald-400" : " text-red-600 dark:text-red-400"}>
                          {" · "}
                          {new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(Math.abs(target.variacao * 100))}%{" "}
                          {good ? "melhor" : "pior"}
                        </span>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            A decisão é uma sugestão de leitura. Respostas, reuniões e custo por reunião aparecem quando o anúncio de origem estiver
            gravado no lead.
          </p>

          {data.accounts.map((account) => (
            <section key={`${account.platform}:${account.id}`} className="space-y-3" data-testid="conta-desempenho">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="min-w-0 break-words font-medium">
                  {account.name || `Conta ${account.id}`}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {account.platform === "meta" ? "Meta Ads" : "Google Ads"}
                  </span>
                </h2>
                <span className="text-sm tabular-nums text-muted-foreground">{formatMoney(account.metrics.spend, account.currency)}</span>
              </div>
              {account.campaigns.map((campaign, index) => (
                <CampaignCard
                  key={campaign.id || `sem-campanha-${index}`}
                  campaign={campaign}
                  primary={primary}
                  currency={account.currency}
                  defaultOpen={index === 0}
                />
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
