import type { BriefingField, CustomTheme, TeamMember } from "./types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — movimento puro, sem alteração de forma.
// DEFAULT_THEME era duplicado (fallback do useState + botão "Restaurar Padrão"); unificado aqui.
export const DEFAULT_THEME: CustomTheme = {
      agencyName: "Geração Digital",
      agencySubtitle: "Transformando Cliques em Clientes e Presença em Faturamento",
      primaryColor: "indigo",
      prospectName: "Cliente Parceiro",
      prospectLogoUrl: "",
      whatsappNumber: "(11) 98888-7777",
      themePreset: "indigo"
};

// Estado inicial dos 20 campos do formulário de briefing.
export const DEFAULT_BRIEFING_FIELDS: BriefingField[] = [
    { 
      id: "produtos", 
      label: "Produtos Contratados", 
      placeholder: "Selecione os pacotes fechados", 
      status: "pending", 
      value: "", 
      confidence: 0, 
      type: "checkboxes", 
      options: [
        "Google meu negócio", "Google ads", "Gestão de redes sociais (Instagram)", 
        "Gestão de redes sociais (Facebook)", "Gestão de redes sociais (LinkedIn)", 
        "Gestão de redes sociais (TikTok)", "Gestão de tráfego google/meta ads", 
        "Logomarca", "Branding", "Cartão de visitas", "Arte avulsa", "Panfletos", 
        "Cardápios", "Fachadas", "Landing Page\\site", "E-commerce", 
        "Cobertura de eventos", "Vídeo avulso", "Outros ______________"
      ] 
    },
    { id: "logo", label: "Logomarca em alta resolução", placeholder: "Link do Google Drive ou Dropbox contendo arquivos editáveis (.ai, .eps, vector)", status: "pending", value: "", confidence: 0, type: "text" },
    { id: "instagram", label: "Login e senha Instagram", placeholder: "Acesso administrativo (@usuario / senha)", status: "pending", value: "", confidence: 0, type: "text" },
    { id: "facebook", label: "Login e senha Facebook", placeholder: "Acesso à página comercial vinculada", status: "pending", value: "", confidence: 0, type: "text" },
    { id: "possui_bm", label: "Possui BM?", placeholder: "Business Manager configurada?", status: "pending", value: "", confidence: 0, type: "radio", options: ["Sim", "Não", "Não sei"] },
    { id: "google", label: "Login e senha Google", placeholder: "Acesso ao Google Ads / Analytics", status: "pending", value: "", confidence: 0, type: "text" },
    { id: "site", label: "Site", placeholder: "Domínio ativo (ex: www.empresa.com.br)", status: "pending", value: "", confidence: 0, type: "text" },
    { id: "dominios_dns", label: "Domínios DNS", placeholder: "Servidor de hospedagem DNS (ex: Cloudflare, Registro.br)", status: "pending", value: "", confidence: 0, type: "text" },
    { id: "whatsapp", label: "WhatsApp Business", placeholder: "Número comercial completo com DDD", status: "pending", value: "", confidence: 0, type: "text" },
    { id: "concorrentes", label: "Maiores concorrentes", placeholder: "Quais empresas competem diretamente com o seu negócio?", status: "pending", value: "", confidence: 0, type: "text" },
    { id: "inspiracao", label: "Perfis de inspiração", placeholder: "Quais marcas inspiram sua estética?", status: "pending", value: "", confidence: 0, type: "text" },
    { id: "servicos", label: "Produtos e serviços", placeholder: "Descreva o core business do negócio", status: "pending", value: "", confidence: 0, type: "text" },
    { id: "localizacao", label: "Localização", placeholder: "Região, bairros ou abrangência nacional", status: "pending", value: "", confidence: 0, type: "text" },
    { id: "produtos_trafego", label: "Produtos trabalhados no tráfego", placeholder: "Foco principal das campanhas patrocinadas", status: "pending", value: "", confidence: 0, type: "text" },
    { 
      id: "objetivo_trafego", 
      label: "Objetivo do tráfego", 
      placeholder: "Selecione o objetivo", 
      status: "pending", 
      value: "", 
      confidence: 0, 
      type: "checkboxes", 
      options: ["Ganho de seguidores e visualização (posicionamento)", "Leads pro whatsapp business", "Formulários"] 
    },
    { id: "verba", label: "Verba disponível", placeholder: "Orçamento mensal planejado para anúncios", status: "pending", value: "", confidence: 0, type: "text" },
    { id: "tipo_pagamento", label: "Tipo de pagamento", placeholder: "Forma de pagamento de mídia", status: "pending", value: "", confidence: 0, type: "radio", options: ["Cartão de crédito virtual", "PIX", "Boleto"] },
    { 
      id: "publico_alvo", 
      label: "Público Alvo", 
      placeholder: "Defina o perfil de público alvo", 
      status: "pending", 
      value: "", 
      confidence: 0, 
      type: "text", 
      subfields: [
        { id: "genero", label: "Gênero", value: "" },
        { id: "idade", label: "Idade", value: "" },
        { id: "classe", label: "Classe social", value: "" },
        { id: "interesses", label: "Interesses", value: "" },
        { id: "outros_detalhes", label: "Outros detalhes", value: "" }
      ] 
    },
    { id: "bloqueado", label: "Quais assuntos você não abordaria nos seus perfis?", placeholder: "Temas proibidos nos perfis (política, concorrência, termos sensíveis)", status: "pending", value: "", confidence: 0, type: "textarea" },
    { id: "temas", label: "Quais temas você acredita que tenha mais a ver com a sua empresa?", placeholder: "Assuntos ideais para engajar seu público", status: "pending", value: "", confidence: 0, type: "textarea" }
];

// Estrutura organizacional padrão exibida no organograma (Slide 3).
export const DEFAULT_TEAM: TeamMember[] = [
    {
      id: "caio",
      name: "Caio Almeida",
      role: "Fundador & Diretor Comercial",
      parent: "",
      bio: "Líder estratégico da Geração Digital, especialista em escala de negócios e fechamento comercial de alto valor. Conecta o cliente aos times de entrega operacional.",
      responsibilities: ["Acompanhamento comercial estratégico", "Alineamento de metas e produtos de escala", "Garantia de ROI institucional para parceiros"],
      tools: ["Vexo CRM", "Calendly", "Trello", "Google Sheets"],
      status: "Online",
      avatarColor: "from-indigo-600 to-blue-500"
    },
    {
      id: "priscila",
      name: "Priscila Karina",
      role: "Prospectora Comercial",
      parent: "caio",
      bio: "Prospecção ativa e mapeamento de leads corporativos altamente qualificados para a carteira de vendas.",
      responsibilities: ["Filtro inicial de fit do lead", "Abordagem ativa por telefone e e-mail", "Agendamento de reuniões para Caio"],
      tools: ["LinkedIn Sales Navigator", "ActiveCampaign", "Phantombuster"],
      status: "Online",
      avatarColor: "from-cyan-600 to-indigo-500"
    },
    {
      id: "gabriel",
      name: "Gabriel Oliveira",
      role: "Prospector Comercial",
      parent: "caio",
      bio: "Mapeamento de novas oportunidades de negócios em mercados emergentes e automação de cold outbound.",
      responsibilities: ["Scraping de contatos corporativos", "Envio de fluxos automáticos de e-mails", "Auditoria de fit comercial"],
      tools: ["Lusha", "Apollo.io", "Vexo CRM"],
      status: "Focando em IA",
      avatarColor: "from-cyan-500 to-teal-500"
    },
    {
      id: "aline",
      name: "Aline Gonçalves",
      role: "Atendimento & Onboarding",
      parent: "caio",
      bio: "Pilar de comunicação e retenção. Responsável por traduzir as necessidades do cliente para o time técnico.",
      responsibilities: ["Primeira reunião de onboarding comercial", "Alinhamento semanal de metas de entrega", "Aprovação de roteiros e layouts criativos"],
      tools: ["Slack", "Trello", "Google Meet", "WhatsApp Business"],
      status: "Online",
      avatarColor: "from-purple-600 to-indigo-400"
    },
    {
      id: "raquel",
      name: "Raquel Borges",
      role: "Diretora Operacional",
      parent: "caio",
      bio: "Supervisora direta dos processos criativos e de mídia, garantindo entrega no prazo e alinhamento tático.",
      responsibilities: ["Criação e acompanhamento de cronogramas", "Gestão de filas de chamados operacionais", "Auditoria de peças prontas para lançamento"],
      tools: ["Asana", "Jira", "Notion", "Google Calendar"],
      status: "Online",
      avatarColor: "from-pink-600 to-rose-400"
    },
    {
      id: "humberto",
      name: "Humberto de Souza",
      role: "Diretor de Operações e Tráfego",
      parent: "aline",
      bio: "Líder de tráfego pago e inteligência de mídia digital, desenhando funis de alto ROI para leads frios.",
      responsibilities: ["Desenvolvimento da estratégia de captação", "Otimização de orçamento de mídia", "Auditoria de anúncios de alta conversão"],
      tools: ["Meta Ads Manager", "Google Ads Editor", "Looker Studio"],
      status: "Online",
      avatarColor: "from-blue-600 to-cyan-500"
    },
    {
      id: "conrado",
      name: "Conrado Finzi",
      role: "Diretor de IA e Automações",
      parent: "aline",
      bio: "Pioneiro no desenvolvimento de soluções baseadas em LLM e automações de atendimento para e-commerce e CRM.",
      responsibilities: ["Integração de robôs à API do Gemini", "Automação de briefing e captação de leads", "Desenvolvimento de conectores no n8n"],
      tools: ["Google Gemini API", "n8n", "Node.js", "Python", "Vite/React"],
      status: "Focando em IA",
      avatarColor: "from-violet-600 to-fuchsia-500"
    },
    {
      id: "jheyson",
      name: "Jheyson Fernandes",
      role: "Diretor de Negócios e Criativos",
      parent: "aline",
      bio: "Líder de design e soluções de identidade visual, responsável pela estética e consistência de marca.",
      responsibilities: ["Direção criativa de posts e anúncios", "Modelos estéticos de marca (Branding Book)", "Aprovação final de templates criativos"],
      tools: ["Figma", "Adobe Illustrator", "Photoshop"],
      status: "Online",
      avatarColor: "from-orange-600 to-amber-500"
    },
    {
      id: "maria_eduarda",
      name: "Maria Eduarda",
      role: "Gestora Operacional de Mídia",
      parent: "raquel",
      bio: "Líder de produção audiovisual e criativos de alto engajamento no Instagram e TikTok.",
      responsibilities: ["Roteirização de vídeos curtos (Reels)", "Coordenação de filmagens e entregas", "Análise de métricas de visualização orgânica"],
      tools: ["Notion", "CapCut Pro", "Tiktok Studio"],
      status: "Online",
      avatarColor: "from-rose-500 to-orange-400"
    },
    {
      id: "arthur",
      name: "Arthur Henrique",
      role: "Gestor de Tráfego",
      parent: "humberto",
      bio: "Analista técnico responsável pela configuração diária de públicos, pixels de rastreamento e criativos dinâmicos.",
      responsibilities: ["Configuração de públicos lookalike", "Execução prática de testes A/B", "Análise de custo por lead (CPL)"],
      tools: ["Meta Ads Manager", "Google Analytics 4"],
      status: "Online",
      avatarColor: "from-blue-500 to-indigo-400"
    },
    {
      id: "cabalim",
      name: "Henrique Cabalim",
      role: "Consultor Estratégico Subido Pro",
      parent: "humberto",
      bio: "Estrategista focado em funis complexos, SEO e posicionamento premium nos canais de busca.",
      responsibilities: ["Estratégias de remarketing avançado", "Mapeamento de jornada de compras", "Consultoria de funil para e-commerce"],
      tools: ["Google Search Console", "SEMrush", "Hotjar"],
      status: "Offline",
      avatarColor: "from-indigo-500 to-purple-500"
    },
    {
      id: "luiz_felipe",
      name: "Luiz Felipe",
      role: "Programador Chefe",
      parent: "conrado",
      bio: "Desenvolvedor responsável pela construção de landing pages rápidas e integração de APIs corporativas.",
      responsibilities: ["Desenvolvimento em Next.js e Tailwind", "Otimização de Core Web Vitals", "Integração de Webhooks com CRM"],
      tools: ["VS Code", "Vercel", "Supabase", "Git/GitHub"],
      status: "Online",
      avatarColor: "from-violet-500 to-indigo-600"
    },
    {
      id: "santana",
      name: "Santana",
      role: "Designer",
      parent: "jheyson",
      bio: "Designer focado em criativos estáticos de alto contraste e carrosséis explicativos para mídias sociais.",
      responsibilities: ["Criação de criativos de anúncios", "Design de posts semanais", "Edição rápida de imagens de produtos"],
      tools: ["Photoshop", "Illustrator", "Canva Team"],
      status: "Online",
      avatarColor: "from-amber-500 to-yellow-400"
    },
    {
      id: "karolina",
      name: "Karolina Martins",
      role: "Designer",
      parent: "jheyson",
      bio: "Especialista em branding corporativo, paletas de cores harmônicas e diagramação estéril/elegante.",
      responsibilities: ["Criação de e-books corporativos", "Identidade visual para Stories", "Layouts de e-mail marketing"],
      tools: ["Figma", "Indesign", "Illustrator"],
      status: "Online",
      avatarColor: "from-yellow-500 to-orange-400"
    },
    {
      id: "eflen",
      name: "Eflen Henrique",
      role: "Editor de Vídeo",
      parent: "maria_eduarda",
      bio: "Editor de vídeo especializado em cortes dinâmicos de alta retenção no Instagram e criativos de tráfego.",
      responsibilities: ["Edição profissional de reels e criativos", "Color grading de vídeos captados", "Animações simples em After Effects"],
      tools: ["Premiere Pro", "CapCut", "After Effects"],
      status: "Online",
      avatarColor: "from-rose-500 to-pink-500"
    },
    {
      id: "carlos",
      name: "Carlos Arantes",
      role: "Videomaker Externo",
      parent: "maria_eduarda",
      bio: "Profissional de gravação externa, responsável pela captação presencial de conteúdo nas empresas clientes.",
      responsibilities: ["Operação de câmeras profissionais e drones", "Direção de depoimentos presenciais", "Captação de áudio limpo em lapela"],
      tools: ["Sony A7SIII", "DJI Mavic Pro", "Adobe Premiere"],
      status: "Gravando",
      avatarColor: "from-red-500 to-rose-400"
    }
];
