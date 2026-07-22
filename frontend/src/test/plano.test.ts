import { describe, it, expect } from "vitest";
import {
  planoVazio,
  planoValido,
  prazosOfertados,
  planoParaPacotes,
  planoDePacotes,
  planoDeProposta,
  nomeDaLinha,
  mesesDoPeriodo,
  type Plano,
} from "@/lib/geracaoDigital/plano";
import { calculateProposalValues } from "@/lib/geracaoDigital/proposalCalculator";

const gdProducts = [
  { id: "g1", nome: "Gestão de tráfego" },
  { id: "g2", nome: "Google Ads" },
  { id: "g3", nome: "Landing page" },
];
const vexoProducts = [{ id: "v1", nome: "CRM Vexo" }];

/** Caso Dr. Diogo: mesmo escopo, 3 prazos, preços diferentes. */
const planoDiogo = (): Plano => ({
  ...planoVazio(),
  gdIds: ["g1", "g2"],
  vexoIds: ["v1"],
  precos: { mensal: 0, trimestral: 2800, semestral: 2600, anual: 2400 },
});

describe("plano = escopo × prazos", () => {
  it("preencher o preço É ofertar o prazo", () => {
    const p = planoDiogo();
    expect(prazosOfertados(p)).toEqual(["trimestral", "semestral", "anual"]);
    expect(planoValido(p)).toBe(true);
  });

  it("plano sem escopo ou sem preço não é válido", () => {
    expect(planoValido(planoVazio())).toBe(false);
    expect(planoValido({ ...planoVazio(), gdIds: ["g1"] })).toBe(false);
    expect(planoValido({ ...planoVazio(), precos: { ...planoVazio().precos, anual: 100 } })).toBe(false);
  });

  it("os 4 prazos são de primeira classe, mensal incluído", () => {
    const p: Plano = { ...planoDiogo(), precos: { mensal: 3000, trimestral: 2800, semestral: 2600, anual: 2400 } };
    expect(prazosOfertados(p)).toEqual(["mensal", "trimestral", "semestral", "anual"]);
    expect(planoParaPacotes(p, "Dr. Diogo", gdProducts, vexoProducts)).toHaveLength(4);
  });

  it("um escopo vira N linhas de preço com o MESMO conteúdo", () => {
    const pacotes = planoParaPacotes(planoDiogo(), "Dr. Diogo", gdProducts, vexoProducts);
    expect(pacotes).toHaveLength(3);
    const escopos = pacotes.map((p) => p.produtos_incluidos.map((x) => x.product_id).join(","));
    expect(new Set(escopos).size).toBe(1);
    expect(pacotes[0].produtos_incluidos).toHaveLength(3); // g1, g2, v1
  });

  it("nome é gerado, não digitado — fim do 'Pacote O Anual' vs 'Pacote P Anual'", () => {
    expect(nomeDaLinha("Dr. Diogo", "semestral")).toBe("Dr. Diogo · Semestral");
    const pacotes = planoParaPacotes(planoDiogo(), "Dr. Diogo", gdProducts, vexoProducts);
    expect(pacotes.map((p) => p.nome)).toEqual([
      "Dr. Diogo · Trimestral",
      "Dr. Diogo · Semestral",
      "Dr. Diogo · Anual",
    ]);
  });

  it("valor gravado é o total do PERÍODO (convenção do gd_packages)", () => {
    const pacotes = planoParaPacotes(planoDiogo(), "Dr. Diogo", gdProducts, vexoProducts);
    expect(pacotes.find((p) => p.periodo === "trimestral")!.valor).toBe(2800 * 3);
    expect(pacotes.find((p) => p.periodo === "semestral")!.valor).toBe(2600 * 6);
    expect(pacotes.find((p) => p.periodo === "anual")!.valor).toBe(2400 * 12);
  });

  it("todas as linhas nascem ad_hoc — nunca entram na biblioteca", () => {
    const pacotes = planoParaPacotes(planoDiogo(), "Dr. Diogo", gdProducts, vexoProducts);
    expect(pacotes.every((p) => p.ad_hoc === true)).toBe(true);
  });

  it("preço cheio só vira riscado quando é maior que o preço real", () => {
    const p: Plano = { ...planoDiogo(), valorTabelaMensal: 3000 };
    const pacotes = planoParaPacotes(p, "X", gdProducts, vexoProducts);
    expect(pacotes.find((x) => x.periodo === "anual")!.valor_tabela).toBe(3000 * 12);
    // trimestral custa 2.800; tabela 3.000 ainda é maior => risca
    expect(pacotes.find((x) => x.periodo === "trimestral")!.valor_tabela).toBe(3000 * 3);

    const semRisco: Plano = { ...planoDiogo(), valorTabelaMensal: 2000 };
    expect(planoParaPacotes(semRisco, "X", gdProducts, vexoProducts).every((x) => x.valor_tabela === null)).toBe(true);
  });
});

describe("ida e volta: plano → linhas → plano (edição)", () => {
  it("reconstrói escopo e preços a partir das linhas gravadas", () => {
    const original = planoDiogo();
    const linhas = planoParaPacotes(original, "Dr. Diogo", gdProducts, vexoProducts).map((p, i) => ({
      ...p,
      id: `pk${i}`,
      tipo: "gd",
    }));
    const volta = planoDePacotes(linhas);
    expect(volta.gdIds.sort()).toEqual(["g1", "g2"]);
    expect(volta.vexoIds).toEqual(["v1"]);
    expect(volta.precos.trimestral).toBe(2800);
    expect(volta.precos.semestral).toBe(2600);
    expect(volta.precos.anual).toBe(2400);
    expect(volta.precos.mensal).toBe(0);
    expect(prazosOfertados(volta)).toEqual(prazosOfertados(original));
  });

  it("ignora períodos legados ('unico') sem quebrar", () => {
    const volta = planoDePacotes([
      { id: "a", tipo: "gd", periodo: "unico", valor: 3000, produtos_incluidos: [] },
      { id: "b", tipo: "gd", periodo: "anual", valor: 28800, produtos_incluidos: [{ product_id: "g1", nome: "x" }] },
    ]);
    expect(volta.precos.anual).toBe(2400);
    expect(volta.gdIds).toEqual(["g1"]);
  });

  it("plano vazio quando não há linha nenhuma", () => {
    expect(planoDePacotes([])).toEqual(planoVazio());
  });
});

describe("dois estados: no plano ou fora da proposta", () => {
  // Caso Vitallis: "GD: Landing Page/site R$ 2.500" sobrou do modelo antigo.
  // Não soma mais nada, mas era impresso com preço para o cliente.
  const linhaSemestral = {
    id: "pk1",
    tipo: "gd",
    periodo: "semestral",
    valor: 36000,
    produtos_incluidos: [
      { product_id: "g1", nome: "Gestão de tráfego", origem: "gd" },
      { product_id: "v1", nome: "CRM Vexo", origem: "vexo" },
    ],
  };
  const itensLegado = [
    { product_id: null, descricao: "Pacote: Vitallis · Semestral (Recorrência)", categoria: "gd", valor: 6000, recorrencia: "mensal" },
    { product_id: "g1", descricao: "Gestão de tráfego", categoria: "gd", valor: 0, recorrencia: "mensal" },
    { product_id: "v1", descricao: "CRM Vexo", categoria: "vexo", valor: 0, recorrencia: "mensal" },
    { product_id: "g3", descricao: "GD: Landing Page/site", categoria: "gd", valor: 2500, recorrencia: "pontual" },
  ];

  it("absorve o avulso com valor no escopo em vez de apagar o serviço", () => {
    const p = planoDeProposta([linhaSemestral], itensLegado);
    expect(p.gdIds).toContain("g3"); // serviço preservado
    expect(p.gdIds).toContain("g1");
    expect(p.vexoIds).toEqual(["v1"]);
  });

  it("não duplica o que já estava no escopo do pacote", () => {
    const itens = [
      ...itensLegado,
      // mesmo produto do pacote reaparecendo com valor
      { product_id: "g1", descricao: "GD: Gestão de tráfego", categoria: "gd", valor: 2000, recorrencia: "mensal" },
    ];
    const p = planoDeProposta([linhaSemestral], itens);
    expect(p.gdIds.filter((x) => x === "g1")).toHaveLength(1);
  });

  it("a linha do pacote nunca vira item de escopo", () => {
    const p = planoDeProposta([linhaSemestral], itensLegado);
    expect(p.gdIds).not.toContain(null);
    expect(p.gdIds).toHaveLength(2); // g1 e g3, sem a linha "Pacote:"
  });

  it("regravar o plano zera o preço fantasma: tudo vira incluso", () => {
    const p = planoDeProposta([linhaSemestral], itensLegado);
    const catalogo = [
      { id: "g1", nome: "Gestão de tráfego" },
      { id: "g3", nome: "Landing Page/site" },
    ];
    const pacotes = planoParaPacotes(p, "Vitallis", catalogo, [{ id: "v1", nome: "CRM Vexo" }]);
    // o escopo agora carrega os 3 serviços, nenhum com preço próprio
    expect(pacotes[0].produtos_incluidos.map((x) => x.product_id).sort()).toEqual(["g1", "g3", "v1"]);
    expect(pacotes[0].valor).toBe(36000);
  });

  it("preços do plano sobrevivem à absorção", () => {
    const p = planoDeProposta([linhaSemestral], itensLegado);
    expect(p.precos.semestral).toBe(6000);
    expect(prazosOfertados(p)).toEqual(["semestral"]);
  });
});

describe("integração com o cálculo da proposta", () => {
  it("a linha escolhida pelo cliente define a mensalidade e o compromisso", () => {
    const linhas = planoParaPacotes(planoDiogo(), "Dr. Diogo", gdProducts, vexoProducts).map((p, i) => ({
      ...p,
      id: `pk-${p.periodo}`,
      tipo: "gd",
    }));

    // cliente escolheu o anual
    const itens = [
      {
        product_id: null,
        descricao: "Pacote: Dr. Diogo · Anual (Recorrência)",
        categoria: "gd",
        valor: 2400,
        recorrencia: "mensal",
        meses: 12,
      },
      ...gdProducts.map((g) => ({ product_id: g.id, descricao: g.nome, categoria: "gd", valor: 0, recorrencia: "mensal" })),
    ];

    const calc = calculateProposalValues(
      { package_id: "pk-anual", periodo_plano: "anual", itens, cobrar_setup: true, valor_setup_vexo: 3000 },
      linhas
    );
    expect(calc.mensalidadeFinal).toBe(2400);
    expect(calc.mesesPeriodo).toBe(mesesDoPeriodo("anual"));
    expect(calc.compromissoFinal).toBe(28800);
    expect(calc.setupFinal).toBe(3000);
    expect(calc.totalGeral).toBe(31800);
  });
});
