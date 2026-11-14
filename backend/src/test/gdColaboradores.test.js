import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { registerGdColaboradoresRoutes } from "../domains/gdClientes/colaboradoresRoutes.js";

const MIGRATION_COLABORADORES = readFileSync(
  resolve("supabase/migrations/20261114180000_create_gd_colaboradores.sql"),
  "utf8"
);

const TOKEN_TESTE = "goclaw-token-teste-colaboradores";

let db;
let server;
let base;

function poolDe(pg) {
  const query = async (sql, params) => pg.query(sql, params);
  const client = { query, release() {} };
  return { query, connect: async () => client };
}

beforeAll(async () => {
  process.env.GOCLAW_READ_TOKEN = TOKEN_TESTE;
  db = await createPgliteDb();
  await db.exec(MIGRATION_COLABORADORES);

  const app = express();
  app.use(express.json());

  // Middleware simulado de autenticação (aceita Bearer GOCLAW_READ_TOKEN ou x-teste-user)
  const mockAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${TOKEN_TESTE}`) {
      req.authActor = { tipo: "goclaw", id: "goclaw" };
      return next();
    }
    if (req.headers["x-teste-user"]) {
      req.authActor = { tipo: "humano", id: req.headers["x-teste-user"] };
      return next();
    }
    return res.status(401).json({ error: "Não autorizado." });
  };

  registerGdColaboradoresRoutes(app, poolDe(db), mockAuth);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  delete process.env.GOCLAW_READ_TOKEN;
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) await db.close();
});

describe("Rotas de Colaboradores GD (gd_colaboradores)", () => {
  it("lista os 8 colaboradores semeados na migration", async () => {
    const res = await fetch(`${base}/api/gd/colaboradores`, {
      headers: { Authorization: `Bearer ${TOKEN_TESTE}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.length).toBe(8);

    const nomes = json.data.map((c) => c.nome);
    expect(nomes).toContain("Caio Almeida");
    expect(nomes).toContain("Conrado Finzi");
    expect(nomes).toContain("Gabriel");
    expect(nomes).toContain("Maria Eduarda (Duda)");
    expect(nomes).toContain("Santana");
    expect(nomes).toContain("Éflen");
    expect(nomes).toContain("Humberto");
    expect(nomes).toContain("Carlos");
  });

  it("filtra colaboradores ativos", async () => {
    const res = await fetch(`${base}/api/gd/colaboradores?ativo=true`, {
      headers: { "x-teste-user": "admin" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.every((c) => c.ativo === true)).toBe(true);
  });

  it("recusa criar colaborador sem nome, função ou telefone válido", async () => {
    const semNome = await fetch(`${base}/api/gd/colaboradores`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_TESTE}` },
      body: JSON.stringify({ funcao: "Designer", telefone: "34999998888" }),
    });
    expect(semNome.status).toBe(422);

    const telInvalido = await fetch(`${base}/api/gd/colaboradores`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_TESTE}` },
      body: JSON.stringify({ nome: "Teste", funcao: "Designer", telefone: "123" }),
    });
    expect(telInvalido.status).toBe(422);
  });

  it("cria um novo colaborador com telefone normalizado em DDI 55", async () => {
    const res = await fetch(`${base}/api/gd/colaboradores`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_TESTE}` },
      body: JSON.stringify({
        nome: "Novo Colaborador",
        funcao: "Copywriter",
        telefone: "34 98888-7777",
        trello_username: "novocopy",
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.item.telefone).toBe("5534988887777");
    expect(json.item.trello_username).toBe("novocopy");
    expect(json.item.recebe_cobranca_whatsapp).toBe(true);
  });

  it("recusa duplicar telefone com 409 Conflict", async () => {
    const res = await fetch(`${base}/api/gd/colaboradores`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_TESTE}` },
      body: JSON.stringify({
        nome: "Duplicado",
        funcao: "Outro",
        telefone: "5534997719779", // telefone do Caio
      }),
    });
    expect(res.status).toBe(409);
  });

  it("atualiza campos de um colaborador via PATCH", async () => {
    // Busca o Santana
    const listRes = await fetch(`${base}/api/gd/colaboradores`, {
      headers: { Authorization: `Bearer ${TOKEN_TESTE}` },
    });
    const listJson = await listRes.json();
    const santana = listJson.data.find((c) => c.nome === "Santana");
    expect(santana).toBeDefined();

    const patchRes = await fetch(`${base}/api/gd/colaboradores/${santana.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_TESTE}` },
      body: JSON.stringify({
        funcao: "Diretor Criativo & Brand Designer",
        observacoes: "Responsável pelas identidades visuais de alta fidelidade",
      }),
    });

    expect(patchRes.status).toBe(200);
    const patchJson = await patchRes.json();
    expect(patchJson.ok).toBe(true);
    expect(patchJson.item.funcao).toBe("Diretor Criativo & Brand Designer");
    expect(patchJson.item.observacoes).toContain("identidades visuais");
  });

  it("exclui colaborador existente e retorna 404 para ID inexistente", async () => {
    const createRes = await fetch(`${base}/api/gd/colaboradores`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_TESTE}` },
      body: JSON.stringify({
        nome: "Temporario",
        funcao: "Estagiário",
        telefone: "34911112222",
      }),
    });
    const { item } = await createRes.json();

    const delRes = await fetch(`${base}/api/gd/colaboradores/${item.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN_TESTE}` },
    });
    expect(delRes.status).toBe(200);

    const getRes = await fetch(`${base}/api/gd/colaboradores/${item.id}`, {
      headers: { Authorization: `Bearer ${TOKEN_TESTE}` },
    });
    expect(getRes.status).toBe(404);
  });
});
