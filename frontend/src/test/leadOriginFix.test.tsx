// src/test/leadOriginFix.test.tsx
//
// Tela da correção da origem "Instagram Direct": o que o usuário vê antes de confirmar, quando o botão
// libera, e que nada é alterado sem ele. O servidor é um fake que registra as chamadas.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls: Array<{ path: string; body?: any }> = [];
let previews: Array<Record<string, unknown>> = [];
let executeResponse: () => { status: number; body: unknown } = () => ({ status: 200, body: {} });

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body }) as unknown as Response;

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ getIdToken: async () => "tok" }) }));
vi.mock("@/lib/api", () => ({
  fetchApi: vi.fn(async (path: string, init: RequestInit = {}) => {
    calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (path.startsWith("/api/leads/mass-delete/tags")) return json(200, { tags: [] });
    if (path === "/api/leads/origin-fix/preview") return json(200, { preview: previews.length > 1 ? previews.shift() : previews[0] });
    if (path === "/api/leads/origin-fix/execute") {
      const r = executeResponse();
      return json(r.status, r.body);
    }
    throw new Error(`rota inesperada ${path}`);
  }),
}));

import { OriginFixDialog } from "../components/leads/OriginFixDialog";
import { LeadBulkActions } from "../components/leads/LeadBulkActions";
import { originFixReportLines, originFixSentence } from "../lib/leadOriginFix";

const WILL_SET = { origem: "Importação de planilha", origemMarketing: "importacao_planilha", leadSource: "importacao_planilha", removeTag: "Instagram Direct" };
const preview = (over: Record<string, unknown> = {}) => ({
  total: 9,
  withImportId: 3,
  onlyImportTag: 4,
  undeterminable: 2,
  correctable: 7,
  instagramImporterUntouched: 5,
  willSet: WILL_SET,
  confirmation: { typedRequired: false, threshold: 500 },
  ...over,
});
const report = (over: Record<string, unknown> = {}) => ({
  corrected: 7,
  correctedWithImportId: 3,
  correctedOnlyImportTag: 4,
  leftUndeterminable: 2,
  leftInstagramImporter: 5,
  ...over,
});

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OriginFixDialog open onOpenChange={() => {}} clientId="A" />
    </QueryClientProvider>
  );
}

const executes = () => calls.filter((c) => c.path === "/api/leads/origin-fix/execute");

beforeEach(() => {
  calls.length = 0;
  previews = [preview()];
  executeResponse = () => ({ status: 200, body: { success: true, report: report() } });
});

describe("regras puras", () => {
  it("[TESTE OBRIGATÓRIO] o relatório diz quantos foram corrigidos (por grupo) e o que ficou sem tocar, com o motivo — não 'pronto'", () => {
    const text = originFixReportLines(report() as any).join("\n");

    expect(text).toContain("Corrigidos: 7 leads (3 com identificador de importação, 4 só pela tag de importação)");
    expect(text).toContain("2 leads indeterminável(is)");
    expect(text).toContain("5 leads do importador de Instagram");
    expect(text).not.toMatch(/pronto/i);
  });

  it("sem sobras, diz 'nenhum'", () => {
    expect(originFixReportLines(report({ leftUndeterminable: 0, leftInstagramImporter: 0 }) as any)).toContain("Não tocados: nenhum.");
  });

  it("a frase de confirmação leva o número e diz o que muda", () => {
    const s = originFixSentence(7, WILL_SET);
    expect(s).toContain("7 leads");
    expect(s).toContain('de "Instagram Direct" para "Importação de planilha"');
  });
});

describe("OriginFixDialog", () => {
  it("[TESTE OBRIGATÓRIO] mostra os três grupos com seus números, o total e os não tocados à parte, antes de qualquer confirmação", async () => {
    renderDialog();
    await screen.findByTestId("origin-fix-preview");

    expect(screen.getByTestId("num-with-import-id").textContent).toBe("3");
    expect(screen.getByTestId("num-only-import-tag").textContent).toBe("4");
    expect(screen.getByTestId("num-undeterminable").textContent).toBe("2");
    expect(screen.getByTestId("num-total").textContent).toBe("9");
    expect(screen.getByTestId("num-instagram-importer").textContent).toBe("5");
    expect(screen.getByText(/Não tocados, à parte/)).toBeTruthy();
    expect(screen.getByText(/Indetermináveis \(não serão tocados\)/)).toBeTruthy();
    expect(executes()).toHaveLength(0);
  });

  it("[TESTE OBRIGATÓRIO] abaixo do limite: confirmação comum com o número na frase; a execução leva o número da prévia", async () => {
    renderDialog();
    await screen.findByTestId("origin-fix-preview");

    expect(screen.getByTestId("origin-fix-sentence").textContent).toContain("7 leads");
    expect(screen.queryByLabelText("Digite o número para confirmar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Corrigir 7 leads" }));

    await screen.findByTestId("origin-fix-report");
    expect(executes()).toHaveLength(1);
    expect(executes()[0].body).toEqual({ clientId: "A", expectedCount: 7 });
    expect(within(screen.getByTestId("origin-fix-report")).getByText(/Corrigidos: 7 leads/)).toBeTruthy();
    expect(within(screen.getByTestId("origin-fix-report")).getByText(/2 leads indeterminável/)).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] o número da execução é o de CORRIGÍVEIS (grupos 1+2), nunca o total nem os indetermináveis", async () => {
    previews = [preview({ total: 100, withImportId: 10, onlyImportTag: 20, undeterminable: 70, correctable: 30 })];
    renderDialog();
    await screen.findByTestId("origin-fix-preview");

    fireEvent.click(screen.getByRole("button", { name: "Corrigir 30 leads" }));

    await screen.findByTestId("origin-fix-report");
    expect(executes()[0].body.expectedCount).toBe(30);
  });

  it("[TESTE OBRIGATÓRIO] acima de 500: botão desabilitado até o número digitado bater", async () => {
    previews = [preview({ total: 900, withImportId: 300, onlyImportTag: 500, undeterminable: 100, correctable: 800 })];
    renderDialog();
    await screen.findByTestId("origin-fix-preview");

    const botao = screen.getByRole("button", { name: "Corrigir 800 leads" }) as HTMLButtonElement;
    const campo = screen.getByLabelText("Digite o número para confirmar");
    expect(botao.disabled).toBe(true);
    fireEvent.change(campo, { target: { value: "799" } });
    expect(botao.disabled).toBe(true);
    fireEvent.change(campo, { target: { value: "800" } });
    expect(botao.disabled).toBe(false);

    fireEvent.click(botao);
    await screen.findByTestId("origin-fix-report");
    expect(executes()[0].body).toEqual({ clientId: "A", expectedCount: 800, confirmation: "800" });
  });

  it("[TESTE OBRIGATÓRIO] exatamente 500 ainda é confirmação comum", async () => {
    previews = [preview({ correctable: 500, withImportId: 250, onlyImportTag: 250 })];
    renderDialog();
    await screen.findByTestId("origin-fix-preview");

    expect(screen.queryByLabelText("Digite o número para confirmar")).toBeNull();
    expect((screen.getByRole("button", { name: "Corrigir 500 leads" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] base mudou entre ver e confirmar: mostra os dois números, nada é alterado e pede nova confirmação", async () => {
    previews = [preview(), preview({ correctable: 9, onlyImportTag: 6, total: 11 })];
    executeResponse = () => ({
      status: 409,
      body: { error: { code: "ORIGIN_FIX_COUNT_MISMATCH", message: "x", details: { expected: 7, actual: 9 } } },
    });
    renderDialog();
    await screen.findByTestId("origin-fix-preview");

    fireEvent.click(screen.getByRole("button", { name: "Corrigir 7 leads" }));

    const aviso = await screen.findByTestId("origin-fix-mismatch");
    expect(aviso.textContent).toContain("você viu 7, agora são 9");
    expect(aviso.textContent).toContain("Nada foi alterado");
    expect(screen.queryByTestId("origin-fix-report")).toBeNull();
    const novo = await screen.findByRole("button", { name: "Corrigir 9 leads" });
    executeResponse = () => ({ status: 200, body: { success: true, report: report({ corrected: 9 }) } });
    fireEvent.click(novo);
    await screen.findByTestId("origin-fix-report");
    expect(executes()).toHaveLength(2);
    expect(executes()[1].body.expectedCount).toBe(9);
  });

  it("sem nada determinável, o botão de corrigir fica desabilitado e não há frase de confirmação", async () => {
    previews = [preview({ correctable: 0, withImportId: 0, onlyImportTag: 0, undeterminable: 9, total: 9 })];
    renderDialog();
    await screen.findByTestId("origin-fix-preview");

    expect((screen.getByRole("button", { name: "Corrigir" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("origin-fix-sentence")).toBeNull();
    expect(screen.getByText(/Nada determinável a corrigir/)).toBeTruthy();
  });

  it("erro do servidor aparece e nada é dado como feito", async () => {
    executeResponse = () => ({ status: 500, body: { error: { code: "ORIGIN_FIX_FAILED", message: "A correção falhou e nada foi alterado. x" } } });
    renderDialog();
    await screen.findByTestId("origin-fix-preview");

    fireEvent.click(screen.getByRole("button", { name: "Corrigir 7 leads" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("nada foi alterado"));
    expect(screen.queryByTestId("origin-fix-report")).toBeNull();
  });

  it("a prévia vai ao servidor com o cliente da tela e nada mais (só leitura)", async () => {
    renderDialog();
    await screen.findByTestId("origin-fix-preview");

    expect(calls.filter((c) => c.path.includes("preview")).map((c) => c.body)).toEqual([{ clientId: "A" }]);
  });
});

describe("LeadBulkActions (botões do Banco)", () => {
  const renderActions = (canManage: boolean) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LeadBulkActions clientId="A" canManage={canManage} />
      </QueryClientProvider>
    );

  it("[TESTE OBRIGATÓRIO] sem permissão de gestor/administrador, nenhum botão aparece (nem o de excluir, nem o de corrigir)", () => {
    renderActions(false);

    expect(screen.queryByTestId("btn-origin-fix")).toBeNull();
    expect(screen.queryByTestId("btn-mass-delete-by-tag")).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] gestor vê os dois botões, e nada vai ao servidor até clicar", () => {
    renderActions(true);

    expect(screen.getByTestId("btn-origin-fix")).toBeTruthy();
    expect(screen.getByTestId("btn-mass-delete-by-tag")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("[TESTE OBRIGATÓRIO] 'Corrigir origem' abre o diálogo da correção (e só ele); a prévia é a primeira chamada", async () => {
    renderActions(true);

    fireEvent.click(screen.getByTestId("btn-origin-fix"));

    await screen.findByTestId("origin-fix-dialog");
    expect(screen.queryByTestId("mass-delete-dialog")).toBeNull();
    await screen.findByTestId("origin-fix-preview");
    expect(calls[0].path).toBe("/api/leads/origin-fix/preview");
    expect(executes()).toHaveLength(0);
  });

  it("'Excluir por tag' continua abrindo o diálogo da exclusão (e só ele)", async () => {
    renderActions(true);

    fireEvent.click(screen.getByTestId("btn-mass-delete-by-tag"));

    await screen.findByTestId("mass-delete-dialog");
    expect(screen.queryByTestId("origin-fix-dialog")).toBeNull();
  });
});
