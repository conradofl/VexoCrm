// frontend/src/pages/LandingPage/ModulesCatalogSection.tsx
// Seção 6 — Arquitetura de Verdade: O Núcleo + Os 5 Módulos Comerciais

import React from "react";
import { ArrowDown, Check, Sparkles } from "lucide-react";
import { CATALOG_MODULES, CORE_FOUNDATION } from "./constants";
import { SpotlightCard } from "./SpotlightCard";

export function ModulesCatalogSection() {
  return (
    <section
      id="sec-modulos"
      className="relative py-28 px-4 sm:px-8 lg:px-12 max-w-7xl mx-auto border-t border-white/5 overflow-hidden"
    >
      {/* Glow Ambiente Cósmico */}
      <div className="section-ambient-glow glow-purple top-1/4 -left-20 w-[600px] h-[400px] opacity-30 pointer-events-none" />
      <div className="section-ambient-glow glow-cyan -bottom-20 -right-20 w-[500px] h-[350px] opacity-20 pointer-events-none" />

      {/* Cabeçalho da Seção */}
      <div className="relative z-10 mb-14 text-center max-w-3xl mx-auto">
        <span className="sec-eyebrow">Arquitetura Comercial</span>
        <h2 className="sec-title">
          O Núcleo vem sempre. <strong>Os módulos você escolhe.</strong>
        </h2>
        <p className="sec-lede mt-3">
          Conversas e Banco de Dados estão em todos os planos — é onde tudo acontece. Em cima deles, você ativa exatamente os módulos que sua operação precisa.
        </p>
      </div>

      {/* ========================================================= */}
      {/* 1. O NÚCLEO — TODO PLANO TEM, NÃO SE VENDE SEPARADO      */}
      {/* ========================================================= */}
      <div className="relative z-10 mb-8 rounded-3xl border border-[#9600FF]/35 bg-gradient-to-b from-[#170E32]/90 via-[#0D0920]/90 to-[#070512]/95 backdrop-blur-2xl p-6 sm:p-8 shadow-[0_0_50px_rgba(150,0,255,0.18)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-6 mb-6 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="flex h-3 w-3 rounded-full bg-[#00FF96] shadow-[0_0_10px_#00FF96]" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#00FF96]">
              O NÚCLEO — Vem em todos os planos
            </span>
          </div>
          <span className="text-xs text-white/50 font-sans">
            Todo cliente já começa com operação real no primeiro dia.
          </span>
        </div>

        {/* 2 Colunas do Núcleo: Conversas e Banco de Dados */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {CORE_FOUNDATION.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex flex-col justify-between hover:border-white/20 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-3.5 mb-3.5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#9600FF]/25 text-[#D7B4FF] border border-[#9600FF]/40 shadow-[0_0_15px_rgba(150,0,255,0.3)] shrink-0">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-extrabold tracking-wide text-white uppercase">
                        {item.name}
                      </h3>
                      <p className="text-xs text-[#D7B4FF] font-medium">{item.tagline}</p>
                    </div>
                  </div>

                  <p className="text-xs text-white/70 leading-relaxed mb-4">
                    {item.description}
                  </p>
                </div>

                <ul className="space-y-2 pt-3 border-t border-white/5 text-xs text-white/80">
                  {item.features.map((feat) => (
                    <li key={feat} className="flex items-center gap-2">
                      <Check className="h-3.5 w-3.5 text-[#00FF96] shrink-0" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* ========================================================= */}
      {/* CONECTOR VISUAL: TUDO ABAIXO ACONTECE EM CIMA DISTO       */}
      {/* ========================================================= */}
      <div className="relative z-10 flex flex-col items-center justify-center my-8 text-center">
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-md text-[11px] font-mono text-white/60">
          <ArrowDown className="h-3.5 w-3.5 text-[#D7B4FF] animate-bounce" />
          <span>↑ tudo abaixo acontece em cima disto ↑</span>
        </div>
        <h3 className="text-sm sm:text-base font-bold text-white uppercase tracking-wider mt-3">
          Os Módulos — Você escolhe quantos conforme o plano
        </h3>
        <p className="text-xs text-white/55 mt-1 max-w-lg">
          Cada módulo passa no teste de funcionar sozinho sobre o Núcleo. Sem pegadinhas.
        </p>
      </div>

      {/* ========================================================= */}
      {/* 2. OS 5 MÓDULOS DE VERDADE                                 */}
      {/* ========================================================= */}
      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {CATALOG_MODULES.map((mod) => {
          const Icon = mod.icon;
          return (
            <SpotlightCard
              key={mod.number}
              className="p-5 rounded-2xl border border-white/8 bg-[#0A0918]/85 backdrop-blur-xl flex flex-col justify-between group transition-all duration-200 hover:-translate-y-1 hover:border-[#9600FF]/50 hover:shadow-[0_10px_30px_rgba(150,0,255,0.25)]"
            >
              <div>
                <div className="flex items-center justify-between mb-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#9600FF]/20 text-[#D7B4FF] border border-[#9600FF]/35 group-hover:scale-105 group-hover:bg-[#9600FF]/35 group-hover:shadow-[0_0_15px_rgba(150,0,255,0.4)] transition-all">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="font-mono text-xs text-white/30 group-hover:text-white/60 transition-colors">
                    {mod.number}
                  </span>
                </div>

                <h4 className="text-sm font-bold text-white mb-2 group-hover:text-[#D7B4FF] transition-colors leading-snug">
                  {mod.title}
                </h4>
              </div>

              <p className="text-xs font-light text-white/65 leading-relaxed mt-2 pt-3 border-t border-white/5">
                {mod.description}
              </p>
            </SpotlightCard>
          );
        })}
      </div>

      {/* ========================================================= */}
      {/* TRANSPARÊNCIA: O QUE VIROU FERRAMENTA INTEGRADA           */}
      {/* ========================================================= */}
      <div className="relative z-10 mt-8 rounded-2xl border border-white/8 bg-white/[0.02] p-4 sm:p-5 text-center max-w-4xl mx-auto">
        <p className="text-xs text-white/60 leading-relaxed">
          <strong className="text-white/85">Ferramentas já integradas aos módulos:</strong> Links rastreados e variações anti-bloqueio fazem parte de <span className="text-[#D7B4FF]">Campanhas</span>. A base de conhecimento RAG faz parte do <span className="text-[#D7B4FF]">Agente 24/7</span>. Extração de grupos e Leads parados fazem parte do <span className="text-[#D7B4FF]">Banco de Dados</span>. Nada é vendido incompleto.
        </p>
      </div>
    </section>
  );
}
