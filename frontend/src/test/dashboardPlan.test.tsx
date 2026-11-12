// frontend/src/test/dashboardPlan.test.tsx
//
// Plano de ação do Dashboard. O sistema traz o fato e o número; dono e prazo quem decide é a pessoa.
// Achado sem fonte não existe, meta não é inventada, e o que a pessoa digita não some.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PlanTab } from "@/pages/Dashboard/PlanTab";
import type { DashboardOverview, DashboardPayload } from "@/hooks/useDashboard";
import { buildDirective, buildPlanActions, buildPlanFindings, weekLabel } from "@/lib/dashboard/plan";

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
  window.localStorage.clear();
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

describe("Plano de ação — a tela", () => {
  const show = (data = payload(), clientId = "t1") => render(<PlanTab data={data} clientId={clientId} companyName="Empresa" />);

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

  it("marcar um achado põe a ação no plano; desmarcar tira", () => {
    show();
    const findings = screen.getByTestId("plan-findings");
    fireEvent.click(within(findings).getByRole("checkbox", { name: /Chip Gabriel/ }));
    expect(screen.getByText("3 ações para esta semana")).toBeInTheDocument();
    expect(within(screen.getByTestId("plan-actions")).getByText(/segurar o próximo lote do chip Gabriel/)).toBeInTheDocument();

    fireEvent.click(within(findings).getByRole("checkbox", { name: /pessoas esperam resposta/ }));
    expect(screen.getByText("2 ações para esta semana")).toBeInTheDocument();
    expect(within(screen.getByTestId("plan-actions")).queryByText(/manter a fila zerada/)).not.toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] dono, prazo e o que foi marcado não somem ao sair da tela, e valem só para aquela empresa", () => {
    const first = show();
    fireEvent.change(screen.getAllByLabelText("Dono")[0], { target: { value: "Gabriel" } });
    fireEvent.change(screen.getAllByLabelText("Prazo")[0], { target: { value: "hoje" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /nunca abordados/ }));
    first.unmount();

    const second = show();
    expect((screen.getAllByLabelText("Dono")[0] as HTMLInputElement).value).toBe("Gabriel");
    expect((screen.getAllByLabelText("Prazo")[0] as HTMLInputElement).value).toBe("hoje");
    expect(screen.getByText("1 ação para esta semana")).toBeInTheDocument();
    second.unmount();

    show(payload(), "outra-empresa");
    expect((screen.getAllByLabelText("Dono")[0] as HTMLInputElement).value).toBe("");
    expect(screen.getByText("2 ações para esta semana")).toBeInTheDocument();
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
    show(payload({ waiting: { status: "pending_source" }, base: null, chips: null, campaigns: null }));
    expect(screen.getByText("Nenhum número deste período pede ação.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar como diretriz" })).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] a tela diz que o plano fica salvo só neste navegador", () => {
    show();
    expect(screen.getByTestId("plan-storage-note")).toHaveTextContent("O plano fica salvo só neste navegador.");
    expect(screen.getByTestId("plan-storage-note")).toHaveTextContent("não vê o que foi marcado aqui");
  });

  it("o que ainda não existe não é prometido: sem Slack, sem planilha, sem 'se cobra sozinho'", () => {
    show();
    const tab = screen.getByTestId("tab-plan");
    expect(tab).not.toHaveTextContent(/Slack/i);
    expect(tab).not.toHaveTextContent(/planilha/i);
    expect(tab).not.toHaveTextContent(/semana seguinte/i);
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
});
