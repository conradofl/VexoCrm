// Tipos e cálculo do desdobramento das condições de pagamento do módulo GD.
// Usado na aba interna de Propostas, no gerenciador de condições e na proposta pública.

export type PaymentTermTipo =
  | "avista_desconto"
  | "entrada_parcelas"
  | "parcelado_cartao"
  | "boleto_recorrente"
  | "semanal"
  | "custom";

export interface PaymentTermConfig {
  percentual_desconto?: number;
  valor_entrada?: number;
  num_parcelas?: number;
  intervalo?: "semanal" | "mensal";
  meio?: "cartao" | "boleto" | "pix";
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

export const PAYMENT_TERM_TIPOS: { value: PaymentTermTipo; label: string }[] = [
  { value: "avista_desconto", label: "À vista com desconto" },
  { value: "entrada_parcelas", label: "Entrada + parcelas" },
  { value: "parcelado_cartao", label: "Parcelado no cartão" },
  { value: "boleto_recorrente", label: "Boleto recorrente" },
  { value: "semanal", label: "Parcelas semanais" },
  { value: "custom", label: "Personalizada (texto livre)" },
];

export const MEIO_LABELS: Record<string, string> = {
  cartao: "cartão",
  boleto: "boleto",
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
    case "boleto_recorrente": {
      const n = Math.max(1, Number(cfg.num_parcelas || 1));
      return {
        linhas: [`${n} boletos mensais de ${brl(base / n)}`],
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

// Estrutura persistida em gd_proposals.condicoes_pagamento
export interface ProposalPaymentTerms {
  ofertadas: PaymentTerm[];
  escolhida?: PaymentTerm | null;
}

// Concessão registrada na mesa de negociação
export interface DescontoConcedido {
  tipo: "isencao_setup" | "desconto_avista" | "parcelamento" | "condicao_pagamento" | "desconto_mensalidade";
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
