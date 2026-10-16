// backend/src/test/blocoCCalendarioCleanEMeet.test.js
// Testes automatizados do BLOCO C: CALENDÁRIO CLEAN & GOOGLE MEET

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../followup/db.js", () => {
  const queryMock = vi.fn();
  const supabaseMock = {
    from: vi.fn(),
  };
  return { query: queryMock, getSupabase: () => supabaseMock };
});

vi.mock("../followup/queue.js", () => ({
  getFollowupQueue: () => ({ add: vi.fn(), getJob: vi.fn() }),
}));

vi.mock("../services/evolution.js", () => ({
  getLeadClientEvolutionInstances: vi.fn().mockResolvedValue([]),
}));

import { registerFollowupRoutes } from "../followup/routes.js";
import { registerRemindersRoutes } from "../domains/reminders/routes.js";
import { query as mockFollowupQuery } from "../followup/db.js";

const mockReminderQuery = vi.fn();

function getFollowupRouteHandler(routePath, method) {
  let followupRouter = null;
  const fakeApp = {
    use: (path, router) => {
      if (path === "/api/followup") followupRouter = router;
    },
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  const noop = (req, res, next) => next?.();
  registerFollowupRoutes(fakeApp, noop, () => noop, noop);
  const layer = followupRouter.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function getReminderRouteHandler(routePath, method) {
  const routes = {};
  const fakeApp = {
    use: vi.fn(),
    get: (path, ...handlers) => { routes[`GET ${path}`] = handlers[handlers.length - 1]; },
    post: (path, ...handlers) => { routes[`POST ${path}`] = handlers[handlers.length - 1]; },
    patch: (path, ...handlers) => { routes[`PATCH ${path}`] = handlers[handlers.length - 1]; },
    delete: (path, ...handlers) => { routes[`DELETE ${path}`] = handlers[handlers.length - 1]; },
  };
  const noop = (req, res, next) => next?.();
  registerRemindersRoutes(fakeApp, {
    ensureDb: () => true,
    normalizeString: (s) => (typeof s === "string" ? s.trim() : ""),
    pgDatabasePool: { query: mockReminderQuery },
    requireAppViewAccess: () => noop,
    requireFirebaseAuth: noop,
    resolveAuthorizedClientId: (req) => req.body?.clientId || req.query?.clientId || "spazio",
    sendError: (res, code, msg) => res.status(code).json({ error: msg }),
  });
  return routes[`${method.toUpperCase()} ${routePath}`];
}

function fakeRes() {
  return {
    statusCode: 200,
    status(s) {
      this.statusCode = s;
      return this;
    },
    json: vi.fn(),
  };
}

describe("Bloco C: Calendário Clean & Google Meet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PARTE 1: Roll-up por Campanha no Calendário", () => {
    it("GET /api/followup/calendar: 16 lotes de uma mesma campanha geram campaignCount = 1 (e não 16) com soma total de leads", async () => {
      // Simula 16 lotes de 10 leads da mesma campanha no dia 16/10
      const dispatches = [];
      for (let i = 1; i <= 16; i++) {
        const hour = String(7 + i).padStart(2, "0");
        dispatches.push({
          campaign_id: "camp-spazio-1",
          target_count: 10,
          scheduled_at: `2026-10-16T${hour}:31:00.000Z`,
        });
      }

      mockFollowupQuery.mockImplementation(async (sql) => {
        if (sql.includes("SELECT fj.scheduled_for")) {
          return { rows: [] };
        }
        if (sql.includes("FROM public.campaign_dispatches")) {
          return { rows: dispatches };
        }
        if (sql.includes("SELECT id, name, date, location")) {
          return { rows: [] };
        }
        if (sql.includes("SELECT id, title, remind_at, activity_type")) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const handler = getFollowupRouteHandler("/calendar", "get");
      const req = {
        query: { clientId: "spazio", month: "2026-10" },
        authAccess: { role: "admin", isAdmin: true },
      };
      const res = fakeRes();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.json.mock.calls[0][0];
      const dayBreakdown = body.dayBreakdown["2026-10-16"];
      expect(dayBreakdown).toBeDefined();
      // REGRA DE OURO: campaignCount é 1 e NÃO 16!
      expect(dayBreakdown.campaignCount).toBe(1);
      // Leads total é a soma dos 16 lotes de 10 leads = 160
      expect(dayBreakdown.campaignLeadsTotal).toBe(160);
    });

    it("GET /api/followup/calendar/day: 16 lotes são agrupados em 1 Card Master consolidado com lista compacta de lotes", async () => {
      const dispatches = [];
      for (let i = 1; i <= 16; i++) {
        const hour = String(7 + i).padStart(2, "0");
        dispatches.push({
          dispatch_id: `disp-${i}`,
          campaign_id: "camp-spazio-1",
          campaign_name: "Continuação campanha 1 - correção",
          dispatch_name: `Lote ${i}/16`,
          target_count: 10,
          status: "scheduled",
          scheduled_at: `2026-10-16T${hour}:31:00.000Z`,
          evolution_instance_id: "inst-1",
        });
      }

      mockFollowupQuery.mockImplementation(async (sql) => {
        if (sql.includes("SELECT fj.id AS job_id")) {
          return { rows: [] };
        }
        if (sql.includes("SELECT d.id AS dispatch_id")) {
          return { rows: dispatches };
        }
        if (sql.includes("SELECT id, name, date, location")) {
          return { rows: [] };
        }
        if (sql.includes("SELECT id, client_id, lead_id, phone")) {
          return {
            rows: [
              {
                id: "rem-meet-1",
                lead_id: "lead-100",
                phone: "5534999990001",
                lead_name: "Cliente Spazio",
                title: "Call Apresentação",
                remind_at: "2026-10-16T15:00:00.000Z",
                activity_type: "meeting",
                meeting_url: "https://meet.google.com/abc-defg-hij",
                status: "pending",
              },
            ],
          };
        }
        return { rows: [] };
      });

      const handler = getFollowupRouteHandler("/calendar/day", "get");
      const req = {
        query: { clientId: "spazio", date: "2026-10-16" },
        authAccess: { role: "admin", isAdmin: true },
      };
      const res = fakeRes();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.json.mock.calls[0][0];

      // Apenas 1 card de campanha consolidada
      expect(body.campaigns).toHaveLength(1);
      const masterCard = body.campaigns[0];
      expect(masterCard.campaignId).toBe("camp-spazio-1");
      expect(masterCard.campaignName).toBe("Continuação campanha 1 - correção");
      expect(masterCard.loteCount).toBe(16);
      expect(masterCard.leadsTotal).toBe(160);
      expect(masterCard.firstScheduledAt).toBe("2026-10-16T08:31:00.000Z");
      expect(masterCard.lastScheduledAt).toBe("2026-10-16T23:31:00.000Z");
      expect(masterCard.lotes).toHaveLength(16);

      // Reunião com Google Meet injetada nos eventos do dia
      expect(body.meetings).toHaveLength(1);
      expect(body.meetings[0].meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
      const meetingEvent = body.events.find((e) => e.isMeeting);
      expect(meetingEvent).toBeDefined();
      expect(meetingEvent.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    });
  });

  describe("PARTE 2: Desfechos de Reunião e Atualização Automática no CRM", () => {
    it("PATCH /api/reminders/:id: registrar meetingOutcome='won' move automaticamente o lead para 'won' no CRM", async () => {
      let leadUpdatedPayload = null;
      mockReminderQuery.mockImplementation(async (sql, params) => {
        if (sql.includes("SELECT * FROM public.lead_reminders WHERE id = $1")) {
          return {
            rows: [
              {
                id: "rem-123",
                client_id: "spazio",
                lead_id: "lead-abc",
                phone: "5534999990001",
                lead_name: "Cliente Call",
                title: "Call Google Meet",
                activity_type: "meeting",
                meeting_url: "https://meet.google.com/abc-defg-hij",
                status: "pending",
              },
            ],
          };
        }
        if (sql.includes("UPDATE public.lead_reminders")) {
          return {
            rows: [
              {
                id: "rem-123",
                lead_id: "lead-abc",
                meeting_outcome: "won",
                status: "completed",
              },
            ],
          };
        }
        if (sql.includes("UPDATE public.leads")) {
          leadUpdatedPayload = params;
          return { rows: [{ id: "lead-abc", stage: "buyer" }] };
        }
        return { rows: [] };
      });

      const handler = getReminderRouteHandler("/api/reminders/:id", "patch");
      const req = {
        params: { id: "rem-123" },
        body: {
          clientId: "spazio",
          meetingOutcome: "won",
          status: "completed",
        },
        user: { uid: "user-1", email: "consultor@vexo.com.br" },
      };
      const res = fakeRes();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);

      // Valida que o lead foi atualizado para buyer/venda fechada no CRM
      expect(leadUpdatedPayload).toBeDefined();
      expect(leadUpdatedPayload).toEqual(["buyer", "lead-abc", "spazio"]);
    });
  });
});
