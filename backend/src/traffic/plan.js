// Plano do dia e aprovação dupla do Gestor de Tráfego (Fase 2, conselheiro).
//
// NADA aqui fala com plataforma de anúncio. O plano propõe; gestor da GD E
// cliente aprovam; quem aplica é uma pessoa, à mão, no gerenciador de anúncios,
// e marca feito. Toda consulta filtra por client_id.
//
// Regras do gerador (SPEC-GESTOR-TRAFEGO-FASE1, seções 3 e 6, e o pedido do
// dono para a Fase 2):
//   - decisão por anúncio é a de decision.js; campanha herda a pior decisão
//     dos anúncios dela (piorDecisao), como na tela Desempenho;
//   - amostra insuficiente (ou sem meta) nunca vira ação;
//   - uma mudança por dia por campanha: no máximo UM item de ação por
//     campanha no plano, e nenhum quando a campanha já tem mudança aplicada
//     hoje, aprovada e ainda não aplicada, ou proposta esperando aprovação;
//   - aumento de verba no máximo max_increase_pct do perfil;
//   - verba proposta nunca abaixo de R$ 10/dia;
//   - tetos diário e mensal do perfil limitam a soma das verbas diárias; acima
//     do teto, o plano propõe reduzir as piores campanhas até caber;
//   - sem coleta nova desde o último plano, não gera e diz por quê.
//
// O que cada ação quer dizer:
//   - pausar campanha: todos os anúncios dela estão para cortar;
//   - pausar anúncio: a campanha tem anúncio para cortar e outros não; pausa o
//     pior (uma mudança por dia: os outros ficam para o próximo plano);
//   - aumentar verba: campanha para escalar, com verba diária própria lida na
//     última coleta;
//   - reduzir verba: só por teto (diário ou mensal) estourado;
//   - manter: campanha dentro da faixa, ou para escalar sem folga no teto.

import { DECISOES } from "./decision.js";
import { dateKeyInTimeZone } from "./collector.js";
import { getKpiDefinition } from "./kpis.js";
import { ALLOWED_WINDOWS, APPROVER_ROLES, REPORT_TIMEZONE, buildPerformance, getProfile } from "./service.js";

export const PLAN_TTL_HOURS = 24;
export const MIN_DAILY_BUDGET = 10;
export const DEFAULT_PLAN_WINDOW = 7;
export const PLAN_AUTONOMY_LEVELS = ["sugere", "aplica_com_limites"];

export const ACTIONS = Object.freeze({
  PAUSAR: "pausar",
  REDUZIR: "reduzir_verba",
  AUMENTAR: "aumentar_verba",
  MANTER: "manter",
});

export const ITEM_STATUS = Object.freeze({
  PROPOSTO: "proposto",
  APROVADO_GD: "aprovado_gd",
  APROVADO_CLIENTE: "aprovado_cliente",
  APROVADO: "aprovado",
  RECUSADO: "recusado",
  EXPIRADO: "expirado",
});

const PENDING_STATUSES = [ITEM_STATUS.PROPOSTO, ITEM_STATUS.APROVADO_GD, ITEM_STATUS.APROVADO_CLIENTE];

export class TrafficPlanError extends Error {
  constructor(code, message, status = 409, details = null) {
    super(message);
    this.name = "TrafficPlanError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status = 409, details = null) {
  return new TrafficPlanError(code, message, status, details);
}

// ─── Números e frases ─────────────────────────────────────────────────────────

function cents(value) {
  return Math.round(Number(value) * 100) / 100;
}

function floorCents(value) {
  return Math.floor(Number(value) * 100 + 1e-6) / 100;
}

// Espaço comum no lugar do espaço inseparável do Intl: a frase vai para tela,
// WhatsApp e GoClaw, e o caractere invisível atrapalha busca e comparação.
function money(value, currency) {
  let text;
  try {
    text = new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(value);
  } catch {
    text = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  }
  return text.replace(/\u00a0/g, " ");
}

function num(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

function dateBr(isoDate) {
  const [y, m, d] = String(isoDate).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function timeBr(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: REPORT_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

// Variação do anúncio contra a meta (> 0 melhor). Gastou sem resultado nenhum
// é o pior caso possível.
function variacaoDe(decision) {
  if (!decision) return null;
  if (decision.numeros?.variacao !== null && decision.numeros?.variacao !== undefined) return decision.numeros.variacao;
  if (decision.decisao === DECISOES.MATAR) return -Infinity;
  return null;
}

function kpiVariacao(value, target, better) {
  if (value === null || value === undefined || !target) return null;
  const v = better === "higher" ? (value - target) / target : (target - value) / target;
  return Math.round(v * 1e6) / 1e6;
}

// ─── Leitura auxiliar ─────────────────────────────────────────────────────────

/** Itens pendentes cujo prazo de 24 h passou viram "expirado". */
export async function expireStaleItems(pool, clientId, now = new Date()) {
  const { rowCount } = await pool.query(
    `UPDATE public.traffic_plan_items
        SET status = 'expirado', updated_at = $3
      WHERE client_id = $1 AND status = ANY($2::text[]) AND expires_at <= $3`,
    [clientId, PENDING_STATUSES, now]
  );
  return rowCount || 0;
}

/**
 * Campanhas que já gastaram a mudança do dia, ou que têm mudança pendurada.
 * Map("plataforma:campanha" -> motivo).
 */
async function loadBlockedCampaigns(pool, clientId, now, today) {
  const { rows } = await pool.query(
    `SELECT platform, campaign_id, status, applied_at, expires_at
       FROM public.traffic_plan_items
      WHERE client_id = $1
        AND action <> 'manter'
        AND campaign_id IS NOT NULL
        AND (
          (status = ANY($2::text[]) AND expires_at > $3)
          OR (status = 'aprovado' AND applied_at IS NULL)
          OR applied_at >= $4
        )`,
    [clientId, PENDING_STATUSES, now, new Date(now.getTime() - 48 * 3600 * 1000)]
  );
  const blocked = new Map();
  for (const row of rows) {
    const key = `${row.platform}:${row.campaign_id}`;
    if (row.applied_at && dateKeyInTimeZone(new Date(row.applied_at), REPORT_TIMEZONE) === today) {
      blocked.set(key, `Campanha já mudou hoje (aplicado em ${timeBr(row.applied_at)}). Uma mudança por dia por campanha.`);
    } else if (row.status === ITEM_STATUS.APROVADO && !row.applied_at) {
      if (!blocked.has(key)) blocked.set(key, "Há mudança aprovada para esta campanha que ainda não foi aplicada. Uma mudança por vez.");
    } else if (PENDING_STATUSES.includes(row.status)) {
      if (!blocked.has(key)) blocked.set(key, "Há proposta anterior para esta campanha esperando aprovação. Uma mudança por vez.");
    }
  }
  return blocked;
}

async function loadBudgets(pool, clientId) {
  const [{ rows: budgets }, { rows: accounts }] = await Promise.all([
    pool.query(
      `SELECT platform, external_account_id, level, entity_id, campaign_id, name,
              daily_budget::float8 AS daily_budget, lifetime_budget::float8 AS lifetime_budget,
              shared, status, collected_at
         FROM public.traffic_budgets
        WHERE client_id = $1`,
      [clientId]
    ),
    pool.query(`SELECT platform, external_account_id, last_sync_at, currency FROM public.traffic_accounts WHERE client_id = $1`, [clientId]),
  ]);
  const lastSync = new Map(accounts.map((a) => [`${a.platform}:${a.external_account_id}`, a.last_sync_at ? new Date(a.last_sync_at) : null]));
  const currency = new Map(accounts.map((a) => [`${a.platform}:${a.external_account_id}`, a.currency || null]));

  const byCampaign = new Map();
  for (const row of budgets) {
    const synced = lastSync.get(`${row.platform}:${row.external_account_id}`);
    // Verba é "da última coleta" quando foi lida na mesma coleta (ou depois)
    // da última coleta de métricas que deu certo.
    const fresh = Boolean(synced) && new Date(row.collected_at).getTime() >= synced.getTime();
    const key = `${row.platform}:${row.campaign_id}`;
    if (!byCampaign.has(key)) byCampaign.set(key, []);
    byCampaign.get(key).push({ ...row, fresh });
  }
  return { byCampaign, currency };
}

/** Verba diária de nível campanha que dá para propor mexer, ou o motivo de não dar. */
function resolveCampaignBudget(rows) {
  if (!rows || rows.length === 0) return { ok: false, reason: "Verba atual da campanha não foi lida. Sem ela não há proposta de verba." };
  const fresh = rows.filter((row) => row.fresh);
  if (fresh.length === 0) {
    const last = rows.map((row) => new Date(row.collected_at)).sort((a, b) => b - a)[0];
    return { ok: false, reason: `Verba lida pela última vez em ${timeBr(last)}, antes da última coleta. Sem verba atual não há proposta de verba.` };
  }
  const campaign = fresh.find((row) => row.level === "campaign");
  if (!campaign) {
    const adsets = fresh.filter((row) => row.level === "adset").length;
    return { ok: false, reason: `A verba desta campanha fica nos conjuntos (${adsets}). Ajuste por conjunto não entra nesta versão.` };
  }
  if (campaign.shared) return { ok: false, reason: "Verba compartilhada com outras campanhas: mexer nela mexe nas outras. Fica de fora." };
  if (campaign.daily_budget === null) return { ok: false, reason: "Campanha com verba total, não diária. Fica de fora." };
  return { ok: true, row: campaign, current: cents(campaign.daily_budget) };
}

function isActiveStatus(status) {
  return !status || String(status).toUpperCase() === "ACTIVE";
}

async function monthToDateSpend(pool, clientId, today) {
  const first = `${today.slice(0, 8)}01`;
  const { rows } = await pool.query(
    `SELECT coalesce(sum(spend), 0)::float8 AS total
       FROM public.traffic_metrics_daily
      WHERE client_id = $1 AND date >= $2 AND date < $3`,
    [clientId, first, today]
  );
  return cents(rows[0]?.total || 0);
}

function daysInMonth(isoDate) {
  const [y, m] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ─── Gerador ──────────────────────────────────────────────────────────────────

/**
 * Gera o plano do dia da empresa. Lança TrafficPlanError com o motivo quando
 * não gera (sem autonomia, sem KPI principal, sem dado, sem dado novo, já existe).
 *
 * @returns {Promise<{ plan: object, items: object[] }>}
 */
export async function generatePlan(pool, clientId, { now = new Date(), generatedBy = "agendador" } = {}) {
  const profile = await getProfile(pool, clientId);
  if (!PLAN_AUTONOMY_LEVELS.includes(profile.autonomyLevel)) {
    throw fail("AUTONOMY_REPORT_ONLY", 'O perfil está em "Relatório": nesse nível o Vexo não gera plano. Mude para "Sugere" em Metas e regras.', 422);
  }
  const primary = profile.kpis.find((kpi) => kpi.key === profile.primaryKpi);
  if (!primary || !primary.target) {
    throw fail("NO_PRIMARY_KPI", "O perfil não tem KPI principal com meta. Sem meta não há decisão nem plano.", 422);
  }

  const { rows: latestRows } = await pool.query(
    "SELECT max(collected_at) AS latest FROM public.traffic_metrics_daily WHERE client_id = $1",
    [clientId]
  );
  const latest = latestRows[0]?.latest ? new Date(latestRows[0].latest) : null;
  if (!latest) throw fail("NO_DATA", "Ainda não há métrica coletada para esta empresa. Sem dado não há plano.", 422);

  const today = dateKeyInTimeZone(now, REPORT_TIMEZONE);
  const { rows: lastPlans } = await pool.query(
    `SELECT id, plan_date::text AS plan_date_s, data_collected_at FROM public.traffic_plans
      WHERE client_id = $1 ORDER BY generated_at DESC LIMIT 1`,
    [clientId]
  );
  const lastPlan = lastPlans[0] || null;
  if (lastPlan && lastPlan.plan_date_s === today) {
    throw fail("PLAN_ALREADY_EXISTS", "Já existe plano de hoje para esta empresa.", 409, { planId: lastPlan.id });
  }
  if (lastPlan && latest.getTime() <= new Date(lastPlan.data_collected_at).getTime()) {
    throw fail(
      "NO_NEW_DATA",
      `Nenhuma coleta nova desde o plano de ${dateBr(lastPlan.plan_date_s)} (coleta de ${timeBr(lastPlan.data_collected_at)}). Sem dado novo, o plano seria o mesmo.`,
      422
    );
  }

  await expireStaleItems(pool, clientId, now);

  const windowDays = profile.windows.includes(DEFAULT_PLAN_WINDOW)
    ? DEFAULT_PLAN_WINDOW
    : profile.windows.filter((w) => ALLOWED_WINDOWS.includes(w)).slice(-1)[0] || DEFAULT_PLAN_WINDOW;
  const perf = await buildPerformance(pool, clientId, { windowDays, now });
  const kpiLabel = getKpiDefinition(primary.key)?.label || primary.key;

  const blocked = await loadBlockedCampaigns(pool, clientId, now, today);
  const { byCampaign: budgets, currency: currencyByAccount } = await loadBudgets(pool, clientId);

  const items = [];
  const skipped = [];
  const raises = [];
  // Campanhas que podem receber redução por teto (ainda sem item de ação).
  const reducible = [];

  for (const account of perf.accounts) {
    const currency = currencyByAccount.get(`${account.platform}:${account.id}`) || account.currency || "BRL";
    for (const campaign of account.campaigns) {
      const campaignKey = `${account.platform}:${campaign.id}`;
      const ads = campaign.adsets.flatMap((adset) => adset.ads.map((ad) => ({ ...ad, adsetId: adset.id })));
      const base = {
        platform: account.platform,
        external_account_id: account.id,
        campaign_id: campaign.id,
        campaign_name: campaign.name || null,
        kpi_key: primary.key,
        kpi_target: primary.target,
        window_since: perf.window.since,
        window_until: perf.window.until,
      };
      const campaignKpi = campaign.kpis?.[primary.key] ?? null;
      const campaignVariacao = kpiVariacao(campaignKpi, primary.target, primary.better);
      const counts = { ESCALAR: 0, MANTER: 0, MATAR: 0, AMOSTRA_INSUFICIENTE: 0, SEM_META: 0 };
      for (const ad of ads) if (ad.decision?.decisao) counts[ad.decision.decisao] = (counts[ad.decision.decisao] || 0) + 1;
      const resumo =
        `${kpiLabel} da campanha em ${campaignKpi === null ? "sem resultado" : num(campaignKpi)} (meta ${num(primary.target)}), ` +
        `gasto de ${money(campaign.metrics.spend, currency)} em ${windowDays} dias. ` +
        `Anúncios: ${counts.ESCALAR} para escalar, ${counts.MANTER} na faixa, ${counts.MATAR} para cortar, ${counts.AMOSTRA_INSUFICIENTE} sem amostra.`;

      if (!campaign.id) {
        skipped.push({ ...base, reason: "Anúncios sem campanha identificada. Fica de fora." });
        continue;
      }
      if (blocked.has(campaignKey)) {
        skipped.push({ ...base, reason: blocked.get(campaignKey) });
        continue;
      }

      const decision = campaign.decision;
      if (decision === DECISOES.MATAR) {
        const everyAdKill = ads.length > 0 && ads.every((ad) => ad.decision?.decisao === DECISOES.MATAR);
        if (everyAdKill) {
          items.push({
            ...base,
            level: "campaign",
            entity_id: campaign.id,
            entity_name: campaign.name || null,
            action: ACTIONS.PAUSAR,
            current_value: null,
            proposed_value: null,
            kpi_value: campaignKpi,
            decision,
            reason: `Todos os ${ads.length} anúncios da campanha estão para cortar. ${resumo} Proposta: pausar a campanha.`,
            numbers: { campaign: { kpi: campaignKpi, variacao: campaignVariacao, metrics: campaign.metrics }, counts },
          });
        } else {
          const worst = ads
            .filter((ad) => ad.decision?.decisao === DECISOES.MATAR)
            .sort((a, b) => (variacaoDe(a.decision) - variacaoDe(b.decision)) || b.metrics.spend - a.metrics.spend)[0];
          const others = counts.MATAR - 1;
          items.push({
            ...base,
            level: "ad",
            entity_id: worst.id,
            entity_name: worst.name || null,
            action: ACTIONS.PAUSAR,
            current_value: null,
            proposed_value: null,
            kpi_value: worst.kpis?.[primary.key] ?? null,
            decision: worst.decision.decisao,
            reason:
              `${worst.decision.motivo} Proposta: pausar este anúncio.` +
              (others > 0 ? ` Outros ${others} anúncios da campanha também estão para cortar e ficam para o próximo plano (uma mudança por dia).` : ""),
            numbers: { ad: worst.decision.numeros, adMetrics: worst.metrics, counts },
          });
        }
        continue;
      }

      if (decision === DECISOES.ESCALAR || decision === DECISOES.MANTER) {
        const budget = resolveCampaignBudget(budgets.get(campaignKey));
        if (decision === DECISOES.ESCALAR) {
          if (!budget.ok) {
            skipped.push({ ...base, reason: `Campanha para escalar, mas: ${budget.reason}` });
            continue;
          }
          raises.push({ base, campaign, campaignKpi, campaignVariacao, counts, resumo, budget, currency, decision });
        } else {
          const item = {
            ...base,
            level: "campaign",
            entity_id: campaign.id,
            entity_name: campaign.name || null,
            action: ACTIONS.MANTER,
            current_value: budget.ok ? budget.current : null,
            proposed_value: budget.ok ? budget.current : null,
            kpi_value: campaignKpi,
            decision,
            reason: `${resumo} Dentro da faixa. Proposta: manter.`,
            numbers: { campaign: { kpi: campaignKpi, variacao: campaignVariacao, metrics: campaign.metrics }, counts },
          };
          items.push(item);
          if (budget.ok) reducible.push({ item, budget, campaignVariacao, currency, resumo });
        }
        continue;
      }

      skipped.push({
        ...base,
        reason:
          decision === DECISOES.AMOSTRA_INSUFICIENTE
            ? `Amostra insuficiente em todos os anúncios. ${resumo} Sem amostra não há ação.`
            : `Sem decisão para esta campanha (${decision || "sem anúncio decidido"}). Sem decisão não há ação.`,
      });
    }
  }

  // ─── Tetos ──────────────────────────────────────────────────────────────────
  const pausedCampaigns = new Set(items.filter((i) => i.action === ACTIONS.PAUSAR && i.level === "campaign").map((i) => `${i.platform}:${i.campaign_id}`));
  let currentTotal = 0;
  for (const [key, rows] of budgets) {
    if (pausedCampaigns.has(key)) continue;
    for (const row of rows) {
      if (row.fresh && row.daily_budget !== null && !row.shared && isActiveStatus(row.status)) currentTotal += Number(row.daily_budget);
    }
  }
  currentTotal = cents(currentTotal);

  const dailyCap = profile.dailyBudgetCap;
  let monthlyAllowedDaily = null;
  let monthToDate = null;
  if (profile.monthlyBudgetCap !== null) {
    monthToDate = await monthToDateSpend(pool, clientId, today);
    const remaining = daysInMonth(today) - Number(today.slice(8, 10)) + 1;
    monthlyAllowedDaily = floorCents(Math.max(0, (profile.monthlyBudgetCap - monthToDate) / remaining));
  }
  const caps = [dailyCap, monthlyAllowedDaily].filter((v) => v !== null);
  const effectiveCap = caps.length > 0 ? Math.min(...caps) : null;
  const capLabel =
    effectiveCap === null
      ? null
      : effectiveCap === dailyCap
        ? `teto diário de ${money(dailyCap)}`
        : `teto mensal de ${money(profile.monthlyBudgetCap)} (já gasto ${money(monthToDate)} no mês; cabe ${money(monthlyAllowedDaily)} por dia até o fim do mês)`;

  const maxPct = Number(profile.maxIncreasePct);
  let room = effectiveCap === null ? Infinity : cents(effectiveCap - currentTotal);
  let shortfall = 0;

  raises.sort((a, b) => (b.campaignVariacao ?? -Infinity) - (a.campaignVariacao ?? -Infinity));
  for (const raise of raises) {
    const { base, campaign, campaignKpi, campaignVariacao, counts, resumo, budget, currency } = raise;
    const current = budget.current;
    const desired = floorCents(current * (1 + maxPct / 100));
    const proposed = room === Infinity ? desired : floorCents(Math.min(desired, current + Math.max(0, room)));
    const common = {
      ...base,
      level: "campaign",
      entity_id: campaign.id,
      entity_name: campaign.name || null,
      kpi_value: campaignKpi,
      decision: DECISOES.ESCALAR,
      numbers: {
        campaign: { kpi: campaignKpi, variacao: campaignVariacao, metrics: campaign.metrics },
        counts,
        budget: { current, desired, maxIncreasePct: maxPct, cap: effectiveCap, currentTotal, minDaily: MIN_DAILY_BUDGET },
      },
    };
    let holdReason = null;
    if (maxPct <= 0) holdReason = "O perfil não permite aumento de verba (aumento máximo de 0%).";
    else if (proposed <= current) holdReason = `Sem folga no ${capLabel}: as verbas diárias já somam ${money(currentTotal, currency)}.`;
    else if (proposed < MIN_DAILY_BUDGET) holdReason = `A verba proposta de ${money(proposed, currency)} fica abaixo do mínimo de ${money(MIN_DAILY_BUDGET)} por dia.`;

    if (holdReason) {
      const item = {
        ...common,
        action: ACTIONS.MANTER,
        current_value: current,
        proposed_value: current,
        reason: `Campanha para escalar. ${resumo} ${holdReason} Proposta: manter.`,
      };
      items.push(item);
      reducible.push({ item, budget, campaignVariacao, currency, resumo });
      continue;
    }
    const pct = Math.round(((proposed - current) / current) * 10000) / 100;
    const limitedByCap = proposed < desired;
    items.push({
      ...common,
      action: ACTIONS.AUMENTAR,
      current_value: current,
      proposed_value: proposed,
      reason:
        `Campanha para escalar. ${resumo} Proposta: verba diária de ${money(current, currency)} para ${money(proposed, currency)} (+${num(pct)}%; ` +
        (limitedByCap ? `limitado pelo ${capLabel}).` : `aumento máximo do perfil: ${num(maxPct)}%).`),
    });
    if (room !== Infinity) room = cents(room - (proposed - current));
  }

  // Teto estourado: reduz as piores campanhas (com verba própria e sem outra
  // ação no plano) até a soma caber, nunca abaixo do mínimo diário.
  if (effectiveCap !== null && currentTotal > effectiveCap) {
    let excess = cents(currentTotal - effectiveCap);
    reducible.sort((a, b) => (a.campaignVariacao ?? Infinity) - (b.campaignVariacao ?? Infinity));
    for (const entry of reducible) {
      if (excess <= 0) break;
      const current = entry.budget.current;
      const cut = cents(Math.min(excess, current - MIN_DAILY_BUDGET));
      if (cut <= 0) continue;
      const proposed = cents(current - cut);
      Object.assign(entry.item, {
        action: ACTIONS.REDUZIR,
        current_value: current,
        proposed_value: proposed,
        reason:
          `As verbas diárias somam ${money(currentTotal, entry.currency)}, acima do ${capLabel}. ${entry.resumo} ` +
          `Proposta: verba diária de ${money(current, entry.currency)} para ${money(proposed, entry.currency)} (mínimo de ${money(MIN_DAILY_BUDGET)} por dia).`,
        numbers: { ...entry.item.numbers, budget: { current, proposed, cap: effectiveCap, currentTotal, minDaily: MIN_DAILY_BUDGET } },
      });
      excess = cents(excess - cut);
    }
    shortfall = Math.max(0, excess);
  }

  const expiresAt = new Date(now.getTime() + PLAN_TTL_HOURS * 3600 * 1000);
  const summary = {
    windowDays,
    primaryKpi: primary.key,
    primaryKpiLabel: kpiLabel,
    primaryKpiUnit: getKpiDefinition(primary.key)?.unit || null,
    target: primary.target,
    maxIncreasePct: maxPct,
    minDailyBudget: MIN_DAILY_BUDGET,
    caps: {
      daily: dailyCap,
      monthly: profile.monthlyBudgetCap,
      monthToDate,
      monthlyAllowedDaily,
      effective: effectiveCap,
      currentTotal,
      shortfall: shortfall > 0 ? shortfall : null,
    },
    skipped: skipped.map((s) => ({
      platform: s.platform,
      campaignId: s.campaign_id,
      campaignName: s.campaign_name,
      reason: s.reason,
    })),
  };

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows: planRows } = await db.query(
      `INSERT INTO public.traffic_plans (
         client_id, plan_date, window_days, window_since, window_until, primary_kpi,
         data_collected_at, generated_by, generated_at, expires_at, summary
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (client_id, plan_date) DO NOTHING
       RETURNING *`,
      [clientId, today, windowDays, perf.window.since, perf.window.until, primary.key, latest, String(generatedBy).slice(0, 128), now, expiresAt, JSON.stringify(summary)]
    );
    if (planRows.length === 0) {
      await db.query("ROLLBACK");
      throw fail("PLAN_ALREADY_EXISTS", "Já existe plano de hoje para esta empresa.");
    }
    const plan = planRows[0];
    if (items.length > 0) {
      await db.query(
        `INSERT INTO public.traffic_plan_items (
           plan_id, client_id, platform, external_account_id, level, entity_id, entity_name,
           campaign_id, campaign_name, action, current_value, proposed_value,
           kpi_key, kpi_value, kpi_target, decision, reason, numbers,
           window_since, window_until, expires_at, created_at, updated_at
         )
         SELECT $1, $2, i.platform, i.external_account_id, i.level, i.entity_id, i.entity_name,
                i.campaign_id, i.campaign_name, i.action, i.current_value, i.proposed_value,
                i.kpi_key, i.kpi_value, i.kpi_target, i.decision, i.reason, i.numbers,
                i.window_since, i.window_until, $4, $5, $5
           FROM jsonb_to_recordset($3::jsonb) AS i(
             platform text, external_account_id text, level text, entity_id text, entity_name text,
             campaign_id text, campaign_name text, action text, current_value numeric, proposed_value numeric,
             kpi_key text, kpi_value numeric, kpi_target numeric, decision text, reason text, numbers jsonb,
             window_since date, window_until date
           )`,
        [plan.id, clientId, JSON.stringify(items.map(sanitizeItemForInsert)), expiresAt, now]
      );
    }
    await db.query("COMMIT");
    return getPlan(pool, clientId, plan.id);
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

function finiteOrNull(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
}

function sanitizeItemForInsert(item) {
  return {
    ...item,
    current_value: finiteOrNull(item.current_value),
    proposed_value: finiteOrNull(item.proposed_value),
    kpi_value: finiteOrNull(item.kpi_value),
    kpi_target: finiteOrNull(item.kpi_target),
    // -Infinity não existe em JSON: vira null.
    numbers: JSON.parse(JSON.stringify(item.numbers, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v))),
  };
}

// ─── Leitura pública ──────────────────────────────────────────────────────────

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

export function toPublicItem(row) {
  return {
    id: row.id,
    planId: row.plan_id,
    platform: row.platform,
    accountId: row.external_account_id,
    level: row.level,
    entityId: row.entity_id,
    entityName: row.entity_name,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    action: row.action,
    currentValue: numberOrNull(row.current_value),
    proposedValue: numberOrNull(row.proposed_value),
    kpi: { key: row.kpi_key, value: numberOrNull(row.kpi_value), target: numberOrNull(row.kpi_target) },
    decision: row.decision,
    reason: row.reason,
    numbers: row.numbers || {},
    window: { since: row.window_since_s, until: row.window_until_s },
    status: row.status,
    expiresAt: iso(row.expires_at),
    approvals: {
      gestor_gd: row.gd_approved_at ? { email: row.gd_approved_by_email, at: iso(row.gd_approved_at) } : null,
      cliente: row.client_approved_at ? { email: row.client_approved_by_email, at: iso(row.client_approved_at) } : null,
    },
    rejection: row.rejected_at
      ? { role: row.rejected_role, email: row.rejected_by_email, at: iso(row.rejected_at), reason: row.rejection_reason }
      : null,
    applied: row.applied_at ? { email: row.applied_by_email, at: iso(row.applied_at) } : null,
  };
}

function toPublicPlan(row) {
  return {
    id: row.id,
    date: row.plan_date_s,
    windowDays: row.window_days,
    window: { since: row.window_since_s, until: row.window_until_s },
    primaryKpi: row.primary_kpi,
    dataCollectedAt: iso(row.data_collected_at),
    generatedBy: row.generated_by === "agendador" ? "agendador" : "pessoa",
    generatedAt: iso(row.generated_at),
    expiresAt: iso(row.expires_at),
    summary: row.summary || {},
  };
}

// Datas como texto AAAA-MM-DD: o driver converte DATE em Date no fuso do
// processo, e meia-noite local vira o dia anterior em UTC fora do Brasil.
const PLAN_COLS = "*, plan_date::text AS plan_date_s, window_since::text AS window_since_s, window_until::text AS window_until_s";
const ITEM_COLS = "*, window_since::text AS window_since_s, window_until::text AS window_until_s";

const ACTION_ORDER = { pausar: 0, reduzir_verba: 1, aumentar_verba: 2, manter: 3 };

export async function getPlan(pool, clientId, planId) {
  const { rows } = await pool.query(`SELECT ${PLAN_COLS} FROM public.traffic_plans WHERE id = $1 AND client_id = $2`, [planId, clientId]);
  if (!rows[0]) return null;
  const { rows: items } = await pool.query(
    `SELECT ${ITEM_COLS} FROM public.traffic_plan_items WHERE plan_id = $1 AND client_id = $2 ORDER BY created_at, id`,
    [planId, clientId]
  );
  const publicItems = items.map(toPublicItem).sort((a, b) => ACTION_ORDER[a.action] - ACTION_ORDER[b.action]);
  return { plan: toPublicPlan(rows[0]), items: publicItems };
}

/** Plano de hoje (fuso de São Paulo), ou null. Expira o que passou de 24 h antes de ler. */
export async function getTodayPlan(pool, clientId, { now = new Date() } = {}) {
  await expireStaleItems(pool, clientId, now);
  const today = dateKeyInTimeZone(now, REPORT_TIMEZONE);
  const { rows } = await pool.query("SELECT id FROM public.traffic_plans WHERE client_id = $1 AND plan_date = $2", [clientId, today]);
  return rows[0] ? getPlan(pool, clientId, rows[0].id) : null;
}

/** Histórico: planos mais recentes com a contagem por estado. */
export async function listPlans(pool, clientId, { limit = 30, now = new Date() } = {}) {
  await expireStaleItems(pool, clientId, now);
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 90);
  const { rows } = await pool.query(
    `SELECT p.*, p.plan_date::text AS plan_date_s, p.window_since::text AS window_since_s, p.window_until::text AS window_until_s,
            coalesce(jsonb_object_agg(c.status, c.n) FILTER (WHERE c.status IS NOT NULL), '{}'::jsonb) AS counts
       FROM public.traffic_plans p
       LEFT JOIN (
         SELECT plan_id, status, count(*)::int AS n FROM public.traffic_plan_items WHERE client_id = $1 GROUP BY plan_id, status
       ) c ON c.plan_id = p.id
      WHERE p.client_id = $1
      GROUP BY p.id
      ORDER BY p.plan_date DESC
      LIMIT $2`,
    [clientId, safeLimit]
  );
  return rows.map((row) => ({ ...toPublicPlan(row), counts: row.counts || {} }));
}

/** Lista "aplicar à mão": aprovados pelos dois (exceto manter), pendentes primeiro, depois os feitos nos últimos 30 dias. */
export async function listApplyQueue(pool, clientId, { now = new Date() } = {}) {
  const { rows } = await pool.query(
    `SELECT ${ITEM_COLS} FROM public.traffic_plan_items
      WHERE client_id = $1 AND status = 'aprovado' AND action <> 'manter'
        AND (applied_at IS NULL OR applied_at >= $2)
      ORDER BY applied_at IS NOT NULL, applied_at DESC NULLS FIRST, client_approved_at DESC, gd_approved_at DESC`,
    [clientId, new Date(now.getTime() - 30 * 24 * 3600 * 1000)]
  );
  return rows.map(toPublicItem);
}

export async function findPlanTenant(pool, planId) {
  if (!isUuid(planId)) return null;
  const { rows } = await pool.query("SELECT client_id FROM public.traffic_plans WHERE id = $1", [planId]);
  return rows[0]?.client_id || null;
}

export async function findPlanItemTenant(pool, itemId) {
  if (!isUuid(itemId)) return null;
  const { rows } = await pool.query("SELECT client_id FROM public.traffic_plan_items WHERE id = $1", [itemId]);
  return rows[0]?.client_id || null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

// ─── Aprovação ────────────────────────────────────────────────────────────────

export function normalizeIdentity(identity) {
  const uid = typeof identity?.uid === "string" ? identity.uid.trim() : "";
  const email = typeof identity?.email === "string" ? identity.email.trim().toLowerCase() : "";
  return { uid: uid || null, email: email || null };
}

/** Papéis de aprovação desta pessoa no perfil da empresa (pelo email do login). */
export function rolesForIdentity(profile, identity) {
  const { email } = normalizeIdentity(identity);
  if (!email) return [];
  const roles = new Set();
  for (const approver of profile?.approvers || []) {
    if (approver?.email && String(approver.email).toLowerCase() === email && APPROVER_ROLES.includes(approver.role)) roles.add(approver.role);
  }
  return Array.from(roles);
}

async function assertApprover(pool, clientId, identity, role) {
  if (!APPROVER_ROLES.includes(role)) throw fail("INVALID_ROLE", "Papel de aprovação inválido.", 400);
  const who = normalizeIdentity(identity);
  if (!who.uid || !who.email) throw fail("NO_IDENTITY", "Login sem email: não dá para registrar quem aprovou.", 403);
  const profile = await getProfile(pool, clientId);
  const roles = rolesForIdentity(profile, who);
  if (!roles.includes(role)) {
    throw fail(
      "NOT_AN_APPROVER",
      role === "gestor_gd"
        ? "Seu email não está na lista de aprovadores do lado da GD em Metas e regras."
        : "Seu email não está na lista de aprovadores do lado do cliente em Metas e regras.",
      403
    );
  }
  return who;
}

async function explainRefusal(pool, clientId, itemId, who, role, now) {
  const { rows } = await pool.query("SELECT * FROM public.traffic_plan_items WHERE id = $1 AND client_id = $2", [itemId, clientId]);
  const row = rows[0];
  if (!row) return fail("NOT_FOUND", "Item do plano não encontrado.", 404);
  if (row.status === ITEM_STATUS.EXPIRADO || (PENDING_STATUSES.includes(row.status) && new Date(row.expires_at) <= now)) {
    return fail("ITEM_EXPIRED", "O prazo de 24 horas deste item passou. Ele expirou sem aprovação.");
  }
  if (row.status === ITEM_STATUS.RECUSADO) return fail("ITEM_REJECTED", "Este item já foi recusado.");
  if (row.status === ITEM_STATUS.APROVADO) return fail("ALREADY_APPROVED", "Este item já foi aprovado pelos dois lados.");
  const mine = role === "gestor_gd" ? row.gd_approved_at : row.client_approved_at;
  if (mine) return fail("ALREADY_APPROVED", "Este lado já aprovou este item.");
  const otherUid = role === "gestor_gd" ? row.client_approved_by_uid : row.gd_approved_by_uid;
  const otherEmail = role === "gestor_gd" ? row.client_approved_by_email : row.gd_approved_by_email;
  if ((otherUid && otherUid === who.uid) || (otherEmail && otherEmail === who.email)) {
    return fail("SAME_PERSON", "Você já aprovou este item pelo outro lado. A mesma pessoa não vale pelas duas aprovações.");
  }
  return fail("ITEM_NOT_PENDING", "Este item não está esperando aprovação.");
}

/** Aprova um item por um dos lados. Só vira "aprovado" com os dois lados, por pessoas diferentes. */
export async function approveItem(pool, { clientId, itemId, role, identity, now = new Date() }) {
  const who = await assertApprover(pool, clientId, identity, role);
  await expireStaleItems(pool, clientId, now);

  const sql =
    role === "gestor_gd"
      ? `UPDATE public.traffic_plan_items
            SET gd_approved_by_uid = $3, gd_approved_by_email = $4, gd_approved_at = $5,
                status = CASE WHEN client_approved_at IS NOT NULL THEN 'aprovado' ELSE 'aprovado_gd' END,
                updated_at = $5
          WHERE id = $1 AND client_id = $2
            AND status IN ('proposto', 'aprovado_cliente') AND gd_approved_at IS NULL
            AND expires_at > $5
            AND client_approved_by_uid IS DISTINCT FROM $3
            AND client_approved_by_email IS DISTINCT FROM $4
          RETURNING ${ITEM_COLS}`
      : `UPDATE public.traffic_plan_items
            SET client_approved_by_uid = $3, client_approved_by_email = $4, client_approved_at = $5,
                status = CASE WHEN gd_approved_at IS NOT NULL THEN 'aprovado' ELSE 'aprovado_cliente' END,
                updated_at = $5
          WHERE id = $1 AND client_id = $2
            AND status IN ('proposto', 'aprovado_gd') AND client_approved_at IS NULL
            AND expires_at > $5
            AND gd_approved_by_uid IS DISTINCT FROM $3
            AND gd_approved_by_email IS DISTINCT FROM $4
          RETURNING ${ITEM_COLS}`;
  const { rows } = await pool.query(sql, [itemId, clientId, who.uid, who.email, now]);
  if (!rows[0]) throw await explainRefusal(pool, clientId, itemId, who, role, now);
  return toPublicItem(rows[0]);
}

/** Recusa um item (qualquer um dos lados), com motivo. Recusa é final. */
export async function rejectItem(pool, { clientId, itemId, role, identity, reason, now = new Date() }) {
  const who = await assertApprover(pool, clientId, identity, role);
  const motivo = typeof reason === "string" ? reason.trim() : "";
  if (motivo.length < 5) throw fail("REASON_REQUIRED", "Escreva o motivo da recusa (pelo menos 5 letras).", 400);
  await expireStaleItems(pool, clientId, now);

  const { rows } = await pool.query(
    `UPDATE public.traffic_plan_items
        SET status = 'recusado', rejected_by_uid = $3, rejected_by_email = $4, rejected_role = $5,
            rejected_at = $6, rejection_reason = $7, updated_at = $6
      WHERE id = $1 AND client_id = $2 AND status = ANY($8::text[]) AND expires_at > $6
      RETURNING ${ITEM_COLS}`,
    [itemId, clientId, who.uid, who.email, role, now, motivo.slice(0, 500), PENDING_STATUSES]
  );
  if (!rows[0]) throw await explainRefusal(pool, clientId, itemId, who, role, now);
  return toPublicItem(rows[0]);
}

/** Marca como aplicado à mão. Só item aprovado pelos dois e que não seja "manter". */
export async function markItemApplied(pool, { clientId, itemId, identity, now = new Date() }) {
  const who = normalizeIdentity(identity);
  if (!who.uid || !who.email) throw fail("NO_IDENTITY", "Login sem email: não dá para registrar quem aplicou.", 403);
  const { rows } = await pool.query(
    `UPDATE public.traffic_plan_items
        SET applied_by_uid = $3, applied_by_email = $4, applied_at = $5, updated_at = $5
      WHERE id = $1 AND client_id = $2 AND status = 'aprovado' AND action <> 'manter' AND applied_at IS NULL
      RETURNING ${ITEM_COLS}`,
    [itemId, clientId, who.uid, who.email, now]
  );
  if (rows[0]) return toPublicItem(rows[0]);

  const { rows: current } = await pool.query("SELECT status, action, applied_at FROM public.traffic_plan_items WHERE id = $1 AND client_id = $2", [itemId, clientId]);
  if (!current[0]) throw fail("NOT_FOUND", "Item do plano não encontrado.", 404);
  if (current[0].applied_at) throw fail("ALREADY_APPLIED", "Este item já foi marcado como aplicado.");
  if (current[0].action === ACTIONS.MANTER) throw fail("NOTHING_TO_APPLY", '"Manter" não tem o que aplicar.');
  throw fail("NOT_APPROVED", "Só item aprovado pela GD e pelo cliente vai para a lista de aplicar.");
}

/**
 * Depois da coleta agendada: gera o plano do dia de cada empresa do piloto com
 * autonomia "sugere". Nunca lança; devolve o que aconteceu por empresa.
 */
export async function generateDailyPlans({ pool, now = new Date(), tenants = [] } = {}) {
  const results = [];
  for (const clientId of tenants) {
    try {
      const profile = await getProfile(pool, clientId);
      if (!PLAN_AUTONOMY_LEVELS.includes(profile.autonomyLevel)) continue;
      const { plan, items } = await generatePlan(pool, clientId, { now, generatedBy: "agendador" });
      results.push({ clientId, ok: true, planId: plan.id, items: items.length });
    } catch (err) {
      results.push({ clientId, ok: false, code: err?.code || "ERROR", message: String(err?.message || err).slice(0, 300) });
    }
  }
  return results;
}
