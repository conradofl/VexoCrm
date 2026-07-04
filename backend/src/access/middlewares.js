// Access control middlewares (movidos de server.js — grupo A do mapa, Onda 3 Run B).
// Movimento puro: corpos idênticos aos de server.js.

import { sendError } from "../services/httpInfra.js";
import { getAuth, firebaseReady } from "../services/firebase.js";
import { buildAccessProfile } from "./claims.js";
import { canAccessAppView, hasInternalPageAccess } from "../accessGuards.js";
import { hasUserPermission } from "../userAccessScope.js";

export async function requireFirebaseAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return;
  }

  const token = authHeader.slice("Bearer ".length);

  if (!firebaseReady) {
    // Em modo de desenvolvimento local, podemos decodificar o payload do JWT do Firebase
    // sem validar a assinatura, permitindo testes locais funcionais sem serviceAccountKey configurado.
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payloadBuf = Buffer.from(parts[1], 'base64');
        const decoded = JSON.parse(payloadBuf.toString('utf8'));
        const accessProfile = buildAccessProfile(decoded);

        if (accessProfile.role === "client" && accessProfile.clientIds.length === 0) {
          sendError(
            res,
            403,
            "INVALID_CLIENT_SCOPE",
            "Client user is missing client scope",
            "Set the Firebase custom claim clientIds for this user"
          );
          return;
        }

        req.authUser = decoded;
        req.authAccess = accessProfile;
        next();
        return;
      }
    } catch (decodeError) {
      console.error("Local dev Firebase token decode failed:", decodeError);
    }

    sendError(
      res,
      500,
      "FIREBASE_NOT_CONFIGURED",
      "Firebase auth not configured",
      "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in backend env"
    );
    return;
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    const accessProfile = buildAccessProfile(decoded);

    if (accessProfile.role === "client" && accessProfile.clientIds.length === 0) {
      sendError(
        res,
        403,
        "INVALID_CLIENT_SCOPE",
        "Client user is missing client scope",
        "Set the Firebase custom claim clientIds for this user"
      );
      return;
    }

    req.authUser = decoded;
    req.authAccess = accessProfile;
    next();
  } catch (error) {
    console.error("Firebase token validation failed:", error);
    sendError(res, 401, "INVALID_TOKEN", "Invalid token");
  }
}

export function requireInternalAccess(req, res, next) {
  if (req.authAccess?.role !== "internal") {
    sendError(res, 403, "FORBIDDEN", "Forbidden");
    return;
  }

  next();
}

export function requireAdminAccess(req, res, next) {
  if (req.authAccess?.role !== "internal" || !req.authAccess?.isAdmin) {
    sendError(res, 403, "FORBIDDEN", "Admin permission required");
    return;
  }

  next();
}

export function requireUserManagementAccess(req, res, next) {
  if (req.authAccess?.role !== "internal") {
    sendError(res, 403, "FORBIDDEN", "Internal access required");
    return;
  }

  if (hasUserPermission(req.authAccess, "users.manage")) {
    next();
    return;
  }

  sendError(res, 403, "FORBIDDEN", "User management permission required");
}

export function requireInternalPageAccess(page) {
  return (req, res, next) => {
    const access = req.authAccess;

    if (access?.role !== "internal") {
      sendError(res, 403, "FORBIDDEN", "Internal access required");
      return;
    }

    if (hasInternalPageAccess(access, page)) {
      next();
      return;
    }

    sendError(res, 403, "FORBIDDEN", `Missing permission for page ${page}`);
  };
}

export function requireAnyInternalPageAccess(pages) {
  const normalizedPages = Array.isArray(pages) ? pages.filter(Boolean) : [];

  return (req, res, next) => {
    const access = req.authAccess;

    if (access?.role !== "internal") {
      sendError(res, 403, "FORBIDDEN", "Internal access required");
      return;
    }

    if (access.isAdmin || normalizedPages.some((page) => access.internalPages?.includes(page))) {
      next();
      return;
    }

    sendError(
      res,
      403,
      "FORBIDDEN",
      `Missing permission for pages ${normalizedPages.join(", ")}`
    );
  };
}

export function requireAppViewAccess(view) {
  return (req, res, next) => {
    const access = req.authAccess;

    if (!access || access.role === "pending") {
      sendError(res, 403, "PENDING_APPROVAL", "Your account is waiting for approval");
      return;
    }

    if (canAccessAppView(access, view)) {
      next();
      return;
    }

    sendError(res, 403, "FORBIDDEN", `Missing permission for view ${view}`);
  };
}
