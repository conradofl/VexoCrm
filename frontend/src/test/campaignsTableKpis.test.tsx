// frontend/src/test/campaignsTableKpis.test.tsx
//
// "O topo de Campanhas, com a mesma lógica, fecha a frente" — CampaignsTable
// ganha os mesmos 4 cartões (campanhas/leads/enviados/taxa), sem "Lotes
// Criados", com o clientId certo.

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const getIdTokenMock = async () => "token";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: getIdTokenMock }),
}));

vi.mock("@/hooks/useCampanhas", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useDispatchSummary: (clientId: string | null) => ({
      isLoading: false,
      data: {
        campaigns: [],
        counts: { active: 2, ended: 5 },
        scope: "active",
        page: 1,
        pageSize: 1,
        totalForScope: 2,
        kpis: { periodLabel: "últimos 30 dias", campaigns: 7, leads: 900, sent: 640, deliveryRate: 92.1 },
      },
    }),
  };
});

describe("CampaignsTable — cartões do topo", () => {
  it("[TESTE OBRIGATÓRIO] mostra campanhas/leads/enviados/taxa de entrega, e nunca 'Lotes Criados'", async () => {
    const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");
    renderWithProviders(
      <CampaignsTable
        clientId="sonhare"
        campaigns={[]}
        loadingCampaigns={false}
        onEditCampaign={vi.fn()}
        onDuplicateCampaign={vi.fn()}
        onDeleteCampaign={vi.fn()}
      />
    );

    expect(await screen.findByText("7")).toBeTruthy(); // campanhas
    expect(screen.getByText("900")).toBeTruthy(); // leads
    expect(screen.getByText("640")).toBeTruthy(); // enviados
    expect(screen.getByText("92.1%")).toBeTruthy(); // taxa
    expect(screen.getAllByText("últimos 30 dias").length).toBe(4);
    expect(screen.queryByText(/Lotes Criados/)).toBeNull();
  });

  it("a lista de campanhas continua funcionando normalmente abaixo dos cartões", async () => {
    const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");
    renderWithProviders(
      <CampaignsTable
        clientId="sonhare"
        campaigns={[{ id: "c1", name: "Campanha A", client_name: "GD", import_id: null, limit_per_run: 20, mode: "disparo", created_at: "2026-09-01T00:00:00Z" } as any]}
        loadingCampaigns={false}
        onEditCampaign={vi.fn()}
        onDuplicateCampaign={vi.fn()}
        onDeleteCampaign={vi.fn()}
      />
    );

    expect(screen.getByText("Campanha A")).toBeTruthy();
  });
});
