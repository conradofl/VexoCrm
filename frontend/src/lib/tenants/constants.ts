export const CHATBOT_MODEL_OPTIONS = [
  {
    value: "energia-solar",
    title: "Energia Solar",
    description: "Foco em faturas de energia, local de instalação, padrão monofásico/trifásico e economia estimada.",
  },
  {
    value: "consorcio-credito",
    title: "Consórcio & Crédito",
    description: "Foco em valor de crédito desejado, parcelas pretendidas, FGTS e tipo de bem (imóvel/automóvel).",
  },
  {
    value: "imobiliaria",
    title: "Imobiliária & Corretores",
    description: "Foco em interesse de compra ou locação, tipo de imóvel, dormitórios, localização e orçamento.",
  },
  {
    value: "clinicas-saude",
    title: "Clínicas & Saúde",
    description: "Foco em agendamentos de consultas, especialidades médicas/odontológicas, convênios e sintomas principais.",
  },
  {
    value: "estetica-beleza",
    title: "Estética & Beleza",
    description: "Foco em tratamentos estéticos de interesse, agendamento de procedimentos, avaliação e cuidados pessoais.",
  },
  {
    value: "escolas-cursos",
    title: "Escolas & Cursos",
    description: "Foco em matrículas de novos alunos, cursos de interesse (idiomas, preparatórios, graduação) e período.",
  },
  {
    value: "academias-fitness",
    title: "Academias & Fitness",
    description: "Foco em planos de assinatura, modalidade de interesse (musculação, pilates, lutas) e objetivos físicos.",
  },
  {
    value: "restaurantes-delivery",
    title: "Restaurantes & Delivery",
    description: "Foco em pedidos recorrentes, reserva de mesas, cardápio digital e área de entrega.",
  },
  {
    value: "lojas-ecommerce",
    title: "Lojas & E-commerce",
    description: "Foco em vendas de produtos físicos, vestuário, eletrônicos, catálogo de produtos e cupons de desconto.",
  },
  {
    value: "advocacia-juridico",
    title: "Advocacia & Jurídico",
    description: "Foco em consultas jurídicas, área do direito (trabalhista, cível, família), andamento processual e prazos.",
  },
  {
    value: "contabilidade",
    title: "Contabilidade & Assessoria",
    description: "Foco em abertura de empresas, migração de MEI/Simples, assessoria fiscal, trabalhista e declarações.",
  },
  {
    value: "automotivo-concessionarias",
    title: "Automotivo & Concessionárias",
    description: "Foco em venda de veículos novos/seminovos, test drive, financiamento, troca com troco e revisões.",
  },
  {
    value: "seguros",
    title: "Seguros & Corretoras",
    description: "Foco em cotação de seguros (auto, vida, residencial, empresarial), vigência e sinistros.",
  },
  {
    value: "eventos",
    title: "Eventos & Cerimonial",
    description: "Foco em orçamento de festas, masamentos, buffet, decoração, data estimada e número de convidados.",
  },
  {
    value: "tecnologia-saas",
    title: "Tecnologia & SaaS",
    description: "Foco em demonstração de software (SaaS), suporte técnico, planos corporativos e integrações.",
  },
] as const;

export type ChatbotModelValue = typeof CHATBOT_MODEL_OPTIONS[number]["value"];

export const ALL_TAB_KEYS = [
  "dashboard",
  "leads",
  "conversas",
  "inteligencia",
  "inteligencia:performance",
  "inteligencia:equipe",
  "inteligencia:ia-config",
  "chatbot-kanban",
  "chatbot",
  "chatbot:geral",
  "chatbot:template",
  "chatbot:prompts",
  "chatbot:teste",
  "followup",
  "followup:fila",
  "followup:sugestoes",
  "followup:campanhas",
  "followup:metrics",
  "followup:config",
  "conexoes",
  "campanhas",
  "aquecimento",
  "relatorios",
  "apresentacao",
  "apresentacao-gd",
  "onboarding",
  "chatbot-docs",
  "usuarios",
  "inbound-agents",
  "integracoes",
  "eventos"
];

export const TABS_HIERARCHY = [
  {
    key: "vendas",
    label: "Máquina de Vendas",
    children: [
      { key: "dashboard", label: "Dashboard" },
      { key: "leads", label: "Leads" },
      { key: "conversas", label: "Conversas" },
      {
        key: "inteligencia",
        label: "Inteligência Comercial",
        children: [
          { key: "inteligencia:performance", label: "Performance Comercial" },
          { key: "inteligencia:equipe", label: "Equipe & Roteamento" },
          { key: "inteligencia:ia-config", label: "Ajustes & Diagnósticos" },
        ]
      },
      { key: "chatbot-kanban", label: "Chatbot Kanban" },
      {
        key: "chatbot",
        label: "Chatbot (Configurações)",
        children: [
          { key: "chatbot:geral", label: "Geral" },
          { key: "chatbot:template", label: "Template" },
          { key: "chatbot:prompts", label: "Prompts" },
          { key: "chatbot:teste", label: "Teste" },
        ]
      },
      {
        key: "followup",
        label: "Follow-up",
        children: [
          { key: "followup:fila", label: "Fila de Envios" },
          { key: "followup:sugestoes", label: "Sugestões de IA" },
          { key: "followup:campanhas", label: "Campanhas & Templates" },
          { key: "followup:metrics", label: "Métricas" },
          { key: "followup:config", label: "Configuração" },
        ]
      }
    ]
  },
  {
    key: "disparos",
    label: "Máquina de Disparos",
    children: [
      { key: "conexoes", label: "Chips WhatsApp" },
      { key: "campanhas", label: "Envios por Planilha" },
      { key: "aquecimento", label: "Aquecimento" },
      { key: "relatorios", label: "Relatórios" }
    ]
  },
  {
    key: "sistema",
    label: "Sistema",
    children: [
      { key: "apresentacao", label: "Demonstração Vexo" },
      { key: "apresentacao-gd", label: "Apresentação GD" },
      { key: "onboarding", label: "Treinamento Vexo" },
      { key: "chatbot-docs", label: "Chatbot Docs" },
      { key: "usuarios", label: "Usuários" }
    ]
  },
  {
    key: "configuracoes",
    label: "Configurações Extras",
    children: [
      { key: "inbound-agents", label: "Assistentes Inbound" },
      { key: "integracoes", label: "Integrações" },
      { key: "eventos", label: "Eventos" }
    ]
  }
];

export const CREATION_STEPS = [
  "Cria o tenant em leads_clients",
  "Cria a tabela dinamica de leads",
  "Libera dashboard, planilhas e portal",
];

export const TENANTS_PAGE_SIZE = 8;
