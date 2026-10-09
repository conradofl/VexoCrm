import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Smartphone,
  Bot,
  FileSpreadsheet,
  CheckCircle2,
  Clock,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";
import { cn } from "@/lib/utils";

interface OnboardingProgressCardProps {
  clientId?: string;
  baseTotal?: number | null;
  className?: string;
}

export function OnboardingProgressCard({
  clientId,
  baseTotal,
  className,
}: OnboardingProgressCardProps) {
  const progress = useOnboardingProgress(clientId, { baseTotal });
  const [isMinimized, setIsMinimized] = useState(false);

  // Quando todos os 3 passos estão concluídos:
  if (progress.isFullyReady) {
    return (
      <div
        className={cn(
          "flex items-center justify-between px-4 py-2.5 rounded-xl border border-emerald-200/80 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-950/20 dark:text-emerald-400 text-xs sm:text-sm transition-all shadow-xs",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="font-semibold text-emerald-900 dark:text-emerald-300">
            ✅ Operação 100% Ativa
          </span>
          <span className="hidden md:inline text-slate-500 dark:text-muted-foreground text-xs">
            — WhatsApp conectado, Agente IA ativo e base de leads importada.
          </span>
        </div>
        <Link
          to="/crm/implantacao"
          className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 hover:underline font-medium"
        >
          Ver Guia de Implantação <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    );
  }

  // Estado minimizado / recolhido
  if (isMinimized) {
    return (
      <div
        className={cn(
          "flex items-center justify-between px-4 py-2.5 rounded-xl border border-slate-200/80 bg-white/95 dark:border-slate-800 dark:bg-slate-900/80 backdrop-blur-sm text-xs transition-all shadow-xs",
          className
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          <span className="font-medium text-slate-900 dark:text-slate-100">
            Implantação Vexo OS:
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            {progress.completedCount} de {progress.totalSteps} passos concluídos ({progress.percent}%)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/crm/implantacao"
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline font-medium"
          >
            Abrir Guia
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMinimized(false)}
            className="h-7 px-2 text-xs text-slate-500 hover:text-slate-900 dark:text-muted-foreground dark:hover:text-foreground gap-1"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            Expandir
          </Button>
        </div>
      </div>
    );
  }

  const stepIcons = {
    chip: Smartphone,
    agente: Bot,
    leads: FileSpreadsheet,
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-slate-200/80 bg-gradient-to-r from-white via-slate-50 to-indigo-50/20 dark:from-slate-900 dark:via-background dark:to-indigo-950/20 dark:border-slate-800 p-5 shadow-xs transition-all",
        className
      )}
    >
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 dark:bg-indigo-500/10 dark:border-indigo-500/20 dark:text-indigo-400 shrink-0">
            <Rocket className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
              Implantação & Boas-Vindas Vexo OS
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Complete os 3 passos para ativar sua operação comercial em potência máxima.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">
            {progress.completedCount}/{progress.totalSteps} passos ({progress.percent}%)
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMinimized(true)}
            className="h-7 px-2 text-xs text-slate-500 hover:text-slate-900 dark:text-muted-foreground dark:hover:text-foreground gap-1"
            title="Recolher card de implantação"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            Recolher
          </Button>
        </div>
      </div>

      {/* Barra de Progresso Visual */}
      <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 mb-4 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-indigo-600 to-emerald-500 transition-all duration-500 rounded-full"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      {/* 3 Passos Horizontais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {progress.steps.map((step) => {
          const StepIcon = stepIcons[step.id] || Smartphone;
          return (
            <div
              key={step.id}
              className={cn(
                "flex items-center justify-between p-3 rounded-lg border transition-all text-xs",
                step.done
                  ? "bg-emerald-50/70 border-emerald-200/80 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-500/20 dark:text-emerald-300"
                  : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300 dark:bg-slate-900/60 dark:border-border dark:text-slate-300"
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={cn(
                    "p-1.5 rounded-md shrink-0",
                    step.done
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                      : "bg-slate-100 text-slate-500 dark:bg-muted dark:text-muted-foreground"
                  )}
                >
                  <StepIcon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "font-medium truncate",
                      step.done
                        ? "text-emerald-900 dark:text-emerald-200"
                        : "text-slate-900 dark:text-slate-100"
                    )}
                  >
                    {step.title}
                  </p>
                </div>
              </div>

              <div className="shrink-0 ml-2">
                {step.done ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-100/80 border border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    Pronto
                  </span>
                ) : (
                  <Link
                    to={step.route}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-100/80 border border-amber-200 hover:bg-amber-200/80 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20 px-2 py-0.5 rounded-full transition-colors"
                  >
                    <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                    Pendente
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rodapé com Botão Principal */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-200/60 dark:border-border/40">
        <span className="text-xs text-slate-500 dark:text-muted-foreground">
          {progress.percent < 100
            ? "Conclua a configuração para liberar os disparos em escala."
            : "Tudo pronto para alavancar suas vendas!"}
        </span>
        <Button
          asChild
          size="sm"
          className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-medium shadow-xs"
        >
          <Link to="/crm/implantacao">
            Abrir Guia de Implantação Completo
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
