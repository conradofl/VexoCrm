import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SetupStepCardProps {
  stepNumber: number;
  title: string;
  icon: ReactNode;
  isDone: boolean;
  statusLabel: string;
  description: string;
  details?: ReactNode;
  ctaText: string;
  ctaRoute: string;
  isPrimary?: boolean;
}

export function SetupStepCard({
  stepNumber,
  title,
  icon,
  isDone,
  statusLabel,
  description,
  details,
  ctaText,
  ctaRoute,
  isPrimary,
}: SetupStepCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between rounded-xl border p-5 transition-all shadow-sm",
        isDone
          ? "bg-card/70 border-emerald-500/20"
          : isPrimary
          ? "bg-card border-indigo-500/40 ring-1 ring-indigo-500/20 shadow-md"
          : "bg-card/40 border-border/80"
      )}
    >
      <div className="space-y-4">
        {/* Header do Card */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex items-center justify-center w-10 h-10 rounded-xl shrink-0",
                isDone
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
              )}
            >
              {icon}
            </div>
            <div>
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Passo {stepNumber}
              </span>
              <h3 className="text-base font-semibold text-foreground">
                {title}
              </h3>
            </div>
          </div>

          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border",
              isDone
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                : "text-amber-400 bg-amber-500/10 border-amber-500/20"
            )}
          >
            {isDone ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Clock className="w-3.5 h-3.5 text-amber-400" />
            )}
            {statusLabel}
          </span>
        </div>

        {/* Descrição */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>

        {/* Detalhes específicos do passo */}
        {details && (
          <div className="rounded-lg bg-muted/40 border border-border/60 p-3 text-xs space-y-1.5">
            {details}
          </div>
        )}
      </div>

      {/* CTA Button */}
      <div className="pt-5 mt-4 border-t border-border/50">
        <Button
          asChild
          variant={isDone ? "outline" : "default"}
          className={cn(
            "w-full text-xs font-medium justify-center gap-1.5",
            !isDone &&
              "bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-sm"
          )}
        >
          <Link to={ctaRoute}>
            {ctaText}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
