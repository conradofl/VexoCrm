// backend/src/test/leadMassDeleteRoutes.test.js
//
// As rotas HTTP da exclusão em massa (prévia, exportação, execução, tags), registradas pelo
// registerLeadsRoutes de verdade, sobre um repositório em memória. Mais: excluir o REGISTRO da
// importação e excluir os LEADS são ações distintas, e nenhuma dispara a outra.

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { registerLeadMassDeleteRoutes } from "../domains/leads/massDeleteRoutes.js";
import { sendError } from "../services/httpInfra.js";
import { createMemoryMassDeleteRepo, makeLeads } from "./helpers/memoryMassDeleteRepo.js";

const TAG = "Lista Out/26";
const GESTOR = { isAdmin: true, role: "internal", uid: "uid-gestor", email: "gestor@vexo.com", clientId: "A", clientIds: ["A"] };
const COMUM = { isAdmin: false, role: "internal", uid: "uid-vendedor", email: "vendedor@vexo.com", clientId: "A", clientIds: ["A"] };

let repo;
let server;
let baseUrl;
let supabaseCalls;
let pgQueries;

function seed() {
  const limpos = makeLeads("A", 10);
  const multi = makeLeads("A", 3, { prefix: "m", offset: 1000, fields: { tags: [TAG, "Outra Lista Nov/26"] } });
  const comMsg = makeLeads("A", 2, { prefix: "g", offset: 2000 });
  return createMemoryMassDeleteRepo({
    leads: [...limpos, ...multi, ...comMsg, ...makeLeads("B", 6, { offset: 9000 })],
    messages: comMsg.map((l) => ({ client_id: "A", lead_id: l.id, phone: null })),
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());

  const supabase = {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { id: "imp-1", client_id: "A" }, error: null }),
        delete: () => {
          supabaseCalls.push({ table, op: "delete" });
          return { eq: async () => ({ error: null }) };
        },
      };
      supabaseCalls.push({ table, op: "from" });
      return chain;
    },
  };

  registerLeadsRoutes(app, {
    ensureDb: () => true,
    // "pool" estável que repassa para o store do repositório atual (recriado a cada teste)
    pgDatabasePool: new Proxy({}, {
      get: (_t, prop) => (prop === "query" ? async (sql) => { pgQueries.push(String(sql)); return { rows: [], rowCount: 0 }; } : repo.store[prop]),
      set: (_t, prop, value) => { repo.store[prop] = value; return true; },
    }),
    massDeleteRepo: new Proxy({}, { get: (_t, prop) => (...args) => repo[prop](...args) }),
    requireFirebaseAuth: (req, _res, next) => {
      req.authAccess = req.headers["x-perfil"] === "comum" ? COMUM : GESTOR;
      next();
    },
    requireInternalPageAccess: () => (_req, _res, next) => next(),
    requireAppViewAccess: () => (_req, _res, next) => next(),
    // barreira de tenant: o cliente pedido tem que estar na sessão
    resolveAuthorizedClientId: (req, res, requested) => {
      const wanted = requested || req.authAccess.clientId;
      if (!req.authAccess.clientIds.includes(wanted)) {
        sendError(res, 403, "FORBIDDEN_CLIENT", "Cliente fora do escopo da sessão.");
        return null;
      }
      return wanted;
    },
    sanitizePhone: (p) => p,
    sendError, // o real: corpo { error: { code, message, details } }
    normalizeString: (s) => (s === null || s === undefined ? "" : String(s).trim()),
    supabase,
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  repo = seed();
  supabaseCalls = [];
  pgQueries = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const post = (path, body, headers = {}) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const base = { clientId: "A", criterion: { type: "tag", value: TAG } };

describe("POST /api/leads/mass-delete/preview", () => {
  it("[TESTE OBRIGATÓRIO] devolve os números nomeados, só leitura", async () => {
    const res = await post("/api/leads/mass-delete/preview", base);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview).toMatchObject({ matched: 15, multiImport: 3, withMessages: 2, willDelete: 10, kept: 5 });
    expect(body.preview.keptReasons).toEqual({ multiImport: 3, withMessages: 2, both: 0 });
    expect(body.options).toEqual({ includeMultiImport: false, includeWithMessages: false });
    expect(repo.store.leads).toHaveLength(21); // nada apagado
    expect(repo.calls.some((c) => ["deleteLeads", "begin", "insertAudit"].includes(c.op))).toBe(false);
  });

  it("critério ausente ou inválido: 400", async () => {
    expect((await post("/api/leads/mass-delete/preview", { clientId: "A" })).status).toBe(400);
    expect((await post("/api/leads/mass-delete/preview", { clientId: "A", criterion: { type: "tag", value: "" } })).status).toBe(400);
  });

  it("[TESTE OBRIGATÓRIO] cliente fora do escopo da sessão: 403 e o repositório nem é consultado", async () => {
    const res = await post("/api/leads/mass-delete/preview", { ...base, clientId: "B" });

    expect(res.status).toBe(403);
    expect(repo.calls).toHaveLength(0);
  });
});

describe("POST /api/leads/mass-delete/execute", () => {
  it("[TESTE OBRIGATÓRIO] a prévia e a execução dão o mesmo número, ponta a ponta pelo HTTP", async () => {
    const prev = await (await post("/api/leads/mass-delete/preview", base)).json();

    const res = await post("/api/leads/mass-delete/execute", { ...base, expectedCount: prev.preview.willDelete });

    expect(res.status).toBe(200);
    const { report } = await res.json();
    expect(report.deleted).toBe(prev.preview.willDelete);
    expect(report.deleted + report.kept).toBe(prev.preview.matched);
    expect(repo.store.leads.filter((l) => l.client_id === "A")).toHaveLength(5);
  });

  it("[TESTE OBRIGATÓRIO] número divergente do da prévia: 409, nada apagado, e diz o número real", async () => {
    const res = await post("/api/leads/mass-delete/execute", { ...base, expectedCount: 7 });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("MASS_DELETE_COUNT_MISMATCH");
    expect(body.error.details).toMatchObject({ expected: 7, actual: 10 });
    expect(body.error.message).toContain("Nada foi apagado");
    expect(repo.store.leads).toHaveLength(21);
  });

  it("[TESTE OBRIGATÓRIO] sem o expectedCount: 400 (a execução nunca roda 'às cegas')", async () => {
    const res = await post("/api/leads/mass-delete/execute", base);

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("MASS_DELETE_INVALID_EXPECTED_COUNT");
    expect(repo.store.leads).toHaveLength(21);
  });

  it("[TESTE OBRIGATÓRIO] acima de 500 leads exige o número digitado, também pela API", async () => {
    repo = createMemoryMassDeleteRepo({ leads: makeLeads("A", 501) });

    const sem = await post("/api/leads/mass-delete/execute", { ...base, expectedCount: 501 });
    expect(sem.status).toBe(400);
    expect((await sem.json()).error.code).toBe("MASS_DELETE_CONFIRMATION_REQUIRED");
    expect(repo.store.leads).toHaveLength(501);

    const com = await post("/api/leads/mass-delete/execute", { ...base, expectedCount: 501, confirmation: "501" });
    expect(com.status).toBe(200);
    expect(repo.store.leads).toHaveLength(0);
  });

  it("[TESTE OBRIGATÓRIO] quem não é gestor/admin recebe 403 e nada é apagado (a prévia continua aberta)", async () => {
    const exec = await post("/api/leads/mass-delete/execute", { ...base, expectedCount: 10 }, { "x-perfil": "comum" });
    expect(exec.status).toBe(403);
    expect(repo.store.leads).toHaveLength(21);

    const prev = await post("/api/leads/mass-delete/preview", base, { "x-perfil": "comum" });
    expect(prev.status).toBe(200);
  });

  it("[TESTE OBRIGATÓRIO] o registro de auditoria leva o usuário da SESSÃO (não do corpo), o critério e a quantidade", async () => {
    await post("/api/leads/mass-delete/execute", { ...base, expectedCount: 10, userEmail: "falso@x.com", userUid: "falso" });

    expect(repo.store.audit).toHaveLength(1);
    expect(repo.store.audit[0]).toMatchObject({
      clientId: "A",
      userUid: "uid-gestor",
      userEmail: "gestor@vexo.com",
      criterion: { type: "tag", value: TAG },
      deleted: 10,
      kept: 5,
    });
  });

  it("[TESTE OBRIGATÓRIO] as opções chegam do corpo e continuam desligadas se não vierem: multi-importação e mensagens", async () => {
    const padrao = await (await post("/api/leads/mass-delete/preview", base)).json();
    const ligado = await (
      await post("/api/leads/mass-delete/preview", { ...base, options: { includeMultiImport: true, includeWithMessages: true } })
    ).json();

    expect(padrao.preview.willDelete).toBe(10);
    expect(ligado.preview.willDelete).toBe(15);
  });

  it("[TESTE OBRIGATÓRIO] tenancy pelo HTTP: critério do cliente A, mesmo com tudo ligado, nunca toca no B", async () => {
    await post("/api/leads/mass-delete/execute", { ...base, options: { includeMultiImport: true, includeWithMessages: true }, expectedCount: 15 });

    expect(repo.store.leads.filter((l) => l.client_id === "B")).toHaveLength(6);
    expect(repo.store.leads.filter((l) => l.client_id === "A")).toHaveLength(0);
    expect(new Set(repo.calls.filter((c) => c.clientId).map((c) => c.clientId))).toEqual(new Set(["A"]));
  });
});

describe("POST /api/leads/mass-delete/export", () => {
  it("[TESTE OBRIGATÓRIO] a exportação traz exatamente os leads que seriam apagados", async () => {
    const res = await post("/api/leads/mass-delete/export", base);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("x-exported-count")).toBe("10");
    const csv = await res.text();
    expect(csv.trim().split("\n")).toHaveLength(11);
    for (const l of repo.store.leads.filter((x) => x.client_id === "A" && x.id.startsWith("A-l"))) expect(csv).toContain(`"${l.id}"`);
    expect(csv).not.toContain('"A-m0"'); // multi-importação
    expect(csv).not.toContain('"A-g0"'); // com mensagem
    expect(csv).not.toContain("B-l"); // outro cliente
    expect(repo.store.leads).toHaveLength(21); // exportar não apaga
  });
});

describe("GET /api/leads/mass-delete/tags", () => {
  it("lista as tags do cliente com a contagem de leads (e só as dele)", async () => {
    const res = await fetch(`${baseUrl}/api/leads/mass-delete/tags?clientId=A`);

    const { tags } = await res.json();
    expect(tags.find((t) => t.tag === TAG).leads).toBe(15);
    expect(repo.calls.find((c) => c.op === "listTags").clientId).toBe("A");
  });
});

describe("Remover o REGISTRO da importação e excluir os LEADS são ações distintas", () => {
  it("[TESTE OBRIGATÓRIO] DELETE /api/lead-imports/:id mexe só em lead_imports e lead_import_items — nunca nos leads", async () => {
    const res = await fetch(`${baseUrl}/api/lead-imports/imp-1`, { method: "DELETE" });

    expect(res.status).toBe(200);
    const tabelas = new Set(supabaseCalls.map((c) => c.table));
    expect(tabelas).toEqual(new Set(["lead_imports", "lead_import_items"]));
    expect(supabaseCalls.filter((c) => c.op === "delete").map((c) => c.table).sort()).toEqual(["lead_import_items", "lead_imports"]);
    expect(pgQueries.some((q) => /DELETE\s+FROM\s+public\.leads/i.test(q))).toBe(false);
    expect(repo.store.leads).toHaveLength(21); // os leads continuam
    expect(repo.calls).toHaveLength(0); // e a exclusão em massa nem foi chamada
  });

  it("[TESTE OBRIGATÓRIO] a exclusão em massa mexe só nos leads (e na auditoria) — nunca no registro da importação", async () => {
    await post("/api/leads/mass-delete/execute", { ...base, expectedCount: 10 });

    expect(supabaseCalls).toHaveLength(0); // nenhuma chamada a lead_imports / lead_import_items
    expect(pgQueries).toHaveLength(0);
    expect(repo.store.leads.filter((l) => l.client_id === "A")).toHaveLength(5);
  });
});

describe("As rotas vestem os guards", () => {
  it("todas passam por requireFirebaseAuth e requireBancoDeDados, nessa ordem", () => {
    const registered = {};
    const app = {
      get: (path, ...chain) => (registered[`GET ${path}`] = chain),
      post: (path, ...chain) => (registered[`POST ${path}`] = chain),
    };
    const requireFirebaseAuth = () => {};
    const requireBancoDeDados = () => {};

    registerLeadMassDeleteRoutes(app, {
      ensureDb: () => true,
      normalizeString: (s) => s,
      pgDatabasePool: {},
      requireBancoDeDados,
      requireFirebaseAuth,
      resolveAuthorizedClientId: () => "A",
      sendError: () => {},
      massDeleteRepo: createMemoryMassDeleteRepo(),
    });

    const paths = ["GET /api/leads/mass-delete/tags", "POST /api/leads/mass-delete/preview", "POST /api/leads/mass-delete/export", "POST /api/leads/mass-delete/execute"];
    for (const p of paths) {
      expect(registered[p], p).toBeDefined();
      expect(registered[p][0], p).toBe(requireFirebaseAuth);
      expect(registered[p][1], p).toBe(requireBancoDeDados);
    }
  });
});
