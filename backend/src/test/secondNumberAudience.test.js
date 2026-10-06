// backend/src/test/secondNumberAudience.test.js
//
// Bloco B — "tentar o número adicional de quem não respondeu", em Postgres REAL (pglite) com a base medida em produção (24.655 leads).
// Cada regra do público tem um teste que MORRE se a regra for removida (prova por mutação, uma por regra, ver relatório da leva).
//
// Mundo do teste: uma campanha "Camp A" enviada ao telefone principal de TODOS os leads da base (24.655 runs 'sent'); em volta dela, ~20 leads
// de cenário (G1…G17) com adicionais, respostas e casos de borda; mais ~5.000 respostas em massa para o tempo ser o de produção.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { inserirBase, montaBase } from "./helpers/leadBaseGd.js";
import {
  listSecondNumberCampaigns,
  querySecondNumberAudience,
  SecondNumberInputError,
  SECOND_NUMBER_BUCKETS,
} from "../services/secondNumberAudience.js";
import { buildMessageEffectivenessSql, MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS } from "../services/messageEffectiveness.js";

const SLOW = 300_000;
const T = "geracao-digital";
const OUTRO = "outra-empresa";
const NOW = "2026-10-06T12:00:00Z";
const DIA = 86_400_000;
const ago = (days) => new Date(new Date(NOW).getTime() - days * DIA).toISOString();
const scope = { clientId: T };

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    telefone text NOT NULL, phone text, nome text, status text, stage text DEFAULT 'cold', temperature text DEFAULT 'warm', lead_temperature text,
    tags text[] DEFAULT ARRAY[]::text[], dados jsonb NOT NULL DEFAULT '{}'::jsonb, lead_source text, potential_contract_value numeric(14,2),
    raw_chat_summary text, last_interaction_at timestamptz, assigned_to text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz DEFAULT now(),
    UNIQUE (client_id, telefone));
  CREATE TABLE campaigns (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, name text NOT NULL, analytics_meta jsonb,
    last_triggered_at timestamptz, created_at timestamptz DEFAULT now());
  CREATE TABLE campaign_dispatches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, client_id text NOT NULL);
  CREATE TABLE campaign_dispatch_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id uuid NOT NULL REFERENCES campaign_dispatches(id) ON DELETE CASCADE,
    campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, client_id text NOT NULL, phone text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')), error_message text, sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), lead_id uuid);
  CREATE TABLE lead_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, lead_id uuid, phone text, direction text,
    engagement_signal text, message_timestamp timestamptz, delivered_at timestamptz, created_at timestamptz DEFAULT now(), is_group boolean);
  CREATE INDEX idx_dispatch_runs_phone ON campaign_dispatch_runs (client_id, phone);
  CREATE INDEX idx_lead_messages_phone ON lead_messages (client_id, phone);
`;

let db;
let pool;
let campA;
let campB;
let dispA;
let dispB;
let G; // leads de cenário, por chave
let baseResult;
let baseMs = 0;
const openDbs = [];

const q = async (sql, values = []) => (await db.query(sql, values)).rows;
const um = async (sql, values = []) => (await q(sql, values))[0];
const principal = (i) => `55${String(i).padStart(11, "0")}`;

async function criaCampanha(nome, client = T) {
  const c = (await um(`INSERT INTO campaigns (client_id, name) VALUES ($1, $2) RETURNING id::text AS id`, [client, nome])).id;
  const d = (await um(`INSERT INTO campaign_dispatches (campaign_id, client_id) VALUES ($1, $2) RETURNING id::text AS id`, [c, client])).id;
  return { c, d };
}
const run = (camp, disp, phone, sentAt, { status = "sent", client = T } = {}) =>
  db.query(`INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, phone, status, sent_at) VALUES ($1, $2, $3, $4, $5, $6)`, [disp, camp, client, phone, status, sentAt]);
const msg = (phone, direction, at, { client = T, signal = null, leadId = null } = {}) =>
  db.query(`INSERT INTO lead_messages (client_id, lead_id, phone, direction, engagement_signal, message_timestamp) VALUES ($1, $2, $3, $4, $5, $6)`, [client, leadId, phone, direction, signal, at]);

/** cria um lead de cenário com telefone principal único e extras; devolve { id, tel } */
let seq = 90_000;
async function lead(nome, extras = [], { client = T, assignedTo = null } = {}) {
  seq += 1;
  const tel = principal(seq);
  const dados = extras.length ? { telefones_extras: extras } : {};
  const r = await um(`INSERT INTO leads (client_id, telefone, nome, dados, assigned_to) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id::text AS id`, [client, tel, nome, JSON.stringify(dados), assignedTo]);
  return { id: r.id, tel };
}
const extra = (telefone, extras = {}) => ({ telefone, coluna: "Telefone 2", ...extras });
const audiencia = (over = {}) => querySecondNumberAudience(pool, { scope, campaignId: campA, waitDays: 7, now: NOW, ...over });

beforeAll(async () => {
  db = await createPgliteDb(SCHEMA);
  openDbs.push(db);
  pool = { query: (sql, values) => db.query(sql, values) };
  await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${T}', 'GD'), ('${OUTRO}', 'Outra')`);
  await inserirBase(db, montaBase(), T);

  ({ c: campA, d: dispA } = await criaCampanha("Camp A"));
  ({ c: campB, d: dispB } = await criaCampanha("Camp B"));

  // a campanha foi enviada ao telefone principal de TODA a base, há 30 dias
  await db.query(
    `INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, phone, status, sent_at)
       SELECT $1, $2, client_id, telefone, 'sent', $4::timestamptz + (row_number() OVER ())::int * interval '1 second' FROM leads WHERE client_id = $3`,
    [dispA, campA, T, ago(30)]
  );
  // adicionais em 20 mil leads (um telefone 2 por lead); respostas em massa: 5.000 no número adicional, 2.000 no principal (a faixa é pelo número do telefone: created_at repete a cada lote)
  await db.query(
    `UPDATE leads SET dados = jsonb_set(dados, '{telefones_extras}', jsonb_build_array(jsonb_build_object('telefone', '5599' || substr(telefone, 5), 'coluna', 'Telefone 2')))
      WHERE client_id = $1 AND substr(telefone, 3)::bigint <= 20000`,
    [T]
  );
  await db.query(
    `INSERT INTO lead_messages (client_id, phone, direction, message_timestamp)
       SELECT $1, '5599' || substr(telefone, 5), 'inbound', $2::timestamptz FROM leads WHERE client_id = $1 AND substr(telefone, 3)::bigint <= 5000`,
    [T, ago(20)]
  );
  await db.query(
    `INSERT INTO lead_messages (client_id, phone, direction, message_timestamp)
       SELECT $1, telefone, 'inbound', $2::timestamptz FROM leads WHERE client_id = $1 AND substr(telefone, 3)::bigint BETWEEN 22001 AND 24000`,
    [T, ago(25)]
  );
  // 500 respostas de LID: sem telefone, não ligam a nada
  await db.query(
    `INSERT INTO lead_messages (client_id, phone, direction, message_timestamp) SELECT $1, (100000000000000 + g)::text || '@lid', 'inbound', $2::timestamptz FROM generate_series(1, 500) g`,
    [T, ago(10)]
  );

  // ── os leads de cenário (todos receberam Camp A no principal, há 30 dias, salvo onde dito) ──────────────────────────────────────────────────
  G = {};
  const recebe = async (g, dias = 30) => run(campA, dispA, g.tel, ago(dias));
  const cria = async (chave, nome, extras, opts) => { G[chave] = await lead(nome, extras, opts); return G[chave]; };

  await cria("g1", "G1 elegível", [extra("5511988880001")]);                                     await recebe(G.g1);
  await cria("g2", "G2 respondeu no principal", [extra("5511988880002")]);                       await recebe(G.g2); await msg(G.g2.tel, "inbound", ago(29));
  await cria("g3", "G3 respondeu no adicional", [extra("5511988880003")]);                       await recebe(G.g3); await msg("5511988880003", "inbound", ago(28)); // lead_id NULL, como o webhook grava
  await cria("g5", "G5 dentro do prazo", [extra("5511988880005")]);                              await recebe(G.g5, 3);
  await cria("g6", "G6 sem adicional", []);                                                      await recebe(G.g6);
  await cria("g7", "G7 adicional já recebeu a campanha", [extra("5511988880007")]);              await recebe(G.g7); await run(campA, dispA, "5511988880007", ago(30));
  await cria("g8", "G8 resposta em JID", [extra("5511988880008")]);                              await recebe(G.g8); await msg(`${G.g8.tel}@s.whatsapp.net`, "inbound", ago(29));
  await cria("g9", "G9 só resposta de LID", [extra("5511988880009")]);                           await recebe(G.g9); await msg("999999999999999@lid", "inbound", ago(29));
  await cria("g10", "G10 resposta ANTES do envio", [extra("5511988880010")]);                    await recebe(G.g10, 10); await msg(G.g10.tel, "inbound", ago(15)); // resposta DEPOIS do 1º envio da campanha (ago 30) e ANTES do envio deste lead (ago 10)
  await cria("g11", "G11 só respondeu em OUTRA empresa", [extra("5511988880011")]);              await recebe(G.g11); await msg("5511988880011", "inbound", ago(20), { client: OUTRO }); await msg(G.g11.tel, "inbound", ago(20), { client: OUTRO });
  await cria("g12", "G12 só mensagem nossa", [extra("5511988880012")]);                          await recebe(G.g12); await msg("5511988880012", "outbound", ago(20)); await msg(G.g12.tel, "outbound", ago(20));
  await cria("g13", "G13 sinal reply", [extra("5511988880013")]);                                await recebe(G.g13); await msg("5511988880013", "outbound", ago(20), { signal: "reply" });
  await cria("g14", "G14 formato diferente", [extra("(11) 98888-0014")]);                        await recebe(G.g14); await msg("5511988880014", "inbound", ago(20));
  await cria("g15", "G15 dois adicionais", [extra("5511988880015"), extra("5511988880115", { coluna: "Telefone 3" })]);
  await recebe(G.g15); await run(campA, dispA, "5511988880015", ago(30));
  await cria("g16", "G16 envio com falha", [extra("5511988880016")]);                            await run(campA, dispA, G.g16.tel, ago(30), { status: "failed" });
  await cria("g17", "G17 já é outro lead", []);                                                  await recebe(G.g17);
  const outro17 = await lead("G17 outro lead (o adicional)", [extra("5511988889017")]);
  await db.query(`UPDATE leads SET dados = jsonb_build_object('telefones_extras', jsonb_build_array(jsonb_build_object('telefone', $2::text, 'coluna', 'Telefone 2', 'ja_existe_como_lead', $3::text))) WHERE id::text = $1`, [G.g17.id, outro17.tel, outro17.id]);
  G.g17b = outro17;
  await msg("5511988889017", "inbound", ago(20)); // resposta do OUTRO telefone do lead ligado: nenhum número de G17 aparece nela, só o vínculo a encontra
  await cria("g18", "G18 de outro operador", [extra("5511988880018")], { assignedTo: "operador-x" }); await recebe(G.g18);
  await cria("g19", "G19 respondeu a outra campanha depois", [extra("5511988880019")]);          await recebe(G.g19); await run(campB, dispB, G.g19.tel, ago(15)); await msg(G.g19.tel, "inbound", ago(14));
  await cria("g20", "G20 segunda tentativa só em Camp B", [extra("5511988880020")]);             await recebe(G.g20); await run(campB, dispB, "5511988880020", ago(30));
  await cria("g21", "G21 extra com ordem", [extra("5511988880021", { coluna: "Telefone 2" })]);   await recebe(G.g21, 8);
  await cria("g23", "G23 run de OUTRA empresa com o mesmo telefone", [extra("5511988880023")]);  await run(campA, dispA, G.g23.tel, ago(30), { client: OUTRO });
  await cria("g24", "G24 só o adicional recebeu", []);                                           await run(campA, dispA, "5511988880024", ago(30));
  await db.query(`UPDATE leads SET dados = jsonb_build_object('telefones_extras', jsonb_build_array(jsonb_build_object('telefone', '5511988880024'))) WHERE id::text = $1`, [G.g24.id]);
  await cria("g25", "G25 dois adicionais não recebidos", [extra("5511988880025"), extra("5511988880125", { coluna: "Telefone 3" })]); await recebe(G.g25);
  await cria("g22", "G22 outra empresa mesmo telefone", [extra("5511988880022")], { client: OUTRO }); await run(campA, dispA, G.g22.tel, ago(30), { client: OUTRO });

  const t0 = performance.now();
  baseResult = await audiencia();
  baseMs = performance.now() - t0;
}, SLOW);

afterAll(async () => {
  for (const d of openDbs) await d.close();
});

const elegivel = (g, r = baseResult) => r.items.some((i) => i.leadId === g.id);
const alvoDe = (g, r = baseResult) => r.items.find((i) => i.leadId === g.id)?.alvo;

describe("cada regra do público", () => {
  it("G1: recebeu, não respondeu, tem adicional, passou o prazo → elegível, e o alvo é o adicional (nunca o principal)", () => {
    expect(elegivel(G.g1)).toBe(true);
    expect(alvoDe(G.g1)).toBe("5511988880001");
    for (const i of baseResult.items) expect(i.alvo).not.toBe(i.principal);
  });

  it("G2: respondeu NO principal → fora (respondeuMesmoNumero)", () => {
    expect(elegivel(G.g2)).toBe(false);
  });

  it("G3: respondeu no ADICIONAL (inbound com lead_id nulo) → fora: o cruzamento é por telefone, não por lead_id", () => {
    expect(elegivel(G.g3)).toBe(false);
  });

  it("G5: enviado há 3 dias com prazo de 7 → dentro do prazo, fora do público", () => {
    expect(elegivel(G.g5)).toBe(false);
  });

  it("G5 muda de lado quando o prazo cai para 2 dias (o prazo é do último envio)", async () => {
    const r = await audiencia({ waitDays: 2 });
    expect(elegivel(G.g5, r)).toBe(true);
  });

  it("G6: sem adicional → fora", () => {
    expect(elegivel(G.g6)).toBe(false);
  });

  it("G7: o adicional JÁ recebeu a campanha → não há para quem tentar", () => {
    expect(elegivel(G.g7)).toBe(false);
  });

  it("G8: resposta em JID (@s.whatsapp.net) casa com o telefone puro — variante JID nos dois lados", () => {
    expect(elegivel(G.g8)).toBe(false);
  });

  it("G9: resposta de @lid não liga a ninguém → continua elegível (não achamos resposta) e entra no aviso", () => {
    expect(elegivel(G.g9)).toBe(true);
    expect(baseResult.counts.lidNaoLigadas).toBeGreaterThanOrEqual(501);
  });

  it("G10: resposta ANTES do envio DESTE lead não conta (o corte é por lead, não o da campanha inteira)", () => {
    expect(elegivel(G.g10)).toBe(true);
  });

  it("G11: resposta de OUTRA empresa com o mesmo telefone não conta (client_id)", () => {
    expect(elegivel(G.g11)).toBe(true);
  });

  it("G12: mensagem nossa (outbound) não é resposta", () => {
    expect(elegivel(G.g12)).toBe(true);
  });

  it("G13: engagement_signal='reply' conta como resposta (mesma definição do relatório)", () => {
    expect(elegivel(G.g13)).toBe(false);
  });

  it("G14: adicional guardado como '(11) 98888-0014' casa com a resposta em '5511988880014'", () => {
    expect(elegivel(G.g14)).toBe(false);
  });

  it("G15: dois adicionais — o primeiro já recebeu, o alvo é o SEGUNDO", () => {
    expect(alvoDe(G.g15)).toBe("5511988880115");
  });

  it("G24: recebeu SÓ no adicional → o principal nunca é oferecido como alvo (o alvo é sempre um adicional)", () => {
    expect(elegivel(G.g24)).toBe(false);
    expect(baseResult.items.every((i) => i.alvo !== i.principal)).toBe(true);
  });

  it("G25: dois adicionais não recebidos → o alvo é o PRIMEIRO, na ordem da planilha", () => {
    expect(alvoDe(G.g25)).toBe("5511988880025");
    expect(baseResult.items.find((i) => i.leadId === G.g25.id).alvoColuna).toBe("Telefone 2");
  });

  it("G16: envio com falha não é recebimento → não entra (nunca recebeu)", () => {
    expect(elegivel(G.g16)).toBe(false);
  });

  it("G17: o adicional já é OUTRO lead; a resposta de um número DAQUELE lead exclui o grupo", () => {
    expect(elegivel(G.g17)).toBe(false);
  });

  it("G18: escopo do operador respeitado — lead de outro operador não aparece", async () => {
    expect(elegivel(G.g18)).toBe(true);
    const r = await audiencia({ scope: { clientId: T, assignedTo: "operador-y" } });
    expect(elegivel(G.g18, r)).toBe(false);
    const r2 = await audiencia({ scope: { clientId: T, assignedTo: "operador-x" } });
    expect(elegivel(G.g18, r2)).toBe(true);
  });

  it("G19: resposta a OUTRA campanha depois do envio conta (a empresa respondeu: é a mesma definição do relatório)", () => {
    expect(elegivel(G.g19)).toBe(false);
  });

  it("G20: quem só recebeu a segunda tentativa em OUTRA campanha continua elegível nesta (o recebimento é por campanha)", () => {
    expect(elegivel(G.g20)).toBe(true);
  });

  it("G23: run de outra empresa com o mesmo telefone não é recebimento desta (client_id nos runs)", () => {
    expect(baseResult.items.some((i) => i.leadId === G.g23.id)).toBe(false);
    expect(baseResult.counts.received).toBe(baseResult.counts.semAdicional + baseResult.counts.respondeuMesmoNumero + baseResult.counts.respondeuOutroNumero + baseResult.counts.dentroDoPrazo + baseResult.counts.elegiveis);
  });

  it("G22: outra empresa nunca aparece", () => {
    expect(elegivel(G.g22)).toBe(false);
  });

  it("a mesma empresa aparece UMA vez, com um alvo só", () => {
    const ids = baseResult.items.map((i) => i.leadId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("os baldes somam o total que recebeu (nada some)", () => {
    const c = baseResult.counts;
    expect(c.semAdicional + c.respondeuMesmoNumero + c.respondeuOutroNumero + c.dentroDoPrazo + c.elegiveis).toBe(c.received);
    expect(c.elegiveis).toBe(baseResult.items.length);
    expect(SECOND_NUMBER_BUCKETS).toHaveLength(5);
  });
});

describe("números da prévia", () => {
  it("'respondeu em outro número': G3, G13, G14 (adicional) e G17 (número do lead ligado) + 5.000 em massa; 'no mesmo número': G2, G8, G19", () => {
    expect(baseResult.counts.respondeuOutroNumero).toBe(5_000 + 4);
    // as 2.000 respostas em massa no principal são de leads SEM adicional: caem em 'sem adicional' (o primeiro balde), não em 'respondeu'
    expect(baseResult.counts.respondeuMesmoNumero).toBe(3);
  });

  it("respostas de LID do período são contadas como não ligadas (500 em massa + 1)", () => {
    expect(baseResult.counts.lidNaoLigadas).toBe(501);
  });

  it("o período começa no primeiro envio da campanha", () => {
    expect(baseResult.counts.periodoDesde).toBe(ago(30));
  });

  it("campanhas do caminho antigo: conta as disparadas sem nenhum campaign_dispatches", async () => {
    const legada = (await um(`INSERT INTO campaigns (client_id, name, last_triggered_at) VALUES ($1, 'Legada', now()) RETURNING id::text AS id`, [T])).id;
    // Camp B foi disparada E tem campaign_dispatches: é do caminho NOVO, não pode contar como legada
    await db.query(`UPDATE campaigns SET last_triggered_at = now() WHERE id::text = $1`, [campB]);
    const r = await audiencia();
    expect(r.counts.campanhasCaminhoAntigo).toBe(1);
    await db.query(`UPDATE campaigns SET last_triggered_at = NULL WHERE id::text = $1`, [campB]);
    await db.query(`DELETE FROM campaigns WHERE id::text = $1`, [legada]);
  });

  it("lista de campanhas: só as que gravaram envio (a legada fica de fora), com contagem", async () => {
    const soFalha = await criaCampanha("Camp só falha");
    await run(soFalha.c, soFalha.d, "5511900000001", ago(5), { status: "failed" });
    const lista = await listSecondNumberCampaigns(pool, { clientId: T });
    expect(lista.map((c) => c.name).sort()).toEqual(["Camp A", "Camp B"]);
    expect(lista.find((c) => c.name === "Camp A").sentCount).toBeGreaterThan(24_000);
  });
});

describe("entrada", () => {
  it("campaignId que não é uuid → erro tipado", async () => {
    await expect(audiencia({ campaignId: "x'; DROP TABLE leads; --" })).rejects.toBeInstanceOf(SecondNumberInputError);
  });
  it.each([0, 91, 1.5, "abc", null])("prazo %s → erro tipado", async (waitDays) => {
    await expect(audiencia({ waitDays })).rejects.toMatchObject({ code: "INVALID_WAIT_DAYS" });
  });
  it("campanha de outra empresa → público vazio (nenhum run no escopo)", async () => {
    const o = await criaCampanha("Camp da outra", OUTRO);
    const r = await audiencia({ campaignId: o.c });
    expect(r.counts.received).toBe(0);
    expect(r.items).toEqual([]);
  });
});

describe("paridade com o relatório de efetividade (a definição de 'respondeu' é uma só)", () => {
  it("na MESMA janela (14 dias), respondeu = respondeuMesmoNumero + respondeuOutroNumero (restrito ao principal) bate com replied_count do relatório", async () => {
    // mundo pequeno e isolado: 40 empresas, cada uma com principal enviado e um adicional não enviado; respostas só no principal, em dias 1, 13, 14 e 15 depois do envio
    const p = await createPgliteDb(SCHEMA);
    openDbs.push(p);
    const pp = { query: (sql, values) => p.query(sql, values) };
    await p.exec(`INSERT INTO leads_clients (id) VALUES ('${T}')`);
    const c = (await p.query(`INSERT INTO campaigns (client_id, name, analytics_meta) VALUES ($1, 'P', '{"message":"oi"}') RETURNING id::text AS id`, [T])).rows[0].id;
    const d = (await p.query(`INSERT INTO campaign_dispatches (campaign_id, client_id) VALUES ($1, $2) RETURNING id::text AS id`, [c, T])).rows[0].id;
    const diasDeResposta = [null, 0.5, 1, 13, 13.99, 14, 14.01, 15, 20];
    for (let i = 0; i < 45; i++) {
      const tel = `55349${String(10_000_000 + i)}`;
      const dados = JSON.stringify({ telefones_extras: [{ telefone: `55119${String(20_000_000 + i)}` }] });
      await p.query(`INSERT INTO leads (client_id, telefone, nome, dados) VALUES ($1, $2, $3, $4::jsonb)`, [T, tel, `L${i}`, dados]);
      await p.query(`INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, phone, status, sent_at) VALUES ($1, $2, $3, $4, 'sent', $5)`, [d, c, T, tel, ago(30)]);
      const dr = diasDeResposta[i % diasDeResposta.length];
      if (dr !== null) await p.query(`INSERT INTO lead_messages (client_id, phone, direction, message_timestamp) VALUES ($1, $2, 'inbound', $3)`, [T, tel, new Date(new Date(ago(30)).getTime() + dr * DIA).toISOString()]);
    }
    const relatorio = (await p.query(buildMessageEffectivenessSql(true, true), [T, 1])).rows[0];
    const meu = await querySecondNumberAudience(pp, { scope, campaignId: c, waitDays: 7, now: NOW, replyWindowDays: MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS });
    expect(relatorio.sent_count).toBe(45);
    expect(relatorio.replied_count).toBeGreaterThan(0);
    expect(meu.counts.respondeuMesmoNumero + meu.counts.respondeuOutroNumero).toBe(relatorio.replied_count);
    expect(meu.counts.received).toBe(relatorio.sent_count);
    // sem janela ("até agora") a diferença é só a que se espera: quem respondeu depois do dia 14 também sai do público
    const semJanela = await querySecondNumberAudience(pp, { scope, campaignId: c, waitDays: 7, now: NOW });
    expect(semJanela.counts.respondeuMesmoNumero).toBeGreaterThan(relatorio.replied_count);
  }, SLOW);
});

describe("a definição de 'respondeu' é uma só", () => {
  it("o serviço NÃO tem a sua cópia: usa as constantes de messageEffectiveness.js, e o relatório usa as mesmas", () => {
    const svc = readFileSync(resolve("src/services/secondNumberAudience.js"), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    const rel = readFileSync(resolve("src/services/messageEffectiveness.js"), "utf8");
    expect(svc).toContain("REPLY_MESSAGE_FILTER_SQL");
    expect(svc).toContain("MESSAGE_TIMESTAMP_SQL");
    expect(svc).not.toMatch(/direction\s*=\s*'inbound'/);
    expect(svc).not.toMatch(/engagement_signal/);
    expect(svc).not.toMatch(/message_timestamp/);
    expect(rel).toMatch(/\$\{REPLY_MESSAGE_FILTER_SQL\}/);
    expect(rel).toMatch(/const lmTimestamp = MESSAGE_TIMESTAMP_SQL/);
  });
});

describe("tempo em 25 mil", () => {
  it(`o público inteiro (24.655 recebimentos, ~20 mil adicionais, ~7 mil respostas) fecha em poucos segundos`, () => {
    // eslint-disable-next-line no-console
    console.log(`[medido] público 2º número: ${baseMs.toFixed(0)} ms, recebeu ${baseResult.counts.received}, elegíveis ${baseResult.counts.elegiveis}, outro número ${baseResult.counts.respondeuOutroNumero}`);
    expect(baseMs).toBeLessThan(15_000);
    expect(baseResult.counts.received).toBeGreaterThan(24_000);
  });
});
