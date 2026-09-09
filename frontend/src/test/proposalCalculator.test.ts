import { describe, it, expect } from "vitest";
import {
  calculateProposalValues,
  computeVpFromItems,
  buildIncludedProductIds,
  isCobrancaUnica,
} from "@/lib/geracaoDigital/proposalCalculator";

// Fonte única de cálculo do módulo GD.
// Cada teste abaixo reproduz um caso que ESTAVA errado em produção.

const pkgAnual = {
  id: "pkg-anual",
  tipo: "gd",
  periodo: "anual",
  valor: 28800, // valor do PERÍODO (12 meses) => 2.400/mês
  valor_vp: null,
};

const pkgTrimestral = {
  id: "pkg-tri",
  tipo: "gd",
  periodo: "trimestral",
  valor: 8400, // 3 meses => 2.800/mês
  valor_vp: null,
};

/** Itens como o wizard monta: linha do pacote + conteúdo do pacote a valor 0. */
function itensDoPacote(nome: string, mensalidade: number, meses: number, produtos: string[]): any[] {
  return [
    {
      product_id: null,
      descricao: `Pacote: ${nome} (Recorrência)`,
      categoria: "gd",
      valor: mensalidade,
      recorrencia: "mensal",
      meses,
    },
    ...produtos.map((id) => ({
      product_id: id,
      descricao: `Produto ${id}`,
      categoria: "gd",
      valor: 0,
      recorrencia: "mensal",
    })),
  ];
}

describe("recorrência: 'pontual' é cobrança única, não mensalidade", () => {
  // O catálogo (gd_products) grava "pontual"; o wizard grava "unico". Os testes
  // antigos só usavam "unico" — testavam a suposição, não o banco. Em produção
  // TODO item "pontual" caía na mensalidade e era multiplicado pelos meses.

  it("reconhece os dois vocabulários como cobrança única", () => {
    expect(isCobrancaUnica({ recorrencia: "unico" })).toBe(true);
    expect(isCobrancaUnica({ recorrencia: "pontual" })).toBe(true);
    expect(isCobrancaUnica({ recorrencia: "PONTUAL" })).toBe(true);
    expect(isCobrancaUnica({ recorrencia: "mensal" })).toBe(false);
    expect(isCobrancaUnica({})).toBe(false); // sem campo => mensal
  });

  const pkgSemestral = { id: "pkg-sem", tipo: "gd", periodo: "semestral", valor: 36000 }; // 6.000/mês

  /** Clinica Vitallis, itens copiados do banco (gd_proposals.itens). */
  const itensVitallis: any[] = [
    { product_id: null, descricao: "Pacote: Pacote Semestral (Recorrência)", categoria: "gd", valor: 6000, recorrencia: "mensal", meses: 6, valor_vp: 3000 },
    // conteúdo do pacote (valor 0) — inclui os pontuais que o pacote já cobre
    ...["p-trafego", "p-linkedin", "p-gads", "p-gmn", "p-logo", "p-panfleto", "p-video"].map((id) => ({
      product_id: id, descricao: `Produto ${id}`, categoria: "gd", valor: 0, recorrencia: "mensal",
    })),
    // avulsos que o wizard regravou com valor a partir do catálogo
    { product_id: "p-trafego", descricao: "GD: Gestão de tráfego google/meta ads", categoria: "gd", valor: 2000, recorrencia: "mensal" },
    { product_id: "p-linkedin", descricao: "GD: Gestão de redes sociais - LinkedIn", categoria: "gd", valor: 1500, recorrencia: "mensal" },
    { product_id: "p-gads", descricao: "GD: Google Ads", categoria: "gd", valor: 1500, recorrencia: "mensal" },
    { product_id: "p-gmn", descricao: "GD: Google Meu Negócio", categoria: "gd", valor: 300, recorrencia: "mensal" },
    { product_id: "p-logo", descricao: "GD: Logomarca", categoria: "gd", valor: 800, recorrencia: "pontual" },
    { product_id: "p-panfleto", descricao: "GD: Panfletos", categoria: "gd", valor: 400, recorrencia: "pontual" },
    { product_id: "p-video", descricao: "GD: Vídeo avulso", categoria: "gd", valor: 350, recorrencia: "pontual" },
    // ÚNICO fora do pacote: one-off de verdade
    { product_id: "p-landing", descricao: "GD: Landing Page/site", categoria: "gd", valor: 2500, recorrencia: "pontual" },
  ];

  it("caso Vitallis: com pacote, nada além do pacote entra na mensalidade", () => {
    const calc = calculateProposalValues(
      { package_id: "pkg-sem", periodo_plano: "semestral", itens: itensVitallis },
      [pkgSemestral]
    );
    // antes: 6.000 + 2.500 = 8.500/mês e compromisso 51.000
    expect(calc.mensalidadeFinal).toBe(6000);
    expect(calc.mesesPeriodo).toBe(6);
    expect(calc.compromissoFinal).toBe(36000);
  });

  it("caso Vitallis: pacote não gera setup — nem os pontuais fora dele", () => {
    const calc = calculateProposalValues(
      { package_id: "pkg-sem", periodo_plano: "semestral", itens: itensVitallis },
      [pkgSemestral]
    );
    // a landing page de 2.500 está coberta pelo pacote
    expect(calc.setupFinal).toBe(0);
    expect(calc.totalGeral).toBe(36000);
  });

  it("caso Vitallis: o único setup cobrável é o do sistema Vexo", () => {
    const calc = calculateProposalValues(
      { package_id: "pkg-sem", periodo_plano: "semestral", itens: itensVitallis, cobrar_setup: true, valor_setup_vexo: 5000 },
      [pkgSemestral]
    );
    expect(calc.setupFinal).toBe(5000);
    expect(calc.totalGeral).toBe(41000);
  });

  it("caso Vitallis: VP é só o do pacote", () => {
    const calc = calculateProposalValues(
      { package_id: "pkg-sem", periodo_plano: "semestral", itens: itensVitallis },
      [pkgSemestral]
    );
    expect(calc.vpTotal).toBe(3000);
  });
});

describe("anti-bitributação (regra única de dedupe)", () => {
  it("identifica os product_ids que já vêm no pacote", () => {
    const items = itensDoPacote("Anual", 2400, 12, ["p1", "p2"]);
    const included = buildIncludedProductIds(items);
    expect(included.has("p1")).toBe(true);
    expect(included.has("p2")).toBe(true);
  });

  it("NÃO soma de novo um avulso que já compõe o pacote", () => {
    const items = [
      ...itensDoPacote("Anual", 2400, 12, ["p1"]),
      // mesmo produto reaparecendo como avulso com valor (o bug)
      { product_id: "p1", descricao: "GD: Produto p1", categoria: "gd", valor: 500, recorrencia: "mensal" },
    ];
    const calc = calculateProposalValues({ package_id: "pkg-anual", itens: items }, [pkgAnual]);
    // 2.400 do pacote e NADA do avulso duplicado
    expect(calc.mensalidadeOriginal).toBe(2400);
  });

  it("PACOTE FECHADO: nem um avulso fora do pacote soma", () => {
    const items = [
      ...itensDoPacote("Anual", 2400, 12, ["p1"]),
      { product_id: "p9", descricao: "GD: Extra p9", categoria: "gd", valor: 500, recorrencia: "mensal" },
    ];
    const calc = calculateProposalValues({ package_id: "pkg-anual", itens: items }, [pkgAnual]);
    // regra: escolheu pacote, o preço do pacote É o preço
    expect(calc.mensalidadeOriginal).toBe(2400);
  });

  it("SEM pacote, os avulsos voltam a somar normalmente", () => {
    const items = [
      { product_id: "p9", descricao: "GD: Extra p9", categoria: "gd", valor: 500, recorrencia: "mensal" },
      { product_id: "p8", descricao: "GD: Extra p8", categoria: "gd", valor: 300, recorrencia: "mensal" },
      { product_id: "p7", descricao: "GD: Landing", categoria: "gd", valor: 2500, recorrencia: "pontual" },
    ];
    const calc = calculateProposalValues({ itens: items }, []);
    expect(calc.mensalidadeOriginal).toBe(800);
    expect(calc.setupOriginal).toBe(2500);
  });
});

describe("VP / permuta — bug de somatória", () => {
  it("não duplica VP de produto que já está no pacote", () => {
    const items = [
      ...itensDoPacote("Anual", 2400, 12, ["p1"]),
      { product_id: null, descricao: "Pacote: Anual (Recorrência)", valor: 0, valor_vp: 1000 },
      // avulso duplicado carregando VP (era somado de novo)
      { product_id: "p1", descricao: "GD: Produto p1", valor: 500, valor_vp: 300, recorrencia: "mensal" },
    ];
    expect(computeVpFromItems(items)).toBe(1000);
  });

  it("com pacote, VP de avulso fora do pacote também não soma", () => {
    const items = [
      ...itensDoPacote("Anual", 2400, 12, ["p1"]),
      { product_id: null, descricao: "Pacote: Anual (Recorrência)", valor: 0, valor_vp: 1000 },
      { product_id: "p9", descricao: "GD: Extra", valor: 500, valor_vp: 250, recorrencia: "mensal" },
    ];
    // pacote fechado vale para VP igual vale para reais
    expect(computeVpFromItems(items)).toBe(1000);
  });

  it("sem pacote, VP dos avulsos soma", () => {
    const items = [
      { product_id: "p9", descricao: "GD: Extra", valor: 500, valor_vp: 250, recorrencia: "mensal" },
      { product_id: "p8", descricao: "GD: Outro", valor: 400, valor_vp: 200, recorrencia: "mensal" },
    ];
    expect(computeVpFromItems(items)).toBe(450);
  });

  it("VP zero quando a proposta é 100% em reais", () => {
    const items = itensDoPacote("Anual", 2400, 12, ["p1", "p2"]);
    expect(computeVpFromItems(items)).toBe(0);
    const calc = calculateProposalValues({ package_id: "pkg-anual", itens: items }, [pkgAnual]);
    expect(calc.vpTotal).toBe(0);
  });

  it("cenário de edição: TODO o conteúdo do pacote vira avulso com VP — não multiplica", () => {
    const produtos = ["p1", "p2", "p3", "p4"];
    const items = [
      ...itensDoPacote("Anual", 2400, 12, produtos),
      { product_id: null, descricao: "Pacote: Anual (Recorrência)", valor: 0, valor_vp: 1000 },
      // o editor pré-marca todo o conteúdo do pacote como avulso
      ...produtos.map((id) => ({
        product_id: id,
        descricao: `GD: Produto ${id}`,
        valor: 400,
        valor_vp: 200,
        recorrencia: "mensal",
      })),
    ];
    // antes: 1000 + 4*200 = 1800. correto: 1000
    expect(computeVpFromItems(items)).toBe(1000);
  });
});

describe("totais derivados (nunca ler valor_total do banco)", () => {
  it("compromisso = mensalidade x meses (trimestral)", () => {
    const items = itensDoPacote("Trimestral", 2800, 3, ["p1"]);
    const calc = calculateProposalValues({ package_id: "pkg-tri", itens: items }, [pkgTrimestral]);
    expect(calc.mensalidadeOriginal).toBe(2800);
    expect(calc.mesesPeriodo).toBe(3);
    expect(calc.compromissoOriginal).toBe(8400);
  });

  it("caso Dr. Diogo: setup 3.000 + anual 2.400/mês => total geral 31.800", () => {
    const items = itensDoPacote("Anual", 2400, 12, ["p1", "p2"]);
    const calc = calculateProposalValues(
      { package_id: "pkg-anual", itens: items, cobrar_setup: true, valor_setup_vexo: 3000 },
      [pkgAnual]
    );
    expect(calc.setupFinal).toBe(3000);
    expect(calc.mensalidadeFinal).toBe(2400);
    expect(calc.compromissoFinal).toBe(28800);
    expect(calc.totalGeral).toBe(31800);
  });

  it("reeditar não infla o total (o bug do R$ 10.900)", () => {
    const produtos = ["p1", "p2", "p3"];
    const items = [
      ...itensDoPacote("Anual", 2400, 12, produtos),
      // conteúdo do pacote reaparecendo como avulso com valor após reedição
      ...produtos.map((id) => ({
        product_id: id,
        descricao: `GD: Produto ${id}`,
        valor: 1000,
        recorrencia: "mensal",
      })),
    ];
    const calc = calculateProposalValues(
      { package_id: "pkg-anual", itens: items, cobrar_setup: true, valor_setup_vexo: 3000 },
      [pkgAnual]
    );
    // sem dedupe daria 2.400 + 3.000 de avulsos; com dedupe fica só o pacote
    expect(calc.mensalidadeFinal).toBe(2400);
    expect(calc.totalGeral).toBe(31800);
  });

  it("pacote vivo do catálogo tem precedência sobre o valor congelado no item", () => {
    // item salvo com 5.000 (preço antigo), catálogo já em 6.000/mês
    const items = itensDoPacote("Anual", 5000, 12, ["p1"]);
    const pkgAtualizado = { ...pkgAnual, valor: 72000 }; // 6.000/mês
    const calc = calculateProposalValues({ package_id: "pkg-anual", itens: items }, [pkgAtualizado]);
    expect(calc.mensalidadeOriginal).toBe(6000);
  });

  it("preço negociado (valor_override) vence o pacote vivo do catálogo", () => {
    // vendedor negociou 2.000/mês nesta proposta; catálogo está em 2.400
    const items = itensDoPacote("Anual", 2000, 12, ["p1"]);
    items[0].valor_override = true;
    const calc = calculateProposalValues({ package_id: "pkg-anual", itens: items }, [pkgAnual]);
    expect(calc.mensalidadeFinal).toBe(2000);
    expect(calc.compromissoFinal).toBe(24000);
  });

  it("sem override, editar o pacote no catálogo continua propagando", () => {
    const items = itensDoPacote("Anual", 2000, 12, ["p1"]);
    // sem valor_override => catálogo manda
    const calc = calculateProposalValues({ package_id: "pkg-anual", itens: items }, [pkgAnual]);
    expect(calc.mensalidadeFinal).toBe(2400);
  });

  it("override + setup negociado somam corretamente no total", () => {
    const items = itensDoPacote("Trimestral", 2500, 3, ["p1"]);
    items[0].valor_override = true;
    const calc = calculateProposalValues(
      { package_id: "pkg-tri", itens: items, cobrar_setup: true, valor_setup_vexo: 1000 },
      [pkgTrimestral]
    );
    expect(calc.mensalidadeFinal).toBe(2500);
    expect(calc.compromissoFinal).toBe(7500);
    expect(calc.totalGeral).toBe(8500);
  });

  it("sem catálogo, cai no valor salvo do item (fallback)", () => {
    const items = itensDoPacote("Anual", 2400, 12, ["p1"]);
    const calc = calculateProposalValues({ package_id: "pkg-anual", itens: items }, []);
    expect(calc.mensalidadeOriginal).toBe(2400);
  });
});

describe("precificação de propostas e repasse Vexo OS em combos GD", () => {
  it("Plano Essencial: setup personalizável R$ 1.000, mensalidade R$ 2.000 => repasse 35% mensal e 50% setup", () => {
    const items = itensDoPacote("Anual", 2000, 12, ["p1"]);
    items[0].valor_override = true;
    const calc = calculateProposalValues({
      package_id: "pkg-anual",
      itens: items,
      cobrar_setup: true,
      valor_setup_vexo: 1000,
      vexoPlan: "essencial",
    }, [pkgAnual]);

    expect(calc.setupOriginal).toBe(1000);
    expect(calc.mensalidadeOriginal).toBe(2000);
    expect(calc.repasseVexoPercentual).toBe(35);
    expect(calc.repasseVexoMensal).toBe(700); // 35% de 2000
    expect(calc.repasseVexoSetup).toBe(500); // 50% de 1000
  });

  it("Plano Avançado: setup personalizável R$ 2.500, mensalidade R$ 3.000 => repasse 45% mensal e 50% setup", () => {
    const items = itensDoPacote("Anual", 3000, 12, ["p1"]);
    items[0].valor_override = true;
    const calc = calculateProposalValues({
      package_id: "pkg-anual",
      itens: items,
      cobrar_setup: true,
      valor_setup_vexo: 2500,
      vexoPlan: "avancado",
    }, [pkgAnual]);

    expect(calc.setupOriginal).toBe(2500);
    expect(calc.mensalidadeOriginal).toBe(3000);
    expect(calc.repasseVexoPercentual).toBe(45);
    expect(calc.repasseVexoMensal).toBe(1350); // 45% de 3000
    expect(calc.repasseVexoSetup).toBe(1250); // 50% de 2500
  });

  it("Setup R$ 0 (isento): calcula repasse de setup como R$ 0 mantendo repasse da mensalidade", () => {
    const items = itensDoPacote("Anual", 1500, 12, ["p1"]);
    items[0].valor_override = true;
    const calc = calculateProposalValues({
      package_id: "pkg-anual",
      itens: items,
      cobrar_setup: true,
      valor_setup_vexo: 0,
      vexoPlan: "essencial",
    }, [pkgAnual]);

    expect(calc.setupOriginal).toBe(0);
    expect(calc.mensalidadeOriginal).toBe(1500);
    expect(calc.repasseVexoMensal).toBe(525); // 35% de 1500
    expect(calc.repasseVexoSetup).toBe(0); // 50% de 0
  });

  it("VP / Permuta Comercial: calcula proporcionalidade de 50% para Mensal, Trimestral, Semestral e Anual", () => {
    const pkgs = [
      { id: "p-mensal", tipo: "gd", periodo: "mensal", valor: 6000, valor_vp: 3000 },
      { id: "p-tri", tipo: "gd", periodo: "trimestral", valor: 16800, valor_vp: 8400 },
      { id: "p-sem", tipo: "gd", periodo: "semestral", valor: 31200, valor_vp: 15600 },
      { id: "p-anual", tipo: "gd", periodo: "anual", valor: 57600, valor_vp: 28800 },
    ];

    // 1. Mensal: R$ 6.000 / mês => R$ 3.000 VP
    const cMensal = calculateProposalValues({ package_id: "p-mensal", periodo_plano: "mensal" }, pkgs);
    expect(cMensal.mensalidadeFinal).toBe(6000);
    expect(cMensal.temVp).toBe(true);
    expect(cMensal.vpMensal).toBe(3000);
    expect(cMensal.dinheiroMensal).toBe(3000);
    expect(cMensal.compromissoFinal).toBe(6000);
    expect(cMensal.vpPeriodo).toBe(3000);
    expect(cMensal.dinheiroPeriodo).toBe(3000);

    // 2. Trimestral: R$ 5.600 / mês => R$ 2.800 VP (8.400 / 3)
    const cTri = calculateProposalValues({ package_id: "p-tri", periodo_plano: "trimestral" }, pkgs);
    expect(cTri.mensalidadeFinal).toBe(5600);
    expect(cTri.temVp).toBe(true);
    expect(cTri.vpMensal).toBe(2800);
    expect(cTri.dinheiroMensal).toBe(2800);
    expect(cTri.compromissoFinal).toBe(16800);
    expect(cTri.vpPeriodo).toBe(8400);
    expect(cTri.dinheiroPeriodo).toBe(8400);

    // 3. Semestral: R$ 5.200 / mês => R$ 2.600 VP (15.600 / 6)
    const cSem = calculateProposalValues({ package_id: "p-sem", periodo_plano: "semestral" }, pkgs);
    expect(cSem.mensalidadeFinal).toBe(5200);
    expect(cSem.temVp).toBe(true);
    expect(cSem.vpMensal).toBe(2600);
    expect(cSem.dinheiroMensal).toBe(2600);
    expect(cSem.compromissoFinal).toBe(31200);
    expect(cSem.vpPeriodo).toBe(15600);
    expect(cSem.dinheiroPeriodo).toBe(15600);

    // 4. Anual: R$ 4.800 / mês => R$ 2.400 VP (28.800 / 12)
    const cAnual = calculateProposalValues({ package_id: "p-anual", periodo_plano: "anual" }, pkgs);
    expect(cAnual.mensalidadeFinal).toBe(4800);
    expect(cAnual.temVp).toBe(true);
    expect(cAnual.vpMensal).toBe(2400);
    expect(cAnual.dinheiroMensal).toBe(2400);
    expect(cAnual.compromissoFinal).toBe(57600);
    expect(cAnual.vpPeriodo).toBe(28800);
    expect(cAnual.dinheiroPeriodo).toBe(28800);
  });

  describe("Descontos por prazo e VP sobre mensalidade com desconto", () => {
    const pkgs = [
      { id: "p-mensal", tipo: "gd", periodo: "mensal", valor: 5000 },
      { id: "p-tri", tipo: "gd", periodo: "trimestral", valor: 9000 }, // 3000/mes
      { id: "p-sem", tipo: "gd", periodo: "semestral", valor: 18000 }, // 3000/mes
      { id: "p-anual", tipo: "gd", periodo: "anual", valor: 24000 }, // 2000/mes
    ];

    it("aplica desconto independente por prazo quando descontos_por_periodo é fornecido", () => {
      const descontosPorPeriodo = {
        mensal: 20,
        trimestral: 0,
        semestral: 10,
        anual: 5,
      };

      // 1. Mensal: 5.000 com 20% de desconto => 4.000/mês
      const cMensal = calculateProposalValues({
        package_id: "p-mensal",
        periodo_plano: "mensal",
        descontos_por_periodo: descontosPorPeriodo,
      }, pkgs);
      expect(cMensal.descontoMensalPorcentagem).toBe(20);
      expect(cMensal.mensalidadeOriginal).toBe(5000);
      expect(cMensal.mensalidadeFinal).toBe(4000);
      expect(cMensal.compromissoFinal).toBe(4000);

      // 2. Trimestral: 3.000/mês com 0% de desconto => 3.000/mês
      const cTri = calculateProposalValues({
        package_id: "p-tri",
        periodo_plano: "trimestral",
        descontos_por_periodo: descontosPorPeriodo,
      }, pkgs);
      expect(cTri.descontoMensalPorcentagem).toBe(0);
      expect(cTri.mensalidadeOriginal).toBe(3000);
      expect(cTri.mensalidadeFinal).toBe(3000);
      expect(cTri.compromissoFinal).toBe(9000);

      // 3. Semestral: 3.000/mês com 10% de desconto => 2.700/mês
      const cSem = calculateProposalValues({
        package_id: "p-sem",
        periodo_plano: "semestral",
        descontos_por_periodo: descontosPorPeriodo,
      }, pkgs);
      expect(cSem.descontoMensalPorcentagem).toBe(10);
      expect(cSem.mensalidadeOriginal).toBe(3000);
      expect(cSem.mensalidadeFinal).toBe(2700);
      expect(cSem.compromissoFinal).toBe(16200);

      // 4. Anual: 2.000/mês com 5% de desconto => 1.900/mês
      const cAnual = calculateProposalValues({
        package_id: "p-anual",
        periodo_plano: "anual",
        descontos_por_periodo: descontosPorPeriodo,
      }, pkgs);
      expect(cAnual.descontoMensalPorcentagem).toBe(5);
      expect(cAnual.mensalidadeOriginal).toBe(2000);
      expect(cAnual.mensalidadeFinal).toBe(1900);
      expect(cAnual.compromissoFinal).toBe(22800);
    });

    it("compatibilidade regressiva: usa desconto_mensal_pct quando descontos_por_periodo não existe", () => {
      const propLegada = {
        package_id: "p-tri",
        periodo_plano: "trimestral",
        desconto_mensal_pct: 15,
      };
      const calc = calculateProposalValues(propLegada, pkgs);
      expect(calc.descontoMensalPorcentagem).toBe(15);
      expect(calc.mensalidadeOriginal).toBe(3000);
      expect(calc.mensalidadeFinal).toBe(2550); // 3000 - 15%
      expect(calc.compromissoFinal).toBe(7650);
    });

    it("calcula VP como percentual sobre a mensalidade JÁ com desconto (não come o desconto)", () => {
      // Caso real: Proposta 33d4d07a-e53b-4863-8bfe-1b72502a45f6
      // Mensal: R$ 5.000 - 20% = R$ 4.000. VP de 50% => R$ 2.000 em permuta + R$ 2.000 em dinheiro.
      const propMensal = {
        package_id: "p-mensal",
        periodo_plano: "mensal",
        descontos_por_periodo: { mensal: 20, trimestral: 0 },
        vp_percent: 50,
      };
      const cMensal = calculateProposalValues(propMensal, pkgs);
      expect(cMensal.mensalidadeOriginal).toBe(5000);
      expect(cMensal.mensalidadeFinal).toBe(4000);
      expect(cMensal.temVp).toBe(true);
      expect(cMensal.vpPercent).toBe(50);
      expect(cMensal.vpMensal).toBe(2000);
      expect(cMensal.dinheiroMensal).toBe(2000);
      expect(cMensal.vpPeriodo).toBe(2000);
      expect(cMensal.dinheiroPeriodo).toBe(2000);

      // Trimestral: R$ 3.000/mês (total 9.000) com 20% desconto => R$ 2.400/mês (total 7.200).
      // VP 50% => R$ 1.200 em permuta + R$ 1.200 em dinheiro / mês. Total VP = 3.600, Dinheiro = 3.600.
      const propTri = {
        package_id: "p-tri",
        periodo_plano: "trimestral",
        descontos_por_periodo: { mensal: 0, trimestral: 20 },
        vp_percent: 50,
      };
      const cTri = calculateProposalValues(propTri, pkgs);
      expect(cTri.mensalidadeOriginal).toBe(3000);
      expect(cTri.mensalidadeFinal).toBe(2400);
      expect(cTri.compromissoFinal).toBe(7200);
      expect(cTri.temVp).toBe(true);
      expect(cTri.vpPercent).toBe(50);
      expect(cTri.vpMensal).toBe(1200);
      expect(cTri.dinheiroMensal).toBe(1200);
      expect(cTri.vpPeriodo).toBe(3600);
      expect(cTri.dinheiroPeriodo).toBe(3600);
    });

    it("compatibilidade regressiva de VP: legado sem vp_percent preserva cálculo via valor_vp", () => {
      const propLegadaVp = {
        package_id: "p-mensal",
        periodo_plano: "mensal",
        valor_vp: 2500, // fixo legado
      };
      const calc = calculateProposalValues(propLegadaVp, pkgs);
      expect(calc.mensalidadeFinal).toBe(5000);
      expect(calc.temVp).toBe(true);
      expect(calc.vpMensal).toBe(2500);
      expect(calc.dinheiroMensal).toBe(2500);
      expect(calc.vpPercent).toBe(50);
    });
  });
});
