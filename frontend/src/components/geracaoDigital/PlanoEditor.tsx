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
  VEXO_STANDARD_MODULES,
} from "@/lib/geracaoDigital/plano";

const brl = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  plano: Plano;
  onChange: (p: Plano) => void;
  gdProducts: any[];
  vexoProducts: any[];
  isVexoCommercial?: boolean;
}

/**
 * Escopo × prazos. Um escopo, até 4 preços. Sem nome, sem biblioteca:
 * preencher o preço de um prazo É ofertá-lo.
 */
export default function PlanoEditor({ plano, onChange, gdProducts, vexoProducts, isVexoCommercial = false }: Props) {
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

  const combinedVexoModules = [...(vexoProducts || [])];
  VEXO_STANDARD_MODULES.forEach((mod) => {
    if (!combinedVexoModules.some((p) => p.id === mod.id)) {
      combinedVexoModules.push(mod);
    }
  });

  const ItemEscopo = ({ id, nome, lista }: { id: string; nome: string; lista: "gdIds" | "vexoIds" }) => {
    const on = plano[lista].includes(id);
    return (
      <button
        type="button"
        onClick={() => toggle(lista, id)}
        className={cn(
          "px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all flex items-center gap-1 text-left",
          on
            ? "bg-purple-600 text-white border-purple-500 shadow-sm"
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
            {isVexoCommercial
              ? "Selecione o plano estruturado Vexo OS e os módulos/ferramentas de software adicionais."
              : "O que o cliente recebe. Vale igual para todos os prazos."}
          </p>
        </div>

        {/* Bloco GD — Exibido apenas fora do Comercial Vexo */}
        {!isVexoCommercial && (
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
        )}

        {/* Bloco Plano Estruturado Vexo OS */}
        <div className={cn("space-y-2", !isVexoCommercial && "pt-2 border-t border-dashed border-slate-200 dark:border-white/10")}>
          <span className="text-[10px] font-black uppercase tracking-wider text-indigo-500 dark:text-indigo-300 block">
            Plano Estruturado Vexo OS (Selecione 1)
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {/* Card Plano Essencial */}
            <button
              type="button"
              onClick={() => {
                const isSelected = (plano as any).vexoPlan === "essencial" || plano.vexoIds.includes("essencial");
                const newPlan = isSelected ? null : "essencial";
                onChange({
                  ...plano,
                  vexoPlan: newPlan,
                  repasse_vexo_pct: newPlan ? 35 : null,
                  vexoIds: newPlan
                    ? Array.from(new Set([...plano.vexoIds.filter(id => id !== "avancado"), "essencial"]))
                    : plano.vexoIds.filter(id => id !== "essencial"),
                } as any);
              }}
              className={cn(
                "p-3 rounded-xl border text-left transition-all relative space-y-1.5",
                (plano as any).vexoPlan === "essencial" || plano.vexoIds.includes("essencial")
                  ? "bg-emerald-500/10 border-emerald-500 shadow-sm"
                  : "bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 hover:border-emerald-400"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  🟢 Plano Essencial Vexo OS
                </span>
                {((plano as any).vexoPlan === "essencial" || plano.vexoIds.includes("essencial")) && (
                  <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                )}
              </div>
              <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                Repasse 35% mensalidade <span className="text-[10px] font-normal text-slate-500">| 50% setup</span>
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                1 Conexão de Chip, IA de Atendimento & Vendas, Disparos por Planilha, Inbox e Follow-up simples.
              </p>
            </button>

            {/* Card Plano Avançado */}
            <button
              type="button"
              onClick={() => {
                const isSelected = (plano as any).vexoPlan === "avancado" || plano.vexoIds.includes("avancado");
                const newPlan = isSelected ? null : "avancado";
                onChange({
                  ...plano,
                  vexoPlan: newPlan,
                  repasse_vexo_pct: newPlan ? 45 : null,
                  vexoIds: newPlan
                    ? Array.from(new Set([...plano.vexoIds.filter(id => id !== "essencial"), "avancado"]))
                    : plano.vexoIds.filter(id => id !== "avancado"),
                } as any);
              }}
              className={cn(
                "p-3 rounded-xl border text-left transition-all relative space-y-1.5",
                (plano as any).vexoPlan === "avancado" || plano.vexoIds.includes("avancado")
                  ? "bg-purple-500/10 border-purple-500 shadow-sm"
                  : "bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 hover:border-purple-400"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                  🟣 Plano Avançado Vexo OS
                </span>
                {((plano as any).vexoPlan === "avancado" || plano.vexoIds.includes("avancado")) && (
                  <CheckCircle className="h-4 w-4 text-purple-500 shrink-0" />
                )}
              </div>
              <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                Repasse 45% mensalidade <span className="text-[10px] font-normal text-slate-500">| 50% setup</span>
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                Múltiplos Chips, Variações Antiban (Groq AI), Agente por Campanha, Base de Conhecimento RAG, Broadcast SDR, Origem de Leads e Follow-up Avançado.
              </p>
            </button>
          </div>
        </div>

        {/* Bloco Módulos & Ferramentas Vexo OS (Avulsos) */}
        <div className="space-y-1.5 pt-2 border-t border-dashed border-slate-200 dark:border-white/10">
          <span className="text-[10px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400 block">
            Módulos & Ferramentas Vexo OS (Avulsos)
          </span>
          <div className="flex flex-wrap gap-1.5">
            {combinedVexoModules.map((p: any) => (
              <ItemEscopo key={p.id} id={p.id} nome={p.nome} lista="vexoIds" />
            ))}
          </div>
        </div>

        {/* CAMPO DE SETUP 100% PERSONALIZÁVEL */}
        <div className="space-y-1.5 pt-3 border-t border-dashed border-slate-200 dark:border-white/10">
          <Label className="text-xs font-bold text-slate-800 dark:text-slate-200">
            Valor da Taxa de Setup / Implantação (R$)
          </Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-bold">R$</span>
            <Input
              type="number"
              min={0}
              value={(plano as any).valorSetupVexo ?? (plano as any).valor_setup_vexo ?? ""}
              onChange={(e) => {
                const val = e.target.value === "" ? 0 : Math.max(0, Number(e.target.value));
                onChange({
                  ...plano,
                  valorSetupVexo: val,
                  valor_setup_vexo: val,
                  cobrarSetup: val > 0,
                  cobrar_setup: val > 0,
                } as any);
              }}
              placeholder="Ex: 1000"
              className="h-8 text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 w-36"
            />
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Setup 100% personalizável (repasse Vexo: 50%)
            </span>
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
            const descPeriodo = Number(plano.descontosPorPeriodo?.[p.key] || 0);
            const mensalFinal = Math.max(0, mensal * (1 - descPeriodo / 100));
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
                {on && (
                  <div className="flex items-center gap-1.5 ml-2">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">Desc:</span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={plano.descontosPorPeriodo?.[p.key] !== undefined && plano.descontosPorPeriodo?.[p.key] !== 0 ? plano.descontosPorPeriodo[p.key] : ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const val = raw === "" ? 0 : Math.max(0, Math.min(100, Number(raw)));
                        const novosDescontos = {
                          ...(plano.descontosPorPeriodo || { mensal: 0, trimestral: 0, semestral: 0, anual: 0 }),
                          [p.key]: val,
                        };
                        onChange({
                          ...plano,
                          descontosPorPeriodo: novosDescontos,
                        });
                      }}
                      placeholder="0"
                      className="h-8 w-16 text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10"
                    />
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">%</span>
                  </div>
                )}
                <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-auto text-right">
                  {on ? (
                    descPeriodo > 0 ? (
                      <>
                        <span className="line-through text-slate-400 mr-1">{brl(mensal)}</span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">{brl(mensalFinal)}/mês</span>
                        <span className="block text-[9px] text-slate-400">total {brl(mensalFinal * meses)}</span>
                      </>
                    ) : (
                      <>
                        {meses}x · total {brl(mensal * meses)}
                      </>
                    )
                  ) : (
                    "não ofertado"
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <div className="pt-3 border-t border-dashed border-slate-200 dark:border-white/10">
          <div className="space-y-1 max-w-xs">
            <Label className="text-[10px] font-bold text-slate-700 dark:text-slate-300">
              Desconto no Setup (%)
            </Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                max={100}
                value={(plano as any).descontoSetupPorcentagem ?? (plano as any).desconto_setup_pct ?? ""}
                onChange={(e) => {
                  const val = Math.max(0, Math.min(100, Number(e.target.value)));
                  onChange({
                    ...plano,
                    descontoSetupPorcentagem: val,
                    desconto_setup_pct: val
                  } as any);
                }}
                placeholder="0"
                className="h-8 text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10"
              />
              <span className="text-xs text-slate-500">%</span>
            </div>
          </div>
        </div>

        {/* RESUMO DE FATURAMENTO COM DESCONTOS REATIVOS */}
        {(() => {
          const descSetupPct = Math.max(0, Math.min(100, Number((plano as any).descontoSetupPorcentagem ?? (plano as any).desconto_setup_pct ?? 0)));
          const primeiroPrazo = PERIODOS.find((p) => Number(plano.precos[p.key] || 0) > 0);
          const descMensalPct = primeiroPrazo && plano.descontosPorPeriodo?.[primeiroPrazo.key] !== undefined
            ? Math.max(0, Math.min(100, Number(plano.descontosPorPeriodo[primeiroPrazo.key])))
            : Math.max(0, Math.min(100, Number((plano as any).descontoMensalPorcentagem ?? (plano as any).desconto_mensal_pct ?? 0)));

          const setupOriginal = Number((plano as any).valorSetupVexo ?? (plano as any).valor_setup_vexo ?? 0);
          const setupFinal = Math.max(0, setupOriginal * (1 - descSetupPct / 100));

          const mensalOriginal = primeiroPrazo ? Number(plano.precos[primeiroPrazo.key] || 0) : 0;
          const mensalFinal = Math.max(0, mensalOriginal * (1 - descMensalPct / 100));
          const mesesCount = primeiroPrazo ? mesesDoPeriodo(primeiroPrazo.key) : 1;
          const compromissoFinal = mensalFinal * mesesCount;

          const vexoPlanType = (plano as any).vexoPlan || (plano as any).vexo_plan;
          const repasseMensalPct = (plano as any).repasse_vexo_pct ?? (vexoPlanType === "avancado" ? 45 : vexoPlanType === "essencial" ? 35 : 0);
          const repasseMensalVal = Math.round((mensalOriginal * (repasseMensalPct / 100)) * 100) / 100;
          const repasseSetupVal = Math.round((setupOriginal * 0.50) * 100) / 100;

          return (
            <div className="mt-4 p-3 rounded-xl bg-purple-900/10 dark:bg-purple-950/30 border border-purple-300 dark:border-purple-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-purple-700 dark:text-purple-300 block">
                  Resumo de Faturamento
                </span>
                {repasseMensalPct > 0 && (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    Repasse Vexo: {repasseMensalPct}% mensalidade ({brl(repasseMensalVal)}) + 50% setup ({brl(repasseSetupVal)})
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="bg-white/60 dark:bg-slate-800/60 p-2 rounded-lg border border-purple-200/50 dark:border-purple-800/40">
                  <span className="text-[10px] font-bold text-slate-500 block uppercase">Taxa de Setup</span>
                  <div className="flex items-center gap-1">
                    {descSetupPct > 0 && (
                      <span className="line-through text-slate-400 text-[10px]">{brl(setupOriginal)}</span>
                    )}
                    <span className="font-black text-slate-800 dark:text-white">{brl(setupFinal)}</span>
                  </div>
                  {descSetupPct > 0 && <span className="text-[9px] text-emerald-600 font-bold">(-{descSetupPct}%)</span>}
                </div>

                <div className="bg-white/60 dark:bg-slate-800/60 p-2 rounded-lg border border-purple-200/50 dark:border-purple-800/40">
                  <span className="text-[10px] font-bold text-slate-500 block uppercase">Mensalidade</span>
                  <div className="flex items-center gap-1">
                    {descMensalPct > 0 && (
                      <span className="line-through text-slate-400 text-[10px]">{brl(mensalOriginal)}</span>
                    )}
                    <span className="font-black text-slate-800 dark:text-white">{brl(mensalFinal)}/mês</span>
                  </div>
                  {descMensalPct > 0 && <span className="text-[9px] text-emerald-600 font-bold">(-{descMensalPct}%)</span>}
                </div>

                <div className="bg-white/60 dark:bg-slate-800/60 p-2 rounded-lg border border-purple-200/50 dark:border-purple-800/40">
                  <span className="text-[10px] font-bold text-slate-500 block uppercase">Compromisso do Período</span>
                  <span className="font-black text-purple-600 dark:text-purple-400">{brl(setupFinal + compromissoFinal)}</span>
                  {primeiroPrazo && <span className="text-[9px] text-slate-400 block font-normal">({primeiroPrazo.label} · {mesesCount} meses)</span>}
                </div>
              </div>
            </div>
          );
        })()}

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
              VP / permuta (% da mensalidade, opcional)
            </Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                max={100}
                value={plano.vpPercent || ""}
                onChange={(e) =>
                  onChange({ ...plano, vpPercent: Math.max(0, Math.min(100, Number(e.target.value))) })
                }
                placeholder="0"
                className="h-8 text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">%</span>
            </div>
            {plano.vpPercent > 0 && ofertados.length > 0 && (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block">
                {plano.vpPercent}% em permuta, aplicado a todos os prazos
              </span>
            )}
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
