import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  const { rows: campaigns } = await pool.query("SELECT * FROM followup_campaigns WHERE status = 'active'");
  console.log('Active followup campaigns:', campaigns.length);

  const { rows: templates } = await pool.query("SELECT * FROM followup_templates WHERE is_active = true");
  console.log('Active templates:', templates.length);

  const { rows: bday } = await pool.query(`
      SELECT id, nome AS lead_name, telefone AS phone
        FROM leads
       WHERE client_id = 'livpub'
         AND data_nascimento IS NOT NULL
         AND EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM CURRENT_DATE)
         AND EXTRACT(DAY FROM data_nascimento) = EXTRACT(DAY FROM CURRENT_DATE)
  `);
  console.log('Bday leads:', bday.length);
  
  process.exit(0);
}
run().catch(console.error);
