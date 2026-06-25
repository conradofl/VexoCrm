import pg from 'pg';
import dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import { join } from 'path';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    await pool.query('DROP TABLE IF EXISTS public.fup_journeys CASCADE;');
    const sql = await readFile(join(process.cwd(), 'supabase/migrations/20260623151500_create_fup_journeys.sql'), 'utf8');
    await pool.query(sql);
    console.log("Table fup_journeys recreated successfully with followup_companies FK.");
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
