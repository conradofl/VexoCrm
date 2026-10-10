import { Link } from "react-router-dom";
import {
  Bot,
  ClipboardList,
  Rocket,
  CalendarClock,
  Zap,
  Timer,
  RefreshCw,
  GraduationCap,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  CalendarDays,
  LayoutGrid,
  Cpu,
  Volume2,
  PartyPopper,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Superpower {
  id: string;
  icon: typeof Bot;
  tag: string;
  tagColor: string;
  title: string;
  description: string;
  whyUse: string;
  route: string;
  ctaLabel: string;
}

const SUPERPOWERS: Superpower[] = [
  {
    id: "agente-247",
    icon: Bot,
    tag: "Atendimento Inteligente",
    tagColor: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400",
    title: "Agente de Atendimento 24/7",
    description:
      "Recepciona leads dia e noite usando os documentos da sua empresa. Atende no WhatsApp sem fila e sem espera.",
    whyUse:
      "Atendimento imediato converte até 7x mais antes do lead esfriar no WhatsApp.",
    route: "/crm/agente",
    ctaLabel: "Configurar Agente",
  },
  {
    id: "extrator-ficha",
    icon: ClipboardList,
    tag: "Pilar 4 · CRM Automático",
    tagColor: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
    title: "Agente Extrator de Ficha",
    description:
      "A IA lê as conversas e anota orçamento, interesse e urgência sozinho no CRM. Zero digitação humana.",
    whyUse:
      "Informação estruturada no banco de dados para sua equipe fechar negócios mais rápido.",
    route: "/crm/banco-de-dados",
    ctaLabel: "Ver Fichas & Leads",
  },
  {
    id: "disparo-massa",
    icon: Rocket,
    tag: "Prospecção em Escala",
    tagColor: "bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400",
    title: "Agente de Disparo em Massa",
    description:
      "Dispare com ritmo humano anti-ban para milhares de contatos da sua base sem risco de bloqueio.",
    whyUse:
      "Escale suas vendas ativas com cadência segura e controle total de entrega pela Meta.",
    route: "/crm/planilhas",
    ctaLabel: "Abrir Disparos",
  },
  {
    id: "campanhas-recorrentes",
    icon: CalendarClock,
    tag: "Pilar 3 · Recorrência",
    tagColor: "bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400",
    title: "Campanhas Recorrentes",
    description:
      "Programe mensagens que rodam todo mês ou toda semana no piloto automático para manter sua marca presente.",
    whyUse:
      "Nutre seus clientes automaticamente com promoções, lembretes e novidades periódicas.",
    route: "/crm/planilhas?tab=campanhas",
    ctaLabel: "Ver Campanhas",
  },
  {
    id: "smart-links",
    icon: Zap,
    tag: "Rastreamento em Tempo Real",
    tagColor: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400",
    title: "Vexo Smart Links (Cliques)",
    description:
      "Receba um alerta no WhatsApp do vendedor no segundo exato em que o lead clicar na proposta ou link enviado.",
    whyUse:
      "Aborde o cliente na hora mais quente da negociação para maximizar a taxa de fechamento.",
    route: "/crm/planilhas",
    ctaLabel: "Criar Smart Links",
  },
  {
    id: "lead-parado",
    icon: Timer,
    tag: "Pilar 1 · SLA & Resgate",
    tagColor: "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
    title: "Aviso de Lead Parado (SLA)",
    description:
      "Veja quem ficou mais de 3 dias sem resposta e nunca perca vendas por esquecimento ou desatenção.",
    whyUse:
      "Resgata negociações esquecidas que já estavam avançadas mas esfriaram no funil.",
    route: "/crm/banco-de-dados?stalled=3",
    ctaLabel: "Ver Leads Parados",
  },
  {
    id: "reativacao-automatica",
    icon: RefreshCw,
    tag: "Pilar 2 · Reciclagem de Base",
    tagColor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400",
    title: "Reativação Automática",
    description:
      "Resgate contatos antigos colocando-os sozinhos em cadência no WhatsApp para gerar novas oportunidades.",
    whyUse:
      "Transforma base fria em novas reuniões e vendas sem precisar investir mais em anúncios.",
    route: "/crm/followup",
    ctaLabel: "Ir para Reativação",
  },
  {
    id: "vexo-academy",
    icon: GraduationCap,
    tag: "Treinamento & Scripts",
    tagColor: "bg-teal-100 text-teal-800 dark:bg-teal-500/10 dark:text-teal-400",
    title: "Vexo Academy",
    description:
      "33 estratégias e mensagens prontas para 11 segmentos comerciais aplicáveis com 1 clique.",
    whyUse:
      "Copie e cole scripts validados de alta conversão para começar faturando imediatamente.",
    route: "/crm/onboarding",
    ctaLabel: "Acessar Academy",
  },
  {
    id: "calendario-unificado",
    icon: CalendarDays,
    tag: "Operação & Disparos",
    tagColor: "bg-pink-100 text-pink-700 dark:bg-pink-500/10 dark:text-pink-400",
    title: "Calendário Comercial Unificado",
    description:
      "Visão mensal consolidada de campanhas, disparos agendados e follow-ups com controle de fuso horário.",
    whyUse:
      "Tenha previsibilidade operacional completa de todos os envios programados para sua base de leads.",
    route: "/crm/calendario",
    ctaLabel: "Ver Calendário",
  },
  {
    id: "kanban-metricas",
    icon: LayoutGrid,
    tag: "Gestão Comercial",
    tagColor: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400",
    title: "Pipeline Visual Kanban & Métricas",
    description:
      "Gestão de oportunidades em 5 colunas canônicas com cálculo de volume financeiro e filtro de inatividade.",
    whyUse:
      "Visualize e movimente oportunidades em tempo real para maximizar a conversão de vendas.",
    route: "/crm/banco-de-dados",
    ctaLabel: "Abrir Funil Kanban",
  },
  {
    id: "transicao-funil-ia",
    icon: Cpu,
    tag: "Automação com IA",
    tagColor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400",
    title: "Motor de Automações & Transição de Funil por IA",
    description:
      "Classificação semântica automática de leads e cancelamento seguro de follow-up após ganho ou perda.",
    whyUse:
      "A IA atualiza o estágio do lead e interrompe réguas automaticamente quando o cliente compra ou desiste.",
    route: "/crm/banco-de-dados",
    ctaLabel: "Ver Automações",
  },
  {
    id: "voz-ia-multimodal",
    icon: Volume2,
    tag: "Voz & Multimodal",
    tagColor: "bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400",
    title: "Voz da IA & Mensageria Multimodal",
    description:
      "Áudios ultra-realistas via OpenAI TTS (6 vozes) com modo espelho inteligente e transcrição via Groq Whisper.",
    whyUse:
      "Humaniza o atendimento no WhatsApp com respostas de voz naturais quando o cliente envia áudios.",
    route: "/crm/agente",
    ctaLabel: "Configurar Voz da IA",
  },
  {
    id: "eventos-reguas",
    icon: PartyPopper,
    tag: "Eventos & Réguas",
    tagColor: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/10 dark:text-fuchsia-400",
    title: "Módulo de Eventos & Réguas Temporais",
    description:
      "Gestão de lotes/ingressos e réguas automáticas em contagem regressiva D-7, D-3, D-1, VIP e D+1.",
    whyUse:
      "Automatiza a pré-venda com escassez e o pós-evento para lotar festas, shows e congressos corporativos.",
    route: "/crm/livpub?tab=eventos",
    ctaLabel: "Gerenciar Eventos",
  },
];

export function SuperpowersMapTab() {
  return (
    <div className="space-y-6">
      {/* Intro Banner */}
      <div className="rounded-xl border border-slate-200/80 bg-gradient-to-r from-white via-indigo-50/20 to-slate-50 dark:from-slate-900/60 dark:via-background dark:to-indigo-950/20 dark:border-slate-800 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:border-indigo-500/20 dark:text-indigo-400 text-[11px] font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              O Que o Vexo OS Faz por Você
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              🌟 Mapa de Superpoderes do Vexo OS
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-3xl leading-relaxed">
              Explore as 13 frentes de inteligência e automação da plataforma. Cada recurso foi desenhado para eliminar trabalho braçal, blindar sua operação contra esquecimentos e acelerar seu faturamento no WhatsApp.
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              13 Superpoderes Disponíveis
            </div>
          </div>
        </div>
      </div>

      {/* Grid de Superpoderes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {SUPERPOWERS.map((power) => {
          const Icon = power.icon;
          return (
            <div
              key={power.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs hover:shadow-md hover:border-indigo-300 dark:bg-card dark:border-border/80 dark:hover:border-indigo-500/40 transition-all duration-200 group"
            >
              <div className="space-y-3.5">
                {/* Header do Card */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-50 border border-slate-200/80 text-indigo-600 dark:bg-slate-800/80 dark:border-slate-700 dark:text-indigo-400 group-hover:scale-105 transition-transform">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-semibold px-2 py-0.5 rounded-md",
                      power.tagColor
                    )}
                  >
                    {power.tag}
                  </span>
                </div>

                {/* Título & Descrição */}
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {power.title}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    {power.description}
                  </p>
                </div>

                {/* Caixa Didática: Por que usar */}
                <div className="rounded-lg bg-slate-50/80 border border-slate-200/70 p-2.5 dark:bg-slate-900/40 dark:border-slate-800/80 text-[11px] space-y-1">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                    💡 Por que usar:
                  </span>
                  <p className="text-slate-600 dark:text-slate-400 leading-snug">
                    {power.whyUse}
                  </p>
                </div>
              </div>

              {/* Botão de Atalho */}
              <div className="pt-4 mt-4 border-t border-slate-100 dark:border-border/50">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="w-full text-xs font-medium justify-between border-slate-200 hover:bg-slate-50 hover:border-indigo-300 dark:border-border dark:hover:bg-muted"
                >
                  <Link to={power.route}>
                    <span>{power.ctaLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
