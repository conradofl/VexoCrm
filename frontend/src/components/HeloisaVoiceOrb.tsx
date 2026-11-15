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

function getSupportedMimeType(): string {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return "audio/webm";
  }
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}

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

export function HeloisaVoiceOrb() {
  const { isInternalUser, isAdminUser, getIdToken } = useAuth();
  const location = useLocation();

  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<HeloisaStatus>("idle");
  const [messages, setMessages] = useState<VoiceMessage[]>([
    {
      id: "init-1",
      sender: "heloisa",
      text: "Olá! Sou a Heloísa, sua assistente executiva. Toque no microfone para falar ou digite sua solicitação.",
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [inputText, setInputText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Somente renderiza para usuários internos e administradores
  if (!isInternalUser && !isAdminUser) {
    return null;
  }

  // Rolagem suave para o fim das mensagens
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, status]);

  // Limpeza de streams e áudio ao desmontar
  useEffect(() => {
    return () => {
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
    };
  }, []);

  // Envio de mensagem para a Heloísa (áudio base64 ou texto)
  const enviarParaHeloisa = async ({
    audioBase64,
    audioMimetype,
    text,
  }: {
    audioBase64?: string;
    audioMimetype?: string;
    text?: string;
  }) => {
    setStatus("consultando");
    setErrorMessage(null);

    // Se veio texto digitado, exibe de imediato na conversa
    if (text && !audioBase64) {
      const userMsg: VoiceMessage = {
        id: `user-${Date.now()}`,
        sender: "user",
        text,
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, userMsg]);
    }

    try {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/heloisa/voice-chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audioBase64,
          audioMimetype,
          text,
          currentPage: location.pathname,
          clientId: "geracao-digital",
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Erro ${res.status} ao comunicar com a Heloísa.`);
      }

      const data = await res.json();

      // Se veio áudio transcrito no backend, registra a mensagem do usuário se ainda não estiver na tela
      if (data.userText && audioBase64) {
        const userAudioMsg: VoiceMessage = {
          id: `user-${Date.now()}`,
          sender: "user",
          text: data.userText,
          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, userAudioMsg]);
      }

      // Adiciona resposta da Heloísa
      const heloisaMsg: VoiceMessage = {
        id: `heloisa-${Date.now()}`,
        sender: "heloisa",
        text: data.responseText || "Solicitação atendida com sucesso.",
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        executedTools: data.executedTools || [],
      };
      setMessages((prev) => [...prev, heloisaMsg]);

      // Reproduz áudio TTS retornado caso não esteja mutado
      if (data.audioBase64 && !isMuted && audioPlayerRef.current) {
        const mime = data.audioMimetype || "audio/mp3";
        audioPlayerRef.current.src = `data:${mime};base64,${data.audioBase64}`;
        setStatus("falando");
        audioPlayerRef.current
          .play()
          .catch((err) => {
            console.warn("[Heloísa] Autoplay bloqueado pelo navegador:", err);
            setStatus("idle");
          });
      } else {
        setStatus("idle");
      }
    } catch (err: any) {
      console.error("[Heloísa] Erro ao enviar mensagem:", err);
      setErrorMessage(err.message || "Falha ao consultar a Heloísa.");
      setStatus("idle");
    }
  };

  // Iniciar gravação de voz no navegador
  const iniciarGravacao = async () => {
    setErrorMessage(null);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      activeStreamRef.current = stream;

      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (activeStreamRef.current) {
          activeStreamRef.current.getTracks().forEach((track) => track.stop());
          activeStreamRef.current = null;
        }

        if (audioBlob.size > 500) {
          const reader = new FileReader();
          reader.onloadend = () => {
            const rawBase64 = (reader.result as string)?.split(",")?.[1];
            if (rawBase64) {
              enviarParaHeloisa({
                audioBase64: rawBase64,
                audioMimetype: mimeType,
              });
            }
          };
          reader.readAsDataURL(audioBlob);
        } else {
          setStatus("idle");
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setStatus("ouvindo");
    } catch (err: any) {
      console.error("[Heloísa] Erro ao acessar microfone:", err);
      setErrorMessage(
        "Acesso ao microfone negado ou indisponível. Conceda permissão no navegador ou digite sua mensagem."
      );
      setStatus("idle");
    }
  };

  // Parar gravação de voz
  const pararGravacao = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      setStatus("consultando");
    }
  };

  // Alternar gravação
  const toggleGravacao = () => {
    if (status === "ouvindo") {
      pararGravacao();
    } else {
      iniciarGravacao();
    }
  };

  // Interromper fala da Heloísa
  const pararFala = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
    }
    setStatus("idle");
  };

  // Enviar texto manual
  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    const textoLimpo = inputText.trim();
    if (!textoLimpo || status === "consultando") return;

    setInputText("");
    enviarParaHeloisa({ text: textoLimpo });
  };

  // Limpar conversa
  const handleLimparConversa = () => {
    setMessages([
      {
        id: `init-${Date.now()}`,
        sender: "heloisa",
        text: "Histórico reiniciado. Como posso te apoiar agora?",
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  };

  return (
    <>
      <style>{`
        @keyframes heloisaWave {
          0%, 100% { height: 6px; }
          50% { height: 26px; }
        }
        @keyframes heloisaPulseRing {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.35); opacity: 0; }
          100% { transform: scale(0.95); opacity: 0; }
        }
      `}</style>

      {/* Player HTML5 Nativo Invisível */}
      <audio
        ref={audioPlayerRef}
        onEnded={() => setStatus("idle")}
        onError={() => setStatus("idle")}
        onPause={() => {
          if (status === "falando") setStatus("idle");
        }}
        className="hidden"
      />

      {/* PAINEL / DRAWER FLUTUANTE DA HELOÍSA */}
      {isOpen && (
        <div
          role="region"
          aria-label="Assistente de Voz Heloísa"
          className="fixed bottom-24 right-4 sm:right-6 z-50 w-[360px] sm:w-[410px] max-w-[calc(100vw-1.5rem)] h-[540px] max-h-[calc(100vh-7.5rem)] rounded-2xl border border-purple-500/30 bg-slate-950/95 shadow-[0_20px_60px_rgba(79,70,229,0.25)] backdrop-blur-2xl flex flex-col overflow-hidden text-slate-100 transition-all duration-300 animate-in fade-in slide-in-from-bottom-5"
        >
          {/* Cabeçalho */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-purple-500/20 bg-gradient-to-r from-purple-950/50 via-slate-950 to-indigo-950/50">
            <div className="flex items-center gap-3">
              <div className="relative flex items-center justify-center h-10 w-10 rounded-full bg-gradient-to-tr from-purple-600 via-indigo-600 to-violet-500 shadow-md shadow-purple-500/30 text-white">
                <Bot className="h-5 w-5" />
                <span
                  className={cn(
                    "absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-slate-950 transition-colors",
                    status === "ouvindo"
                      ? "bg-rose-500 animate-pulse"
                      : status === "consultando"
                      ? "bg-amber-400 animate-spin"
                      : status === "falando"
                      ? "bg-purple-400 animate-pulse"
                      : "bg-emerald-400"
                  )}
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm tracking-wide text-white">Heloísa</h3>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-400/40 text-purple-300">
                    Voz Two-Way
                  </Badge>
                </div>
                <p className="text-xs text-slate-400">Secretária Executiva • Vexo OS</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsMuted(!isMuted)}
                className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
                title={isMuted ? "Ativar som da Heloísa" : "Mutar áudio da Heloísa"}
              >
                {isMuted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLimparConversa}
                className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
                title="Reiniciar conversa"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Ondas de Áudio Animadas & Status Central */}
          <div className="relative px-4 py-3 bg-gradient-to-b from-purple-950/20 to-transparent border-b border-white/5 flex flex-col items-center justify-center">
            {/* Visualizador de Ondas Sonoras */}
            <div className="flex items-center justify-center gap-1.5 h-10 w-full">
              {[0.1, 0.3, 0.5, 0.7, 0.4, 0.2, 0.6].map((delay, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "w-1 rounded-full transition-all duration-200",
                    status === "ouvindo"
                      ? "bg-gradient-to-t from-rose-500 to-pink-400"
                      : status === "falando"
                      ? "bg-gradient-to-t from-purple-400 to-indigo-300"
                      : status === "consultando"
                      ? "bg-amber-400/70"
                      : "bg-slate-700 h-2"
                  )}
                  style={{
                    height: status === "ouvindo" || status === "falando" ? undefined : "6px",
                    animation:
                      status === "ouvindo" || status === "falando"
                        ? `heloisaWave 0.9s ease-in-out infinite`
                        : undefined,
                    animationDelay: `${delay}s`,
                  }}
                />
              ))}
            </div>

            {/* Status Texto */}
            <div className="mt-1 flex items-center gap-2 text-xs font-medium">
              {status === "ouvindo" && (
                <span className="flex items-center gap-1.5 text-rose-400 animate-pulse">
                  <Radio className="h-3.5 w-3.5" />
                  Ouvindo sua fala...
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
                    (Parar)
                  </button>
                </span>
              )}
              {status === "idle" && (
                <span className="text-slate-400">Pronta para falar ou receber tarefas</span>
              )}
            </div>

            {errorMessage && (
              <div className="mt-2 text-[11px] text-rose-400 text-center bg-rose-950/40 border border-rose-500/20 px-2 py-1 rounded w-full">
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
                    ? "ml-auto bg-gradient-to-r from-purple-700 to-indigo-600 text-white rounded-br-sm"
                    : "mr-auto bg-slate-900 border border-white/10 text-slate-200 rounded-bl-sm"
                )}
              >
                <div className="flex items-center justify-between gap-3 mb-1 text-[10px] text-slate-300/80">
                  <span className="font-medium">
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

          {/* Controles de Gravação & Input de Texto */}
          <div className="p-3 border-t border-white/10 bg-slate-950/80 flex flex-col gap-2">
            {/* Botão de Toque para Falar */}
            <div className="flex items-center justify-center">
              <Button
                type="button"
                onClick={toggleGravacao}
                disabled={status === "consultando"}
                className={cn(
                  "w-full py-4 text-xs font-semibold rounded-xl transition-all shadow-md flex items-center justify-center gap-2",
                  status === "ouvindo"
                    ? "bg-rose-600 hover:bg-rose-700 text-white animate-pulse"
                    : "bg-gradient-to-r from-purple-600 via-indigo-600 to-violet-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-600/30"
                )}
              >
                {status === "ouvindo" ? (
                  <>
                    <MicOff className="h-4 w-4" />
                    Ouvindo... Toque para Enviar
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" />
                    Toque para Falar com a Heloísa
                  </>
                )}
              </Button>
            </div>

            {/* Input de Texto Rápido */}
            <form onSubmit={handleSendText} className="flex items-center gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ou digite sua ordem aqui..."
                disabled={status === "consultando" || status === "ouvindo"}
                className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!inputText.trim() || status === "consultando"}
                className="h-8 w-8 rounded-xl bg-purple-600 hover:bg-purple-700 text-white shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* BOTÃO ORBE FLUTUANTE GLOBAL (fixed bottom-6 right-6 z-50) */}
      <div className="fixed bottom-6 right-6 z-50 print:hidden">
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                  "relative flex items-center justify-center h-14 w-14 rounded-full transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-purple-500/40",
                  "bg-gradient-to-tr from-purple-700 via-indigo-600 to-violet-500 shadow-[0_0_25px_rgba(147,51,234,0.45)] hover:shadow-[0_0_35px_rgba(147,51,234,0.7)] hover:scale-105 active:scale-95 text-white ring-2 ring-white/30",
                  isOpen && "ring-purple-400 ring-offset-2 ring-offset-slate-950 scale-105",
                  status === "ouvindo" && "from-rose-600 via-pink-600 to-purple-600 ring-rose-400 animate-pulse",
                  status === "falando" && "from-violet-600 via-purple-500 to-indigo-600 ring-purple-300"
                )}
                aria-label="Falar com a Heloísa (Voz)"
              >
                {/* Efeito de radar pulsante quando ativo */}
                {(status === "ouvindo" || status === "falando") && (
                  <span
                    className={cn(
                      "absolute inset-0 rounded-full pointer-events-none",
                      status === "ouvindo" ? "bg-rose-500/30" : "bg-purple-500/30"
                    )}
                    style={{ animation: "heloisaPulseRing 1.8s infinite ease-out" }}
                  />
                )}

                {status === "ouvindo" ? (
                  <Mic className="h-6 w-6 animate-pulse" />
                ) : status === "falando" ? (
                  <Volume2 className="h-6 w-6 animate-bounce" />
                ) : status === "consultando" ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : isOpen ? (
                  <Bot className="h-6 w-6" />
                ) : (
                  <div className="relative flex items-center justify-center">
                    <Mic className="h-6 w-6" />
                    <Sparkles className="h-3 w-3 absolute -top-1.5 -right-1.5 text-amber-300 animate-pulse" />
                  </div>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="left"
              className="bg-slate-900 border border-purple-500/30 text-white text-xs px-3 py-1.5 rounded-lg shadow-xl"
            >
              Falar com a Heloísa (Voz)
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </>
  );
}
