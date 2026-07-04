// Notification scope/visibility helpers (movidos de server.js — grupo B do mapa, Onda 3 Run B).
// Movimento puro: corpos idênticos aos de server.js.
// ATENCAO: as versões canônicas usadas em runtime vieram do server.js e divergem deliberadamente
// das homônimas em ../notificationScope.js (pendência de unificação — ver mapa-server.md).

import { normalizeString } from "../textNormalize.js";
import { sendError } from "../services/httpInfra.js";
import { canAccessAppView, hasAccessPermission, hasInternalPageAccess } from "../accessGuards.js";
import { normalizeStringArray } from "./claims.js";

export function canManageGlobalNotifications(access) {
  if (access?.role !== "internal") {
    return false;
  }

  return (
    access.isAdmin ||
    hasAccessPermission(access, "users.manage") ||
    hasAccessPermission(access, "tenants.manage")
  );
}

export function normalizeNotificationScopeValues(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }

  const singleValue = normalizeString(value);
  return singleValue ? [singleValue] : [];
}

export function matchesNotificationClientScope(notification, access) {
  const notificationClientIds = Array.from(
    new Set([
      ...normalizeNotificationScopeValues(notification?.client_id),
      ...normalizeNotificationScopeValues(notification?.clientId),
      ...normalizeNotificationScopeValues(notification?.tenant_id),
      ...normalizeNotificationScopeValues(notification?.tenantId),
      ...normalizeNotificationScopeValues(notification?.client_ids),
      ...normalizeNotificationScopeValues(notification?.clientIds),
      ...normalizeNotificationScopeValues(notification?.tenant_ids),
      ...normalizeNotificationScopeValues(notification?.tenantIds),
    ])
  );

  if (notificationClientIds.length === 0) {
    return true;
  }

  if (access?.role !== "internal") {
    return false;
  }

  if (access.isAdmin || access.scopeMode === "all_clients") {
    return true;
  }

  const accessClientIds = new Set(normalizeStringArray(access.clientIds || access.tenantIds || []));
  if (accessClientIds.size === 0) {
    return false;
  }

  return notificationClientIds.some((clientId) => accessClientIds.has(clientId));
}

export function matchesNotificationInternalScope(notification, access) {
  const requiredPages = Array.from(
    new Set([
      ...normalizeNotificationScopeValues(notification?.internal_page),
      ...normalizeNotificationScopeValues(notification?.internalPage),
      ...normalizeNotificationScopeValues(notification?.internal_pages),
      ...normalizeNotificationScopeValues(notification?.internalPages),
      ...normalizeNotificationScopeValues(notification?.target_page),
      ...normalizeNotificationScopeValues(notification?.targetPage),
      ...normalizeNotificationScopeValues(notification?.target_pages),
      ...normalizeNotificationScopeValues(notification?.targetPages),
    ])
  );
  const requiredPermissions = Array.from(
    new Set([
      ...normalizeNotificationScopeValues(notification?.permission),
      ...normalizeNotificationScopeValues(notification?.permissions),
      ...normalizeNotificationScopeValues(notification?.target_permission),
      ...normalizeNotificationScopeValues(notification?.targetPermission),
      ...normalizeNotificationScopeValues(notification?.target_permissions),
      ...normalizeNotificationScopeValues(notification?.targetPermissions),
    ])
  );

  if (requiredPages.length === 0 && requiredPermissions.length === 0) {
    return true;
  }

  if (access?.role !== "internal") {
    return false;
  }

  if (access.isAdmin) {
    return true;
  }

  if (requiredPages.some((page) => hasInternalPageAccess(access, page))) {
    return true;
  }

  if (requiredPermissions.some((permission) => hasAccessPermission(access, permission))) {
    return true;
  }

  return false;
}

export function isNotificationVisibleToAccess(notification, access) {
  if (!notification || access?.role !== "internal") {
    return false;
  }

  return (
    matchesNotificationClientScope(notification, access) &&
    matchesNotificationInternalScope(notification, access)
  );
}

export function filterNotificationsForAccess(items, access) {
  return (Array.isArray(items) ? items : []).filter((item) =>
    isNotificationVisibleToAccess(item, access)
  );
}

export function getVisibleNotificationIds(items, access) {
  return filterNotificationsForAccess(items, access)
    .map((item) => item?.id)
    .filter(Boolean);
}

export function ensureSharedRoutePageAccess(req, res, page) {
  const access = req.authAccess;

  if (access?.role === "pending") {
    sendError(res, 403, "PENDING_APPROVAL", "Your account is waiting for approval");
    return false;
  }

  if (canAccessAppView(access, page)) {
    return true;
  }

  sendError(res, 403, "FORBIDDEN", `Missing permission for view ${page}`);
  return false;
}
