// backend/src/test/leadImportBatchesRoutes.test.js
//
// As rotas HTTP da importação em lotes (abrir → lotes → fechar → progresso) e o POST único antigo, com o tenant autorizado
// pela rota e o Postgres REAL (pglite) por trás. O POST único não tem mais teto de linhas e grava em fatias de 500.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { normalizeImportedLead, sanitizePhone } from "../services/leadImport.js";
import { resetLeadImportBatchStateForTest } from "../services/leadImportBatches.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const SLOW = 120_000;
const T = "tenant-a";
const OUTRO = "tenant-b";
const MIGRATION = readFileSync(resolve("supabase/migrations/20261005120000_add_batch_columns_to_lead_imports.sql"), "utf8");
const SCHEMA = `
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE lead_imports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE, source_name text NOT NULL, source_type text NOT NULL DEFAULT 'spreadsheet', total_rows integer NOT NULL DEFAULT 0, imported_rows integer NOT NULL DEFAULT 0, skipped_rows integer NOT NULL DEFAULT 0, uploaded_by_uid text, uploaded_by_email text, created_at timestamptz NOT NULL DEFAULT now(), column_mapping jsonb);
  CREATE TABLE lead_import_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_id uuid NOT NULL REFERENCES lead_imports(id) ON DELETE CASCADE, client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE, row_number integer NOT NULL, telefone text, lead_id uuid REFERENCES leads(id) ON DELETE SET NULL, imported boolean NOT NULL DEFAULT false, skip_reason text, raw_data jsonb NOT NULL DEFAULT '{}'::jsonb, normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
  CREATE INDEX idx_lead_import_items_import_id ON lead_import_items (import_id);
  CREATE TABLE lead_custom_fields (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, key text NOT NULL, label text NOT NULL, type text NOT NULL DEFAULT 'text', import_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (client_id, key));
`;
const MAPEAMENTO = { columns: ["Nome", "Telefone"], mapping: [{ column: "Nome", target: "nome" }, { column: "Telefone", target: "telefone" }] };
const planilha = (n) => Array.from({ length: n }, (_, i) => ({ Nome: `Pessoa ${i}`, Telefone: i % 10 === 9 ? "" : `(34) 9${String(80000000 + i).padStart(8, "0")}` }));

describe("rotas da importação em lotes", () => {
  let server;
  let baseUrl;
  let db;
  const supabaseLog = { importsInseridos: [], itensPorChamada: [], apagados: [], falharNaChamada: 0 };

  // o POST único antigo ainda grava por aqui (supabase): registra as fatias para provar o limite de 500
  const supabase = {
    from: (table) => {
      if (table === "lead_imports") {
        return {
          insert: (rec) => ({ select: () => ({ single: async () => { supabaseLog.importsInseridos.push(rec); return { data: { id: `imp-${supabaseLog.importsInseridos.length}`, ...rec }, error: null }; } }) }),
          delete: () => ({ eq: (_c, v) => { supabaseLog.apagados.push(v); return Promise.resolve({ error: null }); } }),
        };
      }
      if (table === "lead_import_items") {
        return {
          insert: async (arr) => {
            supabaseLog.itensPorChamada.push(arr.length);
            if (supabaseLog.falharNaChamada && supabaseLog.itensPorChamada.length === supabaseLog.falharNaChamada) return { error: new Error("falha simulada na fatia") };
            return { error: null };
          },
        };
      }
      throw new Error(`tabela inesperada no mock: ${table}`);
    },
  };

  beforeAll(async () => {
    db = await createPgliteDb("SET TimeZone = 'UTC';\n" + SCHEMA);
    await db.exec(MIGRATION);
    await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'A'), ('${OUTRO}', 'B')`);
    const app = express();
    app.use(express.json({ limit: "15mb" }));
    const sendError = (res, status, code, message, details) => res.status(status).json({ error: { code, message, details } });
    registerLeadsRoutes(app, {
      ensureDb: () => true,
      pgDatabasePool: { query: (sql, params) => db.query(sql, params) },
      requireFirebaseAuth: (req, _res, next) => { req.authAccess = { uid: "u1", email: "u@x", clientId: T }; next(); },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      // o usuário do teste só enxerga o tenant-a
      resolveAuthorizedClientId: (_req, res, cid) => {
        if (cid && cid !== T) { sendError(res, 403, "FORBIDDEN", "Sem acesso a este cliente"); return null; }
        return cid || T;
      },
      sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
      sendError,
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeImportedLead,
      supabase,
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
    resetLeadImportBatchStateForTest();
    supabaseLog.importsInseridos = [];
    supabaseLog.itensPorChamada = [];
    supabaseLog.apagados = [];
    supabaseLog.falharNaChamada = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const post = (path, body) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const abrir = async (rows, extra = {}) => (await (await post("/api/lead-imports/open", { clientId: T, sourceName: "p.xlsx", sourceType: "xlsx", defaultDdd: "34", columnMapping: MAPEAMENTO, totalRows: rows.length, sampleRows: rows.slice(0, 15), ...extra })).json());

  it("abrir → lotes → fechar → lista: a planilha aparece completa, com os totais", async () => {
    const rows = planilha(1_200);

    const aberta = await abrir(rows);
    expect(aberta.item.status).toBe("incomplete");
    expect(aberta.batchSize).toBe(500);
    for (let start = 0; start < rows.length; start += 500) {
      const r = await post(`/api/lead-imports/${aberta.item.id}/batches`, { startIndex: start, rows: rows.slice(start, start + 500) });
      expect(r.status).toBe(200);
    }
    const fechada = await (await post(`/api/lead-imports/${aberta.item.id}/close`, {})).json();
    const lista = await (await fetch(`${baseUrl}/api/lead-imports?clientId=${T}`)).json();

    expect(fechada.item.status).toBe("completed");
    expect(fechada.totals).toMatchObject({ total: 1_200, withoutPhone: 120, valid: 1_080 });
    expect(lista.items.find((i) => i.id === aberta.item.id)).toMatchObject({ status: "completed", total_rows: 1_200, imported_rows: 1_080 });
  }, SLOW);

  it("progresso devolve o ponto de retomada; fechar incompleta é 409 com o que falta", async () => {
    const rows = planilha(1_000);
    const aberta = await abrir(rows);
    await post(`/api/lead-imports/${aberta.item.id}/batches`, { startIndex: 0, rows: rows.slice(0, 500) });

    const progresso = await (await fetch(`${baseUrl}/api/lead-imports/${aberta.item.id}/progress`)).json();
    const fechar = await post(`/api/lead-imports/${aberta.item.id}/close`, {});
    const corpo = await fechar.json();

    expect(progresso).toMatchObject({ status: "incomplete", expectedRows: 1_000, receivedOffset: 500, missingRows: 500, storedItems: 500 });
    expect(fechar.status).toBe(409);
    expect(corpo.error).toMatchObject({ code: "IMPORT_INCOMPLETE", details: { missingRows: 500 } });
    const lista = await (await fetch(`${baseUrl}/api/lead-imports?clientId=${T}`)).json();
    expect(lista.items.find((i) => i.id === aberta.item.id)).toMatchObject({ status: "incomplete", expected_rows: 1_000, received_offset: 500 });
  }, SLOW);

  it("lote de 501 linhas é 413 com mensagem clara (o teto por requisição é o tamanho do lote)", async () => {
    const rows = planilha(501);
    const aberta = await abrir(rows);

    const r = await post(`/api/lead-imports/${aberta.item.id}/batches`, { startIndex: 0, rows });
    const corpo = await r.json();

    expect(r.status).toBe(413);
    expect(corpo.error.code).toBe("BATCH_TOO_LARGE");
    expect(corpo.error.message).toMatch(/no máximo 500 linhas/);
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] tenant isolado: a importação de OUTRO tenant não aceita lote, fechamento nem consulta de progresso", async () => {
    await db.exec(`INSERT INTO lead_imports (id, client_id, source_name, status, expected_rows) VALUES ('99999999-9999-4999-8999-999999999999', '${OUTRO}', 'alheia.xlsx', 'incomplete', 100)`);
    const alheia = "99999999-9999-4999-8999-999999999999";

    const lote = await post(`/api/lead-imports/${alheia}/batches`, { startIndex: 0, rows: planilha(10) });
    const fecho = await post(`/api/lead-imports/${alheia}/close`, {});
    const prog = await fetch(`${baseUrl}/api/lead-imports/${alheia}/progress`);
    const abrirOutro = await post("/api/lead-imports/open", { clientId: OUTRO, sourceName: "x", totalRows: 5 });

    expect([lote.status, fecho.status, prog.status, abrirOutro.status]).toEqual([403, 403, 403, 403]);
    expect((await db.query("SELECT count(*)::int AS n FROM lead_import_items WHERE import_id = $1", [alheia])).rows[0].n).toBe(0);
  }, SLOW);

  it("importação inexistente é 404; id mal formado é 400; abrir sem totalRows é 400", async () => {
    expect((await post("/api/lead-imports/00000000-0000-4000-8000-000000000000/batches", { startIndex: 0, rows: planilha(1) })).status).toBe(404);
    expect((await post("/api/lead-imports/nao-e-uuid/batches", { startIndex: 0, rows: planilha(1) })).status).toBe(400);
    expect((await post("/api/lead-imports/open", { clientId: T, sourceName: "x" })).status).toBe(400);
  }, SLOW);

  describe("POST único antigo (/api/lead-imports): sem teto de linhas, em fatias de 500", () => {
    const enviar = (rows) => post("/api/lead-imports", { clientId: T, sourceName: "p.xlsx", sourceType: "xlsx", rows, columnMapping: MAPEAMENTO, defaultDdd: "34" });

    it("[TESTE OBRIGATÓRIO] 8.000 linhas (acima de 5.000 e de 7.281) são aceitas, em fatias de no máximo 500", async () => {
      const r = await enviar(planilha(8_000));
      const corpo = await r.json();

      expect(r.status).toBe(201);
      expect(corpo.item.total_rows).toBe(8_000);
      expect(supabaseLog.itensPorChamada.reduce((a, b) => a + b, 0)).toBe(8_000);
      expect(Math.max(...supabaseLog.itensPorChamada)).toBe(500);
      expect(supabaseLog.itensPorChamada).toHaveLength(16);
    }, SLOW);

    it("5.001 linhas já não dão 413 (o `if > 5000` saiu)", async () => {
      const r = await enviar(planilha(5_001));
      expect(r.status).toBe(201);
    }, SLOW);

    it("falha numa fatia do meio: responde 500 e REMOVE o registro (nada pela metade com cara de completa)", async () => {
      supabaseLog.falharNaChamada = 3;

      const r = await enviar(planilha(2_000));

      expect(r.status).toBe(500);
      expect(supabaseLog.apagados).toEqual(["imp-1"]);
      expect(supabaseLog.itensPorChamada).toHaveLength(3); // parou na fatia que falhou
    }, SLOW);

    it("continua recusando corpo sem linhas", async () => {
      expect((await enviar([])).status).toBe(400);
    }, SLOW);
  });
});
