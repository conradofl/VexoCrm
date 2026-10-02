// frontend/src/test/dashboardCustomPeriod.test.tsx
//
// Dashboard: período personalizado e comparação com nome. Todo "vs N" diz com o que está comparando
// (nos 30 dias anteriores / em 21 a 30 de setembro); com intervalo escolhido, as datas são
// obrigatórias. Intervalo invertido ou no futuro é recusado com mensagem clara.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Block1WhatHappened } from "../pages/Dashboard/Block1WhatHappened";
import { DashboardHeader } from "../pages/Dashboard/DashboardHeader";
import {
  formatDateRange,
  describePreviousPeriod,
  describeComparison,
  describePeriodStatus,
  IN_PROGRESS_NOTICE,
  validateCustomRange,
  type DashboardPeriodInfo,
} from "../lib/dashboard/formatters";
import { buildDashboardPeriodQuery, dashboardQueryKey, type DashboardSummary } from "../hooks/useDashboard";

const Y = new Date().getFullYear();
const NOW = new Date(Y, 9, 15, 12, 0, 0); // 15/10 do ano corrente

const summary: DashboardSummary = {
  sent: { current: 100, previous: 85, delta: 18 },
  replied: { current: 40, previous: 30, delta: 33, rate: 40, previousRate: 35.3, ruleDeclaration: "conversou depois do envio (janela de 14 dias)" },
  meetings: { current: 5, previous: 4, delta: 25 },
  proposals: { current: 3, previous: 1, delta: 200 },
  contracts: { current: 2, previous: 1, delta: 100 },
  closings: { current: 6, previous: 3, delta: 100 },
};

const customInfo: DashboardPeriodInfo = {
  key: `custom:${Y}-10-01:${Y}-10-10`,
  isCustom: true,
  days: 10,
  current: { from: `${Y}-10-01`, to: `${Y}-10-10` },
  previous: { from: `${Y}-09-21`, to: `${Y}-09-30` },
};
const info30d: DashboardPeriodInfo = {
  key: "30d",
  isCustom: false,
  days: 30,
  current: { from: `${Y}-09-16`, to: `${Y}-10-15` },
  previous: { from: `${Y}-08-17`, to: `${Y}-09-15` },
};

// os "vs N …" de todos os cartões do topo
const vsLines = () => screen.getAllByText(/^vs /).map((el) => el.textContent ?? "");

describe("Datas por extenso", () => {
  it("formatDateRange: mesmo mês, meses diferentes, um dia só", () => {
    expect(formatDateRange({ from: `${Y}-10-01`, to: `${Y}-10-10` }, NOW)).toBe("1 a 10 de outubro");
    expect(formatDateRange({ from: `${Y}-09-28`, to: `${Y}-10-05` }, NOW)).toBe("28 de setembro a 5 de outubro");
    expect(formatDateRange({ from: `${Y}-10-02`, to: `${Y}-10-02` }, NOW)).toBe("2 de outubro");
  });

  it("o ano aparece quando o intervalo não é do ano corrente ou atravessa a virada", () => {
    expect(formatDateRange({ from: `${Y - 1}-10-01`, to: `${Y - 1}-10-10` }, NOW)).toBe(`1 a 10 de outubro de ${Y - 1}`);
    expect(formatDateRange({ from: `${Y - 1}-12-28`, to: `${Y}-01-05` }, NOW)).toBe(`28 de dezembro de ${Y - 1} a 5 de janeiro de ${Y}`);
  });
});

describe("Com o que está comparando", () => {
  it("[TESTE OBRIGATÓRIO] intervalo personalizado cita o período anterior com as datas", () => {
    expect(describePreviousPeriod(customInfo, NOW)).toBe("em 21 a 30 de setembro");
    expect(describeComparison(customInfo, NOW)).toBe("Comparando 1 a 10 de outubro contra 21 a 30 de setembro");
  });

  it("[TESTE OBRIGATÓRIO] atalho de 30 dias: 'nos 30 dias anteriores'; 7 dias e este mês também por extenso", () => {
    expect(describePreviousPeriod(info30d, NOW)).toBe("nos 30 dias anteriores");
    expect(describePreviousPeriod({ ...info30d, key: "7d", days: 7 }, NOW)).toBe("nos 7 dias anteriores");
    expect(describePreviousPeriod({ ...info30d, key: "this_month", days: 15 }, NOW)).toBe("nos 15 dias anteriores ao início do mês");
    expect(describeComparison(info30d, NOW)).toBe("Comparando com os 30 dias anteriores");
  });

  it("payload antigo (sem as datas) cai num texto neutro, nunca em branco", () => {
    expect(describePreviousPeriod(undefined, NOW)).toBe("no período anterior");
    expect(describeComparison(null, NOW)).toBe("Comparação com o período anterior de mesma duração");
  });
});

describe("Cartões do topo — todos dizem com o que comparam", () => {
  it("[TESTE OBRIGATÓRIO] intervalo personalizado: os SEIS cartões citam as datas do período anterior, nenhum diz só 'no anterior'", () => {
    render(<Block1WhatHappened summary={summary} hasProposalsAndContracts periodLabel="1 a 10 de outubro" comparison={customInfo} />);

    const lines = vsLines();
    expect(lines).toHaveLength(6); // Enviados, Responderam, Reuniões, Fechamentos, Propostas, Contratos
    for (const line of lines) {
      expect(line).toContain("em 21 a 30 de setembro");
      expect(line).not.toContain("no anterior");
    }
    expect(screen.getByText("Comparando 1 a 10 de outubro contra 21 a 30 de setembro")).toBeInTheDocument();
    expect(lines.some((l) => l.startsWith("vs 85 "))).toBe(true); // o "vs 85" do enunciado
  });

  it("[TESTE OBRIGATÓRIO] atalho de 30 dias: todos os cartões dizem 'vs N nos 30 dias anteriores'", () => {
    render(<Block1WhatHappened summary={summary} hasProposalsAndContracts periodLabel="Últimos 30 dias" comparison={info30d} />);

    const lines = vsLines();
    expect(lines).toHaveLength(6);
    for (const line of lines) expect(line).toContain("nos 30 dias anteriores");
    expect(lines).toContain("vs 85 nos 30 dias anteriores");
  });

  it("o cartão de Responderam mantém a taxa anterior e também diz o período", () => {
    render(<Block1WhatHappened summary={summary} hasProposalsAndContracts={false} periodLabel="x" comparison={customInfo} />);

    expect(screen.getByText(/vs 30 \(35.3%\) em 21 a 30 de setembro/)).toBeInTheDocument();
  });

  it("sem as datas (payload antigo): 'no período anterior' em todos", () => {
    render(<Block1WhatHappened summary={summary} hasProposalsAndContracts periodLabel="x" />);

    for (const line of vsLines()) expect(line).toContain("no período anterior");
  });
});

describe("Período em andamento", () => {
  const renderWith = (comparison: DashboardPeriodInfo | null | undefined) =>
    render(<Block1WhatHappened summary={summary} hasProposalsAndContracts periodLabel="x" comparison={comparison} />);

  it("[TESTE OBRIGATÓRIO] intervalo terminando hoje mostra a marca, junto da comparação", () => {
    renderWith({ ...customInfo, inProgress: true });

    expect(screen.getByRole("note")).toHaveTextContent("O período inclui hoje, que ainda não terminou. A comparação é com um período já completo.");
    // a marca fica junto da comparação, no mesmo cabeçalho
    const header = screen.getByText("Comparando 1 a 10 de outubro contra 21 a 30 de setembro").parentElement as HTMLElement;
    expect(header).toContainElement(screen.getByRole("note"));
  });

  it("[TESTE OBRIGATÓRIO] intervalo que terminou ontem não mostra a marca", () => {
    renderWith({ ...customInfo, inProgress: false });

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/O período inclui hoje/)).not.toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] 'este mês' mostra a marca", () => {
    renderWith({ ...info30d, key: "this_month", days: 15, inProgress: true });

    expect(screen.getByRole("note")).toHaveTextContent(IN_PROGRESS_NOTICE);
  });

  it("[TESTE OBRIGATÓRIO] 'últimos 30 dias' não mostra a marca (rolante nos dois lados)", () => {
    renderWith({ ...info30d, inProgress: false });

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("payload antigo (sem a informação) não mostra marca", () => {
    renderWith(info30d); // sem inProgress
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    renderWith(undefined);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("describePeriodStatus: texto só quando em andamento", () => {
    expect(describePeriodStatus({ ...customInfo, inProgress: true })).toBe(IN_PROGRESS_NOTICE);
    expect(describePeriodStatus({ ...customInfo, inProgress: false })).toBeNull();
    expect(describePeriodStatus(null)).toBeNull();
  });
});

describe("Escolha do intervalo — validação na tela", () => {
  const TODAY = `${Y}-10-15`;

  it("[TESTE OBRIGATÓRIO] intervalo invertido: mensagem clara", () => {
    expect(validateCustomRange(`${Y}-10-10`, `${Y}-10-01`, TODAY)).toBe(
      `A data inicial (10/10/${Y}) é depois da data final (01/10/${Y}). Inverta as datas.`
    );
  });

  it("[TESTE OBRIGATÓRIO] intervalo no futuro: mensagem clara dizendo até quando", () => {
    expect(validateCustomRange(`${Y}-10-01`, `${Y}-10-20`, TODAY)).toBe(
      `A data final (20/10/${Y}) está no futuro. Escolha uma data final até hoje (15/10/${Y}).`
    );
    expect(validateCustomRange(`${Y}-10-18`, `${Y}-10-20`, TODAY)).toContain("A data inicial");
  });

  it("datas faltando e intervalo válido", () => {
    expect(validateCustomRange("", `${Y}-10-01`, TODAY)).toBe("Escolha a data inicial e a data final.");
    expect(validateCustomRange(`${Y}-10-01`, `${Y}-10-15`, TODAY)).toBeNull(); // hoje vale
    expect(validateCustomRange(`${Y}-10-05`, `${Y}-10-05`, TODAY)).toBeNull(); // um dia só vale
  });
});

describe("Cabeçalho — seletor de intervalo", () => {
  const base = { lastUpdatedAt: null, cacheStatus: "ready" as const, onRefresh: () => {}, isRefreshing: false, today: `${Y}-10-15` };

  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("só mostra as datas quando o período é 'Personalizado'", () => {
    const { rerender } = render(<DashboardHeader {...base} period="30d" onPeriodChange={() => {}} />);
    expect(screen.queryByLabelText("Data inicial")).not.toBeInTheDocument();

    rerender(<DashboardHeader {...base} period="custom" onPeriodChange={() => {}} />);
    expect(screen.getByLabelText("Data inicial")).toBeInTheDocument();
    expect(screen.getByLabelText("Data final")).toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] intervalo invertido: mostra a mensagem e não deixa aplicar", () => {
    const onApply = vi.fn();
    render(<DashboardHeader {...base} period="custom" onPeriodChange={() => {}} onCustomRangeApply={onApply} />);

    type("Data inicial", `${Y}-10-10`);
    type("Data final", `${Y}-10-01`);

    expect(screen.getByRole("alert")).toHaveTextContent(`A data inicial (10/10/${Y}) é depois da data final (01/10/${Y})`);
    const apply = screen.getByRole("button", { name: "Aplicar" });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("[TESTE OBRIGATÓRIO] data final no futuro: mostra a mensagem e não deixa aplicar", () => {
    const onApply = vi.fn();
    render(<DashboardHeader {...base} period="custom" onPeriodChange={() => {}} onCustomRangeApply={onApply} />);

    type("Data inicial", `${Y}-10-01`);
    type("Data final", `${Y}-10-30`);

    expect(screen.getByRole("alert")).toHaveTextContent("está no futuro");
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("intervalo válido: aplica as duas datas", () => {
    const onApply = vi.fn();
    render(<DashboardHeader {...base} period="custom" onPeriodChange={() => {}} onCustomRangeApply={onApply} />);

    type("Data inicial", `${Y}-10-01`);
    type("Data final", `${Y}-10-10`);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(onApply).toHaveBeenCalledWith({ from: `${Y}-10-01`, to: `${Y}-10-10` });
  });

  it("os campos de data não aceitam depois de hoje (max)", () => {
    render(<DashboardHeader {...base} period="custom" onPeriodChange={() => {}} />);

    expect(screen.getByLabelText("Data inicial")).toHaveAttribute("max", `${Y}-10-15`);
    expect(screen.getByLabelText("Data final")).toHaveAttribute("max", `${Y}-10-15`);
  });

  it("sem cálculo ainda: não mostra 'Atualizado às' com hora inventada", () => {
    render(<DashboardHeader {...base} lastUpdatedAt={null} period="custom" onPeriodChange={() => {}} />);

    expect(screen.queryByText(/Atualizado às/)).not.toBeInTheDocument();
  });
});

describe("Consulta e cache da tela", () => {
  it("[TESTE OBRIGATÓRIO] intervalo vai na URL com as duas datas; atalho não leva datas", () => {
    expect(buildDashboardPeriodQuery("custom", { from: "2026-10-01", to: "2026-10-10" })).toBe("period=custom&from=2026-10-01&to=2026-10-10");
    expect(buildDashboardPeriodQuery("30d")).toBe("period=30d");
    expect(buildDashboardPeriodQuery("30d", { from: "2026-10-01", to: "2026-10-10" })).toBe("period=30d");
  });

  it("[TESTE OBRIGATÓRIO] a chave do cache da tela distingue intervalos diferentes", () => {
    const a = dashboardQueryKey("t", "custom", { from: "2026-10-01", to: "2026-10-10" });
    const b = dashboardQueryKey("t", "custom", { from: "2026-10-05", to: "2026-10-12" });
    const c = dashboardQueryKey("t", "30d");

    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    expect(JSON.stringify(dashboardQueryKey("t", "custom", { from: "2026-10-01", to: "2026-10-10" }))).toBe(JSON.stringify(a));
    // a invalidação por prefixo (["dashboard", cliente]) continua pegando todos
    expect(a.slice(0, 2)).toEqual(["dashboard", "t"]);
  });
});
