// backend/src/test/campaignDispatchSummary.test.js
//
// "Uma linha por campanha, lote vira quadrado" — regra de status agregado
// (por precedência) e estimativa de término. Pura, sem banco.

import { describe, expect, it } from "vitest";
import {
  aggregateDispatchStatus,
  isCampaignActive,
  estimateDispatchCompletion,
} from "../services/campaignDispatchSummary.js";

describe("aggregateDispatchStatus — status agregado por precedência", () => {
  it("[TESTE OBRIGATÓRIO] um lote 'running' entre 32 pendentes → Enviando", () => {
    const statuses = ["running", ...Array(32).fill("scheduled")];
    expect(aggregateDispatchStatus(statuses)).toBe("enviando");
  });

  it("[TESTE OBRIGATÓRIO] todos 'done' → Concluída", () => {
    expect(aggregateDispatchStatus(Array(33).fill("done"))).toBe("concluida");
  });

  it("algum cancelled e nenhum pendente → Cancelada", () => {
    expect(aggregateDispatchStatus(["done", "done", "cancelled"])).toBe("cancelada");
    expect(aggregateDispatchStatus(["cancelled", "cancelled"])).toBe("cancelada");
  });

  it("cancelled COM pendente ainda não é Cancelada — vira Agendada (ainda há trabalho)", () => {
    expect(aggregateDispatchStatus(["cancelled", "scheduled"])).toBe("agendada");
  });

  it("draft/scheduled/failed/interrupted sem running → Agendada", () => {
    expect(aggregateDispatchStatus(["draft"])).toBe("agendada");
    expect(aggregateDispatchStatus(["done", "scheduled"])).toBe("agendada");
    expect(aggregateDispatchStatus(["done", "failed"])).toBe("agendada");
    expect(aggregateDispatchStatus(["paused", "interrupted"])).toBe("agendada");
  });

  it("só paused (sem draft/scheduled/failed/interrupted) → Pausada", () => {
    expect(aggregateDispatchStatus(["paused"])).toBe("pausada");
    expect(aggregateDispatchStatus(["done", "paused"])).toBe("pausada");
  });

  it("running sempre vence, mesmo com cancelled e paused no meio", () => {
    expect(aggregateDispatchStatus(["done", "cancelled", "paused", "running"])).toBe("enviando");
  });

  it("lista vazia: nenhum status agregado (campanha sem lote não deveria aparecer)", () => {
    expect(aggregateDispatchStatus([])).toBeNull();
    expect(aggregateDispatchStatus(undefined)).toBeNull();
  });
});

describe("isCampaignActive — Ativas vs Encerradas", () => {
  it("[TESTE OBRIGATÓRIO] campanha com lote pendente é Ativa", () => {
    expect(isCampaignActive(["done", "scheduled"])).toBe(true);
  });

  it("[TESTE OBRIGATÓRIO] campanha com todos os lotes done não é Ativa (Encerrada)", () => {
    expect(isCampaignActive(["done", "done", "done"])).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] campanha pausada com lote pendente é Ativa — parada por decisão, não terminada", () => {
    expect(isCampaignActive(["paused", "paused"])).toBe(true);
    expect(isCampaignActive(["done", "paused"])).toBe(true);
  });

  it("cancelled sem nenhum pendente conta como Encerrada", () => {
    expect(isCampaignActive(["cancelled", "done"])).toBe(false);
  });
});

describe("estimateDispatchCompletion — previsão aproximada, nunca minuto exato", () => {
  const seg9h = new Date("2026-09-14T09:00:00-03:00"); // segunda-feira

  it("cota de hoje já dá conta do que falta → 'hoje'", () => {
    const eta = estimateDispatchCompletion({
      pendingLeads: 30,
      dailyLimit: 500,
      sentToday: 100,
      windowDays: ["mon", "tue", "wed", "thu", "fri"],
      windowEnd: "20:00",
      now: seg9h,
    });
    expect(eta.isToday).toBe(true);
    expect(eta.label).toBe("hoje, por volta das 20h");
  });

  it("não cabe hoje: termina no próximo dia útil dentro da janela, nomeado", () => {
    const eta = estimateDispatchCompletion({
      pendingLeads: 600,
      dailyLimit: 500,
      sentToday: 0,
      windowDays: ["mon", "tue", "wed", "thu", "fri"],
      windowEnd: "20:00",
      now: seg9h, // segunda
    });
    expect(eta.isToday).toBe(false);
    expect(eta.weekday).toBe("tue");
    expect(eta.label).toBe("terça-feira, por volta das 20h");
  });

  it("pula fim de semana quando a janela é só dias úteis", () => {
    const sexta = new Date("2026-09-18T09:00:00-03:00"); // sexta-feira
    const eta = estimateDispatchCompletion({
      pendingLeads: 400,
      dailyLimit: 500,
      sentToday: 500, // cota de hoje já estourada
      windowDays: ["mon", "tue", "wed", "thu", "fri"],
      windowEnd: "20:00",
      now: sexta,
    });
    // sexta sem cota -> pula sábado/domingo -> cai na segunda, que sozinha já cobre os 400
    expect(eta.weekday).toBe("mon");
    expect(eta.label).toBe("segunda-feira, por volta das 20h");
  });

  it("nunca inclui minuto — só 'por volta das <hora>h'", () => {
    const eta = estimateDispatchCompletion({ pendingLeads: 10, dailyLimit: 50, sentToday: 0, now: seg9h });
    expect(eta.label).toMatch(/por volta das \d{2}h$/);
  });

  it("sem leads pendentes: nenhuma previsão (nada a estimar)", () => {
    expect(estimateDispatchCompletion({ pendingLeads: 0, dailyLimit: 500 })).toBeNull();
  });

  it("cota zerada/negativa: avisa em vez de dividir por zero", () => {
    const eta = estimateDispatchCompletion({ pendingLeads: 10, dailyLimit: 0 });
    expect(eta.label).toContain("sem cota disponível");
  });
});
