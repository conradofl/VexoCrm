import { useCallback, useRef, useState } from "react";
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
import type { OutsideSendWindowDetails } from "@/lib/dispatchTrigger";

const DAY_LABELS: Record<string, string> = { mon: "seg", tue: "ter", wed: "qua", thu: "qui", fri: "sex", sat: "sáb", sun: "dom" };

export function describeSendWindowDays(days: string[]) {
  return days.map((d) => DAY_LABELS[d] || d).join(", ");
}

/**
 * "Disparar Agora" fora da janela de envio: diz a janela e a hora atual e só envia com confirmação explícita.
 * O botão que dizia "Agora" ignorava a regra calado e criou o chamado de 30/10/2026 (lote saiu 18:38, janela até 18:30).
 */
export function OutsideSendWindowDialog({
  details,
  onForce,
  onCancel,
}: {
  details: OutsideSendWindowDetails | null;
  onForce: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={!!details} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent data-testid="outside-send-window-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Fora da janela de envio</AlertDialogTitle>
          {details && (
            <AlertDialogDescription data-testid="outside-send-window-text">
              Agora são {details.localTime} ({details.timezone}). A janela deste cliente é das {details.start} às{" "}
              {details.end}, em {describeSendWindowDays(details.days)}. A próxima abertura é {details.nextOpeningLocal}.
              Se disparar agora, as mensagens saem fora do horário combinado, e o disparo fica registrado como forçado.
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="outside-send-window-cancel" onClick={onCancel}>
            Não disparar
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="outside-send-window-force"
            onClick={onForce}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Disparar fora da janela
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** askToForce(details) abre o diálogo e resolve true só se a pessoa clicar "Disparar fora da janela". */
export function useOutsideSendWindowConfirm() {
  const [details, setDetails] = useState<OutsideSendWindowDetails | null>(null);
  const resolver = useRef<((force: boolean) => void) | null>(null);

  const settle = useCallback((force: boolean) => {
    resolver.current?.(force);
    resolver.current = null;
    setDetails(null);
  }, []);

  const askToForce = useCallback((next: OutsideSendWindowDetails) => {
    resolver.current?.(false);
    setDetails(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const outsideWindowDialog = (
    <OutsideSendWindowDialog details={details} onForce={() => settle(true)} onCancel={() => settle(false)} />
  );

  return { askToForce, outsideWindowDialog };
}
