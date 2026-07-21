import { describe, it, expect } from "vitest";
import {
  calculateProposalValues,
  computeVpFromItems,
  buildIncludedProductIds,
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

  it("soma normalmente um avulso que NÃO está no pacote", () => {
    const items = [
      ...itensDoPacote("Anual", 2400, 12, ["p1"]),
      { product_id: "p9", descricao: "GD: Extra p9", categoria: "gd", valor: 500, recorrencia: "mensal" },
    ];
    const calc = calculateProposalValues({ package_id: "pkg-anual", itens: items }, [pkgAnual]);
    expect(calc.mensalidadeOriginal).toBe(2900);
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

  it("soma VP de avulso legítimo (fora do pacote)", () => {
    const items = [
      ...itensDoPacote("Anual", 2400, 12, ["p1"]),
      { product_id: null, descricao: "Pacote: Anual (Recorrência)", valor: 0, valor_vp: 1000 },
      { product_id: "p9", descricao: "GD: Extra", valor: 500, valor_vp: 250, recorrencia: "mensal" },
    ];
    expect(computeVpFromItems(items)).toBe(1250);
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
