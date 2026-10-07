// src/test/leadMassDelete.test.tsx
//
// Exclusão em massa de leads, lado da tela: o que o usuário vê antes de confirmar, quando o botão
// libera, e que nada destrutivo acontece sem ele. O servidor é um fake que registra as chamadas.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls: Array<{ path: string; body?: any }> = [];
let previews: Array<Record<string, unknown>> = [];
let executeResponse: () => { status: number; body: unknown } = () => ({ status: 200, body: {} });

const json = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as Response;

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ getIdToken: async () => "tok" }) }));
vi.mock("@/lib/api", () => ({
  fetchApi: vi.fn(async (path: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    if (path.startsWith("/api/leads/mass-delete/tags"))
      return json(200, {
        tags: [
          { tag: "Lista Out/26", leads: 40 },
          { tag: "VIP", leads: 25 },
          { tag: "Proposta", leads: 15 },
        ],
      });
    if (path === "/api/leads/mass-delete/preview") return json(200, { preview: previews.length > 1 ? previews.shift() : previews[0] });
    if (path === "/api/leads/mass-delete/export")
      return {
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h.toLowerCase() === "x-exported-count" ? String(previews[0].willDelete) : null) },
        blob: async () => new Blob(["csv"]),
      } as unknown as Response;
    if (path === "/api/leads/mass-delete/execute") {
      const r = executeResponse();
      return json(r.status, r.body);
    }
    throw new Error(`rota inesperada ${path}`);
  }),
}));

import { MassDeleteDialog } from "../components/leads/MassDeleteDialog";
import { SavedSheetsCards } from "../pages/LeadImports/SavedSheetsCards";
import {
  canConfirmMassDelete,
  canMassDeleteLeads,
  confirmationSentence,
  reportLines,
  requiresTypedConfirmation,
} from "../lib/leadMassDelete";

const preview = (over: Record<string, unknown> = {}) => ({
  matched: 40,
  multiImport: 6,
  withMessages: 4,
  both: 0,
  willDelete: 30,
  kept: 10,
  keptReasons: { multiImport: 6, withMessages: 4, both: 0 },
  confirmation: { typedRequired: false, threshold: 500 },
  ...over,
});

const report = (over: Record<string, unknown> = {}) => ({
  matched: 40,
  deleted: 30,
  kept: 10,
  keptReasons: { multiImport: 6, withMessages: 4, both: 0 },
  options: { includeMultiImport: false, includeWithMessages: false },
  criterion: { type: "tag", value: "Lista Out/26" },
  ...over,
});

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MassDeleteDialog open onOpenChange={() => {}} clientId="A" />
    </QueryClientProvider>
  );
}

async function escolherTag() {
  await waitFor(() => expect(screen.getByRole("option", { name: /Lista Out\/26/ })).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "Lista Out/26" } });
  await screen.findByTestId("mass-delete-preview");
}

const executes = () => calls.filter((c) => c.path === "/api/leads/mass-delete/execute");

beforeEach(() => {
  calls.length = 0;
  previews = [preview()];
  executeResponse = () => ({ status: 200, body: { success: true, report: report() } });
});

describe("regras puras da tela", () => {
  it("[TESTE OBRIGATÓRIO] 500 ainda é confirmação comum; 501 exige digitar", () => {
    expect(requiresTypedConfirmation(500)).toBe(false);
    expect(requiresTypedConfirmation(501)).toBe(true);
  });

  it("[TESTE OBRIGATÓRIO] botão só libera quando o número digitado bate exatamente", () => {
    expect(canConfirmMassDelete(501, "")).toBe(false);
    expect(canConfirmMassDelete(501, "500")).toBe(false);
    expect(canConfirmMassDelete(501, "501abc")).toBe(false);
    expect(canConfirmMassDelete(501, " 501 ")).toBe(true);
    expect(canConfirmMassDelete(0, "0")).toBe(false);
    expect(canConfirmMassDelete(30, "")).toBe(true);
  });

  it("a frase de confirmação leva o número e a tag", () => {
    expect(confirmationSentence(30, "Lista Out/26")).toContain('30 leads com a tag "Lista Out/26"');
    expect(confirmationSentence(1, "x")).toContain("1 lead com");
  });

  it("[TESTE OBRIGATÓRIO] o relatório diz quantos saíram, quantos ficaram e o motivo de cada grupo — não 'pronto'", () => {
    const text = reportLines(report({ keptReasons: { multiImport: 5, withMessages: 3, both: 2 }, kept: 10 }) as any).join("\n");

    expect(text).toContain("Apagados: 30 leads");
    expect(text).toContain("Mantidos: 10 leads");
    expect(text).toContain("5 leads por estar em mais de uma importação");
    expect(text).toContain("3 leads por já ter trocado mensagem");
    expect(text).toContain("2 leads por ambos os motivos");
    expect(text).not.toMatch(/pronto/i);
  });

  it("sem mantidos, diz 'nenhum' em vez de omitir", () => {
    expect(reportLines(report({ kept: 0, keptReasons: { multiImport: 0, withMessages: 0, both: 0 } }) as any)).toContain("Mantidos: nenhum.");
  });

  it("[TESTE OBRIGATÓRIO] só gestor/admin vê a exclusão em massa", () => {
    expect(canMassDeleteLeads({ isAdminUser: false, approvalLevel: "none", canAccessUsersPage: false })).toBe(false);
    expect(canMassDeleteLeads({ isAdminUser: false, approvalLevel: "seller", canAccessUsersPage: false })).toBe(false);
    expect(canMassDeleteLeads({ isAdminUser: true, approvalLevel: "none", canAccessUsersPage: false })).toBe(true);
    expect(canMassDeleteLeads({ isAdminUser: false, approvalLevel: "manager", canAccessUsersPage: false })).toBe(true);
    expect(canMassDeleteLeads({ isAdminUser: false, approvalLevel: "none", canAccessUsersPage: true })).toBe(true);
  });
});

describe("MassDeleteDialog", () => {
  it("[TESTE OBRIGATÓRIO] mostra os números nomeados antes de qualquer confirmação, com as opções desligadas", async () => {
    renderDialog();
    await escolherTag();

    expect(screen.getByTestId("num-matched").textContent).toBe("40");
    expect(screen.getByTestId("num-multi-import").textContent).toBe("6");
    expect(screen.getByTestId("num-with-messages").textContent).toBe("4");
    expect(screen.getByTestId("num-will-delete").textContent).toBe("30");
    expect(screen.getByTestId("num-kept").textContent).toBe("10");
    expect(screen.getByText(/Também têm tag de outra importação/)).toBeTruthy();
    expect(screen.getByText(/Já trocaram mensagem/)).toBeTruthy();
    for (const box of screen.getAllByRole("checkbox")) expect((box as HTMLInputElement).checked).toBe(false);
    expect(executes()).toHaveLength(0);
  });

  it("[TESTE OBRIGATÓRIO] abaixo de 500: confirmação comum com o número na frase; execução leva o número da prévia", async () => {
    renderDialog();
    await escolherTag();

    expect(screen.getByTestId("mass-delete-sentence").textContent).toContain("30 leads");
    expect(screen.queryByLabelText("Digite o número para confirmar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apagar 30 leads" }));

    await screen.findByTestId("mass-delete-report");
    expect(executes()).toHaveLength(1);
    expect(executes()[0].body).toMatchObject({
      clientId: "A",
      criterion: { type: "tag", value: "Lista Out/26" },
      expectedCount: 30,
      options: { includeMultiImport: false, includeWithMessages: false },
    });
    expect(executes()[0].body.confirmation).toBeUndefined();
    expect(within(screen.getByTestId("mass-delete-report")).getByText(/Apagados: 30 leads/)).toBeTruthy();
    expect(within(screen.getByTestId("mass-delete-report")).getByText(/6 leads por estar em mais de uma importação/)).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] acima de 500: botão desabilitado até o número digitado bater", async () => {
    previews = [preview({ matched: 900, willDelete: 800, kept: 100, confirmation: { typedRequired: true, threshold: 500 } })];
    renderDialog();
    await escolherTag();

    const botao = screen.getByRole("button", { name: "Apagar 800 leads" }) as HTMLButtonElement;
    const campo = screen.getByLabelText("Digite o número para confirmar");
    expect(botao.disabled).toBe(true);

    fireEvent.change(campo, { target: { value: "799" } });
    expect(botao.disabled).toBe(true);

    fireEvent.change(campo, { target: { value: "800" } });
    expect(botao.disabled).toBe(false);

    fireEvent.click(botao);
    await screen.findByTestId("mass-delete-report");
    expect(executes()[0].body).toMatchObject({ expectedCount: 800, confirmation: "800" });
  });

  it("[TESTE OBRIGATÓRIO] base mudou entre ver e confirmar: mostra os dois números, nada é apagado e pede nova confirmação", async () => {
    previews = [preview(), preview({ willDelete: 45, matched: 55, kept: 10 })];
    executeResponse = () => ({
      status: 409,
      body: { error: { code: "MASS_DELETE_COUNT_MISMATCH", message: "x", details: { expected: 30, actual: 45 } } },
    });
    renderDialog();
    await escolherTag();

    fireEvent.click(screen.getByRole("button", { name: "Apagar 30 leads" }));

    const aviso = await screen.findByTestId("mass-delete-mismatch");
    expect(aviso.textContent).toContain("você viu 30, agora são 45");
    expect(aviso.textContent).toContain("Nada foi apagado");
    expect(screen.queryByTestId("mass-delete-report")).toBeNull();
    // a prévia foi refeita: o botão agora fala em 45 e a próxima execução leva 45
    const novo = await screen.findByRole("button", { name: "Apagar 45 leads" });
    executeResponse = () => ({ status: 200, body: { success: true, report: report({ deleted: 45 }) } });
    fireEvent.click(novo);
    await screen.findByTestId("mass-delete-report");
    expect(executes()).toHaveLength(2);
    expect(executes()[1].body.expectedCount).toBe(45);
  });

  it("[TESTE OBRIGATÓRIO] ligar uma opção refaz a prévia com a opção e zera o que foi digitado", async () => {
    previews = [
      preview({ willDelete: 800, matched: 900, confirmation: { typedRequired: true, threshold: 500 } }),
      preview({ willDelete: 806, matched: 900, confirmation: { typedRequired: true, threshold: 500 } }),
    ];
    renderDialog();
    await escolherTag();
    fireEvent.change(screen.getByLabelText("Digite o número para confirmar"), { target: { value: "800" } });

    fireEvent.click(screen.getByLabelText(/Apagar também os que vieram de mais de uma importação/));

    await screen.findByRole("button", { name: "Apagar 806 leads" });
    const previewCalls = calls.filter((c) => c.path === "/api/leads/mass-delete/preview");
    expect(previewCalls[previewCalls.length - 1].body.options).toEqual({ includeMultiImport: true, includeWithMessages: false });
    expect((screen.getByLabelText("Digite o número para confirmar") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Apagar 806 leads" }) as HTMLButtonElement).disabled).toBe(true);
    expect(executes()).toHaveLength(0);
  });

  it("[TESTE OBRIGATÓRIO] exportar usa o mesmo critério e as mesmas opções, e não apaga nada", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    previews = [preview(), preview({ willDelete: 34, matched: 40, kept: 6 })];
    renderDialog();
    await escolherTag();
    // com uma opção ligada: o que se exporta é o que SERIA apagado com ela
    fireEvent.click(screen.getByLabelText(/Apagar também os que já trocaram mensagem/));

    fireEvent.click(await screen.findByRole("button", { name: /Exportar os 34 leads que serão apagados/ }));

    await waitFor(() => expect(calls.some((c) => c.path === "/api/leads/mass-delete/export")).toBe(true));
    expect(calls.find((c) => c.path === "/api/leads/mass-delete/export")!.body).toEqual({
      clientId: "A",
      criterion: { type: "tag", value: "Lista Out/26" },
      options: { includeMultiImport: false, includeWithMessages: true },
    });
    expect(screen.getByText(/só reimportando/)).toBeTruthy();
    expect(executes()).toHaveLength(0);
  });

  it("[TESTE OBRIGATÓRIO] exportar trata singular (1 lead) e plural (N leads) na concordância do botão", async () => {
    // 1 lead apagado
    previews = [preview({ willDelete: 1, matched: 10, kept: 9 })];
    const { unmount } = renderDialog();
    await escolherTag();
    expect(screen.getByRole("button", { name: "Exportar o 1 lead que será apagado (planilha)" })).toBeTruthy();
    unmount();

    // Vários leads apagados
    previews = [preview({ willDelete: 17845, matched: 20000, kept: 2155 })];
    renderDialog();
    await escolherTag();
    expect(screen.getByRole("button", { name: "Exportar os 17.845 leads que serão apagados (planilha)" })).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] explica por que os demais leads estão protegidos quando há diferença entre selecionados e a apagar", async () => {
    // Caso com muitos protegidos (salto de 17.845 selecionados para 1 a apagar)
    previews = [preview({ matched: 17845, willDelete: 1, kept: 17844 })];
    const { unmount } = renderDialog();
    await escolherTag();

    const note = screen.getByTestId("mass-delete-protected-note");
    expect(note.textContent).toBe(
      "Os demais 17.844 leads estão protegidos porque vieram de mais de uma importação ou já trocaram mensagem — marque as caixas abaixo para incluí-los."
    );
    unmount();

    // Caso singular: 2 selecionados, 1 a apagar, 1 protegido
    previews = [preview({ matched: 2, willDelete: 1, kept: 1 })];
    const { unmount: unmount2 } = renderDialog();
    await escolherTag();
    expect(screen.getByTestId("mass-delete-protected-note").textContent).toBe(
      "O outro lead está protegido porque veio de mais de uma importação ou já trocou mensagem — marque as caixas abaixo para incluí-lo."
    );
    unmount2();

    // Caso sem mantidos (kept === 0): a nota explicativa não aparece
    previews = [preview({ matched: 10, willDelete: 10, kept: 0 })];
    renderDialog();
    await escolherTag();
    expect(screen.queryByTestId("mass-delete-protected-note")).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] layout da modal fixa cabeçalho e rodapé, limita altura em 85vh e rola miolo e lista de tags", async () => {
    previews = [preview({ willDelete: 10, matched: 20, kept: 10 })];
    renderDialog();
    await escolherTag();

    const dialog = screen.getByTestId("mass-delete-dialog");
    expect(dialog.className).toContain("max-h-[85vh]");
    expect(dialog.className).toContain("flex");
    expect(dialog.className).toContain("flex-col");
    expect(dialog.className).toContain("overflow-hidden");

    // Cabeçalho e rodapé têm shrink-0 para não serem esmagados
    const header = dialog.querySelector("div.border-b");
    expect(header?.className).toContain("shrink-0");

    const footer = dialog.querySelector("div.border-t");
    expect(footer?.className).toContain("shrink-0");

    // Miolo tem flex-1 e overflow-y-auto
    const body = dialog.querySelector("div.flex-1");
    expect(body?.className).toContain("overflow-y-auto");
    expect(body?.className).toContain("min-h-0");

    // Lista de tags tem altura limitada max-h-28 e rolagem própria
    const tagList = screen.getByRole("group", { name: "Lista de tags disponíveis" });
    expect(tagList.className).toContain("max-h-28");
    expect(tagList.className).toContain("overflow-y-auto");
  });

  it("sem nada a apagar, o botão de confirmar fica desabilitado", async () => {
    previews = [preview({ willDelete: 0, kept: 40, matched: 40 })];
    renderDialog();
    await escolherTag();

    expect((screen.getByRole("button", { name: "Apagar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("mass-delete-sentence")).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] seleção de múltiplas tags com busca e aviso de leads sobrepostos", async () => {
    previews = [
      preview({
        matched: 55,
        willDelete: 45,
        kept: 10,
        multiSelectedTags: 10,
      }),
    ];
    executeResponse = () => ({
      status: 200,
      body: {
        success: true,
        report: report({
          deleted: 45,
          matched: 55,
          criterion: { type: "tag", value: "VIP, Proposta", values: ["VIP", "Proposta"] },
        }),
      },
    });
    renderDialog();

    // Aguarda carregar as tags da API
    await waitFor(() => expect(screen.getByText("Lista Out/26")).toBeTruthy());

    // Busca pela tag VIP
    fireEvent.change(screen.getByLabelText("Buscar tags"), { target: { value: "VIP" } });
    expect(screen.getByText("VIP")).toBeTruthy();
    expect(screen.queryByText("Lista Out/26")).toBeNull();

    // Seleciona a tag VIP
    fireEvent.click(screen.getByText("VIP"));

    // Limpa busca para ver Proposta
    fireEvent.change(screen.getByLabelText("Buscar tags"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Proposta"));

    await screen.findByTestId("mass-delete-preview");

    // Mostra o número de sobrepostos nomeado
    const overNotice = screen.getByTestId("num-multi-selected-tags");
    expect(overNotice.textContent).toContain("10 leads têm mais de uma das tags selecionadas");

    // A frase de confirmação lista as tags
    expect(screen.getByTestId("mass-delete-sentence").textContent).toContain("2 tags selecionadas (VIP, Proposta)");

    // Execução envia o critério com values
    fireEvent.click(screen.getByRole("button", { name: "Apagar 45 leads" }));
    await screen.findByTestId("mass-delete-report");

    expect(executes()).toHaveLength(1);
    expect(executes()[0].body.criterion).toMatchObject({
      type: "tag",
      values: ["VIP", "Proposta"],
    });
  });
});

describe("Planilhas Salvas: duas ações com nomes que não se confundem", () => {
  const imp = {
    id: "imp-1",
    client_id: "A",
    source_name: "base.xlsx",
    source_type: "spreadsheet",
    total_rows: 100,
    imported_rows: 90,
    skipped_rows: 10,
    uploaded_by_uid: null,
    uploaded_by_email: "a@x.com",
    created_at: "2026-10-01T10:00:00Z",
  };

  it("[TESTE OBRIGATÓRIO] 'remover registro' e 'excluir leads' são botões distintos e cada um dispara só o seu", () => {
    const onDeleteImport = vi.fn();
    const onDeleteLeads = vi.fn();
    render(<SavedSheetsCards imports={[imp]} onViewImport={() => {}} onDeleteImport={onDeleteImport} onDeleteLeads={onDeleteLeads} />);
    fireEvent.click(screen.getByRole("button", { name: /Ver detalhes/ }));

    expect(screen.queryByRole("button", { name: /^Excluir$/ })).toBeNull(); // o rótulo ambíguo não existe mais

    fireEvent.click(screen.getByRole("button", { name: /Remover registro da planilha/ }));
    expect(onDeleteImport).toHaveBeenCalledWith("imp-1", "base.xlsx");
    expect(onDeleteLeads).not.toHaveBeenCalled();

    onDeleteImport.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Excluir os leads desta planilha/ }));
    expect(onDeleteLeads).toHaveBeenCalledTimes(1);
    expect(onDeleteImport).not.toHaveBeenCalled();
  });

  it("[TESTE OBRIGATÓRIO] quem não pode apagar em massa não vê a ação de excluir leads", () => {
    render(<SavedSheetsCards imports={[imp]} onViewImport={() => {}} onDeleteImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Ver detalhes/ }));

    expect(screen.getByRole("button", { name: /Remover registro da planilha/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Excluir os leads/ })).toBeNull();
  });

  it("o número do cartão é 'linhas importadas' (o que foi lido da planilha), não 'leads' no Banco", () => {
    render(<SavedSheetsCards imports={[imp]} onViewImport={() => {}} onDeleteImport={() => {}} />);

    expect(screen.getByTestId("sheet-leads-imp-1").textContent).toBe("90 linhas importadas");
  });
});
