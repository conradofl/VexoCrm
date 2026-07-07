import { CheckCircle2, RotateCcw, Server, ArrowRight } from "lucide-react";

// Extraído de src/pages/ChatbotDocs.tsx (Onda 4 Run F8) — movimento puro, sem alteração de forma.

export function SdrFlowDiagram() {
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
