// backend/src/services/ragSearch.js
//
// Funções puras de comparação/ranking de trechos RAG. Sem I/O — a rota que
// buscar os chunks no banco (Commit 3, wiring no chatbot-ai-engine.js) decide
// QUAIS linhas entram aqui; estas funções só decidem o que é comparável e o
// que é mais relevante.
//
// Correção do achado de revisão do Commit 1: um trecho indexado com um
// provedor/modelo de embedding não pode ser comparado (cosineSimilarity) com
// a pergunta gerada por outro — as dimensões nem batem na maioria dos casos, e
// mesmo quando batem por coincidência o espaço vetorial é outro. A partição
// abaixo separa ANTES de comparar: nunca deixa um par incompatível chegar em
// cosineSimilarity (que lança se isso acontecer mesmo assim — defesa em
// profundidade, não a única trava).

import { cosineSimilarity } from "./embeddings.js";

/**
 * Separa uma lista de chunks (já com embedding_provider/embedding_model do
 * documento-pai denormalizados na linha, como a query de busca real vai
 * trazer via JOIN) entre os comparáveis com a identidade de embedding da
 * pergunta atual e os que pertencem a documento indexado com outra
 * procedência — esses últimos precisam de reindexação antes de poderem ser
 * usados de novo.
 *
 * @param {Array<{document_id: string, embedding_provider: string, embedding_model: string}>} chunkRows
 * @param {{ provider: string, model: string }} queryIdentity
 */
export function partitionChunksByEmbeddingIdentity(chunkRows, queryIdentity) {
  const comparable = [];
  const needsReindexDocumentIds = new Set();

  for (const row of chunkRows || []) {
    if (row.embedding_provider === queryIdentity.provider && row.embedding_model === queryIdentity.model) {
      comparable.push(row);
    } else {
      needsReindexDocumentIds.add(row.document_id);
    }
  }

  return { comparable, needsReindexDocumentIds: Array.from(needsReindexDocumentIds) };
}

/**
 * Encontra os `topK` trechos mais relevantes pra uma pergunta, só entre os
 * comparáveis com a identidade de embedding da pergunta. Documentos
 * incompatíveis nunca entram na busca calados — voltam em
 * `needsReindexDocumentIds`, pra a camada de cima (rota/UI) avisar "precisa
 * reindexar" em vez de devolver silêncio como se a base estivesse vazia.
 *
 * @param {Array<{document_id: string, embedding: number[], embedding_provider: string, embedding_model: string}>} chunkRows
 * @param {number[]} queryEmbedding
 * @param {{ provider: string, model: string, topK?: number, minSimilarity?: number }} options
 */
export function findRelevantChunks(chunkRows, queryEmbedding, { provider, model, topK = 5, minSimilarity = 0.5 }) {
  const { comparable, needsReindexDocumentIds } = partitionChunksByEmbeddingIdentity(chunkRows, { provider, model });

  // Depois da partição por provider+model, cosineSimilarity não deveria mais
  // encontrar dimensão incompatível — mas se encontrar (corrupção de dado,
  // bug de escrita), deixa lançar. É o comportamento certo: quem chama esta
  // função (Commit 3) já trata "nenhum trecho relevante" caindo pra
  // transferência — um erro aqui deve seguir o mesmo caminho, nunca travar a
  // conversa, mas também nunca fingir silenciosamente que deu zero.
  const scored = comparable
    .map((row) => ({ ...row, similarity: cosineSimilarity(queryEmbedding, row.embedding) }))
    .filter((row) => row.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return { chunks: scored, needsReindexDocumentIds };
}
