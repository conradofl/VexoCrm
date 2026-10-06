// O painel "Tentar outro número" (Bloco B): os avisos da prévia ficam NA TELA, com os números reais, e a opção de mandar para os dois números
// nasce desmarcada. A frase do caminho antigo e a das respostas que não ligam a envio são do dono: o teste as trava.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SecondNumberPanel, type SecondNumberSelection } from "@/components/leads/SecondNumberPanel";
import { secondNumberHandoffRows, secondNumberNotices, type SecondNumberCounts } from "@/lib/leads/leadListApi";

const counts = (over: Partial<SecondNumberCounts> = {}): SecondNumberCounts => ({
  received: 1200,
  semAdicional: 300,
  respondeuMesmoNumero: 250,
  respondeuOutroNumero: 41,
  dentroDoPrazo: 9,
  elegiveis: 600,
  lidNaoLigadas: 511,
  campanhasCaminhoAntigo: 7,
  periodoDesde: "2026-09-01T10:00:00.000Z",
  waitDays: 7,
  ...over,
});

function makeRequest(c: SecondNumberCounts, items: unknown[] = []) {
  return vi.fn(async (path: string) => {
    if (path.startsWith("/api/leads/second-number/campaigns")) {
      return new Response(JSON.stringify({ items: [{ id: "c1", name: "Camp A", sentCount: 1200, lastSentAt: null }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ counts: c, items }), { status: 200 });
  });
}

describe("secondNumberNotices (as frases)", () => {
  it("excluídos por já terem respondido em outro número", () => {
    expect(secondNumberNotices(counts()).excluded).toBe("41 excluídos por já terem respondido em outro número");
    expect(secondNumberNotices(counts({ respondeuOutroNumero: 1 })).excluded).toBe("1 excluído por já ter respondido em outro número");
  });
  it("respostas que não puderam ser ligadas a um envio, com o número real", () => {
    const t = secondNumberNotices(counts()).unlinked;
    expect(t).toContain("511 respostas deste período não puderam ser ligadas a um envio");
    expect(t).toContain("não achamos resposta");
  });
  it("campanhas do caminho antigo: a frase e o número; sem medir, diz que não mediu", () => {
    expect(secondNumberNotices(counts()).legacy).toBe(
      "7 campanhas disparadas pelo caminho antigo não aparecem aqui: elas não gravam o registro de envio e o cruzamento não as enxerga."
    );
    expect(secondNumberNotices(counts({ campanhasCaminhoAntigo: null })).legacy).toContain("Não foi possível conferir");
  });
});

describe("<SecondNumberPanel />", () => {
  it("mostra os três avisos na tela (não em tooltip) depois de escolher a campanha", async () => {
    const request = makeRequest(counts());
    const onChange = vi.fn();
    render(<SecondNumberPanel request={request} clientId="t" onChange={onChange} />);
    await screen.findByText(/Camp A \(1\.200 envios\)/);
    fireEvent.change(screen.getByTestId("second-number-campaign"), { target: { value: "c1" } });
    await waitFor(() => expect(screen.getByTestId("second-number-preview")).toBeTruthy());
    expect(screen.getByTestId("second-number-excluded").textContent).toBe("41 excluídos por já terem respondido em outro número");
    expect(screen.getByTestId("second-number-unlinked").textContent).toContain("511 respostas deste período não puderam ser ligadas a um envio");
    expect(screen.getByTestId("second-number-legacy").textContent).toContain("7 campanhas disparadas pelo caminho antigo não aparecem aqui");
    expect(screen.getByTestId("second-number-eligible").textContent).toBe("600");
    for (const id of ["second-number-excluded", "second-number-unlinked", "second-number-legacy"]) {
      expect(screen.getByTestId(id).getAttribute("title")).toBeNull();
    }
  });

  it("'mandar para os dois números' nasce DESMARCADO, avisa que é a mesma empresa duas vezes e vai para a seleção quando marcado", async () => {
    const request = makeRequest(counts());
    let ultima: SecondNumberSelection | null = null;
    render(<SecondNumberPanel request={request} clientId="t" onChange={(s) => (ultima = s)} />);
    const box = screen.getByTestId("second-number-both") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(/a mesma empresa recebendo duas vezes/i)).toBeTruthy();
    expect(ultima!.includePrincipal).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(ultima!.includePrincipal).toBe(true));
  });

  it("sem campanha escolhida, não pede público ao servidor", async () => {
    const request = makeRequest(counts());
    render(<SecondNumberPanel request={request} clientId="t" onChange={() => {}} />);
    await screen.findByText(/Camp A/);
    expect(request.mock.calls.filter(([p]) => String(p).includes("/audience"))).toHaveLength(0);
  });

  it("pai que recria o `request` a cada render não provoca laço de requisições", async () => {
    let n = 0;
    function Pai() {
      n += 1;
      return <SecondNumberPanel request={(...a) => reqFixa(...(a as [string]))} clientId="t" onChange={() => {}} />;
    }
    const reqFixa = makeRequest(counts());
    const { rerender } = render(<Pai />);
    await screen.findByText(/Camp A/);
    fireEvent.change(screen.getByTestId("second-number-campaign"), { target: { value: "c1" } });
    await waitFor(() => expect(screen.getByTestId("second-number-preview")).toBeTruthy());
    rerender(<Pai />);
    rerender(<Pai />);
    await new Promise((r) => setTimeout(r, 50));
    expect(reqFixa.mock.calls.filter(([p]) => String(p).includes("/audience"))).toHaveLength(1);
    expect(reqFixa.mock.calls.filter(([p]) => String(p).includes("/campaigns"))).toHaveLength(1);
    expect(n).toBeGreaterThan(0);
  });

  it("falha do servidor aparece como alerta, sem prévia", async () => {
    const request = vi.fn(async (path: string) =>
      path.includes("/campaigns")
        ? new Response(JSON.stringify({ items: [{ id: "c1", name: "Camp A", sentCount: 3, lastSentAt: null }] }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: "Falha ao montar o público da segunda tentativa." } }), { status: 500 })
    );
    render(<SecondNumberPanel request={request} clientId="t" onChange={() => {}} />);
    await screen.findByText(/Camp A/);
    fireEvent.change(screen.getByTestId("second-number-campaign"), { target: { value: "c1" } });
    await screen.findByRole("alert");
    expect(screen.queryByTestId("second-number-preview")).toBeNull();
  });
});

describe("secondNumberHandoffRows (o que segue para a central de campanhas)", () => {
  const items = [
    { leadId: "1", nome: "Ana", principal: "5534991110001", alvo: "5534992220001", alvoColuna: "Telefone 2" },
    { leadId: "2", nome: "Beto", principal: "5534991110002", alvo: "5534992220002", alvoColuna: null },
  ];
  it("por padrão: UMA linha por empresa, no número adicional — o principal nunca vira telefone", () => {
    const rows = secondNumberHandoffRows(items, "Camp A", false);
    expect(rows.map((r) => r.telefone)).toEqual(["5534992220001", "5534992220002"]);
    expect(rows.every((r) => r.segunda_tentativa_de === "Camp A")).toBe(true);
  });
  it("com a opção marcada de propósito: as duas linhas da mesma empresa", () => {
    const rows = secondNumberHandoffRows(items, "Camp A", true);
    expect(rows.map((r) => r.telefone)).toEqual(["5534992220001", "5534991110001", "5534992220002", "5534991110002"]);
  });
});
