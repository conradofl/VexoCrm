import { useEffect, useState } from "react";
import { Calendar, RefreshCw, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatLastUpdatedTime, todayDateKey, validateCustomRange } from "@/lib/dashboard/formatters";
import type { DashboardPeriod, DashboardRange } from "@/hooks/useDashboard";

interface DashboardHeaderProps {
  period: DashboardPeriod;
  onPeriodChange: (period: DashboardPeriod) => void;
  // null = ainda não há cálculo para este período (não mostra a hora)
  lastUpdatedAt: string | null;
  cacheStatus: "ready" | "updating" | "failed";
  onRefresh: () => void;
  isRefreshing: boolean;
  // Intervalo personalizado já aplicado e o que fazer quando o usuário aplica outro
  customRange?: DashboardRange | null;
  onCustomRangeApply?: (range: DashboardRange) => void;
  // Hoje (AAAA-MM-DD); só para teste. Padrão: relógio do navegador.
  today?: string;
}

export function DashboardHeader({
  period,
  onPeriodChange,
  lastUpdatedAt,
  cacheStatus,
  onRefresh,
  isRefreshing,
  customRange = null,
  onCustomRangeApply,
  today,
}: DashboardHeaderProps) {
  const formattedTime = formatLastUpdatedTime(lastUpdatedAt);
  const hasUpdateTime = !!lastUpdatedAt;
  const todayKey = today ?? todayDateKey();

  // Rascunho das datas: só vira período quando o usuário clica em Aplicar
  const [draftFrom, setDraftFrom] = useState(customRange?.from ?? "");
  const [draftTo, setDraftTo] = useState(customRange?.to ?? "");
  useEffect(() => {
    setDraftFrom(customRange?.from ?? "");
    setDraftTo(customRange?.to ?? "");
  }, [customRange?.from, customRange?.to]);
  const rangeError = draftFrom && draftTo ? validateCustomRange(draftFrom, draftTo, todayKey) : null;
  const canApply = !!draftFrom && !!draftTo && !rangeError;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3 rounded-2xl bg-card border border-border/80 shadow-xs">
      {/* Seletor de Período (Padrão: 30 dias) */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Calendar className="h-4 w-4 text-indigo-500 shrink-0" />
          <span>Período:</span>
        </div>
        <Select
          value={period}
          onValueChange={(val) => onPeriodChange(val as DashboardPeriod)}
        >
          <SelectTrigger className="h-8 w-[150px] text-xs rounded-xl border-border bg-background font-medium">
            <SelectValue placeholder="Selecione o período" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">7 dias</SelectItem>
            <SelectItem value="30d">30 dias</SelectItem>
            <SelectItem value="this_month">Este mês</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>

        {period === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              De
              <input
                type="date"
                aria-label="Data inicial"
                value={draftFrom}
                max={todayKey}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="h-8 rounded-xl border border-border bg-background px-2 text-xs"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              até
              <input
                type="date"
                aria-label="Data final"
                value={draftTo}
                max={todayKey}
                onChange={(e) => setDraftTo(e.target.value)}
                className="h-8 rounded-xl border border-border bg-background px-2 text-xs"
              />
            </label>
            <Button
              size="sm"
              className="h-8 rounded-xl text-xs"
              disabled={!canApply}
              onClick={() => onCustomRangeApply?.({ from: draftFrom, to: draftTo })}
            >
              Aplicar
            </Button>
            {rangeError && (
              <p role="alert" className="basis-full text-[11px] text-red-600 dark:text-red-400">
                {rangeError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Informação de Última Atualização e Ação de Recalcular */}
      <div className="flex items-center flex-wrap gap-2 text-xs text-muted-foreground">
        {cacheStatus === "failed" ? (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-[11px]"
            title="A atualização em segundo plano falhou. Exibindo último cálculo salvo."
          >
            <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
            <span>Última atualização falhou · Dados de {formattedTime}</span>
          </Badge>
        ) : hasUpdateTime ? (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/30 border border-border/40 text-[11px]">
            <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
            <span>Atualizado às {formattedTime}</span>
          </div>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing || cacheStatus === "updating"}
          className="h-8 gap-1.5 rounded-xl text-xs font-medium border-border hover:bg-muted/50"
          title="Recalcular métricas no banco de dados"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing || cacheStatus === "updating" ? "animate-spin text-indigo-500" : ""}`} />
          <span>{isRefreshing || cacheStatus === "updating" ? "Atualizando..." : "Atualizar agora"}</span>
        </Button>
      </div>
    </div>
  );
}
