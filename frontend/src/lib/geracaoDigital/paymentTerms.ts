// Tipos e cálculo do desdobramento das condições de pagamento do módulo GD.
// Usado na aba interna de Propostas, no gerenciador de condições e na proposta pública.

export type PaymentTermTipo =
  | "avista_desconto"
  | "entrada_parcelas"
  | "parcelado_cartao"
  | "cartao_recorrente"
  | "semanal"
  | "custom";

export interface PaymentTermConfig {
  percentual_desconto?: number;
  valor_entrada?: number;
  num_parcelas?: number;
  intervalo?: "semanal" | "mensal";
  meio?: "cartao" | "pix";
  descricao?: string;
}

export type PaymentTermAplicaA = "setup" | "mensalidade";

export interface PaymentTerm {
  id: string;
  nome: string;
  tipo: PaymentTermTipo;
  config: PaymentTermConfig;
  ativo: boolean;
  // A quê a condição se aplica: entrada/setup ou mensalidade recorrente.
  // Condições antigas (sem o campo) contam como 'setup'.
  aplica_a?: PaymentTermAplicaA;
  created_at?: string;
}

export const APLICA_A_LABELS: Record<PaymentTermAplicaA, string> = {
  setup: "Setup / Entrada",
  mensalidade: "Mensalidade",
};

export function termAplicaA(term: Pick<PaymentTerm, "aplica_a">): PaymentTermAplicaA {
  return term.aplica_a === "mensalidade" ? "mensalidade" : "setup";
}

// Planos de recorrência mensal no cartão (compromisso de período).
export const CARTAO_RECORRENTE_PLANOS: { value: number; label: string }[] = [
  { value: 3, label: "3 meses" },
  { value: 6, label: "6 meses" },
  { value: 12, label: "Anual (12 meses)" },
];

export const PAYMENT_TERM_TIPOS: { value: PaymentTermTipo; label: string }[] = [
  { value: "avista_desconto", label: "À vista com desconto" },
  { value: "entrada_parcelas", label: "Entrada + parcelas" },
  { value: "parcelado_cartao", label: "Parcelado no cartão" },
  { value: "cartao_recorrente", label: "Recorrência mensal no cartão" },
  { value: "semanal", label: "Parcelas semanais" },
  { value: "custom", label: "Personalizada (texto livre)" },
];

export const MEIO_LABELS: Record<string, string> = {
  cartao: "cartão",
  pix: "PIX",
};

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface PaymentBreakdown {
  linhas: string[];
  totalFinal: number;
}

// Calcula o desdobramento de uma condição sobre o total da proposta
// (pacote GD + módulos Vexo + setup Vexo quando cobrado).
export function computePaymentBreakdown(
  term: Pick<PaymentTerm, "tipo" | "config">,
  total: number
): PaymentBreakdown {
  const cfg = term.config || {};
  const base = Number(total || 0);

  switch (term.tipo) {
    case "avista_desconto": {
      const p = Number(cfg.percentual_desconto || 0);
      const final = base * (1 - p / 100);
      return {
        linhas: [
          `À vista${cfg.meio ? ` no ${MEIO_LABELS[cfg.meio] || cfg.meio}` : ""}: ${brl(base)} com ${p}% off = ${brl(final)}`,
        ],
        totalFinal: final,
      };
    }
    case "entrada_parcelas": {
      const entrada = Number(cfg.valor_entrada || 0);
      const n = Math.max(1, Number(cfg.num_parcelas || 1));
      const parcela = Math.max(0, base - entrada) / n;
      return {
        linhas: [
          `Entrada de ${brl(entrada)} + ${n}x de ${brl(parcela)}${cfg.meio ? ` no ${MEIO_LABELS[cfg.meio] || cfg.meio}` : ""}`,
        ],
        totalFinal: base,
      };
    }
    case "parcelado_cartao": {
      const n = Math.max(1, Number(cfg.num_parcelas || 1));
      return {
        linhas: [`${n}x de ${brl(base / n)} no cartão`],
        totalFinal: base,
      };
    }
    case "cartao_recorrente": {
      const n = Math.max(1, Number(cfg.num_parcelas || 1));
      return {
        linhas: [`Recorrência mensal no cartão · plano de ${n} meses · ${n}x de ${brl(base / n)}`],
        totalFinal: base,
      };
    }
    case "semanal": {
      const n = Math.max(1, Number(cfg.num_parcelas || 1));
      return {
        linhas: [`${n} parcelas semanais de ${brl(base / n)}`],
        totalFinal: base,
      };
    }
    case "custom":
    default:
      return {
        linhas: [cfg.descricao || "Condição personalizada"],
        totalFinal: base,
      };
  }
}

// Descrição SIMBÓLICA da condição, sem valores fictícios (não divide um total
// de exemplo). Mostra só a estrutura configurada; os valores em R$ são
// calculados ao vivo sobre o total real da proposta.
export function describeTerm(term: Pick<PaymentTerm, "tipo" | "config">): string {
  const cfg = term.config || {};
  const meio = cfg.meio ? ` no ${MEIO_LABELS[cfg.meio] || cfg.meio}` : "";
  switch (term.tipo) {
    case "avista_desconto":
      return `À vista${meio}${cfg.percentual_desconto ? ` com ${cfg.percentual_desconto}% de desconto` : ""}`;
    case "entrada_parcelas": {
      const n = Math.max(1, Number(cfg.num_parcelas || 1));
      const entrada = Number(cfg.valor_entrada || 0);
      return `Entrada${entrada > 0 ? ` de ${brl(entrada)}` : ""} + ${n}x${meio}`;
    }
    case "parcelado_cartao":
      return `${Math.max(1, Number(cfg.num_parcelas || 1))}x no cartão`;
    case "cartao_recorrente":
      return `Recorrência mensal no cartão · plano de ${Math.max(1, Number(cfg.num_parcelas || 1))} meses`;
    case "semanal":
      return `${Math.max(1, Number(cfg.num_parcelas || 1))} parcelas semanais`;
    case "custom":
    default:
      return cfg.descricao || "Condição personalizada";
  }
}

// Estrutura persistida em gd_proposals.condicoes_pagamento
export interface ProposalPaymentTerms {
  ofertadas: PaymentTerm[];
  escolhida?: PaymentTerm | null;
}

// Concessão registrada na mesa de negociação
export interface DescontoConcedido {
  tipo: "isencao_setup" | "desconto_avista" | "parcelamento" | "condicao_pagamento" | "desconto_mensalidade" | "carencia";
  valor_original: number;
  valor_final: number;
  motivo?: string;
  // Trilha da concessão (entrada/setup ou mensalidade). Ausente em registros antigos = setup.
  trilha?: "setup" | "mensalidade";
}

export const DESCONTO_LABELS: Record<DescontoConcedido["tipo"], string> = {
  isencao_setup: "Isenção de setup",
  desconto_avista: "Desconto à vista",
  parcelamento: "Parcelamento da entrada",
  condicao_pagamento: "Condição de pagamento aplicada",
  desconto_mensalidade: "Desconto na mensalidade",
  carencia: "Carência do primeiro vencimento",
};

export const SETUP_LABEL = "Setup / Implantação Vexo OS";

export const SETUP_JUSTIFICATION = `O investimento único de implantação cobre tudo o que é necessário para colocar sua operação no ar com segurança e sem improviso:

- Configuração e personalização do sistema para o seu negócio (fluxos, integrações e ajustes iniciais)
- Migração e organização dos seus dados e contatos para dentro da plataforma
- Treinamento da sua equipe, presencial ou remoto, até o time operar com autonomia
- Deslocamento e horas técnicas da nossa equipe dedicadas exclusivamente à sua instalação
- Ferramentas, licenças e recursos utilizados na configuração inicial
- Acompanhamento assistido nos primeiros dias de uso (go-live), garantindo adoção real e não só entrega

É um valor pago uma única vez, que transforma a contratação em operação funcionando — não em mais um sistema que você teve que descobrir sozinho.`;
