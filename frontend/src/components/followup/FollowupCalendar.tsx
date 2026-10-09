import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  X,
  Loader2,
  CalendarDays,
  FileSpreadsheet,
  Users,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useFollowupCalendarMonth, useFollowupCalendarDay } from "@/hooks/useFollowupAdmin";
import { useCancelFollowupJob } from "@/hooks/useFollowupQueue";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";

// Calendário do módulo de Follow-up (Etapa 5 Commit 3 / Marco 1 Fase 3). É LENTE, não superfície de
// criação: nada se cria nem se arrasta aqui. Ações permitidas ao abrir um dia:
// abrir a conversa do lead e cancelar um passo pendente específico.

const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

type CalendarFilter = "all" | "campaigns" | "followups";

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthStr: string) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function FollowupCalendar({ tenantId }: { tenantId?: string }) {
  const crmClient = useOptionalCrmClient();
  const effectiveTenantId = tenantId || crmClient?.selectedClientId || crmClient?.selectedClient?.id || undefined;

  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [filter, setFilter] = useState<CalendarFilter>("all");

  const monthStr = monthKey(cursor);
  const { data: month, isLoading: monthLoading } = useFollowupCalendarMonth(effectiveTenantId, monthStr);
  const { data: day, isLoading: dayLoading } = useFollowupCalendarDay(effectiveTenantId, selectedDate || undefined);
  const cancelJob = useCancelFollowupJob();

  if (!effectiveTenantId) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Selecione uma empresa (WhatsApp) no topo para ver o calendário.
        </CardContent>
      </Card>
    );
  }

  const [year, monthNum] = monthStr.split("-").map(Number);
  const firstOfMonth = new Date(year, monthNum - 1, 1);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay(); // 0=domingo

  const cells: Array<{ day: number; date: string } | null> = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, date: `${monthStr}-${String(d).padStart(2, "0")}` });
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  async function handleCancel(jobId: string) {
    try {
      await cancelJob.mutateAsync(jobId);
      toast.success("Passo cancelado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao cancelar.");
    }
  }

  const dayCampaigns = day?.campaigns || [];
  const dayFollowups = day?.followups || day?.items || [];
  const visibleCampaigns = filter === "all" || filter === "campaigns" ? dayCampaigns : [];
  const visibleFollowups = filter === "all" || filter === "followups" ? dayFollowups : [];
  const hasNoItems = visibleCampaigns.length === 0 && visibleFollowups.length === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardContent className="p-4 space-y-3">
          {/* Cabeçalho do Mês + Navegação */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-indigo-600" />
              <span className="text-sm font-bold capitalize">{formatMonthLabel(monthStr)}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCursor(new Date(year, monthNum - 2, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setCursor(new Date())}
              >
                Hoje
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCursor(new Date(year, monthNum, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Barra de Filtros Rápidos */}
          <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
            <Button
              type="button"
              variant={filter === "all" ? "default" : "outline"}
              size="sm"
              className={cn("h-7 text-xs px-2.5", filter === "all" ? "" : "text-muted-foreground")}
              onClick={() => setFilter("all")}
            >
              Todos
            </Button>
            <Button
              type="button"
              variant={filter === "campaigns" ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-7 text-xs px-2.5 gap-1",
                filter === "campaigns"
                  ? "bg-purple-600 hover:bg-purple-700 text-white"
                  : "text-purple-700 dark:text-purple-300 border-purple-300/60 dark:border-purple-800/60 hover:bg-purple-50 dark:hover:bg-purple-950/40"
              )}
              onClick={() => setFilter("campaigns")}
            >
              <span>📢</span> Apenas Campanhas
            </Button>
            <Button
              type="button"
              variant={filter === "followups" ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-7 text-xs px-2.5 gap-1",
                filter === "followups"
                  ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                  : "text-indigo-700 dark:text-indigo-300 border-indigo-300/60 dark:border-indigo-800/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
              )}
              onClick={() => setFilter("followups")}
            >
              <span>🔄</span> Apenas Follow-ups
            </Button>
          </div>

          {/* Dias da Semana */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-muted-foreground uppercase">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>

          {/* Células do Grid Mensal */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, i) => {
              if (!cell) return <div key={`blank-${i}`} />;
              const breakdown = month?.dayBreakdown?.[cell.date];
              const rawTotal = month?.dayCounts?.[cell.date] ?? 0;
              const campCount = breakdown?.campaignCount ?? 0;
              const campLeads = breakdown?.campaignLeadsTotal ?? 0;
              const fuCount = breakdown?.followupCount ?? (campCount === 0 ? rawTotal : 0);

              const showCampaign = (filter === "all" || filter === "campaigns") && campCount > 0;
              const showFollowup = (filter === "all" || filter === "followups") && fuCount > 0;
              const showLegacy = filter === "all" && !breakdown && rawTotal > 0;

              const isToday = cell.date === todayStr;
              const isSelected = cell.date === selectedDate;

              return (
                <button
                  key={cell.date}
                  onClick={() => setSelectedDate(cell.date)}
                  disabled={monthLoading}
                  className={cn(
                    "min-h-[64px] sm:min-h-[72px] rounded-md border p-1 flex flex-col items-center justify-between text-left transition-colors",
                    isSelected
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 shadow-sm"
                      : "border-border/70 hover:border-indigo-400/60 hover:bg-muted/30",
                    isToday && !isSelected && "border-indigo-300 bg-indigo-50/20"
                  )}
                >
                  <span
                    className={cn(
                      "text-[11px] self-start px-0.5",
                      isToday ? "font-bold text-indigo-600 dark:text-indigo-400" : "text-foreground"
                    )}
                  >
                    {cell.day}
                  </span>

                  <div className="flex flex-col items-center gap-0.5 w-full mt-auto">
                    {showCampaign && (
                      <Badge
                        variant="outline"
                        className="text-[9px] h-4 px-1 w-full flex items-center justify-center bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20 font-medium truncate"
                        title={`${campCount} campanha(s) · ${campLeads.toLocaleString("pt-BR")} leads`}
                      >
                        📢 {campCount}
                      </Badge>
                    )}
                    {showFollowup && (
                      <Badge
                        variant="outline"
                        className="text-[9px] h-4 px-1 w-full flex items-center justify-center bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20 font-medium truncate"
                        title={`${fuCount} lead(s) em follow-up`}
                      >
                        🔄 {fuCount}
                      </Badge>
                    )}
                    {showLegacy && (
                      <Badge
                        variant="outline"
                        className="text-[9px] h-4 px-1 w-full flex items-center justify-center bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20 font-medium truncate"
                      >
                        {rawTotal}
                      </Badge>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <p className="text-[10px] text-muted-foreground">
            Lente operacional: exibe tanto as mensagens 1-a-1 de cadências de follow-up quanto os disparos de campanhas em massa programados.
          </p>
        </CardContent>
      </Card>

      {/* Painel Lateral do Dia Selecionado */}
      <Card className="h-fit">
        <CardContent className="p-4 space-y-3">
          {!selectedDate ? (
            <div className="py-8 text-center text-xs text-muted-foreground space-y-1">
              <CalendarDays className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2" />
              <p className="font-medium text-foreground">Nenhum dia selecionado</p>
              <p>Clique num dia do grid para visualizar o detalhamento de campanhas e follow-ups agendados.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <span className="text-xs font-bold text-foreground capitalize">
                  {new Date(`${selectedDate}T12:00:00`).toLocaleDateString("pt-BR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "long",
                  })}
                </span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedDate(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              {dayLoading ? (
                <p className="text-xs text-muted-foreground flex items-center justify-center py-6 gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" /> Carregando envios…
                </p>
              ) : hasNoItems ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  <p>Nenhum envio programado neste dia{filter !== "all" ? " para o filtro ativo" : ""}.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Seção 📢 Campanhas Programadas */}
                  {visibleCampaigns.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between pb-1 border-b border-border/50">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-purple-700 dark:text-purple-300">
                          <span>📢</span>
                          <span>Campanhas Programadas</span>
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[10px] h-4 px-1.5 bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30 font-semibold"
                        >
                          {visibleCampaigns.length}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        {visibleCampaigns.map((camp) => (
                          <div
                            key={camp.dispatchId}
                            className="rounded-lg border border-purple-200/70 dark:border-purple-900/40 bg-purple-50/30 dark:bg-purple-950/20 p-2.5 space-y-1.5 text-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-foreground truncate" title={camp.campaignName}>
                                  {camp.campaignName}
                                </p>
                                {camp.dispatchName && camp.dispatchName !== camp.campaignName && (
                                  <p className="text-[10px] text-muted-foreground truncate">{camp.dispatchName}</p>
                                )}
                              </div>
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1.5 py-0 capitalize shrink-0 bg-background/80"
                              >
                                {camp.status === "scheduled"
                                  ? "Agendada"
                                  : camp.status === "draft"
                                  ? "Rascunho"
                                  : camp.status}
                              </Badge>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                                <strong className="text-foreground font-medium">
                                  {camp.targetCount.toLocaleString("pt-BR")}
                                </strong>{" "}
                                leads
                              </span>
                              <span className="flex items-center gap-1 font-mono text-[10px]">
                                <Clock className="h-3 w-3" />
                                {formatTime(camp.scheduledAt)}
                              </span>
                            </div>
                            <div className="pt-1 flex items-center justify-end">
                              <Link to="/crm/campanhas">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-[10px] gap-1 hover:bg-purple-100 dark:hover:bg-purple-900/40"
                                >
                                  <FileSpreadsheet className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                                  Ver campanha
                                </Button>
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Seção 🔄 Follow-ups Individuais */}
                  {visibleFollowups.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between pb-1 border-b border-border/50">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                          <span>🔄</span>
                          <span>Follow-ups Individuais</span>
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[10px] h-4 px-1.5 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30 font-semibold"
                        >
                          {visibleFollowups.length}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        {visibleFollowups.map((item) => (
                          <div
                            key={item.jobId}
                            className="rounded-lg border border-border/70 p-2.5 space-y-1.5 text-xs bg-background"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold truncate text-foreground">{item.leadName || "Lead"}</span>
                              <span className="text-[10px] text-muted-foreground font-mono shrink-0 flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatTime(item.scheduledFor)}
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {item.campaignName} {item.templateName ? `· ${item.templateName}` : ""}
                            </p>
                            <div className="flex items-center justify-between gap-1.5 pt-1">
                              {item.phone ? (
                                <Link to={`/crm/whatsapp?phone=${encodeURIComponent(item.phone)}`}>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 text-[10px] gap-1 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                                  >
                                    <MessageCircle className="h-3 w-3" /> Abrir conversa
                                  </Button>
                                </Link>
                              ) : (
                                <div />
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                                onClick={() => handleCancel(item.jobId)}
                                disabled={cancelJob.isPending}
                              >
                                <X className="h-3 w-3" /> Cancelar envio
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
