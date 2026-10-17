import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeadImportAuditReport } from "@/pages/LeadImports/LeadImportAuditReport";

const getIdTokenMock = async () => "test-token";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: getIdTokenMock }),
}));

const mockToast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("LeadImportAuditReport — Ações de Excluir e Resetar Disparos", () => {
  const mockItems = [
    {
      delivery_state: "falhou",
      duplicate_of_row: null,
      lead_import_item_id: "lead-item-uuid-1",
      import_id: "import-1",
      telefone: "5534910000001",
      normalized_data: { nome: "Lead Alpha" },
      imported_at: "2026-09-01T00:00:00Z",
      row_number: 1,
      imported: true,
      skip_reason: null,
      dispatch_count: 1,
      last_sent_at: null,
      last_attempt_at: "2026-09-10T00:00:00Z",
      last_status: "failed",
      last_error_message: "Erro no disparo",
      has_replied: false,
      failure_reason: "Erro no disparo",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockImplementation(() => true);
  });

  it("exibe o botão 'Resetar Disparos' ao selecionar leads e dispara POST para reset-dispatch-history", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/campaigns/reports/import-audit")) {
        return {
          ok: true,
          headers: { get: () => "application/json" },
          json: async () => ({
            import: { id: "import-1", source_name: "Planilha Teste", created_at: "2026-09-01T00:00:00Z" },
            items: mockItems,
          }),
        };
      }
      if (urlStr.includes("/api/campaigns/reports/reset-dispatch-history")) {
        return {
          ok: true,
          headers: { get: () => "application/json" },
          json: async () => ({ success: true, resetCount: 1 }),
        };
      }
      return { ok: true, headers: { get: () => "application/json" }, json: async () => ({}) };
    });
    global.fetch = fetchMock as any;

    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="test-client"
        imports={[{ id: "import-1", source_name: "Planilha Teste", imported_rows: 1, skipped_rows: 0, created_at: "2026-09-01T00:00:00Z", source_type: "upload" }]}
        campaigns={[]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    // Aguarda carregar
    await screen.findByText("Lead Alpha");

    // Seleciona o checkbox da linha
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(0);
    // Checkbox da linha (o segundo, após o select-all no cabeçalho)
    fireEvent.click(checkboxes[checkboxes.length - 1]);

    // O botão Resetar Disparos (1) deve aparecer
    const resetButton = await screen.findByText(/Resetar Disparos \(1\)/i);
    expect(resetButton).toBeInTheDocument();

    // Clica no botão de Resetar Disparos
    fireEvent.click(resetButton);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/campaigns/reports/reset-dispatch-history"));
      expect(call).toBeDefined();
      expect(call?.[1]?.method).toBe("POST");
      const body = JSON.parse(call?.[1]?.body);
      expect(body.clientId).toBe("test-client");
      expect(body.leadImportItemIds).toEqual(["lead-item-uuid-1"]);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Histórico resetado",
      })
    );
  });

  it("dispara DELETE para delete-import-items ao clicar na lixeira", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/campaigns/reports/import-audit")) {
        return {
          ok: true,
          headers: { get: () => "application/json" },
          json: async () => ({
            import: { id: "import-1", source_name: "Planilha Teste", created_at: "2026-09-01T00:00:00Z" },
            items: mockItems,
          }),
        };
      }
      if (urlStr.includes("/api/campaigns/reports/delete-import-items")) {
        return {
          ok: true,
          headers: { get: () => "application/json" },
          json: async () => ({ success: true, deletedCount: 1 }),
        };
      }
      return { ok: true, headers: { get: () => "application/json" }, json: async () => ({}) };
    });
    global.fetch = fetchMock as any;

    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="test-client"
        imports={[{ id: "import-1", source_name: "Planilha Teste", imported_rows: 1, skipped_rows: 0, created_at: "2026-09-01T00:00:00Z", source_type: "upload" }]}
        campaigns={[]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    await screen.findByText("Lead Alpha");

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[checkboxes.length - 1]);

    const deleteButton = await screen.findByTitle("Excluir leads selecionados da planilha");
    expect(deleteButton).toBeInTheDocument();

    fireEvent.click(deleteButton);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/campaigns/reports/delete-import-items"));
      expect(call).toBeDefined();
      expect(call?.[1]?.method).toBe("DELETE");
      const body = JSON.parse(call?.[1]?.body);
      expect(body.clientId).toBe("test-client");
      expect(body.leadImportItemIds).toEqual(["lead-item-uuid-1"]);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Leads excluídos",
      })
    );
  });
});
