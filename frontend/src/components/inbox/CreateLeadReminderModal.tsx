// frontend/src/components/inbox/CreateLeadReminderModal.tsx
// Modal para criação de Lembrete Pessoal Interno (não envia WhatsApp para o cliente).

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateLeadReminder, useUpdateLeadReminder, type LeadReminder } from "@/hooks/useLeadReminders";
import { Bell, Calendar, Clock, User, ShieldAlert } from "lucide-react";

interface CreateLeadReminderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: {
    id?: string;
    nome?: string;
    phone: string;
  } | null;
  clientId: string | null;
  operatorOptions?: Array<{
    uid: string;
    displayName?: string | null;
    email?: string | null;
  }>;
  initialReminder?: LeadReminder | null;
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
  const in2Days = new Date(now);
  in2Days.setDate(in2Days.getDate() + 2);
  in2Days.setHours(9, 0, 0, 0);

  // 5. Próxima segunda às 9h
  const nextMonday = new Date(now);
  const dayOfWeek = nextMonday.getDay();
  const daysUntilMonday = ((1 - dayOfWeek + 7) % 7) || 7;
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
  nextMonday.setHours(9, 0, 0, 0);

  return [
    { label: "Em 1 hora", date: in1Hour },
    { label: today18h.getDate() === now.getDate() ? "Hoje às 18h" : "Amanhã às 18h", date: today18h },
    { label: "Amanhã às 9h", date: tomorrow9h },
    { label: "Em 2 dias", date: in2Days },
    { label: "Próxima segunda às 9h", date: nextMonday },
  ];
}

export function CreateLeadReminderModal({
  open,
  onOpenChange,
  lead,
  clientId,
  operatorOptions = [],
  initialReminder,
}: CreateLeadReminderModalProps) {
  const { user } = useAuth();
  const createReminder = useCreateLeadReminder(clientId);
  const updateReminder = useUpdateLeadReminder(clientId);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dateTime, setDateTime] = useState<string>(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return formatLocalDateTime(d);
  });
  const [selectedShortcutIndex, setSelectedShortcutIndex] = useState<number | null>(null);
  const [assignedToUid, setAssignedToUid] = useState<string>("me");

  const shortcuts = useMemo(() => getShortcutDates(), [open]);

  useEffect(() => {
    if (open) {
      if (initialReminder) {
        setTitle(initialReminder.title);
        setNotes(initialReminder.notes || "");
        setDateTime(formatLocalDateTime(new Date(initialReminder.remindAt)));
        setSelectedShortcutIndex(null);
        setAssignedToUid(initialReminder.assignedToUid || "me");
      } else {
        setTitle("");
        setNotes("");
        const defaultDate = new Date(Date.now() + 60 * 60 * 1000);
        setDateTime(formatLocalDateTime(defaultDate));
        setSelectedShortcutIndex(null);
        setAssignedToUid("me");
      }
    }
  }, [open, initialReminder, lead?.phone]);

  const leadName = lead?.nome || "Lead";
  const rawPhone = lead?.phone || "";

  const handleShortcutClick = (index: number, date: Date) => {
    setSelectedShortcutIndex(index);
    setDateTime(formatLocalDateTime(date));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast({
        title: "Título obrigatório",
        description: "Informe um título ou motivo para o lembrete.",
        variant: "destructive",
      });
      return;
    }

    if (!dateTime) {
      toast({
        title: "Data e hora obrigatórias",
        description: "Escolha o momento do lembrete.",
        variant: "destructive",
      });
      return;
    }

    const d = new Date(dateTime);
    if (isNaN(d.getTime())) {
      toast({
        title: "Data inválida",
        description: "A data e hora informadas não são válidas.",
        variant: "destructive",
      });
      return;
    }

    let targetUid: string | null = null;
    let targetName: string | null = null;

    if (assignedToUid === "me" || !assignedToUid) {
      targetUid = user?.uid || null;
      targetName = user?.displayName || user?.email || "Você";
    } else {
      targetUid = assignedToUid;
      const found = operatorOptions.find((op) => op.uid === assignedToUid);
      targetName = found?.displayName || found?.email || null;
    }

    try {
      if (initialReminder) {
        await updateReminder.mutateAsync({
          id: initialReminder.id,
          clientId: clientId || undefined,
          title: title.trim(),
          notes: notes.trim() || null,
          remindAt: d.toISOString(),
          assignedToUid: targetUid,
          assignedToName: targetName,
        });

        toast({
          title: "Lembrete atualizado",
          description: "O lembrete pessoal foi alterado com sucesso.",
        });
      } else {
        await createReminder.mutateAsync({
          clientId: clientId || undefined,
          leadId: lead?.id,
          phone: rawPhone,
          leadName,
          title: title.trim(),
          notes: notes.trim() || null,
          remindAt: d.toISOString(),
          assignedToUid: targetUid,
          assignedToName: targetName,
        });

        toast({
          title: "Lembrete criado",
          description: "O lembrete pessoal foi registrado com sucesso.",
        });
      }

      onOpenChange(false);
    } catch (err) {
      toast({
        title: initialReminder ? "Erro ao atualizar lembrete" : "Erro ao criar lembrete",
        description: err instanceof Error ? err.message : "Falha ao gravar lembrete.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                {initialReminder ? "Editar Lembrete Pessoal" : "Criar Lembrete Pessoal"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Para <strong>{leadName}</strong> ({rawPhone})
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Aviso de Não-Disparo */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <span>
            <strong>Lembrete interno da equipe.</strong> Nenhuma mensagem ou disparo será enviado para o cliente.
          </span>
        </div>

        <div className="space-y-3.5 py-1">
          {/* Título do Lembrete */}
          <div className="space-y-1.5">
            <Label htmlFor="reminder-title" className="text-xs font-semibold">
              O que você precisa lembrar? *
            </Label>
            <Input
              id="reminder-title"
              placeholder="Ex.: Ligar para cobrar retorno da proposta comercial"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-xs rounded-xl"
              autoFocus
            />
          </div>

          {/* Anotações Adicionais */}
          <div className="space-y-1.5">
            <Label htmlFor="reminder-notes" className="text-xs font-medium text-muted-foreground">
              Observações (opcional)
            </Label>
            <Textarea
              id="reminder-notes"
              placeholder="Detalhes adicionais, tópicos para falar ou links úteis..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-xs resize-none rounded-xl h-18"
            />
          </div>

          {/* Atalhos Rápidos de Horário */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary" />
              Quando você quer ser lembrado?
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {shortcuts.map((shortcut, idx) => {
                const isSelected = selectedShortcutIndex === idx;
                return (
                  <Button
                    key={shortcut.label}
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleShortcutClick(idx, shortcut.date)}
                    className="h-7 text-[11px] rounded-lg px-2.5"
                  >
                    {shortcut.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Data e Hora Exata */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Input
                type="datetime-local"
                value={dateTime}
                onChange={(e) => {
                  setDateTime(e.target.value);
                  setSelectedShortcutIndex(null);
                }}
                className="text-xs rounded-xl h-8"
              />
            </div>
          </div>

          {/* Para quem é o lembrete */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-primary" />
              Responsável pelo lembrete
            </Label>
            <Select value={assignedToUid} onValueChange={setAssignedToUid}>
              <SelectTrigger className="text-xs rounded-xl h-8">
                <SelectValue placeholder="Selecione o responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="me" className="text-xs font-medium">
                  Para mim ({user?.displayName || user?.email || "Você"})
                </SelectItem>
                {operatorOptions
                  .filter((op) => op.uid !== user?.uid)
                  .map((op) => (
                    <SelectItem key={op.uid} value={op.uid} className="text-xs">
                      {op.displayName || op.email || op.uid}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
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
            disabled={createReminder.isPending || updateReminder.isPending || !title.trim() || !dateTime}
            onClick={handleSave}
            className="bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1.5 shadow-sm"
          >
            {createReminder.isPending || updateReminder.isPending
              ? "Salvando..."
              : initialReminder
              ? "Salvar Alterações"
              : "Salvar Lembrete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateLeadReminderModal;
