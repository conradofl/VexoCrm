// frontend/src/pages/LandingPage/LandingFooter.tsx
// Seção 12 — Rodapé Institucional Completo com Contato, Endereço/CNPJ, Navegação e Jurídico

import React from "react";
import { FOOTER_NAV_LINKS } from "./constants";
import type { LegalDocType } from "./LegalModal";

interface LandingFooterProps {
  onOpenLegal: (type: LegalDocType) => void;
}

export function LandingFooter({ onOpenLegal }: LandingFooterProps) {
  return (
    <footer className="pt-20 pb-28 sm:pb-14 px-6 sm:px-12 max-w-6xl mx-auto border-t border-white/10 text-xs text-white/60">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-14">
        {/* Coluna 1: Marca & Posicionamento */}
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white p-0.5 shadow-[0_0_12px_rgba(150,0,255,0.4)] border border-white/20">
              <img
                src="/images/vexo-symbol.png"
                alt="Símbolo Vexo"
                className="h-full w-full object-contain rounded-full"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <img
                src="/images/vexo-logo.png"
                alt="VEXO"
                className="h-3.5 sm:h-4 w-auto object-contain"
              />
              <span className="font-extrabold uppercase tracking-widest text-white text-sm">
                OS
              </span>
              <span className="sr-only">VEXO OS</span>
            </div>
          </div>
          <p className="text-xs font-light text-white/70 leading-relaxed max-w-[240px]">
            Inteligência comercial para quem decide vendas.
          </p>
          <p className="text-[11px] font-mono text-white/40 pt-2">
            © 2026 Vexo OS. Todos os direitos reservados.
          </p>
        </div>

        {/* Coluna 2: CONTATO */}
        <div className="space-y-3 font-mono">
          <h4 className="text-xs font-bold uppercase tracking-wider text-white">CONTATO</h4>
          <ul className="space-y-1.5 text-xs text-white/70">
            <li>
              <a
                href="mailto:souvexo.ai@gmail.com"
                className="hover:text-white transition-colors"
              >
                souvexo.ai@gmail.com
              </a>
            </li>
            <li>
              <a
                href="https://wa.me/5534991751267"
                target="_blank"
                rel="noreferrer"
                className="hover:text-white transition-colors"
              >
                (34) 9 9175-1267
              </a>
            </li>
            <li className="text-white/40">Seg a Sex, 8h às 18h</li>
          </ul>
        </div>

        {/* Coluna 3: ENDEREÇO & CNPJ */}
        <div className="space-y-3 font-mono">
          <h4 className="text-xs font-bold uppercase tracking-wider text-white">ENDEREÇO</h4>
          <ul className="space-y-1 text-xs text-white/70">
            <li>Rua Paraná, 65 — Tibery</li>
            <li>Uberlândia, MG</li>
            <li className="text-white/40 pt-1">CNPJ 65.569.191/0001-52</li>
          </ul>
        </div>

        {/* Coluna 4: NAVEGAÇÃO & LEGAL */}
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-white mb-2 font-mono">
              NAVEGAÇÃO
            </h4>
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
              {FOOTER_NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-white/70 hover:text-white transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-white/5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white mb-2 font-mono">
              LEGAL
            </h4>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <button
                type="button"
                onClick={() => onOpenLegal("privacy")}
                className="text-[#D7B4FF] hover:underline cursor-pointer"
              >
                Política de Privacidade
              </button>
              <button
                type="button"
                onClick={() => onOpenLegal("terms")}
                className="text-[#D7B4FF] hover:underline cursor-pointer"
              >
                Termos de Uso
              </button>
              <button
                type="button"
                onClick={() => onOpenLegal("lgpd")}
                className="text-[#D7B4FF] hover:underline cursor-pointer"
              >
                LGPD
              </button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
