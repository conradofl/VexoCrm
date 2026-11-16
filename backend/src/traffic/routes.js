// Rotas do Gestor de Tráfego (Fase 1). Leitura de métricas e decisão, cadastro
// de conta e perfil de metas. Nenhuma rota fala com plataforma de anúncio e
// nenhuma altera campanha, verba ou anúncio.
//
// Gate em duas partes, como em audioLibrary/routes.js: a empresa vem de
// resolveAuthorizedClientId (escopo de quem pediu) e passa por
// evaluateTrafficAccess. Nas rotas por :id a empresa vem da LINHA do banco.

import express from "express";
import { requireFirebaseAuth } from "../access/middlewares.js";
import { pgDatabasePool } from "../services/database.js";
import { resolveAuthorizedClientId } from "../services/tenant.js";
import { evaluateTrafficAccess } from "./access.js";
import { isTrafficCollectorEnabled, SCHEDULED_HOURS } from "./collectorScheduler.js";
import { publicKpiCatalog } from "./kpis.js";
import { isGoogleAdsConnected } from "./googleAdsClient.js";
import { isMetaConnected } from "./metaAdsClient.js";
import {
  ALLOWED_WINDOWS,
  AUTONOMY_AVAILABLE,
  AUTONOMY_LEVELS,
  TrafficRuleError,
  buildPerformance,
  createAccount,
  findAccountTenant,
  getProfile,
  listAccounts,
  saveProfile,
  setAccountStatus,
} from "./service.js";
import {
  TrafficPlanError,
  approveItem,
  findPlanItemTenant,
  findPlanTenant,
  generatePlan,
  getPlan,
  getTodayPlan,
  listApplyQueue,
  listPlans,
  markItemApplied,
  rejectItem,
  rolesForIdentity,
} from "./plan.js";

const RULE_ERROR_STATUS = { ACCOUNT_ALREADY_EXISTS: 409 };

function sendErr(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

function sendRuleOrServerErr(res, err, where) {
  if (err instanceof TrafficRuleError) {
    return sendErr(res, RULE_ERROR_STATUS[err.code] || 400, err.code, err.message);
  }
  if (err instanceof TrafficPlanError) {
    return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message, ...(err.details || {}) } });
  }
  console.error(`[traffic/routes][${where}]`, err?.message || err);
  return sendErr(res, 500, "TRAFFIC_INTERNAL_ERROR", "Não foi possível concluir. Tente novamente em instantes.");
}

function str(value) {
  return typeof value === "string" ? value.trim() || null : null;
}

/** Empresa autorizada para quem pediu, já passada pelo gate. null = resposta já enviada. */
function authorize(req, res, requestedClientId) {
  const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
  if (!clientId) return null;
  const verdict = evaluateTrafficAccess(req.authAccess, clientId);
  if (!verdict.allowed) {
    sendErr(res, verdict.status, verdict.reason, verdict.message);
    return null;
  }
  return clientId;
}

function requireDb(res) {
  if (pgDatabasePool) return pgDatabasePool;
  sendErr(res, 503, "DATABASE_UNAVAILABLE", "Banco de dados indisponível.");
  return null;
}

export function registerTrafficRoutes(app) {
  const router = express.Router();
  router.use(requireFirebaseAuth);

  // A tela pergunta antes de mostrar qualquer aba. Quem não pode recebe 200 com
  // { allowed: false } e o motivo, saído da MESMA função do gate.
  router.get("/access", (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, str(req.query.clientId));
    if (!clientId) return;
    const verdict = evaluateTrafficAccess(req.authAccess, clientId);
    res.json({ success: true, allowed: verdict.allowed, reason: verdict.reason, message: verdict.message });
  });

  router.get("/accounts", async (req, res) => {
    const clientId = authorize(req, res, str(req.query.clientId));
    if (!clientId) return;
    const pool = requireDb(res);
    if (!pool) return;
    try {
      res.json({
        success: true,
        // Só "tem credencial ou não". Token e chave nunca saem do servidor.
        platforms: {
          meta: { available: true, connected: isMetaConnected() },
          google: { available: true, connected: isGoogleAdsConnected() },
        },
        collector: { enabled: isTrafficCollectorEnabled(), hours: SCHEDULED_HOURS.map((h) => `${h}:00`) },
        accounts: await listAccounts(pool, clientId),
      });
    } catch (err) {
      sendRuleOrServerErr(res, err, "list-accounts");
    }
  });

  router.post("/accounts", async (req, res) => {
    const clientId = authorize(req, res, str(req.body?.clientId));
    if (!clientId) return;
    const pool = requireDb(res);
    if (!pool) return;
    try {
      res.status(201).json({ success: true, account: await createAccount(pool, clientId, req.body || {}) });
    } catch (err) {
      sendRuleOrServerErr(res, err, "create-account");
    }
  });

  router.patch("/accounts/:id", async (req, res) => {
    const pool = requireDb(res);
    if (!pool) return;
    try {
      const owner = await findAccountTenant(pool, req.params.id);
      if (!owner) return sendErr(res, 404, "NOT_FOUND", "Conta não encontrada.");
      const clientId = authorize(req, res, owner);
      if (!clientId) return;
      const account = await setAccountStatus(pool, clientId, req.params.id, str(req.body?.status));
      if (!account) return sendErr(res, 404, "NOT_FOUND", "Conta não encontrada.");
      res.json({ success: true, account });
    } catch (err) {
      sendRuleOrServerErr(res, err, "update-account");
    }
  });

  router.get("/profile", async (req, res) => {
    const clientId = authorize(req, res, str(req.query.clientId));
    if (!clientId) return;
    const pool = requireDb(res);
    if (!pool) return;
    try {
      res.json({
        success: true,
        profile: await getProfile(pool, clientId),
        catalog: publicKpiCatalog(),
        allowedWindows: ALLOWED_WINDOWS,
        autonomy: { levels: AUTONOMY_LEVELS, available: AUTONOMY_AVAILABLE },
      });
    } catch (err) {
      sendRuleOrServerErr(res, err, "get-profile");
    }
  });

  router.put("/profile", async (req, res) => {
    const clientId = authorize(req, res, str(req.body?.clientId));
    if (!clientId) return;
    const pool = requireDb(res);
    if (!pool) return;
    try {
      res.json({ success: true, profile: await saveProfile(pool, clientId, req.body || {}) });
    } catch (err) {
      sendRuleOrServerErr(res, err, "save-profile");
    }
  });

  router.get("/performance", async (req, res) => {
    const clientId = authorize(req, res, str(req.query.clientId));
    if (!clientId) return;
    const pool = requireDb(res);
    if (!pool) return;
    try {
      const performance = await buildPerformance(pool, clientId, { windowDays: Number(req.query.window) });
      res.json({ success: true, ...performance, catalog: publicKpiCatalog(), accountsStatus: await listAccounts(pool, clientId) });
    } catch (err) {
      sendRuleOrServerErr(res, err, "performance");
    }
  });

  // ─── Plano do dia e aprovação dupla (Fase 2). Nada é aplicado em plataforma.

  function identityOf(req) {
    return { uid: req.authUser?.uid || null, email: req.authUser?.email || null };
  }

  router.get("/plans/today", async (req, res) => {
    const clientId = authorize(req, res, str(req.query.clientId));
    if (!clientId) return;
    const pool = requireDb(res);
    if (!pool) return;
    try {
      const [today, profile, applyQueue] = await Promise.all([
        getTodayPlan(pool, clientId),
        getProfile(pool, clientId),
        listApplyQueue(pool, clientId),
      ]);
      res.json({
        success: true,
        plan: today?.plan || null,
        items: today?.items || [],
        applyQueue,
        autonomyLevel: profile.autonomyLevel,
        // De que lado quem está logado aprova (pelo email na lista de aprovadores).
        myRoles: rolesForIdentity(profile, identityOf(req)),
      });
    } catch (err) {
      sendRuleOrServerErr(res, err, "plan-today");
    }
  });

  router.get("/plans", async (req, res) => {
    const clientId = authorize(req, res, str(req.query.clientId));
    if (!clientId) return;
    const pool = requireDb(res);
    if (!pool) return;
    try {
      res.json({ success: true, plans: await listPlans(pool, clientId, { limit: Number(req.query.limit) || 30 }) });
    } catch (err) {
      sendRuleOrServerErr(res, err, "plan-list");
    }
  });

  router.get("/plans/:id", async (req, res) => {
    const pool = requireDb(res);
    if (!pool) return;
    try {
      const owner = await findPlanTenant(pool, req.params.id);
      if (!owner) return sendErr(res, 404, "NOT_FOUND", "Plano não encontrado.");
      const clientId = authorize(req, res, owner);
      if (!clientId) return;
      const found = await getPlan(pool, clientId, req.params.id);
      if (!found) return sendErr(res, 404, "NOT_FOUND", "Plano não encontrado.");
      res.json({ success: true, ...found });
    } catch (err) {
      sendRuleOrServerErr(res, err, "plan-get");
    }
  });

  router.post("/plans/generate", async (req, res) => {
    const clientId = authorize(req, res, str(req.body?.clientId));
    if (!clientId) return;
    const pool = requireDb(res);
    if (!pool) return;
    try {
      const generated = await generatePlan(pool, clientId, { generatedBy: identityOf(req).uid || "pessoa" });
      res.status(201).json({ success: true, ...generated });
    } catch (err) {
      sendRuleOrServerErr(res, err, "plan-generate");
    }
  });

  async function itemAction(req, res, where, fn) {
    const pool = requireDb(res);
    if (!pool) return;
    try {
      const owner = await findPlanItemTenant(pool, req.params.id);
      if (!owner) return sendErr(res, 404, "NOT_FOUND", "Item do plano não encontrado.");
      const clientId = authorize(req, res, owner);
      if (!clientId) return;
      res.json({ success: true, item: await fn(pool, clientId) });
    } catch (err) {
      sendRuleOrServerErr(res, err, where);
    }
  }

  router.post("/plan-items/:id/approve", (req, res) =>
    itemAction(req, res, "plan-approve", (pool, clientId) =>
      approveItem(pool, { clientId, itemId: req.params.id, role: str(req.body?.role), identity: identityOf(req) })
    )
  );

  router.post("/plan-items/:id/reject", (req, res) =>
    itemAction(req, res, "plan-reject", (pool, clientId) =>
      rejectItem(pool, {
        clientId,
        itemId: req.params.id,
        role: str(req.body?.role),
        reason: typeof req.body?.reason === "string" ? req.body.reason : "",
        identity: identityOf(req),
      })
    )
  );

  router.post("/plan-items/:id/applied", (req, res) =>
    itemAction(req, res, "plan-applied", (pool, clientId) =>
      markItemApplied(pool, { clientId, itemId: req.params.id, identity: identityOf(req) })
    )
  );

  app.use("/api/traffic", router);
}
