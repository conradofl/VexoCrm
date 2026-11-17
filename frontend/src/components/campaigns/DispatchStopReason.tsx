import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DispatchQueueBlock } from "@/hooks/useCampanhas";
import { formatDateTime } from "@/lib/leadImports/spreadsheet";

/**
 * Por que o lote não está enviando. Regra (16/11/2026, lote da Nous parado com 8 "Pendente na fila" e nada na tela): todo
 * caminho do motor que não envia grava error_message, e a tela mostra esse texto no cartão do lote e nos destinatários.
 * null = nada a dizer (rodando, concluído sem aviso, ou sem motivo gravado num estado que não é de parada).
 */
export function describeDispatchStop(status: string | null | undefined, errorMessage: string | null | undefined): string | null {
  const msg = (errorMessage || "").trim();
  if (status === "running") return null;
  if (status === "failed") return msg || "O lote falhou e o motor não registrou o motivo.";
  if (status === "paused" || status === "interrupted" || status === "scheduled" || status === "draft") return msg || null;
  // done com aviso (ex.: "Chip configurado não encontrado. Enviando por X.") não é parada: não aparece como motivo.
  return null;
}

/**
 * O texto da linha do destinatário que ainda não foi processado: a primeira frase do motivo (o que aconteceu). O texto
 * inteiro, com o que fazer, fica no aviso do topo do diálogo — repetido em cada linha ele não cabe no celular.
 */
export function describePendingRecipient(status: string | null | undefined, errorMessage: string | null | undefined): string {
  if (status === "running") return "Na fila de envio (lote rodando)";
  const motivo = describeDispatchStop(status, errorMessage);
  if (!motivo) return "Pendente na fila";
  const primeira = motivo.split(/(?<=[.;])\s+/)[0].replace(/[.;]$/, "");
  return primeira || motivo;
}

export function DispatchStopNotice({
  status,
  errorMessage,
  className,
  testId = "dispatch-stop-notice",
}: {
  status: string | null | undefined;
  errorMessage: string | null | undefined;
  className?: string;
  testId?: string;
}) {
  const text = describeDispatchStop(status, errorMessage);
  if (!text) return null;
  const isFailure = status === "failed";
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-medium",
        isFailure
          ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
        className
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}

/** Fila de resposta parada por chip fora do ar (nova tentativa espaçada no backend). */
export function QueueBlockNotice({ block, className }: { block: DispatchQueueBlock | null | undefined; className?: string }) {
  if (!block) return null;
  return (
    <div
      role="status"
      data-testid="queue-block-notice"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
        className
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">
        {block.message} Próxima tentativa: {formatDateTime(block.retryAfter)}.
      </span>
    </div>
  );
}
