// frontend/src/pages/LandingPage/LiveChatSimulator.tsx
// Componente Interativo (Padrão 21st.dev):
// Simulador Operacional do Agente Vexo demonstrando a reativação de base parada (2.000 contatos)
// com cronograma anti-bloqueio, estimativa de resposta e minuta de simulação em PDF

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  CheckCheck,
  FileCheck2,
  FileText,
  Send,
  Sparkles,
  X,
  ShieldCheck,
  ExternalLink,
  Download,
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
      text: "Oi, tudo bem? Vi vocês no Instagram. Tenho uns 2 mil contatos no WhatsApp mas confesso que a maioria tá parado há meses. Dá pra fazer alguma coisa com isso?",
    },
    {
      id: "msg-2",
      sender: "agent",
      time: "10:42",
      badge: "Vexo · 1,8s · RAG ativo",
      text: "Dá, e normalmente é onde está o dinheiro mais barato 🙂\n\nDeixa eu te perguntar duas coisas rápidas:\n1. Esses 2 mil vieram de onde — site, indicação, grupo?\n2. Quando foi a última vez que alguém falou com eles?",
    },
    {
      id: "msg-3",
      sender: "user",
      time: "10:43",
      text: "Maioria é de grupo de WhatsApp e indicação. Última vez... uns 6 meses.",
    },
    {
      id: "msg-4",
      sender: "agent",
      time: "10:43",
      badge: "Vexo · 1,8s · RAG ativo",
      text: "Perfeito. Base de grupo e indicação responde melhor que lista fria, e 6 meses é tempo bom pra reabordar sem parecer insistente.\n\nNuma campanha parecida, de 366 contatos nessa mesma situação:\n→ 62,7% responderam\n→ zero bloqueio de chip\n\nMontei uma simulação da sua: 2.000 contatos, 10 por lote, 1 lote por hora, dentro do horário comercial. Leva 2 dias e meio e não queima seu número.",
      contract: {
        name: "Simulacao_Reativacao_2000_contatos.pdf",
        details: "Cronograma · Estimativa de resposta · Mensagens sugeridas",
        status: "Gerado",
      },
    },
  ]);

  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSimulationApproved, setIsSimulationApproved] = useState(false);

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

    // Simula raciocínio e geração contextual da IA comercial com balão "..."
    setTimeout(() => {
      let replyText = "";
      let hasContract = false;
      let badge = "Vexo · 1,8s · RAG ativo";

      const lower = text.toLowerCase();
      if (lower.includes("parada") || lower.includes("reativação") || lower.includes("simular")) {
        replyText =
          "Com base nos seus dados: podemos disparar em 3 chips em rodízio inteligente. Em 2 dias e meio sua base de 2.000 contatos é aquecida, e os interessados caem direto para o vendedor com histórico e qualificação pronta.";
        hasContract = true;
      } else if (lower.includes("trava") || lower.includes("humana") || lower.includes("seguran")) {
        replyText =
          "A Trava Humana é inviolável: nenhuma mensagem ou proposta sai da sua empresa sem que o operador humano dê o 'De Acordo'. A IA sugere, você autoriza.";
        badge = "Protocolo de Segurança Comercial Vexo";
      } else if (lower.includes("bloqueio") || lower.includes("chip") || lower.includes("whatsapp")) {
        replyText =
          "Zero bloqueio: operamos com lotes controlados (10 envios/hora por chip), rodízio de horário e variação sintática na abordagem para simular comportamento 100% humano perante o WhatsApp.";
        badge = "Módulo Anti-Bloqueio Multichip Ativo";
      } else if (lower.includes("preço") || lower.includes("plano") || lower.includes("quanto")) {
        replyText =
          "Para campanhas com rodízio e anti-bloqueio, o plano Disparo começa em R$ 97/mês. Para ter o agente de IA qualificador atendendo 24/7 e gerando minutas, o plano Avançado sai por R$ 947/mês.";
      } else {
        replyText =
          "Entendido! O Vexo OS integra base parada, cadência de reativação em lote e agentes de qualificação para transformar contatos esquecidos em contratos fechados.";
      }

      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        sender: "agent",
        time: getCurrentTime(),
        badge,
        text: replyText,
        contract: hasContract
          ? {
              name: "Simulacao_Reativacao_2000_contatos.pdf",
              details: "Cronograma · Estimativa de resposta · Mensagens sugeridas",
              status: "Gerado",
            }
          : undefined,
      };

      setMessages((prev) => [...prev, agentMsg]);
      setIsTyping(false);
    }, 1500);
  }

  const quickChips = [
    { label: "💬 Base parada", prompt: "Como vocês reativam contatos que não compram há mais de 6 meses?" },
    { label: "📊 Simular reativação", prompt: "Pode simular o cronograma de disparo para minha base?" },
    { label: "🔒 Trava Humana", prompt: "Como funciona a trava humana para segurança da operação?" },
    { label: "⚡ Anti-Bloqueio", prompt: "Qual o segredo para ter zero bloqueios de chip nas campanhas?" },
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
          <span>Ver PDF Simulação</span>
        </button>
      </div>

      {/* Chips Rápidos de Interação Conforme Especificação */}
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
                <p className="leading-relaxed whitespace-pre-line">{msg.text}</p>
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
                <p className="leading-relaxed text-white/85 whitespace-pre-line">{msg.text}</p>

                {/* Card de Simulação em PDF */}
                {msg.contract && (
                  <div
                    onClick={() => setIsModalOpen(true)}
                    className="mt-3 group rounded-xl border border-[#9600FF]/40 bg-[#1C1642] p-2.5 flex items-center justify-between gap-3 hover:border-[#9600FF]/80 hover:bg-[#231B54] transition-all cursor-pointer shadow-lg"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#9600FF]/30 text-[#D7B4FF] group-hover:scale-105 transition-transform shrink-0">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="overflow-hidden">
                        <p className="text-[11px] font-bold text-white group-hover:text-[#D7B4FF] transition-colors truncate">
                          {msg.contract.name}
                        </p>
                        <p className="text-[9px] text-white/50 truncate">{msg.contract.details}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="rounded-md bg-[#00FF96]/15 border border-[#00FF96]/30 px-2 py-0.5 text-[9px] font-bold text-[#00FF96]">
                        {msg.contract.status}
                      </span>
                      <ExternalLink className="h-3 w-3 text-white/40 group-hover:text-white" />
                    </div>
                  </div>
                )}

                <div className="mt-2.5 flex items-center justify-between text-[9px] text-white/40 pt-2 border-t border-white/5">
                  <span className="text-[#D7B4FF] font-medium">🔒 Trava humana ativa: nada é enviado sem o seu OK</span>
                  <span>{msg.time}</span>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Indicador de Digitação do Agente com Balão "..." */}
        {isTyping && (
          <div className="flex justify-start animate-in fade-in duration-200">
            <div className="rounded-2xl rounded-tl-sm bg-[#13112E] border border-[#9600FF]/30 px-4 py-3 text-xs text-white/70 flex items-center gap-2.5 shadow-lg">
              <span className="h-2 w-2 rounded-full bg-[#D7B4FF] animate-bounce [animation-delay:-0.3s]" />
              <span className="h-2 w-2 rounded-full bg-[#D7B4FF] animate-bounce [animation-delay:-0.15s]" />
              <span className="h-2 w-2 rounded-full bg-[#D7B4FF] animate-bounce" />
              <span className="text-[10px] font-mono text-white/40 ml-1">Vexo digitando...</span>
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
          placeholder="Envie uma pergunta ou simule sua base de contatos..."
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

      {/* MODAL DE PRÉ-VISUALIZAÇÃO DA SIMULAÇÃO GERADA */}
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
                    Simulacao_Reativacao_2000_contatos.pdf
                  </h3>
                  <p className="text-[11px] text-white/50">
                    Cronograma · Estimativa de resposta · Script homologado anti-bloqueio
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
            <div className="space-y-4 max-h-[320px] overflow-y-auto pr-2 text-xs text-white/80 leading-relaxed font-light bg-black/30 p-4 rounded-xl border border-white/5 font-mono">
              <div className="text-center font-bold text-white border-b border-white/10 pb-2">
                PLANO DE REATIVAÇÃO DE BASE COMERCIAL — VEXO OS
              </div>
              <p>
                <strong>BASE ANALISADA:</strong> 2.000 contatos inativos (tempo de silêncio &gt; 6 meses).
                <br />
                <strong>ESTIMATIVA DE RESPOSTA HISTÓRICA:</strong> 62,7% em grupos/indicações (benchmark medido).
              </p>
              <div>
                <strong className="text-[#D7B4FF]">1. CRONOGRAMA DE DISPARO FRACIONADO (ANTI-BLOQUEIO):</strong>
                <p className="mt-1 text-white/70">
                  - Lotes de 10 contatos por hora, por chip, estritamente entre 09:00 e 18:00 de dias úteis.
                  <br />
                  - Duração prevista: 2 dias e meio para conclusão total da esteira sem risco de queima do número.
                </p>
              </div>
              <div>
                <strong className="text-[#D7B4FF]">2. SCRIPT DE ABORDAGEM HOMOLOGADO:</strong>
                <p className="mt-1 text-white/70">
                  Mensagens personalizadas com menção à origem do contato e pergunta de desfecho leve, com variação sintática para cada destinatário.
                </p>
              </div>
              <div>
                <strong className="text-[#D7B4FF]">3. TRAVA HUMANA &amp; TRANSBORDO:</strong>
                <p className="mt-1 text-white/70">
                  A IA assume as respostas imediatas e a triagem inicial. Assim que o cliente demonstra interesse concreto, o lead é distribuído ao vendedor com o resumo completo da conversa.
                </p>
              </div>
            </div>

            {/* Rodapé com Assinatura e Ações */}
            <div className="mt-5 flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-white/10">
              <div className="flex items-center gap-2 text-xs">
                <ShieldCheck className="h-4 w-4 text-[#00FF96]" />
                <span className="text-white/60 text-[11px]">
                  {isSimulationApproved
                    ? "✓ Simulação Validada no Protocolo Vexo"
                    : "Plano pronto para execução com trava humana"}
                </span>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setIsSimulationApproved(true)}
                  className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isSimulationApproved
                      ? "bg-[#00FF96]/20 text-[#00FF96] border border-[#00FF96]/40 cursor-default"
                      : "bg-gradient-to-r from-[#9600FF] to-[#4B00FF] text-white hover:brightness-110 shadow-[0_0_15px_rgba(150,0,255,0.4)]"
                  }`}
                >
                  {isSimulationApproved ? "Simulação Aprovada! 🚀" : "Aprovar Esteira de Disparo"}
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
