// backend/src/test/importAuditPostgres.test.js
//
// Relatório & Auditoria de planilha contra Postgres REAL (pglite). A SQL é a do produto (importada de
// campaigns/routes.js, não copiada). Isto existe porque três defeitos de SQL chegaram à produção nesta base
// aprovados por teste simulado (uuid = text derrubando o dashboard; erro de tipo mascarado como tabela ausente;
// NULL IN (...) jogando envio do CRM em "pendente") — e os três foram pegos por Postgres de verdade.
//
// Limites do pglite (ver helpers/pgliteDb.js): não prova que roda em produção; se alguma consulta não rodar aqui
// por limitação da ferramenta, documente qual e por quê — nunca altere a consulta para caber nela.
// Todas as consultas desta suíte rodam no pglite sem adaptação.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildImportAuditSql, buildLegacyDispatchCampaignsSql } from "../domains/campaigns/routes.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const AUDIT = buildImportAuditSql();
const LEGACY = buildLegacyDispatchCampaignsSql();
const T = "T";
const OUTRO = "OUTRO";
const SLOW = 60_000; // criar o banco WASM leva alguns segundos

// tipos como em produção: uuid nos ids, text no tenant, jsonb nas metas, timestamptz nas datas
const SCHEMA = `
  CREATE TABLE campaigns (id uuid PRIMARY KEY, client_id text, name text, import_id uuid, status text DEFAULT 'sent', last_triggered_at timestamptz, analytics_meta jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
  CREATE TABLE campaign_dispatches (id uuid PRIMARY KEY, campaign_id uuid);
  CREATE TABLE lead_import_items (id uuid PRIMARY KEY, import_id uuid, client_id text, telefone text, normalized_data jsonb DEFAULT '{}'::jsonb, imported boolean, skip_reason text, row_number int, created_at timestamptz DEFAULT now());
  CREATE TABLE campaign_dispatch_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id uuid, campaign_id uuid, client_id text, lead_id uuid, lead_import_item_id uuid, phone text NOT NULL, status text, error_message text, sent_at timestamptz, created_at timestamptz DEFAULT now());
  CREATE TABLE lead_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text, phone text, direction text, engagement_signal text, message_timestamp timestamptz, delivered_at timestamptz, created_at timestamptz DEFAULT now());
`;

let seq = 0;
const uid = (p = "0") => `${p}0000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const tel = (n) => `55349910${String(n).padStart(5, "0")}`;
const IMP = uid("1");
const IMP2 = uid("2");

const openDbs = [];
async function mundo() {
  const db = await createPgliteDb(SCHEMA);
  openDbs.push(db);
  return db;
}
afterAll(async () => {
  for (const db of openDbs) await db.close();
});

const addImport = async (db, imp, rows, client = T) => {
  const ids = [];
  let n = 0;
  for (const r of rows) {
    const id = uid("a");
    ids.push(id);
    await db.query("INSERT INTO lead_import_items (id, import_id, client_id, telefone, imported, skip_reason, row_number) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, imp, client, r.tel ?? null, r.imported ?? !!r.tel, r.imported === false || !r.tel ? "Telefone ausente ou invalido" : null, ++n]);
  }
  return ids;
};
const addCampaign = async (db, { imp = null, importIds = null, client = T, name = "camp", triggerSource = null, lastTriggered = null, dispatches = 1, crm = false } = {}) => {
  const id = uid("c");
  const meta = {};
  if (importIds) meta.importIds = importIds;
  if (crm) meta.importSource = "__crm__";
  if (triggerSource) meta.dispatch = { triggerSource, status: "sent" };
  await db.query("INSERT INTO campaigns (id, client_id, name, import_id, last_triggered_at, analytics_meta) VALUES ($1,$2,$3,$4,$5,$6)", [id, client, name, imp, lastTriggered, JSON.stringify(meta)]);
  const disp = [];
  for (let i = 0; i < dispatches; i++) {
    const d = uid("d");
    disp.push(d);
    await db.query("INSERT INTO campaign_dispatches (id, campaign_id) VALUES ($1,$2)", [d, id]);
  }
  return { id, disp };
};
const addRun = (db, { camp, disp, phone, status = "sent", at = "2026-10-02T12:00:00Z", leadId = null, itemId = null, client = T, error = null }) =>
  db.query("INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, lead_id, lead_import_item_id, phone, status, error_message, sent_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [disp, camp, client, leadId, itemId, phone, status, error, status === "sent" ? at : null, at]);
const addMsg = (db, phone, at, o = {}) => db.query("INSERT INTO lead_messages (client_id, phone, direction, message_timestamp) VALUES ($1,$2,$3,$4)", [o.client || T, phone, o.dir || "inbound", at]);
const audit = async (db, imp, client = T) => (await db.query(AUDIT, [client, imp])).rows;
const byRow = (rows) => Object.fromEntries(rows.map((r) => [r.row_number, r]));
const lines = (n, start = 1) => Array.from({ length: n }, (_, i) => ({ tel: tel(start + i) }));

describe("os três casos de origem: os enviados batem com os envios reais", () => {
  it("[TESTE OBRIGATÓRIO] campanha de PLANILHA: enviados da auditoria == envios reais (30 de 32 linhas)", async () => {
    const db = await mundo();
    const ids = await addImport(db, IMP, [...lines(30), { tel: null }, { tel: null }]);
    const c = await addCampaign(db, { imp: IMP, importIds: [IMP] });
    for (let i = 0; i < 30; i++) await addRun(db, { camp: c.id, disp: c.disp[0], phone: tel(i + 1), leadId: ids[i], itemId: ids[i] });

    const rows = await audit(db, IMP);
    const real = (await db.query("SELECT count(DISTINCT phone)::int n FROM campaign_dispatch_runs WHERE status='sent'")).rows[0].n;

    expect(rows.filter((r) => r.delivery_state.startsWith("enviado"))).toHaveLength(real);
    expect(real).toBe(30);
    expect(rows.filter((r) => r.delivery_state === "enviado_por_esta_planilha")).toHaveLength(30);
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] campanha do CRM (lead_id = id do lead, sem item): os 30 enviados aparecem — antes dava 0 — como 'por outra campanha'", async () => {
    const db = await mundo();
    await addImport(db, IMP, [...lines(30), { tel: null }, { tel: null }]);
    const c = await addCampaign(db, { crm: true });
    for (let i = 0; i < 30; i++) await addRun(db, { camp: c.id, disp: c.disp[0], phone: tel(i + 1), leadId: uid("e") });

    const rows = await audit(db, IMP);

    expect(rows.filter((r) => r.delivery_state.startsWith("enviado"))).toHaveLength(30);
    expect(rows.filter((r) => r.delivery_state === "enviado_por_outra_campanha")).toHaveLength(30);
    expect(rows.every((r) => r.sent_by_import_count === 0)).toBe(true);
  }, SLOW);

  describe("telefone repetido (o dispatch envia o ÚLTIMO item de cada telefone)", () => {
    let rows;
    beforeAll(async () => {
      const db = await mundo();
      const ids = await addImport(db, IMP2, [...lines(30), { tel: tel(1) }, { tel: tel(2) }, { tel: null }, { tel: null }]);
      const c = await addCampaign(db, { imp: IMP2, importIds: [IMP2] });
      for (let i = 2; i < 30; i++) await addRun(db, { camp: c.id, disp: c.disp[0], phone: tel(i + 1), leadId: ids[i], itemId: ids[i] });
      await addRun(db, { camp: c.id, disp: c.disp[0], phone: tel(1), leadId: ids[30], itemId: ids[30] });
      await addRun(db, { camp: c.id, disp: c.disp[0], phone: tel(2), leadId: ids[31], itemId: ids[31] });
      rows = await audit(db, IMP2);
    }, SLOW);

    it("[TESTE OBRIGATÓRIO] a linha ORIGINAL (sem envio por id) aparece como enviada, não pendente", () => {
      const r = byRow(rows);
      expect(r[1].delivery_state).toBe("enviado_por_esta_planilha");
      expect(r[2].delivery_state).toBe("enviado_por_esta_planilha");
      expect(rows.filter((x) => x.delivery_state === "pendente")).toHaveLength(0);
    });

    it("a repetida diz de qual linha repete", () => {
      const r = byRow(rows);
      expect(r[31].duplicate_of_row).toBe(1);
      expect(r[32].duplicate_of_row).toBe(2);
      expect(r[1].duplicate_of_row).toBeNull();
    });

    it("contatos válidos (30) == telefones únicos enviados (30)", () => {
      const contatos = rows.filter((r) => r.canonical_phone && r.duplicate_of_row === null);
      expect(contatos).toHaveLength(30);
      expect(contatos.filter((r) => r.delivery_state.startsWith("enviado"))).toHaveLength(30);
    });
  });
});

describe("distinguir 'desta planilha' de 'de outra campanha'", () => {
  it("[TESTE OBRIGATÓRIO] só esta planilha / só outra campanha / as duas / nenhuma", async () => {
    const db = await mundo();
    const ids = await addImport(db, IMP, lines(5));
    const mine = await addCampaign(db, { imp: IMP, importIds: [IMP] });
    const other = await addCampaign(db, { imp: IMP2, importIds: [IMP2] });
    await addRun(db, { camp: mine.id, disp: mine.disp[0], phone: tel(1), itemId: ids[0], leadId: ids[0] });
    await addRun(db, { camp: other.id, disp: other.disp[0], phone: tel(2), leadId: uid("f") });
    await addRun(db, { camp: other.id, disp: other.disp[0], phone: tel(3), leadId: uid("f") });
    await addRun(db, { camp: mine.id, disp: mine.disp[0], phone: tel(3), itemId: ids[2], leadId: ids[2] });
    await addRun(db, { camp: other.id, disp: other.disp[0], phone: tel(5), itemId: ids[4], leadId: uid("f") }); // só a coluna nova liga ao item

    const r = byRow(await audit(db, IMP));

    expect(r[1]).toMatchObject({ delivery_state: "enviado_por_esta_planilha", sent_by_other_count: 0 });
    expect(r[2]).toMatchObject({ delivery_state: "enviado_por_outra_campanha", sent_by_import_count: 0, sent_by_other_count: 1 });
    expect(r[3]).toMatchObject({ delivery_state: "enviado_por_esta_planilha", sent_by_import_count: 1, sent_by_other_count: 1 });
    expect(r[4].delivery_state).toBe("pendente");
    expect(r[5].delivery_state).toBe("enviado_por_esta_planilha"); // lead_import_item_id sozinho identifica o item
  }, SLOW);

  it("histórico sem lead_import_item_id: lead_id apontando para o item desta planilha conta como 'desta planilha'", async () => {
    const db = await mundo();
    const ids = await addImport(db, IMP, lines(1));
    const other = await addCampaign(db, { imp: IMP2, importIds: [IMP2] });
    await addRun(db, { camp: other.id, disp: other.disp[0], phone: tel(1), leadId: ids[0] });

    expect((await audit(db, IMP))[0].delivery_state).toBe("enviado_por_esta_planilha");
  }, SLOW);

  it("campanha com VÁRIAS planilhas (importIds) conta como desta planilha", async () => {
    const db = await mundo();
    await addImport(db, IMP, lines(1));
    const multi = await addCampaign(db, { imp: IMP2, importIds: [IMP2, IMP] });
    await addRun(db, { camp: multi.id, disp: multi.disp[0], phone: tel(1), leadId: uid("f") });

    expect((await audit(db, IMP))[0].delivery_state).toBe("enviado_por_esta_planilha");
  }, SLOW);
});

describe("falhas, pendente e linha sem telefone", () => {
  let r;
  beforeAll(async () => {
    const db = await mundo();
    const ids = await addImport(db, IMP, [{ tel: tel(1) }, { tel: tel(2) }, { tel: tel(3) }, { tel: tel(4) }, { tel: null }, { tel: "", imported: true }, { tel: "   ", imported: true }, { tel: tel(8) }]);
    const c = await addCampaign(db, { imp: IMP, importIds: [IMP] });
    const outroLote = uid("d");
    await addRun(db, { camp: c.id, disp: c.disp[0], phone: tel(1), status: "failed", error: "timeout", itemId: ids[0], leadId: ids[0] });
    await addRun(db, { camp: c.id, disp: c.disp[0], phone: tel(2), status: "invalid_number", itemId: ids[1], leadId: ids[1] });
    await addRun(db, { camp: c.id, disp: c.disp[0], phone: tel(3), status: "failed", at: "2026-10-01T12:00:00Z", itemId: ids[2], leadId: ids[2] });
    await addRun(db, { camp: c.id, disp: outroLote, phone: tel(3), status: "sent", at: "2026-10-02T12:00:00Z", itemId: ids[2] });
    await db.query("INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, lead_id, phone, status, created_at) VALUES ($1,$2,$3,$4,$5,'claimed',now())", [c.disp[0], c.id, T, ids[3], tel(4)]);
    await addRun(db, { camp: c.id, disp: c.disp[0], phone: tel(8), status: "sent", at: "2026-10-01T12:00:00Z", itemId: ids[7], leadId: ids[7] });
    await addRun(db, { camp: c.id, disp: outroLote, phone: tel(8), status: "failed", at: "2026-10-05T12:00:00Z", itemId: ids[7], error: "timeout" });
    r = byRow(await audit(db, IMP));
  }, SLOW);

  it("falhou (failed) e inválido (invalid_number) = 'falhou'", () => {
    expect(r[1].delivery_state).toBe("falhou");
    expect(r[2].delivery_state).toBe("falhou");
  });
  it("falhou antes e enviado depois = enviado", () => expect(r[3].delivery_state).toBe("enviado_por_esta_planilha"));
  it("enviado antes e falhou depois = continua 'recebeu' (a falha posterior não apaga o envio)", () => expect(r[8].delivery_state).toBe("enviado_por_esta_planilha"));
  it("só reivindicado (envio em andamento) = pendente", () => expect(r[4].delivery_state).toBe("pendente"));
  it("[TESTE OBRIGATÓRIO] linha sem telefone válido NÃO é pendente: estado próprio (null, vazio e só espaços)", () => {
    for (const n of [5, 6, 7]) expect(r[n].delivery_state, `linha ${n}`).toBe("sem_telefone_valido");
  });
  it("linha sem telefone nunca recebe envio, resposta nem contagem", () => {
    for (const n of [5, 6, 7]) expect(r[n]).toMatchObject({ sent_count: 0, has_replied: false, canonical_phone: null });
  });
});

describe("resposta: a janela é de CADA envio", () => {
  let r;
  beforeAll(async () => {
    const db = await mundo();
    const ids = await addImport(db, IMP, lines(5));
    const c1 = await addCampaign(db, { imp: IMP, importIds: [IMP] });
    const c2 = await addCampaign(db, { imp: IMP, importIds: [IMP] });
    const envio = (c, n, at) => addRun(db, { camp: c.id, disp: c.disp[0], phone: tel(n), at, itemId: ids[n - 1], leadId: ids[n - 1] });
    await envio(c1, 1, "2026-10-02T12:00:00Z"); // item 1: dois envios (02/10 e 07/10), responde em 03/10 — ENTRE os dois
    await envio(c2, 1, "2026-10-07T12:00:00Z");
    await addMsg(db, tel(1), "2026-10-03T10:00:00Z");
    await envio(c1, 2, "2026-10-02T12:00:00Z"); // item 2: responde 2 dias depois do 2º envio (16 dias do 1º)
    await envio(c2, 2, "2026-10-16T12:00:00Z");
    await addMsg(db, tel(2), "2026-10-18T10:00:00Z");
    await envio(c1, 3, "2026-10-02T12:00:00Z"); // item 3: resposta ANTES de qualquer envio
    await addMsg(db, tel(3), "2026-10-01T10:00:00Z");
    await envio(c1, 4, "2026-10-02T12:00:00Z"); // item 4: 15 dias depois do único envio
    await addMsg(db, tel(4), "2026-10-17T13:00:00Z");
    await addMsg(db, tel(5), "2026-10-03T10:00:00Z"); // item 5: nunca recebeu, mas tem inbound histórico
    r = byRow(await audit(db, IMP));
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] resposta ENTRE dois envios conta como retorno (não só a do último)", () => expect(r[1].has_replied).toBe(true));
  it("resposta dentro de 14d do SEGUNDO envio conta, mesmo fora de 14d do primeiro", () => expect(r[2].has_replied).toBe(true));
  it("resposta antes de qualquer envio não conta", () => expect(r[3].has_replied).toBe(false));
  it("resposta depois de 14 dias do envio não conta", () => expect(r[4].has_replied).toBe(false));
  it("quem nunca recebeu nada nunca 'respondeu', mesmo com mensagem inbound histórica", () => {
    expect(r[5].has_replied).toBe(false);
    expect(r[5].delivery_state).toBe("pendente");
  });
});

describe("formatos de telefone", () => {
  const itens = [
    ["5534991093607", "13 dígitos, com DDI e com 9"],
    ["553491093607", "12 dígitos, com DDI e SEM o 9"],
    ["34991093607", "11 dígitos, sem DDI, com 9"],
    ["3491093607", "10 dígitos, sem DDI e sem 9"],
    ["(34) 99109-3607", "formatado"],
  ];
  const formatos = ["5534991093607", "553491093607", "34991093607", "3491093607", "+55 (34) 99109-3607"];

  itens.forEach(([telItem, desc], i) => {
    it(`[TESTE OBRIGATÓRIO] item '${desc}' casa com envio '${formatos[(i + 1) % 5]}' e resposta '${formatos[(i + 2) % 5]}'`, async () => {
      const db = await mundo();
      const [iid] = await addImport(db, IMP, [{ tel: telItem }]);
      const c = await addCampaign(db, { imp: IMP, importIds: [IMP] });
      await addRun(db, { camp: c.id, disp: c.disp[0], phone: formatos[(i + 1) % 5], itemId: iid, leadId: iid });
      await addMsg(db, formatos[(i + 2) % 5], "2026-10-03T10:00:00Z");

      const [row] = await audit(db, IMP);

      expect(row.delivery_state).toBe("enviado_por_esta_planilha");
      expect(row.has_replied).toBe(true);
    }, SLOW);
  });
});

describe("JID", () => {
  const cenario = async (envio, resposta, telItem = "5534991093607") => {
    const db = await mundo();
    const [iid] = await addImport(db, IMP, [{ tel: telItem }]);
    const c = await addCampaign(db, { imp: IMP, importIds: [IMP] });
    await addRun(db, { camp: c.id, disp: c.disp[0], phone: envio, itemId: iid, leadId: iid });
    if (resposta) await addMsg(db, resposta, "2026-10-03T10:00:00Z");
    return (await audit(db, IMP))[0];
  };

  it("[TESTE OBRIGATÓRIO] '@s.whatsapp.net' (envio e resposta) casa com o telefone puro do item", async () => {
    const row = await cenario("5534991093607@s.whatsapp.net", "5534991093607@s.whatsapp.net");
    expect(row.delivery_state).toBe("enviado_por_esta_planilha");
    expect(row.has_replied).toBe(true);
  }, SLOW);
  it("'@c.us' na resposta casa", async () => expect((await cenario("5534991093607", "5534991093607@c.us")).has_replied).toBe(true), SLOW);
  it("JID de 12 dígitos (sem o 9) casa", async () => expect((await cenario("5534991093607", "553491093607@s.whatsapp.net")).has_replied).toBe(true), SLOW);
  it("'@lid' NÃO é telefone: nunca casa", async () => expect((await cenario("5534991093607", "99887766@lid")).has_replied).toBe(false), SLOW);
  it("JID no próprio telefone do item também é normalizado", async () => {
    expect((await cenario("5534991093607", null, "5534991093607@s.whatsapp.net")).delivery_state).toBe("enviado_por_esta_planilha");
  }, SLOW);
});

describe("tenant", () => {
  let r;
  let db;
  beforeAll(async () => {
    db = await mundo();
    const ids = await addImport(db, IMP, lines(2));
    const cB = await addCampaign(db, { client: OUTRO });
    await addRun(db, { camp: cB.id, disp: cB.disp[0], phone: tel(1), client: OUTRO, leadId: uid("f") });
    await addMsg(db, tel(2), "2026-10-03T10:00:00Z", { client: OUTRO });
    const cA = await addCampaign(db, { imp: IMP, importIds: [IMP] });
    await addRun(db, { camp: cA.id, disp: cA.disp[0], phone: tel(2), itemId: ids[1], leadId: ids[1] });
    r = byRow(await audit(db, IMP));
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] envio de OUTRO tenant com o mesmo telefone nunca casa (continua pendente)", () => {
    expect(r[1].delivery_state).toBe("pendente");
    expect(r[1].sent_count).toBe(0);
  });
  it("resposta de OUTRO tenant nunca conta como retorno", () => {
    expect(r[2].has_replied).toBe(false);
    expect(r[2].delivery_state).toBe("enviado_por_esta_planilha");
  });
  it("auditar a planilha de um tenant pelo OUTRO devolve zero linhas", async () => expect(await audit(db, IMP, OUTRO)).toHaveLength(0));
  it("campanha de outro tenant apontando para a importação não conta como 'desta planilha'", async () => {
    const cX = await addCampaign(db, { client: OUTRO, imp: IMP, importIds: [IMP] });
    await addRun(db, { camp: cX.id, disp: cX.disp[0], phone: tel(1), client: T, leadId: uid("f") }); // dado inconsistente de propósito
    expect(byRow(await audit(db, IMP))[1].delivery_state).toBe("enviado_por_outra_campanha");
  });
});

describe("caminho legado", () => {
  it("[TESTE OBRIGATÓRIO] detecta só a campanha legada desta planilha (e nada de campanha da fila, rascunho, CRM, outra planilha ou outro tenant)", async () => {
    const db = await mundo();
    await addImport(db, IMP, lines(1));
    const base = { lastTriggered: "2026-10-02T10:00:00Z" };
    await addCampaign(db, { imp: IMP, importIds: [IMP], name: "Black Friday (legado)", triggerSource: "scheduler", dispatches: 0, ...base });
    await addCampaign(db, { imp: IMP, importIds: [IMP], name: "Natal (fila)", dispatches: 2, ...base });
    await addCampaign(db, { imp: IMP, importIds: [IMP], name: "Rascunho", dispatches: 0 });
    await addCampaign(db, { crm: true, name: "CRM", triggerSource: "scheduler", dispatches: 0, ...base });
    await addCampaign(db, { imp: IMP2, importIds: [IMP2], name: "Outra", triggerSource: "scheduler", dispatches: 0, ...base });
    await addCampaign(db, { client: OUTRO, imp: IMP, importIds: [IMP], name: "Outro tenant", triggerSource: "scheduler", dispatches: 0, ...base });

    const nomes = (await db.query(LEGACY, [T, IMP])).rows.map((x) => x.name);

    expect(nomes).toEqual(["Black Friday (legado)"]);
  }, SLOW);

  it("planilha sem campanha legada: lista vazia (nenhum aviso falso)", async () => {
    const db = await mundo();
    await addImport(db, IMP, lines(1));
    expect((await db.query(LEGACY, [T, IMP])).rows).toHaveLength(0);
  }, SLOW);
});

describe("os números da tela fecham", () => {
  it("[TESTE OBRIGATÓRIO] linhas = contatos + repetidas + descartadas; contatos = receberam + falharam + ainda vão receber", async () => {
    const db = await mundo();
    const ids = await addImport(db, IMP, [...lines(6), { tel: tel(1) }, { tel: tel(2) }, { tel: null }, { tel: null }, { tel: "", imported: true }]);
    const c = await addCampaign(db, { imp: IMP, importIds: [IMP] });
    await addRun(db, { camp: c.id, disp: c.disp[0], phone: tel(1), itemId: ids[0], leadId: ids[0] });
    await addRun(db, { camp: c.id, disp: c.disp[0], phone: tel(2), status: "failed", itemId: ids[1], leadId: ids[1] });
    const crm = await addCampaign(db, { crm: true });
    await addRun(db, { camp: crm.id, disp: crm.disp[0], phone: tel(3), leadId: uid("f") });

    const rows = await audit(db, IMP);
    const descartadas = rows.filter((x) => !x.imported || x.delivery_state === "sem_telefone_valido").length;
    const repetidas = rows.filter((x) => x.imported && x.duplicate_of_row !== null).length;
    const contatos = rows.filter((x) => x.imported && x.canonical_phone && x.duplicate_of_row === null);
    const recebeu = contatos.filter((x) => x.delivery_state.startsWith("enviado")).length;
    const falhou = contatos.filter((x) => x.delivery_state === "falhou").length;
    const pendente = contatos.filter((x) => x.delivery_state === "pendente").length;

    expect(rows.length).toBe(contatos.length + repetidas + descartadas);
    expect(contatos.length).toBe(recebeu + falhou + pendente);
    expect({ contatos: contatos.length, recebeu, falhou, pendente, repetidas, descartadas }).toEqual({ contatos: 6, recebeu: 2, falhou: 1, pendente: 3, repetidas: 2, descartadas: 3 });
  }, SLOW);
});
