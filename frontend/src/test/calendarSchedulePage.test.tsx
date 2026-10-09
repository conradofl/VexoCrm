import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CalendarSchedule from "@/pages/CalendarSchedule";
import FollowupCalendar from "@/components/followup/FollowupCalendar";

const mockUseFollowupCalendarMonth = vi.fn();
const mockUseFollowupCalendarDay = vi.fn();
const mockCancelJob = vi.fn();

vi.mock("@/lib/api", () => ({
  fetchApi: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    getIdToken: vi.fn().mockResolvedValue("mock-token"),
  }),
}));

vi.mock("@/hooks/useCrmClient", () => ({
  useOptionalCrmClient: () => ({
    selectedClientId: "tenant-demo",
    selectedClient: { id: "tenant-demo", name: "Empresa Demo" },
    clients: [{ id: "tenant-demo", name: "Empresa Demo" }],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useFollowupAdmin", () => ({
  useFollowupCalendarMonth: (...args: any[]) => mockUseFollowupCalendarMonth(...args),
  useFollowupCalendarDay: (...args: any[]) => mockUseFollowupCalendarDay(...args),
}));

vi.mock("@/hooks/useFollowupQueue", () => ({
  useCancelFollowupJob: () => ({
    mutateAsync: mockCancelJob,
    isPending: false,
  }),
}));

describe("CalendarSchedule & FollowupCalendar Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseFollowupCalendarMonth.mockReturnValue({
      data: {
        tenantId: "tenant-demo",
        month: "2026-10",
        dayCounts: { "2026-10-26": 2 },
        dayBreakdown: {
          "2026-10-26": {
            followupCount: 1,
            campaignCount: 1,
            campaignLeadsTotal: 1200,
            total: 2,
          },
        },
      },
      isLoading: false,
    });

    mockUseFollowupCalendarDay.mockReturnValue({
      data: {
        tenantId: "tenant-demo",
        date: "2026-10-26",
        items: [
          {
            jobId: "job-1",
            scheduleId: "sched-1",
            campaignId: "cad-1",
            campaignName: "Cadência Reativação",
            templateName: "Passo 1",
            leadName: "João da Silva",
            phone: "5534999990001",
            scheduledFor: "2026-10-26T14:30:00.000Z",
            status: "pending",
          },
        ],
        followups: [
          {
            jobId: "job-1",
            scheduleId: "sched-1",
            campaignId: "cad-1",
            campaignName: "Cadência Reativação",
            templateName: "Passo 1",
            leadName: "João da Silva",
            phone: "5534999990001",
            scheduledFor: "2026-10-26T14:30:00.000Z",
            status: "pending",
          },
        ],
        campaigns: [
          {
            dispatchId: "disp-1",
            campaignId: "camp-1",
            campaignName: "Campanha Black Friday",
            dispatchName: "Lote 1",
            targetCount: 1200,
            scheduledAt: "2026-10-26T10:00:00.000Z",
            status: "scheduled",
          },
        ],
      },
      isLoading: false,
    });
  });

  it("renderiza a página CalendarSchedule com PageShell e título apropriado", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CalendarSchedule />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByRole("heading", { name: "Calendário de Envios" })).toBeDefined();
    expect(
      screen.getByText("Visão unificada de campanhas em massa e cadências de follow-up programadas")
    ).toBeDefined();
  });

  it("exibe filtros rápidos [Todos], [Apenas Campanhas] e [Apenas Follow-ups]", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CalendarSchedule />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByRole("button", { name: "Todos" })).toBeDefined();
    expect(screen.getByRole("button", { name: /Apenas Campanhas/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Apenas Follow-ups/i })).toBeDefined();
  });

  it("exibe campanhas e follow-ups no painel do dia ao clicar em uma data", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CalendarSchedule />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Clicar no dia 26
    const dayBtn = screen.getByRole("button", { name: /26/i });
    fireEvent.click(dayBtn);

    // Seção de Campanhas Programadas
    expect(screen.getByText("Campanhas Programadas")).toBeDefined();
    expect(screen.getByText("Campanha Black Friday")).toBeDefined();
    expect(screen.getByText("1.200")).toBeDefined();
    expect(screen.getByText("Ver campanha")).toBeDefined();

    // Seção de Follow-ups Individuais
    expect(screen.getByText("Follow-ups Individuais")).toBeDefined();
    expect(screen.getByText("João da Silva")).toBeDefined();
    expect(screen.getByText("Abrir conversa")).toBeDefined();
    expect(screen.getByText("Cancelar envio")).toBeDefined();

    // Link para o WhatsApp
    const waLink = screen.getByText("Abrir conversa").closest("a");
    expect(waLink?.getAttribute("href")).toContain("/crm/whatsapp?phone=5534999990001");
  });

  it("filtra as seções do painel do dia conforme o filtro selecionado", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CalendarSchedule />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Seleciona o dia 26
    fireEvent.click(screen.getByRole("button", { name: /26/i }));

    // Ambos visíveis no modo Todos
    expect(screen.getByText("Campanha Black Friday")).toBeDefined();
    expect(screen.getByText("João da Silva")).toBeDefined();

    // Filtra apenas campanhas
    fireEvent.click(screen.getByRole("button", { name: /Apenas Campanhas/i }));
    expect(screen.getByText("Campanha Black Friday")).toBeDefined();
    expect(screen.queryByText("João da Silva")).toBeNull();

    // Filtra apenas follow-ups
    fireEvent.click(screen.getByRole("button", { name: /Apenas Follow-ups/i }));
    expect(screen.queryByText("Campanha Black Friday")).toBeNull();
    expect(screen.getByText("João da Silva")).toBeDefined();

    // Volta para todos
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(screen.getByText("Campanha Black Friday")).toBeDefined();
    expect(screen.getByText("João da Silva")).toBeDefined();
  });
});
