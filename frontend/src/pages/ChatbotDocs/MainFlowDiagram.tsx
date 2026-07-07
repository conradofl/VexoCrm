import { Bot, MessageCircle, Phone, Zap, Clock, CheckCircle2, RotateCcw, Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FlowNode } from "./FlowNode";
import { Arrow } from "./Arrow";

// Extraído de src/pages/ChatbotDocs.tsx (Onda 4 Run F8) — movimento puro, sem alteração de forma.

export function MainFlowDiagram() {
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
