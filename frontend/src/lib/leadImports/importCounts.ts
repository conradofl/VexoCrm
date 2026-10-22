// Contagens da importação de planilha, na linguagem que o dono entende.
//
// Medido em 22/10/2026 (EXTRAÇÃO DE CONTATOS - SPAZIO2.xlsx): 351 linhas, 274 telefones distintos, 77 repetidos.
// A importação estava certa (um telefone = um contato), mas a tela dizia "351 contatos válidos" antes e "274 leads de
// 351 linhas" depois — e o dono achou que tinha perdido 77 contatos. As repetições DENTRO do arquivo nunca apareciam.
//
// A chave de "contato diferente" é a mesma da importação: o telefone final de cada linha (a regra canônica, com
// paridade travada em shared/phoneTestCases.json) reduzido a dígitos — o equivalente ao DISTINCT telefone que o
// backend conta ao fechar a importação (closeLeadImport → uniquePhones). Nenhuma regra nova de telefone.

import type { ImportTotals } from "./batchedImport";

export interface ImportCounts {
  /** linhas da planilha */
  totalRows: number;
  /** telefones diferentes = contatos que vão existir */
  distinctContacts: number;
  /** linhas com telefone válido que repetem um telefone de outra linha (viram um contato só) */
  repeatedInFile: number;
  /** linhas sem telefone válido (não serão importadas) */
  withoutValidPhone: number;
}

const chave = (telefone: string | null | undefined) => String(telefone ?? "").replace(/\D/g, "");

/** `finalPhones`: o telefone final de cada linha (null/vazio quando a linha não tem telefone válido). */
export function countImportRows(finalPhones: Array<string | null | undefined>): ImportCounts {
  const validos = finalPhones.map(chave).filter(Boolean);
  const distintos = new Set(validos).size;
  return {
    totalRows: finalPhones.length,
    distinctContacts: distintos,
    repeatedInFile: validos.length - distintos,
    withoutValidPhone: finalPhones.length - validos.length,
  };
}

/** Aviso depois de importar, com os números reais que o servidor devolveu. */
export function formatImportResultMessage(totals: Pick<ImportTotals, "total" | "valid" | "uniquePhones">): string {
  const fmt = (n: number) => n.toLocaleString("pt-BR");
  const importados = totals.uniquePhones;
  const repetidas = Math.max(0, totals.valid - totals.uniquePhones);
  const semTelefone = Math.max(0, totals.total - totals.valid);
  const partes = [`${fmt(importados)} contato${importados === 1 ? "" : "s"} importado${importados === 1 ? "" : "s"}.`];
  if (repetidas > 0) {
    partes.push(`${fmt(repetidas)} linha${repetidas === 1 ? " era repetida" : "s eram repetidas"} na planilha e ${repetidas === 1 ? "virou" : "viraram"} um contato só.`);
  }
  if (semTelefone > 0) {
    partes.push(`${fmt(semTelefone)} linha${semTelefone === 1 ? "" : "s"} sem telefone válido não ${semTelefone === 1 ? "foi importada" : "foram importadas"}.`);
  }
  return partes.join(" ");
}
