// backend/src/test/leadOriginFixRoutes.test.js
//
// As rotas HTTP da correção de origem (prévia e execução), registradas pelo registerLeadsRoutes de
// verdade, sobre um repositório em memória.

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { registerLeadOriginFixRoutes } from "../domains/leads/originFixRoutes.js";
import { sendError } from "../services/httpInfra.js";
import { createMemoryOriginFixRepo, fromInstagramImporter, onlyImportTag, undeterminable, withImportId } from "./helpers/memoryOriginFixRepo.js";

const GESTOR = { isAdmin: true, role: "internal", uid: "uid-gestor", email: "gestor@vexo.com", clientId: "A", clientIds: ["A"] };
const COMUM = { isAdmin: false, role: "internal", uid: "uid-vendedor", email: "vendedor@vexo.com", clientId: "A", clientIds: ["A"] };

let repo;
let server;
let baseUrl;

const seed = () =>
  createMemoryOriginFixRepo({
    leads: [
      ...[1, 2].map((i) => withImportId("A", `A-id${i}`)),
      ...[1, 2, 3].map((i) => onlyImportTag("A", `A-tag${i}`)),
      undeterminable("A", "A-und1"),
      ...[1, 2].map((i) => fromInstagramImporter("A", `A-ig${i}`)),
      ...[1, 2].map((i) => withImportId("B", `B-id${i}`)),
    ],
  });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerLeadsRoutes(app, {
    ensureDb: () => true,
    pgDatabasePool: new Proxy({}, { get: (_t, p) => repo.store[p], set: (_t, p, v) => ((repo.store[p] = v), true) }),
    originFixRepo: new Proxy({}, { get: (_t, prop) => (...args) => repo[prop](...args) }),
    requireFirebaseAuth: (req, _res, next) => {
      req.authAccess = req.headers["x-perfil"] === "comum" ? COMUM : GESTOR;
      next();
    },
    requireInternalPageAccess: () => (_req, _res, next) => next(),
    requireAppViewAccess: () => (_req, _res, next) => next(),
    resolveAuthorizedClientId: (req, res, requested) => {
      const wanted = requested || req.authAccess.clientId;
      if (!req.authAccess.clientIds.includes(wanted)) {
        sendError(res, 403, "FORBIDDEN_CLIENT", "Cliente fora do escopo da sessão.");
        return null;
      }
      return wanted;
    },
    sanitizePhone: (p) => p,
    sendError,
    normalizeString: (s) => (s === null || s === undefined ? "" : String(s).trim()),
    supabase: { from: () => ({}) },
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
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const post = (path, body, headers = {}) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("POST /api/leads/origin-fix/preview", () => {
  it("[TESTE OBRIGATÓRIO] devolve os três grupos e o total, só leitura", async () => {
    const res = await post("/api/leads/origin-fix/preview", { clientId: "A" });

    expect(res.status).toBe(200);
    const { preview } = await res.json();
    expect(preview).toMatchObject({ withImportId: 2, onlyImportTag: 3, undeterminable: 1, total: 6, correctable: 5, instagramImporterUntouched: 2 });
    expect(repo.calls.some((c) => ["fixLeads", "begin", "insertAudit"].includes(c.op))).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] cliente fora do escopo da sessão: 403 e o repositório nem é consultado", async () => {
    const res = await post("/api/leads/origin-fix/preview", { clientId: "B" });

    expect(res.status).toBe(403);
    expect(repo.calls).toHaveLength(0);
  });
});

describe("POST /api/leads/origin-fix/execute", () => {
  it("[TESTE OBRIGATÓRIO] prévia e execução com o mesmo número: corrige e relata os grupos", async () => {
    const { preview } = await (await post("/api/leads/origin-fix/preview", { clientId: "A" })).json();

    const res = await post("/api/leads/origin-fix/execute", { clientId: "A", expectedCount: preview.correctable });

    expect(res.status).toBe(200);
    const { report } = await res.json();
    expect(report).toMatchObject({ corrected: 5, correctedWithImportId: 2, correctedOnlyImportTag: 3, leftUndeterminable: 1, leftInstagramImporter: 2 });
  });

  it("[TESTE OBRIGATÓRIO] número divergente: 409, nada alterado, com os dois números", async () => {
    const antes = JSON.stringify(repo.store.leads);
    const res = await post("/api/leads/origin-fix/execute", { clientId: "A", expectedCount: 3 });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("ORIGIN_FIX_COUNT_MISMATCH");
    expect(body.error.details).toMatchObject({ expected: 3, actual: 5 });
    expect(JSON.stringify(repo.store.leads)).toBe(antes);
  });

  it("sem expectedCount: 400", async () => {
    const res = await post("/api/leads/origin-fix/execute", { clientId: "A" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("ORIGIN_FIX_INVALID_EXPECTED_COUNT");
  });

  it("[TESTE OBRIGATÓRIO] quem não é gestor/admin recebe 403 na execução (a prévia continua aberta)", async () => {
    const exec = await post("/api/leads/origin-fix/execute", { clientId: "A", expectedCount: 5 }, { "x-perfil": "comum" });
    expect(exec.status).toBe(403);
    expect(repo.store.leads.filter((l) => l.dados.origem === "Instagram Direct")).toHaveLength(10);

    const prev = await post("/api/leads/origin-fix/preview", { clientId: "A" }, { "x-perfil": "comum" });
    expect(prev.status).toBe(200);
  });

  it("[TESTE OBRIGATÓRIO] a auditoria leva o usuário da SESSÃO, nunca o do corpo", async () => {
    await post("/api/leads/origin-fix/execute", { clientId: "A", expectedCount: 5, userEmail: "falso@x.com", userUid: "falso" });

    expect(repo.store.audit).toHaveLength(1);
    expect(repo.store.audit[0]).toMatchObject({ clientId: "A", userUid: "uid-gestor", userEmail: "gestor@vexo.com", corrected: 5 });
  });

  it("[TESTE OBRIGATÓRIO] tenancy pelo HTTP: corrigir A não toca B", async () => {
    await post("/api/leads/origin-fix/execute", { clientId: "A", expectedCount: 5 });

    expect(repo.store.leads.filter((l) => l.client_id === "B").every((l) => l.dados.origem === "Instagram Direct")).toBe(true);
    expect(new Set(repo.calls.filter((c) => c.clientId).map((c) => c.clientId))).toEqual(new Set(["A"]));
  });
});

describe("As rotas vestem os guards", () => {
  it("passam por requireFirebaseAuth e requireBancoDeDados, nessa ordem", () => {
    const registered = {};
    const app = { post: (path, ...chain) => (registered[`POST ${path}`] = chain) };
    const requireFirebaseAuth = () => {};
    const requireBancoDeDados = () => {};

    registerLeadOriginFixRoutes(app, {
      ensureDb: () => true,
      normalizeString: (s) => s,
      pgDatabasePool: {},
      requireBancoDeDados,
      requireFirebaseAuth,
      resolveAuthorizedClientId: () => "A",
      sendError: () => {},
      originFixRepo: createMemoryOriginFixRepo(),
    });

    for (const p of ["POST /api/leads/origin-fix/preview", "POST /api/leads/origin-fix/execute"]) {
      expect(registered[p][0], p).toBe(requireFirebaseAuth);
      expect(registered[p][1], p).toBe(requireBancoDeDados);
    }
  });
});
