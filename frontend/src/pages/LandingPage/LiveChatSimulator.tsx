// frontend/src/pages/LandingPage/LiveChatSimulator.tsx
// Componente Interativo (Padrão 21st.dev):
// Simulador Operacional do Agente Vexo com RAG, Chat Interativo em Tempo Real e Modal de Minuta Contratual em PDF

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  Check,
  CheckCheck,
  FileCheck2,
  FileText,
  Send,
  Sparkles,
  X,
  ShieldCheck,
  Download,
  ExternalLink,
} from "lucide-react";

interface ChatMessage {
  id: string;
  sender: "user" | "agent";
  time: string;
  text: string;
  badge?: string;
  contract?: {
    name: string;
    details: string;
    status: string;
  };
}

export function LiveChatSimulator() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "msg-1",
      sender: "user",
      time: "10:42",
      text: "Olá! Preciso saber se o Vexo OS consegue atender meu time de 8 corretores e já gerar a minuta do contrato direto com o cliente.",
    },
    {
      id: "msg-2",
      sender: "agent",
      time: "10:42",
      badge: "Resposta baseada no Manual Comercial da Empresa",
      text: "Olá! Perfeitamente. Para 8 corretores, o plano indicado é o Escala Comercial com rodízio inteligente de chips. A geração do contrato é instantânea: basta confirmar os dados que nossa IA monta a minuta completa em PDF.",
      contract: {
        name: "Minuta_Contratual_Vexo.pdf",
        details: "Cláusulas modulares · Cronograma quinzenal",
        status: "Emitido",
      },
    },
  ]);

  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSigned, setIsSigned] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  function getCurrentTime() {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  }

  function handleSend(textToSend?: string) {
    const text = (textToSend || inputText).trim();
    if (!text || isTyping) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      time: getCurrentTime(),
      text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setIsTyping(true);

    // Simula raciocínio e geração contextual da IA comercial
    setTimeout(() => {
      let replyText = "";
      let hasContract = false;
      let badge = "Consulta RAG ao Acervo de Regras Comerciais";

      const lower = text.toLowerCase();
      if (lower.includes("preço") || lower.includes("custa") || lower.includes("valor")) {
        replyText =
          "O investimento para 8 corretores é de R$ 980/mês no plano Escala Comercial, incluindo instâncias ilimitadas de WhatsApp, IA treinada no seu manual de vendas e suporte prioritário via canal dedicado.";
      } else if (lower.includes("contrato") || lower.includes("minuta") || lower.includes("gerar")) {
        replyText =
          "Minuta contratual gerada com sucesso! O documento foi pré-preenchido com cláusulas de proteção de dados, SLA de 99.9% e trava humana ativada. Clique no arquivo abaixo para revisar antes do envio.";
        hasContract = true;
      } else if (lower.includes("trava") || lower.includes("humana") || lower.includes("seguran")) {
        replyText =
          "A Trava Humana garante que a IA nunca feche ou altere condições sem o 'De Acordo' do seu vendedor. Você tem supervisão em tempo real e o controle da negociação é 100% da sua equipe.";
        badge = "Protocolo de Segurança Comercial Vexo";
      } else if (lower.includes("bloqueio") || lower.includes("chip") || lower.includes("whatsapp")) {
        replyText =
          "Nosso rodízio inteligente monitora aquecimento de chips e taxa de disparo em tempo real. Se um canal atingir o limite seguro, a conversa é transferida automaticamente sem o cliente perceber.";
        badge = "Módulo Anti-Bloqueio Multichip Ativo";
      } else {
        replyText =
          "Entendido! O Vexo OS orquestra todas as etapas do funil: qualificação automática, cálculo de propostas sob medida e formalização contratual em PDF pronta para assinatura digital.";
      }

      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        sender: "agent",
        time: getCurrentTime(),
        badge,
        text: replyText,
        contract: hasContract
          ? {
              name: "Minuta_Contratual_Vexo.pdf",
              details: "Cláusulas comerciais · SLA 99.9% · ICP-Brasil",
              status: "Emitido",
            }
          : undefined,
      };

      setMessages((prev) => [...prev, agentMsg]);
      setIsTyping(false);
    }, 1100);
  }

  const quickChips = [
    { label: "💬 Preço 8 corretores", prompt: "Qual o investimento para um time de 8 corretores?" },
    { label: "📄 Gerar Minuta Contratual", prompt: "Pode gerar uma minuta contratual modular agora?" },
    { label: "🔒 Trava Humana", prompt: "Como funciona a trava humana para segurança da venda?" },
    { label: "⚡ Anti-Bloqueio de Chips", prompt: "Como funciona a proteção anti-bloqueio de WhatsApp?" },
  ];

  return (
    <div className="relative w-full rounded-2xl border border-[rgba(245,245,255,0.12)] bg-[#0B0A1C]/95 p-4 sm:p-6 backdrop-blur-2xl shadow-[0_12px_50px_rgba(0,0,0,0.6)]">
      {/* Top Bar do Chat */}
      <div className="flex items-center justify-between border-b border-white/8 pb-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#9600FF] to-[#4B00FF] text-white shadow-[0_0_16px_rgba(150,0,255,0.5)]">
            <Bot className="h-5 w-5" />
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0B0A1C] bg-[#00FF96] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-bold text-white">Vexo Commercial Agent</span>
              <span className="rounded-full bg-[#00FF96]/15 border border-[#00FF96]/30 px-2 py-0.5 text-[9px] font-mono text-[#00FF96]">
                ONLINE 24/7
              </span>
            </div>
            <span className="text-[10px] text-white/50">Tempo de resposta: &lt; 2s · RAG Ativo</span>
          </div>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-[#9600FF]/40 bg-[#9600FF]/15 px-2.5 py-1 text-[11px] font-semibold text-[#D7B4FF] hover:bg-[#9600FF]/25 hover:border-[#9600FF]/60 transition-all cursor-pointer"
        >
          <FileCheck2 className="h-3.5 w-3.5" />
          <span>Ver Minuta PDF</span>
        </button>
      </div>

      {/* Chips Rápidos de Interação */}
      <div className="mb-3 flex flex-wrap gap-1.5 sm:gap-2">
        {quickChips.map((chip) => (
          <button
            key={chip.label}
            onClick={() => handleSend(chip.prompt)}
            disabled={isTyping}
            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/75 hover:bg-white/10 hover:border-[#9600FF]/50 hover:text-white transition-all cursor-pointer active:scale-95 disabled:opacity-50"
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Stream de Mensagens com Rolagem */}
      <div
        ref={scrollRef}
        className="space-y-3.5 max-h-[340px] sm:max-h-[380px] overflow-y-auto pr-1.5 custom-scrollbar"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.sender === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-gradient-to-r from-white/10 to-white/5 border border-white/12 p-3 text-xs text-white/90 shadow-md">
                <p className="leading-relaxed">{msg.text}</p>
                <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-white/40">
                  <span>{msg.time}</span>
                  <CheckCheck className="h-3 w-3 text-sky-400" />
                </div>
              </div>
            ) : (
              <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-[#13112E] border border-[#9600FF]/35 p-3.5 text-xs text-white shadow-xl">
                {msg.badge && (
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#D7B4FF] mb-1.5">
                    <Sparkles className="h-3 w-3 text-[#D7B4FF]" />
                    <span>{msg.badge}</span>
                  </div>
                )}
                <p className="leading-relaxed text-white/85">{msg.text}</p>

                {/* Card de Contrato Modular */}
                {msg.contract && (
                  <div
                    onClick={() => setIsModalOpen(true)}
                    className="mt-3 group rounded-xl border border-[#9600FF]/40 bg-[#1C1642] p-2.5 flex items-center justify-between gap-3 hover:border-[#9600FF]/80 hover:bg-[#231B54] transition-all cursor-pointer shadow-lg"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#9600FF]/30 text-[#D7B4FF] group-hover:scale-105 transition-transform">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold text-white group-hover:text-[#D7B4FF] transition-colors">
                          {msg.contract.name}
                        </p>
                        <p className="text-[9px] text-white/50">{msg.contract.details}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-md bg-[#00FF96]/15 border border-[#00FF96]/30 px-2 py-0.5 text-[9px] font-bold text-[#00FF96]">
                        {msg.contract.status}
                      </span>
                      <ExternalLink className="h-3 w-3 text-white/40 group-hover:text-white" />
                    </div>
                  </div>
                )}

                <div className="mt-2.5 flex items-center justify-between text-[9px] text-white/40 pt-2 border-t border-white/5">
                  <span className="text-white/60">🔒 Trava humana ativa: vendedor no comando</span>
                  <span>{msg.time}</span>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Indicador de Digitação do Agente */}
        {isTyping && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-tl-sm bg-[#13112E] border border-[#9600FF]/30 px-3.5 py-2.5 text-xs text-white/70 flex items-center gap-2 shadow-lg">
              <span className="h-2 w-2 rounded-full bg-[#00FF96] animate-ping" />
              <span className="text-[11px] font-medium text-[#D7B4FF]">
                Vexo Commercial Agent consultando acervo...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Caixa de Entrada Interativa */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="mt-3.5 flex items-center gap-2 border-t border-white/8 pt-3"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Envie uma pergunta ou teste uma solicitação..."
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs text-white placeholder-white/35 focus:outline-none focus:border-[#9600FF]/70 focus:bg-white/8 transition-all"
        />
        <button
          type="submit"
          disabled={!inputText.trim() || isTyping}
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-r from-[#9600FF] to-[#4B00FF] text-white shadow-[0_0_12px_rgba(150,0,255,0.4)] hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>

      {/* MODAL DE PRÉ-VISUALIZAÇÃO DO CONTRATO GERADO */}
      {isModalOpen && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-xl rounded-2xl border border-white/15 bg-[#0C0B1E] p-6 shadow-2xl text-white">
            {/* Header do Modal */}
            <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#9600FF]/30 text-[#D7B4FF] border border-[#9600FF]/40">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Minuta_Contratual_Vexo.pdf
                  </h3>
                  <p className="text-[11px] text-white/50">
                    Documento gerado automaticamente via RAG com regras comerciais
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Conteúdo da Minuta */}
            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 text-xs text-white/80 leading-relaxed font-light bg-black/30 p-4 rounded-xl border border-white/5 font-mono">
              <div className="text-center font-bold text-white border-b border-white/10 pb-2">
                INSTRUMENTO PARTICULAR DE LICENCIAMENTO COMERCIAL E IA
              </div>
              <p>
                <strong>CONTRATADA:</strong> Vexo Tecnologia de Vendas LTDA, plataforma Vexo OS.
                <br />
                <strong>CONTRATANTE:</strong> Sua Empresa Comercial / Time de Vendas.
              </p>
              <div>
                <strong className="text-[#D7B4FF]">CLÁUSULA 1ª — DO ESCOPO &amp; PLANO:</strong>
                <p className="mt-1 text-white/70">
                  Licença de acesso para 8 corretores comerciais, com rodízio inteligente multichip de WhatsApp, geração instantânea de propostas em PDF e agente de qualificação comercial 24/7.
                </p>
              </div>
              <div>
                <strong className="text-[#D7B4FF]">CLÁUSULA 2ª — DA TRAVA HUMANA INVIOLÁVEL:</strong>
                <p className="mt-1 text-white/70">
                  Nenhuma automação ou agente de inteligência artificial poderá alterar valores, conceder descontos ou despachar contratos sem o expresso &apos;De Acordo&apos; do vendedor responsável.
                </p>
              </div>
              <div>
                <strong className="text-[#D7B4FF]">CLÁUSULA 3ª — DO SLA &amp; DISPONIBILIDADE:</strong>
                <p className="mt-1 text-white/70">
                  Garantia de 99.9% de uptime operacional com redundância de servidores e migração automática entre instâncias de WhatsApp para prevenção de bloqueios.
                </p>
              </div>
            </div>

            {/* Rodapé com Assinatura e Ações */}
            <div className="mt-5 flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-white/10">
              <div className="flex items-center gap-2 text-xs">
                <ShieldCheck className="h-4 w-4 text-[#00FF96]" />
                <span className="text-white/60 text-[11px]">
                  {isSigned
                    ? "✓ Assinatura Digital Registrada via ICP-Brasil"
                    : "Aguardando assinatura digital do cliente"}
                </span>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setIsSigned(true)}
                  className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isSigned
                      ? "bg-[#00FF96]/20 text-[#00FF96] border border-[#00FF96]/40 cursor-default"
                      : "bg-gradient-to-r from-[#9600FF] to-[#4B00FF] text-white hover:brightness-110 shadow-[0_0_15px_rgba(150,0,255,0.4)]"
                  }`}
                >
                  {isSigned ? "Contrato Assinado! ✍️" : "Simular Assinatura Digital"}
                </button>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
