// Esquema dos chips (lead_client_evolution_instances, auditoria, sync, lid_map) nasce SÓ das migrations desde o untangle
// (DDL de runtime virou migration 20261126010000). db: PGlite (com exec).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "supabase", "migrations");
const ler = (f) => readFileSync(join(MIGRATIONS, f), "utf8");

export const EVOLUTION_SCHEMA_MIGRATIONS = ["20260802140000_whatsapp_lid_map.sql", "20261126010000_evolution_ddl_de_runtime.sql"];

export async function applyEvolutionSchemaMigrations(db) {
  for (const f of EVOLUTION_SCHEMA_MIGRATIONS) await db.exec(ler(f));
}
