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
  Ear,
  AlertCircle,
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
    case "enviar_mensagem_whatsapp": {
      const falhou = tool.resultado && tool.resultado.sucesso === false;
      const dest =
        tool.args?.destinatario ||
        tool.args?.colaborador ||
        tool.resultado?.destinatario ||
        tool.resultado?.colaborador ||
        "Destinatário";

      return {
        icon: falhou ? (
          <AlertCircle className="h-3 w-3 mr-1 text-rose-400" />
        ) : (
          <MessageSquare className="h-3 w-3 mr-1 text-emerald-400" />
        ),
        label: falhou
          ? `Falha no envio para ${dest}: ${tool.resultado?.erro || "Chip desconectado"}`
          : `WhatsApp enviado para ${dest}`,
        variant: falhou
          ? "border-rose-500/40 bg-rose-950/40 text-rose-300"
          : "border-emerald-500/40 bg-emerald-950/40 text-emerald-300",
      };
    }
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
    case "auditar_geral_vexo":
      return {
        icon: <Sparkles className="h-3 w-3 mr-1 text-cyan-400" />,
        label: `Auditoria Vexo OS: ${tool.args?.tenant_id || "Todos os Tenants"}`,
        variant: "border-cyan-500/40 bg-cyan-950/40 text-cyan-300",
      };
    case "consultar_cliente_ou_lead":
      return {
        icon: <UserCheck className="h-3 w-3 mr-1 text-emerald-400" />,
        label: `Busca no Vexo: "${tool.args?.termo_busca || ""}"`,
        variant: "border-emerald-500/40 bg-emerald-950/40 text-emerald-300",
      };
    default:
      return {
        icon: <Sparkles className="h-3 w-3 mr-1 text-violet-400" />,
        label: `Ação executada: ${tool.name}`,
        variant: "border-violet-500/40 bg-violet-950/40 text-violet-300",
      };
  }
}

// Variáveis a nível de módulo para prevenir Garbage Collection (Bug Crítico Safari/iOS)
let _activeUtterance: SpeechSynthesisUtterance | null = null;
let _speechWatchdog: any = null;

export function getActiveUtterance(): SpeechSynthesisUtterance | null {
  return _activeUtterance;
}

/**
 * Detecta se o dispositivo do usuário é móvel (iOS / Android)
 */
export function isMobileDevice(ua?: string): boolean {
  if (typeof ua === "string") {
    return /iPhone|iPad|iPod|Android/i.test(ua);
  }
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
}

/**
 * Destravamento de Áudio no Primeiro Gesto do Usuário (Mobile Audio Unlock - iOS Safari & Android Chrome)
 * Executa uma fala muda rápida de 0s e invoca resume() para capturar o User Gesture Token do navegador.
 */
export function destravarAudioMobile() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.resume();
    const dummy = new SpeechSynthesisUtterance("");
    dummy.volume = 0;
    dummy.rate = 10;
    window.speechSynthesis.speak(dummy);
  } catch (e) {
    console.warn("[Heloísa] Falha ao destravar áudio mobile:", e);
  }
}

// ─── Síntese de Voz Gratuita Nativa (Web Speech API) ──────────────────────────
export function speakNativeTTS({
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

  const doSpeak = () => {
    try {
      window.speechSynthesis.resume();
    } catch {}

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = "pt-BR";
    utterance.rate = 1.05;
    utterance.pitch = 1.02;

    // Fallback de Voz no iOS:
    // No iOS, window.speechSynthesis.getVoices() costuma retornar array vazio inicialmente.
    // Se selectedVoice for indefinido, NÃO force utterance.voice = undefined. Apenas defina utterance.lang = "pt-BR".
    try {
      const voices = window.speechSynthesis.getVoices() || [];
      const ptVoices = voices.filter(
        (v) => v.lang === "pt-BR" || (v.lang && v.lang.toLowerCase().startsWith("pt"))
      );

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
    } catch (err) {
      console.warn("[Heloísa TTS] Erro ao carregar vozes:", err);
    }

    // Prevenção de Garbage Collection (Bug Crítico Safari/iOS)
    _activeUtterance = utterance;
    if (typeof window !== "undefined") {
      (window as any)._activeUtterance = utterance;
    }

    const limparUtterance = () => {
      _activeUtterance = null;
      if (typeof window !== "undefined") {
        (window as any)._activeUtterance = null;
      }
      if (_speechWatchdog) {
        clearInterval(_speechWatchdog);
        _speechWatchdog = null;
      }
    };

    utterance.onstart = () => {
      // Watchdog de Fala:
      // Adiciona watchdog com setInterval de 1s que executa window.speechSynthesis.resume()
      // enquanto window.speechSynthesis.speaking for true, evitando que o navegador pause a fala no meio da frase.
      if (_speechWatchdog) clearInterval(_speechWatchdog);
      _speechWatchdog = setInterval(() => {
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          if (window.speechSynthesis.speaking) {
            window.speechSynthesis.resume();
          } else {
            if (_speechWatchdog) {
              clearInterval(_speechWatchdog);
              _speechWatchdog = null;
            }
          }
        }
      }, 1000);

      onStart?.();
    };

    utterance.onend = () => {
      limparUtterance();
      onEnd?.();
    };

    utterance.onerror = (e) => {
      console.warn("[Heloísa TTS] Evento de erro ou cancelamento:", e);
      limparUtterance();
      onEnd?.();
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn("[Heloísa TTS] Falha ao invocar speak():", err);
      limparUtterance();
      onEnd?.();
    }
  };

  // Eliminar Deadlock do speechSynthesis.cancel():
  // NÃO chame window.speechSynthesis.cancel() colado no speak().
  // Se window.speechSynthesis.speaking for true, chame cancel() e aguarde 80ms via setTimeout
  // antes de chamar window.speechSynthesis.resume() e window.speechSynthesis.speak().
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    setTimeout(doSpeak, 80);
  } else {
    doSpeak();
  }
}

export function HeloisaVoiceOrb() {
  const { isInternalUser, isAdminUser, getIdToken, user } = useAuth();
  const userName = user?.displayName ? user.displayName.split(" ")[0] : "Conrado";
  const location = useLocation();

  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<HeloisaStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [audioLevel, setAudioLevel] = useState<number>(0);

  const isMobile = isMobileDevice();

  const [messages, setMessages] = useState<VoiceMessage[]>([
    {
      id: "init-1",
      sender: "heloisa",
      text: `Oi, ${userName}! Sou a Heloísa. Tô conectada e pronta por aqui, pode falar o que precisa.`,
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isSpeakingRef = useRef<boolean>(false);
  const isOpenRef = useRef<boolean>(isOpen);
  const isMutedRef = useRef<boolean>(isMuted);
  const resumeListeningTimerRef = useRef<NodeJS.Timeout | null>(null);
  const restartTimerRef = useRef<NodeJS.Timeout | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Mantém refs sincronizadas para callbacks assíncronos
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Somente renderiza para usuários internos e administradores
  if (!isInternalUser && !isAdminUser) {
    return null;
  }

  // Atalho de Teclado Alt + H para abrir/fechar o orbe
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        toggleOpen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Encerramento completo de hardware e escuta
  const stopListeningAndHardware = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (resumeListeningTimerRef.current) {
      clearTimeout(resumeListeningTimerRef.current);
      resumeListeningTimerRef.current = null;
    }
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      mediaStreamRef.current = null;
    }
    setAudioLevel(0);
    setLiveTranscript("");
  }, []);

  // Conecta AnalyserNode para medir volume e frequências reais do microfone
  const conectarAudioAnalyser = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolumeLoop = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(100, Math.round((avg / 255) * 100)));
        animationFrameRef.current = requestAnimationFrame(updateVolumeLoop);
      };
      updateVolumeLoop();
    } catch (e) {
      console.warn("[Heloísa] Aviso ao conectar analisador de áudio:", e);
    }
  }, []);

  // Interromper fala da Heloísa
  const pararFala = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (audioPlayerRef.current) {
      try {
        audioPlayerRef.current.pause();
      } catch {}
      audioPlayerRef.current = null;
    }
    isSpeakingRef.current = false;
    setStatus("idle");
  }, []);

  // Reprodução de áudio com fallback infalível para síntese nativa gratuita
  const tocarRespostaVoz = useCallback(
    (audioBase64: string | null, responseText: string) => {
      if (isMutedRef.current) {
        setStatus("idle");
        return;
      }

      const finalizarFala = () => {
        isSpeakingRef.current = false;
        setStatus("idle");
      };

      const iniciarFala = () => {
        isSpeakingRef.current = true;
        setStatus("falando");
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          try {
            mediaRecorderRef.current.onstop = null;
            mediaRecorderRef.current.stop();
          } catch {}
          mediaRecorderRef.current = null;
        }
        if (recognitionRef.current) {
          try {
            recognitionRef.current.abort();
          } catch {}
        }
      };

      if (audioBase64) {
        try {
          const audio = new Audio(`data:audio/mp3;base64,${audioBase64}`);
          audioPlayerRef.current = audio;

          audio.onplay = () => {
            iniciarFala();
          };

          audio.onended = () => {
            audioPlayerRef.current = null;
            finalizarFala();
          };

          audio.onerror = () => {
            console.warn("[Heloísa] Falha ao tocar áudio retornado pelo servidor, usando TTS nativo...");
            audioPlayerRef.current = null;
            speakNativeTTS({
              text: responseText,
              onStart: iniciarFala,
              onEnd: finalizarFala,
            });
          };

          const playPromise = audio.play();
          if (playPromise !== undefined) {
            playPromise.catch((err) => {
              console.warn("[Heloísa] Autoplay com áudio falhou, usando TTS nativo:", err);
              audioPlayerRef.current = null;
              speakNativeTTS({
                text: responseText,
                onStart: iniciarFala,
                onEnd: finalizarFala,
              });
            });
          }
          return;
        } catch (err) {
          console.warn("[Heloísa] Erro ao instanciar player de áudio:", err);
        }
      }

      speakNativeTTS({
        text: responseText,
        onStart: iniciarFala,
        onEnd: finalizarFala,
      });
    },
    []
  );

  // Envio de texto ou áudio base64 para o backend da Heloísa
  const enviarParaHeloisa = useCallback(
    async ({
      text,
      audioBase64,
      audioMimetype,
    }: {
      text?: string;
      audioBase64?: string;
      audioMimetype?: string;
    }) => {
      const promptLimpo = (text || "").trim();
      if (!promptLimpo && !audioBase64) return;

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.onstop = null;
          mediaRecorderRef.current.stop();
        } catch {}
        mediaRecorderRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      if (resumeListeningTimerRef.current) {
        clearTimeout(resumeListeningTimerRef.current);
        resumeListeningTimerRef.current = null;
      }

      setStatus("consultando");
      setErrorMessage(null);
      setLiveTranscript("");

      const userMsgId = `user-${Date.now()}`;
      const userMsgText = promptLimpo || "🎤 Mensagem de voz (celular)";
      const userMsg: VoiceMessage = {
        id: userMsgId,
        sender: "user",
        text: userMsgText,
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      };

      const historyPayload = messages.slice(-6).map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

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
            text: promptLimpo || undefined,
            audioBase64: audioBase64 || undefined,
            audioMimetype: audioMimetype || undefined,
            userName: userName || "Conrado",
            currentPage: location.pathname,
            clientId: "geracao-digital",
            history: historyPayload,
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

        if (data.userText && !promptLimpo) {
          setMessages((prev) =>
            prev.map((m) => (m.id === userMsgId ? { ...m, text: `🎤 "${data.userText}"` } : m))
          );
        }

        const heloisaMsg: VoiceMessage = {
          id: `heloisa-${Date.now()}`,
          sender: "heloisa",
          text: responseText,
          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          executedTools: data.executedTools || [],
        };
        setMessages((prev) => [...prev, heloisaMsg]);

        tocarRespostaVoz(data.audioBase64 || null, responseText);
      } catch (err: any) {
        console.error("[Heloísa] Erro ao enviar solicitação:", err);
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
    [getIdToken, location.pathname, messages, tocarRespostaVoz, userName]
  );

  // Gravação via MediaRecorder para Dispositivos Móveis (iOS Safari / Android Chrome)
  const iniciarGravacaoMobile = useCallback(async () => {
    destravarAudioMobile();
    if (typeof window === "undefined") return;
    if (isSpeakingRef.current) return;

    try {
      let stream = mediaStreamRef.current;
      if (!stream || !stream.active) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
      }
      conectarAudioAnalyser(stream);

      audioChunksRef.current = [];
      let mimeType = "audio/webm";
      if (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function") {
        if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        } else if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/webm")) {
          mimeType = "audio/webm";
        } else {
          mimeType = "";
        }
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const chosenType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: chosenType });
        audioChunksRef.current = [];
        if (blob.size < 500) {
          setStatus("idle");
          return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
          const resStr = reader.result as string;
          const base64Data = resStr ? resStr.split(",")[1] : null;
          if (base64Data) {
            enviarParaHeloisa({ audioBase64: base64Data, audioMimetype: chosenType });
          } else {
            setStatus("idle");
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start(250);
      setStatus("ouvindo");
      setErrorMessage(null);
    } catch (err: any) {
      console.warn("[Heloísa] Falha ao iniciar gravação mobile:", err);
      if (err.name === "NotAllowedError" || err.message?.includes("Permission denied")) {
        setErrorMessage("Permissão de microfone negada. Permita o microfone no navegador.");
      }
      setStatus("idle");
    }
  }, [conectarAudioAnalyser, enviarParaHeloisa]);

  const pararGravacaoMobile = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.warn("[Heloísa] Erro ao parar gravação mobile:", e);
      }
    }
    setStatus("consultando");
  }, []);

  // Iniciar escuta via Web Speech API (Desktop) com tolerância a ciclo de vida
  const startListening = useCallback(() => {
    destravarAudioMobile();
    if (typeof window === "undefined") return;
    if (!isOpenRef.current || isSpeakingRef.current) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn("[Heloísa] SpeechRecognition não suportado neste navegador.");
      return;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = !isMobile;
      recognition.interimResults = true;
      recognition.lang = "pt-BR";
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
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

        const isJustWakeWord = /^helo[íi]sa[?!.]*$/i.test(rawSpoken);
        let cleanOrder = rawSpoken;
        if (/^helo[íi]sa\b/i.test(rawSpoken)) {
          cleanOrder = rawSpoken.replace(/^helo[íi]sa[,.:;!?\s]*/i, "").trim() || rawSpoken;
        }
        const comandoParaEnviar = isJustWakeWord ? "Olá Heloísa" : cleanOrder;

        setLiveTranscript(comandoParaEnviar);
        setStatus("ouvindo");

        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
        }

        if (comandoParaEnviar && comandoParaEnviar.length >= 2) {
          silenceTimerRef.current = setTimeout(() => {
            if (!isSpeakingRef.current && comandoParaEnviar && isOpenRef.current) {
              enviarParaHeloisa({ text: comandoParaEnviar });
              setLiveTranscript("");
            }
          }, 1200);
        }
      };

      recognition.onerror = (e: any) => {
        if (e.error === "not-allowed") {
          setErrorMessage(
            "Microfone bloqueado pelo navegador. Clique no ícone de configurações ao lado do URL para permitir."
          );
          setStatus("idle");
        } else if (e.error !== "no-speech" && e.error !== "aborted") {
          console.warn("[Heloísa SpeechRecognition] Info:", e.error);
        }
      };

      recognition.onend = () => {
        recognitionRef.current = null;
      };

      recognition.start();
      recognitionRef.current = recognition;
      setStatus("ouvindo");
    } catch (err) {
      console.warn("[Heloísa] Falha ao iniciar reconhecimento de voz:", err);
    }
  }, [enviarParaHeloisa, isMobile]);

  // Solicita explicitamente o microfone e abre a orbe
  const toggleOpen = async () => {
    destravarAudioMobile();
    const nextState = !isOpen;
    setIsOpen(nextState);

    if (nextState) {
      setErrorMessage(null);
      try {
        if (navigator.mediaDevices?.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaStreamRef.current = stream;
          conectarAudioAnalyser(stream);
        }
      } catch (err: any) {
        console.warn("[Heloísa] Permissão de microfone:", err);
        if (err.name === "NotAllowedError" || err.message?.includes("Permission denied")) {
          setErrorMessage("Permissão de microfone negada. Clique no ícone de cadeado do navegador para permitir.");
        }
      }
      if (isMobile) {
        iniciarGravacaoMobile();
      } else {
        startListening();
      }
    } else {
      stopListeningAndHardware();
      pararFala();
      setStatus("idle");
    }
  };

  // Envio manual de texto via form
  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    destravarAudioMobile();
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
        text: `Histórico limpo, ${userName}. Pode falar.`,
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  };

  // Botão interativo de Toque-para-Falar / Forçar Envio
  const handleActionClick = () => {
    destravarAudioMobile();
    if (status === "falando") {
      pararFala();
      return;
    }

    if (liveTranscript && liveTranscript.trim()) {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      enviarParaHeloisa({ text: liveTranscript });
      setLiveTranscript("");
      return;
    }

    if (isMobile) {
      if (status === "ouvindo") {
        pararGravacaoMobile();
      } else {
        iniciarGravacaoMobile();
      }
      return;
    }

    if (status === "ouvindo") {
      return;
    }

    startListening();
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
          0%, 100% { height: 8px; transform: scaleY(0.7); }
          50% { height: 32px; transform: scaleY(1.35); }
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
          className="fixed bottom-24 right-4 sm:right-6 z-50 w-[360px] sm:w-[430px] max-w-[calc(100vw-1.5rem)] h-[560px] max-h-[calc(100vh-7.5rem)] rounded-3xl backdrop-blur-2xl bg-slate-950/90 border border-purple-500/30 shadow-[0_25px_70px_rgba(79,70,229,0.35)] flex flex-col overflow-hidden text-slate-100 transition-all duration-300 animate-in fade-in slide-in-from-bottom-5"
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
                    <Ear className="h-2.5 w-2.5" /> Voz Ativa
                  </Badge>
                </div>
                <p className="text-xs text-slate-400">Secretária Executiva & Amiga • Vexo OS</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsMuted(!isMuted)}
                className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
                title={isMuted ? "Desmutar voz" : "Mutar voz"}
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
                onClick={toggleOpen}
                className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
                title="Minimizar (Alt + H)"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Linha de Frequência Sonora Reativa e Status Neon */}
          <div className="relative px-4 py-3 bg-gradient-to-b from-purple-950/30 to-transparent border-b border-white/5 flex flex-col items-center justify-center">
            {/* Visualizador de Ondas Senoidais Neon que reage a voz real do microfone */}
            <div
              onClick={handleActionClick}
              className="cursor-pointer flex items-center justify-center gap-1.5 h-12 w-full px-4 rounded-2xl hover:bg-white/5 transition-all group"
              title="Toque para falar ou enviar"
            >
              {[0.1, 0.25, 0.45, 0.65, 0.5, 0.35, 0.2, 0.55, 0.7].map((delay, idx) => {
                const heightCalculada =
                  status === "ouvindo"
                    ? Math.max(8, Math.min(36, Math.round(audioLevel * 0.4 + (idx % 3) * 6)))
                    : undefined;

                return (
                  <div
                    key={idx}
                    className={cn(
                      "w-1.5 rounded-full transition-all duration-100",
                      status === "ouvindo"
                        ? "bg-gradient-to-t from-cyan-400 via-indigo-400 to-purple-400 shadow-[0_0_8px_#22d3ee]"
                        : status === "falando"
                        ? "bg-gradient-to-t from-purple-500 via-pink-400 to-cyan-300 shadow-[0_0_8px_#c084fc]"
                        : status === "consultando"
                        ? "bg-amber-400/80 shadow-[0_0_6px_#fbbf24]"
                        : "bg-slate-700/60 h-2"
                    )}
                    style={{
                      height:
                        status === "ouvindo"
                          ? `${heightCalculada}px`
                          : status === "falando"
                          ? undefined
                          : "6px",
                      animation:
                        status === "falando"
                          ? `heloisaSineWave 0.85s ease-in-out infinite`
                          : undefined,
                      animationDelay: `${delay}s`,
                    }}
                  />
                );
              })}
            </div>

            {/* Status Descritivo e Botão de Ação */}
            <div className="mt-1 flex items-center gap-2 text-xs font-medium">
              {status === "ouvindo" && (
                <button
                  type="button"
                  onClick={handleActionClick}
                  className="flex items-center gap-1.5 text-cyan-300 animate-pulse hover:text-cyan-200 transition-colors"
                >
                  <Radio className="h-3.5 w-3.5 text-cyan-400" />
                  <span>
                    {isMobile
                      ? "Gravando voz... Toque para enviar ordem"
                      : liveTranscript
                      ? "Ouvindo... (Pausa envia ou toque para enviar)"
                      : "Microfone ouvindo... Pode falar 'Heloísa' ou sua ordem"}
                  </span>
                </button>
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
                <button
                  type="button"
                  onClick={handleActionClick}
                  className="text-slate-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                >
                  <Sparkles className="h-3 w-3 text-cyan-400" />
                  Toque para falar ou diga <strong className="text-cyan-300">"Heloísa"</strong>
                </button>
              )}
            </div>

            {/* Transcrição em Tempo Real da Fala Atual */}
            {liveTranscript && status === "ouvindo" && (
              <div
                onClick={handleActionClick}
                className="cursor-pointer mt-2 w-full p-2.5 rounded-xl bg-purple-950/50 border border-cyan-400/40 text-xs text-cyan-200 animate-in fade-in flex items-center justify-between gap-2 shadow-[0_0_15px_rgba(34,211,238,0.2)]"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping shrink-0" />
                  <span className="italic truncate font-medium">"{liveTranscript}"</span>
                </div>
                <span className="text-[10px] text-cyan-300/80 shrink-0 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-400/30">
                  Toque p/ enviar
                </span>
              </div>
            )}

            {/* Mensagem de Erro ou Alerta de Permissão */}
            {errorMessage && (
              <div className="mt-2 text-[11px] text-rose-300 text-left bg-rose-950/60 border border-rose-500/40 px-3 py-2 rounded-xl w-full flex items-start gap-2 shadow-sm">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                <span className="leading-snug">{errorMessage}</span>
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
              onClick={() => {
                destravarAudioMobile();
                enviarParaHeloisa({ text: "Heloísa, faça uma auditoria geral da operação de todos os tenants do Vexo OS." });
              }}
              className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 whitespace-nowrap border border-white/5"
            >
              📊 Auditar Vexo OS
            </button>
            <button
              onClick={() => {
                destravarAudioMobile();
                enviarParaHeloisa({ text: "Heloísa, quais clientes estão com prazo vencido?" });
              }}
              className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 whitespace-nowrap border border-white/5"
            >
              ⏰ Prazos vencidos
            </button>
            <button
              onClick={() => {
                destravarAudioMobile();
                enviarParaHeloisa({ text: "Heloísa, quais são meus compromissos de hoje e amanhã?" });
              }}
              className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 whitespace-nowrap border border-white/5"
            >
              📅 Minha agenda
            </button>
            <button
              onClick={() => {
                destravarAudioMobile();
                enviarParaHeloisa({ text: "Heloísa, consulte como está o status da operação da agência hoje." });
              }}
              className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 whitespace-nowrap border border-white/5"
            >
              💼 Status da Operação
            </button>
          </div>

          {/* Input Manual de Texto Fallback */}
          <div className="p-3 border-t border-white/10 bg-slate-950/90">
            <form onSubmit={handleSendText} className="flex items-center gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Fale no microfone ou digite sua ordem, ${userName}...`}
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
                onClick={toggleOpen}
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
                  {[0.1, 0.3, 0.5, 0.2, 0.4].map((delay, idx) => {
                    const orbHeight =
                      status === "ouvindo"
                        ? Math.max(8, Math.min(24, Math.round(audioLevel * 0.25 + (idx % 2) * 5)))
                        : undefined;

                    return (
                      <span
                        key={idx}
                        className={cn(
                          "w-1 rounded-full transition-all duration-100",
                          status === "ouvindo"
                            ? "bg-cyan-200 shadow-[0_0_6px_#22d3ee]"
                            : status === "falando"
                            ? "bg-purple-200 shadow-[0_0_6px_#c084fc]"
                            : status === "consultando"
                            ? "bg-amber-300 animate-pulse"
                            : "bg-white/80 h-3"
                        )}
                        style={{
                          height:
                            status === "ouvindo"
                              ? `${orbHeight}px`
                              : status === "falando"
                              ? undefined
                              : "12px",
                          animation:
                            status === "falando"
                              ? `heloisaSineWave 0.75s ease-in-out infinite`
                              : undefined,
                          animationDelay: `${delay}s`,
                        }}
                      />
                    );
                  })}
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
                <span className="font-semibold text-cyan-300">Heloísa (Voz • Alt + H)</span>
                <span className="text-[11px] text-slate-300">Toque ou Alt + H para falar</span>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </>
  );
}
