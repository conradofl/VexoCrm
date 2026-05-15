import { useState } from "react";
import { FileText, ImageOff, Loader2, Mic, MicOff, Volume2 } from "lucide-react";
import { useMediaMessage, type MediaType } from "@/hooks/useMediaMessage";
import { cn } from "@/lib/utils";

function AudioPlayer({ src, transcription }: { src: string; transcription: string | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Volume2 className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
        <audio controls src={src} className="h-8 max-w-full flex-1" preload="metadata" />
      </div>
      {transcription && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
          >
            <Mic className="h-3 w-3" />
            {expanded ? "Ocultar transcrição" : "Ver transcrição"}
          </button>
          {expanded && (
            <p className="mt-1 rounded-md bg-slate-100 px-2.5 py-2 text-xs italic leading-relaxed text-slate-600 dark:bg-slate-700/60 dark:text-slate-300">
              "{transcription}"
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ImageWithDescription({ src, alt, description }: { src: string; alt: string; description: string | null }) {
  return (
    <div className="space-y-1.5">
      <img
        src={src}
        alt={alt}
        className="max-h-64 w-full rounded-lg object-cover"
        loading="lazy"
      />
      {description && (
        <p className="text-[11px] italic text-slate-500 dark:text-slate-400">{description}</p>
      )}
    </div>
  );
}

function TypeIcon({ type }: { type: MediaType }) {
  if (type === "audio") return <MicOff className="h-4 w-4 text-slate-400" />;
  if (type === "image") return <ImageOff className="h-4 w-4 text-slate-400" />;
  return <FileText className="h-4 w-4 text-slate-400" />;
}

interface MediaMessageProps {
  messageId: string | null;
  hasMedia: boolean;
  fallbackBody: string;
  fromMe: boolean;
  className?: string;
}

export function MediaMessage({ messageId, hasMedia, fallbackBody, fromMe, className }: MediaMessageProps) {
  const { data: media, isLoading, error } = useMediaMessage(messageId, hasMedia);

  if (!hasMedia) {
    return (
      <p className={cn("whitespace-pre-wrap break-words", className)}>
        {fallbackBody || "[mensagem sem texto]"}
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-slate-400", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Carregando mídia...
      </div>
    );
  }

  if (error || media === null) {
    const isApiMissing =
      error instanceof Error &&
      (error.message.includes("404") || error.message.includes("Cannot GET"));

    return (
      <div className={cn("space-y-1", className)}>
        <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
          <FileText className="h-3.5 w-3.5" />
          {isApiMissing ? (
            <span>Mídia — endpoint <code>/api/media</code> ainda não disponível</span>
          ) : (
            <span>[mídia — {fallbackBody || "sem descrição"}]</span>
          )}
        </div>
        {fallbackBody && !isApiMissing && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{fallbackBody}</p>
        )}
      </div>
    );
  }

  const src = media.dataUrl ?? media.url ?? "";

  if (media.mediaType === "audio" && src) {
    return (
      <div className={className}>
        <AudioPlayer src={src} transcription={media.transcription} />
      </div>
    );
  }

  if (media.mediaType === "image" && src) {
    return (
      <div className={className}>
        <ImageWithDescription
          src={src}
          alt={media.fileName || "Imagem recebida"}
          description={media.description}
        />
        {fallbackBody && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{fallbackBody}</p>}
      </div>
    );
  }

  if (media.mediaType === "video" && src) {
    return (
      <div className={cn("space-y-1.5", className)}>
        <video controls src={src} className="max-h-56 w-full rounded-lg" preload="metadata" />
        {fallbackBody && <p className="text-xs text-slate-500">{fallbackBody}</p>}
      </div>
    );
  }

  if (media.mediaType === "document" && src) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <FileText className="h-4 w-4 shrink-0 text-slate-400" />
        <a
          href={src}
          download={media.fileName || "documento"}
          className="text-xs text-indigo-500 underline underline-offset-2 hover:text-indigo-700 dark:text-indigo-400"
        >
          {media.fileName || "Baixar documento"}
        </a>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2 text-xs text-slate-400", className)}>
      <TypeIcon type={media.mediaType} />
      <span>[{media.mediaType}] {fallbackBody || media.fileName || ""}</span>
    </div>
  );
}
