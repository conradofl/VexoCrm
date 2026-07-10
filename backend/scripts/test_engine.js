import { query } from "../src/db.js";
query("SELECT column_name FROM information_schema.columns WHERE table_name = 'followup_companies'")
.then(res => { console.log(res.rows); process.exit(0); })
.catch(e => { console.error(e); process.exit(1); });
