import { RotateCcw } from "lucide-react";
import { type NegotiationResult } from "@/lib/geracaoDigital/negotiation";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Painel das concessões acumuladas da Mesa de Negociação: camadas
// antes → depois por trilha (entrada/mensalidade) e total concedido.
export function ConcessionsPanel({
  result,
  parcelas,
  onReset
}: {
  result: NegotiationResult;
  parcelas: number;
  onReset: () => void;
}) {
  return (
    <div className="rounded-3xl bg-white/85 backdrop-blur border border-emerald-200 shadow-lg p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-emerald-600">
          Concessões desta negociação
        </h3>
        <button onClick={onReset} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1">
          <RotateCcw className="h-3 w-3" /> limpar
        </button>
      </div>

      {result.camadasSetup.length > 0 && (
        <div className="space-y-1">
          <span className="text-[9px] font-black uppercase text-purple-500">Entrada · original {brl(result.entradaOriginal)}</span>
          {result.camadasSetup.map((c, idx) => (
            <div key={idx} className="flex items-center justify-between text-[11px] gap-3">
              <span className="text-slate-700 font-medium">{c.label}</span>
              <span className="font-mono font-bold text-emerald-600 shrink-0">
                {brl(c.antes)} → {brl(c.depois)}
              </span>
            </div>
          ))}
        </div>
      )}

      {result.camadasMensalidade.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-dashed border-emerald-100">
          <span className="text-[9px] font-black uppercase text-blue-500">Mensalidade · original {brl(result.mensalidadeOriginal)}/mês</span>
          {result.camadasMensalidade.map((c, idx) => (
            <div key={idx} className="flex items-center justify-between text-[11px] gap-3">
              <span className="text-slate-700 font-medium">{c.label}</span>
              <span className="font-mono font-bold text-emerald-600 shrink-0">
                {brl(c.antes)} → {brl(c.depois)}/mês
              </span>
            </div>
          ))}
        </div>
      )}

      {parcelas > 1 && (
        <p className="text-[11px] text-slate-700 font-medium pt-2 border-t border-dashed border-emerald-100">
          Entrada dividida em {parcelas}x de {brl(result.valorParcela)} (mensalidade à parte)
        </p>
      )}

      <div className="pt-2 border-t border-emerald-200 flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-black">
        <span className="text-slate-800">
          Total concedido na entrada: <span className="text-emerald-600 font-mono">{brl(result.totalConcedidoSetup)}</span>
        </span>
        <span className="text-slate-800">
          Total concedido na mensalidade: <span className="text-emerald-600 font-mono">{brl(result.totalConcedidoMensalidade)}/mês</span>
        </span>
      </div>
    </div>
  );
}
