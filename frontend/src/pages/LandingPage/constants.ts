// frontend/src/pages/LandingPage/constants.ts

import {
  Bot,
  FileSignature,
  Filter,
  RefreshCw,
} from "lucide-react";
import type { FaqItem, MethodologyStep, MetricItem, PillarItem, PlanItem } from "./types";

export const DEMO_PHONE_NUMBER = "5534999996397";

export const METRICS: MetricItem[] = [
  {
    value: "24/7",
    label: "Resposta Imediata",
    detail: "Atendimento ativo em menos de 3 segundos sem fila ou janela morta.",
  },
  {
    value: "3 Faixas",
    label: "Ativação de Base",
    detail: "Nunca Abordados, Em Conversa e Negociação com cadências automáticas.",
  },
  {
    value: "Zero Furos",
    label: "Contratos & Finanças",
    detail: "Cláusulas modulares, cronogramas flexíveis e PDF pronto para assinar.",
  },
];

export const FOUR_PILLARS: PillarItem[] = [
  {
    number: "01",
    title: "Agentes Inteligentes no WhatsApp",
    badge: "Atendimento 24/7 & RAG",
    description:
      "Atendimento ativo sem perda de tempo de resposta. A IA qualifica oportunidades e responde com base documental segura.",
    items: [
      "Qualificação em tempo real sem travar a operação comercial",
      "Respostas contextualizadas com RAG de documentos e regras do negócio",
      "Handoff limpo para operadores humanos com resumo prévio da conversa",
    ],
    icon: Bot,
    tone: "from-[#9600FF]/25 via-[#4B00FF]/10 to-transparent",
  },
  {
    number: "02",
    title: "Ativação de Base & Recuperação",
    badge: "Contatos em 3 Faixas",
    description:
      "Reative contatos dormentes e conduza conversas com ritmo constante sem depender de disparos genéricos.",
    items: [
      "Classificação em 3 faixas comerciais: Nunca Abordados, Em Conversa e Em Negociação",
      "Cadências automáticas de follow-up guiadas por âncoras reais de calendário",
      "Disparos seguros com alternância de chips e controle anti-bloqueio",
    ],
    icon: RefreshCw,
    tone: "from-[#9600FF]/20 via-[#644BFF]/10 to-transparent",
  },
  {
    number: "03",
    title: "Controle Total do Funil",
    badge: "A IA Não Decide Sozinha",
    description:
      "A IA atende e organiza as informações, mas quem decide avançar, pausar ou fechar o negócio é sempre você e sua equipe.",
    items: [
      "Identificação automática de intenções de compra, orçamento ou motivos de perda",
      "Segurança total: suas decisões manuais jamais são sobrescritas pela automação",
      "Vocabulário e etapas 100% customizáveis para o jeito que a sua empresa vende",
    ],
    icon: Filter,
    tone: "from-white/15 via-white/5 to-transparent",
  },
  {
    number: "04",
    title: "Contratos & Fechamento Ágil",
    badge: "Cláusulas Modulares & PDF",
    description:
      "Gere propostas e contratos blindados em segundos, eliminando idas e vindas de minutas manuais.",
    items: [
      "Montagem em blocos de cláusulas modulares com numeração ordinal contínua",
      "Cronograma flexível com suporte a parcelas semanais, quinzenais, mistas e permuta",
      "Exportação em PDF limpo formatado para assinatura digital imediata",
    ],
    icon: FileSignature,
    tone: "from-[#9600FF]/22 via-[#4B00FF]/8 to-transparent",
  },
];

export const METHODOLOGY: MethodologyStep[] = [
  {
    step: "01",
    title: "Diagnóstico da Operação",
    description:
      "Mapeamos a entrada de leads, gargalos no atendimento, tempos mortos e principais objeções de fechamento antes de automatizar.",
  },
  {
    step: "02",
    title: "Configuração dos 5 Pilares do Agente",
    description:
      "Definimos produtos, faixas de preço, tom de voz, regras comerciais invioláveis e exatamente o que a IA não pode prometer.",
  },
  {
    step: "03",
    title: "Ativação & Ritmo Comercial",
    description:
      "Conectamos os chips de WhatsApp, acionamos disparos segmentados e acompanhamos o funil em tempo real com supervisão humana.",
  },
];

export const PLANS: PlanItem[] = [
  {
    name: "Operação Essencial",
    price: "Sob Consulta",
    badge: "Começo Seguro",
    description: "Ideal para empresas que querem profissionalizar o atendimento no WhatsApp e centralizar o funil.",
    features: [
      "Até 2 chips de WhatsApp integrados",
      "Agente de qualificação 24/7 com RAG",
      "Funil comercial com controle total (a IA não decide sozinha)",
      "Ativação de contatos em 3 faixas",
      "Suporte e onboarding assistido",
    ],
    featured: false,
  },
  {
    name: "Escala Comercial",
    price: "Mais Popular",
    badge: "Operação Completa",
    description: "Para equipes que precisam de múltiplos agentes, geração de contratos e esteira de automação ativa.",
    features: [
      "Múltiplas instâncias de WhatsApp com rodízio inteligente",
      "Agentes treinados com documentação do negócio",
      "Módulo de Contratos & Cronograma flexível",
      "Cadências automáticas de pós-venda e follow-up",
      "Sugestão inteligente de estágio no Inbox",
      "Relatórios de inteligência comercial em tempo real",
    ],
    featured: true,
  },
  {
    name: "Enterprise Multi-Instâncias",
    price: "Customizado",
    badge: "Grandes Volumes",
    description: "Para redes, franqueadoras ou operações de alto volume com regras corporativas dedicadas.",
    features: [
      "Instâncias ilimitadas de WhatsApp",
      "Isolamento multi-tenant robusto",
      "Modelos contratuais complexos e personalizados",
      "SLA dedicado de suporte e engenharia",
      "Integrações de API e Webhooks customizados",
    ],
    featured: false,
  },
];

export const FAQS: FaqItem[] = [
  {
    question: "O agente de IA substitui meu time de vendas?",
    answer:
      "Não. O Vexo OS foi desenvolvido para potencializar seus vendedores, não substituí-los. Ele assume a triagem inicial instantânea 24/7, responde dúvidas com base na sua documentação e entrega o lead pronto e qualificado para o fechamento humano com histórico completo.",
  },
  {
    question: "Existe risco de bloqueio nos números de WhatsApp?",
    answer:
      "O sistema possui arquitetura de segurança anti-bloqueio com alternância e rodízio de chips, intervalos humanizados entre mensagens e aquecimento progressivo, evitando o comportamento de disparo em massa proibido pelo WhatsApp.",
  },
  {
    question: "O que acontece se um vendedor mudar o estágio de um lead manualmente?",
    answer:
      "A decisão do vendedor é soberana. O Vexo OS garante controle total: nenhuma automação ou inteligência artificial altera ou fecha negócios sem a validação da equipe humana.",
  },
  {
    question: "Como funciona a geração de contratos em PDF?",
    answer:
      "O módulo de contratos permite combinar blocos de cláusulas modulares, dados cadastrais do cliente e cronogramas flexíveis (semanal, quinzenal, parcelado ou permuta), gerando o documento pronto para assinatura digital em menos de 10 segundos.",
  },
  {
    question: "A plataforma funciona para o segmento da minha empresa?",
    answer:
      "Sim. O Vexo OS é flexível e customizável para operações B2B, serviços de alto valor, clínicas, imobiliárias, consultorias e empresas de tecnologia que vendem e negociam ativamente através do WhatsApp.",
  },
];

export const FOOTER_LINKS = [
  { label: "Solução", href: "#solucao" },
  { label: "Os 4 Pilares", href: "#pilares" },
  { label: "Metodologia", href: "#metodologia" },
  { label: "Planos", href: "#planos" },
  { label: "FAQ", href: "#faq" },
];
