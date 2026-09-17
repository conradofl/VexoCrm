// backend/src/rag/indexing.js
//
// Orquestração de indexação/reindexação de um documento RAG. Mesma função
// serve os dois casos (upload inicial e reprocessar) — um documento "novo"
// não tem chunk nenhum pra apagar, então o caminho é idêntico.
//
// Transacional por design (achado de revisão do Commit 1): a geração de
// embedding (rede, pode falhar) roda ANTES de tocar em rag_chunks. Só depois
// que TODOS os vetores foram gerados com sucesso é que abre a transação que
// apaga os trechos antigos e grava os novos — atômico, os dois juntos ou
// nenhum. Se a geração de embedding falhar, os trechos antigos (se havia
// algum) continuam exatamente como estavam, e o documento vira `failed` com
// o motivo em error_log. Nunca existe um estado "ready" com zero trechos.

import { pgDatabasePool } from "../services/database.js";
import { getRagDocumentBuffer } from "../services/storage.js";
import { docTypeFromMimeType, extractText } from "./extraction.js";
import { chunkText, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP } from "./chunking.js";
import { embedTexts, resolveEmbeddingIdentity } from "../services/embeddings.js";

function getDb() {
  // Getter, não o valor capturado: pgDatabasePool só é atribuído em
  // initDatabase(), que roda depois do registro dos jobs/rotas. Ler aqui
  // dentro da função (chamada em runtime, não na importação do módulo)
  // pega o valor real — é o mesmo cuidado de contractRoutes.js.
  return pgDatabasePool;
}

async function markFailed(pool, documentId, message) {
  await pool.query(
    `UPDATE public.rag_documents SET status = 'failed', error_log = $1, updated_at = NOW() WHERE id = $2`,
    [String(message || "Falha desconhecida ao indexar.").slice(0, 2000), documentId]
  );
}

/**
 * Indexa (ou reindexa) um documento RAG já gravado em rag_documents e no
 * storage. Devolve { success: true, chunkCount } em sucesso; lança em falha
 * (depois de já ter marcado o documento como `failed` no banco).
 */
export async function processRagDocument(documentId) {
  const pool = getDb();
  if (!pool) {
    throw new Error("[rag/indexing] pool de banco de dados indisponível.");
  }

  const { rows } = await pool.query(
    `SELECT id, client_id, filename, mime_type, storage_key FROM public.rag_documents WHERE id = $1`,
    [documentId]
  );
  if (!rows.length) {
    throw new Error(`[rag/indexing] documento ${documentId} não encontrado.`);
  }
  const doc = rows[0];

  await pool.query(
    `UPDATE public.rag_documents SET status = 'processing', updated_at = NOW() WHERE id = $1`,
    [documentId]
  );

  try {
    const fileData = await getRagDocumentBuffer(doc.storage_key);
    if (!fileData || !fileData.buffer) {
      const err = new Error("Arquivo não encontrado no armazenamento.");
      err.code = "FILE_NOT_FOUND";
      throw err;
    }

    const docType = docTypeFromMimeType(doc.mime_type);
    const text = await extractText(fileData.buffer, docType);

    const chunks = chunkText(text, { chunkSize: DEFAULT_CHUNK_SIZE, overlap: DEFAULT_CHUNK_OVERLAP });
    if (chunks.length === 0) {
      const err = new Error("Nenhum trecho gerado a partir do texto extraído.");
      err.code = "NO_CHUNKS_GENERATED";
      throw err;
    }

    // Procedência lida de resolveEmbeddingIdentity() no momento da indexação —
    // nunca uma constante escrita à mão neste arquivo. É a única fonte de
    // verdade sobre qual provedor/modelo está ativo agora; duplicar isso aqui
    // divergiria da real geração de vetor sem nenhum aviso.
    const identity = resolveEmbeddingIdentity();
    const vectors = await embedTexts(chunks.map((c) => c.content), { provider: identity.provider });

    if (vectors.length !== chunks.length) {
      const err = new Error(
        `Geração de embedding devolveu ${vectors.length} vetor(es) pra ${chunks.length} trecho(s).`
      );
      err.code = "EMBEDDING_COUNT_MISMATCH";
      throw err;
    }

    // Dimensão REAL do vetor devolvido, não identity.dim (que é um valor
    // assumido por provedor — 768 pra "gemini" independente de qual modelo
    // RAG_EMBEDDING_MODEL apontar). Modelo Gemini novo pode devolver tamanho
    // diferente do padrão antigo; gravar o assumido em vez do real deixaria a
    // procedência mentindo exatamente na coluna que existe pra nunca mentir.
    const actualDim = vectors[0]?.length ?? identity.dim;

    // A partir daqui a rede já terminou — só resta gravar. Isolado numa
    // transação: apaga os trechos antigos e grava os novos como uma coisa só.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM public.rag_chunks WHERE document_id = $1`, [documentId]);

      for (let i = 0; i < chunks.length; i++) {
        await client.query(
          `INSERT INTO public.rag_chunks (document_id, client_id, ordinal, content, embedding, char_count)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            documentId,
            doc.client_id,
            chunks[i].ordinal,
            chunks[i].content,
            JSON.stringify(vectors[i]),
            chunks[i].charCount,
          ]
        );
      }

      await client.query(
        `UPDATE public.rag_documents
            SET status = 'ready',
                chunk_count = $1,
                embedding_provider = $2,
                embedding_model = $3,
                embedding_dim = $4,
                error_log = NULL,
                updated_at = NOW()
          WHERE id = $5`,
        [chunks.length, identity.provider, identity.model, actualDim, documentId]
      );

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    return { success: true, chunkCount: chunks.length };
  } catch (err) {
    await markFailed(pool, documentId, err?.message || err);
    throw err;
  }
}
