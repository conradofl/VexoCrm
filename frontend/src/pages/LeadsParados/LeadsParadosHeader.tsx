// frontend/src/pages/LeadsParados/LeadsParadosHeader.tsx
import React from "react";
import { Clock, AlertTriangle, ShieldCheck, Bell, Bot, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface LeadsParadosHeaderProps {
  count: number;
  minDays: number;
  reactivationEnabled?: boolean;
  maxDaysIdle?: number;
  onNotifyAll?: () => void;
  isNotifying?: boolean;
}

export function LeadsParadosHeader({
  count,
  minDays,
  reactivationEnabled = false,
  maxDaysIdle = 0,
  onNotifyAll,
  isNotifying = false,
}: LeadsParadosHeaderProps) {
  return (
    <div className="space-y-4">
      {/* Top Banner / Título e Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <span>Leads Parados</span>
                {count > 0 ? (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 font-semibold text-xs px-2 py-0.5">
                    {count} {count === 1 ? "lead necessitando ação" : "leads necessitando ação"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 font-semibold text-xs px-2 py-0.5">
                    SLA 100% em dia
                  </Badge>
                )}
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                Promessa Comercial: <span className="font-semibold text-foreground">Zero Perdas</span> · Nenhum lead esquecido na base
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Badge Informativo de Reativação Automática (Ver não é agir) */}
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium ${
              reactivationEnabled
                ? "bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300"
                : "bg-muted/40 border-border text-muted-foreground"
            }`}
            title={
              reactivationEnabled
                ? "Reativação automática está ativa para este tenant (cadência configurada)."
                : "Reativação automática está desligada. A visualização de leads parados é independente de qualquer envio automático."
            }
          >
            <Bot className="h-3.5 w-3.5 shrink-0" />
            <span>
              {reactivationEnabled
                ? "Reativação Automática: Ativa"
                : "Reativação Automática: Desativada (modo visualização)"}
            </span>
          </div>

          {onNotifyAll && count > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onNotifyAll}
              disabled={isNotifying}
              className="gap-2 rounded-xl text-xs font-semibold border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
              title="Disparar notificações no sininho para os responsáveis desses leads"
            >
              <Bell className="h-3.5 w-3.5" />
              <span>{isNotifying ? "Notificando..." : "Notificar Responsáveis"}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Grid de Métricas de SLA */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="rounded-2xl border bg-card/60 shadow-xs p-3.5 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total Parados</p>
            <p className="text-xl font-bold text-foreground">{count}</p>
          </div>
        </Card>

        <Card className="rounded-2xl border bg-card/60 shadow-xs p-3.5 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Critério de Inatividade</p>
            <p className="text-xl font-bold text-foreground">≥ {minDays} dias</p>
          </div>
        </Card>

        <Card className="rounded-2xl border bg-card/60 shadow-xs p-3.5 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Maior Tempo Sem Contato</p>
            <p className="text-xl font-bold text-foreground">{maxDaysIdle > 0 ? `${maxDaysIdle} dias` : "-"}</p>
          </div>
        </Card>

        <Card className="rounded-2xl border bg-card/60 shadow-xs p-3.5 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Garantia Comercial</p>
            <p className="text-sm font-bold text-foreground truncate">Zero Leads Esquecidos</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
