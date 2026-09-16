import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  embedTexts,
  cosineSimilarity,
  currentEmbeddingProvider,
  resolveEmbeddingIdentity,
  GEMINI_EMBEDDING_MODEL,
  GEMINI_EMBEDDING_DIM,
  LEXICAL_EMBEDDING_MODEL,
  LEXICAL_EMBEDDING_DIM,
} from "../services/embeddings.js";

describe("Serviço de Embedding (Etapa 5, Leva 2, Commit 1) — trocar de provedor é configuração", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("provedor lexical — determinístico, sem rede, NUNCA escolhido automaticamente", () => {
    it("NENHUMA chamada de rede acontece com o provedor lexical", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      process.env.RAG_EMBEDDING_PROVIDER = "lexical";

      await embedTexts(["Tabela de preços do plano essencial", "Política de garantia de 30 dias"]);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("o mesmo texto gera sempre o mesmo vetor (determinístico)", async () => {
      process.env.RAG_EMBEDDING_PROVIDER = "lexical";
      const [v1] = await embedTexts(["Plano Avançado inclui múltiplos chips"]);
      const [v2] = await embedTexts(["Plano Avançado inclui múltiplos chips"]);
      expect(v1).toEqual(v2);
    });

    it("textos diferentes geram vetores diferentes", async () => {
      process.env.RAG_EMBEDDING_PROVIDER = "lexical";
      const [v1, v2] = await embedTexts([
        "Tabela de preços do plano essencial",
        "Manual técnico de dimensionamento fotovoltaico",
      ]);
      expect(v1).not.toEqual(v2);
    });

    it("textos com palavras em comum ficam mais próximos (cosine) do que textos sem nada em comum", async () => {
      process.env.RAG_EMBEDDING_PROVIDER = "lexical";
      const [base, parecido, diferente] = await embedTexts([
        "O plano essencial custa cento e cinquenta reais por mês",
        "O plano essencial custa cento e sessenta reais por mês",
        "Cachorros e gatos precisam de vacina anual",
      ]);
      const simParecido = cosineSimilarity(base, parecido);
      const simDiferente = cosineSimilarity(base, diferente);
      expect(simParecido).toBeGreaterThan(simDiferente);
    });

    it("NÃO entende sinônimo/paráfrase — só letras em comum (prova de que é lexical, não semântico)", async () => {
      process.env.RAG_EMBEDDING_PROVIDER = "lexical";
      const [pergunta, respostaParafraseada] = await embedTexts([
        "vocês parcelam?",
        "12x sem juros",
      ]);
      // Zero trigrama em comum entre as duas frases -> similaridade ~0, não alta.
      expect(cosineSimilarity(pergunta, respostaParafraseada)).toBeLessThan(0.2);
    });

    it("array vazio devolve array vazio, sem erro", async () => {
      process.env.RAG_EMBEDDING_PROVIDER = "lexical";
      expect(await embedTexts([])).toEqual([]);
    });

    it("currentEmbeddingProvider() reflete a variável de ambiente", () => {
      process.env.RAG_EMBEDDING_PROVIDER = "lexical";
      expect(currentEmbeddingProvider()).toBe("lexical");
    });

    it("qualquer variante que não seja exatamente 'lexical' cai no gemini (nunca escolhido por acidente)", () => {
      process.env.RAG_EMBEDDING_PROVIDER = "local"; // nome antigo, não existe mais
      expect(currentEmbeddingProvider()).toBe("gemini");
    });
  });

  describe("provedor gemini — padrão, ÚNICO escolhido automaticamente, precisa de GEMINI_API_KEY", () => {
    it("é o provedor padrão quando RAG_EMBEDDING_PROVIDER não está definida", () => {
      delete process.env.RAG_EMBEDDING_PROVIDER;
      expect(currentEmbeddingProvider()).toBe("gemini");
    });

    it("sem GEMINI_API_KEY configurada, FALHA com mensagem clara — nunca cai pro lexical em silêncio", async () => {
      process.env.RAG_EMBEDDING_PROVIDER = "gemini";
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      const fetchSpy = vi.spyOn(global, "fetch");

      await expect(embedTexts(["texto qualquer"])).rejects.toThrow(/GEMINI_API_KEY/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("chama a API do Gemini em lote e devolve os vetores na mesma ordem", async () => {
      process.env.RAG_EMBEDDING_PROVIDER = "gemini";
      process.env.GEMINI_API_KEY = "fake-key-for-test";

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
        }),
      });

      const result = await embedTexts(["primeiro texto", "segundo texto"]);
      expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toContain("batchEmbedContents");
      expect(url).toContain("fake-key-for-test");
      const body = JSON.parse(options.body);
      expect(body.requests).toHaveLength(2);
    });

    it("erro 429 (rate limit) tenta de novo, e no sucesso da segunda tentativa devolve o resultado", async () => {
      process.env.RAG_EMBEDDING_PROVIDER = "gemini";
      process.env.GEMINI_API_KEY = "fake-key-for-test";

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ embeddings: [{ values: [0.5, 0.5] }] }),
        });

      const result = await embedTexts(["texto único"]);
      expect(result).toEqual([[0.5, 0.5]]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    }, 15000);
  });

  describe("resolveEmbeddingIdentity — procedência gravada em rag_documents", () => {
    it("gemini: modelo e dimensão reais do text-embedding-004", () => {
      expect(resolveEmbeddingIdentity("gemini")).toEqual({
        provider: "gemini",
        model: GEMINI_EMBEDDING_MODEL,
        dim: GEMINI_EMBEDDING_DIM,
      });
    });

    it("lexical: modelo e dimensão do vetorizador de trigramas", () => {
      expect(resolveEmbeddingIdentity("lexical")).toEqual({
        provider: "lexical",
        model: LEXICAL_EMBEDDING_MODEL,
        dim: LEXICAL_EMBEDDING_DIM,
      });
    });

    it("a dimensão declarada bate com o tamanho real do vetor gerado", async () => {
      const identity = resolveEmbeddingIdentity("lexical");
      const [vector] = await embedTexts(["qualquer texto"], { provider: "lexical" });
      expect(vector.length).toBe(identity.dim);
    });
  });

  describe("cosineSimilarity — dimensão incompatível é ERRO, não zero", () => {
    it("vetores idênticos têm similaridade 1", () => {
      expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
    });

    it("vetores ortogonais de mesma dimensão têm similaridade 0", () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
    });

    it("vetores de tamanhos diferentes LANÇAM — nunca devolvem 0 silenciosamente", () => {
      expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/dimensões incompatíveis/);
    });

    it("o caso real do achado: Gemini (768) contra lexical (256) lança, não vira 'sem trecho relevante' silencioso", async () => {
      const [vetorGemini] = [Array.from({ length: GEMINI_EMBEDDING_DIM }, () => 0.01)];
      const [vetorLexical] = await embedTexts(["texto qualquer"], { provider: "lexical" });
      expect(() => cosineSimilarity(vetorGemini, vetorLexical)).toThrow(/dimensões incompatíveis/);
    });
  });
});
