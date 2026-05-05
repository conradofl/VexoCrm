function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    )
  );
}

export function getAccessClientIds(access = {}) {
  return uniqueStrings([
    access.clientId,
    access.tenantId,
    access.clientIds,
    access.tenantIds,
  ]);
}

export function hasUserPermission(access = {}, permission) {
  return access.role === "internal" && (access.isAdmin || access.permissions?.includes(permission));
}

export function filterVisibleUserRecords(users = [], requesterAccess = {}) {
  if (requesterAccess.isAdmin) {
    return users;
  }

  const requesterClientIds = new Set(getAccessClientIds(requesterAccess));
  if (!requesterClientIds.size) {
    return [];
  }

  return users.filter((user) => {
    const userClientIds = getAccessClientIds(user.access);
    return userClientIds.some((clientId) => requesterClientIds.has(clientId));
  });
}

export function canManageTargetAccess(requesterAccess = {}, targetAccess = {}) {
  if (requesterAccess.role !== "internal") {
    return false;
  }

  if (requesterAccess.isAdmin) {
    return true;
  }

  if (!hasUserPermission(requesterAccess, "users.manage")) {
    return false;
  }

  if (targetAccess.isAdmin || targetAccess.accessPreset === "internal_admin") {
    return false;
  }

  const requesterClientIds = new Set(getAccessClientIds(requesterAccess));
  const targetClientIds = getAccessClientIds(targetAccess);

  return targetClientIds.length > 0 && targetClientIds.every((clientId) => requesterClientIds.has(clientId));
}

export function canAssignManagedAccess(requesterAccess = {}, managedAccess = {}) {
  if (requesterAccess.role !== "internal") {
    return false;
  }

  if (requesterAccess.isAdmin) {
    return true;
  }

  if (!hasUserPermission(requesterAccess, "users.manage")) {
    return false;
  }

  if (managedAccess.isAdmin || managedAccess.accessPreset === "internal_admin") {
    return false;
  }

  if (managedAccess.scopeMode !== "assigned_clients") {
    return false;
  }

  if (managedAccess.permissions?.includes("users.manage")) {
    return false;
  }

  const requesterClientIds = new Set(getAccessClientIds(requesterAccess));
  const managedClientIds = getAccessClientIds(managedAccess);

  return managedClientIds.length > 0 && managedClientIds.every((clientId) => requesterClientIds.has(clientId));
}
