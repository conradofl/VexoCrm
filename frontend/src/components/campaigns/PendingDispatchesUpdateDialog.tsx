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

/**
 * Editou uma campanha que tem lotes ainda não disparados: eles guardam as mensagens da versão anterior.
 * Pergunta "atualizar ou manter" — padrão atualizar (decisão do dono, 22/10/2026), e só lotes não disparados.
 */
export function PendingDispatchesUpdateDialog({
  open,
  count,
  isUpdating = false,
  onUpdate,
  onKeep,
}: {
  open: boolean;
  count: number;
  isUpdating?: boolean;
  onUpdate: () => void;
  onKeep: () => void;
}) {
  const lotes = count === 1 ? "1 lote ainda não disparado" : `${count} lotes ainda não disparados`;
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onKeep(); }}>
      <AlertDialogContent data-testid="pending-dispatches-update-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Atualizar os lotes pendentes?</AlertDialogTitle>
          <AlertDialogDescription data-testid="pending-dispatches-update-text">
            Esta campanha tem {lotes} com as mensagens da versão anterior. Atualizar faz eles saírem com esta versão.
            Lotes que já começaram a enviar não mudam.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="pending-dispatches-keep" onClick={onKeep} disabled={isUpdating}>
            Manter a versão anterior
          </AlertDialogCancel>
          <AlertDialogAction data-testid="pending-dispatches-update" onClick={onUpdate} disabled={isUpdating} autoFocus>
            {isUpdating ? "Atualizando…" : "Atualizar para esta versão"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
