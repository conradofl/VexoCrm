import { Send, MessageSquareReply, CalendarCheck, FileSpreadsheet, CheckCircle2, Handshake, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatMetricNumber,
  formatDelta,
  describeComparison,
  describePreviousPeriod,
  describePeriodStatus,
  type DashboardPeriodInfo,
} from "@/lib/dashboard/formatters";
import type { DashboardSummary } from "@/hooks/useDashboard";

interface Block1WhatHappenedProps {
  summary: DashboardSummary;
  hasProposalsAndContracts: boolean;
  periodLabel: string;
  unavailableBlocks?: string[];
  // Período calculado pelo backend (datas atual e anterior). Ausente em payload antigo.
  comparison?: DashboardPeriodInfo | null;
}

// Número que não pôde ser calculado. Não mostra 0: zero é um dado, e aqui o dado não existe.
function UnavailableMetric() {
  return (
    <div role="status">
      <p className="text-2xl font-extrabold text-muted-foreground tracking-tight mt-0.5">Indisponível</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">Não foi possível calcular agora</p>
    </div>
  );
}

export function Block1WhatHappened({
  summary,
  hasProposalsAndContracts,
  periodLabel,
  unavailableBlocks = [],
  comparison = null,
}: Block1WhatHappenedProps) {
  // Todo "vs N" diz com o que está comparando: nos 30 dias anteriores / em 21 a 30 de setembro
  const previousLabel = describePreviousPeriod(comparison);
  // Período que ainda não terminou: o número do período atual está incompleto
  const periodStatus = describePeriodStatus(comparison);
  const sentDelta = formatDelta(summary.sent?.delta);
  const repliedDelta = formatDelta(summary.replied?.delta);
  const meetingsDelta = formatDelta(summary.meetings?.delta);
  const proposalsDelta = formatDelta(summary.proposals?.delta);
  const contractsDelta = formatDelta(summary.contracts?.delta);
  const closingsDelta = formatDelta(summary.closings?.delta);
  // undefined = payload antigo (sem a medida): não mostra caixa. null = bloco indisponível.
  const showClosings = summary.closings !== undefined;
  // Se não deu para saber se o tenant usa GD, as duas caixas aparecem como indisponíveis
  const proposalsUnavailable = unavailableBlocks.includes("summary.proposals");
  const contractsUnavailable = unavailableBlocks.includes("summary.contracts");
  const showGdCards = hasProposalsAndContracts || proposalsUnavailable || contractsUnavailable;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            O que aconteceu · {periodLabel}
          </h2>
          <p className="text-xs text-muted-foreground">{describeComparison(comparison)}</p>
          {periodStatus && (
            <p role="note" className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              {periodStatus}
            </p>
          )}
        </div>
      </div>

      <div
        className={`grid gap-4 ${
          showGdCards
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-6"
            : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
        }`}
      >
        {/* 1. Enviados */}
        <Card className="rounded-2xl border border-border/80 shadow-xs hover:border-border transition-all">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Send className="h-4 w-4" />
              </span>
              {summary.sent && <DeltaBadge delta={sentDelta} previousValue={summary.sent.previous} />}
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Enviados</p>
              {summary.sent ? (
                <>
                  <p className="text-2xl font-extrabold text-foreground tracking-tight mt-0.5">
                    {formatMetricNumber(summary.sent.current)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    vs {formatMetricNumber(summary.sent.previous)} {previousLabel}
                  </p>
                </>
              ) : (
                <UnavailableMetric />
              )}
            </div>
          </CardContent>
        </Card>

        {/* 2. Responderam (com taxa e declaração explícita da janela de 14 dias ao lado do número) */}
        <Card className="rounded-2xl border border-border/80 shadow-xs hover:border-border transition-all">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <MessageSquareReply className="h-4 w-4" />
              </span>
              {summary.replied && <DeltaBadge delta={repliedDelta} previousValue={summary.replied.previous} />}
            </div>
            <div>
              {summary.replied ? (
                <>
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs font-semibold text-muted-foreground">Responderam</p>
                    {/* taxa null = faltou o número de envios: mostra traço, nunca 0% */}
                    <span
                      className="text-xs font-bold text-emerald-600 dark:text-emerald-400"
                      title={summary.replied.rate == null ? "Taxa indisponível: não foi possível calcular os envios" : undefined}
                    >
                      {summary.replied.rate == null ? "—" : `${summary.replied.rate}%`}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <p className="text-2xl font-extrabold text-foreground tracking-tight">
                      {formatMetricNumber(summary.replied.current)}
                    </p>
                    {/* Declaração explícita ao lado do número — não em rodapé */}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                            {summary.replied.ruleDeclaration}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          Conta quem conversou nos 14 dias seguintes ao envio, garantindo precisão real sem inflar números de quem já falava com a empresa.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    vs {formatMetricNumber(summary.replied.previous)}
                    {summary.replied.previousRate == null ? "" : ` (${summary.replied.previousRate}%)`} {previousLabel}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-muted-foreground">Responderam</p>
                  <UnavailableMetric />
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 3. Agendaram Reunião */}
        <Card className="rounded-2xl border border-border/80 shadow-xs hover:border-border transition-all">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <CalendarCheck className="h-4 w-4" />
              </span>
              {summary.meetings && <DeltaBadge delta={meetingsDelta} previousValue={summary.meetings.previous} />}
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Agendaram Reunião</p>
              {summary.meetings ? (
                <>
                  <p className="text-2xl font-extrabold text-foreground tracking-tight mt-0.5">
                    {formatMetricNumber(summary.meetings.current)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    vs {formatMetricNumber(summary.meetings.previous)} {previousLabel}
                  </p>
                </>
              ) : (
                <UnavailableMetric />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Fechamentos (lead_conversions ganhas) */}
        {showClosings && (
          <Card className="rounded-2xl border border-border/80 shadow-xs hover:border-border transition-all">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400">
                  <Handshake className="h-4 w-4" />
                </span>
                {summary.closings && <DeltaBadge delta={closingsDelta} previousValue={summary.closings.previous} />}
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Fechamentos</p>
                {summary.closings ? (
                  <>
                    <p className="text-2xl font-extrabold text-foreground tracking-tight mt-0.5">
                      {formatMetricNumber(summary.closings.current)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      vs {formatMetricNumber(summary.closings.previous)} {previousLabel}
                    </p>
                  </>
                ) : (
                  <UnavailableMetric />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 4. Propostas Criadas (Somente se usa módulos GD) */}
        {((hasProposalsAndContracts && summary.proposals) || proposalsUnavailable) && (
          <Card className="rounded-2xl border border-border/80 shadow-xs hover:border-border transition-all">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <FileSpreadsheet className="h-4 w-4" />
                </span>
                {summary.proposals && <DeltaBadge delta={proposalsDelta} previousValue={summary.proposals.previous} />}
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Propostas Criadas</p>
                {summary.proposals ? (
                  <>
                    <p className="text-2xl font-extrabold text-foreground tracking-tight mt-0.5">
                      {formatMetricNumber(summary.proposals.current)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      vs {formatMetricNumber(summary.proposals.previous)} {previousLabel}
                    </p>
                  </>
                ) : (
                  <UnavailableMetric />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 5. Contratos Fechados (Somente se usa módulos GD) */}
        {((hasProposalsAndContracts && summary.contracts) || contractsUnavailable) && (
          <Card className="rounded-2xl border border-border/80 shadow-xs hover:border-border transition-all">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                {summary.contracts && <DeltaBadge delta={contractsDelta} previousValue={summary.contracts.previous} />}
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Contratos Fechados</p>
                {summary.contracts ? (
                  <>
                    <p className="text-2xl font-extrabold text-foreground tracking-tight mt-0.5">
                      {formatMetricNumber(summary.contracts.current)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      vs {formatMetricNumber(summary.contracts.previous)} {previousLabel}
                    </p>
                  </>
                ) : (
                  <UnavailableMetric />
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}

function DeltaBadge({
  delta,
  previousValue,
}: {
  delta: { text: string; isPositive: boolean; isNegative: boolean; isZero: boolean };
  previousValue: number;
}) {
  if (previousValue === 0 && delta.isZero) {
    return (
      <Badge variant="outline" className="text-[10px] font-semibold border-border text-muted-foreground">
        0%
      </Badge>
    );
  }

  if (delta.isPositive) {
    return (
      <Badge
        variant="outline"
        className="gap-0.5 text-[10px] font-semibold border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      >
        <TrendingUp className="h-3 w-3" />
        {delta.text}
      </Badge>
    );
  }

  if (delta.isNegative) {
    return (
      <Badge
        variant="outline"
        className="gap-0.5 text-[10px] font-semibold border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
      >
        <TrendingDown className="h-3 w-3" />
        {delta.text}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-[10px] font-semibold border-border text-muted-foreground">
      0%
    </Badge>
  );
}
