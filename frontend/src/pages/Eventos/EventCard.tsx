import React from "react";
import {
  Calendar,
  Clock,
  MapPin,
  Ticket,
  Edit2,
  Trash2,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { EventoItem } from "@/hooks/useEventos";
import { DashboardEsteiras } from "@/components/DashboardEsteiras";

export function getEventCountdown(dateStr: string, now: Date = new Date()) {
  const eventDate = new Date(dateStr);
  if (isNaN(eventDate.getTime())) {
    return { label: "Data inválida", variant: "slate" as const, days: null };
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
  const diffMs = target.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { label: "Encerrado", variant: "slate" as const, days: diffDays };
  }
  if (diffDays === 0) {
    return { label: "Hoje 🎉", variant: "emerald" as const, days: 0 };
  }
  if (diffDays === 1) {
    return { label: "Amanhã", variant: "amber" as const, days: 1 };
  }
  return { label: `Em ${diffDays} dias`, variant: "indigo" as const, days: diffDays };
}

function formatEventDate(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "--/--/----";
  return d.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatEventTime(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return time === "00:00" ? "" : time;
}

interface EventCardProps {
  evento: EventoItem;
  onEdit: (evento: EventoItem) => void;
  onDelete: (evento: EventoItem) => void;
}

export const EventCard: React.FC<EventCardProps> = ({ evento, onEdit, onDelete }) => {
  const countdown = getEventCountdown(evento.date);
  const timeStr = formatEventTime(evento.date);
  const tickets = evento.tickets_sold ?? evento.ticketsSold ?? 0;

  return (
    <Card className="overflow-hidden border-border/70 hover:border-pink-500/40 hover:shadow-md transition-all bg-card flex flex-col justify-between">
      <CardContent className="p-4 sm:p-5 space-y-4">
        {/* Header com Nome, Contagem Regressiva e Ações */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-base sm:text-lg text-foreground truncate" title={evento.name}>
                🎪 {evento.name}
              </h3>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] sm:text-xs px-2 py-0.5 font-semibold",
                  countdown.variant === "emerald" &&
                    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 animate-pulse font-bold",
                  countdown.variant === "amber" &&
                    "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
                  countdown.variant === "indigo" &&
                    "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
                  countdown.variant === "slate" &&
                    "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30"
                )}
              >
                {countdown.label}
              </Badge>
            </div>

            {evento.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {evento.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onEdit(evento)}
              title="Editar evento"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(evento)}
              title="Excluir evento"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Informações: Data, Hora, Local e Ingressos */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground border-y border-border/50 py-2.5">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-pink-600 dark:text-pink-400 shrink-0" />
            <span className="font-medium text-foreground capitalize">{formatEventDate(evento.date)}</span>
            {timeStr && (
              <span className="flex items-center gap-0.5 font-mono text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3 ml-1" />
                {timeStr}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span className="truncate">{evento.location || "Local a definir"}</span>
          </div>

          <div className="flex items-center gap-1.5 sm:col-span-2 pt-0.5">
            <Ticket className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              Ingressos vendidos: <strong className="text-foreground font-semibold">{tickets.toLocaleString("pt-BR")}</strong>
            </span>
          </div>
        </div>

        {/* Dashboard de Esteiras Embutido no Card */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            <Sparkles className="h-3 w-3 text-pink-500" />
            <span>Esteiras de Engajamento & Réguas</span>
          </div>
          <DashboardEsteiras esteiras={evento.esteiras || evento.esteiras_status} compact />
        </div>
      </CardContent>
    </Card>
  );
};
