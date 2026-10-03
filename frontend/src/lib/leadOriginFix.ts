// Regras puras da tela de correção da origem "Instagram Direct" (importador de planilha). A confirmação
// (número digitado acima do limite) é a MESMA da exclusão em massa — vem de lib/leadMassDelete.

export { TYPED_CONFIRMATION_THRESHOLD, canConfirmMassDelete as canConfirmOriginFix, requiresTypedConfirmation } from "@/lib/leadMassDelete";

export interface OriginFixPreview {
  total: number;
  withImportId: number;
  onlyImportTag: number;
  undeterminable: number;
  correctable: number;
  instagramImporterUntouched: number;
  willSet: { origem: string; origemMarketing: string; leadSource: string; removeTag: string };
  confirmation: { typedRequired: boolean; threshold: number };
}

export interface OriginFixReport {
  corrected: number;
  correctedWithImportId: number;
  correctedOnlyImportTag: number;
  leftUndeterminable: number;
  leftInstagramImporter: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Frase de confirmação, com o número dentro dela. */
export function originFixSentence(count: number, willSet: OriginFixPreview["willSet"]): string {
  return `Você vai corrigir a origem de ${plural(count, "lead", "leads")}: de "${willSet.removeTag}" para "${willSet.origem}", e a tag "${willSet.removeTag}" sai deles.`;
}

/** Relatório depois de corrigir: quantos, por grupo, e o que ficou sem tocar (e por quê). */
export function originFixReportLines(r: OriginFixReport): string[] {
  const lines = [
    `Corrigidos: ${plural(r.corrected, "lead", "leads")} (${r.correctedWithImportId} com identificador de importação, ${r.correctedOnlyImportTag} só pela tag de importação).`,
  ];
  const untouched: string[] = [];
  if (r.leftUndeterminable > 0) untouched.push(`${plural(r.leftUndeterminable, "lead", "leads")} indeterminável(is) — não dá para saber se vieram de planilha`);
  if (r.leftInstagramImporter > 0) untouched.push(`${plural(r.leftInstagramImporter, "lead", "leads")} do importador de Instagram — a origem é verdadeira`);
  lines.push(untouched.length === 0 ? "Não tocados: nenhum." : `Não tocados: ${untouched.join("; ")}.`);
  return lines;
}
