import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { LeadImportAuditReport } from "@/pages/LeadImports/LeadImportAuditReport";
import { toast } from "@/components/ui/use-toast";

const getIdTokenMock = async () => "mock-token";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: getIdTokenMock }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  toast: vi.fn(),
}));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const mockCampaign = {
  id: "camp-tags-1",
  client_id: "cliente-vip",
  name: "Campanha VIP do CRM (Tags)",
  status: "active" as const,
  audience_type: "tags",
  import_id: null,
  created_at: "2026-10-15T10:00:00Z",
};

const mockRecipientsResponse = {
  campaignId: "camp-tags-1",
  campaignName: "Campanha VIP do CRM (Tags)",
  total: 4,
  counts: {
    all: 4,
    sent: 3,
    replied: 2,
    failed: 1,
    pending: 0,
  },
  recipients: [
    {
      leadId: "lead-1",
      nome: "Carlos Sent",
      telefone: "5511999990001",
      status: "sent",
      sentAt: "2026-10-15T11:00:00Z",
      replied: false,
      repliedAt: null,
      lastInboundText: null,
      failureReason: null,
      dispatchName: "Lote 1",
    },
    {
      leadId: "lead-2",
      nome: "Beatriz Replied",
      telefone: "5511999990002",
      status: "sent",
      sentAt: "2026-10-15T11:05:00Z",
      replied: true,
      repliedAt: "2026-10-15T11:45:00Z",
      lastInboundText: "Gostei da proposta, quero fechar!",
      failureReason: null,
      dispatchName: "Lote 1",
    },
    {
      leadId: "lead-3",
      nome: "Daniel Failed",
      telefone: "5511999990003",
      status: "failed",
      sentAt: null,
      replied: false,
      repliedAt: null,
      lastInboundText: null,
      failureReason: "Número inválido ou sem WhatsApp",
      dispatchName: "Lote 2",
    },
    {
      leadId: "lead-4",
      nome: "Fernanda Replied Extra",
      telefone: "5511999990004",
      status: "sent",
      sentAt: "2026-10-15T11:10:00Z",
      replied: true,
      repliedAt: "2026-10-15T12:00:00Z",
      lastInboundText: "Pode me ligar?",
      failureReason: null,
      dispatchName: "Lote 2",
    },
  ],
};

describe("BLOCO 2 — Relatório & Auditoria Universal por Campanha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/campaigns/camp-tags-1/recipients")) {
        return {
          ok: true,
          headers: { get: () => "application/json" },
          json: async () => mockRecipientsResponse,
        } as any;
      }
      return {
        ok: false,
        status: 404,
        headers: { get: () => "application/json" },
        json: async () => ({ error: "Not found" }),
      } as any;
    });
  });

  it("quando imports estiver vazio (imports={[]}), mas existirem campaigns, o relatório seleciona e exibe dados da campanha sem erro", async () => {
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="cliente-vip"
        imports={[]}
        campaigns={[mockCampaign]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    expect(screen.queryByText("Nenhuma planilha importada")).toBeNull();

    await screen.findByTestId("audit-campaign-numbers");
    expect(screen.getByTestId("stat-campaign-total-value").textContent).toBe("4");
    expect(screen.getByTestId("stat-campaign-sent-value").textContent).toBe("3");
    expect(screen.getByTestId("stat-campaign-replied-value").textContent).toBe("2");
    expect(screen.getByTestId("stat-campaign-failed-value").textContent).toBe("1");
    expect(screen.getByTestId("stat-campaign-pending-value").textContent).toBe("0");

    expect(screen.getByText(/67%/)).toBeTruthy();

    expect(screen.getByText("Carlos Sent")).toBeTruthy();
    expect(screen.getByText("Beatriz Replied")).toBeTruthy();
    expect(screen.getByText("Daniel Failed")).toBeTruthy();
  });

  it("filtragem por status (replied, failed, pending) e busca funcionam na auditoria da campanha", async () => {
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="cliente-vip"
        imports={[]}
        campaigns={[mockCampaign]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    await screen.findByTestId("audit-campaign-numbers");

    // Filtrar por Responderam
    const repliedBtn = screen.getByRole("button", { name: /^Responderam/ });
    fireEvent.click(repliedBtn);

    expect(screen.getByText("Beatriz Replied")).toBeTruthy();
    expect(screen.getByText("Fernanda Replied Extra")).toBeTruthy();
    expect(screen.queryByText("Carlos Sent")).toBeNull();
    expect(screen.queryByText("Daniel Failed")).toBeNull();

    expect(screen.getByText(/Gostei da proposta, quero fechar!/)).toBeTruthy();

    // Filtrar por Falharam
    const failedBtn = screen.getByRole("button", { name: /^Falharam/ });
    fireEvent.click(failedBtn);

    expect(screen.getByText("Daniel Failed")).toBeTruthy();
    expect(screen.queryByText("Beatriz Replied")).toBeNull();
    expect(screen.queryByText("Carlos Sent")).toBeNull();
    expect(screen.getAllByText("Número inválido ou sem WhatsApp").length).toBeGreaterThanOrEqual(1);

    // Voltar para Todos e buscar
    const allBtn = screen.getByRole("button", { name: /^Todos/ });
    fireEvent.click(allBtn);

    const searchInput = screen.getByPlaceholderText("Buscar por nome ou telefone...");
    fireEvent.change(searchInput, { target: { value: "Carlos" } });

    expect(screen.getByText("Carlos Sent")).toBeTruthy();
    expect(screen.queryByText("Beatriz Replied")).toBeNull();
    expect(screen.queryByText("Daniel Failed")).toBeNull();

    fireEvent.change(searchInput, { target: { value: "999990002" } });
    expect(screen.getByText("Beatriz Replied")).toBeTruthy();
    expect(screen.queryByText("Carlos Sent")).toBeNull();
  });

  it("permite filtrar por motivo de falha agrupado na campanha", async () => {
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="cliente-vip"
        imports={[]}
        campaigns={[mockCampaign]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    await screen.findByTestId("audit-campaign-numbers");

    const reasonBtn = screen.getByRole("button", { name: /Número inválido ou sem WhatsApp/ });
    expect(reasonBtn).toBeTruthy();

    fireEvent.click(reasonBtn);
    expect(screen.getByText("Daniel Failed")).toBeTruthy();
    expect(screen.queryByText("Carlos Sent")).toBeNull();
    expect(screen.queryByText("Beatriz Replied")).toBeNull();

    const clearBtn = screen.getByRole("button", { name: /Limpar motivo/ });
    fireEvent.click(clearBtn);
    expect(screen.getByText("Carlos Sent")).toBeTruthy();
  });

  it("exportação CSV da campanha está disponível e dispara download", async () => {
    const createObjectURLMock = vi.fn(() => "blob:mock-url");
    const revokeObjectURLMock = vi.fn();
    global.URL.createObjectURL = createObjectURLMock;
    global.URL.revokeObjectURL = revokeObjectURLMock;

    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="cliente-vip"
        imports={[]}
        campaigns={[mockCampaign]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    await screen.findByTestId("audit-campaign-numbers");

    const exportBtn = screen.getByTestId("export-campaign-csv");
    expect(exportBtn).toBeTruthy();

    fireEvent.click(exportBtn);

    expect(createObjectURLMock).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Relatório exportado!",
      })
    );
  });

  it("exibe botão Abrir no WhatsApp com link para a conversa no CRM", async () => {
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="cliente-vip"
        imports={[]}
        campaigns={[mockCampaign]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    await screen.findByTestId("audit-campaign-numbers");

    const waLinks = screen.getAllByRole("link", { name: /Abrir no WhatsApp/i });
    expect(waLinks.length).toBeGreaterThan(0);
    expect(waLinks[0].getAttribute("href")).toContain("/crm/whatsapp?chatId=5511999990001");
  });

  it("quando não houver campanhas nem planilhas, exibe estado vazio de importação", async () => {
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="cliente-vip"
        imports={[]}
        campaigns={[]}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    expect(await screen.findByText("Nenhuma planilha importada")).toBeTruthy();
  });
});
