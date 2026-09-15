import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FollowupQueueTable } from "@/components/followup/FollowupQueueTable";

// Mock do contexto de autenticação
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    getIdToken: vi.fn().mockResolvedValue("mock-token"),
  }),
}));

// Mock do hook de campanhas
vi.mock("@/hooks/useFollowupAdmin", () => ({
  useFupCampaigns: () => ({
    data: [
      { id: "camp-1", name: "Lembretes Reunião 7d-3d-1d" },
      { id: "camp-2", name: "Recuperação de Proposta" },
    ],
  }),
}));

// Mock do hook useFollowupQueue
vi.mock("@/hooks/useFollowupQueue", () => ({
  useFollowupQueue: () => ({
    data: {
      items: [
        {
          id: "sched-1",
          leadName: "João da Silva",
          phone: "5511999998888",
          origin: "manual",
          companyId: "comp-1",
          companyName: "Geração Digital",
          campaignId: "camp-1",
          campaignName: "Lembretes Reunião 7d-3d-1d",
          status: "active",
          jobsSent: 1,
          jobsFailed: 0,
          jobsPending: 1,
          totalSteps: 2,
          currentStep: 2,
          lastSentAt: "2026-08-27T16:00:00Z",
          nextScheduledFor: "2026-08-27T18:00:00Z",
          lastErrorLog: null,
          meetingDatetime: "2026-08-30T14:00:00Z",
          createdAt: "2026-08-27T15:50:00Z",
        },
        {
          id: "sched-2",
          leadName: "Maria Oliveira",
          phone: "5511988887777",
          origin: "manual",
          companyId: "comp-1",
          companyName: "Geração Digital",
          campaignId: "camp-2",
          campaignName: "Recuperação de Proposta",
          status: "failed",
          jobsSent: 0,
          jobsFailed: 1,
          jobsPending: 0,
          totalSteps: 1,
          currentStep: 1,
          lastSentAt: null,
          nextScheduledFor: null,
          lastErrorLog: 'Evolution API 404: The "geracao-digital-geracao-digital" instance does not exist',
          meetingDatetime: null,
          createdAt: "2026-08-27T16:10:00Z",
        },
        {
          id: "sched-3",
          leadName: "Carlos Cancelado",
          phone: "5511977776666",
          origin: "manual",
          companyId: "comp-1",
          companyName: "Geração Digital",
          campaignId: "camp-1",
          campaignName: "Lembretes Reunião 7d-3d-1d",
          status: "cancelled",
          jobsSent: 0,
          jobsFailed: 0,
          jobsPending: 0,
          totalSteps: 1,
          currentStep: 1,
          lastSentAt: null,
          nextScheduledFor: null,
          lastErrorLog: null,
          meetingDatetime: null,
          createdAt: "2026-08-27T16:20:00Z",
        },
      ],
      total: 3,
    },
    isLoading: false,
    refetch: vi.fn(),
  }),
  useRetryFollowupStep: () => ({
    mutateAsync: vi.fn(),
  }),
  useDiscardFollowup: () => ({
    mutateAsync: vi.fn(),
  }),
  useDeleteFollowup: () => ({
    mutateAsync: vi.fn(),
  }),
  useRescheduleFollowup: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useCancelFollowupJob: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useConvertToInbound: () => ({
    mutateAsync: vi.fn(),
  }),
}));

describe("FollowupQueueTable Component", () => {
  it("renders scheduled lead items with step progress, date and status", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <FollowupQueueTable companyId="comp-1" tenantId="geracao-digital" />
      </QueryClientProvider>
    );

    expect(screen.getByText("João da Silva")).toBeDefined();
    expect(screen.getByText("5511999998888")).toBeDefined();
    expect(screen.getByText("Passo 2 de 2")).toBeDefined();
    expect(screen.getByText("Agendado")).toBeDefined();
    // Exibe botão de Editar para agendamento ativo
    expect(screen.getByText("Editar")).toBeDefined();
  });

  it("surfaces exact failure error log on failed job rows", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <FollowupQueueTable companyId="comp-1" tenantId="geracao-digital" />
      </QueryClientProvider>
    );

    expect(screen.getByText("Maria Oliveira")).toBeDefined();
    expect(screen.getByText("Falhou")).toBeDefined();
    // Exibe o motivo exato do erro na interface
    expect(
      screen.getByText(/Evolution API 404: The "geracao-digital-geracao-digital" instance does not exist/)
    ).toBeDefined();
    // Exibe botão de reenviar
    expect(screen.getByText("Reenviar")).toBeDefined();
  });

  it("hides cancelled and completed items by default and shows discrete counter", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <FollowupQueueTable companyId="comp-1" tenantId="geracao-digital" />
      </QueryClientProvider>
    );

    // O item cancelado fica oculto por padrão
    expect(screen.queryByText("Carlos Cancelado")).toBeNull();
    // Exibe banner discreto de itens ocultos
    expect(screen.getByText(/1 item\(ns\) cancelados ou concluídos estão ocultos nesta visualização/)).toBeDefined();
  });
});
