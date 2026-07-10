import dotenv from "dotenv";
dotenv.config();
import { createDatabasePool } from "../src/pgSupabaseCompat.js";
const pool = createDatabasePool(process.env.DATABASE_URL);
pool.query("SELECT id, name FROM leads_clients WHERE name ILIKE '%liv%'").then(res => { console.log(res.rows); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
