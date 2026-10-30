// Banco pglite com o esquema REAL das migrations do follow-up, para os testes do
// Bloco 1 (resposta do lead para a cadência). Estado de módulo: um banco por teste.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteDb } from "./pgliteDb.js";
import { CREATE_USAGE_TABLE_SQL } from "../../services/chipQuota.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, "../../../supabase/migrations");
const FOLLOWUP_MIGRATIONS = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => /followup|fup_/.test(f))
  .sort();

let db = null;
export const getDb = () => db;
export const asPool = () => ({
  query: async (sql, params = []) => {
    const r = await db.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
});

// Pool do webhook: tabelas que o teste não montou (whatsapp_chat_states, chips...)
// respondem vazio para o handler seguir; tabela do follow-up nunca é perdoada.
export const tolerantPool = () => ({
  query: async (sql, params = []) => {
    try {
      return await asPool().query(sql, params);
    } catch (err) {
      if (/followup/.test(String(err?.message))) throw err;
      return { rows: [], rowCount: 0 };
    }
  },
});

let seq = 0;

export const COMPANY_A = "00000000-0000-0000-0000-0000000000a1";
export const COMPANY_A2 = "00000000-0000-0000-0000-0000000000a2";
export const COMPANY_B = "00000000-0000-0000-0000-0000000000b1";
export const LEAD_PHONE = "5534991093607";

export async function setupFollowupReplyDb() {
  seq = 0;
  db = await createPgliteDb();
  for (const f of FOLLOWUP_MIGRATIONS) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  }
  // A cota do chip cria a tabela uma vez por processo; aqui o banco é novo a cada teste.
  await db.exec(CREATE_USAGE_TABLE_SQL);
  await db.exec(`
    INSERT INTO followup_companies (id, name, evolution_instance, tenant_id) VALUES
      ('${COMPANY_A}', 'Agente A', 'Chip 1', 't-a'),
      ('${COMPANY_A2}', 'Agente A2', 'Chip 1', 't-a'),
      ('${COMPANY_B}', 'Agente B', 'Chip 1', 't-b');
  `);
}

export async function createCadence({ companyId = COMPANY_A, exitOnReply = true, steps = [{ trigger_type: "after_enrollment" }] } = {}) {
  seq++;
  const { rows: [camp] } = await db.query(
    `INSERT INTO followup_campaigns (company_id, name, status, exit_on_reply)
     VALUES ($1, $2, 'active', $3) RETURNING id`,
    [companyId, `cad-${seq}`, exitOnReply]
  );
  const templates = [];
  for (const [i, s] of steps.entries()) {
    const { rows: [tpl] } = await db.query(
      `INSERT INTO followup_templates (campaign_id, name, message, trigger_type, trigger_value, trigger_unit, order_index)
       VALUES ($1, $2, 'Oi, tudo bem?', $3, 1, 'days', $4) RETURNING id`,
      [camp.id, `p${i + 1}`, s.trigger_type, i]
    );
    templates.push(tpl.id);
  }
  return { campaignId: camp.id, templates };
}

export async function enroll({ campaignId, companyId = COMPANY_A, phone = LEAD_PHONE, createdAt = null, templates }) {
  const { rows: [sched] } = await db.query(
    `INSERT INTO followup_schedules (campaign_id, company_id, lead_name, phone, status, created_at)
     VALUES ($1, $2, 'Lead', $3, 'active', COALESCE($4::timestamptz, now())) RETURNING id`,
    [campaignId, companyId, phone, createdAt]
  );
  const jobs = [];
  for (const tpl of templates) {
    const { rows: [job] } = await db.query(
      `INSERT INTO followup_jobs (schedule_id, template_id, status, scheduled_for)
       VALUES ($1, $2, 'pending', now()) RETURNING id`,
      [sched.id, tpl]
    );
    jobs.push(job.id);
  }
  return { scheduleId: sched.id, jobs };
}

export async function statusOf(table, id) {
  const { rows } = await db.query(`SELECT status FROM ${table} WHERE id = $1`, [id]);
  return rows[0]?.status;
}

export async function addReply({ companyId = COMPANY_A, phone = LEAD_PHONE, at }) {
  await db.query(
    `INSERT INTO followup_replies (company_id, phone, payload, received_at) VALUES ($1, $2, '{}'::jsonb, $3::timestamptz)`,
    [companyId, phone, at]
  );
}

export async function closeFollowupReplyDb() {
  await db?.close();
  db = null;
}
