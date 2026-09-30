/**
 * Kit de documentos por segmento e As Cinco Objeções da Implantação GD
 *
 * Mapeia kits com nomes concretos que o cliente tem em mãos e exemplos
 * visuais de objeções para destravar a reunião sem preencher previamente
 * dados fictícios no cliente.
 */

export type StatusDocumentoKit = "recebido" | "pendente" | "nao_tem";

export interface DocumentoKitItem {
  id: string;
  titulo: string;
  status: StatusDocumentoKit;
  observacao?: string;
}

export interface ParObjecao {
  id: number;
  objecao: string;
  resposta: string;
}

export interface KitItemDef {
  id: string;
  titulo: string;
}

export interface ExemploObjecaoDef {
  objecao: string;
  resposta: string;
}

export interface SegmentoKitDef {
  id: string;
  label: string;
  itens: KitItemDef[];
  objecoesExemplos: ExemploObjecaoDef[];
}

export const SEGMENTOS_KITS: Record<string, SegmentoKitDef> = {
  restaurantes_bares: {
    id: "restaurantes_bares",
    label: "Restaurantes e bares",
    itens: [
      { id: "cardapio_preco", titulo: "Cardápio com preço" },
      { id: "area_taxa_entrega", titulo: "Área e taxa de entrega" },
      { id: "horario_funcionamento", titulo: "Horário de funcionamento" },
      { id: "nao_tem_delivery", titulo: "O que não tem no delivery" },
    ],
    objecoesExemplos: [
      {
        objecao: "A taxa de entrega tá muito cara pro meu bairro.",
        resposta: "Explicamos que a entrega é expressa própria pra comida chegar quente e temos cupom na primeira compra.",
      },
      {
        objecao: "Demora muito tempo pra entregar no horário de pico?",
        resposta: "Passamos o tempo médio real do dia e avisamos que o pedido sai direto da cozinha com link de rastreio.",
      },
      {
        objecao: "Tem opção sem glúten / sem lactose / vegetariana?",
        resposta: "Listamos exatamente as opções dedicadas do cardápio e alertamos com clareza sobre contaminação cruzada.",
      },
      {
        objecao: "Queria pedir um prato do salão que não achei no cardápio de delivery.",
        resposta: "Explicamos se é prato exclusivo do salão por padrão de qualidade e sugerimos o similar mais pedido.",
      },
      {
        objecao: "Meu pedido veio errado ou faltando item da última vez.",
        resposta: "Pedimos desculpa imediata, pegamos o número do pedido anterior e resolvemos enviando o item ou cupom.",
      },
    ],
  },

  turismo: {
    id: "turismo",
    label: "Turismo",
    itens: [
      { id: "pacotes_preco_incluso", titulo: "Planilha de pacotes com preço e o que está incluso" },
      { id: "politica_cancelamento", titulo: "Política de cancelamento e remarcação" },
      { id: "formas_pagamento", titulo: "Formas de pagamento e parcelamento" },
    ],
    objecoesExemplos: [
      {
        objecao: "Achei o pacote caro em comparação com comprar separado na internet.",
        resposta: "Mostramos que o pacote inclui suporte 24h em português, traslado e guia, que avulsos saem mais caros no imprevisto.",
      },
      {
        objecao: "E se chover ou eu precisar remarcar de última hora por imprevisto?",
        resposta: "Explicamos a política de remarcação sem taxa com aviso prévio e as condições do seguro viagem.",
      },
      {
        objecao: "Consigo parcelar no boleto ou só no cartão de crédito?",
        resposta: "Informamos a quantidade de parcelas no boleto até a data do embarque e o limite em até 12x no cartão.",
      },
      {
        objecao: "Não conheço a agência de vocês, como sei que é seguro?",
        resposta: "Enviamos nosso CADASTUR, fotos reais dos grupos atendidos e link com depoimentos no Google Avaliações.",
      },
      {
        objecao: "Vou falar com minha família/amigos antes de fechar.",
        resposta: "Perguntamos qual a principal dúvida do grupo e oferecemos segurar a tarifa especial até o fim do dia.",
      },
    ],
  },

  contabilidade: {
    id: "contabilidade",
    label: "Contabilidade",
    itens: [
      { id: "honorarios_regime", titulo: "Tabela de honorários por regime" },
      { id: "docs_abertura", titulo: "Lista de documentos para abertura" },
      { id: "prazos_obrigacoes", titulo: "Prazos das obrigações que o cliente precisa cumprir" },
    ],
    objecoesExemplos: [
      {
        objecao: "A contabilidade online cobra bem mais barato por mês.",
        resposta: "Explicamos que temos contador dedicado por WhatsApp e ligação sem fila de ticket, além de planejamento tributário ativo.",
      },
      {
        objecao: "Tenho medo da transição dar confusão com o contador antigo.",
        resposta: "Cuidamos de 100% da transição: nós mesmos solicitamos os livros fiscais e acessos sem atrito.",
      },
      {
        objecao: "Abrir empresa demora muito e tem muita burocracia na prefeitura.",
        resposta: "Mostramos o passo a passo digital com prazo médio de 5 a 10 dias úteis sem o cliente sair de casa.",
      },
      {
        objecao: "Não sei se meu faturamento já compensa abrir CNPJ ou continuar como pessoa física.",
        resposta: "Fazemos o cálculo comparativo na hora mostrando quanto ele deixa de pagar de imposto no Simples Nacional.",
      },
      {
        objecao: "Vou ver com meu sócio e retorno depois.",
        resposta: "Perguntamos a previsão de faturamento para já mandar a proposta formal pronta para os dois analisarem.",
      },
    ],
  },

  comercio_local: {
    id: "comercio_local",
    label: "Comércio local",
    itens: [
      { id: "produtos_preco", titulo: "Lista de produtos com preço" },
      { id: "formas_pagamento", titulo: "Formas de pagamento" },
      { id: "politica_troca", titulo: "Política de troca" },
      { id: "horario_endereco", titulo: "Horário e endereço" },
    ],
    objecoesExemplos: [
      {
        objecao: "Na internet ou no concorrente grande achei mais barato.",
        resposta: "Ressaltamos pronta entrega hoje mesmo, teste na hora, garantia de balcão e sem esperar dias pelo frete.",
      },
      {
        objecao: "Se eu comprar e não servir ou não gostar, posso trocar facilmente?",
        resposta: "Explicamos a política de troca em até 7 dias com etiqueta e nota fiscal sem complicação.",
      },
      {
        objecao: "Vocês entregam ainda hoje no meu endereço?",
        resposta: "Confirmamos o motoboy expresso para pedidos fechados até determinado horário da tarde.",
      },
      {
        objecao: "Tem desconto à vista no Pix ou dinheiro?",
        resposta: "Passamos a condição especial à vista e informamos as faixas de parcelamento sem juros no cartão.",
      },
      {
        objecao: "Só estou dando uma olhadinha / pesquisando preços por enquanto.",
        resposta: "Agradecemos e perguntamos o que a pessoa precisa para indicar a melhor opção sem pressão.",
      },
    ],
  },

  prestadores_servico: {
    id: "prestadores_servico",
    label: "Prestadores de serviço",
    itens: [
      { id: "servicos_faixa_preco", titulo: "Tabela de serviços com faixa de preço" },
      { id: "incluso_vs_a_parte", titulo: "O que está incluso e o que é cobrado à parte" },
      { id: "prazo_medio", titulo: "Prazo médio" },
      { id: "area_atendimento", titulo: "Área de atendimento" },
    ],
    objecoesExemplos: [
      {
        objecao: "O orçamento ficou acima do que eu esperava investir.",
        resposta: "Detalhamos o escopo completo, materiais de primeira linha e garantia contratual que evitam retrabalho caro.",
      },
      {
        objecao: "Outro profissional me passou um valor mais em conta.",
        resposta: "Perguntamos se o outro inclui materiais, ART/laudo e pós-atendimento garantido como nós incluímos.",
      },
      {
        objecao: "Qual a garantia caso o serviço apresente defeito após a entrega?",
        resposta: "Apresentamos o termo de garantia formal e retorno prioritário sem custo caso ocorra qualquer problema.",
      },
      {
        objecao: "Preciso do serviço com muita urgência para amanhã.",
        resposta: "Consultamos a escala técnica e explicamos como funciona o encaixe prioritário ou taxa de urgência.",
      },
      {
        objecao: "Vocês atendem no meu bairro/cidade?",
        resposta: "Confirmamos o raio de deslocamento da equipe e se há taxa mínima de visita técnica.",
      },
    ],
  },

  clubes_permuta: {
    id: "clubes_permuta",
    label: "Clubes de permuta e redes de negócios",
    itens: [
      { id: "funcionamento_credito", titulo: "Como funciona o crédito" },
      { id: "o_que_pode_comprar", titulo: "O que pode e o que não pode ser comprado com ele" },
      { id: "mensalidade_adesao", titulo: "Tabela de mensalidade e adesão" },
      { id: "segmentos_rede", titulo: "Lista de segmentos disponíveis na rede" },
    ],
    objecoesExemplos: [
      {
        objecao: "Tenho receio de vender meu estoque/serviço e ficar com crédito parado sem uso.",
        resposta: "Mostramos a liquidez da rede com centenas de empresas ativas de suprimentos, marketing, saúde e viagens.",
      },
      {
        objecao: "A comissão sobre as transações é pesada para o meu negócio.",
        resposta: "Lembramos que a taxa só é paga sobre transações concretizadas, preservando o caixa em dinheiro da empresa.",
      },
      {
        objecao: "Minha empresa não tem capacidade ociosa para atender permuta.",
        resposta: "A permuta é planejada sob demanda para períodos de baixa ou estoque parado, sem afetar clientes em dinheiro.",
      },
      {
        objecao: "E se os parceiros da rede cobrarem mais caro em crédito do que em dinheiro?",
        resposta: "A regra de ouro da rede exige paridade rigorosa de tabela, com auditoria e exclusão em caso de sobrepreço.",
      },
      {
        objecao: "Preciso submeter a adesão para a aprovação dos outros sócios.",
        resposta: "Disponibilizamos um estudo de viabilidade com simulação de consumo nos fornecedores habituais deles.",
      },
    ],
  },

  generico: {
    id: "generico",
    label: "Outros segmentos (Kit genérico)",
    itens: [
      { id: "o_que_vende", titulo: "O que vende" },
      { id: "quanto_custa", titulo: "Quanto custa" },
      { id: "como_funciona", titulo: "Como funciona" },
      { id: "prazo", titulo: "Prazo" },
    ],
    objecoesExemplos: [
      {
        objecao: "Achei o valor alto / tá caro.",
        resposta: "Demonstramos o custo-benefício, o que está incluso no pacote e as facilidades de pagamento disponíveis.",
      },
      {
        objecao: "Vou pensar com calma e depois te chamo.",
        resposta: "Perguntamos gentilmente qual ponto específico gerou dúvida para que ele possa decidir com clareza.",
      },
      {
        objecao: "Preciso alinhar com meu sócio / equipe interna antes.",
        resposta: "Oferecemos preparar um resumo executivo dos pontos principais para facilitar o alinhamento com a equipe.",
      },
      {
        objecao: "Qual é o prazo exato de entrega ou início dos trabalhos?",
        resposta: "Apresentamos o cronograma passo a passo com datas e responsáveis bem definidos.",
      },
      {
        objecao: "Como posso ter certeza de que vai funcionar no meu caso?",
        resposta: "Compartilhamos casos de sucesso parecidos e garantias práticas de entrega do nosso processo.",
      },
    ],
  },
};

export const LISTA_SEGMENTOS = [
  { id: "restaurantes_bares", label: "Restaurantes e bares" },
  { id: "turismo", label: "Turismo" },
  { id: "contabilidade", label: "Contabilidade" },
  { id: "comercio_local", label: "Comércio local" },
  { id: "prestadores_servico", label: "Prestadores de serviço" },
  { id: "clubes_permuta", label: "Clubes de permuta e redes de negócios" },
  { id: "generico", label: "Outro segmento (Genérico)" },
];

export const DEFAULT_CINCO_OBJECOES: ParObjecao[] = [
  { id: 1, objecao: "", resposta: "" },
  { id: 2, objecao: "", resposta: "" },
  { id: 3, objecao: "", resposta: "" },
  { id: 4, objecao: "", resposta: "" },
  { id: 5, objecao: "", resposta: "" },
];

/**
 * Normaliza um segmento textual para a chave do kit correspondente.
 * Se o segmento for desconhecido ou vazio, cai no "generico".
 */
export function resolveSegmentoKey(segmento?: string): string {
  if (!segmento || typeof segmento !== "string") return "generico";
  const norm = segmento
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  if (norm === "restaurantes_bares" || norm.includes("restaurante") || norm.includes("bar") || norm.includes("bares") || norm.includes("gastronomia") || norm.includes("alimentacao") || norm.includes("lanchonete") || norm.includes("pizzaria")) {
    return "restaurantes_bares";
  }
  if (norm === "turismo" || norm.includes("turismo") || norm.includes("viagem") || norm.includes("viagens") || norm.includes("hotel") || norm.includes("pousada") || norm.includes("hospedagem")) {
    return "turismo";
  }
  if (norm === "contabilidade" || norm.includes("contabil") || norm.includes("fiscal") || norm.includes("contador") || norm.includes("escritorio contabil")) {
    return "contabilidade";
  }
  if (norm === "comercio_local" || norm.includes("comercio") || norm.includes("loja") || norm.includes("varejo") || norm.includes("roupa") || norm.includes("calcado")) {
    return "comercio_local";
  }
  if (norm === "prestadores_servico" || norm.includes("prestador") || norm.includes("servico") || norm.includes("servicos") || norm.includes("manutencao") || norm.includes("oficina") || norm.includes("consultoria") || norm.includes("clinica")) {
    return "prestadores_servico";
  }
  if (norm === "clubes_permuta" || norm.includes("permuta") || norm.includes("clube") || norm.includes("negocio") || norm.includes("rede de negocios")) {
    return "clubes_permuta";
  }
  return "generico";
}

/**
 * Retorna os itens do kit padrão para um segmento específico.
 */
export function getKitForSegmento(segmento?: string): DocumentoKitItem[] {
  const key = resolveSegmentoKey(segmento);
  const def = SEGMENTOS_KITS[key] || SEGMENTOS_KITS.generico;
  return def.itens.map((it) => ({
    id: it.id,
    titulo: it.titulo,
    status: "pendente",
    observacao: "",
  }));
}

/**
 * Alterna para um novo segmento preservando status/observações de itens que já existiam,
 * inicializando novos itens como 'pendente'.
 */
export function mergeKitWithSegmento(
  currentKit: DocumentoKitItem[] = [],
  novoSegmento?: string
): DocumentoKitItem[] {
  const key = resolveSegmentoKey(novoSegmento);
  const def = SEGMENTOS_KITS[key] || SEGMENTOS_KITS.generico;
  return def.itens.map((it) => {
    const existing = Array.isArray(currentKit) ? currentKit.find((k) => k?.id === it.id) : undefined;
    if (existing) {
      return {
        id: it.id,
        titulo: it.titulo,
        status: existing.status || "pendente",
        observacao: existing.observacao || "",
      };
    }
    return {
      id: it.id,
      titulo: it.titulo,
      status: "pendente",
      observacao: "",
    };
  });
}

/**
 * Garante que a lista de objeções sempre tenha 5 elementos (IDs de 1 a 5).
 */
export function normalizeObjecoes(objecoes?: any[]): ParObjecao[] {
  const result: ParObjecao[] = [];
  for (let i = 1; i <= 5; i++) {
    const existing = Array.isArray(objecoes)
      ? objecoes.find((o) => o?.id === i) || objecoes[i - 1]
      : null;
    result.push({
      id: i,
      objecao: typeof existing?.objecao === "string" ? existing.objecao : "",
      resposta: typeof existing?.resposta === "string" ? existing.resposta : "",
    });
  }
  return result;
}

/**
 * Retorna quantas das 5 objeções estão preenchidas (considera preenchida se tem objeção OU resposta).
 */
export function countFilledObjecoes(objecoes: ParObjecao[] = []): number {
  if (!Array.isArray(objecoes)) return 0;
  return objecoes.filter(
    (o) => (o?.objecao && o.objecao.trim().length > 0) || (o?.resposta && o.resposta.trim().length > 0)
  ).length;
}

/**
 * Retorna mensagem do que a quantidade preenchida destrava.
 */
export function getUnlockingText(count: number): string {
  switch (count) {
    case 1:
      return "com isso, o agente responde 'tá caro' do jeito que vocês respondem";
    case 2:
      return "com isso, o robô já diferencia objeções comuns e não encerra no primeiro recuo";
    case 3:
      return "com isso, o agente responde 'tá caro' e dúvidas comerciais do jeito que vocês respondem";
    case 4:
      return "com isso, o agente cobre quase todo o funil comercial com argumentos reais da sua equipe";
    case 5:
      return "cobertura completa! O robô tem o arsenal das 5 maiores objeções reais do seu negócio";
    default:
      return "preencha as objeções reais para o robô soar como a empresa e não recuar nas vendas";
  }
}
