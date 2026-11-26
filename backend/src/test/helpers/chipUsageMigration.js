// A tabela evolution_instance_daily_usage nasce SÓ da migration (o código não cria mais: untangle, DDL de runtime).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CHIP_USAGE_MIGRATION_SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "supabase", "migrations", "20261004130000_converge_evolution_instance_daily_usage_instance_id.sql"),
  "utf8"
);

/** db: PGlite (com exec). */
export async function applyChipUsageMigration(db) {
  await db.exec(CHIP_USAGE_MIGRATION_SQL);
}
