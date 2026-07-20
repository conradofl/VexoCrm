// Motor puro da Mesa de Negociação (GD): camadas acumulativas de concessão.
// Regra do módulo: setup (entrada) e mensalidade NUNCA se somam — trilhas independentes.
// Ordem das camadas em cada trilha: isenção → condição de pagamento escolhida → desconto extra.

import {
  type PaymentTerm,
  type DescontoConcedido,
  computePaymentBreakdown,
  termAplicaA,
} from "./paymentTerms";

export type MeioPagamento = "" | "cartao" | "pix";

export const MEIO_PAGAMENTO_LABELS: Record<Exclude<MeioPagamento, "">, string> = {
  cartao: "Cartão",
  pix: "PIX",
};

export interface DescontoLivre {
  modo: "porcentagem" | "valor";
  valor: number;
}

export interface NegotiationLayers {
  isencaoSetup: boolean;
  condicaoSetupId: string | null;
  condicaoMensalidadeId: string | null;
  descontoSetup: DescontoLivre;
  descontoMensalidade: DescontoLivre;
  parcelas: number;
  // Multi-seleção de meios de pagamento por trilha (ex: ["cartao","pix"]).
  meioSetup: MeioPagamento[];
  meioMensalidade: MeioPagamento[];
  // Carência do 1º vencimento da mensalidade (dias). Não altera valores.
  carenciaDias: number | null;
}

export const EMPTY_LAYERS: NegotiationLayers = {
  isencaoSetup: false,
  condicaoSetupId: null,
  condicaoMensalidadeId: null,
  descontoSetup: { modo: "porcentagem", valor: 0 },
  descontoMensalidade: { modo: "porcentagem", valor: 0 },
  parcelas: 1,
  meioSetup: [],
  meioMensalidade: [],
  carenciaDias: null,
};

// Rótulo de uma lista de meios de pagamento (ex: "Cartão · PIX").
export const meiosLabel = (meios: MeioPagamento[]): string =>
  meios.filter((m): m is Exclude<MeioPagamento, ""> => !!m).map((m) => MEIO_PAGAMENTO_LABELS[m]).join(" · ");

export interface CamadaEfeito {
  label: string;
  antes: number;
  depois: number;
}

export interface NegotiationBases {
  setupItensTotal: number;
  setupVexoValue: number;
  recurringTotal: number;
  periodoPlano: string;
}

export interface NegotiationResult {
  entradaOriginal: number;
  entradaFinal: number;
  camadasSetup: CamadaEfeito[];
  mensalidadeOriginal: number;
  mensalidadeFinal: number;
  camadasMensalidade: CamadaEfeito[];
  valorParcela: number;
  totalConcedidoSetup: number;
  totalConcedidoMensalidade: number;
  descontos: DescontoConcedido[];
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function aplicaDescontoLivre(base: number, d: DescontoLivre): number {
  if (!d.valor || d.valor <= 0) return base;
  if (d.modo === "porcentagem") return base * (1 - Math.min(100, d.valor) / 100);
  return Math.max(0, base - d.valor);
}

function labelDescontoLivre(d: DescontoLivre, alvo: string): string {
  return d.modo === "porcentagem"
    ? `+${d.valor}% extra concedido na negociação (${alvo})`
    : `${brl(d.valor)} extra concedido na negociação (${alvo})`;
}

// Aplica a condição escolhida sobre a base da trilha; retorna a camada (mesmo
// quando o tipo não altera valor — ex: parcelado — para constar nas concessões).
function aplicaCondicao(
  base: number,
  term: PaymentTerm | undefined
): { camada: CamadaEfeito | null; depois: number } {
  if (!term) return { camada: null, depois: base };
  const b = computePaymentBreakdown(term, base);
  const depois = Number.isFinite(b.totalFinal) ? b.totalFinal : base;
  return {
    camada: { label: `${term.nome} — ${b.linhas.join(" · ")}`, antes: base, depois },
    depois,
  };
}

export function computeNegotiation(
  bases: NegotiationBases,
  layers: NegotiationLayers,
  terms: PaymentTerm[]
): NegotiationResult {
  const setupTerms = terms.filter((t) => termAplicaA(t) === "setup");
  const mensalTerms = terms.filter((t) => termAplicaA(t) === "mensalidade");

  // ---- Trilha da ENTRADA (setup) ----
  const entradaOriginal = bases.setupItensTotal + bases.setupVexoValue;
  const camadasSetup: CamadaEfeito[] = [];
  let entrada = entradaOriginal;

  if (layers.isencaoSetup && bases.setupVexoValue > 0) {
    const depois = bases.setupItensTotal;
    camadasSetup.push({
      label:
        bases.periodoPlano === "anual"
          ? "Isenção de setup — plano anual"
          : "Isenção de setup concedida na negociação",
      antes: entrada,
      depois,
    });
    entrada = depois;
  }

  const condSetup = setupTerms.find((t) => t.id === layers.condicaoSetupId);
  const condSetupRes = aplicaCondicao(entrada, condSetup);
  if (condSetupRes.camada) camadasSetup.push(condSetupRes.camada);
  entrada = condSetupRes.depois;

  const posDescSetup = aplicaDescontoLivre(entrada, layers.descontoSetup);
  if (posDescSetup < entrada) {
    camadasSetup.push({
      label: labelDescontoLivre(layers.descontoSetup, "entrada"),
      antes: entrada,
      depois: posDescSetup,
    });
    entrada = posDescSetup;
  }

  // ---- Trilha da MENSALIDADE ----
  const mensalidadeOriginal = bases.recurringTotal;
  const camadasMensalidade: CamadaEfeito[] = [];
  let mensal = mensalidadeOriginal;

  const condMensal = mensalTerms.find((t) => t.id === layers.condicaoMensalidadeId);
  const condMensalRes = aplicaCondicao(mensal, condMensal);
  if (condMensalRes.camada) camadasMensalidade.push(condMensalRes.camada);
  mensal = condMensalRes.depois;

  const posDescMensal = aplicaDescontoLivre(mensal, layers.descontoMensalidade);
  if (posDescMensal < mensal) {
    camadasMensalidade.push({
      label: labelDescontoLivre(layers.descontoMensalidade, "mensalidade"),
      antes: mensal,
      depois: posDescMensal,
    });
    mensal = posDescMensal;
  }

  const valorParcela = layers.parcelas > 1 ? entrada / layers.parcelas : entrada;

  // ---- Registro persistível (descontos_concedidos) ----
  const descontos: DescontoConcedido[] = [];
  camadasSetup.forEach((c) => {
    descontos.push({
      tipo: c.label.startsWith("Isenção") ? "isencao_setup" : condSetup && c.label.startsWith(condSetup.nome) ? "condicao_pagamento" : "desconto_avista",
      valor_original: c.antes,
      valor_final: c.depois,
      motivo: c.label,
      trilha: "setup",
    });
  });
  camadasMensalidade.forEach((c) => {
    descontos.push({
      tipo: condMensal && c.label.startsWith(condMensal.nome) ? "condicao_pagamento" : "desconto_mensalidade",
      valor_original: c.antes,
      valor_final: c.depois,
      motivo: c.label,
      trilha: "mensalidade",
    });
  });
  if (layers.carenciaDias && layers.carenciaDias > 0) {
    descontos.push({
      tipo: "carencia",
      valor_original: mensalidadeOriginal,
      valor_final: mensal,
      motivo: `Primeira mensalidade em ${layers.carenciaDias} dias (carência — sem alteração de valores)`,
      trilha: "mensalidade",
    });
  }
  if (layers.parcelas > 1) {
    descontos.push({
      tipo: "parcelamento",
      valor_original: entrada,
      valor_final: entrada,
      motivo: `Entrada dividida em ${layers.parcelas}x de ${brl(valorParcela)} (mensalidade à parte)`,
      trilha: "setup",
    });
  }

  return {
    entradaOriginal,
    entradaFinal: entrada,
    camadasSetup,
    mensalidadeOriginal,
    mensalidadeFinal: mensal,
    camadasMensalidade,
    valorParcela,
    totalConcedidoSetup: entradaOriginal - entrada,
    totalConcedidoMensalidade: mensalidadeOriginal - mensal,
    descontos,
  };
}
