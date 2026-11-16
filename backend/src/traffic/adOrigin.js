// Gestor de Tráfego, PR 4a: origem do anúncio que trouxe o lead.
//
// Regra da spec (5.4): origem em campo próprio, nunca fabricada. Sem parâmetro
// de campanha na chegada, não há linha e o lead fica "sem registro".
//
// O que conta como prova de anúncio pago:
//   - gclid, gbraid ou wbraid (o Google só põe em clique de anúncio);
//   - identificador explícito de campanha, conjunto ou anúncio na URL;
//   - utm_medium de mídia paga (cpc, paid_social...).
// fbclid sozinho NÃO prova: o Facebook acrescenta fbclid em link de post
// orgânico também. Fica registrado, com paid = false.

import { normalizeLeadPhoneKey } from "../services/leadUpsert.js";

const TEXT_MAX = 200;
const CLICK_ID_MAX = 500;
const PATH_MAX = 300;

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const ID_KEYS = ["campaign_id", "adset_id", "ad_id"];
// Ordem = prioridade quando chega mais de um.
const CLICK_ID_KEYS = ["gclid", "gbraid", "wbraid", "fbclid"];
const GOOGLE_CLICK_IDS = new Set(["gclid", "gbraid", "wbraid"]);

export const AD_ATTRIBUTION_KEYS = [...UTM_KEYS, ...ID_KEYS, ...CLICK_ID_KEYS, "landing_path", "referrer"];

const PAID_MEDIUMS = new Set([
  "cpc",
  "ppc",
  "cpm",
  "cpv",
  "paid",
  "paid_social",
  "paidsocial",
  "paid-social",
  "paid_search",
  "paid-search",
  "ads",
  "ad",
  "display",
  "trafego_pago",
]);

// {{site_source_name}} da Meta devolve fb, ig, msg, an.
const META_SOURCES = new Set(["meta", "facebook", "fb", "instagram", "ig", "msg", "messenger", "an", "audience_network"]);
const GOOGLE_SOURCES = new Set(["google", "googleads", "google_ads", "google-ads", "adwords", "gads", "youtube"]);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function cleanText(value, max = TEXT_MAX) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(CONTROL_CHARS, "").trim();
  if (!text) return null;
  return text.slice(0, max);
}

/** Identificador de campanha, conjunto ou anúncio: só dígitos (Meta e Google usam números). */
function cleanId(value) {
  const text = cleanText(value, 40);
  return text && /^\d{1,30}$/.test(text) ? text : null;
}

function cleanClickId(value) {
  const text = cleanText(value, CLICK_ID_MAX);
  return text && /^[A-Za-z0-9_\-.~]+$/.test(text) ? text : null;
}

/** Só o caminho: consulta e âncora podem carregar dado pessoal. */
function cleanPath(value) {
  const text = cleanText(value, 2000);
  if (!text || !text.startsWith("/")) return null;
  const path = text.split(/[?#]/)[0];
  return path.slice(0, PATH_MAX) || null;
}

/** Só o domínio de quem mandou o visitante, nunca a URL inteira. */
function cleanReferrerHost(value) {
  const text = cleanText(value, 2000);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().slice(0, TEXT_MAX) || null;
  } catch {
    return null;
  }
}

function platformFromSource(source) {
  const key = String(source || "").toLowerCase();
  if (!key) return null;
  if (META_SOURCES.has(key)) return "meta";
  if (GOOGLE_SOURCES.has(key)) return "google";
  return null;
}

/**
 * Lê a origem de anúncio mandada pela página. Devolve null quando não há nenhum
 * parâmetro de campanha: aí não existe origem a gravar.
 * @param {unknown} input objeto com as chaves de AD_ATTRIBUTION_KEYS
 */
export function parseAdAttribution(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const utm = {};
  for (const key of UTM_KEYS) utm[key] = cleanText(input[key]);
  const ids = {};
  for (const key of ID_KEYS) ids[key] = cleanId(input[key]);
  const clicks = {};
  for (const key of CLICK_ID_KEYS) clicks[key] = cleanClickId(input[key]);

  const hasUtm = UTM_KEYS.some((key) => utm[key]);
  const hasId = ID_KEYS.some((key) => ids[key]);
  const clickKey = CLICK_ID_KEYS.find((key) => clicks[key]) || null;
  if (!hasUtm && !hasId && !clickKey) return null;

  let platform = null;
  if (clickKey) platform = GOOGLE_CLICK_IDS.has(clickKey) ? "google" : "meta";
  else platform = platformFromSource(utm.utm_source);

  const medium = String(utm.utm_medium || "").toLowerCase();
  const paid = Boolean((clickKey && GOOGLE_CLICK_IDS.has(clickKey)) || hasId || PAID_MEDIUMS.has(medium));

  const landingPath = cleanPath(input.landing_path);
  const referrerHost = cleanReferrerHost(input.referrer);

  const raw = {};
  for (const [key, value] of Object.entries({ ...utm, ...ids, ...clicks })) {
    if (value) raw[key] = value;
  }

  return {
    platform,
    paid,
    campaign_id: ids.campaign_id,
    adset_id: ids.adset_id,
    ad_id: ids.ad_id,
    click_id: clickKey ? clicks[clickKey] : null,
    click_id_type: clickKey,
    ...utm,
    landing_path: landingPath,
    referrer_host: referrerHost,
    raw,
  };
}

/**
 * O que vai para leads.lead_source. Só anúncio pago comprovado vira
 * "trafego_pago"; o resto não escreve nada (undefined = coluna intocada).
 */
export function leadSourceForAdOrigin(origin) {
  return origin?.paid ? "trafego_pago" : undefined;
}

/**
 * Grava a origem ligada ao lead do telefone. O lead já precisa existir (o
 * formulário grava o lead antes). Devolve o id da linha.
 */
export async function recordLeadAdOrigin(pool, { clientId, phone, channel, origin }) {
  if (!pool) throw new Error("Pool de banco indisponível");
  if (!origin) return null;
  // Mesma chave de telefone de upsertLeadByPhone, para achar o mesmo lead.
  const cleanPhone = normalizeLeadPhoneKey(phone);
  if (!clientId || !cleanPhone) throw new Error("Origem do anúncio sem empresa ou telefone");

  const lead = await pool.query(
    `SELECT id FROM public.leads
      WHERE client_id = $1 AND (telefone = $2 OR phone = $2 OR telefone = $3 OR phone = $3)
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
    [clientId, cleanPhone, `+${cleanPhone}`]
  );
  const leadId = lead.rows[0]?.id ?? null;

  const { rows } = await pool.query(
    `INSERT INTO public.lead_ad_origins (
        client_id, lead_id, phone, channel, platform, paid,
        campaign_id, adset_id, ad_id, click_id, click_id_type,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        landing_path, referrer_host, raw)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)
      RETURNING id`,
    [
      clientId,
      leadId,
      cleanPhone,
      channel,
      origin.platform,
      origin.paid === true,
      origin.campaign_id,
      origin.adset_id,
      origin.ad_id,
      origin.click_id,
      origin.click_id_type,
      origin.utm_source,
      origin.utm_medium,
      origin.utm_campaign,
      origin.utm_content,
      origin.utm_term,
      origin.landing_path,
      origin.referrer_host,
      JSON.stringify(origin.raw || {}),
    ]
  );
  return { id: rows[0]?.id ?? null, leadId };
}
