import { createClient } from "@supabase/supabase-js";
import { createDatabasePool, createPgSupabaseClient } from "../pgSupabaseCompat.js";

let databaseUrl = "";
let dataSource = "";
let dbDriverEnv = "";
let supabaseUrl;
let supabaseServiceRoleKey;
let useDirectPostgres = false;

let pgDatabasePool = null;
let supabase = null;

function getDatabaseHostForLogging(connectionString) {
  if (!connectionString) return null;
  try {
    return new URL(connectionString).hostname || null;
  } catch {
    return null;
  }
}

function isLikelyIpv4Host(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(String(hostname || ""));
}

/**
 * Inicializa o pool Postgres (ou cliente Supabase legado). Precisa ser chamada
 * depois de dotenv.config(), por isso é exposta como função em vez de
 * side-effect no import do módulo.
 */
function initDatabase({ isProduction } = {}) {
  databaseUrl = (process.env.DATABASE_URL || "").trim();
  dataSource = (process.env.DATA_SOURCE || "").trim().toLowerCase();
  dbDriverEnv = (process.env.DB_DRIVER || "").trim().toLowerCase();
  supabaseUrl = process.env.SUPABASE_URL || process.env.URL;
  supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

  /**
   * postgres: pg pool + query shim (VPS or any Postgres).
   * supabase: official Supabase JS client (PostgREST).
   * Legacy: DATABASE_URL without DATA_SOURCE=supabase still selects postgres unless DB_DRIVER=supabase.
   */
  useDirectPostgres =
    dbDriverEnv === "postgres" ||
    (dbDriverEnv !== "supabase" && Boolean(databaseUrl) && dataSource !== "supabase");

  if (useDirectPostgres) {
    if (!databaseUrl) {
      console.error("[database] Postgres selected but DATABASE_URL is empty (set DB_DRIVER=supabase to use Supabase only)");
      process.exit(1);
    }
    const databaseHost = getDatabaseHostForLogging(databaseUrl);
    pgDatabasePool = createDatabasePool(databaseUrl);
    pgDatabasePool.on("error", (err) => {
      console.error("[database] pg pool error (idle client):", err?.message || err);
    });
    supabase = createPgSupabaseClient(pgDatabasePool);
    console.info("[database] Using direct PostgreSQL (pg)", dbDriverEnv ? `(DB_DRIVER=${dbDriverEnv})` : "(DATABASE_URL)");
    if (isProduction && isLikelyIpv4Host(databaseHost)) {
      console.warn(
        `[database] DATABASE_URL is using public host ${databaseHost}. ` +
          "If API and Postgres run on the same EasyPanel/VPS, prefer the internal service host " +
          "(for example apps_db-vexo:5432) to avoid NAT/firewall latency and intermittent timeouts."
      );
    }
  } else if (supabaseUrl && supabaseServiceRoleKey) {
    supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    console.info("[database] Using Supabase JS client");
  } else {
    console.warn(
      "[database] No database client configured. Set DATABASE_URL for VPS Postgres, or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for Supabase."
    );
  }

  return {
    databaseUrl,
    dataSource,
    dbDriverEnv,
    useDirectPostgres,
    pgDatabasePool,
    supabase,
    supabaseUrl,
    supabaseServiceRoleKey,
  };
}

// SIGTERM/SIGINT são tratados por gracefulShutdown (fecha HTTP + pool + exit), definido
// junto ao app.listen — não registrar handlers de sinal aqui para não duplicar.
function shutdownPgPool() {
  if (pgDatabasePool) {
    return pgDatabasePool.end().catch(() => {});
  }
  return Promise.resolve();
}

export {
  initDatabase,
  shutdownPgPool,
  getDatabaseHostForLogging,
  isLikelyIpv4Host,
  databaseUrl,
  dataSource,
  dbDriverEnv,
  supabaseUrl,
  supabaseServiceRoleKey,
  useDirectPostgres,
  pgDatabasePool,
  supabase,
};
