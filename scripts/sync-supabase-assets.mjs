import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(scriptDir, "..");
const sourceDir = join(repoRoot, "frontend", "supabase");
const targetDir = join(repoRoot, "backend", "supabase");
const sourceMigrationsDir = join(sourceDir, "migrations");
const targetMigrationsDir = join(targetDir, "migrations");
const sourceFunctionsDir = join(sourceDir, "functions");
const targetFunctionsDir = join(targetDir, "functions");

if (!existsSync(sourceDir)) {
  throw new Error(`Source Supabase directory not found: ${sourceDir}`);
}

mkdirSync(targetMigrationsDir, { recursive: true });

for (const entry of readdirSync(targetMigrationsDir)) {
  if (entry.endsWith(".sql")) {
    rmSync(join(targetMigrationsDir, entry), { force: true });
  }
}

cpSync(join(sourceDir, "config.toml"), join(targetDir, "config.toml"));

for (const entry of readdirSync(sourceMigrationsDir)) {
  if (entry.endsWith(".sql")) {
    cpSync(join(sourceMigrationsDir, entry), join(targetMigrationsDir, entry));
  }
}

if (existsSync(sourceFunctionsDir)) {
  rmSync(targetFunctionsDir, { recursive: true, force: true });
  cpSync(sourceFunctionsDir, targetFunctionsDir, { recursive: true });
}

console.log("Synced frontend/supabase to backend/supabase");
