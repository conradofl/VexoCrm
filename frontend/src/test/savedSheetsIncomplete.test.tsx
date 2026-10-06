// Planilhas Salvas: a importação INCOMPLETA aparece como incompleta (com o que entrou e quantas faltam) e oferece "Retomar" sem
// precisar abrir o cartão — nos dois modos (cartão e lista). Planilha completa não muda. E a incompleta nunca entra nos seletores
// de campanha da página.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import pageSource from "../pages/LeadImports.tsx?raw";
import bancoSource from "../pages/BancoDeDados.tsx?raw";
import { SavedSheetsCards } from "@/pages/LeadImports/SavedSheetsCards";
import { describeIncompleteImport, isImportIncomplete } from "@/lib/leadImports/importStatus";
import type { LeadImportItem } from "@/hooks/useLeadImports";

const base = { client_id: "t", source_type: "xlsx", skipped_rows: 0, uploaded_by_uid: "u", uploaded_by_email: "u@x", created_at: "2026-10-05T12:00:00Z" };
const completa: LeadImportItem = { ...base, id: "imp-ok", source_name: "completa.xlsx", total_rows: 1200, imported_rows: 1080, status: "completed", expected_rows: 1200, received_offset: 1200 };
const incompleta: LeadImportItem = { ...base, id: "imp-parcial", source_name: "grande.xlsx", total_rows: 0, imported_rows: 0, status: "incomplete", expected_rows: 20000, received_offset: 7000 };
const antiga: LeadImportItem = { ...base, id: "imp-antiga", source_name: "antiga.xlsx", total_rows: 50, imported_rows: 40 }; // servidor sem o campo status

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

function montar(props: Partial<React.ComponentProps<typeof SavedSheetsCards>> = {}, modo: "card" | "list" = "card") {
  window.localStorage.setItem("vexo:view-mode:planilhas-salvas", JSON.stringify(modo));
  const onResumeImport = vi.fn();
  render(
    <SavedSheetsCards imports={[completa, incompleta, antiga]} onViewImport={vi.fn()} onDeleteImport={vi.fn()} onResumeImport={onResumeImport} {...props} />
  );
  return { onResumeImport };
}

describe("[TESTE OBRIGATÓRIO] a planilha incompleta aparece como incompleta, com o número certo e o botão de retomar", () => {
  it("descreve o que entrou e o que falta (formato pt-BR)", () => {
    expect(describeIncompleteImport(incompleta)).toBe("Incompleta — entraram 7.000 de 20.000 linhas (faltam 13.000)");
    expect(describeIncompleteImport({ expected_rows: null, received_offset: 0 })).toBe("Incompleta — importação interrompida");
  });

  it("só 'incomplete' é incompleta: 'completed' e servidor antigo (sem status) são completas", () => {
    expect(isImportIncomplete(incompleta)).toBe(true);
    expect(isImportIncomplete(completa)).toBe(false);
    expect(isImportIncomplete(antiga)).toBe(false);
  });

  it("modo CARTÃO: a incompleta mostra o progresso e o botão Retomar SEM expandir; a completa não tem botão", () => {
    montar({}, "card");

    const cartao = screen.getByTestId("sheet-card-imp-parcial");
    expect(within(cartao).getByTestId("sheet-leads-imp-parcial").textContent).toBe("Incompleta — entraram 7.000 de 20.000 linhas (faltam 13.000)");
    expect(within(cartao).getByTestId("sheet-resume-imp-parcial")).toBeTruthy();
    expect(within(cartao).getByTestId("sheet-incomplete-imp-parcial").textContent).toMatch(/Não use esta planilha em campanhas/);
    expect(screen.getByTestId("sheet-leads-imp-ok").textContent).toBe("1080 linhas importadas"); // a completa segue como sempre
    expect(screen.queryByTestId("sheet-resume-imp-ok")).toBeNull();
    expect(screen.queryByTestId("sheet-resume-imp-antiga")).toBeNull();
    expect(screen.queryByTestId("sheet-incomplete-imp-ok")).toBeNull();
  });

  it("modo LISTA: o mesmo texto e o mesmo botão na linha", () => {
    montar({}, "list");

    expect(screen.getAllByText("Incompleta — entraram 7.000 de 20.000 linhas (faltam 13.000)").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("sheet-resume-imp-parcial")).toHaveLength(1);
    expect(screen.queryByTestId("sheet-resume-imp-ok")).toBeNull();
  });

  it("escolher o arquivo no Retomar entrega (planilha, arquivo) ao chamador", () => {
    const { onResumeImport } = montar();
    const arquivo = new File(["a;b"], "grande.xlsx");

    fireEvent.click(screen.getByTestId("sheet-resume-imp-parcial"));
    fireEvent.change(screen.getByTestId("sheet-resume-input"), { target: { files: [arquivo] } });

    expect(onResumeImport).toHaveBeenCalledTimes(1);
    expect(onResumeImport.mock.calls[0][0]).toMatchObject({ id: "imp-parcial" });
    expect(onResumeImport.mock.calls[0][1]).toBe(arquivo);
  });

  it("sem onResumeImport (sem permissão), não há botão — mas a planilha segue marcada como incompleta", () => {
    montar({ onResumeImport: undefined });

    expect(screen.queryByTestId("sheet-resume-imp-parcial")).toBeNull();
    expect(screen.getByTestId("sheet-leads-imp-parcial").textContent).toMatch(/^Incompleta/);
  });

  it("durante a retomada o botão fica desabilitado", () => {
    montar({ resumingImportId: "imp-parcial" });

    expect((screen.getByTestId("sheet-resume-imp-parcial") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("a página não oferece planilha incompleta em campanha, auditoria nem mapeamento lembrado", () => {
  it("`imports` (o que alimenta seletores, relatório e mapeamento) exclui as incompletas; Planilhas Salvas vive no Banco", () => {
    expect(pageSource).toMatch(/const imports = useMemo\(\(\) => allImports\.filter\(\(imp\) => !isImportIncomplete\(imp\)\), \[allImports\]\);/);
    expect(pageSource).not.toMatch(/<SavedSheetsCards/); // Bloco 1: saiu de Campanhas
    expect(bancoSource).toMatch(/<SavedSheetsCards\s+imports=\{pastImports\}/); // Bloco 2: vive no Banco
    expect(pageSource).toMatch(/imports=\{imports\}\s+filterRules/); // LeadSourceStep (seletor de campanha) recebe só as completas
    expect(pageSource).toMatch(/<LeadImportAuditReport\s+activeClientId=\{activeClientId\}\s+imports=\{imports\}/);
  });

  it("o ponto de importação por público mostra o progresso", () => {
    expect(pageSource).toMatch(/onProgress: \(p\) => setSubmittingStatus\(describeImportProgress\(p\)\)/);
  });
});
