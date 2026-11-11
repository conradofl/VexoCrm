// backend/src/test/agentPermanentDeleteRoute.test.js
//
// DELETE /api/followup/companies/:id/permanent — exclusão definitiva de agente.
// Roda o handler de verdade contra Postgres real em memória (pglite), com as
// chaves estrangeiras de produção no esquema: quatro ON DELETE CASCADE
// (campanhas, sugestões, jornadas, documentos) e duas sem cascade
// (agendamentos, respostas). Nada de banco simulado: o que está em prova é
// justamente o que o banco faz com a linha e com as dependentes.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPoolForTesting } from "../followup/db.js";

const { registerFollowupRoutes } = await import("../followup/routes.js");

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const AGENTE_VAZIO = "11111111-1111-4111-8111-111111111111";
const AGENTE_ARQUIVADO = "22222222-2222-4222-8222-222222222222";
const AGENTE_COM_CAMPANHA = "33333333-3333-4333-8333-333333333333";
const AGENTE_COM_RESPOSTA = "44444444-4444-4444-8444-444444444444";
const AGENTE_OUTRO_TENANT = "55555555-5555-4555-8555-555555555555";

// Mesmos tipos e mesmas regras de ON DELETE das migrations
// (20260526000001, 20260527000001, 20260623151500, 20260916100000).
const SCHEMA = `
  CREATE TABLE followup_companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text,
    name text NOT NULL,
    evolution_instance text NOT NULL DEFAULT '',
    archived_at timestamptz
  );
  CREATE TABLE followup_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES followup_companies(id) ON DELETE CASCADE,
    name text NOT NULL
  );
  CREATE TABLE followup_suggestions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES followup_companies(id) ON DELETE CASCADE
  );
  CREATE TABLE fup_journeys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.followup_companies(id) ON DELETE CASCADE
  );
  CREATE TABLE rag_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NULL REFERENCES public.followup_companies(id) ON DELETE CASCADE
  );
  CREATE TABLE followup_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES followup_campaigns(id),
    company_id uuid NOT NULL REFERENCES followup_companies(id),
    lead_name text NOT NULL
  );
  CREATE TABLE followup_replies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES followup_companies(id),
    phone text
  );
`;

function getRouteHandler(routePath, method) {
  let followupRouter = null;
  const fakeApp = {
    use: (path, router) => {
      if (path === "/api/followup") followupRouter = router;
    },
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  const noop = (req, res, next) => next?.();
  registerFollowupRoutes(fakeApp, noop, () => noop, noop);
  const layer = followupRouter.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  expect(layer, `rota ${method.toUpperCase()} ${routePath} não encontrada`).toBeDefined();
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; },
  };
}

function acessoDoTenant(clientIds) {
  return { role: "internal", isAdmin: false, scopeMode: "assigned_clients", clientIds };
}

describe("DELETE /companies/:id/permanent — exclusão definitiva de agente", () => {
  let db;

  async function contar(tabela, where = "true", params = []) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${tabela} WHERE ${where}`, params);
    return rows[0].n;
  }

  async function excluir(id, clientIds = [TENANT_A]) {
    const handler = getRouteHandler("/companies/:id/permanent", "delete");
    const res = fakeRes();
    await handler({ params: { id }, authAccess: acessoDoTenant(clientIds) }, res);
    return res;
  }

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    db = await createPgliteDb(SCHEMA);
    await db.query(
      `INSERT INTO followup_companies (id, tenant_id, name, archived_at) VALUES
        ($1, $6, 'Agente vazio', NULL),
        ($2, $6, 'Agente arquivado', now()),
        ($3, $6, 'Agente com campanha', NULL),
        ($4, $6, 'Agente com resposta', now()),
        ($5, $7, 'Agente do vizinho', now())`,
      [AGENTE_VAZIO, AGENTE_ARQUIVADO, AGENTE_COM_CAMPANHA, AGENTE_COM_RESPOSTA, AGENTE_OUTRO_TENANT, TENANT_A, TENANT_B]
    );
    await db.query(
      `INSERT INTO followup_campaigns (company_id, name) VALUES ($1, 'Cadência 1'), ($1, 'Cadência 2')`,
      [AGENTE_COM_CAMPANHA]
    );
    await db.query(`INSERT INTO fup_journeys (company_id) VALUES ($1)`, [AGENTE_COM_CAMPANHA]);
    await db.query(`INSERT INTO followup_replies (company_id, phone) VALUES ($1, '5511999990000')`, [AGENTE_COM_RESPOSTA]);

    const client = { query: (sql, params) => db.query(sql, params), release: () => {} };
    _setPoolForTesting({ query: client.query, connect: async () => client });
  });

  afterEach(async () => {
    _setPoolForTesting(null);
    await db.close();
    vi.restoreAllMocks();
  });

  it("agente sem dependente é apagado de verdade, e só ele", async () => {
    const res = await excluir(AGENTE_VAZIO);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, deleted: { id: AGENTE_VAZIO, name: "Agente vazio" } });
    expect(await contar("followup_companies", "id = $1", [AGENTE_VAZIO])).toBe(0);
    expect(await contar("followup_companies")).toBe(4);
  });

  it("agente arquivado sem dependente também é apagado (o caso que motivou a rota)", async () => {
    const res = await excluir(AGENTE_ARQUIVADO);

    expect(res.statusCode).toBe(200);
    expect(await contar("followup_companies", "id = $1", [AGENTE_ARQUIVADO])).toBe(0);
  });

  it("dependente em tabela ON DELETE CASCADE: recusa com 409, devolve a contagem e NADA é apagado", async () => {
    const res = await excluir(AGENTE_COM_CAMPANHA);

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe("AGENT_HAS_DEPENDENTS");
    expect(res.body.error.dependents).toEqual([
      { table: "followup_campaigns", count: 2, onDelete: "cascade" },
      { table: "fup_journeys", count: 1, onDelete: "cascade" },
    ]);
    expect(res.body.error.archived).toBe(false);
    // O banco apagaria tudo isto em cascata, sem erro. É o que a checagem impede.
    expect(await contar("followup_companies", "id = $1", [AGENTE_COM_CAMPANHA])).toBe(1);
    expect(await contar("followup_campaigns")).toBe(2);
    expect(await contar("fup_journeys")).toBe(1);
  });

  it("dependente em tabela sem cascade: recusa com 409 e a contagem, em vez de erro de chave estrangeira", async () => {
    const res = await excluir(AGENTE_COM_RESPOSTA);

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe("AGENT_HAS_DEPENDENTS");
    expect(res.body.error.dependents).toEqual([{ table: "followup_replies", count: 1, onDelete: "no_action" }]);
    expect(res.body.error.archived).toBe(true);
    expect(await contar("followup_companies", "id = $1", [AGENTE_COM_RESPOSTA])).toBe(1);
    expect(await contar("followup_replies")).toBe(1);
  });

  it("agente de outro tenant: 404 (não 403) e continua existindo", async () => {
    const res = await excluir(AGENTE_OUTRO_TENANT, [TENANT_A]);

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(await contar("followup_companies", "id = $1", [AGENTE_OUTRO_TENANT])).toBe(1);
  });

  it("o dono do tenant vizinho consegue apagar o próprio agente (o 404 acima é escopo, não defeito)", async () => {
    const res = await excluir(AGENTE_OUTRO_TENANT, [TENANT_B]);

    expect(res.statusCode).toBe(200);
    expect(await contar("followup_companies", "id = $1", [AGENTE_OUTRO_TENANT])).toBe(0);
  });

  it("tabela nova com chave estrangeira entra na checagem sem ninguém listar (vem do catálogo)", async () => {
    await db.exec(`
      CREATE TABLE tabela_que_ninguem_listou (
        id serial PRIMARY KEY,
        "Agente Id" uuid REFERENCES followup_companies(id) ON DELETE CASCADE
      );
    `);
    await db.query(`INSERT INTO tabela_que_ninguem_listou ("Agente Id") VALUES ($1), ($1), ($1)`, [AGENTE_VAZIO]);

    const res = await excluir(AGENTE_VAZIO);

    expect(res.statusCode).toBe(409);
    expect(res.body.error.dependents).toEqual([
      { table: "tabela_que_ninguem_listou", count: 3, onDelete: "cascade" },
    ]);
    expect(await contar("followup_companies", "id = $1", [AGENTE_VAZIO])).toBe(1);
    expect(await contar("tabela_que_ninguem_listou")).toBe(3);
  });

  it("id que não é uuid: 404, sem erro de tipo do banco", async () => {
    const res = await excluir("nao-e-uuid");

    expect(res.statusCode).toBe(404);
    expect(await contar("followup_companies")).toBe(5);
  });

  describe("GET /companies/archived — lista de arquivados", () => {
    async function listar(authAccess, query = {}) {
      const handler = getRouteHandler("/companies/archived", "get");
      const res = fakeRes();
      await handler({ params: {}, query, authAccess }, res);
      return res;
    }

    it("devolve só os arquivados do tenant de quem pede, nunca os ativos nem os do vizinho", async () => {
      const res = await listar(acessoDoTenant([TENANT_A]));

      expect(res.statusCode).toBe(200);
      expect(res.body.companies.map((c) => c.name).sort()).toEqual(["Agente arquivado", "Agente com resposta"]);
      expect(res.body.companies.every((c) => c.tenant_id === TENANT_A && c.archived_at)).toBe(true);
    });

    it("pedir o tenant do vizinho na query não abre o vizinho: lista vazia", async () => {
      const res = await listar(acessoDoTenant([TENANT_A]), { tenantId: TENANT_B });

      expect(res.statusCode).toBe(200);
      expect(res.body.companies).toEqual([]);
    });

    it("usuário sem tenant nenhum recebe lista vazia", async () => {
      const res = await listar(acessoDoTenant([]));

      expect(res.body.companies).toEqual([]);
    });

    it("admin filtra pelo tenant pedido e, sem pedir, vê todos", async () => {
      const admin = { role: "internal", isAdmin: true, scopeMode: "all_clients", clientIds: [] };

      const doVizinho = await listar(admin, { tenantId: TENANT_B });
      expect(doVizinho.body.companies.map((c) => c.name)).toEqual(["Agente do vizinho"]);

      const todos = await listar(admin);
      expect(todos.body.companies).toHaveLength(3);
    });

    it("agente excluído definitivamente some da lista de arquivados", async () => {
      await excluir(AGENTE_ARQUIVADO);
      const res = await listar(acessoDoTenant([TENANT_A]));

      expect(res.body.companies.map((c) => c.name)).toEqual(["Agente com resposta"]);
    });
  });

  it("o DELETE antigo continua só arquivando: a linha fica no banco", async () => {
    const handler = getRouteHandler("/companies/:id", "delete");
    const res = fakeRes();
    await handler({ params: { id: AGENTE_VAZIO }, authAccess: acessoDoTenant([TENANT_A]) }, res);

    expect(res.statusCode).toBe(200);
    expect(await contar("followup_companies", "id = $1 AND archived_at IS NOT NULL", [AGENTE_VAZIO])).toBe(1);
  });
});
