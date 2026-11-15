// Tela Leads Parados: "Nunca abordados" é o número da Visão geral do Dashboard. Conta que falhou mostra
// travessão e motivo, nunca zero.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeadsParadosHeader } from "@/pages/LeadsParados/LeadsParadosHeader";

describe("Leads Parados — nunca abordados", () => {
  it("mostra o número com separador de milhar e diz de onde ele vem", () => {
    render(<LeadsParadosHeader count={2} minDays={7} neverApproachedCount={80033} />);
    expect(screen.getByTestId("never-approached-count")).toHaveTextContent("80.033");
    expect(screen.getByText("Mesmo número da Visão geral do Dashboard.")).toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] conta indisponível: travessão e motivo, nunca zero", () => {
    render(<LeadsParadosHeader count={2} minDays={7} neverApproachedCount={null} />);
    expect(screen.getByTestId("never-approached-count")).toHaveTextContent("—");
    expect(screen.getByTestId("never-approached-count")).not.toHaveTextContent("0");
    expect(screen.getByText("Não foi possível calcular agora.")).toBeInTheDocument();
  });

  it("zero medido continua sendo zero", () => {
    render(<LeadsParadosHeader count={2} minDays={7} neverApproachedCount={0} />);
    expect(screen.getByTestId("never-approached-count")).toHaveTextContent("0");
  });
});
