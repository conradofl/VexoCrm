// Coletor do Gestor de Tráfego (Fase 1, somente leitura).
//
// Uma conta por vez. Para cada conta: lê tudo da plataforma PRIMEIRO e só então
// grava, numa transação. Falha de coleta nunca vira zero: o erro vai para
// last_sync_error, last_sync_at não avança e as métricas que já estavam no banco
// continuam como estavam. Quem lê a tela vê "sem atualização desde ...".
//
// Sem token no ambiente a conta está "não conectada": não é erro, não grava
// nada e não mostra número.

import { createMetaAdsClient, getMetaAccessToken, mapMetaInsightRow } from "./metaAdsClient.js";

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

/**
 * Coleta uma conta da Meta. Nunca lança: devolve { ok } e deixa o resultado
 * registrado na própria conta.
 *
 * @param {object} params
 * @param {{ query: Function, connect: Function }} params.pool
 * @param {object} params.account  Linha de traffic_accounts.
 * @param {object} params.client   Cliente da Meta (createMetaAdsClient).
 * @param {Date} [params.now]
 */
export async function collectMetaAccount({ pool, account, client, now = new Date() }) {
  const firstLoad = !account.last_sync_at;
  const days = firstLoad ? FIRST_LOAD_DAYS : REFRESH_DAYS;

  try {
    const info = await client.fetchAccountInfo(account.external_account_id);
    const window = resolveCollectionWindow({ now, timeZone: info.timezone || account.timezone, days });
    const insights = await client.fetchAdInsights(account.external_account_id, window);
    const statuses = await client.fetchAdStatuses(account.external_account_id);

    const rows = [];
    for (const raw of insights) {
      const mapped = mapMetaInsightRow(raw);
      if (!mapped) continue;
      rows.push({ ...mapped, effective_status: statuses.get(mapped.ad_id) || null });
    }

    const db = await pool.connect();
    let saved = 0;
    try {
      await db.query("BEGIN");
      saved = await upsertDailyMetrics(db, {
        clientId: account.client_id,
        platform: "meta",
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

/**
 * Roda a coleta de todas as contas ativas, uma por vez.
 *
 * @returns {Promise<{ meta: { connected: boolean, accounts: number, ok: number, failed: number, results: object[] } }>}
 */
export async function runTrafficCollection({
  pool,
  now = new Date(),
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep,
} = {}) {
  if (!pool) throw new Error("Pool de banco indisponível para a coleta de tráfego.");

  const summary = { meta: { connected: false, accounts: 0, ok: 0, failed: 0, results: [] } };

  const token = getMetaAccessToken(env);
  if (!token) {
    // Não conectada: sem erro e sem número. Nada é lido nem gravado.
    return summary;
  }
  summary.meta.connected = true;

  const { rows: accounts } = await pool.query(
    `SELECT id, client_id, platform, external_account_id, timezone, last_sync_at
       FROM public.traffic_accounts
      WHERE platform = 'meta' AND status = 'active'
      ORDER BY client_id, external_account_id`
  );
  summary.meta.accounts = accounts.length;

  const client = createMetaAdsClient({ token, fetchImpl, env, ...(sleep ? { sleep } : {}) });
  for (const account of accounts) {
    const result = await collectMetaAccount({ pool, account, client, now });
    summary.meta.results.push(result);
    if (result.ok) summary.meta.ok++;
    else summary.meta.failed++;
  }

  return summary;
}
