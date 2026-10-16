// frontend/src/components/inbox/MeetingPostCallCheckinCard.tsx
// Check-in Inteligente Pós-Reunião (O Fechamento do Gargalo - Bloco C)

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useUpdateLeadReminder, type LeadReminder } from "@/hooks/useLeadReminders";
import { Video, CheckCircle2, FileText, CalendarClock, UserX, ExternalLink, Clock } from "lucide-react";

interface MeetingPostCallCheckinCardProps {
  meeting: LeadReminder;
  clientId: string | null;
  onReschedule: () => void;
  onStageChange?: (newStage: string) => Promise<void> | void;
}

export function MeetingPostCallCheckinCard({
  meeting,
  clientId,
  onReschedule,
  onStageChange,
}: MeetingPostCallCheckinCardProps) {
  const updateReminder = useUpdateLeadReminder(clientId);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOutcome = async (
    outcome: "won" | "proposal" | "no_show" | "lost",
    label: string,
    targetStage?: string
  ) => {
    setIsSubmitting(true);
    try {
      await updateReminder.mutateAsync({
        id: meeting.id,
        clientId: clientId || undefined,
        meetingOutcome: outcome,
        status: "completed",
      });

      if (targetStage && onStageChange) {
        await onStageChange(targetStage);
      }

      toast.success(`Desfecho registrado: ${label}!`);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao registrar desfecho da reunião.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formattedDate = meeting.remindAt
    ? new Date(meeting.remindAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "--:--";

  return (
    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-2 text-xs shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 font-bold text-emerald-900 dark:text-emerald-200">
            <Video className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="truncate">{meeting.title || "Call Google Meet"}</span>
          </div>
          <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 flex items-center gap-1">
            <Clock className="h-3 w-3 shrink-0" />
            Horário: {formattedDate}
          </p>
        </div>
        {meeting.meetingUrl && (
          <a
            href={meeting.meetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold shrink-0"
          >
            Entrar
            <ExternalLink className="h-2.5 w-2.5 opacity-80" />
          </a>
        )}
      </div>

      <div className="pt-1 border-t border-emerald-500/20 space-y-1.5">
        <p className="font-semibold text-emerald-950 dark:text-emerald-100 text-[11px]">
          A call terminou? Qual foi o desfecho?
        </p>

        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={() => handleOutcome("won", "Venda Fechada", "won")}
            disabled={isSubmitting}
            className="h-7 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white gap-1 justify-center rounded-lg"
          >
            <CheckCircle2 className="h-3 w-3" />
            ✅ Venda Fechada
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleOutcome("proposal", "Proposta Enviada", "proposal")}
            disabled={isSubmitting}
            className="h-7 text-[10px] font-semibold border-emerald-600/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/20 gap-1 justify-center rounded-lg"
          >
            <FileText className="h-3 w-3 text-emerald-600" />
            📄 Proposta Enviada
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onReschedule}
            disabled={isSubmitting}
            className="h-7 text-[10px] font-semibold border-indigo-500/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/15 gap-1 justify-center rounded-lg"
          >
            <CalendarClock className="h-3 w-3 text-indigo-500" />
            🔄 Remarcar Call
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleOutcome("no_show", "Não Compareceu (No-Show)", "atendimento")}
            disabled={isSubmitting}
            className="h-7 text-[10px] font-semibold border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/15 gap-1 justify-center rounded-lg"
          >
            <UserX className="h-3 w-3 text-rose-500" />
            ❌ Não Compareceu
          </Button>
        </div>
      </div>
    </div>
  );
}
