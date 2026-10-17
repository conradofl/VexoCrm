// frontend/src/pages/LandingPage/ContentLayer.tsx
// Orquestrador de Conteúdo (Seções 2 a 12) na nova ordem estruturada

import React, { useState, useRef, useEffect } from "react";
import { ArrowRight, Bot, Check, FileSignature, Plus, RefreshCw, Sparkles } from "lucide-react";
import { FAQS } from "./constants";
import { FreeDiagnosisSection } from "./FreeDiagnosisSection";
import { ImplementationTimeline } from "./ImplementationTimeline";
import { LandingFooter } from "./LandingFooter";
import type { LegalDocType } from "./LegalModal";
import { LiveChatSimulator } from "./LiveChatSimulator";
import { ModulesCatalogSection } from "./ModulesCatalogSection";
import { PlansSection } from "./PlansSection";
import { ProofSection } from "./ProofSection";
import { SpotlightCard } from "./SpotlightCard";

interface ContentLayerProps {
  onOpenModal: (mode?: "demo" | "diagnostico" | "plano", planName?: string) => void;
  onOpenLegal: (type: LegalDocType) => void;
  crmHref: string;
  primaryLabel: string;
}

export function ContentLayer({
  onOpenModal,
  onOpenLegal,
  crmHref,
  primaryLabel,
}: ContentLayerProps) {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  // Efeito de surgimento suave da direita para a esquerda para a simulação da IA
  const [isSimulatorVisible, setIsSimulatorVisible] = useState(false);
  const simulatorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setIsSimulatorVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsSimulatorVisible(true);
        }
      },
      { threshold: 0.15 }
    );

    if (simulatorRef.current) {
      observer.observe(simulatorRef.current);
    }

    return () => observer.disconnect();
  }, []);

  function toggleFaq(index: number) {
    setOpenFaqIndex((prev) => (prev === index ? null : index));
  }

  return (
    <div id="layer-content">
      {/* ========================================================= */}
      {/* 2. SEÇÃO PROVA (NOVA - LOGO APÓS O HERO)                 */}
      {/* ========================================================= */}
      <ProofSection />

      {/* ========================================================= */}
      {/* 3. SEÇÃO POSICIONAMENTO / TESE (COM NEBULA CÓSMICA)      */}
      {/* ========================================================= */}
      <section
        id="sec-tese"
        className="relative py-28 px-6 sm:px-12 max-w-5xl mx-auto border-b border-white/5 overflow-hidden"
      >
        <div className="section-ambient-glow glow-purple top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[380px] opacity-40 pointer-events-none" />

        <div className="relative z-10 space-y-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#9600FF]/40 bg-[#9600FF]/15 px-3 py-1 text-xs text-[#D7B4FF] shadow-[0_0_15px_rgba(150,0,255,0.25)]">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="font-mono uppercase tracking-wider text-[10px]">Posicionamento Vexo</span>
          </div>

          <p className="manifesto-line">
            Outros CRMs foram desenhados para burocracia e preenchimento de campos infinitos.
          </p>
          <p className="manifesto-line active">
            O <strong>Vexo OS</strong> foi construído para acelerar conversas e fechar contratos no WhatsApp.
          </p>
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-16 pt-4">
            <p className="manifesto-line text-white/40">Não é melhor nem pior.</p>
            <p className="manifesto-line text-white/90 font-medium">É outro endereço.</p>
          </div>
        </div>
      </section>

      {/* ========================================================= */}
      {/* 4. SEÇÃO MÉTODO VEXO (4 PRINCÍPIOS BUSINESS-FIRST)       */}
      {/* ========================================================= */}
      <section id="sec-metodo" className="relative py-24 px-6 sm:px-12 max-w-6xl mx-auto overflow-hidden">
        <div className="section-ambient-glow glow-indigo -top-16 -left-16 w-[580px] h-[420px] opacity-35 pointer-events-none" />
        <div className="section-ambient-glow glow-cyan -bottom-20 -right-20 w-[480px] h-[380px] opacity-25 pointer-events-none" />

        <div className="relative z-10 mb-14">
          <span className="sec-eyebrow">Business-First</span>
          <h2 className="sec-title">
            Método Vexo de acelerar vendas <strong>pra quem decide</strong>
          </h2>
          <p className="sec-lede">
            Quatro princípios que fazem nossa tecnologia funcionar pra quem vive de resultado comercial.
          </p>
        </div>

        <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-6">
          <SpotlightCard className="p-8 ambient-card group">
            <div className="flex items-center justify-between mb-4">
              <div className="font-mono text-xs font-bold text-[#D7B4FF] bg-[#9600FF]/20 border border-[#9600FF]/40 rounded-lg px-2.5 py-0.5 shadow-[0_0_10px_rgba(150,0,255,0.3)]">
                01
              </div>
              <span className="text-[10px] uppercase font-mono text-white/30 group-hover:text-white/60 transition-colors">Agilidade</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2 group-hover:text-[#D7B4FF] transition-colors">
              Decisão antes da burocracia.
            </h3>
            <p className="text-sm font-light text-white/65 leading-relaxed">
              O vendedor não pode perder tempo alimentando 30 campos de formulário. O Vexo OS resume a conversa e sugere o próximo passo.
            </p>
          </SpotlightCard>

          <SpotlightCard className="p-8 ambient-card group">
            <div className="flex items-center justify-between mb-4">
              <div className="font-mono text-xs font-bold text-[#D7B4FF] bg-[#9600FF]/20 border border-[#9600FF]/40 rounded-lg px-2.5 py-0.5 shadow-[0_0_10px_rgba(150,0,255,0.3)]">
                02
              </div>
              <span className="text-[10px] uppercase font-mono text-white/30 group-hover:text-white/60 transition-colors">Naturalidade</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2 group-hover:text-[#D7B4FF] transition-colors">
              Conversa antes da ferramenta.
            </h3>
            <p className="text-sm font-light text-white/65 leading-relaxed">
              A venda acontece na conversa real de WhatsApp. O sistema opera como suporte invisível, sem travar o ritmo comercial.
            </p>
          </SpotlightCard>

          <SpotlightCard className="p-8 ambient-card group">
            <div className="flex items-center justify-between mb-4">
              <div className="font-mono text-xs font-bold text-[#D7B4FF] bg-[#9600FF]/20 border border-[#9600FF]/40 rounded-lg px-2.5 py-0.5 shadow-[0_0_10px_rgba(150,0,255,0.3)]">
                03
              </div>
              <span className="text-[10px] uppercase font-mono text-white/30 group-hover:text-white/60 transition-colors">Controle</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2 group-hover:text-[#D7B4FF] transition-colors">
              Trava humana antes da autonomia cega.
            </h3>
            <p className="text-sm font-light text-white/65 leading-relaxed">
              A IA qualifica e responde, mas a decisão do vendedor é sagrada e inviolável. Nenhuma automação sobrescreve a escolha da sua equipe.
            </p>
          </SpotlightCard>

          <SpotlightCard className="p-8 ambient-card group">
            <div className="flex items-center justify-between mb-4">
              <div className="font-mono text-xs font-bold text-[#D7B4FF] bg-[#9600FF]/20 border border-[#9600FF]/40 rounded-lg px-2.5 py-0.5 shadow-[0_0_10px_rgba(150,0,255,0.3)]">
                04
              </div>
              <span className="text-[10px] uppercase font-mono text-white/30 group-hover:text-white/60 transition-colors">Fechamento</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2 group-hover:text-[#D7B4FF] transition-colors">
              Contrato assinado antes da vaidade.
            </h3>
            <p className="text-sm font-light text-white/65 leading-relaxed">
              Métrica de vaidade não paga conta. Nosso foco é gerar a minuta comercial em PDF e coletar a assinatura na hora certa.
            </p>
          </SpotlightCard>
        </div>
      </section>

      {/* ========================================================= */}
      {/* 5. SEÇÃO SIMULAÇÃO AO VIVO (REATIVAÇÃO DE BASE PARADA)    */}
      {/* ========================================================= */}
      <section id="sec-simulacao" className="relative py-24 px-6 sm:px-12 max-w-6xl mx-auto border-t border-white/5 overflow-hidden">
        <div className="section-ambient-glow glow-purple top-1/3 right-0 w-[600px] h-[500px] opacity-35 pointer-events-none" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-6">
          <div>
            <span className="sec-eyebrow">Simulação ao Vivo</span>
            <h2 className="sec-title">
              Veja a IA operando <strong>em tempo real</strong>
            </h2>
            <p className="sec-lede">
              Sem enrolação. O agente inteligente analisa o histórico da base, monta a estratégia de reativação por lotes e gera a minuta com cronograma pronta para aprovação.
            </p>

            <div className="mt-8 space-y-4">
              <div className="flex items-start gap-3 text-xs text-white/75">
                <div className="h-5 w-5 rounded-full bg-[#00FF96]/20 text-[#00FF96] flex items-center justify-center shrink-0 mt-0.5 shadow-[0_0_8px_rgba(0,255,150,0.3)]">
                  <Check className="h-3 w-3" />
                </div>
                <span><strong>RAG Documental:</strong> respostas embasadas nas regras da sua empresa.</span>
              </div>
              <div className="flex items-start gap-3 text-xs text-white/75">
                <div className="h-5 w-5 rounded-full bg-[#00FF96]/20 text-[#00FF96] flex items-center justify-center shrink-0 mt-0.5 shadow-[0_0_8px_rgba(0,255,150,0.3)]">
                  <Check className="h-3 w-3" />
                </div>
                <span><strong>Zero Bloqueios:</strong> envios humanizados com rodízio inteligente de chips.</span>
              </div>
              <div className="flex items-start gap-3 text-xs text-white/75">
                <div className="h-5 w-5 rounded-full bg-[#00FF96]/20 text-[#00FF96] flex items-center justify-center shrink-0 mt-0.5 shadow-[0_0_8px_rgba(0,255,150,0.3)]">
                  <Check className="h-3 w-3" />
                </div>
                <span><strong>Trava Humana Inviolável:</strong> a IA só dispara o que o vendedor aprovar.</span>
              </div>
            </div>
          </div>

          <div
            ref={simulatorRef}
            className={`slide-in-right ${isSimulatorVisible ? "visible" : ""}`}
          >
            <LiveChatSimulator />
          </div>
        </div>
      </section>

      {/* ========================================================= */}
      {/* 6. SEÇÃO MÓDULOS (CATÁLOGO DOS 8 MÓDULOS)                 */}
      {/* ========================================================= */}
      <ModulesCatalogSection />

      {/* ========================================================= */}
      {/* 7. SEÇÃO IMPLANTAÇÃO (NO AR EM TRÊS DIAS)                */}
      {/* ========================================================= */}
      <ImplementationTimeline />

      {/* ========================================================= */}
      {/* 8. SEÇÃO PLANOS (4 CARTÕES + TABELA COMPARATIVA)          */}
      {/* ========================================================= */}
      <PlansSection onSelectPlan={(plan) => onOpenModal("plano", plan)} />

      {/* ========================================================= */}
      {/* 9. SEÇÃO FAQ ACCORDION (8 PERGUNTAS)                     */}
      {/* ========================================================= */}
      <section id="sec-faq" className="relative py-24 px-6 sm:px-12 max-w-4xl mx-auto border-t border-white/5 overflow-hidden">
        <div className="section-ambient-glow glow-indigo top-10 left-1/2 -translate-x-1/2 w-[520px] h-[320px] opacity-25 pointer-events-none" />

        <div className="relative z-10 mb-12 text-center">
          <span className="sec-eyebrow">FAQ</span>
          <h2 className="sec-title">
            Perguntas que a gente recebe <strong>toda semana</strong>
          </h2>
        </div>

        <div className="relative z-10 space-y-3">
          {FAQS.map((faq, idx) => {
            const isOpen = openFaqIndex === idx;
            return (
              <div
                key={faq.question}
                className={`rounded-xl border transition-all duration-200 ${
                  isOpen
                    ? "border-[#9600FF]/50 bg-[#0C0B1E] shadow-[0_4px_25px_rgba(150,0,255,0.15)]"
                    : "border-white/5 bg-[#070712] hover:border-white/15"
                }`}
              >
                <button
                  onClick={() => toggleFaq(idx)}
                  className="w-full p-5 text-left flex items-center justify-between gap-4 cursor-pointer"
                >
                  <span className={`text-sm sm:text-base font-normal transition-colors ${
                    isOpen ? "text-white font-medium" : "text-white/90"
                  }`}>
                    {faq.question}
                  </span>
                  <span
                    className={`h-6 w-6 rounded-full flex items-center justify-center transition-all duration-200 shrink-0 ${
                      isOpen
                        ? "rotate-45 bg-[#9600FF]/30 text-[#D7B4FF] shadow-[0_0_10px_rgba(150,0,255,0.4)]"
                        : "bg-white/5 text-white/60"
                    }`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 text-xs sm:text-sm font-light text-white/70 leading-relaxed border-t border-white/5 pt-3 animate-in fade-in duration-200">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ========================================================= */}
      {/* 10. SEÇÃO DIAGNÓSTICO COMERCIAL GRÁTIS                   */}
      {/* ========================================================= */}
      <FreeDiagnosisSection onOpenDiagnosis={() => onOpenModal("diagnostico")} />

      {/* ========================================================= */}
      {/* 11. SEÇÃO CTA FINAL                                       */}
      {/* ========================================================= */}
      <section id="sec-cta" className="relative py-24 px-6 sm:px-12 max-w-6xl mx-auto border-t border-white/5 overflow-hidden">
        <div className="section-ambient-glow glow-purple bottom-0 right-1/4 w-[750px] h-[450px] opacity-45 pointer-events-none" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 items-end">
          <div>
            <span className="sec-eyebrow">Próximo passo</span>
            <h2 className="sec-title">
              Você não precisa virar outra pessoa. Precisa virar a <strong>referência da sua área</strong>.
            </h2>
            <p className="sec-lede">
              O Vexo OS foi construído pra esse passo. Sua concorrência ainda está presa em planilhas manuais. Falta você.
            </p>
          </div>

          <div className="flex flex-col items-start lg:items-end gap-6">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-[#9600FF]/15 border border-[#9600FF]/30 px-3.5 py-1 text-xs text-[#D7B4FF] shadow-[0_0_10px_rgba(150,0,255,0.2)]">
                Gente de Negócio
              </span>
              <span className="rounded-full bg-[#9600FF]/15 border border-[#9600FF]/30 px-3.5 py-1 text-xs text-[#D7B4FF] shadow-[0_0_10px_rgba(150,0,255,0.2)]">
                Trava Humana Inviolável
              </span>
              <span className="rounded-full bg-[#9600FF]/15 border border-[#9600FF]/30 px-3.5 py-1 text-xs text-[#D7B4FF] shadow-[0_0_10px_rgba(150,0,255,0.2)]">
                Sem Fidelidade
              </span>
            </div>

            <div>
              <button
                onClick={() => onOpenModal("demo")}
                className="xp-btn"
              >
                <span>Quero o Vexo OS</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================= */}
      {/* 12. RODAPÉ COMPLETO                                       */}
      {/* ========================================================= */}
      <LandingFooter onOpenLegal={onOpenLegal} />
    </div>
  );
}
