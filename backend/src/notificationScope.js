function normalizeString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => normalizeString(value))
    .filter(Boolean);
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

export function canManageGlobalNotifications(access = {}) {
  if (!access) return false;
  return access.role === "internal" && access.isAdmin === true;
}

export function getAuthorizedNotificationClientIds(access = {}) {
  return uniq([
    normalizeString(access.clientId),
    normalizeString(access.tenantId),
    ...normalizeStringArray(access.clientIds),
    ...normalizeStringArray(access.tenantIds),
  ]);
}

export function getNotificationClientIds(notification = {}) {
  return uniq([
    normalizeString(notification.client_id),
    normalizeString(notification.clientId),
    normalizeString(notification.tenant_id),
    normalizeString(notification.tenantId),
    normalizeString(notification.company_id),
    normalizeString(notification.companyId),
  ]);
}

export function getNotificationUserIds(notification = {}) {
  return uniq([
    normalizeString(notification.user_id),
    normalizeString(notification.userId),
    normalizeString(notification.uid),
    normalizeString(notification.email)?.toLowerCase(),
  ]);
}

export function isNotificationVisibleToAccess(notification = {}, access = {}) {
  const safeAccess = access || {};

  if (canManageGlobalNotifications(safeAccess)) {
    return true;
  }

  if (safeAccess.role !== "internal") {
    return false;
  }

  const userTargets = getNotificationUserIds(notification);
  const currentUserTargets = uniq([
    normalizeString(safeAccess.uid),
    normalizeString(safeAccess.email)?.toLowerCase(),
  ]);

  if (
    userTargets.length > 0 &&
    currentUserTargets.some((target) => userTargets.includes(target))
  ) {
    return true;
  }

  const notificationClientIds = getNotificationClientIds(notification);
  if (notificationClientIds.length === 0) {
    return false;
  }

  const allowedClientIds = getAuthorizedNotificationClientIds(safeAccess);
  return notificationClientIds.some((clientId) => allowedClientIds.includes(clientId));
}

export function filterNotificationsForAccess(notifications = [], access = {}) {
  return notifications.filter((notification) =>
    isNotificationVisibleToAccess(notification, access)
  );
}

export function getVisibleNotificationIds(notifications = [], access = {}) {
  return filterNotificationsForAccess(notifications, access)
    .map((notification) => normalizeString(notification.id))
    .filter(Boolean);
}
