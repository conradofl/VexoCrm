import type { ImportCounts } from "@/lib/leadImports/importCounts";

/** As quatro contagens da planilha antes de confirmar — linhas, contatos diferentes, repetidos no arquivo, sem telefone. */
export function ImportCountsSummary({ counts }: { counts: ImportCounts }) {
  const fmt = (n: number) => n.toLocaleString("pt-BR");
  return (
    <div data-testid="import-counts-summary" className="rounded border border-border bg-background/60 p-2 space-y-0.5 text-xs">
      <p data-testid="import-counts-rows">
        <strong>{fmt(counts.totalRows)}</strong> linhas na planilha
      </p>
      <p data-testid="import-counts-distinct" className="font-medium text-emerald-600 dark:text-emerald-400">
        <strong>{fmt(counts.distinctContacts)}</strong> contatos diferentes
      </p>
      <p data-testid="import-counts-repeated">
        <strong>{fmt(counts.repeatedInFile)}</strong> repetidos dentro da própria planilha (serão importados uma vez só)
      </p>
      <p data-testid="import-counts-without-phone" className={counts.withoutValidPhone > 0 ? "text-amber-600 dark:text-amber-400" : ""}>
        <strong>{fmt(counts.withoutValidPhone)}</strong> sem telefone válido
      </p>
    </div>
  );
}
