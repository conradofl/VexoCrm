// frontend/src/pages/LandingPage/constants.ts

import {
  Activity,
  ArchiveRestore,
  Bot,
  Calendar,
  Clock,
  Database,
  FileSignature,
  FileText,
  Filter,
  Globe,
  Layers,
  Link2,
  MessageSquare,
  Radio,
  RefreshCw,
  Send,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";
import type {
  CoreFoundationItem,
  FaqItem,
  MethodologyStep,
  ModuleItem,
  PillarItem,
  PlanCardItem,
  PlanComparisonRow,
} from "./types";

export const DEMO_PHONE_NUMBER = "5534991751267";

// -------------------------------------------------------------
// SEÇÃO 2 — NÚMEROS DE PROVA REAL
// -------------------------------------------------------------
export const PROOF_METRICS = [
  {
    targetValue: 62.7,
    suffix: "%",
    label: "taxa de resposta numa campanha real",
    decimals: 1,
  },
  {
    targetValue: 366,
    suffix: "",
    label: "contatos ativados em 2 dias",
    decimals: 0,
  },
  {
    targetValue: 0,
    suffix: "",
    label: "bloqueios de chip",
    decimals: 0,
  },
];

// -------------------------------------------------------------
// SEÇÃO 4 — 4 PILARES DO MÉTODO VEXO
// -------------------------------------------------------------
export const FOUR_PILLARS: PillarItem[] = [
  {
    number: "01",
    title: "Decisão antes da burocracia.",
    badge: "Agilidade",
    description:
      "O vendedor não pode perder tempo alimentando 30 campos de formulário. O Vexo OS resume a conversa e sugere o próximo passo.",
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
    title: "Conversa antes da ferramenta.",
    badge: "Naturalidade",
    description:
      "A venda acontece na conversa real de WhatsApp. O sistema opera como suporte invisível, sem travar o ritmo comercial.",
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
    title: "Trava humana antes da autonomia cega.",
    badge: "Controle",
    description:
      "A IA qualifica e responde, mas a decisão do vendedor é sagrada e inviolável. Nenhuma automação sobrescreve a escolha da sua equipe.",
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
    title: "Contrato assinado antes da vaidade.",
    badge: "Fechamento",
    description:
      "Métrica de vaidade não paga conta. Nosso foco é gerar a minuta comercial em PDF e coletar a assinatura na hora certa.",
    items: [
      "Montagem em blocos de cláusulas modulares com numeração ordinal contínua",
      "Cronograma flexível com suporte a parcelas semanais, quinzenais, mistas e permuta",
      "Exportação em PDF limpo formatado para assinatura digital imediata",
    ],
    icon: FileSignature,
    tone: "from-[#9600FF]/22 via-[#4B00FF]/8 to-transparent",
  },
];

// -------------------------------------------------------------
// SEÇÃO 6 — O NÚCLEO (VEM EM TODOS OS PLANOS)
// -------------------------------------------------------------
export const CORE_FOUNDATION: CoreFoundationItem[] = [
  {
    id: "conversas",
    name: "CONVERSAS",
    tagline: "Substitui o WhatsApp Web do time inteiro",
    description:
      "Todos os WhatsApp da empresa numa tela só. Lembretes, agendamento de mensagem e nota interna. Centraliza o atendimento com visibilidade total da gestão.",
    icon: MessageSquare,
    features: [
      "Todos os WhatsApp da empresa centralizados",
      "Lembretes e notas internas por lead",
      "Agendamento de mensagens futuras",
      "Visibilidade completa de histórico",
    ],
  },
  {
    id: "banco",
    name: "BANCO DE DADOS INTELIGENTE",
    tagline: "Sua base organizada com funil visual",
    description:
      "Sua base organizada com funil visual. Transforma conversas e grupos em contatos classificados, e mostra quem está esquecido.",
    icon: Database,
    features: [
      "Base de contatos com funil visual em colunas",
      "Extração inteligente de conversas e grupos",
      "Identificação automática de leads parados",
      "Filtros rápidos por estágio e responsável",
    ],
  },
];

// -------------------------------------------------------------
// SEÇÃO 6 — OS 6 MÓDULOS DE VERDADE (FUNCIONAM SOZINHOS)
// -------------------------------------------------------------
export const CATALOG_MODULES: ModuleItem[] = [
  {
    number: "01",
    title: "Campanhas & Disparos",
    description:
      "Envio em lote com janela de horário, variações anti-bloqueio, links rastreados e acompanhamento lote a lote.",
    icon: Radio,
  },
  {
    number: "02",
    title: "Agente de IA 24/7",
    description:
      "Responde, qualifica e marca reunião sozinho — pelo seu manual comercial, não por achismo. Com trava humana: a decisão do vendedor é inviolável.",
    icon: Bot,
  },
  {
    number: "03",
    title: "Follow-up & Cadências",
    description:
      "Réguas automáticas que recuperam quem sumiu, com passos e intervalos que você define.",
    icon: RefreshCw,
  },
  {
    number: "04",
    title: "Contratos & Propostas",
    description:
      "Minuta e proposta geradas na conversa, puxando os dados do lead automaticamente. Sem digitar nada duas vezes.",
    icon: FileSignature,
  },
  {
    number: "05",
    title: "Múltiplos Chips",
    description:
      "Vários números com rodízio inteligente, aquecimento e transbordo: o batedor abre, o fechador assume.",
    icon: Smartphone,
  },
  {
    number: "06",
    title: "Página de Captação",
    description:
      "A porta de entrada do seu CRM: modelos prontos conectados direto ao seu funil, com auto-resposta imediata no WhatsApp e leitura da jornada do lead.",
    icon: Globe,
  },
];

// -------------------------------------------------------------
// SEÇÃO 7 — LINHA DO TEMPO DA IMPLANTAÇÃO (3 DIAS)
// -------------------------------------------------------------
export const IMPLEMENTATION_STEPS: MethodologyStep[] = [
  {
    step: "DIA 1",
    title: "Conexão de WhatsApp & Importação",
    description: "Conectamos seu WhatsApp e importamos sua base.",
  },
  {
    step: "DIA 2",
    title: "Treinamento do Agente",
    description: "Treinamos o agente com o manual comercial da sua empresa.",
  },
  {
    step: "DIA 3",
    title: "Primeira Campanha no Ar",
    description: "Primeira campanha no ar com validação ao vivo.",
  },
];

// -------------------------------------------------------------
// SEÇÃO 8 — OS 4 PLANOS COMERCIAIS
// -------------------------------------------------------------
export const PRICING_PLANS: PlanCardItem[] = [
  {
    id: "disparo",
    name: "DISPARO",
    price: "R$ 97",
    period: "/mês",
    setup: "+ R$ 297 setup · Implantação guiada",
    tagline: "Para quem está começando e precisa falar com a base que já tem.",
    ctaText: "Começar",
    ctaAction: "modal",
    highlighted: false,
    features: [
      "Núcleo: Conversas + Banco inteligente",
      "Módulo Campanhas & Disparos incluso",
      "Janela de horário e variações anti-bloqueio",
      "1 número de WhatsApp · 1 usuário",
      "Até 2.000 contatos · 1.000 mensagens/mês",
      "Academy e documentação",
    ],
    excludedFeatures: ["Sem agente de IA — quem responde é você"],
  },
  {
    id: "essencial",
    name: "ESSENCIAL",
    price: "R$ 247",
    period: "/mês",
    setup: "+ setup conforme o módulo escolhido",
    tagline: "Para quem vende sozinho ou com até 3 pessoas.",
    ctaText: "Escolher meu módulo",
    ctaAction: "modal",
    highlighted: false,
    featuresHeader: "Tudo do Disparo, mais:",
    features: [
      "Campanhas + 1 módulo à sua escolha",
      "3 usuários",
      "Até 10.000 contatos · 5.000 mensagens/mês",
      "Suporte por e-mail em até 24h",
    ],
  },
  {
    id: "avancado",
    name: "AVANÇADO",
    price: "R$ 947",
    period: "/mês",
    setup: "+ R$ 1.500 setup · Implantação com treinamento do time",
    tagline: "Para times de 4 a 15 pessoas vendendo.",
    badge: "★ MAIS ESCOLHIDO",
    ctaText: "Falar com a gente",
    ctaAction: "modal",
    highlighted: true,
    featuresHeader: "Tudo do Essencial, mais:",
    features: [
      "Campanhas + 3 módulos à sua escolha",
      "3 números com rodízio inteligente entre chips",
      "Transbordo entre chips: o batedor abre, o fechador assume",
      "10 usuários · 50.000 contatos · 25.000 mensagens/mês",
      "Distribuição automática de leads entre vendedores",
      "Relatórios de resposta e conversão por vendedor",
      "Suporte por WhatsApp em até 8h",
    ],
  },
  {
    id: "plus",
    name: "PLUS",
    price: "R$ 1.847",
    period: "/mês",
    setup: "+ setup a partir de R$ 3.500 · Implantação dedicada",
    tagline: "Para operações com mais de 15 pessoas ou mais de uma empresa.",
    ctaText: "Falar com a gente",
    ctaAction: "modal",
    highlighted: false,
    featuresHeader: "Tudo do Avançado, mais:",
    features: [
      "Os 5 módulos completos do catálogo",
      "Números, usuários e contatos ilimitados",
      "Várias empresas na mesma conta, com acesso separado por pessoa",
      "Permissões por perfil e por módulo",
      "Revisão mensal de operação — 1h por videochamada, com pauta",
      "Suporte por WhatsApp em até 4h",
    ],
  },
];

// TABELA COMPARATIVA COMPLETA
export const PLAN_COMPARISON_TABLE: PlanComparisonRow[] = [
  {
    feature: "Mensalidade",
    disparo: "R$ 97",
    essencial: "R$ 247",
    avancado: "R$ 947",
    plus: "R$ 1.847",
  },
  {
    feature: "Setup",
    disparo: "R$ 297",
    essencial: "por módulo",
    avancado: "R$ 1.500",
    plus: "a partir de R$ 3.500",
  },
  {
    feature: "Núcleo (Conversas + Banco)",
    disparo: "✓",
    essencial: "✓",
    avancado: "✓",
    plus: "✓",
  },
  {
    feature: "Módulos do catálogo",
    disparo: "Campanhas",
    essencial: "Campanhas + 1",
    avancado: "Campanhas + 3",
    plus: "os 5 completos",
  },
  {
    feature: "Números de WhatsApp",
    disparo: "1",
    essencial: "1",
    avancado: "3",
    plus: "ilimitado",
  },
  {
    feature: "Usuários",
    disparo: "1",
    essencial: "3",
    avancado: "10",
    plus: "ilimitado",
  },
  {
    feature: "Contatos na base",
    disparo: "2.000",
    essencial: "10.000",
    avancado: "50.000",
    plus: "ilimitado",
  },
  {
    feature: "Mensagens por mês",
    disparo: "1.000",
    essencial: "5.000",
    avancado: "25.000",
    plus: "ilimitado",
  },
  {
    feature: "Agente de IA 24/7",
    disparo: "—",
    essencial: "se escolher",
    avancado: "✓",
    plus: "✓",
  },
  {
    feature: "Transbordo entre chips",
    disparo: "—",
    essencial: "—",
    avancado: "✓",
    plus: "✓",
  },
  {
    feature: "Distribuição de leads",
    disparo: "—",
    essencial: "—",
    avancado: "✓",
    plus: "✓",
  },
  {
    feature: "Várias empresas",
    disparo: "—",
    essencial: "—",
    avancado: "—",
    plus: "✓",
  },
  {
    feature: "Revisão mensal 1h",
    disparo: "—",
    essencial: "—",
    avancado: "—",
    plus: "✓",
  },
  {
    feature: "Suporte",
    disparo: "Academy",
    essencial: "e-mail 24h",
    avancado: "WhatsApp 8h",
    plus: "WhatsApp 4h",
  },
];

// -------------------------------------------------------------
// SEÇÃO 9 — FAQ COMPLETO (9 PERGUNTAS)
// -------------------------------------------------------------
export const FAQS: FaqItem[] = [
  {
    question: "Preciso trocar meu número de WhatsApp?",
    answer: "Não. O Vexo opera no número que seus clientes já conhecem.",
  },
  {
    question: "Quanto tempo até a primeira campanha no ar?",
    answer: "Três dias úteis, com sua base importada e o agente treinado.",
  },
  {
    question: "E se eu escolher o módulo errado?",
    answer:
      "Depois de 3 meses você troca por outro do catálogo. A mensalidade não muda — você paga só o setup do novo. O módulo antigo é desligado e seus dados ficam guardados por 90 dias, caso queira voltar.",
  },
  {
    question: "E se eu quiser sair? Levo meus dados?",
    answer:
      "Sim. Base completa em planilha, histórico de conversas e contratos gerados. Sem carência de saída.",
  },
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

// -------------------------------------------------------------
// SEÇÃO 12 — RODAPÉ INSTITUCIONAL
// -------------------------------------------------------------
export const FOOTER_NAV_LINKS = [
  { label: "Posicionamento", href: "#sec-tese" },
  { label: "Método", href: "#sec-metodo" },
  { label: "Módulos", href: "#sec-modulos" },
  { label: "Planos", href: "#sec-planos" },
  { label: "FAQ", href: "#sec-faq" },
  { label: "Diagnóstico grátis", href: "#sec-diagnostico" },
];
export const FOOTER_LINKS = FOOTER_NAV_LINKS;
