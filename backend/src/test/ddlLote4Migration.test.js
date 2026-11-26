// DDL de runtime lote 4 (chatbot, follow-up, lembretes, importação, captação, auditorias, cache, rodízio, notificações,
// funil): o que faltava foi para a migration 20261126030000; o resto já tinha migration. Postgres real (pglite).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const MIG = readFileSync(resolve("supabase/migrations/20261126030000_ddl_de_runtime_lote4.sql"), "utf8");
const BASE = `
  CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
`;
const ARQUIVOS = [
  "src/domains/chatbot/routes.js", "src/followup/service.js", "src/domains/reminders/routes.js", "src/services/leadImportBatches.js",
  "src/services/leadCapture.js", "src/services/leadOriginFix.js", "src/services/leadMassDelete.js", "src/services/dashboardCalculations.js",
  "src/services/sdrRotationState.js", "src/domains/notifications/routes.js", "src/services/funnelService.js", "src/domains/integrations/routes.js",
];

describe("migration 20261126030000 (DDL de runtime, lote 4)", () => {
  it("cria o que faltava, roda duas vezes sem erro e não mexe nos dados", async () => {
    const db = await createPgliteDb(BASE);
    try {
      await db.query("INSERT INTO leads_clients (id, name) VALUES ('t', 'Tenant')");
      await db.exec(MIG);
      await db.exec(MIG);
      const tem = async (sql, p) => (await db.query(sql, p)).rows.length > 0;
      expect(await tem("SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_capture_dispatches'")).toBe(true);
      for (const i of ["idx_lead_capture_dispatches_client_time", "idx_lead_capture_dispatches_phone_time", "idx_notifications_client_read_created"]) {
        expect(await tem("SELECT 1 FROM pg_indexes WHERE indexname = $1", [i]), i).toBe(true);
      }
      expect(await tem("SELECT 1 FROM information_schema.columns WHERE table_name = 'leads_clients' AND column_name = 'funnel_config'")).toBe(true);
      expect((await db.query("SELECT id, name FROM leads_clients")).rows).toEqual([{ id: "t", name: "Tenant" }]);
    } finally {
      await db.close();
    }
  });

  it("só cria; e nenhum dos 12 arquivos roda DDL", () => {
    const semComentario = MIG.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(semComentario).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE|DROP)\b/i);
    for (const f of ARQUIVOS) {
      const src = readFileSync(resolve(f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
      expect(src, f).not.toMatch(/\b(CREATE TABLE|ALTER TABLE|CREATE (UNIQUE )?INDEX|ADD COLUMN)\b/);
    }
  });
});
