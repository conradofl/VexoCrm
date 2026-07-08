import { Bot, Database, MessageCircle, Clock, AlertCircle } from "lucide-react";
import { Arrow } from "./Arrow";

// Extraído de src/pages/ChatbotDocs.tsx (Onda 4 Run F8) — movimento puro, sem alteração de forma.

export function BufferDiagram() {
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
