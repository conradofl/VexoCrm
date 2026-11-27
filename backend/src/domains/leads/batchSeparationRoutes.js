// Rotas de "separar lotes" e "conferir WhatsApp" do Banco de Dados (services/leadBatchSeparation.js).
// Login de pessoa (Firebase), módulo Banco de Dados contratado e escopo da empresa conferido em toda rota.

import { ImportError } from "../../services/leadImportBatches.js";
import {
  iniciarConferencia,
  pararConferencia,
  previaSeparacao,
  separarLotes,
  statusConferencia,
} from "../../services/leadBatchSeparation.js";
import { idsDaOrigem, lerOrigem, rotuloDaOrigem } from "../../services/leadBatchOrigin.js";
import { resolveLeadListScope } from "../../services/leadListQuery.js";

function responderErro(res, sendError, error, rotulo) {
  if (error instanceof ImportError) {
    sendError(res, error.status, error.code, error.message, error.details ?? undefined);
    return;
  }
  console.error(rotulo, error);
  sendError(res, 500, "LEAD_BATCH_FAILED", error instanceof Error ? error.message : "Falha ao separar lotes");
}

export function registerLeadBatchSeparationRoutes(app, deps) {
  const { pgDatabasePool, requireFirebaseAuth, requireBancoDeDados, resolveAuthorizedClientId, sendError, normalizeTenantKey } = deps;

  const empresa = (req, res, valor) => {
    const pedido = normalizeTenantKey ? normalizeTenantKey(valor) : String(valor ?? "").trim();
    if (!pedido) {
      sendError(res, 400, "MISSING_CLIENT_ID", "Informe a empresa (clientId).");
      return null;
    }
    return resolveAuthorizedClientId(req, res, pedido);
  };
  const semBanco = (res) => {
    if (pgDatabasePool) return false;
    sendError(res, 503, "DATABASE_UNAVAILABLE", "Banco de dados indisponível.");
    return true;
  };
  const actor = (req) => ({ uid: req.authAccess?.uid || null, email: req.authAccess?.email || null });

  app.get("/api/leads/lotes/previa", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (semBanco(res)) return;
    const clientId = empresa(req, res, req.query?.clientId);
    if (!clientId) return;
    try {
      // ?origem={"tipo":"tag","tag":"..."}: a prévia conta só aquele grupo (tag, planilha ou filtro da tela).
      const origem = lerOrigem(req.query?.origem);
      const leadIds = await idsDaOrigem(pgDatabasePool, { origem, scope: resolveLeadListScope(req, clientId) });
      res.json({
        previa: await previaSeparacao(pgDatabasePool, { clientId, leadIds }),
        conferencia: statusConferencia(clientId),
        origem: { ...origem, rotulo: rotuloDaOrigem(origem), grupo: leadIds ? leadIds.length : null },
      });
    } catch (error) {
      responderErro(res, sendError, error, "[lotes] erro na prévia:");
    }
  });

  app.post("/api/leads/lotes", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (semBanco(res)) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientId = empresa(req, res, body.clientId);
    if (!clientId) return;
    try {
      const origem = lerOrigem(body.origem);
      const leadIds = await idsDaOrigem(pgDatabasePool, { origem, scope: resolveLeadListScope(req, clientId) });
      const resultado = await separarLotes(pgDatabasePool, {
        clientId,
        tamanho: body.tamanho,
        quantidade: body.quantidade,
        nomeBase: body.nomeBase,
        exigirWhatsapp: body.exigirWhatsapp === true,
        actor: actor(req),
        leadIds,
        origem: origem.tipo === "empresa" ? null : { tipo: origem.tipo, rotulo: rotuloDaOrigem(origem), grupo: leadIds.length },
      });
      res.status(201).json(resultado);
    } catch (error) {
      responderErro(res, sendError, error, "[lotes] erro ao separar:");
    }
  });

  app.get("/api/leads/conferencia-whatsapp", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    const clientId = empresa(req, res, req.query?.clientId);
    if (!clientId) return;
    res.json({ conferencia: statusConferencia(clientId) });
  });

  app.post("/api/leads/conferencia-whatsapp", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (semBanco(res)) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientId = empresa(req, res, body.clientId);
    if (!clientId) return;
    try {
      const conferencia = await iniciarConferencia(pgDatabasePool, { clientId, chipId: body.chipId, actor: actor(req) });
      res.status(202).json({ conferencia });
    } catch (error) {
      responderErro(res, sendError, error, "[conferencia-whatsapp] erro ao iniciar:");
    }
  });

  app.delete("/api/leads/conferencia-whatsapp", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    const clientId = empresa(req, res, req.query?.clientId);
    if (!clientId) return;
    res.json({ conferencia: pararConferencia(clientId) });
  });
}
