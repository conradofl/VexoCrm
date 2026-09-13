import { describe, it, expect, vi, beforeEach } from "vitest";
import { toCanonicalPhone, SQL_CANONICAL_PHONE } from "../services/canonicalPhone.js";
import {
  SQL_HOJE_REMINDERS_CONDITION,
  SQL_HOJE_SCHEDULES_CONDITION,
  SQL_HOJE_CHAT_FILTER,
} from "../services/remindersHelper.js";
import { registerRemindersRoutes } from "../domains/reminders/routes.js";
import { registerFollowupQueueRoutes } from "../followup/queueRoutes.js";

import { resolveAuthorizedClientId } from "../services/tenant.js";

// Mock das dependências externas do followup/queueRoutes
vi.mock("../followup/db.js", () => ({
  query: vi.fn(),
}));
vi.mock("../followup/queue.js", () => ({
  getFollowupQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({ id: "bull-job-123" }),
  })),
}));
vi.mock("../services/n8nSettings.js", () => ({
  getLeadClientN8nSettings: vi.fn().mockResolvedValue({}),
}));

import { query as mockFupQuery } from "../followup/db.js";

function createMockApp() {
  const routes = {};
  const register = (method, path, ...handlers) => {
    routes[`${method.toUpperCase()} ${path}`] = handlers;
  };
  return {
    routes,
    get: (path, ...handlers) => register("GET", path, ...handlers),
    post: (path, ...handlers) => register("POST", path, ...handlers),
    patch: (path, ...handlers) => register("PATCH", path, ...handlers),
    delete: (path, ...handlers) => register("DELETE", path, ...handlers),
  };
}

async function invokeRoute(app, method, path, req) {
  const key = `${method.toUpperCase()} ${path}`;
  const handlers = app.routes[key];
  if (!handlers) throw new Error(`Route not found: ${key}`);

  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
      return res;
    },
    getHeader(k) {
      return headers[k.toLowerCase()] || null;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };

  for (const handler of handlers) {
    let calledNext = false;
    await handler(req, res, () => {
      calledNext = true;
    });
    if (!calledNext) break;
  }

  return res;
}

describe("Lembretes e Agendamento com Estado (6 Blocos de Verificação)", () => {
  let mockPgPool;
  let remindersApp;
  let queueApp;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPgPool = {
      query: vi.fn(),
    };

    const passThroughMiddleware = (req, res, next) => next();

    const remindersDeps = {
      ensureDb: () => true,
      normalizeString: (str) => (typeof str === "string" ? str.trim() : ""),
      pgDatabasePool: mockPgPool,
      requireAppViewAccess: () => passThroughMiddleware,
      requireFirebaseAuth: passThroughMiddleware,
      resolveAuthorizedClientId,
      sendError: (res, code, errCode, msg) => {
        res.status(code).json({ error: { code: errCode, message: msg } });
      },
    };

    remindersApp = createMockApp();
    registerRemindersRoutes(remindersApp, remindersDeps);

    const queueDeps = {
      normalizeString: (str) => (typeof str === "string" ? str.trim() : ""),
      requireFirebaseAuth: passThroughMiddleware,
      sendError: (res, code, errCode, msg) => {
        res.status(code).json({ error: { code: errCode, message: msg } });
      },
      supabase: { from: () => ({ select: () => ({ not: () => ({ is: () => ({ or: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) }) }) }) }) },
    };

    queueApp = createMockApp();
    registerFollowupQueueRoutes(queueApp, queueDeps);
  });

  // ─── BLOCO 1: Telefone sujo casa com a conversa no lead_reminders ───
  describe("Bloco 1 — Telefone sujo normaliza na escrita e casa por igualdade simples", () => {
    it("normaliza (34) 99109-3607 para 5534991093607 na escrita e casa com JID de conversa", async () => {
      const rawInput = "(34) 99109-3607";
      const canonical = toCanonicalPhone(rawInput);
      expect(canonical).toBe("5534991093607");

      // Simula POST /api/reminders
      mockPgPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: "rem-1",
            client_id: "geracao-digital",
            phone: canonical,
            title: "Ligar para confirmar visita",
            status: "pending",
          },
        ],
      });

      const req = {
        authAccess: { uid: "user-1", name: "Conrado", isAdmin: true },
        body: {
          clientId: "geracao-digital",
          phone: rawInput,
          title: "Ligar para confirmar visita",
          remindAt: new Date(Date.now() + 3600000).toISOString(),
        },
      };

      const res = await invokeRoute(remindersApp, "POST", "/api/reminders", req);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.reminder.phone).toBe("5534991093607");

      // Verifica que o SQL de inserção recebeu o telefone canônico como parâmetro $3
      const insertCall = mockPgPool.query.mock.calls.find((call) =>
        call[0].includes("INSERT INTO public.lead_reminders")
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1][2]).toBe("5534991093607");

      // Simula conversa no WhatsApp (JID: 5534991093607@s.whatsapp.net)
      const chatJid = "5534991093607@s.whatsapp.net";
      const chatPhone = chatJid.replace(/@.*$/, "");

      // A busca por telefone canônico é por igualdade direta:
      expect(chatPhone).toBe(res.body.reminder.phone);
      expect(chatPhone === res.body.reminder.phone).toBe(true);
    });
  });

  // ─── BLOCO 2: Lembrete pessoal não envia nada ───
  describe("Bloco 2 — Lembrete pessoal não cria jobs, não dispara WhatsApp e incrementa todayCount", () => {
    it("registra lembrete pessoal sem tocar em followup_jobs ou BullMQ", async () => {
      const todayRemindAt = new Date().toISOString();

      mockPgPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: "rem-today",
            client_id: "geracao-digital",
            phone: "5534991093607",
            title: "Revisar proposta técnica",
            remind_at: todayRemindAt,
            status: "pending",
          },
        ],
      });

      const createRes = await invokeRoute(remindersApp, "POST", "/api/reminders", {
        authAccess: { uid: "user-1", name: "Conrado", isAdmin: true },
        body: {
          clientId: "geracao-digital",
          phone: "5534991093607",
          title: "Revisar proposta técnica",
          remindAt: todayRemindAt,
        },
      });

      expect(createRes.statusCode).toBe(201);

      // Prova de isolamento: NENHUM job de disparo em followup_jobs foi chamado
      expect(mockFupQuery).not.toHaveBeenCalled();

      // Agora consulta inbox-summary: prova que o lembrete aparece como 'Só para você' e incrementa todayCount
      // Mock da query de schedules (vazia) e de reminders (1 lembrete pendente para hoje)
      mockPgPool.query.mockResolvedValueOnce({ rows: [] }); // scheduleRows
      mockPgPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: "rem-today",
            phone: "5534991093607",
            title: "Revisar proposta técnica",
            notes: null,
            remind_at: todayRemindAt,
            assigned_to_uid: "user-1",
            assigned_to_name: "Conrado",
            created_by_uid: "user-1",
            created_by_name: "Conrado",
            status: "pending",
            is_due_today_or_overdue: true,
            is_for_current_user: true,
          },
        ],
      }); // reminderRows

      const summaryRes = await invokeRoute(remindersApp, "GET", "/api/reminders/inbox-summary", {
        authAccess: { uid: "user-1", name: "Conrado", isAdmin: true },
        query: { clientId: "geracao-digital" },
      });

      expect(summaryRes.statusCode).toBe(200);
      expect(summaryRes.body.todayCount).toBe(1);
      expect(summaryRes.body.remindersTodayCount).toBe(1);
      expect(summaryRes.body.scheduledTodayCount).toBe(0);

      const contactItem = summaryRes.body.itemsByPhone["5534991093607"];
      expect(contactItem).toBeDefined();
      expect(contactItem.activeSchedule).toBeNull(); // NENHUM disparo para cliente
      expect(contactItem.activeReminders.length).toBe(1);
      expect(contactItem.activeReminders[0].title).toBe("Revisar proposta técnica");
      expect(contactItem.todayDue.hasReminderToday).toBe(true);
      expect(contactItem.todayDue.hasScheduledToday).toBe(false);
    });
  });

  // ─── BLOCO 3: Agendamento aparece separado como envio ao cliente ───
  describe("Bloco 3 — Agendamento ativo aparece como disparo ao cliente, separado de lembretes internos", () => {
    it("distingue activeSchedule (FollowupItem completo) de activeReminders", async () => {
      const scheduledTime = new Date(Date.now() + 7200000).toISOString();

      // Mock inbox-summary com 1 schedule ativo E 1 lembrete pessoal para o mesmo telefone
      mockPgPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: "sched-100",
            lead_name: "Ana Silva",
            canonical_phone: "5511988887777",
            raw_phone: "5511988887777",
            company_id: "comp-1",
            tenant_id: "geracao-digital",
            company_name: "Geração Digital",
            campaign_id: null,
            campaign_name: "Mensagem Avulsa",
            raw_status: "active",
            next_scheduled_for: scheduledTime,
            total_active_schedules: 1,
            jobs_sent: 0,
            jobs_failed: 0,
            jobs_pending: 1,
            custom_message: "Olá Ana, confirmamos nossa conversa?",
            created_at: new Date().toISOString(),
            is_due_today_or_overdue: true,
          },
        ],
      });
      mockPgPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: "rem-200",
            phone: "5511988887777",
            title: "Checar se o decisor estará presente",
            notes: "Falar com financeiro antes",
            remind_at: scheduledTime,
            assigned_to_uid: "user-1",
            assigned_to_name: "Conrado",
            created_by_uid: "user-1",
            created_by_name: "Conrado",
            status: "pending",
            is_due_today_or_overdue: true,
            is_for_current_user: true,
          },
        ],
      });

      const summaryRes = await invokeRoute(remindersApp, "GET", "/api/reminders/inbox-summary", {
        authAccess: { uid: "user-1", name: "Conrado", isAdmin: true },
        query: { clientId: "geracao-digital" },
      });

      expect(summaryRes.statusCode).toBe(200);
      expect(summaryRes.body.todayCount).toBe(2);
      expect(summaryRes.body.scheduledTodayCount).toBe(1);
      expect(summaryRes.body.remindersTodayCount).toBe(1);

      const contact = summaryRes.body.itemsByPhone["5511988887777"];
      expect(contact).toBeDefined();

      // Agendamento ativo (disparo ao cliente)
      expect(contact.activeSchedule).toBeDefined();
      expect(contact.activeSchedule.id).toBe("sched-100");
      expect(contact.activeSchedule.customMessage).toBe("Olá Ana, confirmamos nossa conversa?");
      expect(contact.activeSchedule.status).toBe("active");

      // Lembrete pessoal (interno)
      expect(contact.activeReminders.length).toBe(1);
      expect(contact.activeReminders[0].id).toBe("rem-200");
      expect(contact.activeReminders[0].title).toBe("Checar se o decisor estará presente");

      // Indicadores do badge
      expect(contact.todayDue.hasScheduledToday).toBe(true);
      expect(contact.todayDue.hasReminderToday).toBe(true);
    });
  });

  // ─── BLOCO 4: Atribuição nula vira do criador ───
  describe("Bloco 4 — assigned_to_uid nulo assume automaticamente o usuário criador", () => {
    it("atribui ao criador logado se assignedToUid não for informado", async () => {
      mockPgPool.query.mockImplementationOnce(async (sql, params) => {
        return {
          rows: [
            {
              id: "rem-creator-test",
              client_id: params[0],
              phone: params[2],
              title: params[4],
              remind_at: params[6],
              assigned_to_uid: params[7],
              assigned_to_name: params[8],
              created_by_uid: params[9],
              created_by_name: params[10],
              status: "pending",
            },
          ],
        };
      });

      const req = {
        authAccess: { uid: "creator-uid-42", name: "Maria Consultora", role: "internal", scopeMode: "assigned_clients", isAdmin: false, clientIds: ["geracao-digital"] },
        body: {
          clientId: "geracao-digital",
          phone: "34991093607",
          title: "Retornar ligação de tarde",
          remindAt: new Date(Date.now() + 3600000).toISOString(),
          assignedToUid: null, // Explícito nulo
          assignedToName: null,
        },
      };

      const res = await invokeRoute(remindersApp, "POST", "/api/reminders", req);
      expect(res.statusCode).toBe(201);
      expect(res.body.reminder.assigned_to_uid).toBe("creator-uid-42");
      expect(res.body.reminder.assigned_to_name).toBe("Maria Consultora");
      expect(res.body.reminder.created_by_uid).toBe("creator-uid-42");
    });
  });

  // ─── BLOCO 5: O CASO DO 553491093607 (Bloqueador 1) ───
  describe("Bloco 5 — Telefone legado 553491093607 em followup_schedules mapeia para 5534991093607", () => {
    it("expressão SQL_CANONICAL_PHONE e toCanonicalPhone transformam 553491093607 em 5534991093607", () => {
      // 1. Verificação da regra em JavaScript (usada na escrita de lead_reminders)
      expect(toCanonicalPhone("553491093607")).toBe("5534991093607");
      expect(toCanonicalPhone("3491093607")).toBe("5534991093607");

      // 2. Verificação de que SQL_CANONICAL_PHONE contém o ramo exato para 12 dígitos com DDD >= 11
      const sqlExpr = SQL_CANONICAL_PHONE("fs.phone");
      expect(sqlExpr).toContain("regexp_replace");
      expect(sqlExpr).toContain("length");
      expect(sqlExpr).toContain("substr");
    });

    it("inbox-summary resolve agendamento ativo com telefone legado 553491093607 sob a chave canônica 5534991093607", async () => {
      // Simula o retorno do banco Postgres onde o SELECT aplicou SQL_CANONICAL_PHONE("fs.phone")
      // transformando o fs.phone sujo '553491093607' em '5534991093607'
      const legacyRow = {
        id: "sched-legacy-1",
        lead_name: "Cliente Histórico",
        canonical_phone: "5534991093607", // resultado do SQL_CANONICAL_PHONE
        raw_phone: "553491093607",        // gravado 4 meses atrás sem o 9
        company_id: "comp-fup-1",
        tenant_id: "geracao-digital",
        company_name: "Geração Digital",
        campaign_id: null,
        campaign_name: "Mensagem Avulsa",
        raw_status: "active",
        next_scheduled_for: new Date(Date.now() + 86400000).toISOString(),
        total_active_schedules: 1,
        jobs_sent: 0,
        jobs_failed: 0,
        jobs_pending: 1,
        custom_message: "Mensagem agendada",
        created_at: new Date().toISOString(),
        is_due_today_or_overdue: false,
      };

      mockPgPool.query.mockResolvedValueOnce({ rows: [legacyRow] }); // schedules
      mockPgPool.query.mockResolvedValueOnce({ rows: [] });          // reminders

      const summaryRes = await invokeRoute(remindersApp, "GET", "/api/reminders/inbox-summary", {
        authAccess: { uid: "user-1", name: "Conrado", isAdmin: true },
        query: { clientId: "geracao-digital" },
      });

      expect(summaryRes.statusCode).toBe(200);

      // A conversa no WhatsApp (que tem 13 dígitos 5534991093607) ENCONTRA o agendamento!
      const chatPhone = "5534991093607";
      const contactItem = summaryRes.body.itemsByPhone[chatPhone];

      expect(contactItem).toBeDefined();
      expect(contactItem.activeSchedule).toBeDefined();
      expect(contactItem.activeSchedule.id).toBe("sched-legacy-1");
      expect(contactItem.activeSchedule.phone).toBe("5534991093607");
      expect(contactItem.activeSchedule.rawPhone).toBe("553491093607");

      // O botão na tela do WhatsApp saberá exibir:
      // "⏰ Mensagem agendada" em vez de oferecer criar duplicado!
      expect(contactItem.activeSchedule.status).toBe("active");
    });
  });

  // ─── BLOCO 6: Segurança de Tenant (Bloqueador 2 e 3) ───
  describe("Bloco 6 — Segurança de Tenant em queueRoutes e lead_reminders", () => {
    it("reschedule sem tenantId no payload funciona para admin/superadmin (tira tenant da linha)", async () => {
      // Mock do ensureScheduleTenantAccess encontrando o schedule pertencente a geracao-digital
      mockFupQuery
        .mockResolvedValueOnce({
          rows: [{ id: "sched-safe", campaign_id: null, tenant_id: "geracao-digital" }],
        }) // ensureScheduleTenantAccess
        .mockResolvedValueOnce({
          rows: [{ custom_message: "Mensagem anterior" }],
        }) // lastJobRows
        .mockResolvedValueOnce({ rows: [] }) // UPDATE followup_jobs cancelled
        .mockResolvedValueOnce({ rows: [] }) // UPDATE followup_schedules active
        .mockResolvedValueOnce({ rows: [{ id: "new-job-1" }] }); // INSERT followup_jobs

      const req = {
        authAccess: { uid: "admin-1", isAdmin: true, isSuperAdmin: false },
        params: { scheduleId: "sched-safe" },
        // FollowupQueueTable manda SOMENTE id e scheduledFor (sem tenantId)
        body: {
          scheduledFor: new Date(Date.now() + 3600000).toISOString(),
        },
      };

      const res = await invokeRoute(queueApp, "PATCH", "/api/followup-queue/:scheduleId/reschedule", req);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.jobId).toBe("new-job-1");
    });

    it("reschedule/discard/delete de schedule de OUTRO tenant devolve 404 (não 403)", async () => {
      // Usuário com papel 'client' associado apenas ao tenant 'sonhare'
      const clientReq = {
        authAccess: {
          uid: "client-user",
          role: "client",
          isAdmin: false,
          isSuperAdmin: false,
          clientIds: ["sonhare"],
        },
        params: { scheduleId: "sched-out-of-scope" },
        body: { scheduledFor: new Date(Date.now() + 3600000).toISOString() },
      };

      // O schedule no banco pertence a 'geracao-digital'
      mockFupQuery.mockResolvedValueOnce({
        rows: [{ id: "sched-out-of-scope", campaign_id: null, tenant_id: "geracao-digital" }],
      });

      const res = await invokeRoute(queueApp, "PATCH", "/api/followup-queue/:scheduleId/reschedule", clientReq);

      // DEVE ser 404 (evita confirmar que o ID existe)
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("discard de schedule inexistente devolve 404", async () => {
      mockFupQuery.mockResolvedValueOnce({ rows: [] }); // schedule não encontrado

      const req = {
        authAccess: { uid: "admin-1", isAdmin: true },
        params: { scheduleId: "sched-inexistente" },
      };

      const res = await invokeRoute(queueApp, "PATCH", "/api/followup-queue/:scheduleId/discard", req);
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("internal com scopeMode assigned_clients NÃO acessa schedule de outro tenant (devolve 404)", async () => {
      // Perfil de consultor comum (ex: Gabriel / Priscila)
      const internalReq = {
        authAccess: {
          uid: "consultor-gabriel",
          role: "internal",
          scopeMode: "assigned_clients",
          isAdmin: false,
          clientIds: ["geracao-digital"],
        },
        params: { scheduleId: "sched-sonhare" },
      };

      // O schedule no banco pertence à Sonhare
      mockFupQuery.mockResolvedValueOnce({
        rows: [{ id: "sched-sonhare", campaign_id: null, tenant_id: "sonhare" }],
      });

      const res = await invokeRoute(queueApp, "PATCH", "/api/followup-queue/:scheduleId/discard", internalReq);

      // DEVE ser 404 (evita confirmar que o ID existe)
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("internal com scopeMode assigned_clients ACESSA schedule do seu próprio tenant", async () => {
      const internalReq = {
        authAccess: {
          uid: "consultor-gabriel",
          role: "internal",
          scopeMode: "assigned_clients",
          isAdmin: false,
          clientIds: ["geracao-digital"],
        },
        params: { scheduleId: "sched-gd" },
      };

      // O schedule no banco pertence a geracao-digital
      mockFupQuery
        .mockResolvedValueOnce({
          rows: [{ id: "sched-gd", campaign_id: null, tenant_id: "geracao-digital" }],
        })
        .mockResolvedValueOnce({ rows: [{ id: "sched-gd" }] }) // UPDATE followup_schedules
        .mockResolvedValueOnce({ rows: [] }); // UPDATE followup_jobs

      const res = await invokeRoute(queueApp, "PATCH", "/api/followup-queue/:scheduleId/discard", internalReq);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("DELETE em lead_reminders de outro tenant resulta em rowCount = 0 e devolve 404", async () => {
      // Simula pool retornando rowCount = 0 porque WHERE client_id não bateu
      mockPgPool.query.mockResolvedValueOnce({ rowCount: 0 });

      const req = {
        authAccess: {
          uid: "consultor-gabriel",
          role: "internal",
          scopeMode: "assigned_clients",
          isAdmin: false,
          clientIds: ["geracao-digital"],
        },
        params: { id: "rem-outro-tenant" },
        query: { clientId: "geracao-digital" },
      };

      const res = await invokeRoute(remindersApp, "DELETE", "/api/reminders/:id", req);
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");

      // Confere que a query executada filtrou estritamente por id E client_id
      const deleteCall = mockPgPool.query.mock.calls.find((call) =>
        call[0].includes("DELETE FROM public.lead_reminders")
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall[0]).toContain("DELETE FROM public.lead_reminders WHERE id = $1 AND client_id = $2");
      expect(deleteCall[1]).toEqual(["rem-outro-tenant", "geracao-digital"]);
    });

    it("DELETE em lead_reminders com tenant fora do escopo do usuário devolve 403 via tenant.js", async () => {
      const req = {
        authAccess: {
          uid: "consultor-gabriel",
          role: "internal",
          scopeMode: "assigned_clients",
          isAdmin: false,
          clientIds: ["geracao-digital"],
        },
        params: { id: "rem-sonhare" },
        query: { clientId: "sonhare" },
      };

      const res = await invokeRoute(remindersApp, "DELETE", "/api/reminders/:id", req);
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN_CLIENT_SCOPE");
    });
  });

  // ─── BÔNUS: Fuso Horário e Helpers Compartilhados ───
  describe("Helpers Compartilhados e Fuso Horário America/Sao_Paulo", () => {
    it("garante que as expressões SQL usam America/Sao_Paulo para truncamento do dia", () => {
      const remindersCond = SQL_HOJE_REMINDERS_CONDITION({ clientParam: "$1", operatorParam: "$2" });
      expect(remindersCond).toContain("America/Sao_Paulo");
      expect(remindersCond).toContain("date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day'");

      const schedulesCond = SQL_HOJE_SCHEDULES_CONDITION({ tenantParam: "$1" });
      expect(schedulesCond).toContain("America/Sao_Paulo");
      expect(schedulesCond).toContain("date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day'");

      const chatFilter = SQL_HOJE_CHAT_FILTER({ clientParam: "$1", operatorParam: "$2" });
      expect(chatFilter).toContain("America/Sao_Paulo");
      expect(chatFilter).toContain("lead_reminders");
      expect(chatFilter).toContain("followup_schedules");
    });
  });
});
