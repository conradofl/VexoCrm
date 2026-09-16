import { describe, expect, it } from "vitest";
import { partitionChunksByEmbeddingIdentity, findRelevantChunks } from "../services/ragSearch.js";
import { embedTexts } from "../services/embeddings.js";

function chunk(documentId, provider, model, embedding, overrides = {}) {
  return {
    id: `chunk-${documentId}-${Math.random().toString(36).slice(2, 6)}`,
    document_id: documentId,
    embedding_provider: provider,
    embedding_model: model,
    embedding,
    content: overrides.content || "conteúdo de teste",
    ...overrides,
  };
}

describe("ragSearch — índice misturado nunca vira busca calada (Etapa 5, Leva 2, Commit 1)", () => {
  describe("partitionChunksByEmbeddingIdentity", () => {
    it("separa comparáveis (mesmo provider+model da pergunta) dos que precisam reindexar", () => {
      const rows = [
        chunk("doc-A", "gemini", "text-embedding-004", [0.1, 0.2]),
        chunk("doc-B", "lexical", "lexical-trigram-hash-v1", [0.3, 0.4]),
        chunk("doc-C", "gemini", "text-embedding-004", [0.5, 0.6]),
      ];
      const { comparable, needsReindexDocumentIds } = partitionChunksByEmbeddingIdentity(rows, {
        provider: "gemini",
        model: "text-embedding-004",
      });

      expect(comparable.map((c) => c.document_id).sort()).toEqual(["doc-A", "doc-C"]);
      expect(needsReindexDocumentIds).toEqual(["doc-B"]);
    });

    it("modelo diferente do MESMO provedor também precisa reindexar (trocar text-embedding-004 por outro invalida o índice)", () => {
      const rows = [chunk("doc-A", "gemini", "text-embedding-004-v2", [0.1, 0.2])];
      const { comparable, needsReindexDocumentIds } = partitionChunksByEmbeddingIdentity(rows, {
        provider: "gemini",
        model: "text-embedding-004",
      });
      expect(comparable).toHaveLength(0);
      expect(needsReindexDocumentIds).toEqual(["doc-A"]);
    });

    it("nenhum chunk -> nenhum comparável, nenhum pra reindexar", () => {
      const { comparable, needsReindexDocumentIds } = partitionChunksByEmbeddingIdentity([], {
        provider: "gemini",
        model: "text-embedding-004",
      });
      expect(comparable).toEqual([]);
      expect(needsReindexDocumentIds).toEqual([]);
    });
  });

  describe("findRelevantChunks — o teste central do achado de revisão", () => {
    it("TESTE OBRIGATÓRIO: documento indexado com um provedor, pergunta com o outro -> aviso de reindexação, NÃO resposta vazia", async () => {
      // Documento indexado 100% corretamente com Gemini (base "cheia e correta").
      const [embeddingDoIndexadoComGemini] = await embedTexts(["Tabela de preços: Plano A custa R$150"], {
        provider: "lexical", // usa lexical só pra gerar UM vetor determinístico de teste — o que importa é o RÓTULO gravado abaixo
      });
      const rows = [
        chunk("doc-precos", "gemini", "text-embedding-004", embeddingDoIndexadoComGemini, {
          content: "Tabela de preços: Plano A custa R$150",
        }),
      ];

      // A cota do Gemini estourou, e a pergunta chega gerada pelo lexical (o cenário exato do achado).
      const [perguntaEmbeddingLexical] = await embedTexts(["quanto custa o Plano A?"], { provider: "lexical" });

      const result = findRelevantChunks(rows, perguntaEmbeddingLexical, {
        provider: "lexical",
        model: "lexical-trigram-hash-v1",
      });

      // Contra o código de antes desta correção: needsReindexDocumentIds não existia,
      // a comparação rodava (256 vs 256, coincidência deste teste específico, mas em
      // produção real 768 vs 256) e o resultado seria silenciosamente "sem trecho" —
      // indistinguível de "a base está vazia".
      expect(result.needsReindexDocumentIds).toEqual(["doc-precos"]);
      expect(result.chunks).toEqual([]);
    });

    it("com a identidade batendo, o trecho relevante é encontrado normalmente (a correção não quebrou o caso feliz)", async () => {
      const [embeddingDocumento] = await embedTexts(["Tabela de preços: Plano A custa R$150"], {
        provider: "lexical",
      });
      const rows = [
        chunk("doc-precos", "lexical", "lexical-trigram-hash-v1", embeddingDocumento, {
          content: "Tabela de preços: Plano A custa R$150",
        }),
      ];
      const [perguntaEmbedding] = await embedTexts(["Tabela de preços: Plano A custa R$150"], {
        provider: "lexical",
      });

      const result = findRelevantChunks(rows, perguntaEmbedding, {
        provider: "lexical",
        model: "lexical-trigram-hash-v1",
        minSimilarity: 0.5,
      });

      expect(result.needsReindexDocumentIds).toEqual([]);
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].document_id).toBe("doc-precos");
    });

    it("base mista: um documento compatível E um incompatível -> acha o compatível E avisa do outro, os dois ao mesmo tempo", async () => {
      const [embeddingA] = await embedTexts(["Política de garantia de 30 dias"], { provider: "lexical" });
      const [embeddingB] = await embedTexts(["Manual técnico de instalação"], { provider: "lexical" });
      const rows = [
        chunk("doc-garantia", "lexical", "lexical-trigram-hash-v1", embeddingA, { content: "Política de garantia de 30 dias" }),
        chunk("doc-manual", "gemini", "text-embedding-004", embeddingB, { content: "Manual técnico de instalação" }),
      ];
      const [pergunta] = await embedTexts(["Política de garantia de 30 dias"], { provider: "lexical" });

      const result = findRelevantChunks(rows, pergunta, {
        provider: "lexical",
        model: "lexical-trigram-hash-v1",
        minSimilarity: 0.5,
      });

      expect(result.chunks.map((c) => c.document_id)).toEqual(["doc-garantia"]);
      expect(result.needsReindexDocumentIds).toEqual(["doc-manual"]);
    });

    it("abaixo do limiar mínimo de semelhança, não entra no resultado mesmo sendo comparável", async () => {
      const [embeddingIrrelevante] = await embedTexts(["Cachorros e gatos precisam de vacina anual"], {
        provider: "lexical",
      });
      const rows = [
        chunk("doc-irrelevante", "lexical", "lexical-trigram-hash-v1", embeddingIrrelevante),
      ];
      const [pergunta] = await embedTexts(["quanto custa o plano essencial?"], { provider: "lexical" });

      const result = findRelevantChunks(rows, pergunta, {
        provider: "lexical",
        model: "lexical-trigram-hash-v1",
        minSimilarity: 0.9,
      });

      expect(result.chunks).toEqual([]);
      expect(result.needsReindexDocumentIds).toEqual([]); // era comparável, só não relevante — não é caso de reindexação
    });

    it("respeita topK", async () => {
      const textos = ["preço A", "preço B", "preço C", "preço D"];
      const embeddings = await embedTexts(textos, { provider: "lexical" });
      const rows = textos.map((t, i) => chunk(`doc-${i}`, "lexical", "lexical-trigram-hash-v1", embeddings[i], { content: t }));
      const [pergunta] = await embedTexts(["preço"], { provider: "lexical" });

      const result = findRelevantChunks(rows, pergunta, {
        provider: "lexical",
        model: "lexical-trigram-hash-v1",
        minSimilarity: 0,
        topK: 2,
      });

      expect(result.chunks.length).toBeLessThanOrEqual(2);
    });
  });
});
