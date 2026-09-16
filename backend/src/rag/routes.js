// backend/src/rag/routes.js
//
// Upload de documentos pra Base de Conhecimento RAG. Corpo binário cru, mesmo
// padrão de contractRoutes.js:58 (express.raw + limite próprio na rota). O
// upload GRAVA e ENFILEIRA — nunca espera a indexação terminar: um arquivo de
// 20MB com centenas de trechos e o espaçamento entre lotes do Gemini leva
// minutos, e seguraria o navegador do usuário até ele desistir e subir de
// novo, duplicando o documento.

import express from "express";
import crypto from "crypto";
import { requireFirebaseAuth, requireInternalPageAccess } from "../access/middlewares.js";
import { pgDatabasePool } from "../services/database.js";
import { resolveAuthorizedClientId } from "../services/tenant.js";
import { detectRagDocumentType, saveRagDocumentBuffer, RAG_MAX_BYTES } from "../services/storage.js";
import { getRagQueue } from "./queue.js";

function sendErr(res, status, code, message) {
  console.error(`[rag/routes][${code}]`, message);
  return res.status(status).json({ success: false, error: { code, message } });
}

function str(v) {
  return typeof v === "string" ? v.trim() || null : null;
}

function getDb() {
  return pgDatabasePool;
}

export function registerRagRoutes(app) {
  const router = express.Router();

  // Permissão agente_rag (permissionsRegistry.js) já gateia a ABA na tela —
  // sem isso no backend, a tela cobra e a API não: qualquer usuário
  // autenticado, de qualquer plano, indexa documento e gasta a cota
  // compartilhada do Gemini. Uma linha no router inteiro, não rota a rota —
  // endpoint novo nunca nasce desprotegido.
  //
  // "chatbot-docs", não "agente": a página "agente" aparece nas páginas de
  // DUAS permissões (agente_inbound E agente_rag) — gatear por ela deixaria
  // passar quem só tem Agente Inbound, módulo e preço diferentes. Só
  // "chatbot-docs" pertence exclusivamente ao RAG.
  router.use(requireFirebaseAuth, requireInternalPageAccess("chatbot-docs"));

  // POST /api/rag/documents?clientId=&companyId=
  // Header opcional: X-File-Name (nome original do arquivo, urlencoded).
  // Limite da ROTA (25MB) > teto do NEGÓCIO (RAG_MAX_BYTES, 20MB, checado
  // logo abaixo): mesma armadilha da Etapa 4 — um arquivo de exatamente 20MB
  // (ou 20MB + qualquer cabeçalho) tomaria 413 genérico do Express antes de
  // chegar na validação, que tem a mensagem de verdade.
  router.post(
    "/documents",
    requireFirebaseAuth,
    express.raw({ type: "*/*", limit: "25mb" }),
    async (req, res) => {
      const clientId = resolveAuthorizedClientId(req, res, str(req.query.clientId));
      if (!clientId) return;

      const buffer = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buffer || buffer.length === 0) {
        return sendErr(res, 400, "EMPTY_BUFFER", "Arquivo não fornecido ou vazio.");
      }
      if (buffer.length > RAG_MAX_BYTES) {
        return sendErr(res, 400, "FILE_TOO_LARGE", "O arquivo excede o limite máximo permitido de 20 MB.");
      }

      const rawFileName = req.headers["x-file-name"] || req.query.filename || "documento";
      let filename;
      try {
        filename = decodeURIComponent(String(rawFileName)).trim() || "documento";
      } catch {
        filename = String(rawFileName).trim() || "documento";
      }

      let detected;
      try {
        detected = detectRagDocumentType(buffer, filename);
      } catch (err) {
        return sendErr(res, 400, err.code || "INVALID_FILE_TYPE", err.message);
      }

      const companyId = str(req.query.companyId);
      const documentId = crypto.randomUUID();

      let saveResult;
      try {
        saveResult = await saveRagDocumentBuffer({
          clientId,
          documentId,
          buffer,
          filename,
          mimeType: detected.mimeType,
        });
      } catch (err) {
        return sendErr(res, 500, err.code || "STORAGE_ERROR", err.message || "Falha ao salvar o arquivo.");
      }

      const pool = getDb();
      if (!pool) return sendErr(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível.");

      const createdByUid = req.authUser?.uid || req.authAccess?.uid || null;

      try {
        await pool.query(
          `INSERT INTO public.rag_documents
             (id, client_id, company_id, filename, mime_type, size_bytes, storage_key, status, created_by_uid)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
          [documentId, clientId, companyId, filename, detected.mimeType, buffer.length, saveResult.storageKey, createdByUid]
        );
      } catch (err) {
        return sendErr(res, 500, "DB_INSERT_FAILED", err.message || "Falha ao gravar o documento.");
      }

      // Enfileira e responde — a indexação roda no worker, fora do ciclo desta requisição.
      await getRagQueue().add("index-document", { documentId }, { jobId: `rag-index-${documentId}` });

      return res.status(201).json({
        success: true,
        document: {
          id: documentId,
          clientId,
          companyId,
          filename,
          mimeType: detected.mimeType,
          sizeBytes: buffer.length,
          status: "pending",
        },
      });
    }
  );

  // POST /api/rag/documents/:id/reprocess — reindexa (documento pronto, com falha, ou já em processo).
  router.post("/documents/:id/reprocess", requireFirebaseAuth, async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido.");

    const pool = getDb();
    if (!pool) return sendErr(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível.");

    const { rows } = await pool.query(
      `SELECT id, client_id FROM public.rag_documents WHERE id = $1`,
      [id]
    );
    if (!rows.length) return sendErr(res, 404, "NOT_FOUND", "Documento não encontrado.");

    // resolveAuthorizedClientId valida o client_id REAL do documento contra o
    // escopo de quem pediu — 403 se o tenant não bate, nunca confia no que o
    // payload mandaria (aqui nem manda: o tenant vem da linha).
    const clientId = resolveAuthorizedClientId(req, res, rows[0].client_id);
    if (!clientId) return;

    await pool.query(
      `UPDATE public.rag_documents SET status = 'pending', error_log = NULL, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await getRagQueue().add("index-document", { documentId: id }, { jobId: `rag-index-${id}-${Date.now()}` });

    return res.json({ success: true, documentId: id, status: "pending" });
  });

  app.use("/api/rag", router);
}
