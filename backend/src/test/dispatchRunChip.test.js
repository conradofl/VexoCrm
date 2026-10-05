// backend/src/test/dispatchRunChip.test.js
//
// Qual chip enviou cada mensagem: campaign_dispatch_runs.evolution_instance_id.
//
// Regras provadas aqui, em Postgres REAL (pglite) e com o laço de envio de verdade (dispatchCampaignSequence,
// só o fetch da Evolution é simulado):
//   1. envio por chip escolhido grava esse chip;
//   2. envio por rodízio grava o chip que de fato enviou — nunca o padrão da campanha;
//   3. chip desconhecido grava NULL — nunca o padrão da campanha;
//   4. o ranking soma por esta coluna e os envios sem chip aparecem à parte, com a contagem;
//   5. envio antigo (coluna NULL) continua no total e aparece como "sem chip registrado";
//   6. a cota do dia é medida à parte e nunca atribui envio.
// A SQL do ranking e a do UPDATE são as do produto (importadas), não cópias.
//
// Limites do pglite (helpers/pgliteDb.js): não prova que roda em produção. Todas as consultas desta suíte rodam
// no pglite sem adaptação.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { dispatchCampaignSequence } from "../campaign-outbound.js";
import {
  FINALIZE_RUN_SENT_SQL,
  chipIdFromActiveChip,
  chipIdFromDispatchSettings,
  createRunChipTracker,
  finalizeRunSent,
} from "../services/dispatchRunChip.js";
import {
  buildChipQuotaSql,
  buildChipSentByInstanceSql,
  buildChipSentWithoutChipSql,
  calculateDashboardMetrics,
} from "../services/dashboardCalculations.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const SLOW = 60_000;
const T = "tenant-a";
const OUTRO = "tenant-b";
const CHIP_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const CHIP_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const CHIP_PADRAO = "dddddddd-0000-4000-8000-0000000000dd"; // o chip configurado na campanha
const REF = new Date("2026-10-16T01:30:00.000Z");
const DIA = "2026-10-10T12:00:00Z"; // dentro dos 30 dias do REF

// tipos como em produção: uuid nos ids, text no tenant, timestamptz nas datas
const SCHEMA = `
  CREATE TABLE campaign_dispatches (id uuid PRIMARY KEY, campaign_id uuid, evolution_instance_id uuid);
  CREATE TABLE campaign_dispatch_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id uuid, campaign_id uuid, client_id text, lead_id uuid,
    lead_import_item_id uuid, evolution_instance_id uuid, phone text NOT NULL, status text, error_message text,
    sent_at timestamptz, created_at timestamptz DEFAULT now()
  );
  CREATE TABLE lead_client_evolution_instances (id uuid PRIMARY KEY, client_id text, name text, chip_state text DEFAULT 'cold', daily_limit_override int);
  CREATE TABLE evolution_instance_daily_usage (instance_id uuid, date date, sent_count int);
  CREATE TABLE lead_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text, phone text, direction text, engagement_signal text, message_timestamp timestamptz, delivered_at timestamptz, created_at timestamptz DEFAULT now());
`;

const openDbs = [];
async function mundo() {
  const db = await createPgliteDb(SCHEMA);
  openDbs.push(db);
  for (const [id, name] of [[CHIP_A, "Chip A"], [CHIP_B, "Chip B"], [CHIP_PADRAO, "Chip Padrão"]]) {
    await db.query("INSERT INTO lead_client_evolution_instances (id, client_id, name) VALUES ($1,$2,$3)", [id, T, name]);
  }
  return db;
}
afterAll(async () => {
  for (const db of openDbs) await db.close();
});

let seq = 0;
const uid = (p = "1") => `${p}0000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const tel = (n) => `55349910${String(n).padStart(5, "0")}`;

const addDispatch = async (db, chipPadrao = CHIP_PADRAO) => {
  const id = uid("d");
  const campaignId = uid("c");
  await db.query("INSERT INTO campaign_dispatches (id, campaign_id, evolution_instance_id) VALUES ($1,$2,$3)", [id, campaignId, chipPadrao]);
  return { dispatchId: id, campaignId };
};

// insere o run já 'sent' como estava no banco ANTES desta coluna (ou de um envio que não soube o chip)
const addRun = (db, { dispatchId, campaignId, phone, chip = null, status = "sent", at = DIA, client = T }) =>
  db.query(
    "INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, lead_id, phone, status, sent_at, evolution_instance_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [dispatchId, campaignId, client, uid("e"), phone, status, status === "sent" ? at : null, chip]
  );

const runsOf = async (db, dispatchId) =>
  (await db.query("SELECT lead_id, phone, status, evolution_instance_id FROM campaign_dispatch_runs WHERE dispatch_id = $1 ORDER BY phone", [dispatchId])).rows;

// ── envio de verdade: o laço do produto, ligado como o runCampaignDispatch liga ───────────────────────────────────
let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const SEQUENCE = [{ id: "s1", order: 1, type: "text", enabled: true, triggerMode: "immediate", delayAfterSeconds: 0, text: "Oi" }];

async function enviar(db, { dispatchId, campaignId, quantos, chipProvider = null, sequence = SEQUENCE, settingsChipId = null }) {
  const leads = [];
  for (let i = 0; i < quantos; i++) {
    const id = uid("f");
    const telefone = tel(100 + i);
    leads.push({ id, nome: `Lead ${i}`, telefone });
    await db.query("INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, lead_id, phone, status) VALUES ($1,$2,$3,$4,$5,'claimed')", [dispatchId, campaignId, T, id, telefone]);
  }
  const tracker = createRunChipTracker({ settingsChipId });
  const { summary } = await dispatchCampaignSequence({
    webhookUrl: "http://evolution.test/message/sendText/padrao",
    webhookToken: "token-teste",
    leads,
    analyticsMeta: { sequence },
    leadDelayProvider: () => 0,
    chipProvider,
    // as mesmas duas ligações do runCampaignDispatch (onStepDispatched → tracker.record; finalizeLeadSent → take)
    onStepDispatched: async ({ lead, activeChip }) => tracker.record(lead?.id, activeChip),
    onLeadDispatched: async ({ lead, sentAt }) => {
      await finalizeRunSent(db, { dispatchId, leadId: lead.id, sentAt, chipId: tracker.take(lead.id) });
    },
  });
  return { summary, leads };
}

const chip = (id, name) => ({ webhookUrl: `http://evolution.test/message/sendText/${name}`, webhookToken: "t", instanceId: id, instanceName: name, sequence: 1, release: null });

describe("[TESTE OBRIGATÓRIO 1] envio com chip escolhido grava esse chip", () => {
  it("o único chip do disparo é gravado no mesmo UPDATE que marca 'sent'", async () => {
    const db = await mundo();
    const d = await addDispatch(db, CHIP_A);

    const { summary } = await enviar(db, { ...d, quantos: 3, chipProvider: async () => chip(CHIP_A, "Chip A") });

    expect(summary.successCount).toBe(3);
    const runs = await runsOf(db, d.dispatchId);
    expect(runs).toHaveLength(3);
    for (const r of runs) expect(r).toMatchObject({ status: "sent", evolution_instance_id: CHIP_A });
  }, SLOW);

  it("o campo gravado é o ID do chip, não o nome", async () => {
    const db = await mundo();
    const d = await addDispatch(db, CHIP_A);

    await enviar(db, { ...d, quantos: 1, chipProvider: async () => chip(CHIP_A, "Chip A") });

    const [run] = await runsOf(db, d.dispatchId);
    expect(run.evolution_instance_id).toBe(CHIP_A);
    expect(run.evolution_instance_id).not.toBe("Chip A");
  }, SLOW);
});

describe("[TESTE OBRIGATÓRIO 1b] sem rodízio, o chip é o dono do webhook com que o disparo envia", () => {
  // Na rota real o laço não recebe chipProvider (activeChip é sempre null): quem envia é a instância dona do
  // webhook resolvido por resolveCampaignDispatchSettings. É essa que precisa ser gravada.
  it("webhook da instância escolhida na campanha → grava o id dela", async () => {
    const db = await mundo();
    const d = await addDispatch(db, CHIP_A);
    const settingsChipId = chipIdFromDispatchSettings({ source: "campaign_evolution_instance", selectedEvolutionInstanceId: CHIP_A });

    await enviar(db, { ...d, quantos: 2, chipProvider: null, settingsChipId });

    for (const r of await runsOf(db, d.dispatchId)) expect(r).toMatchObject({ status: "sent", evolution_instance_id: CHIP_A });
  }, SLOW);

  it("webhook da instância principal do tenant → grava o id dela (e não o chip configurado na campanha)", async () => {
    const db = await mundo();
    const d = await addDispatch(db, CHIP_PADRAO);
    const settingsChipId = chipIdFromDispatchSettings({ source: "auto_primary_evolution_instance", selectedEvolutionInstanceId: CHIP_B });

    await enviar(db, { ...d, quantos: 1, chipProvider: null, settingsChipId });

    const [run] = await runsOf(db, d.dispatchId);
    expect(run.evolution_instance_id).toBe(CHIP_B);
    expect(run.evolution_instance_id).not.toBe(CHIP_PADRAO);
  }, SLOW);

  it("webhook que NÃO é de instância cadastrada (config do tenant / URL em cache) → chip desconhecido", () => {
    expect(chipIdFromDispatchSettings({ source: "tenant_settings_missing", selectedEvolutionInstanceId: CHIP_A })).toBeNull();
    expect(chipIdFromDispatchSettings({ source: "campaign_cache" })).toBeNull();
    expect(chipIdFromDispatchSettings({ source: "campaign_evolution_instance" })).toBeNull(); // sem id
    expect(chipIdFromDispatchSettings({ source: "campaign_evolution_instance", selectedEvolutionInstanceId: "nome" })).toBeNull();
    expect(chipIdFromDispatchSettings(null)).toBeNull();
  });

  it("havendo rodízio, vale o chip do rodízio; rodízio sem id válido NÃO cai no chip das configurações", () => {
    const t = createRunChipTracker({ settingsChipId: CHIP_PADRAO });

    t.record("l1", { instanceId: CHIP_B });
    t.record("l2", { instanceName: "só nome" });
    t.record("l3", null);

    expect(t.take("l1")).toBe(CHIP_B);
    expect(t.take("l2")).toBeNull();
    expect(t.take("l3")).toBe(CHIP_PADRAO);
  });
});

// O rodízio (chipProvider) existe no código do disparo mas a rota hoje não o entrega ao laço (ver relatório).
// Este teste prova a regra contra o laço: no dia em que o rodízio for ligado, a coluna já grava o chip certo.
describe("[TESTE OBRIGATÓRIO 2] envio por rodízio grava o chip que de fato enviou, não o padrão da campanha", () => {
  it("rodízio A,B,A,B com chip padrão configurado D: cada run tem o seu chip e nenhum tem D", async () => {
    const db = await mundo();
    const d = await addDispatch(db, CHIP_PADRAO);
    const pool = [chip(CHIP_A, "Chip A"), chip(CHIP_B, "Chip B")];
    let cursor = 0;

    await enviar(db, { ...d, quantos: 4, chipProvider: async () => pool[cursor++ % pool.length] });

    const runs = await runsOf(db, d.dispatchId);
    const porChip = runs.reduce((acc, r) => ({ ...acc, [r.evolution_instance_id]: (acc[r.evolution_instance_id] || 0) + 1 }), {});
    expect(porChip).toEqual({ [CHIP_A]: 2, [CHIP_B]: 2 });
    expect(runs.map((r) => r.evolution_instance_id)).not.toContain(CHIP_PADRAO);
    // e foi mesmo esse chip que recebeu a chamada: a ordem das URLs chamadas é a ordem dos chips gravados
    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.map((u) => u.split("/").pop())).toEqual(["Chip A", "Chip B", "Chip A", "Chip B"]);
  }, SLOW);

  it("lead com vários passos: grava o chip que enviou os passos, uma vez", async () => {
    const db = await mundo();
    const d = await addDispatch(db, CHIP_PADRAO);
    const doisPassos = [
      { id: "s1", order: 1, type: "text", enabled: true, triggerMode: "immediate", delayAfterSeconds: 0, text: "Oi" },
      { id: "s2", order: 2, type: "text", enabled: true, triggerMode: "immediate", delayAfterSeconds: 0, text: "Tudo bem?" },
    ];

    await enviar(db, { ...d, quantos: 1, sequence: doisPassos, chipProvider: async () => chip(CHIP_B, "Chip B") });

    const [run] = await runsOf(db, d.dispatchId);
    expect(run).toMatchObject({ status: "sent", evolution_instance_id: CHIP_B });
  }, SLOW);
});

describe("[TESTE OBRIGATÓRIO 3] chip desconhecido grava NULL, nunca o padrão da campanha", () => {
  it("sem rodízio, webhook de origem desconhecida e campanha com chip padrão configurado → NULL", async () => {
    const db = await mundo();
    const d = await addDispatch(db, CHIP_PADRAO);

    const { summary } = await enviar(db, { ...d, quantos: 2, chipProvider: null });

    expect(summary.successCount).toBe(2);
    const runs = await runsOf(db, d.dispatchId);
    for (const r of runs) {
      expect(r.status).toBe("sent");
      expect(r.evolution_instance_id).toBeNull();
      expect(r.evolution_instance_id).not.toBe(CHIP_PADRAO);
    }
  }, SLOW);

  it("só o NOME ou um id que não é uuid não é 'o chip': NULL, e o UPDATE não quebra", async () => {
    expect(chipIdFromActiveChip({ instanceName: "Chip A" })).toBeNull();
    expect(chipIdFromActiveChip({ instanceId: "Chip A", instanceName: "Chip A" })).toBeNull();
    expect(chipIdFromActiveChip({ instanceId: "" })).toBeNull();
    expect(chipIdFromActiveChip(null)).toBeNull();
    expect(chipIdFromActiveChip(undefined)).toBeNull();
    expect(chipIdFromActiveChip({ instanceId: CHIP_A.toUpperCase() })).toBe(CHIP_A);

    const db = await mundo();
    const d = await addDispatch(db, CHIP_PADRAO);
    await enviar(db, { ...d, quantos: 1, chipProvider: async () => chip("nome-nao-uuid", "Chip A") });
    const [run] = await runsOf(db, d.dispatchId);
    expect(run).toMatchObject({ status: "sent", evolution_instance_id: null });
  }, SLOW);

  it("o rastreador não herda o chip de um lead para outro", () => {
    const t = createRunChipTracker();
    t.record("lead-1", { instanceId: CHIP_A });

    expect(t.take("lead-2")).toBeNull();
    expect(t.take("lead-1")).toBe(CHIP_A);
    expect(t.take("lead-1")).toBeNull(); // já entregue
  });

  it("a rota liga o rastreador nos dois pontos (onStepDispatched grava, finalizeLeadSent entrega)", () => {
    const src = readFileSync(resolve("src/domains/campaigns/routes.js"), "utf8");

    expect(src).toMatch(/createRunChipTracker\(\{ settingsChipId: chipIdFromDispatchSettings\(dispatchSettings\) \}\)/);
    expect(src).toMatch(/onStepDispatched:[^]*?runChipTracker\.record\(lead\?\.id, activeChip\)/);
    expect(src).toMatch(/const finalizeLeadSent = async[^]*?finalizeRunSent\(pgDatabasePool, \{[^}]*chipId: runChipTracker\.take\(lead\.id\)/);
    // nada de cair no chip configurado da campanha
    expect(src.match(/const finalizeLeadSent = async[^]*?finalize_sent_failed/)[0]).not.toMatch(/dispatchEvolutionInstanceId/);
    // o espelho de bootstrap existe e roda no caminho do disparo
    expect(src).toMatch(/ADD COLUMN IF NOT EXISTS evolution_instance_id UUID/);
    expect(src).toMatch(/async function ensureDispatchRunsClaimSchema\(\)[^]*?await ensureDispatchRunsChipColumn\(\)/);
  });
});

// ── o ranking, no Postgres real ────────────────────────────────────────────────────────────────────────────────────
const SENT_BY_CHIP = buildChipSentByInstanceSql();
const WITHOUT_CHIP = buildChipSentWithoutChipSql();
const QUOTA = buildChipQuotaSql();
const PERIODO = ["2026-09-16T03:00:00.000Z", "2026-10-16T03:00:00.000Z"];
const porChip = async (db, client = T) => Object.fromEntries((await db.query(SENT_BY_CHIP, [client, ...PERIODO])).rows.map((r) => [r.instance_id, r]));
const semChip = async (db, client = T) => (await db.query(WITHOUT_CHIP, [client, ...PERIODO])).rows[0].unattributed_sent;

describe("[TESTE OBRIGATÓRIO 4] o ranking soma por esta coluna e o sem chip aparece à parte, com a contagem", () => {
  it("A=3, B=1, sem chip=2: cada chip com o seu, o resto separado", async () => {
    const db = await mundo();
    const d = await addDispatch(db, CHIP_PADRAO);
    for (let i = 0; i < 3; i++) await addRun(db, { ...d, phone: tel(i), chip: CHIP_A });
    await addRun(db, { ...d, phone: tel(10), chip: CHIP_B });
    for (let i = 20; i < 22; i++) await addRun(db, { ...d, phone: tel(i), chip: null });

    const chips = await porChip(db);

    expect(chips[CHIP_A].sent_count).toBe(3);
    expect(chips[CHIP_B].sent_count).toBe(1);
    expect(chips[CHIP_PADRAO]).toBeUndefined(); // o chip da campanha não ganha envio que não enviou
    expect(await semChip(db)).toBe(2);
  }, SLOW);

  it("respostas contam por chip pelo envio (janela do envio)", async () => {
    const db = await mundo();
    const d = await addDispatch(db);
    await addRun(db, { ...d, phone: tel(1), chip: CHIP_A });
    await addRun(db, { ...d, phone: tel(2), chip: CHIP_A });
    await db.query("INSERT INTO lead_messages (client_id, phone, direction, message_timestamp) VALUES ($1,$2,'inbound',$3)", [T, tel(1), "2026-10-10T13:00:00Z"]);

    const chips = await porChip(db);

    expect(chips[CHIP_A]).toMatchObject({ sent_count: 2, replied_count: 1 });
  }, SLOW);

  it("só 'sent' no período e só do tenant", async () => {
    const db = await mundo();
    const d = await addDispatch(db);
    await addRun(db, { ...d, phone: tel(1), chip: CHIP_A });
    await addRun(db, { ...d, phone: tel(2), chip: CHIP_A, status: "failed" });
    await addRun(db, { ...d, phone: tel(3), chip: CHIP_A, at: "2026-08-01T12:00:00Z" }); // fora do período
    await addRun(db, { ...d, phone: tel(4), chip: CHIP_A, client: OUTRO });
    await addRun(db, { ...d, phone: tel(5), chip: null, status: "failed" });

    expect((await porChip(db))[CHIP_A].sent_count).toBe(1);
    expect(await semChip(db)).toBe(0);
  }, SLOW);

  it("pelo painel inteiro (calculateDashboardMetrics): chips, 'sem chip registrado' e cota saem separados", async () => {
    const db = await mundo();
    const d = await addDispatch(db);
    for (let i = 0; i < 3; i++) await addRun(db, { ...d, phone: tel(i), chip: CHIP_A });
    await addRun(db, { ...d, phone: tel(10), chip: CHIP_B });
    for (let i = 20; i < 22; i++) await addRun(db, { ...d, phone: tel(i), chip: null });
    await db.query("INSERT INTO evolution_instance_daily_usage (instance_id, date, sent_count) VALUES ($1,'2026-10-15',999)", [CHIP_A]);
    // só as três consultas do ranking de chips vão ao Postgres real; as demais medidas não são deste teste
    const textos = new Set([SENT_BY_CHIP, WITHOUT_CHIP, QUOTA]);
    const pool = { query: async (sql, params) => (textos.has(sql) ? db.query(sql, params) : { rows: [] }) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const m = await calculateDashboardMetrics(pool, T, "30d", { referenceDate: REF });

    const A = m.rankings.chips.find((c) => c.name === "Chip A");
    const B = m.rankings.chips.find((c) => c.name === "Chip B");
    expect(A.sent).toBe(3); // não 999: o contador da cota não atribui envio
    expect(A.sentToday).toBe(999); // a cota de hoje sai à parte
    expect(B.sent).toBe(1);
    expect(B.sentToday).toBe(0);
    expect(m.rankings.chipsUnattributedSent).toBe(2);
    expect(m.unavailableBlocks).not.toContain("rankings.chips");
  }, SLOW);
});

describe("[TESTE OBRIGATÓRIO 5] envio antigo com a coluna NULL continua no total e aparece como 'sem chip registrado'", () => {
  it("chips + sem chip == todos os envios do período: nada some, nada se mistura", async () => {
    const db = await mundo();
    const d = await addDispatch(db, CHIP_PADRAO); // campanha ANTIGA com chip padrão configurado
    for (let i = 0; i < 4; i++) await addRun(db, { ...d, phone: tel(i), chip: null }); // histórico
    for (let i = 10; i < 12; i++) await addRun(db, { ...d, phone: tel(i), chip: CHIP_A }); // já com chip
    const totalNoBanco = (await db.query("SELECT COUNT(*)::int AS n FROM campaign_dispatch_runs WHERE client_id=$1 AND status='sent'", [T])).rows[0].n;

    const chips = await porChip(db);
    const somaChips = Object.values(chips).reduce((s, c) => s + c.sent_count, 0);

    expect(await semChip(db)).toBe(4);
    expect(somaChips).toBe(2);
    expect(somaChips + (await semChip(db))).toBe(totalNoBanco);
    // o histórico NÃO foi empurrado para o chip padrão da campanha
    expect(chips[CHIP_PADRAO]).toBeUndefined();
  }, SLOW);

  it("na tela: 'sem chip registrado' aparece com a contagem (não é escondido)", () => {
    const tela = readFileSync(resolve("../frontend/src/pages/Dashboard/Block2Rankings.tsx"), "utf8");

    expect(tela).toMatch(/envios sem chip registrado/);
    expect(tela).toMatch(/formatMetricNumber\(unattributedSent\)/);
  });
});

describe("[TESTE OBRIGATÓRIO 6] a cota do dia é medida à parte e nunca atribui envio", () => {
  it("cota de hoje 999 no contador, 3 envios gravados: 'envios' = 3, 'cota de hoje' = 999", async () => {
    const db = await mundo();
    const d = await addDispatch(db);
    for (let i = 0; i < 3; i++) await addRun(db, { ...d, phone: tel(i), chip: CHIP_A });
    await db.query("INSERT INTO evolution_instance_daily_usage (instance_id, date, sent_count) VALUES ($1,$2,999)", [CHIP_A, "2026-10-15"]);
    await db.query("INSERT INTO evolution_instance_daily_usage (instance_id, date, sent_count) VALUES ($1,$2,888)", [CHIP_B, "2026-10-15"]);

    const envios = await porChip(db);
    const cota = Object.fromEntries((await db.query(QUOTA, [T, "2026-10-15"])).rows.map((r) => [r.instance_id, r]));

    expect(envios[CHIP_A].sent_count).toBe(3); // não 999
    expect(envios[CHIP_B]).toBeUndefined(); // 888 na cota NÃO vira envio do chip B
    expect(cota[CHIP_A].sent_today).toBe(999);
    expect(cota[CHIP_B].sent_today).toBe(888);
    expect(await semChip(db)).toBe(0);
  }, SLOW);

  it("a consulta de envios não lê a tabela da cota, e gravar o envio não mexe nela", async () => {
    expect(SENT_BY_CHIP).not.toMatch(/evolution_instance_daily_usage/);
    expect(WITHOUT_CHIP).not.toMatch(/evolution_instance_daily_usage/);

    const db = await mundo();
    const d = await addDispatch(db);
    await db.query("INSERT INTO evolution_instance_daily_usage (instance_id, date, sent_count) VALUES ($1,'2026-10-15',7)", [CHIP_A]);
    await enviar(db, { ...d, quantos: 2, chipProvider: async () => chip(CHIP_A, "Chip A") });

    expect((await db.query("SELECT sent_count FROM evolution_instance_daily_usage WHERE instance_id=$1", [CHIP_A])).rows[0].sent_count).toBe(7);
    expect(FINALIZE_RUN_SENT_SQL).not.toMatch(/evolution_instance_daily_usage/);
  }, SLOW);
});

describe("migration e bootstrap", () => {
  it("a migration adiciona a coluna UUID de forma idempotente e a sentinela do migrate.js a conhece", async () => {
    const sql = readFileSync(resolve("supabase/migrations/20261004120000_add_evolution_instance_id_to_dispatch_runs.sql"), "utf8");
    const migrate = readFileSync(resolve("src/migrate.js"), "utf8");
    const db = await createPgliteDb("CREATE TABLE campaign_dispatch_runs (id uuid PRIMARY KEY, phone text);");
    openDbs.push(db);

    await db.exec(sql);
    await db.exec(sql); // rodar duas vezes não quebra

    const col = (await db.query("SELECT data_type FROM information_schema.columns WHERE table_name='campaign_dispatch_runs' AND column_name='evolution_instance_id'")).rows;
    expect(col).toEqual([{ data_type: "uuid" }]);
    expect(migrate).toMatch(/"20261004120000_add_evolution_instance_id_to_dispatch_runs\.sql":[^]*?column_name='evolution_instance_id'/);
  }, SLOW);
});
