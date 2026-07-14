import { pgDatabasePool as db } from "../../services/database.js";
import { resolveAuthorizedClientId } from "../../services/tenant.js";
import { sendError } from "../../services/httpInfra.js";

export async function resolveTenantUuid(req, res, providedClientId = null) {
  const clientKey = providedClientId || req.query.client_id || req.body.client_id;
  
  const allowedClientId = resolveAuthorizedClientId(req, res, clientKey);
  
  if (!allowedClientId) {
    return null; 
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
  if (uuidRegex.test(allowedClientId)) {
    return allowedClientId;
  }

  const { rows: tenantRes } = await db.query(
    "SELECT id FROM public.tenants WHERE name ILIKE $1 LIMIT 1",
    [allowedClientId]
  );
  if (tenantRes.length > 0) {
    return tenantRes[0].id;
  }

  const authAccess = req.authAccess || {};
  if (authAccess.role === "internal" || authAccess.role === "admin") {
    const { rows: firstTenant } = await db.query("SELECT id FROM public.tenants LIMIT 1");
    if (firstTenant.length > 0) {
      return firstTenant[0].id;
    }
  }

  if (!res.headersSent) {
    sendError(res, 404, "TENANT_NOT_FOUND", "Tenant not found or invalid client ID.");
  }
  return null;
}
