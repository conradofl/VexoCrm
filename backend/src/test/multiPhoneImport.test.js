// backend/src/test/multiPhoneImport.test.js
//
// Importação com MAIS DE UMA coluna de telefone, em Postgres REAL (pglite) pelas rotas HTTP reais do Banco.
// O problema medido: o mesmo arquivo (19.998 linhas, duas colunas de telefone) foi importado duas vezes porque o sistema só aceitava uma;
// as mesmas empresas apareciam duas vezes, com números diferentes. Agora UMA linha vira UM lead: o primeiro telefone válido identifica,
// os demais ficam em dados.telefones_extras (com a coluna de origem), e nada é fundido nem fabricado.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { EXTRA_PHONE_TARGET, normalizeImportedLead, resolveRowPhones, sanitizePhone } from "../services/leadImport.js";
import { mergeTelefonesExtras } from "../services/leadUpsert.js";
import { resetLeadImportBatchStateForTest } from "../services/leadImportBatches.js";
import { summarizePhonePreview } from "../../../frontend/src/lib/leadImports/multiPhone.ts";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const SLOW = 180_000;
const T = "tenant-a";
const MIGRATION = readFileSync(resolve("supabase/migrations/20261005120000_add_batch_columns_to_lead_imports.sql"), "utf8");
const CASOS = JSON.parse(readFileSync(resolve("../shared/multiPhoneCases.json"), "utf8")).cases;
const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    telefone text NOT NULL, phone text, nome text, stage text DEFAULT 'cold', stage_source text, lost_reason text, temperature text DEFAULT 'warm',
    tags text[] DEFAULT ARRAY[]::text[], dados jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz DEFAULT now(), UNIQUE (client_id, telefone));
  CREATE TABLE lead_imports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE, source_name text NOT NULL, source_type text NOT NULL DEFAULT 'spreadsheet', total_rows integer NOT NULL DEFAULT 0, imported_rows integer NOT NULL DEFAULT 0, skipped_rows integer NOT NULL DEFAULT 0, uploaded_by_uid text, uploaded_by_email text, created_at timestamptz NOT NULL DEFAULT now(), column_mapping jsonb);
  CREATE TABLE lead_import_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_id uuid NOT NULL REFERENCES lead_imports(id) ON DELETE CASCADE, client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE, row_number integer NOT NULL, telefone text, lead_id uuid REFERENCES leads(id) ON DELETE SET NULL, imported boolean NOT NULL DEFAULT false, skip_reason text, raw_data jsonb NOT NULL DEFAULT '{}'::jsonb, normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
  CREATE INDEX idx_lead_import_items_import_id ON lead_import_items (import_id);
  CREATE TABLE lead_custom_fields (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, key text NOT NULL, label text NOT NULL, type text NOT NULL DEFAULT 'text', import_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (client_id, key));
`;
const MAPA = [
  { column: "Empresa", target: "nome" },
  { column: "Telefone 1", target: "telefone" },
  { column: "Telefone 2", target: "telefone_adicional" },
];

const mundos = [];
afterAll(async () => { for (const m of mundos) await m.close(); });
beforeEach(() => {
  resetLeadImportBatchStateForTest();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function mundo() {
  const db = await createPgliteDb(SCHEMA);
  await db.exec(MIGRATION);
  await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'A')`);
  const pool = { query: (sql, params) => db.query(sql, params) };
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  const sendError = (res, status, code, message, details) => res.status(status).json({ error: { code, message, details } });
  registerLeadsRoutes(app, {
    ensureDb: () => true,
    pgDatabasePool: pool,
    requireFirebaseAuth: (req, _res, next) => { req.authAccess = { uid: "u1", email: "u@x", clientId: T }; next(); },
    requireInternalPageAccess: () => (_req, _res, next) => next(),
    requireAppViewAccess: () => (_req, _res, next) => next(),
    ensureSharedRoutePageAccess: () => true,
    resolveAuthorizedClientId: (_req, res, cid) => (cid && cid !== T ? (sendError(res, 403, "FORBIDDEN", "x"), null) : cid || T),
    sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
    sendError,
    normalizeString: (s) => (s ? String(s).trim() : ""),
    normalizeImportedLead,
    supabase: { from: () => { throw new Error("sem supabase"); } },
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const baseUrl = `http://localhost:${server.address().port}`;
  const post = (path, body) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = (path) => fetch(`${baseUrl}${path}`);
  const m = { db, pool, post, get, close: async () => { await new Promise((r) => server.close(r)); await db.close(); } };
  mundos.push(m);
  return m;
}
const importar = async (m, rows, extra = {}) => (await m.post("/api/leads/import-csv", { clientId: T, rows, columnMapping: MAPA, sourceName: "LEADS - Empresas UDIA.xlsx", ...extra })).json();
const leads = async (m) => (await m.db.query(`SELECT id::text AS id, telefone, nome, dados FROM leads WHERE client_id = $1 ORDER BY nome`, [T])).rows;

describe("regra de telefones da linha: a fixture compartilhada com a prévia da tela", () => {
  it.each(CASOS.map((c) => [c.name, c]))("%s", (_nome, c) => {
    const r = resolveRowPhones(c.row, c.mapping, c.ddd);
    expect({ telefone: r.telefone, colunaPrincipal: r.colunaPrincipal, brutoPrincipal: r.brutoPrincipal, extras: r.extras.map((e) => ({ telefone: e.telefone, coluna: e.coluna })) }).toEqual(c.expected);
  });
});

describe("importação com mais de uma coluna de telefone (Postgres real, rotas reais)", () => {
  it("[TESTE OBRIGATÓRIO] duas colunas de telefone: UMA linha vira UM lead, com o adicional guardado e a coluna de origem registrada", async () => {
    const m = await mundo();
    const out = await importar(m, [{ Empresa: "Padaria Sol", "Telefone 1": "(34) 99810-0001", "Telefone 2": "(34) 99810-0002" }]);
    expect(out.success).toBe(true);
    const ls = await leads(m);
    expect(ls).toHaveLength(1); // nunca um lead por telefone
    expect(ls[0].telefone).toBe("5534998100001");
    expect(ls[0].dados.telefones_extras).toEqual([{ telefone: "5534998100002", coluna: "Telefone 2", bruto: "(34) 99810-0002" }]);
    expect(ls[0].dados.telefone_bruto).toBe("(34) 99810-0001");
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] linha só com o telefone ADICIONAL preenchido: ele vira o principal e a linha não se perde", async () => {
    const m = await mundo();
    await importar(m, [{ Empresa: "Só Adicional", "Telefone 1": "", "Telefone 2": "(34) 99810-0002" }]);
    const ls = await leads(m);
    expect(ls).toHaveLength(1);
    expect(ls[0].telefone).toBe("5534998100002");
    expect(ls[0].dados.telefones_extras).toBeUndefined();
    expect(ls[0].dados.telefone_bruto).toBe("(34) 99810-0002");
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] os dois telefones iguais depois de normalizar: guarda um só", async () => {
    const m = await mundo();
    await importar(m, [{ Empresa: "Igual", "Telefone 1": "(34) 99810-0001", "Telefone 2": "+55 34 99810-0001" }]);
    const ls = await leads(m);
    expect(ls).toHaveLength(1);
    expect(ls[0].telefone).toBe("5534998100001");
    expect(ls[0].dados.telefones_extras).toBeUndefined();
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] linha sem nenhum telefone válido: pulada com motivo, sem fabricar número (nem 5500…)", async () => {
    const m = await mundo();
    const out = await importar(m, [
      { Empresa: "Sem Nada", "Telefone 1": "", "Telefone 2": "" },
      { Empresa: "Só Lixo", "Telefone 1": "abc", "Telefone 2": "12" },
      { Empresa: "Cinquenta e cinco zero zero", "Telefone 1": "5500123456789", "Telefone 2": "" },
      { Empresa: "Boa", "Telefone 1": "(34) 99810-0009", "Telefone 2": "" },
    ]);
    expect(out.skippedNoPhoneCount).toBe(3);
    const ls = await leads(m);
    expect(ls.map((l) => l.nome)).toEqual(["Boa"]);
    expect(ls.every((l) => !l.telefone.startsWith("5500"))).toBe(true);
    const itens = (await m.db.query(`SELECT row_number, imported, skip_reason FROM lead_import_items WHERE import_id = $1 ORDER BY row_number`, [out.importId])).rows;
    expect(itens.filter((i) => !i.imported).map((i) => i.row_number)).toEqual([2, 3, 4]);
    for (const i of itens.filter((x) => !x.imported)) expect(i.skip_reason).toBeTruthy(); // com motivo
  }, SLOW);

  it("o MOTIVO da linha pulada vem do telefone que a pessoa preencheu, principal ou adicional (9 dígitos sem DDD → 'faltou DDD')", async () => {
    const m = await mundo();
    const out = await importar(m, [{ Empresa: "Sem DDD", "Telefone 1": "", "Telefone 2": "998100001" }]);
    expect(out.skippedNoPhoneCount).toBe(1);
    const item = (await m.db.query(`SELECT skip_reason FROM lead_import_items WHERE import_id = $1`, [out.importId])).rows[0];
    expect(item.skip_reason).toMatch(/faltou DDD/);
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] telefone adicional que já é OUTRO lead: nada é fundido, e a coincidência fica registrada (id do outro lead)", async () => {
    const m = await mundo();
    // o outro lead já existe (principal 5534998100009)
    await importar(m, [{ Empresa: "Outra Empresa", "Telefone 1": "(34) 99810-0009", "Telefone 2": "" }], { sourceName: "antes.xlsx" });
    const outro = (await leads(m))[0];
    await importar(m, [{ Empresa: "Nova Empresa", "Telefone 1": "(34) 99810-0001", "Telefone 2": "(34) 99810-0009" }]);
    const ls = await leads(m);
    expect(ls).toHaveLength(2); // não fundiu
    const nova = ls.find((l) => l.nome === "Nova Empresa");
    expect(nova.telefone).toBe("5534998100001");
    expect(nova.dados.telefones_extras).toEqual([{ telefone: "5534998100009", coluna: "Telefone 2", bruto: "(34) 99810-0009", ja_existe_como_lead: outro.id }]);
    // o outro lead ficou como estava
    expect(ls.find((l) => l.nome === "Outra Empresa").dados.telefones_extras).toBeUndefined();
  }, SLOW);

  it("coincidência dentro da MESMA importação também é registrada (a linha 1 tem de adicional o principal da linha 2)", async () => {
    const m = await mundo();
    await importar(m, [
      { Empresa: "Linha Um", "Telefone 1": "(34) 99810-0001", "Telefone 2": "(34) 99810-0002" },
      { Empresa: "Linha Dois", "Telefone 1": "(34) 99810-0002", "Telefone 2": "" },
    ]);
    const ls = await leads(m);
    expect(ls).toHaveLength(2);
    const um = ls.find((l) => l.nome === "Linha Um");
    const dois = ls.find((l) => l.nome === "Linha Dois");
    expect(um.dados.telefones_extras[0].ja_existe_como_lead).toBe(dois.id);
  }, SLOW);

  it("reimportar o mesmo arquivo não duplica lead nem adicional, e junta (não apaga) os adicionais que já estavam", async () => {
    const m = await mundo();
    const linha = { Empresa: "Reimport", "Telefone 1": "(34) 99810-0001", "Telefone 2": "(34) 99810-0002" };
    await importar(m, [linha]);
    await importar(m, [linha]);
    expect(await leads(m)).toHaveLength(1);
    expect((await leads(m))[0].dados.telefones_extras).toHaveLength(1);
    // depois a planilha traz outro adicional: o antigo continua
    await importar(m, [{ ...linha, "Telefone 2": "(34) 99810-0003" }]);
    const ex = (await leads(m))[0].dados.telefones_extras.map((e) => e.telefone).sort();
    expect(ex).toEqual(["5534998100002", "5534998100003"]);
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] os três números da PRÉVIA (só principal / com adicional / puladas) batem com o que a importação de fato faz", async () => {
    const m = await mundo();
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const p = `(34) 9${String(80000000 + i).padStart(8, "0")}`;
      const a = `(34) 9${String(81000000 + i).padStart(8, "0")}`;
      if (i % 5 === 0) rows.push({ Empresa: `E${i}`, "Telefone 1": p, "Telefone 2": a }); // com adicional
      else if (i % 5 === 1) rows.push({ Empresa: `E${i}`, "Telefone 1": "", "Telefone 2": a }); // adicional vira principal
      else if (i % 5 === 2) rows.push({ Empresa: `E${i}`, "Telefone 1": p, "Telefone 2": p }); // iguais: só principal
      else if (i % 5 === 3) rows.push({ Empresa: `E${i}`, "Telefone 1": "lixo", "Telefone 2": "" }); // pulada
      else rows.push({ Empresa: `E${i}`, "Telefone 1": p, "Telefone 2": "" }); // só principal
    }
    const previa = summarizePhonePreview(rows, MAPA, null);
    const out = await importar(m, rows);
    const ls = await leads(m);
    expect(previa.total).toBe(40);
    expect(previa.onlyPrincipal + previa.withExtras).toBe(ls.length); // leads criados
    expect(previa.withExtras).toBe(ls.filter((l) => (l.dados.telefones_extras || []).length > 0).length);
    expect(previa.onlyPrincipal).toBe(ls.filter((l) => !(l.dados.telefones_extras || []).length).length);
    expect(previa.skipped).toBe(out.skippedNoPhoneCount);
    expect(previa.skipped).toBe((await m.db.query(`SELECT count(*)::int AS n FROM lead_import_items WHERE import_id = $1 AND NOT imported`, [out.importId])).rows[0].n);
    expect(previa).toEqual({ total: 40, onlyPrincipal: 24, withExtras: 8, skipped: 8 });
  }, SLOW);

  it("em lotes (arquivo grande) vale o mesmo: o telefone adicional segue no lead e o item registrado guarda os extras", async () => {
    const m = await mundo();
    const rows = Array.from({ length: 1_200 }, (_, i) => ({ Empresa: `L${i}`, "Telefone 1": `(34) 9${String(70000000 + i).padStart(8, "0")}`, "Telefone 2": i % 3 === 0 ? `(34) 9${String(71000000 + i).padStart(8, "0")}` : "" }));
    const aberta = await (await m.post("/api/leads/import-batches/open", { clientId: T, sourceName: "grande.xlsx", columnMapping: MAPA, totalRows: rows.length, sampleRows: rows.slice(0, 15) })).json();
    for (let s = 0; s < rows.length; s += 500) {
      const r = await m.post(`/api/leads/import-batches/${aberta.item.id}/batches`, { startIndex: s, rows: rows.slice(s, s + 500) });
      expect(r.ok).toBe(true);
    }
    const fechada = await (await m.post(`/api/leads/import-batches/${aberta.item.id}/close`, {})).json();
    expect(fechada.totals.total).toBe(1_200);
    expect((await leads(m))).toHaveLength(1_200);
    const comExtras = (await leads(m)).filter((l) => l.dados.telefones_extras?.length === 1);
    expect(comExtras).toHaveLength(400);
    const item = (await m.db.query(`SELECT normalized_data FROM lead_import_items WHERE import_id = $1 AND row_number = 2`, [aberta.item.id])).rows[0];
    expect(item.normalized_data.dados.telefones_extras).toHaveLength(1);
  }, SLOW);

  it("sem coluna de telefone adicional nada muda (a regra antiga de uma coluna)", async () => {
    const m = await mundo();
    const mapaSimples = [{ column: "Empresa", target: "nome" }, { column: "Telefone 1", target: "telefone" }];
    await importar(m, [{ Empresa: "Simples", "Telefone 1": "(34) 99810-0001", "Telefone 2": "(34) 99810-0002" }], { columnMapping: mapaSimples });
    const ls = await leads(m);
    expect(ls).toHaveLength(1);
    expect(ls[0].dados.telefones_extras).toBeUndefined();
  }, SLOW);

  it("mergeTelefonesExtras: união por telefone, sem perder 'ja_existe_como_lead'", () => {
    expect(mergeTelefonesExtras(null, undefined)).toBeNull();
    const r = mergeTelefonesExtras([{ telefone: "1", coluna: "A" }], [{ telefone: "1", coluna: "B", ja_existe_como_lead: "x" }, { telefone: "2", coluna: "B" }]);
    expect(r).toEqual([{ telefone: "1", coluna: "A", ja_existe_como_lead: "x" }, { telefone: "2", coluna: "B" }]);
  });

  it("normalizeImportedLead com adicionais: o telefone do item e os extras (a base do registro da importação)", () => {
    const n = normalizeImportedLead({ Empresa: "X", "Telefone 1": "", "Telefone 2": "(34) 99810-0002", "Telefone 3": "(34) 99810-0003" }, T, null, [...MAPA, { column: "Telefone 3", target: EXTRA_PHONE_TARGET }]);
    expect(n.telefone).toBe("5534998100002");
    expect(n.dados.telefones_extras).toEqual([{ telefone: "5534998100003", coluna: "Telefone 3", bruto: "(34) 99810-0003" }]);
    expect(n.dados.telefone_bruto).toBe("(34) 99810-0002");
  });
});
