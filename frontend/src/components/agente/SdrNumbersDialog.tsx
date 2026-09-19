// frontend/src/components/agente/SdrNumbersDialog.tsx
//
// "O Editar lista para de jogar o usuário na tela velha" — diálogo inline no
// passo 5 do agente, reaproveitando o MESMO endpoint que Padrões da empresa
// já usa (sdr_whatsapp_numbers via useUpdateLeadClientN8nSettings). Sem
// rota nova, sem validação de telefone reinventada — o mesmo regex de
// TabGeral.tsx.

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateLeadClientN8nSettings } from "@/hooks/useLeadClients";
import { toast } from "@/components/ui/use-toast";

// Mesmo critério do backend (services/sdrTarget.js: isValidSdrNumber) — só
// dígitos, 10 a 15, pro mesmo número ser aceito nos dois lados.
const SDR_NUMBER_REGEX = /^\d{10,15}$/;

interface SdrNumbersDialogProps {
  tenantId: string;
  numbers: string[];
}

export function SdrNumbersDialog({ tenantId, numbers }: SdrNumbersDialogProps) {
  const [open, setOpen] = useState(false);
  const [localNumbers, setLocalNumbers] = useState<string[]>(numbers);
  const [newNumber, setNewNumber] = useState("");
  const updateSettings = useUpdateLeadClientN8nSettings();

  const handleOpenChange = (next: boolean) => {
    if (next) setLocalNumbers(numbers); // reabrir sempre parte da lista de verdade, não da última edição não salva
    setNewNumber("");
    setOpen(next);
  };

  const numeroValido = SDR_NUMBER_REGEX.test(newNumber.replace(/\D/g, ""));

  const salvar = async (proxima: string[]) => {
    try {
      await updateSettings.mutateAsync({ tenantId, sdrWhatsappNumbers: proxima });
      setLocalNumbers(proxima);
      toast({ title: "Lista de SDR atualizada" });
    } catch (err: any) {
      toast({ title: "Erro ao salvar a lista", description: err?.message, variant: "destructive" });
    }
  };

  const adicionar = () => {
    const numero = newNumber.replace(/\D/g, "");
    if (!numeroValido || localNumbers.includes(numero)) return;
    setNewNumber("");
    void salvar([...localNumbers, numero]);
  };

  const remover = (numero: string) => {
    void salvar(localNumbers.filter((n) => n !== numero));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Editar lista
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Números que recebem a qualificação</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Esta lista vale para todos os agentes deste tenant, e também para os disparos — não é
            uma lista por agente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {localNumbers.length > 0 ? (
            <div className="space-y-1.5">
              {localNumbers.map((numero) => (
                <div
                  key={numero}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-800/50"
                >
                  <span className="text-xs font-mono text-slate-700 dark:text-slate-200">{numero}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                    onClick={() => remover(numero)}
                    disabled={updateSettings.isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Nenhum número cadastrado — ninguém recebe a qualificação.
            </p>
          )}

          <div className="flex gap-2">
            <Input
              placeholder="5511999999999"
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") adicionar();
              }}
              className="h-9 text-xs font-mono"
              disabled={updateSettings.isPending}
            />
            <Button
              variant="outline"
              size="sm"
              aria-label="Adicionar número"
              className="shrink-0 h-9 text-xs font-semibold"
              onClick={adicionar}
              disabled={updateSettings.isPending || !numeroValido}
            >
              {updateSettings.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {newNumber !== "" && !numeroValido && (
            <p className="text-[10px] text-rose-500">Número inválido: só dígitos, de 10 a 15.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} className="h-8 text-xs">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
