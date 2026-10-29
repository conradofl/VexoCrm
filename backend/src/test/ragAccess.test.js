import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Gate do RAG (SPEC-RAG-GATE-agente-rag, opção A). Quem decide é a função
// REAL de backend/src/rag/access.js — nada aqui dubla a regra. Só o que sai do
// processo é trocado: o banco (settings do tenant via getLeadClientN8nSettings),
// o storage e a fila.

process.env.RAG_EMBEDDING_PROVIDER = "lexical";

const settingsMock = vi.fn();
vi.mock("../services/n8nSettings.js", () => ({
  getLeadClientN8nSettings: (...args) => settingsMock(...args),
}));

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
    saveRagDocumentBuffer: (...args) => saveRagDocumentBufferMock(...args),
    deleteRagDocumentBuffer: (...args) => deleteRagDocumentBufferMock(...args),
  };
});

const queueAddMock = vi.fn(async () => ({ id: "bull-job-1" }));
vi.mock("../rag/queue.js", () => ({
  getRagQueue: () => ({ add: (...args) => queueAddMock(...args) }),
}));

// Token Firebase não dá pra verificar em teste: só esse middleware vira passthrough.
vi.mock("../access/middlewares.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requireFirebaseAuth: (req, res, next) => next(),
  };
});

const { evaluateRagAccess, tenantHasRagModule } = await import("../rag/access.js");
const { registerRagRoutes } = await import("../rag/routes.js");

const TENANT = "container-led";
const DOC_ID = "11111111-1111-1111-1111-111111111111";
const PDF_BUFFER = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(50, 0x20)]);

// Exatamente o que a tela grava para o preset gestor (frontend/src/lib/access.ts:290-308)
// e o que a medição de 29/10/2026 trouxe para o usuário do container-led. Sem chatbot-docs.
const GESTOR_DA_TELA_PAGES = [
  "dashboard", "banco-de-dados", "planilhas", "whatsapp", "agente", "usuarios", "campanhas",
  "followup", "fila-de-followup", "conexoes", "disparos", "aquecimento", "onboarding-wizard",
  "apresentacao", "eventos", "relacionamento", "livpub",
];
const OPERADOR_PAGES = ["dashboard", "banco-de-dados", "whatsapp", "conexoes", "campanhas", "disparos", "planilhas", "agente"];

function internal(internalPages, extra = {}) {
  return { role: "internal", isAdmin: false, scopeMode: "assigned_clients", clientIds: [TENANT], internalPages, permissions: [], ...extra };
}

const AVANCADO = { plan_tier: "avancado", modulos_avulsos: [] };
const ESSENCIAL = { plan_tier: "essencial", modulos_avulsos: [] };
const modular = (modulos) => ({ plan_tier: "modular", modulos_avulsos: modulos });

// Tabela única: o gate das rotas e o GET /api/rag/access têm que dar o mesmo
// veredito para cada linha (T10). `settings: Error` = falha ao ler o banco.
const CASOS = [
  { nome: "T1 gestor salvo pela tela (sem chatbot-docs), tenant avançado — o caso container-led", access: internal(GESTOR_DA_TELA_PAGES), settings: AVANCADO, allowed: true, status: 200, reason: null },
  { nome: "operador (opção A), tenant avançado", access: internal(OPERADOR_PAGES), settings: AVANCADO, allowed: true, status: 200, reason: null },
  { nome: "T2 interno com agente, tenant essencial sem módulo", access: internal(["agente"]), settings: ESSENCIAL, allowed: false, status: 403, reason: "RAG_MODULE_NOT_CONTRACTED" },
  { nome: "T3a tenant modular com agente_rag", access: internal(["agente"]), settings: modular(["agente_rag"]), allowed: true, status: 200, reason: null },
  { nome: "T3b tenant modular com o apelido rag", access: internal(["agente"]), settings: modular(["rag"]), allowed: true, status: 200, reason: null },
  { nome: "T3c tenant modular só com agente_inbound — módulo diferente, preço diferente", access: internal(["agente", "chatbot-kanban", "chatbot-config", "inbound-agents"]), settings: modular(["agente_inbound"]), allowed: false, status: 403, reason: "RAG_MODULE_NOT_CONTRACTED" },
  { nome: "tenant sem linha de settings", access: internal(["agente"]), settings: null, allowed: false, status: 403, reason: "RAG_MODULE_NOT_CONTRACTED" },
  { nome: "T4 interno sem agente nem chatbot-docs, tenant avançado", access: internal(["dashboard"]), settings: AVANCADO, allowed: false, status: 403, reason: "RAG_USER_NOT_ALLOWED" },
  { nome: "T5 role client", access: { role: "client", isAdmin: false, clientIds: [TENANT], allowedViews: ["dashboard"], internalPages: [], permissions: [] }, settings: AVANCADO, allowed: false, status: 403, reason: "RAG_ROLE_NOT_ALLOWED" },
  { nome: "T6 admin, tenant essencial (admin não é barrado, igual a hoje)", access: { role: "internal", isAdmin: true, scopeMode: "all_clients", clientIds: [] }, settings: ESSENCIAL, allowed: true, status: 200, reason: null },
  { nome: "T7a access com TENANT_SETTINGS_READ_FAILED", access: internal(["agente"], { error: "TENANT_SETTINGS_READ_FAILED" }), settings: AVANCADO, allowed: false, status: 503, reason: "RAG_SETTINGS_UNAVAILABLE" },
  { nome: "T7b leitura de settings lança — fail-closed", access: internal(["agente"]), settings: new Error("conexão recusada"), allowed: false, status: 503, reason: "RAG_SETTINGS_UNAVAILABLE" },
  { nome: "T8 compat: chatbot-docs sem agente", access: internal(["chatbot-docs"]), settings: AVANCADO, allowed: true, status: 200, reason: null },
];

function armSettings(settings) {
  if (settings instanceof Error) settingsMock.mockRejectedValue(settings);
  else settingsMock.mockResolvedValue(settings);
}

function buildRagRouter() {
  let ragRouter = null;
  registerRagRoutes({ use: (path, router) => { if (path === "/api/rag") ragRouter = router; } });
  expect(ragRouter).toBeDefined();
  return ragRouter;
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; },
  };
}

// Despacha uma requisição pela pilha REAL do router (router.use + rota), sem
// pular o gate: é isso que produção faz.
async function dispatch(method, url, req) {
  const router = buildRagRouter();
  const res = fakeRes();
  // _body: true faz o express.raw pular a leitura do stream (o corpo já vem em req.body).
  const fullReq = { method: method.toUpperCase(), url, originalUrl: `/api/rag${url}`, headers: {}, query: {}, params: {}, _body: true, ...req };
  await new Promise((resolvePromise, reject) => {
    const origJson = res.json.bind(res);
    res.json = (b) => { origJson(b); resolvePromise(); return res; };
    router.handle(fullReq, res, (err) => (err ? reject(err) : resolvePromise()));
  });
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockResolvedValue({ rows: [] });
  saveRagDocumentBufferMock.mockResolvedValue({ storageKey: "rag/t/d/1_a.pdf", sizeBytes: 100 });
  deleteRagDocumentBufferMock.mockResolvedValue(true);
});

describe("evaluateRagAccess — a regra (uma função, usada pelo gate e pela tela)", () => {
  for (const caso of CASOS) {
    it(caso.nome, async () => {
      armSettings(caso.settings);
      const result = await evaluateRagAccess(caso.access, TENANT);
      expect(result.allowed).toBe(caso.allowed);
      expect(result.status).toBe(caso.status);
      expect(result.reason).toBe(caso.reason);
    });
  }

  it("tenantHasRagModule: all/* liberam; prefixo mod_ e caixa alta são normalizados", () => {
    expect(tenantHasRagModule(modular(["all"]))).toBe(true);
    expect(tenantHasRagModule(modular(["*"]))).toBe(true);
    expect(tenantHasRagModule(modular(["MOD_AGENTE_RAG"]))).toBe(true);
    expect(tenantHasRagModule({ plan_tier: "advanced", modulos_avulsos: [] })).toBe(true);
    expect(tenantHasRagModule(modular(["followup", "agente_inbound"]))).toBe(false);
    expect(tenantHasRagModule(null)).toBe(false);
  });

  it("admin não consulta o banco (não pode depender de settings para o admin subir)", async () => {
    armSettings(new Error("não deveria ser chamado"));
    const result = await evaluateRagAccess({ role: "internal", isAdmin: true }, TENANT);
    expect(result.allowed).toBe(true);
    expect(settingsMock).not.toHaveBeenCalled();
  });
});

describe("Rotas RAG — o gate roda em produção do mesmo jeito que a regra", () => {
  it("PROVA ESTRUTURAL: o router usa requireRagUser e não usa mais a página chatbot-docs", () => {
    const fonte = readFileSync(resolve("src/rag/routes.js"), "utf8");
    expect(fonte).toContain("router.use(requireFirebaseAuth, requireRagUser)");
    expect(fonte).not.toContain('requireInternalPageAccess("chatbot-docs")');
  });

  it("T1 ponta a ponta: gestor da tela no tenant avançado sobe o arquivo (201) — era 403", async () => {
    armSettings(AVANCADO);
    const res = await dispatch("post", "/documents", {
      query: { clientId: TENANT },
      headers: { "x-file-name": "catalogo.pdf", "content-type": "application/octet-stream" },
      body: PDF_BUFFER,
      authAccess: internal(GESTOR_DA_TELA_PAGES),
    });
    expect(res.statusCode).toBe(201);
    expect(saveRagDocumentBufferMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock).toHaveBeenCalledTimes(1);
  });

  // T9: o passo do tenant tem que estar nas CINCO rotas. Uma rota sem ele é uma fresta.
  const ROTAS = [
    { nome: "upload", method: "post", url: "/documents", req: { query: { clientId: TENANT }, headers: { "x-file-name": "a.pdf" }, body: PDF_BUFFER } },
    { nome: "lista", method: "get", url: "/documents", req: { query: { clientId: TENANT } } },
    { nome: "apagar", method: "delete", url: `/documents/${DOC_ID}`, req: {}, docRow: true },
    { nome: "reprocessar", method: "post", url: `/documents/${DOC_ID}/reprocess`, req: {}, docRow: true },
    { nome: "busca de teste", method: "post", url: "/search-test", req: { body: { clientId: TENANT, question: "qual o prazo?" } } },
  ];

  for (const rota of ROTAS) {
    it(`T9 ${rota.nome}: tenant sem o módulo -> 403 RAG_MODULE_NOT_CONTRACTED, nada gravado, apagado ou enfileirado`, async () => {
      armSettings(modular(["agente_inbound"]));
      if (rota.docRow) {
        poolQueryMock.mockResolvedValue({ rows: [{ id: DOC_ID, client_id: TENANT, storage_key: "rag/x" }] });
      }
      const res = await dispatch(rota.method, rota.url, { ...rota.req, authAccess: internal(["agente"]) });
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe("RAG_MODULE_NOT_CONTRACTED");
      expect(saveRagDocumentBufferMock).not.toHaveBeenCalled();
      expect(deleteRagDocumentBufferMock).not.toHaveBeenCalled();
      expect(queueAddMock).not.toHaveBeenCalled();
      const escritas = poolQueryMock.mock.calls.filter(([sql]) => /INSERT|UPDATE|DELETE/i.test(sql));
      expect(escritas).toEqual([]);
    });
  }

  it("T4 no gate do router: usuário sem agente nem chatbot-docs leva 403 antes de qualquer rota", async () => {
    armSettings(AVANCADO);
    const res = await dispatch("post", "/documents", {
      query: { clientId: TENANT }, headers: { "x-file-name": "a.pdf" }, body: PDF_BUFFER, authAccess: internal(["dashboard"]),
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe("RAG_USER_NOT_ALLOWED");
    expect(settingsMock).not.toHaveBeenCalled();
    expect(saveRagDocumentBufferMock).not.toHaveBeenCalled();
  });

  // T10: paridade. A tela pergunta a GET /api/rag/access; o upload responde pelo gate.
  // Os dois têm que concordar em todas as linhas da tabela.
  for (const caso of CASOS) {
    it(`T10 paridade GET /access × upload — ${caso.nome}`, async () => {
      armSettings(caso.settings);
      const acesso = await dispatch("get", "/access", { query: { clientId: TENANT }, authAccess: caso.access });
      expect(acesso.statusCode).toBe(200);
      expect(acesso.body.allowed).toBe(caso.allowed);
      expect(acesso.body.reason).toBe(caso.reason);

      vi.clearAllMocks();
      armSettings(caso.settings);
      saveRagDocumentBufferMock.mockResolvedValue({ storageKey: "rag/t/d/1_a.pdf", sizeBytes: 100 });
      const upload = await dispatch("post", "/documents", {
        query: { clientId: TENANT }, headers: { "x-file-name": "a.pdf" }, body: PDF_BUFFER, authAccess: caso.access,
      });
      expect(upload.statusCode).toBe(caso.allowed ? 201 : caso.status);
      if (!caso.allowed) expect(upload.body.error.code).toBe(caso.reason);
    });
  }
});
