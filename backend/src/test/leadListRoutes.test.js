// backend/src/test/leadListRoutes.test.js
//
// As rotas HTTP da lista do Banco de Dados (GET /api/leads paginado e legado, /facets, /ids, /audience, /lookup, /export) com o
// serviço do produto e Postgres REAL (pglite) por trás, numa base de 25.000 leads.
// Prova o defeito original: a tela só enxergava 2.000 leads, e tag/busca caíam num fallback calado que devolvia as 2.000 primeiras
// linhas SEM filtro.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { sanitizePhone } from "../services/leadImport.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const SLOW = 180_000;
const T = "tenant-a";
const OUTRO = "tenant-b";
const BASE = 25_000;
const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    telefone text NOT NULL, phone text, nome text, status text, cidade text, potential_contract_value numeric(14,2),
    dados jsonb NOT NULL DEFAULT '{}'::jsonb, lead_source text, created_at timestamptz NOT NULL DEFAULT now(),
    stage text DEFAULT 'cold', temperature text DEFAULT 'warm', tags text[] DEFAULT ARRAY[]::text[], last_interaction_at timestamptz,
    raw_chat_summary text, assigned_to text, UNIQUE (client_id, telefone));
`;

describe("rotas da lista de leads (base de 25.000)", () => {
  let server;
  let baseUrl;
  let db;
  const estado = { falharConsultaDoServico: false, falharCompatContains: false };

  const sendError = (res, status, code, message, details) => res.status(status).json({ error: { code, message, details } });

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'A'), ('${OUTRO}', 'B')`);
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, tags, lead_source, raw_chat_summary, assigned_to, cidade, created_at)
      SELECT '${T}', '55' || lpad(i::text, 11, '0'), 'Lead ' || i,
        (ARRAY['buyer','open_budget','cold','lost','inquiry',NULL,'cold','cold'])[1 + i % 8],
        CASE WHEN i % 7 = 0 THEN ARRAY['vip'] ELSE ARRAY[]::text[] END,
        (ARRAY['campanha','organico','Google Ads','Indicação',NULL])[1 + i % 5],
        (ARRAY['Quer proposta',NULL,'🚫 pessoal',''])[1 + i % 4],
        CASE WHEN i % 5 = 0 THEN 'gabriel' WHEN i % 5 = 1 THEN 'priscila' END,
        (ARRAY['São Paulo','Curitiba',NULL])[1 + i % 3],
        timestamptz '2026-01-01' + (i || ' minutes')::interval
        FROM generate_series(1, ${BASE}) AS i;
      INSERT INTO leads (client_id, telefone, nome, stage, tags) SELECT '${OUTRO}', '5599' || lpad(i::text, 9, '0'), 'Outro ' || i, 'buyer', ARRAY['vip'] FROM generate_series(1, 100) AS i;
    `);
    const pool = {
      query: (sql, params) => {
        if (estado.falharConsultaDoServico && /WITH s0 AS/.test(sql)) return Promise.reject(new Error("falha simulada do serviço"));
        return db.query(sql, params);
      },
    };
    const realSupabase = createPgSupabaseClient(pool);
    // supabase com falha provocada em .contains(), para provar o fallback NÃO silencioso do modo legado
    const supabase = {
      from: (table) => {
        const q = realSupabase.from(table);
        if (estado.falharCompatContains) {
          const original = q.select.bind(q);
          q.select = (...a) => {
            const b = original(...a);
            b.contains = () => { throw new Error("contains indisponível (simulado)"); };
            return b;
          };
        }
        return q;
      },
    };
    const app = express();
    app.use(express.json({ limit: "15mb" }));
    registerLeadsRoutes(app, {
      ensureDb: () => true,
      pgDatabasePool: pool,
      supabase,
      requireFirebaseAuth: (req, _res, next) => {
        const papel = req.headers["x-test-papel"];
        req.authAccess = papel === "operador"
          ? { uid: "gabriel", email: "g@x", role: "internal", accessPreset: "operador" }
          : { uid: "u1", email: "u@x", role: "internal", clientId: T };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      ensureSharedRoutePageAccess: () => true,
      resolveAuthorizedClientId: (_req, res, cid) => {
        if (cid && cid !== T) { sendError(res, 403, "FORBIDDEN", "Sem acesso a este cliente"); return null; }
        return cid || T;
      },
      sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
      sendError,
      normalizeString: (s) => (s ? String(s).trim() : ""),
    });
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    baseUrl = `http://localhost:${server.address().port}`;
  }, SLOW);
  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    await db?.close();
  });
  beforeEach(() => {
    estado.falharConsultaDoServico = false;
    estado.falharCompatContains = false;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const get = (path, headers = {}) => fetch(`${baseUrl}${path}`, { headers });
  const json = async (path, headers) => (await get(path, headers)).json();
  const contar = async (where) => (await db.query(`SELECT count(*)::int AS n FROM leads WHERE client_id = '${T}' AND (${where})`)).rows[0].n;

  describe("modo paginado (opt-in por page/limit)", () => {
    it("página 1 devolve o tamanho pedido e o total diz 25.000 (o defeito: a tela via só 2.000)", async () => {
      const r = await json(`/api/leads?clientId=${T}&page=1&limit=50`);
      expect(r.items).toHaveLength(50);
      expect(r.total).toBe(BASE);
      expect(r.totalPages).toBe(500);
      expect(r.degraded).toBe(false);
    }, SLOW);

    it("filtro por tag: total REAL da tag (acima de 2.000), não o da página", async () => {
      const r = await json(`/api/leads?clientId=${T}&page=1&limit=50&tag=vip`);
      expect(r.total).toBe(await contar(`'vip' = ANY(tags)`));
      expect(r.total).toBeGreaterThan(3000);
      expect(r.items).toHaveLength(50);
      expect(r.items.every((x) => x.tags.includes("vip"))).toBe(true);
    }, SLOW);

    it("abas = COUNT do banco; sem filtro coincidem com a base", async () => {
      const r = await json(`/api/leads?clientId=${T}&page=1&limit=10`);
      expect(r.tabs.all).toBe(BASE);
      expect(r.tabs.buyer).toBe(await contar(`stage = 'buyer'`));
      expect(r.tabs.cold).toBe(await contar(`stage IS NULL OR stage NOT IN ('buyer','open_budget','lost')`));
      expect(r.tabs.buyer + r.tabs.open_budget + r.tabs.cold + r.tabs.lost).toBe(BASE);
    }, SLOW);

    it("ordenação por nome e por última conversa vêm do banco, com direção", async () => {
      const asc = await json(`/api/leads?clientId=${T}&page=1&limit=3&sort=contato&dir=asc`);
      const desc = await json(`/api/leads?clientId=${T}&page=1&limit=3&sort=contato&dir=desc`);
      expect(asc.items.map((x) => x.nome)).toEqual(["Lead 1", "Lead 10", "Lead 100"]);
      expect(desc.items[0].nome).toBe("Lead 9999");
    }, SLOW);

    it("filtro inválido de canal ou faixa é 400 (nunca lista vazia calada)", async () => {
      const a = await get(`/api/leads?clientId=${T}&page=1&limit=10&channel=inventado`);
      expect(a.status).toBe(400);
      expect((await a.json()).error.code).toBe("INVALID_LEAD_FILTER");
      const b = await get(`/api/leads?clientId=${T}&page=1&limit=10&segment=inventada`);
      expect(b.status).toBe(400);
    }, SLOW);

    it("operador interno só vê os seus e os sem dono (total e abas)", async () => {
      const r = await json(`/api/leads?clientId=${T}&page=1&limit=10`, { "x-test-papel": "operador" });
      const esperado = await contar(`assigned_to = 'gabriel' OR assigned_to IS NULL`);
      expect(r.total).toBe(esperado);
      expect(r.tabs.all).toBe(esperado);
    }, SLOW);

    it("outro cliente é 403 e o tenant vizinho nunca vaza", async () => {
      expect((await get(`/api/leads?clientId=${OUTRO}&page=1&limit=10`)).status).toBe(403);
      const r = await json(`/api/leads?clientId=${T}&page=1&limit=500&tag=vip`);
      expect(r.items.every((x) => x.client_id === T)).toBe(true);
    }, SLOW);

    it("se a consulta do serviço falha, a resposta DIZ que degradou (e não finge filtro)", async () => {
      estado.falharConsultaDoServico = true;
      const r = await json(`/api/leads?clientId=${T}&page=2&limit=20&tag=vip`);
      expect(r.degraded).toBe(true);
      expect(r.degradedReason).toBe("FILTERS_UNAVAILABLE");
      expect(r.items).toHaveLength(20);
      expect(r.total).toBe(BASE); // página simples da base, sem filtro: o aviso é o que impede a leitura errada
      expect(r.tabs).toBeNull();
    }, SLOW);
  });

  describe("modo legado (sem page/limit: contrato de sempre, lista inteira)", () => {
    it("sem filtro devolve TODOS (não os 2.000 de antes) e o resumo vem do banco", async () => {
      const r = await json(`/api/leads?clientId=${T}`);
      expect(r.items).toHaveLength(BASE);
      expect(r.summary.totalLeads).toBe(BASE);
      expect(r.degraded).toBe(false);
    }, SLOW);

    it("tag e busca FILTRAM (antes lançavam e devolviam 2.000 linhas sem filtro)", async () => {
      const t = await json(`/api/leads?clientId=${T}&tag=vip`);
      expect(t.items).toHaveLength(await contar(`'vip' = ANY(tags)`));
      expect(t.items.every((x) => x.tags.includes("vip"))).toBe(true);
      expect(t.degraded).toBe(false);
      const s = await json(`/api/leads?clientId=${T}&search=${encodeURIComponent("Lead 24999")}`);
      expect(s.items.map((x) => x.nome)).toEqual(["Lead 24999"]);
    }, SLOW);

    it("o fallback deixou de ser calado: marca degradado e que os filtros foram ignorados", async () => {
      estado.falharCompatContains = true;
      const r = await json(`/api/leads?clientId=${T}&tag=vip`);
      expect(r.degraded).toBe(true);
      expect(r.degradedReason).toBe("FILTERS_UNAVAILABLE");
      expect(r.filtersIgnored).toBe(true);
      expect(r.items).toHaveLength(2000); // o comportamento antigo do fallback, agora declarado
    }, SLOW);

    it("falha no resumo é declarada (antes devolvia zeros em silêncio)", async () => {
      estado.falharConsultaDoServico = true;
      const r = await json(`/api/leads?clientId=${T}`);
      expect(r.degraded).toBe(true);
      expect(r.summary).toBeNull();
      expect(r.degradedReason).toBe("SUMMARY_UNAVAILABLE");
    }, SLOW);
  });

  describe("/facets, /ids, /audience, /lookup, /export", () => {
    it("facets: os cartões de origem somam a base e batem com o resumo", async () => {
      const f = await json(`/api/leads/facets?clientId=${T}`);
      expect(Object.values(f.channels).reduce((a, b) => a + b, 0)).toBe(BASE);
      expect(f.summary.totalLeads).toBe(BASE);
      expect(f.baseTotal).toBe(BASE);
      expect(f.tags.find((t) => t.tag === "vip").count).toBe(await contar(`'vip' = ANY(tags)`));
    }, SLOW);

    it("ids: todos os ids da combinação de filtros", async () => {
      const r = await json(`/api/leads/ids?clientId=${T}&tag=vip&stage=buyer`);
      expect(r.total).toBe(await contar(`'vip' = ANY(tags) AND stage = 'buyer'`));
      expect(r.truncated).toBe(false);
      expect(r.contacts).toBeUndefined(); // só com ?contacts=1
      const c = await json(`/api/leads/ids?clientId=${T}&tag=vip&stage=buyer&contacts=1`);
      expect(c.contacts).toHaveLength(r.total);
      expect(c.contacts[0]).toEqual(expect.objectContaining({ id: expect.any(String), nome: expect.any(String), telefone: expect.stringMatching(/^55\d+$/) }));
      expect(c.contacts.map((x) => x.id)).toEqual(c.ids); // mesma ordem dos ids
    }, SLOW);

    it("audience: regra em campo escalar funciona; em campo fora da lista é 400 que diz qual", async () => {
      const ok = await fetch(`${baseUrl}/api/leads/audience`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: T, stages: ["buyer"], rules: [{ column: "cidade", operator: "equals", value: "curitiba" }] }),
      });
      const body = await ok.json();
      expect(ok.status).toBe(200);
      expect(body.total).toBe(await contar(`stage = 'buyer' AND cidade = 'Curitiba'`));

      const ruim = await fetch(`${baseUrl}/api/leads/audience`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: T, rules: [{ column: "dados", operator: "contains", value: "x" }] }),
      });
      expect(ruim.status).toBe(400);
      const err = await ruim.json();
      expect(err.error.code).toBe("UNSUPPORTED_RULES");
      expect(err.problems[0]).toMatchObject({ index: 0, column: "dados", reason: "COLUMN_NOT_SUPPORTED" });
    }, SLOW);

    it("lookup: abre lead fora da página carregada, por id e por telefone; outro tenant não abre", async () => {
      const velho = (await db.query(`SELECT id, telefone FROM leads WHERE client_id = '${T}' ORDER BY created_at ASC LIMIT 1`)).rows[0];
      const porId = await json(`/api/leads/lookup?clientId=${T}&leadId=${velho.id}`);
      expect(porId.item.telefone).toBe(velho.telefone);
      const porFone = await json(`/api/leads/lookup?clientId=${T}&phone=${encodeURIComponent(`+${velho.telefone}`)}`);
      expect(porFone.item.id).toBe(velho.id);
      const nada = await json(`/api/leads/lookup?clientId=${T}&leadId=00000000-0000-0000-0000-000000000000`);
      expect(nada.item).toBeNull();
      expect((await get(`/api/leads/lookup?clientId=${T}`)).status).toBe(400);
    }, SLOW);

    it("export: a base INTEIRA da combinação (sem o teto de 5.000) com cabeçalho e linhas completas", async () => {
      const res = await get(`/api/leads/export?clientId=${T}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/csv/);
      const texto = await res.text();
      const linhas = texto.replace(/^﻿/, "").trim().split("\n");
      expect(linhas.length - 1).toBe(BASE);
      expect(linhas[0]).toContain('"Nome","Telefone"');
    }, SLOW);

    it("export respeita o filtro da tela (tag + aba) e o escopo do operador", async () => {
      const filtrado = await (await get(`/api/leads/export?clientId=${T}&tag=vip&stage=buyer`)).text();
      expect(filtrado.trim().split("\n").length - 1).toBe(await contar(`'vip' = ANY(tags) AND stage = 'buyer'`));
      const op = await (await get(`/api/leads/export?clientId=${T}`, { "x-test-papel": "operador" })).text();
      expect(op.trim().split("\n").length - 1).toBe(await contar(`assigned_to = 'gabriel' OR assigned_to IS NULL`));
    }, SLOW);
  });
});
