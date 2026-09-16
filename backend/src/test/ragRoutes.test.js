import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// search-test roda embedTexts de verdade (só o banco é mockado) — lexical é
// determinístico e sem rede, mesma escolha de ragChatSearch.test.js.
process.env.RAG_EMBEDDING_PROVIDER = "lexical";

const poolQueryMock = vi.fn(async () => ({ rows: [] }));
vi.mock("../services/database.js", () => ({
  get pgDatabasePool() {
    return { query: poolQueryMock };
  },
}));

const saveRagDocumentBufferMock = vi.fn();
const deleteRagDocumentBufferMock = vi.fn();
vi.mock("../services/storage.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // detectRagDocumentType e RAG_MAX_BYTES ficam REAIS — quero testar a
    // rejeição de verdade por assinatura de bytes através da rota.
    saveRagDocumentBuffer: (...args) => saveRagDocumentBufferMock(...args),
    deleteRagDocumentBuffer: (...args) => deleteRagDocumentBufferMock(...args),
  };
});

const queueAddMock = vi.fn(async () => ({ id: "bull-job-1" }));
vi.mock("../rag/queue.js", () => ({
  getRagQueue: () => ({ add: (...args) => queueAddMock(...args) }),
}));

// requireInternalPageAccess fica REAL — quero testar o gate de permissão de
// verdade, não uma simulação do que ele deveria fazer. Só requireFirebaseAuth
// é trocado por um passthrough (não dá pra verificar token Firebase de
// verdade em teste).
vi.mock("../access/middlewares.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requireFirebaseAuth: (req, res, next) => next(),
  };
});

const { registerRagRoutes } = await import("../rag/routes.js");

function buildRagRouter() {
  let ragRouter = null;
  const fakeApp = {
    use: (path, router) => {
      if (path === "/api/rag") ragRouter = router;
    },
  };
  registerRagRoutes(fakeApp);
  expect(ragRouter).toBeDefined();
  return ragRouter;
}

function getRouteHandler(routePath, method) {
  const ragRouter = buildRagRouter();
  const layer = ragRouter.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  expect(layer, `rota ${method.toUpperCase()} ${routePath} não encontrada`).toBeDefined();
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// Middlewares de router.use (requireFirebaseAuth + requireInternalPageAccess)
// rodam ANTES de qualquer rota — é o gate compartilhado pelo router inteiro.
function getRouterLevelMiddlewares() {
  const ragRouter = buildRagRouter();
  return ragRouter.stack.filter((l) => !l.route).map((l) => l.handle);
}

async function runMiddlewareChain(handlers, req, res) {
  let idx = 0;
  const next = async (err) => {
    if (err) throw err;
    const h = handlers[idx++];
    if (!h) return;
    await h(req, res, next);
  };
  await next();
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; },
  };
}

function adminAccess() {
  return { role: "internal", isAdmin: true, scopeMode: "all_clients", clientIds: [] };
}

function assignedAccess(clientIds) {
  return { role: "internal", isAdmin: false, scopeMode: "assigned_clients", clientIds };
}

const PDF_BUFFER = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(50, 0x20)]);
const EXE_BUFFER = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(50)]);

describe("Rotas RAG (Etapa 5, Leva 2, Commit 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolQueryMock.mockResolvedValue({ rows: [] });
    saveRagDocumentBufferMock.mockResolvedValue({ storageKey: "rag/tenant/doc/123_arquivo.pdf", sizeBytes: 100 });
    deleteRagDocumentBufferMock.mockResolvedValue(true);
  });

  describe("POST /documents — upload", () => {
    it("PROVA ESTRUTURAL OBRIGATÓRIA: routes.js não importa indexing.js — upload só pode indexar via fila, nunca inline", () => {
      const fonte = readFileSync(resolve("src/rag/routes.js"), "utf8");
      expect(fonte).not.toContain("indexing.js");
      expect(fonte).not.toContain("processRagDocument");
    });

    it("upload válido: grava status pending, enfileira e responde 201 — sem esperar a indexação", async () => {
      const handler = getRouteHandler("/documents", "post");
      const req = {
        query: { clientId: "geracao-digital" },
        headers: { "x-file-name": "politica.pdf" },
        body: PDF_BUFFER,
        authAccess: adminAccess(),
      };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.document.status).toBe("pending");

      const insert = poolQueryMock.mock.calls.find(([sql]) => sql.includes("INSERT INTO public.rag_documents"));
      expect(insert).toBeTruthy();
      expect(insert[0]).toContain("'pending'");

      expect(queueAddMock).toHaveBeenCalledTimes(1);
      const [jobName, jobData, jobOpts] = queueAddMock.mock.calls[0];
      expect(jobName).toBe("index-document");
      expect(jobData).toHaveProperty("documentId");
      expect(jobOpts.jobId).toContain("rag-index-");
    });

    it("arquivo travestido de PDF mas com assinatura de executável -> 400, NUNCA salva nem enfileira", async () => {
      const handler = getRouteHandler("/documents", "post");
      const req = {
        query: { clientId: "geracao-digital" },
        headers: { "x-file-name": "fingido.pdf" },
        body: EXE_BUFFER,
        authAccess: adminAccess(),
      };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(400);
      expect(saveRagDocumentBufferMock).not.toHaveBeenCalled();
      expect(queueAddMock).not.toHaveBeenCalled();
      expect(poolQueryMock).not.toHaveBeenCalled();
    });

    it("buffer vazio -> 400, sem tocar em storage/banco/fila", async () => {
      const handler = getRouteHandler("/documents", "post");
      const req = { query: { clientId: "geracao-digital" }, headers: {}, body: Buffer.alloc(0), authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(400);
      expect(saveRagDocumentBufferMock).not.toHaveBeenCalled();
      expect(queueAddMock).not.toHaveBeenCalled();
    });

    it("arquivo maior que 20MB -> 400 FILE_TOO_LARGE, sem tocar em storage", async () => {
      const handler = getRouteHandler("/documents", "post");
      const enorme = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(21 * 1024 * 1024)]);
      const req = { query: { clientId: "geracao-digital" }, headers: {}, body: enorme, authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("FILE_TOO_LARGE");
      expect(saveRagDocumentBufferMock).not.toHaveBeenCalled();
    });

    it("tenant fora do escopo do usuário -> 403, nunca salva nem grava linha", async () => {
      const handler = getRouteHandler("/documents", "post");
      const req = {
        query: { clientId: "sonhare" },
        headers: {},
        body: PDF_BUFFER,
        authAccess: assignedAccess(["geracao-digital"]),
      };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      expect(saveRagDocumentBufferMock).not.toHaveBeenCalled();
      expect(poolQueryMock).not.toHaveBeenCalled();
    });
  });

  describe("POST /documents/:id/reprocess", () => {
    it("documento existente e autorizado: volta pra pending e reenfileira", async () => {
      poolQueryMock.mockImplementation(async (sql) => {
        if (sql.includes("SELECT id, client_id FROM public.rag_documents")) {
          return { rows: [{ id: "doc-1", client_id: "geracao-digital" }] };
        }
        return { rows: [] };
      });

      const handler = getRouteHandler("/documents/:id/reprocess", "post");
      const req = { params: { id: "doc-1" }, authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("pending");

      const update = poolQueryMock.mock.calls.find(([sql]) => sql.includes("SET status = 'pending'"));
      expect(update).toBeTruthy();
      expect(queueAddMock).toHaveBeenCalledTimes(1);
    });

    it("documento inexistente -> 404, nunca reenfileira", async () => {
      poolQueryMock.mockResolvedValue({ rows: [] });
      const handler = getRouteHandler("/documents/:id/reprocess", "post");
      const req = { params: { id: "doc-fantasma" }, authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(404);
      expect(queueAddMock).not.toHaveBeenCalled();
    });

    it("documento de outro tenant -> 403, nunca muda status nem reenfileira (tenant vem da linha, não do payload)", async () => {
      poolQueryMock.mockImplementation(async (sql) => {
        if (sql.includes("SELECT id, client_id FROM public.rag_documents")) {
          return { rows: [{ id: "doc-1", client_id: "sonhare" }] };
        }
        return { rows: [] };
      });

      const handler = getRouteHandler("/documents/:id/reprocess", "post");
      const req = { params: { id: "doc-1" }, authAccess: assignedAccess(["geracao-digital"]) };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      const update = poolQueryMock.mock.calls.find(([sql]) => sql.includes("SET status = 'pending'"));
      expect(update).toBeUndefined();
      expect(queueAddMock).not.toHaveBeenCalled();
    });
  });

  describe("GET /documents — lista pra tela (Commit 4)", () => {
    it("lista documentos do tenant, mapeando as colunas certas e sem needsReindex quando a procedência bate", async () => {
      process.env.RAG_EMBEDDING_PROVIDER = "lexical";
      poolQueryMock.mockResolvedValue({
        rows: [
          {
            id: "doc-1",
            filename: "politica.pdf",
            mime_type: "application/pdf",
            size_bytes: 1024,
            status: "ready",
            error_log: null,
            chunk_count: 12,
            embedding_provider: "lexical",
            embedding_model: "lexical-trigram-hash-v1",
            company_id: null,
            created_at: "2026-09-01T10:00:00Z",
            updated_at: "2026-09-01T10:05:00Z",
          },
        ],
      });

      const handler = getRouteHandler("/documents", "get");
      const req = { query: { clientId: "geracao-digital" }, authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.documents).toHaveLength(1);
      const doc = res.body.documents[0];
      expect(doc).toMatchObject({
        id: "doc-1",
        filename: "politica.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: "ready",
        chunkCount: 12,
        needsReindex: false,
      });
    });

    it("documento indexado com OUTRO provedor/modelo: needsReindex true", async () => {
      process.env.RAG_EMBEDDING_PROVIDER = "lexical"; // identidade ATUAL é lexical
      poolQueryMock.mockResolvedValue({
        rows: [
          {
            id: "doc-velho",
            filename: "catalogo_antigo.pdf",
            mime_type: "application/pdf",
            size_bytes: 2048,
            status: "ready",
            error_log: null,
            chunk_count: 30,
            embedding_provider: "gemini", // indexado antes, com outro provedor
            embedding_model: "text-embedding-004",
            company_id: null,
            created_at: "2026-08-01T10:00:00Z",
            updated_at: "2026-08-01T10:05:00Z",
          },
        ],
      });

      const handler = getRouteHandler("/documents", "get");
      const req = { query: { clientId: "geracao-digital" }, authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.body.documents[0].needsReindex).toBe(true);
    });

    it("documento ainda 'pending' (sem procedência gravada): needsReindex nunca true", async () => {
      poolQueryMock.mockResolvedValue({
        rows: [
          {
            id: "doc-novo",
            filename: "recem_subido.pdf",
            mime_type: "application/pdf",
            size_bytes: 500,
            status: "pending",
            error_log: null,
            chunk_count: 0,
            embedding_provider: null,
            embedding_model: null,
            company_id: null,
            created_at: "2026-09-16T10:00:00Z",
            updated_at: "2026-09-16T10:00:00Z",
          },
        ],
      });

      const handler = getRouteHandler("/documents", "get");
      const req = { query: { clientId: "geracao-digital" }, authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.body.documents[0].needsReindex).toBe(false);
    });

    it("tenant fora do escopo -> 403", async () => {
      const handler = getRouteHandler("/documents", "get");
      const req = { query: { clientId: "sonhare" }, authAccess: assignedAccess(["geracao-digital"]) };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      expect(poolQueryMock).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /documents/:id — apaga arquivo, trechos (cascade) e registro", () => {
    it("apagar apaga tudo: storage primeiro, DELETE do banco depois (cascade cuida dos chunks)", async () => {
      poolQueryMock.mockImplementation(async (sql) => {
        if (sql.includes("SELECT id, client_id, storage_key FROM public.rag_documents")) {
          return { rows: [{ id: "doc-1", client_id: "geracao-digital", storage_key: "rag/geracao-digital/doc-1/arquivo.pdf" }] };
        }
        return { rows: [] };
      });

      const handler = getRouteHandler("/documents/:id", "delete");
      const req = { params: { id: "doc-1" }, authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deleteRagDocumentBufferMock).toHaveBeenCalledWith("rag/geracao-digital/doc-1/arquivo.pdf");

      const del = poolQueryMock.mock.calls.find(([sql]) => sql.includes("DELETE FROM public.rag_documents"));
      expect(del).toBeTruthy();
      expect(del[1]).toEqual(["doc-1"]);
    });

    it("storage falha ao apagar: 500, e o registro NÃO é apagado do banco (fica pra tentar de novo, não vira órfão no R2)", async () => {
      deleteRagDocumentBufferMock.mockResolvedValue(false);

      poolQueryMock.mockImplementation(async (sql) => {
        if (sql.includes("SELECT id, client_id, storage_key FROM public.rag_documents")) {
          return { rows: [{ id: "doc-1", client_id: "geracao-digital", storage_key: "rag/geracao-digital/doc-1/arquivo.pdf" }] };
        }
        return { rows: [] };
      });

      const handler = getRouteHandler("/documents/:id", "delete");
      const req = { params: { id: "doc-1" }, authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      const del = poolQueryMock.mock.calls.find(([sql]) => sql.includes("DELETE FROM public.rag_documents"));
      expect(del).toBeUndefined();
    });

    it("documento inexistente -> 404, nunca chama storage", async () => {
      poolQueryMock.mockResolvedValue({ rows: [] });

      const handler = getRouteHandler("/documents/:id", "delete");
      const req = { params: { id: "doc-fantasma" }, authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(404);
      expect(deleteRagDocumentBufferMock).not.toHaveBeenCalled();
    });

    it("documento de outro tenant -> 403, nunca apaga do storage nem do banco (tenant vem da linha)", async () => {
      poolQueryMock.mockImplementation(async (sql) => {
        if (sql.includes("SELECT id, client_id, storage_key FROM public.rag_documents")) {
          return { rows: [{ id: "doc-1", client_id: "sonhare", storage_key: "rag/sonhare/doc-1/arquivo.pdf" }] };
        }
        return { rows: [] };
      });

      const handler = getRouteHandler("/documents/:id", "delete");
      const req = { params: { id: "doc-1" }, authAccess: assignedAccess(["geracao-digital"]) };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      expect(deleteRagDocumentBufferMock).not.toHaveBeenCalled();
      const del = poolQueryMock.mock.calls.find(([sql]) => sql.includes("DELETE FROM public.rag_documents"));
      expect(del).toBeUndefined();
    });
  });

  describe("POST /search-test — busca de teste com similaridade de cada trecho (calibra RAG_MIN_SIMILARITY sem chutar)", () => {
    it("pergunta ausente -> 400, nunca busca", async () => {
      const handler = getRouteHandler("/search-test", "post");
      const req = { body: { clientId: "geracao-digital" }, authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(400);
      expect(poolQueryMock).not.toHaveBeenCalled();
    });

    it("mostra similaridade de trechos que NÃO passariam no limiar de produção — é isso que calibra sem chutar", async () => {
      process.env.RAG_EMBEDDING_PROVIDER = "lexical";
      process.env.RAG_MIN_SIMILARITY = "0.5";

      const TEXTO_COMUM = "Parcelamos em até 12x sem juros no cartão de crédito.";
      const TEXTO_IRRELEVANTE = "Nosso horário de atendimento é de segunda a sexta, das 9h às 18h.";

      const { embedTexts } = await import("../services/embeddings.js");
      const [embComum] = await embedTexts([TEXTO_COMUM], { provider: "lexical" });
      const [embIrrelevante] = await embedTexts([TEXTO_IRRELEVANTE], { provider: "lexical" });

      poolQueryMock.mockImplementation(async (sql) => {
        if (sql.includes("COUNT(*)::int AS n")) return { rows: [{ n: 2 }] };
        if (sql.includes("FROM public.rag_chunks rc")) {
          return {
            rows: [
              {
                document_id: "doc-relevante",
                content: TEXTO_COMUM,
                embedding: JSON.stringify(embComum),
                embedding_provider: "lexical",
                embedding_model: "lexical-trigram-hash-v1",
                filename: "tabela_precos.pdf",
              },
              {
                document_id: "doc-irrelevante",
                content: TEXTO_IRRELEVANTE,
                embedding: JSON.stringify(embIrrelevante),
                embedding_provider: "lexical",
                embedding_model: "lexical-trigram-hash-v1",
                filename: "horario_atendimento.pdf",
              },
            ],
          };
        }
        return { rows: [] };
      });

      const handler = getRouteHandler("/search-test", "post");
      const req = { body: { clientId: "geracao-digital", question: TEXTO_COMUM }, authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.applies).toBe(true);
      expect(res.body.threshold).toBe(0.5);
      // minSimilarity: 0 na busca -> os DOIS candidatos voltam, não só o que passaria.
      expect(res.body.chunks).toHaveLength(2);

      const relevante = res.body.chunks.find((c) => c.documentId === "doc-relevante");
      const irrelevante = res.body.chunks.find((c) => c.documentId === "doc-irrelevante");
      expect(relevante.filename).toBe("tabela_precos.pdf");
      expect(relevante.similarity).toBeCloseTo(1, 5);
      expect(relevante.passesThreshold).toBe(true);
      expect(irrelevante.passesThreshold).toBe(false);

      delete process.env.RAG_MIN_SIMILARITY;
    });

    it("tenant sem nenhum documento pronto: applies false, chunks vazio, nunca gera embedding (200, não erro)", async () => {
      process.env.RAG_EMBEDDING_PROVIDER = "lexical";
      poolQueryMock.mockImplementation(async (sql) => {
        if (sql.includes("COUNT(*)::int AS n")) return { rows: [{ n: 0 }] };
        return { rows: [] };
      });

      const handler = getRouteHandler("/search-test", "post");
      const req = { body: { clientId: "geracao-digital", question: "vocês parcelam?" }, authAccess: adminAccess() };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.applies).toBe(false);
      expect(res.body.chunks).toEqual([]);
    });

    it("tenant fora do escopo -> 403, nunca busca", async () => {
      const handler = getRouteHandler("/search-test", "post");
      const req = { body: { clientId: "sonhare", question: "oi" }, authAccess: assignedAccess(["geracao-digital"]) };
      const res = fakeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      expect(poolQueryMock).not.toHaveBeenCalled();
    });
  });

  describe("Achado de revisão: a permissão agente_rag tem que gatear TODO o router, não só a tela", () => {
    it("PROVA ESTRUTURAL: o gate está em router.use (uma linha, todo o router), não espalhado rota a rota — e é chatbot-docs, não agente", () => {
      const fonte = readFileSync(resolve("src/rag/routes.js"), "utf8");
      expect(fonte).toContain('router.use(requireFirebaseAuth, requireInternalPageAccess("chatbot-docs"))');
      // "agente" é ambíguo (agente_inbound E agente_rag apontam pra ela) — não pode ser o gate.
      expect(fonte).not.toContain('requireInternalPageAccess("agente")');
    });

    it("TESTE OBRIGATÓRIO: usuário interno SEM a permissão de RAG recebe 403 no gate — antes de upload ou reprocessar rodarem", async () => {
      const middlewares = getRouterLevelMiddlewares();
      const req = {
        authAccess: { role: "internal", isAdmin: false, scopeMode: "assigned_clients", internalPages: [], permissions: [], clientIds: [] },
      };
      const res = fakeRes();

      await runMiddlewareChain(middlewares, req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("com a permissão de RAG (\"chatbot-docs\" nas internalPages): o gate deixa passar", async () => {
      const middlewares = getRouterLevelMiddlewares();
      const req = {
        authAccess: { role: "internal", isAdmin: false, scopeMode: "assigned_clients", internalPages: ["chatbot-docs"], permissions: [], clientIds: ["geracao-digital"] },
      };
      const res = fakeRes();
      let passouDoGate = false;

      await runMiddlewareChain([...middlewares, async (_req, _res, next) => { passouDoGate = true; await next(); }], req, res);

      expect(passouDoGate).toBe(true);
      expect(res.statusCode).toBe(200); // res nunca foi tocado pelo gate
    });

    it("TESTE OBRIGATÓRIO: usuário com Agente Inbound (\"agente\" nas internalPages) mas SEM RAG recebe 403 — módulo diferente, preço diferente, não passa mais pela fresta", async () => {
      const middlewares = getRouterLevelMiddlewares();
      const req = {
        // Exatamente o que agente_inbound concede (permissionsRegistry.js): "agente" está
        // aqui, "chatbot-docs" não. Contra o código de antes desta correção, isso passava.
        authAccess: {
          role: "internal",
          isAdmin: false,
          scopeMode: "assigned_clients",
          internalPages: ["agente", "chatbot-kanban", "chatbot-config", "inbound-agents"],
          permissions: [],
          clientIds: ["geracao-digital"],
        },
      };
      const res = fakeRes();

      await runMiddlewareChain(middlewares, req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("prova de ponta a ponta: sem a permissão, nada é gravado nem enfileirado — nem no upload, nem no reprocessar (gate compartilhado, uma vez, pro router inteiro)", async () => {
      const middlewares = getRouterLevelMiddlewares();
      const req = { authAccess: { role: "internal", isAdmin: false, internalPages: [], permissions: [] } };
      const res = fakeRes();

      await runMiddlewareChain(middlewares, req, res);

      expect(res.statusCode).toBe(403);
      // O gate é o MESMO router.use pra /documents e /documents/:id/reprocess —
      // barrado aqui, nenhuma das duas rotas é alcançada em produção.
      expect(saveRagDocumentBufferMock).not.toHaveBeenCalled();
      expect(poolQueryMock).not.toHaveBeenCalled();
      expect(queueAddMock).not.toHaveBeenCalled();
    });
  });

  describe("Achado de revisão: limite da rota (25MB) > teto do negócio (20MB) — quem recusa é a mensagem nossa, não o Express", () => {
    it("PROVA ESTRUTURAL: express.raw está configurado com 25mb, não 20mb (o teste de 21MB abaixo só prova algo se a rota aceitar até 25)", () => {
      const fonte = readFileSync(resolve("src/rag/routes.js"), "utf8");
      expect(fonte).toContain('express.raw({ type: "*/*", limit: "25mb" })');
    });

    // O teste "arquivo maior que 20MB -> 400 FILE_TOO_LARGE" logo acima já
    // usa 21MB e prova que É A NOSSA VALIDAÇÃO que recusa (chega no handler,
    // devolve o código/mensagem de negócio) — combinado com a prova estrutural
    // de que a rota aceita até 25MB, fecha os dois lados: o Express deixa
    // passar (25MB de teto na rota), e quem recusa de fato é RAG_MAX_BYTES.
  });
});
