// frontend/src/test/landingPage.test.tsx

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import LandingPage from "../pages/LandingPage";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    isClientUser: false,
    defaultRoute: "/login",
  }),
}));

describe("LandingPage Modular (Reverse-Engineered Architecture)", () => {
  it("renders the hero headline and core branding", () => {
    render(
      <BrowserRouter>
        <LandingPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/A inteligência comercial para/i)).toBeInTheDocument();
    expect(screen.getByText(/quem decide vendas/i)).toBeInTheDocument();
    expect(screen.getAllByText(/VEXO OS/i).length).toBeGreaterThan(0);
  });

  it("opens the lead capture modal when clicking Conhecer Vexo OS", () => {
    render(
      <BrowserRouter>
        <LandingPage />
      </BrowserRouter>
    );

    const demoButton = screen.getByRole("button", { name: /Conhecer Vexo OS/i });
    expect(demoButton).toBeInTheDocument();

    // Abre o modal
    fireEvent.click(demoButton);

    expect(screen.getByText(/Conhecer o Vexo OS/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Ex: Carlos Eduardo/i)).toBeInTheDocument();

    // Fecha o modal
    const closeBtn = screen.getByLabelText(/Fechar modal/i);
    fireEvent.click(closeBtn);

    expect(screen.queryByText(/Conhecer o Vexo OS/i)).not.toBeInTheDocument();
  });

  it("toggles the FAQ accordion when clicked", () => {
    render(
      <BrowserRouter>
        <LandingPage />
      </BrowserRouter>
    );

    const faqQuestion = screen.getByText(/O agente de IA substitui meu time de vendas\?/i);
    expect(faqQuestion).toBeInTheDocument();

    // Clica para expandir
    fireEvent.click(faqQuestion);

    expect(
      screen.getByText(/Não\. O Vexo OS foi desenvolvido para potencializar seus vendedores/i)
    ).toBeInTheDocument();
  });
});
