// Repetidos DENTRO da planilha: a importação estava certa (um telefone = um contato), a tela é que não contava.
// Medido 22/10/2026 (SPAZIO2.xlsx): 351 linhas, 274 distintos, 77 repetidos — o dono achou que perdeu 77 contatos.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImportCountsSummary } from "@/components/leads/ImportCountsSummary";
import { countImportRows, formatImportResultMessage } from "@/lib/leadImports/importCounts";

// 10 linhas: 7 telefones diferentes; 3 linhas repetem telefone de outra linha
const DEZ_LINHAS = [
  "+5511990000001", "+5511990000002", "+5511990000003", "+5511990000004", "+5511990000005",
  "+5511990000006", "+5511990000007",
  "+5511990000001", "+5511990000002", "5511990000003", // repetidos (o último sem "+": mesma chave)
];

describe("[OBRIGATÓRIO] pré-análise mostra os repetidos dentro da planilha", () => {
  it("(f) 10 linhas com 3 telefones repetidos → '7 contatos diferentes' e '3 repetidos'", () => {
    const counts = countImportRows(DEZ_LINHAS);
    render(<ImportCountsSummary counts={counts} />);

    expect(screen.getByTestId("import-counts-rows").textContent).toBe("10 linhas na planilha");
    expect(screen.getByTestId("import-counts-distinct").textContent).toBe("7 contatos diferentes");
    expect(screen.getByTestId("import-counts-repeated").textContent).toBe(
      "3 repetidos dentro da própria planilha (serão importados uma vez só)"
    );
    expect(screen.getByTestId("import-counts-without-phone").textContent).toBe("0 sem telefone válido");
  });

  it("linha sem telefone válido entra em 'sem telefone', não em repetidos nem em diferentes", () => {
    expect(countImportRows(["+5511990000001", null, "", "+5511990000001", undefined])).toEqual({
      totalRows: 5,
      distinctContacts: 1,
      repeatedInFile: 1,
      withoutValidPhone: 3,
    });
  });

  it("caso medido do cliente: 351 linhas, 274 distintos → 77 repetidos", () => {
    const linhas = [
      ...Array.from({ length: 274 }, (_, i) => `+55119${String(90000000 + i)}`),
      ...Array.from({ length: 77 }, (_, i) => `+55119${String(90000000 + i)}`),
    ];
    expect(countImportRows(linhas)).toEqual({ totalRows: 351, distinctContacts: 274, repeatedInFile: 77, withoutValidPhone: 0 });
  });
});

describe("aviso depois de importar, com os números do servidor", () => {
  it("'274 contatos importados. 77 linhas eram repetidas na planilha e viraram um contato só.'", () => {
    expect(formatImportResultMessage({ total: 351, valid: 351, uniquePhones: 274 })).toBe(
      "274 contatos importados. 77 linhas eram repetidas na planilha e viraram um contato só."
    );
  });

  it("sem repetidas e com linhas sem telefone", () => {
    expect(formatImportResultMessage({ total: 12, valid: 10, uniquePhones: 10 })).toBe(
      "10 contatos importados. 2 linhas sem telefone válido não foram importadas."
    );
  });

  it("singular", () => {
    expect(formatImportResultMessage({ total: 2, valid: 2, uniquePhones: 1 })).toBe(
      "1 contato importado. 1 linha era repetida na planilha e virou um contato só."
    );
  });
});
