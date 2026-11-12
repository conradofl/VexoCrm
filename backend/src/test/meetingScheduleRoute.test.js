// "Registrar → Reunião" da gaveta de Conversas pelas ROTAS REAIS de lembrete, com o banco em
// memória (PGlite), lido de volta pela consulta REAL do Dashboard (measureMeetings).
//
// Prova:
//   1. marcar a reunião grava UMA linha em followup_schedules e o Dashboard passa a contar;
//   2. reagendar não cria segunda reunião;
//   3. cancelar pela gaveta tira a reunião da conta do Dashboard;
//   4. o lead responder não cancela a reunião (o guarda de saída de cadência não a alcança);
//   5. lembrete comum e ligação não viram reunião;
//   6. se a linha do Dashboard não puder ser gravada, a reunião não fica salva pela metade.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { registerRemindersRoutes } from "../domains/reminders/routes.js";
import { measureMeetings } from "../services/dashboardOverview.js";
import { cancelFollowupCadenceOnReply } from "../services/followupExitGuard.js";

const TENANT = "geracao-digital";
const PHONE = "5534991112222";
let db;
let routes;
let failScheduleInsert = false;

const query = async (sql, params) => {
  if (failScheduleInsert && /INSERT INTO followup_schedules/.test(String(sql))) throw new Error("banco recusou");
  return db.query(sql, params);
};

async function call(key, { body = {}, params = {}, query: q = {} } = {}) {
  let status = 200;
  let payload = null;
  const res = {
    status: vi.fn((code) => { status = code; return res; }),
    json: vi.fn((data) => { payload = data; return res; }),
  };
  await routes[key]({ body: { clientId: TENANT, ...body }, params, query: { clientId: TENANT, ...q }, authUser: { uid: "user-1", displayName: "Caio" } }, res);
  return { status, payload };
}

const meetingsNow = async () => {
  const now = Date.now();
  return measureMeetings({ query }, {
    clientId: TENANT,
    currentStart: new Date(now - 7 * 86_400_000),
    currentEnd: new Date(now + 60_000),
    previousStart: new Date(now - 14 * 86_400_000),
    previousEnd: new Date(now - 7 * 86_400_000),
  });
};
const schedules = async () => (await db.query(`SELECT * FROM followup_schedules ORDER BY created_at`)).rows;
const createMeeting = (extra = {}) =>
  call("POST /api/reminders", {
    body: { phone: PHONE, leadName: "Marina Souza", title: "Reunião de apresentação", remindAt: new Date(Date.now() + 86_400_000).toISOString(), activityType: "meeting", ...extra },
  });

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE followup_companies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT, created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE followup_campaigns (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID, name TEXT, exit_on_reply BOOLEAN);
    CREATE TABLE followup_schedules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id UUID, company_id UUID NOT NULL, lead_name TEXT NOT NULL, phone TEXT,
      meeting_datetime TIMESTAMPTZ, calendly_event_uri TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','completed','converted','missing_phone')),
      origin TEXT, origin_type TEXT CHECK (origin_type IS NULL OR origin_type IN ('manual','utm','default')),
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE followup_jobs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id UUID, status TEXT, scheduled_for TIMESTAMPTZ);
    CREATE TABLE public.lead_reminders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, lead_id UUID, phone TEXT NOT NULL, lead_name TEXT,
      title TEXT NOT NULL, notes TEXT, remind_at TIMESTAMPTZ NOT NULL, assigned_to_uid TEXT, assigned_to_name TEXT,
      created_by_uid TEXT, created_by_name TEXT, status TEXT NOT NULL DEFAULT 'pending', completed_at TIMESTAMPTZ, completed_by_uid TEXT,
      activity_type TEXT DEFAULT 'reminder', meeting_url TEXT, call_status TEXT, meeting_outcome TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  routes = {};
  const register = (method) => vi.fn((path, ...handlers) => { routes[`${method} ${path}`] = handlers[handlers.length - 1]; });
  const app = { post: register("POST"), get: register("GET"), delete: register("DELETE"), put: register("PUT"), patch: register("PATCH") };
  registerRemindersRoutes(app, {
    ensureDb: () => true,
    normalizeString: (s) => (s ? String(s).trim() : ""),
    pgDatabasePool: { query },
    requireAppViewAccess: () => (_req, _res, next) => next(),
    requireFirebaseAuth: (_req, _res, next) => next(),
    resolveAuthorizedClientId: (_req, _res, cid) => cid || TENANT,
    sendError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
  });
  // O bootstrap da tabela roda sozinho no registro; espera ele terminar antes dos testes.
  await new Promise((resolve) => setTimeout(resolve, 50));
});

beforeEach(async () => {
  failScheduleInsert = false;
  await db.exec(`DELETE FROM followup_jobs; DELETE FROM followup_schedules; DELETE FROM lead_reminders; DELETE FROM followup_companies;`);
});

afterAll(async () => {
  await db?.close();
});

describe("Registrar → Reunião grava onde o Dashboard lê", () => {
  it("empresa sem nenhuma linha: o Dashboard diz 'sem registro'; depois de marcar, conta 1 pessoa", async () => {
    expect(await meetingsNow()).toEqual({ hasRecords: false, current: null, previous: null });

    const { status, payload } = await createMeeting();
    expect(status).toBe(201);

    const rows = await schedules();
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe(PHONE);
    expect(rows[0].lead_name).toBe("Marina Souza");
    expect(rows[0].origin).toBe("reuniao_conversas");
    expect(rows[0].campaign_id).toBeNull();
    expect(rows[0].calendly_event_uri).toBe(`lead-reminder:${payload.reminder.id}`);
    expect(new Date(rows[0].meeting_datetime).toISOString()).toBe(new Date(payload.reminder.remind_at).toISOString());

    expect(await meetingsNow()).toEqual({ hasRecords: true, current: 1, previous: 0 });
  });

  it("reagendar atualiza a mesma linha: continua UMA reunião", async () => {
    const { payload } = await createMeeting();
    const newDate = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const patched = await call("PATCH /api/reminders/:id", { params: { id: payload.reminder.id }, body: { remindAt: newDate } });
    expect(patched.status).toBe(200);

    const rows = await schedules();
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].meeting_datetime).toISOString()).toBe(newDate);
    expect((await meetingsNow()).current).toBe(1);
  });

  it("cancelar pela gaveta tira a reunião da conta do Dashboard e some dos lembretes", async () => {
    const { payload } = await createMeeting();
    expect((await meetingsNow()).current).toBe(1);

    const cancelled = await call("DELETE /api/reminders/:id", { params: { id: payload.reminder.id } });
    expect(cancelled.status).toBe(200);

    const rows = await schedules();
    expect(rows).toHaveLength(1); // a linha fica, como histórico
    expect(rows[0].status).toBe("cancelled");
    expect((await meetingsNow()).current).toBe(0);
    expect((await db.query(`SELECT 1 FROM lead_reminders`)).rows).toHaveLength(0);
  });

  it("o lead responder não cancela a reunião", async () => {
    await createMeeting();
    // Controle: uma mensagem agendada avulsa do mesmo lead, 'active'. O guarda TEM que cancelá-la,
    // senão este teste passaria só porque o guarda não rodou.
    const [meeting] = await schedules();
    await db.query(
      `INSERT INTO followup_schedules (company_id, lead_name, phone, status, origin) VALUES ($1,'Marina',$2,'active','manual')`,
      [meeting.company_id, PHONE]
    );

    const result = await cancelFollowupCadenceOnReply({ tenantId: TENANT, phone: PHONE, queryFn: query });
    expect(result.cancelledSchedules).toBe(1);

    const rows = await db.query(`SELECT origin, status FROM followup_schedules ORDER BY origin`);
    expect(rows.rows).toEqual([
      { origin: "manual", status: "cancelled" },
      { origin: "reuniao_conversas", status: "completed" },
    ]);
    expect((await meetingsNow()).current).toBe(1);
  });

  it("registrar o resultado da reunião não a tira da conta", async () => {
    const { payload } = await createMeeting();
    await call("PATCH /api/reminders/:id", { params: { id: payload.reminder.id }, body: { status: "completed", meetingOutcome: "no_show" } });
    expect((await meetingsNow()).current).toBe(1);
  });

  it("lembrete comum e ligação não viram reunião", async () => {
    await createMeeting({ activityType: "reminder", title: "Ligar amanhã" });
    await createMeeting({ activityType: "call", title: "Ligação", callStatus: "answered" });
    expect(await schedules()).toHaveLength(0);
    expect((await meetingsNow()).hasRecords).toBe(false);
  });

  it("apagar lembrete comum não mexe em followup_schedules", async () => {
    const meeting = await createMeeting();
    const reminder = await createMeeting({ activityType: "reminder", title: "Ligar amanhã" });
    await call("DELETE /api/reminders/:id", { params: { id: reminder.payload.reminder.id } });
    expect((await schedules())[0].status).toBe("completed");
    expect(meeting.status).toBe(201);
  });

  it("reunião antiga, sem linha, ganha a linha ao ser reagendada, datada de quando foi marcada", async () => {
    const createdAt = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const { rows } = await db.query(
      `INSERT INTO lead_reminders (client_id, phone, lead_name, title, remind_at, activity_type, created_at)
       VALUES ($1,$2,'Marina','Reunião',now() + interval '1 day','meeting',$3) RETURNING id`,
      [TENANT, PHONE, createdAt]
    );
    await call("PATCH /api/reminders/:id", { params: { id: rows[0].id }, body: { remindAt: new Date(Date.now() + 2 * 86_400_000).toISOString() } });

    const [row] = await schedules();
    expect(new Date(row.created_at).toISOString()).toBe(createdAt);
    expect(await meetingsNow()).toEqual({ hasRecords: true, current: 0, previous: 1 });
  });

  it("se a linha do Dashboard não grava, a reunião não fica salva pela metade", async () => {
    failScheduleInsert = true;
    const { status, payload } = await createMeeting();
    expect(status).toBe(500);
    expect(payload.error.code).toBe("MEETING_NOT_REGISTERED");
    expect((await db.query(`SELECT 1 FROM lead_reminders`)).rows).toHaveLength(0);
    expect(await schedules()).toHaveLength(0);
  });
});

describe("cancelamento com o CHECK antigo de status (grafia 'canceled')", () => {
  it("cancela mesmo quando o banco só aceita a grafia antiga, e o Dashboard deixa de contar", async () => {
    await db.exec(`
      ALTER TABLE followup_schedules DROP CONSTRAINT followup_schedules_status_check;
      ALTER TABLE followup_schedules ADD CONSTRAINT followup_schedules_status_check CHECK (status IN ('active','canceled','completed','missing_phone'));
    `);
    try {
      const { payload } = await createMeeting();
      const cancelled = await call("DELETE /api/reminders/:id", { params: { id: payload.reminder.id } });
      expect(cancelled.status).toBe(200);
      expect((await schedules())[0].status).toBe("canceled");
      expect((await meetingsNow()).current).toBe(0);
    } finally {
      await db.exec(`
        DELETE FROM followup_schedules;
        ALTER TABLE followup_schedules DROP CONSTRAINT followup_schedules_status_check;
        ALTER TABLE followup_schedules ADD CONSTRAINT followup_schedules_status_check CHECK (status IN ('active','cancelled','completed','converted','missing_phone'));
      `);
    }
  });
});
