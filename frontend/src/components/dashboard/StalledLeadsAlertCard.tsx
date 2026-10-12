// frontend/src/components/dashboard/StalledLeadsAlertCard.tsx
// Card indicador visual de SLA: Leads Parados e Base Nunca Abordada (Pilar 1: Zero Perdas / Nenhum Lead Esquecido)

import React from "react";
import { useNavigate } from "react-router-dom";
import { Clock, ArrowRight, CheckCircle2, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStalledLeads } from "@/hooks/useStalledLeads";
import { cn } from "@/lib/utils";

export interface StalledLeadsAlertCardProps {
  clientId: string;
  minDays?: number | null;
}

export function StalledLeadsAlertCard({ clientId, minDays = null }: StalledLeadsAlertCardProps) {
  const navigate = useNavigate();
  const { data, isLoading } = useStalledLeads(clientId, minDays ?? null, { limit: 1 });

  if (isLoading && !data) {
    return (
      <div
        data-testid="stalled-leads-alert-card-skeleton"
        className="h-20 rounded-2xl border border-border bg-muted/20 animate-pulse"
      />
    );
  }

  const effectiveMinDays = data?.minDays ?? (typeof minDays === "number" ? minDays : 7);
  const stalledCount = data?.stalled_count ?? data?.count ?? 0;
  const neverApproachedCount = data?.never_approached_count ?? 0;
  const hasStalled = stalledCount > 0;

  return (
    <Card
      data-testid="stalled-leads-alert-card"
      className={cn(
        "rounded-2xl border p-0 shadow-xs transition-all hover:shadow-md",
        hasStalled
          ? "border-amber-500/40 bg-gradient-to-r from-amber-500/[0.08] via-amber-500/[0.03] to-transparent dark:from-amber-950/30 dark:via-zinc-900"
          : "border-emerald-500/30 bg-emerald-500/[0.03] dark:bg-emerald-950/10"
      )}
    >
      <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              hasStalled
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30"
                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30"
            )}
          >
            {hasStalled ? <Clock className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-bold text-foreground flex items-center gap-1.5">
                {hasStalled ? (
                  <span>⚠️ {stalledCount} Leads Parados (&gt; {effectiveMinDays} dias)</span>
                ) : (
                  <span>SLA 100% em dia</span>
                )}
              </h3>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-semibold px-2 py-0.5",
                  hasStalled
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                )}
              >
                {hasStalled ? "Alerta de SLA Comercial" : "SLA 100% em dia"}
              </Badge>
              {neverApproachedCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-medium px-2 py-0.5 bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30 flex items-center gap-1"
                >
                  <Users className="h-3 w-3" />
                  <span>{neverApproachedCount} nunca abordados</span>
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hasStalled
                ? `Contatos em conversa sem resposta há mais de ${effectiveMinDays} dias`
                : "Nenhum lead esquecido · SLA em dia"}
            </p>
          </div>
        </div>

        <Button
          size="sm"
          data-testid="view-stalled-leads-button"
          onClick={() => navigate("/crm/leads-parados")}
          className={cn(
            "shrink-0 h-9 gap-2 rounded-xl font-semibold text-xs self-start sm:self-auto",
            hasStalled
              ? "bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600 dark:text-zinc-950"
              : "variant-outline"
          )}
        >
          <span>Visualizar Leads Parados</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
