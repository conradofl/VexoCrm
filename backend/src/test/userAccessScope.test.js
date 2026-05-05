import { describe, expect, it } from "vitest";
import {
  canAssignManagedAccess,
  canManageTargetAccess,
  filterVisibleUserRecords,
  hasUserPermission,
} from "../userAccessScope.js";

const tenantManager = {
  role: "internal",
  isAdmin: false,
  accessPreset: "internal_manager",
  scopeMode: "assigned_clients",
  clientIds: ["tenant-a"],
  permissions: ["users.view", "users.manage"],
};

describe("user access tenant scope", () => {
  it("filters user listings to the requester tenant", () => {
    const users = [
      { uid: "a", access: { role: "client", clientIds: ["tenant-a"] } },
      { uid: "b", access: { role: "client", clientIds: ["tenant-b"] } },
      { uid: "pending", access: { role: "pending", clientIds: [] } },
    ];

    expect(filterVisibleUserRecords(users, tenantManager).map((user) => user.uid)).toEqual(["a"]);
  });

  it("prevents scoped managers from managing users outside their tenant", () => {
    const target = { role: "client", clientIds: ["tenant-b"], permissions: [] };

    expect(canManageTargetAccess(tenantManager, target)).toBe(false);
  });

  it("prevents scoped managers from assigning global admin access", () => {
    const requestedAccess = {
      role: "internal",
      isAdmin: true,
      accessPreset: "internal_admin",
      scopeMode: "all_clients",
      clientIds: [],
      permissions: ["users.manage"],
    };

    expect(canAssignManagedAccess(tenantManager, requestedAccess)).toBe(false);
  });

  it("allows an authorized scoped manager to assign non-elevated access inside their tenant", () => {
    const requestedAccess = {
      role: "client",
      isAdmin: false,
      accessPreset: "client_operator",
      scopeMode: "assigned_clients",
      clientIds: ["tenant-a"],
      permissions: [],
    };

    expect(hasUserPermission(tenantManager, "users.manage")).toBe(true);
    expect(canAssignManagedAccess(tenantManager, requestedAccess)).toBe(true);
  });
});
