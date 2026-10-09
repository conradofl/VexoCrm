// backend/src/test/funnelExitGuard.test.js
//
// Suíte de Testes Automatizados — Marco 3: Motor de Automações & Transições de Funil pela IA
// Cobrindo:
// 1. Transição automática no inbound para 'buyer' ao receber mensagem de pagamento/fechamento
// 2. Cancelamento automático de cadências de follow-up quando o lead vira 'buyer'
// 3. Respeito rigoroso à trava de inviolabilidade manual (stage_source = 'manual')
// 4. Alertas proativos e notificações ao time de SDR (lead_closed e human_requested)

import { describe, expect, it, vi } from "vitest";
import { reclassifyLeadFromMessages } from "../services/funnelService.js";
import { isWonStage } from "../services/followupExitGuard.js";
import * as leadUpsertModule from "../services/leadUpsert.js";

describe("Marco 3 — Automações de Funil e Saída de Follow-up pela IA", () => {
  describe("1. isWonStage atualizado", () => {
    it("reconhece 'buyer' como estágio ganho canônico além de won, ganho, fechado e cliente", () => {
      expect(isWonStage("buyer")).toBe(true);
      expect(isWonStage("BUYER")).toBe(true);
      expect(isWonStage("won")).toBe(true);
      expect(isWonStage("ganho")).toBe(true);
      expect(isWonStage("fechado")).toBe(true);
      expect(isWonStage("cliente")).toBe(true);

      expect(isWonStage("cold")).toBe(false);
      expect(isWonStage("inquiry")).toBe(false);
      expect(isWonStage("open_budget")).toBe(false);
      expect(isWonStage("lost")).toBe(false);
    });
  });

  describe("2. Transição automática para buyer e cancelamento de follow-ups", () => {
    it("transita para buyer e cancela follow-ups quando lead envia comprovante de pagamento", async () => {
      const mockLead = {
        id: "lead-auto-buyer",
        phone: "5511988887777",
        telefone: "5511988887777",
        stage: "open_budget",
        stage_source: "auto",
        lost_reason: null,
        temperature: "warm",
      };

      const executedQueries = [];
      const mockPool = {
        query: vi.fn(async (sql, params) => {
          executedQueries.push({ sql, params });
          if (sql.includes("SELECT id, phone, telefone")) {
            return { rows: [mockLead] };
          }
          if (sql.includes("SELECT fs.id AS schedule_id")) {
            return { rows: [{ schedule_id: "sched-123" }] };
          }
          if (sql.includes("UPDATE followup_schedules") || sql.includes("UPDATE followup_jobs")) {
            return { rowCount: 1 };
          }
          if (sql.includes("INSERT INTO public.notifications")) {
            return { rowCount: 1 };
          }
          return { rows: [] };
        }),
      };

      const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone").mockResolvedValue({
        id: "lead-auto-buyer",
        stage: "buyer",
        stage_source: "auto",
      });

      const result = await reclassifyLeadFromMessages({
        pool: mockPool,
        clientId: "tenant-alpha",
        leadId: "lead-auto-buyer",
        messages: ["Olá! Fiz o pix agora mesmo, segue o comprovante do pagamento."],
      });

      expect(result.updated).toBe(true);
      expect(result.previousStage).toBe("open_budget");
      expect(result.newStage).toBe("buyer");
      expect(result.stageSource).toBe("auto");

      // Garante que o lead foi atualizado como buyer no banco
      expect(upsertSpy).toHaveBeenCalledWith(
        mockPool,
        "tenant-alpha",
        "5511988887777",
        expect.objectContaining({
          stage: "buyer",
          stage_source: "auto",
          temperature: "hot",
        })
      );

      // Garante que a notificação 'lead_closed' foi inserida
      const closedNotif = executedQueries.find(
        (q) => q.sql.includes("INSERT INTO public.notifications") && q.params?.includes("lead_closed")
      );
      expect(closedNotif).toBeDefined();
      expect(closedNotif.params).toContain("🎉 Intenção de Fechamento Detectada");
      expect(closedNotif.params).toContain("/crm/whatsapp?phone=5511988887777");

      // Garante que o cancelamento de follow-ups foi disparado
      const scheduleCancel = executedQueries.find((q) => q.sql.includes("UPDATE followup_schedules"));
      expect(scheduleCancel).toBeDefined();

      const jobCancel = executedQueries.find((q) => q.sql.includes("UPDATE followup_jobs"));
      expect(jobCancel).toBeDefined();

      upsertSpy.mockRestore();
    });
  });

  describe("3. Respeito à trava de inviolabilidade manual", () => {
    it("não altera estágio se stage_source = 'manual', mas ainda notifica se lead pedir humano", async () => {
      const mockLead = {
        id: "lead-locked-manual",
        phone: "5511977776666",
        telefone: "5511977776666",
        stage: "inquiry",
        stage_source: "manual",
        lost_reason: null,
        temperature: "warm",
      };

      const executedQueries = [];
      const mockPool = {
        query: vi.fn(async (sql, params) => {
          executedQueries.push({ sql, params });
          if (sql.includes("SELECT id, phone, telefone")) {
            return { rows: [mockLead] };
          }
          if (sql.includes("INSERT INTO public.notifications")) {
            return { rowCount: 1 };
          }
          return { rows: [] };
        }),
      };

      const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone");

      const result = await reclassifyLeadFromMessages({
        pool: mockPool,
        clientId: "tenant-alpha",
        leadId: "lead-locked-manual",
        messages: ["Prefiro falar com atendente humano, pode me ligar?"],
      });

      expect(result.updated).toBe(false);
      expect(result.reason).toBe("manual_protection");
      expect(result.stageSource).toBe("manual");
      expect(result.currentStage).toBe("inquiry");
      expect(result.humanRequested).toBe(true);

      // Não sobrescreve lead com stage_source manual
      expect(upsertSpy).not.toHaveBeenCalled();

      // Notificação human_requested foi emitida
      const humanNotif = executedQueries.find(
        (q) => q.sql.includes("INSERT INTO public.notifications") && q.params?.includes("human_requested")
      );
      expect(humanNotif).toBeDefined();
      expect(humanNotif.params).toContain("🙋‍♂️ Lead Pediu Atendente Humano");
      expect(humanNotif.params).toContain("/crm/whatsapp?phone=5511977776666");

      upsertSpy.mockRestore();
    });
  });

  describe("4. Alerta de solicitação de atendente humano", () => {
    it("emite notificação human_requested quando lead solicita suporte humano", async () => {
      const mockLead = {
        id: "lead-human-req",
        phone: "5511955554444",
        telefone: "5511955554444",
        stage: "cold",
        stage_source: "auto",
        lost_reason: null,
        temperature: "cold",
      };

      const executedQueries = [];
      const mockPool = {
        query: vi.fn(async (sql, params) => {
          executedQueries.push({ sql, params });
          if (sql.includes("SELECT id, phone, telefone")) {
            return { rows: [mockLead] };
          }
          if (sql.includes("INSERT INTO public.notifications")) {
            return { rowCount: 1 };
          }
          return { rows: [] };
        }),
      };

      const result = await reclassifyLeadFromMessages({
        pool: mockPool,
        clientId: "tenant-alpha",
        leadId: "lead-human-req",
        messages: ["Preciso de um humano para tirar uma dúvida, tem alguém aí?"],
      });

      expect(result.humanRequested).toBe(true);
      const humanNotif = executedQueries.find(
        (q) => q.sql.includes("INSERT INTO public.notifications") && q.params?.includes("human_requested")
      );
      expect(humanNotif).toBeDefined();
      expect(humanNotif.params).toContain("🙋‍♂️ Lead Pediu Atendente Humano");
    });
  });
});
