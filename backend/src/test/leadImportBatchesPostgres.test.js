// backend/src/test/leadImportBatchesPostgres.test.js
//
// Importação de planilha em LOTES, contra Postgres REAL (pglite), com o serviço do produto (importado, não copiado).
//
// O teto de 5.000 linhas escondia o teto de PARÂMETROS do Postgres: lead_import_items grava 9 colunas por linha e
// 65.535 ÷ 9 = 7.281 linhas num único INSERT. Aqui a prova direta do defeito (o INSERT único estoura) e da correção
// (20.000 linhas entram por inteiro, em lotes), mais idempotência, falha no meio com retomada, totais iguais aos de hoje
// e o comportamento com o schema antigo (DIRETRIZES-IA.md §12).
// Limite do pglite (helpers/pgliteDb.js): uma conexão só — a exclusão mútua por advisory lock é conferida pela SQL emitida
// (e por mutação), não por concorrência real.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  IMPORT_BATCH_SIZE,
  ImportError,
  appendLeadImportBatch,
  classifyImportedPhone,
  closeLeadImport,
  detectImportColumns,
  ensureLeadImportBatchColumns,
  getLeadImportProgress,
  insertImportItems,
  isRowHeader,
  listLeadImports,
  openLeadImport,
  parseImportRows,
  resetLeadImportBatchStateForTest,
} from "../services/leadImportBatches.js";
import { sanitizePhone } from "../services/leadImport.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const SLOW = 120_000;
// o servidor só guarda e compara a impressão digital que a TELA calcula (frontend/src/lib/leadImports/batchedImport.ts); aqui um equivalente
const fingerprintRows = (rows) => createHash("sha256").update(JSON.stringify([rows.length, rows[0] ?? null, rows[rows.length - 1] ?? null])).digest("hex").slice(0, 32);
const T = "tenant-a";
const OUTRO = "tenant-b";
const MIGRATION = readFileSync(resolve("supabase/migrations/20261005120000_add_batch_columns_to_lead_imports.sql"), "utf8");
const CASOS_TELEFONE = JSON.parse(readFileSync(resolve("../shared/importPhoneAuditCases.json"), "utf8")).cases;

// schema como em produção (tipos reais), ANTES da migration desta mudança
const SCHEMA_ANTIGO = `
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE lead_imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    source_name text NOT NULL, source_type text NOT NULL DEFAULT 'spreadsheet', total_rows integer NOT NULL DEFAULT 0,
    imported_rows integer NOT NULL DEFAULT 0, skipped_rows integer NOT NULL DEFAULT 0, uploaded_by_uid text, uploaded_by_email text,
    created_at timestamptz NOT NULL DEFAULT now(), column_mapping jsonb);
  CREATE TABLE lead_import_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_id uuid NOT NULL REFERENCES lead_imports(id) ON DELETE CASCADE,
    client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE, row_number integer NOT NULL, telefone text,
    lead_id uuid REFERENCES leads(id) ON DELETE SET NULL, imported boolean NOT NULL DEFAULT false, skip_reason text,
    raw_data jsonb NOT NULL DEFAULT '{}'::jsonb, normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
  CREATE INDEX idx_lead_import_items_import_id ON lead_import_items (import_id);
  CREATE TABLE lead_custom_fields (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE, key text NOT NULL,
    label text NOT NULL, type text NOT NULL DEFAULT 'text', import_id uuid REFERENCES lead_imports(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT uq_lead_custom_fields_client_key UNIQUE (client_id, key));
`;

const openDbs = [];
afterAll(async () => {
  for (const db of openDbs) await db.close();
});
beforeEach(() => {
  resetLeadImportBatchStateForTest();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** `migrada`: schema já com as colunas novas. `ddlBloqueado`: o app não consegue alterar tabela. */
async function mundo({ migrada = true, ddlBloqueado = false, falharInsertDeItens = 0, falharUpdateDoPonto = 0, comConnect = false } = {}) {
  const db = await createPgliteDb("SET TimeZone = 'UTC';\n" + SCHEMA_ANTIGO);
  openDbs.push(db);
  if (migrada) await db.exec(MIGRATION);
  await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'A'), ('${OUTRO}', 'B')`);
  const estado = { insertsDeItens: 0, falhasRestantes: falharInsertDeItens, falhasNoUpdate: falharUpdateDoPonto, sqls: [], conexoesAbertas: 0, conexoesDevolvidas: 0 };
  const pool = {
    query: async (sql, params) => {
      const texto = String(sql);
      estado.sqls.push(texto);
      if (ddlBloqueado && /^\s*(ALTER|CREATE|DROP)\b/i.test(texto)) throw Object.assign(new Error("permission denied for table lead_imports (DDL bloqueado no teste)"), { code: "42501" });
      if (/INSERT INTO public\.lead_import_items/.test(texto)) {
        estado.insertsDeItens += 1;
        if (estado.falhasRestantes > 0) {
          estado.falhasRestantes -= 1;
          throw new Error("connection terminated unexpectedly (falha simulada no INSERT dos itens)");
        }
      }
      if (/UPDATE public\.lead_imports SET received_offset/.test(texto) && estado.falhasNoUpdate > 0) {
        estado.falhasNoUpdate -= 1; // cai DEPOIS de os itens do lote já terem sido gravados dentro da transação
        throw new Error("connection terminated unexpectedly (falha simulada ao gravar o ponto de retomada)");
      }
      return db.query(sql, params);
    },
  };
  // pool de PRODUÇÃO (pg.Pool): withTransaction pega uma conexão com connect() e a DEVOLVE com release(). Aqui a mesma conexão única do
  // pglite, com a contabilidade de quem pegou e quem devolveu (vazar conexão derrubaria o servidor depois de algumas importações).
  if (comConnect) {
    pool.connect = async () => {
      estado.conexoesAbertas += 1;
      return { query: (sql, params) => pool.query(sql, params), release: () => { estado.conexoesDevolvidas += 1; } };
    };
  }
  return { db, pool, estado };
}

// ── planilhas de teste ──────────────────────────────────────────────────────────────────────────────────────────────
const MAPEAMENTO = [
  { column: "Nome", target: "nome" },
  { column: "Telefone", target: "telefone" },
  { column: "Cidade", target: "ignore" },
];
/** Linha i: telefone válido e único; a cada 10ª sem telefone; a cada 7ª só 9 dígitos (precisa do DDD padrão); a cada 25ª repete um telefone. */
function planilha(n) {
  return Array.from({ length: n }, (_, i) => {
    let telefone = `(34) 9${String(80000000 + i).padStart(8, "0")}`;
    if (i % 10 === 9) telefone = "";
    else if (i % 7 === 6) telefone = `9${String(70000000 + i).padStart(8, "0")}`;
    else if (i % 25 === 24) telefone = `(34) 9${String(80000000 + (i - 24)).padStart(8, "0")}`;
    return { Nome: `Pessoa ${i}`, Telefone: telefone, Cidade: "Uberaba" };
  });
}

async function importarTudo(pool, rows, { clientId = T, mapping = MAPEAMENTO, defaultDdd = "34", tamanhoDoLote = IMPORT_BATCH_SIZE, aoEnviar = null, fechar = true } = {}) {
  const { item, warnings } = await openLeadImport(pool, {
    clientId, sourceName: "planilha.xlsx", sourceType: "xlsx", defaultDdd, columnMapping: mapping ? { columns: Object.keys(rows[0]), mapping } : null,
    totalRows: rows.length, sampleRows: rows.slice(0, 15), fingerprint: fingerprintRows(rows), uploadedByUid: "u1", uploadedByEmail: "u@x",
  });
  const respostas = [];
  for (let start = 0; start < rows.length; start += tamanhoDoLote) {
    if (aoEnviar && (await aoEnviar(start / tamanhoDoLote, start)) === "parar") return { item, warnings, respostas, parou: start };
    respostas.push(await appendLeadImportBatch(pool, { importId: item.id, clientId, startIndex: start, rows: rows.slice(start, start + tamanhoDoLote), fingerprint: fingerprintRows(rows) }));
  }
  const fechamento = fechar ? await closeLeadImport(pool, { importId: item.id, clientId }) : null;
  return { item, warnings, respostas, fechamento };
}
const contar = async (db, importId) => (await db.query("SELECT count(*)::int AS n, count(DISTINCT row_number)::int AS distintas FROM lead_import_items WHERE import_id = $1", [importId])).rows[0];

// o que a planilha DEVERIA dar, contado de forma independente (telefones únicos válidos etc.)
function esperado(rows, ddd = "34") {
  const telefones = rows.map((r) => sanitizePhone(r.Telefone, ddd));
  const validos = telefones.filter(Boolean);
  return { total: rows.length, validos: validos.length, semTelefone: telefones.length - validos.length, unicos: new Set(validos).size };
}

describe("[TESTE OBRIGATÓRIO] 20.000 linhas importam por inteiro, e a contagem no banco bate com o arquivo", () => {
  it("abrir → 40 lotes de 500 → fechar: todos os itens no banco, nenhum duplicado, totais certos", async () => {
    const { db, pool } = await mundo();
    const rows = planilha(20_000);
    const ex = esperado(rows);

    const r = await importarTudo(pool, rows);

    expect(r.respostas).toHaveLength(40);
    const c = await contar(db, r.item.id);
    expect(c).toEqual({ n: 20_000, distintas: 20_000 }); // a contagem do banco bate com o arquivo, sem duplicata
    expect(r.fechamento.item.status).toBe("completed");
    expect(r.fechamento.item.total_rows).toBe(20_000);
    expect(r.fechamento.item.imported_rows).toBe(ex.unicos); // telefones únicos válidos, como sempre foi
    expect(r.fechamento.item.skipped_rows).toBe(20_000 - ex.unicos);
    expect(r.fechamento.totals).toMatchObject({ total: 20_000, valid: ex.validos, withoutPhone: ex.semTelefone, uniquePhones: ex.unicos });
    expect(r.fechamento.totals.intact + r.fechamento.totals.completedWithDdd).toBe(ex.validos);
    const imp = (await db.query("SELECT status, expected_rows, received_offset FROM lead_imports WHERE id = $1", [r.item.id])).rows[0];
    expect(imp).toEqual({ status: "completed", expected_rows: 20_000, received_offset: 20_000 });
  }, SLOW);
});

describe("[TESTE OBRIGATÓRIO] acima de 7.281 linhas não estoura o teto de parâmetros (a prova do defeito que o limite escondia)", () => {
  const itensFalsos = (n) => Array.from({ length: n }, (_, i) => ({ rowNumber: i + 2, rawData: { Nome: `P${i}` }, normalized: { telefone: `5534998${String(i).padStart(6, "0")}`, nome: `P${i}` }, imported: true, skipReason: null }));
  const IMPORT_ID = "11111111-1111-4111-8111-111111111111";

  async function importacaoVazia(db) {
    await db.exec(`INSERT INTO lead_imports (id, client_id, source_name) VALUES ('${IMPORT_ID}', '${T}', 'x')`);
  }

  it("o INSERT ÚNICO de 7.282 linhas × 9 colunas estoura (era o que o `if > 5000` escondia)", async () => {
    const { db } = await mundo();
    await importacaoVazia(db);
    const n = 7_282; // 7.282 × 9 = 65.538 > 65.535
    const params = [];
    const tuplas = Array.from({ length: n }, (_, i) => {
      const o = i * 9;
      params.push(IMPORT_ID, T, i + 2, "5534998000000", null, true, null, "{}", "{}");
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8}::jsonb, $${o + 9}::jsonb)`;
    });

    await expect(
      db.query(`INSERT INTO lead_import_items (import_id, client_id, row_number, telefone, lead_id, imported, skip_reason, raw_data, normalized_data) VALUES ${tuplas.join(", ")}`, params)
    ).rejects.toThrow(/parameter|bind|65535|too many/i);
    // e 7.281 ainda cabia: o teto é exatamente 65.535 ÷ 9
    expect(Math.floor(65_535 / 9)).toBe(7_281);
  }, SLOW);

  it("insertImportItems grava 7.282, 8.000 e 20.000 linhas de uma vez, em fatias de 500", async () => {
    for (const n of [7_282, 8_000, 20_000]) {
      const { db } = await mundo();
      await importacaoVazia(db);

      const gravadas = await insertImportItems(db, { importId: IMPORT_ID, clientId: T, items: itensFalsos(n) });

      expect(gravadas).toHaveLength(n);
      expect((await contar(db, IMPORT_ID)).n).toBe(n);
    }
  }, SLOW);

  it("cada INSERT leva no máximo 500 linhas (4.500 parâmetros), qualquer que seja o tamanho do lote recebido", async () => {
    const { db, pool } = await mundo();
    await importacaoVazia(db);
    const espia = vi.spyOn(pool, "query");

    await insertImportItems(pool, { importId: IMPORT_ID, clientId: T, items: itensFalsos(1_700) });

    const inserts = espia.mock.calls.filter((c) => /INSERT INTO public\.lead_import_items/.test(String(c[0])));
    expect(inserts.map((c) => c[1].length / 9)).toEqual([500, 500, 500, 200]);
    for (const c of inserts) expect(c[1].length).toBeLessThanOrEqual(IMPORT_BATCH_SIZE * 9);
  }, SLOW);
});

describe("[TESTE OBRIGATÓRIO] lote reenviado não duplica item", () => {
  it("o mesmo lote duas vezes: nada novo, nada contado em dobro, e o fechamento dá o mesmo resultado de um envio limpo", async () => {
    const rows = planilha(2_000);
    const limpo = await mundo();
    const base = await importarTudo(limpo.pool, rows);

    const { db, pool } = await mundo();
    const { item } = await openLeadImport(pool, { clientId: T, sourceName: "p", defaultDdd: "34", columnMapping: { mapping: MAPEAMENTO }, totalRows: rows.length });
    const enviar = (start) => appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: start, rows: rows.slice(start, start + 500) });
    const primeiro = await enviar(0);
    const reenvio = await enviar(0); // a conexão caiu depois de gravar, antes da resposta: a tela reenvia
    await enviar(500);
    await enviar(500);
    await enviar(0);
    await enviar(1000);
    await enviar(1500);
    const fechamento = await closeLeadImport(pool, { importId: item.id, clientId: T });

    expect(primeiro).toMatchObject({ accepted: 500, stored: 500, duplicatesIgnored: 0 });
    expect(reenvio).toMatchObject({ accepted: 500, stored: 0, duplicatesIgnored: 500 });
    expect(await contar(db, item.id)).toEqual({ n: 2_000, distintas: 2_000 });
    expect(fechamento.totals).toEqual(base.fechamento.totals); // os totais não contaram o reenvio duas vezes
    expect(fechamento.item.imported_rows).toBe(base.fechamento.item.imported_rows);
  }, SLOW);

  it("lote que SOBREPÕE o anterior grava só as linhas que faltavam", async () => {
    const rows = planilha(1_000);
    const { db, pool } = await mundo();
    const { item } = await openLeadImport(pool, { clientId: T, sourceName: "p", defaultDdd: "34", columnMapping: { mapping: MAPEAMENTO }, totalRows: rows.length });
    await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 0, rows: rows.slice(0, 300) });

    const r = await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 200, rows: rows.slice(200, 500) });

    expect(r).toMatchObject({ stored: 200, duplicatesIgnored: 100, receivedOffset: 500 });
    expect((await contar(db, item.id)).n).toBe(500);
  }, SLOW);

  it("a exclusão mútua por importação é pedida ao banco em TODO lote (advisory lock)", async () => {
    const rows = planilha(10);
    const { pool, estado } = await mundo();
    const { item } = await openLeadImport(pool, { clientId: T, sourceName: "p", defaultDdd: "34", columnMapping: { mapping: MAPEAMENTO }, totalRows: 10 });

    await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 0, rows });

    expect(estado.sqls.some((s) => /pg_advisory_xact_lock/.test(s))).toBe(true);
  }, SLOW);
});

describe("[TESTE OBRIGATÓRIO] falha no meio: a planilha fica INCOMPLETA, com o número certo, e a retomada completa sem duplicar", () => {
  it("a conexão cai no lote 15 de 40: 7.000 linhas entram, faltam 13.000, nada parece completo", async () => {
    const { db, pool } = await mundo();
    const rows = planilha(20_000);

    const r = await importarTudo(pool, rows, { aoEnviar: (indice) => (indice === 14 ? "parar" : undefined) }); // o lote 15 (índice 14) nunca sai

    expect(r.parou).toBe(7_000);
    const progresso = await getLeadImportProgress(pool, { importId: r.item.id, clientId: T });
    expect(progresso).toMatchObject({ status: "incomplete", expectedRows: 20_000, receivedOffset: 7_000, missingRows: 13_000, storedItems: 7_000 });
    expect(await contar(db, r.item.id)).toEqual({ n: 7_000, distintas: 7_000 });
    // fechar agora é recusado, com o número do que falta
    const tentativa = await closeLeadImport(pool, { importId: r.item.id, clientId: T }).catch((e) => e);
    expect(tentativa).toBeInstanceOf(ImportError);
    expect(tentativa).toMatchObject({ status: 409, code: "IMPORT_INCOMPLETE", details: { receivedOffset: 7_000, expectedRows: 20_000, missingRows: 13_000 } });
    // e a lista de planilhas mostra INCOMPLETA, com o progresso — nunca 'completed'
    const lista = await listLeadImports(pool, T);
    expect(lista.find((i) => i.id === r.item.id)).toMatchObject({ status: "incomplete", expected_rows: 20_000, received_offset: 7_000 });
  }, SLOW);

  it("retomar de onde parou completa a planilha: 20.000 itens, nenhum duplicado, totais iguais aos de um envio sem falha", async () => {
    const rows = planilha(20_000);
    const limpo = await mundo();
    const base = await importarTudo(limpo.pool, rows);

    const { db, pool } = await mundo();
    const parcial = await importarTudo(pool, rows, { aoEnviar: (indice) => (indice === 14 ? "parar" : undefined) });
    const { receivedOffset } = await getLeadImportProgress(pool, { importId: parcial.item.id, clientId: T });
    for (let start = receivedOffset; start < rows.length; start += 500) {
      await appendLeadImportBatch(pool, { importId: parcial.item.id, clientId: T, startIndex: start, rows: rows.slice(start, start + 500), fingerprint: fingerprintRows(rows) });
    }
    const fechamento = await closeLeadImport(pool, { importId: parcial.item.id, clientId: T });

    expect(await contar(db, parcial.item.id)).toEqual({ n: 20_000, distintas: 20_000 });
    expect(fechamento.item.status).toBe("completed");
    expect(fechamento.totals).toEqual(base.fechamento.totals);
    expect(fechamento.item.imported_rows).toBe(base.fechamento.item.imported_rows);
  }, SLOW);

  for (const [rotulo, comConnect] of [["pool simples", false], ["pool de produção com connect/release", true]]) {
  it(`falha DENTRO de um lote desfaz o lote inteiro (nada pela metade) e o reenvio entra sem duplicar [${rotulo}]`, async () => {
    const rows = planilha(1_500);
    const { db, pool, estado } = await mundo({ comConnect });
    const { item } = await openLeadImport(pool, { clientId: T, sourceName: "p", defaultDdd: "34", columnMapping: { mapping: MAPEAMENTO }, totalRows: rows.length });
    await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 0, rows: rows.slice(0, 500) });
    estado.falhasRestantes = 1;

    await expect(appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 500, rows: rows.slice(500, 1000) })).rejects.toThrow(/connection terminated/);

    const depoisDaFalha = await getLeadImportProgress(pool, { importId: item.id, clientId: T });
    expect(depoisDaFalha).toMatchObject({ status: "incomplete", receivedOffset: 500, storedItems: 500 }); // o lote que falhou não deixou rastro
    await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 500, rows: rows.slice(500, 1000) });
    await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 1000, rows: rows.slice(1000, 1500) });
    const fechamento = await closeLeadImport(pool, { importId: item.id, clientId: T });
    expect(await contar(db, item.id)).toEqual({ n: 1_500, distintas: 1_500 });
    expect(fechamento.totals.total).toBe(1_500);
  }, SLOW);
  }

  for (const [rotulo, comConnect] of [["pool simples", false], ["pool de produção com connect/release", true]]) {
  it(`[TESTE OBRIGATÓRIO] falha DEPOIS de gravar os itens do lote (ao gravar o ponto): os itens do lote saem junto — nunca itens sem ponto [${rotulo}]`, async () => {
    const rows = planilha(1_000);
    const { db, pool, estado } = await mundo({ comConnect });
    const { item } = await openLeadImport(pool, { clientId: T, sourceName: "p", defaultDdd: "34", columnMapping: { mapping: MAPEAMENTO }, totalRows: rows.length });
    await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 0, rows: rows.slice(0, 500) });
    estado.falhasNoUpdate = 1;

    await expect(appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 500, rows: rows.slice(500, 1000) })).rejects.toThrow(/ponto de retomada/);

    // os 500 itens do lote que falhou JÁ tinham sido inseridos dentro da transação: o rollback tem que levá-los
    expect(await getLeadImportProgress(pool, { importId: item.id, clientId: T })).toMatchObject({ receivedOffset: 500, storedItems: 500 });
    expect((await contar(db, item.id)).n).toBe(500);
    await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 500, rows: rows.slice(500, 1000) });
    expect(await contar(db, item.id)).toEqual({ n: 1_000, distintas: 1_000 });
    expect((await closeLeadImport(pool, { importId: item.id, clientId: T })).totals.total).toBe(1_000);
    // toda conexão pega foi devolvida (também a da transação que falhou)
    expect(estado.conexoesDevolvidas).toBe(estado.conexoesAbertas);
    if (comConnect) expect(estado.conexoesAbertas).toBeGreaterThan(0);
  }, SLOW);
  }

  it("fechar de novo uma importação já concluída devolve os mesmos totais (idempotente)", async () => {
    const { pool } = await mundo();
    const r = await importarTudo(pool, planilha(600));

    const outra = await closeLeadImport(pool, { importId: r.item.id, clientId: T });

    expect(outra.alreadyCompleted).toBe(true);
    expect(outra.totals).toEqual(r.fechamento.totals);
  }, SLOW);

  it("retomar com OUTRO arquivo é recusado (impressão digital) e lote em importação concluída é recusado", async () => {
    const rows = planilha(600);
    const { pool } = await mundo();
    const { item } = await openLeadImport(pool, { clientId: T, sourceName: "p", defaultDdd: "34", columnMapping: { mapping: MAPEAMENTO }, totalRows: rows.length, fingerprint: fingerprintRows(rows) });

    const outroArquivo = await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 0, rows: rows.slice(0, 500), fingerprint: "arquivo-diferente" }).catch((e) => e);
    expect(outroArquivo).toMatchObject({ status: 409, code: "IMPORT_FILE_MISMATCH" });

    await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 0, rows: rows.slice(0, 500), fingerprint: fingerprintRows(rows) });
    await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 500, rows: rows.slice(500), fingerprint: fingerprintRows(rows) });
    await closeLeadImport(pool, { importId: item.id, clientId: T });
    const tarde = await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 0, rows: rows.slice(0, 10) }).catch((e) => e);
    expect(tarde).toMatchObject({ status: 409, code: "IMPORT_ALREADY_COMPLETED" });
  }, SLOW);

  it("lote de OUTRO tenant não enxerga a importação", async () => {
    const rows = planilha(10);
    const { pool } = await mundo();
    const { item } = await openLeadImport(pool, { clientId: T, sourceName: "p", defaultDdd: "34", columnMapping: { mapping: MAPEAMENTO }, totalRows: 10 });

    const r = await appendLeadImportBatch(pool, { importId: item.id, clientId: OUTRO, startIndex: 0, rows }).catch((e) => e);

    expect(r).toMatchObject({ status: 404, code: "IMPORT_NOT_FOUND" });
  }, SLOW);
});

describe("teto por requisição: o tamanho do lote, com mensagem clara", () => {
  it("501 linhas → 413 BATCH_TOO_LARGE dizendo o limite; 500 passam; zero linhas e passar do total esperado → 400", async () => {
    const rows = planilha(501);
    const { pool, db } = await mundo();
    const { item } = await openLeadImport(pool, { clientId: T, sourceName: "p", defaultDdd: "34", columnMapping: { mapping: MAPEAMENTO }, totalRows: 501 });

    const grande = await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 0, rows }).catch((e) => e);
    expect(grande).toMatchObject({ status: 413, code: "BATCH_TOO_LARGE" });
    expect(grande.message).toContain("500");
    expect(grande.message).toContain("501");
    expect((await contar(db, item.id)).n).toBe(0); // nada entrou

    expect(await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 0, rows: rows.slice(0, 500) })).toMatchObject({ stored: 500 });
    expect(await appendLeadImportBatch(pool, { importId: item.id, clientId: T, rows: [], startIndex: 500 }).catch((e) => e)).toMatchObject({ status: 400 });
    expect(await appendLeadImportBatch(pool, { importId: item.id, clientId: T, startIndex: 500, rows: rows.slice(0, 2) }).catch((e) => e)).toMatchObject({ status: 400 });
  }, SLOW);
});

// ── "os mesmos números de hoje" ─────────────────────────────────────────────────────────────────────────────────────
// Transcrição do tratamento do POST único ANTERIOR (referência de hoje): linhas → itens → totais. A ordem e as regras são
// as do handler que existia em domains/leads/routes.js; o fluxo em lotes tem que dar o MESMO resultado.
import { normalizeImportedLead, isImportedLeadEmpty } from "../services/leadImport.js";
function referenciaDeHoje(rows, { clientId, defaultDdd, mappingItems }) {
  const filteredRows = rows.filter((row) => !isRowHeader(row));
  const autoMapping = detectImportColumns(filteredRows);
  const parsedItems = filteredRows.map((row, index) => {
    const enrichedRow = { ...row };
    if (!mappingItems) {
      if (autoMapping.telefone && !enrichedRow.telefone) enrichedRow.telefone = row[autoMapping.telefone];
      if (autoMapping.nome && !enrichedRow.nome) enrichedRow.nome = row[autoMapping.nome];
    }
    const normalized = normalizeImportedLead(enrichedRow, clientId, defaultDdd, mappingItems || null);
    const imported = !!normalized.telefone;
    const phoneMapping = mappingItems?.find((m) => m.target === "telefone");
    const rawPhone = phoneMapping ? String(row[phoneMapping.column] ?? "").trim() : String(enrichedRow.telefone ?? "").trim();
    const rawDigits = rawPhone.replace(/\D/g, "");
    const skipReason = imported
      ? null
      : isImportedLeadEmpty(normalized)
        ? "Linha vazia ou sem dados aproveitaveis"
        : (rawDigits.length === 8 || rawDigits.length === 9) && !defaultDdd
          ? "Telefone incompleto (faltou DDD)"
          : rawDigits.length >= 15 || rawPhone.includes("@g.us")
            ? "Identificador de grupo do WhatsApp bloqueado"
            : "Telefone ausente ou invalido";
    return { rowNumber: index + 2, normalized, imported, skipReason };
  });
  const validRowsMap = new Map();
  for (const item of parsedItems) if (item.imported) validRowsMap.set(item.normalized.telefone, item.normalized);
  return { parsedItems, total_rows: parsedItems.length, imported_rows: validRowsMap.size, skipped_rows: parsedItems.length - validRowsMap.size };
}

describe("[TESTE OBRIGATÓRIO] os totais são iguais aos de hoje para a mesma planilha", () => {
  const misturada = () => {
    const base = planilha(1_300);
    base.splice(0, 0, { Nome: "Nome", Telefone: "Telefone", Cidade: "Cidade" }); // cabeçalho como primeira linha de dados
    return base;
  };
  const DIFICEIS = [
    { Nome: "Sem nada", Telefone: "", Cidade: "" },
    { Nome: "Grupo", Telefone: "120363049633060243@g.us", Cidade: "X" },
    { Nome: "Curto", Telefone: "98100010", Cidade: "X" },
    { Nome: "Com 55", Telefone: "5534998100001", Cidade: "X" },
    { Nome: "Repetido", Telefone: "5534998100001", Cidade: "X" },
    { Nome: "", Telefone: "(34) 99810-0004", Cidade: "" },
  ];

  for (const [rotulo, mapeada, ddd] of [["com mapeamento explícito e DDD padrão", true, "34"], ["com mapeamento explícito SEM DDD padrão", true, ""], ["sem mapeamento (detecção automática)", false, "34"]]) {
    it(`${rotulo}: total_rows, imported_rows, skipped_rows e a PRÉVIA coincidem item a item`, async () => {
      const rows = [...misturada(), ...DIFICEIS];
      const mappingItems = mapeada ? MAPEAMENTO : null;
      const ref = referenciaDeHoje(rows, { clientId: T, defaultDdd: ddd || null, mappingItems });
      const { db, pool } = await mundo();

      const r = await importarTudo(pool, rows, { mapping: mappingItems, defaultDdd: ddd });

      expect(r.fechamento.item).toMatchObject({ total_rows: ref.total_rows, imported_rows: ref.imported_rows, skipped_rows: ref.skipped_rows });
      // os 10 primeiros da prévia: telefone, nome, importado, motivo
      expect(r.fechamento.preview.map((p) => [p.telefone, p.nome, p.imported, p.skipReason])).toEqual(ref.parsedItems.slice(0, 10).map((p) => [p.normalized.telefone, p.normalized.nome, p.imported, p.skipReason]));
      // item a item (ordenado pela posição): telefone, imported, motivo e o normalizado gravado
      const itens = (await db.query("SELECT row_number, telefone, imported, skip_reason, normalized_data FROM lead_import_items WHERE import_id = $1 ORDER BY row_number", [r.item.id])).rows;
      expect(itens.map((i) => [i.telefone, i.imported, i.skip_reason, i.normalized_data])).toEqual(ref.parsedItems.map((p) => [p.normalized.telefone ?? null, p.imported, p.skipReason, p.normalized]));
    }, SLOW);
  }

  it("planilha SEM cabeçalho no meio dos dados: os row_number são os mesmos de hoje (posição + 2)", async () => {
    const rows = [...planilha(1_100), ...DIFICEIS];
    const ref = referenciaDeHoje(rows, { clientId: T, defaultDdd: "34", mappingItems: MAPEAMENTO });
    const { db, pool } = await mundo();

    const r = await importarTudo(pool, rows);

    const numeros = (await db.query("SELECT row_number FROM lead_import_items WHERE import_id = $1 ORDER BY row_number", [r.item.id])).rows.map((x) => x.row_number);
    expect(numeros).toEqual(ref.parsedItems.map((p) => p.rowNumber));
  }, SLOW);

  it("cabeçalho repetido no meio dos dados: a linha é descartada como hoje, e o row_number agora é a posição REAL no arquivo (estável entre lotes)", async () => {
    const rows = planilha(1_100);
    rows.splice(3, 0, { Nome: "Nome", Telefone: "Telefone", Cidade: "Cidade" });
    const { db, pool } = await mundo();

    const r = await importarTudo(pool, rows);

    const numeros = (await db.query("SELECT row_number FROM lead_import_items WHERE import_id = $1 ORDER BY row_number", [r.item.id])).rows.map((x) => x.row_number);
    expect(numeros).toHaveLength(1_100);
    expect(numeros).not.toContain(5); // posição 3 + 2: era o cabeçalho, não virou item (hoje o número seria deslocado: 2,3,4,5,...)
    expect(numeros.slice(0, 4)).toEqual([2, 3, 4, 6]);
    expect(r.fechamento.item.total_rows).toBe(1_100);
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] os totais da tela (válidos, sem telefone, completados com DDD) batem com a regra da tela para cada telefone da fixture compartilhada", async () => {
    const porDdd = new Map();
    for (const c of CASOS_TELEFONE) porDdd.set(c.defaultDdd ?? "", [...(porDdd.get(c.defaultDdd ?? "") || []), c]);
    for (const [ddd, casos] of porDdd) {
      const { pool } = await mundo();
      const rows = casos.map((c, i) => ({ Nome: `P${i}`, Telefone: c.raw, Cidade: "X" }));

      const r = await importarTudo(pool, rows, { defaultDdd: ddd });

      const cont = (k) => casos.filter((c) => c.expected === k).length;
      expect(r.fechamento.totals, `DDD ${JSON.stringify(ddd)}`).toMatchObject({
        total: casos.length, intact: cont("intact"), completedWithDdd: cont("completed"), withoutPhone: cont("missing"), valid: cont("intact") + cont("completed"),
      });
    }
  }, SLOW);

  it("classifyImportedPhone concorda com a fixture compartilhada com a tela, caso a caso", () => {
    for (const c of CASOS_TELEFONE) {
      const sanitizado = sanitizePhone(c.raw, c.defaultDdd);
      expect(sanitizado, `sanitizePhone de ${JSON.stringify(c.raw)}`).toBe(c.sanitized);
      expect(classifyImportedPhone(c.raw, sanitizado), JSON.stringify(c.raw)).toBe(c.expected);
    }
  });
});

describe("campos personalizados e mapeamento automático na abertura", () => {
  it("abrir cadastra o campo novo com o import_id e avisa quando o tipo diverge do cadastrado", async () => {
    const { db, pool } = await mundo();
    await db.exec(`INSERT INTO lead_custom_fields (client_id, key, label, type) VALUES ('${T}', 'renda', 'Renda', 'text')`);
    const mapping = [
      { column: "Nome", target: "nome" }, { column: "Telefone", target: "telefone" },
      { column: "Profissão", target: "custom", label: "Profissão", type: "text" },
      { column: "Renda", target: "custom", label: "Renda", type: "number", key: "renda" },
    ];

    const { item, warnings } = await openLeadImport(pool, { clientId: T, sourceName: "p", columnMapping: { mapping }, totalRows: 10 });

    const campos = (await db.query("SELECT key, type, import_id FROM lead_custom_fields WHERE client_id = $1 ORDER BY key", [T])).rows;
    expect(campos.map((c) => [c.key, c.type])).toEqual([["profissao", "text"], ["renda", "text"]]); // o tipo cadastrado de 'renda' foi mantido
    expect(campos.find((c) => c.key === "profissao").import_id).toBe(item.id);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ key: "renda", detectedType: "number", registeredType: "text" });
  }, SLOW);

  it("sem mapeamento, o automático sai de uma AMOSTRA na abertura e vale para todos os lotes (mesmo resultado que ver o arquivo todo)", async () => {
    const rows = planilha(1_200).map((r) => ({ Contato: r.Nome, Celular: r.Telefone, Cidade: r.Cidade }));
    const ref = referenciaDeHoje(rows, { clientId: T, defaultDdd: "34", mappingItems: null });
    const { pool } = await mundo();

    const r = await importarTudo(pool, rows, { mapping: null });

    expect(r.fechamento.item).toMatchObject({ total_rows: ref.total_rows, imported_rows: ref.imported_rows, skipped_rows: ref.skipped_rows });
  }, SLOW);
});

describe("[TESTE OBRIGATÓRIO] matriz código × schema: o schema ANTIGO (sem as colunas novas) não derruba a lista", () => {
  it("lista em schema antigo com DDL BLOQUEADO: funciona, tudo 'completed' (nada do histórico muda)", async () => {
    const { db, pool } = await mundo({ migrada: false, ddlBloqueado: true });
    await db.exec(`INSERT INTO lead_imports (client_id, source_name, total_rows, imported_rows) VALUES ('${T}', 'antiga.xlsx', 10, 9)`);

    const lista = await listLeadImports(pool, T);

    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ source_name: "antiga.xlsx", status: "completed", expected_rows: null, received_offset: 0 });
  }, SLOW);

  it("lista em schema antigo com DDL liberado: o espelho em runtime cria as colunas e a lista traz o status", async () => {
    const { db, pool } = await mundo({ migrada: false });
    await db.exec(`INSERT INTO lead_imports (client_id, source_name) VALUES ('${T}', 'antiga.xlsx')`);

    const lista = await listLeadImports(pool, T);

    expect(lista[0].status).toBe("completed"); // o DEFAULT da coluna: planilhas anteriores seguem completas
    const colunas = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='lead_imports' AND column_name IN ('status','expected_rows','received_offset','import_params','import_stats','fingerprint')")).rows;
    expect(colunas).toHaveLength(6);
  }, SLOW);

  it("importar em schema antigo com DDL liberado funciona de ponta a ponta (a migration não precisa ter rodado)", async () => {
    const { pool } = await mundo({ migrada: false });
    const r = await importarTudo(pool, planilha(1_200));
    expect(r.fechamento.item.status).toBe("completed");
  }, SLOW);

  it("a migration é idempotente e as colunas novas têm os mesmos nomes do espelho em runtime", async () => {
    const { db, pool } = await mundo({ migrada: true });

    await db.exec(MIGRATION); // de novo
    await ensureLeadImportBatchColumns(pool); // espelho depois da migration

    const colunas = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='lead_imports'")).rows.map((c) => c.column_name);
    for (const c of ["status", "expected_rows", "received_offset", "import_params", "import_stats", "fingerprint"]) expect(colunas).toContain(c);
  }, SLOW);

  it("importar em schema antigo com DDL BLOQUEADO falha com erro claro, sem criar nada pela metade", async () => {
    const { db, pool } = await mundo({ migrada: false, ddlBloqueado: true });

    await expect(openLeadImport(pool, { clientId: T, sourceName: "p", defaultDdd: "34", columnMapping: { mapping: MAPEAMENTO }, totalRows: 10 })).rejects.toThrow(/permission denied/);

    expect((await db.query("SELECT count(*)::int AS n FROM lead_imports")).rows[0].n).toBe(0);
  }, SLOW);
});

describe("regras de linha reaproveitadas pelo POST único", () => {
  it("parseImportRows: numeração 'filtered' (POST único) × 'original' (lotes), cabeçalho descartado nos dois", () => {
    const rows = [{ Nome: "Nome", Telefone: "Telefone" }, { Nome: "Ana", Telefone: "34998100001" }, { Nome: "Bia", Telefone: "34998100002" }];

    const filtrada = parseImportRows(rows, { clientId: T, defaultDdd: null, mappingItems: [{ column: "Nome", target: "nome" }, { column: "Telefone", target: "telefone" }], numbering: "filtered" });
    const original = parseImportRows(rows, { clientId: T, defaultDdd: null, mappingItems: [{ column: "Nome", target: "nome" }, { column: "Telefone", target: "telefone" }], numbering: "original" });

    expect(filtrada.map((i) => i.rowNumber)).toEqual([2, 3]);
    expect(original.map((i) => i.rowNumber)).toEqual([3, 4]);
  });

});
