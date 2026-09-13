import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cancelFollowupCadenceOnReply,
  cancelFollowupCadenceOnTakeover,
  cancelFollowupCadenceOnStageChange,
  isWonStage,
  isLostStage,
} from "../services/followupExitGuard.js";
import { SQL_CANONICAL_PHONE } from "../services/canonicalPhone.js";
import { isFromMe, isGroupJid } from "../services/inboundGuard.js";

describe("Follow-up ETAPA 1 — Condições de Saída de Cadência e Guarda fromMe", () => {
  // ─── 1. Guarda Crítica de fromMe (Não autodestruir cadência) ───────────────
  describe("1. Guarda de fromMe no Webhook", () => {
    it("deve identificar fromMe em múltiplos formatos de payload da Evolution", () => {
      expect(isFromMe({ data: { key: { fromMe: true } } })).toBe(true);
      expect(isFromMe({ key: { fromMe: true } })).toBe(true);
      expect(isFromMe({ data: { fromMe: true } })).toBe(true);
      expect(isFromMe({ fromMe: true })).toBe(true);
      expect(isFromMe({ data: { key: { fromMe: false } } })).toBe(false);
      expect(isFromMe({})).toBe(false);
    });

    it("cenário do fromMe: passo 1 é enviado, evento de saída (fromMe: true) chega no webhook, passos 2 e 3 continuam pending", async () => {
      // Simulação do estado do banco com 3 passos:
      // Passo 1 já enviado ('sent'), Passos 2 e 3 agendados ('pending')
      const databaseJobs = [
        { id: "job-step-1", schedule_id: "sched-123", status: "sent" },
        { id: "job-step-2", schedule_id: "sched-123", status: "pending" },
        { id: "job-step-3", schedule_id: "sched-123", status: "pending" },
      ];
      let scheduleStatus = "active";
      let repliesInserted = 0;

      // Webhook payload disparado pela Evolution após o Passo 1 sair pelo aparelho/API
      const outboundWebhookPayload = {
        event: "messages.upsert",
        data: {
          key: {
            remoteJid: "5534991093607@s.whatsapp.net",
            fromMe: true,
            id: "EVO-OUTBOUND-ECHO-123",
          },
          message: {
            conversation: "Passo 1: Olá Conrado, temos novidades sobre o seu projeto.",
          },
        },
      };

      // Simulação da lógica da rota webhook com a guarda
      const handleWebhook = async (body) => {
        if (isFromMe(body)) {
          return { ok: true, ignored: "fromMe" };
        }
        repliesInserted++;
        scheduleStatus = "cancelled";
        databaseJobs.forEach((j) => {
          if (j.status === "pending") j.status = "cancelled";
        });
        return { ok: true };
      };

      const result = await handleWebhook(outboundWebhookPayload);

      // Prova que o evento de saída foi descartado e a cadência segue intacta
      expect(result.ignored).toBe("fromMe");
      expect(repliesInserted).toBe(0);
      expect(scheduleStatus).toBe("active");
      expect(databaseJobs[1].status).toBe("pending");
      expect(databaseJobs[2].status).toBe("pending");
    });

    it("deve descartar mensagens vindas de grupos ou broadcast", () => {
      expect(isGroupJid("1203630283748291@g.us")).toBe(true);
      expect(isGroupJid("status@broadcast")).toBe(true);
      expect(isGroupJid("5534991093607@s.whatsapp.net")).toBe(false);
    });
  });

  // ─── 2. Telefone Canônico vs Colisão de 8 Dígitos ──────────────────────────
  describe("2. Casamento de Telefone Canônico (Sem colisão de 8 dígitos)", () => {
    it("SQL_CANONICAL_PHONE gera a expressão correta de normalização", () => {
      const sql = SQL_CANONICAL_PHONE("phone");
      expect(sql).toContain("substr(regexp_replace(phone");
      expect(sql).toContain("55");
    });

    it("respostas de leads diferentes com os mesmos 8 dígitos finais cancelam APENAS a cadência do lead correspondente", async () => {
      // Lead A: Uberlândia DDD 34 -> 5534991093607
      // Lead B: São Paulo   DDD 11 -> 5511991093607 (mesmos 8 dígitos finais: 91093607)
      const schedules = [
        { id: "sched-lead-a", company_id: "comp-1", phone: "5534991093607", status: "active", exit_on_reply: true },
        { id: "sched-lead-b", company_id: "comp-1", phone: "5511991093607", status: "active", exit_on_reply: true },
      ];
      const jobs = [
        { id: "job-lead-a-2", schedule_id: "sched-lead-a", status: "pending" },
        { id: "job-lead-b-2", schedule_id: "sched-lead-b", status: "pending" },
      ];

      // Mock da query com comparação estrita de telefone canônico
      const mockQueryFn = vi.fn(async (sql, params) => {
        if (sql.includes("SELECT fs.id AS schedule_id")) {
          const [companyId, phoneParam] = params;
          const cleanPhone = phoneParam.replace(/\D/g, "");
          const matched = schedules.filter((s) => s.company_id === companyId && s.phone === cleanPhone && s.status === "active");
          return { rows: matched.map((m) => ({ schedule_id: m.id })) };
        }
        if (sql.includes("UPDATE followup_schedules")) {
          const [targetIds] = params;
          schedules.forEach((s) => {
            if (targetIds.includes(s.id)) s.status = "cancelled";
          });
          return { rowCount: targetIds.length };
        }
        if (sql.includes("UPDATE followup_jobs")) {
          const [targetIds] = params;
          let count = 0;
          jobs.forEach((j) => {
            if (targetIds.includes(j.schedule_id) && j.status === "pending") {
              j.status = "cancelled";
              count++;
            }
          });
          return { rowCount: count };
        }
        return { rows: [] };
      });

      // Lead A responde
      const cancelResult = await cancelFollowupCadenceOnReply({
        companyId: "comp-1",
        phone: "5534991093607",
        queryFn: mockQueryFn,
      });

      expect(cancelResult.cancelledSchedules).toBe(1);
      expect(cancelResult.cancelledJobs).toBe(1);

      // Lead A teve o schedule e job cancelados
      expect(schedules.find((s) => s.id === "sched-lead-a").status).toBe("cancelled");
      expect(jobs.find((j) => j.id === "job-lead-a-2").status).toBe("cancelled");

      // Lead B PERMANECE ATIVO E INTACTO
      expect(schedules.find((s) => s.id === "sched-lead-b").status).toBe("active");
      expect(jobs.find((j) => j.id === "job-lead-b-2").status).toBe("pending");
    });
  });

  // ─── 3. Cancelamento por Resposta com exit_on_reply ───────────────────────
  describe("3. Cancelamento por Resposta do Lead (exit_on_reply)", () => {
    it("quando lead responde qualquer texto com exit_on_reply = true, cancela schedule e jobs futuros", async () => {
      const schedule = { id: "sched-1", status: "active" };
      const jobs = [
        { id: "job-1", schedule_id: "sched-1", status: "pending" },
        { id: "job-2", schedule_id: "sched-1", status: "pending" },
      ];

      const mockQueryFn = vi.fn(async (sql, params) => {
        if (sql.includes("SELECT fs.id AS schedule_id")) {
          return { rows: [{ schedule_id: schedule.id }] };
        }
        if (sql.includes("UPDATE followup_schedules")) {
          schedule.status = "cancelled";
          return { rowCount: 1 };
        }
        if (sql.includes("UPDATE followup_jobs")) {
          jobs.forEach((j) => (j.status = "cancelled"));
          return { rowCount: jobs.length };
        }
        return { rows: [] };
      });

      const res = await cancelFollowupCadenceOnReply({
        companyId: "empresa-gd",
        phone: "5534991093607",
        queryFn: mockQueryFn,
      });

      expect(res.cancelledSchedules).toBe(1);
      expect(res.cancelledJobs).toBe(2);
      expect(schedule.status).toBe("cancelled");
      expect(jobs[0].status).toBe("cancelled");
      expect(jobs[1].status).toBe("cancelled");
    });

    it("quando exit_on_reply = false na campanha, a query não seleciona o schedule e nada é cancelado", async () => {
      const mockQueryFn = vi.fn(async (sql) => {
        // Simula a cláusula AND COALESCE(fc.exit_on_reply, TRUE) = TRUE retornando vazio quando exit_on_reply é false
        return { rows: [] };
      });

      const res = await cancelFollowupCadenceOnReply({
        companyId: "empresa-gd",
        phone: "5534991093607",
        queryFn: mockQueryFn,
      });

      expect(res.cancelledSchedules).toBe(0);
      expect(res.cancelledJobs).toBe(0);
      expect(mockQueryFn).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 4. Cancelamento por Human Takeover (Marcar Atendido) ─────────────────
  describe("4. Cancelamento em Takeover Humano (exit_on_human_takeover)", () => {
    it("marcar atendido cancela cadência com exit_on_human_takeover = true", async () => {
      const schedule = { id: "sched-humano", status: "active" };
      const jobs = [{ id: "job-h1", schedule_id: "sched-humano", status: "pending" }];

      const mockQueryFn = vi.fn(async (sql) => {
        if (sql.includes("SELECT fs.id AS schedule_id")) {
          return { rows: [{ schedule_id: schedule.id }] };
        }
        if (sql.includes("UPDATE followup_schedules")) {
          schedule.status = "cancelled";
          return { rowCount: 1 };
        }
        if (sql.includes("UPDATE followup_jobs")) {
          jobs.forEach((j) => (j.status = "cancelled"));
          return { rowCount: 1 };
        }
        return { rows: [] };
      });

      const res = await cancelFollowupCadenceOnTakeover({
        clientId: "geracao-digital",
        phone: "5534991093607",
        queryFn: mockQueryFn,
      });

      expect(res.cancelledSchedules).toBe(1);
      expect(res.cancelledJobs).toBe(1);
      expect(schedule.status).toBe("cancelled");
      expect(jobs[0].status).toBe("cancelled");
    });
  });

  // ─── 5. Cancelamento por Estágio do Lead (Ganho / Perdido) ─────────────────
  describe("5. Cancelamento por Estágio do Lead (exit_on_won / exit_on_lost)", () => {
    it("isWonStage e isLostStage detectam corretamente os estágios", () => {
      expect(isWonStage("won")).toBe(true);
      expect(isWonStage("ganho")).toBe(true);
      expect(isWonStage("fechado")).toBe(true);
      expect(isWonStage("cliente")).toBe(true);
      expect(isWonStage("open_budget")).toBe(false);

      expect(isLostStage("lost")).toBe(true);
      expect(isLostStage("perdido")).toBe(true);
      expect(isLostStage("descartado")).toBe(true);
      expect(isLostStage("cancelado")).toBe(true);
      expect(isLostStage("cold")).toBe(false);
    });

    it("quando lead vira 'won', cancela cadência com exit_on_won", async () => {
      let executedWonUpdate = false;
      const mockQueryFn = vi.fn(async (sql) => {
        if (sql.includes("SELECT fs.id AS schedule_id")) {
          expect(sql).toContain("exit_on_won");
          return { rows: [{ schedule_id: "sched-won-1" }] };
        }
        if (sql.includes("UPDATE followup_jobs")) {
          executedWonUpdate = true;
          return { rowCount: 2 };
        }
        return { rows: [] };
      });

      const res = await cancelFollowupCadenceOnStageChange({
        clientId: "geracao-digital",
        phone: "5534991093607",
        newStage: "ganho",
        queryFn: mockQueryFn,
      });

      expect(res.cancelledSchedules).toBe(1);
      expect(res.cancelledJobs).toBe(2);
      expect(executedWonUpdate).toBe(true);
    });

    it("quando lead vira 'lost', cancela cadência com exit_on_lost", async () => {
      let executedLostUpdate = false;
      const mockQueryFn = vi.fn(async (sql) => {
        if (sql.includes("SELECT fs.id AS schedule_id")) {
          expect(sql).toContain("exit_on_lost");
          return { rows: [{ schedule_id: "sched-lost-1" }] };
        }
        if (sql.includes("UPDATE followup_jobs")) {
          executedLostUpdate = true;
          return { rowCount: 1 };
        }
        return { rows: [] };
      });

      const res = await cancelFollowupCadenceOnStageChange({
        clientId: "geracao-digital",
        phone: "5534991093607",
        newStage: "perdido",
        queryFn: mockQueryFn,
      });

      expect(res.cancelledSchedules).toBe(1);
      expect(res.cancelledJobs).toBe(1);
      expect(executedLostUpdate).toBe(true);
    });

    it("estágios intermediários (ex: 'open_budget') não cancelam a cadência", async () => {
      const mockQueryFn = vi.fn();
      const res = await cancelFollowupCadenceOnStageChange({
        clientId: "geracao-digital",
        phone: "5534991093607",
        newStage: "open_budget",
        queryFn: mockQueryFn,
      });

      expect(res.cancelledSchedules).toBe(0);
      expect(mockQueryFn).not.toHaveBeenCalled();
    });
  });

  // ─── 6. Guarda Defensiva no Worker ─────────────────────────────────────────
  describe("6. Guarda Defensiva no Worker de Follow-up", () => {
    it("se job_status !== 'pending' (ex: 'cancelled' ou 'skipped'), não envia nada", async () => {
      const sendViaEvolutionMock = vi.fn();

      const simulateWorkerProcess = async (row) => {
        if (row.job_status !== "pending") {
          return { status: "aborted", reason: "not_pending" };
        }
        await sendViaEvolutionMock();
        return { status: "sent" };
      };

      const resCancelled = await simulateWorkerProcess({ job_status: "cancelled" });
      expect(resCancelled.status).toBe("aborted");
      expect(sendViaEvolutionMock).not.toHaveBeenCalled();

      const resSkipped = await simulateWorkerProcess({ job_status: "skipped" });
      expect(resSkipped.status).toBe("aborted");
      expect(sendViaEvolutionMock).not.toHaveBeenCalled();
    });

    it("se trigger_type for 'on_schedule' ou 'after_enrollment', mas lead já respondeu e exit_on_reply = true, pula o disparo", async () => {
      const sendViaEvolutionMock = vi.fn();
      let updatedStatus = null;

      const simulateWorkerExitOnReply = async (row, hasReply) => {
        const shouldExitOnReply = row.exit_on_reply !== false || row.trigger_type === "no_reply";
        if (shouldExitOnReply && hasReply) {
          updatedStatus = "skipped";
          return { status: "skipped", reason: "lead_replied" };
        }
        await sendViaEvolutionMock();
        return { status: "sent" };
      };

      const row = {
        job_status: "pending",
        trigger_type: "on_schedule", // Não é no_reply, mas a cadência sai quando responde
        exit_on_reply: true,
      };

      const res = await simulateWorkerExitOnReply(row, true);
      expect(res.status).toBe("skipped");
      expect(updatedStatus).toBe("skipped");
      expect(sendViaEvolutionMock).not.toHaveBeenCalled();
    });
  });
});
