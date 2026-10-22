import React from "react";
import { Sparkles, Save, Rocket, CheckCircle2, Clock, AlertCircle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface BriefingHeaderProps {
  razaoSocial: string;
  cnpj: string;
  completedCount: number;
  totalCount: number;
  savingDraft: boolean;
  onOpenTranscriptModal: () => void;
  onSaveDraft: () => void;
  onOpenDispatchModal: () => void;
}

export function BriefingHeader({
  razaoSocial,
  cnpj,
  completedCount,
  totalCount,
  savingDraft,
  onOpenTranscriptModal,
  onSaveDraft,
  onOpenDispatchModal,
}: BriefingHeaderProps) {
  const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const getStatusBadge = () => {
    if (completedCount >= 20) {
      return (
        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-bold px-3 py-1 flex items-center gap-1.5 shadow-xs">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          Concluído ({percentage}%)
        </Badge>
      );
    }
    if (completedCount >= 5) {
      return (
        <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-bold px-3 py-1 flex items-center gap-1.5 shadow-xs">
          <Clock className="w-3.5 h-3.5 text-amber-500" />
          Em Andamento ({percentage}%)
        </Badge>
      );
    }
    return (
      <Badge className="bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20 font-bold px-3 py-1 flex items-center gap-1.5 shadow-xs">
        <AlertCircle className="w-3.5 h-3.5 text-slate-500" />
        Pendente ({percentage}%)
      </Badge>
    );
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Lado Esquerdo: Identificação do Cliente */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/50 flex items-center justify-center text-purple-600 dark:text-purple-400 font-bold">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                  {razaoSocial ? razaoSocial : "Novo Cliente · Briefing Operacional"}
                </h1>
                {getStatusBadge()}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                {cnpj ? <span>CNPJ: <span className="font-mono text-slate-700 dark:text-slate-300 font-medium">{cnpj}</span></span> : <span>CNPJ não informado</span>}
                <span>•</span>
                <span>{completedCount} de {totalCount} campos validados</span>
              </p>
            </div>
          </div>
        </div>

        {/* Lado Direito: Ações Principais */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            onClick={onOpenTranscriptModal}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-4 rounded-xl shadow-sm gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Sparkles className="w-4 h-4 text-indigo-200 animate-pulse" />
            🎙️ Transcrever Áudio com IA
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={onSaveDraft}
            disabled={savingDraft}
            className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs h-10 px-4 rounded-xl shadow-xs gap-2 transition-all"
          >
            <Save className="w-4 h-4 text-slate-500" />
            {savingDraft ? "Salvando..." : "💾 Salvar Rascunho"}
          </Button>

          <Button
            type="button"
            onClick={onOpenDispatchModal}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-10 px-4 rounded-xl shadow-sm gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Rocket className="w-4 h-4 text-emerald-200" />
            🚀 Disparar para a Esteira
          </Button>
        </div>
      </div>

      {/* Barra de Progresso Discreta e Elegante */}
      <div className="space-y-1">
        <div className="w-full bg-slate-100 dark:bg-slate-800/80 h-2 rounded-full overflow-hidden">
          <div
            className="bg-gradient-to-r from-purple-600 to-indigo-500 h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.max(percentage, 2)}%` }}
          />
        </div>
        <div className="flex justify-between items-center text-[11px] text-slate-400 font-medium">
          <span>Hub Operacional Direto em 1 Tela</span>
          <span>{percentage}% do briefing preenchido</span>
        </div>
      </div>
    </div>
  );
}
