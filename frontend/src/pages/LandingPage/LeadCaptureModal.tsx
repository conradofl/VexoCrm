// frontend/src/pages/LandingPage/LeadCaptureModal.tsx

import React, { useState } from "react";
import { CheckCircle2, FileText, MessageSquare, Sparkles, X } from "lucide-react";
import { DEMO_PHONE_NUMBER } from "./constants";
import type { LeadFormData } from "./types";

interface LeadCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: "demo" | "diagnostico" | "plano";
  planName?: string;
}

export function LeadCaptureModal({
  isOpen,
  onClose,
  mode = "demo",
  planName,
}: LeadCaptureModalProps) {
  const [formData, setFormData] = useState<LeadFormData>({
    fullName: "",
    email: "",
    phone: "",
    company: "",
    teamSize: "1-5 vendedores",
    baseSize: "Até 2.000 contatos",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  function formatPhone(value: string) {
    const numbers = value.replace(/\D/g, "").slice(0, 11);
    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
  }

  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFormData((prev) => ({ ...prev, phone: formatPhone(e.target.value) }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);

    let subject = "Solicitação de Demonstração · Vexo OS";
    let intentText = "Gostaria de agendar uma demonstração guiada do sistema e conhecer os agentes 24/7.";

    if (mode === "diagnostico") {
      subject = "Diagnóstico Comercial Grátis · Vexo OS";
      intentText =
        "Gostaria de receber o diagnóstico das 12 perguntas para saber quantos leads estão esquecidos e o potencial financeiro da minha base.";
    } else if (mode === "plano" && planName) {
      subject = `Interesse no Plano ${planName} · Vexo OS`;
      intentText = `Tenho interesse em iniciar no Plano ${planName} com o Vexo OS.`;
    }

    // Constrói mensagem contextualizada para WhatsApp
    const message = encodeURIComponent(
      `*${subject}*\n\n` +
      `👤 *Nome:* ${formData.fullName}\n` +
      `🏢 *Empresa:* ${formData.company || "Não informado"}\n` +
      `📊 *Base de Contatos:* ${formData.baseSize || "Não informado"}\n` +
      `👥 *Equipe Comercial:* ${formData.teamSize}\n` +
      `📱 *WhatsApp:* ${formData.phone}\n` +
      `✉️ *E-mail:* ${formData.email}\n\n` +
      `${intentText}`
    );

    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
      setTimeout(() => {
        window.open(`https://wa.me/${DEMO_PHONE_NUMBER}?text=${message}`, "_blank");
      }, 1200);
    }, 600);
  }

  const modalTitle =
    mode === "diagnostico"
      ? "Diagnóstico Comercial Grátis"
      : mode === "plano" && planName
      ? `Começar no Plano ${planName}`
      : "Conhecer o Vexo OS";

  const modalSubtitle =
    mode === "diagnostico"
      ? "Informe seus dados para receber o diagnóstico de recuperação da sua base em 10 minutos."
      : "Preencha abaixo para falar com um especialista comercial e ver a operação ao vivo.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop de vidro jateado */}
      <div
        className="fixed inset-0 bg-[#00000A]/85 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Conteúdo do Card */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#0A0A14] p-6 shadow-2xl sm:p-8 z-10 animate-fade-in-up">
        {/* Glow Superior */}
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-[#9600FF]/30 blur-3xl" />

        <button
          onClick={onClose}
          className="absolute right-5 top-5 rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          aria-label="Fechar modal"
        >
          <X className="h-5 w-5" />
        </button>

        {isSuccess ? (
          <div className="flex flex-col items-center py-8 text-center animate-fade-in-up">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 mb-5 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <h3 className="text-2xl font-bold text-white">Solicitação Confirmada!</h3>
            <p className="mt-2 text-sm text-white/70 max-w-sm">
              Estamos direcionando você para o WhatsApp oficial com seus dados pré-configurados.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs font-mono text-[#00FF96]">
              <span className="h-2 w-2 rounded-full bg-[#00FF96] animate-ping" />
              Conectando com o time Vexo...
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#9600FF]/40 bg-[#9600FF]/20 text-[#D7B4FF] shadow-[0_0_20px_rgba(150,0,255,0.3)]">
                <span className="font-extrabold text-lg">V</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>{modalTitle}</span>
                  <Sparkles className="h-4 w-4 text-[#D7B4FF]" />
                </h3>
                <p className="text-xs text-white/60">{modalSubtitle}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/70 mb-1.5">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  required
                  value={formData.fullName}
                  onChange={(e) => setFormData((prev) => ({ ...prev, fullName: e.target.value }))}
                  placeholder="Seu nome"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:border-[#9600FF] focus:outline-none focus:bg-white/8 transition-all"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    WhatsApp Comercial *
                  </label>
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={handlePhoneChange}
                    placeholder="(00) 00000-0000"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:border-[#9600FF] focus:outline-none focus:bg-white/8 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    E-mail Corporativo *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="seu@empresa.com"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:border-[#9600FF] focus:outline-none focus:bg-white/8 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    Nome da Empresa
                  </label>
                  <input
                    type="text"
                    value={formData.company}
                    onChange={(e) => setFormData((prev) => ({ ...prev, company: e.target.value }))}
                    placeholder="Sua empresa"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:border-[#9600FF] focus:outline-none focus:bg-white/8 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    Tamanho da Base
                  </label>
                  <select
                    value={formData.baseSize}
                    onChange={(e) => setFormData((prev) => ({ ...prev, baseSize: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-[#120D2C] px-3.5 py-2.5 text-xs text-white focus:border-[#9600FF] focus:outline-none transition-all"
                  >
                    <option value="Até 2.000 contatos">Até 2.000 contatos</option>
                    <option value="2.000 a 10.000 contatos">2.000 a 10.000 contatos</option>
                    <option value="10.000 a 50.000 contatos">10.000 a 50.000 contatos</option>
                    <option value="Mais de 50.000 contatos">Mais de 50.000 contatos</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#9600FF] via-[#7B1FA2] to-[#4B00FF] text-white font-bold text-xs tracking-wide shadow-[0_0_20px_rgba(150,0,255,0.4)] hover:brightness-110 active:scale-[0.99] disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <MessageSquare className="h-4 w-4" />
                <span>
                  {isSubmitting
                    ? "Processando..."
                    : mode === "diagnostico"
                    ? "Receber Diagnóstico no WhatsApp"
                    : "Avançar para WhatsApp Comercial"}
                </span>
              </button>

              <p className="text-[10px] text-center text-white/40 pt-1 font-mono">
                🔒 Seus dados são confidenciais e protegidos pela LGPD. Sem spam.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
