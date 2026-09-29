// frontend/src/data/academyRecipes.ts
//
// Vexo Academy — o conteúdo é dado. Dois tipos, comportamento diferente:
//
//   fundamento — ensina o sistema. Só leitura e Copiar. Nunca tem botão de
//   instalar (seria promessa falsa: não cria nada).
//
//   receita — resolve um objetivo com conteúdo pronto. Tem o botão que
//   instala (cria a cadência via endpoint que já existe, como rascunho).
//
// Fundamentos aparecem sempre, primeiro, independentemente do filtro de
// segmento — valem para todos e são pré-requisito.
//
// Regra do anonimato: nenhum nome de empresa em nenhum lugar — nem texto,
// nem comentário, nem dado de teste, nem exemplo. Só nome de segmento.
//
// Regra que veio da medição: quanto mais frio o contato, mais curta a
// abertura. Os textos curtos (passo 1 de contato morno/frio) são curtos DE
// PROPÓSITO — não "melhorar" acrescentando contexto.
//
// Regra sobre âncora e data (rodada 3, corrigindo a rodada 2, que corrigiu a
// rodada 1): ANCHOR_FIELDS (backend, followup/service.js:18) só tem hoje
// `meeting_datetime` e `data_nascimento` — SUPPORTED_ANCHOR_FIELDS abaixo
// espelha a mesma lista. Passo que o cartão descreve com uma âncora que não
// existe, ou com uma data que a receita não sabe de antemão, NÃO entra em
// `templates` com um trigger_type aproximado ou uma data inventada — isso é
// a tela prometendo algo que o sistema não agenda daquele jeito, sem quem
// instala ter como saber. Em vez disso:
//   - aniversário da pessoa → âncora real (data_nascimento), instala.
//   - aniversário de casamento / época de férias / data de retorno → sem
//     âncora real ainda. Viram `manualSteps` (texto pronto, sem trigger,
//     fora do instalador) ou, quando a receita inteira depende disso,
//     `installable: false` com `notInstallableReason`.
//   - prazo fiscal por cliente → `fixed_date` existe (followup/service.js:70)
//     e é o trigger certo, mas a data de cada aviso muda por cliente e por
//     obrigação — a receita não sabe qual é. Nenhum trigger_type resolve
//     "não sei a data ainda" além de não instalar: vira `manualSteps`
//     também, com a instrução de montar em Follow-up → Cadências, gatilho
//     de data fixa, preenchendo a data real.
//
// Nunca gerar `scheduled_date` a partir de `new Date()` (nem aqui, nem no
// hook de instalação) só pra passar na validação do backend — a cadência
// nasce em draft e não dispara sozinha, mas se alguém ativar sem revisar,
// uma data inventada que parece real é pior que não instalar (rodada 2
// tentou isso com um placeholder de "amanhã"; rodada 3 tirou).
//
// Backlog, não desta leva: em followup/service.js:521 a busca de
// aniversário recorrente está amarrada em `anchor_field === "data_nascimento"`
// escrito na mão. Toda âncora nova que entrar em ANCHOR_FIELDS (e em
// SUPPORTED_ANCHOR_FIELDS aqui) tem que generalizar esse ponto também,
// senão passa na validação e não agenda.

export type AcademyContentType = "fundamento" | "receita";
export type AcademyContactTemperature = "frio" | "morno" | "quente";

export interface AcademyFundamentoSection {
  heading: string;
  body: string;
}

export interface AcademyFundamento {
  id: string;
  tipo: "fundamento";
  title: string;
  resultPhrase: string;
  segments: string[];
  prerequisites: string[];
  timeLabel: string;
  sections: AcademyFundamentoSection[];
}

/**
 * Uma mensagem da cadência a ser criada. O formato espelha o que
 * POST /api/followup/templates espera (menos campaign_id, que só existe
 * depois de instalada).
 */
/** Espelha ANCHOR_FIELDS do backend (followup/service.js:18) — as âncoras que o sistema agenda sozinho. */
export const SUPPORTED_ANCHOR_FIELDS = [
  "meeting_datetime",
  "data_nascimento",
  "aniversario_casamento",
  "epoca_ferias",
  "data_retorno",
] as const;
export type SupportedAnchorField = (typeof SUPPORTED_ANCHOR_FIELDS)[number];

export interface AcademyRecipeTemplate {
  label: string;
  message: string;
  trigger_type: "no_reply" | "after_enrollment" | "before_meeting" | "after_meeting" | "on_schedule" | "before_anchor" | "after_anchor" | "fixed_date";
  trigger_value: number;
  trigger_unit: "minutes" | "hours" | "days";
  trigger_direction: "before" | "after" | null;
  anchor_field?: SupportedAnchorField;
  scheduled_time?: string;
  /** Só em passos "fixed_date" com uma data real já conhecida (YYYY-MM-DD). Quando ausente, quem instala digita a data antes de ligar a cadência. */
  scheduled_date?: string;
  /** true só no passo que a receita descreve com anexo — o arquivo em si não existe aqui, é enviado por quem instala. */
  hasAttachment?: boolean;
}

export interface AcademyRecipe {
  id: string;
  tipo: "receita";
  title: string;
  resultPhrase: string;
  contactTemperature: AcademyContactTemperature;
  segments: string[];
  prerequisites: string[];
  timeLabel: string;
  /** O texto de "Instala:" — o que a instalação cria, em uma frase. */
  whatHappens: string;
  cadenceName: string;
  cadenceDescription: string;
  templates: AcademyRecipeTemplate[];
  screenNote: string;
  /** true quando algum passo precisa de um arquivo que só existe fora do sistema — instalar cria a mensagem, mas o arquivo tem que ser enviado à parte, antes de ligar a cadência. */
  requiresAttachment?: boolean;
  /** Passos que o cartão descreve mas o sistema não agenda sozinho ainda (sem âncora real) — texto pronto pra copiar, fora de `templates` e fora do instalador. */
  manualSteps?: { label: string; message: string }[];
  /** Só quando a receita instala uma PARTE dos passos descritos — uma frase declarando o que instala e o que fica manual. */
  partialInstallNote?: string;
  /** false quando nenhum passo tem como agendar do jeito descrito ainda — a tela não mostra botão de instalar, mostra `notInstallableReason` no lugar. Default: true. */
  installable?: boolean;
  /** Obrigatório quando installable === false — o que falta pro sistema conseguir instalar sozinho. */
  notInstallableReason?: string;
}

export type AcademyContent = AcademyFundamento | AcademyRecipe;

export const ACADEMY_FUNDAMENTOS: AcademyFundamento[] = [
  {
    id: "fundamento-chip-novo",
    tipo: "fundamento",
    title: "Chip novo, do zero ao primeiro disparo",
    resultPhrase: "Seu número novo chega no primeiro disparo sem ser bloqueado.",
    segments: ["Todos os segmentos"],
    prerequisites: ["Um chip conectado."],
    timeLabel: "10 minutos, mais 14 dias de aquecimento",
    sections: [
      {
        heading: "Por que isso existe",
        body: "O WhatsApp não bane por mandar muita mensagem. Bane por mandar muita mensagem de um número que ninguém conhece. Número novo mandando cem mensagens no primeiro dia é o retrato do spam. O mesmo volume, num número com três semanas de conversa real, passa despercebido. Aquecer é construir esse histórico de propósito, antes de precisar dele.",
      },
      {
        heading: "Os dois estados",
        body: "Frio: número novo ou parado, teto de 50 por dia — é o padrão de todo chip recém-conectado. Aquecido: número com histórico de conversa e resposta, teto de 500. O teto não é sugestão: o sistema conta os envios e adia o que passar para o dia seguinte. Não descarta a mensagem, mas não deixa furar o limite por descuido.",
      },
      {
        heading: "Os 14 dias",
        body: "Dias 1 a 3, só conversa humana, sem disparo: vinte a trinta conversas por dia com gente que responde. O que constrói reputação é a resposta, não o envio. Dias 4 a 7, até 20 disparos por dia, só para quem já conhece a empresa. Dias 8 a 14, subindo de 20 para 50, mantendo conversa humana no meio. Depois do dia 14, marque como aquecido e o teto sobe para 500.",
      },
      {
        heading: "O que mata um chip mais rápido",
        body: 'Lista com número inválido — passando de 20% no Relatório, pare e limpe antes de continuar. Mesma mensagem palavra por palavra para centenas — use variação e o campo "Espalhar os envios em até N minutos". Disparo de madrugada — a janela padrão vai das 08:00 às 20:00 em dias úteis, e existe por isso. E ninguém responder: 200 envios com 2 respostas significa lista ou mensagem errada, e insistir queima o número.',
      },
      {
        heading: "No sistema",
        body: "Canais → Chips WhatsApp, escolha o chip. Em Cota Diária de Envios confirme estado e teto; precisando de número diferente, escreva e salve — acima do patamar seguro o sistema avisa e pede confirmação, e a alteração fica registrada. Em Operador Responsável, escolha quem recebe os leads daquele número.",
      },
      {
        heading: "Como saber se está dando certo",
        body: 'Na Fila de Envios, quantos responderam: acima de 10% em lista própria é saudável, abaixo de 3% pare. No Relatório & Auditoria, o bloco "Por que falhou" mostra a qualidade da lista.',
      },
    ],
  },
  {
    id: "fundamento-disparo-em-massa",
    tipo: "fundamento",
    title: "Disparo em massa sem queimar o número",
    resultPhrase: "Sua lista sai inteira, sem bloqueio.",
    segments: ["Todos os segmentos"],
    prerequisites: ["Chip aquecido e lista com telefone."],
    timeLabel: "20 minutos",
    sections: [
      {
        heading: "A conta que ninguém faz antes",
        body: "Mil contatos num chip de 500 por dia são dois dias. Num chip frio de 50, são vinte. Faça a conta antes: contatos ÷ teto = dias. Não cabendo no prazo, o caminho não é aumentar o teto — é usar mais de um chip, ou cortar a lista.",
      },
      {
        heading: "Limpe antes, não depois",
        body: "O maior risco não é o volume, é a qualidade dos números. Tire quem não tem telefone, confira o formato com DDD, e tire quem já pediu para parar. Passando de 20% de número inválido no primeiro lote, pare o resto: a lista está ruim e continuar só entrega sinal ruim ao WhatsApp.",
      },
      {
        heading: "Montando",
        body: "Campanhas → Novo Disparo. Três coisas mudam o resultado. Use {{nome}} — mas confira a planilha: nome vazio faz o sistema bloquear o envio por variável não substituída, e o lote falha em vez de sair torto. Escreva como gente escreve: a mensagem mais curta é a que mais responde. E não mande link no primeiro contato — link de número desconhecido é padrão de golpe.",
      },
      {
        heading: "Espalhe os envios",
        body: 'O campo "Espalhar os envios em até N minutos" dá atraso aleatório a cada mensagem. Trinta minutos é um bom começo. Cem mensagens no mesmo segundo é padrão de robô; espalhadas, parecem alguém trabalhando.',
      },
      {
        heading: "Acompanhe",
        body: "Na Fila de Envios a campanha é uma linha, com os lotes em quadrados numerados — verde enviado, vermelho falhou, azul saindo agora, cinza na fila. Três sinais para parar: vermelho demais nos primeiros lotes (lista ruim), ninguém respondendo (mensagem errada), ou o chip caindo. Pausar vale para a campanha inteira; Cancelar o que falta interrompe os pendentes sem tocar no que já saiu.",
      },
    ],
  },
  {
    id: "fundamento-cadencia-para-quando-responde",
    tipo: "fundamento",
    title: "Cadência que para quando a pessoa responde",
    resultPhrase: "Quem não respondeu recebe sequência; quem respondeu para de receber.",
    segments: ["Todos os segmentos"],
    prerequisites: ["Leads com telefone."],
    timeLabel: "30 minutos",
    sections: [
      {
        heading: "O erro que estraga follow-up",
        body: 'A pessoa responde no primeiro dia, marca conversa, e no terceiro recebe "passando para saber se ainda tem interesse". Isso não é insistência, é a prova de que ninguém está lendo.',
      },
      {
        heading: "As quatro saídas",
        body: "Respondeu — a mais importante. Virou cliente. Foi descartado. E alguém assumiu a conversa: um vendedor entrou no WhatsApp e respondeu, então o robô sai de cena. Essa última salva mais constrangimento: sem ela, o vendedor combina a reunião e a cadência cobra resposta no dia seguinte.",
      },
      {
        heading: "Quando cada passo sai",
        body: 'Três modos: relativo a um evento, data fixa no calendário, ou recorrente ancorado numa data do próprio lead que o sistema busca sozinho. E cada passo pode ter hora do dia — sem isso, "3 dias depois" significa a mesma hora em que a pessoa entrou, e quem caiu às 3 da manhã recebe às 3 da manhã.',
      },
      {
        heading: "Quantos passos",
        body: 'Três a cinco. Mais que isso não aumenta resposta, aumenta bloqueio. Intervalo que funciona: 2, 4 e 7 dias. E cada passo precisa dizer algo novo: a primeira retoma, a segunda traz informação, a terceira dá saída — "se não for o momento, me avisa que eu paro por aqui". Essa última costuma ter a maior resposta das três.',
      },
      {
        heading: "Anexo",
        body: "Imagem, PDF, áudio ou vídeo por passo. O áudio sai como mensagem de voz de verdade, com a onda. Um cuidado: o mesmo arquivo para centenas de contatos é sinal de disparo em massa — use onde faz diferença, não em todo passo.",
      },
      {
        heading: "Onde montar",
        body: "Follow-up → Cadências. A faixa dos próximos sete dias mostra quantos envios caem em cada dia, contando todas as cadências e campanhas do mesmo chip. Dia que passa do teto fica vermelho.",
      },
    ],
  },
  {
    id: "fundamento-agendar-vs-lembrete",
    tipo: "fundamento",
    title: "Agendar mensagem e lembrete não são a mesma coisa",
    resultPhrase: "Você para de esquecer de retornar, e para de mandar mensagem sem querer.",
    segments: ["Todos os segmentos"],
    prerequisites: ["Conversas na aba Conversas."],
    timeLabel: "2 minutos",
    sections: [
      {
        heading: "A diferença",
        body: 'Agendar mensagem: você escreve agora e sai para o cliente na data marcada. Criar lembrete: só para você, nada sai. Confundir tem dois desfechos ruins — ou o cliente recebeu algo que você não revisou, ou a mensagem que você achou que sairia nunca saiu. Por isso a aba Hoje separa os dois: "vai ser enviado ao cliente" e "só para você".',
      },
      {
        heading: "Quando usar cada um",
        body: "Agende mensagem quando o texto já está pronto e o momento é que importa. Crie lembrete quando o que falta é uma ação sua — ligar, conferir, cobrar internamente. O lembrete pode ser atribuído a outra pessoa da equipe.",
      },
      {
        heading: "A aba Hoje",
        body: 'Mostra o que vence hoje ou já venceu, dos dois tipos, com contador. Vencido fica destacado com o tempo decorrido. Concluir some da lista mas não do sistema — fica em "Lembretes concluídos", com quem concluiu e quando, e dá para desfazer.',
      },
      {
        heading: "Para quem usa follow-up",
        body: 'O botão mostra quando já existe envio marcado para aquele lead — "⏰ Mensagem agendada · 14/09 às 10:50" — e é o que impede agendar duas vezes sem perceber.',
      },
    ],
  },
];

export const ACADEMY_RECIPES: AcademyRecipe[] = [
  {
    id: "receita-turismo-orcamento-sem-resposta",
    tipo: "receita",
    title: "Turismo · Orçamento de viagem sem resposta",
    contactTemperature: "morno",
    resultPhrase: "Quem pediu orçamento e sumiu volta a responder.",
    segments: ["Turismo"],
    prerequisites: ["Leads com orçamento enviado."],
    timeLabel: "20 minutos",
    whatHappens: 'Cadência de 3 passos, "X depois da inscrição", 2, 5 e 12 dias, hora fixa 10h, com saídas respondeu / virou cliente / atendimento humano assumiu.',
    cadenceName: "Orçamento sem resposta",
    cadenceDescription: "Cadência de 3 toques para orçamento de viagem sem resposta, instalada pela Vexo Academy.",
    templates: [
      {
        label: "Passo 1 — 2 dias depois",
        message: "{{nome}}, conseguiu dar uma olhada no roteiro?",
        trigger_type: "after_enrollment",
        trigger_value: 2,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "10:00",
      },
      {
        label: "Passo 2 — 5 dias depois",
        message:
          "{{nome}}, sobre essas datas: preço de aéreo sobe conforme a procura, e quanto mais perto, mais caro.\nSe a data ainda está de pé, consigo travar o valor de agora por alguns dias. Quer que eu segure?",
        trigger_type: "after_enrollment",
        trigger_value: 5,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "10:00",
      },
      {
        label: "Passo 3 — 12 dias depois",
        message:
          "{{nome}}, vou parar de te escrever pra não encher.\nSe a viagem ficou pra mais pra frente, me diz a época que você tá pensando — eu te procuro quando chegar perto.",
        trigger_type: "after_enrollment",
        trigger_value: 12,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "10:00",
      },
    ],
    screenNote:
      "O passo 1 é curto de propósito. Ofertas e ajustes de preço são a resposta que você dá quando a pessoa escrever de volta — oferecer desconto antes da conversa existir é queimar margem sem necessidade. O passo 3 costuma ter a maior resposta, porque tira a pressão.",
  },
  {
    id: "receita-turismo-datas-que-voltam",
    tipo: "receita",
    title: "Turismo · As datas que voltam todo ano",
    contactTemperature: "quente",
    resultPhrase: "Você chega antes do concorrente na hora da decisão.",
    segments: ["Turismo"],
    prerequisites: ["Data de nascimento no cadastro do lead, pro passo que instala sozinho."],
    timeLabel: "25 minutos",
    // Nome técnico do gatilho: before_anchor, anchor_field data_nascimento.
    whatHappens:
      "Instala sozinho um passo: 45 dias antes do aniversário do lead, buscado no cadastro, hora fixa 9h, sem saída por resposta.",
    partialInstallNote:
      "Só o aniversário da pessoa tem âncora real no sistema hoje. Aniversário de casamento e época de férias ficam abaixo, prontos pra copiar — monte à mão em Cadências quando tiver a data de cada lead.",
    cadenceName: "Datas que voltam todo ano",
    cadenceDescription: "Cadência ancorada no aniversário do lead, instalada pela Vexo Academy.",
    templates: [
      {
        label: "45 dias antes do aniversário",
        message:
          "{{nome}}, seu aniversário tá chegando e eu lembrei de você.\nTem algum lugar que você sempre quis conhecer? Me conta que eu monto um roteiro com preço, sem compromisso.",
        trigger_type: "before_anchor",
        trigger_value: 45,
        trigger_unit: "days",
        trigger_direction: "before",
        anchor_field: "data_nascimento",
        scheduled_time: "09:00",
      },
    ],
    manualSteps: [
      {
        label: "60 dias antes do aniversário de casamento",
        message:
          "{{nome}}, faltam dois meses pro aniversário de vocês — é o prazo ideal pra fechar viagem com preço bom.\nQuer que eu monte duas opções, uma mais curta e uma mais completa?",
      },
      {
        label: "90 dias antes da época de férias",
        message: "{{nome}}, ano passado vocês viajaram nessa época.\nSe a ideia se repetir, agora é a hora de olhar preço. Quer que eu pesquise?",
      },
    ],
    screenNote:
      "Uma mensagem por ano, por data. Não monte cadência de três passos aqui — quem não respondeu à lembrança de aniversário não vai responder à cobrança dela. Lead sem a data preenchida é pulado automaticamente.",
  },
  {
    id: "receita-turismo-quem-voltou",
    tipo: "receita",
    title: "Turismo · Quem acabou de voltar",
    contactTemperature: "quente",
    resultPhrase: "Avaliação enquanto a viagem está fresca, e indicação de quem está satisfeito.",
    segments: ["Turismo"],
    prerequisites: ["Um campo de data de retorno no cadastro do lead — ainda não existe no sistema."],
    timeLabel: "20 minutos, montando à mão",
    whatHappens: "Ainda não instala sozinho: depende de uma data de retorno que o cadastro do lead não guarda hoje.",
    installable: false,
    notInstallableReason:
      "Falta um campo de data de retorno no cadastro do lead — sem ele o sistema não tem quando disparar. Os textos abaixo estão prontos pra copiar e montar à mão assim que esse campo existir.",
    cadenceName: "Quem acabou de voltar",
    cadenceDescription: "Cadência de avaliação e indicação após o retorno da viagem — ainda montada à mão.",
    templates: [],
    manualSteps: [
      {
        label: "Passo 1 — 2 dias depois da volta",
        message: "{{nome}}, e aí, como foi?\nConta o que você mais gostou — e se teve algo que eu podia ter feito melhor, fala sem dó.",
      },
      {
        label: "Passo 2 — 10 dias depois da volta",
        message: "{{nome}}, que bom que deu certo!\nSe alguém aí tiver falando em viajar, manda meu contato. Quem chega por indicação eu atendo com todo cuidado.",
      },
    ],
    screenNote:
      "A primeira mensagem não pede nada — pergunta, e abre espaço para reclamação. Cliente que teve problema e foi ouvido vira fiel; cliente que teve problema e recebeu pedido de indicação vira ex-cliente. Por isso a saída por resposta vai importar aqui, quando isso puder ser montado.",
  },
  {
    id: "receita-contabilidade-proposta-sem-resposta",
    tipo: "receita",
    title: "Contabilidade · Proposta de honorários sem resposta",
    contactTemperature: "morno",
    resultPhrase: "Quem pediu valor e sumiu volta a responder.",
    segments: ["Contabilidade"],
    prerequisites: ["Leads com proposta enviada."],
    timeLabel: "20 minutos",
    whatHappens: "Cadência de 3 passos, 3, 7 e 15 dias, hora fixa 9h, com as três saídas.",
    cadenceName: "Proposta sem resposta",
    cadenceDescription: "Cadência de 3 toques para proposta de honorários sem resposta, instalada pela Vexo Academy.",
    templates: [
      {
        label: "Passo 1 — 3 dias depois",
        message: "{{nome}}, conseguiu ver a proposta?",
        trigger_type: "after_enrollment",
        trigger_value: 3,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "09:00",
      },
      {
        label: "Passo 2 — 7 dias depois",
        message:
          "{{nome}}, a dúvida que mais escuto é se a troca dá trabalho.\nNa prática quem cuida somos nós: pedimos os documentos ao escritório atual, conferimos o que está pendente e assumimos sem você perder prazo nenhum. Quer que eu te mande como funciona?",
        trigger_type: "after_enrollment",
        trigger_value: 7,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "09:00",
      },
      {
        label: "Passo 3 — 15 dias depois",
        message:
          "{{nome}}, vou parar por aqui pra não incomodar.\nSe preferir rever isso na virada do ano, que é quando a troca fica mais simples, me avisa que eu te procuro em novembro.",
        trigger_type: "after_enrollment",
        trigger_value: 15,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "09:00",
      },
    ],
    screenNote:
      'Em contabilidade o silêncio quase nunca é preço — é medo de trocar. O passo 2 responde a objeção que ninguém verbaliza. O passo 3 transforma "não" em "depois", que é agendável.',
  },
  {
    id: "receita-contabilidade-avisar-prazo",
    tipo: "receita",
    title: "Contabilidade · Avisar prazo antes de perguntarem",
    contactTemperature: "quente",
    resultPhrase: "Menos ligação aflita, e o escritório aparecendo como quem cuida.",
    segments: ["Contabilidade"],
    prerequisites: ["Clientes ativos no Banco."],
    timeLabel: "30 minutos",
    whatHappens:
      'Ainda não instala sozinho: a data de cada aviso muda por cliente e por obrigação, e o sistema não tem como saber qual é na hora de escrever o conteúdo.',
    installable: false,
    // Nome técnico do gatilho: fixed_date.
    notInstallableReason:
      "As datas mudam por cliente e por obrigação — não tem como instalar isso sozinho sem inventar uma data. Monte em Follow-up → Cadências com gatilho de data fixa, preenchendo a data real de cada aviso. Os três textos abaixo estão prontos pra copiar.",
    cadenceName: "Avisar prazo antes de perguntarem",
    cadenceDescription: "Cadência de avisos de prazo fiscal, montada à mão por cliente e obrigação.",
    templates: [],
    manualSteps: [
      {
        label: "15 dias antes do prazo",
        message: "Bom dia, {{nome}}. O prazo de {{obrigacao}} vence dia {{data}}.\nDo seu lado precisamos de {{documento}}. Se já mandou, ignora — é só pra não pegar de surpresa.",
      },
      {
        label: "3 dias antes do prazo",
        message: "{{nome}}, faltam três dias pro prazo de {{obrigacao}} e ainda estamos sem {{documento}}.\nConsegue mandar hoje? Se tiver dificuldade, me chama.",
      },
      {
        label: "No dia seguinte à entrega, às 17h",
        message: "{{nome}}, {{obrigacao}} entregue, tudo certo.\nGuarda o comprovante — se precisar em banco ou licitação, já está à mão.",
      },
    ],
    screenNote:
      "A terceira mensagem parece dispensável e é a mais valiosa: é a única vez no mês em que o cliente vê o trabalho acontecendo. Escritório que só aparece cobrando documento é lembrado como cobrança.",
  },
  {
    id: "receita-contabilidade-documentos-cliente-novo",
    tipo: "receita",
    title: "Contabilidade · Documentos do cliente novo",
    contactTemperature: "quente",
    resultPhrase: "A abertura da conta anda sozinha.",
    segments: ["Contabilidade"],
    prerequisites: ["O cliente novo cadastrado."],
    timeLabel: "25 minutos",
    whatHappens: "Cadência de 3 passos, 0, 3 e 7 dias, hora fixa 10h, com saída por atendimento humano. Passo 1 com anexo em PDF.",
    cadenceName: "Documentos do cliente novo",
    cadenceDescription: "Cadência de coleta de documentos do cliente novo, instalada pela Vexo Academy.",
    requiresAttachment: true,
    templates: [
      {
        label: "Passo 1 — no dia (com anexo)",
        message: "{{nome}}, bem-vindo!\nPra começar preciso de alguns documentos — a lista tá em anexo, é curta. Pode mandar por foto aqui mesmo, não precisa scanner.",
        trigger_type: "after_enrollment",
        trigger_value: 0,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "10:00",
        hasAttachment: true,
      },
      {
        label: "Passo 2 — 3 dias depois",
        message: "{{nome}}, conseguiu separar os documentos?\nSe faltar algum, me diz qual — vários a gente consegue pela via oficial e você nem precisa procurar.",
        trigger_type: "after_enrollment",
        trigger_value: 3,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "10:00",
      },
      {
        label: "Passo 3 — 7 dias depois",
        message: "{{nome}}, sem os documentos a gente não consegue começar, e o prazo corre igual.\nManda o que você já tiver, mesmo incompleto — a gente começa e vai completando.",
        trigger_type: "after_enrollment",
        trigger_value: 7,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "10:00",
      },
    ],
    screenNote:
      '"Pode mandar por foto" tira o obstáculo real, que é achar que precisa digitalizar. "Manda o que você já tiver" quebra a paralisia de quem espera juntar tudo. A saída por atendimento humano é obrigatória aqui: quando o cliente começar a mandar documento, alguém vai responder, e a cobrança automática precisa parar.',
  },
  {
    id: "receita-comercio-local-comprou-nao-voltou",
    tipo: "receita",
    title: "Comércio local · Cliente que comprou e não voltou",
    contactTemperature: "morno",
    resultPhrase: "Cliente antigo volta a aparecer na loja.",
    segments: ["Comércio local"],
    prerequisites: ["Leads com compra registrada."],
    timeLabel: "20 minutos",
    whatHappens:
      "Cadência de 3 passos, 30, 60 e 90 dias depois da inscrição, hora fixa 10h, com saídas respondeu / virou cliente / atendimento humano assumiu.",
    cadenceName: "Cliente que comprou e não voltou",
    cadenceDescription: "Cadência de retorno para cliente que comprou e sumiu, instalada pela Vexo Academy.",
    templates: [
      {
        label: "Passo 1 — 30 dias depois",
        message: "{{nome}}, tudo bem? Chegou coisa nova aqui.\nQuer que eu te mande foto?",
        trigger_type: "after_enrollment",
        trigger_value: 30,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "10:00",
      },
      {
        label: "Passo 2 — 60 dias depois",
        message:
          "{{nome}}, separei uma coisa que tem a ver com o que você levou da última vez.\nTe mando foto ou prefere passar aqui pra ver?",
        trigger_type: "after_enrollment",
        trigger_value: 60,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "10:00",
      },
      {
        label: "Passo 3 — 90 dias depois",
        message:
          "{{nome}}, vou parar de te mandar novidade pra não encher.\nSe quiser voltar a receber quando chegar coisa nova, é só me falar.",
        trigger_type: "after_enrollment",
        trigger_value: 90,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "10:00",
      },
    ],
    screenNote:
      "Comércio local vive de frequência, não de conversão. A primeira mensagem não vende nada — só lembra que a loja existe. Desconto no primeiro contato ensina o cliente a esperar desconto.",
  },
  {
    id: "receita-comercio-local-perguntou-preco",
    tipo: "receita",
    title: "Comércio local · Perguntou o preço e não voltou",
    contactTemperature: "morno",
    resultPhrase: "Quem pediu preço no WhatsApp e sumiu responde.",
    segments: ["Comércio local"],
    prerequisites: ["Leads que pediram orçamento."],
    timeLabel: "20 minutos",
    whatHappens: "Cadência de 3 passos, 1, 3 e 8 dias depois da inscrição, hora fixa 14h, com as três saídas.",
    cadenceName: "Perguntou o preço e não voltou",
    cadenceDescription: "Cadência de retorno para quem pediu preço e sumiu, instalada pela Vexo Academy.",
    templates: [
      {
        label: "Passo 1 — 1 dia depois",
        message: "{{nome}}, conseguiu ver o preço?",
        trigger_type: "after_enrollment",
        trigger_value: 1,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "14:00",
      },
      {
        label: "Passo 2 — 3 dias depois",
        message:
          "{{nome}}, ainda tenho esse aqui separado.\nSe ficou caro, me fala quanto você pensava em gastar que eu vejo o que consigo fazer.",
        trigger_type: "after_enrollment",
        trigger_value: 3,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "14:00",
      },
      {
        label: "Passo 3 — 8 dias depois",
        message: "{{nome}}, vou liberar a peça pra outro cliente.\nSe ainda quiser, me responde hoje que eu seguro.",
        trigger_type: "after_enrollment",
        trigger_value: 8,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "14:00",
      },
    ],
    screenNote:
      'O passo 3 só funciona se for verdade. Se você não vai liberar nada, troque por "me avisa se mudar de ideia" — cliente de bairro descobre blefe e a loja perde mais do que ganhou.',
  },
  {
    id: "receita-comercio-local-lista-quer-saber-primeiro",
    tipo: "receita",
    title: "Comércio local · Lista de quem quer saber primeiro",
    contactTemperature: "quente",
    resultPhrase: "Novidade vira venda no mesmo dia, sem disparo para base fria.",
    segments: ["Comércio local"],
    prerequisites: ["Clientes que já compraram."],
    timeLabel: "15 minutos",
    whatHappens: "Cadência de 1 passo, no dia da inscrição, hora fixa 9h, com saída por atendimento humano.",
    cadenceName: "Lista de quem quer saber primeiro",
    cadenceDescription: "Aviso de novidade para quem já comprou, instalado pela Vexo Academy.",
    templates: [
      {
        label: "Passo único — no dia",
        message: "{{nome}}, chegou o que você tinha perguntado.\nTenho poucas peças. Quer que eu separe uma no seu nome?",
        trigger_type: "after_enrollment",
        trigger_value: 0,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "09:00",
      },
    ],
    screenNote:
      "Um passo só, de propósito. Esta é a lista de quem já comprou — insistir aqui queima a única base que responde de verdade. Enrole manualmente quando a novidade chegar, em vez de deixar rodando.",
  },
  {
    id: "receita-prestadores-servico-orcamento-sem-resposta",
    tipo: "receita",
    title: "Prestadores de serviço · Orçamento de serviço sem resposta",
    contactTemperature: "morno",
    resultPhrase: "Orçamento parado vira serviço agendado.",
    segments: ["Prestadores de serviço"],
    prerequisites: ["Leads com orçamento enviado."],
    timeLabel: "20 minutos",
    whatHappens: "Cadência de 3 passos, 2, 5 e 10 dias depois da inscrição, hora fixa 8h, com as três saídas.",
    cadenceName: "Orçamento de serviço sem resposta",
    cadenceDescription: "Cadência de retorno para orçamento de serviço sem resposta, instalada pela Vexo Academy.",
    templates: [
      {
        label: "Passo 1 — 2 dias depois",
        message: "{{nome}}, conseguiu ver o orçamento?",
        trigger_type: "after_enrollment",
        trigger_value: 2,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "08:00",
      },
      {
        label: "Passo 2 — 5 dias depois",
        message:
          "{{nome}}, uma coisa que costuma pesar na decisão: o preço que passei já inclui material e a garantia do serviço.\nSe você recebeu outro mais barato, vale conferir se inclui os dois.",
        trigger_type: "after_enrollment",
        trigger_value: 5,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "08:00",
      },
      {
        label: "Passo 3 — 10 dias depois",
        message:
          "{{nome}}, minha agenda da semana que vem ainda tem espaço.\nSe quiser resolver isso agora, consigo encaixar. Depois disso só no mês que vem.",
        trigger_type: "after_enrollment",
        trigger_value: 10,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "08:00",
      },
    ],
    screenNote:
      'Em serviço, o concorrente mais barato quase sempre é mais barato porque tirou alguma coisa. O passo 2 não ataca ninguém — dá ao cliente o critério de comparação. E agenda cheia é argumento honesto quando é verdade: é o que separa "estou insistindo" de "estou te avisando".',
  },
  {
    id: "receita-prestadores-servico-depois-do-servico",
    tipo: "receita",
    title: "Prestadores de serviço · Depois do serviço feito",
    contactTemperature: "quente",
    resultPhrase: "Avaliação enquanto o serviço está fresco, e indicação de quem ficou satisfeito.",
    segments: ["Prestadores de serviço"],
    prerequisites: ["Serviço concluído."],
    timeLabel: "20 minutos",
    whatHappens: "Cadência de 2 passos, 2 e 10 dias depois da inscrição, hora fixa 11h, com saída por atendimento humano.",
    cadenceName: "Depois do serviço feito",
    cadenceDescription: "Cadência de avaliação e indicação após o serviço, instalada pela Vexo Academy.",
    templates: [
      {
        label: "Passo 1 — 2 dias depois",
        message: "{{nome}}, ficou tudo certo com o serviço?\nSe tiver alguma coisa pra ajustar, me fala que eu volto lá.",
        trigger_type: "after_enrollment",
        trigger_value: 2,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "11:00",
      },
      {
        label: "Passo 2 — 10 dias depois",
        message:
          "{{nome}}, que bom!\nSe alguém aí precisar, passa meu contato. Quem vem por indicação eu atendo na frente.",
        trigger_type: "after_enrollment",
        trigger_value: 10,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "11:00",
      },
    ],
    screenNote:
      "A primeira mensagem oferece voltar, e é isso que faz o cliente responder. Quem pede indicação antes de perguntar se deu certo descobre o problema pela avaliação ruim.",
  },
  {
    id: "receita-prestadores-servico-buraco-agenda",
    tipo: "receita",
    title: "Prestadores de serviço · Semana com buraco na agenda",
    contactTemperature: "quente",
    resultPhrase: "Dia vazio vira dia de serviço, sem gastar lista nova.",
    segments: ["Prestadores de serviço"],
    prerequisites: ["Clientes antigos no Banco."],
    timeLabel: "15 minutos",
    whatHappens: "Cadência de 1 passo, no dia da inscrição, hora fixa 8h, com saída por atendimento humano.",
    cadenceName: "Semana com buraco na agenda",
    cadenceDescription: "Aviso de horário livre para clientes antigos, instalado pela Vexo Academy.",
    templates: [
      {
        label: "Passo único — no dia",
        message:
          "{{nome}}, tô com um horário livre essa semana.\nTem alguma coisa aí pra resolver? Se tiver, encaixo sem custo de deslocamento.",
        trigger_type: "after_enrollment",
        trigger_value: 0,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "08:00",
      },
    ],
    screenNote:
      "Enrole só quem já foi cliente e só quando o buraco existir. Mandar isso toda semana vira ruído, e o cliente para de ler — é a mensagem que mais funciona e a mais fácil de estragar por repetição.",
  },
  {
    id: "receita-permuta-empresa-nao-associada",
    tipo: "receita",
    title: "Clubes de permuta e redes de negócios · Empresa que ainda não é associada",
    contactTemperature: "frio",
    resultPhrase: "Empresa entende permuta sem achar que é troca de favor.",
    segments: ["Clubes de permuta e redes de negócios"],
    prerequisites: ["Lista de empresas da região."],
    timeLabel: "25 minutos",
    whatHappens: "Cadência de 4 passos, 0, 3, 7 e 14 dias depois da inscrição, hora fixa 9h, com as três saídas.",
    cadenceName: "Empresa que ainda não é associada",
    cadenceDescription: "Cadência de apresentação de permuta para empresa não associada, instalada pela Vexo Academy.",
    templates: [
      {
        label: "Passo 1 — no dia",
        message: "{{nome}}, tudo bem?\nSua empresa vende {{produto}}, certo?",
        trigger_type: "after_enrollment",
        trigger_value: 0,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "09:00",
      },
      {
        label: "Passo 2 — 3 dias depois",
        message:
          "{{nome}}, é o seguinte: existe uma rede de empresas que compram e vendem entre si sem usar dinheiro.\nVocê vende o que já vende, recebe em crédito, e usa esse crédito pra comprar de outras empresas da rede. Quer entender melhor?",
        trigger_type: "after_enrollment",
        trigger_value: 3,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "09:00",
      },
      {
        label: "Passo 3 — 7 dias depois",
        message:
          '{{nome}}, a dúvida que todo mundo tem é essa: "crédito não paga meu fornecedor".\nNão paga mesmo. O que ele faz é ocupar o que ia ficar parado — mesa vazia, hora livre, estoque encalhado — e virar coisa que você ia pagar em dinheiro.\nFaz sentido pro seu caso?',
        trigger_type: "after_enrollment",
        trigger_value: 7,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "09:00",
      },
      {
        label: "Passo 4 — 14 dias depois",
        message:
          "{{nome}}, vou parar por aqui.\nSe um dia sobrar capacidade aí e você quiser transformar isso em compra, me chama que eu explico em cinco minutos.",
        trigger_type: "after_enrollment",
        trigger_value: 14,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "09:00",
      },
    ],
    screenNote:
      'A abertura é de duas palavras e uma pergunta porque o contato é frio — explicar permuta na primeira mensagem faz a pessoa fechar antes de ler. A objeção real nunca é preço, é "vou receber em crédito, não em dinheiro", e ela aparece no passo 3 antes de o cliente falar. Não trate crédito como se fosse dinheiro: quem promete isso perde o associado no primeiro mês.',
  },
  {
    id: "receita-permuta-credito-parado",
    tipo: "receita",
    title: "Clubes de permuta e redes de negócios · Associado com crédito parado",
    contactTemperature: "quente",
    resultPhrase: "Crédito parado vira compra, e o associado enxerga valor na rede.",
    segments: ["Clubes de permuta e redes de negócios"],
    prerequisites: ["Associados com saldo."],
    timeLabel: "20 minutos",
    whatHappens: "Cadência de 3 passos, 0, 7 e 21 dias depois da inscrição, hora fixa 10h, com saída por resposta e por atendimento humano.",
    cadenceName: "Associado com crédito parado",
    cadenceDescription: "Cadência de ativação de crédito parado, instalada pela Vexo Academy.",
    templates: [
      {
        label: "Passo 1 — no dia",
        message: "{{nome}}, você tem crédito disponível na rede.\nO que você precisa comprar esse mês?",
        trigger_type: "after_enrollment",
        trigger_value: 0,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "10:00",
      },
      {
        label: "Passo 2 — 7 dias depois",
        message:
          "{{nome}}, tem coisa na rede que quase todo mundo esquece que dá pra comprar sem dinheiro: contabilidade, manutenção, gráfica, hospedagem, uniforme.\nQuer que eu veja quem tem disponível agora?",
        trigger_type: "after_enrollment",
        trigger_value: 7,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "10:00",
      },
      {
        label: "Passo 3 — 21 dias depois",
        message:
          "{{nome}}, crédito parado não rende — ele só espera.\nMe diz uma coisa que sua empresa vai comprar nos próximos 60 dias que eu procuro na rede.",
        trigger_type: "after_enrollment",
        trigger_value: 21,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "10:00",
      },
    ],
    screenNote:
      "Associado que não gasta o crédito é o que cancela. Esta é a cadência que mais segura a base, e ela pergunta em vez de oferecer: a lista de categorias do passo 2 existe para lembrar, não para vender.",
  },
  {
    id: "receita-permuta-associado-anunciando",
    tipo: "receita",
    title: "Clubes de permuta e redes de negócios · Associado anunciando para a rede",
    contactTemperature: "quente",
    resultPhrase: "O associado vende para dentro da rede em vez de esperar aparecer.",
    segments: ["Clubes de permuta e redes de negócios"],
    prerequisites: ["Os outros associados como base."],
    timeLabel: "15 minutos",
    whatHappens: "Cadência de 1 passo, no dia da inscrição, hora fixa 9h, com saída por atendimento humano.",
    cadenceName: "Associado anunciando para a rede",
    cadenceDescription: "Aviso de disponibilidade para outros associados, instalado pela Vexo Academy.",
    templates: [
      {
        label: "Passo único — no dia",
        message:
          "{{nome}}, tenho disponibilidade de {{produto}} esse mês pra quem é da rede.\nSe te interessa, me chama que eu reservo.",
        trigger_type: "after_enrollment",
        trigger_value: 0,
        trigger_unit: "days",
        trigger_direction: "after",
        scheduled_time: "09:00",
      },
    ],
    screenNote:
      "Um passo só. É base fechada e conhecida, então a mensagem não precisa se apresentar — e insistir dentro da própria rede é o jeito mais rápido de ficar com fama de chato entre quem você vai encontrar de novo. A mesma receita serve para qualquer associado; troque {{produto}} pelo que a empresa oferece.",
  },
];

export const ACADEMY_CONTENT: AcademyContent[] = [...ACADEMY_FUNDAMENTOS, ...ACADEMY_RECIPES];

export function getAcademyContentById(id: string): AcademyContent | undefined {
  return ACADEMY_CONTENT.find((c) => c.id === id);
}

export function isAcademyRecipe(content: AcademyContent): content is AcademyRecipe {
  return content.tipo === "receita";
}
