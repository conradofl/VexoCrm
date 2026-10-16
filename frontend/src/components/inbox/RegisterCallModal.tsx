// frontend/src/components/inbox/RegisterCallModal.tsx
// Modal de Registro Rápido de Ligação Telefônica (Bloco C)

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateLeadReminder } from "@/hooks/useLeadReminders";
import { PhoneCall, Phone, PhoneOff, PhoneMissed, Voicemail, Check } from "lucide-react";

interface RegisterCallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: {
    id?: string;
    nome?: string;
    phone: string;
  } | null;
  clientId: string | null;
}

const CALL_STATUS_OPTIONS = [
  {
    key: "answered",
    label: "Atendeu",
    description: "Conversou com o lead",
    icon: Phone,
    colorClass: "hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300/50",
    activeClass: "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700",
  },
  {
    key: "no_answer",
    label: "Não Atendeu",
    description: "Chama até cair",
    icon: PhoneMissed,
    colorClass: "hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300/50",
    activeClass: "bg-amber-600 text-white border-amber-600 hover:bg-amber-700",
  },
  {
    key: "busy",
    label: "Ocupado",
    description: "Linha ocupada / rejeitou",
    icon: PhoneOff,
    colorClass: "hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-300/50",
    activeClass: "bg-rose-600 text-white border-rose-600 hover:bg-rose-700",
  },
  {
    key: "voicemail",
    label: "Deixou Recado",
    description: "Secretária eletrônica / caixa postal",
    icon: Voicemail,
    colorClass: "hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300/50",
    activeClass: "bg-blue-600 text-white border-blue-600 hover:bg-blue-700",
  },
];

export function RegisterCallModal({
  open,
  onOpenChange,
  lead,
  clientId,
}: RegisterCallModalProps) {
  const { user } = useAuth();
  const createReminder = useCreateLeadReminder(clientId);

  const [selectedStatus, setSelectedStatus] = useState<string>("answered");
  const [notes, setNotes] = useState("");

  const handleSaveCall = async (statusOverride?: string) => {
    if (!lead?.phone) {
      toast.error("Telefone do lead é obrigatório.");
      return;
    }

    const finalStatus = statusOverride || selectedStatus;
    const statusObj = CALL_STATUS_OPTIONS.find((s) => s.key === finalStatus);
    const statusLabel = statusObj?.label || finalStatus;

    try {
      await createReminder.mutateAsync({
        clientId: clientId || undefined,
        leadId: lead.id || null,
        phone: lead.phone,
        leadName: lead.nome || "Lead",
        title: `Ligação: ${statusLabel}`,
        notes: notes.trim() || `Ligação registrada como "${statusLabel}".`,
        remindAt: new Date().toISOString(),
        assignedToUid: user?.uid || null,
        assignedToName: user?.displayName || user?.email || null,
        activityType: "call",
        callStatus: finalStatus,
        status: "completed",
      });

      toast.success(`Ligação registrada (${statusLabel})!`);
      setNotes("");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Falha ao registrar ligação.");
    }
  };

  const isSaving = createReminder.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <PhoneCall className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">Registrar Ligação Telefônica</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Selecione o desfecho da tentativa de contato com {lead?.nome || "o lead"}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3.5 py-1 text-xs">
          {/* Escolha rápida de status com botões de 1 clique */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Desfecho da Chamada</Label>
            <div className="grid grid-cols-2 gap-2">
              {CALL_STATUS_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = selectedStatus === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setSelectedStatus(opt.key)}
                    className={`flex flex-col items-start p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                      isSelected ? opt.activeClass : `bg-background ${opt.colorClass}`
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <Icon className="h-4 w-4" />
                        <span>{opt.label}</span>
                      </div>
                      {isSelected && <Check className="h-3.5 w-3.5" />}
                    </div>
                    <span className="text-[10px] opacity-80 mt-0.5">{opt.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notas opcionais */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Resumo da Conversa (opcional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="O lead pediu para ligar mais tarde? Qual foi o combinado?"
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
            variant="default"
            size="sm"
            onClick={() => handleSaveCall()}
            disabled={isSaving}
            className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-1.5 shadow-xs"
          >
            <Check className="h-3.5 w-3.5" />
            Salvar Ligação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
