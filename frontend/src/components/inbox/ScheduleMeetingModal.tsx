// frontend/src/components/inbox/ScheduleMeetingModal.tsx
// Janela de reunião da aba Conversas: data, assunto e, se a pessoa quiser, o link da sala.
//
// O sistema NÃO cria sala de reunião. Antes esta janela montava um endereço do Google Meet com
// letras sorteadas, que não abria sala nenhuma, e esse endereço ia no convite para o lead.
// Agora o link é um campo opcional que a pessoa cola, de uma sala que ela mesma criou. Sem link,
// o convite sai só com dia e hora. Nenhum link fabricado vai em mensagem para o lead.

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
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateLeadReminder, useUpdateLeadReminder, type LeadReminder } from "@/hooks/useLeadReminders";
import { Video, Calendar, Clock, MessageSquare, ExternalLink } from "lucide-react";

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

/**
 * Confere o link colado. Vazio é válido (o link é opcional). Devolve o endereço limpo, null quando
 * vazio, ou { error } quando o que foi colado não é um endereço de página (http ou https).
 */
export function parseMeetingLink(raw: string | null | undefined): { url: string | null } | { error: string } {
  const text = (raw ?? "").trim();
  if (!text) return { url: null };
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const parsed = new URL(candidate);
    const okProtocol = parsed.protocol === "https:" || parsed.protocol === "http:";
    if (!okProtocol || !parsed.hostname.includes(".") || /\s/.test(text)) throw new Error("invalid");
    return { url: parsed.toString() };
  } catch {
    return { error: "O link da reunião não parece um endereço válido. Cole o link completo da sala ou deixe o campo vazio." };
  }
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

/** Convite para o lead. O link só entra quando a pessoa colou um; sem link, vai só dia e hora. */
export function buildMeetingInviteMessage(leadName: string, meetingDate: Date, meetingUrl?: string | null): string {
  const name = leadName && leadName !== "Lead" ? leadName.trim().split(" ")[0] : "";
  const weekday = meetingDate.toLocaleDateString("pt-BR", { weekday: "long" });
  const dayMonth = meetingDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const time = meetingDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const greeting = name ? `Olá ${name}` : "Olá";
  const link = (meetingUrl ?? "").trim();
  const linkLine = link ? `\n\nLink da reunião: ${link}` : "";

  return `${greeting}, nossa reunião está agendada para ${capitalizedWeekday} (${dayMonth}) às ${time}.${linkLine}\n\nTe vejo lá!`;
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
  // Link da sala: começa vazio. Só o que a pessoa colar (ou o que já estava salvo na reunião) entra aqui.
  const [meetingUrl, setMeetingUrl] = useState("");
  // Erro do link aparece embaixo do campo, não em aviso que some.
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLinkError(null);
    if (initialMeeting) {
      setTitle(initialMeeting.title || "Reunião de Apresentação");
      setNotes(initialMeeting.notes || "");
      if (initialMeeting.remindAt) {
        setDatetimeStr(formatLocalDateTime(new Date(initialMeeting.remindAt)));
      }
      setMeetingUrl(initialMeeting.meetingUrl || "");
    } else {
      setTitle("Reunião de Apresentação");
      setNotes("");
      const defaultDate = shortcuts[0].date;
      setDatetimeStr(formatLocalDateTime(defaultDate));
      setMeetingUrl("");
    }
  }, [open, initialMeeting, shortcuts]);

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

    const link = parseMeetingLink(meetingUrl);
    if ("error" in link) {
      setLinkError(link.error);
      return;
    }
    setLinkError(null);
    const effectiveMeetingUrl = link.url;

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

      if (shouldSendInvite && onSendWhatsappInvite) {
        const inviteMessage = buildMeetingInviteMessage(
          lead.nome || "Lead",
          meetingDate,
          effectiveMeetingUrl
        );
        onSendWhatsappInvite(inviteMessage);
        toast.success("Convite colocado no campo de resposta. Confira e envie.");
      }

      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Falha ao salvar agendamento de reunião.");
    }
  };

  const isSaving = createReminder.isPending || updateReminder.isPending;
  const parsedLink = parseMeetingLink(meetingUrl);
  const parsedLinkUrl = "url" in parsedLink ? parsedLink.url : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inbox-touch max-h-[100dvh] overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Video className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                {initialMeeting ? "Editar reunião" : "Marcar reunião"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Registre a reunião com {lead?.nome || "o lead"}. O convite com dia e hora vai para o campo de resposta, para você conferir antes de enviar.
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
              className="h-8 text-base md:text-xs"
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
              className="h-8 font-mono text-base md:text-xs"
            />
          </div>

          {/* Link da reunião: opcional, colado pela pessoa. O sistema não cria sala. */}
          <div className="space-y-1">
            <Label htmlFor="meeting-link" className="text-xs font-semibold">
              Link da reunião (opcional)
            </Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="meeting-link"
                type="url"
                inputMode="url"
                autoComplete="off"
                value={meetingUrl}
                onChange={(e) => {
                  setMeetingUrl(e.target.value);
                  setLinkError(null);
                }}
                aria-invalid={Boolean(linkError)}
                placeholder="Cole o link da sala (Meet, Zoom, Teams...)"
                data-testid="meeting-link"
                className="h-8 bg-background text-base md:text-xs"
              />
              {parsedLinkUrl && (
                <a
                  href={parsedLinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:bg-muted"
                  title="Abrir o link para conferir a sala"
                  aria-label="Abrir o link para conferir a sala"
                  data-testid="meeting-link-open"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            {linkError && (
              <p role="alert" className="text-[11px] font-semibold text-rose-700 dark:text-rose-300" data-testid="meeting-link-error">
                {linkError}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground" data-testid="meeting-link-help">
              O sistema não cria a sala. Crie a reunião no seu Meet, Zoom ou Teams e cole o link aqui. Sem link, o convite vai só com dia e hora.
            </p>
          </div>

          {/* Anotações internas */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Notas / Pauta Interna (opcional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Objetivo da call, dores do cliente, histórico relevante..."
              rows={2}
              className="resize-none text-base md:text-xs"
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
            Salvar e preparar convite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
