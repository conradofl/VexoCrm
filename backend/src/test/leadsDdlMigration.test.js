// DDL de runtime do lead-client-tables.js virou migration (untangle, 26/11/2026). Postgres real (pglite).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const MIG = readFileSync(resolve("supabase/migrations/20261126020000_leads_colunas_ancora.sql"), "utf8");

describe("migration 20261126020000 (colunas de âncora em leads)", () => {
  it("cria as 3 colunas, roda duas vezes sem erro e não mexe nos dados", async () => {
    const db = await createPgliteDb("CREATE TABLE public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text, telefone text);");
    try {
      await db.query("INSERT INTO leads (client_id, telefone) VALUES ('t', '5534991093607')");
      await db.exec(MIG);
      await db.exec(MIG);
      const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'leads'")).rows.map((r) => r.column_name);
      expect(cols).toEqual(expect.arrayContaining(["aniversario_casamento", "epoca_ferias", "data_retorno"]));
      expect((await db.query("SELECT client_id, telefone FROM leads")).rows).toEqual([{ client_id: "t", telefone: "5534991093607" }]);
    } finally {
      await db.close();
    }
  });

  it("só cria; e o lead-client-tables.js não roda mais DDL", () => {
    const semComentario = MIG.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(semComentario).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE|DROP)\b/i);
    const src = readFileSync(resolve("src/lead-client-tables.js"), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(src).not.toMatch(/\b(CREATE TABLE|ALTER TABLE|CREATE (UNIQUE )?INDEX|ADD COLUMN)\b/);
  });
});
