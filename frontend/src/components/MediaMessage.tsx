import React, { useState, useRef, useEffect } from "react";
import {
  FileText,
  ImageOff,
  Loader2,
  Mic,
  Volume2,
  Play,
  Pause,
  Clock,
  Download,
  Maximize2,
  X,
} from "lucide-react";
import { useMediaMessage, type MediaType } from "@/hooks/useMediaMessage";
import { cn } from "@/lib/utils";
import { normalizeMessageText } from "@/lib/messageFormatting";

function formatSeconds(secs: number): string {
  if (isNaN(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function AudioPlayer({
  src,
  transcription,
  fromMe,
}: {
  src: string;
  transcription: string | null;
  fromMe: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [showTranscription, setShowTranscription] = useState(true);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = Number(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const cyclePlaybackRate = () => {
    if (!audioRef.current) return;
    const rates = [1, 1.5, 2];
    const nextRate = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    audioRef.current.playbackRate = nextRate;
    setPlaybackRate(nextRate);
  };

  return (
    <div className="w-full min-w-[240px] max-w-[340px] space-y-2">
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Player Controls */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlay}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-150 shadow-xs",
            fromMe
              ? "bg-white text-emerald-700 hover:bg-emerald-50 active:scale-95"
              : "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95"
          )}
          aria-label={isPlaying ? "Pausar" : "Reproduzir"}
        >
          {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
        </button>

        {/* Progress & Waveform Slider */}
        <div className="flex-1 space-y-1">
          <div className="relative flex items-center">
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className={cn(
                "h-1.5 w-full cursor-pointer appearance-none rounded-lg accent-current",
                fromMe
                  ? "bg-emerald-800/40 text-white"
                  : "bg-slate-200 dark:bg-slate-700 text-emerald-600"
              )}
            />
          </div>

          <div
            className={cn(
              "flex justify-between text-[10px] tabular-nums font-mono",
              fromMe ? "text-emerald-100/90" : "text-muted-foreground"
            )}
          >
            <span>{formatSeconds(currentTime)}</span>
            <span>{duration > 0 ? formatSeconds(duration) : "--:--"}</span>
          </div>
        </div>

        {/* Speed Toggle */}
        <button
          type="button"
          onClick={cyclePlaybackRate}
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider transition-colors",
            fromMe
              ? "bg-emerald-700/60 text-emerald-100 hover:bg-emerald-700"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
          )}
          title="Velocidade de reprodução"
        >
          {playbackRate}x
        </button>
      </div>

      {/* Transcription */}
      {transcription && (
        <div className="pt-1 border-t border-current/10">
          <button
            type="button"
            onClick={() => setShowTranscription((v) => !v)}
            className={cn(
              "flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-100",
              fromMe ? "text-emerald-100/80 opacity-90" : "text-slate-500 dark:text-slate-400 opacity-80"
            )}
          >
            <Mic className="h-3 w-3" />
            <span>{showTranscription ? "Ocultar transcrição" : "Ver transcrição"}</span>
          </button>
          {showTranscription && (
            <p
              className={cn(
                "mt-1.5 rounded-md px-2.5 py-1.5 text-xs italic leading-relaxed whitespace-pre-wrap select-text",
                fromMe
                  ? "bg-emerald-700/50 text-emerald-50 border border-emerald-500/20"
                  : "bg-slate-100/90 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60"
              )}
            >
              "{transcription}"
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ImageWithDescription({
  src,
  alt,
  description,
  fromMe,
}: {
  src: string;
  alt: string;
  description: string | null;
  fromMe: boolean;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    if (lightboxOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen]);

  return (
    <div className="space-y-1.5">
      <div className="relative group overflow-hidden rounded-lg cursor-pointer">
        <img
          src={src}
          alt={alt}
          onClick={() => setLightboxOpen(true)}
          className="max-h-64 max-w-full rounded-lg object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          loading="lazy"
        />
        <div
          onClick={() => setLightboxOpen(true)}
          className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors duration-150"
        >
          <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white rounded-full p-2">
            <Maximize2 className="h-4 w-4" />
          </div>
        </div>
      </div>

      {description && (
        <p
          className={cn(
            "text-[11px] italic leading-snug select-text",
            fromMe ? "text-emerald-100/90" : "text-slate-500 dark:text-slate-400"
          )}
        >
          {description}
        </p>
      )}

      {/* Lightbox Modal */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 rounded-full bg-white/10 hover:bg-white/20 text-white p-2 transition-colors"
            aria-label="Fechar"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}

interface MediaMessageProps {
  messageId: string | null;
  hasMedia: boolean;
  fallbackBody: string;
  fromMe: boolean;
  className?: string;
  clientId?: string | null;
}

export function MediaMessage({
  messageId,
  hasMedia,
  fallbackBody,
  fromMe,
  className,
  clientId,
}: MediaMessageProps) {
  const { data: media, isLoading, error } = useMediaMessage(messageId, hasMedia, clientId);

  if (!hasMedia) {
    return (
      <p
        className={cn("whitespace-pre-wrap break-words", className)}
        style={{
          fontFamily: '-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
          fontSize: "14px",
          lineHeight: "1.35",
          fontWeight: 400,
        }}
      >
        {normalizeMessageText(fallbackBody) || "[mensagem sem texto]"}
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-2 py-2 text-xs opacity-75", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Carregando mídia...</span>
      </div>
    );
  }

  // Estado 1: Mídia expirada (> 20 dias e sem gravação no R2)
  if (media?.expired) {
    return (
      <div className={cn("space-y-2 py-1", className)}>
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs border font-medium",
            fromMe
              ? "bg-emerald-700/60 text-emerald-100 border-emerald-500/30"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
          )}
        >
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>Mídia expirada no WhatsApp (&gt;20 dias)</span>
        </div>

        {/* Preservação da transcrição ou descrição */}
        {(media.transcription || media.description || fallbackBody) && (
          <div
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs select-text",
              fromMe
                ? "bg-emerald-700/40 text-emerald-50"
                : "bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200"
            )}
          >
            <span
              className={cn(
                "block text-[10px] uppercase font-semibold tracking-wider mb-0.5",
                fromMe ? "text-emerald-200" : "text-muted-foreground"
              )}
            >
              Conteúdo transcrito:
            </span>
            <p className="italic">
              "{media.transcription || media.description || fallbackBody}"
            </p>
          </div>
        )}
      </div>
    );
  }

  if (error || !media) {
    return (
      <div className={cn("space-y-1.5 py-1", className)}>
        <div className="flex items-center gap-1.5 text-xs opacity-80">
          <FileText className="h-3.5 w-3.5" />
          <span>[mídia indisponível]</span>
        </div>
        {fallbackBody && (
          <p className="text-xs italic opacity-90 select-text">
            {fallbackBody}
          </p>
        )}
      </div>
    );
  }

  const src = media.dataUrl ?? media.url ?? "";

  // Áudio
  if (media.mediaType === "audio" && src) {
    return (
      <div className={className}>
        <AudioPlayer
          src={src}
          transcription={media.transcription || (fallbackBody !== "[áudio]" ? fallbackBody : null)}
          fromMe={fromMe}
        />
      </div>
    );
  }

  // Imagem
  if (media.mediaType === "image" && src) {
    return (
      <div className={className}>
        <ImageWithDescription
          src={src}
          alt={media.fileName || "Imagem WhatsApp"}
          description={media.description || (fallbackBody.startsWith("[imagem:") ? fallbackBody : null)}
          fromMe={fromMe}
        />
        {fallbackBody && !fallbackBody.startsWith("[imagem") && (
          <p className="mt-1.5 text-xs opacity-90 select-text">{fallbackBody}</p>
        )}
      </div>
    );
  }

  // Vídeo
  if (media.mediaType === "video" && src) {
    return (
      <div className={cn("space-y-1.5", className)}>
        <video
          controls
          src={src}
          className="max-h-64 max-w-full rounded-lg bg-black/90 shadow-xs"
          preload="metadata"
        />
        {fallbackBody && fallbackBody !== "[vídeo]" && (
          <p className="text-xs opacity-90 select-text">{fallbackBody}</p>
        )}
      </div>
    );
  }

  // Documento
  if (media.mediaType === "document" && src) {
    return (
      <div className={cn("space-y-1.5", className)}>
        <a
          href={src}
          download={media.fileName || "documento"}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex items-center gap-2.5 rounded-lg p-2.5 text-xs transition-colors border shadow-2xs",
            fromMe
              ? "bg-emerald-700/50 text-white border-emerald-500/30 hover:bg-emerald-700"
              : "bg-slate-50 dark:bg-slate-800 text-foreground border-border/80 hover:bg-slate-100 dark:hover:bg-slate-700/80"
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-current/10">
            <FileText className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{media.fileName || "Documento recebido"}</p>
            <p className="text-[10px] opacity-75">Clique para baixar</p>
          </div>
          <Download className="h-4 w-4 shrink-0 opacity-70" />
        </a>
        {fallbackBody && !fallbackBody.startsWith("[documento]") && (
          <p className="text-xs opacity-90 select-text">{fallbackBody}</p>
        )}
      </div>
    );
  }

  // Figurinha (Sticker)
  if (media.mediaType === "sticker" && src) {
    return (
      <div className={cn("py-1", className)}>
        <img
          src={src}
          alt="Figurinha"
          className="max-h-36 max-w-[144px] object-contain drop-shadow-sm"
          loading="lazy"
        />
      </div>
    );
  }

  // Fallback para outros tipos de mídia
  return (
    <div className={cn("flex items-center gap-2 text-xs opacity-80", className)}>
      <FileText className="h-4 w-4" />
      <span>[{media.mediaType}] {fallbackBody || media.fileName || ""}</span>
    </div>
  );
}
