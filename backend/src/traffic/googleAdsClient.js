// Cliente de LEITURA da API do Google Ads (REST, consulta GAQL). Fase 1 do
// Gestor de Tráfego. A única chamada à API de anúncios é googleAds:search, que
// é POST por desenho da API mas só lê: nenhuma função aqui cria, pausa ou
// altera campanha, verba ou anúncio.
//
// Conferido na documentação oficial em 15/11/2026:
//   - versão v26;
//   - o token de desenvolvedor foi aposentado em 09/09/2026: o servidor ignora
//     o cabeçalho, então ele não é enviado. O nível de acesso vem do projeto do
//     Google Cloud dono da credencial;
//   - login-customer-id (só dígitos) é obrigatório quando a leitura passa pela
//     conta gerenciadora (MCC);
//   - search devolve páginas fixas de 10.000 linhas com nextPageToken.
//
// Credencial, por ordem de preferência (a do Google é conta de serviço):
//   1. conta de serviço: GOOGLE_ADS_SERVICE_ACCOUNT_EMAIL + GOOGLE_ADS_SERVICE_ACCOUNT_PRIVATE_KEY;
//   2. usuário: GOOGLE_ADS_CLIENT_ID + GOOGLE_ADS_CLIENT_SECRET + GOOGLE_ADS_REFRESH_TOKEN.
// Sem nenhuma das duas completa, a plataforma está "não conectada".
//
// Segredo: nenhuma mensagem de erro deste arquivo leva token, chave ou corpo
// da resposta do servidor de autenticação.

import crypto from "node:crypto";

export const GOOGLE_ADS_ENV = {
  serviceAccountEmail: "GOOGLE_ADS_SERVICE_ACCOUNT_EMAIL",
  serviceAccountKey: "GOOGLE_ADS_SERVICE_ACCOUNT_PRIVATE_KEY",
  clientId: "GOOGLE_ADS_CLIENT_ID",
  clientSecret: "GOOGLE_ADS_CLIENT_SECRET",
  refreshToken: "GOOGLE_ADS_REFRESH_TOKEN",
  loginCustomerId: "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  apiVersion: "GOOGLE_ADS_API_VERSION",
};
export const DEFAULT_GOOGLE_ADS_API_VERSION = "v26";
export const GOOGLE_ADS_BASE_URL = "https://googleads.googleapis.com";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

const MAX_PAGES = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 8_000];
const TRANSIENT_STATUS = new Set(["RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED"]);

export class GoogleAdsApiError extends Error {
  constructor(message, { status = null, code = null, transient = false } = {}) {
    super(message);
    this.name = "GoogleAdsApiError";
    this.status = status;
    this.code = code;
    this.transient = transient;
  }
}

function envValue(env, name) {
  return String(env?.[name] || "").trim();
}

/**
 * Credencial configurada, ou null. Não devolve nada pela metade: faltando uma
 * peça, é como se não houvesse credencial.
 */
export function getGoogleAdsCredentials(env = process.env) {
  const email = envValue(env, GOOGLE_ADS_ENV.serviceAccountEmail);
  // Chave colada em variável de ambiente costuma vir com \n literal.
  const privateKey = envValue(env, GOOGLE_ADS_ENV.serviceAccountKey).replace(/\\n/g, "\n");
  if (email && privateKey) return { type: "service_account", email, privateKey };

  const clientId = envValue(env, GOOGLE_ADS_ENV.clientId);
  const clientSecret = envValue(env, GOOGLE_ADS_ENV.clientSecret);
  const refreshToken = envValue(env, GOOGLE_ADS_ENV.refreshToken);
  if (clientId && clientSecret && refreshToken) return { type: "refresh_token", clientId, clientSecret, refreshToken };

  return null;
}

export function isGoogleAdsConnected(env = process.env) {
  return getGoogleAdsCredentials(env) !== null;
}

export function getGoogleAdsApiVersion(env = process.env) {
  const raw = envValue(env, GOOGLE_ADS_ENV.apiVersion);
  return /^v\d+$/.test(raw) ? raw : DEFAULT_GOOGLE_ADS_API_VERSION;
}

/**
 * Identificador de cliente do Google Ads: 10 dígitos. Aceita com hífens
 * (123-456-7890). Qualquer outra coisa é recusada: o valor entra na URL.
 */
export function normalizeGoogleCustomerId(value) {
  const raw = String(value ?? "").trim().replace(/-/g, "");
  if (!/^\d{10}$/.test(raw)) {
    throw new GoogleAdsApiError("Identificador de conta do Google Ads inválido.");
  }
  return raw;
}

function getLoginCustomerId(env) {
  const raw = envValue(env, GOOGLE_ADS_ENV.loginCustomerId);
  return raw ? normalizeGoogleCustomerId(raw) : null;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function serviceAccountAssertion({ email, privateKey }, now) {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: email, scope: GOOGLE_ADS_SCOPE, aud: GOOGLE_OAUTH_TOKEN_URL, iat, exp: iat + 3600 })
  );
  let signature;
  try {
    signature = crypto.createSign("RSA-SHA256").update(`${header}.${claims}`).sign(privateKey).toString("base64url");
  } catch {
    throw new GoogleAdsApiError("Chave da conta de serviço do Google Ads inválida.");
  }
  return `${header}.${claims}.${signature}`;
}

/** Troca a credencial por um token de acesso de curta duração. */
async function fetchAccessToken(credentials, { fetchImpl, timeoutMs, now }) {
  const params =
    credentials.type === "service_account"
      ? {
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: serviceAccountAssertion(credentials, now),
        }
      : {
          grant_type: "refresh_token",
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          refresh_token: credentials.refreshToken,
        };

  let response;
  let body = null;
  try {
    response = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    body = await response.json().catch(() => null);
  } catch {
    throw new GoogleAdsApiError("Google não respondeu ao pedido de autorização.", { transient: true });
  }

  const accessToken = typeof body?.access_token === "string" ? body.access_token : null;
  if (!response.ok || !accessToken) {
    // Só o código curto do erro (ex.: invalid_grant). O corpo pode trazer detalhe da credencial.
    const code = typeof body?.error === "string" ? body.error.slice(0, 60) : `HTTP ${response.status}`;
    throw new GoogleAdsApiError(`Google recusou a credencial de acesso (${code}).`, { status: response.status });
  }
  return accessToken;
}

export const AD_METRICS_QUERY_FIELDS = [
  "campaign.id",
  "campaign.name",
  "campaign.advertising_channel_type",
  "ad_group.id",
  "ad_group.name",
  "ad_group_ad.ad.id",
  "ad_group_ad.ad.name",
  "ad_group_ad.ad.type",
  "ad_group_ad.status",
  "segments.date",
  "metrics.cost_micros",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.conversions",
  "metrics.conversions_value",
];

export function buildAdMetricsQuery({ since, until }) {
  return `SELECT ${AD_METRICS_QUERY_FIELDS.join(", ")} FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`;
}

// Conversões por categoria, em consulta separada: a categoria da ação de
// conversão não pode ser pedida junto com custo, impressões e cliques.
export function buildAdConversionsQuery({ since, until }) {
  return (
    "SELECT ad_group_ad.ad.id, segments.date, segments.conversion_action_category, metrics.conversions, metrics.conversions_value " +
    `FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`
  );
}

export const ACCOUNT_INFO_QUERY = "SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1";

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new GoogleAdsApiError("Data inválida para a consulta do Google Ads.");
}

export function createGoogleAdsClient({
  credentials = getGoogleAdsCredentials(),
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  now = () => new Date(),
} = {}) {
  let accessTokenPromise = null;

  // Um token por coleta: vale 1 hora e a coleta inteira dura bem menos.
  function getAccessToken() {
    if (!credentials) return Promise.reject(new GoogleAdsApiError("Google Ads não conectado: credencial ausente."));
    if (!accessTokenPromise) {
      accessTokenPromise = fetchAccessToken(credentials, { fetchImpl, timeoutMs, now: now() }).catch((err) => {
        accessTokenPromise = null;
        throw err;
      });
    }
    return accessTokenPromise;
  }

  /** POST googleAds:search com espera e nova tentativa LIMITADA. Só é seguro repetir porque é leitura. */
  async function searchPage(customerId, body) {
    const url = `${GOOGLE_ADS_BASE_URL}/${getGoogleAdsApiVersion(env)}/customers/${customerId}/googleAds:search`;
    const loginCustomerId = getLoginCustomerId(env);

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const accessToken = await getAccessToken();
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        let payload = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        if (response.ok && payload && !payload.error) return payload;

        const apiError = payload?.error || {};
        const status = response.status;
        const transient = status === 429 || status >= 500 || TRANSIENT_STATUS.has(apiError.status);
        const detalhe = apiError.message
          ? `${apiError.message} (${apiError.status || `HTTP ${status}`})`
          : `resposta HTTP ${status} sem corpo legível`;
        lastError = new GoogleAdsApiError(`Google Ads recusou a leitura: ${detalhe}`, {
          status,
          code: apiError.status || null,
          transient,
        });
      } catch (err) {
        if (err instanceof GoogleAdsApiError) {
          lastError = err;
        } else {
          const motivo = err?.name === "TimeoutError" || err?.name === "AbortError" ? "tempo esgotado" : "falha de rede";
          lastError = new GoogleAdsApiError(`Google Ads não respondeu: ${motivo}.`, { transient: true });
        }
      }

      if (!lastError.transient || attempt === maxAttempts) break;
      await sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
    }
    throw lastError;
  }

  async function searchAll(customerId, query) {
    const rows = [];
    let pageToken = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const payload = await searchPage(customerId, { query, ...(pageToken ? { pageToken } : {}) });
      if (Array.isArray(payload.results)) rows.push(...payload.results);
      if (!payload.nextPageToken) return rows;
      pageToken = payload.nextPageToken;
    }
    // Parar calado aqui gravaria uma conta pela metade como se fosse inteira.
    throw new GoogleAdsApiError(`Leitura do Google Ads passou de ${MAX_PAGES} páginas e foi interrompida.`);
  }

  return {
    /** Nome, moeda e fuso da conta. */
    async fetchAccountInfo(accountId) {
      const id = normalizeGoogleCustomerId(accountId);
      const rows = await searchAll(id, ACCOUNT_INFO_QUERY);
      const customer = rows[0]?.customer || {};
      return {
        name: customer.descriptiveName || null,
        currency: customer.currencyCode || null,
        timezone: customer.timeZone || null,
      };
    },

    /** Métricas por anúncio e por dia entre `since` e `until` (AAAA-MM-DD, no fuso da conta). */
    async fetchAdMetrics(accountId, { since, until }) {
      const id = normalizeGoogleCustomerId(accountId);
      assertDate(since);
      assertDate(until);
      return searchAll(id, buildAdMetricsQuery({ since, until }));
    },

    /** Conversões por anúncio, dia e categoria da ação de conversão. */
    async fetchAdConversions(accountId, { since, until }) {
      const id = normalizeGoogleCustomerId(accountId);
      assertDate(since);
      assertDate(until);
      return searchAll(id, buildAdConversionsQuery({ since, until }));
    },
  };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Estado do anúncio no vocabulário que a tela já conhece (o da Meta).
const STATUS_MAP = { ENABLED: "ACTIVE", PAUSED: "PAUSED", REMOVED: "DELETED" };

// Categorias de ação de conversão contadas como lead e como compra. O resto
// (visita a página, download, rota até a loja...) não entra em coluna nenhuma;
// fica só em `raw`. A CONFERIR com a conta real da GD.
export const LEAD_CONVERSION_CATEGORIES = new Set([
  "SUBMIT_LEAD_FORM",
  "IMPORTED_LEAD",
  "PHONE_CALL_LEAD",
  "CONTACT",
  "REQUEST_QUOTE",
  "BOOK_APPOINTMENT",
  "SIGNUP",
  "QUALIFIED_LEAD",
  "CONVERTED_LEAD",
]);
export const PURCHASE_CONVERSION_CATEGORIES = new Set(["PURCHASE"]);

/**
 * Soma as conversões por (anúncio, dia) em leads e compras, pela categoria.
 * @returns {Map<string, { leads: number, purchases: number, purchase_value: number, byCategory: object }>}
 */
export function summarizeGoogleConversions(rows) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const adId = row?.adGroupAd?.ad?.id ? String(row.adGroupAd.ad.id) : null;
    const date = row?.segments?.date || null;
    const category = row?.segments?.conversionActionCategory || "UNKNOWN";
    if (!adId || !date) continue;

    const key = `${adId}|${date}`;
    if (!out.has(key)) out.set(key, { leads: 0, purchases: 0, purchase_value: 0, byCategory: {} });
    const entry = out.get(key);
    const conversions = toNumber(row.metrics?.conversions);
    const value = toNumber(row.metrics?.conversionsValue);

    entry.byCategory[category] = Math.round(((entry.byCategory[category] || 0) + conversions) * 100) / 100;
    if (LEAD_CONVERSION_CATEGORIES.has(category)) entry.leads += conversions;
    if (PURCHASE_CONVERSION_CATEGORIES.has(category)) {
      entry.purchases += conversions;
      entry.purchase_value += value;
    }
  }
  return out;
}

/**
 * Converte uma linha do Google Ads nas colunas de traffic_metrics_daily.
 *   - spend: cost_micros dividido por 1.000.000 (o Google manda em milionésimos);
 *   - adset_*: o grupo de anúncios é o equivalente do conjunto da Meta;
 *   - messages_started: o Google Ads não tem; fica 0;
 *   - leads, purchases e purchase_value: vêm de summarizeGoogleConversions.
 *
 * Devolve null para linha sem anúncio ou sem data.
 */
export function mapGoogleAdsRow(row, conversions = null) {
  const adId = row?.adGroupAd?.ad?.id ? String(row.adGroupAd.ad.id) : null;
  const date = typeof row?.segments?.date === "string" ? row.segments.date.slice(0, 10) : null;
  if (!adId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const conv = conversions?.get(`${adId}|${date}`) || null;
  const status = row.adGroupAd?.status || null;

  return {
    campaign_id: row.campaign?.id ? String(row.campaign.id) : null,
    campaign_name: row.campaign?.name || null,
    adset_id: row.adGroup?.id ? String(row.adGroup.id) : null,
    adset_name: row.adGroup?.name || null,
    ad_id: adId,
    ad_name: row.adGroupAd?.ad?.name || null,
    objective: row.campaign?.advertisingChannelType || null,
    effective_status: status ? STATUS_MAP[status] || status : null,
    date,
    spend: Math.round((toNumber(row.metrics?.costMicros) / 1_000_000) * 100) / 100,
    impressions: Math.round(toNumber(row.metrics?.impressions)),
    clicks: Math.round(toNumber(row.metrics?.clicks)),
    leads: Math.round(conv?.leads || 0),
    messages_started: 0,
    purchases: Math.round(conv?.purchases || 0),
    purchase_value: Math.round((conv?.purchase_value || 0) * 100) / 100,
    raw: conv ? { ...row, conversionsByCategory: conv.byCategory } : row,
  };
}
