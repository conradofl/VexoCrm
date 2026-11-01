import { resolveAuthorizedClientId } from "../../services/tenant.js";
import { sendError } from "../../services/httpInfra.js";

// MAPA EXPLÍCITO leads_clients.id → tenants.id (decisão do dono, 01/11/2026).
// Antes: ILIKE pelo nome de tenants e, sem casar, a primeira linha de tenants (LIMIT 1) sem
// ORDER BY. Funcionava por sorte, com uma linha só em tenants. Medido em produção 01/11 02:23Z:
// as 341 linhas gd_* + tenant_modules da Geração Digital estão no uuid-zero (que a migration
// 20260711091500 rebatizou 'LivPub'); nenhuma é da LivPub. O primeiro tenant novo podia virar o
// LIMIT 1 e esconder tudo. Agora o nome em tenants é só exibição e não decide nada.
// Tenant novo que precise de gd_*: entra aqui, com a chave de leads_clients.
export const GD_TENANT_UUID = "00000000-0000-0000-0000-000000000000";

const CLIENT_KEY_TO_TENANT_UUID = Object.freeze({
  "geracao-digital": GD_TENANT_UUID,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function tenantUuidForClientKey(clientKey) {
  const key = String(clientKey ?? "").trim();
  if (!key) return null;
  if (UUID_RE.test(key)) return key;
  return Object.hasOwn(CLIENT_KEY_TO_TENANT_UUID, key) ? CLIENT_KEY_TO_TENANT_UUID[key] : null;
}

// Chave sem mapa caía no LIMIT 1, que com uma linha só era a GD. Mantido igual, mas explícito e
// com um aviso por chave, para medir quem chega aqui antes de trocar por 404.
const unmappedWarned = new Set();
function fallbackToGd(clientKey, origem) {
  if (!unmappedWarned.has(clientKey)) {
    unmappedWarned.add(clientKey);
    console.warn(`[gd-tenant] client_id sem mapa caiu na Geração Digital origem=${origem} client_id=${clientKey}`);
  }
  return GD_TENANT_UUID;
}

// Rotas /api/gd/* (geracaoDigitalRoutes.js): sem client_id ou sem mapa → Geração Digital.
export async function resolveGdTenantUuid(clientKey) {
  if (!clientKey) return GD_TENANT_UUID;
  return tenantUuidForClientKey(clientKey) || fallbackToGd(String(clientKey), "gd-routes");
}

export async function resolveTenantUuid(req, res, providedClientId = null) {
  const clientKey = providedClientId || req.query?.client_id || req.body?.client_id;

  const allowedClientId = resolveAuthorizedClientId(req, res, clientKey);

  if (!allowedClientId) {
    return null;
  }

  const mapped = tenantUuidForClientKey(allowedClientId);
  if (mapped) {
    return mapped;
  }

  const authAccess = req.authAccess || {};
  if (authAccess.role === "internal" || authAccess.role === "admin") {
    return fallbackToGd(String(allowedClientId), "contracts");
  }

  if (!res.headersSent) {
    sendError(res, 404, "TENANT_NOT_FOUND", "Tenant not found or invalid client ID.");
  }
  return null;
}
