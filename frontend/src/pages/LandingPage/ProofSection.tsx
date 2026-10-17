// frontend/src/pages/LandingPage/ProofSection.tsx
// Seção 2 — Prova Real (Números medidos de operação real)

import React, { useEffect, useRef, useState } from "react";
import { PROOF_METRICS } from "./constants";

export function ProofSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Caso o ambiente não suporte IntersectionObserver (ex: testes vitest), ativa imediatamente
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
      { threshold: 0.35 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="sec-prova"
      className="relative py-20 px-6 sm:px-12 bg-[#04040A] border-y border-white/5 overflow-hidden"
    >
      {/* Glow sutil central */}
      <div className="section-ambient-glow glow-purple top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[260px] opacity-25 pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 text-center">
          {PROOF_METRICS.map((metric, idx) => (
            <ProofMetricCard
              key={metric.label}
              target={metric.targetValue}
              suffix={metric.suffix}
              label={metric.label}
              decimals={metric.decimals}
              start={isVisible}
              delay={idx * 150}
            />
          ))}
        </div>

        {/* Linha de autoridade e seriedade B2B */}
        <p className="mt-10 text-center text-xs font-mono tracking-wider text-white/40 uppercase">
          Números de operação real, não de simulação.
        </p>
      </div>
    </section>
  );
}

interface ProofMetricCardProps {
  target: number;
  suffix: string;
  label: string;
  decimals: number;
  start: boolean;
  delay: number;
}

function ProofMetricCard({
  target,
  suffix,
  label,
  decimals,
  start,
  delay,
}: ProofMetricCardProps) {
  const [displayValue, setDisplayValue] = useState<number>(0);

  useEffect(() => {
    if (!start) return;

    const timer = setTimeout(() => {
      let startTime: number | null = null;
      let animId: number;
      const duration = 1200; // 1,2s conforme especificação

      function animate(now: number) {
        if (!startTime) startTime = now;
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Curva easeOutCubic para desaceleração natural ao final
        const ease = 1 - Math.pow(1 - progress, 3);
        const current = ease * target;

        setDisplayValue(current);

        if (progress < 1) {
          animId = requestAnimationFrame(animate);
        } else {
          setDisplayValue(target);
        }
      }

      animId = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(animId);
    }, delay);

    return () => clearTimeout(timer);
  }, [start, target, delay]);

  const formatted =
    decimals > 0
      ? displayValue.toFixed(decimals).replace(".", ",")
      : Math.round(displayValue).toString();

  return (
    <div className="flex flex-col items-center justify-center p-6 rounded-2xl border border-white/5 bg-[#090818]/60 backdrop-blur-sm hover:border-[#9600FF]/30 transition-all duration-300">
      <div className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-[#D7B4FF] to-[#9600FF] drop-shadow-[0_0_24px_rgba(150,0,255,0.45)]">
        {formatted}
        {suffix}
      </div>
      <div className="mt-3 text-xs sm:text-sm font-light text-white/60 max-w-[220px] leading-relaxed">
        {label}
      </div>
    </div>
  );
}
