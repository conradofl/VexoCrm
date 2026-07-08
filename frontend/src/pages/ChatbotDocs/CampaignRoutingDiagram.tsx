import { Bot, Megaphone, Shuffle } from "lucide-react";
import { FlowNode } from "./FlowNode";
import { Arrow } from "./Arrow";

// Extraído de src/pages/ChatbotDocs.tsx (Onda 4 Run F8) — movimento puro, sem alteração de forma.

export function CampaignRoutingDiagram() {
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
