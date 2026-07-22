import React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown } from "lucide-react";
import {
  FORMAS_SETUP,
  FORMAS_MENSALIDADE,
  MAX_PARCELAS,
  type FormaDef,
  type FormasSelecionadas,
  ajustarParcelas,
  alternarForma,
  parcelasDe,
} from "@/lib/geracaoDigital/formasPagamento";

const brl = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  formas: FormasSelecionadas;
  onChange: (f: FormasSelecionadas) => void;
  /** Base do setup, para mostrar o valor da parcela. */
  totalSetup: number;
  /** Mensalidade e meses do plano, para o parcelamento do total do período. */
  mensalidade: number;
  meses: number;
}

/**
 * Formas de pagamento fixas, marcadas por checkbox. O número de parcelas é
 * ajustável por setas — é o que muda de negociação para negociação.
 */
export default function FormasPagamentoEditor({
  formas,
  onChange,
  totalSetup,
  mensalidade,
  meses,
}: Props) {
  const baseDe = (def: FormaDef) =>
    def.id === "cartao_total_parcelado" ? mensalidade * meses : totalSetup;

  const Linha = ({ def }: { def: FormaDef }) => {
    const on = formas.marcadas.includes(def.id);
    const n = parcelasDe(formas, def.id);
    const base = baseDe(def);

    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border px-3 py-2 transition-all",
          on
            ? "bg-purple-50/60 dark:bg-purple-950/20 border-purple-300 dark:border-purple-900/40"
            : "bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700"
        )}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none min-w-0 flex-1">
          <input
            type="checkbox"
            checked={on}
            onChange={() => onChange(alternarForma(formas, def.id))}
            className="accent-purple-600 shrink-0"
          />
          <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
            {def.label}
          </span>
        </label>

        {def.parcelavel && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex items-center gap-1 rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 px-2 py-0.5">
              <span className="text-xs font-black text-slate-800 dark:text-slate-100 tabular-nums w-6 text-right">
                {n}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">x</span>
              <div className="flex flex-col -my-0.5">
                <button
                  type="button"
                  aria-label="Mais uma parcela"
                  disabled={n >= MAX_PARCELAS}
                  onClick={() => onChange(ajustarParcelas(formas, def.id, 1))}
                  className="text-slate-400 hover:text-purple-600 disabled:opacity-30 leading-none"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label="Menos uma parcela"
                  disabled={n <= 1}
                  onClick={() => onChange(ajustarParcelas(formas, def.id, -1))}
                  className="text-slate-400 hover:text-purple-600 disabled:opacity-30 leading-none"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            </div>
            {base > 0 && (
              <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums w-28 text-right">
                de {brl(base / n)}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider block">
          Formas de pagamento a ofertar
        </Label>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Marque as que valem para esta negociação. O cliente escolhe uma de cada na proposta.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-300">
            Setup
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
            {totalSetup > 0 ? brl(totalSetup) : "isento"}
          </span>
        </div>
        {FORMAS_SETUP.map((def) => (
          <Linha key={def.id} def={def} />
        ))}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-black uppercase tracking-wider text-pink-600 dark:text-pink-300">
            Mensalidade
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
            {brl(mensalidade)}/mês · {meses} {meses === 1 ? "mês" : "meses"}
          </span>
        </div>
        {FORMAS_MENSALIDADE.map((def) => (
          <Linha key={def.id} def={def} />
        ))}
      </div>
    </div>
  );
}
