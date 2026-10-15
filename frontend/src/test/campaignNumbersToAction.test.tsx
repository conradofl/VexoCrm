// frontend/src/test/campaignNumbersToAction.test.tsx
//
// BLOCO 1 — Números que viram ação: clique nos NumberStats abre modal de destinatários
// com o filtro correto (sent, replied, failed, pending).

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CampaignDetails } from "@/pages/LeadImports/DispatchCampaignTracker";
import { CampaignRecipientsDialog } from "@/pages/LeadImports/CampaignRecipientsDialog";
import type { DispatchSummaryCampaign } from "@/hooks/useCampanhas";

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const showToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: showToast }),
}));

const getIdTokenMock = async () => "token-123";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    getIdToken: getIdTokenMock,
    isAuthenticated: true,
    clientId: "tenant-alpha",
  }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    Link: ({to, children, ...rest}: any) => <a href={to} {...rest}>{children}</a>,
  };
});

const mockRecipientsData = {
  campaignId: "camp-bia-1",
  campaignName: "Bia do Spazio",
  total: 117,
  counts: {
    all: 117,
    sent: 67,
    replied: 32,
    failed: 5,
    pending: 50,
  },
  recipients: [
    {
      leadId: "lead-1",
      nome: "João Silva",
      telefone: "5534999999999",
      status: "sent",
      statusLabel: "Enviado",
      sentAt: "2026-10-15T10:00:00Z",
      replied: true,
      repliedAt: "2026-10-15T10:15:00Z",
      lastInboundText: "Tenho interesse sim!",
      failureReason: null,
      dispatchName: "Lote 1",
    },
    {
      leadId: "lead-2",
      nome: "Carlos Falha",
      telefone: "5534888888888",
      status: "failed",
      statusLabel: "Falhou",
      sentAt: null,
      replied: false,
      repliedAt: null,
      lastInboundText: null,
      failureReason: "Número inválido ou sem WhatsApp",
      dispatchName: "Lote 1",
    },
  ],
};

vi.mock("@/hooks/useCampanhas", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useCampaignDispatchBulkAction: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
    useCampaignRecipients: (campaignId: string | null, statusFilter?: string) => ({
      data: mockRecipientsData,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    }),
  };
});

function makeCampaign(overrides: Partial<DispatchSummaryCampaign> = {}): DispatchSummaryCampaign {
  return {
    campaignId: "camp-bia-1",
    campaignName: "Bia do Spazio",
    status: "em_andamento",
    statusLabel: "Em andamento",
    chipName: "GD Gabriel",
    evolutionInstanceId: "inst-1",
    loteCount: 3,
    sentTotal: 67,
    failedTotal: 5,
    leadsTotal: 117,
    leadsPending: 50,
    leadsActionable: { pause: 50, resume: 0, cancel: 50 },
    repliedCount: 32,
    batches: [],
    eta: null,
    nextScheduledAt: null,
    lastUpdatedAt: "2026-10-15T10:00:00Z",
    ...overrides,
  };
}

describe("BLOCO 1 — Números que viram ação (NumberStat e Diálogo)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ao clicar em 'Enviados', chama onOpenCampaignRecipients com 'sent'", () => {
    const onOpenRecipients = vi.fn();
    const campaign = makeCampaign();

    renderWithProviders(
      <CampaignDetails
        campaign={campaign}
        onOpenDispatch={vi.fn()}
        onOpenCampaignRecipients={onOpenRecipients}
      />
    );

    const sentBtn = screen.getByTestId("stat-sent-camp-bia-1");
    expect(sentBtn).toBeTruthy();
    expect(sentBtn.getAttribute("role")).toBe("button");
    expect(sentBtn.getAttribute("tabindex")).toBe("0");

    fireEvent.click(sentBtn);
    expect(onOpenRecipients).toHaveBeenCalledWith("camp-bia-1", "sent");
  });

  it("ao clicar em 'Responderam', chama onOpenCampaignRecipients com 'replied'", () => {
    const onOpenRecipients = vi.fn();
    const campaign = makeCampaign();

    renderWithProviders(
      <CampaignDetails
        campaign={campaign}
        onOpenDispatch={vi.fn()}
        onOpenCampaignRecipients={onOpenRecipients}
      />
    );

    const repliedBtn = screen.getByTestId("stat-replied-camp-bia-1");
    fireEvent.click(repliedBtn);
    expect(onOpenRecipients).toHaveBeenCalledWith("camp-bia-1", "replied");
  });

  it("ao clicar em 'Falharam', chama onOpenCampaignRecipients com 'failed'", () => {
    const onOpenRecipients = vi.fn();
    const campaign = makeCampaign();

    renderWithProviders(
      <CampaignDetails
        campaign={campaign}
        onOpenDispatch={vi.fn()}
        onOpenCampaignRecipients={onOpenRecipients}
      />
    );

    const failedBtn = screen.getByTestId("stat-failed-camp-bia-1");
    fireEvent.click(failedBtn);
    expect(onOpenRecipients).toHaveBeenCalledWith("camp-bia-1", "failed");
  });

  it("ao clicar em 'Na fila', chama onOpenCampaignRecipients com 'pending'", () => {
    const onOpenRecipients = vi.fn();
    const campaign = makeCampaign();

    renderWithProviders(
      <CampaignDetails
        campaign={campaign}
        onOpenDispatch={vi.fn()}
        onOpenCampaignRecipients={onOpenRecipients}
      />
    );

    const pendingBtn = screen.getByTestId("stat-pending-camp-bia-1");
    fireEvent.click(pendingBtn);
    expect(onOpenRecipients).toHaveBeenCalledWith("camp-bia-1", "pending");
  });

  it("navegação por teclado: Enter ou Espaço no NumberStat ativa o clique", () => {
    const onOpenRecipients = vi.fn();
    const campaign = makeCampaign();

    renderWithProviders(
      <CampaignDetails
        campaign={campaign}
        onOpenDispatch={vi.fn()}
        onOpenCampaignRecipients={onOpenRecipients}
      />
    );

    const sentBtn = screen.getByTestId("stat-sent-camp-bia-1");
    fireEvent.keyDown(sentBtn, { key: "Enter" });
    expect(onOpenRecipients).toHaveBeenCalledWith("camp-bia-1", "sent");

    fireEvent.keyDown(sentBtn, { key: " " });
    expect(onOpenRecipients).toHaveBeenCalledTimes(2);
  });

  it("CampaignRecipientsDialog renderiza detalhes, badge de resposta com citação e botão WhatsApp", () => {
    renderWithProviders(
      <CampaignRecipientsDialog
        campaignId="camp-bia-1"
        initialFilter="sent"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Destinatários da Campanha/)).toBeTruthy();
    expect(screen.getByText(/Bia do Spazio/)).toBeTruthy();
    expect(screen.getByText("Exportar CSV")).toBeTruthy();

    // Abas de contagem
    expect(screen.getByText("Todos (117)")).toBeTruthy();
    expect(screen.getByText("Enviados (67)")).toBeTruthy();
    expect(screen.getByText("Responderam (32) ✨")).toBeTruthy();
    expect(screen.getByText("Falharam (5)")).toBeTruthy();
    expect(screen.getByText("Na Fila (50)")).toBeTruthy();

    // Linha do lead que respondeu
    expect(screen.getByText("João Silva")).toBeTruthy();
    expect(screen.getByText("5534999999999")).toBeTruthy();
    expect(screen.getByText(/Respondeu às/)).toBeTruthy();
    expect(screen.getByText(/“Tenho interesse sim!”/)).toBeTruthy();

    // Botão de abrir no WhatsApp com deep link correto
    const waLink = screen.getAllByRole("link", { name: /WhatsApp/i })[0];
    expect(waLink).toBeTruthy();
    expect(waLink.getAttribute("href")).toContain("/crm/whatsapp?chatId=5534999999999");
  });
});
