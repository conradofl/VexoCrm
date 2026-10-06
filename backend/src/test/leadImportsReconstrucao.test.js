// backend/src/test/leadImportsReconstrucao.test.js
//
// Reconstrução das importações ANTIGAS (ops/sql/2026-10-06-reconstruir-importacoes.sql), em Postgres REAL (pglite) com a base medida em produção
// (geracao-digital, 24.655 leads; seis tags de planilha com 17.843, 351, 58, 21, 4 e 2 leads). As importações feitas antes do registro em lead_imports
// (05/10/2026) não aparecem na campanha por planilha: o script as recria a partir do que dá para saber SEM palpite — ids em dados.import_ids sem
// registro e tags `#Imp-…` — com nome sintético marcado, total que é piso, data aproximada, nenhum campo inventado.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { N, PLANILHAS, PLANILHA_TAMANHOS, inserirBase, montaBase } from "./helpers/leadBaseGd.js";
import { queryCampaignAudience, queryImportOrigin, RECONSTRUCTED_SCOPE_REASON } from "../services/leadListQuery.js";
import { listLeadImports } from "../services/leadImportBatches.js";

const SLOW = 240_000;
const T = "geracao-digital";
const OUTRO = "outra-empresa";
const SCRIPT = readFileSync(resolve("../ops/sql/2026-10-06-reconstruir-importacoes.sql"), "utf8");

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    telefone text NOT NULL, phone text, nome text, status text, stage text DEFAULT 'cold', temperature text DEFAULT 'warm',
    tags text[] DEFAULT ARRAY[]::text[], dados jsonb NOT NULL DEFAULT '{}'::jsonb, lead_source text, potential_contract_value numeric(14,2),
    raw_chat_summary text, last_interaction_at timestamptz, assigned_to text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz DEFAULT now(),
    UNIQUE (client_id, telefone));
  CREATE TABLE lead_imports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    source_name text NOT NULL, source_type text NOT NULL DEFAULT 'spreadsheet', total_rows integer NOT NULL DEFAULT 0, imported_rows integer NOT NULL DEFAULT 0,
    skipped_rows integer NOT NULL DEFAULT 0, uploaded_by_uid text, uploaded_by_email text, created_at timestamptz NOT NULL DEFAULT now(), column_mapping jsonb,
    status text NOT NULL DEFAULT 'completed', expected_rows integer, received_offset integer NOT NULL DEFAULT 0, import_params jsonb, import_stats jsonb, fingerprint text);
  CREATE TABLE lead_import_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_id uuid NOT NULL REFERENCES lead_imports(id) ON DELETE CASCADE, client_id text NOT NULL, row_number integer NOT NULL);
`;

let db;
let pool;
let rows;
let before;
let after;
let scriptMs = 0;
let ids; // ids das importações do cenário
const scope = { clientId: T };
const openDbs = [];

const q = async (sql, values = []) => (await db.query(sql, values)).rows;
const um = async (sql, values = []) => (await q(sql, values))[0];
const leadsComTag = (tag) => before.filter((l) => (l.tags || []).includes(tag));

beforeAll(async () => {
  rows = montaBase();
  db = await createPgliteDb(SCHEMA);
  openDbs.push(db);
  pool = { query: (sql, values) => db.query(sql, values) };
  await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'GD'), ('${OUTRO}', 'Outra')`);
  await inserirBase(db, rows, T);
  // outra empresa, com uma tag #Imp- de MESMO nome: tem que virar importação DELA, não misturar
  await db.query(`INSERT INTO leads (client_id, telefone, nome, tags) VALUES ($1, '5500000000001', 'Outro', ARRAY['#Imp-clientes_2026']), ($1, '5500000000002', 'Outro 2', ARRAY['#Imp-clientes_2026'])`, [OUTRO]);

  // importações REGISTRADAS (pós 05/10) que cobrem por inteiro os grupos de 4 e de 2 leads (tags 4 e 5)
  const reg = async (nome, tag, createdAt) => {
    const id = (await um(`INSERT INTO lead_imports (client_id, source_name, source_type, total_rows, created_at) VALUES ($1, $2, 'xlsx', 10, $3) RETURNING id::text AS id`, [T, nome, createdAt])).id;
    await db.query(`UPDATE leads SET dados = jsonb_set(dados, '{import_ids}', COALESCE(dados->'import_ids', '[]'::jsonb) || to_jsonb($2::text)) WHERE client_id = $1 AND $3 = ANY(tags)`, [T, id, tag]);
    return id;
  };
  const registrada4 = await reg("reativacao.xlsx", PLANILHAS[4], "2026-10-06T10:00:00Z");
  const registrada5 = await reg("janeiro.xlsx", PLANILHAS[5], "2026-10-06T11:00:00Z");
  // ids em dados.import_ids SEM registro: X (20 leads só da tag 1, com ela em comum) e Y (5 leads sem tag em comum); mais um id que já tem OUTRA importação
  const X = "aaaaaaaa-0000-4000-8000-00000000000a";
  const Y = "bbbbbbbb-0000-4000-8000-00000000000b";
  // X: 20 leads que têm a tag 1 e NÃO a tag 0 (a tag em comum do grupo é a 1)
  const soT1 = (await q(`SELECT id::text AS id FROM leads WHERE client_id = $1 AND $2 = ANY(tags) AND NOT ($3 = ANY(tags)) ORDER BY created_at LIMIT 20`, [T, PLANILHAS[1], PLANILHAS[0]])).map((r) => r.id);
  // Y: leads de grupos diferentes, sem NENHUMA tag em comum (conferido abaixo)
  const variados = [];
  for (const [tag, evita] of [["VP Ofertas", null], ["Cliente Antigo", null], [PLANILHAS[3], PLANILHAS[0]], ["Fechamento", null]]) {
    const r = await um(`SELECT id::text AS id FROM leads WHERE client_id = $1 AND $2 = ANY(tags) AND ($3::text IS NULL OR NOT ($3 = ANY(tags))) ORDER BY created_at LIMIT 1`, [T, tag, evita]);
    if (r) variados.push(r.id);
  }
  for (const [imp, lista] of [[X, soT1], [Y, variados]]) {
    await db.query(`UPDATE leads SET dados = jsonb_set(dados, '{import_ids}', COALESCE(dados->'import_ids', '[]'::jsonb) || to_jsonb($1::text)) WHERE id::text = ANY($2::text[])`, [imp, lista]);
  }
  ids = { registrada4, registrada5, X, Y, soT1, variados };

  before = await q(`SELECT id::text AS id, client_id, tags, dados, created_at FROM leads`);
  const t0 = performance.now();
  await db.exec(SCRIPT);
  scriptMs = performance.now() - t0;
  after = await q(`SELECT id::text AS id, client_id, tags, dados, created_at FROM leads`);
}, SLOW);

afterAll(async () => {
  for (const d of openDbs) await d.close();
});

const reconstruidas = () => q(`SELECT *, id::text AS id_txt FROM lead_imports WHERE source_type = 'reconstruida' ORDER BY client_id, source_name`);

describe("o script não pode virar O(n²) (roda no console, mas não pode ficar horas)", () => {
  it("[TESTE ESTRUTURAL] os CTEs de agregação são MATERIALIZED", () => {
    expect(SCRIPT.match(/AS MATERIALIZED/g).length).toBeGreaterThanOrEqual(8);
  });
  it("[TESTE DE CUSTO] roda sobre 24.655 leads em poucos segundos (pglite: limite superior; o tempo em Postgres real é medido pelo dono)", () => {
    console.info(`[reconstrução] script sobre ${N.toLocaleString("pt-BR")} leads em pglite: ${(scriptMs / 1000).toFixed(2)} s`);
    expect(scriptMs).toBeLessThan(30_000);
  });
});

describe("o que a reconstrução cria", () => {
  it("[TESTE OBRIGATÓRIO] as seis planilhas aparecem com as contagens medidas (17.843, 351, 58, 21, 4, 2) — as de 4 e 2 pela importação já registrada", async () => {
    const contagens = {};
    for (const [i, tag] of PLANILHAS.entries()) {
      const grupo = leadsComTag(tag).filter((l) => l.client_id === T);
      expect(grupo.length).toBe(PLANILHA_TAMANHOS[i]); // a base tem a forma medida
      // a importação que representa a tag: a reconstruída dela, ou (grupo todo coberto) a registrada
      const rec = (await reconstruidas()).find((r) => r.client_id === T && r.import_params.tag_planilha === tag);
      const importId = rec ? rec.id_txt : i === 4 ? ids.registrada4 : ids.registrada5;
      const o = await queryImportOrigin(pool, { scope, importId });
      contagens[tag] = o.total;
    }
    expect(Object.values(contagens)).toEqual([17_843, 351, 58, 21, 4, 2]);
  }, SLOW);

  it("só as tags com leads FORA de qualquer importação ganham uma reconstruída (as de 4 e 2 leads, já cobertas pelo registro, não duplicam)", async () => {
    const porTag = (await reconstruidas()).filter((r) => r.client_id === T && r.import_params.fonte === "tag").map((r) => r.import_params.tag_planilha).sort();
    expect(porTag).toEqual([PLANILHAS[0], PLANILHAS[1], PLANILHAS[2], PLANILHAS[3]].sort());
  }, SLOW);

  it("nome SINTÉTICO e marcado (tag em comum + data aproximada), nunca um nome de arquivo inventado", async () => {
    for (const r of (await reconstruidas()).filter((x) => x.import_params.fonte === "tag")) {
      expect(r.source_name).toMatch(/^Importação reconstruída — #Imp-[\w-]+ \(≈ \d{2}\/\d{2}\/\d{4}\)$/);
      expect(r.source_name).not.toMatch(/\.(xlsx|xls|csv|ods)/i);
      expect(r.source_type).toBe("reconstruida");
    }
  }, SLOW);

  it("total = leads ENCONTRADOS e é PISO; data = menor created_at do grupo e é APROXIMADA; ambos declarados no registro", async () => {
    for (const r of (await reconstruidas()).filter((x) => x.client_id === T && x.import_params.fonte === "tag")) {
      const grupo = leadsComTag(r.import_params.tag_planilha).filter((l) => l.client_id === T);
      expect(r.total_rows).toBe(grupo.length);
      expect(r.imported_rows).toBe(grupo.length);
      expect(new Date(r.created_at).getTime()).toBe(Math.min(...grupo.map((l) => new Date(l.created_at).getTime())));
      expect(r.import_params).toMatchObject({ reconstruida: true, total_e_piso: true, data_aproximada: true });
    }
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] nenhum campo preenchido por palpite: sem quem importou, sem mapeamento, sem linhas puladas conhecidas, sem dados brutos", async () => {
    for (const r of await reconstruidas()) {
      expect(r.uploaded_by_uid).toBeNull();
      expect(r.uploaded_by_email).toBeNull();
      expect(r.column_mapping).toBeNull();
      expect(r.import_params.campos_desconhecidos).toEqual(expect.arrayContaining(["nome_do_arquivo", "uploaded_by", "skipped_rows", "dados_brutos"]));
    }
    expect((await um(`SELECT count(*)::int AS n FROM lead_import_items`)).n).toBe(0);
  }, SLOW);

  it("id em dados.import_ids sem registro: a reconstruída nasce com o MESMO id, com a tag em comum no nome (ou 'sem tag em comum')", async () => {
    const x = await um(`SELECT * FROM lead_imports WHERE id::text = $1`, [ids.X]);
    const y = await um(`SELECT * FROM lead_imports WHERE id::text = $1`, [ids.Y]);
    expect(x.source_type).toBe("reconstruida");
    expect(x.source_name).toContain(PLANILHAS[1]);
    expect(x.total_rows).toBe(20);
    expect(x.import_params).toMatchObject({ fonte: "import_ids", tag_em_comum: PLANILHAS[1] });
    const tagsDeY = before.filter((l) => ids.variados.includes(l.id)).map((l) => new Set(l.tags || []));
    expect([...tagsDeY[0]].filter((t) => tagsDeY.every((set) => set.has(t)))).toEqual([]); // o cenário realmente não tem tag em comum
    expect(ids.variados.length).toBeGreaterThanOrEqual(3);
    expect(y.source_name).toContain("sem tag em comum");
    expect(y.total_rows).toBe(ids.variados.length);
  }, SLOW);

  it("importação de OUTRA empresa com a mesma tag é uma importação DELA (não se mistura)", async () => {
    const dela = (await reconstruidas()).filter((r) => r.client_id === OUTRO);
    expect(dela).toHaveLength(1);
    expect(dela[0].total_rows).toBe(2);
    const comTag = after.filter((l) => l.client_id === OUTRO).flatMap((l) => l.dados.import_ids || []);
    expect(new Set(comTag)).toEqual(new Set([dela[0].id_txt]));
  }, SLOW);
});

describe("a ligação dos leads (dados.import_ids) é aditiva", () => {
  it("todo lead com uma tag de planilha reconstruída ganha o id dessa importação; os de 4 tags ganham 4", async () => {
    const recPorTag = Object.fromEntries((await reconstruidas()).filter((r) => r.client_id === T && r.import_params.fonte === "tag").map((r) => [r.import_params.tag_planilha, r.id_txt]));
    const antes = new Map(before.map((l) => [l.id, l]));
    let comMuitas = 0;
    for (const l of after.filter((x) => x.client_id === T)) {
      const esperados = (antes.get(l.id).tags || []).map((t) => recPorTag[t]).filter(Boolean);
      const tem = l.dados.import_ids || [];
      for (const id of esperados) expect(tem).toContain(id);
      if (esperados.length >= 4) comMuitas += 1;
    }
    expect(comMuitas).toBe(0 + after.filter((l) => l.client_id === T && (antes.get(l.id).tags || []).filter((t) => recPorTag[t]).length >= 4).length);
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] nada é removido: tags intactas, import_ids que já existiam preservados, outras chaves de dados intactas, e leads sem tag de planilha não mudam", async () => {
    const antes = new Map(before.map((l) => [l.id, l]));
    for (const l of after) {
      const a = antes.get(l.id);
      expect(l.tags).toEqual(a.tags);
      for (const [k, v] of Object.entries(a.dados)) {
        if (k === "import_ids") for (const id of v) expect(l.dados.import_ids).toContain(id);
        else expect(l.dados[k]).toEqual(v);
      }
      const temTagPlanilha = (a.tags || []).some((t) => t.toLowerCase().startsWith("#imp-"));
      if (!temTagPlanilha) expect(l.dados).toEqual(a.dados);
    }
  }, SLOW);

  it("idempotente: rodar de novo não cria importação nem altera lead", async () => {
    const antesN = (await um(`SELECT count(*)::int AS n FROM lead_imports`)).n;
    await db.exec(SCRIPT);
    expect((await um(`SELECT count(*)::int AS n FROM lead_imports`)).n).toBe(antesN);
    const depois = await q(`SELECT id::text AS id, dados FROM leads`);
    const m = new Map(after.map((l) => [l.id, l.dados]));
    for (const l of depois) expect(l.dados).toEqual(m.get(l.id));
  }, SLOW);

  it("lead que ganha a tag DEPOIS é ligado na reexecução, sem criar outra importação", async () => {
    const antesN = (await um(`SELECT count(*)::int AS n FROM lead_imports`)).n;
    const id = (await um(`INSERT INTO leads (client_id, telefone, nome, tags) VALUES ($1, '5599900000001', 'Tardio', ARRAY[$2]) RETURNING id::text AS id`, [T, PLANILHAS[1]])).id;
    await db.exec(SCRIPT);
    const rec = (await reconstruidas()).find((r) => r.client_id === T && r.import_params.tag_planilha === PLANILHAS[1]);
    const l = await um(`SELECT dados FROM leads WHERE id::text = $1`, [id]);
    expect(l.dados.import_ids).toContain(rec.id_txt);
    expect((await um(`SELECT count(*)::int AS n FROM lead_imports`)).n).toBe(antesN);
    await db.query(`DELETE FROM leads WHERE id::text = $1`, [id]);
  }, SLOW);
});

describe("a aplicação com importação reconstruída", () => {
  it("[TESTE OBRIGATÓRIO] 'nasceram / já existiam' NÃO vale: só o total (piso), a data aproximada e o porquê — número que não dá para saber não vira número", async () => {
    const rec = (await reconstruidas()).find((r) => r.client_id === T && r.import_params.tag_planilha === PLANILHAS[1]);
    const o = await queryImportOrigin(pool, { scope, importId: rec.id_txt });
    expect(o).toMatchObject({ found: true, reconstructed: true, totalIsFloor: true, approximateDate: true, born: null, existed: null, total: 351, reason: RECONSTRUCTED_SCOPE_REASON });
  }, SLOW);

  it("o público 'todos' funciona; o recorte 'nasceram' ou 'já existiam' é recusado com o motivo", async () => {
    const rec = (await reconstruidas()).find((r) => r.client_id === T && r.import_params.tag_planilha === PLANILHAS[2]);
    const todos = await queryCampaignAudience(pool, { scope, importId: rec.id_txt });
    expect(todos.total).toBe(58);
    for (const importScope of ["born", "existed"]) {
      const r = await queryCampaignAudience(pool, { scope, importId: rec.id_txt, importScope });
      expect(r).toMatchObject({ scopeUnavailable: true, total: 0, reason: RECONSTRUCTED_SCOPE_REASON });
    }
  }, SLOW);

  it("a importação REGISTRADA (de verdade) segue com os dois números", async () => {
    const o = await queryImportOrigin(pool, { scope, importId: ids.registrada4 });
    expect(o.reconstructed).toBeUndefined();
    expect(typeof o.born).toBe("number");
    expect(o.total).toBe(4);
  }, SLOW);

  it("a lista da tela de Planilhas NÃO mostra as reconstruídas (sem itens nem dados brutos não são fonte de campanha); o seletor do Banco mostra", async () => {
    const planilhas = await listLeadImports(pool, T, 200);
    expect(planilhas.some((r) => r.source_type === "reconstruida")).toBe(false);
    expect(planilhas.map((r) => r.id)).toEqual(expect.arrayContaining([ids.registrada4, ids.registrada5]));
    const banco = await listLeadImports(pool, T, 200, { includeReconstructed: true });
    expect(banco.filter((r) => r.source_type === "reconstruida").length).toBe((await reconstruidas()).filter((r) => r.client_id === T).length);
  }, SLOW);
});
