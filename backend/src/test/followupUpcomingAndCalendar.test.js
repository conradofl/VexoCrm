import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../followup/db.js", () => {
  const queryMock = vi.fn();
  const supabaseMock = { from: vi.fn() };
  return { query: queryMock, getSupabase: () => supabaseMock };
});

vi.mock("../followup/queue.js", () => ({
  getFollowupQueue: () => ({ add: vi.fn(), getJob: vi.fn() }),
}));

// Chip real depende de services/database.js (pgDatabasePool) — mockado explícito
// pra não depender do estado global "fica null se ninguém chamou initDatabase()".
// Instâncias vazias == chip não resolvido == o código de rota cai no fallback
// gracioso (só a própria empresa da cadência), sem derrubar a faixa.
vi.mock("../services/evolution.js", () => ({
  getLeadClientEvolutionInstances: vi.fn().mockResolvedValue([]),
}));

import {
  groupPendingJobsByDay,
  buildUpcomingDayKeys,
  projectLeadsOntoDays,
  dayKeyInTimezone,
} from "../followup/service.js";
import { registerFollowupRoutes } from "../followup/routes.js";
import { query as mockQuery, getSupabase as mockGetSupabase } from "../followup/db.js";

function getRouteHandler(routePath, method) {
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
  expect(followupRouter).toBeDefined();
  const layer = followupRouter.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  expect(layer, `rota ${method.toUpperCase()} ${routePath} não encontrada`).toBeDefined();
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  return {
    statusCode: 200,
    status(s) { this.statusCode = s; return this; },
    json: vi.fn(),
  };
}

function accessAssignedClients(clientIds) {
  return { role: "internal", isAdmin: false, scopeMode: "assigned_clients", clientIds };
}

describe("Etapa 5 Commit 3 — faixa 'Próximos N dias' e calendário", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("groupPendingJobsByDay — função pura", () => {
    it("conta o que existe: 3 pendentes amanhã -> 3, e nenhum cancelled ou sent entra", () => {
      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const jobs = [
        { status: "pending", scheduled_for: amanha },
        { status: "pending", scheduled_for: amanha },
        { status: "pending", scheduled_for: amanha },
        { status: "sent", scheduled_for: amanha },
        { status: "cancelled", scheduled_for: amanha },
      ];
      const counts = groupPendingJobsByDay(jobs, { timezone: "America/Sao_Paulo" });
      const key = dayKeyInTimezone(new Date(amanha), "America/Sao_Paulo");
      expect(counts.get(key)).toBe(3);
      // soma total de todas as chaves == 3, não 5 — prova que sent/cancelled não vazam
      const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
      expect(total).toBe(3);
    });

    it("job sem scheduled_for é ignorado, não quebra o agrupamento", () => {
      const counts = groupPendingJobsByDay([{ status: "pending", scheduled_for: null }]);
      expect(counts.size).toBe(0);
    });
  });

  describe("buildUpcomingDayKeys", () => {
    it("gera N chaves consecutivas a partir de now, no timezone informado", () => {
      const now = new Date("2026-09-15T14:00:00Z"); // terça 11:00 SP
      const keys = buildUpcomingDayKeys(now, 7, "America/Sao_Paulo");
      expect(keys).toEqual([
        "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18",
        "2026-09-19", "2026-09-20", "2026-09-21",
      ]);
    });
  });

  describe("projectLeadsOntoDays — função pura", () => {
    it("projeta leads só em passos com data calculável, ignora passos que exigem meeting/âncora", () => {
      const now = new Date("2026-09-15T14:00:00Z");
      const sendWindowConfig = { start: "08:00", end: "20:00", days: ["mon","tue","wed","thu","fri"], timezone: "America/Sao_Paulo" };
      const templates = [
        { id: "t1", trigger_type: "on_schedule", trigger_value: 0, trigger_unit: "days", is_active: true },
        { id: "t2", trigger_type: "before_meeting", trigger_value: 1, trigger_unit: "days", is_active: true }, // sem meeting -> ignorado
      ];
      const additions = projectLeadsOntoDays(templates, 10, now, sendWindowConfig);
      expect(additions.size).toBe(1);
      expect(additions.get("2026-09-15")).toBe(10);
    });

    it("leadsCount 0 não projeta nada", () => {
      const additions = projectLeadsOntoDays([{ trigger_type: "on_schedule", is_active: true }], 0, new Date(), {});
      expect(additions.size).toBe(0);
    });
  });

  describe("GET /campaigns/:id/upcoming", () => {
    function mockCampaignRow(tenantId = "geracao-digital") {
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes("FROM followup_campaigns fc")) {
          return {
            rows: [{ id: "camp-up-1", company_id: "comp-1", tenant_id: tenantId, evolution_instance: "chip-1" }],
          };
        }
        if (sql.includes("FROM followup_companies WHERE tenant_id")) {
          return { rows: [{ id: "comp-1", evolution_instance: "chip-1" }] };
        }
        if (sql.includes("WHERE fs.campaign_id = $1 AND fj.status = 'pending'")) {
          const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          return {
            rows: [
              { status: "pending", scheduled_for: amanha },
              { status: "pending", scheduled_for: amanha },
              { status: "pending", scheduled_for: amanha },
              { status: "pending", scheduled_for: amanha },
              { status: "pending", scheduled_for: amanha },
            ],
          };
        }
        if (sql.includes("WHERE fs.company_id = ANY")) {
          return { rows: [] };
        }
        return { rows: [] };
      });
    }

    it("fora do escopo do usuário -> 404, nunca 403 (tenant vem da linha, não do payload)", async () => {
      mockCampaignRow("sonhare");
      const handler = getRouteHandler("/campaigns/:id/upcoming", "get");
      const req = { params: { id: "camp-up-1" }, query: {}, authAccess: accessAssignedClients(["geracao-digital"]) };
      const res = fakeRes();
      await handler(req, res);
      expect(res.statusCode).toBe(404);
    });

    it("dentro do escopo: retorna a faixa com cadencePending e chipPending (fallback sem chip -> igual à cadência)", async () => {
      mockCampaignRow("geracao-digital");
      const handler = getRouteHandler("/campaigns/:id/upcoming", "get");
      const req = { params: { id: "camp-up-1" }, query: { days: "7" }, authAccess: accessAssignedClients(["geracao-digital"]) };
      const res = fakeRes();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          campaignId: "camp-up-1",
          days: expect.any(Array),
        })
      );
      const body = res.json.mock.calls[0][0];
      const amanhaKey = dayKeyInTimezone(new Date(Date.now() + 24 * 60 * 60 * 1000), "America/Sao_Paulo");
      const amanhaEntry = body.days.find((d) => d.date === amanhaKey);
      expect(amanhaEntry.cadencePending).toBe(5);
    });

    it("projeção soma ao existente: aplicar 10 leads numa cadência com 5 pendentes num dia -> 15", async () => {
      // 5 jobs pendentes já existentes HOJE (mesmo dia em que o passo on_schedule,
      // sem scheduled_time, projetaria os 10 leads novos — delay 0 a partir de "now").
      const hoje = new Date().toISOString();
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes("FROM followup_campaigns fc")) {
          return {
            rows: [{ id: "camp-up-1", company_id: "comp-1", tenant_id: "geracao-digital", evolution_instance: "chip-1" }],
          };
        }
        if (sql.includes("FROM followup_companies WHERE tenant_id")) {
          return { rows: [{ id: "comp-1", evolution_instance: "chip-1" }] };
        }
        if (sql.includes("WHERE fs.campaign_id = $1 AND fj.status = 'pending'")) {
          return {
            rows: Array.from({ length: 5 }, () => ({ status: "pending", scheduled_for: hoje })),
          };
        }
        if (sql.includes("WHERE fs.company_id = ANY")) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const supabase = mockGetSupabase();
      // Encadeamento real da rota: .from("followup_templates").select("*").eq(...).eq(...)
      // resolve numa Promise no fim da segunda chamada de .eq(...).
      supabase.from.mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  { id: "tpl-proj", trigger_type: "on_schedule", trigger_value: 0, trigger_unit: "days", is_active: true },
                ],
                error: null,
              }),
          }),
        }),
      });

      const handler = getRouteHandler("/campaigns/:id/upcoming", "get");
      const req = {
        params: { id: "camp-up-1" },
        query: { days: "7", projectLeads: "10" },
        authAccess: accessAssignedClients(["geracao-digital"]),
      };
      const res = fakeRes();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.json.mock.calls[0][0];
      const hojeKey = dayKeyInTimezone(new Date(hoje), "America/Sao_Paulo");
      const hojeEntry = body.days.find((d) => d.date === hojeKey);
      expect(hojeEntry, `dia de hoje (${hojeKey}) não apareceu na faixa`).toBeTruthy();
      expect(hojeEntry.projected).toBe(10);
      expect(hojeEntry.cadencePending).toBe(15);
    });
  });

  describe("GET /calendar e /calendar/day — escopo de tenant obrigatório", () => {
    it("TESTE OBRIGATÓRIO: internal com scopeMode assigned_clients e clientIds=[geracao-digital] pedindo calendário de sonhare -> 404", async () => {
      const handler = getRouteHandler("/calendar", "get");
      const req = {
        query: { clientId: "sonhare", month: "2026-09" },
        authAccess: accessAssignedClients(["geracao-digital"]),
      };
      const res = fakeRes();
      await handler(req, res);
      expect(res.statusCode).toBe(404);
    });

    it("mesma guarda vale para /calendar/day", async () => {
      const handler = getRouteHandler("/calendar/day", "get");
      const req = {
        query: { clientId: "sonhare", date: "2026-09-16" },
        authAccess: accessAssignedClients(["geracao-digital"]),
      };
      const res = fakeRes();
      await handler(req, res);
      expect(res.statusCode).toBe(404);
    });

    it("dentro do escopo: /calendar devolve dayCounts pro mês inteiro, com o dia certo populado", async () => {
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes("FROM followup_jobs fj") && sql.includes("fco.tenant_id = $1")) {
          return { rows: [{ status: "pending", scheduled_for: "2026-09-16T12:00:00.000Z" }] };
        }
        return { rows: [] };
      });
      const handler = getRouteHandler("/calendar", "get");
      const req = {
        query: { clientId: "geracao-digital", month: "2026-09" },
        authAccess: accessAssignedClients(["geracao-digital"]),
      };
      const res = fakeRes();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.json.mock.calls[0][0];
      expect(body.dayCounts["2026-09-16"]).toBe(1);
      expect(Object.keys(body.dayCounts)).toHaveLength(30); // setembro tem 30 dias
    });

    it("dentro do escopo: /calendar/day devolve os itens do dia com dados pra abrir a conversa", async () => {
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes("SELECT fj.id AS job_id")) {
          return {
            rows: [
              {
                job_id: "job-cal-1",
                schedule_id: "sched-cal-1",
                campaign_id: "camp-cal-1",
                campaign_name: "Cadência X",
                template_name: "Passo 1",
                lead_name: "Lead Calendário",
                phone: "5534999994000",
                scheduled_for: "2026-09-16T12:00:00.000Z",
                status: "pending",
              },
            ],
          };
        }
        return { rows: [] };
      });
      const handler = getRouteHandler("/calendar/day", "get");
      const req = {
        query: { clientId: "geracao-digital", date: "2026-09-16" },
        authAccess: accessAssignedClients(["geracao-digital"]),
      };
      const res = fakeRes();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.json.mock.calls[0][0];
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ jobId: "job-cal-1", scheduleId: "sched-cal-1", leadName: "Lead Calendário" });
    });
  });
});
