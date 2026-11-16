import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { LeadImportAuditReport } from "@/pages/LeadImports/LeadImportAuditReport";

const getIdTokenMock = async () => "mock-token";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: getIdTokenMock }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
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

const mockCampaigns = [
  {
    id: "camp-auditoria-1",
    client_id: "cliente-vip",
    name: "Campanha Black Friday Audit",
    status: "active" as const,
    audience_type: "tags",
    import_id: null,
    created_at: "2026-10-15T10:00:00Z",
    analytics_meta: {
      message: "Olá! Aproveite as ofertas exclusivas da Black Friday.",
    },
  },
];

const mockRecipientsResponse = {
  campaignId: "camp-auditoria-1",
  campaignName: "Campanha Black Friday Audit",
  total: 3,
  counts: {
    all: 3,
    sent: 2,
    replied: 1,
    failed: 1,
    pending: 0,
  },
  recipients: [
    {
      leadId: "lead-sent-1",
      nome: "Marcos Enviado",
      telefone: "5511999991111",
      status: "sent",
      sentAt: "2026-10-15T11:00:00Z",
      sentMessageText: "Olá Marcos! Segue o link com 40% de desconto.",
      replied: false,
      repliedAt: null,
      lastInboundText: null,
      failureReason: null,
      dispatchName: "Lote 1",
    },
    {
      leadId: "lead-replied-2",
      nome: "Juliana Respondeu",
      telefone: "5511999992222",
      status: "sent",
      sentAt: "2026-10-15T11:05:00Z",
      sentMessageText: "Olá Juliana! Segue seu cupom exclusivo.",
      replied: true,
      repliedAt: "2026-10-15T11:30:00Z",
      lastInboundText: "Obrigada, já estou finalizando a compra!",
      failureReason: null,
      dispatchName: "Lote 1",
    },
    {
      leadId: "lead-failed-3",
      nome: "Roberto Falhou",
      telefone: "5511999993333",
      status: "failed",
      sentAt: null,
      sentMessageText: null,
      replied: false,
      repliedAt: null,
      lastInboundText: null,
      failureReason: "Número desconectado ou sem WhatsApp",
      dispatchName: "Lote 1",
    },
  ],
};

describe("LeadImportAuditReport — Visualização de Mensagens Disparadas na Auditoria de Campanhas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/campaigns/camp-auditoria-1/recipients")) {
        return {
          ok: true,
          headers: { get: () => "application/json" },
          json: async () => mockRecipientsResponse,
        } as any;
      }
      if (urlStr.includes("/api/campaigns")) {
        return {
          ok: true,
          headers: { get: () => "application/json" },
          json: async () => ({ campaigns: mockCampaigns }),
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

  it("exibe o cabeçalho 'MENSAGEM DISPARADA / RESPOSTA / FALHA' e os balões visuais das mensagens enviadas", async () => {
    renderWithProviders(
      <LeadImportAuditReport
        activeClientId="cliente-vip"
        imports={[]}
        campaigns={mockCampaigns as any}
        onSelectImportForFollowup={vi.fn()}
      />
    );

    // Garante que o modo de auditoria por Campanha está selecionado e dados carregados
    await screen.findByTestId("audit-campaign-numbers");

    // O cabeçalho renomeado deve estar presente
    await waitFor(() => {
      expect(
        screen.getByRole("columnheader", { name: /MENSAGEM DISPARADA \/ RESPOSTA \/ FALHA/i })
      ).toBeInTheDocument();
    });

    // 1. Lead enviado (sem resposta): deve mostrar o balão com a mensagem disparada e horário
    await waitFor(() => {
      const sentMsgLead1 = screen.getByTestId("campaign-recipient-sent-msg-lead-sent-1");
      expect(sentMsgLead1).toBeInTheDocument();
      expect(sentMsgLead1).toHaveTextContent("Olá Marcos! Segue o link com 40% de desconto.");
    });

    // 2. Lead que respondeu: deve mostrar a mensagem disparada E o balão de resposta logo abaixo
    const sentMsgLead2 = screen.getByTestId("campaign-recipient-sent-msg-lead-replied-2");
    expect(sentMsgLead2).toBeInTheDocument();
    expect(sentMsgLead2).toHaveTextContent("Olá Juliana! Segue seu cupom exclusivo.");

    const replyMsgLead2 = screen.getByTestId("campaign-recipient-reply-lead-replied-2");
    expect(replyMsgLead2).toBeInTheDocument();
    expect(replyMsgLead2).toHaveTextContent("Obrigada, já estou finalizando a compra!");

    // 3. Lead que falhou: deve mostrar o badge/motivo de falha
    const failureLead3 = screen.getByTestId("campaign-recipient-failure-lead-failed-3");
    expect(failureLead3).toBeInTheDocument();
    expect(failureLead3).toHaveTextContent("Número desconectado ou sem WhatsApp");
  });
});
