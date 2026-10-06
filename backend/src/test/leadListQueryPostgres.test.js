// backend/src/test/leadListQueryPostgres.test.js
//
// Lista de leads do Banco de Dados com filtro, ordenação, contagem e paginação NO BANCO, contra Postgres REAL (pglite) e
// com o serviço do produto (importado, não copiado), numa base de 25.000 leads.
//
// Antes: GET /api/leads devolvia no máximo 2.000 linhas (quando tag/busca derrubavam a consulta, as 2.000 primeiras SEM filtro)
// e a tela refazia filtro, abas e contagens em cima dessas 2.000. Os totais vinham de `select("*")` da tabela inteira.
//
// Os oráculos das regras derivadas são as funções que a TELA e o servidor usam hoje (lib/leadChannels.ts, lib/leads/basePotential.ts,
// temConversaComercial): a SQL tem que dar o mesmo resultado que elas dão — esse é o contrato.
// Limite do pglite: só tem as collations `und-x-icu` e `unicode` (produção tem `pt-BR-x-icu`, mesma ordem que a raiz `und` para o
// português; conferido pela query de paridade do dono, DIRETRIZES §11) — a consulta é a do produto, o teste que se adapta.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  MAX_PAGE_SIZE,
  queryBaseFacets,
  queryCampaignAudience,
  queryCustomKeys,
  queryLeadIds,
  queryLeadsPage,
  iterateLeadsForExport,
  lookupLead,
  validateAudienceRules,
  RULE_COLUMNS,
  activeCollation,
  resolveCollation,
} from "../services/leadListQuery.js";
import { temConversaComercial } from "../services/conversationInsightHelper.js";
import { getLeadMarketingChannelId, getLeadSource } from "../../../frontend/src/lib/leadChannels.ts";
import { getLeadSegment } from "../../../frontend/src/lib/leads/basePotential.ts";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const SLOW = 180_000;
const T = "tenant-a";
const OUTRO = "tenant-b";
const BASE = 25_000;

// tipos como em produção (uuid, text, jsonb, text[], numeric, timestamptz); colunas das migrations + ensureLeadIntelligenceColumns
const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    telefone text NOT NULL, phone text, nome text, tipo_cliente text, faixa_consumo text, cidade text, estado text, status text,
    lead_temperature text, source_campaign_name text, lead_source text, lead_score numeric(8,2), potential_contract_value numeric(14,2),
    lead_origin text, dados jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
    stage text DEFAULT 'cold', temperature text DEFAULT 'warm', tags text[] DEFAULT ARRAY[]::text[], last_interaction_at timestamptz,
    raw_chat_summary text, assigned_to text, UNIQUE (client_id, telefone));
  CREATE INDEX idx_leads_client_id ON leads (client_id);
`;

let db;
let pool;
const scope = { clientId: T };
const openDbs = [];

beforeAll(async () => {
  db = await createPgliteDb(SCHEMA);
  openDbs.push(db);
  pool = { query: (sql, values) => db.query(sql, values) };
  await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'A'), ('${OUTRO}', 'B')`);
  // 25.000 leads com mistura determinística de estágios, tags, origens, nomes com acento e resumos de conversa
  await db.exec(`
    INSERT INTO leads (client_id, telefone, nome, status, stage, temperature, tags, lead_source, dados, raw_chat_summary, potential_contract_value, assigned_to, created_at)
    SELECT '${T}', '55' || lpad(i::text, 11, '0'),
      (ARRAY['Ana','ângela','Zélia','Álvaro','Érica','Çaio','joão','JOÃO','Bruna','bruno','Ítalo','Ônix','Úrsula','Carlos','Édson','Eduardo'])[1 + i % 16] || ' ' || i,
      CASE WHEN i % 29 = 0 THEN 'orcamento' END,
      (ARRAY['buyer','open_budget','cold','lost','inquiry',NULL,'cold','cold'])[1 + i % 8],
      (ARRAY['hot','warm','cold'])[1 + i % 3],
      CASE WHEN i % 7 = 0 THEN ARRAY['vip','evento'] WHEN i % 11 = 0 THEN ARRAY['vip'] WHEN i % 13 = 0 THEN ARRAY['Instagram-ads'] ELSE ARRAY[]::text[] END,
      (ARRAY['campanha','organico','Google Ads','Indicação',NULL,'whatsapp_ads','importacao_planilha','Importação Vendas Fechadas','Facebook Ads','outro'])[1 + i % 10],
      CASE WHEN i % 17 = 0 THEN jsonb_build_object('origem_marketing', 'TikTok') WHEN i % 19 = 0 THEN jsonb_build_object('origem', 'site', 'resumo_chat', 'Quer proposta de energia solar') ELSE '{}'::jsonb END,
      (ARRAY['Quer proposta de energia solar',NULL,'🚫 conversa pessoal','',E'  \\n ','Pediu orçamento'])[1 + i % 6],
      CASE WHEN i % 4 = 1 THEN 1000 + i END,
      CASE WHEN i % 5 = 0 THEN 'gabriel' WHEN i % 5 = 1 THEN 'priscila' END,
      timestamptz '2026-01-01' + (i || ' minutes')::interval
      FROM generate_series(1, ${BASE}) AS i;
    INSERT INTO leads (client_id, telefone, nome, stage, tags) SELECT '${OUTRO}', '5599' || lpad(i::text, 9, '0'), 'Outro ' || i, 'buyer', ARRAY['vip'] FROM generate_series(1, 300) AS i;
  `);
}, SLOW);

afterAll(async () => {
  for (const d of openDbs) await d.close();
});

const count = async (where, values = []) => (await db.query(`SELECT count(*)::int AS n FROM leads WHERE client_id = '${T}' AND (${where})`, values)).rows[0].n;

describe("Página, total e contagens do banco (base de 25.000)", () => {
  it("a base tem 25.000 leads e a página 1 devolve o tamanho pedido com o total real", async () => {
    const r = await queryLeadsPage(pool, { scope, page: 1, limit: 50 });
    expect(r.items).toHaveLength(50);
    expect(r.total).toBe(BASE);
    expect(r.totalPages).toBe(500);
    // ordem padrão: mais recente primeiro
    expect(new Date(r.items[0].created_at) >= new Date(r.items[49].created_at)).toBe(true);
    expect(r.items[0].nome).toMatch(/ 25000$/);
  }, SLOW);

  it("a última página é a parcial e a página além do fim vem vazia, sem repetir linha", async () => {
    const last = await queryLeadsPage(pool, { scope, page: 500, limit: 50 });
    expect(last.items).toHaveLength(50);
    const beyond = await queryLeadsPage(pool, { scope, page: 501, limit: 50 });
    expect(beyond.items).toHaveLength(0);
    expect(beyond.total).toBe(BASE);
    const a = await queryLeadsPage(pool, { scope, page: 3, limit: 100 });
    const b = await queryLeadsPage(pool, { scope, page: 4, limit: 100 });
    const ids = new Set([...a.items, ...b.items].map((x) => x.id));
    expect(ids.size).toBe(200);
  }, SLOW);

  it("o tamanho da página tem teto", async () => {
    const r = await queryLeadsPage(pool, { scope, page: 1, limit: 999_999 });
    expect(r.limit).toBe(MAX_PAGE_SIZE);
    expect(r.items).toHaveLength(MAX_PAGE_SIZE);
  }, SLOW);

  it("filtro por tag devolve o total REAL da tag (não o da página) e só leads da tag", async () => {
    const real = await count(`'vip' = ANY(tags)`);
    expect(real).toBeGreaterThan(2000); // acima do antigo teto
    const r = await queryLeadsPage(pool, { scope, filters: { tag: "vip" }, page: 1, limit: 50 });
    expect(r.total).toBe(real);
    expect(r.items).toHaveLength(50);
    expect(r.items.every((x) => x.tags.includes("vip"))).toBe(true);
  }, SLOW);

  it("busca por nome, telefone e resumo, sem diferenciar caixa nem acento de maiúscula", async () => {
    const porNome = await queryLeadsPage(pool, { scope, filters: { search: "ÂNGELA 16" }, limit: 50 });
    const nomes = (await db.query(`SELECT nome FROM leads WHERE client_id = '${T}'`)).rows.map((r) => r.nome);
    expect(porNome.total).toBe(nomes.filter((n) => n.toLowerCase().includes("ângela 16")).length);
    expect(porNome.items.every((x) => x.nome.toLowerCase().includes("ângela 16"))).toBe(true);
    const exato = await queryLeadsPage(pool, { scope, filters: { search: "ÂNGELA 16993" }, limit: 50 });
    expect(exato.items.map((x) => x.nome)).toEqual(["ângela 16993"]);
    const porFone = await queryLeadsPage(pool, { scope, filters: { search: "00000000012" }, limit: 50 });
    expect(porFone.total).toBe(await count(`telefone LIKE '%00000000012%'`));
    const porResumo = await queryLeadsPage(pool, { scope, filters: { search: "ORÇAMENTO" }, limit: 50 });
    expect(porResumo.total).toBe(await count(`raw_chat_summary ILIKE '%orçamento%'`));
  }, SLOW);

  it("busca trata % e _ como texto comum", async () => {
    const r = await queryLeadsPage(pool, { scope, filters: { search: "%" }, limit: 50 });
    expect(r.total).toBe(0);
    const u = await queryLeadsPage(pool, { scope, filters: { search: "_" }, limit: 50 });
    expect(u.total).toBe(0);
  }, SLOW);

  it("as contagens das abas são as do banco (COUNT) e coincidem com o total sem filtro", async () => {
    const r = await queryLeadsPage(pool, { scope, page: 1, limit: 50 });
    expect(r.tabs.all).toBe(BASE);
    expect(r.tabs.buyer).toBe(await count(`stage = 'buyer'`));
    expect(r.tabs.open_budget).toBe(await count(`stage = 'open_budget'`));
    expect(r.tabs.lost).toBe(await count(`stage = 'lost'`));
    expect(r.tabs.cold).toBe(await count(`stage IS NULL OR stage NOT IN ('buyer','open_budget','lost')`));
    expect(r.tabs.buyer + r.tabs.open_budget + r.tabs.lost + r.tabs.cold).toBe(BASE); // o complemento fecha a conta
  }, SLOW);

  it("as abas contam DENTRO do filtro ativo de tag e busca; o total da lista é a combinação", async () => {
    const r = await queryLeadsPage(pool, { scope, filters: { tag: "vip", stage: "buyer" }, limit: 50 });
    expect(r.tabs.all).toBe(await count(`'vip' = ANY(tags)`));
    expect(r.tabs.buyer).toBe(await count(`'vip' = ANY(tags) AND stage = 'buyer'`));
    expect(r.tabs.cold).toBe(await count(`'vip' = ANY(tags) AND (stage IS NULL OR stage NOT IN ('buyer','open_budget','lost'))`));
    expect(r.total).toBe(r.tabs.buyer); // estágio ativo = aba ativa
    const s = await queryLeadsPage(pool, { scope, filters: { search: "carlos", tag: "vip", stage: "lost" }, limit: 50 });
    expect(s.tabs.all).toBe(await count(`'vip' = ANY(tags) AND nome ILIKE '%carlos%'`));
    expect(s.total).toBe(await count(`'vip' = ANY(tags) AND nome ILIKE '%carlos%' AND stage = 'lost'`));
  }, SLOW);

  it("'Leads Frios' é o complemento (comprador, orçamento aberto e perdido ficam fora; nulo e 'inquiry' entram)", async () => {
    const r = await queryLeadsPage(pool, { scope, filters: { stage: "cold" }, limit: 500 });
    expect(r.total).toBe(await count(`stage IS NULL OR stage NOT IN ('buyer','open_budget','lost')`));
    expect(r.items.some((x) => x.stage === "inquiry")).toBe(true);
    expect(r.items.some((x) => x.stage === null)).toBe(true);
    expect(r.items.every((x) => !["buyer", "open_budget", "lost"].includes(x.stage))).toBe(true);
  }, SLOW);

  it("os cartões de origem somam a base inteira e são a base inteira mesmo com filtro ativo", async () => {
    const f = await queryBaseFacets(pool, scope);
    const soma = Object.values(f.channels).reduce((a, b) => a + b, 0);
    expect(soma).toBe(BASE);
    expect(f.baseTotal).toBe(BASE);
    expect(f.sources.reduce((a, s) => a + s.count, 0)).toBe(BASE);
    expect(f.summary.totalLeads).toBe(BASE);
    const filtrada = await queryLeadsPage(pool, { scope, filters: { tag: "vip" }, limit: 50 });
    const f2 = await queryBaseFacets(pool, scope); // não depende de filtro: a base é a base
    expect(f2.channels).toEqual(f.channels);
    expect(filtrada.total).toBeLessThan(BASE);
  }, SLOW);

  it("faixas do Potencial fecham: comprador + perdido + 3 faixas = base", async () => {
    const { summary: s } = await queryBaseFacets(pool, scope);
    expect(s.buyersCount + s.lostCount + s.inNegotiationCount + s.inConversationCount + s.neverContactedCount).toBe(BASE);
    expect(s.activeLeadsCount).toBe(s.inNegotiationCount + s.inConversationCount + s.neverContactedCount);
  }, SLOW);

  it("os totais por tag da base (para o seletor) batem com a contagem do banco", async () => {
    const f = await queryBaseFacets(pool, scope);
    const vip = f.tags.find((t) => t.tag === "vip");
    expect(vip.count).toBe(await count(`'vip' = ANY(tags)`));
  }, SLOW);

  it("isolamento por empresa: outro tenant nunca entra no total, na página nem nos cartões", async () => {
    const outro = await queryLeadsPage(pool, { scope: { clientId: OUTRO }, limit: 50 });
    expect(outro.total).toBe(300);
    expect(outro.items.every((x) => x.client_id === OUTRO)).toBe(true);
    const f = await queryBaseFacets(pool, { clientId: OUTRO });
    expect(f.baseTotal).toBe(300);
    const ids = await queryLeadIds(pool, { scope, filters: { tag: "vip" } });
    expect(ids.total).toBe(await count(`'vip' = ANY(tags)`));
  }, SLOW);

  it("escopo do operador: vê os seus e os sem dono; responsável filtra para usuário interno", async () => {
    const op = await queryLeadsPage(pool, { scope: { clientId: T, operatorIdentifiers: ["gabriel"] }, limit: 50 });
    expect(op.total).toBe(await count(`assigned_to = 'gabriel' OR assigned_to IS NULL`));
    const resp = await queryLeadsPage(pool, { scope: { clientId: T, assignedTo: "priscila" }, limit: 50 });
    expect(resp.total).toBe(await count(`assigned_to = 'priscila'`));
    const fc = await queryBaseFacets(pool, { clientId: T, operatorIdentifiers: ["gabriel"] });
    expect(fc.baseTotal).toBe(op.total);
  }, SLOW);

  it("ids por filtro devolvem TODOS os ids da combinação (acima do teto antigo), sem repetir", async () => {
    const r = await queryLeadIds(pool, { scope, filters: { stage: "cold" } });
    expect(r.truncated).toBe(false);
    expect(r.total).toBe(await count(`stage IS NULL OR stage NOT IN ('buyer','open_budget','lost')`));
    expect(new Set(r.ids).size).toBe(r.ids.length);
    expect(r.total).toBeGreaterThan(2000);
  }, SLOW);

  it("exportação percorre a combinação INTEIRA em blocos (sem o teto de 5.000)", async () => {
    let n = 0;
    const seen = new Set();
    for await (const bloco of iterateLeadsForExport(pool, { scope, filters: { stage: "all" }, blockSize: 4000 })) {
      for (const row of bloco) {
        seen.add(row.id);
        n += 1;
      }
    }
    expect(n).toBe(BASE);
    expect(seen.size).toBe(BASE);
  }, SLOW);

  it("abrir lead por id ou por telefone acha lead que NÃO está na página carregada", async () => {
    const velho = (await db.query(`SELECT id, telefone FROM leads WHERE client_id = '${T}' ORDER BY created_at ASC LIMIT 1`)).rows[0];
    const porId = await lookupLead(pool, { scope, leadId: velho.id });
    expect(porId.telefone).toBe(velho.telefone);
    const porFone = await lookupLead(pool, { scope, phoneVariants: [velho.telefone, "000"] });
    expect(porFone.id).toBe(velho.id);
    expect(await lookupLead(pool, { scope: { clientId: OUTRO }, leadId: velho.id })).toBeNull(); // outro tenant não abre
  }, SLOW);

  it("colunas personalizadas presentes na combinação de filtros", async () => {
    await db.exec(`UPDATE leads SET dados = jsonb_build_object('campos', jsonb_build_object('Plano', 'ouro', 'Idade', '30')) WHERE client_id = '${T}' AND telefone = '55${"1".padStart(11, "0")}'`);
    const keys = await queryCustomKeys(pool, { scope, filters: {} });
    expect(keys).toEqual(["Idade", "Plano"]);
  }, SLOW);
});

// ── paridade das regras derivadas com as funções da tela/servidor ────────────────────────────────────────────────────────
const CORPUS_ORIGEM = [
  "instagram", "Instagram Direct", "insta", "Google Ads", "google", "gads", "Pesquisa", "facebook ads", "Facebook", "messenger", "face",
  "TikTok", "tt", "ttk", "indicacao", "Indicação", "amigo", "referral", "importacao_planilha", "Importação de planilha", "vendas_fechadas",
  "Importação Vendas Fechadas", "IA Direct/Chat", "campanha", "Campanha de Natal", "trafego_pago", "tráfego", "Tráfego Pago", "whatsapp_ads",
  "WhatsApp Ads", "whatsapp", "WhatsApp (agenda)", "inbound", "zap", "organico", "Orgânico", "formulário", "site", "landing page", "outro",
  "  Instagram  ", " google ", "ÍNDICA", "", "xyz", "LinkedIn", "Face a face",
];
const CORPUS_TAGS = [[], ["vip"], ["Instagram-ads"], ["FACEBOOK"], ["messenger-x"], ["tiktok"], ["LinkedIn"], ["vip", "Instagram"], null];

describe("Paridade: a SQL dá o mesmo que getLeadSource / getLeadMarketingChannelId / getLeadSegment / temConversaComercial", () => {
  let pdb;
  let ppool;
  let leads = [];

  beforeAll(async () => {
    pdb = await createPgliteDb(SCHEMA);
    openDbs.push(pdb);
    ppool = { query: (sql, values) => pdb.query(sql, values) };
    await pdb.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'A')`);
    const stages = ["buyer", "lost", "open_budget", "cold", "inquiry", null];
    const statuses = [null, "orcamento", "novo"];
    const summaries = [null, "", "   ", " \n\t ", "🚫 pessoal", "  🚫 com espaço antes", "conversa comercial real", " texto ", "a🚫b"];
    const dadosVariants = [{}, { origem_marketing: "TikTok" }, { origem: "site" }, { origem_marketing: "Google Ads", origem: "x" }, { resumo_chat: "Resumo no jsonb" }, { resumo_chat: "🚫 pessoal no jsonb" }, { resumo_chat: 42 }, { resumo_chat: { a: 1 } }, { resumo_chat: "   " }];
    let i = 0;
    for (const origem of CORPUS_ORIGEM) {
      for (const tags of CORPUS_TAGS) {
        i += 1;
        leads.push({
          telefone: `5511${String(i).padStart(9, "0")}`,
          nome: `Lead ${i}`,
          stage: stages[i % stages.length],
          status: statuses[i % statuses.length],
          tags,
          lead_source: origem === "" ? (i % 2 ? null : "") : origem,
          raw_chat_summary: summaries[i % summaries.length],
          dados: dadosVariants[i % dadosVariants.length],
        });
      }
    }
    for (const l of leads) {
      await pdb.query(
        `INSERT INTO leads (client_id, telefone, nome, stage, status, tags, lead_source, raw_chat_summary, dados) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [T, l.telefone, l.nome, l.stage, l.status, l.tags, l.lead_source, l.raw_chat_summary, JSON.stringify(l.dados)]
      );
    }
    // o que a API devolve (e a tela lê): linhas do banco
    leads = (await pdb.query(`SELECT * FROM leads WHERE client_id = '${T}'`)).rows;
  }, SLOW);

  const idsDe = async (filters) => new Set((await queryLeadIds(ppool, { scope, filters })).ids);
  const esperado = (fn) => new Set(leads.filter(fn).map((l) => l.id));
  const igual = (a, b) => expect([...a].sort()).toEqual([...b].sort());

  it("corpus cobre todos os cartões de origem", () => {
    const cobertos = new Set(leads.map(getLeadMarketingChannelId));
    for (const id of ["instagram", "google", "facebook", "tiktok", "indicacao", "importacao_planilha", "vendas_fechadas", "texto_avulso", "campanha", "trafego_pago", "whatsapp", "organico", "nao_identificada"]) {
      expect(cobertos.has(id)).toBe(true);
    }
  });

  it("canal de marketing (cartão) igual ao getLeadMarketingChannelId, para cada cartão", async () => {
    for (const id of new Set(leads.map(getLeadMarketingChannelId))) {
      igual(await idsDe({ channel: id }), esperado((l) => getLeadMarketingChannelId(l) === id));
    }
  }, SLOW);

  it("origem (lista de origens) igual ao getLeadSource, para cada origem distinta", async () => {
    for (const src of new Set(leads.map(getLeadSource))) {
      igual(await idsDe({ source: src }), esperado((l) => getLeadSource(l) === src));
    }
    const f = await queryBaseFacets(ppool, scope);
    const jsCont = new Map();
    for (const l of leads) jsCont.set(getLeadSource(l), (jsCont.get(getLeadSource(l)) || 0) + 1);
    expect(Object.fromEntries(f.sources.map((s) => [s.source, s.count]))).toEqual(Object.fromEntries(jsCont));
  }, SLOW);

  it("faixa do Potencial igual ao getLeadSegment (e comprador/perdido fora das faixas)", async () => {
    for (const seg of ["never_contacted", "in_conversation", "in_negotiation"]) {
      igual(await idsDe({ segment: seg }), esperado((l) => getLeadSegment(l) === seg));
    }
    const { summary } = await queryBaseFacets(ppool, scope);
    expect(summary.inConversationCount).toBe(leads.filter((l) => getLeadSegment(l) === "in_conversation").length);
    expect(summary.neverContactedCount).toBe(leads.filter((l) => getLeadSegment(l) === "never_contacted").length);
  }, SLOW);

  it("resumo da base igual à transcrição do cálculo antigo em JavaScript (temConversaComercial)", async () => {
    // transcrição de GET /api/leads antes desta mudança
    const buyers = leads.filter((l) => l.stage === "buyer").length;
    const lost = leads.filter((l) => l.stage === "lost").length;
    const ne = leads.filter((l) => l.stage !== "buyer" && l.stage !== "lost");
    const neg = ne.filter((l) => l.stage === "open_budget" || l.status === "orcamento");
    const after = ne.filter((l) => !(l.stage === "open_budget" || l.status === "orcamento"));
    const conv = after.filter((l) => temConversaComercial(l));
    const nunca = after.filter((l) => !temConversaComercial(l));
    const f = await queryBaseFacets(ppool, scope);
    expect(f.summary).toMatchObject({
      totalLeads: leads.length, buyersCount: buyers, lostCount: lost, openBudgetsCount: neg.length, inNegotiationCount: neg.length,
      inConversationCount: conv.length, neverContactedCount: nunca.length, activeLeadsCount: neg.length + conv.length + nunca.length,
    });
  }, SLOW);

  // Corpus: acento, cedilha, caixa mista e PARES QUE SÓ DIFEREM POR MAIÚSCULA (onde o lower() empatava e o desempate era arbitrário).
  // O oráculo é o localeCompare puro, sem lower(): a ICU trata caixa no nível terciário e não empata. As 12 últimas são o corpus da medição
  // de produção (pt-BR-x-icu); a ordem fixa de produção SEM lower() entra aqui quando o dono trouxer a medição (query em
  // docs/DIAGNOSTICO-LISTA-LEADS-SQL.md).
  const CORPUS_ORDEM = ["Ana", "ângela", "Zélia", "Álvaro", "Érica", "Çaio", "Caio", "cesar", "João", "JOÃO", "joao", "Bruna", "bruno", "Ítalo", "Ícaro", "Ônix", "Úrsula", "Édson", "Eduardo", "ébano", "zeca", "Zoé", "ana maria", "Ana Maria", "José", "Jose", "josé", "Ñandú", "Nuno", "Östen", "Oscar", "d'Ávila", "da Silva", "De Paula", "-traco", "", "ß", "ss",
    "Ácaro", "alvaro", "ana", "Cesar", "Çesar", "Eder", "Éder", "Óscar", "Zoe"];

  async function ordemPorNome(nomes, { dir, embaralhar = false }) {
    const odb = await createPgliteDb(SCHEMA);
    openDbs.push(odb);
    const opool = { query: (sql, values) => odb.query(sql, values) };
    await odb.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'A')`);
    for (const [i, nome] of nomes.entries()) {
      const minuto = embaralhar ? (i * 7) % nomes.length : i; // muda quem é mais novo, para provar que o par Ana/ana não depende da data
      await odb.query(`INSERT INTO leads (client_id, telefone, nome, created_at) VALUES ($1,$2,$3, timestamptz '2026-01-01' + ($4 || ' minutes')::interval)`, [T, `55${i}`, nome, String(minuto)]);
    }
    const sql = (await queryLeadsPage(opool, { scope, sort: "contato", dir, page: 1, limit: 500, withTabs: false })).items.map((l) => l.nome);
    const rows = (await odb.query(`SELECT * FROM leads`)).rows;
    return { sql, rows };
  }

  it("ordem por nome igual ao localeCompare (SEM lower): acento, cedilha, caixa mista", async () => {
    for (const locale of [undefined, "pt-BR"]) {
      for (const dir of ["asc", "desc"]) {
        const { sql, rows } = await ordemPorNome(CORPUS_ORDEM, { dir });
        // lista por created_at desc (como a tela recebia), sort estável por nome com localeCompare puro
        const porData = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const js = [...porData].sort((a, b) => {
          const cmp = (a.nome || "").localeCompare(b.nome || "", locale);
          return dir === "asc" ? cmp : -cmp;
        }).map((l) => l.nome);
        expect(sql).toEqual(js);
      }
    }
  }, SLOW);

  it("nomes que só diferem por maiúscula NÃO empatam: a ordem entre eles é a da collation, não a da data nem a do id", async () => {
    const pares = [["Ana", "ana"], ["Ana Maria", "ana maria"], ["João", "JOÃO"], ["José", "josé"], ["Cesar", "cesar"], ["Éder", "éder"]];
    const nomes = pares.flat().concat(["Eder"]);
    const a = await ordemPorNome(nomes, { dir: "asc" });
    const b = await ordemPorNome(nomes, { dir: "asc", embaralhar: true }); // outra data de criação para cada um
    expect(b.sql).toEqual(a.sql);
    for (const [x, y] of pares) {
      const esperado = x.localeCompare(y) < 0 ? [x, y] : [y, x];
      expect(a.sql.filter((n) => n === x || n === y)).toEqual(esperado);
    }
  }, SLOW);

  it("ordem por última conversa: data da interação, senão a de criação; empate pela mais nova", async () => {
    const asc = await queryLeadsPage(ppool, { scope, sort: "ultima_conversa", dir: "asc", page: 1, limit: 10, withTabs: false });
    const desc = await queryLeadsPage(ppool, { scope, sort: "ultima_conversa", dir: "desc", page: 1, limit: 10, withTabs: false });
    const t = (l) => new Date(l.last_interaction_at || l.created_at).getTime();
    for (let k = 1; k < asc.items.length; k += 1) expect(t(asc.items[k]) >= t(asc.items[k - 1])).toBe(true);
    for (let k = 1; k < desc.items.length; k += 1) expect(t(desc.items[k]) <= t(desc.items[k - 1])).toBe(true);
  }, SLOW);

  // ── regras dinâmicas ────────────────────────────────────────────────────────────────────────────────────────────────
  // transcrição de applyDynamicRules (BancoDeDados.tsx) para uma linha com valor escalar
  const jsRule = (row, rule) => {
    const valStr = String(row[rule.column] ?? "").trim().toLowerCase();
    const ruleVal = rule.value.trim().toLowerCase();
    if (rule.operator === "equals") return valStr === ruleVal;
    if (rule.operator === "contains") return valStr.includes(ruleVal);
    const num = parseFloat(valStr.replace(/[^\d\.,-]/g, "").replace(",", "."));
    const ruleNum = parseFloat(ruleVal);
    if (rule.operator === "gt") return !isNaN(num) && !isNaN(ruleNum) && num > ruleNum;
    return !isNaN(num) && !isNaN(ruleNum) && num < ruleNum;
  };

  describe("regras dinâmicas (campos escalares)", () => {
    let rdb;
    let rpool;
    let rrows;
    const CIDADES = ["São Paulo", " são paulo ", "Rio de Janeiro", "CURITIBA", null, "", "Belo Horizonte", "São José"];
    const VALORES = [1500, 20, 999.5, null, 0, 100, 7000.25, 3];

    beforeAll(async () => {
      rdb = await createPgliteDb(SCHEMA);
      openDbs.push(rdb);
      rpool = { query: (sql, values) => rdb.query(sql, values) };
      await rdb.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'A')`);
      for (let i = 0; i < 64; i += 1) {
        await rdb.query(
          `INSERT INTO leads (client_id, telefone, nome, cidade, potential_contract_value, faixa_consumo, stage, tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [T, `55${String(i).padStart(9, "0")}`, `L${i}`, CIDADES[i % 8], VALORES[i % 8], ["R$ 1.500,50", "2000", "abc", "-5", "1,5", "1.5.3", ".5", "5 mil", "1e5", "", null, "R$ 99,90"][i % 12], ["buyer", "cold", "inquiry", "open_budget"][i % 4], i % 3 === 0 ? ["vip"] : []]
        );
      }
      rrows = (await rdb.query(`SELECT * FROM leads`)).rows;
    }, SLOW);

    const casos = [
      { column: "cidade", operator: "equals", value: "são paulo" },
      { column: "cidade", operator: "equals", value: "  SÃO PAULO " },
      { column: "cidade", operator: "contains", value: "são" },
      { column: "cidade", operator: "contains", value: "" },
      { column: "cidade", operator: "contains", value: "ZZ" },
      { column: "potential_contract_value", operator: "gt", value: "1000" },
      { column: "potential_contract_value", operator: "lt", value: "100" },
      { column: "potential_contract_value", operator: "gt", value: "abc" },
      { column: "potential_contract_value", operator: "gt", value: "999,5" },
      { column: "faixa_consumo", operator: "gt", value: "1000" },
      { column: "faixa_consumo", operator: "lt", value: "2" },
      { column: "faixa_consumo", operator: "gt", value: "0" },
      { column: "faixa_consumo", operator: "gt", value: "1" }, // "1,5" só passa se a vírgula virar ponto (como a tela)
      { column: "faixa_consumo", operator: "gt", value: "1000" },
      { column: "faixa_consumo", operator: "lt", value: "-10" },
      { column: "faixa_consumo", operator: "equals", value: "abc" },
      { column: "faixa_consumo", operator: "contains", value: "mil" },
    ];

    it.each(casos)("regra %j devolve exatamente o que a tela devolvia", async (rule) => {
      const r = await queryCampaignAudience(rpool, { scope, rules: [rule] });
      const esperados = rrows.filter((l) => jsRule(l, rule)).map((l) => l.id).sort();
      expect(r.items.map((l) => l.id).sort()).toEqual(esperados);
      expect(r.total).toBe(esperados.length);
    }, SLOW);

    it("estágios (igualdade exata, ausência = todos), tag e regras combinam em E", async () => {
      const rule = { column: "cidade", operator: "contains", value: "são" };
      const r = await queryCampaignAudience(rpool, { scope, stages: ["buyer", "inquiry"], tag: "vip", rules: [rule] });
      const esperados = rrows.filter((l) => ["buyer", "inquiry"].includes(l.stage) && l.tags.includes("vip") && jsRule(l, rule)).map((l) => l.id).sort();
      expect(r.items.map((l) => l.id).sort()).toEqual(esperados);
      const todos = await queryCampaignAudience(rpool, { scope, stages: ["all"], rules: [] });
      expect(todos.total).toBe(rrows.length);
      const vazio = await queryCampaignAudience(rpool, { scope, stages: [] });
      expect(vazio.total).toBe(rrows.length);
      // 'cold' como estágio da campanha é IGUALDADE (stage = 'cold'), não o complemento da aba — como a tela sempre fez
      const frios = await queryCampaignAudience(rpool, { scope, stages: ["cold"] });
      expect(frios.items.every((l) => l.stage === "cold")).toBe(true);
    }, SLOW);

    it("regra com coluna que não é escalar é recusada com o motivo (nunca devolve vazio calado)", () => {
      const problemas = validateAudienceRules([
        { column: "cidade", operator: "equals", value: "x" },
        { column: "dados", operator: "contains", value: "x" },
        { column: "tags", operator: "equals", value: "vip" },
        { column: "cidade", operator: "regex", value: "x" },
        { column: "", operator: "equals", value: "x" },
        { column: "id; DROP TABLE leads", operator: "equals", value: "x" },
      ]);
      expect(problemas.map((p) => [p.index, p.reason])).toEqual([[1, "COLUMN_NOT_SUPPORTED"], [2, "COLUMN_NOT_SUPPORTED"], [3, "OPERATOR_NOT_SUPPORTED"], [5, "COLUMN_NOT_SUPPORTED"]]);
      expect(problemas[0].message).toMatch(/dados/);
      expect(RULE_COLUMNS).not.toContain("dados");
      expect(RULE_COLUMNS).not.toContain("tags");
    });
  });
});

// ── collation: pt-BR quando o banco tem, senão a raiz ─────────────────────────────────────────────────────────────────────
describe("collation de texto (nome, busca, origem)", () => {
  // pool de mentira que responde a pergunta das collations e registra o SQL que o produto monta (não executa: o pglite não tem pt-BR)
  const fakePool = (collnames, { fail = false } = {}) => {
    const sqls = [];
    return {
      sqls,
      query: async (sql, values) => {
        sqls.push(String(sql));
        if (/FROM pg_collation/.test(sql)) {
          if (fail) throw new Error("permission denied for pg_collation");
          return { rows: collnames.map((collname) => ({ collname })) };
        }
        return { rows: [{ n: 0, id: "x" }] };
      },
    };
  };
  const pageSql = (pool) => pool.sqls.find((q) => /ORDER BY/.test(q) && /LIMIT/.test(q) && !/count\(\*\)/.test(q));

  it("produção (tem pt-BR-x-icu): usa pt-BR em lower(), busca e ORDER BY, e nada de und-x-icu", async () => {
    const pool = fakePool(["pt-BR-x-icu", "und-x-icu"]);
    await queryLeadsPage(pool, { scope, filters: { search: "ana" }, sort: "contato", dir: "asc", page: 1, limit: 10, withTabs: false });
    const sql = pageSql(pool);
    expect(sql).toContain('COLLATE "pt-BR-x-icu"');
    expect(sql).not.toContain("und-x-icu");
    expect(activeCollation()).toBe('"pt-BR-x-icu"');
  });

  it("banco só com a raiz (pglite dos testes): usa und-x-icu", async () => {
    const pool = fakePool(["und-x-icu"]);
    await queryLeadsPage(pool, { scope, sort: "contato", page: 1, limit: 10, withTabs: false });
    expect(pageSql(pool)).toContain('COLLATE "und-x-icu"');
    expect(pageSql(pool)).not.toContain("pt-BR-x-icu");
  });

  it("não consegue consultar pg_collation: cai na raiz (e a consulta que falhar vira 'degradado' na rota), sem travar", async () => {
    const pool = fakePool([], { fail: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await queryLeadsPage(pool, { scope, sort: "contato", page: 1, limit: 10, withTabs: false });
    expect(pageSql(pool)).toContain('COLLATE "und-x-icu"');
  });

  it("a resposta é guardada por pool: pergunta uma vez só", async () => {
    const pool = fakePool(["pt-BR-x-icu"]);
    await resolveCollation(pool);
    await resolveCollation(pool);
    await queryLeadsPage(pool, { scope, page: 1, limit: 10, withTabs: false });
    expect(pool.sqls.filter((q) => /FROM pg_collation/.test(q))).toHaveLength(1);
  });
});
