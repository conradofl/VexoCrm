/**
 * Perguntas sugeridas e simulação da conclusão do briefing de implantação GD
 *
 * Três perguntas sugeridas não aleatórias:
 * 1. Básico do negócio (preço, prazo ou horário, do kit do segmento)
 * 2. Uma das 5 objeções preenchidas pelo cliente (com palavras reais do cliente)
 * 3. Pergunta fora da base ("esta é para você ver o que acontece quando ele não sabe")
 */

export interface PerguntaSugerida {
  id: "pergunta_1_segmento" | "pergunta_2_objecao" | "pergunta_3_fora_da_base";
  tituloBadge: string;
  pergunta: string;
  explicacao?: string;
  isForaDaBase: boolean;
  tipo: "segmento" | "objecao" | "fora_da_base";
}

export interface PerguntaKitDef {
  pergunta1: string;
  pergunta2Padrao: string;
  pergunta3ForaDaBase: string;
}

export const PERGUNTAS_KIT_SEGMENTO: Record<string, PerguntaKitDef> = {
  restaurantes_bares: {
    pergunta1: "Qual é o horário de funcionamento de vocês e quanto custa a taxa de entrega?",
    pergunta2Padrao: "A taxa de entrega tá muito cara pro meu bairro, tem cupom?",
    pergunta3ForaDaBase: "Vocês organizam jantar de casamento fechado para 180 convidados com bufê japonês exclusivo na próxima quinta-feira?",
  },
  turismo: {
    pergunta1: "Quais são os pacotes disponíveis para o próximo feriado e quanto custa em média?",
    pergunta2Padrao: "Achei o pacote caro em comparação com comprar separado na internet.",
    pergunta3ForaDaBase: "Vocês emitem visto de trabalho para nômade digital na Tailândia com assessoria consular presencial em Bangkok?",
  },
  contabilidade: {
    pergunta1: "Quanto custa a mensalidade para abertura de empresa e qual o prazo médio?",
    pergunta2Padrao: "A contabilidade online cobra bem mais barato por mês.",
    pergunta3ForaDaBase: "Vocês fazem estruturação de holding internacional com offshore nas Bahamas e blindagem sucessória via trust?",
  },
  comercio_local: {
    pergunta1: "Qual o horário de funcionamento da loja e vocês entregam no meu endereço hoje?",
    pergunta2Padrao: "Na internet ou no concorrente grande achei mais barato.",
    pergunta3ForaDaBase: "Vocês importam peça sobressalente da Alemanha para máquina industrial antiga com desembaraço aduaneiro próprio?",
  },
  prestadores_servico: {
    pergunta1: "Qual é o prazo médio de atendimento e qual a faixa de preço da visita técnica?",
    pergunta2Padrao: "O orçamento ficou acima do que eu esperava investir.",
    pergunta3ForaDaBase: "Vocês emitem laudo pericial judicial com assinatura de engenheiro aeroespacial credenciado na ANAC até amanhã?",
  },
  clubes_permuta: {
    pergunta1: "Como funciona o crédito de permuta e qual a taxa de adesão para entrar na rede?",
    pergunta2Padrao: "Tenho receio de vender meu estoque/serviço e ficar com crédito parado sem uso.",
    pergunta3ForaDaBase: "Consigo liquidar meu saldo de permuta comprando ações de empresa de tecnologia listada na Bolsa de Nova York?",
  },
  generico: {
    pergunta1: "Quais são os principais serviços ou produtos que vocês oferecem e qual a faixa de preço?",
    pergunta2Padrao: "Achei o valor alto / tá caro, tem como negociar condição?",
    pergunta3ForaDaBase: "Vocês atendem solicitação emergencial de licitação internacional com certificação ISO 9001 e ISO 27001 até amanhã cedo?",
  },
};

export const EXPLICACAO_FORA_DA_BASE = "esta é para você ver o que acontece quando ele não sabe";

export interface GerarTresPerguntasParams {
  segmento?: string;
  cincoObjecoes?: Array<{ id?: number | string; objecao?: string; resposta?: string; [key: string]: unknown }>;
}

/**
 * Gera as três perguntas sugeridas para a simulação de conclusão:
 * - 1: Básico do segmento
 * - 2: Primeira objeção preenchida pelo cliente (ou fallback do segmento se nenhuma foi preenchida)
 * - 3: Pergunta fora da base com badge e explicação explícita
 */
export function gerarTresPerguntasSugeridas(params: GerarTresPerguntasParams): PerguntaSugerida[] {
  const segKey = String(params.segmento || "").trim().toLowerCase();
  const kit = PERGUNTAS_KIT_SEGMENTO[segKey] || PERGUNTAS_KIT_SEGMENTO.generico;

  // Encontra a primeira objeção real que o cliente escreveu
  const objecoes = Array.isArray(params.cincoObjecoes) ? params.cincoObjecoes : [];
  const objecaoCliente = objecoes
    .map(o => String(o?.objecao || "").trim())
    .find(texto => texto.length > 0);

  const p1Texto = kit.pergunta1;
  const p2Texto = objecaoCliente || kit.pergunta2Padrao;
  const p3Texto = kit.pergunta3ForaDaBase;

  return [
    {
      id: "pergunta_1_segmento",
      tituloBadge: "1. Básico do Negócio",
      pergunta: p1Texto,
      explicacao: "Previsível do negócio (preço, prazo ou horário) para mostrar que o robô sabe o básico.",
      isForaDaBase: false,
      tipo: "segmento",
    },
    {
      id: "pergunta_2_objecao",
      tituloBadge: objecaoCliente ? "2. Objeção do Cliente" : "2. Objeção Típica",
      pergunta: p2Texto,
      explicacao: objecaoCliente
        ? "Uma das objeções que o cliente acabou de escrever — para mostrar a resposta com as palavras dele."
        : "Objeção padrão do segmento (o cliente não preencheu objeção manual).",
      isForaDaBase: false,
      tipo: "objecao",
    },
    {
      id: "pergunta_3_fora_da_base",
      tituloBadge: "Fora da base",
      pergunta: p3Texto,
      explicacao: EXPLICACAO_FORA_DA_BASE,
      isForaDaBase: true,
      tipo: "fora_da_base",
    },
  ];
}
