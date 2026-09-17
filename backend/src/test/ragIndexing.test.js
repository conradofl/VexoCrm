import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mocks: banco (fake pool/client), storage, extração e embedding ─────────
// chunkText é a implementação REAL (já provada em ragChunking.test.js) — só o
// que cruza I/O (banco, storage, rede) é mockado aqui.

let fakeDocumentRow = null;
const clientCalls = [];
const poolCalls = [];
let clientQueryImpl = async () => ({ rows: [] });

const fakeClient = {
  query: vi.fn(async (sql, params) => {
    clientCalls.push({ sql, params });
    return clientQueryImpl(sql, params);
  }),
  release: vi.fn(),
};

const fakePool = {
  query: vi.fn(async (sql, params) => {
    poolCalls.push({ sql, params });
    if (sql.includes("SELECT id, client_id, filename, mime_type, storage_key FROM public.rag_documents")) {
      return { rows: fakeDocumentRow ? [fakeDocumentRow] : [] };
    }
    return { rows: [] };
  }),
  connect: vi.fn(async () => fakeClient),
};

vi.mock("../services/database.js", () => ({
  get pgDatabasePool() {
    return fakePool;
  },
}));

const storageMock = { getRagDocumentBuffer: vi.fn() };
vi.mock("../services/storage.js", () => ({
  getRagDocumentBuffer: (...args) => storageMock.getRagDocumentBuffer(...args),
}));

const extractionMock = { extractText: vi.fn(), docTypeFromMimeType: vi.fn(() => "txt") };
vi.mock("../rag/extraction.js", () => ({
  extractText: (...args) => extractionMock.extractText(...args),
  docTypeFromMimeType: (...args) => extractionMock.docTypeFromMimeType(...args),
}));

const embeddingsMock = { embedTexts: vi.fn(), resolveEmbeddingIdentity: vi.fn() };
vi.mock("../services/embeddings.js", () => ({
  embedTexts: (...args) => embeddingsMock.embedTexts(...args),
  resolveEmbeddingIdentity: (...args) => embeddingsMock.resolveEmbeddingIdentity(...args),
}));

const { processRagDocument } = await import("../rag/indexing.js");

const TEXTO_LONGO = "Trecho de teste com conteúdo suficiente pra virar pelo menos um chunk de verdade. ".repeat(5);

function sqlNames(calls) {
  return calls.map((c) => {
    const s = c.sql.trim();
    if (s.startsWith("BEGIN")) return "BEGIN";
    if (s.startsWith("COMMIT")) return "COMMIT";
    if (s.startsWith("ROLLBACK")) return "ROLLBACK";
    if (s.startsWith("DELETE")) return "DELETE";
    if (s.startsWith("INSERT")) return "INSERT";
    if (s.startsWith("UPDATE")) return "UPDATE";
    return s.slice(0, 30);
  });
}

describe("processRagDocument — indexação/reindexação transacional (Etapa 5, Leva 2, Commit 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientCalls.length = 0;
    poolCalls.length = 0;
    clientQueryImpl = async () => ({ rows: [] });
    fakeDocumentRow = {
      id: "doc-1",
      client_id: "geracao-digital",
      filename: "politica.txt",
      mime_type: "text/plain",
      storage_key: "rag/geracao-digital/doc-1/123_politica.txt",
    };
    storageMock.getRagDocumentBuffer.mockResolvedValue({ buffer: Buffer.from(TEXTO_LONGO, "utf-8") });
    extractionMock.extractText.mockResolvedValue(TEXTO_LONGO);
    embeddingsMock.resolveEmbeddingIdentity.mockReturnValue({
      provider: "fake-provider-xyz",
      model: "fake-model-999",
      dim: 42,
    });
  });

  describe("caminho feliz: tudo grava atomicamente", () => {
    it("gera embeddings, apaga trechos antigos e grava os novos dentro de UMA transação (BEGIN...COMMIT)", async () => {
      embeddingsMock.embedTexts.mockImplementation(async (texts) => texts.map(() => [0.1, 0.2, 0.3]));

      const result = await processRagDocument("doc-1");

      expect(result.success).toBe(true);
      expect(result.chunkCount).toBeGreaterThan(0);

      const nomes = sqlNames(clientCalls);
      expect(nomes[0]).toBe("BEGIN");
      expect(nomes).toContain("DELETE");
      expect(nomes).toContain("INSERT");
      expect(nomes[nomes.length - 2]).toBe("UPDATE");
      expect(nomes[nomes.length - 1]).toBe("COMMIT");
      expect(nomes).not.toContain("ROLLBACK");
      expect(fakeClient.release).toHaveBeenCalledTimes(1);
    });

    it("PROVA OBRIGATÓRIA: a procedência gravada vem de resolveEmbeddingIdentity(), não de constante escrita à mão", async () => {
      embeddingsMock.embedTexts.mockImplementation(async (texts) => texts.map(() => [0.1]));
      embeddingsMock.resolveEmbeddingIdentity.mockReturnValue({
        provider: "valor-de-teste-improvavel-abc",
        model: "modelo-de-teste-improvavel-xyz",
        dim: 777,
      });

      await processRagDocument("doc-1");

      const updateDocumento = clientCalls.find((c) => c.sql.includes("SET status = 'ready'"));
      expect(updateDocumento).toBeTruthy();
      expect(updateDocumento.params).toContain("valor-de-teste-improvavel-abc");
      expect(updateDocumento.params).toContain("modelo-de-teste-improvavel-xyz");
      expect(updateDocumento.params).toContain(777);
    });

    it("mudar o que resolveEmbeddingIdentity() devolve muda o que é gravado — prova que é lido, não cacheado", async () => {
      embeddingsMock.embedTexts.mockImplementation(async (texts) => texts.map(() => [0.1]));

      embeddingsMock.resolveEmbeddingIdentity.mockReturnValue({ provider: "gemini", model: "text-embedding-004", dim: 768 });
      await processRagDocument("doc-1");
      const primeiraGravacao = clientCalls.find((c) => c.sql.includes("SET status = 'ready'"));
      expect(primeiraGravacao.params).toContain("gemini");

      clientCalls.length = 0;
      embeddingsMock.resolveEmbeddingIdentity.mockReturnValue({ provider: "lexical", model: "lexical-trigram-hash-v1", dim: 256 });
      await processRagDocument("doc-1");
      const segundaGravacao = clientCalls.find((c) => c.sql.includes("SET status = 'ready'"));
      expect(segundaGravacao.params).toContain("lexical");
    });

    it("chunk_count gravado bate com o número real de trechos inseridos", async () => {
      embeddingsMock.embedTexts.mockImplementation(async (texts) => texts.map(() => [0.1]));
      await processRagDocument("doc-1");

      const inserts = clientCalls.filter((c) => c.sql.trim().startsWith("INSERT"));
      const update = clientCalls.find((c) => c.sql.includes("SET status = 'ready'"));
      expect(update.params).toContain(inserts.length);
    });
  });

  describe("TESTE OBRIGATÓRIO: falha na geração de embedding — nada é apagado, documento vira failed", () => {
    it("embedTexts falha -> ZERO DELETE, ZERO transação aberta, status vira failed com o motivo", async () => {
      embeddingsMock.embedTexts.mockRejectedValue(new Error("Gemini embeddings: erro temporário 503"));

      await expect(processRagDocument("doc-1")).rejects.toThrow(/503/);

      // Nunca abriu conexão de transação -> nunca teve chance de apagar nada.
      expect(fakePool.connect).not.toHaveBeenCalled();
      expect(clientCalls).toHaveLength(0);

      const updateFalha = poolCalls.find((c) => c.sql.includes("status = 'failed'"));
      expect(updateFalha).toBeTruthy();
      expect(updateFalha.params.join(" ")).toContain("503");

      // Nunca ficou ready.
      const updateReady = poolCalls.find((c) => c.sql.includes("status = 'ready'"));
      expect(updateReady).toBeUndefined();
    });

    it("RAG_EMBEDDING_MODEL apontando pra modelo inexistente: falha uma vez (sem retry aqui dentro — quem não repete é embedBatchGemini, testado em embeddings.test.js), error_log traz o nome do modelo tentado", async () => {
      const err = new Error(
        'Gemini embeddings: modelo "text-embedding-inexistente-999" não encontrado (404). Confira a variável RAG_EMBEDDING_MODEL.'
      );
      err.code = "EMBEDDING_MODEL_NOT_FOUND";
      embeddingsMock.embedTexts.mockRejectedValue(err);

      await expect(processRagDocument("doc-1")).rejects.toThrow(/text-embedding-inexistente-999/);

      expect(embeddingsMock.embedTexts).toHaveBeenCalledTimes(1);
      expect(fakePool.connect).not.toHaveBeenCalled();

      const updateFalha = poolCalls.find((c) => c.sql.includes("status = 'failed'"));
      expect(updateFalha).toBeTruthy();
      expect(updateFalha.params.join(" ")).toContain("text-embedding-inexistente-999");
    });
  });

  describe("TESTE OBRIGATÓRIO: PDF digitalizado / texto insuficiente — não chama embedding nem toca em chunks", () => {
    it("extractText rejeita com INSUFFICIENT_TEXT -> embedTexts nunca é chamado, documento vira failed", async () => {
      const err = new Error("Este PDF parece ser digitalizado (sem texto extraível). Exporte em texto ou envie outro formato.");
      err.code = "INSUFFICIENT_TEXT";
      extractionMock.extractText.mockRejectedValue(err);

      await expect(processRagDocument("doc-1")).rejects.toThrow(/digitalizado/);

      expect(embeddingsMock.embedTexts).not.toHaveBeenCalled();
      expect(fakePool.connect).not.toHaveBeenCalled();

      const updateFalha = poolCalls.find((c) => c.sql.includes("status = 'failed'"));
      expect(updateFalha.params.join(" ")).toContain("digitalizado");
    });
  });

  describe("TESTE OBRIGATÓRIO: falha no meio da transação — rollback, nunca ready sem trecho", () => {
    it("um INSERT falha no meio -> ROLLBACK, nunca COMMIT, documento vira failed (não ready com trechos pela metade)", async () => {
      // Texto grande o bastante pra virar VÁRIOS trechos — precisa de pelo
      // menos 2 INSERTs pra "falhar no meio" fazer sentido.
      extractionMock.extractText.mockResolvedValue(TEXTO_LONGO.repeat(30));
      embeddingsMock.embedTexts.mockImplementation(async (texts) => texts.map(() => [0.1]));

      let insertCount = 0;
      clientQueryImpl = async (sql) => {
        if (sql.trim().startsWith("INSERT")) {
          insertCount++;
          if (insertCount === 2) throw new Error("conexão com o banco caiu no meio do lote");
        }
        return { rows: [] };
      };

      await expect(processRagDocument("doc-1")).rejects.toThrow(/conexão com o banco caiu/);

      const nomes = sqlNames(clientCalls);
      expect(nomes).toContain("ROLLBACK");
      expect(nomes).not.toContain("COMMIT");
      expect(fakeClient.release).toHaveBeenCalledTimes(1);

      const updateFalha = poolCalls.find((c) => c.sql.includes("status = 'failed'"));
      expect(updateFalha).toBeTruthy();

      const updateReady = clientCalls.find((c) => c.sql.includes("status = 'ready'"));
      expect(updateReady).toBeUndefined();
    });
  });

  describe("documento inexistente", () => {
    it("lança erro claro, nunca chama storage/extração/embedding", async () => {
      fakeDocumentRow = null;
      await expect(processRagDocument("doc-fantasma")).rejects.toThrow(/não encontrado/);
      expect(storageMock.getRagDocumentBuffer).not.toHaveBeenCalled();
      expect(embeddingsMock.embedTexts).not.toHaveBeenCalled();
    });
  });
});
