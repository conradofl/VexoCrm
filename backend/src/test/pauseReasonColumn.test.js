// PR 6a do untangle: campaign_dispatches.pause_reason é gerada a partir de error_message com a
// mesma regra que o agendador usa hoje. Roda a migration de verdade em Postgres (PGlite).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { WINDOW_PAUSE_MARKER } from "../services/restartBlockers.js";
import { QUOTA_PAUSE_MARKER } from "../services/campaignQuotaGate.js";

const MIGRATION = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261125030000_add_pause_reason_to_campaign_dispatches.sql"),
  "utf8"
);

// Frases exatamente como os escritores montam hoje (domains/campaigns/routes.js).
const JANELA_AGENDADOR = "Pausado — fora da janela de envio (08:00–18:00). Retomará na próxima janela (abre 25/11 08:00).";
const JANELA_LOTE = "Pausado — fora da janela de envio (08:00–18:00). Retomará automaticamente na próxima janela.";
const COTA = `Pausado — cota diária do chip atingida (40/40 msgs hoje, necessário 1 para próximo lead). Retomará amanhã. ${QUOTA_PAUSE_MARKER}`;

let db;
beforeAll(async () => {
  db = new PGlite();
  await db.query(`CREATE TABLE public.campaign_dispatches (id serial PRIMARY KEY, status text, error_message text)`);
  await db.query(
    `INSERT INTO public.campaign_dispatches (status, error_message) VALUES
      ('paused', $1), ('paused', $2), ('paused', $3), ('paused', 'Pausado manualmente'), ('failed', NULL), ('paused', 'FORA DA JANELA DE ENVIO')`,
    [JANELA_AGENDADOR, JANELA_LOTE, COTA]
  );
  await db.exec(MIGRATION);
});
afterAll(async () => {
  await db?.close();
});

describe("campaign_dispatches.pause_reason (coluna gerada)", () => {
  it("as frases da migration são as mesmas constantes que o código usa", () => {
    expect(MIGRATION).toContain(`'%${WINDOW_PAUSE_MARKER}%'`);
    expect(MIGRATION).toContain(`'%${QUOTA_PAUSE_MARKER}%'`);
  });

  it("linhas que já existiam ganham o motivo sem backfill", async () => {
    const { rows } = await db.query(`SELECT error_message, pause_reason FROM public.campaign_dispatches ORDER BY id`);
    expect(rows.map((r) => r.pause_reason)).toEqual(["fora_da_janela", "fora_da_janela", "cota_chip", null, null, "fora_da_janela"]);
  });

  it("acompanha quem grava error_message (não precisa mudar escritor)", async () => {
    await db.query(`UPDATE public.campaign_dispatches SET error_message = $1 WHERE id = 4`, [COTA]);
    await db.query(`UPDATE public.campaign_dispatches SET error_message = NULL, status = 'running' WHERE id = 1`);
    const { rows } = await db.query(`SELECT id, pause_reason FROM public.campaign_dispatches WHERE id IN (1, 4) ORDER BY id`);
    expect(rows).toEqual([{ id: 1, pause_reason: null }, { id: 4, pause_reason: "cota_chip" }]);
  });

  it("decide igual ao filtro de texto que o agendador usa hoje", async () => {
    const { rows } = await db.query(
      `SELECT id,
              (error_message ILIKE '%' || $1 || '%' OR error_message ILIKE '%' || $2 || '%') AS pelo_texto,
              (pause_reason IS NOT NULL) AS pela_coluna
         FROM public.campaign_dispatches`,
      [WINDOW_PAUSE_MARKER, QUOTA_PAUSE_MARKER]
    );
    for (const r of rows) expect(r.pela_coluna, `linha ${r.id}`).toBe(r.pelo_texto === true);
  });

  it("rodar de novo não quebra (IF NOT EXISTS)", async () => {
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
  });
});
