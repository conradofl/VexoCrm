import { cn } from "@/lib/utils";
import {
  type MeioPagamento,
  MEIO_PAGAMENTO_LABELS
} from "@/lib/geracaoDigital/negotiation";

// Controles reutilizáveis da Mesa de Negociação (pílulas de meio de pagamento
// e input de desconto livre % / R$).

export function MeioPills({ value, onChange, disabled }: { value: MeioPagamento; onChange: (m: MeioPagamento) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-1.5">
      {(Object.keys(MEIO_PAGAMENTO_LABELS) as Exclude<MeioPagamento, "">[]).map((m) => (
        <button
          key={m}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value === m ? "" : m)}
          className={cn(
            "flex-1 rounded-lg py-1.5 text-[11px] font-bold border transition-all",
            value === m
              ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white border-transparent"
              : "bg-white text-slate-600 border-slate-200 hover:border-purple-300"
          )}
        >
          {MEIO_PAGAMENTO_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

export function DescontoLivreInput({
  modo, valor, max, onModo, onValor, alvo
}: {
  modo: "porcentagem" | "valor"; valor: number; max: number;
  onModo: (m: "porcentagem" | "valor") => void; onValor: (v: number) => void; alvo: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
          {(["porcentagem", "valor"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { onModo(m); onValor(0); }}
              className={cn(
                "px-2 py-0.5 text-[9px] font-extrabold rounded-md transition-all",
                modo === m ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
              )}
            >
              {m === "porcentagem" ? "%" : "R$"}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <input
          type="number"
          min="0"
          max={modo === "porcentagem" ? 100 : undefined}
          placeholder={modo === "porcentagem" ? "Ex: 10" : "Ex: 500"}
          value={valor || ""}
          onChange={(e) => {
            const val = Number(e.target.value) || 0;
            onValor(modo === "porcentagem" ? Math.min(100, Math.max(0, val)) : Math.min(max, Math.max(0, val)));
          }}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-800 font-mono focus:outline-none focus:border-purple-500 text-right pr-6"
        />
        <span className="absolute right-2 top-2 text-[10px] font-mono text-slate-400">
          {modo === "porcentagem" ? "%" : "R$"}
        </span>
      </div>
      <p className="text-[10px] text-slate-500 leading-snug font-light">desconto extra sobre {alvo}</p>
    </div>
  );
}

