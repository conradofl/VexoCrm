import React, { useState, useRef, useEffect } from "react";
import { Mic, Trash2, Send, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { SendWhatsAppMediaParams } from "@/hooks/useWhatsAppInbox";

interface VoiceRecorderButtonProps {
  onSendAudio: (params: SendWhatsAppMediaParams) => Promise<void>;
  disabled?: boolean;
}

export function VoiceRecorderButton({ onSendAudio, disabled = false }: VoiceRecorderButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      cleanupStream();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const cleanupStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startRecording = async () => {
    if (disabled || isSending) return;

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        toast.error("Gravação de áudio não suportada pelo seu navegador.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Escolhe o melhor mimeType suportado
      let options: MediaRecorderOptions = {};
      if (MediaRecorder.isTypeSupported("audio/ogg; codecs=opus")) {
        options = { mimeType: "audio/ogg; codecs=opus" };
      } else if (MediaRecorder.isTypeSupported("audio/webm; codecs=opus")) {
        options = { mimeType: "audio/webm; codecs=opus" };
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        options = { mimeType: "audio/mp4" };
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(200);
      setIsRecording(true);
      setRecordingSeconds(0);

      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Erro ao acessar microfone:", err);
      cleanupStream();
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        toast.error("Permissão de microfone negada. Permita o acesso nas configurações do navegador.");
      } else {
        toast.error("Não foi possível iniciar a gravação de áudio.");
      }
    }
  };

  const cancelRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    cleanupStream();
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const finishAndSendRecording = async () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    if (timerRef.current) clearInterval(timerRef.current);

    setIsSending(true);

    const recorder = mediaRecorderRef.current;
    const finalPromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const mime = recorder.mimeType || "audio/ogg";
        const blob = new Blob(audioChunksRef.current, { type: mime });
        resolve(blob);
      };
    });

    recorder.stop();
    cleanupStream();

    try {
      const audioBlob = await finalPromise;
      if (audioBlob.size < 100) {
        toast.error("Áudio muito curto ou vazio.");
        setIsSending(false);
        setIsRecording(false);
        return;
      }

      // Converte Blob para base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          resolve(res.split(",")[1] || "");
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(audioBlob);
      });

      await onSendAudio({
        mediaType: "audio",
        base64,
        mimetype: audioBlob.type || "audio/ogg",
        fileName: `audio-${Date.now()}.ogg`,
      });

      toast.success("Áudio enviado!");
    } catch (err: any) {
      console.error("Falha ao enviar áudio gravado:", err);
      toast.error("Erro ao enviar áudio", {
        description: err?.message || "Tente novamente.",
      });
    } finally {
      setIsSending(false);
      setIsRecording(false);
      setRecordingSeconds(0);
      audioChunksRef.current = [];
    }
  };

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (isRecording) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-1.5 border border-red-500/30 animate-in fade-in duration-150">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
        </span>

        <span className="font-mono text-xs font-semibold text-red-600 dark:text-red-400 tabular-nums">
          {formatTimer(recordingSeconds)}
        </span>

        <div className="flex items-center gap-1.5 ml-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancelRecording}
            disabled={isSending}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
            title="Cancelar gravação"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={finishAndSendRecording}
            disabled={isSending}
            className="h-7 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold gap-1"
            title="Enviar áudio gravado"
          >
            {isSending ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            <span>Enviar</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={startRecording}
      disabled={disabled || isSending}
      className={cn(
        "h-8 w-8 p-0 text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 rounded-lg transition-colors",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      title="Gravar áudio no WhatsApp"
      aria-label="Gravar áudio"
    >
      <Mic className="h-4 w-4" />
    </Button>
  );
}
