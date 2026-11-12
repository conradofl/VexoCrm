// frontend/src/lib/dashboard/plan.ts
//
// Plano de ação do Dashboard: do número à ação. O sistema traz o FATO e o número medido; dono e prazo quem
// decide é a pessoa. Nenhum achado nasce sem fonte, e nenhuma meta é inventada: a coluna "mede-se por" diz qual
// número do próprio Dashboard mostra se a ação funcionou.

import type { DashboardPayload } from "@/hooks/useDashboard";
import { formatMetricNumber } from "./formatters";
import { CHIP_ALERT_PCT } from "./overview";
import { formatDuration } from "./tabs";

const n = formatMetricNumber;
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
const decimal = (value: number) => String(Math.round(value * 10) / 10).replace(".", ",");

export type FindingKey = "waiting" | "neverApproached" | "chipQuota" | "weakCampaign";

export interface PlanFinding {
  key: FindingKey;
  // O fato, como aparece na lista da esquerda.
  title: string;
  detail: string;
  // A ação que o fato sugere, o número que a justifica e o número que mostra se deu certo.
  action: string;
  why: string;
  metric: string;
  // Achado que pede ação agora já vem marcado.
  checkedByDefault: boolean;
}

// "Responde pouco" = menos da metade da campanha que mais responde. É o único corte desta tela e está aqui,
// à vista: abaixo dele a diferença entre duas campanhas não vira achado.
export const WEAK_CAMPAIGN_RATIO = 0.5;

export function buildPlanFindings(data: DashboardPayload): PlanFinding[] {
  const overview = data.overview;
  if (!overview) return [];
  const findings: PlanFinding[] = [];

  // 1. Pessoas esperando resposta: o número da fila da tela Conversas.
  const waiting = overview.waiting?.status === "ready" ? overview.waiting : null;
  if (waiting && waiting.waiting > 0) {
    const over = waiting.waitingOverThreshold;
    const overText = over === null ? "" : over === 0 ? `nenhuma há mais de ${waiting.thresholdHours} horas` : `${n(over)} há mais de ${waiting.thresholdHours} horas`;
    const response = overview.firstHumanResponse;
    const median =
      response && response.medianMinutes !== null && (response.coverageLevel === "ok" || response.coverageLevel === "partial")
        ? ` A primeira resposta de uma pessoa leva ${formatDuration(response.medianMinutes)} (mediana).`
        : "";
    findings.push({
      key: "waiting",
      title: `${n(waiting.waiting)} ${plural(waiting.waiting, "pessoa espera", "pessoas esperam")} resposta`,
      detail: overText || "o lead falou por último e ninguém respondeu",
      action: `Responder ${plural(waiting.waiting, "a conversa que espera", `as ${n(waiting.waiting)} conversas que esperam`)} e manter a fila zerada`,
      why: `${n(waiting.waiting)} esperando${overText ? `, ${overText}` : ""}.${median}`,
      metric: "pessoas esperando resposta = 0",
      checkedByDefault: true,
    });
  }

  // 2. Contatos nunca abordados que podem receber mensagem.
  const never = overview.base?.neverApproached;
  if (never && never.reachable > 0) {
    const share = never.shareOfBasePct === null ? "" : `${decimal(never.shareOfBasePct)}% da base, `;
    const best = bestAndWorstCampaign(data)?.best;
    findings.push({
      key: "neverApproached",
      title: `${n(never.reachable)} ${plural(never.reachable, "contato nunca abordado", "contatos nunca abordados")}`,
      detail: `${share}telefone válido`,
      action: "Campanha de primeiro contato para quem nunca recebeu mensagem",
      why:
        `${n(never.reachable)} ${plural(never.reachable, "contato", "contatos")} com telefone válido e nenhuma mensagem enviada.` +
        (best ? ` Melhor mensagem do período: ${decimal(best.reply_rate)} respostas a cada 100.` : ""),
      metric: `nunca abordados abaixo de ${n(never.reachable)}`,
      checkedByDefault: true,
    });
  }

  // 3. Chip perto da cota de hoje (só quando o período inclui hoje: a cota é do dia).
  if (overview.chipsQuotaIsToday && overview.chips) {
    const hot = overview.chips
      .filter((c) => c.quotaLimit > 0 && c.quotaPercentage >= CHIP_ALERT_PCT)
      .sort((a, b) => b.quotaPercentage - a.quotaPercentage)[0];
    if (hot) {
      const left = Math.max(0, hot.quotaLimit - hot.sentToday);
      findings.push({
        key: "chipQuota",
        title: `Chip ${hot.name} a ${decimal(hot.quotaPercentage)}% da cota de hoje`,
        detail: left > 0 ? `${plural(left, "falta", "faltam")} ${n(left)} ${plural(left, "envio", "envios")}` : "a cota de hoje acabou",
        action: `Dividir os envios de hoje com outro chip ou segurar o próximo lote do chip ${hot.name}`,
        why: `${n(hot.sentToday)} de ${n(hot.quotaLimit)} envios de campanha e follow-up hoje no chip ${hot.name}.`,
        metric: `chip ${hot.name} abaixo de ${CHIP_ALERT_PCT}% da cota`,
        checkedByDefault: false,
      });
    }
  }

  // 4. Campanha que responde pouco, comparada com a que mais responde no mesmo período.
  const pair = bestAndWorstCampaign(data);
  if (pair && pair.worst.reply_rate < pair.best.reply_rate * WEAK_CAMPAIGN_RATIO) {
    const worstName = pair.worst.campaign_name || "Campanha sem nome";
    const bestName = pair.best.campaign_name || "Campanha sem nome";
    findings.push({
      key: "weakCampaign",
      title: `"${worstName}" responde pouco`,
      detail: `${decimal(pair.worst.reply_rate)} de cada 100, contra ${decimal(pair.best.reply_rate)} da melhor`,
      action: `Reescrever a mensagem de "${worstName}" a partir da que mais responde ("${bestName}")`,
      why: `"${worstName}": ${decimal(pair.worst.reply_rate)} respostas a cada 100. "${bestName}": ${decimal(pair.best.reply_rate)}.`,
      metric: `"${worstName}" acima de ${decimal(pair.worst.reply_rate)} a cada 100`,
      checkedByDefault: false,
    });
  }

  return findings;
}

function bestAndWorstCampaign(data: DashboardPayload) {
  const campaigns = data.overview?.campaigns ?? data.rankings.messages;
  if (!campaigns || campaigns.length < 2) return campaigns && campaigns.length === 1 ? { best: campaigns[0], worst: campaigns[0] } : null;
  const sorted = [...campaigns].sort((a, b) => b.reply_rate - a.reply_rate);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

// ── O que a pessoa decide: o que entra, quem faz e até quando ─────────────

export interface PlanChoice {
  checked: boolean;
  owner: string;
  due: string;
}
export type PlanChoices = Partial<Record<FindingKey, PlanChoice>>;

export function choiceFor(finding: PlanFinding, choices: PlanChoices): PlanChoice {
  const saved = choices[finding.key];
  return { checked: saved?.checked ?? finding.checkedByDefault, owner: saved?.owner ?? "", due: saved?.due ?? "" };
}

export interface PlanAction {
  key: FindingKey;
  action: string;
  why: string;
  owner: string;
  due: string;
  metric: string;
}

export function buildPlanActions(findings: PlanFinding[], choices: PlanChoices): PlanAction[] {
  return findings
    .filter((finding) => choiceFor(finding, choices).checked)
    .map((finding) => {
      const choice = choiceFor(finding, choices);
      return { key: finding.key, action: finding.action, why: finding.why, owner: choice.owner.trim(), due: choice.due.trim(), metric: finding.metric };
    });
}

/** Segunda-feira da semana de `now`, como "10/11". */
export function weekLabel(now: Date = new Date()): string {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return `${String(monday.getDate()).padStart(2, "0")}/${String(monday.getMonth() + 1).padStart(2, "0")}`;
}

/** O plano em texto corrido, para colar no grupo da equipe. Dono e prazo em branco saem como "a definir". */
export function buildDirective(actions: PlanAction[], { companyName, now = new Date() }: { companyName?: string; now?: Date } = {}): string {
  const head = `Plano de ação${companyName ? ` · ${companyName}` : ""} · semana de ${weekLabel(now)}`;
  if (actions.length === 0) return `${head}\n\nNenhuma ação marcada.`;
  const lines = actions.map(
    (a, index) =>
      `${index + 1}. ${a.action}\n   Por quê: ${a.why}\n   Dono: ${a.owner || "a definir"} · Prazo: ${a.due || "a definir"}\n   Mede-se por: ${a.metric}`
  );
  return `${head}\n\n${lines.join("\n\n")}`;
}

// ── Guardar a escolha no navegador, por empresa ───────────────────────────
// Dono e prazo digitados não podem sumir ao trocar de aba. Fica no navegador de quem montou o plano; o plano
// compartilhado entre pessoas depende de gravação no servidor, que esta versão não tem.

const planKey = (clientId: string) => `vexo:dashboard-plano:${clientId || "sem-empresa"}`;

export function readPlanChoices(clientId: string): PlanChoices {
  try {
    const raw = window.localStorage.getItem(planKey(clientId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as PlanChoices) : {};
  } catch {
    return {};
  }
}

export function writePlanChoices(clientId: string, choices: PlanChoices) {
  try {
    window.localStorage.setItem(planKey(clientId), JSON.stringify(choices));
  } catch {
    // sem armazenamento: vale só nesta visita
  }
}
