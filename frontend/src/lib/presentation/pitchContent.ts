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
  optica: "otica",
  opticas: "otica",
};

export const DEFAULT_GROUP_ID = "entretenimento_local";

// Palavras-chave por grupo — casam contra o NOME do segmento (o segment_id real
// do app é um UUID, então resolvemos pelo texto: "Clínicas de Saúde",
// "Odontologia", "Food Service", etc.).
const GROUP_KEYWORDS: Record<string, string[]> = {
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
