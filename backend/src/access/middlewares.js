// Access control middlewares (movidos de server.js — grupo A do mapa, Onda 3 Run B).
// Movimento puro: corpos idênticos aos de server.js.

import { sendError } from "../services/httpInfra.js";
import { getAuth, firebaseReady } from "../services/firebase.js";
import { buildAccessProfile } from "./claims.js";
import { canAccessAppView, hasInternalPageAccess } from "../accessGuards.js";
import { hasUserPermission } from "../userAccessScope.js";
import { accessHasPagePermission, accessHasViewPermission } from "./permissionsRegistry.js";
import { applyModularPlanGate } from "./modularGate.js";

export async function requireFirebaseAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return;
  }

  const token = authHeader.slice("Bearer ".length);

  if (!firebaseReady) {
    // Em desenvolvimento local, decodifica o payload do JWT do Firebase sem validar a assinatura, para testar sem
    // serviceAccountKey. Em produção (NODE_ENV=production, definido no Dockerfile) isso deixaria entrar qualquer token
    // forjado: cai direto no 500 de "Firebase não configurado".
    const aceitaTokenSemAssinatura = process.env.NODE_ENV !== "production";
    if (aceitaTokenSemAssinatura) try {
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
    // Plano modular aplicado AQUI, o unico ponto por onde toda rota autenticada
    // passa. O gate so restringe tenant modular; para os demais devolve o perfil
    // intacto. Sem isto o backend respondia normalmente a modulo nao contratado —
    // a sidebar escondia o item e a rota continuava aberta.
    req.authAccess = await applyModularPlanGate(accessProfile);
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

    if (access?.error === "TENANT_SETTINGS_READ_FAILED") {
      sendError(
        res,
        503,
        "SERVICE_UNAVAILABLE",
        "Instabilidade temporária ao verificar permissões de acesso. Por favor, tente novamente em instantes."
      );
      return;
    }

    if (access?.role !== "internal") {
      sendError(res, 403, "FORBIDDEN", "Internal access required");
      return;
    }

    const pagesToCheck = Array.isArray(page) ? page : [page];
    const gdPages = [
      "geracao-digital",
      "implantacao-gd",
      "propostas-gd",
      "briefings-gd",
      "apresentacao-gd",
      "dashboard-gd",
      "contratos-gd",
      "pacotes-gd",
      "condicoes-gd",
    ];
    const isGdPage = pagesToCheck.some((p) => gdPages.includes(p));
    if (isGdPage && !access.isAdmin && access.role !== "superadmin") {
      const clientId = access.clientId || access.clientIds?.[0] || null;
      const isGdTenant = clientId === "geracao-digital" || access.clientIds?.includes("geracao-digital");
      if (!isGdTenant) {
        sendError(res, 403, "FORBIDDEN", "Módulo Geração Digital restrito ao tenant contratante");
        return;
      }
    }

    // Caminho legado: usuário interno com a página liberada (compat total).
    if (hasInternalPageAccess(access, page)) {
      next();
      return;
    }

    // Novo modelo (objetivo 1): usuário interno que, após a migração, tem a permissão
    // granular do PERMISSIONS_REGISTRY mapeada para esta página — mesmo que a lista antiga
    // de páginas não a contenha. Cobre o time interno antigo (ex.: Geração Digital) sem
    // recriar cadastro. Rotas internas seguem internas; clientes acessam ferramentas por
    // requireAppViewAccess / requireCampaignDispatchAccess (com escopo de tenant).
    if (accessHasPagePermission(access, page)) {
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

    if (access?.error === "TENANT_SETTINGS_READ_FAILED") {
      sendError(
        res,
        503,
        "SERVICE_UNAVAILABLE",
        "Instabilidade temporária ao verificar permissões de acesso. Por favor, tente novamente em instantes."
      );
      return;
    }

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

    if (access?.error === "TENANT_SETTINGS_READ_FAILED") {
      sendError(
        res,
        503,
        "SERVICE_UNAVAILABLE",
        "Instabilidade temporária ao carregar a visualização. Por favor, tente novamente em instantes."
      );
      return;
    }

    if (!access || access.role === "pending") {
      sendError(res, 403, "PENDING_APPROVAL", "Your account is waiting for approval");
      return;
    }

    if (canAccessAppView(access, view)) {
      next();
      return;
    }

    // Novo modelo (objetivo 1): autoriza por permissão granular mapeada para a view/página,
    // cobrindo tanto clientes quanto internos que tenham a permissão.
    if (accessHasViewPermission(access, view) || accessHasPagePermission(access, view)) {
      next();
      return;
    }

    sendError(res, 403, "FORBIDDEN", `Missing permission for view ${view}`);
  };
}

// Autoriza criar/disparar lotes de campanha para QUALQUER usuário válido vinculado ao
// tenant que possua permissão de disparo (objetivo 6 da reformulação — bug do Gabriel).
// A vinculação ao tenant continua sendo aplicada dentro da rota por resolveAuthorizedClientId;
// aqui só validamos a capacidade de disparo, sem exigir a página interna "planilhas".
export function requireCampaignDispatchAccess(req, res, next) {
  const access = req.authAccess;

  if (!access || access.role === "pending") {
    sendError(res, 403, "PENDING_APPROVAL", "Your account is waiting for approval");
    return;
  }

  if (access.isAdmin || access.role === "superadmin") {
    next();
    return;
  }

  const permissions = access.permissions || [];
  // Permissões granulares do PERMISSIONS_REGISTRY para todo o fluxo de campanhas/disparos
  // (ver, criar, disparar, pausar, exportar) + compat com o preset antigo campaigns.manage.
  const campaignDispatchPermissions = [
    "campaigns.view",
    "campaigns.create",
    "campaigns.delete",
    "campaigns.manage",
    "dispatches.execute",
    "dispatches.pause",
    "dispatches.export_failed",
  ];

  if (campaignDispatchPermissions.some((permission) => permissions.includes(permission))) {
    next();
    return;
  }

  // Compat: usuários internos antigos identificavam disparo pela página interna.
  if (access.role === "internal") {
    const pages = access.internalPages || [];
    if (pages.includes("planilhas") || pages.includes("disparos") || pages.includes("campanhas")) {
      next();
      return;
    }
  }

  // Compat: usuários do cliente com acesso operacional ao WhatsApp podem disparar.
  if (access.role === "client") {
    const views = access.allowedViews || [];
    if (views.includes("whatsapp") || permissions.includes("whatsapp.reply")) {
      next();
      return;
    }
  }

  sendError(res, 403, "FORBIDDEN", "Missing dispatch permission");
}
