// Diário do chip na aba "Saúde & Volume". Dados no formato da rota /api/reports/chip-diary, com os números medidos em
// produção (Nous, 17/11/2026): Chip 2 caiu às 09:38:21 (SP) por "aparelho removido", 7 s depois do último envio, com
// 46 envios na última hora e a cota do dia em 50 de 50; Chip 1 caiu em 13/11 sem nenhum envio do Vexo.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ChipDiaryView, describeSnapshot, formatDiaryTime } from "@/components/chips/ChipDiary";
import type { ChipDiaryReport } from "@/hooks/useReports";

const MOTIVO =
  "Aparelho removido do WhatsApp: a conexão do Vexo saiu de \"Aparelhos conectados\". Alguém removeu pelo celular, ou o próprio WhatsApp desconectou. (código 401)";

export const DIARIO_NOUS: ChipDiaryReport = {
  available: true,
  items: [
    {
      id: "e3",
      instance_name: "nous-gestao-chip-2-nous",
      chip_name: "Chip 2 - NOUS",
      kind: "conectado",
      occurred_at: "2026-11-17T15:02:00.000Z",
      occurred_at_approx: false,
      reason_code: null,
      reason_kind: null,
      reason_label: "Chip conectado de novo.",
      snapshot: null,
    },
    {
      id: "e2",
      instance_name: "nous-gestao-chip-2-nous",
      chip_name: "Chip 2 - NOUS",
      kind: "queda",
      occurred_at: "2026-11-17T12:38:21.100Z",
      occurred_at_approx: false,
      reason_code: 401,
      reason_kind: "aparelho_removido",
      reason_label: MOTIVO,
      snapshot: {
        limite_diario: 50,
        envios_1h: 46,
        envios_24h: 46,
        ultimo_envio: "2026-11-17T12:38:14.000Z",
        segundos_do_ultimo_envio_ate_a_queda: 7,
        invalidos_24h: 37,
        cota_usada_no_dia: 50,
      },
    },
    {
      id: "e1",
      instance_name: "nous-gestao-chip-1-nous",
      chip_name: "Chip 1 - NOUS",
      kind: "queda",
      occurred_at: "2026-11-13T17:02:21.536Z",
      occurred_at_approx: false,
      reason_code: 401,
      reason_kind: "aparelho_removido",
      reason_label: MOTIVO,
      snapshot: { limite_diario: 50, envios_1h: 0, envios_24h: 0, ultimo_envio: null, segundos_do_ultimo_envio_ate_a_queda: null, invalidos_24h: 0, cota_usada_no_dia: null },
    },
  ],
};

describe("textos do diário", () => {
  it("hora no horário de São Paulo, com segundos", () => {
    expect(formatDiaryTime("2026-11-17T12:38:21.100Z")).toBe("17/11/2026, 09:38:21");
  });

  it("foto do Chip 2: envios, último envio, cota do dia e inexistentes", () => {
    expect(describeSnapshot(DIARIO_NOUS.items[1].snapshot)).toEqual([
      "Antes da queda: 46 envios de campanha na última hora (46 em 24 h), último envio 7 s antes da queda.",
      "Mensagens do chip no dia (campanha, fila de resposta, follow-up e agente): 50 de 50.",
      "37 números inexistentes no WhatsApp nos lotes deste chip nas 24 h antes.",
    ]);
  });

  it("chip que caiu sem nenhum envio do Vexo diz isso com todas as letras", () => {
    expect(describeSnapshot(DIARIO_NOUS.items[2].snapshot)).toEqual([
      "O Vexo não enviou mensagens de campanha por este chip nas 24 h antes da queda.",
    ]);
  });

  it("intervalos maiores em minutos e horas; sem foto, nada", () => {
    expect(describeSnapshot({ envios_1h: 1, envios_24h: 3, segundos_do_ultimo_envio_ate_a_queda: 600 })[0]).toContain("último envio 10 min antes");
    expect(describeSnapshot({ envios_1h: 0, envios_24h: 3, segundos_do_ultimo_envio_ate_a_queda: 10800 })[0]).toContain("último envio 3 h antes");
    expect(describeSnapshot(null)).toEqual([]);
  });
});

describe("[OBRIGATÓRIO] bloco 'Diário do chip'", () => {
  it("lista quedas e voltas da mais recente para a mais antiga, com motivo e foto só nas quedas", () => {
    render(<ChipDiaryView data={DIARIO_NOUS} />);
    const eventos = screen.getAllByTestId("chip-diary-event");
    expect(eventos.map((e) => e.getAttribute("data-kind"))).toEqual(["conectado", "queda", "queda"]);
    expect(eventos[0]).toHaveTextContent("Chip 2 - NOUS voltou");
    expect(within(eventos[0]).queryByTestId("chip-diary-reason")).toBeNull();
    expect(eventos[1]).toHaveTextContent("Chip 2 - NOUS caiu");
    expect(eventos[1]).toHaveTextContent("17/11/2026, 09:38:21");
    expect(within(eventos[1]).getByTestId("chip-diary-reason")).toHaveTextContent(MOTIVO);
    expect(within(eventos[1]).getAllByTestId("chip-diary-snapshot")).toHaveLength(3);
    expect(eventos[2]).toHaveTextContent("O Vexo não enviou mensagens de campanha por este chip nas 24 h antes da queda.");
  });

  it("hora aproximada aparece marcada", () => {
    const aprox = { ...DIARIO_NOUS, items: [{ ...DIARIO_NOUS.items[0], occurred_at_approx: true }] };
    render(<ChipDiaryView data={aprox} />);
    expect(screen.getByTestId("chip-diary-event")).toHaveTextContent("(hora aproximada)");
  });

  it("antes da migration, vazio e erro: cada um com o seu texto", () => {
    const { rerender } = render(<ChipDiaryView data={{ available: false, items: [] }} />);
    expect(screen.getByTestId("chip-diary-unavailable")).toHaveTextContent("depois da próxima atualização do sistema");
    rerender(<ChipDiaryView data={{ available: true, items: [] }} />);
    expect(screen.getByTestId("chip-diary-empty")).toHaveTextContent("Nenhuma queda registrada");
    rerender(<ChipDiaryView error={new Error("Falha ao carregar o diário do chip")} />);
    expect(screen.getByTestId("chip-diary")).toHaveTextContent("Falha ao carregar o diário do chip");
  });
});
