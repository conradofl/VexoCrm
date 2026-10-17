// frontend/src/pages/LandingPage/FreeDiagnosisSection.tsx
// Seção 10 — Diagnóstico Comercial Grátis (Recuperação de leads parados)

import React from "react";
import { ArrowRight, BarChart3, FileText, Lock, Sparkles, Zap } from "lucide-react";

interface FreeDiagnosisSectionProps {
  onOpenDiagnosis: () => void;
}

export function FreeDiagnosisSection({ onOpenDiagnosis }: FreeDiagnosisSectionProps) {
  return (
    <section
      id="sec-diagnostico"
      className="relative py-24 px-6 sm:px-12 bg-gradient-to-b from-[#140828] via-[#0E061E] to-[#0A0014] border-t border-[#9600FF]/30 overflow-hidden"
    >
      {/* Grandes Feixes de Glow Cósmico */}
      <div className="section-ambient-glow glow-purple top-1/2 left-1/4 -translate-y-1/2 w-[700px] h-[450px] opacity-40 pointer-events-none" />
      <div className="section-ambient-glow glow-indigo bottom-0 right-10 w-[550px] h-[350px] opacity-30 pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        {/* Coluna da Esquerda: Chamada e Texto de Conversão */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#9600FF]/50 bg-[#9600FF]/20 px-3.5 py-1 text-xs text-[#D7B4FF] shadow-[0_0_15px_rgba(150,0,255,0.35)]">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="font-mono uppercase tracking-wider text-[10px] font-bold">
              Diagnóstico Grátis em 10 Minutos
            </span>
          </div>

          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight leading-[1.15]">
            Quanto dinheiro está parado{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#D7B4FF] to-[#9600FF]">
              na sua base?
            </span>
          </h2>

          <p className="text-sm sm:text-base text-white/75 font-light leading-relaxed max-w-xl">
            Responda 12 perguntas e receba, em 10 minutos no seu WhatsApp, um diagnóstico com quantos leads estão esquecidos e quanto isso representa em faturamento recuperável.
          </p>

          <div className="pt-2">
            <button
              onClick={onOpenDiagnosis}
              className="group relative inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-[#A020F0] via-[#7B1FA2] to-[#4B00FF] text-white font-bold text-sm tracking-wide shadow-[0_0_30px_rgba(160,32,240,0.55)] hover:shadow-[0_0_40px_rgba(160,32,240,0.8)] transition-all cursor-pointer hover:scale-[1.02] active:scale-95 animate-pulse-subtle"
            >
              <span>Fazer diagnóstico grátis</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
            <p className="text-[11px] font-mono text-white/40 mt-3 flex items-center gap-1.5">
              <Lock className="h-3 w-3 text-[#00FF96]" />
              <span>Sem custo · Sem compromisso de contratação · 100% sigiloso</span>
            </p>
          </div>
        </div>

        {/* Coluna da Direita: Preview Visual do Relatório PDF */}
        <div className="lg:col-span-5">
          <div className="relative mx-auto max-w-sm rounded-2xl border border-white/15 bg-[#120D2C]/90 p-5 shadow-2xl backdrop-blur-xl rotate-1 hover:rotate-0 transition-transform duration-300 group">
            {/* Tag Flutuante no Topo do Card */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#9600FF]/30 text-[#D7B4FF]">
                  <FileText className="h-4 w-4" />
                </div>
                <span className="text-xs font-bold text-white font-mono">Diagnostico_Comercial.pdf</span>
              </div>
              <span className="rounded-full bg-[#00FF96]/15 border border-[#00FF96]/30 px-2 py-0.5 text-[9px] font-bold text-[#00FF96]">
                Exemplo Real
              </span>
            </div>

            {/* Simulação Visual do PDF */}
            <div className="space-y-3 font-mono text-[10px] sm:text-[11px] text-white/80 bg-black/40 p-4 rounded-xl border border-white/5">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-white/50">Base Total Analisada:</span>
                <span className="font-bold text-white">4.200 contatos</span>
              </div>
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-white/50">Leads Esquecidos (&gt; 90 dias):</span>
                <span className="font-bold text-[#FF6B6B]">2.688 (64%)</span>
              </div>
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-white/50">Taxa Estimada de Resposta:</span>
                <span className="font-bold text-[#00FF96]">62,7%</span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[#D7B4FF] font-bold">Potencial de Recuperação:</span>
                <span className="font-bold text-emerald-400 text-xs">R$ 184.000+</span>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between text-[10px] text-white/40 pt-2 border-t border-white/5">
              <span className="flex items-center gap-1 text-[#D7B4FF]">
                <Zap className="h-3 w-3" />
                <span>Gerado em 10 minutos via WhatsApp</span>
              </span>
              <span>12 perguntas</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
