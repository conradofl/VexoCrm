// backend/src/domains/leads/massDeleteRoutes.js
//
// Exclusão em massa de leads por tag / identificador de importação. Quatro rotas, nenhuma delas
// destrutiva exceto `execute`:
//
//   GET  /api/leads/mass-delete/tags      tags do cliente com a contagem de leads (para escolher)
//   POST /api/leads/mass-delete/preview   só leitura: números nomeados
//   POST /api/leads/mass-delete/export    CSV dos leads que SERIAM apagados (o único "desfazer": reimportar)
//   POST /api/leads/mass-delete/execute   recebe o critério + o número visto na prévia; recusa se divergir
//
// Prévia, exportação e execução chamam a mesma seleção (services/leadMassDelete.js).

import {
  MASS_DELETE_ERRORS,
  buildDeletableCsv,
  createPgMassDeleteRepo,
  executeMassDelete,
  normalizeCriterion,
  normalizeOptions,
  previewMassDelete,
  selectMassDeleteTargets,
} from "../../services/leadMassDelete.js";
import { isManagerOrAdmin } from "../../access/claims.js";

const STATUS_BY_ERROR = {
  [MASS_DELETE_ERRORS.COUNT_MISMATCH]: 409,
  [MASS_DELETE_ERRORS.CONFIRMATION_REQUIRED]: 400,
  [MASS_DELETE_ERRORS.INVALID_EXPECTED]: 400,
  [MASS_DELETE_ERRORS.NOTHING_TO_DELETE]: 400,
};

export function registerLeadMassDeleteRoutes(app, deps) {
  const {
    ensureDb,
    normalizeString,
    pgDatabasePool,
    requireBancoDeDados,
    requireFirebaseAuth,
    resolveAuthorizedClientId,
    sendError,
    massDeleteRepo,
  } = deps;
  const repo = massDeleteRepo || createPgMassDeleteRepo();

  // O cliente vem SEMPRE da autorização da sessão (resolveAuthorizedClientId), nunca do critério.
  const resolveRequest = (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, normalizeString(req.body?.clientId ?? req.query?.clientId));
    if (!clientId) return null;
    const parsed = normalizeCriterion(req.body?.criterion);
    if (!parsed.ok) {
      sendError(res, 400, "INVALID_CRITERION", parsed.message);
      return null;
    }
    return { clientId, criterion: parsed.criterion, options: normalizeOptions(req.body?.options) };
  };

  app.get("/api/leads/mass-delete/tags", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = resolveAuthorizedClientId(req, res, normalizeString(req.query?.clientId));
    if (!clientId) return;
    try {
      res.json({ success: true, tags: await repo.listTags(pgDatabasePool, clientId) });
    } catch (err) {
      console.error("[leads-mass-delete] tags:", err);
      sendError(res, 500, "MASS_DELETE_TAGS_FAILED", err.message || "Falha ao listar tags");
    }
  });

  app.post("/api/leads/mass-delete/preview", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;
    const request = resolveRequest(req, res);
    if (!request) return;
    try {
      const preview = await previewMassDelete(repo, pgDatabasePool, request);
      res.json({ success: true, criterion: request.criterion, options: request.options, preview });
    } catch (err) {
      console.error("[leads-mass-delete] preview:", err);
      sendError(res, 500, "MASS_DELETE_PREVIEW_FAILED", err.message || "Falha ao calcular a prévia");
    }
  });

  app.post("/api/leads/mass-delete/export", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;
    const request = resolveRequest(req, res);
    if (!request) return;
    try {
      const selection = await selectMassDeleteTargets(repo, pgDatabasePool, request);
      const csv = buildDeletableCsv(selection.deletable);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="leads-a-apagar.csv"`);
      res.setHeader("X-Exported-Count", String(selection.willDelete));
      res.send(csv);
    } catch (err) {
      console.error("[leads-mass-delete] export:", err);
      sendError(res, 500, "MASS_DELETE_EXPORT_FAILED", err.message || "Falha ao exportar");
    }
  });

  app.post("/api/leads/mass-delete/execute", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;
    // Apagar em massa é decisão de gestor/admin. Ver a prévia e exportar continuam abertos a quem usa o Banco.
    if (!isManagerOrAdmin(req.authAccess)) {
      sendError(res, 403, "FORBIDDEN", "Apenas gestor ou administrador pode excluir leads em massa.");
      return;
    }
    const request = resolveRequest(req, res);
    if (!request) return;
    try {
      const outcome = await executeMassDelete(repo, pgDatabasePool, {
        ...request,
        expectedCount: req.body?.expectedCount,
        typedConfirmation: req.body?.confirmation,
        actor: { uid: req.authAccess?.uid || null, email: req.authAccess?.email || null },
      });
      if (!outcome.ok) {
        sendError(res, STATUS_BY_ERROR[outcome.code] || 400, outcome.code, outcome.message, outcome.details);
        return;
      }
      res.json({ success: true, report: outcome.report });
    } catch (err) {
      console.error("[leads-mass-delete] execute:", err);
      sendError(res, 500, "MASS_DELETE_FAILED", "A exclusão falhou e nada foi apagado. " + (err.message || ""));
    }
  });
}
