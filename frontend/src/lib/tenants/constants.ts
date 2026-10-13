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
  // followup:cadencias e followup:journeys ERAM lidas pela tela e NAO existiam
  // aqui: não havia como conceder, nem marcando o módulo nem na mão. O dono
  // marcava "Follow-up & Cadências" e a seção 2 continuava fechada.
  "followup:cadencias",
  "followup:journeys",
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
          { key: "followup:cadencias", label: "Cadências de Follow-up" },
          { key: "followup:journeys", label: "Automações por Evento" },
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
