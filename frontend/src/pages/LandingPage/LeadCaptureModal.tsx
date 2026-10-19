// frontend/src/pages/LandingPage/LeadCaptureModal.tsx
// Formulário de Diagnóstico Comercial em 4 Telas (12 Perguntas Qualificadoras)
// Multi-tenant: envia para /api/public/leads/capture, salva no tenant, dispara auto-resposta
// no WhatsApp do lead e notifica equipe sem depender de window.open em timer.

import React, { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  HelpCircle,
  MessageSquare,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { DEMO_PHONE_NUMBER } from "./constants";
import { fetchApi } from "@/lib/api";
import type { LeadFormData } from "./types";

interface LeadCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: "demo" | "diagnostico" | "plano";
  planName?: string;
  clientId?: string;
}

export function LeadCaptureModal({
  isOpen,
  onClose,
  mode = "diagnostico",
  planName,
  clientId = "vexo-adm",
}: LeadCaptureModalProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [formData, setFormData] = useState<LeadFormData>({
    fullName: "",
    phone: "",
    email: "",
    company: "",
    segment: "Serviços B2B / Consultoria",
    teamSize: "2 a 5 vendedores",
    baseSize: "2.000 a 10.000 contatos",
    ticketMedio: "R$ 1.000 a R$ 5.000",
    stalledLeadsPct: "30% a 50% da base",
    responseTime: "5 a 30 minutos",
    followupProcess: "Manual (planilha ou lembrete do vendedor)",
    mainPain: "Leads esfriam antes do primeiro contato",
    website_url: "", // honeypot
    client_id: clientId,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [phoneMasked, setPhoneMasked] = useState<string>("");

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

  function handleNextStep(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    // Validações por etapa
    if (step === 1) {
      if (!formData.fullName.trim() || formData.fullName.trim().length < 2) {
        setErrorMessage("Por favor, preencha seu nome completo.");
        return;
      }
      const rawDigits = formData.phone.replace(/\D/g, "");
      if (rawDigits.length < 10) {
        setErrorMessage("Por favor, informe seu WhatsApp com DDD (mínimo 10 dígitos).");
        return;
      }
      if (!formData.email.trim() || !formData.email.includes("@")) {
        setErrorMessage("Por favor, informe um e-mail corporativo válido.");
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      if (!formData.company.trim()) {
        setErrorMessage("Por favor, informe o nome da sua empresa.");
        return;
      }
      setStep(3);
      return;
    }

    if (step === 3) {
      setStep(4);
      return;
    }

    if (step === 4) {
      handleSubmitFinal();
    }
  }

  async function handleSubmitFinal() {
    setIsSubmitting(true);
    setErrorMessage(null);

    const payload = {
      ...formData,
      client_id: clientId,
      mode,
      planName: planName || null,
    };

    try {
      const response = await fetchApi("/api/public/leads/capture", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setIsSubmitting(false);
        setErrorMessage(data?.message || "Ocorreu um erro ao enviar sua solicitação. Tente novamente.");
        return;
      }

      setIsSubmitting(false);
      setPhoneMasked(data?.phoneMasked || formatPhone(formData.phone));
      setIsSuccess(true);
    } catch (err: any) {
      console.warn("[LeadCaptureModal] Falha de conexão ao enviar para API:", err);
      // Fallback gracioso: não trava o usuário
      setIsSubmitting(false);
      setPhoneMasked(formatPhone(formData.phone));
      setIsSuccess(true);
    }
  }

  // Constrói link de contingência manual caso o WhatsApp automático demore
  const fallbackWaMessage = encodeURIComponent(
    `*Diagnóstico Comercial · Vexo OS*\n\n` +
    `👤 *Nome:* ${formData.fullName}\n` +
    `🏢 *Empresa:* ${formData.company}\n` +
    `📊 *Base:* ${formData.baseSize} | *Ticket Médio:* ${formData.ticketMedio}\n` +
    `⚡ *Tempo de Resposta:* ${formData.responseTime}\n\n` +
    `Gostaria de ver o diagnóstico de recuperação da minha base.`
  );
  const fallbackWaUrl = `https://wa.me/${DEMO_PHONE_NUMBER}?text=${fallbackWaMessage}`;

  const stepTitles = [
    { title: "Identificação & Contato", subtitle: "Onde vamos te enviar o diagnóstico" },
    { title: "Sua Empresa & Equipe", subtitle: "Estrutura do seu time comercial" },
    { title: "Seus contatos e suas vendas", subtitle: "Quantas pessoas você tem e quanto vende" },
    { title: "Como você atende hoje", subtitle: "O que acontece depois que alguém te chama" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#00000A]/85 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Conteúdo do Card */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#0B091A] p-6 shadow-2xl sm:p-8 z-10 animate-fade-in-up my-auto">
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
          /* ========================================================= */
          /* TELA DE SUCESSO REAL (NÚMERO MASCARADO + LINK DIRETO)     */
          /* ========================================================= */
          <div className="flex flex-col items-center py-6 text-center animate-fade-in-up">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 mb-4 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <h3 className="text-2xl font-bold text-white">Pronto!</h3>
            <p className="mt-2 text-sm text-white/80 max-w-sm leading-relaxed">
              Te mandamos uma mensagem no WhatsApp{" "}
              <strong className="text-[#00FF96] font-mono">{phoneMasked || "informado"}</strong>.
            </p>
            <p className="text-xs text-white/55 mt-1 max-w-xs">
              Chega em instantes com a análise dos números da sua base.
            </p>

            {/* Botão de fallback em formato de link direto */}
            <div className="mt-6 w-full pt-4 border-t border-white/5">
              <a
                href={fallbackWaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-[#25D366] via-[#1EBE5D] to-[#128C7E] text-white font-extrabold text-xs sm:text-sm tracking-wide shadow-[0_0_25px_rgba(37,211,102,0.4)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer no-underline"
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span>Abrir WhatsApp Agora →</span>
              </a>
              <p className="mt-2.5 text-[10px] text-white/40 font-mono">
                Se a conversa não abriu sozinha, clique acima para falar com nosso time.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="mt-5 text-xs text-white/40 hover:text-white/80 transition-colors cursor-pointer"
            >
              Fechar janela
            </button>
          </div>
        ) : (
          /* ========================================================= */
          /* FORMULÁRIO EM 4 PASSOS (12 PERGUNTAS QUALIFICADORAS)      */
          /* ========================================================= */
          <>
            {/* Cabeçalho do Stepper */}
            <div className="mb-5">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-mono text-[#D7B4FF] font-bold">
                  PASSO {step} DE 4
                </span>
                <span className="text-white/40 text-[11px]">
                  {step === 1 ? "25%" : step === 2 ? "50%" : step === 3 ? "75%" : "100%"} concluído
                </span>
              </div>

              {/* Barra de Progresso */}
              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#9600FF] to-[#00FF96] transition-all duration-300"
                  style={{ width: `${step * 25}%` }}
                />
              </div>

              <div className="mt-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>{stepTitles[step - 1].title}</span>
                  <Sparkles className="h-4 w-4 text-[#D7B4FF]" />
                </h3>
                <p className="text-xs text-white/60">{stepTitles[step - 1].subtitle}</p>
              </div>
            </div>

            {/* Alerta de Erro se houver */}
            {errorMessage && (
              <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2 text-xs text-red-300 animate-shake">
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleNextStep} className="space-y-3.5">
              {/* Campo Honeypot Oculto para Robôs */}
              <input
                type="text"
                name="website_url"
                value={formData.website_url || ""}
                onChange={(e) => setFormData((prev) => ({ ...prev, website_url: e.target.value }))}
                style={{ display: "none" }}
                tabIndex={-1}
                autoComplete="off"
              />

              {/* ======================================================= */}
              {/* PASSO 1: IDENTIFICAÇÃO & CONTATO (Campos 1, 2, 3)        */}
              {/* ======================================================= */}
              {step === 1 && (
                <div className="space-y-3 animate-fade-in">
                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-1">
                      1. Seu nome *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.fullName}
                      onChange={(e) => setFormData((prev) => ({ ...prev, fullName: e.target.value }))}
                      placeholder="Como podemos te chamar?"
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:border-[#9600FF] focus:outline-none focus:bg-white/8 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-1">
                      2. Seu WhatsApp * (com DDD)
                    </label>
                    <input
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={handlePhoneChange}
                      placeholder="(00) 00000-0000"
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:border-[#9600FF] focus:outline-none focus:bg-white/8 transition-all font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-1">
                      3. Seu e-mail *
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
              )}

              {/* ======================================================= */}
              {/* PASSO 2: SUA EMPRESA & EQUIPE (Campos 4, 5, 6)           */}
              {/* ======================================================= */}
              {step === 2 && (
                <div className="space-y-3 animate-fade-in">
                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-1">
                      4. Nome da sua empresa *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.company}
                      onChange={(e) => setFormData((prev) => ({ ...prev, company: e.target.value }))}
                      placeholder="Ex: Minha Empresa"
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:border-[#9600FF] focus:outline-none focus:bg-white/8 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-1">
                      5. O que sua empresa faz?
                    </label>
                    <select
                      value={formData.segment}
                      onChange={(e) => setFormData((prev) => ({ ...prev, segment: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-[#140F30] px-3.5 py-2.5 text-xs text-white focus:border-[#9600FF] focus:outline-none transition-all"
                    >
                      <option value="Serviços B2B / Consultoria">Presto serviço para outras empresas</option>
                      <option value="Saúde / Clínicas / Estética">Saúde / Clínicas / Estética</option>
                      <option value="Imobiliária / Construção Civil">Imobiliária / Construção Civil</option>
                      <option value="Energia Solar / Engenharia">Energia solar ou engenharia</option>
                      <option value="Tecnologia / SaaS">Tecnologia ou sistema por assinatura</option>
                      <option value="Varejo / E-commerce / Franquias">Varejo / E-commerce / Franquias</option>
                      <option value="Outro Segmento">Outra coisa</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-1">
                      6. Quantas pessoas vendem na sua empresa?
                    </label>
                    <select
                      value={formData.teamSize}
                      onChange={(e) => setFormData((prev) => ({ ...prev, teamSize: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-[#140F30] px-3.5 py-2.5 text-xs text-white focus:border-[#9600FF] focus:outline-none transition-all"
                    >
                      <option value="Apenas eu (vendedor único)">Só eu mesmo</option>
                      <option value="2 a 5 vendedores">2 a 5 vendedores</option>
                      <option value="6 a 15 vendedores">6 a 15 vendedores</option>
                      <option value="Mais de 15 pessoas vendendo">Mais de 15 pessoas</option>
                    </select>
                  </div>
                </div>
              )}

              {/* ======================================================= */}
              {/* PASSO 3: SUA BASE & NÚMEROS (Campos 7, 8, 9)             */}
              {/* ======================================================= */}
              {step === 3 && (
                <div className="space-y-3 animate-fade-in">
                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-1">
                      7. Quantos contatos você tem guardados? (celular, planilha e sistema, tudo junto)
                    </label>
                    <select
                      value={formData.baseSize}
                      onChange={(e) => setFormData((prev) => ({ ...prev, baseSize: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-[#140F30] px-3.5 py-2.5 text-xs text-white focus:border-[#9600FF] focus:outline-none transition-all"
                    >
                      <option value="Até 2.000 contatos">Até 2.000 contatos</option>
                      <option value="2.000 a 10.000 contatos">2.000 a 10.000 contatos</option>
                      <option value="10.000 a 50.000 contatos">10.000 a 50.000 contatos</option>
                      <option value="Mais de 50.000 contatos">Mais de 50.000 contatos</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-1">
                      8. Quanto rende uma venda sua, na média?
                    </label>
                    <select
                      value={formData.ticketMedio}
                      onChange={(e) => setFormData((prev) => ({ ...prev, ticketMedio: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-[#140F30] px-3.5 py-2.5 text-xs text-white focus:border-[#9600FF] focus:outline-none transition-all"
                    >
                      <option value="Até R$ 500">Até R$ 500</option>
                      <option value="R$ 500 a R$ 2.000">R$ 500 a R$ 2.000</option>
                      <option value="R$ 2.000 a R$ 5.000">R$ 2.000 a R$ 5.000</option>
                      <option value="R$ 5.000 a R$ 20.000">R$ 5.000 a R$ 20.000</option>
                      <option value="Acima de R$ 20.000">Acima de R$ 20.000</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-1">
                      9. Quantos desses contatos você não conversa há mais de 3 meses?
                    </label>
                    <select
                      value={formData.stalledLeadsPct}
                      onChange={(e) => setFormData((prev) => ({ ...prev, stalledLeadsPct: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-[#140F30] px-3.5 py-2.5 text-xs text-white focus:border-[#9600FF] focus:outline-none transition-all"
                    >
                      <option value="Menos de 30% da base">Menos de 30% deles</option>
                      <option value="30% a 50% da base">Perto da metade</option>
                      <option value="Mais de 50% da base">Mais da metade</option>
                      <option value="Não sei dizer (a maioria parada)">Não sei dizer, mas acho que é a maioria</option>
                    </select>
                  </div>
                </div>
              )}

              {/* ======================================================= */}
              {/* PASSO 4: PROCESSO & GARGALO (Campos 10, 11, 12)          */}
              {/* ======================================================= */}
              {step === 4 && (
                <div className="space-y-3 animate-fade-in">
                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-1">
                      10. Quando alguém te chama, em quanto tempo você responde?
                    </label>
                    <select
                      value={formData.responseTime}
                      onChange={(e) => setFormData((prev) => ({ ...prev, responseTime: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-[#140F30] px-3.5 py-2.5 text-xs text-white focus:border-[#9600FF] focus:outline-none transition-all"
                    >
                      <option value="Até 5 minutos">Até 5 minutos</option>
                      <option value="5 a 30 minutos">5 a 30 minutos</option>
                      <option value="30 minutos a 2 horas">30 minutos a 2 horas</option>
                      <option value="Mais de 2 horas ou dia seguinte">Mais de 2 horas ou no dia seguinte</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-1">
                      11. Quando a pessoa não responde, como você lembra de chamar de novo?
                    </label>
                    <select
                      value={formData.followupProcess}
                      onChange={(e) => setFormData((prev) => ({ ...prev, followupProcess: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-[#140F30] px-3.5 py-2.5 text-xs text-white focus:border-[#9600FF] focus:outline-none transition-all"
                    >
                      <option value="Manual (planilha ou lembrete do vendedor)">De cabeça, ou anotado em caderno ou planilha</option>
                      <option value="CRM tradicional (mas o time não alimenta)">Tenho um sistema, mas ninguém lembra de preencher</option>
                      <option value="Automação básica que não converte">Tenho um robô, mas ele afasta as pessoas</option>
                      <option value="Não temos processo de follow-up">Não tenho um jeito certo de fazer isso</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-1">
                      12. O que mais te faz perder venda hoje?
                    </label>
                    <select
                      value={formData.mainPain}
                      onChange={(e) => setFormData((prev) => ({ ...prev, mainPain: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-[#140F30] px-3.5 py-2.5 text-xs text-white focus:border-[#9600FF] focus:outline-none transition-all"
                    >
                      <option value="Leads esfriam antes do primeiro contato">Demoro pra responder e a pessoa perde o interesse</option>
                      <option value="Vendedores esquecem o follow-up">A gente esquece de voltar a falar com quem não respondeu</option>
                      <option value="Base antiga está parada sem reativação">Tenho muito contato antigo parado, sem ninguém chamar</option>
                      <option value="Demora para emitir proposta e contrato">Demoro pra mandar a proposta e fechar o negócio</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Botões de Ação e Navegação */}
              <div className="pt-3 flex items-center justify-between gap-3">
                {step > 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMessage(null);
                      setStep((prev) => (prev - 1) as any);
                    }}
                    className="py-2.5 px-4 rounded-xl border border-white/15 bg-white/5 text-white/75 hover:text-white hover:bg-white/10 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Voltar</span>
                  </button>
                ) : (
                  <div />
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="py-3 px-6 rounded-xl bg-gradient-to-r from-[#9600FF] via-[#7B1FA2] to-[#4B00FF] text-white font-bold text-xs tracking-wide shadow-[0_0_20px_rgba(150,0,255,0.4)] hover:brightness-110 active:scale-[0.99] disabled:opacity-50 transition-all cursor-pointer flex items-center gap-2 ml-auto"
                >
                  <span>
                    {isSubmitting
                      ? "Enviando e gerando diagnóstico..."
                      : step < 4
                      ? "Próximo Passo"
                      : "Receber Diagnóstico no WhatsApp"}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>

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
