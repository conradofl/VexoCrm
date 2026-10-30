// Padrões da Empresa → "Testar webhook": o teste de conexão roda em simulação.
// Antes ele chamava /api/chatbot-test sem telefone e o motor gravava o lead
// fantasma 5500000000000 (visível no Banco, elegível em "selecionar todos") —
// e recriava o fantasma depois de qualquer limpeza.

import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TabGeral } from "@/pages/ChatbotSettings/TabGeral";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ clientId: "container-led", isInternalUser: true, getIdToken: async () => "mock-token" }),
}));

vi.mock("@/hooks/useCrmClient", () => {
  const ctx = { selectedClientId: "container-led", selectedClient: { id: "container-led", name: "Container Led" }, clients: [], isLoading: false };
  return { useCrmClient: () => ctx, useOptionalCrmClient: () => ctx };
});

vi.mock("@/hooks/useLeadClients", () => ({
  useLeadClients: () => ({ data: [], isLoading: false }),
  useUpdateLeadClientN8nSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useChatbotTemplates", () => ({
  useChatbotTemplates: () => ({ data: [], isLoading: false }),
  useBuiltinTemplates: () => ({ data: [], isLoading: false }),
  useLlmModels: () => ({
    data: { models: [], defaultModel: "openai/gpt-oss-120b", providerStatus: { groq: true } },
    isLoading: false,
  }),
  useSaveChatbotTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteChatbotTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const fetchApiMock = vi.fn();
vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...real, fetchApi: (...args: unknown[]) => fetchApiMock(...args) };
});

beforeEach(() => {
  fetchApiMock.mockReset();
  fetchApiMock.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => ({ success: true, response: "Olá!" }),
    text: async () => JSON.stringify({ success: true, response: "Olá!" }),
  });
});

it("[TESTE OBRIGATÓRIO] 'Testar webhook' chama o simulador em simulação (memória vazia), nunca grava lead", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <TabGeral
          clientId="container-led"
          clientName="Container Led"
          client={{ id: "container-led", name: "Container Led", n8n_settings: { chatbot_enabled: true, chatbot_model: "generico" } }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );

  fireEvent.click(screen.getByRole("button", { name: /Testar webhook/ }));

  await waitFor(() => {
    const chamada = fetchApiMock.mock.calls.find(([url]) => url === "/api/chatbot-test");
    expect(chamada).toBeTruthy();
    const body = JSON.parse((chamada![1] as RequestInit).body as string);
    expect(body.simulacao).toEqual({ historico: [], dados: {} });
  });
});
