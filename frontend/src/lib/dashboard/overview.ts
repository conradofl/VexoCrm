// frontend/src/lib/dashboard/overview.ts
//
// Visão geral do Dashboard: o que cada bloco DIZ, separado de como ele é desenhado.
// Regras que valem para todo texto daqui:
//  - sem registro não é zero; indisponível não é zero;
//  - comparação sem base diz "sem base de comparação";
//  - frase sem fonte não aparece (nada de meta inventada, nada de "nenhuma duplicata").

import type {
  DashboardPayload,
  MessageRankingItem,
  OverviewBase,
  OverviewChip,
  OverviewMeetings,
  OverviewWaiting,
} from "@/hooks/useDashboard";
import { describePreviousPeriod, formatMetricNumber, type DashboardPeriodInfo } from "@/lib/dashboard/formatters";

const n = formatMetricNumber;
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

// ── Pede ação agora ──────────────────────────────────────────────────────

export const CHIP_ALERT_PCT = 80;

export type ActionCard =
  | { kind: "waiting"; state: "pending" }
  | { kind: "waiting"; state: "ready"; value: number; detail: string; attention: boolean; href: string; cta: string }
  | { kind: "neverApproached"; state: "unavailable" }
  | { kind: "neverApproached"; state: "ready"; value: number; detail: string; optOutNote: string }
  | { kind: "chip"; state: "ready"; value: number; limit: number; chipName: string; detail: string; href: string; cta: string };

export function buildWaitingCard(waiting: OverviewWaiting | null | undefined): ActionCard {
  // Bloco que falhou e bloco que ainda não tem fonte mostram o mesmo lugar reservado: nenhum número.
  if (!waiting || waiting.status !== "ready") return { kind: "waiting", state: "pending" };
  const over = waiting.waitingOverThreshold;
  const detail =
    waiting.waiting === 0
      ? "Ninguém esperando resposta agora."
      : over === null
      ? "O lead falou por último e ninguém respondeu."
      : over === 0
      ? `Nenhuma há mais de ${waiting.thresholdHours} horas.`
      : `${n(over)} ${plural(over, "delas", "delas")} há mais de ${waiting.thresholdHours} horas.`;
  return {
    kind: "waiting",
    state: "ready",
    value: waiting.waiting,
    detail,
    attention: waiting.waiting > 0,
    href: "/crm/whatsapp",
    cta: "Abrir a fila de quem espera",
  };
}

export function buildNeverApproachedCard(base: OverviewBase | null | undefined): ActionCard {
  if (!base) return { kind: "neverApproached", state: "unavailable" };
  const na = base.neverApproached;
  const share = na.shareOfBasePct === null ? "" : ` ${String(na.shareOfBasePct).replace(".", ",")}% da base.`;
  const detail = `Têm telefone válido e nenhuma mensagem enviada.${share}`;
  // A frase sai do que existe gravado. Sem nenhum opt-out na empresa, o cartão não afirma que descontou alguém.
  const optOutNote = !na.optOutRecorded
    ? "Opt-out não é registrado nesta empresa."
    : na.optOutDiscounted > 0
    ? `Já sem ${n(na.optOutDiscounted)} que ${plural(na.optOutDiscounted, "pediu", "pediram")} para sair.`
    : "Nenhum deles pediu para sair.";
  return { kind: "neverApproached", state: "ready", value: na.reachable, detail, optOutNote };
}

/** O chip mais perto da cota, se algum passou de 80%. Sem chip acima do limite, o cartão não existe. */
export function buildChipAlertCard(chips: OverviewChip[] | null | undefined, quotaIsToday: boolean): ActionCard | null {
  if (!chips || !quotaIsToday) return null;
  const hot = chips
    .filter((c) => c.quotaLimit > 0 && c.quotaPercentage >= CHIP_ALERT_PCT)
    .sort((a, b) => b.quotaPercentage - a.quotaPercentage)[0];
  if (!hot) return null;
  const left = hot.quotaLimit - hot.sentToday;
  return {
    kind: "chip",
    state: "ready",
    value: hot.sentToday,
    limit: hot.quotaLimit,
    chipName: hot.name,
    detail: left > 0 ? `${plural(left, "Falta", "Faltam")} ${n(left)} para a cota de hoje.` : "A cota de hoje acabou.",
    href: "/crm/chips-whatsapp",
    cta: "Ver os chips",
  };
}

// ── Funil ────────────────────────────────────────────────────────────────

export type FunnelStageKey = "received" | "replied" | "meetings";

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  // null = não dá para mostrar número (sem registro ou indisponível); `emptyText` diz qual dos dois.
  people: number | null;
  emptyText: string | null;
  // Largura da barra, em % de quem recebeu. null = sem barra.
  widthPct: number | null;
  conversion: string;
}

export interface FunnelSelection {
  label: string;
  people: number | null;
  emptyText: string | null;
  delta: string;
  deltaNote: string;
  facts: string[];
}

export interface FunnelAside {
  label: string;
  value: number;
}

export interface FunnelView {
  // false = nenhuma pessoa recebeu campanha no período (ou o bloco caiu): não há funil para desenhar.
  hasData: boolean;
  emptyText: string | null;
  stages: FunnelStage[];
  aside: FunnelAside[];
}

const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export function buildFunnel(data: DashboardPayload): FunnelView {
  const f = data.overview?.funnel;
  const received = f?.received?.current ?? null;
  const replied = f?.replied?.current ?? null;
  const meetings = f?.meetings ?? null;

  if (received === null) return { hasData: false, emptyText: "Não foi possível calcular o funil agora.", stages: [], aside: [] };
  if (received === 0) return { hasData: false, emptyText: "Nenhuma pessoa recebeu campanha neste período.", stages: [], aside: [] };

  const stages: FunnelStage[] = [
    { key: "received", label: "Receberam", people: received, emptyText: null, widthPct: 100, conversion: "ponto de partida" },
    {
      key: "replied",
      label: "Responderam",
      people: replied,
      emptyText: replied === null ? "indisponível" : null,
      widthPct: replied === null ? null : pctOf(replied, received),
      conversion: replied === null ? "" : `${Math.round((replied / received) * 100)}% de quem recebeu`,
    },
    meetingsStage(meetings, replied, received),
  ];

  // Proposta e fechamento contam eventos do período, não gente que veio da etapa anterior: ficam fora das
  // barras, como contagem à parte, até existir vínculo por telefone e data de assinatura.
  const aside: FunnelAside[] = [];
  if (data.hasProposalsAndContracts && data.summary.proposals) aside.push({ label: "Propostas criadas", value: data.summary.proposals.current });
  if (data.hasProposalsAndContracts && data.summary.contracts) aside.push({ label: "Contratos fechados", value: data.summary.contracts.current });
  if (data.summary.closings) aside.push({ label: "Fechamentos", value: data.summary.closings.current });

  return { hasData: true, emptyText: null, stages, aside };
}

function meetingsStage(meetings: OverviewMeetings | null, replied: number | null, received: number): FunnelStage {
  const base = { key: "meetings" as const, label: "Marcaram reunião" };
  if (!meetings) return { ...base, people: null, emptyText: "indisponível", widthPct: null, conversion: "" };
  if (!meetings.hasRecords || meetings.current === null) {
    return { ...base, people: null, emptyText: "sem registro", widthPct: null, conversion: "esta empresa ainda não registra reunião" };
  }
  return {
    ...base,
    people: meetings.current,
    emptyText: null,
    widthPct: pctOf(meetings.current, received),
    conversion: replied && replied > 0 ? `${Math.round((meetings.current / replied) * 100)}% de quem respondeu` : "",
  };
}

function peopleDelta(current: number | null, previous: number | null, info?: DashboardPeriodInfo | null): { delta: string; deltaNote: string } {
  const against = describePreviousPeriod(info);
  if (current === null || previous === null) return { delta: "Sem comparação", deltaNote: "não foi possível calcular o período anterior" };
  if (previous === 0) return { delta: "Sem base de comparação", deltaNote: `nenhuma pessoa ${against}` };
  const diff = current - previous;
  const note = `${n(current)} agora, ${n(previous)} ${against}`;
  if (diff === 0) return { delta: "Igual ao período anterior", deltaNote: note };
  const abs = Math.abs(diff);
  return {
    delta: `${diff > 0 ? "▲" : "▼"} ${n(abs)} ${plural(abs, "pessoa", "pessoas")} ${diff > 0 ? "a mais" : "a menos"}`,
    deltaNote: note,
  };
}

function rankingFacts(messages: MessageRankingItem[] | null | undefined, overallRate: number | null): string[] {
  if (!messages || messages.length < 2 || overallRate === null) return [];
  const sorted = [...messages].sort((a, b) => b.reply_rate - a.reply_rate);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const facts: string[] = [];
  if (best.reply_rate > overallRate) {
    facts.push(`A campanha "${best.campaign_name}" é a que mais faz responder: ${Math.round(best.reply_rate)} de cada 100.`);
  }
  if (worst.campaign_id !== best.campaign_id && worst.reply_rate < overallRate) {
    facts.push(`A campanha "${worst.campaign_name}" puxa a média para baixo: ${Math.round(worst.reply_rate)} de cada 100.`);
  }
  return facts;
}

/** Painel da etapa clicada. Só entram frases com fonte pronta (spec, seção 8.3). */
export function buildFunnelSelection(data: DashboardPayload, funnel: FunnelView, key: FunnelStageKey): FunnelSelection | null {
  const stage = funnel.stages.find((s) => s.key === key);
  if (!stage) return null;
  const f = data.overview?.funnel;
  const info = data.periodInfo;
  const received = f?.received?.current ?? null;
  const replied = f?.replied?.current ?? null;
  const head = { label: stage.label, people: stage.people, emptyText: stage.emptyText };

  if (key === "received") {
    return { ...head, ...peopleDelta(received, f?.received?.previous ?? null, info), facts: [] };
  }

  if (key === "replied") {
    const rate = data.summary.replied?.rate ?? null;
    const prevRate = data.summary.replied?.previousRate ?? null;
    const prevReached = f?.received?.previous ?? null;
    let delta = "Sem comparação";
    let deltaNote = "não foi possível calcular o período anterior";
    if (rate !== null && prevRate !== null && prevReached !== null) {
      if (prevReached === 0) {
        delta = "Sem base de comparação";
        deltaNote = `nenhum envio ${describePreviousPeriod(info)}`;
      } else {
        const points = Math.round(rate - prevRate);
        delta =
          points === 0
            ? "Taxa de resposta igual à do período anterior"
            : `${points > 0 ? "▲" : "▼"} ${Math.abs(points)} ${plural(Math.abs(points), "ponto", "pontos")} na taxa de resposta`;
        deltaNote = `${Math.round(rate)}% agora, ${Math.round(prevRate)}% ${describePreviousPeriod(info)}`;
      }
    }
    const facts: string[] = [];
    if (received !== null && replied !== null && received > replied) {
      const silent = received - replied;
      facts.push(`${n(silent)} de ${n(received)} pessoas que receberam não responderam.`);
    }
    facts.push(...rankingFacts(data.rankings.messages, rate));
    return { ...head, delta, deltaNote, facts };
  }

  // Marcaram reunião
  const meetings = f?.meetings ?? null;
  if (!meetings || !meetings.hasRecords) {
    return {
      ...head,
      delta: meetings ? "Sem registro" : "Indisponível",
      deltaNote: meetings
        ? "Esta empresa ainda não registra reunião no sistema. Zero só aparece quando há registro e nenhum no período."
        : "Não foi possível calcular agora.",
      facts: [],
    };
  }
  const facts: string[] = [];
  if (replied !== null && meetings.current !== null && replied > meetings.current) {
    facts.push(`De ${n(replied)} que responderam, ${n(replied - meetings.current)} não chegaram a marcar.`);
  }
  const waiting = data.overview?.waiting;
  if (waiting?.status === "ready" && waiting.waiting > 0) {
    facts.push(`${n(waiting.waiting)} ${plural(waiting.waiting, "pessoa espera", "pessoas esperam")} resposta agora.`);
  }
  facts.push("Só entra aqui quem respondeu a campanha e marcou depois dela.");
  return { ...head, ...peopleDelta(meetings.current, meetings.previous, info), facts };
}

// ── Leituras de apoio ────────────────────────────────────────────────────

export interface ChipUsageRow {
  name: string;
  text: string;
  widthPct: number;
  attention: boolean;
}

export function buildChipUsage(chips: OverviewChip[] | null | undefined): ChipUsageRow[] | null {
  if (!chips) return null;
  return [...chips]
    .sort((a, b) => b.quotaPercentage - a.quotaPercentage || a.name.localeCompare(b.name))
    .map((c) => ({
      name: c.name,
      text: c.quotaLimit > 0 ? `${n(c.sentToday)} de ${n(c.quotaLimit)}` : n(c.sentToday),
      widthPct: c.quotaLimit > 0 ? Math.min(100, Math.max(0, c.quotaPercentage)) : 0,
      attention: c.quotaLimit > 0 && c.quotaPercentage >= CHIP_ALERT_PCT,
    }));
}

export type BaseSliceKey = "inConversation" | "noReply" | "neverApproached" | "closedNoApproach" | "invalidPhone";

export interface BaseSliceRow {
  key: BaseSliceKey;
  label: string;
  value: number;
  // Proporção real sobre a base. Fatia pequena fica pequena: a barra não mente.
  widthPct: number;
}

const BASE_SLICE_ORDER: { key: BaseSliceKey; label: string }[] = [
  { key: "inConversation", label: "Em conversa" },
  { key: "noReply", label: "Sem resposta" },
  { key: "neverApproached", label: "Nunca abordados" },
  { key: "closedNoApproach", label: "Encerrados sem abordagem" },
  { key: "invalidPhone", label: "Telefone inválido" },
];

export function buildBaseSlices(base: OverviewBase | null | undefined): BaseSliceRow[] | null {
  if (!base) return null;
  return BASE_SLICE_ORDER.map(({ key, label }) => ({
    key,
    label,
    value: base.slices[key],
    widthPct: base.total > 0 ? (base.slices[key] / base.total) * 100 : 0,
  }));
}

export interface MessageRow {
  id: string;
  name: string;
  per100: number;
}

export function buildMessageRows(messages: MessageRankingItem[] | null | undefined): MessageRow[] | null {
  if (!messages) return null;
  return [...messages]
    .sort((a, b) => b.reply_rate - a.reply_rate)
    .map((m) => ({ id: m.campaign_id, name: m.campaign_name, per100: Math.round(m.reply_rate) }));
}
