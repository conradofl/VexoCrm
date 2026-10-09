import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Eventos from "@/pages/Eventos";
import { getEventCountdown } from "@/pages/Eventos/EventCard";

const mockUseEventos = vi.fn();
const mockCreateMutation = vi.fn();
const mockUpdateMutation = vi.fn();
const mockDeleteMutation = vi.fn();

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
    selectedClientId: "tenant-festas",
    selectedClient: { id: "tenant-festas", name: "Festas & Shows" },
    clients: [{ id: "tenant-festas", name: "Festas & Shows" }],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useEventos", () => ({
  useEventos: (...args: any[]) => mockUseEventos(...args),
  useCreateEvento: () => ({
    mutateAsync: mockCreateMutation,
    isPending: false,
  }),
  useUpdateEvento: () => ({
    mutateAsync: mockUpdateMutation,
    isPending: false,
  }),
  useDeleteEvento: () => ({
    mutateAsync: mockDeleteMutation,
    isPending: false,
  }),
}));

describe("Eventos Page & Subcomponents (Marco 5)", () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getEventCountdown helper", () => {
    it("retorna 'Hoje 🎉' quando o evento é hoje", () => {
      const now = new Date("2026-10-15T12:00:00Z");
      const res = getEventCountdown("2026-10-15T22:00:00Z", now);
      expect(res.label).toBe("Hoje 🎉");
      expect(res.variant).toBe("emerald");
    });

    it("retorna 'Amanhã' quando o evento é no dia seguinte", () => {
      const now = new Date("2026-10-15T12:00:00Z");
      const res = getEventCountdown("2026-10-16T20:00:00Z", now);
      expect(res.label).toBe("Amanhã");
      expect(res.variant).toBe("amber");
    });

    it("retorna 'Em X dias' quando o evento é no futuro", () => {
      const now = new Date("2026-10-15T12:00:00Z");
      const res = getEventCountdown("2026-10-20T22:00:00Z", now);
      expect(res.label).toBe("Em 5 dias");
      expect(res.variant).toBe("indigo");
    });

    it("retorna 'Encerrado' quando o evento é no passado", () => {
      const now = new Date("2026-10-15T12:00:00Z");
      const res = getEventCountdown("2026-10-10T22:00:00Z", now);
      expect(res.label).toBe("Encerrado");
      expect(res.variant).toBe("slate");
    });
  });

  describe("Renderização de Eventos e Cards", () => {
    it("exibe lista de eventos com cards ricos e badges de contagem regressiva", () => {
      const hoje = new Date().toISOString();
      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      mockUseEventos.mockReturnValue({
        data: [
          {
            id: "evt-1",
            client_id: "tenant-festas",
            name: "Baile Sunset",
            date: hoje,
            location: "Espaço Sunset VIP",
            description: "Show principal com DJ e open bar",
            tickets_sold: 450,
            esteiras: {
              esteira1: "enviado",
              esteira2: "processando_prompts",
              esteira5: "aguardando_data",
            },
          },
          {
            id: "evt-2",
            client_id: "tenant-festas",
            name: "Congresso de Tecnologia",
            date: amanha,
            location: "Centro de Convenções",
            tickets_sold: 120,
            esteiras: {
              esteira1: "aguardando_disparo",
              esteira2: "aguardando_vaga",
              esteira5: "aguardando_data",
            },
          },
        ],
        isLoading: false,
        error: null,
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Eventos />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Título e Header
      expect(screen.getByText("Painel de Eventos")).toBeDefined();
      expect(screen.getByText("🎪 Baile Sunset")).toBeDefined();
      expect(screen.getByText("🎪 Congresso de Tecnologia")).toBeDefined();

      // Local e Ingressos
      expect(screen.getByText("Espaço Sunset VIP")).toBeDefined();
      expect(screen.getByText("Centro de Convenções")).toBeDefined();
      expect(screen.getByText("450")).toBeDefined();
      expect(screen.getByText("120")).toBeDefined();

      // Badges de contagem
      expect(screen.getByText("Hoje 🎉")).toBeDefined();
      expect(screen.getByText("Amanhã")).toBeDefined();

      // Esteiras
      expect(screen.getAllByText("Esteira 1 (Pré-venda)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Esteira 2 (VIP)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Esteira 5 (Pós-evento)").length).toBeGreaterThan(0);
    });

    it("exibe estado vazio elegante quando não há eventos", () => {
      mockUseEventos.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Eventos />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(screen.getByText("Nenhum evento cadastrado ainda.")).toBeDefined();
      expect(screen.getByRole("button", { name: /Criar Primeiro Evento/i })).toBeDefined();
    });
  });

  describe("Modal de Criação e Submissão", () => {
    it("abre o modal de criação e submete os dados via mutation", async () => {
      mockUseEventos.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      });
      mockCreateMutation.mockResolvedValueOnce({ id: "evt-criado" });

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Eventos />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Clicar em "Novo Evento"
      const btnNovo = screen.getByRole("button", { name: /Novo Evento/i });
      fireEvent.click(btnNovo);

      // Modal abre
      expect(screen.getByRole("heading", { name: "Criar Novo Evento" })).toBeDefined();

      // Preencher campos
      const nameInput = screen.getByLabelText(/Nome do Evento/i);
      const dateInput = screen.getByLabelText(/Data & Hora/i);
      const locInput = screen.getByLabelText(/Local \/ Espaço/i);

      fireEvent.change(nameInput, { target: { value: "Mega Show 2026" } });
      fireEvent.change(dateInput, { target: { value: "2026-12-31T21:00" } });
      fireEvent.change(locInput, { target: { value: "Estádio Municipal" } });

      // Submeter formulário
      const btnSubmit = screen.getByRole("button", { name: /^Criar Evento$/i });
      fireEvent.click(btnSubmit);

      await waitFor(() => {
        expect(mockCreateMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Mega Show 2026",
            location: "Estádio Municipal",
            clientId: "tenant-festas",
          })
        );
      });
    });
  });

  describe("Exclusão de Evento", () => {
    it("abre o modal de confirmação de exclusão e confirma", async () => {
      mockUseEventos.mockReturnValue({
        data: [
          {
            id: "evt-delete",
            client_id: "tenant-festas",
            name: "Evento para Deletar",
            date: "2026-11-10T20:00:00Z",
            location: "Galpão",
          },
        ],
        isLoading: false,
        error: null,
      });
      mockDeleteMutation.mockResolvedValueOnce({ success: true, id: "evt-delete" });

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Eventos />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Clicar no botão de lixeira (exclusão)
      const deleteBtn = screen.getByTitle("Excluir evento");
      fireEvent.click(deleteBtn);

      // AlertDialog abre
      expect(screen.getByText("Excluir Evento?")).toBeDefined();
      expect(screen.getByText(/Tem certeza de que deseja excluir o evento/i)).toBeDefined();

      // Confirmar exclusão
      const confirmBtn = screen.getByRole("button", { name: "Excluir Evento" });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockDeleteMutation).toHaveBeenCalledWith({
          id: "evt-delete",
          clientId: "tenant-festas",
        });
      });
    });
  });
});
