// backend/src/domains/auth/routes.js
// Movimento puro (extraído de registerAllDomainRoutes.js): 6 rotas admin/users +
// access-profiles e 1 rota POST /api/client-signup. Corpo dos handlers idêntico
// ao original — só muda de onde vêm as dependências (deps em vez de routeDeps
// destructure inline).

import { getAuth } from "firebase-admin/auth";
import {
  canAssignManagedAccess,
  canManageTargetAccess,
  filterVisibleUserRecords,
  hasUserPermission,
} from "../../userAccessScope.js";

export function registerAuthRoutes(app, deps) {
  const {
    ACCESS_PERMISSION_KEYS,
    INTERNAL_PAGE_KEYS,
    buildManagedClaims,
    ensureFirebaseUserAccessClaims,
    extractManagedAccessClaims,
    findAccessProfileByKey,
    firebaseReady,
    hasManagedAccessClaims,
    isFixedAdminIdentity,
    isValidManagedApprovalLevelInput,
    isValidManagedRoleInput,
    isValidManagedScopeInput,
    listAccessProfiles,
    listAllFirebaseUsers,
    mapAdminUserRecord,
    mergeManagedClaims,
    normalizeBool,
    normalizeRole,
    normalizeString,
    requireFirebaseAuth,
    requireInternalPageAccess,
    requireUserManagementAccess,
    resolveRequestedAccessProfile,
    sendError,
  } = deps;

  app.get("/api/admin/users", requireFirebaseAuth, requireInternalPageAccess("usuarios"), async (req, res) => {
    if (!hasUserPermission(req.authAccess, "users.view")) {
      sendError(res, 403, "FORBIDDEN", "User view permission required");
      return;
    }

    try {
      const users = await listAllFirebaseUsers();
      const mappedUsers = users.map(mapAdminUserRecord);

      res.json({
        items: filterVisibleUserRecords(mappedUsers, req.authAccess),
      });
    } catch (error) {
      console.error("admin users query error:", error);
      sendError(res, 500, "ADMIN_USERS_QUERY_FAILED", "Failed to query users");
    }
  });

  app.post("/api/admin/users/sync", requireFirebaseAuth, requireUserManagementAccess, async (req, res) => {
    try {
      const users = await listAllFirebaseUsers();
      const synced = [];
      const skipped = [];

      for (const user of users) {
        try {
          const result = await ensureFirebaseUserAccessClaims(user);
          if (result.synced) {
            synced.push(mapAdminUserRecord(result.user));
          } else {
            skipped.push(user.uid);
          }
        } catch (error) {
          skipped.push(user.uid);
          console.error("admin user sync item error:", {
            uid: user.uid,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const refreshedUsers = await listAllFirebaseUsers();
      const mappedUsers = refreshedUsers.map(mapAdminUserRecord);

      res.json({
        success: true,
        syncedCount: synced.length,
        skippedCount: skipped.length,
        synced,
        items: filterVisibleUserRecords(mappedUsers, req.authAccess),
      });
    } catch (error) {
      console.error("admin users sync error:", error);
      sendError(
        res,
        500,
        "ADMIN_USERS_SYNC_FAILED",
        error instanceof Error ? error.message : "Failed to sync Firebase users"
      );
    }
  });

  app.get("/api/admin/access-profiles", requireFirebaseAuth, requireInternalPageAccess("usuarios"), async (req, res) => {
    if (!hasUserPermission(req.authAccess, "users.view")) {
      sendError(res, 403, "FORBIDDEN", "User view permission required");
      return;
    }

    try {
      const items = await listAccessProfiles();
      res.json({ items });
    } catch (error) {
      console.error("access profiles query error:", error);
      sendError(
        res,
        500,
        "ACCESS_PROFILES_QUERY_FAILED",
        error instanceof Error ? error.message : "Failed to query access profiles"
      );
    }
  });

  app.patch("/api/admin/users/:uid/access", requireFirebaseAuth, requireUserManagementAccess, async (req, res) => {
    const uid = normalizeString(req.params.uid);
    const rawRole = normalizeString(req.body?.role);
    const role = normalizeRole(rawRole);

    if (!uid || !rawRole) {
      sendError(res, 400, "INVALID_BODY", "Missing uid or role");
      return;
    }

    if (!isValidManagedRoleInput(rawRole)) {
      sendError(res, 400, "INVALID_ROLE", "Unsupported role");
      return;
    }

    if (!isValidManagedScopeInput(req.body?.scopeMode ?? req.body?.tenantScope)) {
      sendError(res, 400, "INVALID_SCOPE_MODE", "Unsupported scope mode");
      return;
    }

    if (!isValidManagedApprovalLevelInput(req.body?.approvalLevel)) {
      sendError(res, 400, "INVALID_APPROVAL_LEVEL", "Unsupported approval level");
      return;
    }

    try {
      const auth = getAuth();
      const accessProfiles = await listAccessProfiles();
      const selectedProfile = resolveRequestedAccessProfile(accessProfiles, req.body?.accessPreset, role);

      if (req.body?.accessPreset && !findAccessProfileByKey(accessProfiles, req.body?.accessPreset)) {
        sendError(res, 400, "INVALID_ACCESS_PRESET", "Unsupported access preset");
        return;
      }

      const user = await auth.getUser(uid);
      const isTargetFixedAdmin = isFixedAdminIdentity({ uid: user.uid, email: user.email });
      const currentTargetAccess = extractManagedAccessClaims(user.customClaims || {}, {
        uid: user.uid,
        email: user.email,
      });

      if (!canManageTargetAccess(req.authAccess, currentTargetAccess)) {
        sendError(res, 403, "FORBIDDEN_USER_SCOPE", "You do not have permission to manage this user");
        return;
      }

      const managedClaims = isTargetFixedAdmin
        ? buildManagedClaims({
            role: "internal",
            accessPreset: "internal_admin",
            scopeMode: "all_clients",
            approvalLevel: "director",
            permissions: ACCESS_PERMISSION_KEYS,
            clientIds: req.body?.clientIds,
            tenantIds: req.body?.tenantIds,
            clientId: req.body?.clientId,
            tenantId: req.body?.tenantId,
            allowedViews: req.body?.allowedViews,
            companyName: req.body?.companyName,
            internalPages: INTERNAL_PAGE_KEYS,
          })
        : buildManagedClaims({
            role: selectedProfile?.role || role,
            accessPreset: selectedProfile?.key || req.body?.accessPreset,
            scopeMode: req.body?.scopeMode ?? req.body?.tenantScope ?? selectedProfile?.scopeMode,
            approvalLevel: req.body?.approvalLevel ?? selectedProfile?.approvalLevel,
            permissions: req.body?.permissions ?? selectedProfile?.permissions,
            clientIds: req.body?.clientIds,
            tenantIds: req.body?.tenantIds,
            clientId: req.body?.clientId,
            tenantId: req.body?.tenantId,
            allowedViews: req.body?.allowedViews ?? selectedProfile?.allowedViews,
            companyName: req.body?.companyName,
            internalPages: req.body?.internalPages ?? selectedProfile?.internalPages,
          });

      if (!canAssignManagedAccess(req.authAccess, managedClaims)) {
        sendError(res, 403, "FORBIDDEN_USER_SCOPE", "You cannot assign this user access scope");
        return;
      }

      if (isTargetFixedAdmin && typeof req.body?.disabled === "boolean" && req.body.disabled) {
        sendError(res, 400, "INVALID_BODY", "Fixed admin accounts cannot be disabled");
        return;
      }

      const mergedClaims = mergeManagedClaims(user.customClaims || {}, managedClaims);

      await auth.setCustomUserClaims(uid, mergedClaims);

      if (!isTargetFixedAdmin && typeof req.body?.disabled === "boolean") {
        await auth.updateUser(uid, { disabled: req.body.disabled });
      }

      const updatedUser = await auth.getUser(uid);

      res.json({
        item: mapAdminUserRecord(updatedUser),
      });
    } catch (error) {
      console.error("admin user access update error:", error);
      sendError(
        res,
        500,
        "ADMIN_USER_ACCESS_UPDATE_FAILED",
        error instanceof Error ? error.message : "Failed to update user access"
      );
    }
  });

  app.post("/api/admin/users", requireFirebaseAuth, requireUserManagementAccess, async (req, res) => {
    const email = normalizeString(req.body?.email)?.toLowerCase();
    const password = normalizeString(req.body?.password);
    const displayName = normalizeString(req.body?.displayName);
    const rawRole = normalizeString(req.body?.role);
    const role = normalizeRole(rawRole);
    const sendPasswordReset = normalizeBool(req.body?.sendPasswordReset);

    if (!email || !password || !rawRole) {
      sendError(res, 400, "INVALID_BODY", "Missing email, password or role");
      return;
    }

    if (!isValidManagedRoleInput(rawRole)) {
      sendError(res, 400, "INVALID_ROLE", "Unsupported role");
      return;
    }

    if (!isValidManagedScopeInput(req.body?.scopeMode ?? req.body?.tenantScope)) {
      sendError(res, 400, "INVALID_SCOPE_MODE", "Unsupported scope mode");
      return;
    }

    if (!isValidManagedApprovalLevelInput(req.body?.approvalLevel)) {
      sendError(res, 400, "INVALID_APPROVAL_LEVEL", "Unsupported approval level");
      return;
    }

    if (password.length < 8) {
      sendError(res, 400, "WEAK_PASSWORD", "Password must have at least 8 characters");
      return;
    }

    let managedClaims = null;

    try {
      const auth = getAuth();
      const accessProfiles = await listAccessProfiles();
      const selectedProfile = resolveRequestedAccessProfile(accessProfiles, req.body?.accessPreset, role);

      if (req.body?.accessPreset && !findAccessProfileByKey(accessProfiles, req.body?.accessPreset)) {
        sendError(res, 400, "INVALID_ACCESS_PRESET", "Unsupported access preset");
        return;
      }

      console.log("[DEBUG] /api/admin/users - Payload:", req.body);
      console.log("[DEBUG] /api/admin/users - Selected Profile:", selectedProfile);

      managedClaims = buildManagedClaims({
        role: selectedProfile?.role || role,
        accessPreset: selectedProfile?.key || req.body?.accessPreset,
        scopeMode: req.body?.scopeMode ?? req.body?.tenantScope ?? selectedProfile?.scopeMode,
        approvalLevel: req.body?.approvalLevel ?? selectedProfile?.approvalLevel,
        permissions: req.body?.permissions ?? selectedProfile?.permissions,
        clientIds: req.body?.clientIds,
        tenantIds: req.body?.tenantIds,
        clientId: req.body?.clientId,
        tenantId: req.body?.tenantId,
        allowedViews: req.body?.allowedViews ?? selectedProfile?.allowedViews,
        companyName: req.body?.companyName,
        internalPages: req.body?.internalPages ?? selectedProfile?.internalPages,
      });

      console.log("[DEBUG] /api/admin/users - Generated Managed Claims:", managedClaims);

      if (!canAssignManagedAccess(req.authAccess, managedClaims)) {
        sendError(res, 403, "FORBIDDEN_USER_SCOPE", "You cannot assign this user access scope");
        return;
      }

      const user = await auth.createUser({
        email,
        password,
        displayName: displayName || undefined,
      });

      await auth.setCustomUserClaims(user.uid, mergeManagedClaims({}, managedClaims));

      let passwordResetLink = null;
      if (sendPasswordReset) {
        passwordResetLink = await auth.generatePasswordResetLink(email);
      }

      const createdUser = await auth.getUser(user.uid);

      res.status(201).json({
        item: mapAdminUserRecord(createdUser),
        passwordResetLink,
      });
    } catch (error) {
      console.error("admin user create error:", error);
      const code = error?.code || "";

      if (code === "auth/email-already-exists") {
        try {
          const auth = getAuth();
          const existingUser = await auth.getUserByEmail(email);
          const existingAccess = extractManagedAccessClaims(existingUser.customClaims || {}, {
            uid: existingUser.uid,
            email: existingUser.email,
          });

          if (!canManageTargetAccess(req.authAccess, existingAccess) && hasManagedAccessClaims(existingUser.customClaims || {})) {
            sendError(res, 409, "EMAIL_ALREADY_EXISTS", "This email is already registered");
            return;
          }

          await auth.updateUser(existingUser.uid, {
            displayName: displayName || existingUser.displayName || undefined,
            disabled: normalizeBool(req.body?.disabled),
          });
          await auth.setCustomUserClaims(
            existingUser.uid,
            mergeManagedClaims(existingUser.customClaims || {}, managedClaims)
          );

          let passwordResetLink = null;
          if (sendPasswordReset) {
            passwordResetLink = await auth.generatePasswordResetLink(email);
          }

          const syncedUser = await auth.getUser(existingUser.uid);

          res.status(200).json({
            item: mapAdminUserRecord(syncedUser),
            passwordResetLink,
            syncedExisting: true,
          });
          return;
        } catch (syncError) {
          console.error("admin existing user sync error:", syncError);
          sendError(
            res,
            500,
            "ADMIN_USER_EXISTING_SYNC_FAILED",
            syncError instanceof Error ? syncError.message : "Failed to sync existing Firebase user"
          );
          return;
        }
      }

      sendError(
        res,
        500,
        "ADMIN_USER_CREATE_FAILED",
        error instanceof Error ? error.message : "Failed to create user"
      );
    }
  });

  app.delete("/api/admin/users/:uid", requireFirebaseAuth, requireUserManagementAccess, async (req, res) => {
    const uid = normalizeString(req.params?.uid);

    if (!uid) {
      sendError(res, 400, "INVALID_PARAM", "Missing user uid");
      return;
    }

    if (uid === req.authAccess?.uid) {
      sendError(res, 400, "SELF_DELETE_NOT_ALLOWED", "You cannot delete your own account");
      return;
    }

    try {
      const auth = getAuth();
      const user = await auth.getUser(uid);
      const targetAccess = extractManagedAccessClaims(user.customClaims || {}, {
        uid: user.uid,
        email: user.email,
      });

      if (!canManageTargetAccess(req.authAccess, targetAccess)) {
        sendError(res, 403, "FORBIDDEN_USER_SCOPE", "You do not have permission to delete this user");
        return;
      }

      if (isFixedAdminIdentity({ uid: user.uid, email: user.email })) {
        sendError(res, 400, "FIXED_ADMIN_DELETE_BLOCKED", "Fixed admin accounts cannot be deleted");
        return;
      }

      await auth.deleteUser(uid);

      res.json({
        success: true,
        uid,
      });
    } catch (error) {
      console.error("admin user delete error:", error);
      const code = error?.code || "";

      if (code === "auth/user-not-found") {
        sendError(res, 404, "USER_NOT_FOUND", "User not found");
        return;
      }
      sendError(
        res,
        500,
        "ADMIN_USER_DELETE_FAILED",
        error instanceof Error ? error.message : "Failed to delete user"
      );
    }
  });

  app.post("/api/client-signup", async (req, res) => {
    if (!firebaseReady) {
      sendError(
        res,
        500,
        "FIREBASE_NOT_CONFIGURED",
        "Firebase auth not configured"
      );
      return;
    }

    const name = normalizeString(req.body?.name);
    const companyName = normalizeString(req.body?.companyName);
    const email = normalizeString(req.body?.email)?.toLowerCase();
    const password = normalizeString(req.body?.password);

    if (!name || !companyName || !email || !password) {
      sendError(res, 400, "INVALID_BODY", "Missing name, companyName, email or password");
      return;
    }

    if (password.length < 8) {
      sendError(res, 400, "WEAK_PASSWORD", "Password must have at least 8 characters");
      return;
    }

    try {
      const auth = getAuth();
      const user = await auth.createUser({
        email,
        password,
        displayName: `${name} - ${companyName}`.slice(0, 100),
      });

      const managedClaims = buildManagedClaims({
        role: "pending",
        companyName,
      });

      await auth.setCustomUserClaims(user.uid, mergeManagedClaims({}, managedClaims));

      res.status(201).json({
        success: true,
        message: "Conta criada. Aguarde a liberacao do acesso pela equipe Vexo.",
      });
    } catch (error) {
      console.error("client signup error:", error);
      const code = error?.code || "";
      if (code === "auth/email-already-exists") {
        sendError(res, 409, "EMAIL_ALREADY_EXISTS", "This email is already registered");
        return;
      }

      sendError(res, 500, "CLIENT_SIGNUP_FAILED", "Failed to create client account");
    }
  });
}
