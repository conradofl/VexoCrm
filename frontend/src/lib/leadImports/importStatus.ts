import type { LeadImportItem } from "@/hooks/useLeadImports";
import type { ImportProgress } from "@/lib/leadImports/batchedImport";

/** Planilha aberta e ainda sem fechamento. Servidor antigo (sem o campo) = completa: nada do histórico muda. */
export function isImportIncomplete(imp: Pick<LeadImportItem, "status">): boolean {
  return imp.status === "incomplete";
}

const nf = (n: number) => n.toLocaleString("pt-BR");

/** "Incompleta — entraram 7.000 de 20.000 linhas (faltam 13.000)". */
export function describeIncompleteImport(imp: Pick<LeadImportItem, "expected_rows" | "received_offset">): string {
  const expected = imp.expected_rows ?? 0;
  const received = Math.min(imp.received_offset ?? 0, expected || imp.received_offset || 0);
  if (!expected) return "Incompleta — importação interrompida";
  return `Incompleta — entraram ${nf(received)} de ${nf(expected)} linhas (faltam ${nf(Math.max(expected - received, 0))})`;
}

export function describeImportProgress(p: ImportProgress): string {
  if (p.phase === "opening") return "Abrindo a importação…";
  if (p.phase === "closing") return "Concluindo a importação…";
  if (p.phase === "done") return `Importação concluída: ${nf(p.totalRows)} linhas`;
  return `Enviando lote ${nf(p.batch)} de ${nf(p.batches)} — ${nf(p.sentRows)} de ${nf(p.totalRows)} linhas`;
}

export function importProgressPercent(p: ImportProgress): number {
  if (p.totalRows <= 0) return 0;
  if (p.phase === "done") return 100;
  return Math.min(Math.round((p.sentRows / p.totalRows) * 100), 99);
}
