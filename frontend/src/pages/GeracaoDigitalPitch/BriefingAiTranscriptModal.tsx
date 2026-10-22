import React from "react";
import { Sparkles, Loader2, FileAudio, Check, MessageSquare } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TRANSCRIPT_OPTIONS } from "@/lib/geracaoDigital/constants";

interface BriefingAiTranscriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  transcriptText: string;
  setTranscriptText: (text: string) => void;
  isProcessingAI: boolean;
  aiProgressText: string;
  onProcessWithAI: () => void;
  onSelectPreset: (presetId: string) => void;
}

export function BriefingAiTranscriptModal({
  isOpen,
  onClose,
  transcriptText,
  setTranscriptText,
  isProcessingAI,
  aiProgressText,
  onProcessWithAI,
  onSelectPreset,
}: BriefingAiTranscriptModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isProcessingAI && !open && onClose()}>
      <DialogContent className="max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl overflow-hidden">
        <DialogHeader className="space-y-2 pb-2">
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <DialogTitle className="text-xl font-black text-slate-900 dark:text-white">
              Extração Automática com IA (Gemini)
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Cole a transcrição da reunião de alinhamento comercial ou selecione um modelo para preencher todos os campos do briefing automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Presets Rápidos */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
              Carregar Exemplo de Reunião Real (Presets)
            </Label>
            <div className="flex flex-wrap gap-2">
              {TRANSCRIPT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onSelectPreset(opt.id)}
                  disabled={isProcessingAI}
                  className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shadow-2xs"
                >
                  {opt.title}
                </button>
              ))}
            </div>
          </div>

          {/* Textarea de Transcrição */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <FileAudio className="w-4 h-4 text-purple-500" />
                Áudio Transcrito / Conversa de Alinhamento
              </Label>
              <span className="text-[11px] text-slate-400 font-mono">
                {transcriptText.length} caracteres
              </span>
            </div>
            <textarea
              value={transcriptText}
              onChange={(e) => setTranscriptText(e.target.value)}
              disabled={isProcessingAI}
              placeholder="Cole aqui a transcrição completa da reunião (Meet, Zoom, gravação do WhatsApp ou notas do Caio)..."
              className="w-full h-56 p-4 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-slate-100 outline-none leading-relaxed resize-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all shadow-inner"
            />
          </div>

          {/* Feedback de Progresso da IA */}
          {isProcessingAI && (
            <div className="p-3.5 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 flex items-center gap-3 animate-fade-in">
              <Loader2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 animate-spin shrink-0" />
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                  IA processando transcrição...
                </p>
                <p className="text-[11px] text-indigo-700 dark:text-indigo-400">
                  {aiProgressText || "Analisando requisitos comerciais, dores e termos contratuais..."}
                </p>
              </div>
            </div>
          )}

          {/* Ações */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isProcessingAI}
              className="border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs h-10 px-4 rounded-xl"
            >
              Cancelar
            </Button>

            <Button
              type="button"
              onClick={onProcessWithAI}
              disabled={isProcessingAI || !transcriptText.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-5 rounded-xl gap-2 shadow-sm transition-all"
            >
              {isProcessingAI ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-indigo-200" />
                  Processar com Gemini
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
