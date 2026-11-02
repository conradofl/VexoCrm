// Passo 2 da frente GD (02/11/2026): as Esteiras 3 e 4 (aniversário e inativo) só rodam para a
// LivPub, e o tenant_id chega ao SQL como parâmetro, não colado no texto.
// O SQL roda num Postgres de verdade em memória (PGlite). Só a conexão (followup/db.js) é trocada;
// o motor é o código real. Cada consulta é registrada para conferir texto e parâmetros.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const pg = { db: null };
const calls = [];

vi.mock("../followup/db.js", () => ({
  query: async (text, params = []) => {
    calls.push({ text, params });
    return pg.db.query(text, params);
  },
}));

delete process.env.GROQ_API_KEY;

const { findLivPubCandidates, fetchLeadsInBatches, runAutomationEngine, LIVPUB_ESTEIRA_TENANTS } =
  await import("../followup/automationEngine.js");

const ASPA = "x' OR '1'='1";
const leadsQueries = () => calls.filter((c) => /FROM leads/.test(c.text));

beforeAll(async () => {
  pg.db = new PGlite();
  await pg.db.exec(`
    CREATE TABLE followup_companies (
      id TEXT PRIMARY KEY, tenant_id TEXT, archived_at TIMESTAMPTZ,
      engine_scan_interval_hours INT, never_contacted_delay_hours INT, no_reply_delay_hours INT,
      livpub_inactive_delay_months INT, last_engine_run_at TIMESTAMPTZ,
      livpub_aniversario_prompt TEXT, livpub_inativo_prompt TEXT
    );
    CREATE TABLE followup_campaigns (id TEXT PRIMARY KEY, company_id TEXT, status TEXT);
    CREATE TABLE followup_templates (
      id TEXT PRIMARY KEY, campaign_id TEXT, name TEXT, message TEXT, is_active BOOLEAN, order_index INT
    );
    CREATE TABLE followup_schedules (
      id TEXT PRIMARY KEY, campaign_id TEXT, company_id TEXT, status TEXT, created_at TIMESTAMPTZ,
      lead_name TEXT, phone TEXT, origin TEXT, meeting_datetime TIMESTAMPTZ
    );
    CREATE TABLE followup_jobs (id TEXT PRIMARY KEY, schedule_id TEXT, status TEXT, sent_at TIMESTAMPTZ);
    CREATE TABLE followup_replies (company_id TEXT, phone TEXT);
    CREATE TABLE followup_suggestions (
      id SERIAL PRIMARY KEY, company_id TEXT, campaign_id TEXT, lead_name TEXT, phone TEXT,
      lead_source TEXT, reason TEXT, suggested_template_id TEXT, suggested_message TEXT,
      status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE leads (
      id TEXT PRIMARY KEY, nome TEXT, telefone TEXT, lead_source TEXT, perfil_musical TEXT,
      client_id TEXT, data_nascimento DATE, ultima_visita TIMESTAMPTZ
    );
  `);
});

afterAll(async () => {
  await pg.db?.close();
});

async function addCompany(id, tenantId) {
  await pg.db.query(`INSERT INTO followup_companies (id, tenant_id) VALUES ($1, $2)`, [id, tenantId]);
}

// Um aniversariante de hoje e um inativo há 8 meses para o client_id dado.
async function addLeads(clientId, prefix) {
  await pg.db.query(
    `INSERT INTO leads (id, nome, telefone, client_id, data_nascimento)
     VALUES ($1, 'Aniversariante', $2, $3, (CURRENT_DATE - INTERVAL '30 years')::date)`,
    [`${prefix}-bday`, `${prefix}-tel-bday`, clientId]
  );
  await pg.db.query(
    `INSERT INTO leads (id, nome, telefone, client_id, ultima_visita)
     VALUES ($1, 'Inativo', $2, $3, NOW() - INTERVAL '8 months')`,
    [`${prefix}-inativo`, `${prefix}-tel-inativo`, clientId]
  );
}

beforeEach(async () => {
  calls.length = 0;
  await pg.db.exec(`
    DELETE FROM followup_companies; DELETE FROM followup_campaigns; DELETE FROM followup_templates;
    DELETE FROM followup_schedules; DELETE FROM followup_jobs; DELETE FROM followup_replies;
    DELETE FROM followup_suggestions; DELETE FROM leads;
  `);
});

describe("lista explícita das Esteiras 3 e 4", () => {
  it("só a chave canônica 'livpub' está na lista; 'liv_pub' e a GD ficam fora", () => {
    expect(LIVPUB_ESTEIRA_TENANTS).toEqual(["livpub"]);
    expect(Object.isFrozen(LIVPUB_ESTEIRA_TENANTS)).toBe(true);
  });

  it("varredura completa: GD com aniversariante e inativo não recebe sugestão nem é consultada", async () => {
    await addCompany("co-livpub", "livpub");
    await addCompany("co-gd", "geracao-digital");
    await addCompany("co-liv-teste", "liv_pub");
    await addLeads("livpub", "liv");
    await addLeads("geracao-digital", "gd");
    await addLeads("liv_pub", "livteste");

    await runAutomationEngine(true);

    const { rows } = await pg.db.query(
      `SELECT company_id, phone FROM followup_suggestions ORDER BY phone`
    );
    expect(rows).toEqual([
      { company_id: "co-livpub", phone: "liv-tel-bday" },
      { company_id: "co-livpub", phone: "liv-tel-inativo" },
    ]);
    const tenantsConsultados = leadsQueries().map((c) => c.params[0]);
    expect(tenantsConsultados).not.toContain("geracao-digital");
    expect(tenantsConsultados).not.toContain("liv_pub");
  });

  it("findLivPubCandidates da GD devolve vazio sem tocar em leads", async () => {
    await addCompany("co-gd", "geracao-digital");
    await addLeads("geracao-digital", "gd");

    expect(await findLivPubCandidates("co-gd")).toEqual([]);
    expect(leadsQueries()).toHaveLength(0);
  });
});

describe("tenant_id vai como parâmetro, nunca colado no SQL", () => {
  it("LivPub acha aniversariante e inativo, e 'livpub' só aparece nos parâmetros", async () => {
    await addCompany("co-livpub", "livpub");
    await addLeads("livpub", "liv");
    await addLeads("outro-cliente", "outro");

    const found = await findLivPubCandidates("co-livpub", 6);
    expect(found.map((l) => [l.phone, l.reasonType]).sort()).toEqual([
      ["liv-tel-bday", "livpub_aniversario"],
      ["liv-tel-inativo", "livpub_inativo"],
    ]);

    const q = leadsQueries();
    expect(q).toHaveLength(2);
    for (const c of q) {
      expect(c.text).not.toContain("livpub");
      expect(c.params[0]).toBe("livpub");
    }
  });

  it("tenant_id com aspa no cadastro não passa da lista: nenhuma consulta em leads", async () => {
    await addCompany("co-aspa", ASPA);
    await addLeads("livpub", "liv");

    expect(await findLivPubCandidates("co-aspa")).toEqual([]);
    expect(leadsQueries()).toHaveLength(0);
  });

  it("valor com aspa chega ao banco como valor: casa só a linha literal e não muda o SQL", async () => {
    await addLeads(ASPA, "aspa");
    await addLeads("livpub", "liv");
    await addLeads("geracao-digital", "gd");

    const rows = await fetchLeadsInBatches("leads", "client_id = $1", [ASPA], "teste");
    expect(rows.map((r) => r.phone).sort()).toEqual(["aspa-tel-bday", "aspa-tel-inativo"]);

    const [c] = leadsQueries();
    expect(c.text).not.toContain("'1'='1");
    expect(c.params[0]).toBe(ASPA);
  });
});

describe("Esteiras 1 e 2 (follow-up de campanha) continuam para todas as empresas", () => {
  it("GD com campanha ativa recebe sugestão; o prazo em horas vai como parâmetro", async () => {
    await addCompany("co-gd", "geracao-digital");
    await pg.db.query(`UPDATE followup_companies SET never_contacted_delay_hours = 2 WHERE id = 'co-gd'`);
    await pg.db.query(`INSERT INTO followup_campaigns VALUES ('camp-gd', 'co-gd', 'active')`);
    await pg.db.query(
      `INSERT INTO followup_templates VALUES ('tpl-1', 'camp-gd', 'Oi', 'Olá!', true, 1)`
    );
    // 3h atrás passa do prazo de 2h; 1h atrás ainda não.
    await pg.db.query(
      `INSERT INTO followup_schedules (id, campaign_id, company_id, status, created_at, lead_name, phone)
       VALUES ('s-velho', 'camp-gd', 'co-gd', 'active', NOW() - INTERVAL '3 hours', 'Velho', 'tel-velho'),
              ('s-novo',  'camp-gd', 'co-gd', 'active', NOW() - INTERVAL '1 hour',  'Novo',  'tel-novo')`
    );

    await runAutomationEngine(true);

    const { rows } = await pg.db.query(`SELECT company_id, phone FROM followup_suggestions`);
    expect(rows).toEqual([{ company_id: "co-gd", phone: "tel-velho" }]);
    const nunca = calls.find((c) => /FROM followup_schedules fs/.test(c.text) && /NOT EXISTS \(\s*SELECT 1 FROM followup_jobs fj WHERE/.test(c.text));
    expect(nunca.text).not.toMatch(/INTERVAL '\d/);
    expect(nunca.params).toEqual(["camp-gd", "co-gd", 2]);
  });
});
