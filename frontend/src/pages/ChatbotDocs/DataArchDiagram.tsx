import { Zap, Table } from "lucide-react";
import { Arrow } from "./Arrow";

// Extraído de src/pages/ChatbotDocs.tsx (Onda 4 Run F8) — movimento puro, sem alteração de forma.

export function DataArchDiagram() {
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
