// SPEC 17 — o número que a tela mostra é o número que sai. Sem lotes, o público inteiro; o único limite é o opcional.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DispatchVolumeNotice } from "@/pages/LeadImports/DispatchVolumeNotice";
import { buildCampaignFields } from "@/pages/LeadImports/CampaignsTable";
import { describeDispatchVolume, parseDispatchCap } from "@/lib/leadImports/dispatchVolume";
import type { Campaign, CampaignDispatch } from "@/hooks/useCampanhas";

const noop = () => {};
const texto = () => screen.getByTestId("dispatch-volume-text").textContent;

describe("SPEC 17 — aviso do volume real no passo de agendamento", () => {
  it("[OBRIGATÓRIO] sem lotes e sem limite digitado: 120 leads → 'vão sair 120', nunca o 50 padrão", () => {
    render(<DispatchVolumeNotice totalLeads={120} batchingEnabled={false} batchSize="100" capText="" onCapChange={noop} />);
    expect(texto()).toBe("120 leads vão sair neste envio.");
  });

  it("limite opcional 'só os primeiros 30' de 120: diz quantos saem e quantos NÃO saem", () => {
    render(<DispatchVolumeNotice totalLeads={120} batchingEnabled={false} batchSize="100" capText="30" onCapChange={noop} />);
    expect(texto()).toBe("30 de 120 leads vão sair. Os outros 90 não saem.");
  });

  it("limite maior ou igual ao público não corta nada: continua 'vão sair 120'", () => {
    render(<DispatchVolumeNotice totalLeads={120} batchingEnabled={false} batchSize="100" capText="500" onCapChange={noop} />);
    expect(texto()).toBe("120 leads vão sair neste envio.");
  });

  it("com lotes: total, quantidade de lotes e tamanho; e o campo de limite some", () => {
    render(<DispatchVolumeNotice totalLeads={120} batchingEnabled batchSize="10" capText="" onCapChange={noop} />);
    expect(texto()).toBe("120 leads em 12 lotes de até 10.");
    expect(screen.queryByTestId("dispatch-cap-input")).toBeNull();
  });

  it("o campo de limite nasce VAZIO e avisa o texto digitado", () => {
    const onCapChange = vi.fn();
    render(<DispatchVolumeNotice totalLeads={120} batchingEnabled={false} batchSize="100" capText="" onCapChange={onCapChange} />);
    const input = screen.getByTestId("dispatch-cap-input") as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "30" } });
    expect(onCapChange).toHaveBeenCalledWith("30");
  });

  it("sem público não mostra nada; limite inválido (0, negativo, texto) vale como sem limite", () => {
    const { container } = render(<DispatchVolumeNotice totalLeads={0} batchingEnabled={false} batchSize="100" capText="" onCapChange={noop} />);
    expect(container.firstChild).toBeNull();
    for (const invalido of ["0", "-3", "abc", " "]) expect(parseDispatchCap(invalido)).toBeNull();
    expect(describeDispatchVolume({ totalLeads: 120, batchingEnabled: false, batchSize: "100", capText: "abc" })).toEqual({ kind: "all", total: 120 });
  });
});

describe("SPEC 17 — coluna 'Leads' da listagem vem dos lotes, não do limit_per_run da campanha", () => {
  const campanha = { id: "c1", name: "TESTE", limit_per_run: 50 } as unknown as Campaign;
  const lote = (over: Partial<CampaignDispatch>) => ({ id: "d", campaign_id: "c1", status: "done", target_count: 0, ...over }) as unknown as CampaignDispatch;
  const leads = (dispatches?: CampaignDispatch[]) => {
    const campo = buildCampaignFields(dispatches).find((f) => f.key === "leads")!;
    return campo.render(campanha);
  };

  it("[OBRIGATÓRIO] campanha com limit_per_run 50 e um lote de 120: mostra 120, nunca '50 leads por lote'", () => {
    expect(leads([lote({ target_count: 120 })])).toBe("120 leads");
  });

  it("vários lotes: soma e quantidade; lote cancelado e lote de outra campanha não entram", () => {
    const lotes = [
      lote({ id: "a", target_count: 7 }), lote({ id: "b", target_count: 7 }), lote({ id: "c", target_count: 7 }),
      lote({ id: "x", target_count: 99, status: "cancelled" }), lote({ id: "y", target_count: 99, campaign_id: "outra" }),
    ];
    expect(leads(lotes)).toBe("21 leads em 3 lotes");
  });

  it("campanha sem nenhum lote (rascunho) diz que não há envio criado", () => {
    expect(leads([])).toBe("Sem envio criado");
    expect(leads(undefined)).toBe("Sem envio criado");
  });
});
