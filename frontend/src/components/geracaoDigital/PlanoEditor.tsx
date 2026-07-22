import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CheckCircle } from "lucide-react";
import {
  PERIODOS,
  type Plano,
  type PeriodoKey,
  mesesDoPeriodo,
  prazosOfertados,
} from "@/lib/geracaoDigital/plano";

const brl = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  plano: Plano;
  onChange: (p: Plano) => void;
  gdProducts: any[];
  vexoProducts: any[];
}

/**
 * Escopo × prazos. Um escopo, até 4 preços. Sem nome, sem biblioteca:
 * preencher o preço de um prazo É ofertá-lo.
 */
export default function PlanoEditor({ plano, onChange, gdProducts, vexoProducts }: Props) {
  const toggle = (lista: "gdIds" | "vexoIds", id: string) => {
    const atual = plano[lista];
    onChange({
      ...plano,
      [lista]: atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    });
  };

  const setPreco = (periodo: PeriodoKey, valor: number) =>
    onChange({ ...plano, precos: { ...plano.precos, [periodo]: valor } });

  const totalEscopo = plano.gdIds.length + plano.vexoIds.length;
  const ofertados = prazosOfertados(plano);

  const ItemEscopo = ({ id, nome, lista }: { id: string; nome: string; lista: "gdIds" | "vexoIds" }) => {
    const on = plano[lista].includes(id);
    return (
      <button
        type="button"
        onClick={() => toggle(lista, id)}
        className={cn(
          "px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all flex items-center gap-1 text-left",
          on
            ? "bg-purple-600 text-white border-purple-500"
            : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-purple-300"
        )}
      >
        <span className="truncate">{nome}</span>
        {on && <CheckCircle className="h-3 w-3 shrink-0" />}
      </button>
    );
  };

  return (
    <div className="space-y-5">
      {/* ESCOPO */}
      <div className="space-y-3">
        <div>
          <Label className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider block">
            1. Escopo do plano
          </Label>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            O que o cliente recebe. Vale igual para todos os prazos.
          </p>
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] font-black uppercase tracking-wider text-pink-500 dark:text-pink-300">
            Geração Digital
          </span>
          <div className="flex flex-wrap gap-1.5">
            {gdProducts.map((p: any) => (
              <ItemEscopo key={p.id} id={p.id} nome={p.nome} lista="gdIds" />
            ))}
            {gdProducts.length === 0 && (
              <span className="text-[10px] text-slate-400 italic">
                Nenhum serviço no catálogo. Cadastre na aba Catálogo.
              </span>
            )}
          </div>
        </div>

        <div className="space-y-1.5 pt-2 border-t border-dashed border-slate-200 dark:border-white/10">
          <span className="text-[10px] font-black uppercase tracking-wider text-indigo-500 dark:text-indigo-300">
            Vexo OS
          </span>
          <div className="flex flex-wrap gap-1.5">
            {vexoProducts.map((p: any) => (
              <ItemEscopo key={p.id} id={p.id} nome={p.nome} lista="vexoIds" />
            ))}
            {vexoProducts.length === 0 && (
              <span className="text-[10px] text-slate-400 italic">Nenhum módulo Vexo cadastrado.</span>
            )}
          </div>
        </div>

        <span
          className={cn(
            "text-[10px] font-bold block",
            totalEscopo > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"
          )}
        >
          {totalEscopo} {totalEscopo === 1 ? "item no escopo" : "itens no escopo"}
        </span>
      </div>

      {/* PRAZOS */}
      <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-white/5">
        <div>
          <Label className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider block">
            2. Preço por prazo
          </Label>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Preencha só os prazos que quer ofertar. O cliente escolhe um deles na proposta.
          </p>
        </div>

        <div className="space-y-1.5">
          {PERIODOS.map((p) => {
            const mensal = Number(plano.precos[p.key] || 0);
            const on = mensal > 0;
            const meses = mesesDoPeriodo(p.key);
            return (
              <div
                key={p.key}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2 transition-all",
                  on
                    ? "bg-purple-50/60 dark:bg-purple-950/20 border-purple-300 dark:border-purple-900/40"
                    : "bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700"
                )}
              >
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 w-24 shrink-0">
                  {p.label}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">R$</span>
                  <Input
                    type="number"
                    value={mensal || ""}
                    onChange={(e) => setPreco(p.key, Number(e.target.value))}
                    placeholder="0"
                    className="h-8 w-28 text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10"
                  />
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">/mês</span>
                </div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-auto text-right">
                  {on ? (
                    <>
                      {meses}x · total {brl(mensal * meses)}
                    </>
                  ) : (
                    "não ofertado"
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 pt-1">
          <div className="space-y-1">
            <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
              Preço cheio (R$/mês, opcional)
            </Label>
            <Input
              type="number"
              value={plano.valorTabelaMensal || ""}
              onChange={(e) => onChange({ ...plano, valorTabelaMensal: Number(e.target.value) })}
              placeholder="Exibe riscado na proposta"
              className="h-8 text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
              Parte em VP / permuta (R$/mês, opcional)
            </Label>
            <Input
              type="number"
              value={plano.vpMensal || ""}
              onChange={(e) => onChange({ ...plano, vpMensal: Number(e.target.value) })}
              placeholder="0"
              className="h-8 text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10"
            />
          </div>
        </div>

        {ofertados.length > 0 && (
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block">
            {ofertados.length === 1
              ? "1 prazo será exibido na proposta."
              : `${ofertados.length} prazos serão exibidos na proposta para o cliente escolher.`}
          </span>
        )}
      </div>
    </div>
  );
}
