// backend/src/test/bancoImportRegistration.test.js
//
// B e C da leva "a tela de leads só enxerga 2.000":
//  B) a importação feita pelo Banco de Dados passa a ser REGISTRADA no mesmo lugar da tela de Planilhas (lead_imports +
//     lead_import_items, pelo caminho em lotes): nome do arquivo, total de linhas, totais de telefone — a Campanhas lista a
//     planilha com os leads dela. Antes, import-csv gerava um UUID solto e não gravava nada em lead_imports.
//  C) arquivo grande entra em LOTES (≤ 500 linhas por requisição) e não por um corpo único: 20.000 linhas estouravam o limite
//     de 15 MiB do express.json. O id da ABERTURA é o que fica em dados.import_ids de cada lead (a exclusão em massa por
//     importação continua exata).
// Postgres real (pglite), rotas HTTP reais, serviço do produto.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { normalizeImportedLead, sanitizePhone } from "../services/leadImport.js";
import { resetLeadImportBatchStateForTest } from "../services/leadImportBatches.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const SLOW = 180_000;
const T = "tenant-a";
const OUTRO = "tenant-b";
const MIGRATION = readFileSync(resolve("supabase/migrations/20261005120000_add_batch_columns_to_lead_imports.sql"), "utf8");
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
const MAPEAMENTO = [{ column: "Nome", target: "nome" }, { column: "Telefone", target: "telefone" }];
/** Linha i: telefone válido e único; a cada 10ª sem telefone. */
const planilha = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ Nome: `Pessoa ${i}`, Telefone: i % 10 === 9 ? "" : `(34) 9${String(80000000 + i).padStart(8, "0")}`, ...extra }));

async function mundo({ migrada = true } = {}) {
  const db = await createPgliteDb(SCHEMA);
  if (migrada) await db.exec(MIGRATION);
  await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'A'), ('${OUTRO}', 'B')`);
  const estado = { falharInsertDeLeadsNaChamada: 0, chamadasDeInsertDeLeads: 0, ordem: [] };
  const pool = {
    query: async (sql, params) => {
      const texto = String(sql);
      if (/INSERT INTO public\.leads \(/.test(texto)) {
        estado.chamadasDeInsertDeLeads += 1;
        estado.ordem.push("leads");
        if (estado.falharInsertDeLeadsNaChamada && estado.chamadasDeInsertDeLeads === estado.falharInsertDeLeadsNaChamada) throw new Error("falha simulada ao gravar os leads do lote");
      }
      if (/INSERT INTO public\.lead_import_items/.test(texto)) estado.ordem.push("itens");
      return db.query(sql, params);
    },
  };
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
    resolveAuthorizedClientId: (_req, res, cid) => {
      if (cid && cid !== T) { sendError(res, 403, "FORBIDDEN", "Sem acesso a este cliente"); return null; }
      return cid || T;
    },
    sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
    sendError,
    normalizeString: (s) => (s ? String(s).trim() : ""),
    normalizeImportedLead,
    supabase: { from: () => { throw new Error("o fluxo do Banco não usa supabase para registrar a importação"); } },
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const baseUrl = `http://localhost:${server.address().port}`;
  const post = (path, body) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = (path) => fetch(`${baseUrl}${path}`);
  const close = async () => { await new Promise((r) => server.close(r)); await db.close(); };
  return { db, pool, estado, post, get, close };
}

const mundos = [];
afterAll(async () => { for (const m of mundos) await m.close(); });
beforeEach(() => {
  resetLeadImportBatchStateForTest();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
const novoMundo = async (opts) => { const m = await mundo(opts); mundos.push(m); return m; };

const abrirBanco = async (m, rows, extra = {}) =>
  (await m.post("/api/leads/import-batches/open", { clientId: T, sourceName: "clientes-2026.xlsx", defaultDdd: "34", columnMapping: MAPEAMENTO, totalRows: rows.length, sampleRows: rows.slice(0, 15), importTags: ["Feira 2026"], ...extra })).json();
async function enviarLotes(m, importId, rows, { de = 0 } = {}) {
  for (let start = de; start < rows.length; start += 500) {
    const res = await m.post(`/api/leads/import-batches/${importId}/batches`, { startIndex: start, rows: rows.slice(start, start + 500) });
    if (!res.ok) return res;
  }
  return null;
}
const contar = async (m, sql, params = []) => Number((await m.db.query(sql, params)).rows[0].n);

describe("B — a importação do Banco é registrada no mesmo lugar da tela de Planilhas", () => {
  it("em lotes: lead_imports com o NOME do arquivo, total de linhas e totais de telefone; itens gravados; leads criados com o id da abertura", async () => {
    const m = await novoMundo();
    const rows = planilha(1_200);
    const aberta = await abrirBanco(m, rows);
    const importId = aberta.item.id;
    expect(aberta.item.status).toBe("incomplete"); // só o fechamento a torna completa
    expect(aberta.item.source_name).toBe("clientes-2026.xlsx");
    expect(aberta.item.source_type).toBe("xlsx");
    expect(await enviarLotes(m, importId, rows)).toBeNull();
    const fechada = await (await m.post(`/api/leads/import-batches/${importId}/close`, {})).json();

    expect(fechada.item.status).toBe("completed");
    expect(fechada.item.source_name).toBe("clientes-2026.xlsx");
    expect(fechada.item.total_rows).toBe(1_200);
    expect(fechada.totals).toMatchObject({ total: 1_200, valid: 1_080, withoutPhone: 120, uniquePhones: 1_080 });
    // o registro está onde a tela de Planilhas/Campanhas lê
    const lista = await (await m.get(`/api/lead-imports?clientId=${T}`)).json();
    expect(lista.items.map((i) => [i.id, i.source_name, i.status, Number(i.total_rows)])).toContainEqual([importId, "clientes-2026.xlsx", "completed", 1_200]);
    expect(await contar(m, "SELECT count(*)::int AS n FROM lead_import_items WHERE import_id = $1", [importId])).toBe(1_200);
    // e os LEADS existem, com o id da abertura em dados.import_ids e a tag da importação
    expect(await contar(m, "SELECT count(*)::int AS n FROM leads WHERE client_id = $1", [T])).toBe(1_080);
    expect(await contar(m, `SELECT count(*)::int AS n FROM leads WHERE dados @> jsonb_build_object('import_ids', jsonb_build_array($1::text))`, [importId])).toBe(1_080);
    expect(await contar(m, "SELECT count(*)::int AS n FROM leads WHERE 'Feira 2026' = ANY(tags)")).toBe(1_080);
  }, SLOW);

  it("POST único (texto colado da IA): registra com nome DESCRITIVO (nunca inventa arquivo) e o id da abertura nos leads", async () => {
    const m = await novoMundo();
    const rows = [{ nome: "Ana", telefone: "34999990001" }, { nome: "Bia", telefone: "34999990002" }, { nome: "Sem fone", telefone: "" }];
    const res = await m.post("/api/leads/import-csv", { clientId: T, rows, importTags: ["IA Direct/Chat"], defaultDdd: "34" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.importedCount).toBe(2);
    expect(body.skippedNoPhoneCount).toBe(1);
    expect(body.totalRows).toBe(3);
    const reg = (await m.db.query("SELECT * FROM lead_imports WHERE id = $1", [body.importId])).rows[0];
    expect(reg.source_name).toMatch(/^Texto colado \(IA\) — \d{2}\/\d{2}\/\d{4}/);
    expect(reg.source_name).not.toMatch(/\.(xlsx|csv|xls)$/);
    expect(reg.status).toBe("completed");
    expect(reg.total_rows).toBe(3);
    expect(await contar(m, "SELECT count(*)::int AS n FROM lead_import_items WHERE import_id = $1", [body.importId])).toBe(3);
    expect(await contar(m, `SELECT count(*)::int AS n FROM leads WHERE dados @> jsonb_build_object('import_ids', jsonb_build_array($1::text))`, [body.importId])).toBe(2);
  }, SLOW);

  it("POST único com nome de arquivo: o nome vai para o registro", async () => {
    const m = await novoMundo();
    const body = await (await m.post("/api/leads/import-csv", { clientId: T, rows: [{ nome: "Ana", telefone: "34999990001" }], sourceName: "vendas.csv", defaultDdd: "34" })).json();
    const reg = (await m.db.query("SELECT source_name, source_type FROM lead_imports WHERE id = $1", [body.importId])).rows[0];
    expect(reg).toEqual({ source_name: "vendas.csv", source_type: "csv" });
  }, SLOW);

  it("vendas fechadas: leads como compradores, tag e parâmetros guardados na abertura", async () => {
    const m = await novoMundo();
    const body = await (await m.post("/api/leads/import-csv", { clientId: T, rows: [{ nome: "Cli", telefone: "34999990001", valor: "1500" }], asClosedSales: true, defaultDdd: "34" })).json();
    const lead = (await m.db.query("SELECT stage, tags, potential_contract_value FROM (SELECT stage, tags, NULL AS potential_contract_value FROM leads) x")).rows[0];
    expect(lead.stage).toBe("buyer");
    expect(lead.tags).toContain("Venda Fechada");
    const reg = (await m.db.query("SELECT source_name, import_params FROM lead_imports WHERE id = $1", [body.importId])).rows[0];
    expect(reg.source_name).toMatch(/^Vendas fechadas — /);
    expect(reg.import_params).toMatchObject({ mode: "banco", asClosedSales: true });
  }, SLOW);

  it("mapeamento sem coluna de telefone é recusado, nos dois caminhos, sem abrir importação", async () => {
    const m = await novoMundo();
    const ruim = [{ column: "Nome", target: "nome" }];
    expect((await m.post("/api/leads/import-csv", { clientId: T, rows: [{ Nome: "x" }], columnMapping: ruim })).status).toBe(400);
    expect((await m.post("/api/leads/import-batches/open", { clientId: T, columnMapping: ruim, totalRows: 1 })).status).toBe(400);
    expect(await contar(m, "SELECT count(*)::int AS n FROM lead_imports")).toBe(0);
  }, SLOW);
});

describe("C — arquivo grande entra em lotes (não por um corpo único de 15 MiB)", () => {
  it("20.000 linhas / mais de 15 MiB: o POST único é recusado (413), em lotes entra tudo", async () => {
    const m = await novoMundo();
    const rows = planilha(20_000, { Observacao: "x".repeat(800) });
    expect(JSON.stringify({ clientId: T, rows }).length).toBeGreaterThan(15 * 1024 * 1024);
    const unico = await m.post("/api/leads/import-csv", { clientId: T, rows, columnMapping: MAPEAMENTO });
    expect(unico.status).toBe(413); // o defeito: o limite do corpo, não do banco
    expect(await contar(m, "SELECT count(*)::int AS n FROM lead_imports")).toBe(0);

    const aberta = await abrirBanco(m, rows);
    expect(await enviarLotes(m, aberta.item.id, rows)).toBeNull();
    const fechada = await (await m.post(`/api/leads/import-batches/${aberta.item.id}/close`, {})).json();
    expect(fechada.item.total_rows).toBe(20_000);
    expect(fechada.totals.uniquePhones).toBe(18_000);
    expect(await contar(m, "SELECT count(*)::int AS n FROM leads")).toBe(18_000);
    expect(await contar(m, `SELECT count(*)::int AS n FROM leads WHERE dados @> jsonb_build_object('import_ids', jsonb_build_array($1::text))`, [aberta.item.id])).toBe(18_000);
  }, 400_000);

  it("a exclusão em massa por importação acha os leads pelo id da abertura (mesmo critério do leadMassDelete)", async () => {
    const m = await novoMundo();
    const a = planilha(600);
    const b = Array.from({ length: 5 }, (_, i) => ({ Nome: `Outra ${i}`, Telefone: `(34) 98${String(7000000 + i).padStart(7, "0")}` }));
    const ia = (await abrirBanco(m, a)).item.id;
    await enviarLotes(m, ia, a);
    await m.post(`/api/leads/import-batches/${ia}/close`, {});
    const ib = (await abrirBanco(m, b, { sourceName: "outra.xlsx" })).item.id;
    await enviarLotes(m, ib, b);
    await m.post(`/api/leads/import-batches/${ib}/close`, {});
    // o critério exato da exclusão por importação (services/leadMassDelete.js)
    const crit = `dados @> jsonb_build_object('import_ids', jsonb_build_array($1::text))`;
    expect(await contar(m, `SELECT count(*)::int AS n FROM leads WHERE ${crit}`, [ib])).toBe(5);
    expect(await contar(m, `SELECT count(*)::int AS n FROM leads WHERE ${crit}`, [ia])).toBe(540);
  }, SLOW);

  it("reenviar um lote não duplica leads, itens nem import_ids", async () => {
    const m = await novoMundo();
    const rows = planilha(1_000);
    const { item } = await abrirBanco(m, rows);
    await enviarLotes(m, item.id, rows);
    await m.post(`/api/leads/import-batches/${item.id}/batches`, { startIndex: 0, rows: rows.slice(0, 500) }); // reenvio do primeiro lote
    expect(await contar(m, "SELECT count(*)::int AS n FROM lead_import_items WHERE import_id = $1", [item.id])).toBe(1_000);
    expect(await contar(m, "SELECT count(*)::int AS n FROM leads")).toBe(900);
    const ids = (await m.db.query("SELECT dados->'import_ids' AS ids FROM leads LIMIT 50")).rows;
    for (const r of ids) expect(r.ids).toEqual([item.id]);
    const fechada = await (await m.post(`/api/leads/import-batches/${item.id}/close`, {})).json();
    expect(fechada.totals.total).toBe(1_000);
  }, SLOW);

  it("queda no meio: o lote que falhou NÃO avança o ponto de retomada; reenviar completa sem perder nem duplicar", async () => {
    const m = await novoMundo();
    const rows = planilha(1_200);
    const { item } = await abrirBanco(m, rows);
    m.estado.falharInsertDeLeadsNaChamada = 2; // o INSERT de leads do 2º lote cai
    const falha = await enviarLotes(m, item.id, rows);
    expect(falha.status).toBe(500);
    const progresso = await (await m.get(`/api/leads/import-batches/${item.id}/progress`)).json();
    expect(progresso.receivedOffset).toBe(500); // só o 1º lote foi registrado: o 2º caiu ao gravar os leads, ANTES do registro
    expect(progresso.status).toBe("incomplete");
    expect(await contar(m, "SELECT count(*)::int AS n FROM lead_import_items WHERE import_id = $1", [item.id])).toBe(500);
    // fechar agora é recusado (faltam linhas), e retomar do ponto do servidor completa
    expect((await m.post(`/api/leads/import-batches/${item.id}/close`, {})).status).toBe(409);
    expect(await enviarLotes(m, item.id, rows, { de: progresso.receivedOffset })).toBeNull();
    const fechada = await (await m.post(`/api/leads/import-batches/${item.id}/close`, {})).json();
    expect(fechada.item.status).toBe("completed");
    expect(fechada.totals.total).toBe(1_200);
    expect(await contar(m, "SELECT count(*)::int AS n FROM leads")).toBe(1_080);
  }, SLOW);

  it("cada lote grava os LEADS antes de registrar o lote (se cair entre os dois, o ponto não avançou e o reenvio conserta)", async () => {
    const m = await novoMundo();
    const rows = planilha(500);
    const { item } = await abrirBanco(m, rows);
    m.estado.ordem.length = 0;
    await enviarLotes(m, item.id, rows);
    expect(m.estado.ordem.indexOf("leads")).toBeGreaterThanOrEqual(0);
    expect(m.estado.ordem.indexOf("leads")).toBeLessThan(m.estado.ordem.indexOf("itens"));
  }, SLOW);

  it("as rotas da tela de Planilhas recusam uma importação aberta pelo Banco (não criariam os leads) e vice-versa", async () => {
    const m = await novoMundo();
    const rows = planilha(10);
    const { item } = await abrirBanco(m, rows);
    const naPlanilha = await m.post(`/api/lead-imports/${item.id}/batches`, { startIndex: 0, rows });
    expect(naPlanilha.status).toBe(409);
    expect((await naPlanilha.json()).error.code).toBe("IMPORT_MODE_MISMATCH");
    expect((await m.post(`/api/lead-imports/${item.id}/close`, {})).status).toBe(409);
    // importação de planilha comum não é aceita pela rota do Banco
    const planilhaComum = await (await m.post("/api/lead-imports/open", { clientId: T, sourceName: "plan.xlsx", sourceType: "xlsx", defaultDdd: "34", columnMapping: MAPEAMENTO, totalRows: 10, sampleRows: rows })).json();
    const noBanco = await m.post(`/api/leads/import-batches/${planilhaComum.item.id}/batches`, { startIndex: 0, rows });
    expect(noBanco.status).toBe(409);
    expect(await contar(m, "SELECT count(*)::int AS n FROM leads")).toBe(0);
  }, SLOW);

  it("lote com mais de 500 linhas e importação de outro cliente são recusados", async () => {
    const m = await novoMundo();
    const rows = planilha(600);
    const { item } = await abrirBanco(m, rows);
    const grande = await m.post(`/api/leads/import-batches/${item.id}/batches`, { startIndex: 0, rows });
    expect(grande.status).toBe(413);
    expect(await contar(m, "SELECT count(*)::int AS n FROM leads")).toBe(0);
    // importação do OUTRO cliente: o usuário do teste só enxerga o tenant-a
    const outro = (await m.db.query("INSERT INTO lead_imports (client_id, source_name) VALUES ($1, 'x') RETURNING id", [OUTRO])).rows[0].id;
    expect((await m.post(`/api/leads/import-batches/${outro}/batches`, { startIndex: 0, rows: rows.slice(0, 5) })).status).toBe(403);
  }, SLOW);

  it("funciona com o schema ANTIGO (sem as colunas de lote): as colunas são garantidas em tempo de execução", async () => {
    const m = await novoMundo({ migrada: false });
    const rows = planilha(100);
    const aberta = await abrirBanco(m, rows);
    expect(aberta.item.status).toBe("incomplete");
    expect(await enviarLotes(m, aberta.item.id, rows)).toBeNull();
    const fechada = await (await m.post(`/api/leads/import-batches/${aberta.item.id}/close`, {})).json();
    expect(fechada.item.status).toBe("completed");
    expect(await contar(m, "SELECT count(*)::int AS n FROM leads")).toBe(90);
  }, SLOW);
});
