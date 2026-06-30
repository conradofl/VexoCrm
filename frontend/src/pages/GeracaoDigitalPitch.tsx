import { useState, useEffect, useMemo } from "react";
import {
  Sparkles,
  TrendingUp,
  MessageSquare,
  Bot,
  Layers,
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
  Check,
  Mic,
  Palette,
  Eye,
  FileText,
  Award,
  Zap,
  Sliders,
  Save,
  Undo2,
  Plus,
  Trash2,
  Users2,
  Terminal,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

// ─── TYPES & INTERFACES ──────────────────────────────────────────────────────

interface TeamMember {
  id: string;
  name: string;
  role: string;
  parent: string;
  bio: string;
  responsibilities: string[];
  tools: string[];
  status: "Online" | "Em Reunião" | "Focando em IA" | "Offline" | "Gravando";
  avatarColor: string;
}

interface BriefingField {
  id: string;
  label: string;
  placeholder: string;
  status: "pending" | "processing" | "completed";
  value: string;
  confidence: number;
  type?: "text" | "textarea" | "radio" | "checkboxes";
  options?: string[];
  subfields?: { id: string; label: string; value: string }[];
}

interface RoadmapStep {
  week: string;
  title: string;
  subtitle: string;
  details: string[];
}

interface CustomTheme {
  agencyName: string;
  agencySubtitle: string;
  primaryColor: string; // HSL color string or preset key
  prospectName: string;
  prospectLogoUrl: string;
  whatsappNumber: string;
  themePreset: "indigo" | "emerald" | "violet" | "rose" | "amber";
}

interface TranscriptOption {
  id: string;
  title: string;
  description: string;
  text: string;
  extractedValues: Record<string, string>;
}

// ─── MOCK DATA FOR THE BRIEFING TRANSCRIPTS ──────────────────────────────────
const TRANSCRIPT_OPTIONS: TranscriptOption[] = [
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

const ACCENT_PRESETS = {
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
  }
};

export default function GeracaoDigitalPitch() {
  const { user } = useAuth();
  // ─── STATE INITIALIZATION ──────────────────────────────────────────────────
  const [isPresenting, setIsPresenting] = useState<boolean>(false);
  const [activeSlide, setActiveSlide] = useState<number>(1);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  // Theme settings (persist in localStorage)
  const [theme, setTheme] = useState<CustomTheme>(() => {
    const saved = localStorage.getItem("vexo_gd_theme");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return {
      agencyName: "Geração Digital",
      agencySubtitle: "Transformando Cliques em Clientes e Presença em Faturamento",
      primaryColor: "indigo",
      prospectName: "Cliente Parceiro",
      prospectLogoUrl: "",
      whatsappNumber: "(11) 98888-7777",
      themePreset: "indigo"
    };
  });

  // Save theme helper
  const handleSaveTheme = (newTheme: CustomTheme) => {
    setTheme(newTheme);
    localStorage.setItem("vexo_gd_theme", JSON.stringify(newTheme));
    toast({
      title: "Design Salvo",
      description: "As configurações de marca e white-label foram aplicadas com sucesso!",
    });
  };

  const presetStyle = ACCENT_PRESETS[theme.themePreset] || ACCENT_PRESETS.indigo;

  // State of customizer panel
  const [isCustomizerOpen, setIsCustomizerOpen] = useState<boolean>(false);

  // Briefing Form State (Updated fields)
  const [briefingFields, setBriefingFields] = useState<BriefingField[]>([
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
  ]);

  // AI Briefing Simulator State
  const [transcriptText, setTranscriptText] = useState<string>("");
  const [isProcessingAI, setIsProcessingAI] = useState<boolean>(false);
  const [aiProgressText, setAiProgressText] = useState<string>("");
  const [successModalOpen, setSuccessModalOpen] = useState<boolean>(false);

  // Dispatch States for Slide 6
  const [sendToProspectWhatsapp, setSendToProspectWhatsapp] = useState<boolean>(true);
  const [sendToProspectEmail, setSendToProspectEmail] = useState<boolean>(true);
  const [sendToSectors, setSendToSectors] = useState<boolean>(true);
  const [prospectEmail, setProspectEmail] = useState<string>("contato@empresa.com.br");
  const [sectorsWhatsapp, setSectorsWhatsapp] = useState<string>("(11) 98888-7777");
  const [sectorsEmail, setSectorsEmail] = useState<string>("operacoes@geracaodigital.com.br");
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatchSuccess, setDispatchSuccess] = useState<boolean>(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);

  // Team Members list (loaded from localStorage or default)
  const [team, setTeam] = useState<TeamMember[]>([
    {
      id: "caio",
      name: "Caio Almeida",
      role: "CEO Fundador & Diretor Comercial",
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
      role: "Hunter Comercial",
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
      role: "Hunter Comercial",
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
      role: "Designer & Video Maker",
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
      role: "Video Maker Externo",
      parent: "maria_eduarda",
      bio: "Profissional de gravação externa, responsável pela captação presencial de conteúdo nas empresas clientes.",
      responsibilities: ["Operação de câmeras profissionais e drones", "Direção de depoimentos presenciais", "Captação de áudio limpo em lapela"],
      tools: ["Sony A7SIII", "DJI Mavic Pro", "Adobe Premiere"],
      status: "Gravando",
      avatarColor: "from-red-500 to-rose-400"
    },
    {
      id: "iohan",
      name: "Iohan Lancer",
      role: "Designer & Video Maker",
      parent: "maria_eduarda",
      bio: "Motion designer e criador de vinhetas, transformando logos estáticos em animações tecnológicas impactantes.",
      responsibilities: ["Criação de motion design para anúncios", "Vinhetas para vídeos do Youtube e Instagram", "Efeitos sonoros e sonoplastia"],
      tools: ["After Effects", "Premiere", "Audition"],
      status: "Online",
      avatarColor: "from-pink-500 to-purple-600"
    }
  ]);

  // ─── CHIME NOTIFICATION SOUND SIMULATION ──────────────────────────────────────
  const playChime = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
      oscillator.frequency.exponentialRampToValueAtTime(783.99, audioCtx.currentTime + 0.12); // G5
      oscillator.frequency.exponentialRampToValueAtTime(1046.50, audioCtx.currentTime + 0.24); // C6
      
      gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
      
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.45);
    } catch (e) {
      console.warn(e);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Arquivo Inválido",
          description: "Por favor, selecione uma imagem PNG ou JPEG.",
          variant: "destructive"
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          const updated = {
            ...theme,
            prospectLogoUrl: event.target.result as string
          };
          setTheme(updated);
          localStorage.setItem("vexo_gd_theme", JSON.stringify(updated));
          toast({
            title: "Logo Carregada",
            description: "A logomarca do prospect foi carregada com sucesso!",
          });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const renderMemberNode = (memberId: string, size: "sm" | "md" | "lg" = "md") => {
    const member = team.find((m) => m.id === memberId);
    if (!member) return null;

    const getInitials = (name: string) => {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    };

    const initials = getInitials(member.name);

    let cardSize = "";
    let avatarSize = "";
    let nameSize = "";
    let roleSize = "";
    let customBorder = "";

    if (size === "lg") {
      cardSize = "p-4 w-48 rounded-2xl shadow-lg";
      avatarSize = "h-9 w-9 text-xs";
      nameSize = "text-xs font-black mt-2";
      roleSize = "text-[9px]";
      customBorder = member.id === "caio"
        ? "border-violet-500/25 hover:border-violet-500 shadow-lg shadow-violet-500/5"
        : member.id === "aline"
        ? "border-indigo-500/25 hover:border-indigo-500 shadow-lg shadow-indigo-500/5"
        : "border-pink-500/25 hover:border-pink-500 shadow-lg shadow-pink-500/5";
    } else if (size === "md") {
      cardSize = "p-3 w-40 rounded-xl shadow-md";
      avatarSize = "h-8 w-8 text-xs";
      nameSize = "text-[10px] font-black mt-1.5";
      roleSize = "text-[8px]";
      customBorder = "border-white/10 hover:border-white/30";
    } else {
      cardSize = "p-2 w-28 rounded-lg shadow-sm";
      avatarSize = "h-7 w-7 text-[9px]";
      nameSize = "text-[9px] font-bold mt-1";
      roleSize = "text-[7.5px]";
      customBorder = "border-slate-800 hover:border-slate-600 bg-slate-900/30";
    }

    return (
      <div
        onClick={() => setSelectedMember(member)}
        className={cn(
          "group cursor-pointer bg-slate-900/60 backdrop-blur-md text-center transform hover:-translate-y-0.5 transition-all duration-300 relative z-10 border",
          customBorder,
          cardSize
        )}
      >
        <div className={cn(
          "rounded-full mx-auto bg-gradient-to-br flex items-center justify-center font-extrabold border-2 border-slate-950 text-white shadow-sm",
          member.avatarColor,
          avatarSize
        )}>
          {initials}
        </div>
        <h4 className={cn("text-white transition-colors group-hover:text-indigo-300 truncate", nameSize)}>
          {member.name}
        </h4>
        <p className={cn("text-slate-400 uppercase font-mono tracking-wider font-semibold truncate", roleSize)}>
          {member.role}
        </p>
        {member.status && size === "lg" && member.id !== "aline" && member.id !== "raquel" && (
          <span className={cn(
            "inline-flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded-full mt-1.5 font-semibold",
            member.status === "Online" && "bg-emerald-500/10 text-emerald-400",
            member.status === "Em Reunião" && "bg-amber-500/10 text-amber-400",
            member.status === "Focando em IA" && "bg-indigo-500/10 text-indigo-400",
            member.status === "Gravando" && "bg-red-500/10 text-red-400"
          )}>
            <span className={cn(
              "h-1 w-1 rounded-full",
              member.status === "Online" && "bg-emerald-500 animate-pulse",
              member.status === "Em Reunião" && "bg-amber-500 animate-ping",
              member.status === "Focando em IA" && "bg-indigo-500",
              member.status === "Gravando" && "bg-red-500 animate-pulse"
            )} />
            {member.status}
          </span>
        )}
      </div>
    );
  };

  // ─── BRIEFING IA MOCK PARSER ──────────────────────────────────────────────
  const selectTranscriptPreset = (presetId: string) => {
    const preset = TRANSCRIPT_OPTIONS.find((t) => t.id === presetId);
    if (!preset) return;
    setTranscriptText(preset.text);
    toast({
      title: "Transcrição Carregada",
      description: "Carregado o áudio transcrito do cliente. Pronto para análise com IA.",
    });
  };

  const processBriefingWithGemini = () => {
    if (!transcriptText.trim()) {
      toast({
        title: "Transcrição vazia",
        description: "Por favor, cole um áudio transcrito ou selecione um dos modelos acima.",
        variant: "destructive"
      });
      return;
    }

    setIsProcessingAI(true);
    // Reset fields
    setBriefingFields((prev) =>
      prev.map((f) => ({ ...f, status: "pending", value: "", confidence: 0 }))
    );

    const steps = [
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

    let currentStepIndex = 0;

    // Check if the current transcript is one of our presets, otherwise create dynamic values
    const matchedPreset = TRANSCRIPT_OPTIONS.find((t) => transcriptText.includes(t.text.substring(0, 30)));
    
    let extractedValues: Record<string, string> = {};
    if (matchedPreset) {
      extractedValues = matchedPreset.extractedValues;
    } else {
      // Heuristic parsing on custom transcript text
      const text = transcriptText;
      
      const whatsappMatch = text.match(/(?:whatsapp|whats|tel|fone|contato|celular|cel)[\s:a-zA-Z]*(\(?\d{2}\)?\s?\d{4,5}[-.\s]?\d{4})/i) || text.match(/(\(?\d{2}\)?\s?\d{4,5}[-.\s]?\d{4})/);
      const whatsapp = whatsappMatch ? whatsappMatch[1] : "(11) 99999-9999 (Solicitar)";
      
      const siteMatch = text.match(/(?:site|domain|domínio|web|www)[\s:a-zA-Z]*([a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+)/i) || text.match(/([a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+)/);
      const site = siteMatch ? siteMatch[1] : "Não citado no briefing";
      
      const igMatch = text.match(/(?:instagram|insta|ig|perfil)[\s:a-zA-Z]*@([a-zA-Z0-9._]+)/i) || text.match(/@([a-zA-Z0-9._]+)/);
      const instagram = igMatch ? `@${igMatch[1]}` : "@cliente (Pendente)";
      
      const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6})/);
      const email = emailMatch ? emailMatch[1] : "contato@empresa.com.br";
      
      const passwordMatch = text.match(/(?:senha|password|pass|acesso)[\s:a-zA-Z]*([a-zA-Z0-9@#$_!-]+)/i);
      const password = passwordMatch ? passwordMatch[1] : "senha123";
      
      const compMatch = text.match(/(?:concorrentes|concorrente|compete|competidor|rivais)[\s:a-zA-Z]*([^\.]+)/i);
      const concorrentes = compMatch ? compMatch[1].trim() : "Mapeando concorrência local";

      const inspMatch = text.match(/(?:inspiração|inspirar|referência|gostamos)[\s:a-zA-Z]*([^\.]+)/i);
      const inspiracao = inspMatch ? inspMatch[1].trim() : "Clean e moderno";

      const geoMatch = text.match(/(?:atuação|cidade|estado|região|localizado|endereço)[\s:a-zA-Z]*([^\.]+)/i);
      const atuacao = geoMatch ? geoMatch[1].trim() : "Local";

      const targetMatch = text.match(/(?:público|publico|persona|idade)[\s:a-zA-Z]*([^\.]+)/i);
      const publico = targetMatch ? targetMatch[1].trim() : "Consumidores do segmento";

      const blockMatch = text.match(/(?:bloqueado|não abordar|nunca falar|assuntos)[\s:a-zA-Z]*([^\.]+)/i);
      const bloqueado = blockMatch ? blockMatch[1].trim() : "Política, religião e polêmicas";

      const themesMatch = text.match(/(?:temas|conteúdo|postagens|linha editorial)[\s:a-zA-Z]*([^\.]+)/i);
      const temas = themesMatch ? themesMatch[1].trim() : "Dicas úteis, bastidores e depoimentos";

      const prodMatch = text.match(/(?:serviços|produtos|vende|contratamos|fechamos)[\s:a-zA-Z]*([^\.]+)/i);
      const produtos = prodMatch ? prodMatch[1].trim() : "Gestão de Tráfego Pago + Social Media";

      extractedValues = {
        produtos: produtos.substring(0, 80),
        logo: text.includes("drive.google") || text.includes("dropbox") 
          ? "Link de nuvem detectado no áudio" 
          : "Link de pasta compartilhada pendente",
        instagram: `User: ${instagram} | Senha: ${password}`,
        facebook: `Página comercial vinculada a ${instagram}`,
        google: `User: ${email} | Senha: ${password}`,
        site,
        whatsapp,
        concorrentes: concorrentes.substring(0, 80),
        inspiracao: inspiracao.substring(0, 80),
        servicos: text.slice(0, 100) + "...",
        atuacao: atuacao.substring(0, 80),
        publico: publico.substring(0, 80),
        bloqueado: bloqueado.substring(0, 80),
        temas: temas.substring(0, 80)
      };
    }

    const interval = setInterval(() => {
      if (currentStepIndex >= steps.length) {
        clearInterval(interval);
        setIsProcessingAI(false);
        playChime();
        toast({
          title: "Análise da IA Concluída!",
          description: "Os 14 campos do briefing foram qualificados e preenchidos em tempo real.",
        });
        return;
      }

      const step = steps[currentStepIndex];
      setAiProgressText(step.t);

      if (step.fId) {
        const fieldId = step.fId;
        // Simulate typing for this field
        setBriefingFields((prev) =>
          prev.map((f) => {
            if (f.id === fieldId) {
              const val = extractedValues[fieldId] || "Preenchido com base nas respostas do briefing comercial.";
              return {
                ...f,
                status: "completed",
                value: val,
                confidence: Math.round(85 + Math.random() * 14)
              };
            }
            return f;
          })
        );
      }

      currentStepIndex++;
    }, 1200);
  };

  const handleSendBriefing = () => {
    // Check if fields are filled
    const filledCount = briefingFields.filter((f) => f.value).length;
    if (filledCount < 5) {
      toast({
        title: "Briefing Incompleto",
        description: "Por favor, execute o processamento com Gemini para preencher o briefing antes de enviar.",
        variant: "destructive"
      });
      return;
    }

    setSuccessModalOpen(true);
  };

  // ─── BRIEFING DISPATCH LOGIC ────────────────────────────────────────────────
  const handleWhatsappDispatch = async () => {
    try {
      setIsDispatching(true);
      
      const payload = {
        prospectName: theme.prospectName,
        whatsappNumber: theme.whatsappNumber,
        agencyName: theme.agencyName,
        themePreset: theme.themePreset,
        briefingData: briefingFields.reduce((acc, f) => ({ ...acc, [f.id]: f.value }), {})
      };

      const token = (await user?.getIdToken()) || "";
      const response = await fetch("/api/geracao-digital/briefing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("Erro ao salvar e disparar o briefing.");
      }

      toast({
        title: "WhatsApp Disparado!",
        description: `Dossiê técnico do briefing enviado para o WhatsApp de ${theme.prospectName} (${theme.whatsappNumber || "número cadastrado"}).`,
      });
      playChime();
    } catch (error: any) {
      toast({
        title: "Erro no Disparo",
        description: error.message || "Ocorreu um erro ao disparar o briefing.",
        variant: "destructive"
      });
    } finally {
      setIsDispatching(false);
    }
  };

  const handleEmailDispatch = () => {
    toast({
      title: "E-mail de Boas-Vindas!",
      description: `E-mail com o cronograma e cópia do briefing disparado para ${theme.prospectName} com sucesso.`,
    });
    playChime();
  };

  const handlePdfExport = () => {
    toast({
      title: "PDF Gerado!",
      description: `O arquivo PDF do briefing foi gerado e salvo nos anexos da conta no CRM.`,
    });
    playChime();
  };

  const handleSectorsDispatch = () => {
    toast({
      title: "Handoff Operacional Ativado!",
      description: `Setores de tráfego, design e contratos foram notificados no Slack e Vexo OS.`,
    });
    playChime();
  };

  // ─── ROADMAP ITEMS MAPPED ────────────────────────────────────────────────────
  const roadmapSteps: RoadmapStep[] = [
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

  return (
    <PageShell
      title="Apresentação & Onboarding On-Demand"
      subtitle="Pitch premium interativo da Geração Digital e ferramenta inteligente de briefing com IA, integrados ao motor da Vexo."
      icon={Briefcase}
    >
      
      {/* ─── MAIN CONFIGURATION BOARD (WHEN NOT IN PRESENTATION MODE) ────────── */}
      {!isPresenting && (
        <div className="space-y-6 animate-fade-in-up">
          
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-50 dark:bg-white/[0.02] p-5 rounded-2xl border border-slate-200 dark:border-white/10 relative overflow-hidden">
            <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-purple-500" />
            <div className="space-y-1">
              <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                Módulo Comercial da {theme.agencyName}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
                Ferramenta comercial completa para reuniões com clientes. Permite apresentar a estrutura da agência, coletar dados com IA em tempo real e white-labelizar a plataforma.
              </p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => {
                  setActiveSlide(1);
                  setIsPresenting(true);
                }}
                className="gap-2 bg-indigo-600 hover:bg-indigo-500 font-extrabold shadow-lg shadow-indigo-600/20 px-5 text-white"
              >
                <Maximize2 className="h-4 w-4" />
                Iniciar Apresentação (Tela Cheia)
              </Button>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Quick Setup Client Card */}
            <Card className="border-slate-200 dark:border-white/10 bg-white/40 dark:bg-white/[0.02] backdrop-blur-md relative overflow-hidden flex flex-col justify-between group hover:border-slate-300 dark:hover:border-white/20 transition-all duration-300">
              <div className="p-6 space-y-4">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Prospect Vinculado</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Altere o nome e o logotipo do cliente em tempo real para apresentar uma página totalmente personalizada para ele.
                  </p>
                </div>
              </div>
              <div className="p-6 pt-0 space-y-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono uppercase font-bold">Nome do Prospect</Label>
                  <Input
                    value={theme.prospectName}
                    onChange={(e) => {
                      const updated = { ...theme, prospectName: e.target.value };
                      setTheme(updated);
                      localStorage.setItem("vexo_gd_theme", JSON.stringify(updated));
                    }}
                    className="h-8 text-xs border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/60 focus:border-indigo-500/50 text-slate-900 dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono uppercase font-bold">Logomarca do Prospect (PNG/JPG)</Label>
                  <div className="flex items-center gap-2">
                    {theme.prospectLogoUrl ? (
                      <div className="relative h-8 w-8 rounded border border-slate-200 dark:border-white/10 overflow-hidden bg-white dark:bg-slate-950 flex items-center justify-center shrink-0">
                        <img src={theme.prospectLogoUrl} alt="Logo Prospect" className="h-full w-full object-contain" />
                        <button
                          onClick={() => {
                            const updated = { ...theme, prospectLogoUrl: "" };
                            setTheme(updated);
                            localStorage.setItem("vexo_gd_theme", JSON.stringify(updated));
                          }}
                          className="absolute inset-0 bg-red-600/80 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-white" />
                        </button>
                      </div>
                    ) : (
                      <div className="h-8 w-8 rounded border border-dashed border-slate-200 dark:border-white/20 flex items-center justify-center text-slate-500 shrink-0">
                        <Building2 className="h-3.5 w-3.5" />
                      </div>
                    )}
                    <label className="flex-1">
                      <div className="h-8 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 rounded flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer gap-1 bg-slate-50 dark:bg-slate-950/60">
                        <Upload className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        Selecionar Imagem
                      </div>
                      <input
                        type="file"
                        accept="image/png, image/jpeg, image/jpg"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </Card>

            {/* Productization Info Card */}
            <Card className="border-slate-200 dark:border-white/10 bg-white/40 dark:bg-white/[0.02] backdrop-blur-md relative overflow-hidden flex flex-col justify-between group hover:border-slate-300 dark:hover:border-white/20 transition-all duration-300">
              <div className="p-6 space-y-4">
                <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <Award className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">White-Label & Revenda</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Esta ferramenta comercial pode ser duplicada e vendida para outras agências. Configure a logo da agência parceira no painel lateral.
                  </p>
                </div>
              </div>
              <div className="p-6 pt-0">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setIsCustomizerOpen(true)}
                  className="w-full text-xs font-bold border-indigo-500/20 bg-indigo-500/5 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/10 dark:hover:bg-indigo-500/10"
                >
                  Configurar White-Label
                </Button>
              </div>
            </Card>
          </div>

          {/* Quick instructions on how the slides work */}
          <div className="bg-slate-50 dark:bg-slate-950/40 p-6 rounded-2xl border border-slate-200 dark:border-white/5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Terminal className="h-4.5 w-4.5 text-indigo-600 dark:text-indigo-400" />
              Estrutura do Deck de Apresentação (6 Slides)
            </h3>
            
            <div className="grid gap-4 md:grid-cols-3 text-xs">
              <div className="p-3 bg-white dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Slide 1: Capa</span>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Institucional com animação futurista de partículas e saudações dinâmicas.</p>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Slide 2: Escopo</span>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Delineia o processo de tráfego, design criativo e relatórios de ROI.</p>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Slide 3: Organograma</span>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Diagrama interativo com neon conectivo das equipes de Caio, Humberto, Jheyson etc.</p>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Slide 4: Cronograma</span>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Timeline visual de 4 semanas até o lançamento das campanhas.</p>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Slide 5: Briefing com IA</span>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Formulário inteligente que preenche 14 dados analisando texto transcrito.</p>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Slide 6: Ativação</span>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Fechamento de contrato com simulação de assinatura digital interativa.</p>
              </div>
            </div>
          </div>
          
        </div>
      )}

      {/* ─── FULLSCREEN PRESENTATION MODE (THE PITCH & BRIEFING SPA) ───────── */}
      {isPresenting && (
        <div className="fixed inset-0 z-50 bg-slate-950 text-white overflow-y-auto flex flex-col justify-between font-sans transition-all duration-300">
          
          {/* Neon Grid Overlay Backdrop */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none z-0" />
          <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-indigo-500/5 to-transparent pointer-events-none z-0" />
          
          {/* Dynamic Floating stars backgound */}
          <div className="stars-layer absolute inset-0 pointer-events-none z-0">
            <div className="stars-1 opacity-50" />
            <div className="stars-2 opacity-30" />
          </div>

          {/* Header Panel */}
          <header className="relative z-10 border-b border-white/5 bg-slate-950/60 backdrop-blur-md px-8 py-4 shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Interactive Initials Avatar or uploaded Logo */}
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-500 p-px flex items-center justify-center font-bold text-sm tracking-tight text-white shadow-lg shadow-indigo-500/20">
                <div className="h-full w-full bg-slate-950 rounded-[11px] flex items-center justify-center">
                  {theme.agencyName.substring(0, 2).toUpperCase()}
                </div>
              </div>
              <div>
                <span className="text-sm font-black text-white tracking-tight uppercase">{theme.agencyName}</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] text-slate-400 font-medium">Briefing Comercial · {theme.prospectName}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCustomizerOpen(true)}
                className="h-8 text-[11px] font-bold border-white/10 hover:bg-white/5 bg-slate-900/60 text-slate-300"
              >
                <Sliders className="h-3.5 w-3.5 mr-1.5 text-indigo-400" />
                Painel Customizador
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPresenting(false)}
                className="h-8 text-[11px] font-bold border-white/10 hover:bg-white/5 bg-slate-900/60 text-red-400 hover:text-red-300"
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Fechar Pitch
              </Button>
            </div>
          </header>

          {/* Main Slide Deck Canvas */}
          <main className="flex-1 relative z-10 flex items-center justify-center p-6 md:p-12 overflow-y-auto">
            
            {/* SLIDE 1: WELCOME & COVER */}
            {activeSlide === 1 && (
              <div className="max-w-4xl w-full text-center space-y-8 animate-fade-in-up">
                <div className="space-y-4">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-4 py-1.5 uppercase tracking-widest font-mono">
                    Slide 01 · Parceria Comercial
                  </Badge>
                  <h1 className="text-5xl md:text-7xl font-black tracking-tight text-white leading-tight">
                    Seja muito bem-vindo à <span className="bg-gradient-to-r from-indigo-400 via-cyan-400 to-purple-400 bg-clip-text text-transparent">{theme.agencyName}</span>
                  </h1>
                  <p className="text-base md:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
                    {theme.agencySubtitle}
                  </p>
                </div>

                <div className="max-w-md mx-auto p-6 rounded-2xl border border-white/5 bg-slate-900/20 backdrop-blur-lg space-y-4">
                  <p className="text-xs text-slate-400 font-medium">Reunião de Onboarding estruturada para:</p>
                  <div className="flex items-center justify-center gap-3">
                    {theme.prospectLogoUrl ? (
                      <div className="h-10 w-24 rounded-lg border border-white/10 p-1.5 bg-slate-900/60 flex items-center justify-center overflow-hidden">
                        <img src={theme.prospectLogoUrl} alt="Logo Prospect" className="max-h-full max-w-full object-contain" />
                      </div>
                    ) : (
                      <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center font-black text-emerald-400 text-xs">
                        {(() => {
                          const parts = theme.prospectName.trim().split(/\s+/);
                          if (parts.length >= 2) {
                            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                          }
                          return theme.prospectName.substring(0, 2).toUpperCase();
                        })()}
                      </div>
                    )}
                    <span className="text-lg font-black text-white">{theme.prospectName}</span>
                  </div>
                  <div className="h-px bg-white/5" />
                  <p className="text-[10px] text-slate-500 font-mono">Status: Pronto para qualificação do plano tático</p>
                </div>

                <div className="pt-4 flex justify-center gap-3">
                  <Button
                    onClick={() => setActiveSlide(2)}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold px-8 py-5 text-sm rounded-xl shadow-lg shadow-indigo-600/30 group"
                  >
                    Avançar para Metodologia
                    <ArrowRight className="h-4.5 w-4.5 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </div>
              </div>
            )}

            {/* SLIDE 2: METHODOLOGY & SCOPE */}
            {activeSlide === 2 && (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-3">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-4 py-1.5 uppercase tracking-wider font-mono">
                    Slide 02 · Como Trabalhamos
                  </Badge>
                  <h2 className="text-3xl md:text-5xl font-black text-white">Engrenagem de Tração & Escala</h2>
                  <p className="text-xs md:text-sm text-slate-400 max-w-2xl mx-auto">
                    Nossa metodologia consiste em integrar perfeitamente criativos envolventes com inteligência de tráfego pago local e de conversão rápida.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-4 mt-6">
                  {/* Step 1 */}
                  <div className="p-6 rounded-2xl border border-white/5 bg-slate-900/10 backdrop-blur-md hover:border-indigo-500/30 transition-all duration-300 group space-y-4">
                    <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center font-bold text-indigo-400">
                      01
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="font-bold text-white text-sm group-hover:text-indigo-400 transition-colors">Planejamento & Briefing</h3>
                      <p className="text-xs text-slate-400 leading-relaxed">Captura estruturada de logins, metas, paleta de cores e perfil de cliente ideal para mapear o posicionamento.</p>
                    </div>
                  </div>
                  {/* Step 2 */}
                  <div className="p-6 rounded-2xl border border-white/5 bg-slate-900/10 backdrop-blur-md hover:border-cyan-500/30 transition-all duration-300 group space-y-4">
                    <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center font-bold text-cyan-400">
                      02
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="font-bold text-white text-sm group-hover:text-cyan-400 transition-colors">Produção Criativa</h3>
                      <p className="text-xs text-slate-400 leading-relaxed">Roteirização de vídeos curtos magnéticos (Reels/TikTok) e design estético refinado de criativos para anúncios.</p>
                    </div>
                  </div>
                  {/* Step 3 */}
                  <div className="p-6 rounded-2xl border border-white/5 bg-slate-900/10 backdrop-blur-md hover:border-purple-500/30 transition-all duration-300 group space-y-4">
                    <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center font-bold text-purple-400">
                      03
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="font-bold text-white text-sm group-hover:text-purple-400 transition-colors">Mídia & Tráfego Pago</h3>
                      <p className="text-xs text-slate-400 leading-relaxed">Configuração profissional de pixel, UTMs e campanhas de anúncios focadas em menor CPL e alta intenção comercial.</p>
                    </div>
                  </div>
                  {/* Step 4 */}
                  <div className="p-6 rounded-2xl border border-white/5 bg-slate-900/10 backdrop-blur-md hover:border-emerald-500/30 transition-all duration-300 group space-y-4">
                    <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center font-bold text-emerald-400">
                      04
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="font-bold text-white text-sm group-hover:text-emerald-400 transition-colors">Inteligência de Vendas</h3>
                      <p className="text-xs text-slate-400 leading-relaxed">Relatório de ROI unificado direto no Vexo CRM, com auditoria de CAC e otimização diária de orçamentos.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SLIDE 3: INTERACTIVE ORG CHART */}
            {activeSlide === 3 && (
              <div className="max-w-7xl w-full space-y-6 animate-fade-in-up">
                <div className="text-center space-y-3">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-4 py-1.5 uppercase tracking-wider font-mono">
                    Slide 03 · Estrutura Organizacional Interativa
                  </Badge>
                  <h2 className="text-3xl md:text-5xl font-black text-white">Nossa Equipe de Performance</h2>
                  <p className="text-xs md:text-sm text-slate-400 max-w-2xl mx-auto">
                    Conheça os especialistas que farão o motor digital da sua empresa rodar. Clique sobre um profissional para inspecionar suas atribuições e ferramentas.
                  </p>
                </div>

                {/* The Tech Organogram Tree */}
                <div className="relative border border-white/5 bg-slate-950/80 p-8 rounded-3xl overflow-x-auto">
                  <div className="w-full max-w-[1200px] mx-auto pb-32">
                    
                    {/* Level 0 Node (Centered) */}
                    <div className="flex flex-col items-center">
                      {renderMemberNode("caio", "lg")}
                      <div className="h-8 w-px bg-violet-500/40" />
                    </div>

                    {/* Level 1 Horizontal Connect Bar */}
                    <div className="relative w-full">
                      <div className="absolute top-0 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-cyan-500 via-indigo-500 to-pink-500" />
                    </div>

                    {/* Three Main Columns Grid */}
                    <div className="grid grid-cols-[1fr_2fr_1fr] gap-12 pt-6">
                      
                      {/* Column 1: Comercial Outbound */}
                      <div className="flex flex-col items-center">
                        <div className="h-6 w-px bg-cyan-500/40 -mt-6" />
                        <div className="text-[10px] text-slate-500 font-mono tracking-widest uppercase font-bold border-b border-white/5 pb-1 mb-4">Comercial Outbound</div>
                        <div className="flex flex-col gap-3">
                          {renderMemberNode("conrado", "md")}
                          {renderMemberNode("luiz_felipe", "sm")}
                          {renderMemberNode("priscila", "md")}
                          {renderMemberNode("gabriel", "md")}
                        </div>
                      </div>

                      {/* Column 2: Atendimento (Aline) */}
                      <div className="flex flex-col items-center">
                        <div className="h-6 w-px bg-indigo-500/40 -mt-6" />
                        {renderMemberNode("aline", "lg")}
                        
                        {/* Line down to Aline's sub-directors */}
                        <div className="h-8 w-px bg-indigo-500/40" />
                        
                        {/* Sub-branches grid wrapper */}
                        <div className="relative w-full">
                          {/* Horizontal sub-connector */}
                          <div className="absolute top-0 left-[25%] right-[25%] h-px bg-gradient-to-r from-blue-500 to-orange-500" />
                          
                          <div className="grid grid-cols-2 gap-6 pt-6">
                            
                            {/* Sub-branch 1: Humberto (Tráfego) */}
                            <div className="flex flex-col items-center">
                              <div className="h-6 w-px bg-blue-500/40 -mt-6" />
                              {renderMemberNode("humberto", "md")}
                              
                              {/* Sub-line to Traffic Team */}
                              <div className="h-8 w-px bg-blue-500/40" />
                              <div className="flex flex-col gap-3">
                                {renderMemberNode("arthur", "sm")}
                                {renderMemberNode("cabalim", "sm")}
                              </div>
                            </div>

                            {/* Sub-branch 2: Jheyson (Design) */}
                            <div className="flex flex-col items-center">
                              <div className="h-6 w-px bg-orange-500/40 -mt-6" />
                              {renderMemberNode("jheyson", "md")}
                              
                              {/* Sub-line to Design Team */}
                              <div className="h-8 w-px bg-orange-500/40" />
                              <div className="flex flex-col gap-3">
                                {renderMemberNode("santana", "sm")}
                                {renderMemberNode("karolina", "sm")}
                              </div>
                            </div>

                          </div>
                        </div>
                      </div>

                      {/* Column 3: Diretora Operacional (Raquel) */}
                      <div className="flex flex-col items-center">
                        <div className="h-6 w-px bg-pink-500/40 -mt-6" />
                        {renderMemberNode("raquel", "lg")}
                        
                        {/* Line down to Maria Eduarda */}
                        <div className="h-8 w-px bg-pink-500/40" />
                        
                        {/* Sub-branch Maria Eduarda */}
                        <div className="flex flex-col items-center w-full">
                          {renderMemberNode("maria_eduarda", "md")}
                          
                          {/* Sub-line to Video Team */}
                          <div className="h-8 w-px bg-rose-500/40" />
                          <div className="flex flex-col gap-3">
                            {renderMemberNode("eflen", "sm")}
                            {renderMemberNode("carlos", "sm")}
                            {renderMemberNode("iohan", "sm")}
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>

                {/* Team Member detail display card drawer modal */}
                {selectedMember && (
                  <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <Card className="max-w-md w-full border-white/10 bg-slate-900 text-white relative overflow-hidden animate-fade-in-up">
                      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-violet-600 to-indigo-500" />
                      <button 
                        onClick={() => setSelectedMember(null)}
                        className="absolute top-4 right-4 text-slate-400 hover:text-white"
                      >
                        <X className="h-5 w-5" />
                      </button>
                      <CardHeader className="pt-6">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-extrabold text-sm text-white">
                            {selectedMember.name.split(" ").map(n => n[0]).join("")}
                          </div>
                          <div>
                            <CardTitle className="text-base font-black text-white">{selectedMember.name}</CardTitle>
                            <CardDescription className="text-xs text-indigo-400 font-semibold">{selectedMember.role}</CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4 text-xs">
                        <p className="text-slate-300 leading-relaxed bg-slate-950/30 p-3 rounded-lg border border-white/5">{selectedMember.bio}</p>
                        
                        <div className="space-y-1.5">
                          <span className="font-bold text-slate-400 uppercase text-[9px] font-mono tracking-wider">Responsabilidade na Conta</span>
                          <ul className="space-y-1 text-slate-300">
                            {selectedMember.responsibilities.map((r, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                <span>{r}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="space-y-1.5">
                          <span className="font-bold text-slate-400 uppercase text-[9px] font-mono tracking-wider">Ferramentas de Trabalho</span>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedMember.tools.map((t, i) => (
                              <Badge key={i} className="bg-white/5 border-white/5 text-slate-300 text-[10px] font-mono">{t}</Badge>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

              </div>
            )}

            {/* SLIDE 5: THE AI BRIEFING QUESTIONNAIRE */}
            {activeSlide === 5 && (
              <div className="max-w-6xl w-full space-y-4 animate-fade-in-up">
                <div className="text-center space-y-2">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-4 py-1.5 uppercase tracking-wider font-mono">
                    Slide 05 · Onboarding Inteligente (Integração com IA)
                  </Badge>
                  <h2 className="text-3xl md:text-5xl font-black text-white">Questionário Automatizado por IA</h2>
                  <p className="text-xs md:text-sm text-slate-400 max-w-2xl mx-auto">
                    Insira a conversa de briefing no campo esquerdo. A IA processará a transcrição de voz/texto, preencherá os 14 requisitos operacionais e preparará o handoff técnico.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-5 mt-4 items-start">
                  
                  {/* Left Column: Speech Transcript Pasting & presets */}
                  <div className="md:col-span-2 space-y-4">
                    <Card className="border-white/5 bg-slate-900/30 backdrop-blur-md">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <Mic className="h-4 w-4 text-indigo-400" />
                          Áudio Transcrito do Briefing
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        
                        {/* Select Presets */}
                        <div className="space-y-2">
                          <Label className="text-[10px] text-slate-400 uppercase font-mono font-bold">Modelos Rápidos (Demos Comerciais)</Label>
                          <div className="space-y-1.5">
                            {TRANSCRIPT_OPTIONS.map((o) => (
                              <button
                                key={o.id}
                                onClick={() => selectTranscriptPreset(o.id)}
                                className="w-full text-left text-xs p-2 rounded-lg border border-white/5 hover:bg-indigo-600/10 hover:border-indigo-500/30 bg-slate-950/40 text-slate-300 font-semibold block transition-all"
                              >
                                {o.title}
                                <span className="block text-[9px] text-slate-500 font-normal">{o.description}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Textarea */}
                        <div className="space-y-1.5">
                          <Label className="text-[10px] text-slate-400 uppercase font-mono font-bold" htmlFor="transcript-area">Transcrição do briefing comercial</Label>
                          <textarea
                            id="transcript-area"
                            value={transcriptText}
                            onChange={(e) => setTranscriptText(e.target.value)}
                            placeholder="Cole aqui o texto da conversa transcrita..."
                            className="w-full h-44 p-3 text-xs bg-slate-950/80 border border-white/5 rounded-xl text-slate-300 font-sans focus:border-indigo-500/50 outline-none leading-relaxed resize-none"
                          />
                        </div>

                        {/* Run Button */}
                        <Button
                          onClick={processBriefingWithGemini}
                          disabled={isProcessingAI}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 font-extrabold text-xs text-white h-10 gap-2 shadow-lg shadow-indigo-600/10"
                        >
                          {isProcessingAI ? (
                            <>
                              <RefreshCw className="h-4 w-4 animate-spin text-white" />
                              Processando Briefing...
                            </>
                          ) : (
                            <>
                              <Bot className="h-4 w-4 text-white" />
                              Qualificar com IA
                            </>
                          )}
                        </Button>
                      </CardContent>
                    </Card>

                    {/* Gemini Processing Console view */}
                    {isProcessingAI && (
                      <div className="p-3 bg-indigo-950/20 border border-indigo-500/30 rounded-xl space-y-1.5 animate-pulse">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-mono text-indigo-400 uppercase font-bold">Console do Processador de IA</span>
                          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-ping" />
                        </div>
                        <p className="text-[10px] font-mono text-indigo-200/90 leading-normal">{aiProgressText}</p>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Dynamic Form (14 fields) */}
                  <div className="md:col-span-3">
                    <Card className="border-white/5 bg-slate-900/30 backdrop-blur-md max-h-[500px] overflow-y-auto">
                      <CardHeader className="pb-3 border-b border-white/5 flex flex-row items-center justify-between sticky top-0 bg-slate-900/80 backdrop-blur z-20">
                        <div>
                          <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">Requisitos do Briefing da Agência</CardTitle>
                          <CardDescription className="text-[10px]">20 dados chaves coletados e validados pelo robô.</CardDescription>
                        </div>
                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-bold font-mono">
                          {briefingFields.filter(f => f.value).length} / 20 Completos
                        </Badge>
                      </CardHeader>
                      <CardContent className="p-6 space-y-4">
                        
                        <div className="grid gap-4 sm:grid-cols-2">
                          {briefingFields.map((field) => {
                            if (field.id === "publico_alvo") {
                              return (
                                <div key={field.id} className="sm:col-span-2 p-4 rounded-xl border border-white/5 bg-slate-950/40 space-y-3">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">{field.label}</Label>
                                    {field.status === "completed" ? (
                                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] font-bold flex items-center gap-0.5 px-1 py-0 h-4">
                                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                                        IA ({field.confidence}%)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-950 text-slate-500 text-[8px] px-1 py-0 h-4 border border-white/5">
                                        Pendente
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    {field.subfields?.map((sf) => (
                                      <div key={sf.id} className="space-y-1">
                                        <Label className="text-[10px] text-slate-400 font-medium">{sf.label}</Label>
                                        <Input
                                          value={sf.value}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setBriefingFields((prev) =>
                                              prev.map((f) => {
                                                if (f.id === "publico_alvo") {
                                                  const updatedSub = f.subfields?.map((s) => s.id === sf.id ? { ...s, value: val } : s) || [];
                                                  const anyVal = updatedSub.some((s) => s.value.trim());
                                                  const summary = updatedSub.filter((s) => s.value).map((s) => `${s.label}: ${s.value}`).join(" | ");
                                                  return {
                                                    ...f,
                                                    subfields: updatedSub,
                                                    value: anyVal ? summary : "",
                                                    status: anyVal ? "completed" : "pending"
                                                  };
                                                }
                                                return f;
                                              })
                                            );
                                          }}
                                          placeholder={`Defina ${sf.label.toLowerCase()}`}
                                          className="h-8 text-xs border-white/5 bg-slate-950/60 focus:border-indigo-500/50 text-slate-200"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            }

                            if (field.type === "checkboxes") {
                              const selectedList = field.value ? field.value.split(", ").map(x => x.trim()) : [];
                              const isProdutos = field.id === "produtos";
                              const outrosItem = selectedList.find(x => x.startsWith("Outros:") || x.toLowerCase().startsWith("outros"));
                              const hasOutros = !!outrosItem;
                              const outrosText = outrosItem ? (outrosItem.includes(":") ? outrosItem.split(":")[1].trim() : outrosItem.replace(/outros/i, "").trim()) : "";

                              const handleToggleProduct = (option: string) => {
                                let newList = [...selectedList];
                                if (newList.includes(option)) {
                                  newList = newList.filter(x => x !== option);
                                } else {
                                  newList.push(option);
                                }
                                newList = newList.filter(Boolean);
                                const joined = newList.join(", ");
                                setBriefingFields((prev) =>
                                  prev.map((f) => f.id === field.id ? { ...f, value: joined, status: joined ? "completed" : "pending" } : f)
                                );
                              };

                              const handleOutrosTextChange = (text: string) => {
                                let newList = selectedList.filter(x => !x.startsWith("Outros:") && !x.toLowerCase().startsWith("outros"));
                                if (text.trim()) {
                                  newList.push(`Outros: ${text.trim()}`);
                                } else {
                                  newList.push("Outros");
                                }
                                const joined = newList.join(", ");
                                setBriefingFields((prev) =>
                                  prev.map((f) => f.id === "produtos" ? { ...f, value: joined, status: joined ? "completed" : "pending" } : f)
                                );
                              };

                              return (
                                <div key={field.id} className="sm:col-span-2 p-4 rounded-xl border border-white/5 bg-slate-950/40 space-y-3">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">{field.label}</Label>
                                    {field.status === "completed" ? (
                                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] font-bold flex items-center gap-0.5 px-1 py-0 h-4">
                                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                                        IA ({field.confidence}%)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-950 text-slate-500 text-[8px] px-1 py-0 h-4 border border-white/5">
                                        Pendente
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {field.options?.map((opt) => {
                                      const isSelected = selectedList.includes(opt) || (opt === "Outros ______________" && hasOutros);
                                      return (
                                        <button
                                          key={opt}
                                          type="button"
                                          onClick={() => {
                                            if (opt === "Outros ______________") {
                                              if (hasOutros) {
                                                const newList = selectedList.filter(x => !x.startsWith("Outros:") && !x.toLowerCase().startsWith("outros"));
                                                const joined = newList.join(", ");
                                                setBriefingFields((prev) =>
                                                  prev.map((f) => f.id === field.id ? { ...f, value: joined, status: joined ? "completed" : "pending" } : f)
                                                );
                                              } else {
                                                handleToggleProduct("Outros");
                                              }
                                            } else {
                                              handleToggleProduct(opt);
                                            }
                                          }}
                                          className={cn(
                                            "text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-all duration-200",
                                            isSelected 
                                              ? "bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-md shadow-indigo-600/10" 
                                              : "bg-slate-900 border-white/5 text-slate-400 hover:text-slate-300 hover:bg-slate-800"
                                          )}
                                        >
                                          {opt === "Outros ______________" ? "Outros" : opt}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {isProdutos && hasOutros && (
                                    <div className="space-y-1 mt-2 animate-fade-in-up">
                                      <Label className="text-[10px] text-slate-400 font-mono">Especifique os outros produtos:</Label>
                                      <Input
                                        value={outrosText}
                                        onChange={(e) => handleOutrosTextChange(e.target.value)}
                                        placeholder="Ex: Assessoria de imprensa, Tráfego para afiliados..."
                                        className="h-8 text-xs border-white/5 bg-slate-950/60 focus:border-indigo-500/50 text-slate-200"
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            }

                            if (field.type === "radio") {
                              return (
                                <div key={field.id} className="space-y-1">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-[11px] font-bold text-slate-300 leading-tight">{field.label}</Label>
                                    {field.status === "completed" ? (
                                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] font-bold flex items-center gap-0.5 px-1 py-0 h-4">
                                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                                        IA ({field.confidence}%)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-950 text-slate-500 text-[8px] px-1 py-0 h-4 border border-white/5">
                                        Pendente
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex gap-2">
                                    {field.options?.map((opt) => {
                                      const isSelected = field.value === opt;
                                      return (
                                        <button
                                          key={opt}
                                          type="button"
                                          onClick={() => {
                                            setBriefingFields((prev) =>
                                              prev.map((f) => f.id === field.id ? { ...f, value: opt, status: "completed", confidence: 99 } : f)
                                            );
                                          }}
                                          className={cn(
                                            "flex-1 text-[10px] font-semibold py-1.5 px-2.5 rounded-lg border transition-all duration-200",
                                            isSelected 
                                              ? "bg-indigo-600/20 border-indigo-500 text-indigo-300" 
                                              : "bg-slate-950/60 border-white/5 text-slate-400 hover:text-slate-300 hover:bg-slate-900"
                                          )}
                                        >
                                          {opt}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            }

                            if (field.type === "textarea") {
                              return (
                                <div key={field.id} className="sm:col-span-2 space-y-1">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-[11px] font-bold text-slate-300" htmlFor={field.id}>{field.label}</Label>
                                    {field.status === "completed" ? (
                                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] font-bold flex items-center gap-0.5 px-1 py-0 h-4">
                                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                                        IA ({field.confidence}%)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-950 text-slate-500 text-[8px] px-1 py-0 h-4 border border-white/5">
                                        Pendente
                                      </Badge>
                                    )}
                                  </div>
                                  <textarea
                                    id={field.id}
                                    value={field.value}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setBriefingFields((prev) =>
                                        prev.map((f) => (f.id === field.id ? { ...f, value: val, status: val ? "completed" : "pending" } : f))
                                      );
                                    }}
                                    placeholder={field.placeholder}
                                    className={cn(
                                      "w-full h-20 p-3 text-xs bg-slate-950/80 border border-white/5 rounded-xl text-slate-200 font-sans focus:border-indigo-500/50 outline-none leading-relaxed resize-none",
                                      field.status === "completed" && "border-emerald-500/20 bg-emerald-950/5 focus:border-emerald-500/50"
                                    )}
                                  />
                                </div>
                              );
                            }

                            return (
                              <div key={field.id} className="space-y-1">
                                <div className="flex justify-between items-center gap-1.5">
                                  <Label className="text-[11px] font-bold text-slate-300 leading-tight" htmlFor={field.id}>{field.label}</Label>
                                  {field.status === "completed" ? (
                                    <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] font-bold flex items-center gap-0.5 px-1 py-0 h-4">
                                      <Check className="h-2.5 w-2.5 text-emerald-400" />
                                      IA ({field.confidence}%)
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-slate-950 text-slate-500 text-[8px] px-1 py-0 h-4 border border-white/5">
                                      Pendente
                                    </Badge>
                                  )}
                                </div>
                                <Input
                                  id={field.id}
                                  value={field.value}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setBriefingFields((prev) =>
                                      prev.map((f) => (f.id === field.id ? { ...f, value: val, status: val ? "completed" : "pending" } : f))
                                    );
                                  }}
                                  placeholder={field.placeholder}
                                  className={cn(
                                    "h-8 text-xs border-white/5 bg-slate-950/60 transition-colors focus:border-indigo-500/50 text-slate-200",
                                    field.status === "completed" && "border-emerald-500/20 bg-emerald-950/5 focus:border-emerald-500/50"
                                  )}
                                />
                              </div>
                            );
                          })}
                        </div>

                        {/* Send Dossier Action */}
                        <div className="pt-4 border-t border-white/5 flex justify-end">
                          <Button
                            onClick={handleSendBriefing}
                            className="bg-emerald-600 hover:bg-emerald-500 font-extrabold text-xs text-white h-9 px-6 gap-2"
                          >
                            <FileText className="h-4 w-4" />
                            Enviar Dossiê & Disparar Handoff
                          </Button>
                        </div>

                      </CardContent>
                    </Card>
                  </div>

                </div>

                {/* Handoff Success Modal */}
                {successModalOpen && (
                  <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
                    <Card className="max-w-lg w-full border-emerald-500/20 bg-slate-900 text-white relative overflow-hidden animate-fade-in-up">
                      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-500 to-teal-400" />
                      <CardHeader className="text-center pt-8">
                        <div className="h-12 w-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400 mb-2">
                          <CheckCircle2 className="h-6 w-6" />
                        </div>
                        <CardTitle className="text-lg font-black text-white">Dossiê Comercial Qualificado!</CardTitle>
                        <CardDescription className="text-xs text-slate-400">O robô processou as informações e ativou os setores operacionais.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4 text-xs">
                        
                        <div className="p-4 bg-slate-950/50 rounded-xl border border-white/5 space-y-3">
                          <span className="font-bold text-slate-400 uppercase text-[9px] font-mono tracking-wider block">Fluxo de Handoff Disparado</span>
                          
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-300">Setor Comercial (Caio / Priscila)</span>
                              <Badge className="bg-emerald-500/15 text-emerald-400 border-none text-[8px] font-bold">Briefing Preenchido</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-300">Setor Técnico Tráfego (Humberto / Arthur)</span>
                              <Badge className="bg-emerald-500/15 text-emerald-400 border-none text-[8px] font-bold">Logins Coletados</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-300">Direção Criativa (Jheyson / Santana)</span>
                              <Badge className="bg-emerald-500/15 text-emerald-400 border-none text-[8px] font-bold">Logomarca & Perfis</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-300">Onboarding Cliente ({theme.prospectName})</span>
                              <Badge className="bg-blue-500/15 text-blue-400 border-none text-[8px] font-bold">Roadmap & Termos Enviados</Badge>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/10 p-3 flex gap-2">
                          <Zap className="h-4 w-4 text-indigo-400 shrink-0" />
                          <p className="text-[10px] text-indigo-200 leading-normal">
                            Notificações de push enviadas com sucesso no painel administrativo Vexo CRM para as contas operacionais ativas.
                          </p>
                        </div>

                        <div className="flex justify-end pt-2">
                          <Button
                            onClick={() => {
                              setSuccessModalOpen(false);
                              setActiveSlide(6);
                            }}
                            className="bg-indigo-600 hover:bg-indigo-500 font-extrabold text-white text-xs h-9 px-6 gap-2"
                          >
                            Ir para Fechamento
                            <ArrowRight className="h-4 w-4 ml-1.5" />
                          </Button>
                        </div>

                      </CardContent>
                    </Card>
                  </div>
                )}

              </div>
            )}

            {/* SLIDE 4: ONBOARDING TIMELINE */}
            {activeSlide === 4 && (
              <div className="max-w-5xl w-full space-y-6 animate-fade-in-up">
                <div className="text-center space-y-3">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-4 py-1.5 uppercase tracking-wider font-mono">
                    Slide 04 · Cronograma de Lançamento
                  </Badge>
                  <h2 className="text-4xl md:text-6xl font-black text-white">Linha do Tempo: Primeiros 30 Dias</h2>
                  <p className="text-sm md:text-base text-slate-300 max-w-3xl mx-auto">
                    Planejamento tático de implantação desde a validação inicial até a análise dos primeiros resultados de faturamento.
                  </p>
                </div>

                {/* The Timeline Steps layout */}
                <div className="grid gap-6 md:grid-cols-4 mt-6">
                  {roadmapSteps.map((step, idx) => (
                    <div key={idx} className="relative group p-6 rounded-2xl border border-white/5 bg-slate-900/15 hover:border-indigo-500/30 transition-all duration-300 flex flex-col justify-between shadow-lg">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-indigo-400 uppercase tracking-wider">{step.week}</span>
                          <Calendar className="h-4.5 w-4.5 text-slate-600 group-hover:text-indigo-400 transition-colors" />
                        </div>
                        
                        <div className="space-y-2">
                          <h4 className="font-black text-base text-white">{step.title}</h4>
                          <p className="text-xs text-slate-400 leading-normal font-medium">{step.subtitle}</p>
                        </div>

                        <div className="h-px bg-white/5" />

                        <ul className="space-y-2">
                          {step.details.map((d, i) => (
                            <li key={i} className="text-xs md:text-sm text-slate-200 flex items-start gap-1.5 leading-relaxed">
                              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0 mt-1.5" />
                              <span>{d}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SLIDE 6: SUMMARY REVIEW & DISPATCH */}
            {activeSlide === 6 && (
              <div className="max-w-5xl w-full space-y-6 animate-fade-in-up">
                <div className="text-center space-y-3">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-4 py-1.5 uppercase tracking-wider font-mono">
                    Slide 06 · Revisão Geral e Handoff Técnico
                  </Badge>
                  <h2 className="text-4xl md:text-5xl font-black text-white leading-tight">
                    Revisão Geral e Envio de Dados
                  </h2>
                  <p className="text-xs md:text-sm text-slate-400 max-w-xl mx-auto">
                    Confirme as informações coletadas no briefing e dispare o dossiê para o prospect e para os setores técnicos responsáveis.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-2 mt-4 items-stretch">
                  {/* Left Side: Briefing Summary list */}
                  <Card className="border-white/5 bg-slate-900/20 backdrop-blur-md p-6 flex flex-col justify-between max-h-[460px]">
                    <div className="space-y-3 overflow-y-auto pr-1">
                      <span className="font-bold text-slate-400 uppercase text-[9px] font-mono tracking-wider block">Resumo do Briefing Coletado</span>
                      
                      <div className="space-y-2">
                        {briefingFields.map((f) => (
                          <div key={f.id} className="p-2.5 rounded-lg bg-slate-950/40 border border-white/5 space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold text-indigo-300 uppercase font-mono tracking-wider">{f.label}</span>
                              {f.value ? (
                                <Badge className="bg-emerald-500/15 text-emerald-400 text-[8px] font-bold py-0 px-1 border-none">Preenchido</Badge>
                              ) : (
                                <Badge className="bg-rose-500/15 text-rose-400 text-[8px] font-bold py-0 px-1 border-none">Vazio</Badge>
                              )}
                            </div>
                            <p className="text-xs text-slate-300 leading-normal break-all font-sans">
                              {f.value ? f.value : <span className="text-slate-500 italic">Não fornecido</span>}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>

                  {/* Right Side: Dispatch Options */}
                  <Card className="border-white/5 bg-slate-900/20 backdrop-blur-md p-6 flex flex-col justify-between">
                    {!dispatchSuccess ? (
                      <div className="space-y-4 flex-1 flex flex-col justify-between">
                        <div className="space-y-4">
                          <div className="text-center space-y-1">
                            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Canais de Envio & Handoff</h4>
                            <p className="text-[10px] text-slate-500">Selecione para onde deseja enviar o briefing qualificado.</p>
                          </div>
                          
                          <div className="space-y-3">
                            {/* Option 1: WhatsApp Prospect */}
                            <div className="p-3 rounded-xl border border-white/5 bg-slate-950/30 space-y-2">
                              <label className="flex items-center gap-2.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sendToProspectWhatsapp}
                                  onChange={(e) => setSendToProspectWhatsapp(e.target.checked)}
                                  className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500/50 h-4 w-4"
                                />
                                <div className="text-left">
                                  <span className="text-xs font-bold text-slate-200 block">Enviar para o Prospect via WhatsApp</span>
                                  <span className="text-[9px] text-slate-500">Dossiê e cronograma no WhatsApp do cliente</span>
                                </div>
                              </label>
                              {sendToProspectWhatsapp && (
                                <div className="pl-6 pt-1 animate-fade-in-up">
                                  <Label className="text-[9px] text-slate-400 uppercase font-mono">WhatsApp do Prospect</Label>
                                    <Input
                                      value={theme.whatsappNumber}
                                      onChange={(e) => {
                                        const updated = { ...theme, whatsappNumber: e.target.value };
                                        setTheme(updated);
                                        localStorage.setItem("vexo_gd_theme", JSON.stringify(updated));
                                      }}
                                      placeholder="Ex: (11) 98888-7777"
                                      style={{ WebkitTextFillColor: 'white' }}
                                      className="h-8 text-xs border-white/5 bg-slate-950 focus:border-indigo-500/50 text-white mt-1 autofill:[box-shadow:inset_0_0_0px_1000px_#020617]"
                                    />
                                </div>
                              )}
                            </div>

                            {/* Option 2: Email Prospect */}
                            <div className="p-3 rounded-xl border border-white/5 bg-slate-950/30 space-y-2">
                              <label className="flex items-center gap-2.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sendToProspectEmail}
                                  onChange={(e) => setSendToProspectEmail(e.target.checked)}
                                  className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500/50 h-4 w-4"
                                />
                                <div className="text-left">
                                  <span className="text-xs font-bold text-slate-200 block">Enviar para o Prospect via E-mail</span>
                                  <span className="text-[9px] text-slate-500">Relatório e cronograma em PDF</span>
                                </div>
                              </label>
                              {sendToProspectEmail && (
                                <div className="pl-6 pt-1 animate-fade-in-up">
                                  <Label className="text-[9px] text-slate-400 uppercase font-mono">E-mail do Prospect</Label>
                                    <Input
                                      type="email"
                                      value={prospectEmail}
                                      onChange={(e) => setProspectEmail(e.target.value)}
                                      placeholder="Ex: cliente@empresa.com.br"
                                      style={{ WebkitTextFillColor: 'white' }}
                                      className="h-8 text-xs border-white/5 bg-slate-950 focus:border-indigo-500/50 text-white mt-1 autofill:[box-shadow:inset_0_0_0px_1000px_#020617]"
                                    />
                                </div>
                              )}
                            </div>

                            {/* Option 3: Sectors */}
                            <div className="p-3 rounded-xl border border-white/5 bg-slate-950/30 space-y-2">
                              <label className="flex items-center gap-2.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sendToSectors}
                                  onChange={(e) => setSendToSectors(e.target.checked)}
                                  className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500/50 h-4 w-4"
                                />
                                <div className="text-left">
                                  <span className="text-xs font-bold text-slate-200 block">Enviar para os Setores da Geração Digital</span>
                                  <span className="text-[9px] text-slate-500">Dispara tarefas automáticas para Tráfego, Design e Contratos</span>
                                </div>
                              </label>
                              {sendToSectors && (
                                <div className="pl-6 pt-1 space-y-2 animate-fade-in-up">
                                  <div className="space-y-1">
                                    <Label className="text-[9px] text-slate-400 uppercase font-mono">WhatsApp dos Setores (Handoff)</Label>
                                    <Input
                                      value={sectorsWhatsapp}
                                      onChange={(e) => setSectorsWhatsapp(e.target.value)}
                                      placeholder="Ex: (11) 99999-0000"
                                      style={{ WebkitTextFillColor: 'white' }}
                                      className="h-8 text-xs border-white/5 bg-slate-950 focus:border-indigo-500/50 text-white mt-1 autofill:[box-shadow:inset_0_0_0px_1000px_#020617]"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[9px] text-slate-400 uppercase font-mono">E-mail dos Setores (Handoff)</Label>
                                    <Input
                                      type="email"
                                      value={sectorsEmail}
                                      onChange={(e) => setSectorsEmail(e.target.value)}
                                      placeholder="Ex: operacoes@geracaodigital.com.br"
                                      style={{ WebkitTextFillColor: 'white' }}
                                      className="h-8 text-xs border-white/5 bg-slate-950 focus:border-indigo-500/50 text-white mt-1 autofill:[box-shadow:inset_0_0_0px_1000px_#020617]"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <Button
                          disabled={isDispatching}
                          onClick={async () => {
                            try {
                              setIsDispatching(true);
                              
                              const payload = {
                                prospectName: theme.prospectName,
                                whatsappNumber: theme.whatsappNumber,
                                agencyName: theme.agencyName,
                                themePreset: theme.themePreset,
                                briefingData: briefingFields.reduce((acc, f) => ({ ...acc, [f.id]: f.value }), {}),
                                sendToProspectWhatsapp,
                                sendToProspectEmail,
                                prospectEmail,
                                sendToSectors,
                                sectorsWhatsapp,
                                sectorsEmail
                              };

                              const token = (await user?.getIdToken()) || "";
                              const response = await fetch("/api/geracao-digital/briefing", {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                  "Authorization": `Bearer ${token}`
                                },
                                body: JSON.stringify(payload)
                              });

                              if (!response.ok) {
                                throw new Error("Erro ao salvar e disparar o briefing.");
                              }

                              const responseData = await response.json();
                              setDispatchResult(responseData);
                              setDispatchSuccess(true);
                              
                              if (sendToProspectWhatsapp) {
                                toast({
                                  title: "WhatsApp Disparado!",
                                  description: `Dossiê técnico enviado para ${theme.prospectName} (${theme.whatsappNumber}).`,
                                });
                              }
                              if (sendToProspectEmail) {
                                toast({
                                  title: "E-mail Enviado!",
                                  description: `Cópia do briefing enviada para o e-mail: ${prospectEmail}.`,
                                });
                              }
                              if (sendToSectors) {
                                toast({
                                  title: "Handoff Operacional Ativado!",
                                  description: `Os setores de tráfego, design e contratos foram notificados com sucesso no Vexo OS (WhatsApp: ${sectorsWhatsapp} | E-mail: ${sectorsEmail}).`,
                                });
                              }
                              playChime();
                            } catch (error: any) {
                              toast({
                                title: "Erro no Disparo",
                                description: error.message || "Ocorreu um erro ao disparar o briefing.",
                                variant: "destructive"
                              });
                            } finally {
                              setIsDispatching(false);
                            }
                          }}
                          className="w-full bg-emerald-600 hover:bg-emerald-500 font-extrabold text-xs text-white h-10 shadow-lg shadow-emerald-600/10 mt-4 flex items-center justify-center gap-2"
                        >
                          {isDispatching ? (
                            <>
                              <RefreshCw className="h-4 w-4 animate-spin text-white" />
                              Disparando Briefing...
                            </>
                          ) : (
                            <>
                              <Zap className="h-4 w-4 text-white" />
                              Enviar Briefing & Disparar Handoff
                            </>
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="text-center space-y-4 animate-fade-in-up py-6 flex-1 flex flex-col justify-center items-center">
                        <div className="h-14 w-14 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 animate-bounce">
                          <CheckCircle2 className="h-7 w-7" />
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-base font-black text-white">Dossiê Enviado com Sucesso!</h4>
                          <p className="text-[10px] text-slate-500">As informações foram consolidadas e enviadas para os canais ativos.</p>
                        </div>

                        <div className="p-3.5 bg-slate-950/70 border border-white/5 rounded-xl text-[9.5px] font-mono text-slate-400 text-left space-y-1.5 w-full max-w-sm">
                          <p><span className="text-indigo-400 font-bold">CLIENTE:</span> {theme.prospectName}</p>
                          {sendToProspectWhatsapp && <p><span className="text-emerald-400 font-bold">WHATSAPP:</span> {theme.whatsappNumber} ({dispatchResult?.evolutionStatus === 'sent' ? 'Enviado' : 'Não configurado/Falha'})</p>}
                          {sendToProspectEmail && <p><span className="text-blue-400 font-bold">E-MAIL:</span> {prospectEmail} ({dispatchResult?.emailStatus === 'sent' ? 'Enviado' : 'Não configurado/Falha'})</p>}
                          {sendToSectors && (
                            <>
                              <p><span className="text-purple-400 font-bold">WHATSAPP SETORES:</span> {sectorsWhatsapp} ({dispatchResult?.sectorsStatus?.includes('wpp:sent') ? 'Enviado' : 'Não configurado/Falha'})</p>
                              <p><span className="text-pink-400 font-bold">E-MAIL SETORES:</span> {sectorsEmail} ({dispatchResult?.sectorsStatus?.includes('email:sent') ? 'Enviado' : 'Não configurado/Falha'})</p>
                              <p><span className="text-indigo-400 font-bold">SETORES INTERNOS:</span> Tráfego, Design, Contratos (Handoff Ativo)</p>
                            </>
                          )}
                          <p><span className="text-slate-500 font-bold">STATUS:</span> ONBOARDING_COMPLETED_SUCCESS</p>
                        </div>

                        <div className="flex gap-2 w-full max-w-sm pt-2">
                          <Button
                            variant="outline"
                            onClick={() => setDispatchSuccess(false)}
                            className="flex-1 border-white/10 hover:bg-white/5 text-slate-300 text-xs font-bold h-9"
                          >
                            Voltar
                          </Button>
                          <Button
                            onClick={() => {
                              setIsPresenting(false);
                              setDispatchSuccess(false);
                            }}
                            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold h-9"
                          >
                            Concluir Apresentação
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            )}

          </main>

          {/* Slide Deck Bottom Navigator Footer */}
          <footer className="relative z-10 border-t border-white/5 bg-slate-950/60 backdrop-blur-md px-8 py-4 shrink-0 flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-8 text-[11px] font-bold transition-all duration-200 border-white/10 hover:bg-white/5 bg-slate-900/60",
                  activeSlide === 1 && "opacity-30 cursor-not-allowed"
                )}
                disabled={activeSlide === 1}
                onClick={() => setActiveSlide(activeSlide - 1)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Slide Anterior
              </Button>
            </div>

            {/* Slide Index dots */}
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6].map((num) => (
                <div
                  key={num}
                  onClick={() => setActiveSlide(num)}
                  className={cn(
                    "h-2 w-8 rounded-full cursor-pointer transition-all duration-300",
                    activeSlide === num ? "bg-indigo-500" : "bg-white/10 hover:bg-white/20"
                  )}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {activeSlide < 6 ? (
                <Button
                  size="sm"
                  className="h-8 bg-indigo-600 hover:bg-indigo-500 text-[11px] font-bold text-white px-5"
                  onClick={() => setActiveSlide(activeSlide + 1)}
                >
                  Próximo Slide
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-8 bg-emerald-600 hover:bg-emerald-500 text-[11px] font-bold text-white px-5"
                  onClick={() => setIsPresenting(false)}
                >
                  Encerrar Reunião
                </Button>
              )}
            </div>
          </footer>

        </div>
      )}

      {/* ─── SLIDE THEME CUSTOMIZER DRAWER (WHITE-LABEL BUILDER) ─────────────── */}
      {isCustomizerOpen && (
        <div className="fixed inset-y-0 right-0 z-50 w-80 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-white/10 shadow-2xl p-6 flex flex-col justify-between text-slate-900 dark:text-white font-sans animate-fade-in-up">
          <div className="space-y-6">
            
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-4">
              <div className="flex items-center gap-2">
                <Palette className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-sm font-black uppercase text-slate-900 dark:text-white">Personalizar Marca</h3>
              </div>
              <button 
                onClick={() => setIsCustomizerOpen(false)}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs overflow-y-auto max-h-[70vh] pr-1">
              
              {/* Agency Settings */}
              <div className="space-y-3">
                <span className="font-bold text-[9px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-mono">Agência (White-Label)</span>
                
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-slate-500 uppercase font-bold">Nome da Agência</Label>
                  <Input
                    value={theme.agencyName}
                    onChange={(e) => setTheme({ ...theme, agencyName: e.target.value })}
                    className="h-8 border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/60 focus:border-indigo-500/50 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] text-slate-500 uppercase font-bold">Subtítulo da Agência</Label>
                  <Input
                    value={theme.agencySubtitle}
                    onChange={(e) => setTheme({ ...theme, agencySubtitle: e.target.value })}
                    className="h-8 border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/60 focus:border-indigo-500/50 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Accent Color Preset Selector */}
              <div className="space-y-3">
                <span className="font-bold text-[9px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-mono">Tema de Cores</span>
                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(ACCENT_PRESETS).map(([key, value]) => (
                    <button
                      key={key}
                      onClick={() => setTheme({ ...theme, themePreset: key as any })}
                      style={{ backgroundColor: value.colorHex }}
                      className={cn(
                        "h-8 rounded-lg relative hover:scale-105 transition-transform",
                        theme.themePreset === key && "ring-2 ring-indigo-500 dark:ring-white ring-offset-2 ring-offset-white dark:ring-offset-slate-950"
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Client Settings */}
              <div className="space-y-3">
                <span className="font-bold text-[9px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-mono">Cliente Ativo</span>
                
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-slate-500 uppercase font-bold">Nome do Prospect</Label>
                  <Input
                    value={theme.prospectName}
                    onChange={(e) => setTheme({ ...theme, prospectName: e.target.value })}
                    className="h-8 border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/60 focus:border-indigo-500/50 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] text-slate-500 uppercase font-bold">Logomarca do Prospect (PNG/JPG)</Label>
                  <div className="flex items-center gap-2">
                    {theme.prospectLogoUrl ? (
                      <div className="relative h-8 w-8 rounded border border-slate-200 dark:border-white/10 overflow-hidden bg-white dark:bg-slate-950 flex items-center justify-center shrink-0">
                        <img src={theme.prospectLogoUrl} alt="Logo Prospect" className="h-full w-full object-contain" />
                        <button
                          onClick={() => setTheme({ ...theme, prospectLogoUrl: "" })}
                          className="absolute inset-0 bg-red-600/80 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-white" />
                        </button>
                      </div>
                    ) : (
                      <div className="h-8 w-8 rounded border border-dashed border-slate-200 dark:border-white/20 flex items-center justify-center text-slate-500 shrink-0">
                        <Building2 className="h-3.5 w-3.5" />
                      </div>
                    )}
                    <label className="flex-1">
                      <div className="h-8 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 rounded flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer gap-1 bg-slate-50 dark:bg-slate-950/60">
                        <Upload className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        Selecionar Imagem
                      </div>
                      <input
                        type="file"
                        accept="image/png, image/jpeg, image/jpg"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

            </div>

          </div>

          <div className="border-t border-slate-100 dark:border-white/5 pt-4 space-y-2">
            <Button
              onClick={() => handleSaveTheme(theme)}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold h-9 gap-1.5"
            >
              <Save className="h-4 w-4" />
              Aplicar e Salvar
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const defaults: CustomTheme = {
                  agencyName: "Geração Digital",
                  agencySubtitle: "Transformando Cliques em Clientes e Presença em Faturamento",
                  primaryColor: "indigo",
                  prospectName: "Cliente Parceiro",
                  prospectLogoUrl: "",
                  whatsappNumber: "(11) 98888-7777",
                  themePreset: "indigo"
                };
                handleSaveTheme(defaults);
              }}
              className="w-full border-slate-200 dark:border-white/5 bg-transparent text-xs hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400"
            >
              <Undo2 className="h-4 w-4 mr-1.5" />
              Restaurar Padrão
            </Button>
          </div>

        </div>
      )}

    </PageShell>
  );
}
