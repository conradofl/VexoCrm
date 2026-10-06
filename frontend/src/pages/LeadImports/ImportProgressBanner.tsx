import { Loader2 } from "lucide-react";
import type { ImportProgress } from "@/lib/leadImports/batchedImport";
import { describeImportProgress, importProgressPercent } from "@/lib/leadImports/importStatus";

interface ImportProgressBannerProps {
  progress: ImportProgress | null;
  /** Nome do arquivo em andamento (opcional). */
  fileName?: string | null;
}

/** Barra de progresso do envio em lotes. Some quando não há importação em andamento. */
export function ImportProgressBanner({ progress, fileName }: ImportProgressBannerProps) {
  if (!progress) return null;
  const percent = importProgressPercent(progress);
  return (
    <div role="status" aria-live="polite" data-testid="import-progress" className="rounded-xl border border-indigo-200/70 bg-indigo-50/40 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/20 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500 shrink-0" />
        <span className="truncate" data-testid="import-progress-text">
          {fileName ? `${fileName}: ` : ""}
          {describeImportProgress(progress)}
        </span>
        <span className="ml-auto tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-white/10 overflow-hidden" aria-hidden="true">
        <div className="h-full rounded-full bg-indigo-500 transition-all duration-200" style={{ width: `${percent}%` }} data-testid="import-progress-bar" />
      </div>
      <p className="text-[11px] text-muted-foreground">Não feche esta aba até terminar. Se a conexão cair, a planilha fica salva como incompleta e você retoma de onde parou.</p>
    </div>
  );
}
