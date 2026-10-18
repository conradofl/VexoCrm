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

    expect(screen.getAllByText(/A inteligência comercial para/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/quem decide vendas/i).length).toBeGreaterThan(0);
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
    expect(screen.getByPlaceholderText(/Seu nome/i)).toBeInTheDocument();

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

  it("submits lead capture form and displays direct WhatsApp connection button", async () => {
    render(
      <BrowserRouter>
        <LandingPage />
      </BrowserRouter>
    );

    const demoButton = screen.getByRole("button", { name: /Conhecer Vexo OS/i });
    fireEvent.click(demoButton);

    const nameInput = screen.getByPlaceholderText(/Seu nome/i);
    const phoneInput = screen.getByPlaceholderText(/\(00\) 00000-0000/i);
    const emailInput = screen.getByPlaceholderText(/seu@empresa\.com/i);

    fireEvent.change(nameInput, { target: { value: "Carlos Teste" } });
    fireEvent.change(phoneInput, { target: { value: "34999999999" } });
    fireEvent.change(emailInput, { target: { value: "carlos@teste.com" } });

    const submitBtn = screen.getByRole("button", { name: /Avançar para WhatsApp Comercial/i });
    const form = submitBtn.closest("form")!;
    fireEvent.submit(form);

    expect(await screen.findByText(/Solicitação Confirmada!/i)).toBeInTheDocument();
    const whatsappLink = screen.getByRole("link", { name: /Abrir WhatsApp Agora →/i });
    expect(whatsappLink).toBeInTheDocument();
    expect(whatsappLink).toHaveAttribute("href", expect.stringContaining("wa.me"));
  });
});
