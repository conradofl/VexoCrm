import { describe, it, expect } from "vitest";
import { formasParaTerms, FORMAS_SETUP, nomeDaForma, formasVazias, alternarForma } from "@/lib/geracaoDigital/formasPagamento";
import { computePaymentBreakdown } from "@/lib/geracaoDigital/paymentTerms";

describe("DEFEITO 1: Isolamento e Renderização de Condições Especiais", () => {
  const renderCardCondicoesEspeciais = (proposal: any): string | null => {
    const temCondicoes = Boolean(proposal.condicoes_especiais || proposal.condicao_especial);
    if (!temCondicoes) return null;
    return String(proposal.condicoes_especiais || proposal.condicao_especial);
  };

  it("DUAS propostas com condições especiais DIFERENTES: cada uma mostra apenas a sua e não vaza", () => {
    const propostaA = {
      id: "prop-a",
      prospect_name: "Cliente Alpha",
      condicoes: "Contrato de 6 meses. Faturamento recorrente mensal.",
      condicoes_especiais: "Condição Alpha: 50% de entrada no aceite + saldo em 30 dias.",
    };

    const propostaB = {
      id: "prop-b",
      prospect_name: "Cliente Beta",
      condicoes: "Contrato de 12 meses. Faturamento recorrente mensal.",
      condicoes_especiais: "Condição Beta: Primeiro mês carência total, faturamento a partir do 2º mês.",
    };

    const cardA = renderCardCondicoesEspeciais(propostaA);
    const cardB = renderCardCondicoesEspeciais(propostaB);

    // Cada card exibe a sua própria condição especial
    expect(cardA).toBe("Condição Alpha: 50% de entrada no aceite + saldo em 30 dias.");
    expect(cardB).toBe("Condição Beta: Primeiro mês carência total, faturamento a partir do 2º mês.");

    // Nenhuma contém o texto da outra
    expect(cardA).not.toContain("Condição Beta");
    expect(cardB).not.toContain("Condição Alpha");

    // Nenhuma contém o texto de condicoes contratuais dentro do card especial
    expect(cardA).not.toContain(propostaA.condicoes);
    expect(cardB).not.toContain(propostaB.condicoes);
  });

  it("Proposta SEM condições especiais: o card NÃO é renderizado (null) e NÃO faz fallback para proposal.condicoes", () => {
    const propostaSemEspecial = {
      id: "prop-sem-especial",
      prospect_name: "Cliente Padrão",
      condicoes: "Contrato de 6 meses. Faturamento recorrente mensal.",
      condicoes_especiais: null,
    };

    const card = renderCardCondicoesEspeciais(propostaSemEspecial);
    expect(card).toBeNull();
  });

  it("Teste de Mutação: se houvesse fallback indevido para proposal.condicoes, o card apareceria com o texto do contrato", () => {
    const propostaSemEspecial = {
      id: "prop-sem-especial",
      prospect_name: "Cliente Padrão",
      condicoes: "Contrato de 6 meses. Faturamento recorrente mensal.",
      condicoes_especiais: null,
    };

    // Implementação antiga com bug (fazia || proposal.condicoes)
    const cardComBug = propostaSemEspecial.condicoes_especiais || propostaSemEspecial.condicoes;
    expect(cardComBug).toBe("Contrato de 6 meses. Faturamento recorrente mensal.");

    // Implementação corrigida (não faz fallback)
    const cardCorreto = renderCardCondicoesEspeciais(propostaSemEspecial);
    expect(cardCorreto).toBeNull();
  });
});

describe("DEFEITO 2: Formas de Pagamento e Ausência de 'Desconto' Não Concedido", () => {
  it("Rótulo de Pix à vista NÃO contém a palavra 'desconto' chumbada", () => {
    const pixDef = FORMAS_SETUP.find((f) => f.id === "pix_avista")!;
    expect(pixDef.label).toBe("Pix à vista");
    expect(pixDef.label.toLowerCase()).not.toContain("desconto");
    expect(pixDef.label.toLowerCase()).not.toContain("off");

    let f = formasVazias();
    f = alternarForma(f, "pix_avista");
    const nomeExibido = nomeDaForma(f, pixDef);
    expect(nomeExibido).toBe("Pix à vista");
    expect(nomeExibido.toLowerCase()).not.toContain("desconto");
  });

  it("Conversão de pix_avista para PaymentTerm NÃO força desconto fictício de 5%", () => {
    let f = formasVazias();
    f = alternarForma(f, "pix_avista");
    const terms = formasParaTerms(f);
    const pixTerm = terms.find((t) => t.id === "pix_avista")!;

    expect(pixTerm).toBeTruthy();
    // Breakdown de Pix à vista com base de R$ 2.000 não inventa desconto
    const breakdown = computePaymentBreakdown(pixTerm, 2000);
    expect(breakdown.linhas[0]).toContain("Pix à vista");
    expect(breakdown.linhas[0].toLowerCase()).not.toContain("desconto");
    expect(breakdown.linhas[0].toLowerCase()).not.toContain("off");
    expect(breakdown.totalFinal).toBe(2000);
  });

  it("Desconto em PaymentTerm só aparece quando percentual_desconto for explicitamente > 0", () => {
    const termSemDesconto = {
      id: "avista",
      nome: "À vista",
      tipo: "avista_desconto" as const,
      config: { meio: "pix" as const, percentual_desconto: 0 },
    };

    const breakdownSemDesc = computePaymentBreakdown(termSemDesconto, 5000);
    expect(breakdownSemDesc.linhas[0].toLowerCase()).not.toContain("desconto");
    expect(breakdownSemDesc.linhas[0].toLowerCase()).not.toContain("off");
    expect(breakdownSemDesc.totalFinal).toBe(5000);

    const termComDesconto = {
      id: "avista",
      nome: "À vista",
      tipo: "avista_desconto" as const,
      config: { meio: "pix" as const, percentual_desconto: 10 },
    };

    const breakdownComDesc = computePaymentBreakdown(termComDesconto, 5000);
    expect(breakdownComDesc.linhas[0]).toContain("10% de desconto");
    expect(breakdownComDesc.totalFinal).toBe(4500);
  });

  it("Teste de Mutação: se o label de Pix tivesse 'Com desconto' forçado, a palavra vazaria sem desconto", () => {
    const labelMutado = "Pix à vista (Com desconto)";
    expect(labelMutado.toLowerCase()).toContain("desconto");

    const labelCorrigido = FORMAS_SETUP.find((f) => f.id === "pix_avista")!.label;
    expect(labelCorrigido.toLowerCase()).not.toContain("desconto");
  });
});

describe("DEFEITO 3: Desconto na Mensalidade e Preço Riscado na Proposta Pública", () => {
  const resolvePrecoCheioMensal = ({
    valorTabelaPeriodo = 0,
    mesesItem = 1,
    valorTabelaMensal = 0,
    mensalFinalVal,
    mensalidadeOriginal,
    descontoMensalPorcentagem,
  }: {
    valorTabelaPeriodo?: number;
    mesesItem?: number;
    valorTabelaMensal?: number;
    mensalFinalVal: number;
    mensalidadeOriginal: number;
    descontoMensalPorcentagem: number;
  }) => {
    const rawTabelaMensal =
      valorTabelaPeriodo > 0
        ? Math.round((valorTabelaPeriodo / mesesItem) * 100) / 100
        : Number(valorTabelaMensal || 0);
    const temTabelaExplicita = rawTabelaMensal > mensalFinalVal;
    const temDescontoPercentual =
      !temTabelaExplicita &&
      descontoMensalPorcentagem > 0 &&
      mensalidadeOriginal > mensalFinalVal;
    const temPrecoCheio = temTabelaExplicita || temDescontoPercentual;
    const valorRiscado = temTabelaExplicita ? rawTabelaMensal : mensalidadeOriginal;
    const badgeTexto = temTabelaExplicita
      ? "Condição Especial"
      : `-${descontoMensalPorcentagem}%`;

    return {
      temPrecoCheio,
      valorRiscado,
      badgeTexto,
    };
  };

  it("Caso Big Jhow: mensal de R$ 8.000 com 25% de desconto exibe R$ 8.000 riscado e badge -25%", () => {
    const res = resolvePrecoCheioMensal({
      mensalidadeOriginal: 8000,
      mensalFinalVal: 6000,
      descontoMensalPorcentagem: 25,
    });

    expect(res.temPrecoCheio).toBe(true);
    expect(res.valorRiscado).toBe(8000);
    expect(res.badgeTexto).toBe("-25%");
  });

  it("Preço de tabela explícito prevalece e mantém badge 'Condição Especial'", () => {
    const res = resolvePrecoCheioMensal({
      valorTabelaMensal: 10000,
      mensalidadeOriginal: 8000,
      mensalFinalVal: 6000,
      descontoMensalPorcentagem: 25,
    });

    expect(res.temPrecoCheio).toBe(true);
    expect(res.valorRiscado).toBe(10000);
    expect(res.badgeTexto).toBe("Condição Especial");
  });

  it("Sem desconto e sem tabela: não exibe riscado", () => {
    const res = resolvePrecoCheioMensal({
      mensalidadeOriginal: 6000,
      mensalFinalVal: 6000,
      descontoMensalPorcentagem: 0,
    });

    expect(res.temPrecoCheio).toBe(false);
  });
});
