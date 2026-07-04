// Helpers puros de tenant/lead (movidos de server.js — grupo C do mapa Onda 3).
// Movimento puro: corpos idênticos aos de server.js na revisão 0ae005a.

import { randomUUID } from "crypto";
import { normalizeString } from "../textNormalize.js";

export function normalizeTenantKey(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const tenantKey = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 50);

  if (!tenantKey || tenantKey.length < 3) {
    return null;
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantKey)) {
    return null;
  }

  return tenantKey;
}

/**
 * Retorna o nome da tabela de leads para um clientId.
 * Padrão: leads_{clientId} com underscores (ex: leads_infinie, leads_outlier, leads_teste).
 * Valida estritamente para evitar SQL injection.
 */
export function leadsTableName(clientId) {
  return "leads";
}

export function normalizeHttpUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function getRequestId(req) {
  return (
    normalizeString(req.headers["x-request-id"]) ||
    normalizeString(req.headers["x-correlation-id"]) ||
    randomUUID()
  );
}

export function maskPhoneForLog(phone) {
  const normalized = normalizeString(phone);
  if (!normalized) return null;
  const lastDigits = normalized.slice(-4);
  return `${"*".repeat(Math.max(normalized.length - 4, 0))}${lastDigits}`;
}

export function getClientEnvSuffix(clientId) {
  const normalized = normalizeString(clientId);
  if (!normalized) return null;
  return normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseJsonEnvMap(name) {
  const raw = normalizeString(process.env[name]);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    console.warn("[campaign-direct-dispatch] invalid json env map", {
      env: name,
      error: error instanceof Error ? error.message : "invalid json",
    });
    return null;
  }
}
