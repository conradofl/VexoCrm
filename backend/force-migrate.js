import pg from 'pg';
import dotenv from 'dotenv';
import { runMigrations } from './src/migrate.js';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  console.log("Forcing migrations to run...");
  try {
    await runMigrations(pool);
    console.log("Migrations done.");
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
