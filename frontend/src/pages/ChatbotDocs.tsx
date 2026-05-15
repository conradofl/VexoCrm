import { useState } from "react";
import {
  Bot,
  Database,
  MessageCircle,
  Phone,
  Zap,
  ChevronRight,
  GitBranch,
  Clock,
  CheckCircle2,
  RotateCcw,
  AlertCircle,
  Server,
  Table,
  ArrowRight,
  ArrowDown,
  Megaphone,
  Users,
  TrendingUp,
  FileText,
  Image,
  Timer,
  Shuffle,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useLeadClients } from "@/hooks/useLeadClients";
import { useCampanhas } from "@/hooks/useCampanhas";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

// ─── Componentes de Diagrama ─────────────────────────────────────────────────

function FlowNode({
  label,
  sublabel,
  variant = "default",
  icon: Icon,
}: {
  label: string;
  sublabel?: string;
  variant?: "default" | "decision" | "action" | "end" | "start";
  icon?: React.ElementType;
}) {
  const base =
    "flex flex-col items-center justify-center gap-1 rounded-xl border px-4 py-3 text-center text-sm font-medium shadow-sm min-w-[120px]";
  const variants: Record<string, string> = {
    default:
      "border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200",
    decision:
      "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
    action:
      "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300",
    end: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300",
    start:
      "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300",
  };

  return (
    <div className={`${base} ${variants[variant]}`}>
      {Icon && <Icon className="h-4 w-4 opacity-70" />}
      <span>{label}</span>
      {sublabel && <span className="text-[10px] font-normal opacity-60">{sublabel}</span>}
    </div>
  );
}

function Arrow({ label, direction = "down" }: { label?: string; direction?: "down" | "right" }) {
  if (direction === "right") {
    return (
      <div className="flex items-center gap-1 text-slate-400">
        <ArrowRight className="h-4 w-4" />
        {label && <span className="text-[11px]">{label}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-0.5 text-slate-400">
      <ArrowDown className="h-4 w-4" />
      {label && <span className="text-[10px]">{label}</span>}
    </div>
  );
}

// ─── Diagrama: Fluxo Principal ────────────────────────────────────────────────

function MainFlowDiagram() {
  return (
    <div className="flex flex-col items-center gap-2 py-4">
      <FlowNode label="WhatsApp" sublabel="Mensagem do Lead" variant="start" icon={MessageCircle} />
      <Arrow />
      <FlowNode label="Evolution API" sublabel="Webhook → /api/hardcoded-chat-webhook" variant="default" icon={Zap} />
      <Arrow />
      <FlowNode label="Message Buffer" sublabel="Debounce 3s (agrupa msgs)" variant="action" icon={Clock} />
      <Arrow />
      <FlowNode label="processBatch()" sublabel="chatbot-ai-engine.js" variant="action" icon={Bot} />
      <Arrow />

      {/* Decisão: Lead existe? */}
      <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 px-6 py-3 text-center text-sm font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
        Lead existe no banco?
      </div>

      {/* 3 cenários */}
      <div className="flex flex-wrap justify-center gap-6 pt-2">
        <div className="flex flex-col items-center gap-2">
          <Badge variant="outline" className="border-violet-300 text-violet-700 dark:text-violet-300">
            Cenário 1
          </Badge>
          <FlowNode label="Novo Lead" sublabel="Primeiro contato" variant="start" icon={MessageCircle} />
          <Arrow />
          <FlowNode label="Fluxo SPIN" sublabel="Perguntas normais" variant="action" />
          <Arrow />
          <FlowNode label="Salva no DB" sublabel="leads_{clientId}" variant="action" icon={Database} />
        </div>

        <div className="flex flex-col items-center gap-2">
          <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
            Cenário 2
          </Badge>
          <FlowNode label="Lead Abandonado" sublabel="> 4h sem resposta" variant="decision" icon={Clock} />
          <Arrow />
          <FlowNode label="Reengajamento" sublabel="IA retoma com contexto" variant="action" icon={RotateCcw} />
          <Arrow />
          <FlowNode label="Continua Fluxo" variant="action" />
        </div>

        <div className="flex flex-col items-center gap-2">
          <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-300">
            Cenário 3
          </Badge>
          <FlowNode label="Lead Finalizado" sublabel="Recontato" variant="end" icon={CheckCircle2} />
          <Arrow />
          <FlowNode label="Msg. Quente" sublabel="Já qualificado" variant="end" />
          <Arrow />
          <FlowNode label="Alerta SDR" sublabel="WhatsApp do SDR" variant="action" icon={Phone} />
        </div>
      </div>

      {/* Finalização */}
      <div className="mt-4 flex flex-col items-center gap-2">
        <Arrow label="Fluxo concluído" />
        <FlowNode label="Briefing Gerado" sublabel="extractConversationBriefing()" variant="action" icon={Bot} />
        <Arrow />
        <FlowNode label="SDR notificado" sublabel="sdr_whatsapp_number" variant="end" icon={Phone} />
      </div>
    </div>
  );
}

// ─── Diagrama: Modelo SPIN ────────────────────────────────────────────────────

const SPIN_STEPS = [
  { id: "situation_interest", label: "Interesse", fase: "Situação", pergunta: "Você tem interesse em adquirir um imóvel?" },
  { id: "situation_objective", label: "Objetivo", fase: "Situação", pergunta: "Qual o objetivo: moradia ou investimento?" },
  { id: "situation_state", label: "Estado", fase: "Situação", pergunta: "Em qual estado deseja o imóvel?" },
  { id: "situation_city", label: "Cidade", fase: "Situação", pergunta: "Em qual cidade?" },
  { id: "problem_credit", label: "Crédito", fase: "Problema", pergunta: "Como está seu crédito? (Excelente/Bom/Regular/Ruim)" },
  { id: "implication_parcels", label: "Parcelas", fase: "Implicação", pergunta: "Qual valor de parcela cabe no seu bolso?" },
  { id: "implication_timeline", label: "Prazo", fase: "Implicação", pergunta: "Em quanto tempo precisa do imóvel?" },
  { id: "implication_fgts", label: "FGTS", fase: "Implicação", pergunta: "Possui FGTS disponível?" },
  { id: "necessity_best_time", label: "Horário", fase: "Necessidade", pergunta: "Qual o melhor horário para um consultor ligar?" },
];

const FASE_COLORS: Record<string, string> = {
  Situação: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30",
  Problema: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  Implicação: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30",
  Necessidade: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
};

function SpinFlowDiagram() {
  const [activeStep, setActiveStep] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 pb-2">
        {Object.entries(FASE_COLORS).map(([fase, cls]) => (
          <span key={fase} className={`rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
            {fase}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-0">
        {SPIN_STEPS.map((step, i) => (
          <div key={step.id} className="flex items-stretch gap-3">
            {/* Linha vertical */}
            <div className="flex flex-col items-center">
              <div
                className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
                  activeStep === step.id
                    ? "border-cyan-500 bg-cyan-500 text-white"
                    : "border-slate-300 bg-white text-slate-500 dark:border-white/20 dark:bg-white/5 dark:text-slate-400"
                }`}
                onClick={() => setActiveStep(activeStep === step.id ? null : step.id)}
              >
                {i + 1}
              </div>
              {i < SPIN_STEPS.length - 1 && (
                <div className="w-px flex-1 bg-slate-200 dark:bg-white/10" style={{ minHeight: 20 }} />
              )}
            </div>

            {/* Conteúdo */}
            <div
              className={`mb-2 flex-1 cursor-pointer rounded-xl border px-4 py-3 transition-all ${
                activeStep === step.id
                  ? "border-cyan-300 bg-cyan-50 dark:border-cyan-500/30 dark:bg-cyan-500/10"
                  : "border-slate-100 bg-white hover:border-slate-200 dark:border-white/8 dark:bg-white/[0.02]"
              }`}
              onClick={() => setActiveStep(activeStep === step.id ? null : step.id)}
            >
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${FASE_COLORS[step.fase]}`}>
                  {step.fase}
                </span>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{step.label}</span>
                <span className="ml-auto font-mono text-[10px] text-slate-400">{step.id}</span>
              </div>
              {activeStep === step.id && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{step.pergunta}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Diagrama: Arquitetura de Dados ──────────────────────────────────────────

function DataArchDiagram() {
  const companies = [
    { id: "infinie", label: "Infine", table: "leads_infinie", color: "violet" },
    { id: "outlier", label: "Outlier", table: "leads_outlier", color: "cyan" },
    { id: "teste", label: "Teste", table: "leads_teste", color: "amber" },
    { id: "nova_empresa", label: "Nova Empresa", table: "leads_{clientId}", color: "slate" },
  ];

  const colorMap: Record<string, string> = {
    violet:
      "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
    cyan: "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300",
    amber:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    slate:
      "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400",
  };

  return (
    <div className="space-y-6">
      {/* Webhook recebe clientId */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium shadow-sm dark:border-white/10 dark:bg-white/5">
          <Zap className="h-4 w-4 text-cyan-500" />
          <code className="font-mono text-[13px]">/api/hardcoded-chat-webhook?clientId=...</code>
        </div>
        <Arrow label="leadsTableName(clientId)" />
      </div>

      {/* Tabelas por empresa */}
      <div className="flex flex-wrap justify-center gap-4">
        {companies.map((c) => (
          <div key={c.id} className="flex flex-col items-center gap-1">
            <div
              className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${colorMap[c.color]}`}
            >
              <Table className="h-4 w-4" />
              <span>{c.label}</span>
            </div>
            <code className="font-mono text-[10px] text-slate-500">{c.table}</code>
          </div>
        ))}
      </div>

      {/* Colunas da tabela */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Colunas da tabela de leads</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { col: "telefone", type: "VARCHAR", note: "PK lógica" },
            { col: "client_id", type: "VARCHAR", note: "Multi-tenant" },
            { col: "dados", type: "JSONB", note: "collectedData + _currentStepId" },
            { col: "status_conversa", type: "VARCHAR", note: "em_atendimento | finalizado" },
            { col: "lead_temperature", type: "VARCHAR", note: "QUENTE | MORNO | FRIO" },
            { col: "mensagem", type: "TEXT", note: "Última msg do bot" },
            { col: "finalizado", type: "BOOLEAN", note: "Flag de conclusão" },
            { col: "spin_fase", type: "VARCHAR", note: "situacao | problema..." },
            { col: "created_at", type: "TIMESTAMPTZ", note: "" },
            { col: "updated_at", type: "TIMESTAMPTZ", note: "Reengajamento < 4h" },
          ].map(({ col, type, note }) => (
            <div
              key={col}
              className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-white/8 dark:bg-white/[0.03]"
            >
              <code className="block text-[11px] font-bold text-cyan-700 dark:text-cyan-400">{col}</code>
              <span className="text-[10px] text-slate-400">{type}</span>
              {note && <span className="block text-[10px] text-slate-500">{note}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Diagrama: SDR Notification ───────────────────────────────────────────────

function SdrFlowDiagram() {
  return (
    <div className="space-y-6">
      {/* Config */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Configuração</p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm dark:border-violet-500/30 dark:bg-violet-500/10">
            <Server className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            <code className="font-mono text-[12px] text-violet-800 dark:text-violet-300">lead_client_n8n_settings</code>
          </div>
          <ArrowRight className="h-4 w-4 text-slate-400" />
          <code className="font-mono text-[12px] text-slate-600 dark:text-slate-300">sdr_whatsapp_number</code>
          <ArrowRight className="h-4 w-4 text-slate-400" />
          <span className="text-sm text-slate-500">Ex: 5511999998888</span>
        </div>
      </div>

      {/* Dois cenários de notificação */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Finalização */}
        <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              Lead Finalizado (Novo)
            </span>
          </div>
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            Quando <code>finalizado: true</code> e não é recontato
          </p>
          <div className="rounded-lg border border-emerald-200 bg-white p-3 font-mono text-[11px] text-slate-700 dark:border-emerald-500/20 dark:bg-white/5 dark:text-slate-300">
            extractConversationBriefing()<br />
            → Briefing completo<br />
            → Enviado via Evolution API<br />
            → Para: sdr_whatsapp_number
          </div>
        </div>

        {/* Recontato */}
        <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Lead Recontato (Já qualificado)
            </span>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Quando <code>_recontato: true</code>
          </p>
          <div className="rounded-lg border border-amber-200 bg-white p-3 font-mono text-[11px] text-slate-700 dark:border-amber-500/20 dark:bg-white/5 dark:text-slate-300">
            Mensagem curta:<br />
            "Lead {"{telefone}"} recontou"<br />
            "Já qualificado anteriormente"<br />
            → Para: sdr_whatsapp_number
          </div>
        </div>
      </div>

      {/* Briefing format */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Formato do Briefing</p>
        <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-[11px] text-slate-700 dark:bg-white/[0.03] dark:text-slate-300">
{`🔔 Novo Lead Qualificado!

📱 Telefone: +55 11 9xxxx-8888
🌡️ Temperatura: QUENTE
📊 Fase: necessidade (9/9 perguntas)

📋 Dados Coletados:
• Interesse: Sim, tenho interesse
• Objetivo: Moradia própria
• Estado: SP
• Cidade: São Paulo
• Crédito: Bom
• Parcelas: Até R$ 2.000
• Prazo: 6 meses
• FGTS: Sim, tenho FGTS
• Horário: Manhã`}
        </pre>
      </div>
    </div>
  );
}

// ─── Diagrama: Buffer de Mensagens ────────────────────────────────────────────

function BufferDiagram() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3">
        {/* Msgs chegando */}
        <div className="flex gap-2">
          {["Msg 1", "Msg 2", "Msg 3"].map((m, i) => (
            <div
              key={m}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
              style={{ animationDelay: `${i * 200}ms` }}
            >
              {m}
            </div>
          ))}
        </div>
        <Arrow label="messageBuffers Map" />

        {/* Buffer */}
        <div className="w-full max-w-sm rounded-xl border-2 border-dashed border-cyan-300 bg-cyan-50 p-4 text-center dark:border-cyan-500/40 dark:bg-cyan-500/10">
          <Clock className="mx-auto h-5 w-5 text-cyan-600 dark:text-cyan-400" />
          <p className="mt-1 text-sm font-bold text-cyan-800 dark:text-cyan-300">Debounce 3 segundos</p>
          <p className="text-xs text-cyan-600 dark:text-cyan-400">
            Aguarda silêncio para agrupar msgs
          </p>
          <code className="mt-2 block font-mono text-[10px] text-cyan-700 dark:text-cyan-300">
            key: "clientId:phone"
          </code>
        </div>
        <Arrow label="Timer dispara" />

        {/* processBatch */}
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-6 py-3 text-center text-sm font-semibold text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300">
          processBatch(messages.join("\n"))
        </div>
        <Arrow />

        <div className="flex gap-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-xs dark:border-white/10 dark:bg-white/5">
            <Database className="mx-auto h-4 w-4 text-slate-400" />
            <p className="mt-1 font-medium">Carrega histórico</p>
            <p className="text-slate-400">dados.historico (DB)</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-xs dark:border-white/10 dark:bg-white/5">
            <Bot className="mx-auto h-4 w-4 text-slate-400" />
            <p className="mt-1 font-medium">IA processa</p>
            <p className="text-slate-400">Claude / Gemini</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-xs dark:border-white/10 dark:bg-white/5">
            <MessageCircle className="mx-auto h-4 w-4 text-slate-400" />
            <p className="mt-1 font-medium">Evolution envia</p>
            <p className="text-slate-400">WhatsApp resp.</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/[0.06]">
        <div className="flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Histórico sempre do banco</p>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
              O buffer é in-memory mas o histórico completo é carregado do PostgreSQL a cada processBatch. Isso garante
              que usuários lentos (que demoram minutos para responder) nunca percam o contexto da conversa.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Campanhas: Fluxo de Roteamento ──────────────────────────────────────────

function CampaignRoutingDiagram() {
  return (
    <div className="space-y-6">
      {/* Dois caminhos de entrada */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex gap-6">
          <div className="flex flex-col items-center gap-2">
            <FlowNode label="Lead Inbound" sublabel="Contato espontâneo" variant="default" icon={MessageCircle} />
            <Arrow label="lead_origin = inbound" />
            <FlowNode label="Prompt Padrão" sublabel="Tom consultivo SPIN" variant="action" icon={Bot} />
          </div>
          <div className="flex flex-col items-center gap-2">
            <FlowNode label="Lead de Campanha" sublabel="Recebeu disparo" variant="start" icon={Megaphone} />
            <Arrow label="lead_origin = campaign" />
            <FlowNode label="Prompt Campanha" sublabel="Contexto do produto" variant="start" icon={Bot} />
          </div>
        </div>

        <div className="mt-2 flex flex-col items-center gap-2">
          <Arrow label="Mesmo motor SPIN" />
          <FlowNode label="9 Perguntas SPIN" sublabel="Qualificação unificada" variant="action" />
          <Arrow />
          <FlowNode label="Briefing SDR" sublabel="sdr_whatsapp_number" variant="end" icon={Phone} />
        </div>
      </div>

      {/* Como o origin chega */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">
          Como lead_origin chega ao chatbot
        </p>
        <div className="space-y-2">
          {[
            {
              field: "lead_origin",
              table: "leads_{clientId}",
              values: "'inbound' | 'campaign' | NULL",
              note: "Gravado pelo webhook de disparo da campanha",
            },
            {
              field: "source_campaign_id",
              table: "leads_{clientId}",
              values: "UUID | NULL",
              note: "FK para public.campaigns — permite buscar nome e sequência",
            },
          ].map(({ field, table, values, note }) => (
            <div
              key={field}
              className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 dark:border-white/8 dark:bg-white/[0.03]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-[11px] font-bold text-cyan-700 dark:text-cyan-400">{field}</code>
                <span className="font-mono text-[10px] text-slate-400">{table}</span>
                <span className="font-mono text-[10px] text-indigo-500 dark:text-indigo-400">{values}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">{note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Badge no CRM */}
      <div className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-800/40 dark:bg-indigo-900/10">
        <Shuffle className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
        <div className="text-sm text-indigo-800 dark:text-indigo-300">
          <p className="font-medium">Badge visual no Kanban e WhatsApp</p>
          <p className="mt-0.5 text-indigo-700 dark:text-indigo-400 text-xs">
            Conversas com <code>lead_origin = campaign</code> exibem o badge roxo "Campanha: [nome]" na lista de chats e no cabeçalho da conversa. Leads inbound mostram o badge cinza "Inbound".
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Campanhas: Visualizador de Sequência ────────────────────────────────────

const TRIGGER_MODE_LABELS: Record<string, string> = {
  immediate: "Imediato",
  after_reply: "Após resposta",
};

function StepTypeIcon({ type }: { type: string }) {
  if (type === "image") return <Image className="h-3.5 w-3.5 text-violet-400" />;
  return <FileText className="h-3.5 w-3.5 text-slate-400" />;
}

function CampaignSequenceViewer() {
  const { data: clients = [], isLoading: loadingClients } = useLeadClients();
  const [clientId, setClientId] = useState("");
  const [campaignId, setCampaignId] = useState("");

  const { data: campaigns = [], isLoading: loadingCampaigns } = useCampanhas(clientId || undefined);

  const selectedCampaign = campaigns.find((c) => c.id === campaignId);
  const sequence = selectedCampaign?.analytics_meta?.sequence ?? [];
  const dispatchOptions = selectedCampaign?.analytics_meta?.dispatchOptions;

  return (
    <div className="space-y-4">
      {/* Seletores */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-500 dark:text-slate-400">Empresa</Label>
          <Select
            value={clientId}
            onValueChange={(v) => { setClientId(v); setCampaignId(""); }}
            disabled={loadingClients}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Selecione a empresa" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-slate-500 dark:text-slate-400">Campanha</Label>
          <Select
            value={campaignId}
            onValueChange={setCampaignId}
            disabled={!clientId || loadingCampaigns}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={clientId ? "Selecione a campanha" : "— selecione empresa primeiro —"} />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Sequência */}
      {!campaignId ? (
        <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Selecione uma campanha para visualizar a sequência.</p>
        </div>
      ) : sequence.length === 0 ? (
        <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Esta campanha não tem sequência de mensagens configurada.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Opções de disparo */}
          {dispatchOptions && (
            <div className="flex flex-wrap gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-white/8 dark:bg-white/[0.03]">
              <span className="text-xs text-slate-500">
                <span className="font-medium text-slate-700 dark:text-slate-300">Delay entre leads:</span>{" "}
                {dispatchOptions.leadDelaySeconds}s
              </span>
              {dispatchOptions.waitForReply && (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Aguarda resposta</span>
              )}
              {dispatchOptions.aiAssisted && (
                <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">IA assistida</span>
              )}
            </div>
          )}

          {/* Steps */}
          <div className="flex flex-col gap-0">
            {sequence
              .filter((s) => s.enabled !== false)
              .sort((a, b) => a.order - b.order)
              .map((step, i, arr) => (
                <div key={step.id} className="flex items-stretch gap-3">
                  <div className="flex flex-col items-center">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 bg-white text-xs font-bold text-slate-500 dark:border-white/20 dark:bg-white/5 dark:text-slate-400">
                      {i + 1}
                    </div>
                    {i < arr.length - 1 && (
                      <div className="w-px flex-1 bg-slate-200 dark:bg-white/10" style={{ minHeight: 16 }} />
                    )}
                  </div>

                  <div className="mb-2 flex-1 rounded-xl border border-slate-100 bg-white px-4 py-3 dark:border-white/8 dark:bg-white/[0.02]">
                    <div className="flex flex-wrap items-center gap-2">
                      <StepTypeIcon type={step.type} />
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {step.type === "image" ? "Imagem" : "Texto"}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Timer className="h-3 w-3" />
                        {step.delayAfterSeconds}s
                      </span>
                      <span className="ml-auto text-[10px] font-medium text-indigo-500 dark:text-indigo-400">
                        {TRIGGER_MODE_LABELS[step.triggerMode ?? "immediate"]}
                      </span>
                    </div>
                    {step.text && (
                      <p className="mt-1.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                        {step.text}
                      </p>
                    )}
                    {step.image && (
                      <p className="mt-1 text-[10px] text-violet-500">[imagem: {step.image.name}]</p>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Campanhas: Métricas por Agente ──────────────────────────────────────────

interface AgentMetric {
  agentId: string;
  agentName: string;
  totalLeads: number;
  converted: number;
  conversionRate: number;
  avgResponseMinutes: number | null;
}

function useAgentMetrics(clientId: string) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["campaign-agent-metrics", clientId],
    enabled: isAuthenticated && !!clientId,
    queryFn: async (): Promise<AgentMetric[] | null> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);

      const res = await fetchApi(`/api/campaigns/metrics/by-agent?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 404) return null;
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao carregar métricas"));

      const data = await readApiJson<{ items?: AgentMetric[] }>(res, "agent_metrics");
      return data.items ?? [];
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

function CampaignAgentMetrics() {
  const { data: clients = [] } = useLeadClients();
  const [clientId, setClientId] = useState("");
  const { data: metrics, isLoading, error } = useAgentMetrics(clientId);

  const apiNotReady = metrics === null || (error instanceof Error && error.message.includes("404"));

  return (
    <div className="space-y-4">
      <div className="max-w-xs space-y-1.5">
        <Label className="text-xs text-slate-500 dark:text-slate-400">Empresa</Label>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Selecione a empresa" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!clientId ? (
        <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Selecione uma empresa para ver as métricas.</p>
        </div>
      ) : apiNotReady ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/50 p-8 text-center dark:border-amber-800/40 dark:bg-amber-900/10">
          <AlertCircle className="h-7 w-7 text-amber-400" />
          <p className="font-medium text-amber-800 dark:text-amber-300">Endpoint ainda não disponível</p>
          <p className="text-sm text-amber-700 dark:text-amber-400">
            O Conrado ainda não publicou{" "}
            <code className="rounded bg-amber-100 px-1 dark:bg-amber-800">
              GET /api/campaigns/metrics/by-agent
            </code>
            . As métricas aparecerão aqui assim que a rota estiver no ar.
          </p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-6 text-center dark:border-red-800/40 dark:bg-red-900/10">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">Erro: {error.message}</p>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : metrics && metrics.length === 0 ? (
        <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Nenhuma métrica encontrada para esta empresa.</p>
        </div>
      ) : metrics ? (
        <div className="space-y-2">
          {metrics
            .sort((a, b) => b.conversionRate - a.conversionRate)
            .map((agent, i) => (
              <div
                key={agent.agentId}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-100 bg-white px-4 py-3 dark:border-white/8 dark:bg-white/[0.02]"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {agent.agentName}
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono">{agent.agentId}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-center">
                  <div>
                    <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{agent.totalLeads}</p>
                    <p className="text-[10px] text-slate-400">Leads</p>
                  </div>
                  <div>
                    <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{agent.converted}</p>
                    <p className="text-[10px] text-slate-400">Convertidos</p>
                  </div>
                  <div>
                    <p className="text-lg font-extrabold text-indigo-600 dark:text-indigo-400">
                      {(agent.conversionRate * 100).toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-slate-400">Taxa</p>
                  </div>
                  {agent.avgResponseMinutes !== null && (
                    <div>
                      <p className="text-lg font-extrabold text-amber-600 dark:text-amber-400">
                        {agent.avgResponseMinutes}min
                      </p>
                      <p className="text-[10px] text-slate-400">Resp. média</p>
                    </div>
                  )}
                </div>

                {/* Barra de progresso */}
                <div className="hidden w-28 sm:block">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500"
                      style={{ width: `${Math.min(100, agent.conversionRate * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function ChatbotDocs() {
  return (
    <PageShell title="Documentação do Chatbot" description="Arquitetura, fluxos e modelos do sistema de qualificação">
      <div className="space-y-6">
        {/* Header badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            SPIN Selling
          </Badge>
          <Badge variant="outline" className="border-cyan-300 text-cyan-700 dark:text-cyan-400">
            <Bot className="mr-1 h-3 w-3" />
            AI Engine
          </Badge>
          <Badge variant="outline" className="border-violet-300 text-violet-700 dark:text-violet-400">
            <Database className="mr-1 h-3 w-3" />
            Multi-tenant
          </Badge>
          <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400">
            <Phone className="mr-1 h-3 w-3" />
            SDR Alerts
          </Badge>
          <Badge variant="outline" className="border-indigo-300 text-indigo-700 dark:text-indigo-400">
            <Megaphone className="mr-1 h-3 w-3" />
            Campanhas
          </Badge>
        </div>

        {/* Resumo rápido */}
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Perguntas SPIN", value: "9", sub: "Situação, Problema, Implicação, Necessidade" },
            { label: "Cenários de conversa", value: "3", sub: "Novo, Reengajamento, Recontato" },
            { label: "Threshold abandono", value: "4h", sub: "Sem resposta → reengajamento" },
            { label: "Debounce buffer", value: "3s", sub: "Agrupa mensagens rápidas" },
          ].map(({ label, value, sub }) => (
            <Card key={label} className="border-slate-100 dark:border-white/8">
              <CardContent className="pt-4">
                <p className="text-2xl font-extrabold text-foreground">{value}</p>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</p>
                <p className="text-[11px] text-slate-400">{sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs com diagramas */}
        <Tabs defaultValue="main-flow">
          <TabsList className="flex-wrap">
            <TabsTrigger value="main-flow">
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />
              Fluxo Principal
            </TabsTrigger>
            <TabsTrigger value="spin">
              <ChevronRight className="mr-1.5 h-3.5 w-3.5" />
              Modelo SPIN
            </TabsTrigger>
            <TabsTrigger value="data">
              <Database className="mr-1.5 h-3.5 w-3.5" />
              Dados & Tabelas
            </TabsTrigger>
            <TabsTrigger value="buffer">
              <Clock className="mr-1.5 h-3.5 w-3.5" />
              Buffer de Msgs
            </TabsTrigger>
            <TabsTrigger value="sdr">
              <Phone className="mr-1.5 h-3.5 w-3.5" />
              Notificação SDR
            </TabsTrigger>
            <TabsTrigger value="campanhas">
              <Megaphone className="mr-1.5 h-3.5 w-3.5" />
              Campanhas
            </TabsTrigger>
          </TabsList>

          <TabsContent value="main-flow">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Fluxo Principal de Mensagem</CardTitle>
              </CardHeader>
              <CardContent>
                <MainFlowDiagram />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="spin">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Modelo SPIN — 9 Perguntas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-slate-500">
                  Clique em cada passo para ver a pergunta completa.
                </p>
                <SpinFlowDiagram />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="data">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Arquitetura de Dados — Tabelas por Empresa</CardTitle>
              </CardHeader>
              <CardContent>
                <DataArchDiagram />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="buffer">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Buffer de Mensagens</CardTitle>
              </CardHeader>
              <CardContent>
                <BufferDiagram />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sdr">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notificação para SDR/Closer</CardTitle>
              </CardHeader>
              <CardContent>
                <SdrFlowDiagram />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="campanhas">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Shuffle className="h-4 w-4 text-indigo-500" />
                    Roteamento Campanha vs Inbound
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CampaignRoutingDiagram />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4 text-slate-500" />
                    Sequência de Mensagens por Campanha
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
                    Visualize os passos configurados para cada campanha, com tipo, texto, delay e modo de disparo.
                  </p>
                  <CampaignSequenceViewer />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    Métricas de Conversão por Agente
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
                    Taxa de conversão, volume de leads e tempo médio de resposta por consultor.
                  </p>
                  <CampaignAgentMetrics />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Referência de endpoints */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Endpoints da API</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                {
                  method: "POST",
                  path: "/api/hardcoded-chat-webhook",
                  desc: "Webhook Evolution → processa mensagem do WhatsApp",
                  color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
                },
                {
                  method: "GET",
                  path: "/api/hardcoded-chat-leads",
                  desc: "Lista leads para o Kanban por empresa",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
                },
                {
                  method: "GET",
                  path: "/api/hardcoded-chat-briefing/:phone",
                  desc: "Briefing completo de um lead específico",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
                },
                {
                  method: "GET",
                  path: "/api/chatbot-config",
                  desc: "Configurações do chatbot por empresa",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
                },
                {
                  method: "POST",
                  path: "/api/import-leads-outlier",
                  desc: "Importa leads via CSV para a tabela da empresa",
                  color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
                },
              ].map(({ method, path, desc, color }) => (
                <div
                  key={path}
                  className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white p-3 dark:border-white/8 dark:bg-white/[0.02]"
                >
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-bold ${color}`}
                  >
                    {method}
                  </span>
                  <code className="shrink-0 font-mono text-[12px] text-slate-700 dark:text-slate-200">{path}</code>
                  <span className="text-xs text-slate-400">{desc}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
