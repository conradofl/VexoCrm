// frontend/src/pages/LandingPage/LeadCaptureModal.tsx

import React, { useState } from "react";
import { CheckCircle2, MessageSquare, Sparkles, X } from "lucide-react";
import { DEMO_PHONE_NUMBER } from "./constants";
import type { LeadFormData } from "./types";

interface LeadCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LeadCaptureModal({ isOpen, onClose }: LeadCaptureModalProps) {
  const [formData, setFormData] = useState<LeadFormData>({
    fullName: "",
    email: "",
    phone: "",
    company: "",
    teamSize: "1-5 vendedores",
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

    // Constrói mensagem contextualizada para WhatsApp
    const message = encodeURIComponent(
      `*Solicitação de Demonstração · Vexo OS*\n\n` +
      `👤 *Nome:* ${formData.fullName}\n` +
      `🏢 *Empresa:* ${formData.company || "Não informado"}\n` +
      `👥 *Equipe Comercial:* ${formData.teamSize}\n` +
      `📱 *WhatsApp:* ${formData.phone}\n` +
      `✉️ *E-mail:* ${formData.email}\n\n` +
      `Gostaria de agendar uma demonstração guiada do sistema e conhecer os agentes 24/7.`
    );

    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
      setTimeout(() => {
        window.open(`https://wa.me/${DEMO_PHONE_NUMBER}?text=${message}`, "_blank");
      }, 1200);
    }, 600);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop de vidro jateado */}
      <div
        className="fixed inset-0 bg-[#00000A]/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Conteúdo do Card */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#0A0A14] p-6 shadow-2xl sm:p-8 z-10 animate-fade-in-up">
        {/* Glow Superior */}
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-[#9600FF]/30 blur-3xl" />

        <button
          onClick={onClose}
          className="absolute right-5 top-5 rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
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
              Estamos direcionando você para o atendimento comercial prioritário no WhatsApp com seus dados pré-configurados.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs font-mono text-[#00FF96]">
              <span className="h-2 w-2 rounded-full bg-[#00FF96] animate-ping" />
              Conectando com especialista Vexo...
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#9600FF]/40 bg-[#9600FF]/20 text-[#D7B4FF] shadow-[0_0_20px_rgba(150,0,255,0.3)]">
                <span className="font-extrabold text-lg">V</span>
              </div>
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#9600FF]/15 border border-[#9600FF]/30 px-2.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase text-[#D7B4FF]">
                  <Sparkles className="h-3 w-3 text-[#D7B4FF]" />
                  Acesso Exclusivo
                </span>
                <h3 className="text-xl font-bold text-white mt-1">Conhecer o Vexo OS</h3>
              </div>
            </div>

            <p className="text-xs text-white/60 mb-6">
              Preencha os dados da sua operação para receber uma demonstração prática dos agentes inteligentes e do funil comercial.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/70 mb-1.5">
                  Seu Nome Completo
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Carlos Eduardo"
                  value={formData.fullName}
                  onChange={(e) => setFormData((p) => ({ ...p, fullName: e.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-[#9600FF] focus:outline-none focus:ring-1 focus:ring-[#9600FF] transition-all"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/70 mb-1.5">
                    E-mail Corporativo
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="carlos@empresa.com"
                    value={formData.email}
                    onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-[#9600FF] focus:outline-none focus:ring-1 focus:ring-[#9600FF] transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/70 mb-1.5">
                    WhatsApp (com DDD)
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="(34) 99999-9999"
                    value={formData.phone}
                    onChange={handlePhoneChange}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-[#9600FF] focus:outline-none focus:ring-1 focus:ring-[#9600FF] transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/70 mb-1.5">
                    Nome da Empresa
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Sua empresa"
                    value={formData.company}
                    onChange={(e) => setFormData((p) => ({ ...p, company: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-[#9600FF] focus:outline-none focus:ring-1 focus:ring-[#9600FF] transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/70 mb-1.5">
                    Tamanho do Time Comercial
                  </label>
                  <select
                    value={formData.teamSize}
                    onChange={(e) => setFormData((p) => ({ ...p, teamSize: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-[#121220] px-4 py-3 text-sm text-white focus:border-[#9600FF] focus:outline-none focus:ring-1 focus:ring-[#9600FF] transition-all"
                  >
                    <option value="1-3 vendedores">1 a 3 vendedores</option>
                    <option value="4-10 vendedores">4 a 10 vendedores</option>
                    <option value="11-30 vendedores">11 a 30 vendedores</option>
                    <option value="+30 vendedores">+30 vendedores (Enterprise)</option>
                  </select>
                </div>
              </div>

              <div className="pt-3">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-xl bg-gradient-to-r from-[#9600FF] to-[#4B00FF] px-6 py-3.5 text-sm font-bold uppercase tracking-wider text-white shadow-[0_8px_25px_rgba(150,0,255,0.4)] hover:brightness-110 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span>{isSubmitting ? "Processando..." : "Confirmar Demonstração"}</span>
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
