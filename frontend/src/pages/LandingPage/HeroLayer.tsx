import React from "react";
import { ArrowRight } from "lucide-react";
import { LightBeamCanvas } from "./LightBeamCanvas";

interface HeroLayerProps {
  isHeroOut: boolean;
  scrollY?: number;
  onOpenModal: () => void;
  crmHref?: string;
  primaryLabel?: string;
}

export function HeroLayer({
  isHeroOut,
  scrollY = 0,
  onOpenModal,
}: HeroLayerProps) {
  // Transição contínua suave e cinematográfica ao rolar a página
  const progress = Math.min(1, Math.max(0, scrollY / 380));
  const heroOpacity = isHeroOut ? 0 : Math.max(0, 1 - progress * 1.15);
  const heroTranslateY = -progress * 60;
  const heroScale = 1 - progress * 0.04;
  // O desfoque óptico só entra suavemente no terço final da saída, mantendo o texto nítido no início
  const heroBlur = progress > 0.55 ? (progress - 0.55) * 14 : 0;
  const isPointerDisabled = isHeroOut || progress > 0.85;

  return (
    <div
      id="layer-hero"
      className={isHeroOut ? "is-out" : ""}
      style={{
        opacity: heroOpacity,
        transform: `translateY(${heroTranslateY}px) scale(${heroScale})`,
        filter: heroBlur > 0.2 ? `blur(${heroBlur}px)` : "none",
        pointerEvents: isPointerDisabled ? "none" : "auto",
        transition: "opacity 0.15s ease-out, transform 0.15s ease-out",
        willChange: "opacity, transform, filter",
      }}
    >
      {/* Background Interativo: V Emblem Cyber + Luz Suave de Lanterna */}
      <LightBeamCanvas />

      <div className="hero-inner">
        {/* Espaçador superior preservando o centro perfeito do Hero abaixo da Navbar fixa */}
        <div className="hero-top-spacer h-12 sm:h-14 w-full flex-shrink-0" aria-hidden="true" />

        {/* Centro de Conversão */}
        <div className="hero-content">
          <div className="flex flex-col gap-3.5 sm:gap-4">
            <h1 className="hero-h1">
              A inteligência comercial para{" "}
              <strong>quem decide vendas</strong>
            </h1>
            <p className="hero-p">
              Você não precisa virar dev ou analista de CRM. Precisa transformar planilhas e conversas de WhatsApp em vendas e contratos assinados.
            </p>
          </div>

          <div className="flex justify-center pt-2 sm:pt-3">
            <button
              onClick={onOpenModal}
              className="xp-btn"
            >
              <span>Conhecer Vexo OS</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Rodapé do Hero: Tópicos de autoridade à esquerda 100% visíveis + indicador de rolagem */}
        <div className="hero-bottom">
          <ul className="hero-bottom-list">
            <li>De gente de Negócio, Para gente de Negócio</li>
            <li>Milhares de conversas ativadas no ecossistema</li>
            <li>Você sempre no controle do funil &amp; Contratos em PDF</li>
          </ul>

          <div
            className="hero-scroll-cue"
            style={{
              opacity: scrollY > 25 ? 0 : 0.85,
              transition: "opacity 0.3s ease",
            }}
          >
            <a
              href="#sec-tese"
              className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60 hover:text-white hover:border-white/20 transition-all"
            >
              <span className="font-medium tracking-wide">Role para explorar</span>
              <span className="text-[11px] transition-transform group-hover:translate-y-0.5">↓</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
