import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: any[]) => toastMock(...args),
}));

const fetchApiMock = vi.fn();
vi.mock("@/lib/api", () => ({
  fetchApi: (...args: any[]) => fetchApiMock(...args),
  readApiErrorMessage: vi.fn(),
  readApiJson: vi.fn(),
}));

const contractsData = [
  {
    id: "ct-notif-1",
    status: "gerado",
    created_at: "2026-11-09T10:00:00Z",
    dados: {
      razao_social: "Cliente Solar VIP",
      cnpj: "11.222.333/0001-44",
      representante: "Roberto Dono",
    },
  },
];

vi.mock("@/hooks/useGdContracts", () => ({
  useGdContracts: () => ({
    data: contractsData,
    isLoading: false,
    error: null,
  }),
  useUpdateGdContract: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadSignedContract: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useJuridico", () => ({
  useSendContractToJuridico: () => ({ mutate: vi.fn(), isPending: false }),
  useJuridicoSettings: () => ({ data: {}, isLoading: false }),
  useSaveJuridicoSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    getIdToken: async () => "mock-token-123",
    isAuthenticated: true,
    clientId: "geracao-digital",
    accessProfile: { role: "internal" },
  }),
}));

vi.mock("@/pages/GeracaoDigitalContracts/JuridicoSettingsCard", () => ({
  JuridicoSettingsCard: () => <div data-testid="juridico-settings-mock" />,
}));

vi.mock("@/pages/GeracaoDigitalContracts/GenerateContractDialog", () => ({
  GenerateContractDialog: () => null,
}));

function renderComponent(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ContractsList — Botão Notificar no WhatsApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renderiza o botão 'Notificar no WhatsApp' no cartão expandido e dispara a requisição com sucesso", async () => {
    fetchApiMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        instance: "vexo-adm",
        resultados: [
          { numero: "5534997719779", status: "sent" },
          { numero: "5534991751267", status: "sent" },
        ],
      }),
    });

    const { ContractsList } = await import("@/pages/GeracaoDigitalContracts/ContractsList");
    renderComponent(<ContractsList />);

    // Localiza o card do contrato
    const card = screen.getByTestId("contract-card-ct-notif-1");
    expect(card).toBeTruthy();

    // Expande o card
    const toggleButton = within(card).getByRole("button", { name: /Ver detalhes/i });
    fireEvent.click(toggleButton);

    // Encontra o botão "Notificar no WhatsApp"
    const notifBtn = within(card).getByRole("button", { name: /Notificar no WhatsApp/i });
    expect(notifBtn).toBeTruthy();

    // Clica no botão
    fireEvent.click(notifBtn);

    await waitFor(() => {
      expect(fetchApiMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/gd/contracts/ct-notif-1/notificar-diretoria"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer mock-token-123",
          }),
        })
      );
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Diretoria notificada!",
          description: "Caio e Conrado foram notificados no WhatsApp.",
        })
      );
    });
  });

  it("trata erro da API exibindo toast destrutivo", async () => {
    fetchApiMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: { message: "Falha na Evolution API" },
      }),
    });

    const { ContractsList } = await import("@/pages/GeracaoDigitalContracts/ContractsList");
    renderComponent(<ContractsList />);

    const card = screen.getByTestId("contract-card-ct-notif-1");
    const toggleButton = within(card).getByRole("button", { name: /Ver detalhes/i });
    fireEvent.click(toggleButton);

    const notifBtn = within(card).getByRole("button", { name: /Notificar no WhatsApp/i });
    fireEvent.click(notifBtn);

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Erro ao notificar diretoria",
          description: "Falha na Evolution API",
          variant: "destructive",
        })
      );
    });
  });
});
