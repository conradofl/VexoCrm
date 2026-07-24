// Motor de conteúdo da Apresentação Comercial High-Ticket (SPIN Selling).
//
// Separação de preocupações: este arquivo carrega SÓ os dados/roteiro. O
// componente visual (PresentationViewer.tsx) é genérico e recebe tudo via props.
//
// Isolamento: nada aqui toca preços, pacotes ou venda casada (ProposalConfig).
// É estritamente o roteiro visual da apresentação.
//
// Regra de copy — ANTI-JARGÃO. Proibido: SDR, Tráfego Pago, N8N, Typebot,
// Evolution API, Funil, Leads, Automação. Traduções aplicadas no roteiro:
//   SDR / IA        -> "Recepcionista Digital 24h" / "Atendimento Imediato"
//   Tráfego Pago    -> "Sistema de Atração de Clientes"
//   Automação       -> "Operação no Piloto Automático"

export type SlideKind =
  | "impact"
  | "pain"
  | "implication"
  | "solution"
  | "partnership"
  | "vision"
  | "close";

export interface PitchFront {
  label: string;        // nome da frente (ex: "Geração Digital")
  tag: string;          // papel curto (ex: "Atração & Marca")
  items: string[];      // entregáveis em linguagem anti-jargão
}

export interface PitchSlide {
  id: number;
  kind: SlideKind;
  eyebrow: string;      // rótulo curto (ex: "A DOR ATUAL")
  title: string;
  subtitle?: string;
  body?: string;
  steps?: string[];     // passos numerados (usado no slide de solução)
  fronts?: PitchFront[]; // colunas da parceria (GD + Vexo)
  compare?: {           // antes/depois visual (impacto: loja vazia -> cheia)
    before: { img?: string; label: string };
    after: { img?: string; label: string };
  };
  metric?: {            // destaque numérico (ROI / benchmark)
    value: string;
    caption: string;
  };
  punch?: string;       // frase de efeito / gatilho mental (slide de fechamento)
}

export interface SegmentGroup {
  id: string;
  label: string;
  focus: string;        // resumo do foco comercial do grupo
  accent: string;       // cor de destaque (hex) do tema do grupo
  buildSlides: (ctx: PitchContext) => PitchSlide[];
}

export interface PitchContext {
  companyName: string;
  segmentId?: string | null;
}

// ---------------------------------------------------------------------------
// Utilitários de estimativa (ROI automático por benchmark de mercado)
// ---------------------------------------------------------------------------

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const milhar = (v: number) =>
  `R$ ${Math.round(v / 1000).toLocaleString("pt-BR")} mil`;

// Benchmarks de mercado — usados quando o cliente não traz os próprios números.
// Conservadores de propósito: melhor subestimar a dor do que soar irreal.
export const BENCHMARKS = {
  entretenimento_local: {
    // Ocupação real da casa no ponto ATUAL.
    ocupacaoDiaFracoAtual: "50%",      // quinta e domingo
    ocupacaoFimDeSemanaAtual: "80 a 100%", // sexta e sábado
    // Mesmo público num ponto com 3x a capacidade: a ocupação se dilui.
    multiplicadorNovoPonto: 3,
    ocupacaoDiaFracoNovo: "15% a 20%",
    ocupacaoFimDeSemanaNovo: "25% a 33%",
  },
  saude_estetica: {
    horariosVagosDia: 4,       // janelas ociosas por dia na agenda
    ticketMedioProcedimento: 250,
    diasUteisMes: 22,
    mesesAno: 12,
  },
  otica: {
    // Vazamento 1 — orçamentos que saem pela porta e ninguém retoma.
    orcamentosSemFollowupMes: 30,   // orçamentos/mês sem nenhum retorno
    ticketMedio: 650,               // armação + lente (conservador)
    taxaResgateOrcamento: 0.2,      // 20% recuperável com follow-up ativo
    // Vazamento 2 — recompra dormida (troca de lente/grau a cada ~18 meses).
    clientesNoCicloMes: 25,         // clientes/mês que batem o ciclo e não voltam
    ticketRecompra: 650,
    taxaResgateRecompra: 0.15,      // 15% recuperável com lembrete de troca
    cicloMeses: 18,
  },
  suplementos: {
    // Vazamento 1 — recompra dormida. É o ciclo mais curto de todos os
    // segmentos atendidos: o pote acaba em ~45 dias e o cliente decide de novo.
    // Se ninguém lembra, ele compra no marketplace ou simplesmente para.
    clientesNoCicloMes: 80,          // clientes/mês que fecham o ciclo e não voltam
    ticketMedio: 180,                // pote + complemento (conservador)
    taxaResgateRecompra: 0.18,       // 18% recuperável com lembrete na hora certa
    cicloDias: 45,
    // Vazamento 2 — consulta no WhatsApp que morre sem resposta rápida.
    consultasSemFechamentoMes: 50,
    taxaResgateConsulta: 0.2,        // 20% recuperável com resposta imediata
  },
  fotografia: {
    // Vazamento 1 — base fria parada. A fotógrafa tem contatos que já a
    // conhecem e nunca mais foram trabalhados. Foco corporativo (menos
    // dependência de data, mais recorrência que casamento).
    baseParada: 4000,
    ticketEnsaio: 800,               // ensaio/retrato corporativo (conservador)
    taxaReativacaoMes: 0.008,        // 0,8% da base responde e reagenda/mês
    taxaFechaReativacao: 0.25,
    // Vazamento 2 — lead novo que chega (Meta/Google) e não é agendado na hora.
    leadsNovosMes: 25,
    taxaResgateLead: 0.2,
  },
  consultoria: {
    // Número dado pela cliente (Instituto Siqueira): ticket alto e vagas que
    // ficam vazias por falta de máquina de atração/qualificação.
    ticketMentoria: 12000,
    vagasNaoPreenchidasMes: 3,       // 3 × 12.000 = 36.000 deixados na mesa/mês
  },
  uniformes: {
    // ML Sports: opera a ~40% da capacidade (60% ociosa) e pode dobrar a
    // produção. Máquina de vendas ativa preenche parte da ociosidade com o
    // público certo (times, academias, escolas, empresas), não peça avulsa.
    pedidosMes: 25,
    ticketPedido: 1500,              // por pedido/kit em volume (conservador)
    pedidosOciososRecuperaveisMes: 12, // metade do que a capacidade ociosa comporta
    taxaVpMercado: 0.13,             // referência de VP que o cliente já paga
  },
} as const;

// Ocupação diluída ao mudar para um ponto maior: o público é o mesmo, o salão
// não. Números da própria casa — sem benchmark inventado.
export function estimateOcupacaoNovoPonto() {
  return BENCHMARKS.entretenimento_local;
}

// Perda anual estimada com horários vagos na agenda (saude_estetica).
export function estimateEmptyChairLoss() {
  const b = BENCHMARKS.saude_estetica;
  const mensal = b.horariosVagosDia * b.ticketMedioProcedimento * b.diasUteisMes * 0.5; // 50% recuperável
  const anual = mensal * 12;
  return { anual, mensal };
}

// Óticas — dois vazamentos recuperáveis somados num só número de ROI:
// (1) orçamentos sem follow-up + (2) recompra dormida (troca de lente/grau).
// Números da própria base do cliente sob benchmark conservador — não é
// promessa de venda nova, é receita já presente na base que hoje escapa.
export function estimateOpticalLoss() {
  const b = BENCHMARKS.otica;
  const orcamentoMensal = b.orcamentosSemFollowupMes * b.ticketMedio * b.taxaResgateOrcamento;
  const recompraMensal = b.clientesNoCicloMes * b.ticketRecompra * b.taxaResgateRecompra;
  const mensal = orcamentoMensal + recompraMensal;
  const anual = mensal * 12;
  return { orcamentoMensal, recompraMensal, mensal, anual };
}

// Suplementos — mesma lógica de dois vazamentos das óticas, com um agravante:
// aqui o ciclo é de dias, não de anos. Toda vez que o pote acaba o cliente
// decide de novo onde comprar, e o marketplace está a um toque de distância.
// A base é o ativo; sem lembrete na hora certa ela evapora sozinha.
export function estimateSupplementLoss() {
  const b = BENCHMARKS.suplementos;
  const recompraMensal = b.clientesNoCicloMes * b.ticketMedio * b.taxaResgateRecompra;
  const consultaMensal = b.consultasSemFechamentoMes * b.ticketMedio * b.taxaResgateConsulta;
  const mensal = recompraMensal + consultaMensal;
  const anual = mensal * 12;
  return { recompraMensal, consultaMensal, mensal, anual };
}

// Fotografia — base fria parada + contato novo sem agendamento na hora.
export function estimatePhotographyLoss() {
  const b = BENCHMARKS.fotografia;
  const reativacaoMensal = b.baseParada * b.taxaReativacaoMes * b.taxaFechaReativacao * b.ticketEnsaio;
  const leadMensal = b.leadsNovosMes * b.taxaResgateLead * b.ticketEnsaio;
  const mensal = reativacaoMensal + leadMensal;
  const anual = mensal * 12;
  return { reativacaoMensal, leadMensal, mensal, anual };
}

// Consultoria/mentoria — vagas de ticket alto que ficam vazias. O número vem
// da própria cliente, não de benchmark inventado.
export function estimateConsultingLoss() {
  const b = BENCHMARKS.consultoria;
  const mensal = b.vagasNaoPreenchidasMes * b.ticketMentoria;
  const anual = mensal * 12;
  return { mensal, anual };
}

// Uniformes — capacidade ociosa que uma máquina de vendas ativa preenche.
export function estimateUniformLoss() {
  const b = BENCHMARKS.uniformes;
  const mensal = b.pedidosOciososRecuperaveisMes * b.ticketPedido;
  const anual = mensal * 12;
  return { mensal, anual };
}

// ---------------------------------------------------------------------------
// Grupos de segmentos (dicionário) — segmentos semelhantes compartilham roteiro
// ---------------------------------------------------------------------------

export const SEGMENT_GROUPS: Record<string, SegmentGroup> = {
  entretenimento_local: {
    id: "entretenimento_local",
    label: "Entretenimento Local",
    focus: "Fluxo de pessoas e reservas (luderias, bares, boliches, karaokês).",
    accent: "#a855f7",
    buildSlides: ({ companyName }) => {
      const nome = companyName?.trim() || "sua casa";
      const b = estimateOcupacaoNovoPonto();
      return [
        {
          id: 1,
          kind: "impact",
          eyebrow: "APRESENTAÇÃO COMERCIAL",
          title: "O Fim das Mesas Vazias.",
          subtitle: `Como encher um salão ${b.multiplicadorNovoPonto}x maior desde a primeira semana, e fazer a cidade inteira saber que a ${nome} mudou de endereço.`,
        },
        {
          id: 2,
          kind: "pain",
          eyebrow: "A DOR ATUAL",
          title: "O salão novo é 3x maior. O público, o mesmo.",
          body:
            `Hoje a ${nome} lota de ${b.ocupacaoFimDeSemanaAtual} da sua capacidade na sexta e no sábado, e ${b.ocupacaoDiaFracoAtual} na quinta e no domingo. ` +
            `No ponto novo, com ${b.multiplicadorNovoPonto}x a capacidade, esse mesmo público ocupa só ${b.ocupacaoFimDeSemanaNovo} no fim de semana ` +
            `e ${b.ocupacaoDiaFracoNovo} na quinta e no domingo. O salão triplica; o movimento, não.`,
          compare: {
            before: {
              img: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=70",
              label: "O salão novo com o público de hoje",
            },
            after: {
              img: "https://images.unsplash.com/photo-1585504198199-20277593b94f?auto=format&fit=crop&w=900&q=70",
              label: "O salão novo cheio, com GD + Vexo",
            },
          },
        },
        {
          id: 3,
          kind: "implication",
          eyebrow: "A IMPLICAÇÃO",
          title: "Mudar de endereço reinicia o jogo.",
          body:
            `Quem não souber que a ${nome} mudou, simplesmente não aparece. E o melhor dia da casa, sexta e sábado, passa a ocupar ` +
            `só ${b.ocupacaoFimDeSemanaNovo} do salão novo. Um espaço grande e vazio não dá sensação de espaço: dá sensação de casa parada. ` +
            `Para o ponto novo funcionar, o público precisa crescer na mesma proporção que a capacidade.`,
          metric: {
            value: b.ocupacaoFimDeSemanaNovo,
            caption: "é o quanto o seu melhor dia ocupa do salão novo, se o público continuar o mesmo",
          },
        },
        {
          id: 4,
          kind: "solution",
          eyebrow: "A SOLUÇÃO",
          title: "A Máquina de Atração e Reservas.",
          steps: [
            `Avisamos a cidade inteira que a ${nome} mudou de endereço, com o Sistema de Atração de Clientes na sua região.`,
            "Atraímos o público local que está buscando diversão e enchemos também a quinta e o domingo.",
            "Nossa Recepcionista Digital 24h atende o WhatsApp em 3 segundos, envia o cardápio e agenda a mesa, no piloto automático.",
            "Você foca no que importa: entregar a melhor experiência da cidade.",
          ],
        },
        {
          id: 5,
          kind: "partnership",
          eyebrow: "A PARCERIA COMPLETA",
          title: "Duas forças, um só resultado.",
          subtitle: `A Geração Digital cuida da sua atração e da sua marca. A Vexo cuida do atendimento no piloto automático. Juntas, enchem a ${nome}.`,
          fronts: [
            {
              label: "Geração Digital",
              tag: "Atração & Marca",
              items: [
                "Sistema de Atração de Clientes na sua região",
                "Presença forte nas redes sociais",
                "Sua casa achada no Google na hora certa",
                "Página de reservas profissional",
                "Vídeos e fotos que enchem os olhos",
                "Marca com cara de líder da cidade",
              ],
            },
            {
              label: "Vexo OS",
              tag: "Atendimento & Piloto Automático",
              items: [
                "Recepcionista Digital 24h no seu WhatsApp",
                "Reservas e cardápio enviados na hora",
                "Lembretes automáticos que trazem o cliente de volta",
                "Tudo organizado num só lugar",
              ],
            },
          ],
        },
        {
          id: 6,
          kind: "vision",
          eyebrow: "VISÃO DE FUTURO",
          title: "Previsibilidade.",
          body:
            `Imagine estrear o salão novo já cheio, com a quinta e o domingo enchendo de verdade, e a quarta abrindo porque a procura passou a justificar. ` +
            `Sem depender de sorte, sem torcer pelo movimento.`,
        },
        {
          id: 7,
          kind: "close",
          eyebrow: "A DECISÃO",
          title: "O custo da inércia.",
          body: `Quanto a ${nome} perde por mês inaugurando um salão ${b.multiplicadorNovoPonto}x maior com o público de hoje?`,
          metric: {
            value: b.ocupacaoDiaFracoNovo,
            caption: "é a ocupação da quinta e do domingo no salão novo, se nada mudar",
          },
          punch: "A pergunta não é quanto custa começar. É quanto custa esperar mais um mês. Cada semana parada é receita que não volta. A virada começa hoje.",
        },
      ];
    },
  },

  saude_estetica: {
    id: "saude_estetica",
    label: "Saúde & Estética",
    focus: "Agendamentos (clínicas, consultórios, estética).",
    accent: "#06b6d4",
    buildSlides: ({ companyName }) => {
      const nome = companyName?.trim() || "sua clínica";
      const { anual, mensal } = estimateEmptyChairLoss();
      const b = BENCHMARKS.saude_estetica;
      return [
        {
          id: 1,
          kind: "impact",
          eyebrow: "APRESENTAÇÃO COMERCIAL",
          title: "A Agenda Sempre Cheia.",
          subtitle: `Como transformar a ${nome} na referência da região, com horários disputados o mês inteiro.`,
        },
        {
          id: 2,
          kind: "pain",
          eyebrow: "A DOR ATUAL",
          title: "O paciente que não espera.",
          body:
            "Quem procura um procedimento quer resposta na hora. Se o seu WhatsApp demora porque a recepção está cuidando de quem já está na clínica, esse paciente esfria, adia a decisão e acaba não voltando.",
          compare: {
            before: {
              img: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=900&q=70",
              label: "Agenda de hoje",
            },
            after: {
              img: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=900&q=70",
              label: "Agenda com GD + Vexo",
            },
          },
        },
        {
          id: 3,
          kind: "implication",
          eyebrow: "A IMPLICAÇÃO",
          title: "O Custo do Horário Vago.",
          body:
            `Uma agenda como a da ${nome} costuma ter em média ${b.horariosVagosDia} janelas ociosas por dia. ` +
            `Com um ticket médio de ${brl(b.ticketMedioProcedimento)}, metade disso é receita perfeitamente recuperável, ` +
            `${milhar(mensal)} por mês deixados na mesa.`,
          metric: {
            value: `${milhar(anual)}/ano`,
            caption: "perda estimada com horários vagos na agenda",
          },
        },
        {
          id: 4,
          kind: "solution",
          eyebrow: "A SOLUÇÃO",
          title: "A Máquina de Atração e Agendamentos.",
          steps: [
            "Atraímos os pacientes certos da sua região, com o Sistema de Atração de Clientes.",
            "Nossa Recepcionista Digital 24h responde em 3 segundos, tira dúvidas e agenda a consulta, no piloto automático.",
            "Sua equipe foca no atendimento presencial de excelência.",
          ],
        },
        {
          id: 5,
          kind: "partnership",
          eyebrow: "A PARCERIA COMPLETA",
          title: "Duas forças, um só resultado.",
          subtitle: `A Geração Digital cuida da sua atração e da sua marca. A Vexo cuida do atendimento no piloto automático. Juntas, enchem a agenda da ${nome}.`,
          fronts: [
            {
              label: "Geração Digital",
              tag: "Atração & Marca",
              items: [
                "Sistema de Atração de Clientes na sua região",
                "Presença forte nas redes sociais",
                "Sua clínica achada no Google na hora certa",
                "Página de agendamento profissional",
                "Vídeos e fotos que passam confiança",
                "Marca com cara de referência",
              ],
            },
            {
              label: "Vexo OS",
              tag: "Atendimento & Piloto Automático",
              items: [
                "Recepcionista Digital 24h no seu WhatsApp",
                "Consultas agendadas na hora, sem fila de espera",
                "Lembretes automáticos que reduzem as faltas",
                "Tudo organizado num só lugar",
              ],
            },
          ],
        },
        {
          id: 6,
          kind: "vision",
          eyebrow: "VISÃO DE FUTURO",
          title: "Previsibilidade.",
          body: `Imagine começar a semana com a agenda da ${nome} praticamente fechada, sem correria e sem horário vago.`,
        },
        {
          id: 7,
          kind: "close",
          eyebrow: "A DECISÃO",
          title: "O custo da inércia.",
          body: `Quanto a ${nome} deixa de faturar por mês continuando exatamente como está hoje?`,
          metric: {
            value: `${milhar(mensal)}/mês`,
            caption: "é o preço estimado de não fazer nada",
          },
          punch: "A pergunta não é quanto custa começar. É quanto custa esperar mais um mês. Cada dia de agenda vazia é receita que não volta. A virada começa hoje.",
        },
      ];
    },
  },

  otica: {
    id: "otica",
    label: "Óticas",
    focus: "Fim da guerra de preço: resgate de orçamentos, recompra e ticket maior (óticas).",
    accent: "#4f46e5",
    buildSlides: ({ companyName }) => {
      const nome = companyName?.trim() || "sua ótica";
      const { orcamentoMensal, recompraMensal, mensal, anual } = estimateOpticalLoss();
      const b = BENCHMARKS.otica;
      return [
        {
          id: 1,
          kind: "impact",
          eyebrow: "APRESENTAÇÃO COMERCIAL",
          title: "O Fim da Guerra de Preço.",
          subtitle: `A ${nome} vira referência na cidade. Mais movimento, ticket maior e uma base que volta sozinha.`,
        },
        {
          id: 2,
          kind: "pain",
          eyebrow: "A DOR ATUAL",
          title: "O orçamento que sai pela porta.",
          body:
            `O cliente experimenta, pede o orçamento e diz que "vai pensar". Compara o preço na concorrência e some. ` +
            `Ninguém liga de volta. Quando decide comprar, já fechou em outra loja.`,
          compare: {
            before: {
              img: "https://images.unsplash.com/photo-1574258495973-f010dfbb5371?auto=format&fit=crop&w=900&q=70",
              label: "O orçamento de hoje: feito e esquecido",
            },
            after: {
              img: "https://images.unsplash.com/photo-1715635845783-7404fae223f9?auto=format&fit=crop&w=900&q=70",
              label: "Cliente sendo atendido na loja, com GD + Vexo",
            },
          },
        },
        {
          id: 3,
          kind: "implication",
          eyebrow: "A IMPLICAÇÃO",
          title: "O dinheiro parado na sua base.",
          body:
            `Dois vazamentos ao mesmo tempo. Cerca de ${b.orcamentosSemFollowupMes} orçamentos por mês que ninguém retoma valem ${milhar(orcamentoMensal * 12)} por ano. ` +
            `Os clientes de ${b.cicloMeses} meses que precisam trocar de grau e ninguém avisa somam outros ${milhar(recompraMensal * 12)}. Junto, ${milhar(mensal)} escapam todo mês.`,
          metric: {
            value: `${milhar(anual)}/ano`,
            caption: "receita já presente na sua base que hoje escapa por falta de retorno e recompra",
          },
        },
        {
          id: 4,
          kind: "solution",
          eyebrow: "A SOLUÇÃO",
          title: "A Máquina de Atração e Resgate.",
          steps: [
            `Atraímos quem está procurando óculos agora na sua região, não quem só caça desconto.`,
            "Nossa Recepcionista Digital 24h responde o WhatsApp em 3 segundos, tira dúvida e já chama pra loja, no piloto automático.",
            "O Resgate Automático de Orçamentos volta a falar com quem pediu preço e não fechou, antes de ele comprar em outro lugar.",
            `O Lembrete de Troca de Lentes avisa o cliente certo na hora certa e traz a recompra de volta a cada ${b.cicloMeses} meses, sozinho.`,
          ],
        },
        {
          id: 5,
          kind: "partnership",
          eyebrow: "A PARCERIA COMPLETA",
          title: "Duas forças, um só resultado.",
          subtitle: `A Geração Digital constrói sua atração e sua autoridade. A Vexo cuida do atendimento, do resgate e da recompra no piloto automático. Juntas, tiram a ${nome} da guerra de preço.`,
          fronts: [
            {
              label: "Geração Digital",
              tag: "Atração & Autoridade",
              items: [
                "Sistema de Atração de Clientes na sua região",
                "Conteúdo que educa (saúde ocular, luz azul, multifocais) e vende o premium",
                "Sua ótica achada no Google na hora certa",
                "Reputação forte: mais avaliações e prova social",
                "Campanhas para as datas que vendem (volta às aulas, Dia das Mães, Natal)",
                "Marca com cara de referência, não de mais uma ótica",
              ],
            },
            {
              label: "Vexo OS",
              tag: "Atendimento, Resgate & Recompra",
              items: [
                "Recepcionista Digital 24h no seu WhatsApp",
                "Resgate automático dos orçamentos que não fecharam",
                "Lembrete de troca de lentes que traz a recompra sozinho",
                "Cada atendimento e orçamento registrado num só lugar",
              ],
            },
          ],
        },
        {
          id: 6,
          kind: "vision",
          eyebrow: "VISÃO DE FUTURO",
          title: "Previsibilidade.",
          body:
            `Imagine a ${nome} com movimento o mês todo. Vendendo lente premium em vez de brigar por centavos. ` +
            `Os orçamentos se resgatam sozinhos e a base antiga volta na hora da troca.`,
        },
        {
          id: 7,
          kind: "close",
          eyebrow: "A DECISÃO",
          title: "O custo da inércia.",
          body: `Quanto a ${nome} deixa na mesa todo mês atendendo bem, orçando bem e nunca dando o retorno?`,
          metric: {
            value: `${milhar(mensal)}/mês`,
            caption: "é o preço estimado de não resgatar orçamento nem trabalhar a recompra",
          },
          punch: "A pergunta não é quanto custa começar. É quanto custa esperar mais um mês. Cada orçamento sem retorno é uma venda que fecha na concorrência. A virada começa hoje.",
        },
      ];
    },
  },

  suplementos: {
    id: "suplementos",
    label: "Suplementos Alimentares",
    focus: "A base que compra sozinha: recompra no ciclo certo e resposta imediata (suplementos).",
    accent: "#059669",
    buildSlides: ({ companyName }) => {
      const nome = companyName?.trim() || "sua loja";
      const { recompraMensal, consultaMensal, mensal, anual } = estimateSupplementLoss();
      const b = BENCHMARKS.suplementos;
      return [
        {
          id: 1,
          kind: "impact",
          eyebrow: "APRESENTAÇÃO COMERCIAL",
          title: "A Base Que Compra Sozinha.",
          subtitle: `A ${nome} para de vender pote por pote. O cliente volta no ciclo certo, sem você correr atrás.`,
        },
        {
          id: 2,
          kind: "pain",
          eyebrow: "A DOR ATUAL",
          title: "O pote acaba e ele compra em outro lugar.",
          body:
            `O cliente comprou, gostou e sumiu. Quando o pote acabou, ele não lembrou da sua loja. ` +
            `Abriu o aplicativo, achou dois reais mais barato e fechou. Você não perdeu para o preço. Perdeu para o silêncio.`,
          compare: {
            before: {
              img: "https://images.unsplash.com/photo-1581269631092-f5cbb136ea2e?auto=format&fit=crop&w=900&q=70",
              label: "O pote acabando em casa, e ninguém avisa",
            },
            after: {
              img: "https://images.unsplash.com/photo-1739289696449-cba3a5ef085d?auto=format&fit=crop&w=900&q=70",
              label: "Cliente de volta na loja, com GD + Vexo",
            },
          },
        },
        {
          id: 3,
          kind: "implication",
          eyebrow: "A IMPLICAÇÃO",
          title: "Seu maior ativo está dormindo.",
          body:
            `Seu ciclo é de ${b.cicloDias} dias. A cada ${b.cicloDias} dias o cliente decide de novo onde comprar, e o marketplace está a um toque. ` +
            `Cerca de ${b.clientesNoCicloMes} clientes por mês fecham o ciclo sem receber um lembrete. Isso vale ${milhar(recompraMensal * 12)} por ano. ` +
            `Some as ${b.consultasSemFechamentoMes} perguntas por mês no WhatsApp que esfriam antes da resposta e vão mais ${milhar(consultaMensal * 12)}.`,
          metric: {
            value: `${milhar(anual)}/ano`,
            caption: "receita que já é sua e escapa por falta de lembrete e de resposta na hora",
          },
        },
        {
          id: 4,
          kind: "solution",
          eyebrow: "A SOLUÇÃO",
          title: "A Máquina de Recompra.",
          steps: [
            "Atraímos quem treina na sua região e está comprando suplemento agora, não quem só caça promoção.",
            "Nossa Recepcionista Digital 24h responde no WhatsApp em 3 segundos, tira dúvida de uso e já fecha o pedido.",
            `O Lembrete de Recompra fala com o cliente quando o pote dele está acabando, no dia ${b.cicloDias}, sozinho.`,
            "O Resgate Automático volta a falar com quem perguntou preço e não comprou, antes de ele fechar no aplicativo.",
          ],
        },
        {
          id: 5,
          kind: "partnership",
          eyebrow: "A PARCERIA COMPLETA",
          title: "Duas forças, um só resultado.",
          subtitle: `A Geração Digital traz gente nova e constrói sua autoridade. A Vexo cuida da resposta, do resgate e da recompra no piloto automático. Juntas, transformam a ${nome} em ponto fixo de reabastecimento.`,
          fronts: [
            {
              label: "Geração Digital",
              tag: "Atração & Autoridade",
              items: [
                "Sistema de Atração de Clientes na sua região",
                "Conteúdo que educa sobre uso e dosagem, e justifica o produto certo",
                "Sua loja achada no Google na hora da recompra",
                "Reputação forte: mais avaliações e prova social",
                "Campanhas para os picos do ano (janeiro, verão, Black Friday)",
                "Marca com cara de referência, não de mais uma loja de whey",
              ],
            },
            {
              label: "Vexo OS",
              tag: "Resposta, Resgate & Recompra",
              items: [
                "Recepcionista Digital 24h no seu WhatsApp",
                `Lembrete de recompra disparado no ciclo de ${b.cicloDias} dias`,
                "Resgate automático de quem perguntou e não comprou",
                "Cada cliente, pedido e ciclo registrado num só lugar",
              ],
            },
          ],
        },
        {
          id: 6,
          kind: "vision",
          eyebrow: "VISÃO DE FUTURO",
          title: "Previsibilidade.",
          body:
            `Imagine a ${nome} com o mês já começando vendido. A base antiga voltando sozinha no ciclo. ` +
            `Você vendendo o produto certo para quem já confia em você, em vez de brigar por centavos com o aplicativo.`,
        },
        {
          id: 7,
          kind: "close",
          eyebrow: "A DECISÃO",
          title: "O custo do silêncio.",
          body: `Quanto a ${nome} deixa na mesa todo mês vendendo bem e nunca lembrando o cliente na hora que o pote acaba?`,
          metric: {
            value: `${milhar(mensal)}/mês`,
            caption: "é o preço estimado de não trabalhar a recompra nem responder na hora",
          },
          punch: "A pergunta não é quanto custa começar. É quanto custa esperar mais um ciclo. Cada pote que acaba em silêncio é um cliente que vira do concorrente. A virada começa hoje.",
        },
      ];
    },
  },

  fotografia: {
    id: "fotografia",
    label: "Fotografia",
    focus: "Base fria reativada e agenda cheia no automático (fotografia corporativa).",
    accent: "#0ea5e9",
    buildSlides: ({ companyName }) => {
      const nome = companyName?.trim() || "seu estúdio";
      const { reativacaoMensal, leadMensal, mensal, anual } = estimatePhotographyLoss();
      const b = BENCHMARKS.fotografia;
      return [
        {
          id: 1,
          kind: "impact",
          eyebrow: "APRESENTAÇÃO COMERCIAL",
          title: "A Agenda Cheia, no Automático.",
          subtitle: `Menos dependência da Meta e mais ensaios corporativos. A ${nome} vira uma máquina de agendamento, não só um portfólio bonito.`,
        },
        {
          id: 2,
          kind: "pain",
          eyebrow: "A DOR ATUAL",
          title: "O talento existe, o movimento não.",
          body:
            `O trabalho é excelente, mas a agenda depende de uma rede que pode mudar as regras a qualquer momento. ` +
            `Uma base inteira de clientes que já te conhecem está parada, e o contato novo que chega hoje espera resposta e desiste.`,
          compare: {
            before: {
              img: "https://images.unsplash.com/photo-1471341971476-ae15ff5dd4ea?auto=format&fit=crop&w=900&q=70",
              label: "O estúdio montado, esperando cliente",
            },
            after: {
              img: "https://images.unsplash.com/photo-1615702669705-0d3002c6801c?auto=format&fit=crop&w=900&q=70",
              label: "Ensaio corporativo em produção, com GD + Vexo",
            },
          },
        },
        {
          id: 3,
          kind: "implication",
          eyebrow: "A IMPLICAÇÃO",
          title: "Seus clientes já existem. Estão parados.",
          body:
            `São cerca de ${b.baseParada.toLocaleString("pt-BR")} contatos que já passaram por você e ninguém trabalha. ` +
            `Reativar essa base vale ${milhar(reativacaoMensal * 12)} por ano. Os ${b.leadsNovosMes} contatos novos por mês que chegam e não são agendados na hora somam outros ${milhar(leadMensal * 12)}.`,
          metric: {
            value: `${milhar(anual)}/ano`,
            caption: "receita presente na sua base e nos contatos que hoje escapam por falta de retorno",
          },
        },
        {
          id: 4,
          kind: "solution",
          eyebrow: "A SOLUÇÃO",
          title: "A Máquina de Agendamento.",
          steps: [
            `Reativamos seus ${b.baseParada.toLocaleString("pt-BR")} contatos com uma abordagem que aquece e chama para agendar, no piloto automático.`,
            "Atraímos empresas que precisam de foto e vídeo corporativo na sua região, não quem só compara preço.",
            "Nossa Recepcionista Digital 24h responde o WhatsApp em 3 segundos e marca o ensaio direto na sua agenda Google.",
            "Vídeo e portfólio trabalhados para vender o corporativo, o serviço de maior ticket e mais recorrência.",
          ],
        },
        {
          id: 5,
          kind: "partnership",
          eyebrow: "A PARCERIA COMPLETA",
          title: "Duas forças, um só resultado.",
          subtitle: `A Geração Digital constrói sua atração e sua autoridade além da Meta. A Vexo reativa sua base e enche sua agenda sozinha. Juntas, tiram a ${nome} da dependência de uma rede só.`,
          fronts: [
            {
              label: "Geração Digital",
              tag: "Atração & Autoridade",
              items: [
                "Sistema de Atração de empresas na sua região",
                "Anúncios no Google para quem procura foto corporativa agora",
                "Vídeo e portfólio que vendem o ensaio de maior ticket",
                "Presença que não depende de uma rede social só",
                "Marca com cara de estúdio de referência",
              ],
            },
            {
              label: "Vexo OS",
              tag: "Reativação & Agenda",
              items: [
                "Reativação da base de contatos parada",
                "Recepcionista Digital 24h no seu WhatsApp",
                "Agendamento automático direto na sua agenda Google",
                "Cada contato e cada ensaio registrado num só lugar",
              ],
            },
          ],
        },
        {
          id: 6,
          kind: "vision",
          eyebrow: "VISÃO DE FUTURO",
          title: "Previsibilidade.",
          body:
            `Imagine a ${nome} com a agenda corporativa cheia o mês todo, sem depender do humor de um algoritmo. ` +
            `A base antiga voltando sozinha e cada novo contato virando ensaio marcado.`,
        },
        {
          id: 7,
          kind: "close",
          eyebrow: "A DECISÃO",
          title: "O custo da base parada.",
          body: `Quanto a ${nome} deixa na mesa todo mês com uma base inteira de clientes que ninguém trabalha?`,
          metric: {
            value: `${milhar(mensal)}/mês`,
            caption: "é o preço estimado de não reativar a base nem agendar o contato na hora",
          },
          punch: "A pergunta não é quanto custa começar. É quanto custa esperar mais um mês. Cada contato parado é um ensaio que não acontece. A virada começa hoje.",
        },
      ];
    },
  },

  consultoria: {
    id: "consultoria",
    label: "Consultoria e Mentoria",
    focus: "Vagas de ticket alto preenchidas com previsibilidade (consultoria e mentoria).",
    accent: "#7c3aed",
    buildSlides: ({ companyName }) => {
      const nome = companyName?.trim() || "sua consultoria";
      const { mensal, anual } = estimateConsultingLoss();
      const b = BENCHMARKS.consultoria;
      return [
        {
          id: 1,
          kind: "impact",
          eyebrow: "APRESENTAÇÃO COMERCIAL",
          title: "Autoridade Que Enche a Agenda.",
          subtitle: `A ${nome} deixa de depender de indicação e passa a atrair, qualificar e fechar mentoria de ticket alto com previsibilidade.`,
        },
        {
          id: 2,
          kind: "pain",
          eyebrow: "A DOR ATUAL",
          title: "A demanda existe. A vaga fica vazia.",
          body:
            `Você começou agora e cada hora sua vale muito. Sem uma máquina que atrai e qualifica antes, ` +
            `o tempo vai embora em conversa que não fecha, e a vaga de ticket alto fica aberta esperando.`,
          compare: {
            before: {
              img: "https://images.unsplash.com/photo-1560372326-6db12716ff43?auto=format&fit=crop&w=900&q=70",
              label: "A agenda vazia, decidindo tudo sozinha",
            },
            after: {
              img: "https://images.unsplash.com/photo-1573164574397-dd250bc8a598?auto=format&fit=crop&w=900&q=70",
              label: "Mentoria acontecendo, com GD + Vexo",
            },
          },
        },
        {
          id: 3,
          kind: "implication",
          eyebrow: "A IMPLICAÇÃO",
          title: "Cada vaga vazia custa caro.",
          body:
            `Com ticket de ${brl(b.ticketMentoria)}, bastam ${b.vagasNaoPreenchidasMes} vagas não preenchidas para ${milhar(mensal)} saírem da mesa todo mês. ` +
            `Não é falta de demanda. É falta de um sistema que traz a cliente certa até você.`,
          metric: {
            value: `${milhar(anual)}/ano`,
            caption: "é o que fica na mesa hoje com as vagas de ticket alto que não são preenchidas",
          },
        },
        {
          id: 4,
          kind: "solution",
          eyebrow: "A SOLUÇÃO",
          title: "A Máquina de Autoridade e Vendas.",
          steps: [
            "Construímos sua autoridade para que a cliente certa chegue já reconhecendo seu valor.",
            "Atraímos mulheres no momento de decisão, prontas para investir em mentoria, não curiosas.",
            "Nossa Recepcionista Digital 24h qualifica cada contato e só leva à sua agenda quem tem perfil.",
            "Follow-up automático mantém a conversa viva até a decisão, sem você correr atrás.",
          ],
        },
        {
          id: 5,
          kind: "partnership",
          eyebrow: "A PARCERIA COMPLETA",
          title: "Duas forças, um só resultado.",
          subtitle: `A Geração Digital constrói sua autoridade e atrai a cliente certa. A Vexo qualifica e fecha no piloto automático. Juntas, dão à ${nome} previsibilidade desde o começo.`,
          fronts: [
            {
              label: "Geração Digital",
              tag: "Autoridade & Atração",
              items: [
                "Posicionamento que sustenta o ticket alto",
                "Conteúdo que educa e prepara a cliente para decidir",
                "Atração de mulheres no momento certo de investir",
                "Prova social e reputação que constroem confiança",
                "Marca de referência em mentoria feminina",
              ],
            },
            {
              label: "Vexo OS",
              tag: "Qualificação & Fechamento",
              items: [
                "Recepcionista Digital 24h que qualifica cada contato",
                "Só o perfil certo chega à sua agenda",
                "Follow-up automático até a decisão",
                "Cada cliente e cada conversa registrada num só lugar",
              ],
            },
          ],
        },
        {
          id: 6,
          kind: "vision",
          eyebrow: "VISÃO DE FUTURO",
          title: "Previsibilidade.",
          body:
            `Imagine a ${nome} com a agenda de mentoria cheia das clientes certas, sem depender de indicação. ` +
            `Seu tempo dedicado a entregar resultado, não a caçar cliente.`,
        },
        {
          id: 7,
          kind: "close",
          eyebrow: "A DECISÃO",
          title: "O custo da vaga vazia.",
          body: `Quanto a ${nome} deixa na mesa todo mês com as vagas de ticket alto que a demanda quer e o sistema não entrega?`,
          metric: {
            value: `${milhar(mensal)}/mês`,
            caption: "é o que fica na mesa hoje sem uma máquina de atração e qualificação",
          },
          punch: "A pergunta não é quanto custa começar. É quanto custa esperar. Cada mês sem sistema é uma vaga de ticket alto que não volta. A virada começa hoje.",
        },
      ];
    },
  },

  uniformes: {
    id: "uniformes",
    label: "Confecção de Uniformes",
    focus: "Capacidade ociosa preenchida com o público certo, não peça avulsa (confecção de uniformes).",
    accent: "#ea580c",
    buildSlides: ({ companyName }) => {
      const nome = companyName?.trim() || "sua fábrica";
      const { mensal, anual } = estimateUniformLoss();
      const b = BENCHMARKS.uniformes;
      return [
        {
          id: 1,
          kind: "impact",
          eyebrow: "APRESENTAÇÃO COMERCIAL",
          title: "Máquina Rodando na Capacidade Cheia.",
          subtitle: `A ${nome} para de depender de indicação e enche a produção ociosa com pedido de kit em volume, não peça avulsa.`,
        },
        {
          id: 2,
          kind: "pain",
          eyebrow: "A DOR ATUAL",
          title: "Máquina parada e tráfego queimado.",
          body:
            `A produção roda a 40% e o que sobra de capacidade não vira faturamento. ` +
            `Os anúncios que você testou trouxeram quem quer uma camisa com o próprio nome, não o clube que pede kit fechado. Dinheiro gasto, venda que não veio.`,
          compare: {
            before: {
              img: "https://images.unsplash.com/photo-1561053114-fbe0ffaa1440?auto=format&fit=crop&w=900&q=70",
              label: "Uma máquina rodando, capacidade sobrando",
            },
            after: {
              img: "https://images.unsplash.com/photo-1533548893636-3eac05d3bde7?auto=format&fit=crop&w=900&q=70",
              label: "Time inteiro uniformizado, com GD + Vexo",
            },
          },
        },
        {
          id: 3,
          kind: "implication",
          eyebrow: "A IMPLICAÇÃO",
          title: "60% de capacidade parada é dinheiro parado.",
          body:
            `Você fecha cerca de ${b.pedidosMes} pedidos por mês operando a 40%. A produção pode dobrar. ` +
            `Preencher parte dessa ociosidade com o público certo, times, academias, escolas e empresas, vale ${milhar(mensal)} por mês.`,
          metric: {
            value: `${milhar(anual)}/ano`,
            caption: "é o faturamento que a capacidade ociosa comporta e hoje não acontece",
          },
        },
        {
          id: 4,
          kind: "solution",
          eyebrow: "A SOLUÇÃO",
          title: "A Máquina de Vendas por Volume.",
          steps: [
            "Atraímos quem compra kit em volume, times, academias, escolas e empresas, não a peça avulsa que trava sua produção.",
            "Nossa Recepcionista Digital 24h responde, qualifica o pedido pelo mínimo e já encaminha o orçamento.",
            "Follow-up automático não deixa nenhum orçamento esfriar, o que resolve a perda por esquecimento.",
            "Investimento em atração no patamar certo, mirado no público que fecha volume, não no clique barato.",
          ],
        },
        {
          id: 5,
          kind: "partnership",
          eyebrow: "A PARCERIA COMPLETA",
          title: "Duas forças, um só resultado.",
          subtitle: `A Geração Digital traz o pedido certo e constrói sua marca. A Vexo qualifica e não deixa orçamento esfriar. E aceitamos parte em permuta (VP), sem a mordida que você paga hoje.`,
          fronts: [
            {
              label: "Geração Digital",
              tag: "Atração & Marca",
              items: [
                "Sistema de Atração de clubes, academias e empresas",
                "Atração mirada em quem fecha kit em volume",
                "Identidade visual que sai da concentração em um público só",
                "Portfólio que mostra a fábrica além do futebol",
                "Presença ativa no lugar do Instagram parado",
              ],
            },
            {
              label: "Vexo OS",
              tag: "Qualificação & Resgate",
              items: [
                "Recepcionista Digital 24h que qualifica o pedido",
                "Follow-up automático para nenhum orçamento esfriar",
                "Carteira de clientes registrada num só lugar",
                `Parte do investimento em permuta (VP), sem a taxa de ${(b.taxaVpMercado * 100).toFixed(0)}% de mercado`,
              ],
            },
          ],
        },
        {
          id: 6,
          kind: "vision",
          eyebrow: "VISÃO DE FUTURO",
          title: "Previsibilidade.",
          body:
            `Imagine a ${nome} com a produção cheia o mês todo, de pedido de volume, sem depender só de indicação. ` +
            `Máquina rodando no talo e público diversificado além do futebol.`,
        },
        {
          id: 7,
          kind: "close",
          eyebrow: "A DECISÃO",
          title: "O custo da máquina parada.",
          body: `Quanto a ${nome} deixa na mesa todo mês com 60% da capacidade parada e sem uma máquina de vendas ativa?`,
          metric: {
            value: `${milhar(mensal)}/mês`,
            caption: "é o faturamento que a capacidade ociosa comporta e hoje não acontece",
          },
          punch: "A pergunta não é quanto custa começar. É quanto custa manter a máquina a 40%. Cada mês parado é volume que não volta. A virada começa hoje.",
        },
      ];
    },
  },
};

// Mapeamento de segment_id específico -> grupo. Adicione novos ids aqui conforme
// a base crescer; o default cai em entretenimento_local.
const SEGMENT_ID_TO_GROUP: Record<string, string> = {
  // Entretenimento local
  luderia: "entretenimento_local",
  bar: "entretenimento_local",
  boliche: "entretenimento_local",
  karaoke: "entretenimento_local",
  entretenimento: "entretenimento_local",
  entretenimento_local: "entretenimento_local",
  // Saúde & estética
  clinica: "saude_estetica",
  clinicas: "saude_estetica",
  clinicas_de_saude: "saude_estetica",
  consultorio: "saude_estetica",
  estetica: "saude_estetica",
  saude: "saude_estetica",
  saude_estetica: "saude_estetica",
  // Óticas
  otica: "otica",
  oticas: "otica",
  suplementos: "suplementos",
  suplemento: "suplementos",
  suplementos_alimentares: "suplementos",
  nutricao_esportiva: "suplementos",
  optica: "otica",
  opticas: "otica",
  // Fotografia
  fotografia: "fotografia",
  fotografo: "fotografia",
  fotografa: "fotografia",
  // Consultoria e mentoria
  consultoria: "consultoria",
  mentoria: "consultoria",
  consultoria_empresarial: "consultoria",
  // Confecção de uniformes
  uniformes: "uniformes",
  uniforme: "uniformes",
  confeccao: "uniformes",
  confeccao_de_uniformes: "uniformes",
};

export const DEFAULT_GROUP_ID = "entretenimento_local";

// Palavras-chave por grupo — casam contra o NOME do segmento (o segment_id real
// do app é um UUID, então resolvemos pelo texto: "Clínicas de Saúde",
// "Odontologia", "Food Service", etc.).
const GROUP_KEYWORDS: Record<string, string[]> = {
  suplementos: [
    "suplemento", "suplementos", "whey", "creatina", "nutricao", "nutrição",
    "nutri esportiva", "academia", "fitness", "hipertrofia", "proteina", "proteína",
    "pre-treino", "pré-treino", "vitamina", "emporio saudavel", "empório saudável",
  ],
  fotografia: [
    "fotografia", "fotografo", "fotógrafo", "fotografa", "fotógrafa", "foto",
    "ensaio", "estudio fotografico", "estúdio fotográfico", "retrato", "photography",
  ],
  consultoria: [
    "consultoria", "consultor", "mentoria", "mentor", "mentora", "coach",
    "coaching", "assessoria empresarial", "instituto",
  ],
  uniformes: [
    "uniforme", "uniformes", "confeccao", "confecção", "fardamento", "malharia",
    "costura", "camiseta", "dry fit", "esportivo", "sportswear", "têxtil", "textil",
  ],
  otica: [
    "otica", "ótica", "oticas", "óticas", "optica", "óptica", "oculos", "óculos",
    "lente", "armacao", "armação", "grau", "multifocal", "visao", "visão", "eyewear",
  ],
  saude_estetica: [
    "clinica", "clínica", "saude", "saúde", "estetica", "estética", "odonto",
    "consultorio", "consultório", "laboratorio", "laboratório", "medic", "dental",
  ],
  entretenimento_local: [
    "luderia", "jogos", "board", "bar", "boliche", "karaoke", "karaokê",
    "entreten", "food service", "delivery", "hospitalidade", "turismo",
    "restaurante", "gastro", "lazer", "diversao", "diversão",
  ],
};

// Resolve o grupo por: (1) id/chave exata do dicionário; (2) palavra-chave no
// nome; senão cai no grupo padrão.
export function resolveSegmentGroup(segmentIdOrName?: string | null): SegmentGroup {
  const raw = String(segmentIdOrName || "").trim().toLowerCase();
  if (SEGMENT_ID_TO_GROUP[raw]) return SEGMENT_GROUPS[SEGMENT_ID_TO_GROUP[raw]];
  for (const [groupId, words] of Object.entries(GROUP_KEYWORDS)) {
    if (words.some((w) => raw.includes(w))) return SEGMENT_GROUPS[groupId];
  }
  return SEGMENT_GROUPS[DEFAULT_GROUP_ID];
}

export function buildPitch(ctx: PitchContext): { group: SegmentGroup; slides: PitchSlide[] } {
  const group = resolveSegmentGroup(ctx.segmentId);
  return { group, slides: group.buildSlides(ctx) };
}
