// backend/src/test/leadProcedenciaPostgres.test.js
//
// Leva "separar procedência de marcação, e campanha por planilha", em Postgres REAL (pglite) com uma base do tamanho da medida em produção
// (geracao-digital, 24.655 leads; 6 tags de planilha com 18.279 marcações, só 73 leads com mais de uma; agenda-whatsapp 5.050; nomes de grupo;
// rótulos da IA; marcações da pessoa).
//   Bloco 1 — a campanha por PLANILHA traz os dois números (nasceram / já existiam) e o público certo;
//   Bloco 2 — o seletor de tags agrupa por tipo SEM perder nenhuma tag;
//   Bloco 3 — o campo novo de procedência bate com a tag correspondente em TODOS os leads do histórico (backfill), sem tocar nas tags.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { GRUPOS, N, PLANILHAS, ROTULOS, inserirBase, montaBase } from "./helpers/leadBaseGd.js";
import {
  IMPORT_BORN_TOLERANCE_SECONDS,
  queryBaseFacets,
  queryCampaignAudience,
  queryImportOrigin,
} from "../services/leadListQuery.js";
import {
  AI_LABELS,
  AGENDA_WHATSAPP_TAG,
  CONVERSA_WHATSAPP_TAG,
  classifyTagKind,
  mergeProcedencia,
  sanitizeAiLabels,
} from "../services/leadProcedencia.js";
import { upsertLeadByPhone, upsertLeadsBatchByPhone } from "../services/leadUpsert.js";

const SLOW = 240_000;
const T = "geracao-digital";
const OUTRO = "outra-empresa";
const MIGRATION = readFileSync(resolve("../ops/sql/2026-10-06-backfill-procedencia.sql"), "utf8");

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    telefone text NOT NULL, phone text, nome text, status text, stage text DEFAULT 'cold', stage_source text, lost_reason text, temperature text DEFAULT 'warm',
    tags text[] DEFAULT ARRAY[]::text[], dados jsonb NOT NULL DEFAULT '{}'::jsonb, lead_source text, potential_contract_value numeric(14,2),
    raw_chat_summary text, last_interaction_at timestamptz, assigned_to text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz DEFAULT now(),
    UNIQUE (client_id, telefone));
  CREATE TABLE lead_imports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    source_name text NOT NULL, source_type text NOT NULL DEFAULT 'spreadsheet', total_rows integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
`;

let db;
let pool;
let base;
const scope = { clientId: T };
const openDbs = [];

beforeAll(async () => {
  base = montaBase();
  db = await createPgliteDb(SCHEMA);
  openDbs.push(db);
  pool = { query: (sql, values) => db.query(sql, values) };
  await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'GD'), ('${OUTRO}', 'Outra')`);
  await inserirBase(db, base, T);
  // outra empresa: um grupo com o MESMO nome que uma tag da pessoa na GD, e uma planilha dela
  await db.query(`INSERT INTO leads (client_id, telefone, nome, tags, dados) VALUES ($1, '5500000000001', 'Outro', ARRAY['Grupo da Outra Empresa'], '{"grupo_nome":"Grupo da Outra Empresa"}'::jsonb)`, [OUTRO]);
}, SLOW);

afterAll(async () => {
  for (const d of openDbs) await d.close();
});

const contar = async (sql, values = []) => Number((await db.query(sql, values)).rows[0].n);

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("a migration de backfill não pode virar O(n²)", () => {
  it("[TESTE ESTRUTURAL] os três CTEs são MATERIALIZED: sem isso o planejador inlina as subconsultas correlacionadas no join e a migration não termina no boot", () => {
    expect(MIGRATION.match(/AS MATERIALIZED/g)).toHaveLength(3);
    expect(MIGRATION).toMatch(/grupos AS MATERIALIZED/);
    expect(MIGRATION).toMatch(/calc AS MATERIALIZED/);
    expect(MIGRATION).toMatch(/alvo AS MATERIALIZED/);
  });
});

describe("a base de teste tem a forma medida em produção", () => {
  it("24.655 leads; planilha 18.279 marcações em 18.162 leads, 73 com mais de uma", async () => {
    expect(await contar(`SELECT count(*)::int AS n FROM leads WHERE client_id = '${T}'`)).toBe(N);
    const marcas = await contar(`SELECT count(*)::int AS n FROM leads l CROSS JOIN LATERAL unnest(l.tags) t WHERE l.client_id = '${T}' AND t LIKE '#Imp-%'`);
    expect(marcas).toBe(18_279);
    expect(await contar(`SELECT count(*)::int AS n FROM leads WHERE client_id = '${T}' AND (SELECT count(*) FROM unnest(tags) t WHERE t LIKE '#Imp-%') > 1`)).toBe(73);
    expect(await contar(`SELECT count(*)::int AS n FROM leads WHERE client_id = '${T}' AND 'agenda-whatsapp' = ANY(tags)`)).toBe(5_050);
  }, SLOW);
});

// ── Bloco 2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Bloco 2 — o seletor de tags agrupa por tipo, sem perder nenhuma tag", () => {
  it("cada tag da empresa aparece UMA vez, com a mesma contagem de antes, e com o tipo certo", async () => {
    const f = await queryBaseFacets(pool, scope, { parts: ["tags"] });
    const doBanco = (await db.query(`SELECT t AS tag, count(*)::int AS n FROM leads l CROSS JOIN LATERAL unnest(l.tags) t WHERE l.client_id = $1 GROUP BY 1 ORDER BY 1`, [T])).rows;
    expect(f.tags.map((x) => [x.tag, x.count])).toEqual(doBanco.map((x) => [x.tag, x.n])); // nenhuma perdida, nenhuma inventada, mesma contagem
    expect(new Set(f.tags.map((x) => x.tag)).size).toBe(f.tags.length);
    const kind = Object.fromEntries(f.tags.map((x) => [x.tag, x.kind]));
    for (const p of PLANILHAS) expect(kind[p]).toBe("planilha");
    for (const [g] of GRUPOS) expect(kind[g]).toBe("origem");
    expect(kind["agenda-whatsapp"]).toBe("origem");
    expect(kind["WhatsApp WA"]).toBe("origem");
    for (const [r] of ROTULOS) expect(kind[r]).toBe("ia");
    expect(kind["vip"]).toBe("minhas");
    expect(kind["Cliente Antigo"]).toBe("minhas");
    // o nome de grupo de OUTRA empresa não classifica como grupo aqui: é marcação da pessoa
    expect(kind["Grupo da Outra Empresa"]).toBe("minhas");
  }, SLOW);

  it("os quatro tipos juntos são exatamente o conjunto de tags (partição, sem sobra)", async () => {
    const f = await queryBaseFacets(pool, scope, { parts: ["tags"] });
    const porTipo = { planilha: [], origem: [], ia: [], minhas: [] };
    for (const t of f.tags) porTipo[t.kind].push(t.tag);
    expect(Object.values(porTipo).flat().sort()).toEqual(f.tags.map((t) => t.tag).sort());
    expect(porTipo.planilha).toHaveLength(6);
    expect(porTipo.origem).toHaveLength(GRUPOS.length + 2);
    expect(porTipo.ia).toHaveLength(ROTULOS.length);
    expect(porTipo.minhas.sort()).toEqual(["Cliente Antigo", "Grupo da Outra Empresa", "vip"]);
  }, SLOW);

  it("se a consulta dos nomes de grupo falha, TODAS as tags continuam saindo (os grupos caem em 'minhas') e a causa vem junto", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const quebrado = { query: (sql, v) => (/grupo_nome/.test(sql) && /DISTINCT/.test(sql) ? Promise.reject(Object.assign(new Error("boom grupos"), { code: "XX000" })) : pool.query(sql, v)) };
    const f = await queryBaseFacets(quebrado, scope, { parts: ["tags"] });
    expect(f.failedParts).toEqual({});
    expect(f.tags.length).toBeGreaterThan(20);
    expect(f.tags.find((t) => t.tag === "VP Ofertas").kind).toBe("minhas");
    expect(f.tagKindsCause).toMatchObject({ message: "boom grupos", code: "XX000" });
  }, SLOW);

  it("classifyTagKind: precedência planilha > origem > IA > minhas, prefixo sem diferenciar caixa", () => {
    const g = new Set(["VP Ofertas"]);
    expect(classifyTagKind("#Imp-x", g)).toBe("planilha");
    expect(classifyTagKind("#IMP-x", g)).toBe("planilha");
    expect(classifyTagKind("#imp-x", g)).toBe("planilha");
    expect(classifyTagKind("VP Ofertas", g)).toBe("origem");
    expect(classifyTagKind("vp ofertas", g)).toBe("minhas"); // nome de grupo é exato
    expect(classifyTagKind("Follow-up", g)).toBe("ia");
    expect(classifyTagKind("meu rótulo", g)).toBe("minhas");
    expect(classifyTagKind(null, g)).toBe("minhas");
  });
});

// ── Bloco 1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Bloco 1 — campanha por planilha: nasceram × já existiam", () => {
  let importA;
  let importB;
  const ids = { bornA: [], existedA: [], bordaA: [], bornB: [] };
  const T0 = "2026-06-01T12:00:00.000Z";

  beforeAll(async () => {
    importA = (await db.query(`INSERT INTO lead_imports (client_id, source_name, total_rows, created_at) VALUES ($1, 'clientes-junho.xlsx', 1530, $2) RETURNING id::text AS id`, [T, T0])).rows[0].id;
    importB = (await db.query(`INSERT INTO lead_imports (client_id, source_name, total_rows, created_at) VALUES ($1, 'reimportacao.xlsx', 400, $2) RETURNING id::text AS id`, [T, "2026-07-01T12:00:00.000Z"])).rows[0].id;
    // 1.200 NASCERAM na importação A (criados depois da abertura), 300 JÁ EXISTIAM (criados meses antes) e foram tocados por ela
    const ins = async (n, tel0, createdSql, impIds, tags = "ARRAY[]::text[]") => {
      const r = await db.query(
        `INSERT INTO leads (client_id, telefone, nome, tags, dados, created_at)
         SELECT $1, '55' || lpad((${tel0} + g)::text, 11, '0'), 'Imp ' || g, ${tags}, jsonb_build_object('import_ids', $2::jsonb), ${createdSql}
           FROM generate_series(1, ${n}) g RETURNING id::text AS id`,
        [T, JSON.stringify(impIds)]
      );
      return r.rows.map((x) => x.id);
    };
    ids.bornA = await ins(1200, 90_000_000, `timestamptz '${T0}' + (g || ' seconds')::interval`, [importA]);
    ids.existedA = await ins(300, 91_000_000, `timestamptz '${T0}' - interval '40 days' - (g || ' minutes')::interval`, [importA]);
    // bordas da tolerância: 5 s ANTES da abertura (relógios diferentes: conta como nascido) e 11 s antes (já existia)
    ids.bordaA = [
      ...(await ins(1, 92_000_000, `timestamptz '${T0}' - interval '5 seconds'`, [importA])),
      ...(await ins(1, 92_100_000, `timestamptz '${T0}' - interval '${IMPORT_BORN_TOLERANCE_SECONDS + 1} seconds'`, [importA])),
    ];
    // importação B reimporta 150 leads que a A criou (existiam) e cria 250 novos
    await db.query(`UPDATE leads SET dados = jsonb_set(dados, '{import_ids}', dados->'import_ids' || to_jsonb($2::text)) WHERE id::text = ANY($1::text[])`, [ids.bornA.slice(0, 150), importB]);
    ids.bornB = await ins(250, 93_000_000, `timestamptz '2026-07-01T12:00:00.000Z' + (g || ' seconds')::interval`, [importB]);
  }, SLOW);

  it("importação A: 1.201 nasceram (1.200 + o da borda de 5 s), 301 já existiam; total = soma", async () => {
    const o = await queryImportOrigin(pool, { scope, importId: importA });
    expect(o).toMatchObject({ found: true, importId: importA, sourceName: "clientes-junho.xlsx", born: 1201, existed: 301, total: 1502 });
  }, SLOW);

  it("importação B (reimporta 150 de A e cria 250): para a B, os 150 JÁ EXISTIAM e os 250 nasceram", async () => {
    const o = await queryImportOrigin(pool, { scope, importId: importB });
    expect(o).toMatchObject({ born: 250, existed: 150, total: 400 });
  }, SLOW);

  it("o público 'todos' é a soma, 'nasceram' e 'já existiam' são os dois recortes, sem ponto em comum", async () => {
    const all = await queryCampaignAudience(pool, { scope, importId: importA });
    const born = await queryCampaignAudience(pool, { scope, importId: importA, importScope: "born" });
    const existed = await queryCampaignAudience(pool, { scope, importId: importA, importScope: "existed" });
    expect(all.total).toBe(1502 + 0); // os 150 reimportados pela B continuam sendo da A (import_ids acumula)
    expect(born.total).toBe(1201);
    expect(existed.total).toBe(301);
    const bornIds = new Set(born.items.map((x) => x.id));
    expect(existed.items.some((x) => bornIds.has(x.id))).toBe(false);
    expect(new Set([...born.items, ...existed.items].map((x) => x.id))).toEqual(new Set(all.items.map((x) => x.id)));
    expect(ids.existedA.every((id) => existed.items.some((x) => x.id === id))).toBe(true);
  }, SLOW);

  it("os números do seletor são os mesmos do público que a campanha recebe (o que o dono vê é o que envia)", async () => {
    for (const importId of [importA, importB]) {
      const o = await queryImportOrigin(pool, { scope, importId });
      expect((await queryCampaignAudience(pool, { scope, importId, importScope: "all" })).total).toBe(o.total);
      expect((await queryCampaignAudience(pool, { scope, importId, importScope: "born" })).total).toBe(o.born);
      expect((await queryCampaignAudience(pool, { scope, importId, importScope: "existed" })).total).toBe(o.existed);
    }
  }, SLOW);

  it("planilha combina em E com estágio e tag (a escolha por tag continua existindo)", async () => {
    await db.query(`UPDATE leads SET stage = 'buyer' WHERE id::text = ANY($1::text[])`, [ids.bornA.slice(0, 40)]);
    await db.query(`UPDATE leads SET tags = ARRAY['vip'] WHERE id::text = ANY($1::text[])`, [ids.bornA.slice(0, 10)]);
    expect((await queryCampaignAudience(pool, { scope, importId: importA, stages: ["buyer"] })).total).toBe(40);
    expect((await queryCampaignAudience(pool, { scope, importId: importA, stages: ["buyer"], tag: "vip", importScope: "born" })).total).toBe(10);
    // sem planilha: a escolha por tag segue como sempre
    expect((await queryCampaignAudience(pool, { scope, tag: "vip" })).total).toBe(await contar(`SELECT count(*)::int AS n FROM leads WHERE client_id = '${T}' AND 'vip' = ANY(tags)`));
  }, SLOW);

  it("importação de OUTRA empresa, inexistente ou id inválido: não encontrada (nunca devolve os leads de outro tenant)", async () => {
    const alheia = (await db.query(`INSERT INTO lead_imports (client_id, source_name) VALUES ($1, 'alheia.xlsx') RETURNING id::text AS id`, [OUTRO])).rows[0].id;
    expect(await queryImportOrigin(pool, { scope, importId: alheia })).toMatchObject({ found: false });
    expect(await queryCampaignAudience(pool, { scope, importId: alheia })).toMatchObject({ importNotFound: true, total: 0 });
    expect(await queryImportOrigin(pool, { scope, importId: "00000000-0000-0000-0000-000000000000" })).toMatchObject({ found: false });
    expect(await queryImportOrigin(pool, { scope, importId: "nao-e-uuid'; DROP TABLE leads;--" })).toMatchObject({ found: false });
    expect(await contar("SELECT count(*)::int AS n FROM leads")).toBeGreaterThan(N);
  }, SLOW);

  it("operador só conta os leads dele e os sem dono", async () => {
    await db.query(`UPDATE leads SET assigned_to = 'gabriel' WHERE id::text = ANY($1::text[])`, [ids.bornA.slice(0, 100)]);
    await db.query(`UPDATE leads SET assigned_to = 'priscila' WHERE id::text = ANY($1::text[])`, [ids.bornA.slice(100, 200)]);
    const op = { clientId: T, operatorIdentifiers: ["gabriel"] };
    const o = await queryImportOrigin(pool, { scope: op, importId: importA });
    expect(o.born).toBe(1201 - 100); // sem os 100 da Priscila
    const aud = await queryCampaignAudience(pool, { scope: op, importId: importA, importScope: "born" });
    expect(aud.total).toBe(o.born);
  }, SLOW);
});

// ── Bloco 3 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Bloco 3 — procedência e rótulos da IA ganham campo próprio; histórico preenchido a partir das tags", () => {
  let before;
  let migrated;
  let updated;
  let migrationMs = 0;
  const LABELS_IN_SQL = () => [...MIGRATION.matchAll(/ARRAY\['Fechamento'[^\]]*\]/g)][0][0].match(/'([^']+)'/g).map((s) => s.slice(1, -1));

  beforeAll(async () => {
    before = (await db.query(`SELECT id::text AS id, client_id, tags, dados FROM leads WHERE client_id = $1`, [T])).rows;
    const t0 = performance.now();
    const res = await db.query(MIGRATION);
    migrationMs = performance.now() - t0;
    updated = res.affectedRows;
    migrated = (await db.query(`SELECT id::text AS id, client_id, tags, dados FROM leads WHERE client_id = $1`, [T])).rows;
  }, SLOW);

  it("[TESTE DE CUSTO] a migration roda sobre 26 mil leads em poucos segundos", () => {
    expect(migrationMs).toBeLessThan(30_000);
  });

  it("[DECISÃO DO DONO] a lista fechada tem os 8 rótulos medidos; 'Campanha' (colide com o canal de marketing) e 'Prótese' (vocabulário de um cliente só) ficaram de fora", () => {
    expect([...AI_LABELS].sort()).toEqual(["Dúvida", "Energia Solar", "Fechamento", "Follow-up", "Não Convertido", "Orçamento", "Prioridade alta", "Óculos de Sol"].sort());
    expect(AI_LABELS).not.toContain("Campanha");
    expect(AI_LABELS).not.toContain("Prótese");
    expect(sanitizeAiLabels(["Campanha", "Prótese", "Orçamento"])).toMatchObject({ rotulos: ["Orçamento"], descartados: ["Campanha", "Prótese"] });
  });

  it("a lista de rótulos da migration é a mesma do código (AI_LABELS)", () => {
    expect(LABELS_IN_SQL()).toEqual([...AI_LABELS]);
  });

  it("[TESTE OBRIGATÓRIO] em TODOS os leads do histórico, o campo novo bate com a tag correspondente", () => {
    const grupos = new Set(before.map((l) => l.dados?.grupo_nome).filter(Boolean));
    const labels = new Set(AI_LABELS);
    const byId = new Map(before.map((l) => [l.id, l]));
    expect(migrated).toHaveLength(before.length);
    expect(migrated.length).toBeGreaterThanOrEqual(N); // a base de 24.655 + o que o Bloco 1 acrescentou
    let comProcedencia = 0;
    let comRotulos = 0;
    for (const l of migrated) {
      const tags = byId.get(l.id).tags || [];
      const esperadoGrupos = [...new Set(tags.filter((t) => grupos.has(t)))].sort();
      const proc = l.dados.procedencia;
      const temSinal = esperadoGrupos.length > 0 || tags.includes("agenda-whatsapp") || tags.includes("WhatsApp WA");
      if (!temSinal) {
        expect(proc).toBeUndefined(); // sem tag de procedência, sem campo
      } else {
        comProcedencia += 1;
        expect(proc.grupos).toEqual(esperadoGrupos);
        expect(proc.agenda_whatsapp).toBe(tags.includes("agenda-whatsapp"));
        expect(proc.conversa_whatsapp).toBe(tags.includes("WhatsApp WA"));
      }
      const esperadoRotulos = tags.filter((t) => labels.has(t));
      if (esperadoRotulos.length === 0) expect(l.dados.rotulos_ia).toBeUndefined();
      else {
        comRotulos += 1;
        expect(l.dados.rotulos_ia).toEqual(esperadoRotulos);
      }
    }
    expect(comProcedencia).toBe(before.filter((l) => (l.tags || []).some((t) => t === "agenda-whatsapp" || t === "WhatsApp WA" || grupos.has(t))).length);
    expect(comProcedencia).toBeGreaterThan(5_000);
    expect(comRotulos).toBe(before.filter((l) => (l.tags || []).some((t) => labels.has(t))).length);
    expect(comRotulos).toBeGreaterThan(300);
  }, SLOW);

  it("NENHUMA tag foi alterada ou removida, e as outras chaves de dados continuam intactas", () => {
    const antes = new Map(before.map((l) => [l.id, l]));
    for (const l of migrated) {
      const a = antes.get(l.id);
      expect(l.tags).toEqual(a.tags);
      for (const [k, v] of Object.entries(a.dados)) expect(l.dados[k]).toEqual(v);
    }
  }, SLOW);

  it("grupo é o nome de um grupo extraído DA MESMA empresa: nome de grupo de outra empresa numa marcação da pessoa não vira procedência", () => {
    const l = migrated.find((x) => (x.tags || []).includes("Grupo da Outra Empresa"));
    expect(l).toBeDefined();
    expect(l.dados.procedencia?.grupos ?? []).toEqual([]);
  });

  it("lead em dois grupos guarda os DOIS (o dados.grupo_nome só guardava o último)", () => {
    const l = migrated.find((x) => (x.tags || []).includes("VP Ofertas") && (x.tags || []).includes("Via Permuta 🇧🇷"));
    expect(l).toBeDefined();
    expect(l.dados.procedencia.grupos).toEqual(["VP Ofertas", "Via Permuta 🇧🇷"].sort());
  });

  it("idempotente: rodar de novo não altera nenhuma linha", async () => {
    const again = await db.query(MIGRATION);
    expect(again.affectedRows).toBe(0);
    const depois = (await db.query(`SELECT id::text AS id, dados FROM leads WHERE client_id = $1`, [T])).rows;
    const m = new Map(migrated.map((l) => [l.id, l.dados]));
    for (const l of depois) expect(l.dados).toEqual(m.get(l.id));
  }, SLOW);

  it("não sobrescreve o que o código novo já gravou: procedência é UNIÃO, rotulos_ia existente é preservado (mesmo quando a procedência do lead muda e a linha é atualizada)", async () => {
    const id = migrated.find((x) => (x.tags || []).includes("Follow-up")).id;
    // o código novo gravou os dois campos; depois o lead ganhou a tag "WhatsApp WA" (a procedência calculada passa a diferir → a linha ENTRA no UPDATE)
    await db.query(
      `UPDATE leads SET tags = tags || ARRAY['WhatsApp WA'], dados = dados || '{"rotulos_ia":["Campanha"],"procedencia":{"grupos":["Grupo Novo"],"agenda_whatsapp":true,"conversa_whatsapp":false}}'::jsonb WHERE id::text = $1`,
      [id]
    );
    const r = await db.query(MIGRATION);
    expect(r.affectedRows).toBeGreaterThanOrEqual(1);
    const l = (await db.query(`SELECT dados FROM leads WHERE id::text = $1`, [id])).rows[0];
    expect(l.dados.rotulos_ia).toEqual(["Campanha"]); // o palpite mais recente não é pisado pelo que as tags dizem (Follow-up)
    expect(l.dados.procedencia.grupos).toContain("Grupo Novo");
    expect(l.dados.procedencia.agenda_whatsapp).toBe(true); // o que já estava
    expect(l.dados.procedencia.conversa_whatsapp).toBe(true); // o que a tag nova diz
  }, SLOW);

  it("o que foi contado: a migration tocou só os leads com algum sinal", () => {
    expect(updated).toBeGreaterThan(0);
    expect(updated).toBeLessThan(N);
  });
});

// ── o que o código grava daqui para frente ──────────────────────────────────────────────────────────────────────────────────
describe("o que o código grava daqui para frente (extração e upsert)", () => {
  it("sanitizeAiLabels: só a lista fechada; 'WhatsApp WA' é procedência; rótulo inventado é descartado", () => {
    const r = sanitizeAiLabels(["Orçamento", "Energia Solar", "Orçamento", "Rótulo Inventado Pela IA", "WhatsApp WA", "", null]);
    expect(r.rotulos).toEqual(["Orçamento", "Energia Solar"]);
    expect(r.conversaWhatsapp).toBe(true);
    expect(r.descartados).toEqual(["Rótulo Inventado Pela IA"]);
    expect(sanitizeAiLabels(undefined)).toEqual({ rotulos: [], descartados: [], conversaWhatsapp: false });
  });

  it("mergeProcedencia acumula grupos e liga as bandeiras (sem perder o anterior)", () => {
    expect(mergeProcedencia(null, null)).toBeNull();
    expect(mergeProcedencia({ grupos: ["A"], agenda_whatsapp: false, conversa_whatsapp: false }, { grupos: ["B", "A"], agenda_whatsapp: true, conversa_whatsapp: false }))
      .toEqual({ grupos: ["A", "B"], agenda_whatsapp: true, conversa_whatsapp: false });
    expect(mergeProcedencia(undefined, { grupos: ["X"], agenda_whatsapp: false, conversa_whatsapp: true })).toEqual({ grupos: ["X"], agenda_whatsapp: false, conversa_whatsapp: true });
  });

  it("upsert real: o lead que aparece num segundo grupo e depois na agenda acumula a procedência (o merge raso de dados a sobrescreveria)", async () => {
    const udb = await createPgliteDb(SCHEMA);
    openDbs.push(udb);
    const upool = { query: (sql, values) => udb.query(sql, values) };
    await udb.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'GD')`);
    const lead = (grupo) => ({ telefone: "5534999990001", phone: "5534999990001", nome: "Ana", tags: [grupo], dados: { grupo_nome: grupo, procedencia: { grupos: [grupo], agenda_whatsapp: false, conversa_whatsapp: false } } });
    await upsertLeadsBatchByPhone(upool, T, [lead("Grupo A")]);
    await upsertLeadsBatchByPhone(upool, T, [lead("Grupo B")]); // existente: atualiza (merge)
    let dados = (await udb.query(`SELECT dados, tags FROM leads WHERE telefone = '5534999990001'`)).rows[0];
    expect(dados.dados.procedencia.grupos).toEqual(["Grupo A", "Grupo B"]);
    expect(dados.dados.grupo_nome).toBe("Grupo B"); // o campo antigo guarda só o último, como sempre
    expect(dados.tags).toEqual(["Grupo A", "Grupo B"]); // as tags continuam acumulando
    await upsertLeadByPhone(upool, T, "5534999990001", { phone: "5534999990001", tags: ["agenda-whatsapp"], dados: { procedencia: { grupos: [], agenda_whatsapp: true, conversa_whatsapp: false } } });
    dados = (await udb.query(`SELECT dados, tags FROM leads WHERE telefone = '5534999990001'`)).rows[0];
    expect(dados.dados.procedencia).toEqual({ grupos: ["Grupo A", "Grupo B"], agenda_whatsapp: true, conversa_whatsapp: false });
    // dois grupos no MESMO lote para o mesmo telefone (dedup em memória)
    await upsertLeadsBatchByPhone(upool, T, [lead("G1"), { ...lead("G2"), telefone: "5534999990002", phone: "5534999990002" }, { ...lead("G3"), telefone: "5534999990002", phone: "5534999990002" }]);
    const dois = (await udb.query(`SELECT dados FROM leads WHERE telefone = '5534999990002'`)).rows[0];
    expect(dois.dados.procedencia.grupos).toEqual(["G2", "G3"]);
  }, SLOW);
});
