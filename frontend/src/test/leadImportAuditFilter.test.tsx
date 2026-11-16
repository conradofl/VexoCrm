import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { LeadImportAuditReport } from "@/pages/LeadImports/LeadImportAuditReport";

const mockGetIdToken = vi.fn(async () => "mock-token");
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    clientId: "cliente-teste",
    isAuthenticated: true,
    canAccessView: () => true,
    getIdToken: mockGetIdToken,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
}

const mockImports = [
  {
    id: "imp-123",
    source_name: "Lista Clientes 2026.xlsx",
    created_at: "2026-11-10T10:00:00Z",
    total_rows: 3,
    imported_rows: 3,
  },
];

const mockAuditItems = [
  {
    lead_import_item_id: "item-1",
    import_id: "imp-123",
    telefone: "5534999990001",
    row_number: 1,
    imported: true,
    normalized_data: { nome: "João Silva" },
    delivery_state: "enviado_por_esta_planilha",
    dispatch_count: 1,
    sent_count: 1,
    has_replied: true,
    failure_reason: null,
    last_sent_at: "2026-11-16T14:30:00Z",
    last_sent_message: "Olá João! Segue a proposta especial da Vexo.",
    last_message_text: "Olá João! Segue a proposta especial da Vexo.",
    last_sent_message_at: "2026-11-16T14:30:00Z",
    last_reply_message: "Opa, tenho interesse! Como funciona?",
    last_reply_message_at: "2026-11-16T15:00:00Z",
  },
  {
    lead_import_item_id: "item-2",
    import_id: "imp-123",
    telefone: "5534999990002",
    row_number: 2,
    imported: true,
    normalized_data: { nome: "Maria Oliveira" },
    delivery_state: "pendente",
    dispatch_count: 0,
    sent_count: 0,
    has_replied: false,
    failure_reason: null,
    last_sent_at: null,
    last_sent_message: null,
  },
  {
    lead_import_item_id: "item-3",
    import_id: "imp-123",
    telefone: "5534999990003",
    row_number: 3,
    imported: true,
    normalized_data: { nome: "Carlos Santos" },
    delivery_state: "falhou",
    dispatch_count: 1,
    sent_count: 0,
    has_replied: false,
    failure_reason: "Número sem WhatsApp",
    last_sent_at: null,
    last_sent_message: null,
  },
];

describe("Auditoria de Planilha — Filtro de Enviadas e Visualização de Mensagens", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/campaigns/reports/import-audit") || url.includes("/api/lead-imports/imp-123/audit")) {
          return new Response(
            JSON.stringify({
              items: mockAuditItems,
              legacy_dispatch_campaigns: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      })
    );
  });

  it("renderiza o botão de filtro 'Enviadas' na auditoria de planilha", async () => {
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="cliente-teste"
        imports={mockImports}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    // Seleciona a aba Planilha
    fireEvent.click(screen.getByTestId("audit-target-import"));

    // Aguarda o carregamento dos itens da planilha
    await waitFor(() => {
      expect(screen.getByText("João Silva")).toBeInTheDocument();
    });

    // O botão 'Enviadas' deve estar visível entre os filtros da planilha
    const botaoEnviadas = screen.getByRole("button", { name: /^Enviadas$/i });
    expect(botaoEnviadas).toBeInTheDocument();
  });

  it("ao clicar em 'Enviadas', filtra apenas os leads que receberam disparos", async () => {
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="cliente-teste"
        imports={mockImports}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("audit-target-import"));

    await waitFor(() => {
      expect(screen.getByText("João Silva")).toBeInTheDocument();
      expect(screen.getByText("Maria Oliveira")).toBeInTheDocument();
      expect(screen.getByText("Carlos Santos")).toBeInTheDocument();
    });

    // Clica no filtro 'Enviadas'
    const botaoEnviadas = screen.getByRole("button", { name: /^Enviadas$/i });
    fireEvent.click(botaoEnviadas);

    // Deve exibir apenas João Silva (enviado) e esconder os demais
    await waitFor(() => {
      expect(screen.getByText("João Silva")).toBeInTheDocument();
      expect(screen.queryByText("Maria Oliveira")).not.toBeInTheDocument();
      expect(screen.queryByText("Carlos Santos")).not.toBeInTheDocument();
    });
  });

  it("exibe o texto da mensagem disparada e a resposta do lead na tabela", async () => {
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="cliente-teste"
        imports={mockImports}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("audit-target-import"));

    await waitFor(() => {
      expect(screen.getByText("João Silva")).toBeInTheDocument();
    });

    // Verifica que o texto da mensagem enviada e a resposta aparecem na interface
    expect(screen.getByText(/Olá João! Segue a proposta especial da Vexo/i)).toBeInTheDocument();
    expect(screen.getByText(/Opa, tenho interesse! Como funciona?/i)).toBeInTheDocument();
  });
});
