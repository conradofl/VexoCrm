import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";

interface LandingNavbarProps {
  scrollY: number;
  crmHref: string;
  primaryLabel: string;
}

export function LandingNavbar({
  scrollY,
  crmHref,
  primaryLabel,
}: LandingNavbarProps) {
  const [activeNav, setActiveNav] = useState<string>("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const isScrolled = scrollY > 20;

  const navItems = [
    { href: "#sec-tese", id: "sec-tese", label: "Posicionamento" },
    { href: "#sec-metodo", id: "sec-metodo", label: "Método" },
    { href: "#sec-modulos", id: "sec-modulos", label: "Módulos" },
    { href: "#sec-planos", id: "sec-planos", label: "Planos" },
    { href: "#sec-faq", id: "sec-faq", label: "FAQ" },
    { href: "#sec-diagnostico", id: "sec-diagnostico", label: "Diagnóstico" },
  ];

  // Monitora as seções visíveis na rolagem para acender a aba ativa na cápsula
  useEffect(() => {
    function detectActiveSection() {
      if (window.scrollY < 250) {
        setActiveNav("");
        return;
      }

      const offset = 140;
      let currentSection = "";

      for (const item of navItems) {
        const el = document.getElementById(item.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= offset && rect.bottom > offset) {
            currentSection = item.href;
            break;
          }
        }
      }

      if (currentSection) {
        setActiveNav(currentSection);
      }
    }

    window.addEventListener("scroll", detectActiveSection, { passive: true });
    detectActiveSection();

    return () => window.removeEventListener("scroll", detectActiveSection);
  }, []);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    setActiveNav(href);
    const targetId = href.replace("#", "");
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      const topOffset = 85;
      const elementPosition = targetEl.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - topOffset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });
      window.history.pushState(null, "", href);
    }
  };

  const handleLogoClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setActiveNav("");
    setIsMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.history.pushState(null, "", window.location.pathname);
  };

  return (
    <header className={`landing-fixed-navbar ${isScrolled || isMobileMenuOpen ? "is-scrolled" : ""}`}>
      <div className="landing-fixed-navbar-inner">
        {/* Logo Vexo OS com link de volta ao topo */}
        <a
          href="#"
          onClick={handleLogoClick}
          className="flex items-center gap-2.5 sm:gap-3 group focus:outline-none shrink-0"
          title="Vexo OS - Voltar ao topo"
        >
          <div className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#A020F0] via-[#7B1FA2] to-[#4B00FF] text-white font-extrabold text-sm sm:text-lg shadow-[0_0_20px_rgba(160,32,240,0.55)] border border-white/20 transition-all duration-300 group-hover:scale-105 group-hover:shadow-[0_0_28px_rgba(180,60,255,0.85)]">
            V
          </div>
          <div className="flex flex-col">
            <span className="font-extrabold tracking-[0.22em] text-xs sm:text-sm text-white uppercase drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              VEXO OS
            </span>
            <span className="text-[9px] sm:text-[10px] tracking-wider text-[#D7B4FF] uppercase font-mono hidden sm:block">
              Sales Intelligence
            </span>
          </div>
        </a>

        {/* 1. Desktop: Cápsula Completa com Todos os Links (md+) */}
        <nav className="hidden md:flex hero-nav-capsule items-center gap-1 sm:gap-2">
          {navItems.map((item) => {
            const isSelected = activeNav === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={(e) => handleNavClick(e, item.href)}
                className={`hero-nav-link ${isSelected ? "is-selected" : ""}`}
              >
                {item.label}
              </a>
            );
          })}

          {/* Divisor vertical sutil */}
          <div className="h-4 sm:h-5 w-[1px] bg-white/15 mx-1" />

          {/* Botão de Acesso à Plataforma */}
          {crmHref.startsWith("http") ? (
            <a href={crmHref} className="hero-header-cta">
              {primaryLabel}
            </a>
          ) : (
            <Link to={crmHref} className="hero-header-cta">
              {primaryLabel}
            </Link>
          )}
        </nav>

        {/* 2. Mobile: Ações compactas (Acessar + Menu Hamburger) para não estourar a tela */}
        <div className="flex md:hidden items-center gap-2">
          {crmHref.startsWith("http") ? (
            <a
              href={crmHref}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#A020F0] to-[#4B00FF] text-white font-bold text-xs shadow-[0_0_15px_rgba(160,32,240,0.4)] active:scale-95 transition-all"
            >
              Acessar
            </a>
          ) : (
            <Link
              to={crmHref}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#A020F0] to-[#4B00FF] text-white font-bold text-xs shadow-[0_0_15px_rgba(160,32,240,0.4)] active:scale-95 transition-all"
            >
              Acessar
            </Link>
          )}

          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label={isMobileMenuOpen ? "Fechar menu" : "Abrir menu"}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white hover:bg-white/10 hover:border-[#9600FF]/50 transition-all cursor-pointer active:scale-95"
          >
            {isMobileMenuOpen ? (
              <X className="h-5 w-5 text-[#D7B4FF]" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* 3. Mobile Dropdown Menu: Totalmente funcional e adaptado para celular na vertical */}
      {isMobileMenuOpen && (
        <div className="md:hidden w-full bg-[#090818]/98 backdrop-blur-2xl border-b border-white/10 px-5 py-5 space-y-4 shadow-[0_20px_50px_rgba(0,0,0,0.85)] pointer-events-auto animate-in slide-in-from-top-2 duration-200">
          <div className="flex flex-col divide-y divide-white/5">
            {navItems.map((item, idx) => (
              <a
                key={item.href}
                href={item.href}
                onClick={(e) => {
                  handleNavClick(e, item.href);
                  setIsMobileMenuOpen(false);
                }}
                className="flex items-center justify-between py-3 text-sm font-medium text-white/80 hover:text-white transition-colors"
              >
                <span className="flex items-center gap-3">
                  <span className="font-mono text-xs text-[#D7B4FF] opacity-60">0{idx + 1}</span>
                  <span>{item.label}</span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-white/30" />
              </a>
            ))}
          </div>

          <div className="pt-2">
            {crmHref.startsWith("http") ? (
              <a
                href={crmHref}
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#A020F0] via-[#7B1FA2] to-[#4B00FF] text-white font-bold text-center text-xs flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(160,32,240,0.5)]"
              >
                <span>{primaryLabel}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            ) : (
              <Link
                to={crmHref}
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#A020F0] via-[#7B1FA2] to-[#4B00FF] text-white font-bold text-center text-xs flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(160,32,240,0.5)]"
              >
                <span>{primaryLabel}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
