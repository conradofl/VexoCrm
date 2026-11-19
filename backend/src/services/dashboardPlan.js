// backend/src/services/dashboardPlan.js
//
// Plano de ação do Dashboard, gravado no servidor (tabela dashboard_action_plans).
//
// Regras (decididas pelo dono em 18/11/2026):
//   - só usuário da equipe Vexo edita; o cliente vê e não edita;
//   - a planilha com nome e telefone só sai para quem tem acesso à tela Conversas;
//   - a cobrança mora na própria aba: "você combinou X; o número foi de A para B". A é o número do dia em que o item
//     entrou no plano, medido AQUI no servidor e nunca reescrito; B é medido de novo na hora de mostrar.
//
// O número de cada achado sai do MESMO payload do Dashboard (getOrComputeDashboardMetrics), pela função
// findingValue abaixo. É a única definição: a tela não recalcula A nem B.

export const PLAN_FINDING_KEYS = ["waiting", "neverApproached", "chipQuota", "weakCampaign"];
export const PLAN_EXPORT_LISTS = ["waiting", "neverApproached"];
export const PLAN_MAX_ITEMS = 12;
export const PLAN_EXPORT_WAITING_LIMIT = 2000;

const LIMITS = { subject: 120, owner: 60, due: 40, action: 300, why: 600, metric: 200 };
const UNITS = {
  waiting: "pessoas esperando resposta",
  neverApproached: "contatos nunca abordados",
  chipQuota: "% da cota de hoje",
  weakCampaign: "respostas a cada 100",
};
const UNNAMED_CAMPAIGN = "Campanha sem nome";

export class PlanRuleError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Equipe Vexo: quem edita o plano. Cliente (role "client") só lê. */
export function isVexoTeam(access) {
  return access?.role === "internal" || access?.role === "superadmin";
}

/** Segunda-feira da semana de `now` no fuso de São Paulo, como "AAAA-MM-DD". */
export function weekStartFor(now = new Date(), timeZone = "America/Sao_Paulo") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
    .formatToParts(now)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const offsets = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const monday = new Date(local - offsets[parts.weekday] * 86400000);
  return monday.toISOString().slice(0, 10);
}

const round1 = (v) => Math.round(Number(v) * 10) / 10;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * O número de um achado no payload do Dashboard. null = não há número agora (bloco indisponível, chip ou campanha
 * fora do período). Nunca zero inventado.
 */
export function findingValue(metrics, key, subject = null) {
  const overview = metrics?.overview;
  if (!overview) return null;
  if (key === "waiting") {
    const w = overview.waiting;
    return w?.status === "ready" && isNum(w.waiting) ? { value: w.waiting, unit: UNITS.waiting } : null;
  }
  if (key === "neverApproached") {
    const reachable = overview.base?.neverApproached?.reachable;
    return isNum(reachable) ? { value: reachable, unit: UNITS.neverApproached } : null;
  }
  if (key === "chipQuota") {
    if (!overview.chipsQuotaIsToday || !Array.isArray(overview.chips) || !subject) return null;
    const chip = overview.chips.find((c) => c?.name === subject && Number(c.quotaLimit) > 0);
    return chip && isNum(chip.quotaPercentage) ? { value: round1(chip.quotaPercentage), unit: UNITS.chipQuota } : null;
  }
  if (key === "weakCampaign") {
    const list = overview.campaigns ?? metrics?.rankings?.messages;
    if (!Array.isArray(list) || !subject) return null;
    const campaign = list.find((c) => (c?.campaign_name || UNNAMED_CAMPAIGN) === subject);
    return campaign && isNum(campaign.reply_rate) ? { value: round1(campaign.reply_rate), unit: UNITS.weakCampaign } : null;
  }
  return null;
}

function text(value, field, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new PlanRuleError("INVALID_PLAN_ITEM", `Campo "${field}" é obrigatório.`);
    return "";
  }
  if (typeof value !== "string") throw new PlanRuleError("INVALID_PLAN_ITEM", `Campo "${field}" precisa ser texto.`);
  const trimmed = value.trim();
  if (trimmed.length > LIMITS[field]) {
    throw new PlanRuleError("INVALID_PLAN_ITEM", `Campo "${field}" passa de ${LIMITS[field]} caracteres.`);
  }
  return trimmed;
}

const itemId = (item) => `${item.key}::${item.subject ?? ""}`;

/** Valida o que a tela mandou. Só os campos que a pessoa decide e os textos do achado; o número, nunca. */
export function normalizePlanItems(input) {
  if (!Array.isArray(input)) throw new PlanRuleError("INVALID_PLAN_ITEMS", "O plano precisa ser uma lista de itens.");
  if (input.length > PLAN_MAX_ITEMS) throw new PlanRuleError("INVALID_PLAN_ITEMS", `O plano aceita até ${PLAN_MAX_ITEMS} itens.`);
  const seen = new Set();
  return input.map((raw) => {
    if (!raw || typeof raw !== "object") throw new PlanRuleError("INVALID_PLAN_ITEM", "Item do plano inválido.");
    if (!PLAN_FINDING_KEYS.includes(raw.key)) throw new PlanRuleError("INVALID_PLAN_ITEM", "Achado desconhecido no plano.");
    const needsSubject = raw.key === "chipQuota" || raw.key === "weakCampaign";
    const subject = needsSubject ? text(raw.subject, "subject", { required: true }) : null;
    const item = {
      key: raw.key,
      subject,
      checked: raw.checked === true,
      owner: text(raw.owner, "owner"),
      due: text(raw.due, "due"),
      action: text(raw.action, "action", { required: true }),
      why: text(raw.why, "why"),
      metric: text(raw.metric, "metric"),
    };
    const id = itemId(item);
    if (seen.has(id)) throw new PlanRuleError("INVALID_PLAN_ITEMS", "Item repetido no plano.");
    seen.add(id);
    return item;
  });
}

/**
 * Junta o que veio da tela com o que já estava gravado.
 * - baseline (número do dia em que o item entrou) é do servidor e nunca é reescrito;
 * - item gravado que a tela não mandou (o achado sumiu: a fila zerou, a campanha saiu do período) continua no plano.
 */
export function mergePlanItems(stored, incoming, { metrics, now = new Date() }) {
  const byId = new Map((Array.isArray(stored) ? stored : []).map((item) => [itemId(item), item]));
  const at = now.toISOString();
  const merged = incoming.map((item) => {
    const previous = byId.get(itemId(item));
    byId.delete(itemId(item));
    if (previous && "baseline" in previous) return { ...item, baseline: previous.baseline ?? null, baselineAt: previous.baselineAt ?? null };
    return { ...item, baseline: findingValue(metrics, item.key, item.subject), baselineAt: at };
  });
  return [...merged, ...byId.values()];
}

const PLAN_COLUMNS = "client_id, week_start::text AS week_start, items, created_at, updated_at";

export async function readPlan(pool, { clientId, weekStart }) {
  const { rows } = await pool.query(
    `SELECT ${PLAN_COLUMNS} FROM public.dashboard_action_plans WHERE client_id = $1 AND week_start = $2::date`,
    [clientId, weekStart]
  );
  return rows[0] ? toPlan(rows[0]) : null;
}

/** O plano mais recente ANTES da semana atual: é ele que a aba cobra. */
export async function readPreviousPlan(pool, { clientId, weekStart }) {
  const { rows } = await pool.query(
    `SELECT ${PLAN_COLUMNS} FROM public.dashboard_action_plans
      WHERE client_id = $1 AND week_start < $2::date
      ORDER BY week_start DESC LIMIT 1`,
    [clientId, weekStart]
  );
  return rows[0] ? toPlan(rows[0]) : null;
}

function toPlan(row) {
  const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);
  return {
    weekStart: String(row.week_start).slice(0, 10),
    items: Array.isArray(row.items) ? row.items : typeof row.items === "string" ? JSON.parse(row.items) : [],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** Cobrança: cada item marcado do plano anterior com o número de hoje ao lado do número do dia do plano. */
export function withCurrentValues(plan, metrics) {
  if (!plan) return null;
  return {
    ...plan,
    items: plan.items.filter((item) => item.checked).map((item) => ({ ...item, current: findingValue(metrics, item.key, item.subject) })),
  };
}

export async function savePlan(pool, { clientId, weekStart, items, uid, metrics, now = new Date() }) {
  const client = typeof pool.connect === "function" ? await pool.connect() : null;
  const q = client ? (sql, params) => client.query(sql, params) : (sql, params) => pool.query(sql, params);
  try {
    if (client) await q("BEGIN");
    const { rows } = await q(
      "SELECT items FROM public.dashboard_action_plans WHERE client_id = $1 AND week_start = $2::date FOR UPDATE",
      [clientId, weekStart]
    );
    const stored = rows[0] ? (typeof rows[0].items === "string" ? JSON.parse(rows[0].items) : rows[0].items) : [];
    const merged = mergePlanItems(stored, items, { metrics, now });
    const { rows: saved } = await q(
      `INSERT INTO public.dashboard_action_plans (client_id, week_start, items, created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2::date, $3::jsonb, $4, $4, now(), now())
       ON CONFLICT (client_id, week_start)
       DO UPDATE SET items = EXCLUDED.items, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING ${PLAN_COLUMNS}`,
      [clientId, weekStart, JSON.stringify(merged), uid || "desconhecido"]
    );
    if (client) await q("COMMIT");
    return toPlan(saved[0]);
  } catch (err) {
    if (client) await q("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client?.release?.();
  }
}

/** Tabela ainda não criada (código novo, schema velho). */
export function isMissingPlanTable(err) {
  return err?.code === "42P01" || /dashboard_action_plans.*does not exist|relation .*dashboard_action_plans/i.test(String(err?.message));
}

// ── Planilha ──────────────────────────────────────────────────────────────
// Separador ";" e BOM: abre certo no Excel em português. Célula que começa com = + - @ ganha apóstrofo para não
// virar fórmula quando a planilha é aberta (nome de contato vem de fora).
function csvCell(value) {
  let v = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function buildCsv(header, rows) {
  return "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

function formatSaoPaulo(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function waitingCsv(queue) {
  return buildCsv(
    ["Nome", "Telefone", "Chip", "Esperando desde"],
    (queue?.oldest ?? []).map((row) => [row.name || "", row.phone || "", row.chip || "", formatSaoPaulo(row.waitingSince)])
  );
}

export function neverApproachedCsv(list) {
  return buildCsv(["Nome", "Telefone"], list.map((row) => [row.name || "", row.phone || ""]));
}
