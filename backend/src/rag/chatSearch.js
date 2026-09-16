// backend/src/rag/chatSearch.js
//
// Ponte entre a Base de Conhecimento RAG e o motor do chatbot. Resolve os
// trechos relevantes pra uma pergunta de lead — reaproveita findRelevantChunks
// (ragSearch.js, Commit 1) pra nunca comparar vetores de procedências
// diferentes, e embedTexts/resolveEmbeddingIdentity (embeddings.js) pra gerar
// o embedding da pergunta com o MESMO provedor que indexou os documentos.
//
// `applies: false` significa "este tenant/agente não tem nenhum documento
// pronto" — o chamador (chatbot-ai-engine.js) segue o fluxo de hoje, sem
// nenhuma mudança de comportamento. Só quando `applies: true` é que a regra
// dura entra: sem trecho acima do limiar, sem chamada ao modelo.

import { pgDatabasePool } from "../services/database.js";
import { embedTexts, resolveEmbeddingIdentity } from "../services/embeddings.js";
import { findRelevantChunks } from "../services/ragSearch.js";

export const DEFAULT_TOP_K = 5;

// Limiar de similaridade — o número que decide entre "responder com o trecho"
// e "não achou nada, segue conversa normal". Lido do ambiente A CADA CHAMADA
// (mesmo padrão de resolveEmbeddingIdentity em embeddings.js — nunca cacheado
// em módulo), pra dar pra calibrar sem deploy. Ainda é um valor único pro
// sistema inteiro, não por tenant — quando houver uso real e tenants
// precisarem de limiares diferentes (base mais esparsa vs. mais densa), isso
// vira coluna em rag_documents ou configuração de agente, não env var global.
export function resolveDefaultMinSimilarity() {
  const raw = process.env.RAG_MIN_SIMILARITY;
  if (raw === undefined || raw === null || raw === "") return 0.5;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.5;
}

export const DEFAULT_RAG_TRANSFER_MESSAGE =
  "Não tenho essa informação aqui. Vou passar para um especialista que já te responde.";

function getDb() {
  return pgDatabasePool;
}

/**
 * Busca os trechos relevantes pra uma pergunta, escopados ao client_id — e ao
 * agente (companyId), quando o documento estiver amarrado a um. Documento sem
 * company_id (NULL) vale pro tenant inteiro; documento com company_id só
 * entra na busca de conversas daquele agente específico.
 */
export async function findRagContextForQuestion({
  clientId,
  companyId = null,
  question,
  topK = DEFAULT_TOP_K,
  minSimilarity = resolveDefaultMinSimilarity(),
}) {
  const pool = getDb();
  if (!pool || !clientId || !question || !String(question).trim()) {
    return { applies: false, chunks: [], needsReindexDocumentIds: [] };
  }

  // Checagem barata ANTES de gerar embedding (rede): tenant/agente sem nenhum
  // documento pronto não paga o custo de uma chamada de embedding que não vai
  // servir pra nada, e o fluxo de hoje segue intocado.
  const { rows: readyRows } = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM public.rag_documents
      WHERE client_id = $1 AND status = 'ready' AND (company_id IS NULL OR company_id = $2)`,
    [clientId, companyId]
  );
  if (!readyRows[0] || readyRows[0].n === 0) {
    return { applies: false, chunks: [], needsReindexDocumentIds: [] };
  }

  const identity = resolveEmbeddingIdentity();
  const [questionEmbedding] = await embedTexts([question], { provider: identity.provider });

  const { rows } = await pool.query(
    `SELECT rc.document_id, rc.content, rc.embedding, rd.embedding_provider, rd.embedding_model
       FROM public.rag_chunks rc
       JOIN public.rag_documents rd ON rd.id = rc.document_id
      WHERE rd.client_id = $1 AND rd.status = 'ready' AND (rd.company_id IS NULL OR rd.company_id = $2)`,
    [clientId, companyId]
  );

  const chunkRows = rows.map((r) => ({
    ...r,
    embedding: typeof r.embedding === "string" ? JSON.parse(r.embedding) : r.embedding,
  }));

  const { chunks, needsReindexDocumentIds } = findRelevantChunks(chunkRows, questionEmbedding, {
    provider: identity.provider,
    model: identity.model,
    topK,
    minSimilarity,
  });

  return { applies: true, chunks, needsReindexDocumentIds };
}

/**
 * Monta o bloco de contexto RAG pro prompt do sistema. Nunca cita nome de
 * documento nem número de trecho — conversa de WhatsApp não tem rodapé de
 * fonte. A regra ("responda só com o que está aqui") é reforçada aqui e na
 * instrução do contrato JSON (buildJsonInstruction).
 */
export function buildRagContextBlock(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return "";

  const trechos = chunks.map((c) => c.content.trim()).join("\n\n---\n\n");

  return `

═══════════════════════════════════════════════════════════════
BASE DE CONHECIMENTO (CONTEXTO RECUPERADO PARA ESTA PERGUNTA)
═══════════════════════════════════════════════════════════════
Os trechos abaixo vieram da base de documentos da empresa e são a ÚNICA fonte
de verdade pra responder o que o lead perguntou agora. Responda SOMENTE com o
que está aqui. Se a resposta não estiver nestes trechos, você NÃO SABE —
marque "precisa_humano": true e use a frase de transferência, mesmo que ache
que sabe a resposta por conta própria. Nunca cite "documento", "trecho" ou
qualquer numeração — fale como se soubesse a informação naturalmente.

${trechos}
═══════════════════════════════════════════════════════════════`;
}
