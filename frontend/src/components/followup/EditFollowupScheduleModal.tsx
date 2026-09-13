import { useState, useEffect, useMemo } from "react";
import {
  Clock,
  Calendar,
  Zap,
  AlertTriangle,
  Info,
  Edit3,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/components/ui/use-toast";
import { useRescheduleFollowup, useDiscardFollowup, type FollowupItem } from "@/hooks/useFollowupQueue";

interface EditFollowupScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: FollowupItem | null;
}

function formatLocalDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getShortcutDates(): Array<{ label: string; date: Date }> {
  const now = new Date();

  // 1. Em 1 hora
  const in1Hour = new Date(now.getTime() + 60 * 60 * 1000);

  // 2. Hoje às 18h (ou amanhã às 18h se já passou)
  const today18h = new Date(now);
  today18h.setHours(18, 0, 0, 0);
  if (today18h.getTime() <= now.getTime()) {
    today18h.setDate(today18h.getDate() + 1);
  }

  // 3. Amanhã às 9h
  const tomorrow9h = new Date(now);
  tomorrow9h.setDate(tomorrow9h.getDate() + 1);
  tomorrow9h.setHours(9, 0, 0, 0);

  // 4. Em 2 dias às 9h
  const in2Days9h = new Date(now);
  in2Days9h.setDate(in2Days9h.getDate() + 2);
  in2Days9h.setHours(9, 0, 0, 0);

  // 5. Próxima segunda às 9h
  const nextMonday9h = new Date(now);
  const dayOfWeek = nextMonday9h.getDay();
  const daysUntilMonday = ((8 - dayOfWeek) % 7) || 7;
  nextMonday9h.setDate(nextMonday9h.getDate() + daysUntilMonday);
  nextMonday9h.setHours(9, 0, 0, 0);

  return [
    { label: "Em 1 hora", date: in1Hour },
    { label: today18h.getDate() === now.getDate() ? "Hoje às 18h" : "Amanhã às 18h", date: today18h },
    { label: "Amanhã às 9h", date: tomorrow9h },
    { label: "Em 2 dias", date: in2Days9h },
    { label: "Próxima segunda às 9h", date: nextMonday9h },
  ];
}

export function EditFollowupScheduleModal({
  open,
  onOpenChange,
  item,
}: EditFollowupScheduleModalProps) {
  const reschedule = useRescheduleFollowup();
  const discardFollowup = useDiscardFollowup();

  const isAvulso = !item?.campaignId || item?.campaignName === "Avulso";
  const leadName = item?.leadName || "Lead";
  const rawPhone = item?.phone || "";

  const [selectedShortcutIndex, setSelectedShortcutIndex] = useState<number | null>(null);
  const [dateTime, setDateTime] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (open && item) {
      setSelectedShortcutIndex(null);
      if (item.nextScheduledFor) {
        const d = new Date(item.nextScheduledFor);
        setDateTime(isNaN(d.getTime()) ? formatLocalDateTime(new Date(Date.now() + 3600000)) : formatLocalDateTime(d));
      } else {
        setDateTime(formatLocalDateTime(new Date(Date.now() + 3600000)));
      }
      setMessage(item.customMessage || "Olá {{nome}}, tudo bem? Passando para saber se conseguiu dar uma olhada na proposta!");
    }
  }, [open, item]);

  const shortcuts = useMemo(() => getShortcutDates(), [open]);

  const targetDate = useMemo(() => {
    if (!dateTime) return null;
    const d = new Date(dateTime);
    return isNaN(d.getTime()) ? null : d;
  }, [dateTime]);

  const isPast = Boolean(targetDate && targetDate.getTime() <= Date.now());

  // Prévia da mensagem em tempo real para lembretes avulsos
  const previewText = useMemo(() => {
    if (!isAvulso || !message) return "";
    let rendered = message;
    const firstName = leadName.split(" ")[0] || leadName;
    rendered = rendered.replace(/\{\{\s*(nome|lead_name|name)\s*\}\}/gi, firstName);
    rendered = rendered.replace(/\{\{\s*(telefone|phone|celular)\s*\}\}/gi, rawPhone || "(telefone)");
    rendered = rendered.replace(/\{\{\s*(scheduling_link|link|agendamento)\s*\}\}/gi, "https://vexo.com.br/agenda");
    return rendered;
  }, [message, leadName, rawPhone, isAvulso]);

  const relativeTimeLabel = useMemo(() => {
    if (!targetDate || isPast) return null;
    const diffMs = targetDate.getTime() - Date.now();
    const diffMinutes = Math.round(diffMs / 60000);
    if (diffMinutes < 60) return `em ${diffMinutes} minuto(s)`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `em ${diffHours} hora(s)`;
    const diffDays = Math.round(diffHours / 24);
    return `em ${diffDays} dia(s)`;
  }, [targetDate, isPast]);

  const handleInsertVariable = (token: string) => {
    setMessage((prev) => {
      if (prev.endsWith(" ") || prev === "") return prev + token + " ";
      return prev + " " + token + " ";
    });
  };

  const handleSave = async () => {
    if (!item) return;
    if (!targetDate || isPast) {
      toast({
        variant: "destructive",
        title: "Horário inválido",
        description: "Esse horário já passou. Escolha um momento futuro.",
      });
      return;
    }

    if (isAvulso && !message.trim()) {
      toast({
        variant: "destructive",
        title: "Mensagem obrigatória",
        description: "Digite o texto da mensagem do lembrete avulso.",
      });
      return;
    }

    try {
      await reschedule.mutateAsync({
        id: item.id,
        scheduledFor: targetDate.toISOString(),
        customMessage: isAvulso ? message.trim() : undefined,
      });

      const formattedHour = targetDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const formattedDate = targetDate.toLocaleDateString("pt-BR");

      toast({
        title: "Agendamento atualizado!",
        description: `Novo horário de envio: ${formattedDate} às ${formattedHour}.`,
      });

      onOpenChange(false);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Erro ao atualizar agendamento",
        description: err?.message || "Ocorreu um erro ao salvar o novo horário.",
      });
    }
  };

  const handleDiscard = async () => {
    if (!item?.id) return;
    if (!window.confirm("Deseja realmente cancelar este agendamento? A mensagem programada não será enviada.")) {
      return;
    }
    try {
      await discardFollowup.mutateAsync(item.id);
      toast({
        title: "Agendamento cancelado",
        description: "A mensagem agendada foi cancelada com sucesso.",
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Erro ao cancelar agendamento",
        description: err?.message || "Falha ao descartar envio.",
      });
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Editar Follow-up Agendado</DialogTitle>
              <DialogDescription className="text-xs">
                Ajuste o horário de envio ou personalize a mensagem do lembrete.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-1 text-sm">
          {/* Card do Lead e Origem */}
          <div className="p-3 rounded-xl border border-border/70 bg-muted/30 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Destinatário</span>
              <div className="font-semibold text-foreground">{leadName}</div>
              <div className="text-xs font-mono text-muted-foreground">{rawPhone}</div>
            </div>
            <div className="text-right flex flex-col items-end gap-1.5">
              <Badge variant={isAvulso ? "secondary" : "outline"} className="text-xs">
                {item.campaignName || "Avulso"}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={discardFollowup.isPending || reschedule.isPending}
                onClick={handleDiscard}
                className="h-6 px-2 text-[11px] font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                title="Cancelar agendamento de mensagem"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                {discardFollowup.isPending ? "Cancelando..." : "Cancelar agendamento"}
              </Button>
            </div>
          </div>

          {/* 1. Data e Hora */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-500" />
              1. Novo Horário de Envio (Data e Hora)
            </Label>

            {/* Atalhos Rápidos */}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {shortcuts.map((sc, i) => {
                const formatted = formatLocalDateTime(sc.date);
                const isSelected = selectedShortcutIndex === i;
                return (
                  <Button
                    key={i}
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      if (selectedShortcutIndex === i) {
                        setSelectedShortcutIndex(null);
                      } else {
                        setSelectedShortcutIndex(i);
                        setDateTime(formatted);
                      }
                    }}
                    className={`h-7 px-2.5 text-xs font-medium rounded-lg transition-all ${
                      isSelected
                        ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                        : "border-border/80 hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Zap className="w-3 h-3 mr-1 text-amber-500" />
                    {sc.label}
                  </Button>
                );
              })}
            </div>

            {/* Input Manual */}
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => {
                setSelectedShortcutIndex(null);
                setDateTime(e.target.value);
              }}
              className="w-full h-9 px-3 py-1.5 text-xs rounded-xl border border-input bg-background font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />

            {/* Trava de horário passado */}
            {isPast && (
              <div className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 font-medium bg-rose-50 dark:bg-rose-950/30 p-2 rounded-lg border border-rose-200 dark:border-rose-900/50">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Esse horário já passou. Escolha um momento futuro.</span>
              </div>
            )}
          </div>

          {/* 2. Mensagem */}
          {isAvulso ? (
            <div className="space-y-2">
              <Label className="text-xs font-semibold flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-500" />
                  2. Mensagem do Lembrete Avulso
                </span>
                <span className="text-[10px] text-muted-foreground">Variáveis dinâmicas suportadas</span>
              </Label>

              <Textarea
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="text-xs resize-none rounded-xl"
                placeholder="Digite a mensagem..."
              />

              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="text-[11px] font-medium">Inserir:</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleInsertVariable("{{nome}}")}
                  className="h-6 px-2 text-[11px] font-mono border-dashed hover:border-indigo-500 hover:text-indigo-600"
                >
                  +&#123;&#123;nome&#125;&#125;
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleInsertVariable("{{telefone}}")}
                  className="h-6 px-2 text-[11px] font-mono border-dashed hover:border-indigo-500 hover:text-indigo-600"
                >
                  +&#123;&#123;telefone&#125;&#125;
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleInsertVariable("{{scheduling_link}}")}
                  className="h-6 px-2 text-[11px] font-mono border-dashed hover:border-indigo-500 hover:text-indigo-600"
                >
                  +&#123;&#123;scheduling_link&#125;&#125;
                </Button>
              </div>

              {/* 3. Prévia Real */}
              <div className="p-3 rounded-xl border border-indigo-200/80 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                    Prévia Real do Envio
                  </span>
                  {relativeTimeLabel && (
                    <span className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                      {relativeTimeLabel}
                    </span>
                  )}
                </div>
                <div className="p-2.5 rounded-lg bg-background border border-border/80 text-xs text-foreground font-sans whitespace-pre-wrap leading-relaxed shadow-2xs">
                  {previewText || <span className="text-muted-foreground italic">Nenhuma mensagem digitada</span>}
                </div>
              </div>
            </div>
          ) : (
            <Alert className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-xs py-2.5">
              <Info className="h-4 w-4 text-indigo-500" />
              <AlertDescription className="text-xs text-muted-foreground leading-relaxed">
                Mensagem definida pela cadência <strong className="text-foreground">{item.campaignName}</strong>. O texto é padronizado pelo template da cadência e não pode ser editado individualmente por envio.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-border">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={reschedule.isPending || discardFollowup.isPending || isPast || (isAvulso && !message.trim())}
            onClick={handleSave}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5 shadow-sm"
          >
            {reschedule.isPending ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
