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
  it("três por item, como combinado", () => {
    expect(FORMAS_SETUP.map((f) => f.id)).toEqual(["pix_avista", "cartao_avista", "cartao_parcelado"]);
    expect(FORMAS_MENSALIDADE.map((f) => f.id)).toEqual([
      "pix_recorrente",
      "cartao_recorrente",
      "cartao_total_parcelado",
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
    expect(parcelasDe(f, "cartao_total_parcelado")).toBe(12);
  });

  it("sobe e desce de um em um", () => {
    let f = formasVazias();
    f = ajustarParcelas(f, "cartao_parcelado", 1);
    expect(parcelasDe(f, "cartao_parcelado")).toBe(4);
    f = ajustarParcelas(f, "cartao_parcelado", -1);
    expect(parcelasDe(f, "cartao_parcelado")).toBe(3);
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
    expect(nomeDaForma(f, FORMAS_SETUP[2])).toBe("Cartão parcelado em 6x");
    expect(nomeDaForma(f, FORMAS_SETUP[0])).toBe("Pix à vista");
  });
});

describe("conversão para PaymentTerm (formato já gravado em condicoes_pagamento)", () => {
  const marcarTudo = () => {
    let f = formasVazias();
    ["pix_avista", "cartao_parcelado", "pix_recorrente", "cartao_total_parcelado"].forEach((id) => {
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
    f = alternarForma(f, "cartao_total_parcelado"); // 12x
    const term = formasParaTerms(f)[0];
    const b = computePaymentBreakdown(term, 2400 * 12);
    expect(b.linhas[0]).toContain("12x");
    expect(b.linhas[0]).toContain("2.400,00");
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
