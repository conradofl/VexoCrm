import React, { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Paperclip,
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  LoaderCircle,
  Send,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { SendWhatsAppMediaParams } from "@/hooks/useWhatsAppInbox";

interface MediaAttachmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSendMedia: (params: SendWhatsAppMediaParams) => Promise<void>;
  disabled?: boolean;
}

export function MediaAttachmentModal({
  open,
  onOpenChange,
  onSendMedia,
  disabled = false,
}: MediaAttachmentModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"audio" | "image" | "video" | "document">("document");
  const [caption, setCaption] = useState("");
  const [isSending, setIsSending] = useState(false);

  const resetState = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setCaption("");
    setIsSending(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClose = () => {
    if (isSending) return;
    resetState();
    onOpenChange(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Detectar tipo
    let detectedType: "audio" | "image" | "video" | "document" = "document";
    const mime = file.type.toLowerCase();
    if (mime.startsWith("image/")) detectedType = "image";
    else if (mime.startsWith("video/")) detectedType = "video";
    else if (mime.startsWith("audio/")) detectedType = "audio";

    // Validar limites
    const maxBytes = detectedType === "document" ? 50 * 1024 * 1024 : 16 * 1024 * 1024;
    if (file.size > maxBytes) {
      const maxMb = Math.round(maxBytes / 1024 / 1024);
      toast.error(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). O limite para este tipo é de ${maxMb} MB.`);
      return;
    }

    setSelectedFile(file);
    setMediaType(detectedType);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSend = async () => {
    if (!selectedFile) return;

    try {
      setIsSending(true);

      // Converter para base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64Clean = result.split(",")[1] || "";
          resolve(base64Clean);
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(selectedFile);
      });

      await onSendMedia({
        mediaType,
        base64,
        mimetype: selectedFile.type || "application/octet-stream",
        fileName: selectedFile.name,
        caption: caption.trim() || undefined,
      });

      toast.success("Mídia enviada com sucesso!");
      handleClose();
    } catch (err: any) {
      console.error("Erro ao enviar mídia:", err);
      toast.error("Falha ao enviar mídia", {
        description: err?.message || "Tente novamente mais tarde.",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
        onChange={handleFileChange}
      />

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Paperclip className="h-4 w-4 text-emerald-600" />
              Enviar Mídia no WhatsApp
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 space-y-4">
            {!selectedFile ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-emerald-500/60 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/10 transition-colors text-center group"
              >
                <div className="flex items-center justify-center h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400 mb-3 group-hover:scale-105 transition-transform">
                  <Paperclip className="h-6 w-6" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  Clique para selecionar uma imagem, vídeo, áudio ou documento
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Até 16 MB para imagens/vídeos/áudios e até 50 MB para documentos
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Preview */}
                <div className="relative overflow-hidden rounded-xl border border-border/80 bg-muted/30 flex items-center justify-center min-h-[160px] max-h-[260px] p-2">
                  {mediaType === "image" && previewUrl && (
                    <img
                      src={previewUrl}
                      alt="Pré-visualização"
                      className="max-h-[240px] max-w-full object-contain rounded-lg shadow-2xs"
                    />
                  )}
                  {mediaType === "video" && previewUrl && (
                    <video
                      src={previewUrl}
                      controls
                      className="max-h-[240px] max-w-full rounded-lg"
                    />
                  )}
                  {mediaType === "audio" && previewUrl && (
                    <div className="w-full p-4 flex flex-col items-center gap-2">
                      <Music className="h-8 w-8 text-emerald-600" />
                      <audio src={previewUrl} controls className="w-full" />
                    </div>
                  )}
                  {mediaType === "document" && (
                    <div className="p-6 flex flex-col items-center gap-2 text-center">
                      <FileText className="h-10 w-10 text-emerald-600" />
                      <p className="text-xs font-semibold max-w-[300px] truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  )}
                </div>

                {/* Trocar arquivo */}
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                  <span className="truncate max-w-[280px]">
                    {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-emerald-600 dark:text-emerald-400 font-medium hover:underline"
                  >
                    Trocar arquivo
                  </button>
                </div>

                {/* Legenda (opcional) */}
                {mediaType !== "audio" && (
                  <div className="space-y-1">
                    <Input
                      placeholder="Adicione uma legenda (opcional)..."
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      disabled={isSending}
                      className="text-xs rounded-lg"
                      maxLength={1000}
                    />
                  </div>
                )}

                {/* Aviso A4: Imagem > 8 MB */}
                {mediaType === "image" && selectedFile && selectedFile.size > 8 * 1024 * 1024 && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5 text-xs text-amber-800 dark:text-amber-300 animate-in fade-in">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                    <div className="leading-snug">
                      <span className="font-semibold">Aviso:</span> Acima de 8 MB a imagem é enviada normalmente ao cliente, mas não fica guardada no sistema.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={isSending}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!selectedFile || isSending || disabled}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
            >
              {isSending ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {isSending ? "Enviando..." : "Enviar Mídia"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
