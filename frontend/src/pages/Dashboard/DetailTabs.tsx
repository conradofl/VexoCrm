import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { DashboardPayload } from "@/hooks/useDashboard";
import { formatMetricNumber } from "@/lib/dashboard/formatters";
import { buildBaseSlices, buildCountedNote, buildNeverApproachedCard, type BaseSliceKey } from "@/lib/dashboard/overview";
import {
  CONVERSATIONS_PATH,
  buildCampaignRows,
  buildChipRows,
  buildFailureView,
  buildQueueView,
  buildRegionRows,
  buildResponseTimeCard,
  buildWaitHistogram,
} from "@/lib/dashboard/tabs";

// Abas de detalhe do Dashboard. Mesma linguagem da Visão geral: laranja é o único tom de atenção.

const CARD = "rounded-2xl border border-border bg-card";
const BIG_NUMBER = "font-bold leading-none tracking-tight tabular-nums";
const LABEL = "text-[13px] font-semibold text-muted-foreground";
const NOTE = "text-[12.5px] text-muted-foreground";
const UNAVAILABLE = "Não foi possível calcular agora.";
const TH = "px-3 py-2 text-left text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground";
const TD = "px-3 py-2.5 text-[13px] text-foreground";

const SLICE_COLOR: Record<BaseSliceKey, string> = {
  inConversation: "bg-indigo-600",
  noReply: "bg-indigo-400",
  neverApproached: "bg-indigo-200 dark:bg-indigo-300",
  closedNoApproach: "bg-slate-400",
  invalidPhone: "bg-slate-300 dark:bg-slate-600",
};

interface TabProps {
  data: DashboardPayload;
  periodLabel: string;
}

function Unavailable({ title }: { title: string }) {
  return (
    <div className={`${CARD} px-5 py-[18px]`}>
      <div className={LABEL}>{title}</div>
      <div className={`${BIG_NUMBER} mt-1.5 text-[34px] text-muted-foreground/60`} aria-hidden="true">
        —
      </div>
      <p className={`${NOTE} mt-2`}>{UNAVAILABLE}</p>
    </div>
  );
}

// ── Atendimento ──────────────────────────────────────────────────────────

export function AttendanceTab({ data, periodLabel }: TabProps) {
  const overview = data.overview;
  const response = useMemo(() => buildResponseTimeCard(overview?.firstHumanResponse), [overview?.firstHumanResponse]);
  const histogram = useMemo(() => buildWaitHistogram(overview?.firstHumanResponse), [overview?.firstHumanResponse]);
  const queue = useMemo(() => buildQueueView(overview?.queue), [overview?.queue]);

  return (
    <div className="flex flex-col gap-5" data-testid="tab-attendance">
      <section aria-label="Indicadores de atendimento" className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {/* Tempo até a 1ª resposta de uma pessoa */}
        {response.state === "unavailable" ? (
          <Unavailable title="Tempo até a 1ª resposta de uma pessoa" />
        ) : (
          <div className={`${CARD} px-5 py-[18px]`} data-testid="card-response-time">
            <div className={LABEL}>Tempo até a 1ª resposta de uma pessoa</div>
            {response.state === "ready" ? (
              <>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className={`${BIG_NUMBER} text-[38px] text-foreground`}>{response.value}</span>
                  <span className="text-[15px] font-semibold text-muted-foreground">{response.unit}</span>
                </div>
                {response.p90 && <p className="mt-3 text-[13px] text-foreground/90">{response.p90}</p>}
                <p className={`${NOTE} mt-1.5`}>
                  {response.coverage} {periodLabel}.
                </p>
                {response.partial && (
                  <p className="mt-1.5 text-[12.5px] font-medium text-orange-800 dark:text-orange-300">
                    Parte das conversas não diz quem respondeu. O tempo vale só para as medidas.
                  </p>
                )}
              </>
            ) : (
              <>
                <div className={`${BIG_NUMBER} mt-1.5 text-[38px] text-muted-foreground/60`} aria-hidden="true">
                  —
                </div>
                <p className={`${NOTE} mt-3`}>{response.note}</p>
              </>
            )}
          </div>
        )}

        {/* Esperando resposta agora: a fila da tela Conversas */}
        {!queue ? (
          <Unavailable title="Esperando resposta agora" />
        ) : (
          <div
            className={
              queue.waiting > 0
                ? "rounded-2xl border border-orange-300 bg-orange-50 px-5 py-[18px] dark:border-orange-500/40 dark:bg-orange-500/10"
                : `${CARD} px-5 py-[18px]`
            }
            data-testid="card-queue-waiting"
          >
            <div className={queue.waiting > 0 ? "text-[13px] font-semibold text-orange-900 dark:text-orange-200" : LABEL}>
              Esperando resposta agora
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className={`${BIG_NUMBER} text-[38px] ${queue.waiting > 0 ? "text-orange-800 dark:text-orange-200" : "text-foreground"}`}>
                {formatMetricNumber(queue.waiting)}
              </span>
              <span className={`text-[15px] font-semibold ${queue.waiting > 0 ? "text-orange-900 dark:text-orange-200" : "text-muted-foreground"}`}>
                {queue.waiting === 1 ? "pessoa" : "pessoas"}
              </span>
            </div>
            <p className={`mt-3 text-[12.5px] ${queue.waiting > 0 ? "text-orange-900 dark:text-orange-200" : "text-muted-foreground"}`}>{queue.detail}</p>
            <p className={`mt-1.5 text-xs ${queue.waiting > 0 ? "text-orange-900/90 dark:text-orange-200/90" : "text-muted-foreground"}`}>
              Só conta quem o robô não está atendendo.
            </p>
          </div>
        )}

        {/* A fila inteira, nos quatro estados da tela Conversas */}
        {queue && (
          <div className={`${CARD} px-5 py-[18px] md:col-span-2 xl:col-span-1`} data-testid="card-queue-states">
            <div className={LABEL}>Como está a fila de Conversas agora</div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              {queue.states.map((state) => (
                <div key={state.label}>
                  <dd className={`${BIG_NUMBER} text-2xl text-foreground`}>{formatMetricNumber(state.value)}</dd>
                  <dt className="mt-1 text-[12.5px] text-muted-foreground">{state.label}</dt>
                </div>
              ))}
            </dl>
            <p className={`${NOTE} mt-3`}>Os mesmos números das abas da tela Conversas.</p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3.5 lg:flex-row lg:items-stretch">
        {/* Quanto tempo as pessoas esperaram */}
        {histogram && (
          <div className={`${CARD} min-w-0 flex-1 px-5 py-5`} data-testid="card-wait-histogram">
            <h2 className="text-base font-bold text-foreground">Quanto tempo as pessoas esperaram</h2>
            <p className={`${NOTE} mb-4 mt-0.5`}>
              {histogram.total === 0
                ? "Nenhuma conversa foi respondida por uma pessoa neste período."
                : `${formatMetricNumber(histogram.total)} ${histogram.total === 1 ? "conversa respondida" : "conversas respondidas"} por gente, por faixa de espera`}
            </p>
            {histogram.total > 0 && (
              <>
                <div className="grid h-[200px] grid-cols-4 items-end gap-3 border-b border-border">
                  {histogram.buckets.map((bucket) => (
                    <div key={bucket.key} className="flex h-full flex-col items-center justify-end gap-1.5">
                      <span className={`text-sm font-bold tabular-nums ${bucket.attention ? "text-orange-800 dark:text-orange-300" : "text-foreground"}`}>
                        {formatMetricNumber(bucket.value)}
                      </span>
                      <div
                        className={`w-full max-w-[72px] rounded-t-md ${bucket.attention ? "bg-orange-500" : "bg-indigo-600"}`}
                        style={{ height: `${Math.max(bucket.value > 0 ? 2 : 0, bucket.heightPct * 0.85)}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-4 gap-3 text-center text-[12px] text-muted-foreground">
                  {histogram.buckets.map((bucket) => (
                    <span key={bucket.key} className={bucket.attention ? "font-bold text-orange-800 dark:text-orange-300" : undefined}>
                      {bucket.label}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Quem espera há mais tempo */}
        {queue && (
          <div className={`${CARD} flex min-w-0 flex-1 flex-col px-5 py-5`} data-testid="card-queue-oldest">
            <h2 className="text-base font-bold text-foreground">Quem espera há mais tempo</h2>
            {queue.waiting === 0 ? (
              <p className={`${NOTE} mt-0.5`}>Ninguém esperando resposta agora.</p>
            ) : (
              <>
                <p className={`${NOTE} mb-3 mt-0.5`}>
                  {queue.oldest.length < queue.waiting
                    ? `As ${queue.oldest.length} mais antigas das ${formatMetricNumber(queue.waiting)}`
                    : queue.waiting === 1
                    ? "A única conversa esperando"
                    : `As ${formatMetricNumber(queue.waiting)} conversas esperando`}{" "}
                  · toque para abrir a conversa
                </p>
                <ul className="flex flex-col">
                  {queue.oldest.map((row) => (
                    <li key={row.phone} className="border-b border-border/60 last:border-b-0">
                      <Link to={row.href} className="flex min-h-[48px] items-center gap-3 py-1 hover:bg-muted/40">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{row.name}</span>
                        {row.chip && <span className="max-w-[40%] flex-none truncate text-xs text-muted-foreground">chip {row.chip}</span>}
                        <span
                          className={`w-16 flex-none text-right text-[13.5px] font-bold tabular-nums ${
                            row.late ? "text-orange-800 dark:text-orange-300" : "text-foreground"
                          }`}
                        >
                          {row.waited ?? "—"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <span className="flex-1" />
                <Link
                  to={CONVERSATIONS_PATH}
                  className="mt-3.5 flex min-h-[44px] items-center justify-center rounded-[10px] bg-indigo-600 px-4 text-[13.5px] font-bold text-white hover:bg-indigo-700"
                >
                  {queue.waiting === 1 ? "Abrir a conversa em Conversas" : `Abrir as ${formatMetricNumber(queue.waiting)} em Conversas`}
                </Link>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Campanhas ────────────────────────────────────────────────────────────

export function CampaignsTab({ data, periodLabel }: TabProps) {
  const overview = data.overview;
  const rows = useMemo(() => buildCampaignRows(overview?.campaigns), [overview?.campaigns]);
  const failures = useMemo(
    () => buildFailureView(data.rankings.failureReasons, data.rankings.failureTotals),
    [data.rankings.failureReasons, data.rankings.failureTotals]
  );
  const sent = data.summary.sent;
  const received = overview?.funnel.received ?? null;
  const replied = data.summary.replied;

  const numbers: Array<{ label: string; value: number | null; note: string }> = [
    { label: "Mensagens enviadas", value: sent ? sent.current : null, note: sent ? "Envios de campanha confirmados" : UNAVAILABLE },
    { label: "Pessoas que receberam", value: received ? received.current : null, note: received ? "Cada telefone conta uma vez" : UNAVAILABLE },
    {
      label: "Pessoas que responderam",
      value: replied ? replied.current : null,
      note: replied ? (replied.rate === null || replied.rate === undefined ? "Em até 14 dias depois do envio" : `${String(replied.rate).replace(".", ",")} de cada 100 que receberam, em até 14 dias`) : UNAVAILABLE,
    },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="tab-campaigns">
      <section aria-label="Números de campanha" className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        {numbers.map((item) => (
          <div key={item.label} className={`${CARD} px-5 py-[18px]`}>
            <div className={LABEL}>{item.label}</div>
            <div className={`${BIG_NUMBER} mt-1.5 text-[34px] ${item.value === null ? "text-muted-foreground/60" : "text-foreground"}`}>
              {item.value === null ? "—" : formatMetricNumber(item.value)}
            </div>
            <p className={`${NOTE} mt-2`}>{item.note}</p>
          </div>
        ))}
      </section>

      {overview?.campaigns !== undefined && (
        <section className={`${CARD} px-5 py-5`} data-testid="card-campaigns">
          <h2 className="text-base font-bold text-foreground">Campanha por campanha</h2>
          <p className={`${NOTE} mb-3.5 mt-0.5`}>{periodLabel} · só campanhas com 30 envios ou mais · contando pessoas, não mensagens</p>
          {rows === null ? (
            <p className={NOTE}>{UNAVAILABLE}</p>
          ) : rows.length === 0 ? (
            <p className={NOTE}>Nenhuma campanha com envios suficientes neste período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className={TH}>Campanha</th>
                    <th className={`${TH} text-right`}>Envios</th>
                    <th className={`${TH} text-right`}>Responderam</th>
                    <th className={`${TH} w-[34%]`}>De cada 100</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/60 last:border-b-0">
                      <td className={`${TD} max-w-[260px] truncate font-semibold`}>{row.name}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMetricNumber(row.sent)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMetricNumber(row.replied)}</td>
                      <td className={TD}>
                        <div className="flex items-center gap-2.5">
                          <div className="h-2.5 flex-1 rounded-md bg-muted">
                            <div className="h-full rounded-md bg-indigo-600" style={{ width: `${row.widthPct}%` }} />
                          </div>
                          <span className="w-10 flex-none text-right font-bold tabular-nums">{row.per100}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className={`${CARD} px-5 py-5`} data-testid="card-failures">
        <h2 className="text-base font-bold text-foreground">Por que os envios falharam</h2>
        {failures === null ? (
          <p className={`${NOTE} mt-0.5`}>{UNAVAILABLE}</p>
        ) : (
          <>
            <p className={`${NOTE} mb-3.5 mt-0.5`}>{failures.total}</p>
            <div className="flex flex-col gap-3">
              {failures.rows.map((row) => (
                <div key={row.reason}>
                  <div className="mb-1 flex justify-between gap-2.5 text-[13px]">
                    <span className="min-w-0 truncate font-semibold text-foreground">{row.reason}</span>
                    <span className="flex-none font-bold tabular-nums text-foreground">
                      {formatMetricNumber(row.count)} · {row.pct}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-md bg-muted">
                    <div className="h-full rounded-md bg-indigo-600" style={{ width: `${row.widthPct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ── Base de leads ────────────────────────────────────────────────────────

export function BaseTab({ data, periodLabel }: TabProps) {
  const overview = data.overview;
  const base = overview?.base ?? null;
  const slices = useMemo(() => buildBaseSlices(base), [base]);
  const never = useMemo(() => buildNeverApproachedCard(base, data.lastUpdatedAt), [base, data.lastUpdatedAt]);
  const counted = useMemo(() => buildCountedNote(data.lastUpdatedAt), [data.lastUpdatedAt]);
  const regions = useMemo(() => buildRegionRows(overview?.regions), [overview?.regions]);

  return (
    <div className="flex flex-col gap-5" data-testid="tab-base">
      <section className={`${CARD} px-5 py-5`} data-testid="card-base-slices">
        <h2 className="text-base font-bold text-foreground">
          {base ? `Como está a base de ${formatMetricNumber(base.total)} leads` : "Como está a base"}
        </h2>
        <p className={`${NOTE} mb-4 mt-0.5`}>Cada lead em uma situação só{counted ? ` · ${counted}` : ""}</p>
        {!slices || !base ? (
          <p className={NOTE}>{UNAVAILABLE}</p>
        ) : base.total === 0 ? (
          <p className={NOTE}>Nenhum lead na base ainda.</p>
        ) : (
          <>
            <div className="mb-4 flex h-4 overflow-hidden rounded-md bg-muted" role="img" aria-label="Divisão da base por situação">
              {slices
                .filter((slice) => slice.value > 0)
                .map((slice) => (
                  <span key={slice.key} className={`block h-full ${SLICE_COLOR[slice.key]}`} style={{ width: `${slice.widthPct}%` }} />
                ))}
            </div>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              {slices.map((slice) => (
                <div key={slice.key} className="flex items-center justify-between gap-3 text-[13.5px]">
                  <dt className="flex min-w-0 items-center gap-2 text-foreground">
                    <span className={`h-2.5 w-2.5 flex-none rounded-sm ${SLICE_COLOR[slice.key]}`} aria-hidden="true" />
                    <span className="truncate">{slice.label}</span>
                  </dt>
                  <dd className="flex-none tabular-nums text-foreground">
                    <strong>{formatMetricNumber(slice.value)}</strong>
                    <span className="ml-2 text-muted-foreground">{String(Math.round(slice.widthPct * 10) / 10).replace(".", ",")}%</span>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>

      {never.kind === "neverApproached" && never.state === "ready" && (
        <section className={`${CARD} px-5 py-[18px]`} data-testid="card-base-reachable">
          <div className={LABEL}>Contatos que nunca receberam mensagem e podem receber</div>
          <div className={`${BIG_NUMBER} mt-1.5 text-[34px] text-foreground`}>{formatMetricNumber(never.value)}</div>
          <p className={`${NOTE} mt-2`}>{never.detail}</p>
          <p className={`${NOTE} mt-1`}>{never.optOutNote}</p>
        </section>
      )}

      {overview?.regions !== undefined && (
        <section className={`${CARD} px-5 py-5`} data-testid="card-regions">
          <h2 className="text-base font-bold text-foreground">Onde as pessoas respondem mais</h2>
          <p className={`${NOTE} mb-3.5 mt-0.5`}>{periodLabel} · por DDD e cidade de quem recebeu campanha</p>
          {regions === null ? (
            <p className={NOTE}>{UNAVAILABLE}</p>
          ) : regions.length === 0 ? (
            <p className={NOTE}>Nenhuma região com envios suficientes neste período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className={TH}>Região</th>
                    <th className={`${TH} text-right`}>Envios</th>
                    <th className={`${TH} text-right`}>Responderam</th>
                    <th className={`${TH} text-right`}>De cada 100</th>
                  </tr>
                </thead>
                <tbody>
                  {regions.map((row) => (
                    <tr key={row.id} className="border-b border-border/60 last:border-b-0">
                      <td className={`${TD} max-w-[240px] truncate font-semibold`}>{row.label}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMetricNumber(row.sent)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMetricNumber(row.replied)}</td>
                      <td className={`${TD} text-right font-bold tabular-nums`}>{row.per100}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── Chips ────────────────────────────────────────────────────────────────

export function ChipsTab({ data, periodLabel }: TabProps) {
  const overview = data.overview;
  const quotaIsToday = overview?.chipsQuotaIsToday ?? false;
  const rows = useMemo(() => buildChipRows(overview?.chips, quotaIsToday), [overview?.chips, quotaIsToday]);
  const unattributed = data.rankings.chipsUnattributedSent;

  return (
    <div className="flex flex-col gap-5" data-testid="tab-chips">
      <section className={`${CARD} px-5 py-5`} data-testid="card-chips">
        <h2 className="text-base font-bold text-foreground">Chip por chip</h2>
        <p className={`${NOTE} mb-3.5 mt-0.5`}>
          {periodLabel} · envios e respostas pelo chip gravado em cada envio
          {quotaIsToday ? " · a cota é de hoje, só de campanha e follow-up" : " · a cota do dia só aparece quando o período inclui hoje"}
        </p>
        {rows === null ? (
          <p className={NOTE}>{UNAVAILABLE}</p>
        ) : rows.length === 0 ? (
          <p className={NOTE}>Nenhum chip ativo cadastrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className={TH}>Chip</th>
                  <th className={TH}>Estado</th>
                  <th className={`${TH} text-right`}>Envios</th>
                  <th className={`${TH} text-right`}>Responderam</th>
                  {quotaIsToday && <th className={`${TH} w-[30%]`}>Cota de hoje</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-b-0">
                    <td className={`${TD} max-w-[220px] truncate font-semibold`}>{row.name}</td>
                    <td className={TD}>{row.state || "—"}</td>
                    <td className={`${TD} text-right tabular-nums`}>{row.sent === null ? "—" : formatMetricNumber(row.sent)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{row.replied === null ? "—" : formatMetricNumber(row.replied)}</td>
                    {quotaIsToday && (
                      <td className={TD}>
                        {row.quotaText ? (
                          <div className="flex items-center gap-2.5">
                            <div className="h-2.5 flex-1 rounded-md bg-muted">
                              <div className={`h-full rounded-md ${row.attention ? "bg-orange-500" : "bg-indigo-600"}`} style={{ width: `${row.quotaWidthPct}%` }} />
                            </div>
                            <span className={`flex-none font-bold tabular-nums ${row.attention ? "text-orange-800 dark:text-orange-300" : ""}`}>{row.quotaText}</span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && rows.length > 0 && quotaIsToday && <p className={`${NOTE} mt-3`}>Laranja = acima de 80% da cota.</p>}
        {typeof unattributed === "number" && unattributed > 0 && (
          <p className={`${NOTE} mt-2`}>
            {formatMetricNumber(unattributed)} {unattributed === 1 ? "envio do período não tem" : "envios do período não têm"} chip registrado e{" "}
            {unattributed === 1 ? "não entra" : "não entram"} em nenhuma linha.
          </p>
        )}
      </section>
    </div>
  );
}
