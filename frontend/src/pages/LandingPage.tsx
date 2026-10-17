// frontend/src/pages/LandingPage.tsx
// Landing Page Oficial do Vexo OS — Parte 2 (Com Prova, Catálogo, Implantação, Planos, Diagnóstico e Legal)

import React, { useEffect, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getCrmLoginUrl } from "@/lib/domainRouting";
import { ContentLayer } from "./LandingPage/ContentLayer";
import { HeroLayer } from "./LandingPage/HeroLayer";
import { LandingNavbar } from "./LandingPage/LandingNavbar";
import { LeadCaptureModal } from "./LandingPage/LeadCaptureModal";
import { LegalModal, type LegalDocType } from "./LandingPage/LegalModal";
import "./LandingPage/landing.css";

export default function LandingPage() {
  const { isAuthenticated, isClientUser, defaultRoute } = useAuth();
  const [scrollY, setScrollY] = useState(0);
  const [isHeroOut, setIsHeroOut] = useState(false);

  // Controle do Modal de Conversão (Demo, Diagnóstico ou Plano)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"demo" | "diagnostico" | "plano">("demo");
  const [selectedPlanName, setSelectedPlanName] = useState<string | undefined>(undefined);

  // Controle do Modal Jurídico e Conformidade
  const [isLegalOpen, setIsLegalOpen] = useState(false);
  const [legalDocType, setLegalDocType] = useState<LegalDocType>("privacy");

  const crmLoginUrl = getCrmLoginUrl();
  const crmHref = isAuthenticated ? defaultRoute : crmLoginUrl;
  const primaryLabel = isAuthenticated
    ? isClientUser
      ? "Abrir portal"
      : "Abrir CRM"
    : "Acessar Plataforma";

  useEffect(() => {
    function handleScroll() {
      const y = window.scrollY || 0;
      setScrollY(y);
      if (y > 340) {
        setIsHeroOut(true);
      } else {
        setIsHeroOut(false);
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  function handleOpenModal(
    mode: "demo" | "diagnostico" | "plano" = "demo",
    planName?: string
  ) {
    setModalMode(mode);
    setSelectedPlanName(planName);
    setIsModalOpen(true);
  }

  function handleOpenLegal(docType: LegalDocType) {
    setLegalDocType(docType);
    setIsLegalOpen(true);
  }

  return (
    <div className="relative min-h-screen bg-[#00000A] text-[#F5F5FF] overflow-x-hidden selection:bg-[#9600FF] selection:text-white">
      {/* Barra de Navegação Fixa no Topo que Acompanha toda a rolagem da página */}
      <LandingNavbar
        scrollY={scrollY}
        crmHref={crmHref}
        primaryLabel={primaryLabel}
      />

      {/* Camada Fixa Superior (Hero com o "V" de Vexo e Luz de Lanterna Suave) */}
      <HeroLayer
        isHeroOut={isHeroOut}
        scrollY={scrollY}
        onOpenModal={() => handleOpenModal("demo")}
      />

      {/* Camada Deslizante de Conteúdo (Seções 2 a 12) */}
      <ContentLayer
        onOpenModal={handleOpenModal}
        onOpenLegal={handleOpenLegal}
        crmHref={crmHref}
        primaryLabel={primaryLabel}
      />

      {/* Modal de Captura de Leads / Diagnóstico / Planos */}
      <LeadCaptureModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        mode={modalMode}
        planName={selectedPlanName}
      />

      {/* Modal Jurídico Oficial (Privacidade, Termos e LGPD) */}
      <LegalModal
        isOpen={isLegalOpen}
        docType={legalDocType}
        onClose={() => setIsLegalOpen(false)}
        onSelectDoc={setLegalDocType}
      />

      {/* Barra de CTA Fixa no Rodapé da Tela no Celular */}
      <div
        className={`sm:hidden fixed bottom-0 left-0 right-0 z-40 p-3 bg-[#080716]/95 backdrop-blur-xl border-t border-white/10 flex items-center justify-between gap-3 shadow-[0_-10px_30px_rgba(0,0,0,0.8)] transition-all duration-300 ${
          scrollY > 250 ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex flex-col">
          <span className="text-xs font-bold text-white flex items-center gap-1">
            <span>Vexo OS</span>
            <Sparkles className="h-3 w-3 text-[#D7B4FF]" />
          </span>
          <span className="text-[10px] text-white/50">Planos a partir de R$ 97/mês</span>
        </div>

        <button
          onClick={() => handleOpenModal("diagnostico")}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#9600FF] to-[#4B00FF] text-white text-xs font-bold shadow-[0_0_15px_rgba(150,0,255,0.4)] active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <span>Diagnóstico Grátis</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
