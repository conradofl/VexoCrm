// frontend/src/pages/LandingPage/ModulesCatalogSection.tsx
// Seção 6 — Catálogo dos 8 Módulos Funcionais do Vexo OS

import React from "react";
import { CATALOG_MODULES } from "./constants";
import { SpotlightCard } from "./SpotlightCard";

export function ModulesCatalogSection() {
  return (
    <section
      id="sec-modulos"
      className="relative py-28 px-6 sm:px-12 max-w-6xl mx-auto border-t border-white/5 overflow-hidden"
    >
      {/* Glow Ambiente Cósmico */}
      <div className="section-ambient-glow glow-purple top-1/4 -left-20 w-[600px] h-[400px] opacity-30 pointer-events-none" />
      <div className="section-ambient-glow glow-cyan -bottom-20 -right-20 w-[500px] h-[350px] opacity-20 pointer-events-none" />

      <div className="relative z-10 mb-16 text-center max-w-3xl mx-auto">
        <span className="sec-eyebrow">Catálogo Modular</span>
        <h2 className="sec-title">
          Oito módulos. <strong>Você escolhe por onde começar.</strong>
        </h2>
        <p className="sec-lede mt-3">
          Cada plano libera uma quantidade. Todos já estão construídos e funcionando — nada aqui é promessa.
        </p>
      </div>

      {/* Grade de 8 Cartões (4 colunas desktop, 2 tablet, 1 celular) */}
      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {CATALOG_MODULES.map((mod) => {
          const Icon = mod.icon;
          return (
            <SpotlightCard
              key={mod.number}
              className="p-6 rounded-2xl border border-white/8 bg-[#0A0918]/80 backdrop-blur-xl flex flex-col justify-between group transition-all duration-200 hover:-translate-y-1 hover:border-[#9600FF]/50 hover:shadow-[0_10px_30px_rgba(150,0,255,0.25)]"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#9600FF]/20 text-[#D7B4FF] border border-[#9600FF]/35 group-hover:scale-105 group-hover:bg-[#9600FF]/35 group-hover:shadow-[0_0_15px_rgba(150,0,255,0.4)] transition-all">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="font-mono text-xs text-white/30 group-hover:text-white/60 transition-colors">
                    {mod.number}
                  </span>
                </div>

                <h3 className="text-base font-bold text-white mb-2 group-hover:text-[#D7B4FF] transition-colors leading-snug">
                  {mod.title}
                </h3>
              </div>

              <p className="text-xs font-light text-white/65 leading-relaxed mt-2 pt-3 border-t border-white/5">
                {mod.description}
              </p>
            </SpotlightCard>
          );
        })}
      </div>
    </section>
  );
}
