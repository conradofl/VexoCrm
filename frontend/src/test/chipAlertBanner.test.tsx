// Aviso de chip conectado que recebe com atraso ou ficou mudo (19/11/2026). Dados no formato da rota
// /api/whatsapp/chip-alerts, com os números medidos em produção em 19/11: container-led 9499 com até 9,7 h de atraso
// (lotes de 50 em 50 min), Tinge com 37 h.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ChipAlertBannerView, duracao, fraseDoAlerta } from "@/components/chips/ChipAlertBanner";
import { ChipDiaryView } from "@/components/chips/ChipDiary";
import type { ChipAlertsReport } from "@/hooks/useChipAlerts";

export const ALERTAS_19_11: ChipAlertsReport = {
  limiteMin: 30,
  verificadoEm: "2026-11-19T18:00:00.000Z",
  alertas: [
    {
      instancia: "container-led-chip-de-disparo-atendimento",
      tipo: "atrasado",
      mensagensAtrasadas: 12,
      maiorAtrasoMin: 582,
      ultimaChegada: "2026-11-19T17:55:00.000Z",
    },
    {
      instancia: "tinge-brasil",
      tipo: "mudo",
      minutosSemReceber: 47,
      diasComEntradaNestaHora: 6,
      ultimaChegada: "2026-11-19T17:13:00.000Z",
    },
  ],
};

describe("duracao", () => {
  it.each([
    [0, "0 min"],
    [45, "45 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
    [582, "9 h 42 min"],
    [2220, "37 h"],
  ])("%s min -> %s", (m, esperado) => {
    expect(duracao(m)).toBe(esperado);
  });
});

describe("fraseDoAlerta", () => {
  it("atrasado diz quantas mensagens, o maior atraso e que o chip aparece conectado", () => {
    expect(fraseDoAlerta(ALERTAS_19_11.alertas[0])).toBe(
      "container-led-chip-de-disparo-atendimento: 12 mensagens chegaram com até 9 h 42 min de atraso na última hora. O chip aparece conectado, mas o WhatsApp está segurando as mensagens."
    );
  });

  it("uma mensagem só fica no singular", () => {
    expect(fraseDoAlerta({ instancia: "Chip 9499", tipo: "atrasado", mensagensAtrasadas: 1, maiorAtrasoMin: 45 })).toContain(
      "1 mensagem chegou com até 45 min de atraso"
    );
  });

  it("mudo diz há quanto tempo e que é um horário em que o chip costuma receber", () => {
    expect(fraseDoAlerta(ALERTAS_19_11.alertas[1])).toBe(
      "tinge-brasil: nenhuma mensagem recebida há 47 min, num horário em que este chip costuma receber. Confira se as mensagens estão chegando."
    );
  });
});

describe("ChipAlertBannerView", () => {
  it("sem alerta não ocupa espaço nenhum", () => {
    const { container } = render(<ChipAlertBannerView data={{ alertas: [], limiteMin: 30, verificadoEm: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sem dados (carregando ou erro) não mostra nada", () => {
    const { container } = render(<ChipAlertBannerView data={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("um item por chip, com o tipo, em role=alert", () => {
    render(<ChipAlertBannerView data={ALERTAS_19_11} />);
    const banner = screen.getByRole("alert");
    const itens = within(banner).getAllByTestId("chip-alert");
    expect(itens.map((i) => i.getAttribute("data-tipo"))).toEqual(["atrasado", "mudo"]);
    expect(banner).toHaveTextContent("2 chips com problema para receber");
  });

  it("versão compacta (Conversas, Diário) não tem título", () => {
    render(<ChipAlertBannerView data={ALERTAS_19_11} compact />);
    expect(screen.getByRole("alert")).not.toHaveTextContent("chips com problema para receber");
  });
});

describe("Diário do chip mostra o alerta no topo", () => {
  it("com alerta, o aviso aparece antes da lista", () => {
    render(<ChipDiaryView data={{ available: true, items: [] }} alertas={ALERTAS_19_11} />);
    const diario = screen.getByTestId("chip-diary");
    expect(within(diario).getByTestId("chip-alert-banner")).toBeInTheDocument();
    expect(within(diario).getByTestId("chip-diary-empty")).toBeInTheDocument();
  });

  it("sem alerta, o diário fica como antes", () => {
    render(<ChipDiaryView data={{ available: true, items: [] }} />);
    expect(screen.queryByTestId("chip-alert-banner")).not.toBeInTheDocument();
  });
});
