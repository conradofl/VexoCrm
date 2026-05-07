// VexoCrm/backend/scripts/conditional-migrate.mjs
// Runs Supabase CLI migrations before local `npm start` / `npm run dev` (npm `prestart` / `predev` hooks).
// Docker/EasyPanel uses start.sh + RUN_SUPABASE_MIGRATIONS_ON_START instead; this script is not invoked there.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");

dotenv.config({ path: join(backendRoot, ".env") });

// Opt out for a single run: SKIP_DB_MIGRATE=1
// Note: backend/.env often copies RUN_SUPABASE_MIGRATIONS_ON_START=0 for Docker; that flag is for start.sh only, not npm hooks.
if (process.env.SKIP_DB_MIGRATE === "1") {
  console.log("[migrate] Skipping because SKIP_DB_MIGRATE=1");
  process.exit(0);
}

const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.warn(
    "[migrate] Skipping: set SUPABASE_DB_URL or DATABASE_URL in backend/.env to apply migrations."
  );
  process.exit(0);
}

console.log("[migrate] Applying Supabase migrations (db push) before API start…");

const isWin = process.platform === "win32";
const result = spawnSync(
  "npx",
  ["--yes", "supabase@latest", "db", "push", "--db-url", dbUrl],
  {
    cwd: backendRoot,
    stdio: "inherit",
    shell: isWin,
    env: process.env,
  }
);

if (result.error) {
  console.error("[migrate] Failed to spawn npx:", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error("[migrate] supabase db push exited with code", result.status);
  process.exit(result.status ?? 1);
}

console.log("[migrate] Done.");
