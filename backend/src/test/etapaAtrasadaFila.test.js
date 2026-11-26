// Fila da etapa de campanha que chegou atrasada + alerta de atraso da Evolution. Postgres real (pglite) na fila.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { enfileirarEtapaAtrasada, runEtapaAtrasadaTick, FILA_MAX_ENVIOS_POR_CICLO } from "../campaign/etapaAtrasadaFila.js";
import { registrarIdadeDaEntrada, getInboundDelayAlertStatus, _resetInboundDelayAlertForTesting, ATRASO_LIMITE } from "../services/inboundDelayAlert.js";

const SEQ = { sequence: [
  { id: "s1", type: "text", text: "Oi", order: 1, enabled: true },
  { id: "s2", type: "text", text: "Passo 2", order: 2, enabled: true, triggerMode: "after_reply" },
] };
const esperando = () => ({ id: "camp-1", status: "ativa", analyticsMeta: SEQ, leadImportItem: { id: "it", progress: { status: "aguardando_usuario", nextStepIndex: 1, waitForReply: true } } });
const ctx = (camps) => ({ matches: camps, waitForReplyMatches: camps, processingWaitForReplyMatches: [], activePeriodCampaign: null });
const ABERTA = async () => ({ send_window_enabled: false });
const FECHADA = async () => ({ send_window_enabled: true, send_window_start: "08:00", send_window_end: "09:00", send_window_days: ["seg"] });

let db;
afterEach(async () => {
  _resetInboundDelayAlertForTesting();
  if (db) await db.close();
  db = null;
});

async function banco() {
  db = await createPgliteDb(`CREATE TABLE public.lead_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text, phone text,
    direction text, wa_message_id text, message_timestamp timestamptz, created_at timestamptz DEFAULT now(), meta jsonb DEFAULT '{}'::jsonb);`);
  return { query: (sql, p) => db.query(sql, p) };
}
let seq = 0;
async function resposta(pool, { cliente = "adv", phone, criada = "now()", enfileirar = true }) {
  const wa = `wa-${++seq}`;
  await db.query(`INSERT INTO lead_messages (client_id, phone, direction, wa_message_id, message_timestamp, created_at) VALUES ($1,$2,'inbound',$3, now() - interval '5 hours', ${criada})`, [cliente, phone, wa]);
  if (enfileirar) await enfileirarEtapaAtrasada(pool, { clientId: cliente, waMessageId: wa });
  return wa;
}
const estadoDe = async (wa) => (await db.query("SELECT meta->>'etapa_atrasada' AS e FROM lead_messages WHERE wa_message_id = $1", [wa])).rows[0].e;
const deps = (over = {}) => ({
  optedOut: async () => false,
  findCampaignReplyMatches: async () => ctx([esperando()]),
  getSettings: ABERTA,
  env: {},
  ...over,
});

describe("[OBRIGATÓRIO] fila da etapa de campanha atrasada", () => {
  it("enfileirar marca a resposta como pendente; o ciclo envia pelo caminho da resposta, com a hora real", async () => {
    const pool = await banco();
    const wa = await resposta(pool, { phone: "5534991342631" });
    expect(await estadoDe(wa)).toBe("pendente");
    const chamadas = [];
    const r = await runEtapaAtrasadaTick({ pool, continueReply: async (a) => { chamadas.push(a); return { continued: true }; }, ...deps() });
    expect(r.envios).toBe(1);
    expect(chamadas[0]).toMatchObject({ clientId: "adv", phone: "5534991342631", campaignMatch: { id: "camp-1" } });
    expect(await estadoDe(wa)).toBe("enviada");
    expect((await runEtapaAtrasadaTick({ pool, continueReply: async () => ({ continued: true }), ...deps() })).envios).toBe(0); // não repete
  });

  it("aos poucos: no máximo 1 por empresa por ciclo e no máximo 5 no total", async () => {
    const pool = await banco();
    for (let i = 0; i < 3; i += 1) await resposta(pool, { cliente: "adv", phone: `553499000000${i}` });
    for (let e = 0; e < 7; e += 1) await resposta(pool, { cliente: `emp${e}`, phone: `551199999000${e}` });
    const enviados = [];
    const r = await runEtapaAtrasadaTick({ pool, continueReply: async (a) => { enviados.push(a.clientId); return { continued: true }; }, ...deps() });
    expect(r.envios).toBe(FILA_MAX_ENVIOS_POR_CICLO);
    expect(new Set(enviados).size).toBe(enviados.length); // uma empresa não recebe dois envios no mesmo ciclo
  });

  it("lead com duas respostas atrasadas recebe UMA vez (as duas resolvem juntas, em qualquer grafia)", async () => {
    const pool = await banco();
    const a = await resposta(pool, { phone: "5534991342631", criada: "now() - interval '1 hour'" });
    const b = await resposta(pool, { phone: "553491342631" }); // mesma pessoa, sem o 9
    let n = 0;
    await runEtapaAtrasadaTick({ pool, continueReply: async () => { n += 1; return { continued: true }; }, ...deps() });
    await runEtapaAtrasadaTick({ pool, continueReply: async () => { n += 1; return { continued: true }; }, ...deps() });
    expect(n).toBe(1);
    expect([await estadoDe(a), await estadoDe(b)]).toEqual(["enviada", "enviada"]);
  });

  it("fora da janela: não envia nem resolve; adiada (cota): não resolve; recusa e erro: resolvem sem repetir", async () => {
    const pool = await banco();
    const wa = await resposta(pool, { phone: "5534991342631" });
    let chamou = false;
    await runEtapaAtrasadaTick({ pool, now: new Date("2026-11-26T23:00:00Z"), continueReply: async () => { chamou = true; return { continued: true }; }, ...deps({ getSettings: FECHADA }) });
    expect(chamou).toBe(false);
    expect(await estadoDe(wa)).toBe("pendente");
    await runEtapaAtrasadaTick({ pool, continueReply: async () => ({ continued: false, held: true, reason: "chip_quota_exhausted" }), ...deps() });
    expect(await estadoDe(wa)).toBe("pendente");
    await runEtapaAtrasadaTick({ pool, continueReply: async () => ({ continued: false, reason: "lead_not_waiting_reply" }), ...deps() });
    expect(await estadoDe(wa)).toBe("lead_not_waiting_reply");
    const wa2 = await resposta(pool, { phone: "5534990001111" });
    await runEtapaAtrasadaTick({ pool, continueReply: async () => { throw new Error("evolution fora"); }, ...deps() });
    expect(await estadoDe(wa2)).toMatch(/^erro: evolution fora/);
  });

  it("não envia: já saiu mensagem depois (equipe/robô), opt-out, sem etapa pendente, ou mais de 7 dias na fila", async () => {
    const pool = await banco();
    const atendida = await resposta(pool, { phone: "5534990000001", criada: "now() - interval '2 hours'" });
    await db.query("INSERT INTO lead_messages (client_id, phone, direction, created_at) VALUES ('adv','553490000001','outbound', now() - interval '1 hour')");
    const opt = await resposta(pool, { cliente: "b", phone: "5534990000002" });
    const sem = await resposta(pool, { cliente: "c", phone: "5534990000003" });
    const velha = await resposta(pool, { cliente: "d", phone: "5534990000004", criada: "now() - interval '8 days'" });
    let chamou = false;
    await runEtapaAtrasadaTick({
      pool, continueReply: async () => { chamou = true; return { continued: true }; },
      ...deps({ optedOut: async (_p, { phone }) => phone === "5534990000002", findCampaignReplyMatches: async ({ phone }) => ctx(phone === "5534990000003" ? [] : [esperando()]) }),
    });
    expect(chamou).toBe(false);
    expect([await estadoDe(atendida), await estadoDe(opt), await estadoDe(sem), await estadoDe(velha)]).toEqual(["atendida_depois", "opt_out", "sem_etapa_pendente", "expirada"]);
  });

  it("FILA_ETAPA_ATRASADA_DESLIGADA=1 desliga sem deploy", async () => {
    const pool = await banco();
    await resposta(pool, { phone: "5534991342631" });
    const r = await runEtapaAtrasadaTick({ pool, continueReply: async () => ({ continued: true }), ...deps({ env: { FILA_ETAPA_ATRASADA_DESLIGADA: "1" } }) });
    expect(r).toMatchObject({ envios: 0, motivo: "desligada" });
  });

  it("o webhook enfileira só a ETAPA DE CAMPANHA atrasada (os dois pontos); o agente continua barrado; server.js liga e desliga", () => {
    const rotas = readFileSync(resolve("src/domains/chatbot/routes.js"), "utf8");
    expect(rotas).toContain("if (activeWaitCampaignToDispatch && (await enfileirarEtapaSeAtrasada())) return;");
    expect(rotas).toContain("if (pendingCampaignMatch && (await enfileirarEtapaSeAtrasada())) return;");
    expect(rotas).toMatch(/\n    if \(await barrarSeAtrasada\(\)\) return;/); // caminho do agente: só barra
    expect(rotas).toContain("void registrarIdadeDaEntrada({ clientId, idadeMs: atrasoEntregaMs });");
    const server = readFileSync(resolve("src/server.js"), "utf8");
    expect(server).toContain("startEtapaAtrasadaScheduler({ pool: pgDatabasePool });");
    expect(server).toContain("stopEtapaAtrasadaScheduler();");
  });
});

describe("[OBRIGATÓRIO] alerta de atraso da Evolution", () => {
  const MIN = 60_000;
  it(`${ATRASO_LIMITE} respostas atrasadas em 30 min: avisa no Slack uma vez, com empresas e mediana; resposta na hora não conta`, async () => {
    const slack = vi.fn(async () => {});
    const t0 = Date.UTC(2026, 10, 26, 12);
    await registrarIdadeDaEntrada({ clientId: "adv", idadeMs: 5 * MIN, agora: t0, sendSlack: slack }); // na hora
    for (let i = 0; i < ATRASO_LIMITE - 1; i += 1) await registrarIdadeDaEntrada({ clientId: "adv", idadeMs: 300 * MIN, agora: t0 + i * MIN, sendSlack: slack });
    expect(slack).not.toHaveBeenCalled();
    expect(await registrarIdadeDaEntrada({ clientId: "tinge", idadeMs: 400 * MIN, agora: t0 + 10 * MIN, sendSlack: slack })).toBe(true);
    expect(slack).toHaveBeenCalledTimes(1);
    expect(slack.mock.calls[0][0].text).toMatch(/adv, tinge/);
    expect(slack.mock.calls[0][0].text).toMatch(/atraso mediano 300 min/);
    for (let i = 0; i < 10; i += 1) await registrarIdadeDaEntrada({ clientId: "adv", idadeMs: 300 * MIN, agora: t0 + (11 + i) * MIN, sendSlack: slack });
    expect(slack).toHaveBeenCalledTimes(1); // no máximo um a cada 2 h
    expect(getInboundDelayAlertStatus(t0 + 20 * MIN)).toMatchObject({ alertasEnviados: 1, limite: ATRASO_LIMITE });
  });

  it("atrasos espalhados (fora da janela de 30 min) não disparam; falha do Slack fica registrada e não lança", async () => {
    const t0 = Date.UTC(2026, 10, 26, 12);
    const slack = vi.fn(async () => { throw new Error("SLACK_BOT_TOKEN não configurado."); });
    for (let i = 0; i < ATRASO_LIMITE; i += 1) await registrarIdadeDaEntrada({ clientId: "a", idadeMs: 100 * MIN, agora: t0 + i * 40 * MIN, sendSlack: slack });
    expect(slack).not.toHaveBeenCalled();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < ATRASO_LIMITE; i += 1) await registrarIdadeDaEntrada({ clientId: "a", idadeMs: 100 * MIN, agora: t0 + 300 * MIN + i, sendSlack: slack });
    expect(getInboundDelayAlertStatus(t0 + 300 * MIN + 10).ultimoErroAlerta).toMatch(/SLACK_BOT_TOKEN/);
    err.mockRestore();
  });
});
