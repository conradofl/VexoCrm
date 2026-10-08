// backend/src/services/smartLinks.js
// Serviço Central de Vexo Smart Links & Rastreamento de Cliques
// Gera URLs curtas com telemetria, detecção de dispositivo e substituição em mensagens.

import crypto from "crypto";

// Alfabeto base62 seguro sem caracteres ambíguos:
// Excluídos: '0' (zero), 'O' (ó maiúsculo), '1' (um), 'I' (i maiúsculo), 'l' (ele minúsculo)
export const SAFE_ALPHABET = "23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * Gera código alfanumérico seguro com base62 sem caracteres ambíguos.
 * @param {number} [length=6] - Tamanho do slug (padrão: 6)
 * @returns {string} Código alfanumérico
 */
export function generateLinkCode(length = 6) {
  const targetLength = Math.max(1, Number.isInteger(length) ? length : 6);
  let code = "";
  const alphabetLen = SAFE_ALPHABET.length;

  for (let i = 0; i < targetLength; i++) {
    const randomIndex = crypto.randomInt(0, alphabetLen);
    code += SAFE_ALPHABET[randomIndex];
  }

  return code;
}

/**
 * Identifica o tipo de dispositivo a partir do User-Agent.
 * @param {string|null|undefined} userAgent - String de cabeçalho User-Agent
 * @returns {'mobile'|'tablet'|'desktop'|'outro'}
 */
export function detectDeviceType(userAgent) {
  if (!userAgent || typeof userAgent !== "string") {
    return "outro";
  }

  const ua = userAgent.toLowerCase();

  // 1. Tablet (deve ser checado antes de mobile padrão para capturar iPads e tablets Android)
  if (/ipad|tablet|(android(?!.*mobi))|kindle|playbook/i.test(ua)) {
    return "tablet";
  }

  // 2. Mobile
  if (/mobi|iphone|ipod|android.*mobi|blackberry|opera mini|iemobile|wpdesktop/i.test(ua)) {
    return "mobile";
  }

  // 3. Desktop
  if (/windows nt|macintosh|mac os x|linux|cros/i.test(ua)) {
    return "desktop";
  }

  return "outro";
}

/**
 * Extrai dados de telemetria da requisição Express.
 * @param {object} req - Objeto Express Request
 * @returns {{ ipAddress: string|null, userAgent: string|null, referrer: string|null, deviceType: string }}
 */
export function extractClientTelemetry(req) {
  if (!req) {
    return {
      ipAddress: null,
      userAgent: null,
      referrer: null,
      deviceType: "outro",
    };
  }

  const xForwardedFor = req.headers?.["x-forwarded-for"];
  const ipAddress = (
    (typeof xForwardedFor === "string" ? xForwardedFor.split(",")[0].trim() : null) ||
    req.headers?.["cf-connecting-ip"] ||
    req.headers?.["x-real-ip"] ||
    req.socket?.remoteAddress ||
    req.ip ||
    null
  );

  const userAgent = (
    req.headers?.["user-agent"] ||
    (typeof req.get === "function" ? req.get("user-agent") : null) ||
    null
  );

  const referrer = (
    req.headers?.["referer"] ||
    req.headers?.["referrer"] ||
    (typeof req.get === "function" ? req.get("referrer") : null) ||
    null
  );

  const deviceType = detectDeviceType(userAgent);

  return { ipAddress, userAgent, referrer, deviceType };
}

/**
 * Cria um smart link no banco de dados com tratamento de colisão.
 * @param {object} pool - Pool de conexão Postgres
 * @param {object} params
 * @param {string} params.clientId - Identificador do tenant (obrigatório)
 * @param {string} params.destinationUrl - URL final para onde o lead será redirecionado
 * @param {string} [params.title] - Título ou rótulo opcional do link
 * @param {string} [params.campaignId] - UUID da campanha associada
 * @param {string} [params.leadId] - UUID do lead associado
 * @param {string} [params.dispatchId] - UUID do disparo
 * @param {string} [params.code] - Código pré-definido (opcional)
 * @returns {Promise<object>} Objeto do link criado com `code` e `url`
 */
export async function createSmartLink(pool, {
  clientId,
  destinationUrl,
  title = null,
  campaignId = null,
  leadId = null,
  dispatchId = null,
  code = null,
}) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("Pool de banco de dados é obrigatório para criar smart link");
  }
  if (!clientId || typeof clientId !== "string") {
    throw new Error("clientId é obrigatório para criar smart link (multi-tenant)");
  }
  if (!destinationUrl || typeof destinationUrl !== "string") {
    throw new Error("destinationUrl é obrigatória para criar smart link");
  }

  const cleanDestination = destinationUrl.trim();
  const maxAttempts = 10;
  let attempts = 0;
  let lastError = null;

  while (attempts < maxAttempts) {
    attempts++;
    const linkCode = (attempts === 1 && code) ? String(code).trim() : generateLinkCode(6);

    try {
      const { rows } = await pool.query(
        `INSERT INTO public.smart_links (
          client_id,
          code,
          destination_url,
          title,
          campaign_id,
          lead_id,
          dispatch_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          clientId,
          linkCode,
          cleanDestination,
          title ? String(title).trim() : null,
          campaignId || null,
          leadId || null,
          dispatchId || null,
        ]
      );

      const link = rows[0];
      return {
        ...link,
        url: `/l/${link.code}`,
        shortUrl: `/l/${link.code}`,
      };
    } catch (err) {
      // Postgres código 23505 = unique_violation
      if (
        err?.code === "23505" ||
        err?.message?.includes("idx_smart_links_code") ||
        err?.message?.includes("smart_links_code_key")
      ) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Falha ao gerar código único para smart link após ${maxAttempts} tentativas: ${lastError?.message || ""}`);
}

/**
 * Registra o clique no smart link com telemetria (executado de forma assíncrona).
 * Atualiza contadores do link e insere registro detalhado em smart_link_clicks.
 * @param {object} pool - Pool de conexão Postgres
 * @param {object} params
 * @param {object} params.link - Registro do smart_link
 * @param {object} params.req - Objeto da requisição HTTP (para extração de IP e User-Agent)
 * @returns {Promise<object|null>} Registro do clique inserido
 */
export async function recordLinkClick(pool, { link, req }) {
  if (!pool || typeof pool.query !== "function" || !link || !link.id) {
    return null;
  }

  const { ipAddress, userAgent, referrer, deviceType } = extractClientTelemetry(req);

  try {
    // 1. Atualizar contadores no smart_link
    await pool.query(
      `UPDATE public.smart_links
       SET clicks_count = clicks_count + 1,
           last_clicked_at = NOW(),
           first_clicked_at = COALESCE(first_clicked_at, NOW())
       WHERE id = $1`,
      [link.id]
    );

    // 2. Inserir telemetria em smart_link_clicks
    const { rows } = await pool.query(
      `INSERT INTO public.smart_link_clicks (
        link_id,
        client_id,
        lead_id,
        clicked_at,
        ip_address,
        user_agent,
        referrer,
        device_type
      ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
      RETURNING *`,
      [
        link.id,
        link.client_id,
        link.lead_id || null,
        ipAddress,
        userAgent,
        referrer,
        deviceType,
      ]
    );

    return rows[0] || null;
  } catch (err) {
    console.error(`[smartLinks] Erro ao registrar clique do link ${link.id}:`, err);
    throw err;
  }
}

/**
 * Verifica se a URL já é um link do encurtador Vexo.
 * @param {string} url - URL para checar
 * @param {string} [baseUrl] - URL base do CRM/aplicação
 * @returns {boolean}
 */
export function isVexoShortLink(url, baseUrl = "") {
  if (!url || typeof url !== "string") return false;

  if (baseUrl) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    if (url.startsWith(`${cleanBase}/l/`) || url.startsWith(`${cleanBase}/api/l/`)) {
      return true;
    }
  }

  try {
    const parsed = new URL(url);
    if (/^\/(api\/)?l\/[a-zA-Z0-9]+$/i.test(parsed.pathname)) {
      if (
        parsed.hostname.includes("vexoia.com") ||
        parsed.hostname.includes("vexo.com") ||
        parsed.hostname === "localhost" ||
        (baseUrl && parsed.host === new URL(baseUrl).host)
      ) {
        return true;
      }
    }
  } catch {
    // URL não parseável diretamente
  }

  return false;
}

/**
 * Substitui URLs comuns dentro do texto por smart links personalizados para o lead.
 * @param {object} pool - Pool de conexão Postgres
 * @param {object} params
 * @param {string} params.text - Mensagem com possíveis links
 * @param {string} params.clientId - Identificador do tenant
 * @param {string} [params.leadId] - UUID do lead
 * @param {string} [params.campaignId] - UUID da campanha
 * @param {string} [params.dispatchId] - UUID do disparo
 * @param {string} [params.baseUrl] - Base da URL pública (ex: https://crm.vexoia.com)
 * @returns {Promise<string>} Mensagem com URLs substituídas por smart links
 */
export async function wrapMessageUrlsWithSmartLinks(pool, {
  text,
  clientId,
  leadId = null,
  campaignId = null,
  dispatchId = null,
  baseUrl = "",
}) {
  if (!text || typeof text !== "string") {
    return text;
  }

  const URL_REGEX = /https?:\/\/[^\s]+/g;
  const matches = [...text.matchAll(URL_REGEX)];
  if (matches.length === 0) {
    return text;
  }

  const replacementMap = new Map();

  for (const match of matches) {
    const rawUrl = match[0];
    const punctuationMatch = rawUrl.match(/^(https?:\/\/[^\s]+?)([.,;:!?)">]*)$/);
    const cleanUrl = punctuationMatch ? punctuationMatch[1] : rawUrl;

    if (isVexoShortLink(cleanUrl, baseUrl)) {
      continue;
    }

    if (!replacementMap.has(cleanUrl)) {
      const smartLink = await createSmartLink(pool, {
        clientId,
        destinationUrl: cleanUrl,
        campaignId,
        leadId,
        dispatchId,
      });

      const formattedUrl = baseUrl
        ? `${baseUrl.replace(/\/+$/, "")}/l/${smartLink.code}`
        : `/l/${smartLink.code}`;

      replacementMap.set(cleanUrl, formattedUrl);
    }
  }

  if (replacementMap.size === 0) {
    return text;
  }

  return text.replace(URL_REGEX, (rawUrl) => {
    const punctuationMatch = rawUrl.match(/^(https?:\/\/[^\s]+?)([.,;:!?)">]*)$/);
    const cleanUrl = punctuationMatch ? punctuationMatch[1] : rawUrl;
    const trailingPunctuation = punctuationMatch ? punctuationMatch[2] : "";

    if (replacementMap.has(cleanUrl)) {
      return `${replacementMap.get(cleanUrl)}${trailingPunctuation}`;
    }
    return rawUrl;
  });
}
