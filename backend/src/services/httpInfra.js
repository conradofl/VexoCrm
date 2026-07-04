// Helpers puros de HTTP/infra (movidos de server.js — grupo I do mapa, Onda 3 Run A).
// Movimento puro: corpos idênticos aos de server.js na revisão 0ae005a.
//
// NOTA (desvio deliberado do mapa): validateN8nInboundBearer permanece em server.js
// porque depende de getLeadClientN8nSettings (grupo F, ainda não extraído — Run D).
// Movê-la criaria um novo ciclo server.js <-> httpInfra.js. Mover junto quando F for extraído.
//
// validateConversationMemoryPayload + MAX_CONVERSATION_BYTES vivem em ./leadImport.js
// (dependem de sanitizePhone; mantém o grafo de imports acíclico).

import { supabase, useDirectPostgres } from "./database.js";
import { normalizeString } from "../textNormalize.js";

export function sendError(res, status, code, message, details) {
  const body = {
    error: {
      code,
      message,
    },
  };
  if (details) {
    body.error.details = details;
  }
  res.status(status).json(body);
}

/** When true, INTERNAL_ERROR responses include a short `details` payload (for staging / temporary prod debugging). */
export function shouldExposeInternalErrorDetails() {
  const raw = String(process.env.EXPOSE_INTERNAL_ERROR_DETAILS || "").toLowerCase();
  return process.env.NODE_ENV !== "production" || raw === "1" || raw === "true" || raw === "yes";
}

/** Safe diagnostic object for 500 handlers (no stack traces unless non-production). */
export function internalErrorPayloadDetails(err) {
  if (!shouldExposeInternalErrorDetails()) return undefined;
  if (err instanceof Error) {
    const out = { cause: err.message, name: err.name };
    if (process.env.NODE_ENV !== "production" && err.stack) {
      out.stack = err.stack.split("\n").slice(0, 8).join("\n");
    }
    return out;
  }
  if (err && typeof err === "object") {
    const out = {};
    if ("message" in err) out.cause = String(err.message);
    if ("code" in err) out.code = String(err.code);
    if ("details" in err && err.details != null) out.pgDetails = err.details;
    if ("hint" in err && err.hint != null) out.hint = err.hint;
    if (Object.keys(out).length) return out;
  }
  return { cause: String(err) };
}

export function ensureDb(res) {
  if (!supabase) {
    sendError(
      res,
      500,
      "DATABASE_NOT_CONFIGURED",
      "Missing database configuration",
      useDirectPostgres
        ? "Set DATABASE_URL for Postgres (DB_DRIVER=postgres or unset DATA_SOURCE=supabase)"
        : "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or use DATABASE_URL with DB_DRIVER=postgres"
    );
    return false;
  }
  return true;
}

export function getRequestBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
}

export function isDuplicateKeyError(error) {
  const code = normalizeString(error?.code);
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();

  return code === "23505" || message.includes("duplicate key");
}

export function normalizeBool(value) {
  return value === true || value === "true" || value === "TRUE" || value === "1";
}

export function normalizeIsoDate(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export function isValidBase64(value) {
  if (!value || typeof value !== "string") return false;
  if (value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(value);
}

/** Global bearer for n8n-facing routes (POST/GET conversation-memory*, POST n8n-error-webhook). Env overrides; default matches legacy Edge. */
export function getN8nWebhookBearerSecret() {
  return normalizeString(process.env.N8N_WEBHOOK_SECRET) || "@Vexo2026";
}

export function requireN8nWebhookSecret(req, res, next) {
  const authHeader = req.headers.authorization;
  const expectedSecret = getN8nWebhookBearerSecret();

  if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return;
  }

  next();
}

/** Keep /health fast so Docker HEALTHCHECK does not kill the container when Postgres is slow or unreachable. */
export function getHealthPostgresPingBudgetMs() {
  const raw = Number.parseInt(String(process.env.HEALTH_PG_PING_TIMEOUT_MS || ""), 10);
  if (Number.isFinite(raw) && raw >= 500 && raw <= 20_000) return raw;
  return 12_000;
}

export async function postgresHealthPing(pool) {
  const budgetMs = getHealthPostgresPingBudgetMs();
  return await Promise.race([
    pool.query("select 1 as ok"),
    new Promise((_, reject) => {
      const id = setTimeout(() => reject(new Error("health_pg_ping_timeout")), budgetMs);
      if (typeof id.unref === "function") id.unref();
    }),
  ]);
}
