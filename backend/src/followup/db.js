// Conexão com o banco de dados para o módulo de follow-up.
// Reutiliza createDatabasePool de pgPostgresCompat para manter consistência.
import { createDatabasePool, createPostgresCompatClient } from "../pgPostgresCompat.js";

let _pool = null;
let _db = null;

function getPool() {
  if (!_pool) {
    const connStr = process.env.DATABASE_URL;
    if (!connStr) throw new Error("[followup/db] DATABASE_URL não configurado.");
    _pool = createDatabasePool(connStr);
  }
  return _pool;
}

export function getDbClient() {
  if (!_db) {
    _db = createPostgresCompatClient(getPool());
  }
  return _db;
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
