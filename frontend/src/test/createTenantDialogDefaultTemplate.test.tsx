// Criação de empresa: o falso campo "Segmentacao da empresa" saiu. Ele gravava em chatbot_model — a persona do
// agente — a partir de 16 opções fixas, com padrão "energia-solar" (template que não existe). Toda empresa nova nasce
// agora em "generico"; a persona é escolhida depois, na tela do agente, que só oferece template real.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateTenantDialog } from "@/pages/Tenants/CreateTenantDialog";

const mutateAsync = vi.fn(async (payload: { id: string; name: string }) => ({
  id: payload.id,
  name: payload.name,
  leads_table: { exists: true, tableName: "leads" },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasPermission: () => true, isAdminUser: false }),
}));
vi.mock("@/hooks/useLeadClients", () => ({
  useCreateLeadClient: () => ({ mutateAsync, isPending: false }),
}));

function abrirDialogo() {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <CreateTenantDialog onTenantCreated={vi.fn()} />
    </QueryClientProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: /Nova empresa/i }));
}

describe("criar empresa — persona do agente", () => {
  it("o campo 'Segmentacao da empresa' não existe mais", () => {
    abrirDialogo();
    expect(screen.queryByText(/Segmentacao da empresa/i)).toBeNull();
    expect(screen.getByText("Genérico — escolha depois na tela do agente")).toBeTruthy();
  });

  it("[OBRIGATÓRIO] empresa nova é criada com chatbotModel 'generico' (não 'energia-solar', que não existe)", async () => {
    abrirDialogo();
    fireEvent.change(screen.getByLabelText(/Nome da empresa/i), { target: { value: "Condomínio Alfa" } });
    fireEvent.click(screen.getByRole("button", { name: /Criar empresa e tabela/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ name: "Condomínio Alfa", chatbotModel: "generico" });
  });
});
