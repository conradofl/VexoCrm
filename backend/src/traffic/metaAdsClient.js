// Cliente de LEITURA da Marketing API da Meta (Graph API). Fase 1 do Gestor de
// Tráfego: só GET. Nenhuma função aqui cria, pausa ou altera campanha, verba ou
// anúncio.
//
// Segredo: o token vem de variável de ambiente e viaja no cabeçalho
// Authorization, nunca na URL. A paginação é refeita com o cursor `after` em vez
// de seguir `paging.next`, porque esse link traz o token embutido. Nenhuma
// mensagem de erro deste arquivo inclui a URL nem o token.

export const META_TOKEN_ENV = "META_ADS_ACCESS_TOKEN";
export const META_API_VERSION_ENV = "META_GRAPH_API_VERSION";
// Em 15/11/2026 o servidor da Meta respondia de v21.0 a v27.0 (medido pelo
// cabeçalho facebook-api-version). v26.0 fica uma atrás da mais nova.
export const DEFAULT_META_API_VERSION = "v26.0";
export const META_GRAPH_BASE_URL = "https://graph.facebook.com";

const PAGE_LIMIT = 500;
const MAX_PAGES = 200;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 8_000];

// Códigos que a Meta usa para limite de requisições: 4 (aplicativo), 17
// (usuário), 32 (página), 613 (chamadas por hora) e a faixa 80000 a 80014
// (limite por conta de anúncios e por caso de uso).
const THROTTLE_CODES = new Set([4, 17, 32, 613]);

export const INSIGHTS_FIELDS = [
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "objective",
  "spend",
  "impressions",
  "clicks",
  "actions",
  "action_values",
];

export class MetaApiError extends Error {
  constructor(message, { status = null, code = null, subcode = null, transient = false } = {}) {
    super(message);
    this.name = "MetaApiError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.transient = transient;
  }
}

/** Token da Meta lido do ambiente. null quando não está configurado. */
export function getMetaAccessToken(env = process.env) {
  const token = String(env?.[META_TOKEN_ENV] || "").trim();
  return token || null;
}

export function isMetaConnected(env = process.env) {
  return getMetaAccessToken(env) !== null;
}

export function getMetaApiVersion(env = process.env) {
  const raw = String(env?.[META_API_VERSION_ENV] || "").trim();
  return /^v\d+\.\d+$/.test(raw) ? raw : DEFAULT_META_API_VERSION;
}

/**
 * Número da conta de anúncios, só dígitos. Aceita com ou sem "act_".
 * Qualquer outra coisa é recusada: o valor entra no caminho da URL.
 */
export function normalizeMetaAccountId(value) {
  const raw = String(value ?? "").trim().replace(/^act_/i, "");
  if (!/^\d{1,32}$/.test(raw)) {
    throw new MetaApiError("Identificador de conta de anúncios da Meta inválido.");
  }
  return raw;
}

function isThrottleCode(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return false;
  return THROTTLE_CODES.has(n) || (n >= 80000 && n <= 80014);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET na Graph API com espera e nova tentativa LIMITADA para limite de
 * requisições, erro 5xx e falha de rede. Só é seguro repetir porque toda chamada
 * daqui é leitura.
 */
async function graphGet(path, params, { token, fetchImpl, sleep, env, timeoutMs, maxAttempts }) {
  if (!token) {
    throw new MetaApiError("Conta da Meta não conectada: token ausente.");
  }

  const url = new URL(`${META_GRAPH_BASE_URL}/${getMetaApiVersion(env)}/${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });

      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (response.ok && body && !body.error) {
        return body;
      }

      const apiError = body?.error || {};
      const status = response.status;
      const transient =
        status === 429 || status >= 500 || apiError.is_transient === true || isThrottleCode(apiError.code);
      const detalhe = apiError.message
        ? `${apiError.message} (código ${apiError.code ?? "?"})`
        : `resposta HTTP ${status} sem corpo legível`;
      lastError = new MetaApiError(`Meta recusou a leitura: ${detalhe}`, {
        status,
        code: apiError.code ?? null,
        subcode: apiError.error_subcode ?? null,
        transient,
      });
    } catch (err) {
      if (err instanceof MetaApiError) {
        lastError = err;
      } else {
        const motivo = err?.name === "TimeoutError" || err?.name === "AbortError" ? "tempo esgotado" : "falha de rede";
        lastError = new MetaApiError(`Meta não respondeu: ${motivo}.`, { transient: true });
      }
    }

    if (!lastError.transient || attempt === maxAttempts) break;
    await sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
  }

  throw lastError;
}

async function graphGetAllPages(path, params, options) {
  const rows = [];
  let after = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await graphGet(path, { ...params, limit: PAGE_LIMIT, after }, options);
    if (Array.isArray(body.data)) rows.push(...body.data);

    const nextCursor = body.paging?.cursors?.after || null;
    if (!body.paging?.next || !nextCursor) return rows;
    after = nextCursor;
  }

  // Parar calado aqui gravaria uma conta pela metade como se fosse inteira.
  throw new MetaApiError(`Leitura da Meta passou de ${MAX_PAGES} páginas e foi interrompida.`);
}

export function createMetaAdsClient({
  token = getMetaAccessToken(),
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
} = {}) {
  const options = { token, fetchImpl, sleep, env, timeoutMs, maxAttempts };

  return {
    /** Nome, moeda e fuso da conta de anúncios. */
    async fetchAccountInfo(accountId) {
      const id = normalizeMetaAccountId(accountId);
      const body = await graphGet(`act_${id}`, { fields: "name,currency,timezone_name,account_status" }, options);
      return {
        name: body.name || null,
        currency: body.currency || null,
        timezone: body.timezone_name || null,
        accountStatus: body.account_status ?? null,
      };
    },

    /** Métricas por anúncio e por dia, entre `since` e `until` (AAAA-MM-DD, no fuso da conta). */
    async fetchAdInsights(accountId, { since, until }) {
      const id = normalizeMetaAccountId(accountId);
      return graphGetAllPages(
        `act_${id}/insights`,
        {
          level: "ad",
          time_increment: 1,
          time_range: JSON.stringify({ since, until }),
          fields: INSIGHTS_FIELDS.join(","),
        },
        options
      );
    },

    /** Estado atual de cada anúncio da conta: Map(ad_id -> effective_status). */
    async fetchAdStatuses(accountId) {
      const id = normalizeMetaAccountId(accountId);
      const rows = await graphGetAllPages(`act_${id}/ads`, { fields: "id,effective_status" }, options);
      return new Map(rows.filter((row) => row?.id).map((row) => [String(row.id), row.effective_status || null]));
    },
  };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function actionValue(list, types) {
  if (!Array.isArray(list)) return 0;
  for (const type of types) {
    const found = list.find((item) => item?.action_type === type);
    if (found) return toNumber(found.value);
  }
  return 0;
}

/**
 * Converte uma linha do relatório da Meta nas colunas de traffic_metrics_daily.
 *
 * Um tipo de ação por coluna, de propósito: a Meta devolve o mesmo evento em
 * vários tipos (lead, lead do pixel, lead agrupado) e somar todos conta em
 * dobro. A linha inteira vai em `raw`, então dá para recalcular depois sem
 * coletar de novo.
 *   - leads: "lead" (total de leads, dentro e fora da Meta).
 *   - messages_started: conversa iniciada por mensagem, janela de 7 dias.
 *   - purchases e purchase_value: "omni_purchase" e, na falta, "purchase".
 *
 * Devolve null para linha sem anúncio ou sem data: sem a chave não há onde gravar.
 */
export function mapMetaInsightRow(row) {
  const adId = row?.ad_id ? String(row.ad_id) : null;
  const date = typeof row?.date_start === "string" ? row.date_start.slice(0, 10) : null;
  if (!adId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  return {
    campaign_id: row.campaign_id ? String(row.campaign_id) : null,
    campaign_name: row.campaign_name || null,
    adset_id: row.adset_id ? String(row.adset_id) : null,
    adset_name: row.adset_name || null,
    ad_id: adId,
    ad_name: row.ad_name || null,
    objective: row.objective || null,
    date,
    spend: toNumber(row.spend),
    impressions: Math.round(toNumber(row.impressions)),
    clicks: Math.round(toNumber(row.clicks)),
    leads: Math.round(actionValue(row.actions, ["lead"])),
    messages_started: Math.round(actionValue(row.actions, ["onsite_conversion.messaging_conversation_started_7d"])),
    purchases: Math.round(actionValue(row.actions, ["omni_purchase", "purchase"])),
    purchase_value: actionValue(row.action_values, ["omni_purchase", "purchase"]),
    raw: row,
  };
}
