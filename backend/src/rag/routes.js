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
import { detectRagDocumentType, saveRagDocumentBuffer, deleteRagDocumentBuffer, RAG_MAX_BYTES } from "../services/storage.js";
import { resolveEmbeddingIdentity } from "../services/embeddings.js";
import { findRagContextForQuestion, resolveDefaultMinSimilarity } from "./chatSearch.js";
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

  // GET /api/rag/documents?clientId=&companyId= — lista pra tela.
  // needsReindex é calculado aqui, não guardado: compara a procedência
  // gravada no documento (embedding_provider/model, escrita no último índice
  // bem-sucedido) contra resolveEmbeddingIdentity() de AGORA. Documento
  // 'pending'/'processing' ainda não tem procedência (NULL) — nunca marca
  // como precisando reindexar, porque ainda vai indexar com a identidade atual.
  router.get("/documents", requireFirebaseAuth, async (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, str(req.query.clientId));
    if (!clientId) return;
    const companyId = str(req.query.companyId);

    const pool = getDb();
    if (!pool) return sendErr(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível.");

    const { rows } = await pool.query(
      `SELECT id, filename, mime_type, size_bytes, status, error_log, chunk_count,
              embedding_provider, embedding_model, company_id, created_at, updated_at
         FROM public.rag_documents
        WHERE client_id = $1 AND (company_id IS NULL OR company_id = $2)
        ORDER BY created_at DESC`,
      [clientId, companyId]
    );

    const identity = resolveEmbeddingIdentity();

    return res.json({
      success: true,
      documents: rows.map((d) => ({
        id: d.id,
        filename: d.filename,
        mimeType: d.mime_type,
        sizeBytes: d.size_bytes,
        status: d.status,
        errorLog: d.error_log,
        chunkCount: d.chunk_count,
        companyId: d.company_id,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        needsReindex: Boolean(
          d.embedding_provider &&
          (d.embedding_provider !== identity.provider || d.embedding_model !== identity.model)
        ),
      })),
    });
  });

  // DELETE /api/rag/documents/:id — apaga arquivo, trechos e o registro.
  // Ordem importa: apaga do storage PRIMEIRO. Se falhar, a linha do banco
  // fica intacta e o documento continua aparecendo na tela (retry natural) —
  // o contrário apagaria a referência à storage_key e deixaria o objeto
  // órfão no R2 pra sempre, sem jeito de encontrar de novo.
  router.delete("/documents/:id", requireFirebaseAuth, async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido.");

    const pool = getDb();
    if (!pool) return sendErr(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível.");

    const { rows } = await pool.query(
      `SELECT id, client_id, storage_key FROM public.rag_documents WHERE id = $1`,
      [id]
    );
    if (!rows.length) return sendErr(res, 404, "NOT_FOUND", "Documento não encontrado.");

    const clientId = resolveAuthorizedClientId(req, res, rows[0].client_id);
    if (!clientId) return;

    const storageOk = await deleteRagDocumentBuffer(rows[0].storage_key);
    if (!storageOk) {
      return sendErr(res, 500, "STORAGE_DELETE_FAILED", "Falha ao apagar o arquivo do armazenamento. Tente novamente.");
    }

    // ON DELETE CASCADE (migration) apaga os trechos junto.
    await pool.query(`DELETE FROM public.rag_documents WHERE id = $1`, [id]);

    return res.json({ success: true, documentId: id });
  });

  // POST /api/rag/search-test  { clientId, companyId?, question }
  // Reaproveita findRagContextForQuestion (Commit 3) com minSimilarity: 0 —
  // devolve TODOS os candidatos rankeados, não só os que passariam em
  // produção. É o único jeito de calibrar RAG_MIN_SIMILARITY sem chutar: ver
  // onde cada trecho caiu, não só quem passou. `threshold` vai junto pra tela
  // marcar visualmente quem passaria hoje.
  router.post("/search-test", requireFirebaseAuth, async (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, str(req.body?.clientId));
    if (!clientId) return;
    const companyId = str(req.body?.companyId);
    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    if (!question) return sendErr(res, 400, "MISSING_QUESTION", "Pergunta de teste não fornecida.");

    const threshold = resolveDefaultMinSimilarity();

    let result;
    try {
      result = await findRagContextForQuestion({ clientId, companyId, question, topK: 10, minSimilarity: 0 });
    } catch (err) {
      return sendErr(res, 500, "SEARCH_FAILED", err.message || "Falha ao buscar na base de conhecimento.");
    }

    return res.json({
      success: true,
      applies: result.applies,
      threshold,
      chunks: result.chunks.map((c) => ({
        documentId: c.document_id,
        filename: c.filename || null,
        content: c.content,
        similarity: c.similarity,
        passesThreshold: c.similarity >= threshold,
      })),
      needsReindexDocumentIds: result.needsReindexDocumentIds,
    });
  });

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
