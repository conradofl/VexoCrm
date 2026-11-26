// frontend/src/test/repeatContactsGuard.test.tsx
//
// Lead que já recebeu OUTRA campanha (26/11/2026, Advocacia Almeida: campanha nova com a mesma planilha mandou de novo).
// "⚡ Disparar Lote N Agora" confere antes; com repetido, pergunta "pular ou enviar de novo", grava a escolha e só então
// dispara. "Não disparar" não dispara. Lote parado pelo agendador esperando a decisão mostra a faixa com os dois botões.
// Hooks reais; só o fetch é simulado.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: any[]) => toastMock(...args),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: async () => "tok" }),
}));

const summaryMockFn = vi.fn();
vi.mock("@/hooks/useCampanhas", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useDispatchSummary: (_clientId: any, scope: string) => summaryMockFn(scope),
    useCampaignDispatchBulkAction: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRestoreCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

const DETAILS = {
  localTime: "18:38",
  start: "08:00",
  end: "18:30",
  days: ["mon", "tue", "wed", "thu", "fri"],
  timezone: "America/Sao_Paulo",
  sendWindow: "08:00–18:30 [mon,tue,wed,thu,fri] (America/Sao_Paulo)",
  nextOpening: "2026-11-02T11:00:00.000Z",
  nextOpeningLocal: "08:00 (2/11)",
};

function jsonResponse(status: number, body: any) {
  const res: any = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
  };
  res.clone = () => res;
  return res;
}

let triggerBodies: any[] = [];
let decisoes: any[] = [];
let repetidos: any = { pendentes: 4, jaReceberam: 0, campanhas: [], decisao: null };
let batchError: string | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  triggerBodies = [];
  decisoes = [];
  repetidos = { pendentes: 4, jaReceberam: 0, campanhas: [], decisao: null };
  batchError = null;
  globalThis.fetch = vi.fn().mockImplementation(async (url: string, options?: any) => {
    const u = String(url);
    if (u.endsWith("/trigger")) {
      triggerBodies.push(options?.body ? JSON.parse(options.body) : {});
      return jsonResponse(200, { success: true, status: "running" });
    }
    if (u.endsWith("/repeat-contacts")) return jsonResponse(200, repetidos);
    if (u.endsWith("/repeat-contacts-decision")) {
      const body = JSON.parse(options.body);
      decisoes.push(body.decisao);
      return jsonResponse(200, { ok: true, decisao: body.decisao, lotesLiberados: 1 });
    }
    return jsonResponse(200, {});
  }) as any;
  const campaign = {
    campaignId: "c-1",
    campaignName: "Funil GD",
    chipName: "GD Gabriel",
    loteCount: 1,
    leadsTotal: 7,
    leadsPending: 7,
    sentTotal: 0,
    failedTotal: 0,
    repliedCount: 0,
    status: "agendada",
    statusLabel: "Agendada",
    nextScheduledAt: null,
    eta: { isToday: true, weekday: "sex", label: "hoje, por volta das 18h" },
    leadsActionable: { pause: 0, resume: 0, cancel: 7 },
    batches: [{ id: "batch-1", status: batchError ? "paused" : "scheduled", errorMessage: batchError, sentCount: 0, failedCount: 0, targetCount: 7, scheduledAt: null, createdAt: "2026-10-30T00:00:00Z" }],
  };
  summaryMockFn.mockImplementation((scope: string) => {
    const campaigns = scope === "active" ? [{ ...campaign, batches: [{ ...campaign.batches[0], status: batchError ? "paused" : "scheduled", errorMessage: batchError }] }] : [];
    return {
      isLoading: false,
      data: {
        campaigns,
        counts: { active: 1, ended: 0, trashed: 0 },
        scope,
        page: 1,
        pageSize: 100,
        totalForScope: campaigns.length,
        kpis: { periodLabel: "últimos 30 dias", campaigns: 1, leads: 7, sent: 0, deliveryRate: 0 },
      },
    };
  });
});

async function renderTracker() {
  const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DispatchCampaignTracker clientId="geracao-digital" onOpenDispatch={vi.fn()} />
    </QueryClientProvider>
  );
}


const clicarDisparar = async () => {
  await renderTracker();
  fireEvent.click(await screen.findByTestId("btn-trigger-batch-1-c-1"));
};

describe("pergunta antes de mandar para quem já recebeu outra campanha", () => {
  it("sem repetido: dispara direto, sem pergunta", async () => {
    await clicarDisparar();
    await waitFor(() => expect(triggerBodies).toHaveLength(1));
    expect(screen.queryByTestId("repeat-contacts-dialog")).toBeNull();
    expect(decisoes).toEqual([]);
  });

  it("com repetido: pergunta com o número e a campanha; 'Pular quem já recebeu' grava 'pular' e dispara", async () => {
    repetidos = { pendentes: 2463, jaReceberam: 1200, campanhas: [{ campaignId: "a", campaignName: "Terço de férias 1", count: 1200 }], decisao: null };
    await clicarDisparar();
    const texto = await screen.findByTestId("repeat-contacts-text");
    expect(texto.textContent).toContain("1200 lead(s) dos 2463");
    expect(texto.textContent).toContain('"Terço de férias 1" (1200)');
    expect(triggerBodies).toHaveLength(0);
    fireEvent.click(screen.getByTestId("repeat-contacts-skip"));
    await waitFor(() => expect(triggerBodies).toHaveLength(1));
    expect(decisoes).toEqual(["pular"]);
  });

  it("'Enviar de novo' grava 'enviar' e dispara", async () => {
    repetidos = { pendentes: 4, jaReceberam: 2, campanhas: [{ campaignId: "a", campaignName: "A", count: 2 }], decisao: null };
    await clicarDisparar();
    fireEvent.click(await screen.findByTestId("repeat-contacts-send"));
    await waitFor(() => expect(triggerBodies).toHaveLength(1));
    expect(decisoes).toEqual(["enviar"]);
  });

  it("'Não disparar' não grava nem dispara", async () => {
    repetidos = { pendentes: 4, jaReceberam: 2, campanhas: [{ campaignId: "a", campaignName: "A", count: 2 }], decisao: null };
    await clicarDisparar();
    fireEvent.click(await screen.findByTestId("repeat-contacts-cancel"));
    await new Promise((r) => setTimeout(r, 50));
    expect(triggerBodies).toHaveLength(0);
    expect(decisoes).toEqual([]);
  });

  it("lote parado pelo agendador esperando a decisão: faixa com os dois botões responde e libera", async () => {
    batchError = 'Aguardando sua decisão: leads que já receberam outra campanha: 2 lead(s) deste lote já receberam "A" (2). Escolha pular ou enviar de novo na tela da campanha.';
    await renderTracker();
    const faixa = await screen.findByTestId("repeat-decision-banner-c-1");
    expect(faixa.textContent).toContain('2 lead(s) deste lote já receberam "A" (2).');
    fireEvent.click(screen.getByTestId("repeat-decision-skip"));
    await waitFor(() => expect(decisoes).toEqual(["pular"]));
  });
});
