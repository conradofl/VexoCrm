export const INTERNAL_PAGE_HIERARCHY = [
  {
    key: "vendas",
    label: "Máquina de Vendas",
    children: [
      { key: "dashboard", label: "Dashboard" },
      { key: "leads", label: "Leads" },
      { key: "whatsapp", label: "Conversas" },
      { key: "inteligencia-comercial", label: "Inteligência Comercial" },
      { key: "chatbot-kanban", label: "Chatbot Kanban" },
      { key: "chatbot-config", label: "Chatbot" },
      {
        key: "followup",
        label: "Follow-up",
        children: [
          { key: "fila-de-followup", label: "Fila de Follow-up" },
          { key: "followup-empresas", label: "Follow-up Empresas" },
          { key: "followup-campanhas", label: "Follow-up Campanhas" },
          { key: "followup-analytics", label: "Follow-up Analytics" },
          { key: "followup-sugestoes", label: "Follow-up Sugestões" },
        ]
      }
    ]
  },
  {
    key: "disparos",
    label: "Máquina de Disparos",
    children: [
      { key: "conexoes", label: "Chips WhatsApp" },
      { key: "planilhas", label: "Envios por Planilha" },
      { key: "campanhas", label: "Campanhas" },
      { key: "disparos", label: "Disparos" },
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
      { key: "briefings-gd", label: "Briefings Salvos" },
      { key: "onboarding-wizard", label: "Treinamento Vexo" },
      { key: "chatbot-docs", label: "Chatbot Docs" },
      { key: "usuarios", label: "Usuários" },
      { key: "empresas", label: "Empresas" }
    ]
  },
  {
    key: "configuracoes",
    label: "Configurações Extras",
    children: [
      { key: "agente", label: "Assistentes Inbound" },
      { key: "onboarding-agent", label: "Agente de Onboarding" },
      { key: "integracoes", label: "Integrações" },
      { key: "eventos", label: "Eventos" },
      { key: "relacionamento", label: "Relacionamento" },
      { key: "livpub", label: "LivPub" }
    ]
  }
];
