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

export type FormaSetupId = "pix_avista" | "cartao_avista" | "cartao_parcelado";
export type FormaMensalId = "pix_recorrente" | "cartao_recorrente" | "cartao_total_parcelado";
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
  { id: "cartao_avista", label: "Cartão à vista", aplica_a: "setup", parcelavel: false },
  { id: "cartao_parcelado", label: "Cartão parcelado", aplica_a: "setup", parcelavel: true },
];

export const FORMAS_MENSALIDADE: FormaDef[] = [
  { id: "pix_recorrente", label: "Pix recorrente", aplica_a: "mensalidade", parcelavel: false },
  { id: "cartao_recorrente", label: "Cartão recorrente", aplica_a: "mensalidade", parcelavel: false },
  {
    id: "cartao_total_parcelado",
    label: "Parcelar o total do período no cartão",
    aplica_a: "mensalidade",
    parcelavel: true,
  },
];

export const TODAS_FORMAS: FormaDef[] = [...FORMAS_SETUP, ...FORMAS_MENSALIDADE];

export const MAX_PARCELAS = 24;

export interface FormasSelecionadas {
  marcadas: FormaId[];
  /** Parcelas por forma parcelável. */
  parcelas: Partial<Record<FormaId, number>>;
}

export const formasVazias = (): FormasSelecionadas => ({ marcadas: [], parcelas: {} });

export function parcelasDe(formas: FormasSelecionadas, id: FormaId): number {
  const n = Number(formas.parcelas?.[id] || 0);
  if (n >= 1) return Math.min(n, MAX_PARCELAS);
  return id === "cartao_total_parcelado" ? 12 : 3;
}

/** Clamp do stepper: nunca 0, nunca acima do teto. */
export function ajustarParcelas(
  formas: FormasSelecionadas,
  id: FormaId,
  delta: number
): FormasSelecionadas {
  const atual = parcelasDe(formas, id);
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
export function nomeDaForma(formas: FormasSelecionadas, def: FormaDef): string {
  if (!def.parcelavel) return def.label;
  return `${def.label} em ${parcelasDe(formas, def.id)}x`;
}

/**
 * Converte para `PaymentTerm[]`, o formato que `condicoes_pagamento.ofertadas`
 * já usa. Ids são estáveis (o próprio id da forma) para que a escolha do
 * cliente sobreviva a uma reedição da proposta.
 */
export function formasParaTerms(formas: FormasSelecionadas): PaymentTerm[] {
  return TODAS_FORMAS.filter((def) => formas.marcadas.includes(def.id)).map((def) => {
    const n = parcelasDe(formas, def.id);
    const base = { id: def.id, nome: nomeDaForma(formas, def), ativo: true, aplica_a: def.aplica_a };

    switch (def.id) {
      case "pix_avista":
        return { ...base, tipo: "avista_desconto", config: { meio: "pix", percentual_desconto: 0 } };
      case "cartao_avista":
        return { ...base, tipo: "avista_desconto", config: { meio: "cartao", percentual_desconto: 0 } };
      case "cartao_parcelado":
        return { ...base, tipo: "parcelado_cartao", config: { meio: "cartao", num_parcelas: n } };
      case "pix_recorrente":
        return { ...base, tipo: "custom", config: { meio: "pix", descricao: "Pix recorrente todo mês" } };
      case "cartao_recorrente":
        return { ...base, tipo: "custom", config: { meio: "cartao", descricao: "Cartão de crédito recorrente todo mês" } };
      case "cartao_total_parcelado":
        return { ...base, tipo: "parcelado_cartao", config: { meio: "cartao", num_parcelas: n } };
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
