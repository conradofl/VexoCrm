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

    expect(screen.getByText(/Identificação & Contato/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Como podemos te chamar\?/i)).toBeInTheDocument();

    // Fecha o modal
    const closeBtn = screen.getByLabelText(/Fechar modal/i);
    fireEvent.click(closeBtn);

    expect(screen.queryByText(/Identificação & Contato/i)).not.toBeInTheDocument();
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

  it("submits lead capture form through 4 diagnostic steps and displays WhatsApp confirmation", async () => {
    // Mock global fetch for API submission
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        success: true,
        message: "Pronto! Te mandamos uma mensagem no WhatsApp (34) *****-1267.",
        phoneMasked: "(34) *****-1267",
      }),
    });

    render(
      <BrowserRouter>
        <LandingPage />
      </BrowserRouter>
    );

    const demoButton = screen.getByRole("button", { name: /Conhecer Vexo OS/i });
    fireEvent.click(demoButton);

    // PASSO 1
    const nameInput = screen.getByPlaceholderText(/Como podemos te chamar\?/i);
    const phoneInput = screen.getByPlaceholderText(/\(00\) 00000-0000/i);
    const emailInput = screen.getByPlaceholderText(/seu@empresa\.com/i);

    fireEvent.change(nameInput, { target: { value: "Carlos Teste" } });
    fireEvent.change(phoneInput, { target: { value: "34991751267" } });
    fireEvent.change(emailInput, { target: { value: "carlos@empresa.com" } });

    const step1Form = nameInput.closest("form")!;
    fireEvent.submit(step1Form);

    // PASSO 2
    expect(await screen.findByText(/Sua Empresa & Equipe/i)).toBeInTheDocument();
    const companyInput = screen.getByPlaceholderText(/Ex: Minha Empresa/i);
    fireEvent.change(companyInput, { target: { value: "Empresa Teste" } });
    const step2Form = companyInput.closest("form")!;
    fireEvent.submit(step2Form);

    // PASSO 3
    expect(await screen.findByText(/(?:Sua Base & Números|Seus contatos e suas vendas)/i)).toBeInTheDocument();
    const step3Form = screen.getByText(/(?:Tamanho da sua base total de contatos|Quantos contatos você tem guardados)/i).closest("form")!;
    fireEvent.submit(step3Form);

    // PASSO 4
    expect(await screen.findByText(/(?:Processo & Gargalo|Como você atende hoje)/i)).toBeInTheDocument();
    const step4Form = screen.getByText(/(?:Tempo médio para primeiro atendimento|Quando alguém te chama, em quanto tempo você responde)/i).closest("form")!;
    fireEvent.submit(step4Form);

    // TELA DE CONFIRMAÇÃO
    expect(await screen.findByText(/Pronto!/i)).toBeInTheDocument();
    expect(screen.getByText(/Te mandamos uma mensagem no WhatsApp/i)).toBeInTheDocument();
    expect(screen.getByText(/\(34\) \*\*\*\*\*-1267/i)).toBeInTheDocument();

    const whatsappLink = screen.getByRole("link", { name: /Abrir WhatsApp Agora →/i });
    expect(whatsappLink).toBeInTheDocument();
    expect(whatsappLink).toHaveAttribute("href", expect.stringContaining("wa.me"));

    global.fetch = originalFetch;
  });
});
