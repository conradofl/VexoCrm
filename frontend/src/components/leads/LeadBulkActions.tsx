import { useState } from "react";
import { Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MassDeleteDialog } from "@/components/leads/MassDeleteDialog";
import { OriginFixDialog } from "@/components/leads/OriginFixDialog";

interface LeadBulkActionsProps {
  clientId: string;
  /** Só gestor/administrador (a mesma regra do servidor). Sem permissão: nada é renderizado. */
  canManage: boolean;
}

/** Ações em massa do Banco de Dados — excluir por tag e corrigir a origem "Instagram Direct" — e seus diálogos. */
export function LeadBulkActions({ clientId, canManage }: LeadBulkActionsProps) {
  const [massDeleteOpen, setMassDeleteOpen] = useState(false);
  const [originFixOpen, setOriginFixOpen] = useState(false);

  if (!canManage) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        data-testid="btn-mass-delete-by-tag"
        onClick={() => setMassDeleteOpen(true)}
        className="gap-2 text-xs border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Excluir por tag
      </Button>
      <Button variant="outline" size="sm" data-testid="btn-origin-fix" onClick={() => setOriginFixOpen(true)} className="gap-2 text-xs">
        <Wrench className="w-3.5 h-3.5" />
        Corrigir origem "Instagram Direct"
      </Button>
      <MassDeleteDialog open={massDeleteOpen} onOpenChange={setMassDeleteOpen} clientId={clientId} />
      <OriginFixDialog open={originFixOpen} onOpenChange={setOriginFixOpen} clientId={clientId} />
    </>
  );
}
