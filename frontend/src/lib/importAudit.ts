// Relatório & Auditoria de planilha: o que cada número CONTA. A tela mistura duas coisas que não são a mesma:
//   - o ARQUIVO: linhas (o que veio no arquivo), contatos válidos (telefones únicos utilizáveis), linhas
//     repetidas (mesmo telefone de uma linha anterior) e linhas descartadas (sem telefone utilizável);
//   - os CONTATOS: o que cada telefone válido recebeu. "Receberam" = este telefone recebeu mensagem (de qualquer
//     campanha), não "esta planilha disparou para ele" — um contato em duas planilhas aparece como recebido nas duas.
// Todo número daqui fecha com o total: linhas = contatos + repetidas + descartadas; contatos = receberam + falharam
// + ainda vão receber.

export type DeliveryState =
  | "sem_telefone_valido"
  | "enviado_por_esta_planilha"
  | "enviado_por_outra_campanha"
  | "falhou"
  | "pendente";

export const DELIVERY_STATE_LABELS: Record<DeliveryState, string> = {
  sem_telefone_valido: "Sem telefone válido",
  enviado_por_esta_planilha: "Recebeu (campanha desta planilha)",
  enviado_por_outra_campanha: "Recebeu (outra campanha)",
  falhou: "Falhou",
  pendente: "Ainda vai receber",
};

export interface ImportAuditRow {
  imported: boolean;
  delivery_state: DeliveryState;
  duplicate_of_row?: number | null;
  has_replied: boolean;
  skip_reason?: string | null;
}

export interface ImportAuditStats {
  /** linhas do arquivo (o que o arquivo trouxe, já sem o cabeçalho) */
  fileRows: number;
  /** telefones únicos utilizáveis */
  validContacts: number;
  /** linhas com o mesmo telefone de uma linha anterior (contam uma vez, em "contatos válidos") */
  repeatedRows: number;
  /** linhas sem telefone utilizável (têm motivo; não são "pendentes") */
  discardedRows: number;
  /** das linhas descartadas, quantas por motivo */
  discardedByReason: Array<{ reason: string; count: number }>;
  /** contatos que receberam mensagem de qualquer campanha */
  received: number;
  receivedByThisImport: number;
  receivedByOther: number;
  failed: number;
  /** ainda vão receber */
  pending: number;
  replied: number;
  /** linhas = contatos + repetidas + descartadas */
  fileCloses: boolean;
  /** contatos = receberam + falharam + ainda vão receber */
  contactsClose: boolean;
}

const isDiscarded = (r: ImportAuditRow) => !r.imported || r.delivery_state === "sem_telefone_valido";

export function computeImportAuditStats(rows: readonly ImportAuditRow[]): ImportAuditStats {
  const discarded = rows.filter(isDiscarded);
  const repeated = rows.filter((r) => !isDiscarded(r) && r.duplicate_of_row != null);
  const contacts = rows.filter((r) => !isDiscarded(r) && r.duplicate_of_row == null);

  const reasons = new Map<string, number>();
  for (const r of discarded) {
    const reason = r.skip_reason || "Telefone ausente ou inválido";
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }

  const receivedByThisImport = contacts.filter((r) => r.delivery_state === "enviado_por_esta_planilha").length;
  const receivedByOther = contacts.filter((r) => r.delivery_state === "enviado_por_outra_campanha").length;
  const received = receivedByThisImport + receivedByOther;
  const failed = contacts.filter((r) => r.delivery_state === "falhou").length;
  const pending = contacts.filter((r) => r.delivery_state === "pendente").length;

  return {
    fileRows: rows.length,
    validContacts: contacts.length,
    repeatedRows: repeated.length,
    discardedRows: discarded.length,
    discardedByReason: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    received,
    receivedByThisImport,
    receivedByOther,
    failed,
    pending,
    replied: contacts.filter((r) => r.has_replied).length,
    fileCloses: rows.length === contacts.length + repeated.length + discarded.length,
    contactsClose: contacts.length === received + failed + pending,
  };
}

export interface LegacyDispatchCampaign {
  id: string;
  name: string;
}

/** O aviso de acompanhamento indisponível, quando há campanha desta planilha disparada pelo caminho legado. */
export function legacyTrackingNotice(campaigns: readonly LegacyDispatchCampaign[]): string | null {
  if (campaigns.length === 0) return null;
  const nomes = campaigns.map((c) => `"${c.name}"`).join(", ");
  const quais = campaigns.length === 1 ? `a campanha ${nomes}` : `as campanhas ${nomes}`;
  return `Acompanhamento indisponível para ${quais}: foi disparada pelo caminho antigo, que não registra os envios. Os contatos podem ter recebido e aparecer abaixo como "${DELIVERY_STATE_LABELS.pendente}".`;
}
