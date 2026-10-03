// Regras puras da exclusão em massa de leads (o que a tela mostra e quando libera o botão).
// O servidor repete cada regra — a tela só evita que o usuário chegue a um "não" óbvio.

export const TYPED_CONFIRMATION_THRESHOLD = 500;

export interface MassDeletePreview {
  matched: number;
  multiImport: number;
  withMessages: number;
  both: number;
  willDelete: number;
  kept: number;
  keptReasons: { multiImport: number; withMessages: number; both: number };
  confirmation: { typedRequired: boolean; threshold: number };
}

export interface MassDeleteOptions {
  includeMultiImport: boolean;
  includeWithMessages: boolean;
}

export interface MassDeleteReport {
  matched: number;
  deleted: number;
  kept: number;
  keptReasons: { multiImport: number; withMessages: number; both: number };
  options: MassDeleteOptions;
  criterion: { type: string; value: string };
}

export const DEFAULT_MASS_DELETE_OPTIONS: MassDeleteOptions = {
  includeMultiImport: false,
  includeWithMessages: false,
};

/** Acima do limite exige digitar o número; no limite ou abaixo, confirmação comum. */
export function requiresTypedConfirmation(willDelete: number): boolean {
  return willDelete > TYPED_CONFIRMATION_THRESHOLD;
}

/** O botão de confirmar só libera quando há o que apagar e, se exigido, o número digitado bate. */
export function canConfirmMassDelete(willDelete: number, typed: string): boolean {
  if (!Number.isInteger(willDelete) || willDelete <= 0) return false;
  if (!requiresTypedConfirmation(willDelete)) return true;
  return /^\d+$/.test(typed.trim()) && Number(typed.trim()) === willDelete;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Você vai apagar 12 leads com a tag "X"." — o número sempre dentro da frase de confirmação. */
export function confirmationSentence(willDelete: number, tag: string): string {
  return `Você vai apagar ${plural(willDelete, "lead", "leads")} com a tag "${tag}". Isso não pode ser desfeito.`;
}

/** Relatório depois de apagar: quantos saíram, quantos ficaram e por qual motivo cada grupo. */
export function reportLines(report: MassDeleteReport): string[] {
  const lines = [`Apagados: ${plural(report.deleted, "lead", "leads")}.`];
  if (report.kept === 0) {
    lines.push("Mantidos: nenhum.");
    return lines;
  }
  lines.push(`Mantidos: ${plural(report.kept, "lead", "leads")}.`);
  const { multiImport, withMessages, both } = report.keptReasons;
  if (multiImport > 0) lines.push(`${plural(multiImport, "lead", "leads")} por estar em mais de uma importação.`);
  if (withMessages > 0) lines.push(`${plural(withMessages, "lead", "leads")} por já ter trocado mensagem.`);
  if (both > 0) lines.push(`${plural(both, "lead", "leads")} por ambos os motivos.`);
  return lines;
}

/** Mesma regra do servidor (isManagerOrAdmin): apagar leads em massa é decisão de gestor/admin. */
export function canMassDeleteLeads(access: {
  isAdminUser: boolean;
  approvalLevel?: string | null;
  canAccessUsersPage: boolean;
}): boolean {
  return (
    access.isAdminUser ||
    access.canAccessUsersPage ||
    access.approvalLevel === "manager" ||
    access.approvalLevel === "director"
  );
}
