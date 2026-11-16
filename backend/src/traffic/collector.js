// Coletor do Gestor de Tráfego (Fase 1, somente leitura).
//
// Uma conta por vez. Para cada conta: lê tudo da plataforma PRIMEIRO e só então
// grava, numa transação. Falha de coleta nunca vira zero: o erro vai para
// last_sync_error, last_sync_at não avança e as métricas que já estavam no banco
// continuam como estavam. Quem lê a tela vê "sem atualização desde ...".
//
// Sem credencial da plataforma no ambiente a conta está "não conectada": não é
// erro, não grava nada e não mostra número.

import { createMetaAdsClient, getMetaAccessToken, mapMetaInsightRow } from "./metaAdsClient.js";
import {
  createGoogleAdsClient,
  getGoogleAdsCredentials,
  mapGoogleAdsRow,
  summarizeGoogleConversions,
} from "./googleAdsClient.js";

export const FIRST_LOAD_DAYS = 30;
// A plataforma revisa os números dos últimos dias; por isso toda coleta relê 7.
export const REFRESH_DAYS = 7;
export const DEFAULT_ACCOUNT_TIMEZONE = "America/Sao_Paulo";
const UPSERT_CHUNK = 500;
const MAX_ERROR_LENGTH = 500;

function isValidTimeZone(timeZone) {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Data (AAAA-MM-DD) de `date` no fuso informado. */
export function dateKeyInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Janela de coleta: os últimos `days` dias terminando hoje, no fuso da conta.
 * @returns {{ since: string, until: string }}
 */
export function resolveCollectionWindow({ now = new Date(), timeZone, days }) {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_ACCOUNT_TIMEZONE;
  const until = dateKeyInTimeZone(now, zone);
  const [year, month, day] = until.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day - (days - 1)));
  return { since: start.toISOString().slice(0, 10), until };
}

const UPSERT_SQL = `
  INSERT INTO public.traffic_metrics_daily (
    client_id, platform, external_account_id,
    campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
    objective, effective_status, date,
    spend, impressions, clicks, leads, messages_started, purchases, purchase_value,
    raw, collected_at
  )
  SELECT
    $1, $2, $3,
    r.campaign_id, r.campaign_name, r.adset_id, r.adset_name, r.ad_id, r.ad_name,
    r.objective, r.effective_status, r.date,
    r.spend, r.impressions, r.clicks, r.leads, r.messages_started, r.purchases, r.purchase_value,
    r.raw, $5
  FROM jsonb_to_recordset($4::jsonb) AS r(
    campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text,
    objective text, effective_status text, date date,
    spend numeric, impressions bigint, clicks bigint, leads integer, messages_started integer,
    purchases integer, purchase_value numeric, raw jsonb
  )
  ON CONFLICT (client_id, platform, ad_id, date) DO UPDATE SET
    external_account_id = EXCLUDED.external_account_id,
    campaign_id = EXCLUDED.campaign_id,
    campaign_name = EXCLUDED.campaign_name,
    adset_id = EXCLUDED.adset_id,
    adset_name = EXCLUDED.adset_name,
    ad_name = EXCLUDED.ad_name,
    objective = EXCLUDED.objective,
    effective_status = EXCLUDED.effective_status,
    spend = EXCLUDED.spend,
    impressions = EXCLUDED.impressions,
    clicks = EXCLUDED.clicks,
    leads = EXCLUDED.leads,
    messages_started = EXCLUDED.messages_started,
    purchases = EXCLUDED.purchases,
    purchase_value = EXCLUDED.purchase_value,
    raw = EXCLUDED.raw,
    collected_at = EXCLUDED.collected_at
`;

/**
 * Grava as linhas por upsert na chave (client_id, platform, ad_id, date).
 * Recebe um client de transação, não o pool.
 */
export async function upsertDailyMetrics(client, { clientId, platform, externalAccountId, rows, collectedAt }) {
  // Duas linhas com a mesma chave no mesmo comando fazem o Postgres recusar o
  // upsert inteiro. A última vence.
  const byKey = new Map();
  for (const row of rows) byKey.set(`${row.ad_id}|${row.date}`, row);
  const unique = Array.from(byKey.values());

  for (let start = 0; start < unique.length; start += UPSERT_CHUNK) {
    const chunk = unique.slice(start, start + UPSERT_CHUNK);
    await client.query(UPSERT_SQL, [clientId, platform, externalAccountId, JSON.stringify(chunk), collectedAt]);
  }
  return unique.length;
}

function describeError(err) {
  const message = String(err?.message || err || "erro desconhecido").replace(/\s+/g, " ").trim();
  return message.slice(0, MAX_ERROR_LENGTH);
}

/** Fonte de coleta da Meta: relatório por anúncio e por dia, mais o estado atual de cada anúncio. */
export function createMetaSource(client) {
  return {
    platform: "meta",
    fetchAccountInfo: (accountId) => client.fetchAccountInfo(accountId),
    async fetchRows(accountId, window) {
      const insights = await client.fetchAdInsights(accountId, window);
      const statuses = await client.fetchAdStatuses(accountId);
      const rows = [];
      for (const raw of insights) {
        const mapped = mapMetaInsightRow(raw);
        if (!mapped) continue;
        rows.push({ ...mapped, effective_status: statuses.get(mapped.ad_id) || null });
      }
      return rows;
    },
  };
}

/** Fonte de coleta do Google Ads: métricas por anúncio e por dia, mais as conversões por categoria. */
export function createGoogleSource(client) {
  return {
    platform: "google",
    fetchAccountInfo: (accountId) => client.fetchAccountInfo(accountId),
    async fetchRows(accountId, window) {
      const metrics = await client.fetchAdMetrics(accountId, window);
      const conversions = summarizeGoogleConversions(await client.fetchAdConversions(accountId, window));
      const rows = [];
      for (const raw of metrics) {
        const mapped = mapGoogleAdsRow(raw, conversions);
        if (mapped) rows.push(mapped);
      }
      return rows;
    },
  };
}

/**
 * Coleta uma conta. Nunca lança: devolve { ok } e deixa o resultado registrado
 * na própria conta. Lê TUDO da plataforma antes de gravar, e grava numa
 * transação: falha no meio não deixa a conta pela metade.
 *
 * @param {object} params
 * @param {{ query: Function, connect: Function }} params.pool
 * @param {object} params.account  Linha de traffic_accounts.
 * @param {{ platform: string, fetchAccountInfo: Function, fetchRows: Function }} params.source
 * @param {Date} [params.now]
 */
export async function collectAccount({ pool, account, source, now = new Date() }) {
  const firstLoad = !account.last_sync_at;
  const days = firstLoad ? FIRST_LOAD_DAYS : REFRESH_DAYS;

  try {
    const info = await source.fetchAccountInfo(account.external_account_id);
    const window = resolveCollectionWindow({ now, timeZone: info.timezone || account.timezone, days });
    const rows = await source.fetchRows(account.external_account_id, window);

    const db = await pool.connect();
    let saved = 0;
    try {
      await db.query("BEGIN");
      saved = await upsertDailyMetrics(db, {
        clientId: account.client_id,
        platform: source.platform,
        externalAccountId: account.external_account_id,
        rows,
        collectedAt: now,
      });
      await db.query(
        `UPDATE public.traffic_accounts
            SET last_sync_at = $2,
                last_sync_attempt_at = $2,
                last_sync_error = NULL,
                display_name = COALESCE($3, display_name),
                currency = COALESCE($4, currency),
                timezone = COALESCE($5, timezone),
                updated_at = $2
          WHERE id = $1 AND client_id = $6`,
        [account.id, now, info.name, info.currency, info.timezone, account.client_id]
      );
      await db.query("COMMIT");
    } catch (dbErr) {
      await db.query("ROLLBACK").catch(() => {});
      throw dbErr;
    } finally {
      db.release();
    }

    return { ok: true, accountId: account.id, clientId: account.client_id, rows: saved, window, firstLoad };
  } catch (err) {
    const error = describeError(err);
    try {
      await pool.query(
        `UPDATE public.traffic_accounts
            SET last_sync_attempt_at = $2, last_sync_error = $3, updated_at = $2
          WHERE id = $1 AND client_id = $4`,
        [account.id, now, error, account.client_id]
      );
    } catch (recordErr) {
      console.error("[traffic-collector] Não consegui registrar a falha de coleta:", describeError(recordErr));
    }
    console.warn(`[traffic-collector] Coleta falhou (conta ${account.id}, empresa ${account.client_id}): ${error}`);
    return { ok: false, accountId: account.id, clientId: account.client_id, error };
  }
}

/** Coleta uma conta da Meta (cliente de createMetaAdsClient). */
export function collectMetaAccount({ pool, account, client, now = new Date() }) {
  return collectAccount({ pool, account, source: createMetaSource(client), now });
}

/** Coleta uma conta do Google Ads (cliente de createGoogleAdsClient). */
export function collectGoogleAccount({ pool, account, client, now = new Date() }) {
  return collectAccount({ pool, account, source: createGoogleSource(client), now });
}

function emptyPlatformSummary() {
  return { connected: false, accounts: 0, ok: 0, failed: 0, results: [] };
}

async function collectPlatform({ pool, platform, source, now, summary }) {
  const { rows: accounts } = await pool.query(
    `SELECT id, client_id, platform, external_account_id, timezone, last_sync_at
       FROM public.traffic_accounts
      WHERE platform = $1 AND status = 'active'
      ORDER BY client_id, external_account_id`,
    [platform]
  );
  summary.accounts = accounts.length;

  for (const account of accounts) {
    const result = await collectAccount({ pool, account, source, now });
    summary.results.push(result);
    if (result.ok) summary.ok++;
    else summary.failed++;
  }
}

/**
 * Roda a coleta de todas as contas ativas, uma por vez: primeiro Meta, depois
 * Google. Plataforma sem credencial no ambiente fica "não conectada": sem
 * erro, sem número, nada é lido nem gravado para ela.
 *
 * @returns {Promise<{ meta: object, google: object }>} Por plataforma: { connected, accounts, ok, failed, results }.
 */
export async function runTrafficCollection({
  pool,
  now = new Date(),
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep,
} = {}) {
  if (!pool) throw new Error("Pool de banco indisponível para a coleta de tráfego.");

  const summary = { meta: emptyPlatformSummary(), google: emptyPlatformSummary() };
  const shared = { fetchImpl, env, ...(sleep ? { sleep } : {}) };

  const metaToken = getMetaAccessToken(env);
  if (metaToken) {
    summary.meta.connected = true;
    const source = createMetaSource(createMetaAdsClient({ token: metaToken, ...shared }));
    await collectPlatform({ pool, platform: "meta", source, now, summary: summary.meta });
  }

  const googleCredentials = getGoogleAdsCredentials(env);
  if (googleCredentials) {
    summary.google.connected = true;
    const source = createGoogleSource(createGoogleAdsClient({ credentials: googleCredentials, now: () => now, ...shared }));
    await collectPlatform({ pool, platform: "google", source, now, summary: summary.google });
  }

  return summary;
}
