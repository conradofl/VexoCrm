// Politica de CORS em UM lugar so.
//
// Ate aqui a lista de origens permitidas vivia dentro de server.js, visivel
// apenas para o middleware cors(). Quem responde erro (sendError, em
// httpInfra.js) nao tinha como saber se a origem era permitida — e a tentativa
// de consertar isso refletindo `req.headers.origin` cru devolveria
// Access-Control-Allow-Origin para QUALQUER site, com Allow-Credentials: true,
// justamente nas respostas que carregam detalhe de erro.
//
// Aqui a decisao e uma so, e as duas pontas perguntam para ela.

function normalizeCorsOrigin(value) {
  if (value == null || typeof value !== "string") return "";
  const t = value.trim();
  if (!t) return "";
  return t.replace(/\/+$/u, "");
}

// Origens do Vexo Scout (extensao) e das redes onde ele roda.
const SUFIXOS_CONFIAVEIS = ["instagram.com", "linkedin.com", "facebook.com", "tiktok.com"];

let politica = {
  allowAny: false,
  origens: [],
};

/**
 * Identifica se uma rota HTTP e intencionalmente publica (ex: /api/public/leads/capture,
 * /api/public/diagnostico, /api/public/landing-pages/telemetry).
 * Rotas publicas aceitam requisicoes de qualquer origem sem credenciais.
 */
export function isPublicApiRoute(pathname) {
  if (typeof pathname !== "string") return false;
  const clean = pathname.split("?")[0].trim().toLowerCase();
  return clean.startsWith("/api/public/");
}

/**
 * Chamado uma vez no boot, por server.js, com a lista ja resolvida.
 * Mantem o comportamento existente: server.js continua dono do parse do env.
 */
export function configureCorsPolicy({ allowAny, origens }) {
  politica = {
    allowAny: Boolean(allowAny),
    origens: [...new Set((origens || []).map(normalizeCorsOrigin).filter(Boolean))],
  };
  return politica;
}

export function isAllowedCorsOrigin(origin, pathname = "") {
  if (pathname && isPublicApiRoute(pathname)) return true;
  if (!origin) return false;
  if (politica.allowAny) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  if (SUFIXOS_CONFIAVEIS.some((dominio) => origin.includes(dominio))) return true;
  return politica.origens.includes(normalizeCorsOrigin(origin));
}

/**
 * Fabrica de delegado do middleware cors().
 * Rotas publicas (/api/public/*): origin: true, credentials: false.
 * Demais rotas: lista fechada com origin callback seguro e credentials: true.
 */
export function createCorsOptionsDelegate({ allowAny, corsOrigins } = {}) {
  return function corsOptionsDelegate(req, callback) {
    const pathname = req.path || req.url || "";
    if (isPublicApiRoute(pathname)) {
      callback(null, {
        origin: true,
        credentials: false,
      });
      return;
    }

    const isAnyAllowed = allowAny !== undefined ? Boolean(allowAny) : politica.allowAny;
    const originsList = corsOrigins !== undefined
      ? corsOrigins.map(normalizeCorsOrigin).filter(Boolean)
      : politica.origens;

    callback(null, {
      credentials: true,
      origin(origin, originCallback) {
        if (!origin || isAnyAllowed) {
          originCallback(null, true);
          return;
        }
        if (
          origin.startsWith("chrome-extension://") ||
          SUFIXOS_CONFIAVEIS.some((dominio) => origin.includes(dominio))
        ) {
          originCallback(null, true);
          return;
        }
        const normalized = normalizeCorsOrigin(origin);
        if (originsList.includes(normalized)) {
          originCallback(null, true);
          return;
        }
        console.warn(
          "[cors] Blocked browser Origin:",
          origin,
          "(normalized:",
          normalized + ")",
          "| Ensure this normalized value is covered by CORS_ORIGINS or FRONTEND_ORIGIN in EasyPanel."
        );
        originCallback(null, false);
      },
    });
  };
}

/**
 * Garante os cabecalhos de CORS numa resposta. Idempotente: se o middleware
 * cors() ja escreveu, nao mexe.
 *
 * Em rotas publicas (/api/public/*), reflete a origem informada sem credenciais.
 * Em rotas normais, so reflete origem que a politica aprova (com credentials: true)
 * — origem desconhecida sai sem cabecalho, que e o comportamento correto do CORS.
 */
export function applyCorsHeaders(res, origin) {
  if (!res || typeof res.setHeader !== "function") return false;
  if (res.headersSent) return false;
  if (res.getHeader("Access-Control-Allow-Origin")) return true;

  const pathname = res?.req?.path || res?.req?.url || "";
  if (isPublicApiRoute(pathname)) {
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    return true;
  }

  if (!isAllowedCorsOrigin(origin)) return false;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, sentry-trace, baggage"
  );
  return true;
}

export { normalizeCorsOrigin };
