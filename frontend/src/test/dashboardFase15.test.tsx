// frontend/src/test/dashboardFase15.test.tsx
//
// Dashboard Fase 1.5 (tela): as medidas novas, e as correções de rótulo do que já estava na tela:
//  - cota do chip é do DIA, envios são do PERÍODO — nunca na mesma unidade/linha;
//  - motivos de falha mostram o total de FALHAS (e de números distintos) como base;
//  - envios sem chip registrado aparecem à parte, não como "0 envios" de um chip.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Block1WhatHappened } from "../pages/Dashboard/Block1WhatHappened";
import { Block2Rankings } from "../pages/Dashboard/Block2Rankings";
import { Block4Analysis, formatMinutes, NO_CLOSINGS_NOTICE } from "../pages/Dashboard/Block4Analysis";
import type { DashboardAnalysis, DashboardPayload, DashboardSummary } from "../hooks/useDashboard";

const RULE = "conversou depois do envio (janela de 14 dias)";

const summary: DashboardSummary = {
  sent: { current: 201, previous: 150, delta: 34 },
  replied: { current: 40, previous: 30, delta: 33, rate: 19.9, previousRate: 20, ruleDeclaration: RULE },
  meetings: { current: 5, previous: 4, delta: 25 },
  proposals: { current: 3, previous: 1, delta: 200 },
  contracts: { current: 2, previous: 1, delta: 100 },
  closings: { current: 6, previous: 3, delta: 100 },
};

const analysis: DashboardAnalysis = {
  leadClassification: {
    total: 68,
    byTemperature: { QUENTE: 32, MORNO: 3, FRIO: 2, SEM_CLASSIFICACAO: 31 },
    byStage: [
      { stage: "cold", count: 34 },
      { stage: "inquiry", count: 32 },
      { stage: "sem_estagio", count: 2 },
    ],
  },
  firstReplyOnly: { repliedFirst: 11, receivedFollowUp: 8, stoppedAfterFirst: 5, stoppedRate: 62.5 },
  topProfiles: {
    minLeads: 30,
    eligibleGroups: 2,
    top: [
      { temperature: "QUENTE", origin: "meta_ads", leads: 40, replied: 24, scheduled: 8, closed: 4, replyRate: 60, scheduleRate: 20, closeRate: 10 },
      { temperature: "SEM_CLASSIFICACAO", origin: "sem_origem", leads: 31, replied: 10, scheduled: 2, closed: 0, replyRate: 32.3, scheduleRate: 6.5, closeRate: 0 },
    ],
  },
  baseHealth: { total: 100, validPhone: 91, invalidPhone: 9, neverApproached: 40, noReplyOverDays: 12, silenceDays: 90 },
  firstHumanResponse: { conversations: 10, answered: 8, waiting: 2, waitingOverThreshold: 1, thresholdHours: 3, medianMinutes: 12, p90Minutes: 95 },
};

const chip = (o: Partial<NonNullable<DashboardPayload["rankings"]["chips"]>[number]> = {}) => ({
  instanceId: "i1",
  name: "Chip A",
  chipState: "warm",
  sent: 201,
  replies: 40,
  sentToday: 0,
  quotaLimit: 80,
  quotaConsumedText: "0 de 80 (0%)",
  quotaPercentage: 0,
  ...o,
});

const rankings = (o: Partial<DashboardPayload["rankings"]> = {}): DashboardPayload["rankings"] => ({
  messages: [],
  chips: [chip()],
  regions: [],
  failureReasons: [],
  ...o,
});

describe("Fechamentos (caixa nova no topo)", () => {
  it("[TESTE OBRIGATÓRIO] aparece com o número e a variação; payload antigo (sem a medida) não mostra caixa", () => {
    const { unmount } = render(<Block1WhatHappened summary={summary} hasProposalsAndContracts periodLabel="30 dias" />);
    expect(screen.getByText("Fechamentos")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    unmount();

    const { closings: _ignored, ...legacy } = summary;
    render(<Block1WhatHappened summary={legacy as DashboardSummary} hasProposalsAndContracts periodLabel="30 dias" />);
    expect(screen.queryByText("Fechamentos")).not.toBeInTheDocument();
  });

  it("fechamentos indisponíveis mostram 'Indisponível', não 0", () => {
    render(<Block1WhatHappened summary={{ ...summary, closings: null }} hasProposalsAndContracts periodLabel="30 dias" unavailableBlocks={["summary.closings"]} />);

    expect(screen.getAllByText("Indisponível").length).toBe(1);
  });

  it("[TESTE OBRIGATÓRIO] três estados, três comportamentos: ausente esconde, erro diz 'Indisponível', zero mostra 0", () => {
    // 1. cliente não usa o recurso (null e fora de unavailableBlocks): o cartão não aparece
    const { unmount: u1 } = render(<Block1WhatHappened summary={{ ...summary, closings: null }} hasProposalsAndContracts periodLabel="30 dias" unavailableBlocks={[]} />);
    expect(screen.queryByText("Fechamentos")).not.toBeInTheDocument();
    expect(screen.queryByText("Indisponível")).not.toBeInTheDocument();
    u1();

    // 2. erro de verdade (null e listado): o cartão aparece dizendo indisponível
    const { unmount: u2 } = render(<Block1WhatHappened summary={{ ...summary, closings: null }} hasProposalsAndContracts periodLabel="30 dias" unavailableBlocks={["summary.closings"]} />);
    expect(screen.getByText("Fechamentos")).toBeInTheDocument();
    expect(screen.getByText("Indisponível")).toBeInTheDocument();
    u2();

    // 3. tabela presente e vazia: o cartão aparece com ZERO
    render(<Block1WhatHappened summary={{ ...summary, closings: { current: 0, previous: 0, delta: 0 } }} hasProposalsAndContracts periodLabel="30 dias" unavailableBlocks={[]} />);
    expect(screen.getByText("Fechamentos")).toBeInTheDocument();
    expect(screen.queryByText("Indisponível")).not.toBeInTheDocument();
    const cartao = screen.getByText("Fechamentos").closest("div[class*='rounded-2xl']") as HTMLElement;
    expect(within(cartao).getByText("0")).toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] tenant com GD mostra as caixas de propostas e contratos", () => {
    render(<Block1WhatHappened summary={summary} hasProposalsAndContracts periodLabel="30 dias" />);

    expect(screen.getByText("Propostas Criadas")).toBeInTheDocument();
    expect(screen.getByText("Contratos Fechados")).toBeInTheDocument();
  });
});

describe("Conversões: Fechamentos e Perfil que mais converteu dependem da mesma tabela", () => {
  const perfil = (over: any = {}) => ({
    temperature: "QUENTE" as const,
    origin: "meta_ads",
    leads: 40,
    replied: 24,
    scheduled: 8,
    closed: 4 as number | null,
    replyRate: 60,
    scheduleRate: 20,
    closeRate: 10 as number | null,
    ...over,
  });

  // os dois cartões lado a lado, como na página
  const renderAmbos = (opts: { closings: any; unavailable: string[]; topProfiles: any }) =>
    render(
      <>
        <Block1WhatHappened summary={{ ...summary, closings: opts.closings }} hasProposalsAndContracts={false} periodLabel="30 dias" unavailableBlocks={opts.unavailable} />
        <Block4Analysis analysis={{ ...analysis, topProfiles: opts.topProfiles }} />
      </>
    );

  it("[TESTE OBRIGATÓRIO] sem a tabela: o cartão de Fechamentos some e o de Perfil aparece sem a coluna, com o aviso", () => {
    renderAmbos({
      closings: null,
      unavailable: [],
      topProfiles: {
        minLeads: 30,
        eligibleGroups: 2,
        closingsAvailable: false,
        top: [perfil({ origin: "indicacao", scheduled: 12, scheduleRate: 30, closed: null, closeRate: null }), perfil({ origin: "meta_ads", scheduled: 4, scheduleRate: 10, closed: null, closeRate: null })],
      },
    });

    expect(screen.queryByText("Fechamentos")).not.toBeInTheDocument();
    expect(screen.queryByText("Indisponível")).not.toBeInTheDocument();
    // o ranking continua, na ordem que veio (agendou → respondeu), sem "fecharam"
    expect(screen.getByText(/1\. Quente · indicacao/)).toBeInTheDocument();
    expect(screen.getByText(/2\. Quente · meta_ads/)).toBeInTheDocument();
    expect(screen.getAllByText(/% agendaram/).length).toBe(2);
    expect(screen.queryByText(/fecharam/)).not.toBeInTheDocument();
    expect(screen.getByText("Temperatura × origem: responderam e agendaram")).toBeInTheDocument();
    // e a UMA linha que diz por quê
    expect(screen.getByText(NO_CLOSINGS_NOTICE)).toBeInTheDocument();
    expect(NO_CLOSINGS_NOTICE).toBe("Fechamentos não entram neste cliente: ele não registra conversões.");
  });

  it("[TESTE OBRIGATÓRIO] com a tabela: os dois aparecem completos, sem aviso", () => {
    renderAmbos({
      closings: { current: 6, previous: 3, delta: 100 },
      unavailable: [],
      topProfiles: { minLeads: 30, eligibleGroups: 1, closingsAvailable: true, top: [perfil()] },
    });

    expect(screen.getByText("Fechamentos")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText(/40 leads · 60% responderam · 20% agendaram · 10% fecharam/)).toBeInTheDocument();
    expect(screen.getByText("Temperatura × origem: responderam, agendaram, fecharam")).toBeInTheDocument();
    expect(screen.queryByText(NO_CLOSINGS_NOTICE)).not.toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] com coluna faltando: os dois dizem indisponível", () => {
    renderAmbos({ closings: null, unavailable: ["summary.closings", "analysis.topProfiles"], topProfiles: null });

    const cartaoFechamentos = screen.getByText("Fechamentos").closest("div[class*='rounded-2xl']") as HTMLElement;
    expect(within(cartaoFechamentos).getByText("Indisponível")).toBeInTheDocument();
    const cartaoPerfil = screen.getByText("Perfil que mais converteu").closest("div[class*='rounded-2xl']") as HTMLElement;
    expect(within(cartaoPerfil).getByText(/Indisponível — não foi possível calcular agora/)).toBeInTheDocument();
    expect(screen.queryByText(NO_CLOSINGS_NOTICE)).not.toBeInTheDocument();
  });

  it("sem a tabela e nenhum perfil com volume: a linha do aviso aparece mesmo assim", () => {
    renderAmbos({ closings: null, unavailable: [], topProfiles: { minLeads: 30, eligibleGroups: 0, top: [], closingsAvailable: false } });

    expect(screen.getByText(/Nenhum perfil com 30\+ leads/)).toBeInTheDocument();
    expect(screen.getByText(NO_CLOSINGS_NOTICE)).toBeInTheDocument();
  });

  it("payload antigo (sem closingsAvailable) segue mostrando 'fecharam', sem aviso", () => {
    render(<Block4Analysis analysis={analysis} />);

    expect(screen.getByText(/10% fecharam/)).toBeInTheDocument();
    expect(screen.queryByText(NO_CLOSINGS_NOTICE)).not.toBeInTheDocument();
  });
});

describe("Correção 1 — cota (dia) e envios (período) não compartilham unidade", () => {
  it("[TESTE OBRIGATÓRIO] envios e cota ficam em linhas separadas, cada um com o próprio rótulo", () => {
    render(<Block2Rankings rankings={rankings({ chips: [chip({ sent: 201, sentToday: 0, quotaLimit: 80 })] })} />);

    const enviosLine = screen.getByText("201 envios no período");
    const cotaLine = screen.getByText("cota de hoje: 0 de 80");
    expect(enviosLine).toBeInTheDocument();
    expect(cotaLine).toBeInTheDocument();
    // linhas distintas: o número do período não divide texto com o da cota
    expect(enviosLine).not.toBe(cotaLine);
    expect(enviosLine.textContent).not.toMatch(/cota/);
    expect(cotaLine.textContent).not.toMatch(/período/);
  });
});

describe("Correção 3 — envios sem chip registrado", () => {
  it("[TESTE OBRIGATÓRIO] aparecem à parte, explicando por que não são de nenhum chip", () => {
    render(<Block2Rankings rankings={rankings({ chips: [chip({ sent: 0 })], chipsUnattributedSent: 5 })} />);

    expect(screen.getByText(/5 envios sem chip registrado/)).toBeInTheDocument();
    expect(screen.getByText(/chip principal ou o rodízio/)).toBeInTheDocument();
  });

  it("sem envios órfãos, a nota não aparece", () => {
    render(<Block2Rankings rankings={rankings({ chipsUnattributedSent: 0 })} />);

    expect(screen.queryByText(/sem chip registrado/)).not.toBeInTheDocument();
  });
});

describe("Correção 2 — motivos de falha", () => {
  it("[TESTE OBRIGATÓRIO] mostra a base (total de falhas e números distintos) e as ocorrências por números", () => {
    render(
      <Block2Rankings
        rankings={rankings({
          failureReasons: [
            { reason: "Sem WhatsApp", count: 6, percentage: 44, distinctNumbers: 5 },
            { reason: "Chip fora do ar", count: 3, percentage: 21, distinctNumbers: 3 },
            { reason: "Demais motivos", count: 5, percentage: 35, distinctNumbers: 5 },
          ],
          failureTotals: { occurrences: 14, distinctNumbers: 13 },
        })}
      />
    );

    expect(screen.getByText(/6 ocorrências · 5 números/)).toBeInTheDocument();
    expect(screen.getByText(/Percentuais sobre o total de falhas: 14 ocorrências em 13 números/)).toBeInTheDocument();
    expect(screen.getByText("Demais motivos")).toBeInTheDocument();
  });
});

describe("Análise — as cinco medidas novas", () => {
  it("[TESTE OBRIGATÓRIO] cada medida mostra o número que veio do banco", () => {
    render(<Block4Analysis analysis={analysis} />);

    // leads por temperatura e estágio
    expect(screen.getByText("Leads que chegaram")).toBeInTheDocument();
    expect(screen.getByText("68")).toBeInTheDocument();
    expect(screen.getByText("Sem classificação")).toBeInTheDocument();
    expect(screen.getByText("Sem avanço")).toBeInTheDocument();
    // só a primeira
    expect(screen.getByText("62.5%")).toBeInTheDocument();
    expect(screen.getByText(/5 de 8 que receberam o passo seguinte/)).toBeInTheDocument();
    // perfil
    expect(screen.getByText(/1\. Quente · meta_ads/)).toBeInTheDocument();
    expect(screen.getByText(/40 leads · 60% responderam · 20% agendaram · 10% fecharam/)).toBeInTheDocument();
    expect(screen.getByText(/2\. Sem classificação · Sem origem/)).toBeInTheDocument();
    // saúde da base
    expect(screen.getByText("91")).toBeInTheDocument();
    expect(screen.getByText("9 sem telefone válido")).toBeInTheDocument();
    expect(screen.getByText("Nunca abordados")).toBeInTheDocument();
    expect(screen.getByText(/Sem resposta há 90\+ dias/)).toBeInTheDocument();
    // primeira resposta humana
    expect(screen.getByText("12 min")).toBeInTheDocument();
    expect(screen.getByText("9 em 10 em até 1 h 35 min")).toBeInTheDocument();
    expect(screen.getByText(/Esperando há mais de 3 h/)).toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] medida indisponível diz 'Indisponível' naquele cartão e as outras continuam", () => {
    render(<Block4Analysis analysis={{ ...analysis, baseHealth: null, firstReplyOnly: null }} />);

    expect(screen.getAllByText(/Indisponível — não foi possível calcular agora/).length).toBe(2);
    expect(screen.getByText("Leads que chegaram")).toBeInTheDocument();
    expect(screen.getByText("12 min")).toBeInTheDocument();
    expect(screen.queryByText("Nunca abordados")).not.toBeInTheDocument();
  });

  it("taxa 'pararam' indisponível (ninguém recebeu o passo seguinte) mostra traço, nunca 0%", () => {
    render(
      <Block4Analysis analysis={{ ...analysis, firstReplyOnly: { repliedFirst: 4, receivedFollowUp: 0, stoppedAfterFirst: 0, stoppedRate: null } }} />
    );

    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getByText(/Ninguém recebeu o passo seguinte ainda/)).toBeInTheDocument();
  });

  it("sem resposta humana ainda: tempo típico é traço, não '0 min'", () => {
    render(
      <Block4Analysis
        analysis={{
          ...analysis,
          firstHumanResponse: { conversations: 3, answered: 0, waiting: 3, waitingOverThreshold: 2, thresholdHours: 3, medianMinutes: null, p90Minutes: null },
        }}
      />
    );

    expect(screen.queryByText("0 min")).not.toBeInTheDocument();
    expect(screen.getByText("Ninguém foi respondido ainda")).toBeInTheDocument();
    expect(formatMinutes(null)).toBe("—");
  });

  it("nenhum perfil com volume mínimo: diz isso, não inventa ranking", () => {
    render(<Block4Analysis analysis={{ ...analysis, topProfiles: { minLeads: 30, eligibleGroups: 0, top: [] } }} />);

    expect(screen.getByText(/Nenhum perfil com 30\+ leads no período/)).toBeInTheDocument();
  });

  it("payload antigo (sem análise): o bloco inteiro some", () => {
    const { container } = render(<Block4Analysis analysis={undefined} />);

    expect(container.firstChild).toBeNull();
  });

  it("formatMinutes: minutos, horas e minutos", () => {
    expect(formatMinutes(12)).toBe("12 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(95)).toBe("1 h 35 min");
  });

  it("cartão da base fica dentro do próprio cartão (sem vazar números de outro)", () => {
    render(<Block4Analysis analysis={analysis} />);

    const card = screen.getByText("Saúde da base").closest("div[class*='rounded-2xl']") as HTMLElement;
    expect(within(card).getByText("100")).toBeInTheDocument();
    expect(within(card).queryByText("68")).not.toBeInTheDocument();
  });
});
