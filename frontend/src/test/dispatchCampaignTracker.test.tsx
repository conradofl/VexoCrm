// frontend/src/test/dispatchCampaignTracker.test.tsx
//
// "Uma linha por campanha, lote vira quadrado" — Acompanhar Disparos. Abre
// em Ativas, com contagem nas duas abas; cada linha soma a campanha; clicar
// num quadrado abre o lote; a confirmação das ações conta LEADS, não lotes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DISPATCH_SQUARE_STYLES } from "@/hooks/useCampanhas";

vi.mock("@/components/ui/use-toast", () => ({
  toast: vi.fn(),
}));

const bulkActionMutate = vi.fn();
const summaryMockFn = vi.fn();

vi.mock("@/hooks/useCampanhas", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useDispatchSummary: (_clientId: any, scope: string, page: number, pageSize: number) =>
      summaryMockFn(scope, page, pageSize),
    useCampaignDispatchBulkAction: () => ({ mutate: bulkActionMutate, isPending: false }),
  };
});

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function makeBatch(overrides: Partial<any> = {}) {
  return {
    id: "batch-1",
    status: "done",
    sentCount: 10,
    failedCount: 0,
    targetCount: 10,
    scheduledAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<any> = {}) {
  return {
    campaignId: "camp-1",
    campaignName: "Campanha Teste",
    chipName: "GD Gabriel",
    loteCount: 1,
    leadsTotal: 100,
    leadsPending: 20,
    sentTotal: 70,
    failedTotal: 10,
    repliedCount: 15,
    status: "agendada",
    statusLabel: "Agendada",
    nextScheduledAt: null,
    eta: { isToday: false, weekday: "qui", label: "quinta-feira, por volta das 20h" },
    leadsActionable: { pause: 0, resume: 0, cancel: 20 },
    batches: [makeBatch()],
    ...overrides,
  };
}

function setupSummary({ active, ended }: { active: any[]; ended: any[] }) {
  summaryMockFn.mockImplementation((scope: string) => {
    const campaigns = scope === "active" ? active : ended;
    return {
      isLoading: false,
      data: {
        campaigns,
        counts: { active: active.length, ended: ended.length },
        scope,
        page: 1,
        pageSize: scope === "active" ? 100 : 20,
        totalForScope: campaigns.length,
        // Números diferentes dos da linha (70/15/10/20/100), de propósito —
        // pra não colidir com os testes que leem os números da linha.
        kpis: { periodLabel: "últimos 30 dias", campaigns: campaigns.length, leads: 12345, sent: 999, deliveryRate: 87.5 },
      },
    };
  });
}

describe("DispatchCampaignTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[TESTE OBRIGATÓRIO] abre em Ativas, com a contagem das duas abas visível", async () => {
    setupSummary({ active: [makeCampaign()], ended: [makeCampaign({ campaignId: "c2" }), makeCampaign({ campaignId: "c3" })] });
    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    expect(screen.getByText("Ativas (1)")).toBeTruthy();
    expect(screen.getByText("Encerradas (2)")).toBeTruthy();
    expect(screen.getByText("Campanha Teste")).toBeTruthy();
  });

  it("a linha soma a campanha: chip, total de leads, quantidade de lotes, e os quatro números", async () => {
    setupSummary({ active: [makeCampaign()], ended: [] });
    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    expect(screen.getByText(/GD Gabriel/)).toBeTruthy();
    expect(screen.getByText(/100 leads/)).toBeTruthy();
    expect(screen.getByText("70")).toBeTruthy(); // enviados
    expect(screen.getByText("15")).toBeTruthy(); // responderam
    expect(screen.getByText("10")).toBeTruthy(); // falharam
    expect(screen.getByText("20")).toBeTruthy(); // na fila
    expect(screen.getByText(/quinta-feira, por volta das 20h/)).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] clicar num quadrado abre o lote daquele quadrado, reaproveitando a tela de destinatários", async () => {
    const onOpenDispatch = vi.fn();
    setupSummary({
      active: [makeCampaign({ batches: [makeBatch({ id: "lote-especifico" })] })],
      ended: [],
    });
    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={onOpenDispatch} />);

    const squares = screen.getAllByTitle(/Lote 1 — enviado/);
    fireEvent.click(squares[0]);
    expect(onOpenDispatch).toHaveBeenCalledWith("lote-especifico");
  });

  it("[TESTE OBRIGATÓRIO] cada quadrado mostra o número do lote — dá pra dizer 'abre o lote 4', não 'o quarto da esquerda'", async () => {
    setupSummary({
      active: [
        makeCampaign({
          batches: [
            makeBatch({ id: "b1", status: "done" }),
            makeBatch({ id: "b2", status: "done" }),
            makeBatch({ id: "b3", status: "done" }),
            makeBatch({ id: "b4", status: "failed" }),
            makeBatch({ id: "b5", status: "running" }),
          ],
        }),
      ],
      ended: [],
    });
    const onOpenDispatch = vi.fn();
    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={onOpenDispatch} />);

    for (const n of [1, 2, 3, 4, 5]) {
      const square = screen.getByTitle(new RegExp(`^Lote ${n} —`));
      expect(square.textContent).toBe(String(n));
    }
    // clicar no quadrado 4 (falhou) abre exatamente o lote b4, não outro
    fireEvent.click(screen.getByTitle(/Lote 4 — com falha/));
    expect(onOpenDispatch).toHaveBeenCalledWith("b4");
  });

  it("[TESTE OBRIGATÓRIO] lote cancelado dentro de campanha ativa não vira 'na fila' — é o seu próprio estado", async () => {
    // Cenário real: "Cancelar o que falta" atingiu um lote, mas a campanha
    // segue ativa (outro lote ainda pendente). O quadrado cancelado nunca
    // vai sair — contar como "na fila" faria a pessoa contar errado o que
    // falta de verdade.
    setupSummary({
      active: [
        makeCampaign({
          status: "agendada",
          statusLabel: "Agendada",
          batches: [
            makeBatch({ id: "b1", status: "cancelled" }),
            makeBatch({ id: "b2", status: "scheduled" }),
          ],
        }),
      ],
      ended: [],
    });
    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    const cancelado = screen.getByTitle(/^Lote 1 — cancelado/);
    const naFila = screen.getByTitle(/^Lote 2 — na fila/);
    expect(cancelado).toBeTruthy();
    expect(naFila).toBeTruthy();
    // as duas cores precisam ser diferentes — senão viraria a mesma confusão de novo
    expect(cancelado.className).not.toBe(naFila.className);
  });

  it("[TESTE OBRIGATÓRIO] 45 lotes: todos numerados de 1 a 45, sem truncar, sem estourar a página", async () => {
    const batches = Array.from({ length: 45 }, (_, i) => makeBatch({ id: `lote-${i + 1}`, status: i === 44 ? "running" : "done" }));
    setupSummary({
      active: [makeCampaign({ campaignName: "Clínica Estética - Uberlândia", loteCount: 45, leadsTotal: 2031, batches })],
      ended: [],
    });
    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    expect(screen.getByText("45 lotes — clique em um para ver os leads dele")).toBeTruthy();
    for (const n of [1, 23, 45]) {
      const square = screen.getByTitle(new RegExp(`^Lote ${n} —`));
      expect(square.textContent).toBe(String(n));
    }
    expect(screen.getAllByTitle(/^Lote \d+ —/).length).toBe(45);
  });

  it("[TESTE OBRIGATÓRIO] a confirmação de 'Cancelar o que falta' conta LEADS, não lotes", async () => {
    setupSummary({
      active: [makeCampaign({ loteCount: 33, leadsActionable: { pause: 0, resume: 0, cancel: 280 } })],
      ended: [],
    });
    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Cancelar o que falta/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/280 leads/)).toBeTruthy();
    expect(within(dialog).queryByText(/33 lotes/)).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar o que falta" }));
    expect(bulkActionMutate).toHaveBeenCalledWith(
      { campaignId: "camp-1", action: "cancel" },
      expect.any(Object)
    );
  });

  it("botão de ação só aparece quando há leads acionáveis para aquela ação", async () => {
    setupSummary({
      active: [makeCampaign({ leadsActionable: { pause: 0, resume: 0, cancel: 0 }, status: "concluida", statusLabel: "Concluída" })],
      ended: [],
    });
    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Pausar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retomar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancelar o que falta/ })).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] o lote é quadrado, não bolinha — e cada estado tem a cor certa", async () => {
    setupSummary({
      active: [
        makeCampaign({
          batches: [
            makeBatch({ id: "b1", status: "done" }),
            makeBatch({ id: "b2", status: "failed" }),
            makeBatch({ id: "b3", status: "running" }),
            makeBatch({ id: "b4", status: "scheduled" }),
            makeBatch({ id: "b5", status: "cancelled" }),
          ],
        }),
      ],
      ended: [],
    });
    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    // Estrutural: nenhum quadrado de lote usa rounded-full (bolinha). O
    // desenho aprovado pede cantos levemente arredondados, não círculo.
    for (const n of [1, 2, 3, 4, 5]) {
      const square = screen.getByTitle(new RegExp(`^Lote ${n} —`));
      expect(square.className).not.toMatch(/rounded-full/);
    }

    // Enviado — verde; Com falha — vermelho; Saindo agora — azul; Na fila —
    // cinza; Cancelado — cinza mais apagado. Cada cor da lista, no lugar
    // certo, não um tom azul-esverdeado indistinguível pra tudo.
    expect(screen.getByTitle(/^Lote 1 — enviado/).className).toBe(`h-7 w-7 shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold leading-none hover:ring-2 hover:ring-indigo-400 hover:scale-105 transition-all ${DISPATCH_SQUARE_STYLES.enviado}`);
    expect(screen.getByTitle(/^Lote 2 — com falha/).className).toContain(DISPATCH_SQUARE_STYLES.falha);
    expect(screen.getByTitle(/^Lote 3 — saindo agora/).className).toContain(DISPATCH_SQUARE_STYLES.saindo);
    expect(screen.getByTitle(/^Lote 4 — na fila/).className).toContain(DISPATCH_SQUARE_STYLES.fila);
    expect(screen.getByTitle(/^Lote 5 — cancelado/).className).toContain(DISPATCH_SQUARE_STYLES.cancelado);

    expect(DISPATCH_SQUARE_STYLES.enviado).toContain("emerald");
    expect(DISPATCH_SQUARE_STYLES.falha).toContain("rose");
    expect(DISPATCH_SQUARE_STYLES.saindo).toContain("blue-500");
    expect(DISPATCH_SQUARE_STYLES.saindo).not.toContain("indigo");
    expect(DISPATCH_SQUARE_STYLES.fila).toContain("slate");
    expect(DISPATCH_SQUARE_STYLES.cancelado).toContain("slate");
    // apagado de verdade: cancelado não pode ser o MESMO tom que "na fila"
    expect(DISPATCH_SQUARE_STYLES.cancelado).not.toBe(DISPATCH_SQUARE_STYLES.fila);
  });

  it("[TESTE OBRIGATÓRIO] Encerradas com mais campanhas que o tamanho da página mostra paginação", async () => {
    const endedCampaigns = Array.from({ length: 25 }, (_, i) => makeCampaign({ campaignId: `ended-${i}`, campaignName: `Encerrada ${i}` }));
    summaryMockFn.mockImplementation((scope: string) => {
      if (scope === "active") {
        return { isLoading: false, data: { campaigns: [], counts: { active: 0, ended: 25 }, scope, page: 1, pageSize: 100, totalForScope: 0, kpis: { periodLabel: "últimos 30 dias", campaigns: 0, leads: 0, sent: 0, deliveryRate: null } } };
      }
      return {
        isLoading: false,
        data: { campaigns: endedCampaigns.slice(0, 20), counts: { active: 0, ended: 25 }, scope, page: 1, pageSize: 20, totalForScope: 25, kpis: { periodLabel: "últimos 30 dias", campaigns: 25, leads: 0, sent: 0, deliveryRate: null } },
      };
    });
    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    fireEvent.click(screen.getByText("Encerradas (25)"));
    expect(await screen.findByText(/Página 1 de 2/)).toBeTruthy();
  });
});
