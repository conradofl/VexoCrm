import { describe, expect, it } from "vitest";
import {
  canManageGlobalNotifications,
  filterNotificationsForAccess,
  getVisibleNotificationIds,
  isNotificationVisibleToAccess,
} from "../notificationScope.js";

const tenantAAccess = {
  uid: "user-a",
  email: "a@example.com",
  role: "internal",
  isAdmin: false,
  clientId: "tenant-a",
  clientIds: ["tenant-a"],
  tenantId: "tenant-a",
  tenantIds: ["tenant-a"],
};

const tenantBNotification = {
  id: "notification-b",
  title: "Erro tenant B",
  client_id: "tenant-b",
  read: false,
};

describe("notification tenant scope", () => {
  it("does not expose tenant B notifications to tenant A", () => {
    const visible = filterNotificationsForAccess(
      [
        { id: "notification-a", title: "Erro tenant A", client_id: "tenant-a", read: false },
        tenantBNotification,
      ],
      tenantAAccess
    );

    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("notification-a");
  });

  it("does not allow tenant A to mutate tenant B notifications", () => {
    expect(isNotificationVisibleToAccess(tenantBNotification, tenantAAccess)).toBe(false);
    expect(getVisibleNotificationIds([tenantBNotification], tenantAAccess)).toEqual([]);
  });

  it("blocks client users from protected notification scope", () => {
    const clientAccess = {
      ...tenantAAccess,
      role: "client",
    };

    expect(isNotificationVisibleToAccess({ id: "notification-a", client_id: "tenant-a" }, clientAccess))
      .toBe(false);
  });

  it("treats missing or invalid auth access as unauthorized", () => {
    expect(isNotificationVisibleToAccess({ id: "notification-a", client_id: "tenant-a" }, null))
      .toBe(false);
  });

  it("keeps global notifications restricted to real internal admins", () => {
    const globalNotification = { id: "global", title: "Erro operacional", read: false };
    const adminAccess = { role: "internal", isAdmin: true };

    expect(isNotificationVisibleToAccess(globalNotification, tenantAAccess)).toBe(false);
    expect(isNotificationVisibleToAccess(globalNotification, adminAccess)).toBe(true);
    expect(canManageGlobalNotifications(adminAccess)).toBe(true);
  });

  it("allows a notification targeted directly to the authenticated user", () => {
    const userNotification = {
      id: "user-notification",
      title: "Aviso individual",
      user_id: "user-a",
      read: false,
    };

    expect(isNotificationVisibleToAccess(userNotification, tenantAAccess)).toBe(true);
  });
});
