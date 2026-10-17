// frontend/src/pages/LandingPage/PlansSection.tsx
// Seção 8 — Planos Comerciais e Tabela Comparativa Completa

import React, { useState } from "react";
import { ArrowRight, Check, ChevronDown, Sparkles, X } from "lucide-react";
import { PLAN_COMPARISON_TABLE, PRICING_PLANS } from "./constants";

interface PlansSectionProps {
  onSelectPlan: (planName: string) => void;
}

export function PlansSection({ onSelectPlan }: PlansSectionProps) {
  const [isTableExpanded, setIsTableExpanded] = useState(false);

  return (
    <section
      id="sec-planos"
      className="relative py-28 px-4 sm:px-8 lg:px-12 max-w-7xl mx-auto border-t border-white/5 overflow-hidden"
    >
      {/* Glow Ambiente Central */}
      <div className="section-ambient-glow glow-purple top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[400px] opacity-35 pointer-events-none" />

      <div className="relative z-10 mb-16 text-center max-w-3xl mx-auto">
        <span className="sec-eyebrow">Investimento</span>
        <h2 className="sec-title">
          Planos transparentes para <strong>cada estágio da sua empresa</strong>
        </h2>
        <p className="sec-lede mt-3">
          Sem contratos de fidelidade. Cancele quando quiser e leve todos os seus dados.
        </p>
      </div>

      {/* 4 Cartões de Planos (Desktop: 4 colunas; Mobile: scroll horizontal / grid) */}
      <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch pt-6">
        {PRICING_PLANS.map((plan) => {
          const isHighlighted = plan.highlighted;

          return (
            <div
              key={plan.id}
              className={`relative rounded-3xl p-6 sm:p-7 flex flex-col justify-between transition-all duration-300 ${
                isHighlighted
                  ? "border-2 border-[#A020F0] bg-gradient-to-b from-[#1E1238] via-[#120B26] to-[#0A0718] shadow-[0_0_40px_rgba(160,32,240,0.45)] lg:-translate-y-3 lg:scale-[1.04] z-20"
                  : "border border-white/10 bg-[#0B0A1C]/80 backdrop-blur-xl hover:border-white/20 z-10"
              }`}
            >
              {/* Selo Mais Escolhido no Plano Avançado */}
              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#C850C0] to-[#4158D0] px-3.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-[0_0_15px_rgba(200,80,192,0.6)] flex items-center gap-1.5 whitespace-nowrap">
                  <Sparkles className="h-3 w-3" />
                  <span>{plan.badge}</span>
                </div>
              )}

              <div>
                {/* Nome e Descrição */}
                <div className="mb-4">
                  <h3 className="text-lg font-bold uppercase tracking-wider text-white">
                    {plan.name}
                  </h3>
                  <p className="text-xs text-white/60 mt-1 min-h-[34px] leading-relaxed">
                    {plan.tagline}
                  </p>
                </div>

                {/* Preço e Setup */}
                <div className="py-4 border-y border-white/8 mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl sm:text-4xl font-black tracking-tight text-white">
                      {plan.price}
                    </span>
                    <span className="text-xs font-mono text-white/50">{plan.period}</span>
                  </div>
                  <p className="text-[11px] font-mono text-[#D7B4FF] mt-1.5 font-medium">
                    {plan.setup}
                  </p>
                </div>

                {/* Header de Continuidade (ex: Tudo do Disparo, mais:) */}
                {plan.featuresHeader && (
                  <p className="text-xs font-bold text-white/80 mb-3 tracking-wide">
                    {plan.featuresHeader}
                  </p>
                )}

                {/* Lista de Features Inclusas */}
                <ul className="space-y-2.5 text-xs text-white/75">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2.5 leading-snug">
                      <Check className="h-4 w-4 text-[#00FF96] shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}

                  {/* Features Excluídas (ex: sem agente no Disparo) */}
                  {plan.excludedFeatures?.map((exFeat) => (
                    <li key={exFeat} className="flex items-start gap-2.5 leading-snug text-white/40">
                      <X className="h-4 w-4 text-white/30 shrink-0 mt-0.5" />
                      <span>{exFeat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Botão de Ação do Plano */}
              <div className="mt-8 pt-4 border-t border-white/5">
                <button
                  onClick={() => onSelectPlan(plan.name)}
                  className={`w-full py-3 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    isHighlighted
                      ? "bg-gradient-to-r from-[#A020F0] via-[#7B1FA2] to-[#4B00FF] text-white hover:brightness-110 shadow-[0_0_20px_rgba(160,32,240,0.5)] active:scale-95"
                      : "bg-white/10 hover:bg-white/15 text-white border border-white/15 active:scale-95"
                  }`}
                >
                  <span>{plan.ctaText}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ========================================================= */}
      {/* TABELA COMPARATIVA COMPLETA                              */}
      {/* ========================================================= */}
      <div className="mt-16 relative z-10">
        {/* Botão de Toggle para Mobile */}
        <div className="md:hidden flex justify-center mb-6">
          <button
            onClick={() => setIsTableExpanded(!isTableExpanded)}
            className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold text-white hover:bg-white/10 transition-colors"
          >
            <span>{isTableExpanded ? "Ocultar tabela comparativa" : "Ver tabela comparativa completa"}</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${isTableExpanded ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* Tabela Comparativa (Sempre visível no desktop, colapsável no mobile) */}
        <div className={`overflow-x-auto rounded-2xl border border-white/10 bg-[#090818]/90 backdrop-blur-xl ${
          isTableExpanded ? "block" : "hidden md:block"
        }`}>
          <table className="w-full text-left text-xs text-white/80 border-collapse">
            <thead>
              <tr className="border-b border-white/10 bg-[#120D2C]/70">
                <th className="py-4 px-5 font-bold uppercase tracking-wider text-white/60">Recursos &amp; Limites</th>
                <th className="py-4 px-4 font-bold text-center text-white">DISPARO</th>
                <th className="py-4 px-4 font-bold text-center text-white">ESSENCIAL</th>
                <th className="py-4 px-4 font-bold text-center text-[#D7B4FF] bg-[#9600FF]/15">
                  AVANÇADO ★
                </th>
                <th className="py-4 px-4 font-bold text-center text-white">PLUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono text-[11px] sm:text-xs">
              {PLAN_COMPARISON_TABLE.map((row) => (
                <tr key={row.feature} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-5 font-sans font-medium text-white/90">{row.feature}</td>
                  <td className="py-3 px-4 text-center text-white/70">{row.disparo}</td>
                  <td className="py-3 px-4 text-center text-white/70">{row.essencial}</td>
                  <td className="py-3 px-4 text-center font-bold text-[#D7B4FF] bg-[#9600FF]/10">
                    {row.avancado}
                  </td>
                  <td className="py-3 px-4 text-center text-white/70">{row.plus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Explicação do Setup Cobrado uma Única Vez */}
        <p className="mt-4 text-center text-xs text-white/55 max-w-2xl mx-auto leading-relaxed">
          * O setup é o trabalho de colocar no ar: conectar os números, importar sua base, treinar o agente com o seu manual comercial e treinar seu time. É cobrado uma única vez.
        </p>
      </div>

      {/* ========================================================= */}
      {/* AS TRÊS LINHAS DE QUEBRA DE OBJEÇÃO                       */}
      {/* ========================================================= */}
      <div className="mt-12 space-y-3 max-w-3xl mx-auto text-center relative z-10">
        <p className="text-xs sm:text-sm text-white/80 font-medium">
          ✓ <strong className="text-white">Todos os planos: sem fidelidade.</strong> Cancela quando quiser, leva seus dados.
        </p>
        <p className="text-xs sm:text-sm text-white/60">
          Precisa de algo que não está no catálogo? <span className="text-[#D7B4FF] font-semibold">Isso é Projeto</span> — escopo e preço fechados antes de começar.
        </p>
        <p className="text-xs sm:text-sm text-white/60">
          Não sabe por onde começar?{" "}
          <a
            href="#sec-diagnostico"
            className="text-[#D7B4FF] underline underline-offset-4 font-bold hover:text-white transition-colors"
          >
            Faça o Diagnóstico Comercial grátis →
          </a>
        </p>
      </div>
    </section>
  );
}
