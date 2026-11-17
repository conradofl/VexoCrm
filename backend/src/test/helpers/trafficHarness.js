// Bancada dos testes do Gestor de Tráfego.
//
// - Banco: Postgres real em memória (pglite) com a MIGRATION DE PRODUÇÃO. O
//   schema não é reescrito no teste: é o arquivo .sql que vai para o deploy.
// - Meta: dublado só o fetch, que é o que sai do processo. O cliente, o coletor
//   e a gravação rodam de verdade.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteDb } from "./pgliteDb.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(__dirname, "../../..");

export const TRAFFIC_MIGRATION = readFileSync(
  resolve(BACKEND_ROOT, "supabase/migrations/20261115120000_create_traffic_tables.sql"),
  "utf8"
);

// Fase 2: verba, plano do dia e aprovação dupla.
export const TRAFFIC_PLANS_MIGRATION = readFileSync(
  resolve(BACKEND_ROOT, "supabase/migrations/20261116180000_create_traffic_plans.sql"),
  "utf8"
);

export async function createTrafficDb({ withPlans = true } = {}) {
  const db = await createPgliteDb();
  await db.exec(TRAFFIC_MIGRATION);
  if (withPlans) await db.exec(TRAFFIC_PLANS_MIGRATION);
  return db;
}

/** Objeto com .query e .connect no formato que o código de produção espera de um pool. Conta as conexões abertas. */
export function poolFor(db) {
  const stats = { connects: 0, releases: 0 };
  const client = {
    query: (sql, params) => db.query(sql, params),
    release: () => {
      stats.releases++;
    },
  };
  return {
    stats,
    query: client.query,
    connect: async () => {
      stats.connects++;
      return client;
    },
  };
}

export async function insertAccount(db, { clientId, externalAccountId, platform = "meta", status = "active" }) {
  const { rows } = await db.query(
    `INSERT INTO traffic_accounts (client_id, platform, external_account_id, status)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [clientId, platform, externalAccountId, status]
  );
  return rows[0];
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/**
 * Dublê do fetch da Graph API. `handler({ path, params, url, init })` devolve
 * { status, body } ou lança (falha de rede). Guarda todas as chamadas.
 */
export function createMetaFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    // "/v26.0/act_123/insights" -> "act_123/insights"
    const path = parsed.pathname.split("/").slice(2).join("/");
    const params = Object.fromEntries(parsed.searchParams.entries());
    const call = { url, path, params, init };
    calls.push(call);
    const result = await handler(call);
    return jsonResponse(result.status ?? 200, result.body);
  };
  return { fetchImpl, calls };
}

export function insightRow({
  adId,
  date,
  spend = "10.00",
  impressions = "1000",
  clicks = "20",
  actions = [],
  actionValues = [],
  campaignId = "c1",
  adsetId = "s1",
}) {
  return {
    campaign_id: campaignId,
    campaign_name: `Campanha ${campaignId}`,
    adset_id: adsetId,
    adset_name: `Conjunto ${adsetId}`,
    ad_id: adId,
    ad_name: `Anúncio ${adId}`,
    objective: "OUTCOME_LEADS",
    spend,
    impressions,
    clicks,
    actions,
    action_values: actionValues,
    date_start: date,
    date_stop: date,
  };
}

/**
 * Handler padrão: uma conta responde info, insights e estados conforme o mapa
 * `accounts[accountId] = { info, insights, ads, campaigns, adsets }`.
 */
export function metaHandlerFor(accounts) {
  return ({ path }) => {
    const [act, resource] = path.split("/");
    const account = accounts[act.replace(/^act_/, "")];
    if (!account) {
      return { status: 400, body: { error: { message: "Unsupported get request.", code: 100, type: "GraphMethodException" } } };
    }
    if (!resource) return { body: account.info || { name: "Conta", currency: "BRL", timezone_name: "America/Sao_Paulo" } };
    if (resource === "insights") return { body: { data: account.insights || [] } };
    if (resource === "ads") return { body: { data: account.ads || [] } };
    if (resource === "campaigns") return { body: { data: account.campaigns || [] } };
    if (resource === "adsets") return { body: { data: account.adsets || [] } };
    return { status: 404, body: { error: { message: "desconhecido", code: 803 } } };
  };
}
