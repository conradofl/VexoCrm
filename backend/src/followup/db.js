// Conexão com o banco de dados para o módulo de follow-up.
// Reutiliza createDatabasePool de pgSupabaseCompat para manter consistência.
import { createDatabasePool, createPgSupabaseClient } from "../pgSupabaseCompat.js";

let _pool = null;
let _supabase = null;

function getPool() {
  if (!_pool) {
    const connStr = process.env.DATABASE_URL;
    if (!connStr) throw new Error("[followup/db] DATABASE_URL não configurado.");
    _pool = createDatabasePool(connStr);
  }
  return _pool;
}

export function getSupabase() {
  if (!_supabase) {
    _supabase = createPgSupabaseClient(getPool());
  }
  return _supabase;
}

/**
 * Executa SQL raw. Útil para analytics com agregações complexas.
 * @param {string} text
 * @param {unknown[]} [params]
 */
export async function query(text, params = []) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
