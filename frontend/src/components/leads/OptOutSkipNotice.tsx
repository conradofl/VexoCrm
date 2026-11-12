import { Ban } from "lucide-react";
import { cn } from "@/lib/utils";

export type OptOutSkipNoticeContext = "publico" | "lote";

/**
 * Texto do aviso. O total da lista NÃO muda: quem pediu para sair continua na lista e é pulado no envio.
 * Devolve null quando não há o que avisar (zero) ou quando o servidor não soube contar (null/undefined).
 */
export function optOutSkipNoticeText(count: number | null | undefined, context: OptOutSkipNoticeContext = "publico"): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return null;
  const n = count.toLocaleString("pt-BR");
  if (context === "lote") {
    return count === 1
      ? "1 dos não processados pediu para não receber mensagens e será pulado no envio."
      : `${n} dos não processados pediram para não receber mensagens e serão pulados no envio.`;
  }
  return count === 1
    ? "1 lead deste público pediu para não receber mensagens e será pulado no envio. O total não muda."
    : `${n} leads deste público pediram para não receber mensagens e serão pulados no envio. O total não muda.`;
}

interface OptOutSkipNoticeProps {
  count: number | null | undefined;
  context?: OptOutSkipNoticeContext;
  className?: string;
}

/** Linha separada de aviso de opt-out na prévia e na contagem de público. Não renderiza nada sem o que avisar. */
export function OptOutSkipNotice({ count, context = "publico", className }: OptOutSkipNoticeProps) {
  const text = optOutSkipNoticeText(count, context);
  if (!text) return null;
  return (
    <div
      role="note"
      data-testid="optout-skip-notice"
      className={cn("flex items-start gap-1.5 text-xs text-rose-700 dark:text-rose-300 bg-rose-500/5", className)}
    >
      <Ban className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
