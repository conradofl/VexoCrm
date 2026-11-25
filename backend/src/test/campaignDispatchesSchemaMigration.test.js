// PR 7 do untangle: o CHECK de status de campaign_dispatches mora na migration, não no código que
// derrubava e recriava a cada pausa. Roda a migration de verdade (PGlite).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const MIG = readFileSync(resolve(__dirname, "../../supabase/migrations/20261125050000_campaign_dispatches_status_check.sql"), "utf8");
const STATUS = ["draft", "scheduled", "running", "paused", "done", "failed", "cancelled", "interrupted"];

let db;
beforeAll(async () => {
  db = new PGlite();
  // Como nasceu em 20260517000000: CHECK sem 'paused' e sem 'interrupted'.
  await db.exec(`CREATE TABLE public.campaign_dispatches (
    id serial PRIMARY KEY,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'running', 'done', 'failed', 'cancelled'))
  )`);
  await db.exec(MIG);
});
afterAll(async () => {
  await db?.close();
});

describe("migration 20261125050000", () => {
  it.each(STATUS)("aceita status %s", async (st) => {
    await expect(db.query("INSERT INTO public.campaign_dispatches (status) VALUES ($1)", [st])).resolves.toBeDefined();
  });

  it("recusa status fora da lista", async () => {
    await expect(db.query("INSERT INTO public.campaign_dispatches (status) VALUES ('qualquer')")).rejects.toThrow();
  });

  it("cria as colunas e roda de novo sem erro", async () => {
    const { rows } = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'campaign_dispatches' ORDER BY column_name"
    );
    expect(rows.map((r) => r.column_name)).toEqual(expect.arrayContaining(["dispatch_options", "evolution_instance_id", "target_count"]));
    await expect(db.exec(MIG)).resolves.toBeDefined();
  });

  it("o código não derruba mais CHECK nem faz ALTER de campaign_dispatches/runs por requisição", () => {
    const rotas = readFileSync(resolve(__dirname, "../domains/campaigns/routes.js"), "utf8");
    expect(rotas).not.toMatch(/DROP CONSTRAINT IF EXISTS campaign_dispatches_status_check/);
    expect(rotas).not.toMatch(/DROP CONSTRAINT IF EXISTS campaign_dispatch_runs_status_check/);
    expect(rotas).not.toMatch(/ALTER TABLE public\.campaign_dispatch_runs ADD COLUMN/);
  });
});
