// Aviso de opt-out na prévia e no público: texto e regra de quando NÃO aparecer.
// Presença no DOM só; visibilidade e posição estão no harness de Chromium (e2e/harness/optout-aviso.harness.pw.ts).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OptOutSkipNotice, optOutSkipNoticeText } from "@/components/leads/OptOutSkipNotice";

describe("optOutSkipNoticeText", () => {
  it("público: singular, plural com milhar, e avisa que o total não muda", () => {
    expect(optOutSkipNoticeText(1)).toBe("1 lead deste público pediu para não receber mensagens e será pulado no envio. O total não muda.");
    expect(optOutSkipNoticeText(2)).toBe("2 leads deste público pediram para não receber mensagens e serão pulados no envio. O total não muda.");
    expect(optOutSkipNoticeText(1234)).toContain("1.234 leads deste público");
  });

  it("lote: fala dos não processados", () => {
    expect(optOutSkipNoticeText(1, "lote")).toBe("1 dos não processados pediu para não receber mensagens e será pulado no envio.");
    expect(optOutSkipNoticeText(3, "lote")).toBe("3 dos não processados pediram para não receber mensagens e serão pulados no envio.");
  });

  it("sem o que avisar ou sem saber contar, não há texto: zero, null, undefined, negativo, NaN", () => {
    for (const v of [0, null, undefined, -1, Number.NaN]) expect(optOutSkipNoticeText(v as number | null | undefined)).toBeNull();
  });
});

describe("<OptOutSkipNotice />", () => {
  it("renderiza a linha quando há quem pular", () => {
    render(<OptOutSkipNotice count={2} />);
    expect(screen.getByTestId("optout-skip-notice").textContent).toContain("2 leads deste público pediram");
  });

  it("não renderiza nada com zero nem com null", () => {
    const { container, rerender } = render(<OptOutSkipNotice count={0} />);
    expect(container.firstChild).toBeNull();
    rerender(<OptOutSkipNotice count={null} />);
    expect(container.firstChild).toBeNull();
  });
});
