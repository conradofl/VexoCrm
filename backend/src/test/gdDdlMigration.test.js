// DDL de runtime da GD (ensureGdTablesAndSeeds) virou a migration 20261126040000 (untangle, lote 5). Postgres real (pglite).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const MIG = readFileSync(resolve("supabase/migrations/20261126040000_gd_ddl_de_runtime.sql"), "utf8");
const tabelas = async (db) => (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1")).rows.map((r) => r.table_name);

describe("migration 20261126040000 (DDL da GD)", () => {
  it("[OBRIGATÓRIO] banco vazio: nenhum comando derruba a migration (cada um registra e segue) e as tabelas da GD nascem", async () => {
    const db = await createPgliteDb("CREATE TABLE public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid());");
    try {
      await expect(db.exec(MIG)).resolves.toBeDefined();
      await expect(db.exec(MIG)).resolves.toBeDefined(); // de novo: idempotente
      const t = await tabelas(db);
      for (const n of ["gd_proposals", "gd_packages", "gd_contracts", "gd_implementation_briefings", "gd_products", "gd_segments", "gd_payment_terms", "geracao_digital_briefings", "tenants"]) {
        expect(t, n).toContain(n);
      }
      const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'gd_proposals'")).rows.map((r) => r.column_name);
      expect(cols).toEqual(expect.arrayContaining(["dados_cadastrais", "assinatura_metodo", "owner_company", "presentation_slides"]));
    } finally {
      await db.close();
    }
  });

  it("dados que já existem ficam intactos", async () => {
    const db = await createPgliteDb("CREATE TABLE public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid());");
    try {
      await db.exec(MIG);
      await db.query("INSERT INTO gd_packages (nome) VALUES ('Pacote X')").catch(async () => {
        await db.query("INSERT INTO gd_packages (tenant_id, nome) VALUES ('00000000-0000-0000-0000-000000000000', 'Pacote X')");
      });
      const antes = (await db.query("SELECT nome FROM gd_packages")).rows;
      await db.exec(MIG);
      expect((await db.query("SELECT nome FROM gd_packages")).rows).toEqual(antes);
    } finally {
      await db.close();
    }
  });

  it("só DDL (nenhum INSERT/UPDATE/DELETE) e o arquivo da GD não roda mais CREATE/ALTER", () => {
    const sem = MIG.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sem).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im); // "ON DELETE CASCADE" de FK não conta
    const src = readFileSync(resolve("src/domains/geracaoDigitalRoutes.js"), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    expect(src).not.toMatch(/\b(CREATE TABLE|ALTER TABLE|CREATE (UNIQUE )?INDEX)\b/);
  });
});
