import type { PaymentTerm, PaymentTermAplicaA } from "./paymentTerms";

// ---------------------------------------------------------------------------
// FORMAS DE PAGAMENTO — fixas do negócio, não registros que alguém cadastra.
//
// A biblioteca `gd_payment_terms` repetia o erro da biblioteca de pacotes:
// obrigava inventar e nomear uma condição por proposta, e por isso vivia vazia
// ("Nenhuma condição salva"). As formas abaixo são as que a Vexo aceita, ponto.
// O vendedor só marca quais ofertar e ajusta o número de parcelas.
//
// Elas são convertidas em objetos `PaymentTerm` na gravação, então a proposta
// pública, a escolha do cliente e o aceite continuam funcionando sem alteração
// — e sem migração de banco (tudo vive no jsonb `condicoes_pagamento`).
// ---------------------------------------------------------------------------

export type FormaSetupId = "pix_avista" | "entrada_pix_30d" | "cartao_parcelado";
export type FormaMensalId =
  | "cartao_recorrente"
  | "boleto_recorrente"
  | "pix_recorrente"
  | "cartao_parcelado_periodo"
  | "pix_avista_projeto";
export type FormaId = FormaSetupId | FormaMensalId;

export interface FormaDef {
  id: FormaId;
  label: string;
  aplica_a: PaymentTermAplicaA;
  /** Tem stepper de parcelas. */
  parcelavel: boolean;
}

export const FORMAS_SETUP: FormaDef[] = [
  { id: "pix_avista", label: "Pix à vista", aplica_a: "setup", parcelavel: false },
  { id: "entrada_pix_30d", label: "Entrada no Pix + 30 dias no Pix", aplica_a: "setup", parcelavel: false },
  { id: "cartao_parcelado", label: "Parcelado no Cartão em até 3x", aplica_a: "setup", parcelavel: true },
];

export const FORMAS_MENSALIDADE: FormaDef[] = [
  { id: "cartao_recorrente", label: "Cartão Recorrente (Sem comprometer limite)", aplica_a: "mensalidade", parcelavel: false },
  { id: "boleto_recorrente", label: "Boleto Bancário Recorrente (Exclusivo PJ)", aplica_a: "mensalidade", parcelavel: false },
  { id: "pix_recorrente", label: "Pix Recorrente", aplica_a: "mensalidade", parcelavel: false },
  { id: "cartao_parcelado_periodo", label: "Parcelado no Cartão", aplica_a: "mensalidade", parcelavel: true },
  { id: "pix_avista_projeto", label: "Pix à Vista (Pagamento Único / Projeto Pontual)", aplica_a: "mensalidade", parcelavel: false },
];

export const TODAS_FORMAS: FormaDef[] = [...FORMAS_SETUP, ...FORMAS_MENSALIDADE];

export const MAX_PARCELAS = 24;

export interface FormasSelecionadas {
  marcadas: FormaId[];
  /** Parcelas por forma parcelável. */
  parcelas: Partial<Record<FormaId, number>>;
}

export const formasVazias = (): FormasSelecionadas => ({ marcadas: [], parcelas: {} });

export function defaultParcelasPorPeriodo(periodoOuMeses?: string | number | null): number {
  if (typeof periodoOuMeses === "number") {
    return periodoOuMeses >= 1 ? Math.min(MAX_PARCELAS, Math.round(periodoOuMeses)) : 1;
  }
  if (typeof periodoOuMeses === "string") {
    const p = periodoOuMeses.trim().toLowerCase();
    if (p === "trimestral") return 3;
    if (p === "semestral") return 6;
    if (p === "anual") return 12;
    if (p === "mensal") return 1;
    const num = Number(p);
    if (!isNaN(num) && num >= 1) {
      return Math.min(MAX_PARCELAS, Math.round(num));
    }
  }
  return 1;
}

export function parcelasDe(
  formas: FormasSelecionadas,
  id: FormaId,
  periodoOuMeses?: string | number | null
): number {
  const n = Number(formas.parcelas?.[id] || 0);
  if (n >= 1) return Math.min(n, MAX_PARCELAS);
  if (id === "cartao_parcelado_periodo") return defaultParcelasPorPeriodo(periodoOuMeses);
  return id === "cartao_parcelado" ? 3 : 1;
}

/** Clamp do stepper: nunca 0, nunca acima do teto. */
export function ajustarParcelas(
  formas: FormasSelecionadas,
  id: FormaId,
  delta: number,
  periodoOuMeses?: string | number | null
): FormasSelecionadas {
  const atual = parcelasDe(formas, id, periodoOuMeses);
  const proximo = Math.max(1, Math.min(MAX_PARCELAS, atual + delta));
  return { ...formas, parcelas: { ...formas.parcelas, [id]: proximo } };
}

export function alternarForma(formas: FormasSelecionadas, id: FormaId): FormasSelecionadas {
  const on = formas.marcadas.includes(id);
  return {
    ...formas,
    marcadas: on ? formas.marcadas.filter((x) => x !== id) : [...formas.marcadas, id],
  };
}

/** Nome exibido, já com as parcelas quando houver. */
export function nomeDaForma(
  formas: FormasSelecionadas,
  def: FormaDef,
  periodoOuMeses?: string | number | null
): string {
  if (!def.parcelavel) return def.label;
  const n = parcelasDe(formas, def.id, periodoOuMeses);
  if (def.id === "cartao_parcelado_periodo") {
    return n === 1 ? "Parcelado no Cartão em 1x" : `Parcelado no Cartão em até ${n}x`;
  }
  return `${def.label} em ${n}x`;
}

/**
 * Converte para `PaymentTerm[]`, o formato que `condicoes_pagamento.ofertadas`
 * já usa. Ids são estáveis (o próprio id da forma) para que a escolha do
 * cliente sobreviva a uma reedição da proposta.
 */
export function formasParaTerms(
  formas: FormasSelecionadas,
  periodoOuMeses?: string | number | null
): PaymentTerm[] {
  return TODAS_FORMAS.filter((def) => formas.marcadas.includes(def.id)).map((def) => {
    const n = parcelasDe(formas, def.id, periodoOuMeses);
    const base = { id: def.id, nome: nomeDaForma(formas, def, periodoOuMeses), ativo: true, aplica_a: def.aplica_a };

    switch (def.id) {
      case "pix_avista":
        return { ...base, tipo: "custom", config: { meio: "pix", descricao: "Pix à vista" } };
      case "entrada_pix_30d":
        return { ...base, tipo: "custom", config: { meio: "pix", descricao: "Entrada no Pix + 30 dias no Pix" } };
      case "cartao_parcelado":
        return { ...base, tipo: "parcelado_cartao", config: { meio: "cartao", num_parcelas: n } };
      case "cartao_parcelado_periodo":
        return { ...base, tipo: "parcelado_cartao", config: { meio: "cartao", num_parcelas: n } };
      case "cartao_recorrente":
        return { ...base, tipo: "custom", config: { meio: "cartao", descricao: "Cartão Recorrente (Sem comprometer limite)" } };
      case "boleto_recorrente":
        return { ...base, tipo: "custom", config: { meio: "boleto", descricao: "Boleto Bancário Recorrente (Exclusivo PJ)" } };
      case "pix_recorrente":
        return { ...base, tipo: "custom", config: { meio: "pix", descricao: "Pix Recorrente" } };
      case "pix_avista_projeto":
        return { ...base, tipo: "custom", config: { meio: "pix", descricao: "Pix à Vista (Pagamento Único / Projeto Pontual)" } };
    }
  }) as PaymentTerm[];
}

/** Reconstrói o estado do editor a partir do que está gravado na proposta. */
export function termsParaFormas(terms: any[]): FormasSelecionadas {
  const formas = formasVazias();
  (terms || []).forEach((t) => {
    const def = TODAS_FORMAS.find((d) => d.id === t?.id);
    if (!def) return; // condição legada da biblioteca antiga: ignorada aqui
    formas.marcadas.push(def.id);
    const n = Number(t?.config?.num_parcelas || 0);
    if (def.parcelavel && n >= 1) formas.parcelas[def.id] = n;
  });
  return formas;
}

/** Condições legadas (criadas na biblioteca) que não são formas fixas. */
export function termsLegados(terms: any[]): any[] {
  return (terms || []).filter((t) => !TODAS_FORMAS.some((d) => d.id === t?.id));
}
