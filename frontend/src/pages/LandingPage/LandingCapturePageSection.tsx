// frontend/src/pages/LandingPage/LandingCapturePageSection.tsx
// Seção Especial — Módulo 06: Página de Captação Nativa do Vexo OS
// "Sua página não precisa ser só uma página"

import React from "react";
import { Activity, ArrowRight, FileText, Link2, Sparkles } from "lucide-react";
import { SpotlightCard } from "./SpotlightCard";

interface LandingCapturePageSectionProps {
  onOpenModal: (mode?: "demo" | "diagnostico" | "plano") => void;
}

export function LandingCapturePageSection({ onOpenModal }: LandingCapturePageSectionProps) {
  const pillars = [
    {
      id: "modelos",
      emoji: "📄",
      icon: FileText,
      title: "Modelos prontos",
      description: "Você escolhe, a gente monta. No ar em 3 dias.",
      tag: "Design Fechado & Testado",
    },
    {
      id: "funil",
      emoji: "🔗",
      icon: Link2,
      title: "Conectada ao seu funil",
      description: "Preencheu, virou lead. Sem planilha no meio.",
      tag: "Disparo Instantâneo",
    },
    {
      id: "jornada",
      emoji: "📊",
      icon: Activity,
      title: "Você vê a jornada",
      description: "Quem leu o quê, por quanto tempo, e o que clicou.",
      tag: "Telemetria & LGPD",
    },
  ];

  return (
    <section
      id="sec-pagina-captura"
      className="relative py-28 px-4 sm:px-8 lg:px-12 max-w-7xl mx-auto border-t border-white/5 overflow-hidden"
    >
      {/* Glow Ambiente Cósmico */}
      <div className="section-ambient-glow glow-purple top-1/3 -left-20 w-[600px] h-[400px] opacity-35 pointer-events-none" />
      <div className="section-ambient-glow glow-cyan -bottom-20 -right-20 w-[550px] h-[400px] opacity-25 pointer-events-none" />

      {/* Cabeçalho da Seção */}
      <div className="relative z-10 max-w-3xl mx-auto text-center mb-12">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#00FF96]/40 bg-[#00FF96]/10 px-3.5 py-1 text-xs text-[#00FF96] mb-5 shadow-[0_0_15px_rgba(0,255,150,0.2)]">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="font-mono uppercase tracking-wider text-[11px] font-bold">
            Módulo 06 · Captação Nativa
          </span>
        </div>

        <h2 className="sec-title text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight">
          Sua página não precisa ser <strong>só uma página</strong>
        </h2>

        <div className="sec-lede mt-5 space-y-3 text-white/70 text-sm sm:text-base leading-relaxed">
          <p>
            A maioria das empresas tem uma página que mostra o que ela faz e para por aí. O visitante lê, vai embora, e ninguém sabe que ele esteve lá.
          </p>
          <p>
            A sua página no Vexo é a <strong>porta de entrada do seu comercial</strong>. Quem preenche vira lead no seu funil na hora, recebe mensagem no WhatsApp em segundos, e entra na sua régua de follow-up.
          </p>
          <p className="text-white/85 font-medium">
            E quando o vendedor abre a conversa, ele já sabe o que essa pessoa leu, quanto tempo ficou e em qual plano clicou.
          </p>
        </div>
      </div>

      {/* Destaque da Frase de Ouro Comercial */}
      <div className="relative z-10 max-w-2xl mx-auto mb-12 text-center">
        <div className="rounded-2xl border border-[#9600FF]/40 bg-gradient-to-r from-[#9600FF]/15 via-[#140F30]/80 to-[#00FF96]/15 p-4 sm:p-5 shadow-[0_0_30px_rgba(150,0,255,0.2)] backdrop-blur-xl">
          <p className="text-sm sm:text-base font-bold text-white tracking-wide">
            “Quem preencheu sua página chega no WhatsApp do seu vendedor já sabendo o que ela leu.”
          </p>
        </div>
      </div>

      {/* Os 3 Blocos de Funcionalidade */}
      <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        {pillars.map((item) => {
          const Icon = item.icon;
          return (
            <SpotlightCard
              key={item.id}
              className="p-6 sm:p-8 rounded-3xl border border-white/10 bg-[#0C0A1E]/85 backdrop-blur-2xl flex flex-col justify-between group transition-all duration-300 hover:-translate-y-1.5 hover:border-[#9600FF]/50 hover:shadow-[0_15px_35px_rgba(150,0,255,0.25)]"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#9600FF]/20 text-[#D7B4FF] border border-[#9600FF]/35 group-hover:scale-110 group-hover:bg-[#9600FF]/35 group-hover:shadow-[0_0_20px_rgba(150,0,255,0.4)] transition-all">
                    <Icon className="h-6 w-6" />
                  </div>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[#00FF96] bg-[#00FF96]/10 px-2.5 py-1 rounded-full border border-[#00FF96]/20">
                    {item.tag}
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">{item.emoji}</span>
                  <h3 className="text-lg font-bold text-white group-hover:text-[#D7B4FF] transition-colors">
                    {item.title}
                  </h3>
                </div>

                <p className="text-xs sm:text-sm font-light text-white/70 leading-relaxed">
                  {item.description}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-white/5 flex items-center gap-2 text-[11px] font-mono text-white/40 group-hover:text-white/70 transition-colors">
                <span>Incluso no módulo</span>
                <span className="text-[#00FF96]">✓</span>
              </div>
            </SpotlightCard>
          );
        })}
      </div>

      {/* Botão de Chamada para Ação (CTA) */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center">
        <button
          type="button"
          onClick={() => onOpenModal("diagnostico")}
          className="group relative inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-[#9600FF] via-[#7B00D4] to-[#00FF96] text-white font-extrabold text-sm sm:text-base tracking-wide shadow-[0_0_35px_rgba(150,0,255,0.45)] hover:shadow-[0_0_50px_rgba(0,255,150,0.5)] hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer border border-white/20"
        >
          <span>Quero minha página conectada</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </button>

        <p className="mt-3 text-xs text-white/45 font-sans">
          Setup único com modelo, conteúdo, publicação e conexão ao seu WhatsApp inclusos.
        </p>
      </div>
    </section>
  );
}
