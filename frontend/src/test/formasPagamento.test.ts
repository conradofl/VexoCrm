import { describe, it, expect } from "vitest";
import {
  FORMAS_SETUP,
  FORMAS_MENSALIDADE,
  MAX_PARCELAS,
  formasVazias,
  alternarForma,
  ajustarParcelas,
  parcelasDe,
  nomeDaForma,
  formasParaTerms,
  termsParaFormas,
  termsLegados,
} from "@/lib/geracaoDigital/formasPagamento";
import { termAplicaA, computePaymentBreakdown } from "@/lib/geracaoDigital/paymentTerms";

describe("formas de pagamento fixas", () => {
  it("formas por item, como combinado", () => {
    expect(FORMAS_SETUP.map((f) => f.id)).toEqual(["pix_avista", "entrada_pix_30d", "cartao_parcelado"]);
    expect(FORMAS_MENSALIDADE.map((f) => f.id)).toEqual([
      "cartao_recorrente",
      "boleto_recorrente",
      "pix_recorrente",
      "cartao_parcelado_periodo",
      "pix_avista_projeto",
    ]);
  });

  it("marcar e desmarcar", () => {
    let f = formasVazias();
    f = alternarForma(f, "pix_avista");
    expect(f.marcadas).toEqual(["pix_avista"]);
    f = alternarForma(f, "pix_avista");
    expect(f.marcadas).toEqual([]);
  });
});

describe("stepper de parcelas", () => {
  it("tem padrão sensato por forma", () => {
    const f = formasVazias();
    expect(parcelasDe(f, "cartao_parcelado")).toBe(3);
  });

  it("deriva o padrão de parcelas da mensalidade pelo período do plano", () => {
    const f = formasVazias();
    expect(parcelasDe(f, "cartao_parcelado_periodo", "trimestral")).toBe(3);
    expect(parcelasDe(f, "cartao_parcelado_periodo", "semestral")).toBe(6);
    expect(parcelasDe(f, "cartao_parcelado_periodo", "anual")).toBe(12);
    expect(parcelasDe(f, "cartao_parcelado_periodo", "mensal")).toBe(1);
    expect(parcelasDe(f, "cartao_parcelado_periodo", 3)).toBe(3);
    expect(parcelasDe(f, "cartao_parcelado_periodo", 6)).toBe(6);
    expect(parcelasDe(f, "cartao_parcelado_periodo")).toBe(1);
  });

  it("sobe e desce de um em um", () => {
    let f = formasVazias();
    f = ajustarParcelas(f, "cartao_parcelado", 1);
    expect(parcelasDe(f, "cartao_parcelado")).toBe(4);
    f = ajustarParcelas(f, "cartao_parcelado", -1);
    expect(parcelasDe(f, "cartao_parcelado")).toBe(3);
  });

  it("sobe e desce parcelas da mensalidade a partir do padrão do período", () => {
    let f = formasVazias();
    f = ajustarParcelas(f, "cartao_parcelado_periodo", 1, "trimestral"); // 3 -> 4
    expect(parcelasDe(f, "cartao_parcelado_periodo", "trimestral")).toBe(4);
    f = ajustarParcelas(f, "cartao_parcelado_periodo", -2, "trimestral"); // 4 -> 2
    expect(parcelasDe(f, "cartao_parcelado_periodo", "trimestral")).toBe(2);
  });

  it("nunca desce abaixo de 1", () => {
    let f = formasVazias();
    for (let i = 0; i < 10; i++) f = ajustarParcelas(f, "cartao_parcelado", -1);
    expect(parcelasDe(f, "cartao_parcelado")).toBe(1);
  });

  it("nunca passa do teto", () => {
    let f = formasVazias();
    for (let i = 0; i < 50; i++) f = ajustarParcelas(f, "cartao_parcelado", 1);
    expect(parcelasDe(f, "cartao_parcelado")).toBe(MAX_PARCELAS);
  });

  it("o nome exibido carrega as parcelas", () => {
    let f = formasVazias();
    f = ajustarParcelas(f, "cartao_parcelado", 3); // 3 -> 6
    expect(nomeDaForma(f, FORMAS_SETUP[2])).toBe("Parcelado no Cartão em até 3x em 6x");
    expect(nomeDaForma(f, FORMAS_SETUP[0])).toBe("Pix à vista");

    const formaMensal = FORMAS_MENSALIDADE.find((m) => m.id === "cartao_parcelado_periodo")!;
    expect(nomeDaForma(f, formaMensal, "trimestral")).toBe("Parcelado no Cartão em até 3x");
    expect(nomeDaForma(f, formaMensal, "semestral")).toBe("Parcelado no Cartão em até 6x");
    expect(nomeDaForma(f, formaMensal, "anual")).toBe("Parcelado no Cartão em até 12x");
    expect(nomeDaForma(f, formaMensal, "mensal")).toBe("Parcelado no Cartão em 1x");
  });
});

describe("conversão para PaymentTerm (formato já gravado em condicoes_pagamento)", () => {
  const marcarTudo = () => {
    let f = formasVazias();
    ["pix_avista", "cartao_parcelado", "pix_recorrente", "pix_avista_projeto"].forEach((id) => {
      f = alternarForma(f, id as any);
    });
    return f;
  };

  it("gera um term por forma marcada, com aplica_a certo", () => {
    const terms = formasParaTerms(marcarTudo());
    expect(terms).toHaveLength(4);
    expect(termAplicaA(terms.find((t) => t.id === "cartao_parcelado")!)).toBe("setup");
    expect(termAplicaA(terms.find((t) => t.id === "pix_recorrente")!)).toBe("mensalidade");
  });

  it("ids são estáveis: a escolha do cliente sobrevive a reedição", () => {
    const a = formasParaTerms(marcarTudo()).map((t) => t.id);
    const b = formasParaTerms(marcarTudo()).map((t) => t.id);
    expect(a).toEqual(b);
    expect(a).toContain("cartao_parcelado");
  });

  it("o desdobramento do parcelado bate com o valor", () => {
    let f = formasVazias();
    f = alternarForma(f, "cartao_parcelado"); // 3x
    const term = formasParaTerms(f)[0];
    const b = computePaymentBreakdown(term, 3000);
    expect(b.linhas[0]).toContain("3x");
    expect(b.linhas[0]).toContain("1.000,00");
  });

  it("parcelar o total do período usa o total, não a mensalidade", () => {
    let f = formasVazias();
    f = alternarForma(f, "cartao_parcelado"); // 3x
    const term = formasParaTerms(f)[0];
    const b = computePaymentBreakdown(term, 2400 * 12);
    expect(b.linhas[0]).toContain("3x");
    expect(b.linhas[0]).toContain("9.600,00");
  });

  it("converte cartao_parcelado_periodo para parcelado_cartao com total do período", () => {
    let f = formasVazias();
    f = alternarForma(f, "cartao_parcelado_periodo");
    const terms = formasParaTerms(f, "trimestral");
    expect(terms).toHaveLength(1);
    const term = terms[0];
    expect(term.id).toBe("cartao_parcelado_periodo");
    expect(term.tipo).toBe("parcelado_cartao");
    expect(termAplicaA(term)).toBe("mensalidade");
    expect(term.config?.num_parcelas).toBe(3);
    expect(term.nome).toBe("Parcelado no Cartão em até 3x");

    // trimestral de R$ 5.000/mês vira 3x de R$ 5.000 (total R$ 15.000)
    const b = computePaymentBreakdown(term, 5000 * 3);
    expect(b.linhas[0]).toContain("3x");
    expect(b.linhas[0]).toContain("5.000,00");
    expect(b.linhas[0]).toContain("no cartão");
    expect(b.totalFinal).toBe(15000);
  });
});

describe("ida e volta e convivência com a biblioteca antiga", () => {
  it("reconstrói marcadas e parcelas do que está gravado", () => {
    let f = formasVazias();
    f = alternarForma(f, "cartao_parcelado");
    f = ajustarParcelas(f, "cartao_parcelado", 5); // 8x
    f = alternarForma(f, "pix_recorrente");

    const volta = termsParaFormas(formasParaTerms(f));
    expect(volta.marcadas.sort()).toEqual(["cartao_parcelado", "pix_recorrente"]);
    expect(parcelasDe(volta, "cartao_parcelado")).toBe(8);
  });

  it("ignora condições legadas ao reconstruir, mas as preserva à parte", () => {
    const gravadas = [
      ...formasParaTerms(alternarForma(formasVazias(), "pix_avista")),
      { id: "adhoc-123", nome: "Setup 2x no boleto", tipo: "custom", config: {}, ativo: true },
    ];
    expect(termsParaFormas(gravadas).marcadas).toEqual(["pix_avista"]);
    expect(termsLegados(gravadas).map((t) => t.id)).toEqual(["adhoc-123"]);
  });
});
