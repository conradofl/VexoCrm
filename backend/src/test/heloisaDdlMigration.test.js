// A secretária (heloisaEngine.js, ensureHeloisaTables) não roda mais DDL: tabelas e índices vêm das migrations
// 20261114190000 e 20261116183000 (untangle, lote 6, 26/11/2026). Seeds e correções idempotentes ficam no código.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { ensureHeloisaTables } from "../domains/goclaw/heloisaEngine.js";

const MIGS = ["20261114190000_create_heloisa_usuarios.sql", "20261116183000_create_heloisa_execucoes_and_agendas.sql"];

describe("secretária sem DDL em runtime", () => {
  it("o arquivo não tem CREATE/ALTER; seeds e correções continuam", () => {
    const src = readFileSync(resolve("src/domains/goclaw/heloisaEngine.js"), "utf8");
    const a = src.indexOf("export async function ensureHeloisaTables");
    const bloco = src.slice(a, src.indexOf("\n}\n", a)).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(bloco).not.toMatch(/\b(CREATE TABLE|ALTER TABLE|CREATE (UNIQUE )?INDEX)\b/);
    expect(bloco).toContain("INSERT INTO public.heloisa_config");
    expect(bloco).toContain("INSERT INTO public.heloisa_agendas");
    expect(bloco).toContain("INSERT INTO public.heloisa_usuarios_autorizados");
    expect(bloco).toContain("DELETE FROM public.heloisa_agendas WHERE email = 'conradofinzi@gmail.com'");
  });

  it("com as migrations, ensureHeloisaTables roda (seeds com ON CONFLICT) e duas vezes não duplica", async () => {
    const db = await createPgliteDb("");
    try {
      for (const m of MIGS) await db.exec(readFileSync(resolve("supabase/migrations", m), "utf8"));
      const pool = { query: (sql, p) => (p ? db.query(sql, p) : db.exec(sql)) };
      await ensureHeloisaTables(pool);
      await ensureHeloisaTables(pool);
      const n = async (t) => (await db.query(`SELECT count(*)::int AS n FROM public.${t}`)).rows[0].n;
      expect(await n("heloisa_config")).toBe(1);
      const agendas = await n("heloisa_agendas");
      await ensureHeloisaTables(pool);
      expect(await n("heloisa_agendas")).toBe(agendas);
    } finally {
      await db.close();
    }
  });
});
