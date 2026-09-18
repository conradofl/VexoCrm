// frontend/src/test/leadImportAuditReportGrouped.test.tsx
//
// "Agora sim, converta o Relatório & Auditoria" — reaproveita o
// DispatchCampaignTracker (uma linha por campanha), tira "Lotes Criados" e
// o gráfico "Desempenho dos Lotes" (por lote, sem servir por campanha), e
// mantém intocado o detalhe por lead (invalid_number, tentativas, motivo).
//
// Mocka os HOOKS de dados (useDispatchSummary etc.), não o componente — é o
// mesmo padrão já provado em dispatchCampaignTracker.test.tsx, e evita
// qualquer fetch de verdade escapando pro ambiente de teste.

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// getIdToken precisa ser uma referência ESTÁVEL entre renders — o efeito de
// carregar a auditoria (LeadImportAuditReport) tem getIdToken nas próprias
// deps (a AuthContext real memoiza com useCallback). Uma arrow function nova
// a cada chamada de useAuth() reentra o efeito a cada render: loop infinito.
const getIdTokenMock = async () => "token";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: getIdTokenMock }),
}));

vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));

vi.mock("@/hooks/useCampanhas", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useDispatchSummary: () => ({
      isLoading: false,
      data: {
        campaigns: [],
        counts: { active: 0, ended: 0 },
        scope: "active",
        page: 1,
        pageSize: 100,
        totalForScope: 0,
        kpis: { periodLabel: "últimos 30 dias", campaigns: 0, leads: 0, sent: 0, deliveryRate: null },
      },
    }),
    useCampaignDispatchBulkAction: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("LeadImportAuditReport — convertido pro DispatchCampaignTracker", () => {
  it("[TESTE OBRIGATÓRIO] reaproveita o DispatchCampaignTracker — mostra as abas Ativas/Encerradas", async () => {
    const { LeadImportAuditReport } = await import("@/pages/LeadImports/LeadImportAuditReport");
    renderWithProviders(
      <LeadImportAuditReport activeClientId="sonhare" imports={[]} onSelectImportForFollowup={vi.fn()} />
    );

    expect(await screen.findByText("Acompanhar Disparos")).toBeTruthy();
    expect(screen.getByText("Ativas (0)")).toBeTruthy();
    expect(screen.getByText("Encerradas (0)")).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] 'Lotes Criados' e o gráfico 'Desempenho dos Lotes' não existem mais", async () => {
    const { LeadImportAuditReport } = await import("@/pages/LeadImports/LeadImportAuditReport");
    renderWithProviders(
      <LeadImportAuditReport activeClientId="sonhare" imports={[]} onSelectImportForFollowup={vi.fn()} />
    );

    await screen.findByText("Acompanhar Disparos");
    expect(screen.queryByText(/Lotes Criados/)).toBeNull();
    expect(screen.queryByText(/Desempenho dos Lotes/)).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] o detalhe por lead (Relatório & Auditoria de Envios) continua intocado", async () => {
    const { LeadImportAuditReport } = await import("@/pages/LeadImports/LeadImportAuditReport");
    renderWithProviders(
      <LeadImportAuditReport activeClientId="sonhare" imports={[]} onSelectImportForFollowup={vi.fn()} />
    );

    expect(screen.getByText("Relatório & Auditoria de Envios")).toBeTruthy();
    expect(screen.getByText(/Nenhuma planilha importada/)).toBeTruthy();
  });
});
