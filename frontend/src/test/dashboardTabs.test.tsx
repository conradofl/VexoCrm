// frontend/src/test/dashboardTabs.test.tsx
//
// Abas de detalhe do Dashboard (Atendimento, Campanhas, Base de leads, Chips). As regras são as da Visão geral:
// bloco que falhou diz que não deu para calcular (nunca zero), bloco sem fonte não existe, e a aba Atendimento
// mostra os números da fila da tela Conversas, sem refazer a conta.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AttendanceTab, BaseTab, CampaignsTab, ChipsTab, sharePct } from "@/pages/Dashboard/DetailTabs";
import type { DashboardOverview, DashboardPayload, OverviewFirstHumanResponse, OverviewQueue } from "@/hooks/useDashboard";
import {
  buildChipRows,
  buildQueueView,
  buildResponseTimeCard,
  buildWaitHistogram,
  formatDuration,
  waitingMinutes,
} from "@/lib/dashboard/tabs";

const NOW = new Date("2026-11-11T15:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60000).toISOString();

const RESPONSE: OverviewFirstHumanResponse = {
  conversations: 215,
  measured: 191,
  indeterminate: 24,
  coveragePct: 88.8,
  coverageLevel: "ok",
  answered: 149,
  waiting: 42,
  waitingBotOnly: 7,
  waitingOverThreshold: 42,
  answeredWithUnknownBefore: 7,
  thresholdHours: 3,
  waitBuckets: { upTo10m: 90, upTo30m: 25, upTo2h: 14, over2h: 20 },
  medianMinutes: 4.3,
  p90Minutes: 333.8,
};

const QUEUE: OverviewQueue = {
  states: { waiting: 12, withLead: 154, withRobot: 0, cooled: 669 },
  waitingOverThreshold: 7,
  thresholdHours: 3,
  oldest: [
    { phone: "5534991110001", name: "Jéssica Mendonça", chip: "Comercial - Gabriel", waitingSince: ago(250) },
    { phone: "5534991110002", name: null, chip: null, waitingSince: ago(72) },
  ],
};

const OVERVIEW: DashboardOverview = {
  waiting: { status: "ready", waiting: 12, waitingOverThreshold: 7, thresholdHours: 3 },
  base: {
    total: 80320,
    slices: { invalidPhone: 63, inConversation: 168, noReply: 49, neverApproached: 80033, closedNoApproach: 7 },
    neverApproached: { leads: 80033, phones: 80033, reachable: 80033, optOutDiscounted: 0, optOutRecorded: false, shareOfBasePct: 99.6 },
  } as DashboardOverview["base"],
  meetings: { hasRecords: true, current: 0, previous: 4 },
  funnel: { received: { current: 240, previous: 200 }, replied: { current: 83, previous: 60 }, meetings: { hasRecords: true, current: 0, previous: 1 } },
  chips: [
    { instanceId: "a", name: "Comercial - Gabriel", chipState: "cold", sent: 200, replies: 70, sentToday: 36, quotaLimit: 40, quotaPercentage: 90 },
    { instanceId: "b", name: "Pessoal - Caio", chipState: "warm", sent: 40, replies: 13, sentToday: 4, quotaLimit: 200, quotaPercentage: 2 },
  ],
  chipsQuotaIsToday: true,
  firstHumanResponse: RESPONSE,
  campaigns: [
    { campaign_id: "c1", campaign_name: "Aquecimento rápido", message: null, sent_count: 120, replied_count: 46, reply_rate: 38.3 },
    { campaign_id: "c2", campaign_name: "Reativação de parados", message: null, sent_count: 90, replied_count: 8, reply_rate: 8.9 },
  ],
  regions: [{ label: "34 · Uberlândia", ddd: "34", cidade: "Uberlândia", sent: 150, replies: 50, replyRate: 33.3 }],
  queue: QUEUE,
};

function payload(overview: Partial<DashboardOverview> = {}, extra: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    client: { id: "t1", name: "Empresa" },
    period: "30d",
    lastUpdatedAt: "2026-11-11T12:00:00.000Z",
    cacheStatus: "fresh",
    hasProposalsAndContracts: false,
    unavailableBlocks: [],
    summary: {
      sent: { current: 304, previous: 250, delta: 22 },
      replied: { current: 83, previous: 60, delta: 38, rate: 34.6, previousRate: 30, reached: 240, previousReached: 200, ruleDeclaration: "" },
      proposals: null,
      contracts: null,
      closings: null,
    },
    rankings: {
      messages: [],
      chips: [],
      regions: [],
      failureReasons: [
        { reason: "Número não existe no WhatsApp", count: 9, percentage: 75 },
        { reason: "Chip desconectado", count: 3, percentage: 25 },
      ],
      failureTotals: { occurrences: 12, distinctNumbers: 11 },
      chipsUnattributedSent: 64,
    },
    overview: { ...OVERVIEW, ...overview },
    ...extra,
  } as DashboardPayload;
}

const show = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("Tempo, como se fala", () => {
  it("minutos, horas com minutos e dias", () => {
    expect(formatDuration(4.3)).toBe("4 min");
    expect(formatDuration(59.6)).toBe("1h00");
    expect(formatDuration(250)).toBe("4h10");
    expect(formatDuration(60 * 50)).toBe("2 dias");
  });

  it("sem data ou com data inválida não inventa espera", () => {
    expect(waitingMinutes(null, NOW)).toBeNull();
    expect(waitingMinutes("não é data", NOW)).toBeNull();
    expect(waitingMinutes(ago(72), NOW)).toBe(72);
  });
});

describe("Aba Atendimento — tempo até a primeira resposta", () => {
  it("cobertura boa: mediana, o tempo de 9 em cada 10 e 'medido em N de M'", () => {
    expect(buildResponseTimeCard(RESPONSE)).toEqual({
      state: "ready",
      value: "4",
      unit: "min (mediana)",
      p90: "9 em cada 10 foram respondidas em até 5h34.",
      coverage: "Medido em 191 de 215 conversas.",
      partial: false,
    });
  });

  it("[TESTE OBRIGATÓRIO] cobertura abaixo do corte: diz a cobertura e NÃO mostra tempo", () => {
    const card = buildResponseTimeCard({ ...RESPONSE, measured: 80, coveragePct: 37.2, coverageLevel: "insufficient" });
    expect(card).toEqual({ state: "insufficient", note: "Medido em 80 de 215 conversas. É pouco para dizer um tempo." });

    show(<AttendanceTab data={payload({ firstHumanResponse: { ...RESPONSE, measured: 80, coveragePct: 37.2, coverageLevel: "insufficient" } })} periodLabel="Últimos 30 dias" />);
    const el = screen.getByTestId("card-response-time");
    expect(within(el).queryByText(/mediana/)).not.toBeInTheDocument();
    expect(within(el).getByText(/É pouco para dizer um tempo/)).toBeInTheDocument();
  });

  it("cobertura parcial mostra o tempo com o aviso; bloco indisponível mostra travessão e motivo", () => {
    expect(buildResponseTimeCard({ ...RESPONSE, coverageLevel: "partial" })).toMatchObject({ state: "ready", partial: true });
    expect(buildResponseTimeCard(null)).toEqual({ state: "unavailable" });
    expect(buildResponseTimeCard({ ...RESPONSE, conversations: 0, measured: 0, answered: 0, medianMinutes: null, p90Minutes: null, coverageLevel: "none" })).toEqual({
      state: "empty",
      note: "Nenhuma conversa começou neste período.",
    });
  });

  it("faixas de espera: a soma é o total respondido, a altura parte do zero e só 'mais de 2h' é atenção", () => {
    const h = buildWaitHistogram(RESPONSE)!;
    expect(h.total).toBe(149);
    expect(h.buckets.map((b) => b.value).reduce((a, b) => a + b, 0)).toBe(149);
    expect(h.buckets.map((b) => b.label)).toEqual(["até 10 min", "10 a 30 min", "30 min a 2h", "mais de 2h"]);
    expect(h.buckets[0].heightPct).toBe(100);
    expect(h.buckets[2].heightPct).toBeCloseTo((14 / 90) * 100, 5);
    expect(h.buckets.map((b) => b.attention)).toEqual([false, false, false, true]);
    // payload sem as faixas (cálculo antigo): o bloco não existe
    expect(buildWaitHistogram({ ...RESPONSE, waitBuckets: undefined })).toBeNull();
  });
});

describe("Aba Atendimento — a fila é a da tela Conversas", () => {
  it("[TESTE OBRIGATÓRIO] o número de quem espera é o MESMO do bloco 1 da Visão geral, sem recalcular", () => {
    const data = payload();
    show(<AttendanceTab data={data} periodLabel="Últimos 30 dias" />);
    const card = screen.getByTestId("card-queue-waiting");
    expect(within(card).getByText("12")).toBeInTheDocument();
    expect(data.overview!.queue!.states.waiting).toBe((data.overview!.waiting as { waiting: number }).waiting);
    expect(within(card).getByText(/Só conta quem o robô não está atendendo/)).toBeInTheDocument();
  });

  it("frase do cartão: quantas passaram do limite e há quanto tempo espera a mais antiga", () => {
    const view = buildQueueView(QUEUE, NOW)!;
    expect(view.detail).toBe("7 há mais de 3 horas · a mais antiga há 4h10");
    expect(view.states).toEqual([
      { label: "Esperam você", value: 12 },
      { label: "Com o lead", value: 154 },
      { label: "Com o robô", value: 0 },
      { label: "Esfriaram", value: 669 },
    ]);
  });

  it("lista: mais antiga primeiro, atraso em destaque, sem nome vale o telefone, e o link abre a conversa", () => {
    const view = buildQueueView(QUEUE, NOW)!;
    expect(view.oldest[0]).toMatchObject({ name: "Jéssica Mendonça", chip: "Comercial - Gabriel", waited: "4h10", late: true });
    expect(view.oldest[1]).toMatchObject({ name: "5534991110002", chip: null, waited: "1h12", late: false });
    expect(view.oldest[0].href).toBe("/crm/whatsapp?phone=5534991110001");

    show(<AttendanceTab data={payload()} periodLabel="Últimos 30 dias" />);
    const list = screen.getByTestId("card-queue-oldest");
    expect(within(list).getByText(/As 2 mais antigas das 12/)).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: /Abrir as 12 em Conversas/ })).toHaveAttribute("href", "/crm/whatsapp");
    expect(within(list).getByRole("link", { name: /Jéssica Mendonça/ })).toHaveAttribute("href", "/crm/whatsapp?phone=5534991110001");
  });

  it("ninguém esperando: zero dito com clareza, sem lista e sem cor de atenção", () => {
    const empty: OverviewQueue = { ...QUEUE, states: { ...QUEUE.states, waiting: 0 }, waitingOverThreshold: 0, oldest: [] };
    expect(buildQueueView(empty, NOW)!.detail).toBe("Ninguém esperando resposta agora.");
    show(<AttendanceTab data={payload({ queue: empty, waiting: { status: "ready", waiting: 0, waitingOverThreshold: 0, thresholdHours: 3 } })} periodLabel="x" />);
    expect(within(screen.getByTestId("card-queue-oldest")).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByTestId("card-queue-waiting").className).not.toContain("orange");
  });

  it("[TESTE OBRIGATÓRIO] sem acesso à tela Conversas: os números aparecem, a lista e os atalhos não", () => {
    const restricted: OverviewQueue = { ...QUEUE, oldest: [], listRestricted: true };
    expect(buildQueueView(restricted, NOW)).toMatchObject({ waiting: 12, detail: "7 há mais de 3 horas", oldest: [], listRestricted: true });

    show(<AttendanceTab data={payload({ queue: restricted })} periodLabel="x" />);
    expect(within(screen.getByTestId("card-queue-waiting")).getByText("12")).toBeInTheDocument();
    expect(within(screen.getByTestId("card-queue-states")).getByText("154")).toBeInTheDocument();
    const list = screen.getByTestId("card-queue-oldest");
    expect(within(list).getByTestId("queue-list-restricted")).toBeInTheDocument();
    expect(within(list).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByTestId("tab-attendance")).not.toHaveTextContent("Jéssica");
  });

  it("[TESTE OBRIGATÓRIO] fila indisponível: travessão e motivo, nunca zero; os blocos que dependem dela não aparecem", () => {
    show(<AttendanceTab data={payload({ queue: null })} periodLabel="x" />);
    expect(screen.getByText("Esperando resposta agora").parentElement).toHaveTextContent("Não foi possível calcular agora.");
    expect(screen.queryByTestId("card-queue-waiting")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-queue-states")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-queue-oldest")).not.toBeInTheDocument();
    expect(screen.getByTestId("tab-attendance")).not.toHaveTextContent(/^0$/);
  });

  it("o desenho tem meta de resposta e 'conversas que o robô levou': sem fonte, não aparecem", () => {
    show(<AttendanceTab data={payload()} periodLabel="x" />);
    const tab = screen.getByTestId("tab-attendance");
    expect(tab).not.toHaveTextContent(/meta/i);
    expect(tab).not.toHaveTextContent(/sem precisar de gente/i);
    expect(tab).not.toHaveTextContent(/plano de ação/i);
  });
});

describe("Aba Campanhas", () => {
  it("números do período, tabela inteira na ordem do servidor e motivos de falha com o total", () => {
    show(<CampaignsTab data={payload()} periodLabel="Últimos 30 dias" />);
    const tab = screen.getByTestId("tab-campaigns");
    expect(within(tab).getByText("304")).toBeInTheDocument();
    expect(within(tab).getByText("240")).toBeInTheDocument();
    expect(within(tab).getByText(/34,6 de cada 100 que receberam/)).toBeInTheDocument();

    const rows = within(screen.getByTestId("card-campaigns")).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["Aquecimento rápido", "Reativação de parados"]);
    expect(within(rows[0]).getByText("38,3")).toBeInTheDocument();

    const failures = screen.getByTestId("card-failures");
    expect(within(failures).getByText("12 envios falharam, em 11 números.")).toBeInTheDocument();
    expect(within(failures).getByText("9 · 75%")).toBeInTheDocument();
  });

  it("lista de campanhas indisponível diz o motivo; payload antigo (sem a lista) não mostra o bloco", () => {
    const { unmount } = show(<CampaignsTab data={payload({ campaigns: null })} periodLabel="x" />);
    expect(screen.getByTestId("card-campaigns")).toHaveTextContent("Não foi possível calcular agora.");
    unmount();
    show(<CampaignsTab data={payload({ campaigns: undefined })} periodLabel="x" />);
    expect(screen.queryByTestId("card-campaigns")).not.toBeInTheDocument();
  });

  it("número que falhou vira travessão com motivo, nunca zero", () => {
    show(<CampaignsTab data={payload({}, { summary: { sent: null, replied: null, proposals: null, contracts: null, closings: null } } as Partial<DashboardPayload>)} periodLabel="x" />);
    const tab = screen.getByTestId("tab-campaigns");
    expect(within(tab).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(within(tab).queryByText("0")).not.toBeInTheDocument();
  });
});

describe("Aba Base de leads", () => {
  it("cinco fatias com número e fração, abordáveis com a frase de opt-out e a hora da contagem", () => {
    show(<BaseTab data={payload()} periodLabel="Últimos 30 dias" />);
    const slices = screen.getByTestId("card-base-slices");
    expect(within(slices).getByText(/base de 80\.320 leads/)).toBeInTheDocument();
    expect(within(slices).getByText("80.033")).toBeInTheDocument();
    expect(within(slices).getByText("99,6%")).toBeInTheDocument();
    expect(within(slices).getByText(/Contado/)).toBeInTheDocument();

    const reachable = screen.getByTestId("card-base-reachable");
    expect(within(reachable).getByText("80.033")).toBeInTheDocument();
    expect(within(reachable).getByText("Opt-out não é registrado nesta empresa.")).toBeInTheDocument();

    expect(within(screen.getByTestId("card-regions")).getByText("33,3")).toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] fatia que existe nunca aparece como 0%", () => {
    expect(sharePct(7, (7 / 80320) * 100)).toBe("menos de 0,1%");
    expect(sharePct(0, 0)).toBe("0%");
    expect(sharePct(63, (63 / 80320) * 100)).toBe("0,1%");
    show(<BaseTab data={payload()} periodLabel="x" />);
    const slices = screen.getByTestId("card-base-slices");
    expect(within(slices).getByText("menos de 0,1%")).toBeInTheDocument();
    expect(within(slices).queryByText("0%")).not.toBeInTheDocument();
  });

  it("base indisponível: motivo, sem número; e o cartão de abordáveis não existe", () => {
    show(<BaseTab data={payload({ base: null })} periodLabel="x" />);
    expect(screen.getByTestId("card-base-slices")).toHaveTextContent("Não foi possível calcular agora.");
    expect(screen.queryByTestId("card-base-reachable")).not.toBeInTheDocument();
  });
});

describe("Aba Chips", () => {
  it("uma linha por chip, do que mais enviou para o que menos enviou, com a cota de hoje e o alerta acima de 80%", () => {
    const rows = buildChipRows(OVERVIEW.chips, true)!;
    expect(rows.map((r) => r.name)).toEqual(["Comercial - Gabriel", "Pessoal - Caio"]);
    expect(rows[0]).toMatchObject({ state: "Frio", sent: 200, replied: 70, quotaText: "36 de 40", attention: true });
    expect(rows[1]).toMatchObject({ state: "Aquecido", attention: false });

    show(<ChipsTab data={payload()} periodLabel="Últimos 30 dias" />);
    const card = screen.getByTestId("card-chips");
    expect(within(card).getByText("36 de 40")).toBeInTheDocument();
    expect(within(card).getByText(/64 envios do período não têm chip registrado/)).toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] período que não inclui hoje: a coluna da cota não existe", () => {
    expect(buildChipRows(OVERVIEW.chips, false)!.every((r) => r.quotaText === null && !r.attention)).toBe(true);
    show(<ChipsTab data={payload({ chipsQuotaIsToday: false })} periodLabel="x" />);
    const card = screen.getByTestId("card-chips");
    expect(within(card).queryByText("Cota de hoje")).not.toBeInTheDocument();
    expect(within(card).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Chip", "Estado", "Envios", "Responderam"]);
    expect(within(card).queryByText("36 de 40")).not.toBeInTheDocument();
  });

  it("chips indisponíveis dizem o motivo", () => {
    show(<ChipsTab data={payload({ chips: null })} periodLabel="x" />);
    expect(screen.getByTestId("card-chips")).toHaveTextContent("Não foi possível calcular agora.");
  });
});
