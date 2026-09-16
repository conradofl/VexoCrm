import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const poolQueryMock = vi.fn(async () => ({ rows: [] }));
vi.mock("../services/database.js", () => ({
  get pgDatabasePool() {
    return { query: poolQueryMock };
  },
}));

const saveRagDocumentBufferMock = vi.fn();
vi.mock("../services/storage.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // detectRagDocumentType e RAG_MAX_BYTES ficam REAIS — quero testar a
    // rejeição de verdade por assinatura de bytes através da rota.
    saveRagDocumentBuffer: (...args) => saveRagDocumentBufferMock(...args),
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
