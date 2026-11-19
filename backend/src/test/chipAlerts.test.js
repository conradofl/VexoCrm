// Alerta de chip "open" atrasado ou mudo (19/11/2026).
//
// Fatos medidos em 19/11: quatro instâncias "open" (tinge, advocacia-almeida, nous moacir, container-led 9499)
// entregavam mensagens com 8 a 37 h de atraso, em lotes de 50 em 50 min, e nada na tela mostrava isso. As outras 12
// entregavam em 1 s. A causa (Baileys rc.9 sem ack do <status>) foi consertada no #275; este alerta é para a próxima
// vez não depender de alguém medir no console.
//
// Regra:
// - ATRASADO: na última hora chegou pelo webhook ao menos uma mensagem de lead mais de 30 min depois da hora real dela;
// - MUDO: o chip não recebe nada há mais de 30 min, num horário em que costuma receber (recebeu nessa mesma hora em
//   pelo menos 4 dos 7 dias anteriores). Horário quieto não alerta.
// Só chip conectado entra (chip caído já aparece como caído). Mensagem importada pelo sincronizar, enviada, de grupo
// ou de outra empresa não conta.
//
// Postgres REAL (PGlite). Nada sai do processo.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { listarAlertasDeChip } from "../services/chipAlerts.js";

const TENANT = "container-led";
// 19/11/2026 15:00 em São Paulo (18:00Z): horário comercial
const AGORA = new Date("2026-11-19T18:00:00Z");
const min = (m) => new Date(AGORA.getTime() - m * 60_000);
const dias = (d, mAntes = 0) => new Date(AGORA.getTime() - d * 86_400_000 - mAntes * 60_000);

let db;
let pool;
let seq = 0;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE public.lead_messages (
      id BIGSERIAL PRIMARY KEY,
      client_id TEXT, phone TEXT, direction TEXT, message_text TEXT, message_timestamp TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(), meta JSONB, instance_name TEXT, is_group BOOLEAN DEFAULT false
    );
  `);
  pool = { query: (sql, params) => db.query(sql, params) };
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("DELETE FROM public.lead_messages;");
});

async function chegou({ chip = "Chip 9499", chegada, horaReal = chegada, clientId = TENANT, direction = "inbound", source = "hardcoded-chat-webhook", isGroup = false }) {
  seq += 1;
  await db.query(
    `INSERT INTO public.lead_messages (client_id, phone, direction, message_text, message_timestamp, created_at, meta, instance_name, is_group)
     VALUES ($1, $2, $3, 'oi', $4, $5, $6, $7, $8)`,
    [clientId, `55349999${String(seq).padStart(5, "0")}`, direction, horaReal, chegada, JSON.stringify({ source }), chip, isGroup]
  );
}

/** O chip recebeu nesta mesma hora (15h em SP) em `n` dos dias anteriores. */
async function costumaReceberNestaHora(chip, n) {
  for (let d = 1; d <= n; d += 1) await chegou({ chip, chegada: dias(d, -10) });
}

const CHIPS = [
  { name: "Chip 9499", active: true, connection_state: "open" },
  { name: "Chip 9171", active: true, connection_state: "open" },
];
const alertas = (r) => r.alertas.map((a) => `${a.instancia}:${a.tipo}`).sort();

describe("Chip atrasado", () => {
  it("mensagem que chegou 2 h depois da hora real, na última hora: alerta com o maior atraso", async () => {
    await chegou({ chegada: min(5), horaReal: min(125) });
    await chegou({ chegada: min(5), horaReal: min(65) });
    await chegou({ chip: "Chip 9171", chegada: min(3), horaReal: min(3) });
    const r = await listarAlertasDeChip(pool, TENANT, { chips: CHIPS, agora: AGORA });
    expect(alertas(r)).toEqual(["Chip 9499:atrasado"]);
    const a = r.alertas[0];
    expect(a.mensagensAtrasadas).toBe(2);
    expect(a.maiorAtrasoMin).toBe(120);
    expect(a.ultimaChegada).toBe(min(5).toISOString());
  });

  it("atraso de 10 min não alerta", async () => {
    await chegou({ chegada: min(5), horaReal: min(15) });
    const r = await listarAlertasDeChip(pool, TENANT, { chips: CHIPS, agora: AGORA });
    expect(r.alertas).toEqual([]);
  });

  it("lote atrasado que chegou há mais de 1 h não alerta mais", async () => {
    await chegou({ chegada: min(70), horaReal: min(600) });
    await chegou({ chegada: min(2), horaReal: min(2) });
    const r = await listarAlertasDeChip(pool, TENANT, { chips: CHIPS, agora: AGORA });
    expect(r.alertas).toEqual([]);
  });

  it.each([
    ["importada pelo sincronizar", { source: "evolution-sync" }],
    ["enviada", { direction: "outbound" }],
    ["de grupo", { isGroup: true }],
    ["de outra empresa", { clientId: "tinge-brasil" }],
  ])("mensagem %s com horas de atraso não conta", async (_nome, extra) => {
    await chegou({ chegada: min(5), horaReal: min(600), ...extra });
    const r = await listarAlertasDeChip(pool, TENANT, { chips: CHIPS, agora: AGORA });
    expect(r.alertas).toEqual([]);
  });
});

describe("Chip mudo", () => {
  it("sem receber há 45 min num horário em que recebe todo dia: alerta mudo", async () => {
    await costumaReceberNestaHora("Chip 9499", 6);
    await chegou({ chegada: min(45) });
    const r = await listarAlertasDeChip(pool, TENANT, { chips: CHIPS, agora: AGORA });
    expect(alertas(r)).toEqual(["Chip 9499:mudo"]);
    expect(r.alertas[0].minutosSemReceber).toBe(45);
    expect(r.alertas[0].diasComEntradaNestaHora).toBe(6);
  });

  it("horário quieto (recebeu nessa hora só em 2 dos 7 dias) não alerta", async () => {
    await costumaReceberNestaHora("Chip 9499", 2);
    await chegou({ chegada: min(45) });
    const r = await listarAlertasDeChip(pool, TENANT, { chips: CHIPS, agora: AGORA });
    expect(r.alertas).toEqual([]);
  });

  it("silêncio de 20 min não alerta", async () => {
    await costumaReceberNestaHora("Chip 9499", 6);
    await chegou({ chegada: min(20) });
    const r = await listarAlertasDeChip(pool, TENANT, { chips: CHIPS, agora: AGORA });
    expect(r.alertas).toEqual([]);
  });

  it("chip que nunca recebeu nada nos últimos 7 dias não alerta", async () => {
    const r = await listarAlertasDeChip(pool, TENANT, { chips: CHIPS, agora: AGORA });
    expect(r.alertas).toEqual([]);
  });
});

describe("Só chip conectado entra", () => {
  it.each(["close", "disconnected"])("chip %s não alerta (já aparece como caído)", async (estado) => {
    await chegou({ chegada: min(5), horaReal: min(600) });
    const r = await listarAlertasDeChip(pool, TENANT, {
      chips: [{ name: "Chip 9499", active: true, connection_state: estado }],
      agora: AGORA,
    });
    expect(r.alertas).toEqual([]);
  });

  it("chip inativo não alerta", async () => {
    await chegou({ chegada: min(5), horaReal: min(600) });
    const r = await listarAlertasDeChip(pool, TENANT, {
      chips: [{ name: "Chip 9499", active: false, connection_state: "open" }],
      agora: AGORA,
    });
    expect(r.alertas).toEqual([]);
  });

  it("sem chip cadastrado: lista vazia, sem consultar o banco", async () => {
    const consultas = [];
    const r = await listarAlertasDeChip({ query: (...a) => { consultas.push(a); return { rows: [] }; } }, TENANT, { chips: [], agora: AGORA });
    expect(r.alertas).toEqual([]);
    expect(consultas).toEqual([]);
  });

  it("devolve o limite usado e a hora da verificação", async () => {
    const r = await listarAlertasDeChip(pool, TENANT, { chips: CHIPS, agora: AGORA });
    expect(r.limiteMin).toBe(30);
    expect(r.verificadoEm).toBe(AGORA.toISOString());
  });
});
