// frontend/src/test/dashboardPlan.test.tsx
//
// Plano de ação do Dashboard. O sistema traz o fato e o número; dono e prazo quem decide é a pessoa.
// Achado sem fonte não existe, meta não é inventada. O plano mora no servidor (um por empresa por semana): só a
// equipe Vexo edita, o cliente vê; a planilha com nome e telefone só aparece para quem acessa a tela Conversas; e
// o plano da semana anterior volta como cobrança, com o número do dia ao lado do de hoje.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlanBoard, PlanTab, type PlanSaveState, type PlanServerState } from "@/pages/Dashboard/PlanTab";
import type { DashboardOverview, DashboardPayload } from "@/hooks/useDashboard";
import {
  buildDirective,
  buildItemsToSave,
  buildPlanActions,
  buildPlanFindings,
  describeFollowUp,
  storedOnlyItems,
  weekLabel,
  type DashboardPlanResponse,
  type StoredPlanItem,
} from "@/lib/dashboard/plan";

const apiCalls: Array<{ path: string; init?: RequestInit }> = [];
let apiResponder: (path: string, init?: RequestInit) => Response = () => new Response("{}", { status: 200 });
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAuthenticated: true, getIdToken: async () => "token" }) }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchApi: async (path: string, init?: RequestInit) => {
    apiCalls.push({ path, init });
    return apiResponder(path, init);
  },
}));

const OVERVIEW: DashboardOverview = {
  waiting: { status: "ready", waiting: 12, waitingOverThreshold: 7, thresholdHours: 3 },
  base: {
    total: 1900,
    slices: { invalidPhone: 10, inConversation: 900, noReply: 640, neverApproached: 340, closedNoApproach: 10 },
    neverApproached: { leads: 340, phones: 340, reachable: 340, optOutDiscounted: 0, optOutRecorded: false, shareOfBasePct: 17.9 },
  } as DashboardOverview["base"],
  meetings: { hasRecords: true, current: 3, previous: 4 },
  funnel: { received: { current: 240, previous: 200 }, replied: { current: 83, previous: 60 }, meetings: null },
  chips: [
    { instanceId: "a", name: "Gabriel", chipState: "cold", sent: 200, replies: 70, sentToday: 37, quotaLimit: 40, quotaPercentage: 92.5 },
    { instanceId: "b", name: "Caio", chipState: "warm", sent: 40, replies: 13, sentToday: 4, quotaLimit: 200, quotaPercentage: 2 },
  ],
  chipsQuotaIsToday: true,
  firstHumanResponse: {
    conversations: 100, measured: 90, indeterminate: 10, coveragePct: 90, coverageLevel: "ok", answered: 80, waiting: 10, waitingBotOnly: 0,
    waitingOverThreshold: 5, answeredWithUnknownBefore: 0, thresholdHours: 3, medianMinutes: 14, p90Minutes: 200,
  },
  campaigns: [
    { campaign_id: "c1", campaign_name: "Aquecimento rápido", message: null, sent_count: 120, replied_count: 46, reply_rate: 38 },
    { campaign_id: "c2", campaign_name: "Black Friday", message: null, sent_count: 90, replied_count: 24, reply_rate: 27 },
    { campaign_id: "c3", campaign_name: "Reativação de parados", message: null, sent_count: 90, replied_count: 8, reply_rate: 9 },
  ],
};

function payload(overview: Partial<DashboardOverview> = {}): DashboardPayload {
  return {
    client: { id: "t1", name: "Empresa" },
    period: "30d",
    lastUpdatedAt: "2026-11-11T12:00:00.000Z",
    cacheStatus: "fresh",
    hasProposalsAndContracts: false,
    unavailableBlocks: [],
    summary: { sent: null, replied: null, proposals: null, contracts: null, closings: null },
    rankings: { messages: [], chips: [], regions: [], failureReasons: [] },
    overview: { ...OVERVIEW, ...overview },
  } as DashboardPayload;
}

beforeEach(() => {
  apiCalls.length = 0;
});

describe("Plano de ação — o que o período mostrou", () => {
  it("cada achado traz o fato, o número e a ação que ele sugere", () => {
    const findings = buildPlanFindings(payload());
    expect(findings.map((f) => f.key)).toEqual(["waiting", "neverApproached", "chipQuota", "weakCampaign"]);
    expect(findings[0]).toMatchObject({ title: "12 pessoas esperam resposta", detail: "7 há mais de 3 horas", metric: "pessoas esperando resposta = 0" });
    expect(findings[0].why).toBe("12 esperando, 7 há mais de 3 horas. A primeira resposta de uma pessoa leva 14 min (mediana).");
    expect(findings[1]).toMatchObject({ title: "340 contatos nunca abordados", detail: "17,9% da base, telefone válido" });
    expect(findings[1].why).toContain("Melhor mensagem do período: 38 respostas a cada 100.");
    expect(findings[2]).toMatchObject({ title: "Chip Gabriel a 92,5% da cota de hoje", detail: "faltam 3 envios" });
    expect(findings[3]).toMatchObject({ title: '"Reativação de parados" responde pouco', detail: "9 de cada 100, contra 38 da melhor" });
  });

  it("[TESTE OBRIGATÓRIO] achado sem fonte não existe: nada inventa número", () => {
    // fila ainda sem fonte, base indisponível, período que não inclui hoje e uma campanha só
    const findings = buildPlanFindings(
      payload({ waiting: { status: "pending_source" }, base: null, chipsQuotaIsToday: false, campaigns: [OVERVIEW.campaigns![0]] })
    );
    expect(findings).toEqual([]);

    // zero medido também não vira achado
    const semPendencia = buildPlanFindings(
      payload({
        waiting: { status: "ready", waiting: 0, waitingOverThreshold: 0, thresholdHours: 3 },
        base: { ...OVERVIEW.base!, neverApproached: { ...OVERVIEW.base!.neverApproached, reachable: 0 } },
        chips: [OVERVIEW.chips![1]],
        campaigns: OVERVIEW.campaigns!.slice(0, 2),
      })
    );
    expect(semPendencia).toEqual([]);
    expect(buildPlanFindings({ ...payload(), overview: undefined })).toEqual([]);
  });

  it("[TESTE OBRIGATÓRIO] o desenho tem 'reuniões sem proposta' e meta de 10 min: sem fonte, não aparecem", () => {
    const all = JSON.stringify(buildPlanFindings(payload()));
    expect(all).not.toMatch(/sem proposta/i);
    expect(all).not.toMatch(/meta/i);
    expect(all).not.toMatch(/10 min/);
  });

  it("tempo de resposta com cobertura insuficiente não entra na justificativa", () => {
    const findings = buildPlanFindings(payload({ firstHumanResponse: { ...OVERVIEW.firstHumanResponse!, coverageLevel: "insufficient" } }));
    expect(findings[0].why).toBe("12 esperando, 7 há mais de 3 horas.");
  });

  it("'responde pouco' só quando fica abaixo da metade da melhor", () => {
    const perto = buildPlanFindings(payload({ campaigns: [OVERVIEW.campaigns![0], { ...OVERVIEW.campaigns![2], reply_rate: 20 }] }));
    expect(perto.some((f) => f.key === "weakCampaign")).toBe(false);
  });
});

function planResponse(overrides: Partial<DashboardPlanResponse> = {}): DashboardPlanResponse {
  return { weekStart: "2026-11-16", canEdit: true, canExport: true, current: null, previous: null, ...overrides };
}
const ready = (plan: DashboardPlanResponse = planResponse()): PlanServerState => ({ status: "ready", plan });

describe("Plano de ação — a tela", () => {
  const onChange = vi.fn();
  const onRetry = vi.fn();
  const onDownload = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    onChange.mockClear();
    onRetry.mockClear();
    onDownload.mockClear();
  });
  const show = ({ server = ready(), saveState = { status: "idle" } as PlanSaveState, data = payload(), clientId = "t1" } = {}) =>
    render(<PlanBoard data={data} clientId={clientId} companyName="Empresa" server={server} saveState={saveState} onChange={onChange} onRetry={onRetry} onDownload={onDownload} />);

  it("abre com o que pede ação agora marcado; dono e prazo nascem 'definir', nunca um nome inventado", () => {
    show();
    expect(screen.getByText("Marque o que vira ação. 2 de 4 marcados.")).toBeInTheDocument();
    const plan = screen.getByTestId("plan-actions");
    expect(within(plan).getByText("2 ações para esta semana")).toBeInTheDocument();
    const owners = within(plan).getAllByLabelText("Dono") as HTMLInputElement[];
    const dues = within(plan).getAllByLabelText("Prazo") as HTMLInputElement[];
    expect(owners).toHaveLength(2);
    for (const input of [...owners, ...dues]) {
      expect(input.value).toBe("");
      expect(input).toHaveAttribute("placeholder", "definir");
    }
  });

  it("marcar um achado põe a ação no plano e manda o plano inteiro para gravar", () => {
    show();
    const findings = screen.getByTestId("plan-findings");
    fireEvent.click(within(findings).getByRole("checkbox", { name: /Chip Gabriel/ }));
    expect(screen.getByText("3 ações para esta semana")).toBeInTheDocument();
    expect(within(screen.getByTestId("plan-actions")).getByText(/segurar o próximo lote do chip Gabriel/)).toBeInTheDocument();
    const sent = onChange.mock.calls.at(-1)![0];
    expect(sent.map((i: StoredPlanItem) => [i.key, i.subject, i.checked])).toEqual([
      ["waiting", null, true],
      ["neverApproached", null, true],
      ["chipQuota", "Gabriel", true],
      ["weakCampaign", "Reativação de parados", false],
    ]);
    // a tela não manda número: quem mede é o servidor
    expect(JSON.stringify(sent)).not.toMatch(/baseline/);

    fireEvent.click(within(findings).getByRole("checkbox", { name: /pessoas esperam resposta/ }));
    expect(screen.getByText("2 ações para esta semana")).toBeInTheDocument();
    expect(within(screen.getByTestId("plan-actions")).queryByText(/manter a fila zerada/)).not.toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] abre com o plano salvo no servidor (o que foi marcado, dono e prazo)", () => {
    const current = {
      weekStart: "2026-11-16",
      updatedAt: "2026-11-18T15:00:00.000Z",
      items: [
        { key: "waiting", subject: null, checked: false, owner: "", due: "", action: "a", why: "", metric: "" },
        { key: "neverApproached", subject: null, checked: true, owner: "Gabriel", due: "hoje", action: "b", why: "", metric: "" },
      ] as StoredPlanItem[],
    };
    show({ server: ready(planResponse({ current })) });
    expect(screen.getByText("1 ação para esta semana")).toBeInTheDocument();
    expect((screen.getByLabelText("Dono") as HTMLInputElement).value).toBe("Gabriel");
    expect((screen.getByLabelText("Prazo") as HTMLInputElement).value).toBe("hoje");
  });

  it("[TESTE OBRIGATÓRIO] cliente vê o plano e não edita: tudo travado e a tela diz por quê", () => {
    const current = {
      weekStart: "2026-11-16",
      updatedAt: null,
      items: [{ key: "waiting", subject: null, checked: true, owner: "Caio", due: "", action: "a", why: "", metric: "" }] as StoredPlanItem[],
    };
    show({ server: ready(planResponse({ canEdit: false, canExport: false, current })) });
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    for (const input of screen.getAllByRole("textbox")) expect(input).toBeDisabled();
    // campo vazio de quem só vê não pede ação: "a definir", sem o destaque de pendência
    const due = screen.getAllByLabelText("Prazo")[0] as HTMLInputElement;
    expect(due).toHaveAttribute("placeholder", "a definir");
    expect(due.className).not.toMatch(/border-dashed/);
    expect(screen.getByTestId("plan-storage-note")).toHaveTextContent("Só a equipe Vexo edita este plano.");
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/Marque o que vira ação/)).not.toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] planilha só aparece para quem acessa a tela Conversas, e só para fila e nunca abordados", async () => {
    show({ server: ready(planResponse({ canExport: false })) });
    expect(screen.queryByText(/Baixar planilha/)).not.toBeInTheDocument();
    expect(screen.getByTestId("tab-plan")).not.toHaveTextContent(/planilha/i);
  });

  it("planilha: um botão para a fila e um para nunca abordados; falha diz o motivo", async () => {
    show();
    expect(screen.getAllByRole("button", { name: "Baixar planilha (nome e telefone)" })).toHaveLength(2);
    fireEvent.click(screen.getByTestId("plan-sheet-neverApproached"));
    expect(onDownload).toHaveBeenCalledWith("neverApproached");
    // enquanto monta, os botões ficam travados (sem pedido em dobro); depois voltam
    expect(screen.getByTestId("plan-sheet-waiting")).toBeDisabled();
    await vi.waitFor(() => expect(screen.getByTestId("plan-sheet-waiting")).not.toBeDisabled());
    onDownload.mockRejectedValueOnce(new Error("A planilha com nome e telefone é só para quem acessa a tela Conversas."));
    fireEvent.click(screen.getByTestId("plan-sheet-waiting"));
    expect(await screen.findByRole("alert")).toHaveTextContent("só para quem acessa a tela Conversas");
  });

  it("[TESTE OBRIGATÓRIO] cobrança: a semana anterior volta com 'você combinou' e o número de antes e de hoje", () => {
    const previous = {
      weekStart: "2026-11-09",
      items: [
        {
          key: "waiting", subject: null, checked: true, owner: "Caio", due: "sexta", action: "Responder as 36 conversas que esperam", why: "", metric: "",
          baseline: { value: 36, unit: "pessoas esperando resposta" }, current: { value: 4, unit: "pessoas esperando resposta" },
        },
        {
          key: "chipQuota", subject: "Gabriel", checked: true, owner: "", due: "", action: "Segurar o chip Gabriel", why: "", metric: "",
          baseline: { value: 92.5, unit: "% da cota de hoje" }, current: null,
        },
      ],
    } as DashboardPlanResponse["previous"];
    show({ server: ready(planResponse({ previous })) });
    const section = screen.getByTestId("plan-followup");
    expect(section).toHaveTextContent("Semana de 09/11: o que foi combinado");
    const [first, second] = within(section).getAllByTestId("plan-followup-item");
    expect(first).toHaveTextContent("Você combinou: Responder as 36 conversas que esperam");
    expect(first).toHaveTextContent("Dono: Caio · Prazo: sexta");
    expect(first).toHaveTextContent("O número foi de 36 pessoas esperando resposta para 4 pessoas esperando resposta.");
    expect(second).toHaveTextContent("Dono: a definir · Prazo: a definir");
    expect(second).toHaveTextContent("No dia do plano: 92,5% da cota de hoje. Hoje o Dashboard não tem esse número.");
  });

  it("sem plano anterior, não há cobrança", () => {
    show();
    expect(screen.queryByTestId("plan-followup")).not.toBeInTheDocument();
  });

  it("enquanto o plano salvo carrega, ou se não carregou, nada é editável (não grava por cima do que existe)", () => {
    const { unmount } = show({ server: { status: "loading" } });
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    expect(screen.getByTestId("plan-storage-note")).toHaveTextContent("Carregando o plano salvo");
    unmount();
    show({ server: { status: "error", message: "x" } });
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    expect(screen.getByTestId("plan-storage-note")).toHaveTextContent("Nada do que aparece aqui foi gravado.");
  });

  it("servidor sem onde guardar: a tela diz que vale só nesta visita e não tenta gravar", () => {
    show({ server: { status: "unavailable" } });
    expect(screen.getByTestId("plan-storage-note")).toHaveTextContent("O plano ainda não pode ser salvo no servidor.");
    fireEvent.click(screen.getByRole("checkbox", { name: /Chip Gabriel/ }));
    expect(screen.getByText("3 ações para esta semana")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("gravação: salvando, salvo, e falha com 'tentar de novo' sem perder o que foi digitado", () => {
    const { rerender } = show({ saveState: { status: "saving" } });
    expect(screen.getByTestId("plan-storage-note")).toHaveTextContent("Salvando…");
    const board = (saveState: PlanSaveState) => (
      <PlanBoard data={payload()} clientId="t1" companyName="Empresa" server={ready()} saveState={saveState} onChange={onChange} onRetry={onRetry} onDownload={onDownload} />
    );
    rerender(board({ status: "saved", at: "2026-11-18T15:04:00.000Z" }));
    expect(screen.getByTestId("plan-storage-note")).toHaveTextContent(/Salvo às \d{2}:\d{2}\. Quem abrir o Dashboard desta empresa vê este plano\./);
    rerender(board({ status: "failed", message: "Não foi possível salvar o plano." }));
    expect(screen.getByTestId("plan-storage-note")).toHaveTextContent("O que você digitou continua na tela.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("copiar como diretriz leva o plano em texto, com 'a definir' onde falta dono ou prazo", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    show();
    fireEvent.change(screen.getAllByLabelText("Dono")[0], { target: { value: "Gabriel" } });
    fireEvent.click(screen.getByRole("button", { name: "Copiar como diretriz" }));

    await screen.findByText(/^Copiado\./);
    const text = writeText.mock.calls[0][0] as string;
    expect(text.split("\n")[0]).toBe(`Plano de ação · Empresa · semana de ${weekLabel()}`);
    expect(text).toContain("1. Responder as 12 conversas que esperam e manter a fila zerada");
    expect(text).toContain("Dono: Gabriel · Prazo: a definir");
    expect(text).toContain("Dono: a definir · Prazo: a definir");
    expect(text).toContain("Mede-se por: pessoas esperando resposta = 0");
  });

  it("navegador que bloqueia a área de transferência: a tela diz que não copiou", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("bloqueado")) } });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Copiar como diretriz" }));
    expect(await screen.findByText(/Não foi possível copiar/)).toBeInTheDocument();
  });

  it("período sem achado: nada a marcar, nada a copiar, e a tela diz isso", () => {
    show({ data: payload({ waiting: { status: "pending_source" }, base: null, chips: null, campaigns: null }) });
    expect(screen.getByText("Nenhum número deste período pede ação.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar como diretriz" })).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] combinado que saiu do período continua no plano (a fila zerou, a campanha saiu)", () => {
    const current = {
      weekStart: "2026-11-16",
      updatedAt: null,
      items: [{ key: "weakCampaign", subject: "Campanha encerrada", checked: true, owner: "Ana", due: "", action: "Reescrever a campanha encerrada", why: "x", metric: "y" }] as StoredPlanItem[],
    };
    show({ server: ready(planResponse({ current })) });
    expect(within(screen.getByTestId("plan-actions")).getByText("Reescrever a campanha encerrada")).toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText("Dono").at(-1)!, { target: { value: "Bia" } });
    const sent = onChange.mock.calls.at(-1)![0];
    expect(sent.find((i: StoredPlanItem) => i.subject === "Campanha encerrada")).toMatchObject({ owner: "Bia", checked: true });
  });

  it("o que não existe não é prometido: sem Slack, sem 'se cobra sozinho', sem meta", () => {
    show();
    const tab = screen.getByTestId("tab-plan");
    expect(tab).not.toHaveTextContent(/Slack/i);
    expect(tab).not.toHaveTextContent(/sozinho/i);
    expect(tab).not.toHaveTextContent(/sem proposta/i);
  });
});

describe("Plano de ação — gravação no servidor (contêiner)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function withClient(ui: React.ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  }

  it("[TESTE OBRIGATÓRIO] espera a pessoa parar de digitar e grava UMA vez, na empresa em que foi digitado", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiResponder = (path, init) =>
      init?.method === "PUT"
        ? new Response(JSON.stringify({ success: true, plan: { weekStart: "2026-11-16", items: [], updatedAt: "2026-11-18T15:00:00.000Z" } }), { status: 200 })
        : new Response(JSON.stringify({ success: true, ...planResponse() }), { status: 200 });
    const view = withClient(<PlanTab data={payload()} clientId="empresa-a" companyName="A" />);
    await vi.waitFor(() => expect(screen.getAllByRole("checkbox")[0]).not.toBeDisabled());

    const owner = screen.getAllByLabelText("Dono")[0];
    for (const value of ["G", "Ga", "Gab"]) fireEvent.change(owner, { target: { value } });
    expect(apiCalls.filter((c) => c.init?.method === "PUT")).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    const puts = apiCalls.filter((c) => c.init?.method === "PUT");
    expect(puts).toHaveLength(1);
    const body = JSON.parse(String(puts[0].init!.body));
    expect(body.clientId).toBe("empresa-a");
    expect(body.items[0]).toMatchObject({ key: "waiting", owner: "Gab" });
    expect(await screen.findByText(/Salvo às/)).toBeInTheDocument();

    // Troca de empresa com tecla pendente: grava na empresa A, nunca na B.
    fireEvent.change(owner, { target: { value: "Gabriel" } });
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PlanTab data={payload()} clientId="empresa-b" companyName="B" />
      </QueryClientProvider>
    );
    await vi.waitFor(() => expect(apiCalls.filter((c) => c.init?.method === "PUT")).toHaveLength(2));
    const second = JSON.parse(String(apiCalls.filter((c) => c.init?.method === "PUT")[1].init!.body));
    expect(second.clientId).toBe("empresa-a");
    expect(second.items[0].owner).toBe("Gabriel");
  });

  it("servidor sem a tabela (503 PLAN_STORAGE_UNAVAILABLE): a aba diz isso e não grava", async () => {
    apiResponder = () => new Response(JSON.stringify({ error: { code: "PLAN_STORAGE_UNAVAILABLE", message: "O plano ainda não pode ser salvo no servidor." } }), { status: 503, headers: { "content-type": "application/json" } });
    withClient(<PlanTab data={payload()} clientId="empresa-a" companyName="A" />);
    expect(await screen.findByText(/O plano ainda não pode ser salvo no servidor/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Chip Gabriel/ }));
    expect(apiCalls.filter((c) => c.init?.method === "PUT")).toHaveLength(0);
  });
});

describe("Plano de ação — texto e semana", () => {
  it("a semana é a da segunda-feira; plano vazio diz que não há ação", () => {
    expect(weekLabel(new Date(2026, 10, 12))).toBe("09/11"); // quinta 12/11 → segunda 09/11
    expect(weekLabel(new Date(2026, 10, 9))).toBe("09/11");
    expect(weekLabel(new Date(2026, 10, 15))).toBe("09/11"); // domingo ainda é a semana da segunda anterior
    expect(buildDirective([], { now: new Date(2026, 10, 12) })).toBe("Plano de ação · semana de 09/11\n\nNenhuma ação marcada.");
    expect(buildPlanActions(buildPlanFindings(payload()), {}).map((a) => a.key)).toEqual(["waiting", "neverApproached"]);
  });

  it("cobrança por extenso: sem número de um lado, diz qual falta; nunca inventa", () => {
    const people = { value: 36, unit: "pessoas esperando resposta" };
    expect(describeFollowUp({ baseline: people, current: { value: 0, unit: people.unit } })).toBe("O número foi de 36 pessoas esperando resposta para 0 pessoas esperando resposta.");
    expect(describeFollowUp({ baseline: { value: 80033, unit: "contatos nunca abordados" }, current: { value: 79500, unit: "contatos nunca abordados" } })).toBe(
      "O número foi de 80.033 contatos nunca abordados para 79.500 contatos nunca abordados."
    );
    expect(describeFollowUp({ baseline: null, current: people })).toBe("Hoje: 36 pessoas esperando resposta. O número do dia do plano não foi registrado.");
    expect(describeFollowUp({ baseline: null, current: null })).toBe("Sem número para comparar.");
  });

  it("itens gravados fora do período seguem no que vai para o servidor", () => {
    const findings = buildPlanFindings(payload());
    const stored = [{ key: "weakCampaign", subject: "Velha", checked: true, owner: "", due: "", action: "a", why: "", metric: "" }] as StoredPlanItem[];
    const only = storedOnlyItems(findings, stored);
    expect(only).toHaveLength(1);
    expect(buildItemsToSave(findings, {}, only).map((i) => i.subject)).toEqual([null, null, "Gabriel", "Reativação de parados", "Velha"]);
  });
});
