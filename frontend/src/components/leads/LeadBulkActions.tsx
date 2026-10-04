import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MassDeleteDialog } from "@/components/leads/MassDeleteDialog";

interface LeadBulkActionsProps {
  clientId: string;
  /** Só gestor/administrador (a mesma regra do servidor). Sem permissão: nada é renderizado. */
  canManage: boolean;
}

/**
 * Exclusão em massa de leads por tag, com o seu diálogo. Visualmente discreta de propósito (contorno, sem
 * preenchimento, cor neutra): apagar vinte mil leads não pode parecer um botão como os de criar.
 */
export function LeadBulkActions({ clientId, canManage }: LeadBulkActionsProps) {
  const [massDeleteOpen, setMassDeleteOpen] = useState(false);

  if (!canManage) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        data-testid="btn-mass-delete-by-tag"
        onClick={() => setMassDeleteOpen(true)}
        className="gap-2 border-dashed text-xs font-normal text-muted-foreground hover:border-rose-500/50 hover:bg-transparent hover:text-rose-700 dark:hover:text-rose-300"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Excluir leads por tag…
      </Button>
      <MassDeleteDialog open={massDeleteOpen} onOpenChange={setMassDeleteOpen} clientId={clientId} />
    </>
  );
}
