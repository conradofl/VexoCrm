import { describe, expect, it } from "vitest";
import {
  canAccessAppView,
  hasAccessPermission,
  hasClientViewAccess,
  hasInternalPageAccess,
} from "../accessGuards.js";

describe("access guard helpers", () => {
  it("keeps internal admin access to every internal page and permission", () => {
    const adminAccess = { role: "internal", isAdmin: true, internalPages: [], permissions: [] };

    expect(hasInternalPageAccess(adminAccess, "dashboard")).toBe(true);
    expect(hasAccessPermission(adminAccess, "tenants.manage")).toBe(true);
    expect(canAccessAppView(adminAccess, "planilhas")).toBe(true);
  });

  it("keeps internal page access scoped to declared pages", () => {
    const operatorAccess = {
      role: "internal",
      isAdmin: false,
      internalPages: ["leads"],
      permissions: [],
    };

    expect(hasInternalPageAccess(operatorAccess, "leads")).toBe(true);
    expect(hasInternalPageAccess(operatorAccess, "usuarios")).toBe(false);
  });

  it("keeps the existing empresas exception for internal managers with usuarios page", () => {
    const managerAccess = {
      role: "internal",
      isAdmin: false,
      accessPreset: "internal_manager",
      internalPages: ["usuarios"],
      permissions: ["users.view"],
    };

    expect(hasInternalPageAccess(managerAccess, "empresas")).toBe(true);
    expect(hasAccessPermission(managerAccess, "tenants.manage")).toBe(true);
  });

  it("keeps client view access separate from internal page access", () => {
    const clientAccess = {
      role: "client",
      allowedViews: ["dashboard"],
    };

    expect(hasClientViewAccess(clientAccess, "dashboard")).toBe(true);
    expect(hasInternalPageAccess(clientAccess, "dashboard")).toBe(false);
    expect(canAccessAppView(clientAccess, "dashboard")).toBe(true);
    expect(canAccessAppView(clientAccess, "whatsapp")).toBe(false);
  });
});
