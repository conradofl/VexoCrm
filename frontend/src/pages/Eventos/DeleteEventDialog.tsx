import React from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EventoItem, useDeleteEvento } from "@/hooks/useEventos";

interface DeleteEventDialogProps {
  evento: EventoItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: string;
}

export const DeleteEventDialog: React.FC<DeleteEventDialogProps> = ({
  evento,
  open,
  onOpenChange,
  clientId,
}) => {
  const deleteMutation = useDeleteEvento();

  const handleDelete = async () => {
    if (!evento) return;
    try {
      await deleteMutation.mutateAsync({ id: evento.id, clientId });
      toast.success(`Evento "${evento.name}" excluído com sucesso.`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir evento.");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir Evento?</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza de que deseja excluir o evento{" "}
            <strong>"{evento?.name}"</strong>? Esta ação removerá a projeção do evento no calendário unificado e desativará os gatilhos das esteiras associadas.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMutation.isPending ? "Excluindo..." : "Excluir Evento"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
