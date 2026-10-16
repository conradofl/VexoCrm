// frontend/src/pages/LandingPage.tsx
//
// Landing Page Oficial do Vexo OS
// Inspirada na arquitetura visual e mecânica do Xperiun:
// - Elemento central "V" em neon roxo volumétrico (Variante B - Cyber Wings)
// - Dual-layer fixed scroll com transição progressiva suave (#layer-hero + #layer-content)
// - Modal de alta conversão para captura de leads e encaminhamento para WhatsApp

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getCrmLoginUrl } from "@/lib/domainRouting";
import { ContentLayer } from "./LandingPage/ContentLayer";
import { HeroLayer } from "./LandingPage/HeroLayer";
import { LeadCaptureModal } from "./LandingPage/LeadCaptureModal";
import "./LandingPage/landing.css";

export default function LandingPage() {
  const { isAuthenticated, isClientUser, defaultRoute } = useAuth();
  const [scrollY, setScrollY] = useState(0);
  const [isHeroOut, setIsHeroOut] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  return (
    <div className="relative min-h-screen bg-[#00000A] text-[#F5F5FF] overflow-x-hidden selection:bg-[#9600FF] selection:text-white">
      {/* Camada Fixa Superior (Hero com o "V" de Vexo e Luz de Lanterna Suave) */}
      <HeroLayer
        isHeroOut={isHeroOut}
        scrollY={scrollY}
        onOpenModal={() => setIsModalOpen(true)}
        crmHref={crmHref}
        primaryLabel={primaryLabel}
      />

      {/* Camada Deslizante de Conteúdo (Módulos, Pilares, FAQ e Rodapé) */}
      <ContentLayer
        onOpenModal={() => setIsModalOpen(true)}
        crmHref={crmHref}
        primaryLabel={primaryLabel}
      />

      {/* Modal de Captura de Leads com Backdrop de Vidro */}
      <LeadCaptureModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
