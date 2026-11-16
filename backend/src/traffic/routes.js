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

const RULE_ERROR_STATUS = { ACCOUNT_ALREADY_EXISTS: 409 };

function sendErr(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

function sendRuleOrServerErr(res, err, where) {
  if (err instanceof TrafficRuleError) {
    return sendErr(res, RULE_ERROR_STATUS[err.code] || 400, err.code, err.message);
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

  app.use("/api/traffic", router);
}
