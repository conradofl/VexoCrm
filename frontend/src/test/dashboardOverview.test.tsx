// Dashboard, Visão geral (redesenho, Fase 2): a tela só diz o que foi medido.
// Sem registro não é zero, indisponível não é zero, bloco que depende de outra frente mostra o lugar
// reservado, e frase sem fonte não aparece.
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OverviewTab } from "@/pages/Dashboard/OverviewTab";
import type { DashboardOverview, DashboardPayload } from "@/hooks/useDashboard";
import { buildChipAlertCard, buildCountedNote, buildFunnel } from "@/lib/dashboard/overview";

const OVERVIEW: DashboardOverview = {
  waiting: { status: "pending_source" },
  base: {
    total: 1890,
    slices: { invalidPhone: 151, inConversation: 775, noReply: 624, neverApproached: 330, closedNoApproach: 10 },
    slicesAddUp: true,
    neverApproached: { reachable: 320, totalPhones: 323, totalLeads: 330, optOutDiscounted: 3, optOutRecorded: true, shareOfBasePct: 17.5 },
  },
  meetings: { hasRecords: true, current: 47, previous: 50 },
  funnel: {
    received: { current: 1240, previous: 1060 },
    replied: { current: 312, previous: 223 },
    meetings: { hasRecords: true, current: 41, previous: 47 },
  },
  chips: [
    { instanceId: "c1", name: "Comercial", sentToday: 46, quotaLimit: 50, quotaPercentage: 92 },
    { instanceId: "c2", name: "Pessoal", sentToday: 12, quotaLimit: 50, quotaPercentage: 24 },
  ],
  chipsQuotaIsToday: true,
  firstHumanResponse: null,
};

function payload(overview: Partial<DashboardOverview> = {}, extra: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    client: { id: "t1", name: "Empresa" },
    period: "30d",
    periodInfo: {
      key: "30d",
      isCustom: false,
      days: 30,
      current: { from: "2026-10-12", to: "2026-11-10" },
      previous: { from: "2026-09-12", to: "2026-10-11" },
    },
    lastUpdatedAt: "2026-11-11T12:00:00.000Z",
    cacheStatus: "fresh",
    hasProposalsAndContracts: true,
    unavailableBlocks: [],
    summary: {
      sent: { current: 1500, previous: 1300, delta: 15 },
      replied: { current: 312, previous: 223, delta: 40, rate: 25.2, previousRate: 21, reached: 1240, previousReached: 1060, ruleDeclaration: "" },
      proposals: { current: 18, previous: 0, delta: 0 },
      contracts: { current: 6, previous: 0, delta: 0 },
      closings: null,
    },
    rankings: {
      messages: [
        { campaign_id: "a", campaign_name: "Aquecimento rápido", message: null, sent_count: 300, replied_count: 100, reply_rate: 38 },
        { campaign_id: "b", campaign_name: "Black Friday antecipada", message: null, sent_count: 300, replied_count: 70, reply_rate: 27 },
        { campaign_id: "c", campaign_name: "Reativação de parados", message: null, sent_count: 300, replied_count: 20, reply_rate: 9 },
      ],
      chips: [],
      regions: [],
      failureReasons: [],
    },
    overview: { ...OVERVIEW, ...overview },
    ...extra,
  };
}

const show = (data: DashboardPayload) =>
  render(
    <MemoryRouter>
      <OverviewTab data={data} periodLabel="Últimos 30 dias" />
    </MemoryRouter>
  );

describe("Pede ação agora", () => {
  it("[bloco 1] sem a consulta da tela Conversas: lugar reservado e 'disponível em breve', nenhum número", () => {
    show(payload());
    const card = screen.getByTestId("card-waiting");
    expect(within(card).getByText(/Disponível em breve/)).toBeInTheDocument();
    expect(within(card).queryByText(/\d/)).not.toBeInTheDocument();
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
  });

  it("[bloco 1] liga sozinho quando o servidor manda o número, com o atalho para a fila", () => {
    show(payload({ waiting: { status: "ready", waiting: 12, waitingOverThreshold: 7, thresholdHours: 3 } }));
    const card = screen.getByTestId("card-waiting");
    expect(within(card).getByText("12")).toBeInTheDocument();
    expect(within(card).getByText("7 delas há mais de 3 horas.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Abrir a fila de quem espera/ })).toHaveAttribute("href", "/crm/whatsapp");
  });

  it("[bloco 1] sem acesso à tela Conversas: o número aparece, o atalho para a fila não", () => {
    show(
      payload({
        waiting: { status: "ready", waiting: 12, waitingOverThreshold: 7, thresholdHours: 3 },
        queue: { states: { waiting: 12, withLead: 0, withRobot: 0, cooled: 0 }, waitingOverThreshold: 7, thresholdHours: 3, oldest: [], listRestricted: true },
      })
    );
    const card = screen.getByTestId("card-waiting");
    expect(within(card).getByText("12")).toBeInTheDocument();
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
  });

  it("nunca abordados mostra o abordável e, havendo opt-out gravado, quantos saíram da conta", () => {
    show(payload());
    const card = screen.getByTestId("card-never-approached");
    expect(within(card).getByText("320")).toBeInTheDocument();
    expect(within(card).getByText(/17,5% da base/)).toBeInTheDocument();
    expect(within(card).getByText("Já sem 3 que pediram para sair.")).toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] empresa sem opt-out gravado: o cartão diz que não é registrado, não que descontou", () => {
    show(
      payload({
        base: { ...OVERVIEW.base!, neverApproached: { ...OVERVIEW.base!.neverApproached, optOutRecorded: false, optOutDiscounted: 0 } },
      })
    );
    const card = screen.getByTestId("card-never-approached");
    expect(within(card).getByText("Opt-out não é registrado nesta empresa.")).toBeInTheDocument();
    expect(within(card).queryByText(/pediram para sair|pediu para sair/)).not.toBeInTheDocument();
  });

  it("nunca abordados é número guardado: o cartão diz a hora em que foi contado", () => {
    const at = "2026-11-11T12:00:00.000Z";
    const time = new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    show(payload());
    expect(screen.getByTestId("card-never-approached-counted")).toHaveTextContent(new RegExp(`às ${time}\\.$`));

    // Mesmo dia: só a hora. Outro dia: a data vai junto. Sem hora ou hora inválida: nenhuma frase, nunca uma hora inventada.
    const sameDay = new Date(at);
    expect(buildCountedNote(at, sameDay)).toBe(`Contado às ${time}.`);
    const nextDay = new Date(sameDay.getTime() + 36 * 3600 * 1000);
    expect(buildCountedNote(at, nextDay)).toMatch(/^Contado em \d{2}\/\d{2} às \d{2}:\d{2}\.$/);
    expect(buildCountedNote(null)).toBeNull();
    expect(buildCountedNote("não é data")).toBeNull();
  });

  it("sem hora de cálculo no payload, o cartão não mostra frase de hora", () => {
    show(payload({}, { lastUpdatedAt: null }));
    expect(screen.queryByTestId("card-never-approached-counted")).not.toBeInTheDocument();
  });

  it("base indisponível mostra travessão e o motivo, nunca zero", () => {
    show(payload({ base: null }));
    const card = screen.getByTestId("card-never-approached");
    expect(within(card).getByText("Não foi possível calcular agora.")).toBeInTheDocument();
    expect(within(card).queryByText("0")).not.toBeInTheDocument();
  });

  it("alerta de chip só existe acima de 80% da cota, e o rótulo não promete mais do que o contador enxerga", () => {
    show(payload());
    const card = screen.getByTestId("card-chip");
    expect(within(card).getByText(/envios de campanha e follow-up no chip Comercial hoje/)).toBeInTheDocument();
    expect(within(card).getByText("Faltam 4 para a cota de hoje.")).toBeInTheDocument();

    expect(buildChipAlertCard([{ ...OVERVIEW.chips![1] }], true)).toBeNull();
    expect(buildChipAlertCard(OVERVIEW.chips, false)).toBeNull();
    expect(buildChipAlertCard(null, true)).toBeNull();
  });
});

describe("Funil de coorte", () => {
  it("as barras têm a proporção real sobre quem recebeu", () => {
    const funnel = buildFunnel(payload());
    expect(funnel.stages.map((s) => [s.key, s.people, s.widthPct])).toEqual([
      ["received", 1240, 100],
      ["replied", 312, 25.2],
      ["meetings", 41, 3.3],
    ]);
  });

  it("[TESTE OBRIGATÓRIO] empresa que não registra reunião: 'sem registro', sem barra, nunca 0", () => {
    show(payload({ funnel: { ...OVERVIEW.funnel, meetings: { hasRecords: false, current: null, previous: null } } }));
    const stage = screen.getByRole("button", { name: /Marcaram reunião/ });
    expect(within(stage).getByText("sem registro")).toBeInTheDocument();
    expect(within(stage).queryByText("0")).not.toBeInTheDocument();
    expect(buildFunnel(payload({ funnel: { ...OVERVIEW.funnel, meetings: { hasRecords: false, current: null, previous: null } } })).stages[2].widthPct).toBeNull();
  });

  it("proposta e contrato ficam fora das barras, como contagem à parte", () => {
    show(payload());
    expect(screen.getByText(/Fora do funil/)).toBeInTheDocument();
    expect(screen.getByText("Propostas criadas")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Propostas criadas/ })).not.toBeInTheDocument();
  });

  it("período sem envio de campanha diz isso, em vez de desenhar um funil de zeros", () => {
    show(payload({ funnel: { received: { current: 0, previous: 0 }, replied: { current: 0, previous: 0 }, meetings: OVERVIEW.funnel.meetings } }));
    expect(screen.getByText("Nenhuma pessoa recebeu campanha neste período.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Receberam/ })).not.toBeInTheDocument();
  });

  it("etapa clicada explica o número com frases que têm fonte", () => {
    show(payload());
    // Abre em "Responderam".
    expect(screen.getByText("▲ 4 pontos na taxa de resposta")).toBeInTheDocument();
    expect(screen.getByText("928 de 1.240 pessoas que receberam não responderam.")).toBeInTheDocument();
    expect(screen.getByText('A campanha "Reativação de parados" puxa a média para baixo: 9 de cada 100.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Marcaram reunião/ }));
    expect(screen.getByText("▼ 6 pessoas a menos")).toBeInTheDocument();
    expect(screen.getByText("De 312 que responderam, 271 não chegaram a marcar.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Receberam/ }));
    expect(screen.getByText("▲ 180 pessoas a mais")).toBeInTheDocument();
  });

  it("período anterior sem ninguém: 'sem base de comparação', nunca um percentual", () => {
    show(payload({ funnel: { ...OVERVIEW.funnel, received: { current: 1240, previous: 0 } } }));
    fireEvent.click(screen.getByRole("button", { name: /Receberam/ }));
    expect(screen.getByText("Sem base de comparação")).toBeInTheDocument();
  });
});

describe("Frases sem fonte não aparecem", () => {
  it("nada de meta de resposta, lote adiado ou 'nenhuma mensagem duplicada'", () => {
    const { container } = show(payload({ waiting: { status: "ready", waiting: 12, waitingOverThreshold: 7, thresholdHours: 3 } }));
    for (const stage of [/Receberam/, /Responderam/, /Marcaram reunião/]) {
      fireEvent.click(screen.getByRole("button", { name: stage }));
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/meta é responder/i);
      expect(text).not.toMatch(/lote .* adiado|vai ser adiado/i);
      expect(text).not.toMatch(/duas vezes/i);
    }
  });
});

describe("Leituras de apoio", () => {
  it("[TESTE OBRIGATÓRIO] envio sem chip registrado aparece com a contagem; sem nenhum, a frase não existe", () => {
    const { unmount } = show(payload({}, { rankings: { ...payload().rankings, chipsUnattributedSent: 64 } }));
    expect(screen.getByTestId("chips-unattributed")).toHaveTextContent("64 envios do período sem chip registrado.");
    unmount();
    show(payload({}, { rankings: { ...payload().rankings, chipsUnattributedSent: 0 } }));
    expect(screen.queryByTestId("chips-unattributed")).not.toBeInTheDocument();
  });

  it("cota por chip: o rótulo diz o que o contador enxerga", () => {
    show(payload());
    expect(screen.getByText("46 de 50")).toBeInTheDocument();
    expect(screen.getByText("12 de 50")).toBeInTheDocument();
    expect(screen.getByText(/Envios de campanha e follow-up de hoje/)).toBeInTheDocument();
    expect(screen.getByText("Laranja = acima de 80% da cota.")).toBeInTheDocument();
  });

  it("base: cinco situações, cada uma com o seu número", () => {
    show(payload());
    expect(screen.getByText("Como está a base de 1.890 leads")).toBeInTheDocument();
    for (const label of ["Em conversa", "Sem resposta", "Nunca abordados", "Encerrados sem abordagem", "Telefone inválido"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("775")).toBeInTheDocument();
  });

  it("ranking e chips indisponíveis dizem que não deu para calcular, em vez de lista vazia", () => {
    show(payload({ chips: null }, { rankings: { messages: null, chips: null, regions: null, failureReasons: null } }));
    expect(screen.getAllByText("Não foi possível calcular agora.").length).toBe(2);
  });
});
