// frontend/src/test/leadImportAuditReportGrouped.test.tsx
//
// "O que aconteceu, e por que falhou" — o Relatório & Auditoria não é mais
// o Acompanhar Disparos duplicado (esse mora só na Fila de Envios): é os
// quatro cartões do período, o seletor de planilha, os motivos agrupados
// (clicáveis, com contagem e percentual) e a lista de leads, paginada.

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// getIdToken precisa ser uma referência ESTÁVEL entre renders — o efeito de
// carregar a auditoria (LeadImportAuditReport) tem getIdToken nas próprias
// deps (a AuthContext real memoiza com useCallback). Uma arrow function nova
// a cada chamada de useAuth() reentra o efeito a cada render: loop infinito.
const getIdTokenMock = async () => "token";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: getIdTokenMock }),
}));

vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return {
    ...utils,
    rerenderWithProviders: (next: React.ReactElement) =>
      utils.rerender(<QueryClientProvider client={qc}>{next}</QueryClientProvider>),
  };
}

function makeItem(overrides: Partial<any> = {}) {
  return {
    lead_import_item_id: `item-${Math.random()}`,
    import_id: "import-1",
    telefone: "5534910000001",
    normalized_data: { nome: "Lead Teste" },
    imported_at: "2026-09-01T00:00:00Z",
    row_number: 1,
    imported: true,
    skip_reason: null,
    dispatch_count: 1,
    last_sent_at: null,
    last_attempt_at: "2026-09-10T00:00:00Z",
    last_status: null,
    last_error_message: null,
    has_replied: false,
    failure_reason: null,
    ...overrides,
  };
}

function mockFetchForImport(importId: string, items: any[]) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/api/campaigns/reports/import-audit")) {
      const u = new URL(String(url), "http://localhost");
      const reqImportId = u.searchParams.get("importId");
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({
          import: { id: reqImportId, source_name: "Planilha", created_at: "2026-09-01T00:00:00Z" },
          items: reqImportId === importId ? items : [],
        }),
      };
    }
    return { ok: true, headers: { get: () => "application/json" }, json: async () => ({}) };
  });
  global.fetch = fetchMock as any;
  return fetchMock;
}

describe("LeadImportAuditReport — Relatório & Auditoria redesenhado", () => {
  it("[TESTE OBRIGATÓRIO] o DispatchCampaignTracker não existe mais aqui — os cartões são da planilha, não do período", async () => {
    const items = [
      makeItem({ lead_import_item_id: "s1", last_status: "sent" }),
      makeItem({ lead_import_item_id: "s2", last_status: "sent", has_replied: true }),
      makeItem({ lead_import_item_id: "f1", last_status: "invalid_number", failure_reason: "Número inválido" }),
    ];
    mockFetchForImport("import-1", items);
    const { LeadImportAuditReport } = await import("@/pages/LeadImports/LeadImportAuditReport");
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="sonhare"
        imports={[{ id: "import-1", source_name: "Planilha A", imported_rows: 3, skipped_rows: 0, created_at: "2026-09-01T00:00:00Z", source_type: "upload" }]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    // O Acompanhar Disparos (tracker + abas Ativas/Encerradas) mora só na
    // Fila de Envios — não deve aparecer aqui de jeito nenhum.
    expect(screen.queryByText("Acompanhar Disparos")).toBeNull();
    expect(screen.queryByText(/Ativas \(/)).toBeNull();

    await screen.findByText("Total de leads");
    const totalCard = screen.getByText("Total de leads").closest("div")! as HTMLElement;
    expect(within(totalCard).getByText("3")).toBeTruthy();
    const sentCard = screen.getByText("Enviados").closest("div")! as HTMLElement;
    expect(within(sentCard).getByText("2")).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] os cartões seguem a planilha selecionada — trocar de planilha muda os cinco números", async () => {
    // Planilha A: 10 leads — 6 enviados (2 com retorno), 3 falhas, 1 pendente
    const itemsA = [
      ...Array.from({ length: 4 }, (_, i) => makeItem({ lead_import_item_id: `a-sent-${i}`, last_status: "sent" })),
      ...Array.from({ length: 2 }, (_, i) => makeItem({ lead_import_item_id: `a-sent-r-${i}`, last_status: "sent", has_replied: true })),
      ...Array.from({ length: 3 }, (_, i) => makeItem({ lead_import_item_id: `a-fail-${i}`, last_status: "invalid_number", failure_reason: "Número inválido" })),
      makeItem({ lead_import_item_id: "a-pend", last_status: null }),
    ];
    // Planilha B: 4 leads — 1 enviado, 0 falhas, 0 retorno, 3 pendentes
    const itemsB = [
      makeItem({ lead_import_item_id: "b-sent", last_status: "sent" }),
      ...Array.from({ length: 3 }, (_, i) => makeItem({ lead_import_item_id: `b-pend-${i}`, last_status: null })),
    ];

    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(String(url), "http://localhost");
      const reqImportId = u.searchParams.get("importId");
      const items = reqImportId === "import-a" ? itemsA : reqImportId === "import-b" ? itemsB : [];
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ import: { id: reqImportId, source_name: "x", created_at: "2026-09-01T00:00:00Z" }, items }),
      };
    });
    global.fetch = fetchMock as any;

    const { LeadImportAuditReport } = await import("@/pages/LeadImports/LeadImportAuditReport");
    const importA = { id: "import-a", source_name: "Planilha A", imported_rows: 10, skipped_rows: 0, created_at: "2026-09-01T00:00:00Z", source_type: "upload" };
    const importB = { id: "import-b", source_name: "Planilha B", imported_rows: 4, skipped_rows: 0, created_at: "2026-09-02T00:00:00Z", source_type: "upload" };

    const { rerenderWithProviders } = renderWithProviders(
      <LeadImportAuditReport activeClientId="sonhare" imports={[importA]} onSelectImportForFollowup={vi.fn()} />
    );

    // "Falhas" também é o texto do botão de filtro — escopar a busca no
    // grid dos cartões evita pegar o botão por engano.
    await screen.findByText("Total de leads");
    let statsGrid = screen.getByText("Total de leads").closest("div.grid")! as HTMLElement;
    expect(within(statsGrid).getByText("10")).toBeTruthy();
    expect(within(within(statsGrid).getByText("Enviados").closest("div")! as HTMLElement).getByText("6")).toBeTruthy();
    expect(within(within(statsGrid).getByText("Falhas").closest("div")! as HTMLElement).getByText("3")).toBeTruthy();
    expect(within(within(statsGrid).getByText("Com retorno").closest("div")! as HTMLElement).getByText("2")).toBeTruthy();
    expect(within(within(statsGrid).getByText("Pendentes").closest("div")! as HTMLElement).getByText("1")).toBeTruthy();

    rerenderWithProviders(
      <LeadImportAuditReport activeClientId="sonhare" imports={[importB]} onSelectImportForFollowup={vi.fn()} />
    );

    await waitFor(() => {
      statsGrid = screen.getByText("Total de leads").closest("div.grid")! as HTMLElement;
      expect(within(statsGrid).getByText("4")).toBeTruthy();
    });
    expect(within(within(statsGrid).getByText("Enviados").closest("div")! as HTMLElement).getByText("1")).toBeTruthy();
    expect(within(within(statsGrid).getByText("Falhas").closest("div")! as HTMLElement).getByText("0")).toBeTruthy();
    expect(within(within(statsGrid).getByText("Com retorno").closest("div")! as HTMLElement).getByText("0")).toBeTruthy();
    expect(within(within(statsGrid).getByText("Pendentes").closest("div")! as HTMLElement).getByText("3")).toBeTruthy();
    // nada da planilha A sobra nos cartões
    expect(within(statsGrid).queryByText("10")).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] uma fileira de filtro só — Todos/Falhas/Com Retorno aparece uma vez", async () => {
    mockFetchForImport("import-1", [makeItem()]);
    const { LeadImportAuditReport } = await import("@/pages/LeadImports/LeadImportAuditReport");
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="sonhare"
        imports={[{ id: "import-1", source_name: "Planilha A", imported_rows: 1, skipped_rows: 0, created_at: "2026-09-01T00:00:00Z", source_type: "upload" }]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    await screen.findByText("Total de leads");
    expect(screen.getAllByRole("button", { name: "Todos" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Falhas" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Com Retorno" })).toHaveLength(1);
  });

  it("[TESTE OBRIGATÓRIO] ordenação por Nome funciona nos dois sentidos, com indicador na coluna certa", async () => {
    const items = [
      makeItem({ lead_import_item_id: "c", normalized_data: { nome: "Lead C" } }),
      makeItem({ lead_import_item_id: "a", normalized_data: { nome: "Lead A" } }),
      makeItem({ lead_import_item_id: "b", normalized_data: { nome: "Lead B" } }),
    ];
    mockFetchForImport("import-1", items);
    const { LeadImportAuditReport } = await import("@/pages/LeadImports/LeadImportAuditReport");
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="sonhare"
        imports={[{ id: "import-1", source_name: "Planilha A", imported_rows: 3, skipped_rows: 0, created_at: "2026-09-01T00:00:00Z", source_type: "upload" }]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    await screen.findByText("Lead C");
    const nomeHeader = screen.getByText("Nome").closest("th")! as HTMLElement;
    expect(nomeHeader.querySelector("svg")).toBeNull(); // sem indicador antes de ordenar

    fireEvent.click(screen.getByText("Nome"));
    await waitFor(() => {
      const names = screen.getAllByText(/^Lead [ABC]$/).map((el) => el.textContent);
      expect(names).toEqual(["Lead A", "Lead B", "Lead C"]);
    });
    expect(nomeHeader.querySelector("svg")).toBeTruthy(); // indicador aparece na coluna ativa

    fireEvent.click(screen.getByText("Nome"));
    await waitFor(() => {
      const names = screen.getAllByText(/^Lead [ABC]$/).map((el) => el.textContent);
      expect(names).toEqual(["Lead C", "Lead B", "Lead A"]);
    });

    // outra coluna não ganha indicador — só a que está ordenando
    const telefoneHeader = screen.getByText("Telefone").closest("th")! as HTMLElement;
    expect(telefoneHeader.querySelector("svg")).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] os motivos somam — 3 invalid_number + 1 telefone ausente vira duas linhas com 3, 1 e o percentual certo", async () => {
    const items = [
      makeItem({ lead_import_item_id: "a", last_status: "invalid_number", failure_reason: "Número inválido" }),
      makeItem({ lead_import_item_id: "b", last_status: "invalid_number", failure_reason: "Número inválido" }),
      makeItem({ lead_import_item_id: "c", last_status: "invalid_number", failure_reason: "Número inválido" }),
      makeItem({ lead_import_item_id: "d", imported: false, skip_reason: "Telefone ausente ou invalido", failure_reason: "Telefone ausente ou invalido" }),
    ];
    mockFetchForImport("import-1", items);
    const { LeadImportAuditReport } = await import("@/pages/LeadImports/LeadImportAuditReport");
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="sonhare"
        imports={[{ id: "import-1", source_name: "Planilha A", imported_rows: 4, skipped_rows: 0, created_at: "2026-09-01T00:00:00Z", source_type: "upload" }]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    const invalidRow = await screen.findByRole("button", { name: /^Número inválido/ });
    expect(within(invalidRow).getByText("3 (75%)")).toBeTruthy();
    const missingRow = screen.getByRole("button", { name: /^Telefone ausente ou invalido/ });
    expect(within(missingRow).getByText("1 (25%)")).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] clicar no motivo filtra a lista — só sobram os leads daquele motivo", async () => {
    const items = [
      makeItem({ lead_import_item_id: "a", normalized_data: { nome: "Lead Inválido 1" }, last_status: "invalid_number", failure_reason: "Número inválido" }),
      makeItem({ lead_import_item_id: "b", normalized_data: { nome: "Lead Inválido 2" }, last_status: "invalid_number", failure_reason: "Número inválido" }),
      makeItem({ lead_import_item_id: "c", normalized_data: { nome: "Lead Sem Telefone" }, imported: false, skip_reason: "Telefone ausente ou invalido", failure_reason: "Telefone ausente ou invalido" }),
    ];
    mockFetchForImport("import-1", items);
    const { LeadImportAuditReport } = await import("@/pages/LeadImports/LeadImportAuditReport");
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="sonhare"
        imports={[{ id: "import-1", source_name: "Planilha A", imported_rows: 3, skipped_rows: 0, created_at: "2026-09-01T00:00:00Z", source_type: "upload" }]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    await screen.findByText("Lead Sem Telefone");
    fireEvent.click(screen.getByRole("button", { name: /^Número inválido/ }));

    await waitFor(() => expect(screen.queryByText("Lead Sem Telefone")).toBeNull());
    expect(screen.getByText("Lead Inválido 1")).toBeTruthy();
    expect(screen.getByText("Lead Inválido 2")).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] trocar a campanha muda os motivos e a lista — nada da campanha anterior sobra", async () => {
    const itemsA = [makeItem({ lead_import_item_id: "a1", normalized_data: { nome: "Lead da Planilha A" }, last_status: "invalid_number", failure_reason: "Número inválido" })];
    const itemsB = [makeItem({ lead_import_item_id: "b1", normalized_data: { nome: "Lead da Planilha B" }, imported: false, skip_reason: "Identificador de grupo do WhatsApp bloqueado", failure_reason: "Identificador de grupo do WhatsApp bloqueado" })];

    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(String(url), "http://localhost");
      const reqImportId = u.searchParams.get("importId");
      const items = reqImportId === "import-a" ? itemsA : reqImportId === "import-b" ? itemsB : [];
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ import: { id: reqImportId, source_name: "x", created_at: "2026-09-01T00:00:00Z" }, items }),
      };
    });
    global.fetch = fetchMock as any;

    const { LeadImportAuditReport } = await import("@/pages/LeadImports/LeadImportAuditReport");
    const importA = { id: "import-a", source_name: "Planilha A", imported_rows: 1, skipped_rows: 0, created_at: "2026-09-01T00:00:00Z", source_type: "upload" };
    const importB = { id: "import-b", source_name: "Planilha B", imported_rows: 0, skipped_rows: 1, created_at: "2026-09-02T00:00:00Z", source_type: "upload" };

    const { rerenderWithProviders } = renderWithProviders(
      <LeadImportAuditReport activeClientId="sonhare" imports={[importA]} onSelectImportForFollowup={vi.fn()} />
    );

    await screen.findByText("Lead da Planilha A");
    expect(screen.getByRole("button", { name: /^Número inválido/ })).toBeTruthy();

    // clica no motivo (filtro ativo) e SÓ DEPOIS troca de planilha — prova
    // que o filtro antigo também não sobrevive, não só os dados
    fireEvent.click(screen.getByRole("button", { name: /^Número inválido/ }));
    await waitFor(() => expect(screen.getByText("Lead da Planilha A")).toBeTruthy());

    // a planilha ativa some da lista disponível (ex.: parent recarregou a
    // lista de planilhas) — simula a troca sem depender do Select do Radix,
    // que é notoriamente instável em jsdom.
    rerenderWithProviders(
      <LeadImportAuditReport activeClientId="sonhare" imports={[importB]} onSelectImportForFollowup={vi.fn()} />
    );

    await waitFor(() => expect(screen.getByText("Lead da Planilha B")).toBeTruthy());
    expect(screen.queryByText("Lead da Planilha A")).toBeNull();
    expect(screen.queryByText(/^Número inválido/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Identificador de grupo do WhatsApp bloqueado/ })).toBeTruthy();
  });
});
