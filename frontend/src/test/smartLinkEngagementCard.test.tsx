// frontend/src/test/smartLinkEngagementCard.test.tsx
// Suíte de testes para o componente SmartLinkEngagementCard (Etapa 3)
// Valida: Renderização do grid de métricas, leads mais quentes, formatação de telefone,
// botão de WhatsApp com link direto, empty state e loading state.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SmartLinkEngagementCard } from "../components/dashboard/SmartLinkEngagementCard";
import * as smartLinksHook from "../hooks/useSmartLinks";

vi.mock("../hooks/useSmartLinks", async () => {
  const actual = await vi.importActual("../hooks/useSmartLinks");
  return {
    ...actual,
    useSmartLinkMetrics: vi.fn(),
  };
});

describe("SmartLinkEngagementCard Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renderiza skeleton durante o carregamento inicial", () => {
    vi.mocked(smartLinksHook.useSmartLinkMetrics).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    const { container } = render(<SmartLinkEngagementCard clientId="tenant-123" />);
    // Deve conter classes de Skeleton do Tailwind
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renderiza métricas e ranking de leads mais quentes com sucesso", () => {
    const mockMetrics: smartLinksHook.SmartLinkMetrics = {
      totalLinks: 10,
      totalClicks: 142,
      uniqueLeadsClicked: 45,
      ctr: 45.0,
      clicksLast24h: 18,
      periodDays: 30,
      topLeads: [
        {
          leadId: "lead-1",
          leadNome: "Carlos Eduardo Oliveira",
          leadTelefone: "5511999998888",
          linkCode: "k9x2m",
          destinationUrl: "https://vexoia.com/proposta",
          linkTitle: "Proposta Executiva",
          clicksCount: 5,
          lastClickedAt: "2026-10-08T12:00:00Z",
          campaignId: "camp-1",
          campaignName: "Campanha VIP",
        },
        {
          leadId: "lead-2",
          leadNome: "Ana Beatriz",
          leadTelefone: "11988887777",
          linkCode: "p7y3q",
          destinationUrl: "https://vexoia.com/catalogo",
          linkTitle: null,
          clicksCount: 1,
          lastClickedAt: "2026-10-08T10:00:00Z",
          campaignId: null,
          campaignName: null,
        },
      ],
    };

    vi.mocked(smartLinksHook.useSmartLinkMetrics).mockReturnValue({
      data: mockMetrics,
      isLoading: false,
      error: null,
    } as any);

    render(<SmartLinkEngagementCard clientId="tenant-123" periodDays={30} />);

    // Cabeçalho
    expect(screen.getByText("Engajamento de Links & Cliques")).toBeInTheDocument();
    expect(screen.getByText("Tempo Real")).toBeInTheDocument();

    // Métricas do Grid
    expect(screen.getByText("142")).toBeInTheDocument(); // Total de cliques
    expect(screen.getByText("10 links gerados")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument(); // Leads únicos
    expect(screen.getByText("(45.0%)")).toBeInTheDocument(); // CTR
    expect(screen.getByText("18")).toBeInTheDocument(); // Últimas 24h

    // Leads Mais Quentes
    expect(screen.getByText("Carlos Eduardo Oliveira")).toBeInTheDocument();
    expect(screen.getByText("Campanha VIP")).toBeInTheDocument();
    expect(screen.getByText("5 cliques")).toBeInTheDocument();

    expect(screen.getByText("Ana Beatriz")).toBeInTheDocument();
    expect(screen.getByText("1 clique")).toBeInTheDocument();

    // Botão de ação rápida WhatsApp
    const waButtons = screen.getAllByRole("button", { name: /Conversar no WhatsApp/i });
    expect(waButtons.length).toBe(2);

    // Testa clique no WhatsApp abrindo https://wa.me/5511999998888
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    fireEvent.click(waButtons[0]);
    expect(windowOpenSpy).toHaveBeenCalledWith(
      "https://wa.me/5511999998888",
      "_blank",
      "noopener,noreferrer"
    );
    windowOpenSpy.mockRestore();
  });

  it("renderiza empty state amigável quando nenhum link foi gerado no período", () => {
    const emptyMetrics: smartLinksHook.SmartLinkMetrics = {
      totalLinks: 0,
      totalClicks: 0,
      uniqueLeadsClicked: 0,
      ctr: 0,
      clicksLast24h: 0,
      periodDays: 30,
      topLeads: [],
    };

    vi.mocked(smartLinksHook.useSmartLinkMetrics).mockReturnValue({
      data: emptyMetrics,
      isLoading: false,
      error: null,
    } as any);

    render(<SmartLinkEngagementCard clientId="tenant-123" />);

    expect(screen.getByText("Nenhum link rastreado no período")).toBeInTheDocument();
    expect(
      screen.getByText(/Ao disparar campanhas com links, o Vexo OS converte URLs automaticamente/i)
    ).toBeInTheDocument();
  });

  it("renderiza aviso quando existem links disparados porém nenhum clique ocorreu ainda", () => {
    const zeroClicksMetrics: smartLinksHook.SmartLinkMetrics = {
      totalLinks: 4,
      totalClicks: 0,
      uniqueLeadsClicked: 0,
      ctr: 0,
      clicksLast24h: 0,
      periodDays: 30,
      topLeads: [],
    };

    vi.mocked(smartLinksHook.useSmartLinkMetrics).mockReturnValue({
      data: zeroClicksMetrics,
      isLoading: false,
      error: null,
    } as any);

    render(<SmartLinkEngagementCard clientId="tenant-123" />);

    expect(
      screen.getByText(/4 links disparados, mas ainda sem nenhum clique registrado/i)
    ).toBeInTheDocument();
  });
});
