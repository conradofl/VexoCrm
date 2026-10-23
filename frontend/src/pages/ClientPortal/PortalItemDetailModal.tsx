import React, { useState } from "react";
import { DeliverableItem } from "@/hooks/useClientPortal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Video,
  Send,
  Sparkles,
  MessageSquare,
  Wrench,
} from "lucide-react";

interface PortalItemDetailModalProps {
  item: DeliverableItem | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (itemId: string) => void;
  onRequestRevision: (itemId: string, feedback: string) => void;
  isApproving?: boolean;
}

export const PortalItemDetailModal: React.FC<PortalItemDetailModalProps> = ({
  item,
  isOpen,
  onClose,
  onApprove,
  onRequestRevision,
  isApproving = false,
}) => {
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");

  if (!item) return null;

  const handleSendRevision = () => {
    if (!revisionFeedback.trim()) return;
    onRequestRevision(item.id, revisionFeedback);
    setShowRevisionInput(false);
    setRevisionFeedback("");
  };

  const getStatusBadge = () => {
    switch (item.status) {
      case "publicado":
        return (
          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 gap-1.5 py-1 px-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Publicado no Feed / Reels
          </Badge>
        );
      case "aguardando_aprovacao":
        return (
          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 gap-1.5 py-1 px-3 animate-pulse">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            Aguardando Sua Aprovação
          </Badge>
        );
      case "em_producao":
        return (
          <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30 gap-1.5 py-1 px-3">
            <Clock className="w-4 h-4 text-sky-400" />
            Em Produção / Edição
          </Badge>
        );
      case "ajuste_solicitado":
        return (
          <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 gap-1.5 py-1 px-3">
            <Wrench className="w-4 h-4 text-purple-400" />
            Ajuste Solicitado · Em Edição
          </Badge>
        );
      default:
        return (
          <Badge className="bg-slate-700/50 text-slate-300 border-slate-600 gap-1.5 py-1 px-3">
            <FileText className="w-4 h-4 text-slate-400" />
            Roteiro Pronto para Gravação
          </Badge>
        );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl bg-slate-900 border-slate-800 text-white max-h-[90vh] overflow-y-auto p-6 sm:p-8">
        <DialogHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {item.code} · Etapa {item.stage.toUpperCase()}
            </span>
            {getStatusBadge()}
          </div>

          <DialogTitle className="text-xl sm:text-2xl font-bold tracking-tight text-white leading-snug">
            {item.title}
          </DialogTitle>

          <DialogDescription className="text-xs sm:text-sm text-slate-400 flex flex-wrap items-center gap-3">
            <span>
              <strong>Previsão de Veiculação:</strong> {item.date} ({item.dayOfWeek})
            </span>
            <span>•</span>
            <span>
              <strong>Formato:</strong> {item.format}
            </span>
            <span>•</span>
            <span>
              <strong>Canais:</strong> {item.channel}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Video Preview Section (if video exists) */}
        {item.videoUrl && (
          <div className="my-3 rounded-xl overflow-hidden bg-black/60 border border-slate-800 p-2">
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-slate-300 px-2 pt-1">
              <Video className="w-4 h-4 text-indigo-400" />
              <span>Preview do Vídeo Editado:</span>
            </div>
            <video
              src={item.videoUrl}
              controls
              className="w-full max-h-72 rounded-lg bg-black object-contain mx-auto"
            />
          </div>
        )}

        {/* Script Content Blocks */}
        <div className="space-y-4 my-4">
          {/* 1. Hook (Gancho) */}
          <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-800/40">
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-300 uppercase tracking-wider mb-1.5">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>1. Gancho dos Primeiros 3 Segundos (Hook)</span>
            </div>
            <p className="text-sm font-semibold text-white italic">
              "{item.hook}"
            </p>
          </div>

          {/* 2. Spoken Dialogue / Script */}
          <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              <FileText className="w-4 h-4 text-sky-400" />
              <span>2. Texto Falado / Roteiro Completo</span>
            </div>
            <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-line font-normal">
              {item.script}
            </p>
          </div>

          {/* 3. CTA */}
          <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/40">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-300 uppercase tracking-wider mb-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>3. Chamada para Ação (CTA & Legenda)</span>
            </div>
            <p className="text-sm font-medium text-emerald-100">
              {item.cta}
            </p>
          </div>

          {/* 4. Technical Orientations (Optional) */}
          {item.technicalNotes && (
            <div className="p-3.5 rounded-xl bg-slate-800/30 border border-slate-800 text-xs text-slate-400">
              <strong className="text-slate-300 block mb-1">
                Orientações da Direção de Audiovisual (Eflen / Carlos):
              </strong>
              <span>{item.technicalNotes}</span>
            </div>
          )}

          {/* Previous Revision Feedback (if any) */}
          {item.feedback && (
            <div className="p-3.5 rounded-xl bg-purple-950/40 border border-purple-800/50 text-xs text-purple-200">
              <div className="flex items-center gap-1.5 font-bold text-purple-300 mb-1">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Seu pedido de ajuste em andamento:</span>
              </div>
              <p>"{item.feedback}"</p>
            </div>
          )}
        </div>

        {/* Action Buttons Footer */}
        <div className="pt-4 border-t border-slate-800 flex flex-col gap-3">
          {item.status === "aguardando_aprovacao" && !showRevisionInput && (
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <Button
                onClick={() => onApprove(item.id)}
                disabled={isApproving}
                className="w-full sm:flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 shadow-lg shadow-emerald-950/50 border border-emerald-400/40 gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isApproving ? "Aprovando..." : "Aprovar Vídeo com 1 Clique"}</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowRevisionInput(true)}
                className="w-full sm:w-auto border-amber-500/40 text-amber-300 hover:bg-amber-950/30 hover:text-white"
              >
                Solicitar Ajuste
              </Button>
            </div>
          )}

          {/* Form to submit revision */}
          {showRevisionInput && (
            <div className="space-y-3 p-4 bg-slate-950/80 rounded-xl border border-amber-500/30 animate-in fade-in">
              <label className="text-xs font-semibold text-amber-300 block">
                Descreva o ajuste desejado para a equipe de edição (Santana / Eflen):
              </label>
              <Textarea
                value={revisionFeedback}
                onChange={(e) => setRevisionFeedback(e.target.value)}
                placeholder="Ex: Trocar a música de fundo por uma mais animada e corrigir a legenda aos 0:15s..."
                className="bg-slate-900 border-slate-700 text-white text-xs resize-none h-20"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowRevisionInput(false)}
                  className="text-slate-400 hover:text-white text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleSendRevision}
                  disabled={!revisionFeedback.trim()}
                  className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Enviar Ajuste</span>
                </Button>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              variant="ghost"
              onClick={onClose}
              className="text-xs text-slate-400 hover:text-white"
            >
              Fechar Visualização
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
