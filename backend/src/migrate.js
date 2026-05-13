/**
 * Migration runner para Postgres direto.
 * Roda na subida do backend — aplica apenas migrations ainda não executadas.
 * Rastreia execuções na tabela schema_migrations.
 */

import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(pool) {
  const { rows } = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
  return new Set(rows.map((r) => r.version));
}

async function getPendingMigrations(applied) {
  let files;
  try {
    files = await readdir(MIGRATIONS_DIR);
  } catch {
    console.warn("[migrate] Migrations dir not found:", MIGRATIONS_DIR);
    return [];
  }

  return files
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !applied.has(f));
}

async function runMigration(pool, filename) {
  const filepath = join(MIGRATIONS_DIR, filename);
  const sql = await readFile(filepath, "utf8");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (version) VALUES ($1)",
      [filename]
    );
    await client.query("COMMIT");
    console.info(`[migrate] ✅ Applied: ${filename}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`[migrate] ❌ Failed: ${filename} — ${err.message}`);
  } finally {
    client.release();
  }
}

export async function runMigrations(pool) {
  if (!pool) {
    console.warn("[migrate] No Postgres pool — skipping migrations");
    return;
  }

  try {
    await ensureMigrationsTable(pool);
    const applied = await getAppliedMigrations(pool);
    const pending = await getPendingMigrations(applied);

    if (pending.length === 0) {
      console.info("[migrate] No pending migrations");
      return;
    }

    console.info(`[migrate] Running ${pending.length} migration(s)...`);
    for (const filename of pending) {
      await runMigration(pool, filename);
    }
    console.info("[migrate] All migrations applied");
  } catch (err) {
    console.error("[migrate] Migration error:", err.message);
    // Não mata o processo — loga e continua
    // Se uma migration crítica falhar, o erro vai aparecer quando o código tentar usar a coluna
  }
}
