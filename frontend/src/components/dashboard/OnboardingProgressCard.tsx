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
          "flex items-center justify-between px-4 py-2.5 rounded-xl border border-emerald-500/20 bg-emerald-950/20 text-emerald-400 text-xs sm:text-sm transition-all",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-semibold text-emerald-300">
            ✅ Operação 100% Ativa
          </span>
          <span className="hidden md:inline text-muted-foreground text-xs">
            — WhatsApp conectado, Agente IA ativo e base de leads importada.
          </span>
        </div>
        <Link
          to="/crm/implantacao"
          className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 hover:underline font-medium"
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
          "flex items-center justify-between px-4 py-2.5 rounded-xl border border-indigo-500/20 bg-background/80 backdrop-blur-sm text-xs transition-all",
          className
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          <span className="font-medium text-foreground">
            Implantação Vexo OS:
          </span>
          <span className="text-muted-foreground">
            {progress.completedCount} de {progress.totalSteps} passos concluídos ({progress.percent}%)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/crm/implantacao"
            className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline font-medium"
          >
            Abrir Guia
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMinimized(false)}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
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
        "relative overflow-hidden rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-background to-emerald-950/20 p-5 shadow-sm transition-all",
        className
      )}
    >
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0">
            <Rocket className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight">
              Implantação & Boas-Vindas Vexo OS
            </h3>
            <p className="text-xs text-muted-foreground">
              Complete os 3 passos para ativar sua operação comercial em potência máxima.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <span className="text-xs font-semibold text-indigo-300">
            {progress.completedCount}/{progress.totalSteps} passos ({progress.percent}%)
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMinimized(true)}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
            title="Recolher card de implantação"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            Recolher
          </Button>
        </div>
      </div>

      {/* Barra de Progresso Visual */}
      <div className="w-full bg-muted/60 rounded-full h-2 mb-4 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-emerald-500 transition-all duration-500 rounded-full"
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
                  ? "bg-emerald-950/10 border-emerald-500/20 text-foreground"
                  : "bg-background/60 border-border/80 text-muted-foreground hover:border-indigo-500/30"
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={cn(
                    "p-1.5 rounded-md shrink-0",
                    step.done
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <StepIcon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {step.title}
                  </p>
                </div>
              </div>

              <div className="shrink-0 ml-2">
                {step.done ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    Pronto
                  </span>
                ) : (
                  <Link
                    to={step.route}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/20 transition-colors"
                  >
                    <Clock className="w-3 h-3 text-amber-400" />
                    Pendente
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rodapé com Botão Principal */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-border/40">
        <span className="text-xs text-muted-foreground">
          {progress.percent < 100
            ? "Conclua a configuração para liberar os disparos em escala."
            : "Tudo pronto para alavancar suas vendas!"}
        </span>
        <Button
          asChild
          size="sm"
          className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-medium shadow-sm"
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
