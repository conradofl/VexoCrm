import React, { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  X,
  Send,
  Sparkles,
  Bot,
  Calendar,
  MessageSquare,
  UserCheck,
  Clock,
  Loader2,
  RotateCcw,
  Radio,
  CheckCircle2,
  Zap,
  Ear,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface ExecutedTool {
  name: string;
  args?: Record<string, any>;
  resultado?: Record<string, any>;
}

export interface VoiceMessage {
  id: string;
  sender: "user" | "heloisa";
  text: string;
  timestamp: string;
  executedTools?: ExecutedTool[];
}

type HeloisaStatus = "idle" | "ouvindo" | "consultando" | "falando";

function formatToolBadge(tool: ExecutedTool) {
  switch (tool.name) {
    case "cadastrar_cliente":
      return {
        icon: <UserCheck className="h-3 w-3 mr-1 text-emerald-400" />,
        label: `Cliente cadastrado: ${tool.args?.nome || ""}`,
        variant: "border-emerald-500/40 bg-emerald-950/40 text-emerald-300",
      };
    case "cobrar_colaborador":
      return {
        icon: <MessageSquare className="h-3 w-3 mr-1 text-sky-400" />,
        label: `${tool.args?.colaborador || "Colaborador"} cobrado no WhatsApp`,
        variant: "border-sky-500/40 bg-sky-950/40 text-sky-300",
      };
    case "agendar_compromisso":
      return {
        icon: <Calendar className="h-3 w-3 mr-1 text-purple-400" />,
        label: `Reunião agendada: ${tool.args?.titulo || "Compromisso"}`,
        variant: "border-purple-500/40 bg-purple-950/40 text-purple-300",
      };
    case "criar_followup":
      return {
        icon: <Clock className="h-3 w-3 mr-1 text-amber-400" />,
        label: `Lembrete criado: ${tool.args?.titulo || "Follow-up"}`,
        variant: "border-amber-500/40 bg-amber-950/40 text-amber-300",
      };
    case "consultar_operacao":
      return {
        icon: <CheckCircle2 className="h-3 w-3 mr-1 text-indigo-400" />,
        label: `Operação consultada (${tool.args?.tipo || "Geral"})`,
        variant: "border-indigo-500/40 bg-indigo-950/40 text-indigo-300",
      };
    default:
      return {
        icon: <Sparkles className="h-3 w-3 mr-1 text-violet-400" />,
        label: `Ação executada: ${tool.name}`,
        variant: "border-violet-500/40 bg-violet-950/40 text-violet-300",
      };
  }
}

// ─── Síntese de Voz Gratuita Nativa (Web Speech API) ──────────────────────────
function speakNativeTTS({
  text,
  onStart,
  onEnd,
}: {
  text: string;
  onStart?: () => void;
  onEnd?: () => void;
}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd?.();
    return;
  }

  window.speechSynthesis.cancel();

  // Limpeza de marcações markdown para dicção fluida e executiva
  const cleanText = text
    .replace(/[*#_`~>•-]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanText) {
    onEnd?.();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = "pt-BR";
  utterance.rate = 1.05;
  utterance.pitch = 1.02;

  const voices = window.speechSynthesis.getVoices();
  const ptVoices = voices.filter(
    (v) => v.lang === "pt-BR" || v.lang.toLowerCase().startsWith("pt")
  );

  // Seleciona a melhor voz feminina em pt-BR disponível no sistema
  const selectedVoice =
    ptVoices.find((v) => /Google.*português/i.test(v.name)) ||
    ptVoices.find((v) => /Luciana/i.test(v.name)) ||
    ptVoices.find((v) => /Francisca/i.test(v.name)) ||
    ptVoices.find((v) => /Leticia|Letícia/i.test(v.name)) ||
    ptVoices.find((v) => /Feminina|Female/i.test(v.name)) ||
    ptVoices.find((v) => v.lang === "pt-BR") ||
    ptVoices[0];

  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  utterance.onstart = () => {
    onStart?.();
  };

  utterance.onend = () => {
    onEnd?.();
  };

  utterance.onerror = (e) => {
    console.warn("[Heloísa TTS] Evento de erro ou cancelamento:", e);
    onEnd?.();
  };

  window.speechSynthesis.speak(utterance);
}

export function HeloisaVoiceOrb() {
  const { isInternalUser, isAdminUser, getIdToken } = useAuth();
  const location = useLocation();

  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<HeloisaStatus>("idle");
  const [isHandsFreeActive, setIsHandsFreeActive] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");

  const [messages, setMessages] = useState<VoiceMessage[]>([
    {
      id: "init-1",
      sender: "heloisa",
      text: "Olá! Sou a Heloísa. Diga 'Heloísa' a qualquer momento para falar, ou me envie uma solicitação.",
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isSpeakingRef = useRef<boolean>(false);

  // Somente renderiza para usuários internos e administradores
  if (!isInternalUser && !isAdminUser) {
    return null;
  }

  // Rolagem suave para o fim das mensagens
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, liveTranscript, status]);

  // Carrega lista de vozes do navegador
  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  // Envio de texto para o backend
  const enviarParaHeloisa = useCallback(
    async ({ text }: { text: string }) => {
      const promptLimpo = text.trim();
      if (!promptLimpo) return;

      setStatus("consultando");
      setErrorMessage(null);
      setLiveTranscript("");

      // Registra mensagem do usuário no histórico
      const userMsg: VoiceMessage = {
        id: `user-${Date.now()}`,
        sender: "user",
        text: promptLimpo,
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const token = await getIdToken();
        const res = await fetchApi("/api/goclaw/heloisa/voice-chat", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: promptLimpo,
            currentPage: location.pathname,
            clientId: "geracao-digital",
          }),
        });

        if (!res.ok) {
          let errText = `Erro ${res.status}`;
          try {
            const errJson = await res.json();
            errText = errJson?.error || errText;
          } catch {
            const raw = await res.text().catch(() => "");
            if (raw) errText = raw.slice(0, 100);
          }
          throw new Error(errText);
        }

        const data = await res.json();
        const responseText = data.responseText || "Ação processada com sucesso.";

        // Adiciona resposta da Heloísa ao histórico
        const heloisaMsg: VoiceMessage = {
          id: `heloisa-${Date.now()}`,
          sender: "heloisa",
          text: responseText,
          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          executedTools: data.executedTools || [],
        };
        setMessages((prev) => [...prev, heloisaMsg]);

        // Síntese de voz gratuita nativa (window.speechSynthesis)
        if (!isMuted) {
          isSpeakingRef.current = true;
          setStatus("falando");
          speakNativeTTS({
            text: responseText,
            onStart: () => {
              isSpeakingRef.current = true;
              setStatus("falando");
            },
            onEnd: () => {
              isSpeakingRef.current = false;
              setStatus("idle");
            },
          });
        } else {
          setStatus("idle");
        }
      } catch (err: any) {
        console.error("[Heloísa] Erro ao enviar:", err);
        const readableError =
          typeof err === "string"
            ? err
            : err?.message
            ? String(err.message)
            : "Falha de comunicação com o servidor.";
        setErrorMessage(readableError);
        setStatus("idle");
      }
    },
    [getIdToken, isMuted, location.pathname]
  );

  // ─── Hands-Free: Wake Word "Heloísa" + Detecção de Silêncio 1.2s ───────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn("[Heloísa] SpeechRecognition não suportado neste navegador.");
      return;
    }

    let recognition: any = null;

    try {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "pt-BR";
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        // Se a Heloísa estiver falando via TTS, não processa para evitar eco
        if (isSpeakingRef.current) return;

        let interim = "";
        let finalConcat = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const trans = event.results[i][0].transcript || "";
          if (event.results[i].isFinal) {
            finalConcat += trans;
          } else {
            interim += trans;
          }
        }

        const rawSpoken = (finalConcat || interim).trim();
        if (!rawSpoken) return;

        // 1. Verificação de Wake Word: "Heloísa" ou "Heloisa"
        const hasWakeWord = /\bhelo[íi]sa\b/i.test(rawSpoken);

        if (hasWakeWord) {
          setIsOpen(true);
          setStatus("ouvindo");
        }

        // Se o painel estiver aberto ou acabou de ouvir wake word
        if (hasWakeWord || isOpen) {
          // Extrai a ordem removendo o prefixo "Heloísa"
          const cleanOrder = rawSpoken.replace(/^.*?\bhelo[íi]sa\b[,.]?\s*/i, "").trim();
          setLiveTranscript(cleanOrder || rawSpoken);

          // 2. Detecção de Silêncio (Auto-send após 1.2s sem falar)
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }

          const comandoParaEnviar = cleanOrder || rawSpoken;
          if (comandoParaEnviar && comandoParaEnviar.length >= 3) {
            silenceTimerRef.current = setTimeout(() => {
              if (!isSpeakingRef.current && comandoParaEnviar) {
                enviarParaHeloisa({ text: comandoParaEnviar });
                setLiveTranscript("");
              }
            }, 1200);
          }
        }
      };

      recognition.onerror = (e: any) => {
        if (e.error === "not-allowed") {
          setErrorMessage("Permissão de microfone bloqueada pelo navegador.");
        } else if (e.error !== "no-speech") {
          console.warn("[Heloísa SpeechRecognition] Info:", e.error);
        }
      };

      recognition.onend = () => {
        // Reinicia escuta contínua se hands-free estiver ativo e não estiver falando
        if (isHandsFreeActive && !isSpeakingRef.current) {
          try {
            recognition.start();
          } catch {
            // Ignora se já estiver ativo
          }
        }
      };

      if (isHandsFreeActive) {
        try {
          recognition.start();
        } catch (e) {
          console.warn("[Heloísa] Falha ao iniciar reconhecimento:", e);
        }
      }

      recognitionRef.current = recognition;
    } catch (err) {
      console.warn("[Heloísa] Erro ao instanciar SpeechRecognition:", err);
    }

    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      if (recognition) {
        recognition.stop();
      }
    };
  }, [enviarParaHeloisa, isHandsFreeActive, isOpen]);

  // Interromper fala
  const pararFala = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    isSpeakingRef.current = false;
    setStatus("idle");
  };

  // Envio manual de texto via form
  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    const textoLimpo = inputText.trim();
    if (!textoLimpo || status === "consultando") return;

    setInputText("");
    enviarParaHeloisa({ text: textoLimpo });
  };

  // Limpar conversa
  const handleLimparConversa = () => {
    pararFala();
    setMessages([
      {
        id: `init-${Date.now()}`,
        sender: "heloisa",
        text: "Histórico reiniciado. Estou à disposição para te apoiar por voz ou comando.",
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  };

  return (
    <>
      <style>{`
        @keyframes heloisaNeonPulse {
          0%, 100% {
            box-shadow: 0 0 25px rgba(168, 85, 247, 0.65), 0 0 50px rgba(99, 102, 241, 0.45), 0 0 80px rgba(34, 211, 238, 0.25);
            transform: scale(1);
          }
          50% {
            box-shadow: 0 0 35px rgba(168, 85, 247, 0.9), 0 0 65px rgba(99, 102, 241, 0.6), 0 0 95px rgba(34, 211, 238, 0.4);
            transform: scale(1.04);
          }
        }
        @keyframes heloisaSineWave {
          0%, 100% { height: 6px; transform: scaleY(0.7); }
          50% { height: 28px; transform: scaleY(1.35); }
        }
        @keyframes heloisaOrbParticle {
          0% { transform: rotate(0deg) translateX(36px) rotate(0deg); opacity: 0.8; }
          100% { transform: rotate(360deg) translateX(36px) rotate(-360deg); opacity: 0.8; }
        }
      `}</style>

      {/* PAINEL TRANSLÚCIDO DE TRANSCRIÇÃO (Glassmorphism futurista) */}
      {isOpen && (
        <div
          role="region"
          aria-label="Painel de Transcrição Heloísa"
          className="fixed bottom-24 right-4 sm:right-6 z-50 w-[360px] sm:w-[420px] max-w-[calc(100vw-1.5rem)] h-[540px] max-h-[calc(100vh-7.5rem)] rounded-3xl backdrop-blur-2xl bg-slate-950/85 border border-purple-500/30 shadow-[0_25px_70px_rgba(79,70,229,0.35)] flex flex-col overflow-hidden text-slate-100 transition-all duration-300 animate-in fade-in slide-in-from-bottom-5"
        >
          {/* Cabeçalho Glassmorphism */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-purple-500/20 bg-gradient-to-r from-purple-950/60 via-slate-950/80 to-indigo-950/60">
            <div className="flex items-center gap-3">
              <div className="relative flex items-center justify-center h-10 w-10 rounded-full bg-gradient-to-tr from-purple-600 via-indigo-600 to-cyan-500 shadow-md shadow-purple-500/40 text-white">
                <Bot className="h-5 w-5" />
                <span
                  className={cn(
                    "absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-slate-950 transition-colors",
                    status === "ouvindo"
                      ? "bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]"
                      : status === "consultando"
                      ? "bg-amber-400 animate-spin"
                      : status === "falando"
                      ? "bg-purple-400 animate-pulse shadow-[0_0_8px_#c084fc]"
                      : "bg-emerald-400"
                  )}
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm tracking-wide text-white drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]">
                    Heloísa
                  </h3>
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 border-cyan-400/40 text-cyan-300 bg-cyan-950/30 flex items-center gap-1"
                  >
                    <Ear className="h-2.5 w-2.5" /> Hands-Free
                  </Badge>
                </div>
                <p className="text-xs text-slate-400">Secretária Executiva • Vexo OS</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsHandsFreeActive(!isHandsFreeActive)}
                className={cn(
                  "h-8 w-8 transition-colors",
                  isHandsFreeActive
                    ? "text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/40"
                    : "text-slate-500 hover:text-slate-300 hover:bg-white/10"
                )}
                title={isHandsFreeActive ? "Desativar escuta contínua" : "Ativar escuta contínua"}
              >
                {isHandsFreeActive ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsMuted(!isMuted)}
                className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
                title={isMuted ? "Desmutar voz nativa" : "Mutar voz nativa"}
              >
                {isMuted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLimparConversa}
                className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
                title="Limpar histórico"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
                title="Minimizar"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Linha de Frequência Sonora Reativa e Status Neon */}
          <div className="relative px-4 py-3 bg-gradient-to-b from-purple-950/30 to-transparent border-b border-white/5 flex flex-col items-center justify-center">
            {/* Visualizador de Ondas Senoidais Neon */}
            <div className="flex items-center justify-center gap-1.5 h-10 w-full">
              {[0.1, 0.25, 0.45, 0.65, 0.5, 0.35, 0.2, 0.55, 0.7].map((delay, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "w-1.5 rounded-full transition-all duration-150",
                    status === "ouvindo"
                      ? "bg-gradient-to-t from-cyan-400 via-indigo-400 to-purple-400 shadow-[0_0_8px_#22d3ee]"
                      : status === "falando"
                      ? "bg-gradient-to-t from-purple-500 via-pink-400 to-cyan-300 shadow-[0_0_8px_#c084fc]"
                      : status === "consultando"
                      ? "bg-amber-400/80 shadow-[0_0_6px_#fbbf24]"
                      : "bg-slate-700/60 h-2"
                  )}
                  style={{
                    height: status === "ouvindo" || status === "falando" ? undefined : "6px",
                    animation:
                      status === "ouvindo" || status === "falando"
                        ? `heloisaSineWave 0.85s ease-in-out infinite`
                        : undefined,
                    animationDelay: `${delay}s`,
                  }}
                />
              ))}
            </div>

            {/* Status Descritivo */}
            <div className="mt-1 flex items-center gap-2 text-xs font-medium">
              {status === "ouvindo" && (
                <span className="flex items-center gap-1.5 text-cyan-300 animate-pulse">
                  <Radio className="h-3.5 w-3.5" />
                  Ouvindo sua fala... (Pausa envia automaticamente)
                </span>
              )}
              {status === "consultando" && (
                <span className="flex items-center gap-1.5 text-amber-300">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Consultando o sistema Vexo OS...
                </span>
              )}
              {status === "falando" && (
                <span className="flex items-center gap-1.5 text-purple-300">
                  <Volume2 className="h-3.5 w-3.5 animate-pulse" />
                  Heloísa falando...
                  <button
                    onClick={pararFala}
                    className="ml-1 text-[11px] underline text-purple-200 hover:text-white"
                  >
                    (Parar fala)
                  </button>
                </span>
              )}
              {status === "idle" && (
                <span className="text-slate-400 flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-cyan-400" />
                  Diga <strong className="text-cyan-300">"Heloísa"</strong> a qualquer momento
                </span>
              )}
            </div>

            {/* Transcrição em Tempo Real da Fala Atual */}
            {liveTranscript && status === "ouvindo" && (
              <div className="mt-2 w-full p-2 rounded-xl bg-purple-950/40 border border-purple-400/30 text-xs text-cyan-200 animate-in fade-in flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping shrink-0" />
                <span className="italic truncate">{liveTranscript}</span>
              </div>
            )}

            {/* Mensagem de Erro Legível (sem [object Object]) */}
            {errorMessage && (
              <div className="mt-2 text-[11px] text-rose-300 text-center bg-rose-950/50 border border-rose-500/30 px-2.5 py-1.5 rounded-xl w-full">
                {errorMessage}
              </div>
            )}
          </div>

          {/* Histórico da Conversa Falada */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm scrollbar-thin scrollbar-thumb-purple-500/20">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex flex-col max-w-[85%] rounded-2xl p-3 shadow-sm transition-all",
                  msg.sender === "user"
                    ? "ml-auto bg-gradient-to-r from-purple-700 via-indigo-600 to-purple-800 text-white rounded-br-sm shadow-[0_4px_15px_rgba(126,34,206,0.3)]"
                    : "mr-auto bg-slate-900/90 border border-purple-500/20 text-slate-200 rounded-bl-sm shadow-[0_4px_15px_rgba(0,0,0,0.3)]"
                )}
              >
                <div className="flex items-center justify-between gap-3 mb-1 text-[10px] text-slate-300/80">
                  <span className="font-medium text-cyan-300">
                    {msg.sender === "user" ? "Você" : "Heloísa"}
                  </span>
                  <span>{msg.timestamp}</span>
                </div>
                <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>

                {/* Badges de Ferramentas Executadas */}
                {msg.executedTools && msg.executedTools.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-white/10 space-y-1.5">
                    {msg.executedTools.map((t, idx) => {
                      const badgeInfo = formatToolBadge(t);
                      return (
                        <div
                          key={idx}
                          className={cn(
                            "flex items-center text-[11px] px-2 py-1 rounded-md border",
                            badgeInfo.variant
                          )}
                        >
                          {badgeInfo.icon}
                          <span className="truncate">{badgeInfo.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Comandos Rápidos Sugeridos */}
          <div className="px-3 py-1.5 border-t border-white/5 bg-slate-950/60 flex items-center gap-1.5 overflow-x-auto no-scrollbar text-[11px]">
            <button
              onClick={() => enviarParaHeloisa({ text: "Heloísa, como está a operação da agência hoje?" })}
              className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 whitespace-nowrap border border-white/5"
            >
              📊 Resumo da operação
            </button>
            <button
              onClick={() => enviarParaHeloisa({ text: "Heloísa, quais clientes estão com prazo vencido?" })}
              className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 whitespace-nowrap border border-white/5"
            >
              ⏰ Prazos vencidos
            </button>
            <button
              onClick={() => enviarParaHeloisa({ text: "Heloísa, quais são meus compromissos de hoje e amanhã?" })}
              className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 whitespace-nowrap border border-white/5"
            >
              📅 Minha agenda
            </button>
          </div>

          {/* Input Manual de Texto Fallback */}
          <div className="p-3 border-t border-white/10 bg-slate-950/90">
            <form onSubmit={handleSendText} className="flex items-center gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Diga 'Heloísa...' ou digite sua ordem..."
                disabled={status === "consultando"}
                className="flex-1 bg-slate-900 border border-purple-500/20 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition-colors"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!inputText.trim() || status === "consultando"}
                className="h-8 w-8 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shrink-0 shadow-md shadow-purple-600/30"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* ORBE NEON FUTURISTA GLOBAL (fixed bottom-6 right-6 z-50) */}
      <div className="fixed bottom-6 right-6 z-50 print:hidden select-none">
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                  animation:
                    status === "ouvindo" || status === "falando"
                      ? "heloisaNeonPulse 2s infinite ease-in-out"
                      : undefined,
                }}
                className={cn(
                  "relative flex items-center justify-center h-16 w-16 rounded-full transition-all duration-300 focus:outline-none",
                  "bg-gradient-to-tr from-purple-800 via-indigo-600 to-cyan-400 text-white ring-2 ring-purple-300/40",
                  "shadow-[0_0_30px_rgba(168,85,247,0.65)] hover:shadow-[0_0_45px_rgba(34,211,238,0.7)] hover:scale-105 active:scale-95",
                  isOpen && "ring-cyan-400 ring-offset-2 ring-offset-slate-950 scale-105 shadow-[0_0_40px_rgba(34,211,238,0.7)]",
                  status === "ouvindo" && "from-cyan-500 via-purple-600 to-pink-500 ring-cyan-300 shadow-[0_0_40px_rgba(34,211,238,0.8)]",
                  status === "falando" && "from-violet-600 via-purple-500 to-cyan-400 ring-purple-300 shadow-[0_0_40px_rgba(192,132,252,0.8)]"
                )}
                aria-label="Falar com a Heloísa (Voz)"
              >
                {/* Partícula Luminosa em Órbita */}
                <span
                  className="absolute h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_#22d3ee] pointer-events-none"
                  style={{ animation: "heloisaOrbParticle 3.5s linear infinite" }}
                />

                {/* Linha de Frequência Sonora Reativa Central */}
                <div className="flex items-center justify-center gap-0.5 h-6">
                  {[0.1, 0.3, 0.5, 0.2, 0.4].map((delay, idx) => (
                    <span
                      key={idx}
                      className={cn(
                        "w-1 rounded-full transition-all duration-200",
                        status === "ouvindo"
                          ? "bg-cyan-200 shadow-[0_0_6px_#22d3ee]"
                          : status === "falando"
                          ? "bg-purple-200 shadow-[0_0_6px_#c084fc]"
                          : status === "consultando"
                          ? "bg-amber-300 animate-pulse"
                          : "bg-white/80 h-3"
                      )}
                      style={{
                        height: status === "ouvindo" || status === "falando" ? undefined : "12px",
                        animation:
                          status === "ouvindo" || status === "falando"
                            ? `heloisaSineWave 0.75s ease-in-out infinite`
                            : undefined,
                        animationDelay: `${delay}s`,
                      }}
                    />
                  ))}
                </div>

                {/* Microfone Flutuante de Canto */}
                <span className="absolute -top-1 -right-1 flex items-center justify-center h-5 w-5 rounded-full bg-slate-950 border border-cyan-400/60 shadow-sm text-cyan-300">
                  <Mic className="h-3 w-3" />
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="left"
              className="bg-slate-900/95 border border-purple-500/40 text-white text-xs px-3 py-1.5 rounded-xl shadow-2xl backdrop-blur-md"
            >
              <div className="flex flex-col">
                <span className="font-semibold text-cyan-300">Heloísa (Hands-Free)</span>
                <span className="text-[11px] text-slate-300">Diga "Heloísa" ou toque para abrir</span>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </>
  );
}
