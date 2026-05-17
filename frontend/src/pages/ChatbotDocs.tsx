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
  RefreshCw,
  Flame,
  Thermometer,
  Snowflake,
  Activity,
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

      {/* Campaign routing */}
      <div className="rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50 px-6 py-3 text-center text-sm font-semibold text-indigo-800 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300">
        Lead dentro do período de campanha mode='agente'?
      </div>
      <div className="flex gap-6 pt-1">
        <div className="flex flex-col items-center gap-1 text-xs text-slate-400">
          <span className="font-bold text-emerald-600">Sim</span>
          <FlowNode label="Prompt Campanha" sublabel="type='campanha' do banco" variant="action" icon={Megaphone} />
        </div>
        <div className="flex flex-col items-center gap-1 text-xs text-slate-400">
          <span>Não</span>
          <FlowNode label="Prompt Padrão" sublabel="type='padrao' do banco" variant="default" icon={Bot} />
        </div>
      </div>

      <Arrow />
      <FlowNode label="Message Buffer" sublabel="Debounce 3s (agrupa msgs)" variant="action" icon={Clock} />
      <Arrow />
      <FlowNode label="processBatch()" sublabel="Envia prompt selecionado → Groq" variant="action" icon={Bot} />
      <Arrow />

      {/* 3 cenários */}
      <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 px-6 py-3 text-center text-sm font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
        Estado do lead no banco?
      </div>
      <div className="flex flex-wrap justify-center gap-6 pt-2">
        <div className="flex flex-col items-center gap-2">
          <Badge variant="outline" className="border-violet-300 text-violet-700 dark:text-violet-300">Novo</Badge>
          <FlowNode label="Primeiro contato" variant="start" icon={MessageCircle} />
          <Arrow />
          <FlowNode label="Qualificação SPIN" variant="action" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">Abandonado</Badge>
          <FlowNode label="> 4h sem resposta" variant="decision" icon={Clock} />
          <Arrow />
          <FlowNode label="Reengajamento" sublabel="IA retoma contexto" variant="action" icon={RotateCcw} />
        </div>
        <div className="flex flex-col items-center gap-2">
          <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-300">Finalizado</Badge>
          <FlowNode label="Recontato" variant="end" icon={CheckCircle2} />
          <Arrow />
          <FlowNode label="Alerta SDR" sublabel="Já qualificado" variant="end" icon={Phone} />
        </div>
      </div>

      {/* Finalização */}
      <div className="mt-4 flex flex-col items-center gap-2">
        <Arrow label="finalizado = true" />
        <FlowNode label="Briefing via IA" sublabel="extractBriefingWithAI() — prompt 'extrato' do banco" variant="action" icon={Bot} />
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
            extractBriefingWithAI()<br />
            → prompt type='extrato' do banco<br />
            → Groq gera briefing formatado<br />
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
            <p className="text-slate-400">Groq llama-3.3-70b</p>
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

      {/* Modos de campanha */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Só Disparo */}
        <div className="rounded-xl border-2 border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.02]">
          <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Modo: Só Disparo</p>
          <div className="flex flex-col items-center gap-2">
            <FlowNode label="Disparo enviado" sublabel="campaign_dispatches" variant="start" icon={Megaphone} />
            <Arrow label="lead responde" />
            <FlowNode label="Chatbot Padrão" sublabel="prompt type='padrao'" variant="action" icon={Bot} />
            <Arrow />
            <FlowNode label="Qualificação SPIN" sublabel="fluxo normal" variant="end" />
          </div>
          <p className="mt-3 text-center text-[11px] text-slate-400">Agente IA não é ativado pela campanha.</p>
        </div>

        {/* Com Agente IA */}
        <div className="rounded-xl border-2 border-sky-300 bg-sky-50/60 p-4 dark:border-sky-500/40 dark:bg-sky-500/5">
          <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-sky-600 dark:text-sky-400">Modo: Com Agente IA</p>
          <div className="flex flex-col items-center gap-2">
            <FlowNode label="Disparo enviado" sublabel="campaign_dispatches" variant="start" icon={Megaphone} />
            <Arrow label="lead responde" />
            <div className="rounded-lg border border-sky-300 bg-sky-100/60 px-4 py-2 text-center text-[11px] font-semibold text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300">
              Dentro do período ativo? (starts_at → ends_at)
            </div>
            <div className="flex gap-6">
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-bold text-emerald-600">SIM</span>
                <FlowNode label="Prompt Campanha" sublabel="type='campanha'" variant="action" icon={Bot} />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-bold text-slate-400">NÃO</span>
                <FlowNode label="Prompt Padrão" sublabel="type='padrao'" variant="default" icon={Bot} />
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] text-sky-600 dark:text-sky-400">Ao término do período o lead volta ao fluxo padrão automaticamente.</p>
        </div>
      </div>

      {/* Campos relevantes */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Campos da tabela campaigns</p>
        <div className="space-y-2">
          {[
            { field: "mode", values: "'disparo' | 'agente'", note: "Define se o chatbot usa prompt de campanha na resposta do lead" },
            { field: "starts_at", values: "TIMESTAMPTZ | NULL", note: "Início do período ativo do agente de campanha" },
            { field: "ends_at", values: "TIMESTAMPTZ | NULL", note: "Fim do período — após essa data prompt volta ao padrão" },
            { field: "chatbot_prompt_type", values: "'campanha'", note: "Tipo de prompt usado quando dentro do período (modo agente)" },
          ].map(({ field, values, note }) => (
            <div key={field} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 dark:border-white/8 dark:bg-white/[0.03]">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-[11px] font-bold text-cyan-700 dark:text-cyan-400">{field}</code>
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
            Conversas com <code>lead_origin = campaign</code> exibem o badge roxo "Campanha: [nome]". Leads inbound mostram o badge cinza "Inbound".
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

// ─── Painel de Métricas ao Vivo ───────────────────────────────────────────────

interface ChatbotLead {
  statusConversa: string;
  leadTemperature: string | null;
  spinFase: string | null;
  finalizado: boolean;
  updatedAt: string;
}

function useLiveStats(clientId: string) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["live-chatbot-stats", clientId],
    enabled: isAuthenticated && !!clientId,
    refetchInterval: 30_000,
    staleTime: 0,
    queryFn: async () => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const res = await fetchApi(`/api/hardcoded-chat-leads?clientId=${clientId}&limit=500`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro"));
      const data = await readApiJson<{ leads: ChatbotLead[] }>(res, "live_stats");
      return data.leads ?? [];
    },
  });
}

const TEMP_CONFIG = {
  QUENTE: { label: "Quente", color: "text-red-600 dark:text-red-400", bg: "bg-red-100 dark:bg-red-900/30", icon: Flame },
  MORNO: { label: "Morno", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30", icon: Thermometer },
  FRIO: { label: "Frio", color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-100 dark:bg-sky-900/30", icon: Snowflake },
} as const;

function LiveStatsPanel() {
  const { data: clients = [] } = useLeadClients();
  const [clientId, setClientId] = useState("");
  const { data: leads, isLoading, isFetching, dataUpdatedAt, error } = useLiveStats(clientId);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const active = leads?.filter((l) => l.statusConversa === "em_atendimento").length ?? 0;
  const finalized = leads?.filter((l) => l.statusConversa === "finalizado").length ?? 0;
  const finalizedToday = leads?.filter(
    (l) => l.statusConversa === "finalizado" && new Date(l.updatedAt) >= todayStart
  ).length ?? 0;
  const total = leads?.length ?? 0;

  const byTemp = { QUENTE: 0, MORNO: 0, FRIO: 0 };
  leads?.forEach((l) => {
    const t = (l.leadTemperature ?? "").toUpperCase() as keyof typeof byTemp;
    if (t in byTemp) byTemp[t]++;
  });

  const spinFases = { situacao: 0, problema: 0, implicacao: 0, necessidade: 0 };
  leads?.forEach((l) => {
    const f = l.spinFase as keyof typeof spinFases | null;
    if (f && f in spinFases) spinFases[f]++;
  });

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return (
    <div className="space-y-4">
      {/* Seletor de empresa + timestamp */}
      <div className="flex flex-wrap items-end justify-between gap-3">
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
        {lastUpdate && (
          <p className="flex items-center gap-1 text-[11px] text-slate-400">
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            Atualizado {lastUpdate.toLocaleTimeString("pt-BR")} · auto 30s
          </p>
        )}
      </div>

      {!clientId ? (
        <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Selecione uma empresa para ver as métricas ao vivo.</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-6 text-center dark:border-red-800/40 dark:bg-red-900/10">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">{(error as Error).message}</p>
        </div>
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { label: "Total de leads", value: total, sub: "no histórico", color: "text-slate-800 dark:text-slate-100" },
              { label: "Em atendimento", value: active, sub: "aguardando resposta", color: "text-cyan-700 dark:text-cyan-400" },
              { label: "Finalizados hoje", value: finalizedToday, sub: `${finalized} no total`, color: "text-emerald-700 dark:text-emerald-400" },
              { label: "Taxa finalização", value: total > 0 ? `${((finalized / total) * 100).toFixed(0)}%` : "—", sub: `${finalized} finalizados`, color: "text-indigo-700 dark:text-indigo-400" },
            ].map(({ label, value, sub, color }) => (
              <Card key={label} className="border-slate-100 dark:border-white/8">
                <CardContent className="pt-4">
                  <p className={`text-2xl font-extrabold ${color}`}>{value}</p>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</p>
                  <p className="text-[11px] text-slate-400">{sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Temperatura */}
          {total > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.entries(TEMP_CONFIG) as [keyof typeof TEMP_CONFIG, typeof TEMP_CONFIG[keyof typeof TEMP_CONFIG]][]).map(([key, cfg]) => {
                const count = byTemp[key];
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3 dark:border-white/8 dark:bg-white/[0.02]"
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cfg.bg}`}>
                      <cfg.icon className={`h-4 w-4 ${cfg.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between">
                        <p className={`text-lg font-extrabold ${cfg.color}`}>{count}</p>
                        <p className="text-[11px] text-slate-400">{pct.toFixed(0)}%</p>
                      </div>
                      <p className="text-xs text-slate-500">{cfg.label}</p>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                        <div className="h-full rounded-full bg-current transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* SPIN em andamento */}
          {active > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">SPIN — Fase atual (conversas ativas)</p>
              <div className="grid gap-2 sm:grid-cols-4">
                {([["situacao", "Situação"], ["problema", "Problema"], ["implicacao", "Implicação"], ["necessidade", "Necessidade"]] as const).map(([key, label]) => {
                  const count = spinFases[key];
                  return (
                    <div key={key} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 dark:border-white/8">
                      <p className="text-xs text-slate-600 dark:text-slate-300">{label}</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{count}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {total === 0 && (
            <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
              <p className="text-sm text-slate-400">Nenhum lead encontrado para esta empresa.</p>
            </div>
          )}
        </>
      )}
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

        {/* Painel de métricas ao vivo */}
        <Card className="border-slate-100 dark:border-white/8">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-emerald-500" />
              Métricas ao Vivo
              <Badge variant="outline" className="ml-1 border-emerald-300 text-[10px] text-emerald-600 dark:text-emerald-400">
                auto 30s
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LiveStatsPanel />
          </CardContent>
        </Card>

        {/* Resumo de arquitetura */}
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Perguntas SPIN", value: "9", sub: "Situação, Problema, Implicação, Necessidade" },
            { label: "Cenários de conversa", value: "3", sub: "Novo, Reengajamento, Recontato" },
            { label: "Modos de campanha", value: "2", sub: "Só Disparo / Com Agente IA" },
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
                    <Zap className="h-4 w-4 text-amber-500" />
                    Disparos (campaign_dispatches)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Dentro de uma campanha podem existir múltiplos disparos independentes — cada um com seus próprios passos (textos/imagens), podendo ser acionado manualmente ou agendado.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      { label: "draft", desc: "Criado, ainda não disparado", color: "text-slate-400 border-slate-200 dark:border-white/10" },
                      { label: "running", desc: "Executando envios em background", color: "text-amber-500 border-amber-200 dark:border-amber-800/40" },
                      { label: "done", desc: "Concluído — sent_count / failed_count atualizados", color: "text-emerald-500 border-emerald-200 dark:border-emerald-800/40" },
                    ].map(({ label, desc, color }) => (
                      <div key={label} className={`rounded-xl border p-3 ${color}`}>
                        <p className="font-mono text-[11px] font-bold uppercase">{label}</p>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{desc}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
                    <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Tabelas</p>
                    <div className="space-y-1.5">
                      {[
                        { table: "campaign_dispatches", desc: "Um disparo por campanha — steps, status, sent_count, failed_count" },
                        { table: "campaign_dispatch_runs", desc: "Um registro por telefone/lead de cada disparo executado" },
                      ].map(({ table, desc }) => (
                        <div key={table} className="flex items-start gap-2 rounded-lg border border-slate-100 px-3 py-2 dark:border-white/8">
                          <code className="shrink-0 font-mono text-[11px] font-bold text-cyan-700 dark:text-cyan-400">{table}</code>
                          <span className="text-[11px] text-slate-500">{desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
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
                  desc: "Webhook Evolution → processa mensagem, roteamento por mode/período, buffer 3s",
                  color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
                },
                {
                  method: "GET",
                  path: "/api/hardcoded-chat-leads",
                  desc: "Lista leads para o Kanban por empresa",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
                },
                {
                  method: "POST",
                  path: "/api/hardcoded-chat-extract",
                  desc: "Gera briefing SDR de uma conversa finalizada (prompt 'extrato' do banco)",
                  color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
                },
                {
                  method: "GET",
                  path: "/api/prompts",
                  desc: "Busca prompt por clientId e type (padrao | campanha | extrato)",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
                },
                {
                  method: "PUT",
                  path: "/api/prompts",
                  desc: "Salva ou atualiza prompt via Editor de Prompts",
                  color: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                },
                {
                  method: "GET",
                  path: "/api/campaigns/:id/dispatches",
                  desc: "Lista disparos de uma campanha",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
                },
                {
                  method: "POST",
                  path: "/api/campaigns/:id/dispatches",
                  desc: "Cria novo disparo (steps, trigger_type, scheduled_at)",
                  color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
                },
                {
                  method: "PATCH",
                  path: "/api/campaigns/dispatches/:id",
                  desc: "Atualiza disparo — steps, nome, status",
                  color: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                },
                {
                  method: "POST",
                  path: "/api/campaigns/dispatches/:id/trigger",
                  desc: "Dispara manualmente — executa em background, atualiza sent_count/failed_count",
                  color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
                },
                {
                  method: "DELETE",
                  path: "/api/campaigns/dispatches/:id",
                  desc: "Remove disparo (não permitido quando status = running)",
                  color: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
                },
                {
                  method: "GET",
                  path: "/api/chatbot-templates/builtins",
                  desc: "Lista templates built-in disponíveis para o dropdown de modelo",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
                },
                {
                  method: "GET",
                  path: "/api/followup-queue",
                  desc: "Fila de leads aguardando recontato",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
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
