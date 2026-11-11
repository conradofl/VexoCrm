import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardPayload } from "@/hooks/useDashboard";
import { formatMetricNumber } from "@/lib/dashboard/formatters";
import {
  buildBaseSlices,
  buildChipAlertCard,
  buildChipUsage,
  buildFunnel,
  buildFunnelSelection,
  buildMessageRows,
  buildNeverApproachedCard,
  buildWaitingCard,
  type ActionCard,
  type BaseSliceKey,
  type FunnelStageKey,
} from "@/lib/dashboard/overview";

// Visão geral do Dashboard (redesenho, Fase 2). Laranja é o único tom de atenção da tela: sempre quer
// dizer "olhe aqui". Todo o resto é índigo ou neutro.

const CARD = "rounded-2xl border border-border bg-card";
const BIG_NUMBER = "font-bold leading-none tracking-tight tabular-nums";
const EYEBROW = "text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground";

const SLICE_COLOR: Record<BaseSliceKey, string> = {
  inConversation: "bg-indigo-600",
  noReply: "bg-indigo-400",
  neverApproached: "bg-indigo-200 dark:bg-indigo-300",
  closedNoApproach: "bg-slate-400",
  invalidPhone: "bg-slate-300 dark:bg-slate-600",
};

function ActionCardView({ card }: { card: ActionCard }) {
  if (card.kind === "waiting" && card.state === "pending") {
    return (
      <div className={`${CARD} flex flex-col gap-1.5 border-dashed px-5 py-4`} data-testid="card-waiting">
        <div className="flex items-baseline gap-2.5">
          <span className={`${BIG_NUMBER} text-[34px] text-muted-foreground/60`} aria-hidden="true">
            —
          </span>
          <span className="text-sm font-semibold text-foreground">pessoas esperam resposta</span>
        </div>
        <p className="text-[12.5px] text-muted-foreground">Disponível em breve. Este número vai sair da mesma fila da tela Conversas.</p>
      </div>
    );
  }

  if (card.kind === "waiting") {
    const tone = card.attention
      ? "border-orange-300 bg-orange-50 dark:border-orange-500/40 dark:bg-orange-500/10"
      : "border-border bg-card";
    const strong = card.attention ? "text-orange-800 dark:text-orange-200" : "text-foreground";
    return (
      <div className={`flex flex-col gap-1.5 rounded-2xl border px-5 py-4 ${tone}`} data-testid="card-waiting">
        <div className="flex items-baseline gap-2.5">
          <span className={`${BIG_NUMBER} text-[34px] ${strong}`}>{formatMetricNumber(card.value)}</span>
          <span className={`text-sm font-semibold ${strong}`}>{card.value === 1 ? "pessoa espera resposta" : "pessoas esperam resposta"}</span>
        </div>
        <p className={`text-[12.5px] ${card.attention ? "text-orange-900 dark:text-orange-200" : "text-muted-foreground"}`}>{card.detail}</p>
        <Link to={card.href} className={`mt-1 inline-flex min-h-[28px] items-center text-[13px] font-bold underline-offset-2 hover:underline ${strong}`}>
          {card.cta} →
        </Link>
      </div>
    );
  }

  if (card.kind === "neverApproached" && card.state === "unavailable") {
    return (
      <div className={`${CARD} flex flex-col gap-1.5 px-5 py-4`} data-testid="card-never-approached">
        <div className="flex items-baseline gap-2.5">
          <span className={`${BIG_NUMBER} text-[34px] text-muted-foreground/60`} aria-hidden="true">
            —
          </span>
          <span className="text-sm font-semibold text-foreground">contatos nunca abordados</span>
        </div>
        <p className="text-[12.5px] text-muted-foreground">Não foi possível calcular agora.</p>
      </div>
    );
  }

  if (card.kind === "neverApproached") {
    return (
      <div className={`${CARD} flex flex-col gap-1.5 px-5 py-4`} data-testid="card-never-approached">
        <div className="flex items-baseline gap-2.5">
          <span className={`${BIG_NUMBER} text-[34px] text-foreground`}>{formatMetricNumber(card.value)}</span>
          <span className="text-sm font-semibold text-foreground">{card.value === 1 ? "contato nunca abordado" : "contatos nunca abordados"}</span>
        </div>
        <p className="text-[12.5px] text-muted-foreground">{card.detail}</p>
        <p className="text-[12.5px] text-muted-foreground">{card.optOutNote}</p>
        {card.countedNote && (
          <p className="text-[11.5px] text-muted-foreground/80" data-testid="card-never-approached-counted">
            {card.countedNote}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-1.5 rounded-2xl border border-orange-300 bg-orange-50 px-5 py-4 dark:border-orange-500/40 dark:bg-orange-500/10"
      data-testid="card-chip"
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className={`${BIG_NUMBER} text-[34px] text-orange-800 dark:text-orange-200`}>
          {formatMetricNumber(card.value)}
          <span className="text-lg">/{formatMetricNumber(card.limit)}</span>
        </span>
        <span className="min-w-0 break-words text-sm font-semibold text-orange-800 dark:text-orange-200">
          envios de campanha e follow-up no chip {card.chipName} hoje
        </span>
      </div>
      <p className="text-[12.5px] text-orange-900 dark:text-orange-200">{card.detail}</p>
      <Link
        to={card.href}
        className="mt-1 inline-flex min-h-[28px] items-center text-[13px] font-bold text-orange-800 underline-offset-2 hover:underline dark:text-orange-200"
      >
        {card.cta} →
      </Link>
    </div>
  );
}

interface OverviewTabProps {
  data: DashboardPayload;
  periodLabel: string;
}

export function OverviewTab({ data, periodLabel }: OverviewTabProps) {
  const [selected, setSelected] = useState<FunnelStageKey>("replied");

  const overview = data.overview;
  const actionCards = useMemo(() => {
    const cards: ActionCard[] = [buildWaitingCard(overview?.waiting), buildNeverApproachedCard(overview?.base, data.lastUpdatedAt)];
    const chip = buildChipAlertCard(overview?.chips, overview?.chipsQuotaIsToday ?? false);
    if (chip) cards.push(chip);
    return cards;
  }, [overview, data.lastUpdatedAt]);
  const funnel = useMemo(() => buildFunnel(data), [data]);
  const selection = useMemo(() => buildFunnelSelection(data, funnel, selected), [data, funnel, selected]);
  const messages = useMemo(() => buildMessageRows(data.rankings.messages), [data.rankings.messages]);
  const chips = useMemo(() => buildChipUsage(overview?.chips), [overview?.chips]);
  const slices = useMemo(() => buildBaseSlices(overview?.base), [overview?.base]);

  return (
    <div className="flex flex-col gap-5">
      {/* 1 · Pede ação agora */}
      <section aria-label="Pede ação agora">
        <div className={`${EYEBROW} mb-2.5`}>Pede ação agora</div>
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {actionCards.map((card) => (
            <ActionCardView key={card.kind} card={card} />
          ))}
        </div>
      </section>

      {/* 2 · O funil: barras na proporção real + o detalhe da etapa clicada */}
      <section aria-label="Funil do período" className="flex flex-col gap-3.5 lg:flex-row lg:items-stretch">
        <div className={`${CARD} min-w-0 flex-[2] px-4 py-5 sm:px-6`}>
          <div className="mb-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h2 className="text-base font-bold text-foreground">De quem recebeu até quem marcou reunião</h2>
            <span className="text-[12.5px] text-muted-foreground">{periodLabel} · contando pessoas, não mensagens</span>
          </div>

          {!funnel.hasData ? (
            <p className="py-8 text-sm text-muted-foreground">{funnel.emptyText}</p>
          ) : (
            <>
              <p className="mb-4 text-xs text-muted-foreground">Clique numa etapa para ver o que explica o número.</p>
              <div className="flex flex-col gap-2">
                {funnel.stages.map((stage) => {
                  const on = stage.key === selected;
                  return (
                    <button
                      key={stage.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSelected(stage.key)}
                      className={`grid min-h-[56px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2 text-left transition-colors sm:grid-cols-[140px_minmax(0,1fr)_170px] ${
                        on ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500/50 dark:bg-indigo-500/10" : "border-transparent hover:bg-muted/40"
                      }`}
                    >
                      <span className="text-[13.5px] font-semibold text-foreground">{stage.label}</span>
                      <span className="col-span-2 row-start-2 block h-[22px] overflow-hidden rounded-md bg-muted sm:col-span-1 sm:row-start-auto">
                        {stage.widthPct !== null && (
                          <span
                            className={`block h-full rounded-md ${on ? "bg-indigo-600" : "bg-indigo-400"}`}
                            style={{ width: `${stage.widthPct}%` }}
                          />
                        )}
                      </span>
                      <span className="text-right">
                        <span className={`${BIG_NUMBER} block text-lg text-foreground`}>
                          {stage.people !== null ? formatMetricNumber(stage.people) : stage.emptyText}
                        </span>
                        {stage.conversion && <span className="block text-[11.5px] text-muted-foreground">{stage.conversion}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                <span>A largura de cada barra é a proporção real sobre quem recebeu.</span>
                <span>Barra pequena não é defeito do gráfico: é o tamanho da etapa.</span>
              </div>

              {funnel.aside.length > 0 && (
                <div className="mt-3.5 border-t border-border/60 pt-3">
                  <div className="mb-2 text-xs text-muted-foreground">
                    Fora do funil: contagens do período, sem ligação com quem recebeu campanha.
                  </div>
                  <dl className="flex flex-wrap gap-x-8 gap-y-2">
                    {funnel.aside.map((item) => (
                      <div key={item.label} className="flex items-baseline gap-2">
                        <dd className={`${BIG_NUMBER} text-lg text-foreground`}>{formatMetricNumber(item.value)}</dd>
                        <dt className="text-[12.5px] text-muted-foreground">{item.label}</dt>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </>
          )}
        </div>

        {funnel.hasData && selection && (
          <aside
            aria-label="Etapa selecionada"
            className="flex min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-indigo-200 bg-card px-4 py-5 sm:px-6 dark:border-indigo-500/40"
          >
            <div>
              <div className="text-[11.5px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">Etapa selecionada</div>
              <h3 className="mt-1 text-lg font-bold text-foreground">{selection.label}</h3>
            </div>
            <div className="flex items-baseline gap-2.5">
              <span className={`${BIG_NUMBER} text-[40px] text-foreground`}>
                {selection.people !== null ? formatMetricNumber(selection.people) : "—"}
              </span>
              <span className="text-[13px] text-muted-foreground">{selection.people !== null ? "pessoas" : selection.emptyText}</span>
            </div>
            <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-[13px]">
              <strong className="text-foreground">{selection.delta}</strong>
              <span className="block text-xs text-muted-foreground">{selection.deltaNote}</span>
            </div>
            {selection.facts.length > 0 && (
              <div>
                <div className={`${EYEBROW} mb-1.5`}>O que explica</div>
                <ul className="flex flex-col gap-1.5">
                  {selection.facts.map((fact) => (
                    <li key={fact} className="flex items-start gap-2 text-[13px] leading-snug text-foreground/90">
                      <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-indigo-600" aria-hidden="true" />
                      <span>{fact}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        )}
      </section>

      {/* 3 · Três leituras de apoio */}
      <section aria-label="Leituras de apoio" className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        <div className={`${CARD} min-w-0 px-5 py-[18px]`}>
          <h2 className="text-[15px] font-bold text-foreground">Qual mensagem faz responder</h2>
          <p className="mb-3.5 mt-0.5 text-xs text-muted-foreground">De cada 100 pessoas que receberam, quantas responderam</p>
          {messages === null ? (
            <p className="text-[13px] text-muted-foreground">Não foi possível calcular agora.</p>
          ) : messages.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nenhuma campanha com envios suficientes neste período.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((m) => (
                <div key={m.id}>
                  <div className="mb-1 flex justify-between gap-2.5 text-[13px]">
                    <span className="truncate font-semibold text-foreground">{m.name}</span>
                    <span className="flex-none font-bold tabular-nums text-foreground">{m.per100}</span>
                  </div>
                  <div className="h-2.5 rounded-md bg-muted">
                    <div className="h-full rounded-md bg-indigo-600" style={{ width: `${Math.min(100, m.per100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`${CARD} min-w-0 px-5 py-[18px]`}>
          <h2 className="text-[15px] font-bold text-foreground">Quanto cada chip já usou hoje</h2>
          <p className="mb-3.5 mt-0.5 text-xs text-muted-foreground">Envios de campanha e follow-up de hoje sobre a cota diária do chip</p>
          {chips === null ? (
            <p className="text-[13px] text-muted-foreground">Não foi possível calcular agora.</p>
          ) : chips.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nenhum chip ativo cadastrado.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {chips.map((c) => (
                <div key={c.name}>
                  <div className="mb-1 flex justify-between gap-2.5 text-[13px]">
                    <span className="truncate font-semibold text-foreground">{c.name}</span>
                    <span className={`flex-none font-bold tabular-nums ${c.attention ? "text-orange-700 dark:text-orange-300" : "text-foreground"}`}>
                      {c.text}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-md bg-muted">
                    <div className={`h-full rounded-md ${c.attention ? "bg-orange-500" : "bg-indigo-600"}`} style={{ width: `${c.widthPct}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-[11.5px] text-muted-foreground">Laranja = acima de 80% da cota.</p>
            </div>
          )}
        </div>

        <div className={`${CARD} min-w-0 px-5 py-[18px] md:col-span-2 xl:col-span-1`}>
          <h2 className="text-[15px] font-bold text-foreground">
            {overview?.base ? `Como está a base de ${formatMetricNumber(overview.base.total)} leads` : "Como está a base"}
          </h2>
          <p className="mb-3.5 mt-0.5 text-xs text-muted-foreground">Cada lead em uma situação só</p>
          {slices === null || !overview?.base ? (
            <p className="text-[13px] text-muted-foreground">Não foi possível calcular agora.</p>
          ) : overview.base.total === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nenhum lead na base ainda.</p>
          ) : (
            <>
              <div className="mb-3.5 flex h-3.5 overflow-hidden rounded-md bg-muted" role="img" aria-label="Divisão da base por situação">
                {slices
                  .filter((s) => s.value > 0)
                  .map((s) => (
                    <span key={s.key} className={`block h-full ${SLICE_COLOR[s.key]}`} style={{ width: `${s.widthPct}%` }} />
                  ))}
              </div>
              <dl className="flex flex-col gap-1.5">
                {slices.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-3 text-[13px]">
                    <dt className="flex min-w-0 items-center gap-2 text-foreground">
                      <span className={`h-2.5 w-2.5 flex-none rounded-sm ${SLICE_COLOR[s.key]}`} aria-hidden="true" />
                      <span className="truncate">{s.label}</span>
                    </dt>
                    <dd className="flex-none font-bold tabular-nums text-foreground">{formatMetricNumber(s.value)}</dd>
                  </div>
                ))}
              </dl>
              {!overview.base.slicesAddUp && (
                <p className="mt-2 text-[11.5px] text-orange-700 dark:text-orange-300">As fatias não somaram a base nesta leitura. Atualize o painel.</p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
