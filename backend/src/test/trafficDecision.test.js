// Função de decisão do Gestor de Tráfego (SPEC-GESTOR-TRAFEGO-FASE1, 5.3).
// Função pura: nada dublado.

import { describe, expect, it } from "vitest";
import { DECISOES, decidir, piorDecisao } from "../traffic/decision.js";

// Custo por lead: quanto menor melhor, meta de R$ 50.
const CPL = { key: "cpl", target: 50, better: "lower" };
// Retorno sobre o gasto: quanto maior melhor, meta 4, gasto mínimo próprio de R$ 200.
const ROAS = { key: "roas", target: 4, better: "higher", min_spend: 200 };

describe("decidir: KPI de quanto menor melhor (custo por lead)", () => {
  it("escala quando o custo está mais de 20% abaixo da meta", () => {
    const r = decidir({ valorKpi: 30, kpi: CPL, gasto: 300 });
    expect(r.decisao).toBe(DECISOES.ESCALAR);
    expect(r.numeros).toMatchObject({ valor: 30, meta: 50, gasto: 300, gastoMinimo: 60, variacao: 0.4 });
    expect(r.motivo).toContain("40% melhor");
  });

  it("limiar exato de escala: 20% melhor escala, um centavo a menos mantém", () => {
    expect(decidir({ valorKpi: 40, kpi: CPL, gasto: 300 }).decisao).toBe(DECISOES.ESCALAR);
    expect(decidir({ valorKpi: 40.01, kpi: CPL, gasto: 300 }).decisao).toBe(DECISOES.MANTER);
  });

  it("limiar exato de corte: 50% pior corta, um centavo a menos mantém", () => {
    expect(decidir({ valorKpi: 75, kpi: CPL, gasto: 300 }).decisao).toBe(DECISOES.MATAR);
    expect(decidir({ valorKpi: 74.99, kpi: CPL, gasto: 300 }).decisao).toBe(DECISOES.MANTER);
  });

  it("mantém no meio, dizendo de que lado da meta está", () => {
    const pior = decidir({ valorKpi: 60, kpi: CPL, gasto: 300 });
    expect(pior.decisao).toBe(DECISOES.MANTER);
    expect(pior.motivo).toContain("20% pior");

    const melhor = decidir({ valorKpi: 45, kpi: CPL, gasto: 300 });
    expect(melhor.decisao).toBe(DECISOES.MANTER);
    expect(melhor.motivo).toContain("10% melhor");
  });

  it("limiar exato não depende de resto de ponto flutuante", () => {
    // (0.3 - 0.24) / 0.3 dá 0.19999999999999996 em ponto flutuante.
    const r = decidir({ valorKpi: 0.24, kpi: { key: "cpc", target: 0.3, better: "lower" }, gasto: 10 });
    expect(r.decisao).toBe(DECISOES.ESCALAR);
  });
});

describe("decidir: amostra", () => {
  it("gasto abaixo de 1,2 vez a meta é amostra insuficiente, mesmo com KPI ótimo", () => {
    const r = decidir({ valorKpi: 10, kpi: CPL, gasto: 59.99 });
    expect(r.decisao).toBe(DECISOES.AMOSTRA_INSUFICIENTE);
    expect(r.numeros.gastoMinimo).toBe(60);
  });

  it("gasto exatamente em 1,2 vez a meta já decide", () => {
    expect(decidir({ valorKpi: 10, kpi: CPL, gasto: 60 }).decisao).toBe(DECISOES.ESCALAR);
  });

  it("gasto zero é amostra insuficiente, nunca corte", () => {
    const r = decidir({ valorKpi: null, kpi: CPL, gasto: 0 });
    expect(r.decisao).toBe(DECISOES.AMOSTRA_INSUFICIENTE);
    expect(decidir({ valorKpi: null, kpi: CPL, gasto: undefined }).decisao).toBe(DECISOES.AMOSTRA_INSUFICIENTE);
  });

  it("o fator de gasto mínimo vem do perfil", () => {
    expect(decidir({ valorKpi: 10, kpi: CPL, gasto: 100, minSpendFactor: 3 }).decisao).toBe(DECISOES.AMOSTRA_INSUFICIENTE);
    expect(decidir({ valorKpi: 10, kpi: CPL, gasto: 150, minSpendFactor: 3 }).decisao).toBe(DECISOES.ESCALAR);
  });

  it("gastou o suficiente e não teve resultado nenhum: corta e diz por quê", () => {
    const r = decidir({ valorKpi: null, kpi: CPL, gasto: 200 });
    expect(r.decisao).toBe(DECISOES.MATAR);
    expect(r.motivo).toContain("sem nenhum resultado");
  });
});

describe("decidir: KPI de quanto maior melhor (retorno sobre o gasto)", () => {
  it("escala em 20% acima, corta em 50% abaixo, mantém no meio", () => {
    expect(decidir({ valorKpi: 4.8, kpi: ROAS, gasto: 500 }).decisao).toBe(DECISOES.ESCALAR);
    expect(decidir({ valorKpi: 4.79, kpi: ROAS, gasto: 500 }).decisao).toBe(DECISOES.MANTER);
    expect(decidir({ valorKpi: 2, kpi: ROAS, gasto: 500 }).decisao).toBe(DECISOES.MATAR);
    expect(decidir({ valorKpi: 2.01, kpi: ROAS, gasto: 500 }).decisao).toBe(DECISOES.MANTER);
  });

  it("valor maior nunca é lido como pior", () => {
    const r = decidir({ valorKpi: 8, kpi: ROAS, gasto: 500 });
    expect(r.decisao).toBe(DECISOES.ESCALAR);
    expect(r.numeros.variacao).toBe(1);
  });

  it("usa o gasto mínimo do próprio KPI, não 1,2 vez a meta", () => {
    expect(decidir({ valorKpi: 8, kpi: ROAS, gasto: 199 }).decisao).toBe(DECISOES.AMOSTRA_INSUFICIENTE);
    expect(decidir({ valorKpi: 8, kpi: ROAS, gasto: 200 }).decisao).toBe(DECISOES.ESCALAR);
  });

  it("sem gasto mínimo configurado não decide", () => {
    const r = decidir({ valorKpi: 8, kpi: { key: "roas", target: 4, better: "higher" }, gasto: 5000 });
    expect(r.decisao).toBe(DECISOES.SEM_META);
    expect(r.motivo).toContain("gasto mínimo");
  });
});

describe("decidir: meta e limiares", () => {
  it("meta ausente, zero ou inválida não vira decisão", () => {
    for (const target of [undefined, null, "", 0, -5, "abc"]) {
      const r = decidir({ valorKpi: 30, kpi: { key: "cpl", target, better: "lower" }, gasto: 1000 });
      expect(r.decisao).toBe(DECISOES.SEM_META);
    }
    expect(decidir({ valorKpi: 30, kpi: undefined, gasto: 1000 }).decisao).toBe(DECISOES.SEM_META);
    expect(decidir().decisao).toBe(DECISOES.SEM_META);
  });

  it("limiares são configuráveis por KPI", () => {
    const kpi = { ...CPL, scale_at: 0.1, kill_at: 0.3 };
    expect(decidir({ valorKpi: 45, kpi, gasto: 300 }).decisao).toBe(DECISOES.ESCALAR);
    expect(decidir({ valorKpi: 65, kpi, gasto: 300 }).decisao).toBe(DECISOES.MATAR);
    expect(decidir({ valorKpi: 64, kpi, gasto: 300 }).decisao).toBe(DECISOES.MANTER);
  });

  it("devolve sempre a frase do motivo e os números usados", () => {
    const r = decidir({ valorKpi: 75, kpi: CPL, gasto: 300 });
    expect(r.motivo).toBe("cpl em 75, 50% pior que a meta de 50 (corta a partir de 50%).");
    expect(r.numeros).toEqual({
      kpi: "cpl",
      valor: 75,
      meta: 50,
      melhor: "lower",
      gasto: 300,
      gastoMinimo: 60,
      variacao: -0.5,
      escalarEm: 0.2,
      matarEm: 0.5,
    });
  });
});

describe("piorDecisao: campanha herda a pior decisão dos anúncios", () => {
  it("cortar vence manter, que vence escalar", () => {
    expect(piorDecisao([DECISOES.ESCALAR, DECISOES.MATAR, DECISOES.MANTER])).toBe(DECISOES.MATAR);
    expect(piorDecisao([DECISOES.ESCALAR, DECISOES.MANTER])).toBe(DECISOES.MANTER);
    expect(piorDecisao([DECISOES.ESCALAR, DECISOES.ESCALAR])).toBe(DECISOES.ESCALAR);
  });

  it("anúncio sem amostra não puxa a campanha", () => {
    expect(piorDecisao([DECISOES.ESCALAR, DECISOES.AMOSTRA_INSUFICIENTE])).toBe(DECISOES.ESCALAR);
    expect(piorDecisao([DECISOES.AMOSTRA_INSUFICIENTE, DECISOES.SEM_META])).toBe(DECISOES.AMOSTRA_INSUFICIENTE);
    expect(piorDecisao([DECISOES.SEM_META])).toBe(DECISOES.SEM_META);
  });

  it("lista vazia não tem decisão", () => {
    expect(piorDecisao([])).toBeNull();
    expect(piorDecisao(undefined)).toBeNull();
  });
});
