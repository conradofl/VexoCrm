// Migration 20261126010000: a DDL que services/evolution.js rodava em runtime. Postgres real (pglite).
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { applyEvolutionSchemaMigrations } from "./helpers/evolutionSchemaMigration.js";

const MIG = readFileSync(resolve("supabase/migrations/20261126010000_evolution_ddl_de_runtime.sql"), "utf8");
let db;
afterEach(async () => {
  if (db) await db.close();
  db = null;
});

const colunas = async (t) => (await db.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name", [t])).rows;
const indice = async (n) => (await db.query("SELECT 1 FROM pg_indexes WHERE indexname = $1", [n])).rows.length === 1;

describe("migration 20261126010000 (DDL de runtime do evolution.js)", () => {
  it("banco novo: cria chips, índices, auditoria, sync e as colunas da lid_map; rodar de novo não muda nada", async () => {
    db = await createPgliteDb("");
    await applyEvolutionSchemaMigrations(db);
    await db.exec(MIG);
    expect((await colunas("lead_client_evolution_instances")).map((c) => c.column_name)).toEqual(expect.arrayContaining(["connection_state", "owner_uid", "daily_limit_override", "webhook_enabled"]));
    for (const i of ["idx_lead_client_evolution_client", "idx_lead_client_evolution_owner_uid", "idx_lead_client_evolution_default", "idx_evolution_instance_daily_limit_audit_instance"]) expect(await indice(i), i).toBe(true);
    expect((await colunas("whatsapp_instance_sync_progress")).length).toBeGreaterThan(10);
    const lid = Object.fromEntries((await colunas("whatsapp_lid_map")).map((c) => [c.column_name, c.is_nullable]));
    expect(lid).toMatchObject({ phone: "YES", profile_pic: "YES", description: "YES", website: "YES", profile_checked: "YES" });
  });

  it("dados que já existem continuam iguais", async () => {
    db = await createPgliteDb("");
    await applyEvolutionSchemaMigrations(db);
    await db.query("INSERT INTO lead_client_evolution_instances (client_id, name, dispatch_webhook_url, is_default) VALUES ('t', 'Chip 1', 'https://x/a', true)");
    await db.query("INSERT INTO whatsapp_lid_map (lid, phone) VALUES ('1@lid', '5534991093607')");
    await db.exec(MIG);
    expect((await db.query("SELECT name, is_default FROM lead_client_evolution_instances")).rows).toEqual([{ name: "Chip 1", is_default: true }]);
    expect((await db.query("SELECT lid, phone FROM whatsapp_lid_map")).rows).toEqual([{ lid: "1@lid", phone: "5534991093607" }]);
  });

  it("[OBRIGATÓRIO] empresa com DOIS chips padrão (índice nunca existiu): a migration NÃO falha (não derruba o boot) e segue sem o índice", async () => {
    db = await createPgliteDb("");
    await db.exec(readFileSync(resolve("supabase/migrations/20260802140000_whatsapp_lid_map.sql"), "utf8"));
    await db.exec(`CREATE TABLE public.lead_client_evolution_instances (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL,
      name text NOT NULL DEFAULT 'Evolution', dispatch_webhook_url text NOT NULL, is_default boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true);`);
    await db.query("INSERT INTO lead_client_evolution_instances (client_id, dispatch_webhook_url, is_default) VALUES ('t','a',true), ('t','b',true)");
    await expect(db.exec(MIG)).resolves.toBeDefined();
    expect(await indice("idx_lead_client_evolution_default")).toBe(false);
    expect((await db.query("SELECT count(*)::int AS n FROM lead_client_evolution_instances")).rows[0].n).toBe(2);
  });

  it("só cria: nenhum DELETE, UPDATE, DROP TABLE ou TRUNCATE", () => {
    const semComentario = MIG.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(semComentario).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i);
  });

  it("o evolution.js não roda mais DDL", () => {
    const src = readFileSync(resolve("src/services/evolution.js"), "utf8");
    expect(src).not.toMatch(/\b(CREATE TABLE|ALTER TABLE|CREATE (UNIQUE )?INDEX)\b/);
  });
});
