import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, MessageCircle, X, Loader2, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useFollowupCalendarMonth, useFollowupCalendarDay } from "@/hooks/useFollowupAdmin";
import { useCancelFollowupJob } from "@/hooks/useFollowupQueue";

// Calendário do módulo de Follow-up (Etapa 5 Commit 3). É LENTE, não superfície de
// criação: nada se cria nem se arrasta aqui. Ações permitidas ao abrir um dia:
// abrir a conversa do lead e cancelar um passo pendente específico.

const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

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
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const monthStr = monthKey(cursor);
  const { data: month, isLoading: monthLoading } = useFollowupCalendarMonth(tenantId, monthStr);
  const { data: day, isLoading: dayLoading } = useFollowupCalendarDay(tenantId, selectedDate || undefined);
  const cancelJob = useCancelFollowupJob();

  if (!tenantId) {
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

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardContent className="p-4 space-y-3">
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

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-muted-foreground uppercase">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, i) => {
              if (!cell) return <div key={`blank-${i}`} />;
              const count = month?.dayCounts?.[cell.date] ?? 0;
              const isToday = cell.date === todayStr;
              const isSelected = cell.date === selectedDate;
              return (
                <button
                  key={cell.date}
                  onClick={() => setSelectedDate(cell.date)}
                  disabled={monthLoading}
                  className={cn(
                    "aspect-square rounded-md border p-1 flex flex-col items-center justify-center gap-0.5 text-left transition-colors",
                    isSelected
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30"
                      : "border-border/70 hover:border-indigo-400/60 hover:bg-muted/30",
                    isToday && !isSelected && "border-indigo-300"
                  )}
                >
                  <span className={cn("text-[11px]", isToday ? "font-bold text-indigo-600" : "text-foreground")}>
                    {cell.day}
                  </span>
                  {count > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[9px] h-4 min-w-4 px-1 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20"
                    >
                      {count}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>

          <p className="text-[10px] text-muted-foreground">
            Só leitura: mostra quantas mensagens pendentes estão agendadas em cada dia. Pra criar ou mudar um agendamento, use a Cadência ou a Fila.
          </p>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardContent className="p-4 space-y-3">
          {!selectedDate ? (
            <p className="text-xs text-muted-foreground">Clique num dia pra ver os envios agendados.</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">
                  {new Date(`${selectedDate}T12:00:00`).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "long",
                  })}
                </span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedDate(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              {dayLoading ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
                </p>
              ) : !day?.items?.length ? (
                <p className="text-xs text-muted-foreground">Nenhum envio pendente neste dia.</p>
              ) : (
                <div className="space-y-2">
                  {day.items.map((item) => (
                    <div key={item.jobId} className="rounded-md border border-border/70 p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold truncate">{item.leadName || "Lead"}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{formatTime(item.scheduledFor)}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {item.campaignName} {item.templateName ? `· ${item.templateName}` : ""}
                      </p>
                      <div className="flex items-center gap-1.5 pt-1">
                        {item.phone && (
                          <Link to={`/crm/whatsapp?phone=${encodeURIComponent(item.phone)}`}>
                            <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1">
                              <MessageCircle className="h-3 w-3" /> Abrir conversa
                            </Button>
                          </Link>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] text-destructive hover:text-destructive gap-1"
                          onClick={() => handleCancel(item.jobId)}
                          disabled={cancelJob.isPending}
                        >
                          <X className="h-3 w-3" /> Cancelar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
