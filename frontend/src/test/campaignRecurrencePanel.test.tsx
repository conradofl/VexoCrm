import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RecurrencePanel } from "@/pages/LeadImports/RecurrencePanel";
import { CampaignsTable } from "@/pages/LeadImports/CampaignsTable";
import { formatAudienceToday, recurrenceStatusText, type RecurrenceEndType, type RecurrencePattern } from "@/lib/campaignRecurrence";
import type { Campaign, RecurrencePreview } from "@/hooks/useCampanhas";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: async () => "token", isAuthenticated: true, clientId: "condominio", accessProfile: { role: "client" } }),
}));
vi.mock("@/pages/LeadImports/DispatchKpiCards", () => ({ DispatchKpiCards: () => <div /> }));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const PREVIEW_BASE: RecurrencePreview = {
  timezone: "America/Sao_Paulo",
  nextRunAt: "2026-10-31T12:00:00.000Z",
  nextRunLabel: "31/10 às 09:00",
  summary: "Todo mês, no dia 31, às 09:00",
  monthEndNote: "Em meses sem dia 31, o envio sai no último dia do mês (ex.: 30/11, 28/02).",
  originKind: "spreadsheet",
  audience: { total: 1482, toSend: 1482, limitPerRun: null },
  missingVariantSteps: [],
  variantsMessage: null,
  variantsBlocking: false,
  load: null,
};

let fetchMock: ReturnType<typeof vi.fn>;
function respondPreview(preview: Partial<RecurrencePreview>) {
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify({ ...PREVIEW_BASE, ...preview }), { status: 200, headers: { "content-type": "application/json" } })
  );
}
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function Painel({ withPreview = true, initialEnd = null as RecurrenceEndType | null, initialDay = 15 }) {
  const [pattern, setPattern] = useState<RecurrencePattern>("monthly");
  const [dom, setDom] = useState(initialDay);
  const [dow, setDow] = useState(2);
  const [time, setTime] = useState("09:00");
  const [endType, setEndType] = useState<RecurrenceEndType | null>(initialEnd);
  const [endsOn, setEndsOn] = useState("");
  const [max, setMax] = useState(12);
  const [confirmed, setConfirmed] = useState(false);
  const [overrunOk, setOverrunOk] = useState(false);
  return (
    <RecurrencePanel
      recurrencePattern={pattern} setRecurrencePattern={setPattern}
      recurrenceDayOfMonth={dom} setRecurrenceDayOfMonth={setDom}
      recurrenceDayOfWeek={dow} setRecurrenceDayOfWeek={setDow}
      recurrenceTime={time} setRecurrenceTime={setTime}
      recurrenceEndType={endType} setRecurrenceEndType={setEndType}
      recurrenceEndsOn={endsOn} setRecurrenceEndsOn={setEndsOn}
      recurrenceMaxOccurrences={max} setRecurrenceMaxOccurrences={setMax}
      recurrenceNoEndConfirmed={confirmed} setRecurrenceNoEndConfirmed={setConfirmed}
      recurrenceOverrunConfirmed={overrunOk} setRecurrenceOverrunConfirmed={setOverrunOk}
      previewInput={withPreview ? {
        clientId: "condominio", importId: "imp-1", importIds: ["imp-1"], pendingRows: null, limitPerRun: 500,
        analyticsMeta: { sequence: [] } as never,
      } : null}
    />
  );
}

describe("painel de recorrência — o que o dono lê antes de salvar", () => {
  it("[OBRIGATÓRIO] próximo envio em TEXTO, não ícone: 'Próximo envio: 31/10 às 09:00'", async () => {
    respondPreview({});
    renderWithProviders(<Painel initialDay={31} />);
    expect((await screen.findByTestId("recurrence-next-run")).textContent).toContain("Próximo envio: 31/10 às 09:00");
  });

  it("dia 31: a regra do mês curto está escrita na tela", () => {
    renderWithProviders(<Painel withPreview={false} initialDay={31} />);
    expect(screen.getByTestId("recurrence-month-end-note").textContent).toBe(
      "Em meses sem dia 31, o envio sai no último dia do mês (ex.: 30/11, 28/02)."
    );
  });

  it("dia 15: sem nota de mês curto", () => {
    renderWithProviders(<Painel withPreview={false} initialDay={15} />);
    expect(screen.queryByTestId("recurrence-month-end-note")).toBeNull();
  });

  it("origem planilha: 'o público é sempre o mesmo' + hoje seriam N (público inteiro, sem limite)", async () => {
    respondPreview({});
    renderWithProviders(<Painel />);
    const nota = await screen.findByTestId("recurrence-origin-note");
    expect(nota.textContent).toContain("O público é sempre o mesmo — as planilhas escolhidas agora. Quem entrar depois não entra.");
    expect(nota.textContent).toContain("Hoje seriam 1.482 leads.");
    expect(nota.textContent).not.toContain("limitado");
  });

  it("origem CRM: 'o público é recalculado a cada envio'", async () => {
    respondPreview({ originKind: "crm", audience: { total: 30, toSend: 30, limitPerRun: null } });
    renderWithProviders(<Painel />);
    const nota = await screen.findByTestId("recurrence-origin-note");
    expect(nota.textContent).toContain("O público é recalculado a cada envio — quem entrar na base depois também recebe.");
    expect(nota.textContent).toContain("Hoje seriam 30 leads.");
  });

  it("planilha sem variações: aviso de bloqueio visível antes de salvar", async () => {
    respondPreview({ missingVariantSteps: [1], variantsMessage: "Campanha recorrente com público de planilha…", variantsBlocking: true });
    renderWithProviders(<Painel />);
    const aviso = await screen.findByTestId("recurrence-variants-message");
    expect(aviso.getAttribute("data-blocking")).toBe("true");
  });

  it("a prévia manda o mesmo critério do formulário (origem e limite) para a API", async () => {
    respondPreview({});
    renderWithProviders(<Painel />);
    await screen.findByTestId("recurrence-next-run");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ clientId: "condominio", importIds: ["imp-1"], limitPerRun: 500, recurrencePattern: "monthly", recurrenceDayOfMonth: 15 });
  });
});

describe("fim declarado", () => {
  it("três opções; 'sem fim' mostra a confirmação explícita, desmarcada", () => {
    renderWithProviders(<Painel withPreview={false} />);
    expect(screen.getByTestId("recurrence-end-until_date")).toBeTruthy();
    expect(screen.getByTestId("recurrence-end-count")).toBeTruthy();
    expect(screen.queryByTestId("recurrence-no-end-confirm")).toBeNull();
    fireEvent.click(screen.getByTestId("recurrence-end-never"));
    const confirm = screen.getByTestId("recurrence-no-end-confirm") as HTMLInputElement;
    expect(confirm.checked).toBe(false);
  });

  it("nenhum fim vem marcado por padrão (o dono escolhe)", () => {
    renderWithProviders(<Painel withPreview={false} />);
    for (const t of ["until_date", "count", "never"]) {
      expect((screen.getByTestId(`recurrence-end-${t}`) as HTMLInputElement).checked).toBe(false);
    }
  });

  it("por contagem mostra o número de envios; por data mostra o campo de data", () => {
    renderWithProviders(<Painel withPreview={false} />);
    fireEvent.click(screen.getByTestId("recurrence-end-count"));
    expect(screen.getByTestId("recurrence-max-occurrences-input")).toBeTruthy();
    fireEvent.click(screen.getByTestId("recurrence-end-until_date"));
    expect(screen.getByTestId("recurrence-ends-on-input")).toBeTruthy();
  });
});

describe("linha da campanha", () => {
  const base = {
    id: "c1", name: "Assembleia", client_id: "t", client_name: null, import_id: null, limit_per_run: 500, webhook_url: "",
    webhook_token: null, status: "active", scheduled_for: null, last_triggered_at: null, archived_at: null,
    created_by_uid: null, created_by_email: null, created_at: "2026-10-01T00:00:00Z", starts_at: null, ends_at: null,
    chatbot_prompt_type: "campanha", campaign_prompt_id: null, mode: "disparo", is_recurring: true, recurrence_pattern: "monthly",
    recurrence_day_of_month: 15,
  } as unknown as Campaign;

  it("próximo envio / encerrada / parada esperando o fim declarado", () => {
    expect(recurrenceStatusText({ ...base, recurrence_end_type: "count", next_run_label: "15/11 às 09:00" })).toBe("Próximo envio: 15/11 às 09:00");
    expect(recurrenceStatusText({ ...base, recurrence_end_type: "count", recurrence_ended_label: "15/12 às 09:00" })).toBe("Repetição encerrada em 15/12 às 09:00");
    expect(recurrenceStatusText({ ...base, recurrence_end_type: null })).toBe("Parada: salve de novo declarando quando termina");
    expect(recurrenceStatusText({ ...base, is_recurring: false })).toBeNull();
  });

  it("botão 'Envios' abre o histórico com a ocorrência PULADA e o motivo", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      isRecurring: true, summary: "Todo mês, no dia 15, às 09:00", monthEndNote: null, nextRunLabel: "15/01 às 09:00", endedLabel: null,
      endSummary: "Termina depois de 12 envios (1 feito)", needsResave: false, originKind: "spreadsheet",
      audienceToday: { total: 10, toSend: 10, limitPerRun: null },
      occurrences: [
        { occurrenceAt: "2026-12-15T12:00:00Z", label: "15/12 às 09:00", outcome: "skipped", reason: "Pulado: o envio \"Envio recorrente — 15/11 às 09:00\" ainda estava enviando quando este venceu.", audienceCount: null, dispatchId: null, dispatchStatus: null, sentCount: null, failedCount: null, dispatchError: null },
        { occurrenceAt: "2026-11-15T12:00:00Z", label: "15/11 às 09:00", outcome: "created", reason: null, audienceCount: 10, dispatchId: "d1", dispatchStatus: "running", sentCount: 4, failedCount: 0, dispatchError: null },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    renderWithProviders(
      <CampaignsTable clientId="t" campaigns={[{ ...base, recurrence_end_type: "count", next_run_label: "15/01 às 09:00" }]} loadingCampaigns={false}
        onEditCampaign={vi.fn()} onDuplicateCampaign={vi.fn()} onDeleteCampaign={vi.fn()} />
    );
    // abre o cartão e clica em Envios
    fireEvent.click(screen.getByTitle("Ver detalhes"));
    fireEvent.click(screen.getByTestId("campaign-recurrence-history-c1"));
    const itens = await screen.findAllByTestId("recurrence-occurrence");
    expect(itens.map((i) => i.getAttribute("data-outcome"))).toEqual(["skipped", "created"]);
    expect(within(itens[0]).getByText(/ainda estava enviando/)).toBeTruthy();
    expect(within(itens[1]).getByText(/Público do dia: 10 leads/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("recurrence-history-next-run").textContent).toBe("Próximo envio: 15/01 às 09:00"));
  });
});

describe("formatAudienceToday", () => {
  it("é o público inteiro — recorrente não tem limite por envio", () => {
    expect(formatAudienceToday({ total: 1482 })).toBe("Hoje seriam 1.482 leads.");
    expect(formatAudienceToday({ total: 1 })).toBe("Hoje seriam 1 lead.");
  });
});

describe("[OBRIGATÓRIO] quanto cada envio leva, com a cota real, antes de salvar", () => {
  const LOAD_OK = {
    overrun: false, days: 3, intervalDays: 31, dailyQuota: 500, chipName: "Chip GD", messagesPerLead: 1, leadsPerDay: 500, limitedBy: "quota" as const,
    message: 'Com a cota do chip "Chip GD" (500 mensagens/dia, 1 por lead), cada envio para 1.482 leads leva cerca de 3 dias; sua repetição é a cada 31 dias.',
  };
  const LOAD_RUIM = {
    ...LOAD_OK, overrun: true, days: 30, intervalDays: 1, dailyQuota: 50,
    message: 'Com a cota do chip "Chip GD" (50 mensagens/dia, 1 por lead), cada envio para 1.482 leads leva cerca de 30 dias; sua repetição é a cada 1 dia. A repetição não vai conseguir acontecer como configurada: …',
  };

  it("mostra a conta com os números do chip", async () => {
    respondPreview({ load: LOAD_OK });
    renderWithProviders(<Painel />);
    const el = await screen.findByTestId("recurrence-load");
    expect(el.textContent).toContain("cada envio para 1.482 leads leva cerca de 3 dias; sua repetição é a cada 31 dias");
    expect(el.getAttribute("data-overrun")).toBe("false");
    expect(screen.queryByTestId("recurrence-overrun-confirm")).toBeNull();
  });

  it("passou do intervalo: aviso em destaque e confirmação explícita, desmarcada", async () => {
    respondPreview({ load: LOAD_RUIM });
    renderWithProviders(<Painel />);
    const el = await screen.findByTestId("recurrence-load");
    expect(el.getAttribute("data-overrun")).toBe("true");
    expect(el.textContent).toContain("não vai conseguir acontecer como configurada");
    expect((screen.getByTestId("recurrence-overrun-confirm") as HTMLInputElement).checked).toBe(false);
  });

  it("mudou a configuração (outra conta): a confirmação anterior não vale mais", async () => {
    respondPreview({ load: LOAD_RUIM });
    renderWithProviders(<Painel />);
    const box = (await screen.findByTestId("recurrence-overrun-confirm")) as HTMLInputElement;
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    respondPreview({ load: { ...LOAD_RUIM, days: 40, message: LOAD_RUIM.message.replace("30 dias", "40 dias") } });
    fireEvent.change(screen.getByTestId("recurrence-time-input"), { target: { value: "10:00" } });
    await waitFor(() => expect(screen.getByTestId("recurrence-load").textContent).toContain("40 dias"));
    expect((screen.getByTestId("recurrence-overrun-confirm") as HTMLInputElement).checked).toBe(false);
  });
});
