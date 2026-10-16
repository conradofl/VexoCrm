// frontend/src/components/inbox/ScheduleMeetingModal.tsx
// Modal para Agendamento de Reuniões com Google Meet e Envio com 1 Clique no WhatsApp (Bloco C)

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateLeadReminder, useUpdateLeadReminder, type LeadReminder } from "@/hooks/useLeadReminders";
import { Video, Calendar, Clock, RefreshCw, MessageSquare, ExternalLink } from "lucide-react";

interface ScheduleMeetingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: {
    id?: string;
    nome?: string;
    phone: string;
  } | null;
  clientId: string | null;
  onSendWhatsappInvite?: (inviteText: string) => void;
  initialMeeting?: LeadReminder | null;
}

function generateRandomLetters(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function generateGoogleMeetUrl(): string {
  const p1 = generateRandomLetters(3);
  const p2 = generateRandomLetters(4);
  const p3 = generateRandomLetters(3);
  return `https://meet.google.com/${p1}-${p2}-${p3}`;
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

function getMeetingShortcuts(): Array<{ label: string; date: Date }> {
  const now = new Date();

  // 1. Hoje 15h
  const today15h = new Date(now);
  today15h.setHours(15, 0, 0, 0);
  if (today15h.getTime() <= now.getTime()) {
    today15h.setDate(today15h.getDate() + 1);
  }

  // 2. Hoje 17h
  const today17h = new Date(now);
  today17h.setHours(17, 0, 0, 0);
  if (today17h.getTime() <= now.getTime()) {
    today17h.setDate(today17h.getDate() + 1);
  }

  // 3. Amanhã 10h
  const tomorrow10h = new Date(now);
  tomorrow10h.setDate(tomorrow10h.getDate() + 1);
  tomorrow10h.setHours(10, 0, 0, 0);

  // 4. Amanhã 15h
  const tomorrow15h = new Date(now);
  tomorrow15h.setDate(tomorrow15h.getDate() + 1);
  tomorrow15h.setHours(15, 0, 0, 0);

  // 5. Em 2 dias 15h
  const in2Days15h = new Date(now);
  in2Days15h.setDate(in2Days15h.getDate() + 2);
  in2Days15h.setHours(15, 0, 0, 0);

  return [
    { label: today15h.getDate() === now.getDate() ? "Hoje 15h" : "Amanhã 15h", date: today15h },
    { label: today17h.getDate() === now.getDate() ? "Hoje 17h" : "Amanhã 17h", date: today17h },
    { label: "Amanhã 10h", date: tomorrow10h },
    { label: "Amanhã 15h", date: tomorrow15h },
    { label: "Em 2 dias 15h", date: in2Days15h },
  ];
}

export function buildMeetingInviteMessage(leadName: string, meetingDate: Date, meetingUrl: string): string {
  const name = leadName && leadName !== "Lead" ? leadName.trim().split(" ")[0] : "olá";
  const weekday = meetingDate.toLocaleDateString("pt-BR", { weekday: "long" });
  const dayMonth = meetingDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const time = meetingDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);

  return `Olá ${name}, nossa reunião está agendada para ${capitalizedWeekday} (${dayMonth}) às ${time}.\n\nLink da nossa sala no Google Meet: ${meetingUrl}\n\nTe vejo lá!`;
}

export function ScheduleMeetingModal({
  open,
  onOpenChange,
  lead,
  clientId,
  onSendWhatsappInvite,
  initialMeeting,
}: ScheduleMeetingModalProps) {
  const { user } = useAuth();
  const createReminder = useCreateLeadReminder(clientId);
  const updateReminder = useUpdateLeadReminder(clientId);

  const shortcuts = useMemo(() => getMeetingShortcuts(), []);

  const [title, setTitle] = useState("Reunião de Apresentação");
  const [notes, setNotes] = useState("");
  const [datetimeStr, setDatetimeStr] = useState(() => {
    const defaultDate = shortcuts[0].date;
    return formatLocalDateTime(defaultDate);
  });
  const [autoGenerateMeet, setAutoGenerateMeet] = useState(true);
  const [meetingUrl, setMeetingUrl] = useState(() => generateGoogleMeetUrl());

  useEffect(() => {
    if (!open) return;
    if (initialMeeting) {
      setTitle(initialMeeting.title || "Reunião de Apresentação");
      setNotes(initialMeeting.notes || "");
      if (initialMeeting.remindAt) {
        setDatetimeStr(formatLocalDateTime(new Date(initialMeeting.remindAt)));
      }
      if (initialMeeting.meetingUrl) {
        setMeetingUrl(initialMeeting.meetingUrl);
        setAutoGenerateMeet(true);
      }
    } else {
      setTitle("Reunião de Apresentação");
      setNotes("");
      const defaultDate = shortcuts[0].date;
      setDatetimeStr(formatLocalDateTime(defaultDate));
      setMeetingUrl(generateGoogleMeetUrl());
      setAutoGenerateMeet(true);
    }
  }, [open, initialMeeting, shortcuts]);

  const handleRegenerateMeet = () => {
    const newUrl = generateGoogleMeetUrl();
    setMeetingUrl(newUrl);
    toast.success("Novo link do Google Meet gerado!");
  };

  const handleSave = async (shouldSendInvite = false) => {
    if (!lead?.phone) {
      toast.error("Telefone do lead é obrigatório.");
      return;
    }

    const meetingDate = new Date(datetimeStr);
    if (isNaN(meetingDate.getTime())) {
      toast.error("Por favor, selecione uma data e horário válidos.");
      return;
    }

    const effectiveMeetingUrl = autoGenerateMeet ? meetingUrl.trim() : null;

    try {
      if (initialMeeting?.id) {
        await updateReminder.mutateAsync({
          id: initialMeeting.id,
          title: title.trim() || "Reunião com Lead",
          notes: notes.trim() || null,
          remindAt: meetingDate.toISOString(),
          activityType: "meeting",
          meetingUrl: effectiveMeetingUrl,
        });
        toast.success("Reunião atualizada com sucesso!");
      } else {
        await createReminder.mutateAsync({
          clientId: clientId || undefined,
          leadId: lead.id || null,
          phone: lead.phone,
          leadName: lead.nome || "Lead",
          title: title.trim() || "Reunião com Lead",
          notes: notes.trim() || null,
          remindAt: meetingDate.toISOString(),
          assignedToUid: user?.uid || null,
          assignedToName: user?.displayName || user?.email || null,
          activityType: "meeting",
          meetingUrl: effectiveMeetingUrl,
        });
        toast.success("Reunião agendada no calendário!");
      }

      if (shouldSendInvite && onSendWhatsappInvite && effectiveMeetingUrl) {
        const inviteMessage = buildMeetingInviteMessage(
          lead.nome || "Lead",
          meetingDate,
          effectiveMeetingUrl
        );
        onSendWhatsappInvite(inviteMessage);
        toast.success("Convite carregado na caixa de envio do WhatsApp!");
      }

      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Falha ao salvar agendamento de reunião.");
    }
  };

  const isSaving = createReminder.isPending || updateReminder.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Video className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                {initialMeeting ? "Editar Reunião / Call" : "Agendar Call (Google Meet)"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Gere uma sala no Google Meet e envie o convite formatado para {lead?.nome || "o lead"}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3.5 py-1 text-xs">
          {/* Título da Call */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Assunto / Pauta</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Apresentação da Proposta Comercial"
              className="h-8 text-xs"
            />
          </div>

          {/* Atalhos Rápidos */}
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3 text-indigo-500" />
              Atalhos de Horário
            </Label>
            <div className="flex flex-wrap gap-1">
              {shortcuts.map((sc, i) => (
                <Button
                  key={i}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDatetimeStr(formatLocalDateTime(sc.date))}
                  className="h-6 text-[10px] px-2 rounded-md hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-700 dark:hover:text-emerald-300 border-border/70"
                >
                  {sc.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Data e Horário */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Data e Horário da Reunião
            </Label>
            <Input
              type="datetime-local"
              value={datetimeStr}
              onChange={(e) => setDatetimeStr(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>

          {/* Opção Google Meet */}
          <div className="space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="auto-meet"
                checked={autoGenerateMeet}
                onCheckedChange={(checked) => setAutoGenerateMeet(Boolean(checked))}
              />
              <label
                htmlFor="auto-meet"
                className="text-xs font-semibold cursor-pointer text-foreground flex items-center gap-1"
              >
                Gerar sala do Google Meet automaticamente
              </label>
            </div>

            {autoGenerateMeet && (
              <div className="space-y-1 pt-1">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={meetingUrl}
                    onChange={(e) => setMeetingUrl(e.target.value)}
                    placeholder="https://meet.google.com/..."
                    className="h-7 text-xs font-mono bg-background"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleRegenerateMeet}
                    className="h-7 w-7 text-emerald-700 dark:text-emerald-300"
                    title="Regerar link da sala"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <a
                    href={meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border/70 hover:bg-muted text-muted-foreground"
                    title="Testar sala no Meet"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Link direto da sala pronto para compartilhar com o cliente.
                </p>
              </div>
            )}
          </div>

          {/* Anotações internas */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Notas / Pauta Interna (opcional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Objetivo da call, dores do cliente, histórico relevante..."
              rows={2}
              className="text-xs resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-1.5 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="h-8 text-xs"
          >
            Cancelar
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleSave(false)}
            disabled={isSaving}
            className="h-8 text-xs"
          >
            Apenas Salvar
          </Button>

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => handleSave(true)}
            disabled={isSaving}
            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5 shadow-xs"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            💬 Enviar Convite no WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
