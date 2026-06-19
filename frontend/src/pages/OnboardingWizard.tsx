import { useState, useMemo } from "react";
import {
  BookOpen,
  ListChecks,
  ArrowRight,
  CheckCircle2,
  Check,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ChecklistItem {
  id: string;
  title: string;
  desc: string;
  howTo: string[];
  benefit: string;
  screenPath: string;
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    id: "chips",
    title: "1. Conectar seus Chips de WhatsApp",
    desc: "Vincule os números que farão as abordagens frias ou o suporte de qualificação automática.",
    howTo: [
      "Acesse a aba 'Chips WhatsApp' no menu (Modo Disparos).",
      "Clique no botão 'Adicionar Instância' e dê um nome claro (ex: 'vendas-1').",
      "Abra o WhatsApp no seu aparelho celular físico, vá em 'Aparelhos Conectados' e escaneie o QR Code gerado na tela.",
      "Mantenha o celular conectado à internet para garantir a estabilidade do sinal."
    ],
    benefit: "Permite enviar mensagens em escala rotacionando entre vários chips. Isso dilui o volume de disparos e blinda seus números contra bloqueios de spam do WhatsApp.",
    screenPath: "/crm/conexoes"
  },
  {
    id: "chatbot",
    title: "2. Personalizar as Regras do Chatbot",
    desc: "Treine a IA com as particularidades da sua oferta, tabelas de preço e contornos de objeções.",
    howTo: [
      "Vá em 'Chatbot Settings' no menu (Modo Vendas).",
      "Na aba 'Prompt Editor', descreva a sua empresa, seu produto e o objetivo principal do bot (ex: 'conseguir o agendamento de uma consultoria').",
      "Escreva as respostas de contorno para as maiores objeções de seus clientes (como preço, parcelamento ou equipe).",
      "Use a caixa de testes na própria tela para simular perguntas e validar se a IA responde de acordo."
    ],
    benefit: "Garante um atendimento qualificado e humanizado 24 horas por dia, 7 dias por semana. Nenhum lead esfria ou fica sem resposta em finais de semana ou feriados.",
    screenPath: "/crm/chatbot-settings"
  },
  {
    id: "imports",
    title: "3. Importar a Planilha de Leads",
    desc: "Envie contatos inativos, listas antigas de leads ou cadastros do CRM direto para o motor de disparos.",
    howTo: [
      "No Modo Disparos, acesse a aba 'Envios por Planilha'.",
      "Clique em 'Nova Campanha' e selecione o arquivo Excel (XLSX) ou CSV do seu computador.",
      "O sistema detectará e descartará linhas de cabeçalho duplicadas automaticamente.",
      "Defina o texto do template (ex: 'Olá {{nome}}!') e a velocidade de envio para evitar picos suspeitos de rede."
    ],
    benefit: "Ativa bases de contatos frios ou esquecidos em menos de 5 minutos, resgatando leads inativos que seriam jogados fora sem esforço manual da equipe.",
    screenPath: "/crm/planilhas"
  },
  {
    id: "followup",
    title: "4. Ativar Cadência de Follow-ups",
    desc: "Garanta que nenhum lead interessado morra por falta de acompanhamento ativo do comercial.",
    howTo: [
      "Vá em 'Follow-up' no menu lateral (Modo Vendas).",
      "Defina a cadência de mensagens: Lembrete 1 dia antes da reunião, e mensagem de cobrança caso o cliente pare de responder.",
      "Estruture templates curtos e envolvendo variáveis dinâmicas (ex: '{{lead_name}}, tudo pronto para nossa conversa amanhã?')."
    ],
    benefit: "Reduz a taxa de faltas (no-show) em reuniões agendadas em até 70% e recupera clientes que 'sumiram' após receber o preço ou proposta comercial.",
    screenPath: "/crm/followup"
  },
  {
    id: "reports",
    title: "5. Auditar Resultados nos Relatórios",
    desc: "Acompanhe de forma analítica o desempenho de conversões, taxa de entrega e feedbacks de objeções.",
    howTo: [
      "Clique na aba 'Relatórios' (Modo Disparos).",
      "Avalie os indicadores visuais (Sucessos, Falhas de rede, Entrega global).",
      "Use os filtros para baixar apenas os leads que falharam no envio e crie uma nova campanha de reativação imediata."
    ],
    benefit: "Fornece controle absoluto da qualidade da sua base. Você passa a ter dados reais do motivo de os clientes não estarem respondendo ou de estarem recusando a proposta.",
    screenPath: "/crm/relatorios"
  }
];

export default function OnboardingWizard() {
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    const saved = localStorage.getItem("vexo_onboarding_completed");
    return saved ? JSON.parse(saved) : {};
  });
  
  const [expandedChecklistItem, setExpandedChecklistItem] = useState<string | null>("chips");

  const toggleStepCompleted = (id: string) => {
    const updated = { ...completedSteps, [id]: !completedSteps[id] };
    setCompletedSteps(updated);
    localStorage.setItem("vexo_onboarding_completed", JSON.stringify(updated));
  };

  const completedPercentage = useMemo(() => {
    const total = CHECKLIST_ITEMS.length;
    const completed = Object.values(completedSteps).filter(Boolean).length;
    return Math.round((completed / total) * 100);
  }, [completedSteps]);

  return (
    <PageShell
      title="Treinamento & Onboarding Vexo"
      subtitle="Siga o checklist de 5 passos para configurar a sua operação e iniciar a qualificação automática de leads."
      icon={BookOpen}
    >
      <div className="space-y-6 animate-fade-in-up">
        {/* Card Progresso */}
        <Card className="border-slate-200/80 bg-white/80 dark:border-white/10 dark:bg-slate-900/40">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold">Progresso das Configurações</CardTitle>
              <CardDescription>
                Marque cada etapa como concluída após realizar as configurações correspondentes nas telas do sistema.
              </CardDescription>
            </div>
            <Badge className="bg-indigo-600 text-white py-1 px-2.5 text-xs font-black shadow-md">
              {completedPercentage}% Concluído
            </Badge>
          </CardHeader>
          <CardContent>
            {/* Barra de Progresso Visual */}
            <div className="h-2 w-full bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-all duration-300"
                style={{ width: `${completedPercentage}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Lista de Passos de Configuração */}
        <div className="space-y-3">
          {CHECKLIST_ITEMS.map((item) => {
            const isCompleted = !!completedSteps[item.id];
            const isExpanded = expandedChecklistItem === item.id;

            return (
              <div
                key={item.id}
                className={cn(
                  "rounded-2xl border transition-smooth overflow-hidden bg-white/80 dark:bg-slate-900/40",
                  isExpanded
                    ? "border-indigo-200 dark:border-indigo-950"
                    : "border-slate-200/80 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10"
                )}
              >
                {/* Cabeçalho da Linha */}
                <div
                  onClick={() => setExpandedChecklistItem(isExpanded ? null : item.id)}
                  className="flex items-center justify-between p-4 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStepCompleted(item.id);
                      }}
                      className={cn(
                        "h-5.5 w-5.5 rounded-full border-2 flex items-center justify-center transition-smooth",
                        isCompleted
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : "border-slate-300 hover:border-indigo-500 dark:border-white/10 dark:hover:border-indigo-400"
                      )}
                    >
                      {isCompleted && <Check className="h-3.5 w-3.5 stroke-[3px]" />}
                    </button>
                    <span className={cn(
                      "text-sm font-bold text-slate-800 dark:text-slate-200",
                      isCompleted && "line-through text-slate-400 dark:text-slate-500"
                    )}>
                      {item.title}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-[10px] bg-slate-50 dark:bg-white/[0.01]">
                    {isExpanded ? "Fechar detalhes" : "Ver instruções"}
                  </Badge>
                </div>

                {/* Detalhes Expandidos (Como usar + Benefício) */}
                {isExpanded && (
                  <div className="px-4 pb-4.5 pt-1 border-t border-slate-100 dark:border-white/5 bg-slate-50/30 dark:bg-white/[0.01] grid gap-4 md:grid-cols-2 animate-fade-in-up">
                    
                    {/* Como Operar */}
                    <div className="space-y-3.5 p-3 rounded-xl border border-slate-200/50 bg-white/90 dark:border-white/5 dark:bg-slate-950/40">
                      <div>
                        <p className="text-[9px] font-bold font-mono text-slate-400 uppercase tracking-wider">Como configurar passo a passo</p>
                        <ul className="mt-2 space-y-2">
                          {item.howTo.map((step, idx) => (
                            <li key={idx} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-1.5 leading-relaxed">
                              <span className="text-indigo-600 font-extrabold mt-0.5 shrink-0">{idx + 1}.</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs font-bold gap-1.5"
                        onClick={() => window.location.href = item.screenPath}
                      >
                        Ir para esta tela
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Benefício Comercial */}
                    <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/20 dark:border-indigo-950/30 dark:bg-indigo-950/10 flex flex-col justify-between">
                      <div>
                        <p className="text-[9px] font-bold font-mono text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">Benefício prático para a sua empresa</p>
                        <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed mt-2.5 font-medium">
                          💡 {item.benefit}
                        </p>
                      </div>
                      <div className="mt-4 pt-3.5 border-t border-indigo-100/50 dark:border-indigo-950/30 flex items-center justify-between text-[11px] text-indigo-600 dark:text-indigo-400 font-bold">
                        <span>Status da Tarefa:</span>
                        <button
                          onClick={() => toggleStepCompleted(item.id)}
                          className={cn(
                            "underline cursor-pointer",
                            isCompleted ? "text-indigo-600 dark:text-indigo-400" : "text-amber-600 dark:text-amber-400"
                          )}
                        >
                          {isCompleted ? "Marcar como pendente" : "Marcar como realizada"}
                        </button>
                      </div>
                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </PageShell>
  );
}
