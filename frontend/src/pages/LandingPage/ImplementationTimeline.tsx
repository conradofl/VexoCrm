// frontend/src/pages/LandingPage/ImplementationTimeline.tsx
// Seção 7 — Linha do Tempo da Implantação (No ar em três dias)

import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Cpu, Rocket, Smartphone } from "lucide-react";
import { IMPLEMENTATION_STEPS } from "./constants";

export function ImplementationTimeline() {
  const containerRef = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.25 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const icons = [Smartphone, Cpu, Rocket];

  return (
    <section
      ref={containerRef}
      id="sec-implantacao"
      className="relative py-28 px-6 sm:px-12 max-w-6xl mx-auto border-t border-white/5 overflow-hidden"
    >
      {/* Glow Ambiente Cósmico */}
      <div className="section-ambient-glow glow-indigo top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[350px] opacity-25 pointer-events-none" />

      <div className="relative z-10 mb-16 text-center max-w-2xl mx-auto">
        <span className="sec-eyebrow">Agilidade Operacional</span>
        <h2 className="sec-title">
          No ar em <strong>três dias</strong>
        </h2>
        <p className="sec-lede mt-3">
          Sem instalar nada. Sem trocar o número que seus clientes já conhecem.
        </p>
      </div>

      <div className="relative z-10">
        {/* Linha de progresso no Desktop (anima da esquerda para a direita em 1.5s) */}
        <div className="hidden md:block absolute top-[52px] left-[12%] right-[12%] h-[2px] bg-white/10 z-0">
          <div
            className={`h-full bg-gradient-to-r from-[#9600FF] via-[#7B1FA2] to-[#00FF96] transition-all duration-[1500ms] ease-out shadow-[0_0_12px_rgba(150,0,255,0.8)] ${
              isVisible ? "w-full" : "w-0"
            }`}
          />
        </div>

        {/* 3 Passos da Linha do Tempo */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
          {IMPLEMENTATION_STEPS.map((step, idx) => {
            const Icon = icons[idx];
            return (
              <div
                key={step.step}
                className="flex flex-col items-center text-center p-6 rounded-2xl border border-white/8 bg-[#090818]/70 backdrop-blur-md group hover:border-[#9600FF]/40 transition-all duration-300"
              >
                {/* Marcador Numérico Centralizado com Ícone */}
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1C1642] to-[#0D0B24] border border-[#9600FF]/50 text-[#D7B4FF] shadow-[0_0_20px_rgba(150,0,255,0.35)] group-hover:scale-105 group-hover:shadow-[0_0_30px_rgba(150,0,255,0.6)] transition-all mb-5">
                  <Icon className="h-7 w-7 text-white" />
                  <span className="absolute -top-2.5 -right-2.5 rounded-full bg-[#9600FF] text-white text-[10px] font-bold font-mono px-2 py-0.5 shadow-md">
                    {step.step}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-white mb-2 group-hover:text-[#D7B4FF] transition-colors">
                  {step.title}
                </h3>
                <p className="text-xs font-light text-white/65 leading-relaxed max-w-[280px]">
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
