export interface SegmentStep {
  botMsg: string;
  leadMsg?: string;
  options?: { label: string; value: string }[];
  slots?: string[];
  reasoning: string;
  training: string;
  action: string;
  handoff?: {
    lead: string;
    meta: string;
    action: string;
    closer: string;
  };
}

export interface SlideContent {
  badge: string;
  title: string;
  subtitle: string;
}

export interface FeatureContent {
  title: string;
  desc: string;
}

export interface SegmentScenario {
  name: string;
  emoji: string;
  defaultProspectName: string;
  productName: string;
  targetLeadType: string;
  painPoint: string;
  benefit: string;
  goalAction: string;
  averageTicket: number;
  conversionImprovement: string;
  leadsCountDefault: number;
  leadCostDefault: number;
  conversionRateDefault: number;
  
  // Custom Slides
  slide1: SlideContent & {
    dor1Title: string;
    dor1Desc: string;
    dor2Title: string;
    dor2Desc: string;
  };
  slide2: SlideContent & {
    motor1Title: string;
    motor1Features: FeatureContent[];
    motor2Title: string;
    motor2Features: FeatureContent[];
  };
  slide3: SlideContent & {
    feature1Title: string;
    feature1Items: FeatureContent[];
    feature2Title: string;
    feature2Desc: string;
    feature2Highlight: string;
  };
  slide4: SlideContent & {
    cards: (FeatureContent & { icon: "users" | "bell" | "sparkles" | "check" | "clock" })[];
  };

  steps: {
    step1: SegmentStep;
    step2: Record<string, SegmentStep>;
    step3: Record<string, SegmentStep>;
    step4: Record<string, SegmentStep>;
    step5: Record<string, SegmentStep>;
  };
}

export const SEGMENTS: Record<string, SegmentScenario> = {
  academia: {
    name: "Academia & CrossFit",
    emoji: "🏋️",
    defaultProspectName: "Corpo & Ação Fitness",
    productName: "Plano Anual Premium",
    targetLeadType: "Ex-alunos inativos há mais de 3 meses",
    painPoint: "Ex-alunos parados que nunca mais foram contatados pela recepção por falta de tempo.",
    benefit: "A IA reativa a base fria enviando convites personalizados e agenda a aula experimental.",
    goalAction: "Agendar Aula Experimental",
    averageTicket: 190,
    conversionImprovement: "Reativa 3x mais alunos inativos sem esforço do time",
    leadsCountDefault: 500,
    leadCostDefault: 8,
    conversionRateDefault: 4,
    
    slide1: {
      badge: "SLIDE 01 · A EVASÃO NA ACADEMIA",
      title: "Por que sua academia tem tantas catracas ociosas?",
      subtitle: "As academias perdem alunos todos os meses e a recepção não tem braço para reativá-los individualmente.",
      dor1Title: "Base Fria Abandonada",
      dor1Desc: "Sua equipe de recepção está focada no atendimento presencial. Ex-alunos inativos viram números mortos no seu sistema.",
      dor2Title: "Baixa Conversão de Leads Sociais",
      dor2Desc: "O lead que chama no Instagram de madrugada quer matricular na hora. Sem resposta imediata, ele vai para a concorrência."
    },
    slide2: {
      badge: "SLIDE 02 · A SOLUÇÃO FITNESS",
      title: "Automação e IA para Captação e Retenção",
      subtitle: "Combinamos um atendimento focado em conversão com campanhas ativas para encher seu salão.",
      motor1Title: "Recepção Inteligente (Inbound)",
      motor1Features: [
        { title: "Respostas 24/7", desc: "A IA atende interessados, apresenta fotos, planos e quebra objeções." },
        { title: "Agendamento Experimental", desc: "A inteligência agenda o lead diretamente no seu sistema." },
        { title: "Venda de Planos Anuais", desc: "IA treinada para contornar objeções de preço e focar no benefício." }
      ],
      motor2Title: "Motor de Reativação (Outbound)",
      motor2Features: [
        { title: "Resgate de Ex-Alunos", desc: "Disparos automáticos segmentados por tempo de inatividade e foco de treino." },
        { title: "Cobrança de Vencimentos", desc: "Avisos amigáveis para planos que estão vencendo nesta semana." },
        { title: "Upsell de Personal", desc: "Oferece consultorias premium para quem já está matriculado." }
      ]
    },
    slide3: {
      badge: "SLIDE 03 · RETENÇÃO & COBRANÇA",
      title: "O Fim das Ligações de Cobrança Manuais",
      subtitle: "A IA garante que o dinheiro não pare de entrar, realizando cobranças sutis e recuperando inativos.",
      feature1Title: "Cadências Automáticas",
      feature1Items: [
        { title: "Aviso de Fim de Plano", desc: "Alerta aos alunos 7 dias antes do vencimento do contrato." },
        { title: "Recuperação de Inativos", desc: "Campanha especial com isenção de matrícula para resgate." },
        { title: "No-Show Experimental", desc: "Reagendamento automático de leads que faltaram à aula teste." }
      ],
      feature2Title: "Humanização Preservada",
      feature2Desc: "Nossa IA sabe exatamente quando parar de cobrar.",
      feature2Highlight: "Assim que o ex-aluno responde com interesse na reativação, a automação é pausada e o Closer/Recepção assume a conversa no mesmo minuto."
    },
    slide4: {
      badge: "SLIDE 04 · PERFORMANCE DA ACADEMIA",
      title: "Roteamento para os Melhores Consultores",
      subtitle: "Distribua os leads qualificados entre os seus consultores fitness baseados em métricas reais.",
      cards: [
        { icon: "users", title: "Distribuição Justa", desc: "Seja Round Robin ou por performance, garanta que os leads online cheguem ao celular dos melhores vendedores." },
        { icon: "bell", title: "Alertas de SLA (Tempo Real)", desc: "Lead qualificado que não foi atendido em 10 minutos gera um alerta vermelho para o gerente da unidade." },
        { icon: "sparkles", title: "Inteligência Comercial", desc: "Relatórios de quais horários têm mais faltas e quais planos sofrem mais objeção." }
      ]
    },
    
    steps: {
      step1: {
        botMsg: "Olá Felipe! Tudo bem? Sou a assistente virtual da {{prospectName}}. Sentimos sua falta nos nossos treinos! Preparamos uma condição especial de reativação sem taxa de matrícula este mês. Que tal agendar uma aula experimental amanhã?",
        reasoning: "A IA da {{prospectName}} inicia o contato usando o gatilho de isenção de matrícula para reativar o ex-aluno inativo.",
        training: "Seja caloroso e mencione que sentimos a falta do aluno na {{prospectName}}.",
        action: "Campanha ativa iniciada. Disparo automático para lista de ex-alunos.",
        options: [
          { label: "🗣️ 'Estou sem tempo para treinar ultimamente'", value: "optA" },
          { label: "🗣️ 'Quais são os planos atuais?'", value: "optB" },
        ],
      },
      step2: {
        optA: {
          leadMsg: "Estou sem tempo para treinar ultimamente.",
          botMsg: "Entendo perfeitamente, Felipe! Por isso na {{prospectName}} lançamos treinos expressos de 40 minutos. Para eu te direcionar o melhor plano, seu foco seria perda de peso ou massa magra?",
          reasoning: "IA da {{prospectName}} detecta objeção de tempo e oferece os novos treinos expressos.",
          training: "Contorne a falta de tempo sugerindo os treinos rápidos da {{prospectName}}.",
          action: "Lead movido para 'Qualificando'.",
          options: [
            { label: "🗣️ 'Meu foco é massa magra'", value: "optA" },
            { label: "🗣️ 'Preciso emagrecer'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Quais são os planos atuais?",
          botMsg: "Nossos planos começam em R$ 119/mês no recorrente na {{prospectName}}. Seu foco principal seria perda de peso ou massa magra?",
          reasoning: "IA da {{prospectName}} contorna objeção de preço e segue qualificando.",
          training: "Apresente o preço de entrada da {{prospectName}} e pergunte o foco físico.",
          action: "Lead movido para 'Qualificando'. Temperatura QUENTE.",
          options: [
            { label: "🗣️ 'Meu foco é massa magra'", value: "optA" },
            { label: "🗣️ 'Preciso emagrecer'", value: "optB" },
          ],
        },
      },
      step3: {
        optA: {
          leadMsg: "Meu foco é massa magra.",
          botMsg: "Show! O ganho de massa exige treino resistido regular, e nossos professores vão montar uma ficha sob medida. Qual período prefere vir à {{prospectName}} amanhã: manhã ou noite?",
          reasoning: "IA avança para a proposta de agendamento na {{prospectName}} focando em hipertrofia.",
          training: "Para ganho de massa, ofereça agendamento de manhã ou noite.",
          action: "Propriedade 'meta_comercial' = 'Hipertrofia'.",
          options: [
            { label: "🗣️ 'Prefiro de noite'", value: "optA" },
            { label: "🗣️ 'Pela manhã'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Preciso emagrecer.",
          botMsg: "Excelente! Vamos focar em acelerar seu metabolismo. Qual período prefere vir à {{prospectName}} amanhã: manhã ou noite?",
          reasoning: "IA avança para a proposta de agendamento na {{prospectName}} focando em emagrecimento.",
          training: "Para emagrecimento, ofereça agendamento de manhã ou noite.",
          action: "Propriedade 'meta_comercial' = 'Emagrecimento'.",
          options: [
            { label: "🗣️ 'Prefiro de noite'", value: "optA" },
            { label: "🗣️ 'Pela manhã'", value: "optB" },
          ],
        },
      },
      step4: {
        optA: {
          leadMsg: "Prefiro de noite.",
          botMsg: "Perfeito! Tenho vaga às 18:30 ou às 20:00 com o professor Marcos da {{prospectName}}. Qual fica melhor?",
          reasoning: "IA consulta horários noturnos da {{prospectName}}.",
          training: "Ofereça horários noturnos para agendamento.",
          action: "Integração com Agenda da {{prospectName}}.",
          slots: ["Amanhã 18:30", "Amanhã 20:00"],
        },
        optB: {
          leadMsg: "Pela manhã.",
          botMsg: "Perfeito! Tenho vaga às 07:00 ou às 08:30 com a professora Júlia da {{prospectName}}. Qual fica melhor?",
          reasoning: "IA consulta horários matutinos da {{prospectName}}.",
          training: "Ofereça horários matutinos para agendamento.",
          action: "Integração com Agenda da {{prospectName}}.",
          slots: ["Amanhã 07:00", "Amanhã 08:30"],
        },
      },
      step5: {
        "Amanhã 18:30": {
          leadMsg: "Pode ser 18:30.",
          botMsg: "Confirmado! Sua aula experimental na {{prospectName}} será amanhã às 18:30. Te esperamos lá!",
          reasoning: "Agendamento concluído na {{prospectName}}.",
          training: "Confirme a reserva e seja acolhedor.",
          action: "Handoff para a Recepção da {{prospectName}}.",
          handoff: { lead: "Ex-Aluno VIP", meta: "Foco: Noturno", action: "Aula 18:30", closer: "Recepção {{prospectName}}" }
        },
        "Amanhã 20:00": {
          leadMsg: "Marque 20:00.",
          botMsg: "Confirmado! Sua aula experimental na {{prospectName}} será amanhã às 20:00. Te esperamos lá!",
          reasoning: "Agendamento concluído na {{prospectName}}.",
          training: "Confirme a reserva e seja acolhedor.",
          action: "Handoff para a Recepção.",
          handoff: { lead: "Ex-Aluno VIP", meta: "Foco: Noturno", action: "Aula 20:00", closer: "Recepção {{prospectName}}" }
        },
        "Amanhã 07:00": {
          leadMsg: "Vou às 07:00.",
          botMsg: "Confirmado! Sua aula experimental na {{prospectName}} será amanhã às 07:00. Te esperamos lá!",
          reasoning: "Agendamento concluído na {{prospectName}}.",
          training: "Confirme a reserva e seja acolhedor.",
          action: "Handoff para a Recepção.",
          handoff: { lead: "Ex-Aluno VIP", meta: "Foco: Matutino", action: "Aula 07:00", closer: "Recepção {{prospectName}}" }
        },
        "Amanhã 08:30": {
          leadMsg: "Vou às 08:30.",
          botMsg: "Confirmado! Sua aula experimental na {{prospectName}} será amanhã às 08:30. Te esperamos lá!",
          reasoning: "Agendamento concluído na {{prospectName}}.",
          training: "Confirme a reserva e seja acolhedor.",
          action: "Handoff para a Recepção.",
          handoff: { lead: "Ex-Aluno VIP", meta: "Foco: Matutino", action: "Aula 08:30", closer: "Recepção {{prospectName}}" }
        }
      }
    }
  },

  restaurante: {
    name: "Restaurante & Delivery",
    emoji: "🍔",
    defaultProspectName: "Saboroso Grill",
    productName: "Cardápio Digital & Reservas de Mesas",
    targetLeadType: "Clientes de WhatsApp em horários de pico",
    painPoint: "Demora no atendimento via WhatsApp faz o cliente pedir no concorrente.",
    benefit: "A IA atende instantaneamente e agenda reservas integradas ao sistema.",
    goalAction: "Confirmar Reserva de Mesa",
    averageTicket: 150,
    conversionImprovement: "Aumento de 35% no volume de reservas",
    leadsCountDefault: 1000,
    leadCostDefault: 3,
    conversionRateDefault: 15,
    
    slide1: {
      badge: "SLIDE 01 · A OPERAÇÃO DO RESTAURANTE",
      title: "Por que seu restaurante perde vendas e reservas no WhatsApp?",
      subtitle: "Nos horários de pico, a demanda digital explode e a sua equipe no salão não consegue dar conta.",
      dor1Title: "Demora no Delivery e Reservas",
      dor1Desc: "O cliente faminto não espera 15 minutos por uma resposta no WhatsApp. Ele entra no iFood ou vai para o concorrente.",
      dor2Title: "Sobrecarga na Hostess/Recepção",
      dor2Desc: "A mesma pessoa que atende a porta precisa responder o WhatsApp, resultando em erros e péssimo atendimento nos dois canais."
    },
    slide2: {
      badge: "SLIDE 02 · A SOLUÇÃO DE ATENDIMENTO",
      title: "O Garçom Digital que Nunca Falha",
      subtitle: "A Inteligência Artificial atende todos os seus clientes em menos de 1 segundo, mesmo no horário de pico de sexta-feira.",
      motor1Title: "Recepção Inteligente",
      motor1Features: [
        { title: "Atendimento Imediato", desc: "A IA tira dúvidas sobre o cardápio, entrega links de delivery e horários de funcionamento." },
        { title: "Reservas Autônomas", desc: "Qualifica o tamanho da mesa (casal, grupos) e bloqueia horários no sistema da casa." },
        { title: "Redução de Filas", desc: "Otimiza a lotação organizando os horários de chegada da clientela automaticamente." }
      ],
      motor2Title: "Reengajamento e Pesquisa",
      motor2Features: [
        { title: "NPS e Feedbacks", desc: "Dispara mensagem no dia seguinte perguntando como foi a experiência no restaurante." },
        { title: "Recuperação de Abandono", desc: "Se o cliente iniciou o pedido mas sumiu, a IA faz um follow-up sutil." },
        { title: "Promoções Segmentadas", desc: "Avisos de Happy Hour ou pratos especiais para clientes frequentes." }
      ]
    },
    slide3: {
      badge: "SLIDE 03 · FOLLOW-UP",
      title: "Garanta que a Mesa não Fique Vazia",
      subtitle: "As desistências de última hora matam o faturamento da noite. Automatize as confirmações.",
      feature1Title: "Avisos de Reserva",
      feature1Items: [
        { title: "Confirmação Prévia", desc: "Mensagem automática 2h antes perguntando se a mesa está confirmada." },
        { title: "Aviso de Fila", desc: "Avisa o cliente que a mesa está sendo liberada." },
        { title: "Ofertas de Aniversário", desc: "Filtra aniversariantes da semana e convida com um voucher de sobremesa." }
      ],
      feature2Title: "Transição Suave para Equipe",
      feature2Desc: "Se o cliente tiver dúvidas complexas (ex: restrições alimentares severas),",
      feature2Highlight: "A IA pausa imediatamente e chama a gerência ou a hostess para um atendimento humano premium e sem ruídos."
    },
    slide4: {
      badge: "SLIDE 04 · INSIGHTS DO NEGÓCIO",
      title: "Analytics do Salão e do Delivery",
      subtitle: "Informações valiosas geradas pelos diálogos de inteligência artificial.",
      cards: [
        { icon: "clock", title: "Horários de Maior Gargalo", desc: "Descubra quando seus clientes mais pedem delivery e estão sendo ignorados." },
        { icon: "sparkles", title: "Pratos Mais Pesquisados", desc: "A IA identifica quais itens do cardápio geram mais dúvidas e o que os clientes mais pedem." },
        { icon: "users", title: "Distribuição Interna", desc: "Seja para a cozinha ou para o salão, a IA direciona o lead certo (pedido vs. reserva) para o setor correto." }
      ]
    },

    steps: {
      step1: {
        botMsg: "Olá! Bem-vindo(a) ao {{prospectName}}. Meu nome é Sofia, a inteligência artificial do restaurante. Em que posso te ajudar hoje?",
        reasoning: "A IA do {{prospectName}} inicia o atendimento em menos de 1 segundo em horário de pico.",
        training: "Atenda imediatamente e ofereça as opções de delivery ou reserva.",
        action: "Autoatendimento iniciado para {{prospectName}}.",
        options: [
          { label: "🗣️ 'Queria ver o cardápio'", value: "optA" },
          { label: "🗣️ 'Gostaria de fazer uma reserva'", value: "optB" },
        ],
      },
      step2: {
        optA: {
          leadMsg: "Queria ver o cardápio.",
          botMsg: "Claro! Nosso cardápio digital está aqui. Você gostaria de aproveitar e fazer uma reserva para o salão do {{prospectName}}?",
          reasoning: "IA da {{prospectName}} entrega a solução e faz cross-sell de reserva física.",
          training: "Envie o cardápio e ofereça a experiência presencial no {{prospectName}}.",
          action: "Link enviado. Tag 'Delivery'.",
          options: [
            { label: "🗣️ 'Sim, para casal'", value: "optA" },
            { label: "🗣️ 'Sim, para 6 pessoas'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Gostaria de fazer uma reserva.",
          botMsg: "Maravilha! Fico feliz que venha ao {{prospectName}}. Será uma mesa para casal ou para família/amigos?",
          reasoning: "IA da {{prospectName}} qualifica o tamanho da mesa.",
          training: "Pergunte o tamanho da mesa para reservar corretamente.",
          action: "Lead movido para 'Reserva'.",
          options: [
            { label: "🗣️ 'Seremos um casal'", value: "optA" },
            { label: "🗣️ 'Vamos em 6 pessoas'", value: "optB" },
          ],
        },
      },
      step3: {
        optA: {
          leadMsg: "Seremos um casal.",
          botMsg: "Perfeito! Uma mesa a dois no {{prospectName}}. Qual horário você prefere hoje: mais cedo ou mais tarde?",
          reasoning: "IA da {{prospectName}} reconhece perfil Casal.",
          training: "Para casais, sugira as mesas aconchegantes e pergunte o turno.",
          action: "Tag 'Mesa 2 lugares'.",
          options: [
            { label: "🗣️ 'Mais cedo'", value: "optA" },
            { label: "🗣️ 'Mais tarde'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Vamos em 6 pessoas.",
          botMsg: "Ótimo! Reservaremos uma área mais espaçosa no {{prospectName}}. Qual horário prefere: mais cedo ou mais tarde?",
          reasoning: "IA da {{prospectName}} reconhece Grupo.",
          training: "Para grupos, garanta o conforto.",
          action: "Tag 'Mesa Grupo'.",
          options: [
            { label: "🗣️ 'Mais cedo'", value: "optA" },
            { label: "🗣️ 'Mais tarde'", value: "optB" },
          ],
        },
      },
      step4: {
        optA: {
          leadMsg: "Mais cedo.",
          botMsg: "Certo! No {{prospectName}}, temos vaga às 19:00 ou 19:30. Qual fica melhor?",
          reasoning: "IA busca slots iniciais no {{prospectName}}.",
          training: "Ofereça horários iniciais.",
          action: "Integração de reservas ativada.",
          slots: ["Hoje às 19:00", "Hoje às 19:30"],
        },
        optB: {
          leadMsg: "Mais tarde.",
          botMsg: "Certo! No {{prospectName}}, temos vaga às 20:30 ou 21:00. Qual fica melhor?",
          reasoning: "IA busca slots tardios no {{prospectName}}.",
          training: "Ofereça horários tardios.",
          action: "Integração de reservas ativada.",
          slots: ["Hoje às 20:30", "Hoje às 21:00"],
        },
      },
      step5: {
        "Hoje às 19:00": {
          leadMsg: "Pode ser 19:00.",
          botMsg: "Reserva confirmada no {{prospectName}} para as 19:00! Nossa hostess estará te aguardando.",
          reasoning: "Lead confirma horário no {{prospectName}}.",
          training: "Finalize com entusiasmo.",
          action: "Mesa bloqueada.",
          handoff: { lead: "Cliente", meta: "Mesa 19:00", action: "Reserva Confirmada", closer: "Hostess {{prospectName}}" }
        },
        "Hoje às 19:30": {
          leadMsg: "Pode ser 19:30.",
          botMsg: "Reserva confirmada no {{prospectName}} para as 19:30! Nossa hostess estará te aguardando.",
          reasoning: "Lead confirma horário.",
          training: "Finalize com entusiasmo.",
          action: "Mesa bloqueada.",
          handoff: { lead: "Cliente", meta: "Mesa 19:30", action: "Reserva Confirmada", closer: "Hostess {{prospectName}}" }
        },
        "Hoje às 20:30": {
          leadMsg: "Pode ser 20:30.",
          botMsg: "Reserva confirmada no {{prospectName}} para as 20:30! Nossa hostess estará te aguardando.",
          reasoning: "Lead confirma horário.",
          training: "Finalize com entusiasmo.",
          action: "Mesa bloqueada.",
          handoff: { lead: "Cliente", meta: "Mesa 20:30", action: "Reserva Confirmada", closer: "Hostess {{prospectName}}" }
        },
        "Hoje às 21:00": {
          leadMsg: "Pode ser 21:00.",
          botMsg: "Reserva confirmada no {{prospectName}} para as 21:00! Nossa hostess estará te aguardando.",
          reasoning: "Lead confirma horário.",
          training: "Finalize com entusiasmo.",
          action: "Mesa bloqueada.",
          handoff: { lead: "Cliente", meta: "Mesa 21:00", action: "Reserva Confirmada", closer: "Hostess {{prospectName}}" }
        }
      }
    }
  },

  turismo: {
    name: "Agência de Turismo",
    emoji: "✈️",
    defaultProspectName: "Viagens Inesquecíveis",
    productName: "Pacotes Personalizados",
    targetLeadType: "Leads de tráfego pago buscando orçamento",
    painPoint: "Orçamentos manuais levam muito tempo e o lead esfria.",
    benefit: "A IA qualifica o destino e agenda a reunião com o agente imediatamente.",
    goalAction: "Agendar Call",
    averageTicket: 7500,
    conversionImprovement: "Triplica as reuniões",
    leadsCountDefault: 300,
    leadCostDefault: 20,
    conversionRateDefault: 3,

    slide1: {
      badge: "SLIDE 01 · GARGALO EM VENDAS DE VIAGENS",
      title: "Por que as agências perdem leads de alto valor no WhatsApp?",
      subtitle: "Montar orçamentos de viagens é complexo e demorado. Nesse meio tempo, o lead procura seu concorrente.",
      dor1Title: "A Demora na Cotação",
      dor1Desc: "Agentes de viagem levam horas ou dias para montar um roteiro personalizado. Até lá, o lead que veio do tráfego pago esfriou.",
      dor2Title: "Qualificação Manual Ineficiente",
      dor2Desc: "O agente passa mais tempo fazendo perguntas básicas de triagem (destino, datas) do que fechando o pacote de viagem em si."
    },
    slide2: {
      badge: "SLIDE 02 · A SOLUÇÃO DE INTELIGÊNCIA",
      title: "O Primeiro Atendimento Automatizado de Alto Valor",
      subtitle: "A IA absorve a carga da triagem e agenda a call do passageiro diretamente com o Agente Especialista.",
      motor1Title: "Consultor IA (Inbound)",
      motor1Features: [
        { title: "Descoberta de Destino", desc: "A IA faz perguntas sutis para descobrir o estilo da viagem, datas e destino." },
        { title: "Aquecimento do Lead", desc: "Engaja o viajante mandando curiosidades ou opções rápidas enquanto a cotação real é preparada." },
        { title: "Agendamento da Call", desc: "Marca a reunião com o Agente humano para apresentação da proposta de roteiro." }
      ],
      motor2Title: "Follow-up Seguro (Outbound)",
      motor2Features: [
        { title: "Cobrança Pós-Envio", desc: "Verifica se o cliente gostou da cotação sem parecer invasivo." },
        { title: "Retenção Pós-Viagem", desc: "Coleta feedback e já inicia o plantio para as férias do próximo ano." },
        { title: "Reativação de Frios", desc: "Promoções ativas com passagens ou pacotes em bloqueio aéreo para contatos antigos." }
      ]
    },
    slide3: {
      badge: "SLIDE 03 · REENGAJAMENTO & COTAÇÕES",
      title: "O Timing Perfeito para a Viagem",
      subtitle: "O setor de turismo depende muito do timing certo. Cadências prontas solucionam isso.",
      feature1Title: "Persistência Pós-Cotação",
      feature1Items: [
        { title: "Aviso de Virada de Lote", desc: "Alerta automático de que aéreo/hotel vão sofrer reajuste se não fecharem hoje." },
        { title: "No-Show de Reunião", desc: "Mensagem automática remarcando quem não apareceu na call do roteiro." },
        { title: "Recuperação Anual", desc: "Se ele viajou ano passado, o motor avisa que já é hora de planejar a próxima." }
      ],
      feature2Title: "Handoff Consultivo",
      feature2Desc: "Assim que o viajante responde a cadência mostrando urgência para fechar,",
      feature2Highlight: "A IA aciona o consultor VIP, entregando todo o resumo do destino no CRM, para um fechamento humanizado via ligação."
    },
    slide4: {
      badge: "SLIDE 04 · DESEMPENHO DA AGÊNCIA",
      title: "Roteamento Inteligente de Leads",
      subtitle: "Direcione o passageiro para o Especialista de Destino correto automaticamente.",
      cards: [
        { icon: "users", title: "Roteamento por Destino", desc: "O lead quer Disney? Manda para o consultor X. Quer Europa? Manda para Y." },
        { icon: "bell", title: "Alerta de Urgência", desc: "Se o lead quer viajar no próximo feriado, ele fura a fila do SLA no CRM da agência." },
        { icon: "sparkles", title: "IA Analítica", desc: "Identifica quais destinos estão sendo mais procurados nas mensagens do mês." }
      ]
    },

    steps: {
      step1: {
        botMsg: "Olá! Vi que você se interessou pelos pacotes da {{prospectName}}. Você está buscando um destino Nacional ou Internacional?",
        reasoning: "A IA da {{prospectName}} aborda o lead do anúncio e qualifica o tipo de viagem.",
        training: "Qualifique imediatamente se a intenção é Nacional ou Internacional.",
        action: "Lead de {{prospectName}} em Atendimento.",
        options: [
          { label: "🗣️ 'Nacionais'", value: "optA" },
          { label: "🗣️ 'Internacional'", value: "optB" },
        ],
      },
      step2: {
        optA: {
          leadMsg: "Estou procurando opções Nacionais.",
          botMsg: "Que delícia! Nossos roteiros no Nordeste da {{prospectName}} são perfeitos. Você quer viajar logo ou pro fim do ano?",
          reasoning: "IA da {{prospectName}} valida Nacional e filtra timing.",
          training: "Sugira Nordeste e pergunte o timing da viagem.",
          action: "Tag 'Viagem Nacional'.",
          options: [
            { label: "🗣️ 'Fim do ano / Ano que vem'", value: "optA" },
            { label: "🗣️ 'Próximos 2 a 3 meses'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Quero um destino Internacional.",
          botMsg: "Excelente! Aqui na {{prospectName}} adoramos Europa e Caribe. Você quer viajar logo ou pro fim do ano?",
          reasoning: "IA da {{prospectName}} valida Internacional e filtra timing.",
          training: "Sugira Europa/Caribe e pergunte o timing.",
          action: "Tag 'Viagem Internacional'.",
          options: [
            { label: "🗣️ 'Fim do ano / Ano que vem'", value: "optA" },
            { label: "🗣️ 'Próximos 2 a 3 meses'", value: "optB" },
          ],
        },
      },
      step3: {
        optA: {
          leadMsg: "Para as férias mais pro final do ano.",
          botMsg: "Maravilha! O Agente da {{prospectName}} montará opções exclusivas. Vamos agendar um bate-papo rápido amanhã: manhã ou tarde?",
          reasoning: "IA convida lead de longo prazo para call com especialista da {{prospectName}}.",
          training: "Convide para a call de apresentação de roteiros.",
          action: "Timing 'Longo Prazo'.",
          options: [
            { label: "🗣️ 'Pela manhã'", value: "optA" },
            { label: "🗣️ 'À tarde'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Próximos 2 a 3 meses.",
          botMsg: "Ótimo, na {{prospectName}} temos bloqueios aéreos fantásticos de última hora! Vamos agendar um bate-papo amanhã: manhã ou tarde?",
          reasoning: "IA cria urgência no lead de curto prazo na {{prospectName}}.",
          training: "Crie escassez positiva e ofereça call urgente.",
          action: "Timing 'Curto Prazo'.",
          options: [
            { label: "🗣️ 'Pela manhã'", value: "optA" },
            { label: "🗣️ 'À tarde'", value: "optB" },
          ],
        },
      },
      step4: {
        optA: {
          leadMsg: "Pela manhã.",
          botMsg: "Perfeito! Tenho a agenda da Mariana, especialista da {{prospectName}}. Qual horário fica melhor amanhã?",
          reasoning: "Busca disponibilidade matutina do Agente da {{prospectName}}.",
          training: "Ofereça horários matutinos.",
          action: "Consulta agenda da {{prospectName}}.",
          slots: ["Amanhã 09:30", "Amanhã 10:30"],
        },
        optB: {
          leadMsg: "À tarde.",
          botMsg: "Perfeito! Tenho a agenda da Mariana, especialista da {{prospectName}}. Qual horário fica melhor amanhã?",
          reasoning: "Busca disponibilidade vespertina do Agente da {{prospectName}}.",
          training: "Ofereça horários vespertinos.",
          action: "Consulta agenda da {{prospectName}}.",
          slots: ["Amanhã 14:30", "Amanhã 16:00"],
        },
      },
      step5: {
        "Amanhã 09:30": {
          leadMsg: "Pode ser 09:30.",
          botMsg: "Confirmado! A Mariana da {{prospectName}} fará a chamada amanhã às 09:30 com seu orçamento.",
          reasoning: "Call agendada no sistema da {{prospectName}}.",
          training: "Confirme a call e transfira pro agente.",
          action: "Handoff enviado para Mariana.",
          handoff: { lead: "Viajante", meta: "Call 09:30", action: "Reunião", closer: "Mariana" }
        },
        "Amanhã 10:30": {
          leadMsg: "Pode ser 10:30.",
          botMsg: "Confirmado! A Mariana da {{prospectName}} fará a chamada amanhã às 10:30 com seu orçamento.",
          reasoning: "Call agendada.",
          training: "Confirme a call.",
          action: "Handoff enviado para Mariana.",
          handoff: { lead: "Viajante", meta: "Call 10:30", action: "Reunião", closer: "Mariana" }
        },
        "Amanhã 14:30": {
          leadMsg: "Pode ser 14:30.",
          botMsg: "Confirmado! A Mariana da {{prospectName}} fará a chamada amanhã às 14:30 com seu orçamento.",
          reasoning: "Call agendada.",
          training: "Confirme a call.",
          action: "Handoff enviado para Mariana.",
          handoff: { lead: "Viajante", meta: "Call 14:30", action: "Reunião", closer: "Mariana" }
        },
        "Amanhã 16:00": {
          leadMsg: "Pode ser 16:00.",
          botMsg: "Confirmado! A Mariana da {{prospectName}} fará a chamada amanhã às 16:00 com seu orçamento.",
          reasoning: "Call agendada.",
          training: "Confirme a call.",
          action: "Handoff enviado para Mariana.",
          handoff: { lead: "Viajante", meta: "Call 16:00", action: "Reunião", closer: "Mariana" }
        }
      }
    }
  },

  b2b: {
    name: "Consultoria & CRM",
    emoji: "💼",
    defaultProspectName: "Tech Sales Corp",
    productName: "Automação Vexo OS",
    targetLeadType: "Leads B2B qualificáveis",
    painPoint: "Leads caros não são atendidos a tempo pela equipe de vendas, gerando enorme custo de aquisição (CAC).",
    benefit: "A IA qualifica B2B instantaneamente e agenda calls com os diretores de forma 100% automatizada.",
    goalAction: "Agendar Reunião B2B",
    averageTicket: 3000,
    conversionImprovement: "Reduz o ciclo de vendas em 40%",
    leadsCountDefault: 150,
    leadCostDefault: 45,
    conversionRateDefault: 8,

    slide1: {
      badge: "SLIDE 01 · O GARGALO COMERCIAL NO WHATSAPP",
      title: "Por que a sua empresa perde vendas no WhatsApp todos os dias?",
      subtitle: "A maioria das operações não consegue responder em tempo recorde ou perde o controle do relacionamento com leads frios.",
      dor1Title: "Leads Parados e Frios na Base",
      dor1Desc: "Ligar ou enviar mensagens manualmente consome horas do dia do comercial, gerando baixas taxas de resposta.",
      dor2Title: "Risco Alto de Banimento de Chips",
      dor2Desc: "Disparar campanhas manuais sem inteligência resulta em denúncias e o bloqueio de números da empresa."
    },
    slide2: {
      badge: "SLIDE 02 · A SOLUÇÃO VEXO OS",
      title: "Os Dois Motores da Automação Comercial",
      subtitle: "Combinando Inteligência Artificial de atendimento à maior infraestrutura de disparos seguros do mercado.",
      motor1Title: "Motor de Atendimento (Inbound)",
      motor1Features: [
        { title: "Qualificação B2B com IA", desc: "Respostas baseadas em treinamento para qualificar leads de alto valor 24/7." },
        { title: "Contorno de Objeções", desc: "IA programada para rebater objeções corporativas e guiar ao fechamento." },
        { title: "Agendamento Automático", desc: "Sincronização nativa para agendar calls nos calendários dos Closers." }
      ],
      motor2Title: "Motor de Disparos (Outbound)",
      motor2Features: [
        { title: "Distribuição Multi-Chip", desc: "Campanhas B2B disparadas dividindo a carga entre vários números comerciais." },
        { title: "Aquecimento Inteligente", desc: "Simulação automática de conversas humanas para blindar os chips." },
        { title: "Follow-up de Longo Prazo", desc: "Cobrança automática de propostas comerciais de ticket alto." }
      ]
    },
    slide3: {
      badge: "SLIDE 03 · FOLLOW-UP E REENGAJAMENTO",
      title: "Persistência Sem Esforço no B2B",
      subtitle: "Não dependa da memória do SDR. Automatize a persistência corporativa com cadência ativa e pausa inteligente.",
      feature1Title: "Cadências Prontas B2B",
      feature1Items: [
        { title: "Lembrete Pré-Reunião", desc: "Envia mensagens automáticas aos diretores antes da call, diminuindo no-shows." },
        { title: "Cobrança de Proposta", desc: "Relembra o lead corporativo sobre a proposta enviada de forma elegante." },
        { title: "Reativação de Contratos Frios", desc: "Resgata negociações que esfriaram em quarters anteriores." }
      ],
      feature2Title: "Pausa Automática Pós-Resposta",
      feature2Desc: "O maior risco no B2B é parecer um robô chato.",
      feature2Highlight: "Assim que o decisor responde, a cadência é pausada. O Closer sênior recebe uma notificação e assume o negócio."
    },
    slide4: {
      badge: "SLIDE 04 · GOVERNANÇA COMERCIAL B2B",
      title: "Roteamento Inteligente & Governança",
      subtitle: "Distribua os leads B2B baseados em níveis de expertise e controle as SLAs do time.",
      cards: [
        { icon: "users", title: "Distribuição Round Robin", desc: "Direciona leads inbound balanceando o peso e a taxa de conversão do SDR." },
        { icon: "bell", title: "Alertas de SLA Estrito", desc: "Tempo é dinheiro. Lead qualificado B2B que não for contatado em 5 min gera alerta." },
        { icon: "sparkles", title: "Diagnósticos Vexo Brain", desc: "IA analisa conversas inteiras para identificar as objeções de mercado mais citadas." }
      ]
    },

    steps: {
      step1: {
        botMsg: "Olá! Tudo bem? Sou do time de vendas da {{prospectName}}. Recebemos o seu contato. Para eu acionar nosso executivo correto, qual o principal desafio da sua operação hoje?",
        reasoning: "A IA da {{prospectName}} foca na dor principal (B2B) logo na abordagem inicial.",
        training: "Ao atender leads B2B, aja com postura executiva.",
        action: "Lead B2B em Triagem na {{prospectName}}.",
        options: [
          { label: "🗣️ 'Aumentar conversão'", value: "optA" },
          { label: "🗣️ 'Reduzir custos'", value: "optB" },
        ],
      },
      step2: {
        optA: {
          leadMsg: "Aumentar a conversão de vendas.",
          botMsg: "Excelente desafio. A {{prospectName}} é especialista em aumentar a conversão melhorando o tempo de resposta. A sua equipe de vendas atua mais ativamente no Inbound ou Outbound?",
          reasoning: "IA da {{prospectName}} valida o contexto corporativo e mapeia o setor comercial.",
          training: "Pergunte sobre a composição da equipe.",
          action: "Filtro comercial ativo.",
          options: [
            { label: "🗣️ 'Time focado em Inbound'", value: "optA" },
            { label: "🗣️ 'Operação forte no Outbound'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Quero reduzir os custos de aquisição.",
          botMsg: "Entendi. A {{prospectName}} consegue reduzir o CAC automatizando tarefas manuais. Sua equipe atual foca mais em Inbound ou Outbound?",
          reasoning: "IA da {{prospectName}} ajusta o argumento para redução de custos.",
          training: "Pergunte a composição de vendas com foco no ROI.",
          action: "Filtro comercial ativo.",
          options: [
            { label: "🗣️ 'Time focado em Inbound'", value: "optA" },
            { label: "🗣️ 'Operação forte no Outbound'", value: "optB" },
          ],
        },
      },
      step3: {
        optA: {
          leadMsg: "Time focado em Inbound.",
          botMsg: "Perfeito! Nossos fluxos vão garantir atendimento em 1s. Para te mostrar isso rodando, vamos agendar uma call amanhã: pela manhã ou tarde?",
          reasoning: "IA avança no agendamento.",
          training: "Ofereça horários para reunião corporativa.",
          action: "Qualificado para Reunião.",
          options: [
            { label: "🗣️ 'Pela manhã'", value: "optA" },
            { label: "🗣️ 'À tarde'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Operação forte no Outbound.",
          botMsg: "Sensacional! Nossos disparos com proteção anti-ban vão alavancar suas respostas. Vamos agendar uma call executiva amanhã: manhã ou tarde?",
          reasoning: "IA avança no agendamento com apelo a Outbound.",
          training: "Ofereça horários para reunião corporativa.",
          action: "Qualificado para Reunião.",
          options: [
            { label: "🗣️ 'Pela manhã'", value: "optA" },
            { label: "🗣️ 'À tarde'", value: "optB" },
          ],
        },
      },
      step4: {
        optA: {
          leadMsg: "Pela manhã.",
          botMsg: "Certo! Na {{prospectName}}, os diretores têm espaço às 10:00 ou 11:30. Qual funciona?",
          reasoning: "Busca horários executivos.",
          training: "Agende com o executivo da {{prospectName}}.",
          action: "Integração Calendly.",
          slots: ["Amanhã 10:00", "Amanhã 11:30"],
        },
        optB: {
          leadMsg: "À tarde.",
          botMsg: "Certo! Na {{prospectName}}, os diretores têm espaço às 15:00 ou 16:30. Qual funciona?",
          reasoning: "Busca horários executivos.",
          training: "Agende com o executivo da {{prospectName}}.",
          action: "Integração Calendly.",
          slots: ["Amanhã 15:00", "Amanhã 16:30"],
        },
      },
      step5: {
        "Amanhã 10:00": {
          leadMsg: "Pode ser 10:00.",
          botMsg: "Reunião confirmada! O executivo da {{prospectName}} entrará no link enviado amanhã às 10:00.",
          reasoning: "Call B2B confirmada.",
          training: "Confirme a call corporativa.",
          action: "Reunião no CRM.",
          handoff: { lead: "Decisor B2B", meta: "Foco: Inbound/Outbound", action: "Call", closer: "Executivo Vendas" }
        },
        "Amanhã 11:30": {
          leadMsg: "Pode ser 11:30.",
          botMsg: "Reunião confirmada! O executivo da {{prospectName}} entrará no link enviado amanhã às 11:30.",
          reasoning: "Call B2B confirmada.",
          training: "Confirme a call.",
          action: "Reunião no CRM.",
          handoff: { lead: "Decisor B2B", meta: "Foco: Inbound/Outbound", action: "Call", closer: "Executivo Vendas" }
        },
        "Amanhã 15:00": {
          leadMsg: "Pode ser 15:00.",
          botMsg: "Reunião confirmada! O executivo da {{prospectName}} entrará no link enviado amanhã às 15:00.",
          reasoning: "Call B2B confirmada.",
          training: "Confirme a call.",
          action: "Reunião no CRM.",
          handoff: { lead: "Decisor B2B", meta: "Foco: Inbound/Outbound", action: "Call", closer: "Executivo Vendas" }
        },
        "Amanhã 16:30": {
          leadMsg: "Pode ser 16:30.",
          botMsg: "Reunião confirmada! O executivo da {{prospectName}} entrará no link enviado amanhã às 16:30.",
          reasoning: "Call B2B confirmada.",
          training: "Confirme a call.",
          action: "Reunião no CRM.",
          handoff: { lead: "Decisor B2B", meta: "Foco: Inbound/Outbound", action: "Call", closer: "Executivo Vendas" }
        }
      }
    }
  }
};
