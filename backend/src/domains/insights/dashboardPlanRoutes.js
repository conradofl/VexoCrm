// backend/src/domains/insights/dashboardPlanRoutes.js
//
// Plano de ação do Dashboard gravado no servidor.
//
//   GET  /api/dashboard/plan          plano desta semana + cobrança do plano anterior (quem vê o Dashboard)
//   PUT  /api/dashboard/plan          grava o plano desta semana (só equipe Vexo)
//   GET  /api/dashboard/plan/export   planilha com nome e telefone (só quem acessa a tela Conversas)
//
// A semana é decidida aqui (segunda-feira, fuso de São Paulo), nunca pelo navegador. O número de cada item também:
// sai do mesmo payload do Dashboard (getOrComputeDashboardMetrics), pelo período que a tela está olhando.

import { requireFirebaseAuth } from "../../access/middlewares.js";
import { ensureSharedRoutePageAccess } from "../../access/notifications.js";
import { canAccessAppView } from "../../accessGuards.js";
import { pgDatabasePool } from "../../services/database.js";
import { resolveAuthorizedClientId } from "../../services/tenant.js";
import { sendError } from "../../services/httpInfra.js";
import { getOrComputeDashboardMetrics } from "../../services/dashboardCalculations.js";
import { parseDashboardPeriodRequest } from "../../services/dashboardPeriod.js";
import { listNeverApproachedReachable, measureQueue } from "../../services/dashboardOverview.js";
import {
  PLAN_EXPORT_LISTS,
  PLAN_EXPORT_WAITING_LIMIT,
  PlanRuleError,
  isMissingPlanTable,
  isVexoTeam,
  neverApproachedCsv,
  normalizePlanItems,
  readPlan,
  readPreviousPlan,
  savePlan,
  waitingCsv,
  weekStartFor,
  withCurrentValues,
} from "../../services/dashboardPlan.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");
const canSeeConversations = (req) => canAccessAppView(req?.authAccess, "whatsapp");

function planStorageUnavailable(res) {
  return sendError(res, 503, "PLAN_STORAGE_UNAVAILABLE", "O plano ainda não pode ser salvo no servidor.");
}

/** Empresa autorizada e com acesso ao Dashboard. null = resposta já enviada. */
function authorize(req, res, requestedClientId) {
  if (!pgDatabasePool) {
    sendError(res, 503, "DATABASE_UNAVAILABLE", "Banco de dados indisponível.");
    return null;
  }
  if (!ensureSharedRoutePageAccess(req, res, "dashboard")) return null;
  return resolveAuthorizedClientId(req, res, requestedClientId) || null;
}

/** Período que a tela está olhando. Inválido cai no padrão (30 dias): o plano não falha por causa disso. */
function periodKeyFrom(source) {
  const parsed = parseDashboardPeriodRequest({ period: str(source?.period), from: str(source?.from), to: str(source?.to) });
  return parsed.ok ? parsed.periodKey : "30d";
}

async function metricsOrNull(clientId, periodKey) {
  try {
    return await getOrComputeDashboardMetrics(pgDatabasePool, clientId, periodKey);
  } catch (err) {
    console.error(`[dashboard-plano] números indisponíveis (client=${clientId}):`, err?.message || err);
    return null;
  }
}

export function registerDashboardPlanRoutes(app) {
  app.get("/api/dashboard/plan", requireFirebaseAuth, async (req, res) => {
    const clientId = authorize(req, res, str(req.query.clientId));
    if (!clientId) return;
    const weekStart = weekStartFor(new Date());
    try {
      const [current, previous] = await Promise.all([
        readPlan(pgDatabasePool, { clientId, weekStart }),
        readPreviousPlan(pgDatabasePool, { clientId, weekStart }),
      ]);
      // A cobrança precisa do número de hoje; sem plano anterior, nada a medir.
      const metrics = previous ? await metricsOrNull(clientId, periodKeyFrom(req.query)) : null;
      res.json({
        success: true,
        weekStart,
        canEdit: isVexoTeam(req.authAccess),
        canExport: canSeeConversations(req),
        current,
        previous: withCurrentValues(previous, metrics),
      });
    } catch (err) {
      if (isMissingPlanTable(err)) return planStorageUnavailable(res);
      console.error(`[dashboard-plano] leitura falhou (client=${clientId}):`, err?.message || err);
      sendError(res, 500, "PLAN_READ_FAILED", "Não foi possível ler o plano agora.");
    }
  });

  app.put("/api/dashboard/plan", requireFirebaseAuth, async (req, res) => {
    const clientId = authorize(req, res, str(req.body?.clientId));
    if (!clientId) return;
    if (!isVexoTeam(req.authAccess)) {
      return sendError(res, 403, "PLAN_READ_ONLY", "Só a equipe Vexo edita o plano.");
    }
    let items;
    try {
      items = normalizePlanItems(req.body?.items);
    } catch (err) {
      if (err instanceof PlanRuleError) return sendError(res, 400, err.code, err.message);
      throw err;
    }
    try {
      const metrics = await metricsOrNull(clientId, periodKeyFrom(req.body));
      const plan = await savePlan(pgDatabasePool, {
        clientId,
        weekStart: weekStartFor(new Date()),
        items,
        uid: req.authUser?.uid || null,
        metrics,
      });
      res.json({ success: true, plan });
    } catch (err) {
      if (isMissingPlanTable(err)) return planStorageUnavailable(res);
      console.error(`[dashboard-plano] gravação falhou (client=${clientId}):`, err?.message || err);
      sendError(res, 500, "PLAN_SAVE_FAILED", "Não foi possível salvar o plano agora.");
    }
  });

  app.get("/api/dashboard/plan/export", requireFirebaseAuth, async (req, res) => {
    const clientId = authorize(req, res, str(req.query.clientId));
    if (!clientId) return;
    // Nome e telefone de lead: mesma guarda das rotas da tela Conversas.
    if (!canSeeConversations(req)) {
      return sendError(res, 403, "PLAN_EXPORT_FORBIDDEN", "A planilha com nome e telefone é só para quem acessa a tela Conversas.");
    }
    const list = str(req.query.list);
    if (!PLAN_EXPORT_LISTS.includes(list)) {
      return sendError(res, 400, "PLAN_EXPORT_INVALID_LIST", "Planilha desconhecida.");
    }
    try {
      const now = new Date();
      let csv;
      let rows;
      if (list === "waiting") {
        const queue = await measureQueue(pgDatabasePool, { clientId, now, oldestLimit: PLAN_EXPORT_WAITING_LIMIT });
        rows = queue.oldest.length;
        csv = waitingCsv(queue);
      } else {
        const people = await listNeverApproachedReachable(pgDatabasePool, { clientId, asOf: now });
        rows = people.length;
        csv = neverApproachedCsv(people);
      }
      // Registro sem dado pessoal: quem baixou, qual lista, quantas linhas.
      console.info(`[dashboard-plano] planilha ${list} baixada (client=${clientId}, uid=${req.authUser?.uid || "?"}, linhas=${rows})`);
      const name = list === "waiting" ? "esperando-resposta" : "nunca-abordados";
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="plano-${name}-${weekStartFor(now)}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(csv);
    } catch (err) {
      console.error(`[dashboard-plano] planilha ${list} falhou (client=${clientId}):`, err?.message || err);
      sendError(res, 500, "PLAN_EXPORT_FAILED", "Não foi possível montar a planilha agora.");
    }
  });
}
