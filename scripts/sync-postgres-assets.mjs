import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(scriptDir, "..");
const sourceDir = join(repoRoot, "frontend", "postgres");
const targetDir = join(repoRoot, "backend", "postgres");
const sourceMigrationsDir = join(sourceDir, "migrations");
const targetMigrationsDir = join(targetDir, "migrations");

if (!existsSync(sourceMigrationsDir)) {
  throw new Error(`Source Postgres migrations directory not found: ${sourceMigrationsDir}`);
}

mkdirSync(targetMigrationsDir, { recursive: true });

for (const entry of readdirSync(targetMigrationsDir)) {
  if (entry.endsWith(".sql")) {
    rmSync(join(targetMigrationsDir, entry), { force: true });
  }
}

for (const entry of readdirSync(sourceMigrationsDir)) {
  if (entry.endsWith(".sql")) {
    cpSync(join(sourceMigrationsDir, entry), join(targetMigrationsDir, entry));
  }
}

console.log("Synced frontend/postgres migrations to backend/postgres migrations");
