// Leitura e escrita do Gestor de Tráfego para a tela: contas, perfil de metas e
// regras, e desempenho. Toda consulta filtra por client_id.
//
// Nada aqui fala com plataforma de anúncio. Quem coleta é collector.js.

import { decidir, piorDecisao, DEFAULT_KILL_AT, DEFAULT_MIN_SPEND_FACTOR, DEFAULT_SCALE_AT } from "./decision.js";
import { resolveCollectionWindow } from "./collector.js";
import { computeKpis, getKpiDefinition, publicKpiCatalog, sumMetrics } from "./kpis.js";
import { normalizeMetaAccountId } from "./metaAdsClient.js";

export const ALLOWED_WINDOWS = [4, 7, 14, 30];
export const AUTONOMY_LEVELS = ["relatorio", "sugere", "aplica_com_limites"];
// Fase 1: o servidor só aceita relatório. Os outros dois existem no banco e na
// tela (desabilitados), mas não entram por aqui.
export const AUTONOMY_AVAILABLE = ["relatorio"];
export const APPROVER_ROLES = ["gestor_gd", "cliente"];
export const REPORT_TIMEZONE = "America/Sao_Paulo";

export class TrafficRuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TrafficRuleError";
    this.code = code;
  }
}

function rule(code, message) {
  return new TrafficRuleError(code, message);
}

// ─── Contas ───────────────────────────────────────────────────────────────────

function toPublicAccount(row) {
  return {
    id: row.id,
    platform: row.platform,
    externalAccountId: row.external_account_id,
    displayName: row.display_name || null,
    currency: row.currency || null,
    timezone: row.timezone || null,
    status: row.status,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null,
    lastSyncAttemptAt: row.last_sync_attempt_at ? new Date(row.last_sync_attempt_at).toISOString() : null,
    lastSyncError: row.last_sync_error || null,
  };
}

export async function listAccounts(pool, clientId) {
  const { rows } = await pool.query(
    `SELECT id, platform, external_account_id, display_name, currency, timezone, status,
            last_sync_at, last_sync_attempt_at, last_sync_error
       FROM public.traffic_accounts
      WHERE client_id = $1
      ORDER BY platform, created_at, external_account_id`,
    [clientId]
  );
  return rows.map(toPublicAccount);
}

export async function createAccount(pool, clientId, input = {}) {
  const platform = String(input.platform || "").trim().toLowerCase();
  if (platform === "google") {
    throw rule("PLATFORM_NOT_AVAILABLE", "A coleta do Google Ads ainda não está disponível. Por enquanto só a Meta.");
  }
  if (platform !== "meta") throw rule("INVALID_PLATFORM", "Plataforma inválida.");

  let externalAccountId;
  try {
    externalAccountId = normalizeMetaAccountId(input.externalAccountId);
  } catch {
    throw rule("INVALID_ACCOUNT_ID", "Informe o número da conta de anúncios da Meta (só dígitos, com ou sem act_).");
  }

  const displayName = typeof input.displayName === "string" ? input.displayName.trim().slice(0, 120) || null : null;

  const { rows } = await pool.query(
    `INSERT INTO public.traffic_accounts (client_id, platform, external_account_id, display_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id, platform, external_account_id) DO NOTHING
     RETURNING id, platform, external_account_id, display_name, currency, timezone, status,
               last_sync_at, last_sync_attempt_at, last_sync_error`,
    [clientId, platform, externalAccountId, displayName]
  );
  if (rows.length === 0) throw rule("ACCOUNT_ALREADY_EXISTS", "Esta conta já está cadastrada nesta empresa.");
  return toPublicAccount(rows[0]);
}

/** Empresa dona da conta, ou null. As rotas por :id tiram o tenant da LINHA, nunca do payload. */
export async function findAccountTenant(pool, accountId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(accountId || ""))) return null;
  const { rows } = await pool.query("SELECT client_id FROM public.traffic_accounts WHERE id = $1", [accountId]);
  return rows[0]?.client_id || null;
}

export async function setAccountStatus(pool, clientId, accountId, status) {
  if (status !== "active" && status !== "paused") throw rule("INVALID_STATUS", "Estado inválido.");
  const { rows } = await pool.query(
    `UPDATE public.traffic_accounts SET status = $3, updated_at = now()
      WHERE id = $1 AND client_id = $2
      RETURNING id, platform, external_account_id, display_name, currency, timezone, status,
                last_sync_at, last_sync_attempt_at, last_sync_error`,
    [accountId, clientId, status]
  );
  return rows[0] ? toPublicAccount(rows[0]) : null;
}

// ─── Perfil ───────────────────────────────────────────────────────────────────

export function defaultProfile() {
  return {
    exists: false,
    objectives: [],
    kpis: [],
    primaryKpi: null,
    windows: [...ALLOWED_WINDOWS],
    minSpendFactor: DEFAULT_MIN_SPEND_FACTOR,
    dailyBudgetCap: null,
    monthlyBudgetCap: null,
    maxIncreasePct: 50,
    autonomyLevel: "relatorio",
    approvers: [],
    updatedAt: null,
  };
}

function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function toPublicProfile(row) {
  if (!row) return defaultProfile();
  return {
    exists: true,
    objectives: Array.isArray(row.objectives) ? row.objectives : [],
    kpis: Array.isArray(row.kpis) ? row.kpis : [],
    primaryKpi: row.primary_kpi || null,
    windows: Array.isArray(row.windows) && row.windows.length > 0 ? row.windows : [...ALLOWED_WINDOWS],
    minSpendFactor: Number(row.min_spend_factor),
    dailyBudgetCap: row.daily_budget_cap === null ? null : Number(row.daily_budget_cap),
    monthlyBudgetCap: row.monthly_budget_cap === null ? null : Number(row.monthly_budget_cap),
    maxIncreasePct: Number(row.max_increase_pct),
    autonomyLevel: row.autonomy_level,
    approvers: Array.isArray(row.approvers) ? row.approvers : [],
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function getProfile(pool, clientId) {
  const { rows } = await pool.query("SELECT * FROM public.traffic_profiles WHERE client_id = $1", [clientId]);
  return toPublicProfile(rows[0]);
}

/** Valida o que veio da tela e devolve o perfil pronto para gravar. Lança TrafficRuleError. */
export function normalizeProfileInput(input = {}) {
  const autonomyLevel = String(input.autonomyLevel || "relatorio");
  if (!AUTONOMY_LEVELS.includes(autonomyLevel)) throw rule("INVALID_AUTONOMY", "Nível de autonomia inválido.");
  if (!AUTONOMY_AVAILABLE.includes(autonomyLevel)) {
    throw rule("AUTONOMY_NOT_AVAILABLE", "Nesta fase só o nível Relatório está disponível.");
  }

  const objectives = (Array.isArray(input.objectives) ? input.objectives : [])
    .map((item) => (typeof item === "string" ? item.trim().slice(0, 120) : ""))
    .filter(Boolean)
    .slice(0, 10);

  const seen = new Set();
  const kpis = [];
  for (const raw of Array.isArray(input.kpis) ? input.kpis : []) {
    const definition = getKpiDefinition(raw?.key);
    if (!definition) throw rule("INVALID_KPI", `KPI desconhecido: ${String(raw?.key ?? "").slice(0, 40)}.`);
    if (seen.has(definition.key)) throw rule("DUPLICATE_KPI", `${definition.label} aparece duas vezes.`);
    seen.add(definition.key);

    const target = numOrNull(raw.target);
    if (Number.isNaN(target) || (target !== null && target <= 0)) {
      throw rule("INVALID_TARGET", `Meta de ${definition.label} precisa ser um número maior que zero.`);
    }
    const scaleAt = numOrNull(raw.scale_at) ?? DEFAULT_SCALE_AT;
    const killAt = numOrNull(raw.kill_at) ?? DEFAULT_KILL_AT;
    if (Number.isNaN(scaleAt) || scaleAt <= 0 || scaleAt > 5) {
      throw rule("INVALID_THRESHOLD", `Limiar de escala de ${definition.label} precisa ficar entre 1% e 500%.`);
    }
    if (Number.isNaN(killAt) || killAt <= 0 || killAt > 5) {
      throw rule("INVALID_THRESHOLD", `Limiar de corte de ${definition.label} precisa ficar entre 1% e 500%.`);
    }
    const minSpend = numOrNull(raw.min_spend);
    if (Number.isNaN(minSpend) || (minSpend !== null && minSpend < 0)) {
      throw rule("INVALID_MIN_SPEND", `Gasto mínimo de ${definition.label} não pode ser negativo.`);
    }

    // `better` vem do catálogo, não da tela.
    kpis.push({ key: definition.key, target, better: definition.better, scale_at: scaleAt, kill_at: killAt, min_spend: minSpend });
  }

  const primaryKpi = input.primaryKpi ? String(input.primaryKpi) : null;
  if (primaryKpi && !seen.has(primaryKpi)) {
    throw rule("INVALID_PRIMARY_KPI", "O KPI principal precisa estar na lista de KPIs com meta.");
  }

  const windows = Array.from(
    new Set((Array.isArray(input.windows) ? input.windows : ALLOWED_WINDOWS).map(Number).filter((n) => ALLOWED_WINDOWS.includes(n)))
  ).sort((a, b) => a - b);
  if (windows.length === 0) throw rule("INVALID_WINDOWS", "Escolha ao menos uma janela.");

  const minSpendFactor = numOrNull(input.minSpendFactor) ?? DEFAULT_MIN_SPEND_FACTOR;
  if (Number.isNaN(minSpendFactor) || minSpendFactor <= 0 || minSpendFactor > 10) {
    throw rule("INVALID_MIN_SPEND_FACTOR", "O fator de gasto mínimo precisa ficar entre 0,1 e 10.");
  }

  const dailyBudgetCap = numOrNull(input.dailyBudgetCap);
  const monthlyBudgetCap = numOrNull(input.monthlyBudgetCap);
  for (const [value, label] of [[dailyBudgetCap, "diário"], [monthlyBudgetCap, "mensal"]]) {
    if (Number.isNaN(value) || (value !== null && value < 0)) {
      throw rule("INVALID_BUDGET_CAP", `Teto ${label} de verba precisa ser um número maior ou igual a zero.`);
    }
  }

  const maxIncreasePct = numOrNull(input.maxIncreasePct) ?? 50;
  if (Number.isNaN(maxIncreasePct) || maxIncreasePct < 0 || maxIncreasePct > 100) {
    throw rule("INVALID_MAX_INCREASE", "O aumento máximo por mudança precisa ficar entre 0% e 100%.");
  }

  const approvers = [];
  for (const raw of (Array.isArray(input.approvers) ? input.approvers : []).slice(0, 10)) {
    const name = typeof raw?.name === "string" ? raw.name.trim().slice(0, 80) : "";
    if (!name) continue;
    if (!APPROVER_ROLES.includes(raw.role)) throw rule("INVALID_APPROVER", "Aprovador precisa ser gestor da GD ou cliente.");
    approvers.push({ name, role: raw.role });
  }

  return { objectives, kpis, primaryKpi, windows, minSpendFactor, dailyBudgetCap, monthlyBudgetCap, maxIncreasePct, autonomyLevel, approvers };
}

export async function saveProfile(pool, clientId, input) {
  const p = normalizeProfileInput(input);
  const { rows } = await pool.query(
    `INSERT INTO public.traffic_profiles (
       client_id, objectives, kpis, primary_kpi, windows, min_spend_factor,
       daily_budget_cap, monthly_budget_cap, max_increase_pct, autonomy_level, approvers
     ) VALUES ($1, $2::jsonb, $3::jsonb, $4, $5::jsonb, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (client_id) DO UPDATE SET
       objectives = EXCLUDED.objectives,
       kpis = EXCLUDED.kpis,
       primary_kpi = EXCLUDED.primary_kpi,
       windows = EXCLUDED.windows,
       min_spend_factor = EXCLUDED.min_spend_factor,
       daily_budget_cap = EXCLUDED.daily_budget_cap,
       monthly_budget_cap = EXCLUDED.monthly_budget_cap,
       max_increase_pct = EXCLUDED.max_increase_pct,
       autonomy_level = EXCLUDED.autonomy_level,
       approvers = EXCLUDED.approvers,
       updated_at = now()
     RETURNING *`,
    [
      clientId,
      JSON.stringify(p.objectives),
      JSON.stringify(p.kpis),
      p.primaryKpi,
      JSON.stringify(p.windows),
      p.minSpendFactor,
      p.dailyBudgetCap,
      p.monthlyBudgetCap,
      p.maxIncreasePct,
      p.autonomyLevel,
      JSON.stringify(p.approvers),
    ]
  );
  return toPublicProfile(rows[0]);
}

// ─── Desempenho ───────────────────────────────────────────────────────────────

function node(base, ads) {
  const metrics = sumMetrics(ads.map((ad) => ad.metrics));
  return { ...base, metrics, kpis: computeKpis(metrics), decision: piorDecisao(ads.map((ad) => ad.decision?.decisao)) };
}

/**
 * Desempenho da empresa numa janela: conta > campanha > conjunto > anúncio, com
 * KPI contra a meta e decisão por anúncio. Só leitura.
 */
export async function buildPerformance(pool, clientId, { windowDays, now = new Date() } = {}) {
  const profile = await getProfile(pool, clientId);
  const days = ALLOWED_WINDOWS.includes(Number(windowDays)) ? Number(windowDays) : 7;
  const window = resolveCollectionWindow({ now, timeZone: REPORT_TIMEZONE, days });

  const { rows } = await pool.query(
    `SELECT platform, external_account_id, campaign_id, adset_id, ad_id,
            (array_agg(campaign_name ORDER BY date DESC))[1] AS campaign_name,
            (array_agg(adset_name ORDER BY date DESC))[1] AS adset_name,
            (array_agg(ad_name ORDER BY date DESC))[1] AS ad_name,
            (array_agg(objective ORDER BY date DESC))[1] AS objective,
            (array_agg(effective_status ORDER BY date DESC))[1] AS effective_status,
            sum(spend)::float8 AS spend,
            sum(impressions)::float8 AS impressions,
            sum(clicks)::float8 AS clicks,
            sum(leads)::float8 AS leads,
            sum(messages_started)::float8 AS messages_started,
            sum(purchases)::float8 AS purchases,
            sum(purchase_value)::float8 AS purchase_value
       FROM public.traffic_metrics_daily
      WHERE client_id = $1 AND date BETWEEN $2 AND $3
      GROUP BY platform, external_account_id, campaign_id, adset_id, ad_id
      ORDER BY sum(spend) DESC, ad_id`,
    [clientId, window.since, window.until]
  );

  const primaryRaw = profile.kpis.find((kpi) => kpi.key === profile.primaryKpi) || null;
  const primary = primaryRaw ? { ...primaryRaw, label: getKpiDefinition(primaryRaw.key)?.label || primaryRaw.key } : null;

  const ads = rows.map((row) => {
    const metrics = sumMetrics([row]);
    const kpis = computeKpis(metrics);
    const decision = primary
      ? decidir({ valorKpi: kpis[primary.key], kpi: primary, gasto: metrics.spend, minSpendFactor: profile.minSpendFactor })
      : null;
    return {
      platform: row.platform,
      accountId: row.external_account_id,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      adsetId: row.adset_id,
      adsetName: row.adset_name,
      id: row.ad_id,
      name: row.ad_name,
      objective: row.objective,
      effectiveStatus: row.effective_status,
      metrics,
      kpis,
      decision,
    };
  });

  const accountsMap = new Map();
  for (const ad of ads) {
    const accountKey = `${ad.platform}:${ad.accountId}`;
    if (!accountsMap.has(accountKey)) accountsMap.set(accountKey, { platform: ad.platform, id: ad.accountId, campaigns: new Map() });
    const account = accountsMap.get(accountKey);

    const campaignKey = ad.campaignId || "sem-campanha";
    if (!account.campaigns.has(campaignKey)) {
      account.campaigns.set(campaignKey, { id: ad.campaignId, name: ad.campaignName, objective: ad.objective, adsets: new Map() });
    }
    const campaign = account.campaigns.get(campaignKey);

    const adsetKey = ad.adsetId || "sem-conjunto";
    if (!campaign.adsets.has(adsetKey)) campaign.adsets.set(adsetKey, { id: ad.adsetId, name: ad.adsetName, ads: [] });
    campaign.adsets.get(adsetKey).ads.push(ad);
  }

  const accountInfo = new Map((await listAccounts(pool, clientId)).map((acc) => [`${acc.platform}:${acc.externalAccountId}`, acc]));

  const accounts = Array.from(accountsMap.entries()).map(([key, account]) => {
    const campaigns = Array.from(account.campaigns.values()).map((campaign) => {
      const adsets = Array.from(campaign.adsets.values()).map((adset) =>
        node({ id: adset.id, name: adset.name, ads: adset.ads.map(({ id, name, effectiveStatus, metrics, kpis, decision }) => ({ id, name, effectiveStatus, metrics, kpis, decision })) }, adset.ads)
      );
      const campaignAds = Array.from(campaign.adsets.values()).flatMap((adset) => adset.ads);
      return node({ id: campaign.id, name: campaign.name, objective: campaign.objective, adsets }, campaignAds);
    });
    const accountAds = ads.filter((ad) => `${ad.platform}:${ad.accountId}` === key);
    const info = accountInfo.get(key);
    const { decision: _ignored, ...summary } = node(
      { platform: account.platform, id: account.id, name: info?.displayName || null, currency: info?.currency || null, campaigns },
      accountAds
    );
    return summary;
  });

  const totals = sumMetrics(ads.map((ad) => ad.metrics));
  const totalKpis = computeKpis(totals);
  const catalog = publicKpiCatalog();

  return {
    window: { days, since: window.since, until: window.until, timezone: REPORT_TIMEZONE },
    windows: profile.windows,
    hasProfile: profile.exists,
    primaryKpi: primary ? primary.key : null,
    totals: { metrics: totals, kpis: totalKpis },
    // KPIs com meta contra o realizado da janela. variacao > 0 = melhor que a meta.
    targets: profile.kpis.map((kpi) => {
      const definition = catalog.find((item) => item.key === kpi.key);
      const value = totalKpis[kpi.key];
      let variacao = null;
      if (value !== null && kpi.target) {
        variacao = kpi.better === "higher" ? (value - kpi.target) / kpi.target : (kpi.target - value) / kpi.target;
        variacao = Math.round(variacao * 10000) / 10000;
      }
      return { key: kpi.key, label: definition?.label || kpi.key, unit: definition?.unit || null, better: kpi.better, target: kpi.target, value, variacao };
    }),
    accounts,
    adsCount: ads.length,
    // Respostas, reuniões e custo por reunião dependem da origem do anúncio
    // gravada no lead, que ainda não existe. Sem origem não há número.
    vexo: { available: false, reason: "SEM_ORIGEM_DO_ANUNCIO" },
  };
}
