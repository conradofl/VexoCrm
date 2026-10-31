// frontend/src/test/dispatchTriggerSendWindow.test.tsx
//
// "⚡ Disparar Lote N Agora" fora da janela de envio. Desde 30/10/2026 a rota responde 422 OUTSIDE_SEND_WINDOW (antes
// ignorava a janela calada: o lote do geracao-digital saiu 18:38 com janela até 18:30). A tela mostra a janela e a
// hora atual e só repete com forceOutsideWindow: true quando a pessoa confirma. Hook useTriggerDispatch real; só o
// fetch (o que sai do navegador) é simulado.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OutsideSendWindowError, postDispatchTrigger } from "@/lib/dispatchTrigger";

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
beforeEach(() => {
  vi.clearAllMocks();
  triggerBodies = [];
  globalThis.fetch = vi.fn().mockImplementation(async (url: string, options?: any) => {
    if (String(url).endsWith("/trigger")) {
      const body = options?.body ? JSON.parse(options.body) : {};
      triggerBodies.push(body);
      if (body.forceOutsideWindow === true) return jsonResponse(200, { success: true, status: "running", forcedOutsideWindow: true });
      return jsonResponse(422, { error: { code: "OUTSIDE_SEND_WINDOW", message: "Fora da janela de envio", details: DETAILS } });
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
    batches: [{ id: "batch-1", status: "scheduled", sentCount: 0, failedCount: 0, targetCount: 7, scheduledAt: null, createdAt: "2026-10-30T00:00:00Z" }],
  };
  summaryMockFn.mockImplementation((scope: string) => {
    const campaigns = scope === "active" ? [campaign] : [];
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

describe("postDispatchTrigger", () => {
  it("422 OUTSIDE_SEND_WINDOW vira OutsideSendWindowError com a janela; sem force o corpo vai vazio", async () => {
    const err = await postDispatchTrigger("tok", "batch-1").catch((e) => e);
    expect(err).toBeInstanceOf(OutsideSendWindowError);
    expect(err.details).toEqual(DETAILS);
    expect(triggerBodies).toEqual([{}]);
  });

  it("outro 422 (campanha sem origem) não vira erro de janela", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(422, { error: { code: "CAMPAIGN_WITHOUT_SOURCE", message: "Esta campanha não tem planilha de origem definida." } })
    ) as any;
    const err = await postDispatchTrigger("tok", "batch-1").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(OutsideSendWindowError);
    expect(err.message).toContain("planilha de origem");
  });
});

describe("⚡ Disparar Lote 1 Agora fora da janela de envio", () => {
  it("mostra a janela e a hora atual; 'Não disparar' não repete o envio e avisa que nada saiu", async () => {
    await renderTracker();
    fireEvent.click(screen.getByTestId("btn-trigger-batch-1-c-1"));

    const texto = await screen.findByTestId("outside-send-window-text");
    expect(texto.textContent).toContain("Agora são 18:38 (America/Sao_Paulo)");
    expect(texto.textContent).toContain("das 08:00 às 18:30, em seg, ter, qua, qui, sex");

    fireEvent.click(screen.getByTestId("outside-send-window-cancel"));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Lote não disparado" }));
    });
    expect(triggerBodies).toEqual([{}]);
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Lote 1 disparado" }));
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Erro ao disparar lote" }));
  });

  it("'Disparar fora da janela' repete com forceOutsideWindow: true e confirma o disparo", async () => {
    await renderTracker();
    fireEvent.click(screen.getByTestId("btn-trigger-batch-1-c-1"));

    fireEvent.click(await screen.findByTestId("outside-send-window-force"));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Lote 1 disparado" }));
    });
    expect(triggerBodies).toEqual([{}, { forceOutsideWindow: true }]);
  });
});
