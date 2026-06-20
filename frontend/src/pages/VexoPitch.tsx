import { useState, useMemo } from "react";
import {
  Sparkles,
  TrendingUp,
  MessageSquare,
  Bot,
  Layers,
  Calculator,
  RefreshCw,
  HelpCircle,
  Play,
  Upload,
  X,
  ChevronLeft,
  ChevronRight,
  Flame,
  CheckCircle2,
  AlertTriangle,
  Building2,
  DollarSign,
  Maximize2,
  Clock,
  Briefcase,
  Users,
  Calendar,
  ArrowRight,
  Bell,
  UserCheck,
  Smartphone,
  Check,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

// ─── TYPES & DATA ────────────────────────────────────────────────────────────

interface SegmentStep {
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

interface SegmentScenario {
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
  steps: {
    step1: SegmentStep;
    step2: Record<string, SegmentStep>; // keyed by optA / optB
    step3: Record<string, SegmentStep>; // keyed by optA / optB
    step4: Record<string, SegmentStep>; // keyed by optA / optB (periods)
    step5: Record<string, SegmentStep>; // keyed by slot index/label
  };
}

const SEGMENTS: Record<string, SegmentScenario> = {
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
    steps: {
      step1: {
        botMsg: "Olá Felipe! Tudo bem? Sentimos sua falta nos treinos da Corpo & Ação Fitness! Preparamos uma condição especial de reativação sem taxa de matrícula este mês. Que tal agendar uma aula experimental amanhã?",
        reasoning: "IA inicia o contato ativamente usando o gatilho de reativação imediata (isenção de matrícula) para um ex-aluno inativo.",
        training: "Ao abordar ex-alunos inativos, seja caloroso, use o nome da academia e ofereça isenção de matrícula imediata na primeira mensagem.",
        action: "Campanha ativa iniciada pelo motor Vexo. Fila de disparos configurada para Chip #2 (Blindagem Anti-ban).",
        options: [
          { label: "🗣️ 'Estou sem tempo para treinar ultimamente'", value: "optA" },
          { label: "🗣️ 'Tenho interesse, mas quais são os planos?'", value: "optB" },
        ],
      },
      step2: {
        optA: {
          leadMsg: "Estou sem tempo para treinar ultimamente, correria total no trabalho.",
          botMsg: "Super entendo, Felipe! A rotina está muito corrida mesmo. Por isso lançamos os novos treinos expressos de 40 minutos de alta intensidade, ideais para fazer no horário de almoço ou antes de ir para casa. Me conta, seu foco principal hoje seria perda de peso ou ganho de massa magra?",
          reasoning: "IA detecta a objeção de falta de tempo e apresenta uma solução técnica (treinos de 40min). Transiciona imediatamente para a qualificação de objetivo físico.",
          training: "Se o lead alegar falta de tempo, ressalte os novos treinos expressos de 40 minutos e pergunte se busca hipertrofia ou emagrecimento.",
          action: "Lead movido para a etapa 'Qualificando' no CRM. Alerta de follow-up automático pausado.",
          options: [
            { label: "🗣️ 'Meu foco principal é ganho de massa magra'", value: "optA" },
            { label: "🗣️ 'Preciso queimar gordura / emagrecimento'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Gostaria de ver quais são as opções de planos hoje.",
          botMsg: "Perfeito, Felipe! Nossos planos começam em R$ 119/mês no recorrente (sem travar o limite do seu cartão). E o melhor é que agora temos treinos expressos de 40 minutos inclusos. Para eu te direcionar o melhor plano, seu foco principal seria perda de peso ou ganho de massa magra?",
          reasoning: "IA contorna a objeção implícita de preço apresentando a facilidade do plano recorrente e segue qualificando o objetivo físico.",
          training: "Apresente o preço de entrada de R$ 119 recorrente (sem travar limite do cartão) e pergunte o foco físico do lead.",
          action: "Lead movido para 'Qualificando' no CRM. Temperatura do lead alterada para QUENTE.",
          options: [
            { label: "🗣️ 'Meu foco principal é ganho de massa magra'", value: "optA" },
            { label: "🗣️ 'Preciso queimar gordura / emagrecimento'", value: "optB" },
          ],
        },
      },
      step3: {
        optA: {
          leadMsg: "Meu foco principal é ganho de massa magra (hipertrofia).",
          botMsg: "Show! O ganho de massa exige treino resistido regular, e nossos professores vão montar uma ficha sob medida focada em hipertrofia rápida. Para começarmos, temos horários para sua aula amanhã. Qual período prefere: manhã ou noite?",
          reasoning: "IA armazena a meta de ganho de massa, valida clinicamente o objetivo e avança para a proposta de agendamento de períodos.",
          training: "Para foco em ganho de massa, reforce a importância do treino resistido curto de alta intensidade e pergunte se prefere agendar de manhã ou à noite.",
          action: "Propriedade 'meta_comercial' atualizada para 'Hipertrofia' no CRM. Temperatura alterada para MUITO QUENTE.",
          options: [
            { label: "🗣️ 'Prefiro no período da noite'", value: "optA" },
            { label: "🗣️ 'Pela manhã bem cedo seria melhor'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Preciso queimar gordura e sair do sedentarismo.",
          botMsg: "Excelente, Felipe! Vamos focar em acelerar o seu metabolismo com treinos aeróbicos expressos bem dinâmicos. Para começarmos, temos horários para sua aula amanhã. Qual período prefere: manhã ou noite?",
          reasoning: "IA armazena a meta de emagrecimento, propõe treinos dinâmicos para sair do sedentarismo e avança para propor os períodos de agendamento.",
          training: "Para emagrecimento/sedentarismo, proponha treinos metabólicos curtos e pergunte se prefere o período da manhã ou noite.",
          action: "Propriedade 'meta_comercial' atualizada para 'Emagrecimento' no CRM. Temperatura alterada para MUITO QUENTE.",
          options: [
            { label: "🗣️ 'Prefiro no período da noite'", value: "optA" },
            { label: "🗣️ 'Pela manhã bem cedo seria melhor'", value: "optB" },
          ],
        },
      },
      step4: {
        optA: {
          leadMsg: "Prefiro fazer no período da noite.",
          botMsg: "Excelente! Temos horários com professor amanhã à noite. Qual desses horários fica melhor para deixar agendado?",
          reasoning: "IA identifica a preferência noturna do lead e puxa a agenda disponível em tempo real para ex-alunos.",
          training: "Filtre a agenda para noite e apresente os slots livres das 19:30 e 20:30.",
          action: "API de Calendário integrada (Calendly) consultada. Slots livres carregados na simulação.",
          slots: ["Amanhã às 19:30", "Amanhã às 20:30"],
        },
        optB: {
          leadMsg: "Pela manhã bem cedo seria melhor.",
          botMsg: "Excelente! Temos horários com professor amanhã de manhã. Qual desses horários fica melhor para deixar agendado?",
          reasoning: "IA identifica a preferência matutina do lead e puxa a agenda disponível correspondente.",
          training: "Filtre a agenda para manhã e apresente os slots livres das 07:00 e 08:30.",
          action: "API de Calendário integrada (Calendly) consultada. Slots livres carregados na simulação.",
          slots: ["Amanhã às 07:00", "Amanhã às 08:30"],
        },
      },
      step5: {
        "Amanhã às 19:30": {
          leadMsg: "Pode ser amanhã às 19:30.",
          botMsg: "Sensacional, Felipe! Aula experimental agendada para amanhã às 19:30. O professor Rodrigo já está reservado para te acompanhar. Te enviei os detalhes no seu e-mail e nos vemos amanhã na recepção da academia!",
          reasoning: "Reserva confirmada. IA bloqueia o slot, envia os dados coletados e dispara a notificação de qualificação (handoff) para o Closer.",
          training: "Após a escolha do slot, faça a reserva oficial, envie um e-mail de confirmação e dispare os dados do lead para o time de fechamento da recepção.",
          action: "Lead movido para 'Agendado' no CRM. Campanha de lembrete de presença ativada (1 hora antes do treino). Handoff disparado.",
          handoff: {
            lead: "Felipe Melo (Lead Inativo)",
            meta: "Objetivo: Ganho de Massa | Objeção 'Sem Tempo' Superada",
            action: "Aula Experimental: Amanhã às 19:30 com Prof. Rodrigo",
            closer: "Recepção / Consultor Comercial",
          },
        },
        "Amanhã às 20:30": {
          leadMsg: "Pode agendar para amanhã às 20:30.",
          botMsg: "Sensacional, Felipe! Aula experimental agendada para amanhã às 20:30. O professor Rodrigo já está reservado para te acompanhar. Te enviei os detalhes no seu e-mail e nos vemos amanhã na recepção da academia!",
          reasoning: "Reserva confirmada. IA agenda e notifica equipe.",
          training: "Registre o agendamento e envie notificação de handoff comercial.",
          action: "Lead movido para 'Agendado' no CRM. Lembretes ativados.",
          handoff: {
            lead: "Felipe Melo (Lead Inativo)",
            meta: "Objetivo: Ganho de Massa | Objeção 'Sem Tempo' Superada",
            action: "Aula Experimental: Amanhã às 20:30 com Prof. Rodrigo",
            closer: "Recepção / Consultor Comercial",
          },
        },
        "Amanhã às 07:00": {
          leadMsg: "Quero amanhã às 07:00.",
          botMsg: "Sensacional, Felipe! Aula experimental agendada para amanhã às 07:00. A professora Camila já está reservado para te acompanhar. Te enviei os detalhes no seu e-mail e nos vemos amanhã na recepção da academia!",
          reasoning: "Reserva confirmada no slot matutino. IA bloqueia o horário e notifica recepção.",
          training: "Registre o agendamento matutino e envie notificação de handoff comercial.",
          action: "Lead movido para 'Agendado' no CRM. Lembretes ativados.",
          handoff: {
            lead: "Felipe Melo (Lead Inativo)",
            meta: "Objetivo: Emagrecimento | Prefere Treinar Cedo",
            action: "Aula Experimental: Amanhã às 07:00 com Prof. Camila",
            closer: "Recepção / Consultor Comercial",
          },
        },
        "Amanhã às 08:30": {
          leadMsg: "Amanhã às 08:30 fica bom.",
          botMsg: "Sensacional, Felipe! Aula experimental agendada para amanhã às 08:30. A professora Camila já está reservada para te acompanhar. Te enviei os detalhes no seu e-mail e nos vemos amanhã na recepção da academia!",
          reasoning: "Reserva confirmada. IA agenda e envia o handoff.",
          training: "Registre o agendamento matutino e envie notificação de handoff comercial.",
          action: "Lead movido para 'Agendado' no CRM. Lembretes ativados.",
          handoff: {
            lead: "Felipe Melo (Lead Inativo)",
            meta: "Objetivo: Emagrecimento | Prefere Treinar Cedo",
            action: "Aula Experimental: Amanhã às 08:30 com Prof. Camila",
            closer: "Recepção / Consultor Comercial",
          },
        },
      },
    },
  },
  imobiliaria: {
    name: "Imobiliária & Incorporadora",
    emoji: "🏢",
    defaultProspectName: "Bella Vista Imóveis",
    productName: "Residencial Bella Vista",
    targetLeadType: "Leads de portais (Zap/VivaReal) parados",
    painPoint: "Leads que chegam de portais demoram horas para ser respondidos e esfriam rapidamente.",
    benefit: "A IA responde instantaneamente (em menos de 60 segundos), qualifica o perfil de financiamento e agenda visitas ao decorado.",
    goalAction: "Agendar Visita ao Decorado",
    averageTicket: 12000,
    conversionImprovement: "Aumento de 40% nas visitas presencias",
    leadsCountDefault: 300,
    leadCostDefault: 25,
    conversionRateDefault: 2,
    steps: {
      step1: {
        botMsg: "Olá Mariana! Vi seu interesse no Residencial Bella Vista. Sou o assistente virtual da imobiliária. Para te passar as informações certas sobre o condomínio, você busca um imóvel para morar ou para investir?",
        reasoning: "IA capta o lead de portal imobiliário instantaneamente (menor tempo de resposta = maior conversão) e identifica a intenção primária de compra.",
        training: "Ao atender novos leads de portais, responda em menos de 60s. Identifique se buscam moradia própria ou investimento na primeira mensagem.",
        action: "Captura de webhook de portal imobiliário ativa. Autoatendimento de IA iniciado.",
        options: [
          { label: "🗣️ 'Estou buscando um imóvel para morar'", value: "optA" },
          { label: "🗣️ 'É para investir, quero saber sobre rentabilidade'", value: "optB" },
        ],
      },
      step2: {
        optA: {
          leadMsg: "Estou buscando para morar, mas achei que a parcela de entrada ficaria muito alta.",
          botMsg: "Entendo perfeitamente, Mariana. A entrada é um ponto importante! Temos condições facilitadas direto com a construtora durante a obra e você também pode usar seu FGTS. Para eu simular os valores exatos para você, qual a sua faixa média de renda familiar hoje?",
          reasoning: "IA contorna a objeção de entrada explicando o parcelamento e uso do FGTS. Em seguida, inicia qualificação de renda familiar para a simulação habitacional.",
          training: "Se o lead temer a entrada, argumente sobre o parcelamento direto na obra e FGTS. Pergunte a faixa de renda familiar para fins de simulação.",
          action: "Lead movido para 'Qualificando'. Tag 'Entrada Facilitada' aplicada. Status do lead: MORNO.",
          options: [
            { label: "🗣️ 'Minha renda familiar é de R$ 8 mil a R$ 12 mil'", value: "optA" },
            { label: "🗣️ 'Minha renda familiar é acima de R$ 15 mil'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "É para investir, quero saber sobre rentabilidade e fluxo.",
          botMsg: "Excelente, Mariana! O Residencial Bella Vista fica no vetor de maior crescimento da cidade, com valorização média de 12% ao ano e alta taxa de ocupação para aluguel. Para alinhar a melhor opção de portfólio, qual o seu teto estimado de investimento hoje?",
          reasoning: "IA valida a intenção de investimento fornecendo dados de valorização e solicita o teto de investimento para enquadrar as unidades disponíveis.",
          training: "Para investidores, informe dados de valorização de 12% a.a. e alta liquidez de locação. Solicite o teto estimado de aporte financeiro.",
          action: "Lead movido para 'Qualificando'. Tag 'Perfil Investidor' aplicada. Status do lead: QUENTE.",
          options: [
            { label: "🗣️ 'Quero investir até R$ 450 mil'", value: "optA" },
            { label: "🗣️ 'Busco opções acima de R$ 600 mil'", value: "optB" },
          ],
        },
      },
      step3: {
        optA: {
          leadMsg: "Minha renda fica entre R$ 8 mil e R$ 12 mil. / Quero investir até R$ 450 mil.",
          botMsg: "Excelente! Para essa faixa de perfil, conseguimos aprovar parcelas confortáveis e temos 2 unidades exclusivas no decorado perfeitas para esse fluxo. Vamos agendar uma visita amanhã ao decorado para fazermos uma simulação bancária exata? Qual período prefere: manhã ou tarde?",
          reasoning: "IA confirma a adequação do perfil financeiro e convida para visita física ao decorado, sugerindo os períodos manhã ou tarde.",
          training: "Enquadre o lead em unidades adequadas de entrada baixa/médio ticket e proponha visita presencial ao decorado amanhã (pergunta manhã/tarde).",
          action: "CRM atualizado. Lead classificado como QUENTE. Temperatura do lead atualizada.",
          options: [
            { label: "🗣️ 'Prefiro no período da manhã'", value: "optA" },
            { label: "🗣️ 'Prefiro no período da tarde'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Minha renda familiar é acima de R$ 15 mil. / Busco opções premium acima de R$ 600 mil.",
          botMsg: "Excelente! Esse perfil dá acesso às nossas coberturas e andares altos com vista definitiva e acabamento de alto padrão. Vamos agendar uma visita amanhã ao decorado para apresentar a planta e fluxo personalizado? Qual período prefere: manhã ou tarde?",
          reasoning: "IA qualifica o lead como alto padrão, oferece as coberturas/andares altos e convida para visita de simulação personalizada.",
          training: "Para alto padrão/investimento elevado, destaque unidades premium (cobertura, vista definitiva) e convide para o decorado (pergunta manhã/tarde).",
          action: "CRM atualizado. Lead classificado como MUITO QUENTE. Tag 'Alto Padrão' aplicada.",
          options: [
            { label: "🗣️ 'Prefiro no período da manhã'", value: "optA" },
            { label: "🗣️ 'Prefiro no período da tarde'", value: "optB" },
          ],
        },
      },
      step4: {
        optA: {
          leadMsg: "Prefiro ir no período da manhã.",
          botMsg: "Excelente! Temos horários disponíveis amanhã de manhã no plantão. Qual desses horários fica melhor para reservar?",
          reasoning: "IA identifica preferência matutina e busca horários vagos com o corretor Lucas no plantão de vendas.",
          training: "Para o período da manhã, apresente os slots livres das 09:30 e 11:00.",
          action: "Agenda do corretor integrada consultada. Reserva temporária bloqueada no painel.",
          slots: ["Amanhã às 09:30", "Amanhã às 11:00"],
        },
        optB: {
          leadMsg: "Prefiro ir no período da tarde.",
          botMsg: "Excelente! Temos horários disponíveis amanhã à tarde no plantão. Qual desses horários fica melhor para reservar?",
          reasoning: "IA identifica preferência vespertina e busca slots com o corretor Lucas no decorado.",
          training: "Para o período da tarde, apresente os slots livres das 14:00 e 16:30.",
          action: "Reserva temporária no decorado bloqueada na agenda do corretor.",
          slots: ["Amanhã às 14:00", "Amanhã às 16:30"],
        },
      },
      step5: {
        "Amanhã às 09:30": {
          leadMsg: "Pode ser amanhã às 09:30.",
          botMsg: "Confirmado, Mariana! Sua visita ao decorado está agendada para amanhã às 09:30. O corretor Lucas estará te aguardando no plantão de vendas com as simulações prontas. Estou enviando a localização exata do decorado com vaga de visitante.",
          reasoning: "Lead reserva o slot. IA confirma no CRM e dispara notificação de handoff urgente com a faixa de renda e interesse para o corretor.",
          training: "Finalize o agendamento no slot matutino e envie os dados financeiros coletados para o Corretor fechar a proposta.",
          action: "Visita confirmada no CRM. Handoff enviado ao corretor Lucas. Campanha de lembrete pós-visita ativa.",
          handoff: {
            lead: "Mariana Souza",
            meta: "Renda: 8-12k | Busca: Morar (Médio Padrão)",
            action: "Visita: Amanhã 09:30 no Decorado (Corretor Lucas)",
            closer: "Corretor Lucas (Closer)",
          },
        },
        "Amanhã às 11:00": {
          leadMsg: "Marque para amanhã às 11:00.",
          botMsg: "Confirmado, Mariana! Sua visita ao decorado está agendada para amanhã às 11:00. O corretor Lucas estará te aguardando no plantão de vendas com as simulações prontas. Estou enviando a localização exata do decorado com vaga de visitante.",
          reasoning: "Lead reserva o slot. IA confirma agendamento e notifica o corretor.",
          training: "Finalize o agendamento e notifique o corretor.",
          action: "Visita registrada no CRM. Handoff enviado.",
          handoff: {
            lead: "Mariana Souza",
            meta: "Renda: >15k | Busca: Cobertura / Vista Definitiva",
            action: "Visita: Amanhã 11:00 no Decorado (Corretor Lucas)",
            closer: "Corretor Lucas (Closer)",
          },
        },
        "Amanhã às 14:00": {
          leadMsg: "Pode ser amanhã às 14:00.",
          botMsg: "Confirmado, Mariana! Sua visita ao decorado está agendada para amanhã às 14:00. O corretor Lucas estará te aguardando no plantão de vendas com as simulações prontas. Estou enviando a localização exata do decorado com vaga de visitante.",
          reasoning: "Lead agenda à tarde. IA envia confirmação e handoff.",
          training: "Finalize o agendamento e notifique o corretor.",
          action: "Visita registrada no CRM. Handoff enviado.",
          handoff: {
            lead: "Mariana Souza",
            meta: "Renda: 8-12k | Busca: Morar (Médio Padrão)",
            action: "Visita: Amanhã 14:00 no Decorado (Corretor Lucas)",
            closer: "Corretor Lucas (Closer)",
          },
        },
        "Amanhã às 16:30": {
          leadMsg: "Amanhã às 16:30 fica bom.",
          botMsg: "Confirmado, Mariana! Sua visita ao decorado está agendada para amanhã às 16:30. O corretor Lucas estará te aguardando no plantão de vendas com as simulações prontas. Estou enviando a localização exata do decorado com vaga de visitante.",
          reasoning: "Lead agenda à tarde. IA envia confirmação e handoff.",
          training: "Finalize o agendamento e notifique o corretor.",
          action: "Visita registrada no CRM. Handoff enviado.",
          handoff: {
            lead: "Mariana Souza",
            meta: "Renda: >15k | Busca: Cobertura / Vista Definitiva",
            action: "Visita: Amanhã 16:30 no Decorado (Corretor Lucas)",
            closer: "Corretor Lucas (Closer)",
          },
        },
      },
    },
  },
  estetica: {
    name: "Clínica Médica & Estética",
    emoji: "✨",
    defaultProspectName: "Clínica Harmonize",
    productName: "Toxina Botulínica (Botox)",
    targetLeadType: "Leads que fizeram avaliação e sumiram",
    painPoint: "Avaliações feitas onde o cliente diz que 'vai pensar' e a secretária esquece de fazer follow-up.",
    benefit: "A IA envia lembrete amigável oferecendo uma condição especial para fechar o tratamento nos próximos 3 dias.",
    goalAction: "Agendar Procedimento",
    averageTicket: 1200,
    conversionImprovement: "Recuperação de 22% de orçamentos perdidos",
    leadsCountDefault: 200,
    leadCostDefault: 15,
    conversionRateDefault: 8,
    steps: {
      step1: {
        botMsg: "Olá Clara! Tudo bem? Passando para saber como ficou sua pele após a avaliação com a Dra. Patrícia. Conseguimos liberar uma cortesia de Peeling de Diamante se fecharmos seu protocolo de Toxina Botulínica (Botox) esta semana. Vamos agendar seu retorno?",
        reasoning: "IA dispara campanha de follow-up automático para orçamentos em aberto, agregando valor com uma cortesia especial para acelerar a decisão.",
        training: "No follow-up de orçamentos parados, ofereça uma cortesia de Peeling de Diamante como bônus de conversão e convide para fechar o tratamento na primeira mensagem.",
        action: "Campanha de recuperação de orçamentos ativa no Vexo OS. Lembrete enviado com sucesso.",
        options: [
          { label: "🗣️ 'Achei o valor um pouco apertado esse mês'", value: "optA" },
          { label: "🗣️ 'Gostaria de agendar, mas tem horário quinta?'", value: "optB" },
        ],
      },
      step2: {
        optA: {
          leadMsg: "Achei o valor um pouco apertado para mim esse mês.",
          botMsg: "Compreendo perfeitamente, Clara! Queremos muito que você faça seu procedimento conosco. Conseguimos parcelar o seu protocolo em até 10x sem juros no cartão de crédito. Fica super suave! Qual região você gostaria de dar mais atenção no tratamento: testa ou área dos olhos?",
          reasoning: "IA neutraliza a objeção financeira oferecendo o facilitador de pagamento (10x sem juros) e transiciona para entender a preferência clínica do tratamento.",
          training: "Se reclamar do preço, ofereça parcelamento em até 10x sem juros e pergunte a área focal do tratamento (testa ou olhos) para avançar.",
          action: "Lead movido para 'Qualificando'. Tag 'Negociando Condições' aplicada.",
          options: [
            { label: "🗣️ 'Quero focar na região da testa'", value: "optA" },
            { label: "🗣️ 'Quero tratar a área dos olhos (pés de galinha)'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Gostaria de agendar, mas tem horário nesta quinta-feira?",
          botMsg: "Temos sim, Clara! A Dra. Patrícia tem alguns horários na quinta. Para deixarmos tudo preparado para o seu retorno, qual região você gostaria de dar mais atenção no tratamento: testa ou área dos olhos?",
          reasoning: "IA confirma a disponibilidade e transiciona para a qualificação clínica para que a biomédica prepare a dose ideal da aplicação.",
          training: "Se o lead perguntar sobre dias específicos, confirme a agenda e qualifique a área focal da aplicação de botox (testa ou olhos).",
          action: "Lead movido para 'Qualificando'. Temperatura do lead alterada para QUENTE.",
          options: [
            { label: "🗣️ 'Quero focar na região da testa'", value: "optA" },
            { label: "🗣️ 'Quero tratar a área dos olhos (pés de galinha)'", value: "optB" },
          ],
        },
      },
      step3: {
        optA: {
          leadMsg: "Quero focar principalmente nas rugas da testa.",
          botMsg: "Perfeito! A aplicação na testa traz um efeito lifting super natural e rejuvenescedor. Para agendarmos, qual período fica mais prático para você na quinta-feira: manhã ou tarde?",
          reasoning: "IA valida a escolha clínica e prossegue com a triagem de agendamento de horário, perguntando o período preferido.",
          training: "Confirme os benefícios do tratamento na testa e pergunte a preferência de período na quinta-feira (manhã/tarde).",
          action: "Meta clínica registrada como 'Testa/Glabela' no histórico do lead.",
          options: [
            { label: "🗣️ 'Prefiro no período da manhã'", value: "optA" },
            { label: "🗣️ 'Prefiro no período da tarde'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Quero tratar a área dos olhos (pés de galinha).",
          botMsg: "Excelente escolha! A aplicação nessa área abre o olhar e suaviza as linhas de expressão de forma fantástica. Para agendarmos, qual período fica mais prático para você na quinta-feira: manhã ou tarde?",
          reasoning: "IA valida a escolha clínica de rejuvenescimento ocular e transiciona para agendamento de horário.",
          training: "Valide o foco estético ocular e pergunte a preferência de período na quinta-feira (manhã/tarde).",
          action: "Meta clínica registrada como 'Área dos Olhos' no CRM.",
          options: [
            { label: "🗣️ 'Prefiro no período da manhã'", value: "optA" },
            { label: "🗣️ 'Prefiro no período da tarde'", value: "optB" },
          ],
        },
      },
      step4: {
        optA: {
          leadMsg: "Prefiro fazer no período da manhã.",
          botMsg: "Perfeito! Dra. Patrícia tem esses horários livres na quinta de manhã. Qual prefere reservar?",
          reasoning: "IA busca os slots livres da Dra. Patrícia na agenda matutina de procedimentos.",
          training: "Apresente os horários disponíveis da quinta de manhã: 09:00 e 10:30.",
          action: "Integração do sistema de agendamento médico consultada. Slot pré-reservado.",
          slots: ["Quinta às 09:00", "Quinta às 10:30"],
        },
        optB: {
          leadMsg: "Prefiro fazer no período da tarde.",
          botMsg: "Perfeito! Dra. Patrícia tem esses horários livres na quinta à tarde. Qual prefere reservar?",
          reasoning: "IA busca os slots livres na agenda vespertina da clínica.",
          training: "Apresente os horários disponíveis da quinta à tarde: 14:00 e 15:30.",
          action: "Slot de procedimento pré-reservado na agenda clínica.",
          slots: ["Quinta às 14:00", "Quinta às 15:30"],
        },
      },
      step5: {
        "Quinta às 09:00": {
          leadMsg: "Pode marcar para quinta às 09:00.",
          botMsg: "Perfeito, Clara! Procedimento confirmado para quinta-feira às 09:00. O consultório e a ampola de aplicação já estão reservados para você. Ah, lembre-se de chegar com 10 minutinhos de antecedência. Nos vemos na quinta!",
          reasoning: "Lead escolhe o slot. IA efetiva o agendamento e envia a notificação de handoff detalhada para a recepção da clínica preparar o contrato estético.",
          training: "Confirme o procedimento, envie os cuidados pré-aplicação e alerte a secretária da clínica para o fechamento financeiro do contrato.",
          action: "Lead movido para 'Agendado' no CRM. Alerta de handoff disparado para a Closer. Lembrete de consulta ativo.",
          handoff: {
            lead: "Clara Reis",
            meta: "Foco: Testa/Rugas | Pagamento: 10x sem juros (Objeção superada)",
            action: "Procedimento: Quinta 09:00 (Dra. Patrícia) + Cortesia Peeling",
            closer: "Recepção / Secretária Clínica",
          },
        },
        "Quinta às 10:30": {
          leadMsg: "Quinta às 10:30 fica ótimo.",
          botMsg: "Perfeito, Clara! Procedimento confirmado para quinta-feira às 10:30. O consultório e a ampola de aplicação já estão reservados para você. Ah, lembre-se de chegar com 10 minutinhos de antecedência. Nos vemos na quinta!",
          reasoning: "Lead escolhe slot. IA confirma agendamento e notifica equipe.",
          training: "Finalize o agendamento no slot escolhido e envie notificação de handoff.",
          action: "Lead movido para 'Agendado'. Handoff enviado.",
          handoff: {
            lead: "Clara Reis",
            meta: "Foco: Testa/Rugas | Pagamento: 10x sem juros",
            action: "Procedimento: Quinta 10:30 (Dra. Patrícia) + Cortesia Peeling",
            closer: "Recepção / Secretária Clínica",
          },
        },
        "Quinta às 14:00": {
          leadMsg: "Quero na quinta às 14:00.",
          botMsg: "Perfeito, Clara! Procedimento confirmado para quinta-feira às 14:00. O consultório e a ampola de aplicação já estão reservados para você. Ah, lembre-se de chegar com 10 minutinhos de antecedência. Nos vemos na quinta!",
          reasoning: "Lead escolhe slot. IA confirma agendamento e notifica equipe.",
          training: "Finalize o agendamento no slot escolhido e envie notificação de handoff.",
          action: "Lead movido para 'Agendado'. Handoff enviado.",
          handoff: {
            lead: "Clara Reis",
            meta: "Foco: Área dos Olhos | Pagamento: 10x sem juros (Objeção superada)",
            action: "Procedimento: Quinta 14:00 (Dra. Patrícia) + Cortesia Peeling",
            closer: "Recepção / Secretária Clínica",
          },
        },
        "Quinta às 15:30": {
          leadMsg: "Marque para quinta às 15:30.",
          botMsg: "Perfeito, Clara! Procedimento confirmado para quinta-feira às 15:30. O consultório e a ampola de aplicação já estão reservados para você. Ah, lembre-se de chegar com 10 minutinhos de antecedência. Nos vemos na quinta!",
          reasoning: "Lead escolhe slot. IA confirma agendamento e notifica equipe.",
          training: "Finalize o agendamento no slot escolhido e envie notificação de handoff.",
          action: "Lead movido para 'Agendado'. Handoff enviado.",
          handoff: {
            lead: "Clara Reis",
            meta: "Foco: Área dos Olhos | Pagamento: 10x sem juros",
            action: "Procedimento: Quinta 15:30 (Dra. Patrícia) + Cortesia Peeling",
            closer: "Recepção / Secretária Clínica",
          },
        },
      },
    },
  },
  b2b: {
    name: "B2B / Agência & Serviços",
    emoji: "💼",
    defaultProspectName: "Scale Agência B2B",
    productName: "Assessoria de Vendas Vexo",
    targetLeadType: "Lista de prospecção fria (Outbound)",
    painPoint: "Dificuldade de conectar e conversar com diretores ocupados sem parecer uma abordagem chata de spam.",
    benefit: "A IA aborda o decisor tocando em dores reais do setor, responde dúvidas técnicas e agenda reuniões de diagnóstico com o closer.",
    goalAction: "Agendar Reunião de Diagnóstico",
    averageTicket: 3500,
    conversionImprovement: "Conversão de 15% de contatos frios em reuniões",
    leadsCountDefault: 400,
    leadCostDefault: 12,
    conversionRateDefault: 5,
    steps: {
      step1: {
        botMsg: "Olá Roberto, tudo bem? Vi sua atuação como Diretor Comercial na TechCorp. Apoiamos empresas de TI a triplicar a conversão comercial de leads frios com qualificação inteligente via WhatsApp. Vocês já estruturam alguma automação para leads que não respondem o time comercial?",
        reasoning: "IA inicia prospecção fria automatizada (Outbound) abordando o decisor com gancho de dor real (leads frios acumulados no CRM).",
        training: "Ao prospectar B2B, cite o cargo do lead (ex: Diretor Comercial), a dor comum de conversão de leads frios e faça uma pergunta de diagnóstico.",
        action: "Disparo outbound via campanha de engajamento ativa.",
        options: [
          { label: "🗣️ 'Nós já temos uma agência interna de marketing'", value: "optA" },
          { label: "🗣️ 'Temos interesse, como funciona a plataforma?'", value: "optB" },
        ],
      },
      step2: {
        optA: {
          leadMsg: "Nós já temos uma agência interna de marketing que cuida de tudo.",
          botMsg: "Excelente, Roberto! Ter um time focado é o melhor cenário. Na verdade, nossa ferramenta atua justamente aliando-se ao marketing interno para triplicar a produtividade deles, qualificando e agendando automaticamente no funil. Qual o principal CRM que vocês usam hoje para o time comercial: Hubspot ou Pipefy?",
          reasoning: "IA contorna a objeção mostrando que a ferramenta soma com o marketing interno, em vez de substituí-los. Avança qualificando a ferramenta de CRM integrada.",
          training: "Se alegar equipe interna, explique que o Vexo OS atua como acelerador de produtividade do time interno. Pergunte o CRM comercial ativo (Hubspot ou Pipefy).",
          action: "Lead movido para 'Qualificando'. Tag 'CRM Qualificado' aplicada no histórico.",
          options: [
            { label: "🗣️ 'Nós usamos o Hubspot aqui'", value: "optA" },
            { label: "🗣️ 'Nós usamos o Pipefy / outro CRM'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Nós temos interesse em conhecer mais detalhes. Como funciona a plataforma?",
          botMsg: "Perfeito, Roberto! O Vexo OS integra-se ao seu site e ao seu CRM de vendas, qualificando leads em segundos e agendando reuniões direto no calendário comercial dos closers. Por sinal, qual o principal CRM que vocês usam hoje: Hubspot ou Pipefy?",
          reasoning: "IA explica a proposta de valor técnica e imediatamente pergunta o CRM integrado para validar a viabilidade técnica e mapear o perfil da conta.",
          training: "Explique a integração de chat/calendário e pergunte qual CRM eles utilizam atualmente (Hubspot ou Pipefy).",
          action: "Lead movido para 'Qualificando'. Temperatura do lead definida como QUENTE.",
          options: [
            { label: "🗣️ 'Nós usamos o Hubspot aqui'", value: "optA" },
            { label: "🗣️ 'Nós usamos o Pipefy / outro CRM'", value: "optB" },
          ],
        },
      },
      step3: {
        optA: {
          leadMsg: "Nós usamos o Hubspot no nosso time comercial.",
          botMsg: "Excelente! Temos integração nativa bi-direcional com o Hubspot. Quando a IA qualifica o lead, cria a oportunidade e atualiza o funil instantaneamente. Para demonstrar a integração rodando, vamos agendar um diagnóstico técnico rápido amanhã? Prefere de manhã ou à tarde?",
          reasoning: "IA valida a integração do Hubspot e propõe reunião de demonstração técnica avançando com a seleção de períodos.",
          training: "Mencione a integração nativa bidirecional do Hubspot e convide para reunião de diagnóstico (pergunta manhã/tarde).",
          action: "Integração nativa bi-direcional com Hubspot ativada no lead.",
          options: [
            { label: "🗣️ 'Prefiro no período da manhã'", value: "optA" },
            { label: "🗣️ 'Prefiro no período da tarde'", value: "optB" },
          ],
        },
        optB: {
          leadMsg: "Usamos o Pipefy / outro sistema interno.",
          botMsg: "Excelente! Integramos via webhook e API aberta em poucos minutos, permitindo mover cards nos pipes automaticamente conforme a IA qualifica. Para demonstrar essa automação rodando, vamos agendar um diagnóstico técnico rápido amanhã? Prefere de manhã ou à tarde?",
          reasoning: "IA valida a integração via API/Webhook do Pipefy e transiciona para o convite de reunião de diagnóstico técnico.",
          training: "Destaque a flexibilidade da API/Webhooks para Pipefy e sugira agendar reunião de diagnóstico técnico (pergunta manhã/tarde).",
          action: "Configuração de webhook ativada no lead.",
          options: [
            { label: "🗣️ 'Prefiro no período da manhã'", value: "optA" },
            { label: "🗣️ 'Prefiro no período da tarde'", value: "optB" },
          ],
        },
      },
      step4: {
        optA: {
          leadMsg: "Prefiro fazer no período da manhã.",
          botMsg: "Excelente! Tenho esses horários disponíveis com o nosso especialista técnico amanhã de manhã. Qual fica melhor?",
          reasoning: "IA identifica preferência pela manhã e busca slots no calendário do consultor de TI.",
          training: "Apresente os slots matutinos disponíveis para a reunião técnica: 09:00 e 10:30.",
          action: "Fila de agendas técnicas sincronizada. Reserva temporária feita.",
          slots: ["Amanhã às 09:00", "Amanhã às 10:30"],
        },
        optB: {
          leadMsg: "Prefiro fazer no período da tarde.",
          botMsg: "Excelente! Tenho esses horários disponíveis com o nosso especialista técnico amanhã à tarde. Qual fica melhor?",
          reasoning: "IA identifica preferência pela tarde e busca slots livres na agenda do consultor.",
          training: "Apresente os slots verpertinos disponíveis para a reunião técnica: 14:30 e 16:00.",
          action: "Reserva temporária criada no calendário.",
          slots: ["Amanhã às 14:30", "Amanhã às 16:00"],
        },
      },
      step5: {
        "Amanhã às 09:00": {
          leadMsg: "Marque para amanhã às 09:00.",
          botMsg: "Reunião confirmada, Roberto! Agenda bloqueada para amanhã às 09:00. O link do Google Meet e o convite oficial já foram enviados para o seu e-mail corporativo. Nos falamos amanhã!",
          reasoning: "Lead reserva o slot. IA efetiva o agendamento no Google Meet e envia a notificação de handoff contendo o stack tecnológico do cliente para o Closer.",
          training: "Após o lead confirmar, gere a reunião no Google Meet e envie o alerta de handoff com o CRM integrado do lead para o Closer da conta.",
          action: "Reunião gerada no Google Meet. Lead movido para 'Reunião Agendada' no CRM. Campanha de lembrete de call ativa.",
          handoff: {
            lead: "Roberto Junior",
            meta: "CRM: Hubspot | Foco: Qualificar Leads Frios de TI (Objeção 'Equipe Interna' superada)",
            action: "Reunião: Amanhã 09:00 (Google Meet) com Closer Daniel",
            closer: "Daniel (Closer B2B)",
          },
        },
        "Amanhã às 10:30": {
          leadMsg: "Pode ser amanhã às 10:30.",
          botMsg: "Reunião confirmada, Roberto! Agenda bloqueada para amanhã às 10:30. O link do Google Meet e o convite oficial já foram enviados para o seu e-mail corporativo. Nos falamos amanhã!",
          reasoning: "Lead agenda. IA cria a reunião no Meet e notifica o Closer.",
          training: "Crie reunião técnica e notifique Closer com relatório.",
          action: "Reunião criada. Handoff disparado.",
          handoff: {
            lead: "Roberto Junior",
            meta: "CRM: Hubspot | Foco: Qualificar Leads Frios de TI",
            action: "Reunião: Amanhã 10:30 (Google Meet) com Closer Daniel",
            closer: "Daniel (Closer B2B)",
          },
        },
        "Amanhã às 14:30": {
          leadMsg: "Quero amanhã às 14:30.",
          botMsg: "Reunião confirmada, Roberto! Agenda bloqueada para amanhã às 14:30. O link do Google Meet e o convite oficial já foram enviados para o seu e-mail corporativo. Nos falamos amanhã!",
          reasoning: "Lead agenda à tarde. IA gera o convite do Meet e notifica o Closer.",
          training: "Crie a reunião técnica e notifique Closer.",
          action: "Reunião criada. Handoff disparado.",
          handoff: {
            lead: "Roberto Junior",
            meta: "CRM: Pipefy | Foco: Qualificar Leads Frios (Objeção superada)",
            action: "Reunião: Amanhã 14:30 (Google Meet) com Closer Daniel",
            closer: "Daniel (Closer B2B)",
          },
        },
        "Amanhã às 16:00": {
          leadMsg: "Amanhã às 16:00 fica ótimo.",
          botMsg: "Reunião confirmada, Roberto! Agenda bloqueada para amanhã às 16:00. O link do Google Meet e o convite oficial já foram enviados para o seu e-mail corporativo. Nos falamos amanhã!",
          reasoning: "Lead agenda à tarde. IA gera o convite do Meet e notifica o Closer.",
          training: "Crie a reunião técnica e notifique Closer.",
          action: "Reunião criada. Handoff disparado.",
          handoff: {
            lead: "Roberto Junior",
            meta: "CRM: Pipefy | Foco: Qualificar Leads Frios",
            action: "Reunião: Amanhã 16:00 (Google Meet) com Closer Daniel",
            closer: "Daniel (Closer B2B)",
          },
        },
      },
    },
  },
};

type Message = {
  sender: "bot" | "lead" | "system";
  text: string;
  time: string;
};

export default function VexoPitch() {
  const [selectedSegmentKey, setSelectedSegmentKey] = useState<string>("academia");
  const segment = SEGMENTS[selectedSegmentKey];

  // Configurações do Prospect
  const [prospectName, setProspectName] = useState<string>(segment.defaultProspectName);
  const [prospectLogo, setProspectLogo] = useState<string | null>(null);

  // ROI Calculator Parameters
  const [leadsCount, setLeadsCount] = useState<number>(500);
  const [customTicket, setCustomTicket] = useState<number>(0);
  const [customConv, setCustomConv] = useState<number>(0);

  // Sync inputs on segment change
  useMemo(() => {
    setProspectName(segment.defaultProspectName);
    setLeadsCount(segment.leadsCountDefault);
    setCustomTicket(segment.averageTicket);
    setCustomConv(segment.conversionRateDefault);
  }, [selectedSegmentKey]);

  // Fullscreen Presentation State
  const [isPresenting, setIsPresenting] = useState<boolean>(false);
  const [activeSlide, setActiveSlide] = useState<number>(1);

  // Guided Chat Simulator State
  const [simStep, setSimStep] = useState<number>(1); // 1 to 5
  const [selectedObjection, setSelectedObjection] = useState<string>("");
  const [selectedQualification, setSelectedQualification] = useState<string>("");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<string>("");

  const handleStartPresentation = () => {
    setActiveSlide(1);
    setIsPresenting(true);
    handleResetSimulator();
  };

  const handleResetSimulator = () => {
    setSimStep(1);
    setSelectedObjection("");
    setSelectedQualification("");
    setSelectedPeriod("");
    setSelectedSlot("");
  };

  // Play synthetic double-chime ding sound for Step 5
  const playNotificationSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.type = "sine";
      // Double chime
      oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1); // A5
      
      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.35);
    } catch (e) {
      console.warn("Could not play notification sound", e);
    }
  };

  const handleSelectOption = (value: string) => {
    if (simStep === 1) {
      setSelectedObjection(value);
      setSimStep(2);
    } else if (simStep === 2) {
      setSelectedQualification(value);
      setSimStep(3);
    } else if (simStep === 3) {
      setSelectedPeriod(value);
      setSimStep(4);
    }
  };

  const handleSelectSlot = (slot: string) => {
    setSelectedSlot(slot);
    setSimStep(5);
    playNotificationSound();
  };

  // Chat History generation
  const chatHistory = useMemo((): Message[] => {
    const list: Message[] = [];
    
    // Step 1 Greeting (always show)
    list.push({ sender: "system", text: segment.steps.step1.action, time: "14:00" });
    list.push({ sender: "bot", text: segment.steps.step1.botMsg, time: "14:01" });
    
    // Step 2 Objection Contortion
    if (simStep >= 2 && selectedObjection) {
      const s2 = segment.steps.step2[selectedObjection];
      if (s2) {
        list.push({ sender: "lead", text: s2.leadMsg || "", time: "14:03" });
        list.push({ sender: "bot", text: s2.botMsg, time: "14:04" });
      }
    }
    
    // Step 3 Qualification
    if (simStep >= 3 && selectedQualification) {
      const s3 = segment.steps.step3[selectedQualification];
      if (s3) {
        list.push({ sender: "lead", text: s3.leadMsg || "", time: "14:06" });
        list.push({ sender: "bot", text: s3.botMsg, time: "14:07" });
      }
    }
    
    // Step 4 Calendar Period Selection
    if (simStep >= 4 && selectedPeriod) {
      const s4 = segment.steps.step4[selectedPeriod];
      if (s4) {
        list.push({ sender: "lead", text: s4.leadMsg || "", time: "14:09" });
        list.push({ sender: "bot", text: s4.botMsg, time: "14:10" });
      }
    }
    
    // Step 5 Handoff Confirm
    if (simStep >= 5 && selectedSlot) {
      const s5 = segment.steps.step5[selectedSlot];
      if (s5) {
        list.push({ sender: "lead", text: s5.leadMsg || "", time: "14:12" });
        list.push({ sender: "bot", text: s5.botMsg, time: "14:13" });
        list.push({ sender: "system", text: s5.action, time: "14:14" });
      }
    }
    
    return list;
  }, [segment, simStep, selectedObjection, selectedQualification, selectedPeriod, selectedSlot]);

  // AI thoughts and configuration instructions panel data
  const currentStepData = useMemo(() => {
    if (simStep === 1) {
      return {
        title: "Passo 1/5: Abordagem Automática",
        reasoning: segment.steps.step1.reasoning,
        training: segment.steps.step1.training,
        action: "Vexo Engine disparou o gatilho da campanha.",
      };
    }
    if (simStep === 2 && selectedObjection) {
      const s2 = segment.steps.step2[selectedObjection];
      return {
        title: "Passo 2/5: Contorno de Objeção",
        reasoning: s2.reasoning,
        training: s2.training,
        action: s2.action,
      };
    }
    if (simStep === 3 && selectedQualification) {
      const s3 = segment.steps.step3[selectedQualification];
      return {
        title: "Passo 3/5: Qualificação Ativa",
        reasoning: s3.reasoning,
        training: s3.training,
        action: s3.action,
      };
    }
    if (simStep === 4 && selectedPeriod) {
      const s4 = segment.steps.step4[selectedPeriod];
      return {
        title: "Passo 4/5: Proposta de Agenda",
        reasoning: s4.reasoning,
        training: s4.training,
        action: s4.action,
      };
    }
    if (simStep === 5 && selectedSlot) {
      const s5 = segment.steps.step5[selectedSlot];
      return {
        title: "Passo 5/5: Agendado & Handoff Closer",
        reasoning: s5.reasoning,
        training: s5.training,
        action: s5.action,
      };
    }
    return {
      title: "Vexo AI Simulator",
      reasoning: "Aguardando interação...",
      training: "Configuração de IA ativa.",
      action: "Nenhuma ação ativa.",
    };
  }, [segment, simStep, selectedObjection, selectedQualification, selectedPeriod, selectedSlot]);

  // Calculations for ROI slide (aligned with math tests)
  const qualifiedLeads = Math.round(leadsCount * 0.8);
  const operatorHoursSaved = Math.round((qualifiedLeads * 12) / 60);
  const currentSales = Math.round(leadsCount * (customConv / 100));
  const estimatedVexoSales = Math.round(currentSales * 1.30);
  const extraSales = Math.max(1, estimatedVexoSales - currentSales);
  const additionalRevenue = extraSales * customTicket;

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setProspectLogo(reader.result as string);
      toast({ title: "Sucesso", description: "Logotipo do prospect importado com sucesso!" });
    };
    reader.readAsDataURL(file);
  };

  return (
    <PageShell
      title="Demonstração Comercial"
      subtitle="Apresentação interativa do Vexo OS personalizada para prospects, com simulação em tela cheia."
      icon={Sparkles}
    >
      <div className="space-y-6">
        
        {/* Painel Normal de Configurações do Prospect */}
        <Card className="border-slate-200/80 bg-white/80 dark:border-white/10 dark:bg-slate-900/40 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4">
            <Button
              onClick={handleStartPresentation}
              className="gap-2 bg-indigo-600 hover:bg-indigo-500 font-extrabold shadow-lg shadow-indigo-600/10 px-5"
            >
              <Maximize2 className="h-4 w-4" />
              Iniciar Apresentação (Tela Cheia)
            </Button>
          </div>
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Bot className="h-5 w-5 text-indigo-600" />
              Configurar Marca do Prospect
            </CardTitle>
            <CardDescription>
              Personalize o nome e o logotipo do seu potencial cliente antes de projetar a tela inteira.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Seletor Segmento */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-500">Segmento do Prospect</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {Object.entries(SEGMENTS).map(([key, data]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedSegmentKey(key)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold transition-smooth",
                      selectedSegmentKey === key
                        ? "bg-indigo-600/10 border-indigo-500 text-indigo-700 dark:text-indigo-400"
                        : "bg-white border-slate-200 hover:bg-slate-50 dark:bg-slate-900/40 dark:border-white/5"
                    )}
                  >
                    <span>{data.emoji}</span>
                    <span>{data.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Nome do lead/empresa */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500" htmlFor="prospect-name">Nome da Empresa do Prospect</Label>
                <Input
                  id="prospect-name"
                  value={prospectName}
                  onChange={(e) => setProspectName(e.target.value)}
                  placeholder="Nome do cliente (ex: SmartFit)"
                  className="h-9.5 text-xs"
                />
              </div>

              {/* Logo Uploader */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500">Logotipo do Prospect (Opcional)</Label>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 shrink-0 border border-slate-200 dark:border-white/5 rounded-xl bg-slate-50 dark:bg-white/[0.02] flex items-center justify-center overflow-hidden">
                    {prospectLogo ? (
                      <img src={prospectLogo} alt="Logo" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold text-slate-400">{prospectName[0]?.toUpperCase() || "V"}</span>
                    )}
                  </div>
                  <div className="flex-1 flex gap-2">
                    <input
                      type="file"
                      id="prospect-logo-file"
                      accept="image/png, image/jpeg"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                    <Label
                      htmlFor="prospect-logo-file"
                      className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      Fazer Upload
                    </Label>
                    {prospectLogo && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" onClick={() => setProspectLogo(null)}>
                        Remover
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Parâmetros ROI e Preview Rápido */}
        <div className="grid gap-6 md:grid-cols-2">
          
          <Card className="border-slate-200/80 bg-white/80 dark:border-white/10 dark:bg-slate-900/40">
            <CardHeader>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Calculator className="h-4.5 w-4.5 text-indigo-600" />
                Métricas Financeiras para o Slide de ROI
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <Label>Volume de Leads Mensais</Label>
                  <span className="font-bold text-indigo-600">{leadsCount} contatos</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="2000"
                  step="50"
                  value={leadsCount}
                  onChange={(e) => setLeadsCount(Number(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-indigo-600 dark:bg-white/10"
                />
              </div>

              <div className="grid gap-3 grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-400 font-mono">Ticket Médio (R$)</Label>
                  <Input
                    type="number"
                    value={customTicket}
                    onChange={(e) => setCustomTicket(Number(e.target.value) || 0)}
                    className="h-8.5 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-400 font-mono">Conversão Atual (%)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={customConv}
                    onChange={(e) => setCustomConv(Number(e.target.value) || 0)}
                    className="h-8.5 text-xs"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-indigo-100 bg-indigo-50/10 dark:border-indigo-950/20 dark:bg-indigo-950/5 flex flex-col justify-between">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-indigo-700 dark:text-indigo-400">Resumo da Demonstração</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-2 flex-1 flex flex-col justify-center">
              <div className="flex justify-between">
                <span className="text-slate-500">Empresa Simulação:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{prospectName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Segmento Ativo:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{segment.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Produto Promovido:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{segment.productName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Faturamento Extra Projetado:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">R$ {additionalRevenue.toLocaleString("pt-BR")} / mês</span>
              </div>
            </CardContent>
          </Card>

        </div>

      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODO APRESENTAÇÃO FULLSCREEN (SPA SLIDES DECK)
          ═══════════════════════════════════════════════════════════════════════ */}
      {isPresenting && (
        <div className="fixed inset-0 z-50 bg-slate-950 text-white overflow-y-auto flex flex-col justify-between font-sans transition-all duration-300">
          
          {/* Animação Estelar Background */}
          <div className="stars-layer">
            <div className="stars-1" />
            <div className="stars-2" />
          </div>

          {/* Header Fullscreen */}
          <header className="relative z-10 shrink-0 border-b border-white/5 bg-slate-950/60 backdrop-blur-md px-8 py-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 border border-white/10 rounded-xl bg-white/5 flex items-center justify-center overflow-hidden shadow-lg shadow-indigo-500/10">
                {prospectLogo ? (
                  <img src={prospectLogo} alt="Logo" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-indigo-400">{prospectName[0]?.toUpperCase()}</span>
                )}
              </div>
              <div>
                <h2 className="text-base font-black tracking-tight text-white flex items-center gap-1.5">
                  {prospectName} <span className="text-slate-500 font-normal">| Demo Vexo OS</span>
                </h2>
                <p className="text-[10px] text-indigo-400 font-mono tracking-wider uppercase">{segment.name}</p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-slate-400 hover:text-white hover:bg-white/5 gap-1.5"
              onClick={() => setIsPresenting(false)}
            >
              <X className="h-4 w-4" />
              Sair da Apresentação
            </Button>
          </header>

          {/* Área Principal de Slides */}
          <main className="relative z-10 flex-1 flex items-center justify-center px-8 py-6">
            
            {/* SLIDE 1: O PROBLEMA */}
            {activeSlide === 1 && (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    SLIDE 01 · O GARGALO COMERCIAL NO WHATSAPP
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    Por que a sua empresa perde vendas no WhatsApp todos os dias?
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    A maioria das empresas não consegue responder em tempo recorde ou perde o controle do relacionamento com leads frios.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-2 mt-4">
                  {/* Card Dor 1 */}
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 space-y-4 relative overflow-hidden group hover:border-red-500/30 transition-all duration-300 shadow-2xl">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-red-500/5 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                      <AlertTriangle className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-red-400">Leads Parados e Frios na Base</h3>
                    <p className="text-base text-slate-300 leading-relaxed">
                      ⚠️ <strong>Dor específica:</strong> {segment.painPoint}
                    </p>
                    <p className="text-sm text-slate-400 leading-relaxed">
                      Ligar ou enviar mensagens de forma manual consome horas do dia da recepção/comercial, gerando baixas taxas de resposta e esquecimento.
                    </p>
                  </div>

                  {/* Card Dor 2 */}
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 space-y-4 relative overflow-hidden group hover:border-red-500/30 transition-all duration-300 shadow-2xl">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-red-500/5 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                      <Flame className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-red-400">Risco Alto de Banimentos de Chips</h3>
                    <p className="text-base text-slate-300 leading-relaxed">
                      Disparar campanhas manuais sem inteligência de aquecimento e em massa por um único número pessoal resulta em denúncias e bloqueios.
                    </p>
                    <p className="text-sm text-slate-400 leading-relaxed">
                      Perder o número de atendimento principal da empresa paralisa a operação comercial e destrói o faturamento imediato.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* SLIDE 2: A SOLUÇÃO */}
            {activeSlide === 2 && (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    SLIDE 02 · A SOLUÇÃO VEXO OS
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    Os Dois Motores da Automação de WhatsApp
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    Combinando Inteligência Artificial de atendimento à maior infraestrutura de disparos seguros do mercado.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-2 mt-4">
                  {/* Máquina de Vendas */}
                  <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/10 p-8 space-y-5 relative overflow-hidden group shadow-[inset_0_0_30px_rgba(99,102,241,0.15)]">
                    <div className="absolute -right-16 -top-16 h-36 w-36 bg-indigo-500/10 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
                      <TrendingUp className="h-7 w-7" />
                    </div>
                    <h3 className="text-2xl font-black text-indigo-400">1. Motor de Atendimento (Inbound)</h3>
                    <ul className="space-y-3.5 text-sm text-slate-300">
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-400 mt-0.5" />
                        <span><strong>Qualificação Inteligente com IA</strong>: Respostas baseadas em treinamento de nicho para qualificar leads 24/7.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-400 mt-0.5" />
                        <span><strong>Contorno de Objeções Ativo</strong>: IA programada para rebater desculpas comuns e guiar ao fechamento.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-400 mt-0.5" />
                        <span><strong>Agendamento Automático (API)</strong>: Sincronização nativa para agendar visitas ou reuniões nos calendários.</span>
                      </li>
                    </ul>
                  </div>

                  {/* Máquina de Disparos */}
                  <div className="rounded-2xl border border-orange-500/30 bg-orange-950/10 p-8 space-y-5 relative overflow-hidden group shadow-[inset_0_0_30px_rgba(249,115,22,0.15)]">
                    <div className="absolute -right-16 -top-16 h-36 w-36 bg-orange-500/10 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/20 text-orange-400">
                      <Flame className="h-7 w-7" />
                    </div>
                    <h3 className="text-2xl font-black text-orange-400">2. Motor de Disparos (Outbound)</h3>
                    <ul className="space-y-3.5 text-sm text-slate-300">
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-400 mt-0.5" />
                        <span><strong>Distribuição Multi-Chip</strong>: Campanhas disparadas dividindo a carga entre vários números comerciais.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-400 mt-0.5" />
                        <span><strong>Aquecimento Inteligente</strong>: Simulação automática de conversas humanas para blindar chips contra bans.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-400 mt-0.5" />
                        <span><strong>Follow-up de Longo Prazo</strong>: Cobrança automática de propostas e reativação programada de contatos.</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* SLIDE 3: FOLLOW-UPS E REENGAJAMENTO */}
            {activeSlide === 3 && (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-orange-500/10 border-orange-500/20 text-orange-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    SLIDE 03 · FOLLOW-UP & REENGAJAMENTO
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    Persistência Sem Esforço: Follow-ups Inteligentes
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    Não dependa de planilhas ou da memória do vendedor. Automatize a persistência comercial de forma de cadência ativa com pausa automática.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-3 mt-4">
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-4 relative overflow-hidden group hover:border-orange-500/30 transition-all duration-300 shadow-2xl">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-orange-500/5 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400">
                      <Clock className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-orange-400">Cadências Prontas</h3>
                    <ul className="space-y-2.5 text-xs text-slate-300">
                      <li className="flex items-start gap-2">
                        <Check className="h-4 w-4 shrink-0 text-orange-400 mt-0.5" />
                        <span><strong>Lembrete Pré-Reunião (No-Show)</strong>: Envia mensagens automáticas antes do agendamento, diminuindo faltas em até 70%.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="h-4 w-4 shrink-0 text-orange-400 mt-0.5" />
                        <span><strong>Cobrança de Proposta</strong>: Relembra o lead sobre a proposta de forma automática e sutil.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="h-4 w-4 shrink-0 text-orange-400 mt-0.5" />
                        <span><strong>Reativação de Frios</strong>: Resgata contatos antigos ou inativos de meses atrás de maneira prática.</span>
                      </li>
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/10 p-6 space-y-4 relative overflow-hidden group shadow-[inset_0_0_30px_rgba(99,102,241,0.15)] md:col-span-2">
                    <div className="absolute -right-16 -top-16 h-36 w-36 bg-indigo-500/10 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
                      <Bot className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-indigo-400">Pausa Automática Pós-Resposta</h3>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      O maior risco das automações é continuar mandando mensagens após o cliente responder. O Vexo OS resolve isso nativamente:
                    </p>
                    <div className="rounded-xl bg-slate-950/50 p-4 border border-white/5 space-y-2">
                      <p className="text-xs text-slate-400 flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        <strong>Detecção em tempo real:</strong>
                      </p>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Assim que o lead responde (ex: "Gostei, vamos marcar"), a cadência de follow-up é pausada no mesmo segundo. O Closer recebe uma notificação instantânea e assume o atendimento de forma 100% humanizada.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SLIDE 4: INTELIGÊNCIA COMERCIAL & ROTEAMENTO */}
            {activeSlide === 4 && (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-emerald-500/10 border-emerald-500/20 text-emerald-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    SLIDE 04 · INTELIGÊNCIA & ROTEAMENTO DE LEADS
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    Roteamento Inteligente & Governança da Operação
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    Distribua leads de forma otimizada para o vendedor certo no timing exato e identifique gargalos comerciais instantaneamente.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-3 mt-4">
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-4 hover:border-emerald-500/30 transition-all duration-300 relative overflow-hidden group shadow-2xl">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-emerald-500/5 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                      <Users className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-emerald-400">Distribuição Round Robin</h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Distribuição automática de leads baseada no status de atividade do vendedor. Permite configurar pesos e regras baseados em conversão histórica de cada consultor da equipe.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-4 hover:border-emerald-500/30 transition-all duration-300 relative overflow-hidden group shadow-2xl">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-emerald-500/5 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                      <Bell className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-emerald-400">Alertas de SLA Estrito</h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Tempo é dinheiro. Se o lead qualificado pela IA não for atendido pelo vendedor humano em até 10 minutos, o Vexo OS gera alertas visuais e reencaminha o lead na hora para salvar a venda.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-4 hover:border-emerald-500/30 transition-all duration-300 relative overflow-hidden group shadow-2xl">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-emerald-500/5 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                      <Sparkles className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-emerald-400">Diagnósticos da IA</h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Tenha um analista de dados integrado. O Vexo Brain analisa conversas inteiras e sintetiza relatórios diários de dores dos clientes, objeções mais comuns e sugestões práticas de melhoria.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* SLIDE 5: O SIMULADOR LIVE MULTITURNO */}
            {activeSlide === 5 && (
              <div className="max-w-[1400px] w-full space-y-6 animate-fade-in-up">
                <div className="text-center space-y-1">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-3 py-1 uppercase tracking-wider font-mono">
                    SLIDE 05 · SIMULADOR LIVE VEXO OS
                  </Badge>
                  <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
                    Simulação Interativa de Atendimento Automático
                  </h1>
                  <p className="text-sm text-slate-400">
                    Acompanhe como a inteligência artificial qualifica o lead, contorna as dores e move o card no funil de vendas em tempo real.
                  </p>
                </div>

                <div className="grid gap-6 lg:grid-cols-12 items-stretch">
                  
                  {/* Coluna Esquerda (5/12): WhatsApp Simulator */}
                  <div className="lg:col-span-5 flex flex-col justify-between bg-slate-900/60 border border-white/5 rounded-2xl p-4 space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 border border-white/10 rounded-full overflow-hidden shrink-0">
                            {prospectLogo ? (
                              <img src={prospectLogo} alt="Prospect Logo" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[10px] font-bold text-indigo-400 text-center block leading-7 bg-white/5">{prospectName[0]}</span>
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white leading-none">{prospectName}</p>
                            <span className="text-[8px] text-emerald-400 font-mono flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> online
                            </span>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="h-7 text-[10px] text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/10 px-2.5 py-0" onClick={handleResetSimulator}>
                          <RefreshCw className="h-3 w-3 mr-1" /> Reiniciar Simulação
                        </Button>
                      </div>

                      {/* Caixa de Mensagens */}
                      <div className="bg-slate-950/70 border border-white/5 rounded-xl p-3.5 h-[280px] overflow-y-auto flex flex-col gap-3">
                        {chatHistory.map((msg, i) => (
                          <div
                            key={i}
                            className={cn(
                              "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs flex flex-col animate-fade-in-up leading-relaxed shadow-md",
                              msg.sender === "bot"
                                ? "bg-slate-800 text-slate-100 self-start border border-white/5"
                                : msg.sender === "lead"
                                ? "bg-indigo-600 text-white self-end"
                                : "bg-white/[0.02] text-slate-400 self-center text-[9px] py-1 border border-transparent font-mono rounded-lg"
                            )}
                          >
                            {msg.sender === "bot" && (
                              <span className="text-[8px] font-mono font-bold text-indigo-400 uppercase tracking-wider mb-1 block">Atendente IA ({prospectName})</span>
                            )}
                            {msg.sender === "lead" && (
                              <span className="text-[8px] font-mono font-bold text-indigo-300 uppercase tracking-wider mb-1 block">Lead: Felipe Melo / Mariana</span>
                            )}
                            <span>{msg.text}</span>
                            {msg.sender !== "system" && (
                              <span className="text-[7px] opacity-60 self-end mt-0.5">{msg.time}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Controles de Ação do Lead */}
                    <div className="border-t border-white/5 pt-3.5">
                      {simStep <= 3 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                            <Smartphone className="h-3.5 w-3.5 text-indigo-400" />
                            Escolha a resposta do lead (Cliente):
                          </p>
                          <div className="grid grid-cols-1 gap-2">
                            {simStep === 1 && segment.steps.step1.options?.map((opt, i) => (
                              <button
                                key={i}
                                className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-600/20 hover:border-indigo-500 text-xs font-bold py-2.5 px-3.5 text-left transition-smooth text-slate-200"
                                onClick={() => handleSelectOption(opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                            {simStep === 2 && selectedObjection && segment.steps.step2[selectedObjection]?.options?.map((opt, i) => (
                              <button
                                key={i}
                                className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-600/20 hover:border-indigo-500 text-xs font-bold py-2.5 px-3.5 text-left transition-smooth text-slate-200"
                                onClick={() => handleSelectOption(opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                            {simStep === 3 && selectedQualification && segment.steps.step3[selectedQualification]?.options?.map((opt, i) => (
                              <button
                                key={i}
                                className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-600/20 hover:border-indigo-500 text-xs font-bold py-2.5 px-3.5 text-left transition-smooth text-slate-200"
                                onClick={() => handleSelectOption(opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Passo 4: Grid interativo de Slots de Horários */}
                      {simStep === 4 && selectedPeriod && (
                        <div className="space-y-2.5">
                          <p className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-emerald-400" />
                            Selecione um horário na Agenda para confirmar:
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {segment.steps.step4[selectedPeriod]?.slots?.map((slot, i) => (
                              <button
                                key={i}
                                className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 hover:bg-emerald-600 text-white text-xs font-black py-3 px-2 text-center transition-smooth"
                                onClick={() => handleSelectSlot(slot)}
                              >
                                {slot}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Passo 5: Sucesso Completo */}
                      {simStep === 5 && (
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/15 p-3 flex items-center gap-3">
                          <div className="h-8 w-8 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400 animate-pulse">
                            <Check className="h-4.5 w-4.5" />
                          </div>
                          <div>
                            <p className="text-xs font-black text-emerald-400 leading-none">Agendamento Realizado!</p>
                            <p className="text-[10px] text-slate-400 mt-1">A IA qualificou o lead, bloqueou a agenda e enviou o alerta ao Closer.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Coluna Direita (7/12): Vexo OS Brain & CRM Dashboard */}
                  <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
                    
                    {/* CRM Kanban Board */}
                    <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4.5 space-y-2">
                      <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5 text-indigo-400" />
                        Status do CRM Integrado em Tempo Real
                      </p>
                      
                      <div className="grid grid-cols-4 gap-2.5 h-[100px] bg-slate-950/50 rounded-xl p-2">
                        {/* Coluna Novo */}
                        <div className="rounded-lg bg-white/[0.01] p-1 flex flex-col gap-1 overflow-hidden">
                          <span className="text-[8px] font-bold text-slate-500 uppercase text-center block">Novo</span>
                          {simStep === 1 && (
                            <div className="rounded bg-indigo-500/10 border border-indigo-500/30 p-1.5 animate-pulse text-center">
                              <p className="text-[9px] font-black text-white truncate">{prospectName[0] || "L"}</p>
                              <span className="text-[7px] text-indigo-400 block font-semibold leading-none mt-0.5">Triagem IA</span>
                            </div>
                          )}
                        </div>

                        {/* Coluna Qualificando */}
                        <div className="rounded-lg bg-white/[0.01] p-1 flex flex-col gap-1 overflow-hidden">
                          <span className="text-[8px] font-bold text-slate-500 uppercase text-center block">Qualificando</span>
                          {(simStep === 2 || simStep === 3) && (
                            <div className="rounded bg-amber-500/10 border border-amber-500/30 p-1.5 text-center">
                              <p className="text-[9px] font-black text-white truncate">{prospectName[0] || "L"}</p>
                              <span className="text-[7px] text-amber-500 block font-semibold leading-none mt-0.5">Qualificando</span>
                            </div>
                          )}
                        </div>

                        {/* Coluna Agendado */}
                        <div className="rounded-lg bg-white/[0.01] p-1 flex flex-col gap-1 overflow-hidden">
                          <span className="text-[8px] font-bold text-slate-500 uppercase text-center block">Agendado</span>
                          {simStep >= 4 && (
                            <div className={cn(
                              "rounded bg-emerald-500/20 border border-emerald-500 p-1.5 text-center shadow-lg shadow-emerald-500/10",
                              simStep === 5 ? "animate-bounce" : ""
                            )}>
                              <p className="text-[9px] font-black text-white truncate">{prospectName[0] || "L"}</p>
                              <span className="text-[7px] text-emerald-400 block font-black leading-none mt-0.5">✓ {segment.goalAction.split(" ")[1]}</span>
                            </div>
                          )}
                        </div>

                        {/* Coluna Arquivado */}
                        <div className="rounded-lg bg-white/[0.01] p-1 flex flex-col gap-1 overflow-hidden">
                          <span className="text-[8px] font-bold text-slate-500 uppercase text-center block">Perdidos</span>
                        </div>
                      </div>
                    </div>

                    {/* AI Reasoning Console (Vexo Brain) */}
                    <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4.5 space-y-3.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Bot className="h-4 w-4 text-indigo-400" />
                            Painel de Inteligência Vexo OS
                          </p>
                          <Badge variant="outline" className="text-[9px] px-2 py-0.5 border-indigo-500/30 text-indigo-400 font-mono bg-indigo-500/5">
                            {currentStepData.title}
                          </Badge>
                        </div>

                        {/* Detalhes do Turno */}
                        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                          <div className="bg-slate-950/60 rounded-xl p-3 border border-white/5 space-y-1">
                            <span className="text-[9px] font-black text-indigo-400 uppercase font-mono tracking-wider">Como a IA pensa (Raciocínio)</span>
                            <p className="text-xs text-slate-300 leading-relaxed font-sans">
                              {currentStepData.reasoning}
                            </p>
                          </div>
                          <div className="bg-slate-950/60 rounded-xl p-3 border border-white/5 space-y-1">
                            <span className="text-[9px] font-black text-emerald-400 uppercase font-mono tracking-wider">Treinamento Ativo Configurado</span>
                            <p className="text-xs text-slate-300 leading-relaxed font-sans italic">
                              "{currentStepData.training}"
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Explicador de Ações em Background e Handoff do Closer no Passo 5 */}
                      <div className="border-t border-white/5 pt-3.5">
                        {simStep < 5 ? (
                          <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-950/40 rounded-xl p-2.5 border border-white/5">
                            <span className="flex items-center gap-1.5 font-mono text-[10px]">
                              <Clock className="h-3.5 w-3.5 text-indigo-400" />
                              Ação de Backstage:
                            </span>
                            <span className="text-[11px] font-bold text-slate-200 truncate max-w-md">{currentStepData.action}</span>
                          </div>
                        ) : (
                          // Passo 5: Card de Handoff Completo e Relatório de Qualificação para Closer
                          <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/30 p-4 shadow-xl space-y-3 relative overflow-hidden animate-pulse">
                            <div className="absolute top-0 right-0 p-3 text-indigo-400">
                              <Bell className="h-5 w-5 animate-bounce" />
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <UserCheck className="h-4.5 w-4.5 text-indigo-400" />
                              <span className="text-xs font-black text-indigo-300 uppercase font-mono tracking-wider">
                                Card de Qualificação Comercial Criado (Handoff)
                              </span>
                            </div>

                            {segment.steps.step5[selectedSlot]?.handoff && (
                              <div className="grid gap-2 grid-cols-2 text-xs">
                                <div className="space-y-0.5">
                                  <span className="text-[9px] text-slate-500 uppercase font-mono block">Nome do Lead</span>
                                  <p className="font-bold text-white truncate">{segment.steps.step5[selectedSlot].handoff.lead}</p>
                                </div>
                                <div className="space-y-0.5">
                                  <span className="text-[9px] text-slate-500 uppercase font-mono block">Responsável (Closer)</span>
                                  <p className="font-bold text-indigo-300 truncate">{segment.steps.step5[selectedSlot].handoff.closer}</p>
                                </div>
                                <div className="col-span-2 space-y-0.5 border-t border-white/5 pt-1.5">
                                  <span className="text-[9px] text-slate-500 uppercase font-mono block">Dados da Triagem da IA</span>
                                  <p className="text-slate-300 leading-relaxed text-[11px]">{segment.steps.step5[selectedSlot].handoff.meta}</p>
                                </div>
                                <div className="col-span-2 space-y-0.5 border-t border-white/5 pt-1.5">
                                  <span className="text-[9px] text-slate-500 uppercase font-mono block">Horário Reservado</span>
                                  <p className="text-emerald-400 font-extrabold">{segment.steps.step5[selectedSlot].handoff.action}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                    </div>

                  </div>

                </div>
              </div>
            )}

            {/* SLIDE 6: ROI E RESULTADOS */}
            {activeSlide === 6 && (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-emerald-500/10 border-emerald-500/20 text-emerald-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    SLIDE 06 · PROJEÇÃO DE RETORNO DO INVESTIMENTO (R.O.I.)
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    Resultados Esperados para {prospectName}
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    Demonstrativo financeiro simulado baseado nas métricas de conversão e ticket médio do seu nicho.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-3 mt-4">
                  {/* ROI Card 1 */}
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 space-y-3 text-center shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
                    <p className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">Tempo Comercial Salvo</p>
                    <p className="text-5xl md:text-6xl font-black text-indigo-400 tracking-tight">{operatorHoursSaved}h</p>
                    <p className="text-sm text-slate-500 leading-relaxed">de trabalho de recepção e triagem manual economizados por mês para sua equipe focar apenas no fechamento presencial.</p>
                  </div>

                  {/* ROI Card 2 */}
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 space-y-3 text-center shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
                    <p className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">Novas Vendas Adicionais</p>
                    <p className="text-5xl md:text-6xl font-black text-orange-400 tracking-tight">+{extraSales}</p>
                    <p className="text-sm text-slate-500 leading-relaxed">fechamentos mensais conquistados devido à qualificação em menos de 60 segundos e follow-ups automáticos persistentes.</p>
                  </div>

                  {/* ROI Card 3 */}
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/5 p-8 space-y-3 text-center shadow-[0_8px_30px_rgba(16,185,129,0.08)]">
                    <p className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">Faturamento Extra Estimado</p>
                    <p className="text-3xl md:text-4xl font-black text-emerald-400 tracking-tight pt-2">
                      R$ {additionalRevenue.toLocaleString("pt-BR")}
                    </p>
                    <p className="text-sm text-slate-500 leading-relaxed pt-2">de faturamento recorrente extra recuperado de leads que simplesmente sumiriam e esfriariam na base fria.</p>
                  </div>
                </div>

                <div className="rounded-2xl bg-indigo-600 p-5 text-center font-black text-base tracking-tight text-white max-w-lg mx-auto shadow-2xl shadow-indigo-600/30 mt-6">
                  ⚡ Recupere o investimento da plataforma no primeiro mês de uso!
                </div>
              </div>
            )}

          </main>

          {/* Rodapé de Navegação Fullscreen */}
          <footer className="relative z-10 shrink-0 border-t border-white/5 bg-slate-950/60 backdrop-blur-md px-8 py-5 flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-9 text-xs font-bold transition-all duration-200",
                  activeSlide === 1
                    ? "border-white/5 bg-transparent text-white/20 cursor-not-allowed opacity-30"
                    : "border-white/20 text-white bg-slate-900/60 hover:bg-white/10 hover:text-white"
                )}
                disabled={activeSlide === 1}
                onClick={() => setActiveSlide(activeSlide - 1)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Voltar Slide
              </Button>
            </div>

            {/* Indicadores de slides */}
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6].map((slideNum) => (
                <div
                  key={slideNum}
                  onClick={() => setActiveSlide(slideNum)}
                  className={cn(
                    "h-2.5 w-10 rounded-full cursor-pointer transition-smooth",
                    activeSlide === slideNum ? "bg-indigo-500" : "bg-white/10 hover:bg-white/20"
                  )}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {activeSlide < 6 ? (
                <Button
                  size="sm"
                  className="h-9 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white px-5"
                  onClick={() => setActiveSlide(activeSlide + 1)}
                >
                  Avançar Slide
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-9 bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white px-5"
                  onClick={() => setIsPresenting(false)}
                >
                  Encerrar Demonstração
                </Button>
              )}
            </div>
          </footer>

        </div>
      )}

    </PageShell>
  );
}
