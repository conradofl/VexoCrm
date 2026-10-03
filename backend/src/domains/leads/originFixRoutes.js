// backend/src/domains/leads/originFixRoutes.js
//
// Correção dos leads marcados "Instagram Direct" pelo padrão fabricado do importador de planilha.
// Duas rotas, nunca uma:
//   POST /api/leads/origin-fix/preview   só leitura: números por grupo (com identificador / só tag / indeterminável)
//   POST /api/leads/origin-fix/execute   recebe o número de corrigíveis visto na prévia; recusa (409) se divergir

import { ORIGIN_FIX_ERRORS, createPgOriginFixRepo, executeOriginFix, previewOriginFix } from "../../services/leadOriginFix.js";
import { isManagerOrAdmin } from "../../access/claims.js";

const STATUS_BY_ERROR = {
  [ORIGIN_FIX_ERRORS.COUNT_MISMATCH]: 409,
  [ORIGIN_FIX_ERRORS.CONFIRMATION_REQUIRED]: 400,
  [ORIGIN_FIX_ERRORS.INVALID_EXPECTED]: 400,
  [ORIGIN_FIX_ERRORS.NOTHING_TO_FIX]: 400,
};

export function registerLeadOriginFixRoutes(app, deps) {
  const { ensureDb, normalizeString, pgDatabasePool, requireBancoDeDados, requireFirebaseAuth, resolveAuthorizedClientId, sendError, originFixRepo } = deps;
  const repo = originFixRepo || createPgOriginFixRepo();

  app.post("/api/leads/origin-fix/preview", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;
    // O cliente vem SEMPRE da autorização da sessão, nunca de um critério solto.
    const clientId = resolveAuthorizedClientId(req, res, normalizeString(req.body?.clientId));
    if (!clientId) return;
    try {
      res.json({ success: true, preview: await previewOriginFix(repo, pgDatabasePool, { clientId }) });
    } catch (err) {
      console.error("[leads-origin-fix] preview:", err);
      sendError(res, 500, "ORIGIN_FIX_PREVIEW_FAILED", err.message || "Falha ao calcular a prévia");
    }
  });

  app.post("/api/leads/origin-fix/execute", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;
    if (!isManagerOrAdmin(req.authAccess)) {
      sendError(res, 403, "FORBIDDEN", "Apenas gestor ou administrador pode corrigir a origem dos leads em massa.");
      return;
    }
    const clientId = resolveAuthorizedClientId(req, res, normalizeString(req.body?.clientId));
    if (!clientId) return;
    try {
      const outcome = await executeOriginFix(repo, pgDatabasePool, {
        clientId,
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
      console.error("[leads-origin-fix] execute:", err);
      sendError(res, 500, "ORIGIN_FIX_FAILED", "A correção falhou e nada foi alterado. " + (err.message || ""));
    }
  });
}
