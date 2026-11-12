// frontend/src/lib/dashboard/tabs.ts
//
// Abas de detalhe do Dashboard (Atendimento, Campanhas, Base de leads, Chips): o que cada bloco diz, em
// funções puras. Mesmas regras da Visão geral: bloco que falhou diz que não deu para calcular, nunca zero;
// bloco sem fonte não existe; frase só com número medido.

import type {
  FailureReasonItem,
  MessageRankingItem,
  OverviewChip,
  OverviewFirstHumanResponse,
  OverviewQueue,
  RegionRankingItem,
} from "@/hooks/useDashboard";
import { formatMetricNumber } from "./formatters";
import { CHIP_ALERT_PCT } from "./overview";

const n = formatMetricNumber;
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
const decimal = (value: number) => String(Math.round(value * 10) / 10).replace(".", ",");

// ── Tempo ────────────────────────────────────────────────────────────────

/** Duração curta, como se fala: "52 min", "4h10", "2 dias". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  if (hours < 48) return `${hours}h${String(total % 60).padStart(2, "0")}`;
  return `${Math.floor(hours / 24)} dias`;
}

/** Há quanto tempo a pessoa espera. null quando não dá para saber (sem data ou data inválida). */
export function waitingMinutes(since: string | null | undefined, now: Date): number | null {
  if (!since) return null;
  const at = new Date(since).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, (now.getTime() - at) / 60000);
}

// ── Atendimento: tempo até a primeira resposta de uma pessoa ─────────────

export type ResponseTimeCard =
  | { state: "unavailable" }
  | { state: "empty"; note: string }
  | { state: "insufficient"; note: string }
  | { state: "ready"; value: string; unit: string; p90: string; coverage: string; partial: boolean };

export function buildResponseTimeCard(r: OverviewFirstHumanResponse | null | undefined): ResponseTimeCard {
  if (!r) return { state: "unavailable" };
  if (r.conversations === 0) return { state: "empty", note: "Nenhuma conversa começou neste período." };
  const coverage = `Medido em ${n(r.measured)} de ${n(r.conversations)} conversas.`;
  // Abaixo do corte, mediana de poucas conversas engana: o cartão diz a cobertura e não mostra tempo.
  if (r.coverageLevel === "insufficient" || r.coverageLevel === "none") {
    return { state: "insufficient", note: `${coverage} É pouco para dizer um tempo.` };
  }
  if (r.medianMinutes === null) return { state: "empty", note: `${coverage} Nenhuma foi respondida por uma pessoa ainda.` };
  const median = formatDuration(r.medianMinutes);
  const [value, unit] = median.endsWith(" min") ? [median.replace(" min", ""), "min (mediana)"] : [median, "(mediana)"];
  return {
    state: "ready",
    value,
    unit,
    p90: r.p90Minutes === null ? "" : `9 em cada 10 foram respondidas em até ${formatDuration(r.p90Minutes)}.`,
    coverage,
    partial: r.coverageLevel === "partial",
  };
}

// ── Atendimento: quanto tempo as pessoas esperaram ───────────────────────

export interface WaitBucket {
  key: "upTo10m" | "upTo30m" | "upTo2h" | "over2h";
  label: string;
  value: number;
  heightPct: number;
  attention: boolean;
}

const BUCKETS: Array<{ key: WaitBucket["key"]; label: string }> = [
  { key: "upTo10m", label: "até 10 min" },
  { key: "upTo30m", label: "10 a 30 min" },
  { key: "upTo2h", label: "30 min a 2h" },
  { key: "over2h", label: "mais de 2h" },
];

/** null = sem a distribuição (bloco indisponível ou payload antigo). Altura sempre a partir do zero. */
export function buildWaitHistogram(r: OverviewFirstHumanResponse | null | undefined): { total: number; buckets: WaitBucket[] } | null {
  if (!r?.waitBuckets) return null;
  const max = Math.max(...BUCKETS.map((b) => r.waitBuckets![b.key]));
  return {
    total: r.answered,
    buckets: BUCKETS.map(({ key, label }) => {
      const value = r.waitBuckets![key];
      return { key, label, value, heightPct: max > 0 ? (value / max) * 100 : 0, attention: key === "over2h" && value > 0 };
    }),
  };
}

// ── Atendimento: a fila da tela Conversas ────────────────────────────────

export interface QueueRow {
  phone: string;
  name: string;
  chip: string | null;
  waited: string | null;
  late: boolean;
  href: string;
}

export interface QueueView {
  waiting: number;
  detail: string;
  states: Array<{ label: string; value: number }>;
  oldest: QueueRow[];
}

export const CONVERSATIONS_PATH = "/crm/whatsapp";

export function buildQueueView(queue: OverviewQueue | null | undefined, now: Date = new Date()): QueueView | null {
  if (!queue) return null;
  const oldest = queue.oldest.map((item) => {
    const minutes = waitingMinutes(item.waitingSince, now);
    return {
      phone: item.phone,
      // Sem nome gravado, o telefone é o que identifica a conversa.
      name: item.name?.trim() || item.phone,
      chip: item.chip,
      waited: minutes === null ? null : formatDuration(minutes),
      late: minutes !== null && minutes > queue.thresholdHours * 60,
      href: `${CONVERSATIONS_PATH}?phone=${encodeURIComponent(item.phone)}`,
    };
  });
  const over = queue.waitingOverThreshold;
  const parts: string[] = [];
  if (queue.states.waiting === 0) parts.push("Ninguém esperando resposta agora.");
  else {
    parts.push(over === 0 ? `Nenhuma há mais de ${queue.thresholdHours} horas` : `${n(over)} há mais de ${queue.thresholdHours} horas`);
    if (oldest[0]?.waited) parts.push(`a mais antiga há ${oldest[0].waited}`);
  }
  return {
    waiting: queue.states.waiting,
    detail: parts.join(" · "),
    states: [
      { label: "Esperam você", value: queue.states.waiting },
      { label: "Com o lead", value: queue.states.withLead },
      { label: "Com o robô", value: queue.states.withRobot },
      { label: "Esfriaram", value: queue.states.cooled },
    ],
    oldest,
  };
}

// ── Campanhas ────────────────────────────────────────────────────────────

export interface CampaignRow {
  id: string;
  name: string;
  sent: number;
  replied: number;
  per100: string;
  widthPct: number;
}

/** Linha por campanha, na ordem que o servidor mandou (da que mais faz responder para a que menos faz). */
export function buildCampaignRows(campaigns: MessageRankingItem[] | null | undefined): CampaignRow[] | null {
  if (!campaigns) return null;
  return campaigns.map((c, index) => ({
    id: `${c.campaign_id}-${index}`,
    name: c.campaign_name || "Campanha sem nome",
    sent: c.sent_count,
    replied: c.replied_count,
    per100: decimal(c.reply_rate),
    widthPct: Math.min(100, Math.max(0, c.reply_rate)),
  }));
}

export interface FailureView {
  total: string;
  rows: Array<{ reason: string; count: number; pct: string; widthPct: number }>;
}

export function buildFailureView(
  reasons: FailureReasonItem[] | null | undefined,
  totals: { occurrences: number; distinctNumbers: number } | null | undefined,
): FailureView | null {
  if (!reasons) return null;
  const occurrences = totals?.occurrences ?? reasons.reduce((sum, r) => sum + r.count, 0);
  return {
    total:
      occurrences === 0
        ? "Nenhum envio falhou neste período."
        : totals
        ? `${n(occurrences)} ${plural(occurrences, "envio falhou", "envios falharam")}, em ${n(totals.distinctNumbers)} ${plural(totals.distinctNumbers, "número", "números")}.`
        : `${n(occurrences)} ${plural(occurrences, "envio falhou", "envios falharam")}.`,
    rows: reasons.map((r) => ({ reason: r.reason, count: r.count, pct: `${decimal(r.percentage)}%`, widthPct: Math.min(100, Math.max(0, r.percentage)) })),
  };
}

// ── Base de leads ────────────────────────────────────────────────────────

export interface RegionRow {
  id: string;
  label: string;
  sent: number;
  replied: number;
  per100: string;
}

export function buildRegionRows(regions: RegionRankingItem[] | null | undefined): RegionRow[] | null {
  if (!regions) return null;
  return regions.map((r, index) => ({ id: `${r.label}-${index}`, label: r.label, sent: r.sent, replied: r.replies, per100: decimal(r.replyRate) }));
}

// ── Chips ────────────────────────────────────────────────────────────────

const CHIP_STATE_LABEL: Record<string, string> = { cold: "Frio", warming: "Aquecendo", warm: "Aquecido", hot: "Aquecido" };

export interface ChipRow {
  id: string;
  name: string;
  state: string;
  sent: number | null;
  replied: number | null;
  quotaText: string | null;
  quotaWidthPct: number;
  attention: boolean;
}

/** Uma linha por chip ativo. A cota só aparece quando o período inclui hoje: ela é do dia. */
export function buildChipRows(chips: OverviewChip[] | null | undefined, quotaIsToday: boolean): ChipRow[] | null {
  if (!chips) return null;
  return [...chips]
    .sort((a, b) => (b.sent ?? 0) - (a.sent ?? 0) || a.name.localeCompare(b.name))
    .map((c) => {
      const hasQuota = quotaIsToday && c.quotaLimit > 0;
      return {
        id: c.instanceId,
        name: c.name,
        state: c.chipState ? CHIP_STATE_LABEL[c.chipState] ?? c.chipState : "",
        sent: c.sent ?? null,
        replied: c.replies ?? null,
        quotaText: hasQuota ? `${n(c.sentToday)} de ${n(c.quotaLimit)}` : null,
        quotaWidthPct: hasQuota ? Math.min(100, Math.max(0, c.quotaPercentage)) : 0,
        attention: hasQuota && c.quotaPercentage >= CHIP_ALERT_PCT,
      };
    });
}
