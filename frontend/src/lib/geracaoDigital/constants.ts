import type { RoadmapStep, TranscriptOption } from "./types";

// ─── MOCK DATA FOR THE BRIEFING TRANSCRIPTS ──────────────────────────────────
// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — movimento puro, sem alteração de forma.
export const TRANSCRIPT_OPTIONS: TranscriptOption[] = [
  {
    id: "burger",
    title: "🍔 Hamburgueria Artesanal (Burger Flow)",
    description: "Briefing clássico para rede de alimentação local com delivery.",
    text: "Olá Caio, estamos contratando o plano de Gestão Completa de Redes Sociais mais Tráfego Pago local. Nossa logo em alta resolução está no link do Google Drive drive.google.com/burger-flow-hd. O nosso instagram é @burgerflow.br com senha burger123flow, e a página do facebook é fb.com/burgerflowbr com a mesma senha. Nosso Google Business Profile está no e-mail burgerflowbr@gmail.com com senha burgergoogle987. Nosso site é burgerflow.com.br e o whatsapp comercial de atendimento é (11) 98888-7777. Nossos concorrentes diretos são o Madero e o Cabana Burger. Amamos a identidade do Bullguer, que é nossa principal inspiração. Nós vendemos hambúrgueres artesanais premium com smash burger rápido e cervejas artesanais. Atuamos na zona sul de São Paulo e o público alvo são jovens de 18 a 35 anos que valorizam ingredientes selecionados. Nos perfis, nunca falaríamos sobre política ou piadas depreciativas. Acreditamos que temas de 'making of' na chapa, depoimentos de clientes e promoções de happy hour têm tudo a ver com a nossa marca.",
    extractedValues: {
      produtos: "Gestão de redes sociais (Instagram), Gestão de redes sociais (Facebook), Gestão de tráfego google/meta ads",
      logo: "drive.google.com/burger-flow-hd (Google Drive HD)",
      instagram: "User: @burgerflow.br | Senha: burger123flow",
      facebook: "User: fb.com/burgerflowbr | Senha: burger123flow",
      possui_bm: "Sim",
      google: "User: burgerflowbr@gmail.com | Senha: burgergoogle987",
      site: "burgerflow.com.br",
      dominios_dns: "Registro.br (DNS gerenciado)",
      whatsapp: "(11) 98888-7777",
      concorrentes: "Madero, Cabana Burger",
      inspiracao: "Bullguer",
      servicos: "Hambúrgueres artesanais premium, smash burgers rápidos, cervejas artesanais",
      localizacao: "Zona Sul de São Paulo - SP",
      produtos_trafego: "Smash burgers artesanais e combos promocionais",
      objetivo_trafego: "Leads pro whatsapp business, Ganho de seguidores e visualização (posicionamento)",
      verba: "R$ 2.000,00 / mês",
      tipo_pagamento: "Cartão de crédito virtual",
      genero: "Todos (Foco unissex)",
      idade: "18 a 35 anos",
      classe: "Classe B/C",
      interesses: "Gastronomia, hambúrguer, happy hour, delivery",
      outros_detalhes: "Clientes jovens que buscam praticidade e qualidade",
      bloqueado: "Assuntos políticos, piadas depreciativas, religião ou polêmicas gerais",
      temas: "Processo de fabricação (chapa/cozinha), depoimentos de clientes, promoções de Happy Hour e memes gastronômicos"
    }
  },
  {
    id: "sorriso",
    title: "🦷 Clínica Odontológica (Sorriso Clean)",
    description: "Briefing focado em estética dental e captação de pacientes de implantes.",
    text: "Fechamos o plano de tráfego de atração de implantes e clareamentos. A logo está no drive.google.com/sorrisoclean. Nosso instagram é @sorrisoclean com senha dentes2026, a página do facebook é sorrisocleandentistas com senha dentes2026, e a conta do google ads é sorrisocleanads@gmail.com com senha cleanads44. O site é sorrisoclean.odo.br e o whatsapp business é (21) 97777-5555. Nossos maiores concorrentes na região do Centro do Rio são a OdontoCompany e a Sorridents. Nossa inspiração é o perfil da Dra. Andressa (perfil estético clean). Oferecemos implantes, clareamento a laser, facetas e Invisalign. Nossa área de atuação é o centro e zona sul do Rio de Janeiro. Público alvo são pessoas adultas de 30 a 60 anos com renda média/alta buscando estética dental. Nunca falaríamos sobre dor, cirurgias sangrentas ou piadas com medo de dentista. Os temas ideais são antes/depois explicativos, dicas de higiene bucal cotidiana e depoimentos de satisfação dos pacientes.",
    extractedValues: {
      produtos: "Google ads, Gestão de tráfego google/meta ads, Landing Page\\site",
      logo: "drive.google.com/sorrisoclean (Drive Vetores)",
      instagram: "User: @sorrisoclean | Senha: dentes2026",
      facebook: "User: sorrisocleandentistas | Senha: dentes2026",
      possui_bm: "Não sei",
      google: "User: sorrisocleanads@gmail.com | Senha: cleanads44",
      site: "sorrisoclean.odo.br",
      dominios_dns: "Cloudflare DNS",
      whatsapp: "(21) 97777-5555",
      concorrentes: "OdontoCompany, Sorridents",
      inspiracao: "Dra. Andressa (Odontologia Estética Clean)",
      servicos: "Implantes dentários, clareamento a laser, facetas de porcelana e Invisalign",
      localizacao: "Centro e Zona Sul do Rio de Janeiro - RJ",
      produtos_trafego: "Implantes de dente e clareamento estético",
      objetivo_trafego: "Leads pro whatsapp business, Formulários",
      verba: "R$ 3.500,00 / mês",
      tipo_pagamento: "Cartão de crédito virtual",
      genero: "Masculino e Feminino",
      idade: "30 a 60 anos",
      classe: "Classe A/B",
      interesses: "Estética dental, Invisalign, facetas de porcelana, implantes",
      outros_detalhes: "Adultos que buscam saúde bucal e melhorias estéticas",
      bloqueado: "Procedimentos cirúrgicos com muito sangue, termos dolorosos ou piadas que induzam pânico",
      temas: "Casos reais de antes & depois explicativos, dicas práticas de rotina bucal, mitos/verdades da saúde bucal"
    }
  },
  {
    id: "glow",
    title: "👗 E-commerce de Moda (Glow Modas)",
    description: "Briefing para loja online nacional com e-commerce e tráfego direto.",
    text: "Escolhemos o plano Full Service Digital (Social Media, Tráfego Pago, E-mail Marketing). A logo em vetor está no link dropbox.com/glow-modas-vector. O instagram é @glowmodas_oficial com senha glow2026pass, o facebook é fb.com/glowmodas com senha glow2026pass, e a conta do google analytics/ads está no e-mail marketing@glowmodas.com.br com a senha glowanalytics909. Nosso site é glowmodas.com.br e o whatsapp business do comercial de vendas é (19) 99999-1111. Nossos concorrentes diretos são a Amaro e a Farm. Nossas inspirações são os perfis da Zara Brasil e da Shoulder. Vendemos moda feminina casual chic, vestidos de linho, alfaiataria moderna e acessórios. Atendemos todo o Brasil através de envio nacional. Público alvo são mulheres de 25 a 45 anos da classe A/B que gostam de elegância prática. Não falaríamos sobre assuntos polêmicos do dia a dia, fofocas ou liquidações agressivas de baixa qualidade. Os temas com mais a ver são provadores virtuais mostrando caimento das peças, lookbooks conceituais de coleções e dicas de estilo de como combinar roupas.",
    extractedValues: {
      produtos: "Gestão de redes sociais (Instagram), Gestão de redes sociais (Facebook), Gestão de tráfego google/meta ads, E-commerce",
      logo: "dropbox.com/glow-modas-vector (Dropbox Vetores)",
      instagram: "User: @glowmodas_oficial | Senha: glow2026pass",
      facebook: "User: fb.com/glowmodas | Senha: glow2026pass",
      possui_bm: "Sim",
      google: "User: marketing@glowmodas.com.br | Senha: glowanalytics909",
      site: "glowmodas.com.br",
      dominios_dns: "Hospedagem Hostgator",
      whatsapp: "(19) 99999-1111",
      concorrentes: "Amaro, Farm",
      inspiracao: "Zara Brasil, Shoulder",
      servicos: "Moda feminina casual chic, vestidos de linho, alfaiataria de corte moderno e acessórios",
      localizacao: "Território Nacional (Todo o Brasil via e-commerce)",
      produtos_trafego: "Coleção de vestidos de linho e peças de alfaiataria",
      objetivo_trafego: "Leads pro whatsapp business, Ganho de seguidores e visualização (posicionamento)",
      verba: "R$ 4.000,00 / mês",
      tipo_pagamento: "PIX",
      genero: "Feminino",
      idade: "25 a 45 anos",
      classe: "Classe A/B",
      interesses: "Elegância prática, vestidos, estilo de vida, Zara, Shoulder",
      outros_detalhes: "Mulheres que buscam se vestir bem no dia a dia",
      bloqueado: "Fofocas de famosos, debates políticos e liquidações agressivas de baixo padrão",
      temas: "Provadores virtuais dinâmicos (reels), lookbooks conceituais de novas coleções e dicas de mix & match"
    }
  },
  {
    id: "audio1",
    title: "🎙️ Áudio 1 — Visão do Produto & Assinatura",
    description: "Transcrição do áudio sobre o conceito comercial do briefing white-label.",
    text: "O Caio me pediu pra criar uma apresentação, você viu lá a apresentação que eu criei da Vexo, né? Que aí a gente consegue colocar o ticket médio, a média de vendas que ele consegue pôr por mês pra na apresentação. Aí consegue colocar a imagem da empresa, e mais o nome da empresa pra ficar bem personalizado, né? E aí eu fiz isso lá, o Caio curtiu, ele queria que criasse pra Geração Digital. Aí o que que vai virar? Vai virar um produto da Vexo. E aí eu tô pedindo aqui pra IA construir uma ferramenta que eu consiga personalizar pra quem queira ter essa apresentação e o briefing do cliente, né, que é a entrada do cliente na empresa. E aí a... lá na Vexo a gente só vai, fala assim, ó, se o cara quiser só esse produto, né, ele só vai ter acesso a isso e aí ele entra pelo próprio Vexo, porque aí já tem o domínio, o cara não precisa ter domínio, não precisa ter nada. Ele só paga o mensal para nós e ele consegue fazer o briefing dos clientes dele direto do Vexo. Que aí lá ele cria a apresentação, tudo boninitho, né, personalizado pro negócio dele.",
    extractedValues: {
      produtos: "Gestão de tráfego google/meta ads, Landing Page\\site",
      logo: "Geração Digital / Vexo (Logomarca Customizável Dinâmica)",
      instagram: "Não aplicável (Modelo de Plataforma White-Label)",
      facebook: "Não aplicável (Configurado no painel do assinante)",
      possui_bm: "Sim",
      google: "Não aplicável (Conta do assinante Vexo)",
      site: "dominio.vexo.com.br (Sem necessidade de domínio próprio para o assinante)",
      dominios_dns: "DNS Vexo OS integrado",
      whatsapp: "(11) 98888-7777 (Comercial Vexo)",
      concorrentes: "Apresentações comerciais estáticas em PDF, PDFs estáticos de briefing",
      inspiracao: "Apresentação comercial e briefing interativos originais da Vexo",
      servicos: "Criação de apresentações dinâmicas e gerenciamento de briefings comerciais estruturados",
      localizacao: "Nacional (Acesso direto pela plataforma da Vexo)",
      produtos_trafego: "Assinaturas mensais de software de vendas",
      objetivo_trafego: "Leads pro whatsapp business",
      verba: "R$ 1.500,00 / mês",
      tipo_pagamento: "Boleto",
      genero: "Todos",
      idade: "25 a 50 anos",
      classe: "Classe A/B/C",
      interesses: "SaaS, automação de vendas, CRM, agências de marketing",
      outros_detalhes: "Empresários e donos de agências digitais buscando eficiência",
      bloqueado: "Qualquer menção a necessidade de domínio próprio, setups complicados ou infraestrutura do zero",
      temas: "Assinatura recorrente barata, personalização de marca rápida (logo, ticket médio, vendas) e facilidade de onboarding"
    }
  },
  {
    id: "audio2",
    title: "🎙️ Áudio 2 — Automação da Triagem & Grok",
    description: "Transcrição do áudio sobre inteligência artificial Grok/Gemini no briefing.",
    text: "E aí o Caio já vai ser esse cliente, né, ele vai usar. Ele vai já fazer o briefing da Live direto ali do Vexo. Que aí o Vexo vai pegar, fazer o questionamento, já vai ouvir, que ele vai... já vai usar todos os motores que já tá construído, não precisa construir nada do zero. É só conectar o Gemini ali ou outra ferramenta com o Vexo pra poder fazer a... ou a própria Grok, da IA da Vexo, consegue fazer isso. Ela ouve o que o cliente deu de resposta, constrói o formulário, envia eles pro Caio e pro cliente, né, via e-mail ou via WhatsApp. E já fica tudo amarradinho ali.",
    extractedValues: {
      produtos: "Gestão de tráfego google/meta ads, Landing Page\\site, E-commerce",
      logo: "drive.google.com/live-briefing-assets (Projeto Live)",
      instagram: "User: @live.briefing | Senha: liveads2026",
      facebook: "fb.com/livebriefing | Senha: liveads2026",
      possui_bm: "Sim",
      google: "liveadsmanager@gmail.com | Senha: googlelive88",
      site: "livebranding.com.br (Projeto Live)",
      dominios_dns: "Cloudflare DNS (Projeto Live)",
      whatsapp: "(11) 99999-8888",
      concorrentes: "Triagem manual de briefings de áudio por profissionais de atendimento",
      inspiracao: "Motores e IA integrados à Vexo (Grok, Gemini)",
      servicos: "Escuta ativa de briefing, geração automática de formulários consolidados de briefing e envio de dossiês",
      localizacao: "Nacional (Projeto Live e contas Geração Digital)",
      produtos_trafego: "Automação de triagem digital via inteligência artificial",
      objetivo_trafego: "Leads pro whatsapp business, Formulários",
      verba: "R$ 5.000,00 / mês",
      tipo_pagamento: "Cartão de crédito virtual",
      genero: "Todos",
      idade: "20 a 45 anos",
      classe: "Classe A/B",
      interesses: "Inteligência artificial, automação comercial, n8n, processamento de áudio",
      outros_detalhes: "Gestores comerciais e donos de agências parceiras",
      bloqueado: "Uso de infraestrutura externa ou construção técnica do zero",
      temas: "Automação de briefing por áudio, envios instantâneos por WhatsApp/E-mail e amarração total de fluxos com Grok/Gemini"
    }
  }
];

// ─── ACCENT COLOR PALETTES ────────────────────────────────────────────────────

export const ACCENT_PRESETS = {
  indigo: {
    primary: "from-indigo-600 to-indigo-400",
    text: "text-indigo-400",
    border: "border-indigo-500/30",
    bgGlow: "bg-indigo-500/10",
    shadow: "shadow-indigo-500/20",
    hover: "hover:bg-indigo-600/20",
    accent: "bg-indigo-600",
    colorHex: "#6366f1"
  },
  emerald: {
    primary: "from-emerald-600 to-emerald-400",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    bgGlow: "bg-emerald-500/10",
    shadow: "shadow-emerald-500/20",
    hover: "hover:bg-emerald-600/20",
    accent: "bg-emerald-600",
    colorHex: "#10b981"
  },
  violet: {
    primary: "from-violet-600 to-violet-400",
    text: "text-violet-400",
    border: "border-violet-500/30",
    bgGlow: "bg-violet-500/10",
    shadow: "shadow-violet-500/20",
    hover: "hover:bg-violet-600/20",
    accent: "bg-violet-600",
    colorHex: "#8b5cf6"
  },
  rose: {
    primary: "from-rose-600 to-rose-400",
    text: "text-rose-400",
    border: "border-rose-500/30",
    bgGlow: "bg-rose-500/10",
    shadow: "shadow-rose-500/20",
    hover: "hover:bg-rose-600/20",
    accent: "bg-rose-600",
    colorHex: "#f43f5e"
  },
  amber: {
    primary: "from-amber-600 to-amber-400",
    text: "text-amber-400",
    border: "border-amber-500/30",
    bgGlow: "bg-amber-500/10",
    shadow: "shadow-amber-500/20",
    hover: "hover:bg-amber-600/20",
    accent: "bg-amber-600",
    colorHex: "#f59e0b"
  },
  gd: {
    primary: "from-purple-600 to-pink-500",
    text: "text-pink-400",
    border: "border-purple-500/30",
    bgGlow: "bg-purple-500/10",
    shadow: "shadow-purple-500/20",
    hover: "hover:bg-purple-600/20",
    accent: "bg-purple-600",
    colorHex: "#a855f7"
  },
  "gd-light": {
    primary: "from-purple-600 to-pink-500",
    text: "text-purple-600",
    border: "border-purple-100",
    bgGlow: "bg-purple-50",
    shadow: "shadow-purple-100",
    hover: "hover:bg-purple-50",
    accent: "bg-gradient-to-r from-purple-600 to-pink-500",
    colorHex: "#9333ea"
  }
};

// ─── ROADMAP ITEMS MAPPED ────────────────────────────────────────────────────
export const roadmapSteps: RoadmapStep[] = [
    {
      week: "Semana 1",
      title: "Jornada Comercial",
      subtitle: "Processo de Onboarding e Setup",
      details: [
        "Abertura de drive do cliente",
        "Abertura de grupos de whatsapp",
        "Assinatura do contrato",
        "Cadastro financeiro",
        "Recebimento",
        "Reunião de briefing",
        "Abertura de quadro do cliente no Trello",
        "Criação e aprovação de roteiros",
        "Configuração de tráfego"
      ]
    },
    {
      week: "Semana 2",
      title: "Produção e Execução",
      subtitle: "Distribuição e criação de tarefas",
      details: [
        "Abertura de cards no trello",
        "Repasse de cards à equipe",
        "Marcação de gravação de conteúdo",
        "Criação de conteúdo",
        "Criativos de tráfego",
        "Agendamento de conteúdo",
        "Aprovação de tráfego"
      ]
    },
    {
      week: "Semana 3",
      title: "Ajustes e Otimizações",
      subtitle: "Refinamento da operação",
      details: [
        "Ajustes necessários"
      ]
    },
    {
      week: "Semana 4",
      title: "Sucesso do Cliente",
      subtitle: "Acompanhamento de resultados",
      details: [
        "Reunião Sucesso do cliente"
      ]
    }
  ];

// ─── AI PROCESSING STEPS (Simulação de qualificação de briefing) ──────────────
export const AI_PROCESSING_STEPS: { t: string; fId: string | null }[] = [
      { t: "Inicializando o agente de IA Audio Parser...", fId: null },
      { t: "Identificando produtos e escopo contratado...", fId: "produtos" },
      { t: "Extraindo URLs de arquivos e links da logomarca...", fId: "logo" },
      { t: "Buscando dados de login e senhas de redes sociais...", fId: "instagram" },
      { t: "Buscando acessos de Facebook Business Suite...", fId: "facebook" },
      { t: "Decodificando acessos do Google Analytics & Tag Manager...", fId: "google" },
      { t: "Analisando domínio do site principal...", fId: "site" },
      { t: "Capturando contato do WhatsApp Business comercial...", fId: "whatsapp" },
      { t: "Identificando lista de concorrentes mapeados...", fId: "concorrentes" },
      { t: "Mapeando referências estéticas e perfis de inspiração...", fId: "inspiracao" },
      { t: "Identificando core business e produtos comercializados...", fId: "servicos" },
      { t: "Definindo a segmentação geográfica de anúncios...", fId: "atuacao" },
      { t: "Mapeando o perfil demográfico do público-alvo...", fId: "publico" },
      { t: "Listando os assuntos proibidos / bloqueados no perfil...", fId: "bloqueado" },
      { t: "Mapeando os temas chaves e tópicos mais sugeridos...", fId: "temas" },
      { t: "Qualificação de Briefing concluída com 98% de precisão! Gerando dossiê de handoff...", fId: null },
];
