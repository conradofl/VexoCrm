export function hasInternalPageAccess(access, page) {
  if (access?.role !== "internal") {
    return false;
  }

  if (access.isAdmin || access.internalPages?.includes(page)) {
    return true;
  }

  return (
    page === "empresas" &&
    access.accessPreset === "gestor" &&
    access.internalPages?.includes("usuarios")
  );
}

export function hasClientViewAccess(access, view) {
  return access?.role === "client" && access.allowedViews?.includes(view);
}

export function hasAccessPermission(access, permission) {
  if (access?.role !== "internal") {
    return false;
  }

  if (access.isAdmin || access.permissions?.includes(permission)) {
    return true;
  }

  return (
    permission === "tenants.manage" &&
    access.accessPreset === "gestor" &&
    access.internalPages?.includes("usuarios") &&
    access.permissions?.includes("users.view")
  );
}

export function canAccessAppView(access, view) {
  return hasInternalPageAccess(access, view) || hasClientViewAccess(access, view);
}
