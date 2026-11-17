// frontend/src/test/dispatchLoteCaladoMotivo.test.tsx
//
// Lote calado (Nous, 16/11/2026): o lote parou com 8 "Pendente na fila" e a tela não dizia por quê, embora o motor tivesse
// gravado o motivo em error_message. Agora o motivo aparece no cartão do lote e no diálogo de destinatários, no lugar de
// "Pendente na fila"; e "Disparar não processados" pede a mesma confirmação de janela do "Disparar Agora".
// Presença no DOM só; visibilidade e posição estão no harness de Chromium (e2e/harness/lote-calado.harness.pw.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describeDispatchStop, describePendingRecipient } from "@/components/campaigns/DispatchStopReason";
import { OutsideSendWindowError, postDispatchRunPending } from "@/lib/dispatchTrigger";

const MOTIVO_CHIP = "Pausado — chip desconectado (Chip 2-NOUS). Reconecte o chip em Conexões para retomar.";
const MOTIVO_CHIP_CURTO = "Pausado — chip desconectado (Chip 2-NOUS)";
const JANELA = {
  localTime: "20:22",
  start: "08:00",
  end: "20:00",
  days: ["mon", "tue", "wed", "thu", "fri"],
  timezone: "America/Sao_Paulo",
  sendWindow: "08:00–20:00 [mon,tue,wed,thu,fri] (America/Sao_Paulo)",
  nextOpening: "2026-11-17T11:00:00.000Z",
  nextOpeningLocal: "08:00 (17/11)",
};

const toastFn = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastFn }) }));
vi.mock("@/components/ui/use-toast", () => ({ toast: (...a: unknown[]) => toastFn(...a) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ getIdToken: async () => "token" }) }));

const estado = vi.hoisted(() => ({
  recipients: null as any,
  runPending: null as any,
  summary: null as any,
  triggerMutate: null as any,
}));

vi.mock("@/hooks/useCampanhas", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useDispatchRecipients: () => ({ data: estado.recipients, isLoading: false, refetch: vi.fn(), isFetching: false }),
    useRetryFailedDispatchLeads: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRunPendingDispatchLeads: () => ({ mutateAsync: estado.runPending, isPending: false }),
    useDispatchSummary: () => estado.summary,
    useCampaignDispatchBulkAction: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRestoreCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useTriggerDispatch: () => ({ mutate: estado.triggerMutate, isPending: false }),
  };
});

function recipientsPausados(overrides: Record<string, unknown> = {}) {
  return {
    dispatchId: "lote-1",
    dispatchName: "Lote 1/50",
    campaignName: "Evento Mesa de Negocios 2 - Planilha 1",
    dispatchStatus: "paused",
    dispatchErrorMessage: MOTIVO_CHIP,
    total: 10,
    sentCount: 0,
    failedCount: 0,
    invalidCount: 2,
    skippedCount: 0,
    pendingCount: 8,
    optedOutPendingCount: 0,
    items: [
      { index: 1, leadId: "l1", nome: "Ana", telefone: "5534990001000", status: "invalid_number", statusLabel: "Número inválido", sentAt: null, attemptedAt: null, failureReason: "Número não existe no WhatsApp", technicalDetails: null, campaignName: "x", dispatchName: "y" },
      { index: 2, leadId: "l2", nome: "Bia", telefone: "5534990001001", status: "pending", statusLabel: "Não processado", sentAt: null, attemptedAt: null, failureReason: null, technicalDetails: null, campaignName: "x", dispatchName: "y" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  toastFn.mockReset();
  estado.recipients = recipientsPausados();
  estado.runPending = vi.fn();
  estado.triggerMutate = vi.fn();
});

describe("describeDispatchStop / describePendingRecipient", () => {
  it("parado (paused, interrupted, failed, agendado com aviso) mostra o motivo gravado", () => {
    expect(describeDispatchStop("paused", MOTIVO_CHIP)).toBe(MOTIVO_CHIP);
    expect(describeDispatchStop("interrupted", "Interrompido: 8 lead(s) pendente(s) de envio.")).toContain("Interrompido");
    expect(describeDispatchStop("scheduled", "Aguardando janela de envio (08:00–20:00, abre 08:00 (17/11))")).toContain("Aguardando janela");
    expect(describeDispatchStop("failed", "Falhou: banco caiu")).toBe("Falhou: banco caiu");
  });

  it("failed sem motivo não fica mudo; rodando e concluído não mostram parada", () => {
    expect(describeDispatchStop("failed", null)).toBe("O lote falhou e o motor não registrou o motivo.");
    expect(describeDispatchStop("running", "qualquer")).toBeNull();
    expect(describeDispatchStop("done", "Chip configurado não encontrado. Enviando por X.")).toBeNull();
    expect(describeDispatchStop("paused", "")).toBeNull();
  });

  it("linha do não processado: primeira frase do motivo, 'na fila' quando roda, e o texto antigo só sem motivo", () => {
    expect(describePendingRecipient("paused", MOTIVO_CHIP)).toBe(MOTIVO_CHIP_CURTO);
    expect(describePendingRecipient("failed", "Falhou: banco caiu")).toBe("Falhou: banco caiu");
    expect(describePendingRecipient("interrupted", "Interrompido: 8 lead(s) pendente(s) de envio. 8 não entrou(aram) na fila.")).toBe(
      "Interrompido: 8 lead(s) pendente(s) de envio"
    );
    expect(describePendingRecipient("running", null)).toBe("Na fila de envio (lote rodando)");
    expect(describePendingRecipient("scheduled", null)).toBe("Pendente na fila");
  });
});

describe("postDispatchRunPending", () => {
  const fetchOriginal = global.fetch;
  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it("422 OUTSIDE_SEND_WINDOW vira OutsideSendWindowError; forceOutsideWindow vai no corpo só quando confirmado", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 422,
      clone() {
        return this;
      },
      json: async () => ({ error: { code: "OUTSIDE_SEND_WINDOW", message: "Fora da janela de envio", details: JANELA } }),
      text: async () => "",
    }));
    global.fetch = fetchMock as any;
    await expect(postDispatchRunPending("token", "lote-1")).rejects.toBeInstanceOf(OutsideSendWindowError);
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toContain("/api/campaigns/dispatches/lote-1/run-pending");
    expect(JSON.parse(init.body)).toEqual({});

    const okMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, pendingCount: 8 }) }));
    global.fetch = okMock as any;
    await postDispatchRunPending("token", "lote-1", { forceOutsideWindow: true });
    expect(JSON.parse((okMock.mock.calls[0] as any)[1].body)).toEqual({ forceOutsideWindow: true });
  });
});

describe("DispatchRecipientsDialog: motivo no lugar de 'Pendente na fila'", () => {
  it("[OBRIGATÓRIO] lote pausado por chip: aviso no topo com o motivo, e a linha do não processado mostra o motivo", async () => {
    const { DispatchRecipientsDialog } = await import("@/pages/LeadImports/DispatchRecipientsDialog");
    render(<DispatchRecipientsDialog dispatchId="lote-1" onClose={vi.fn()} />);
    expect(screen.getByTestId("dispatch-stop-notice").textContent).toContain(MOTIVO_CHIP);
    const linha = screen.getByTestId("pending-recipient-reason");
    expect(linha.textContent).toBe(MOTIVO_CHIP_CURTO);
    expect(screen.queryByText("Pendente na fila")).toBeNull();
  });

  it("lote rodando: sem aviso de parada, linha diz que está na fila de envio", async () => {
    estado.recipients = recipientsPausados({ dispatchStatus: "running", dispatchErrorMessage: null });
    const { DispatchRecipientsDialog } = await import("@/pages/LeadImports/DispatchRecipientsDialog");
    render(<DispatchRecipientsDialog dispatchId="lote-1" onClose={vi.fn()} />);
    expect(screen.queryByTestId("dispatch-stop-notice")).toBeNull();
    expect(screen.getByTestId("pending-recipient-reason").textContent).toBe("Na fila de envio (lote rodando)");
  });

  it("[OBRIGATÓRIO] 'Disparar não processados' fora da janela: abre a confirmação; confirmar repete com forceOutsideWindow", async () => {
    estado.runPending = vi
      .fn()
      .mockRejectedValueOnce(new OutsideSendWindowError("Fora da janela", JANELA))
      .mockResolvedValueOnce({ success: true, message: "8 lead(s) pendente(s) em execução.", pendingCount: 8 });
    const { DispatchRecipientsDialog } = await import("@/pages/LeadImports/DispatchRecipientsDialog");
    render(<DispatchRecipientsDialog dispatchId="lote-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Disparar não processados \(8\)/ }));
    const dialogo = await screen.findByTestId("outside-send-window-dialog");
    expect(within(dialogo).getByTestId("outside-send-window-text").textContent).toContain("Agora são 20:22");
    fireEvent.click(within(dialogo).getByTestId("outside-send-window-force"));
    await waitFor(() => expect(estado.runPending).toHaveBeenCalledTimes(2));
    expect(estado.runPending.mock.calls[0][0]).toEqual({ dispatchId: "lote-1" });
    expect(estado.runPending.mock.calls[1][0]).toEqual({ dispatchId: "lote-1", forceOutsideWindow: true });
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Disparo iniciado" })));
  });

  it("'Disparar não processados' fora da janela e a pessoa desiste: nada é repetido e o aviso diz que nada saiu", async () => {
    estado.runPending = vi.fn().mockRejectedValueOnce(new OutsideSendWindowError("Fora da janela", JANELA));
    const { DispatchRecipientsDialog } = await import("@/pages/LeadImports/DispatchRecipientsDialog");
    render(<DispatchRecipientsDialog dispatchId="lote-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Disparar não processados \(8\)/ }));
    fireEvent.click(await screen.findByTestId("outside-send-window-cancel"));
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Não processados não disparados" }))
    );
    expect(estado.runPending).toHaveBeenCalledTimes(1);
  });
});

describe("Cartão da campanha: motivo do lote e fila de resposta parada", () => {
  function batch(overrides: Record<string, unknown>) {
    return { id: "b", status: "done", sentCount: 0, failedCount: 0, targetCount: 10, scheduledAt: null, createdAt: "2026-11-16T00:00:00Z", ...overrides };
  }
  function campanha(overrides: Record<string, unknown>) {
    return {
      campaignId: "c-nous",
      campaignName: "Evento Mesa de Negocios 2 - Planilha 1",
      chipName: "Chip 2-NOUS",
      loteCount: 2,
      leadsTotal: 20,
      leadsPending: 18,
      sentTotal: 0,
      failedTotal: 0,
      repliedCount: 0,
      status: "agendada",
      statusLabel: "Agendada",
      nextScheduledAt: null,
      eta: null,
      leadsActionable: { pause: 0, resume: 0, cancel: 0 },
      batches: [],
      queueBlock: null,
      ...overrides,
    };
  }
  function montar(c: any) {
    estado.summary = {
      isLoading: false,
      data: {
        campaigns: [c],
        counts: { active: 1, ended: 0, trashed: 0 },
        scope: "active",
        page: 1,
        pageSize: 100,
        totalForScope: 1,
        kpis: { periodLabel: "últimos 30 dias", campaigns: 1, leads: 0, sent: 0, deliveryRate: 0 },
      },
    };
  }
  async function renderTracker() {
    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <DispatchCampaignTracker clientId="nous-gestao" onOpenDispatch={vi.fn()} />
      </QueryClientProvider>
    );
  }

  it("[OBRIGATÓRIO] lote 1 interrompido com motivo: o cartão fechado mostra 'Lote 1: <motivo>' e o botão dispara o lote 1, não o 2", async () => {
    montar(
      campanha({
        batches: [
          batch({ id: "lote-1", status: "paused", errorMessage: MOTIVO_CHIP }),
          batch({ id: "lote-2", status: "scheduled" }),
        ],
      })
    );
    await renderTracker();
    expect(screen.getByTestId("dispatch-stop-notice-c-nous").textContent).toContain(`Lote 1: ${MOTIVO_CHIP}`);
    const botao = screen.getByTestId("btn-trigger-batch-1-c-nous");
    expect(botao.textContent).toContain("Disparar Lote 1 Agora");
    fireEvent.click(botao);
    expect(estado.triggerMutate).toHaveBeenCalledWith("lote-1", expect.any(Object));
  });

  it("lote 1 'interrupted' e lote 2 agendado: antes o botão 'Lote 1' disparava o lote 2; agora dispara o 1", async () => {
    montar(
      campanha({
        batches: [
          batch({ id: "lote-1", status: "interrupted", errorMessage: "Interrompido: 8 lead(s) pendente(s) de envio." }),
          batch({ id: "lote-2", status: "scheduled" }),
        ],
      })
    );
    await renderTracker();
    fireEvent.click(screen.getByTestId("btn-trigger-batch-1-c-nous"));
    expect(estado.triggerMutate).toHaveBeenCalledWith("lote-1", expect.any(Object));
  });

  it("lote concluído sem motivo: nenhum aviso", async () => {
    montar(campanha({ status: "concluida", statusLabel: "Concluída", batches: [batch({ id: "lote-1", status: "done", errorMessage: null })] }));
    await renderTracker();
    expect(screen.queryByTestId("dispatch-stop-notice-c-nous")).toBeNull();
    expect(screen.queryByTestId("queue-block-notice")).toBeNull();
  });

  it("[OBRIGATÓRIO] fila de resposta parada por chip: o cartão mostra o motivo e a próxima tentativa", async () => {
    montar(
      campanha({
        status: "concluida",
        statusLabel: "Concluída",
        batches: [batch({ id: "lote-1", status: "done" })],
        queueBlock: {
          reason: "chip_unavailable",
          message: "Fila de resposta parada: chip nous-gestao-chip-4-nous desconectado (close). Reconecte em Conexões; o sistema tenta de novo sozinho.",
          chipName: "nous-gestao-chip-4-nous",
          connectionState: "close",
          since: "2026-11-16T23:00:00Z",
          retryAfter: "2026-11-16T23:30:00Z",
          attempts: 4,
        },
      })
    );
    await renderTracker();
    const aviso = screen.getByTestId("queue-block-notice");
    expect(aviso.textContent).toContain("chip nous-gestao-chip-4-nous desconectado (close)");
    expect(aviso.textContent).toContain("Próxima tentativa:");
  });
});
