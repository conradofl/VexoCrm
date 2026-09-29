// frontend/src/pages/LandingPage.tsx
//
// Landing Page Institucional do Vexo OS (Item 13)
// Foco: Inteligência Comercial, Agentes de WhatsApp, Ativação de Base, Funil Protegido e Contratos.

import { useAuth } from "@/contexts/AuthContext";
import { getCrmLoginUrl } from "@/lib/domainRouting";
import {
  ArrowRight,
  Bot,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  FileSignature,
  FileText,
  Filter,
  Layers,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";

const DEMO_WHATSAPP_URL =
  "https://wa.me/5534999996397?text=Ol%C3%A1!%20Gostaria%20de%20agendar%20uma%20demonstra%C3%A7%C3%A3o%20do%20Vexo%20OS%20para%20minha%20empresa.";

const METRICS = [
  {
    value: "24/7",
    label: "Resposta Ativa",
    detail: "Atendimento imediato sem janela morta ou atraso no primeiro contato.",
  },
  {
    value: "14 Dias",
    label: "Recuperação de Base",
    detail: "Janela comprovada de reativação e retorno pós-campanhas de follow-up.",
  },
  {
    value: "Zero Furos",
    label: "Contratos & Finanças",
    detail: "Cláusulas modulares e cronogramas de pagamento fechados na hora.",
  },
];

const FOUR_PILLARS = [
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
    tone: "from-[#1A5CFF]/18 via-[#1A5CFF]/6 to-transparent",
  },
  {
    number: "02",
    title: "Ativação de Base & Recuperação",
    badge: "Contatos em 3 Faixas",
    description:
      "Reative contatos dormentes e conduza conversas com ritmo constante sem depender de disparos genéricos.",
    items: [
      "Classificação em 3 faixas comerciais: Nunca Abordados, Em Conversa e Em Negociação",
      "Cadências automáticas de follow-up guiadas por âncoras reais de calendário (aniversário, retorno, férias)",
      "Disparos seguros com alternância de chips e controle anti-bloqueio",
    ],
    icon: RefreshCw,
    tone: "from-[#1A5CFF]/14 via-[#2E6FFF]/6 to-transparent",
  },
  {
    number: "03",
    title: "Funil com Inviolabilidade Manual",
    badge: "Motor Semântico Comercial",
    description:
      "A IA acompanha a conversa e sugere a evolução do lead, mas as decisões do operador humano são intocáveis.",
    items: [
      "Identificação automática de intenções de compra, orçamento ou motivos de perda",
      "Trava de segurança: decisões manuais do vendedor jamais são sobrescritas por automações",
      "Vocabulário e etapas 100% customizáveis por segmento de mercado",
    ],
    icon: Filter,
    tone: "from-white/12 via-white/4 to-transparent",
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
    tone: "from-[#1A5CFF]/16 via-[#1A5CFF]/5 to-transparent",
  },
];

const METHODOLOGY = [
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
      "Conectamos os chips de WhatsApp, acionamos disparos segmentados e acompanhamos o funil em tempo real com handoff humano.",
  },
];

const PLANS = [
  {
    name: "Operação Essencial",
    price: "Sob Consulta",
    badge: "Começo Seguro",
    description: "Ideal para empresas que querem profissionalizar o atendimento no WhatsApp e centralizar o funil.",
    features: [
      "Até 2 chips de WhatsApp integrados",
      "Agente de qualificação 24/7",
      "Funil comercial com trava manual",
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
      "Múltiplas instâncias de WhatsApp com rodízio",
      "Agentes treinados com RAG documental",
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
      "Isolamento multi-tenant customizável",
      "Modelos contratuais complexos e personalizados",
      "SLA dedicado de suporte e engenharia",
      "Integrações de API e Webhooks dedicados",
    ],
    featured: false,
  },
];

const FOOTER_LINKS = [
  { label: "Solução", href: "#solucao" },
  { label: "Os 4 Pilares", href: "#pilares" },
  { label: "Metodologia", href: "#metodologia" },
  { label: "Planos", href: "#planos" },
];

function ActionLink({
  href,
  className,
  children,
  target,
  rel,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  target?: string;
  rel?: string;
}) {
  if (href.startsWith("http")) {
    return (
      <a href={href} className={className} target={target} rel={rel}>
        {children}
      </a>
    );
  }
  return (
    <Link to={href} className={className}>
      {children}
    </Link>
  );
}

export default function LandingPage() {
  const { isAuthenticated, isClientUser, defaultRoute } = useAuth();

  const crmLoginUrl = getCrmLoginUrl();
  const crmHref = isAuthenticated ? defaultRoute : crmLoginUrl;
  const primaryLabel = isAuthenticated
    ? isClientUser
      ? "Abrir portal"
      : "Abrir CRM"
    : "Acessar Plataforma";

  return (
    <>
      <main className="relative min-h-screen overflow-hidden bg-[#030308] text-white">
        {/* Glow de Fundo e Gradientes */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(26,92,255,0.16),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(26,92,255,0.09),transparent_25%),linear-gradient(180deg,#030308_0%,#050818_38%,#030308_100%)]" />
          <div className="absolute left-[-8rem] top-24 h-72 w-72 rounded-full bg-[#1A5CFF]/20 blur-[140px]" />
          <div className="absolute right-[-10rem] top-12 h-96 w-96 rounded-full bg-[#1A5CFF]/12 blur-[160px]" />
          <div className="absolute bottom-0 left-1/2 h-72 w-[38rem] -translate-x-1/2 rounded-full bg-[#1A5CFF]/8 blur-[180px]" />
        </div>

        <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-6 sm:px-8 lg:px-10">
          {/* Header Superior com Marca e Acesso ao CRM */}
          <header className="sticky top-0 z-30 mb-8 animate-fade-in-up">
            <nav className="glass-panel mx-auto flex max-w-6xl items-center justify-between rounded-full px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#1A5CFF]/30 bg-[#1A5CFF]/15 shadow-[0_0_30px_rgba(26,92,255,0.25)]">
                  <span className="text-lg font-bold text-[#1A5CFF]">V</span>
                </div>
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.28em] text-white/90">VEXO OS</p>
                  <p className="text-[11px] font-medium text-[#3A75FF]">Inteligência Comercial & WhatsApp</p>
                </div>
              </div>

              <div className="hidden items-center gap-8 text-sm font-medium text-white/60 md:flex">
                <a href="#solucao" className="shiny-sm rounded-full px-3 py-1.5 transition-colors hover:text-white">
                  Solução
                </a>
                <a href="#pilares" className="shiny-sm rounded-full px-3 py-1.5 transition-colors hover:text-white">
                  Os 4 Pilares
                </a>
                <a href="#metodologia" className="shiny-sm rounded-full px-3 py-1.5 transition-colors hover:text-white">
                  Metodologia
                </a>
                <a href="#planos" className="shiny-sm rounded-full px-3 py-1.5 transition-colors hover:text-white">
                  Planos
                </a>
              </div>

              <ActionLink
                href={crmHref}
                className="shiny-cta inline-flex items-center gap-2 rounded-full bg-[#1A5CFF] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:scale-[1.02] hover:bg-[#2E6FFF]"
              >
                <span>{primaryLabel}</span>
                <ArrowRight className="h-4 w-4" />
              </ActionLink>
            </nav>
          </header>

          {/* Seção Hero: Apresentação de Impacto */}
          <section className="grid flex-1 items-center gap-12 pb-20 pt-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10 lg:pt-10">
            <div className="max-w-3xl animate-fade-in-up">
              <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-[#1A5CFF]/30 bg-[#1A5CFF]/10 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[#3A75FF]">
                <Sparkles className="h-3.5 w-3.5 text-[#3A75FF]" />
                Plataforma All-in-One de Operação Comercial
              </div>

              <h1 className="text-4xl font-extrabold leading-[1.05] tracking-[-0.05em] text-white sm:text-5xl lg:text-[4.5rem]">
                Transforme conversas de WhatsApp em vendas fechadas e contratos assinados.
              </h1>

              <p className="mt-6 max-w-2xl text-base font-light leading-relaxed text-white/60 sm:text-lg sm:leading-8">
                O Vexo OS integra agentes inteligentes de atendimento 24/7, ativação contínua da sua base de contatos,
                funil de vendas protegido e geração instantânea de contratos comerciais.
              </p>

              <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
                <ActionLink
                  href={crmHref}
                  className="shiny-cta group inline-flex items-center justify-center gap-2 rounded-full bg-[#1A5CFF] px-8 py-4 text-sm font-bold uppercase tracking-[0.16em] text-white shadow-[0_0_50px_rgba(26,92,255,0.35)] transition-all hover:scale-[1.02] hover:bg-[#2E6FFF]"
                >
                  <span>{primaryLabel}</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </ActionLink>

                <a
                  href={DEMO_WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shiny-cta inline-flex items-center justify-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-8 py-4 text-sm font-semibold uppercase tracking-[0.16em] text-emerald-300 transition-all hover:bg-emerald-500/20"
                >
                  <MessageSquare className="h-4 w-4 text-emerald-400" />
                  Agendar Demonstração
                </a>
              </div>

              {/* Cards de Métricas Rápidas */}
              <div className="mt-12 grid gap-3 sm:grid-cols-3">
                {METRICS.map((metric) => (
                  <div key={metric.label} className="glass-panel rounded-2xl border border-white/6 p-4">
                    <p className="text-2xl font-extrabold tracking-[-0.04em] text-[#1A5CFF]">{metric.value}</p>
                    <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white/80">
                      {metric.label}
                    </p>
                    <p className="mt-2 text-xs font-light leading-5 text-white/50">{metric.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Painel Visual Dinâmico / Preview do Sistema */}
            <div className="relative animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
              <div className="absolute inset-0 rounded-[2.5rem] bg-gradient-to-b from-[#1A5CFF]/20 to-transparent blur-3xl" />
              <div className="glass-panel relative overflow-hidden rounded-[2.5rem] border border-white/10 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.6)] sm:p-7">
                <div className="mb-6 flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#3A75FF]">
                      MOTOR COMERCIAL ATIVO
                    </p>
                    <h2 className="mt-1 text-xl font-bold tracking-tight">Operação Comercial Vexo OS</h2>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1A5CFF]/30 bg-[#1A5CFF]/15">
                    <Cpu className="h-5 w-5 text-[#1A5CFF]" />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                          Agente IA Online
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-white/50">Tempo de resposta: &lt; 3s</span>
                    </div>
                    <p className="mt-2 text-xs text-white/70">
                      &quot;Olá Roberto! Analisei sua solicitação e nossa proposta comercial já está pronta com as cláusulas que alinhamos.&quot;
                    </p>
                  </div>

                  {/* Trilha do Funil com Inviolabilidade */}
                  <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between text-xs mb-3">
                      <span className="font-mono text-[10px] text-white/40 uppercase tracking-wider">
                        Funil de Conversão
                      </span>
                      <span className="rounded-full bg-[#1A5CFF]/15 text-[#3A75FF] px-2 py-0.5 text-[10px] font-semibold">
                        Trava Manual Ativa
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5 text-center text-[10px]">
                      <div className="rounded-lg bg-emerald-600/30 border border-emerald-500/40 p-2 text-emerald-200 font-semibold">
                        ✓ 1. Contato
                      </div>
                      <div className="rounded-lg bg-emerald-600/30 border border-emerald-500/40 p-2 text-emerald-200 font-semibold">
                        ✓ 2. Dúvida
                      </div>
                      <div className="rounded-lg bg-amber-500/20 border border-amber-500/40 p-2 text-amber-200 font-bold">
                        3. Proposta
                      </div>
                      <div className="rounded-lg bg-white/5 border border-white/10 p-2 text-white/40">
                        4. Fechado
                      </div>
                    </div>
                  </div>

                  {/* Resumo da Minuta Contratual */}
                  <div className="rounded-2xl border border-[#1A5CFF]/20 bg-[#1A5CFF]/5 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1A5CFF]/20 text-[#3A75FF]">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white">Contrato Gerado em 1 Clique</p>
                        <p className="text-[11px] text-white/50">Cláusulas modulares + Cronograma quinzenal</p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-emerald-400">Pronto para Assinatura</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Seção Solução */}
          <section id="solucao" className="border-t border-white/5 py-20">
            <div className="mb-12 max-w-2xl">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#3A75FF]">SOLUÇÃO INTEGRADA</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Uma camada única para capturar, qualificar e fechar contratos.
              </h2>
              <p className="mt-4 text-base font-light text-white/60">
                Sem ferramentas fragmentadas. Da primeira mensagem enviada no WhatsApp até o contrato assinado, sua equipe
                opera com contexto completo e zero retrabalho.
              </p>
            </div>
          </section>

          {/* Seção Os 4 Pilares do Vexo OS */}
          <section id="pilares" className="pb-24">
            <div className="mb-12 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#3A75FF]">OS 4 PILARES</p>
                <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">
                  A estrutura que sustenta sua máquina comercial.
                </h2>
              </div>
              <p className="max-w-md text-sm font-light text-white/50">
                Projetado especificamente para operações que vendem serviços de alto valor ou produtos complexos via WhatsApp.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {FOUR_PILLARS.map((pillar) => (
                <div
                  key={pillar.title}
                  className="group relative overflow-hidden rounded-[2rem] border border-white/6 bg-[#040612] p-7 transition-all duration-300 hover:border-[#1A5CFF]/30 hover:shadow-[0_12px_40px_rgba(26,92,255,0.1)]"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${pillar.tone} opacity-100 transition-opacity`} />
                  <div className="relative flex h-full flex-col">
                    <div className="mb-6 flex items-center justify-between">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#1A5CFF]/20 bg-[#1A5CFF]/10 text-[#1A5CFF]">
                        <pillar.icon className="h-6 w-6" />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-white/30">{pillar.number}</span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/70">
                          {pillar.badge}
                        </span>
                      </div>
                    </div>

                    <h3 className="text-2xl font-bold tracking-tight text-white">{pillar.title}</h3>
                    <p className="mt-3 text-sm font-light leading-relaxed text-white/60">{pillar.description}</p>

                    <div className="mt-6 space-y-2.5 pt-4 border-t border-white/6">
                      {pillar.items.map((item) => (
                        <div key={item} className="flex items-start gap-2.5 text-xs text-white/75">
                          <Check className="h-4 w-4 shrink-0 text-[#1A5CFF] mt-0.5" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Seção Metodologia & Implantação */}
          <section id="metodologia" className="border-t border-white/5 py-24">
            <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#3A75FF]">MÉTODO VEXO</p>
                <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">
                  Diagnóstico, implantação e aceleração comercial.
                </h2>
                <p className="mt-4 text-base font-light text-white/60 leading-relaxed">
                  Não entregamos automação sobre processo quebrado. Primeiro organizamos a rotina e as regras comerciais.
                  Em seguida, conectamos os agentes e ativamos o ritmo operacional.
                </p>

                <div className="mt-8 space-y-4">
                  {METHODOLOGY.map((item) => (
                    <div key={item.step} className="glass-panel rounded-2xl border border-white/6 p-5">
                      <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#1A5CFF]/20 bg-[#1A5CFF]/10 font-mono text-sm font-bold text-[#3A75FF]">
                          {item.step}
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-white">{item.title}</h3>
                          <p className="mt-1 text-sm font-light text-white/60 leading-relaxed">{item.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Card Destaque de Governança */}
              <div className="glass-panel relative rounded-[2.5rem] border border-[#1A5CFF]/15 bg-[linear-gradient(180deg,rgba(26,92,255,0.12),rgba(255,255,255,0.02),rgba(3,3,8,0.8))] p-7 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1A5CFF]/20 text-[#3A75FF] font-bold text-xl">
                      V
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-white">Governança Comercial Segura</h4>
                      <p className="text-xs text-white/50">IA com supervisão humana completa</p>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2">
                    {[
                      "Sem promessas indevidas: o agente respeita estritamente o manual da sua empresa",
                      "O vendedor mantém o controle total: alteração manual de estágio nunca é desfeita pela IA",
                      "Auditoria completa de conversas com geração de dossiês comerciais",
                      "Cláusulas contratuais padronizadas com proteção jurídica em PDF",
                    ].map((bullet) => (
                      <div key={bullet} className="flex items-start gap-2.5 text-xs text-white/70">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-4 border-t border-white/6">
                    <a
                      href={DEMO_WHATSAPP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 py-3 text-xs font-bold uppercase tracking-wider text-white transition-colors"
                    >
                      <MessageSquare className="h-4 w-4" />
                      Falar com Especialista
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Seção Planos & Estruturas de Contratação */}
          <section id="planos" className="border-t border-white/5 py-24">
            <div className="mb-12 max-w-2xl">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#3A75FF]">PLANOS & ESTRUTURAS</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Escolha o nível de aceleração para a sua empresa.
              </h2>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {PLANS.map((plan) => (
                <div
                  key={plan.name}
                  className={`relative flex flex-col justify-between rounded-[2rem] border p-7 transition-all ${
                    plan.featured
                      ? "border-[#1A5CFF]/40 bg-[#060A2A] shadow-[0_0_70px_rgba(26,92,255,0.18)]"
                      : "border-white/6 bg-[#040612] hover:border-white/15"
                  }`}
                >
                  {plan.featured && (
                    <div className="absolute -top-3 left-6 rounded-full bg-[#1A5CFF] px-3.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white shadow-md">
                      Mais Popular
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-white/40">
                        {plan.badge}
                      </p>
                    </div>
                    <h3 className="mt-2 text-2xl font-bold text-white">{plan.name}</h3>
                    <p className="mt-2 text-xs font-light text-white/50">{plan.description}</p>
                    <p className="mt-4 text-xl font-extrabold text-[#3A75FF]">{plan.price}</p>

                    <div className="mt-6 space-y-3 pt-6 border-t border-white/6">
                      {plan.features.map((feature) => (
                        <div key={feature} className="flex items-start gap-2.5 text-xs text-white/70">
                          <Check className="h-4 w-4 shrink-0 text-[#1A5CFF] mt-0.5" />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-8 pt-4">
                    <ActionLink
                      href={crmHref}
                      className={`inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-all ${
                        plan.featured
                          ? "bg-[#1A5CFF] text-white hover:bg-[#2E6FFF]"
                          : "bg-white/5 text-white hover:bg-white/10"
                      }`}
                    >
                      Acessar Plataforma
                      <ArrowRight className="h-3.5 w-3.5" />
                    </ActionLink>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* CTA Final */}
          <section className="pb-16">
            <div className="overflow-hidden rounded-[2.5rem] border border-[#1A5CFF]/20 bg-[linear-gradient(135deg,rgba(26,92,255,0.18),rgba(46,111,255,0.06),rgba(0,0,0,0.5))] p-[1px]">
              <div className="rounded-[calc(2.5rem-1px)] bg-[#030308] px-6 py-12 text-center sm:px-10 sm:py-16">
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#3A75FF]">ACELERE SUA OPERAÇÃO</p>
                <h2 className="mx-auto mt-4 max-w-3xl text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
                  Pronto para fechar mais vendas pelo WhatsApp com menos ruído?
                </h2>
                <p className="mx-auto mt-5 max-w-xl text-sm font-light text-white/60 leading-relaxed">
                  Entre no Vexo OS e revolucione o relacionamento, qualificação e emissão de contratos comerciais.
                </p>
                <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
                  <ActionLink
                    href={crmHref}
                    className="shiny-cta inline-flex items-center gap-2 rounded-full bg-[#1A5CFF] px-8 py-4 text-sm font-bold uppercase tracking-wider text-white shadow-[0_0_50px_rgba(26,92,255,0.3)] hover:bg-[#2E6FFF]"
                  >
                    <span>{primaryLabel}</span>
                    <ArrowRight className="h-4 w-4" />
                  </ActionLink>
                  <a
                    href={DEMO_WHATSAPP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-8 py-4 text-sm font-semibold uppercase tracking-wider text-white/80 hover:bg-white/10"
                  >
                    <MessageSquare className="h-4 w-4 text-emerald-400" />
                    Agendar Demonstração
                  </a>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Rodapé Refinado */}
      <footer className="border-t border-white/6 bg-[#030308] px-6 py-10 text-white sm:px-8 lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#1A5CFF]/30 bg-[#1A5CFF]/15 text-[#1A5CFF] font-bold">
              V
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/80">Vexo OS</p>
              <p className="text-[10px] text-white/40">Plataforma de Inteligência Comercial e Vendas</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-white/50">
            {FOOTER_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="hover:text-white transition-colors">
                {link.label}
              </a>
            ))}
            <ActionLink href={crmHref} className="text-[#3A75FF] hover:underline font-semibold">
              {primaryLabel}
            </ActionLink>
          </div>

          <p className="text-[11px] text-white/40">
            © {new Date().getFullYear()} Vexo OS. Todos os direitos reservados.
          </p>
        </div>
      </footer>
    </>
  );
}
