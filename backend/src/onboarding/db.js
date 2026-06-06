import { createDatabasePool } from "../pgPostgresCompat.js";

let _pool = null;

export function getPool() {
  if (!_pool) {
    const connStr = process.env.DATABASE_URL;
    if (!connStr) throw new Error("[onboarding/db] DATABASE_URL não configurado.");
    _pool = createDatabasePool(connStr);
  }
  return _pool;
}
