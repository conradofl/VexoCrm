// Medição do atraso da Evolution na entrada (resposta do lead que chega horas depois e é barrada). Postgres real (pglite).
import { afterEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { measureInboundDelay, getInboundDelayStatus, _resetInboundDelayStatusForTesting } from "../services/inboundDelayStatus.js";

let db;
afterEach(async () => {
  _resetInboundDelayStatusForTesting();
  await db?.close();
});

describe("measureInboundDelay", () => {
  it("conta por dia (fuso de SP) e por empresa: recebidas, atrasadas (>30 min), barradas e atraso mediano", async () => {
    db = await createPgliteDb(`CREATE TABLE public.lead_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text,
      direction text, message_timestamp timestamptz, created_at timestamptz, meta jsonb DEFAULT '{}'::jsonb);`);
    await db.exec(`
      INSERT INTO lead_messages (client_id, direction, message_timestamp, created_at, meta) VALUES
        ('adv', 'inbound', '2026-11-18 21:28:00+00', '2026-11-19 03:00:00+00', '{"agente_barrado":"mensagem_atrasada"}'),
        ('adv', 'inbound', '2026-11-18 21:29:00+00', '2026-11-18 21:29:05+00', '{}'),
        ('adv', 'outbound','2026-11-18 21:00:00+00', '2026-11-19 05:00:00+00', '{}'),
        ('tinge','inbound', '2026-11-25 12:00:00+00', '2026-11-25 12:00:03+00', '{}'),
        ('velho','inbound', '2026-11-01 12:00:00+00', '2026-11-02 12:00:00+00', '{}');
    `);
    const r = await measureInboundDelay({ query: (sql, p) => db.query(sql, p) });
    // agrupa pelo dia de CHEGADA (fuso de SP): a resposta das 18:28 de 18/11 chegou 00:00 de 19/11
    expect(Object.keys(r.porDia)).toEqual(["2026-11-18", "2026-11-19", "2026-11-25"]);
    expect(r.porDia["2026-11-18"]).toMatchObject({ recebidas: 1, atrasadas: 0, barradas: 0 });
    expect(r.porDia["2026-11-19"]).toMatchObject({ recebidas: 1, atrasadas: 1, barradas: 1 });
    expect(r.porDia["2026-11-19"].empresasComAtraso.adv).toMatchObject({ recebidas: 1, atrasadas: 1, barradas: 1, atrasoMedianoMin: 332 });
    expect(r.porDia["2026-11-25"]).toMatchObject({ recebidas: 1, atrasadas: 0, barradas: 0, empresasComAtraso: {} });
  });

  it("no /health: dispara em segundo plano uma vez e depois devolve o resultado guardado", async () => {
    db = await createPgliteDb(`CREATE TABLE public.lead_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text,
      direction text, message_timestamp timestamptz, created_at timestamptz, meta jsonb DEFAULT '{}'::jsonb);`);
    const pool = { query: (sql, p) => db.query(sql, p) };
    expect(getInboundDelayStatus(pool)).toEqual({ medido: false, emAndamento: true });
    await new Promise((r) => setTimeout(r, 300));
    expect(getInboundDelayStatus(pool).medido).toBe(true);
  });
});
