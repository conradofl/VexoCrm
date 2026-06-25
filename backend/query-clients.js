import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  try {
    const { rows } = await pool.query('SELECT id, name FROM public.leads_clients');
    console.log("Leads clients:", rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
