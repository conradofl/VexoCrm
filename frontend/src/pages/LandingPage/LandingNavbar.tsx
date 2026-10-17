import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

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
  const isScrolled = scrollY > 20;

  const navItems = [
    { href: "#sec-tese", id: "sec-tese", label: "Posicionamento" },
    { href: "#sec-metodo", id: "sec-metodo", label: "Método" },
    { href: "#sec-modulos", id: "sec-modulos", label: "Módulos" },
    { href: "#sec-faq", id: "sec-faq", label: "FAQ" },
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
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.history.pushState(null, "", window.location.pathname);
  };

  return (
    <header className={`landing-fixed-navbar ${isScrolled ? "is-scrolled" : ""}`}>
      <div className="landing-fixed-navbar-inner">
        {/* Logo Vexo OS com link de volta ao topo */}
        <a
          href="#"
          onClick={handleLogoClick}
          className="flex items-center gap-3 group focus:outline-none"
          title="Vexo OS - Voltar ao topo"
        >
          <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#A020F0] via-[#7B1FA2] to-[#4B00FF] text-white font-extrabold text-base sm:text-lg shadow-[0_0_20px_rgba(160,32,240,0.55)] border border-white/20 transition-all duration-300 group-hover:scale-105 group-hover:shadow-[0_0_28px_rgba(180,60,255,0.85)]">
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

        {/* Barra de Navegação em Cápsula Fosca com Iluminação Neon no Hover e Seleção */}
        <nav className="hero-nav-capsule flex items-center gap-1 sm:gap-2">
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
          <div className="hidden sm:block h-4 sm:h-5 w-[1px] bg-white/15 mx-1" />

          {/* Botão de Acesso à Plataforma */}
          {crmHref.startsWith("http") ? (
            <a
              href={crmHref}
              className="hero-header-cta"
            >
              {primaryLabel}
            </a>
          ) : (
            <Link
              to={crmHref}
              className="hero-header-cta"
            >
              {primaryLabel}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
