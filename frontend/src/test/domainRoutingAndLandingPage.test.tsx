// frontend/src/test/domainRoutingAndLandingPage.test.ts
//
// Suíte de Testes Automatizados — Item 13: Landing Page e Separação de Domínio
// Cobrindo:
// 1. Detecção de domínio do CRM (isCrmDomain)
// 2. Resolução da URL de Login dinamicamente (getCrmLoginUrl)
// 3. Renderização dos 4 Pilares Reais do Vexo OS e CTAs da Landing Page

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { isCrmDomain, getCrmLoginUrl } from "../lib/domainRouting";
import LandingPage from "../pages/LandingPage";
import { RootRouteHandler } from "../App";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    isClientUser: false,
    defaultRoute: "/crm/dashboard",
  }),
}));

describe("Item 13: Landing Page e Separação de Domínio", () => {
  describe("1. Segregação de Domínio — isCrmDomain", () => {
    it("identifica subdomínio de produção crm.vexoia.com como CRM", () => {
      expect(isCrmDomain("crm.vexoia.com")).toBe(true);
    });

    it("identifica subdomínio alternativo app.vexoia.com como CRM", () => {
      expect(isCrmDomain("app.vexoia.com")).toBe(true);
    });

    it("identifica subdomínios de preview/staging com prefixo ou sufixo crm", () => {
      expect(isCrmDomain("crm-staging.vercel.app")).toBe(true);
      expect(isCrmDomain("preview-crm.vexo.app")).toBe(true);
    });

    it("identifica override via query param ?app=crm ou ?mode=crm", () => {
      expect(isCrmDomain("vexoia.com", "?app=crm")).toBe(true);
      expect(isCrmDomain("localhost", "?mode=crm")).toBe(true);
    });

    it("retorna false para domínios institucionais vexoia.com e www.vexoia.com", () => {
      expect(isCrmDomain("vexoia.com")).toBe(false);
      expect(isCrmDomain("www.vexoia.com")).toBe(false);
    });

    it("retorna false para ambiente de desenvolvimento local padrão (localhost / 127.0.0.1)", () => {
      expect(isCrmDomain("localhost")).toBe(false);
      expect(isCrmDomain("127.0.0.1")).toBe(false);
    });
  });

  describe("2. URL do Botão de Acesso ao CRM — getCrmLoginUrl", () => {
    it("redireciona para https://crm.vexoia.com/login quando acessado de vexoia.com", () => {
      expect(getCrmLoginUrl("vexoia.com")).toBe("https://crm.vexoia.com/login");
      expect(getCrmLoginUrl("www.vexoia.com")).toBe("https://crm.vexoia.com/login");
    });

    it("retorna rota relativa /login para ambiente de desenvolvimento local ou quando já no CRM", () => {
      expect(getCrmLoginUrl("localhost")).toBe("/login");
      expect(getCrmLoginUrl("127.0.0.1")).toBe("/login");
      expect(getCrmLoginUrl("crm.vexoia.com")).toBe("/login");
    });
  });

  describe("3. Conteúdo e Estrutura da Landing Page (LandingPage.tsx)", () => {
    it("renderiza a headline principal focada em inteligência comercial para quem decide vendas", () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      expect(
        screen.getByText(/A inteligência comercial para/i)
      ).toBeInTheDocument();
      expect(
        screen.getAllByText(/quem decide vendas/i).length
      ).toBeGreaterThanOrEqual(1);
    });

    it("exibe os 4 Princípios do Método Vexo de acelerar vendas", () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      expect(screen.getByText("Decisão antes da burocracia.")).toBeInTheDocument();
      expect(screen.getByText("Conversa antes da ferramenta.")).toBeInTheDocument();
      expect(screen.getByText("Trava humana antes da autonomia cega.")).toBeInTheDocument();
      expect(screen.getByText("Contrato assinado antes da vaidade.")).toBeInTheDocument();
    });

    it("exibe as credenciais de autoridade no rodapé do hero", () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      expect(screen.getByText("De gente de Negócio, Para gente de Negócio")).toBeInTheDocument();
      expect(screen.getByText("Anti-bloqueio inteligente e conversas num lugar só")).toBeInTheDocument();
      expect(screen.getByText("Você sempre no controle do funil & Contratos em PDF")).toBeInTheDocument();
    });

    it("renderiza as novas seções da Parte 2: Prova, Módulos, Implantação, Planos e Diagnóstico", () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      // Seção 2: Prova
      expect(screen.getByText(/Números de operação real, não de simulação/i)).toBeInTheDocument();

      // Seção 6: Módulos
      expect(screen.getByText(/O Núcleo vem sempre/i)).toBeInTheDocument();
      expect(screen.getByText(/Os módulos você escolhe/i)).toBeInTheDocument();

      // Seção 7: Implantação
      expect(screen.getByText(/No ar em/i)).toBeInTheDocument();

      // Seção 8: Planos
      expect(screen.getByText(/Planos transparentes para/i)).toBeInTheDocument();
      expect(screen.getAllByText("DISPARO").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("ESSENCIAL").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("AVANÇADO").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("PLUS").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/\+ R\$ 1\.500 setup/i)).toBeInTheDocument();
      expect(screen.getByText(/\+ setup a partir de R\$ 3\.500/i)).toBeInTheDocument();
      expect(screen.getByText(/O setup é o trabalho de colocar no ar/i)).toBeInTheDocument();

      // Seção 9: FAQ
      expect(screen.getByText(/E se eu escolher o módulo errado\?/i)).toBeInTheDocument();

      // Seção 10: Diagnóstico Grátis
      expect(screen.getByText(/Quanto dinheiro está parado/i)).toBeInTheDocument();
    });

    it("exibe os botões de CTA primário e de acesso à plataforma", () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      // CTA principal da página
      const demoButton = screen.getByRole("button", { name: /Conhecer Vexo OS/i });
      expect(demoButton).toBeInTheDocument();

      // CTA de acesso à plataforma
      const accessButtons = screen.getAllByText(/Acessar Plataforma/i);
      expect(accessButtons.length).toBeGreaterThan(0);
    });
  });

  describe("4. Roteamento da Raiz — RootRouteHandler", () => {
    it("renderiza LandingPage quando acessado via domínio institucional ou localhost", () => {
      render(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<RootRouteHandler />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText(/A inteligência comercial para/i)).toBeInTheDocument();
    });

    it("redireciona para /login se acessado via domínio do CRM e não autenticado", () => {
      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        writable: true,
        value: { ...originalLocation, hostname: "crm.vexoia.com", search: "" }
      });

      render(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<RootRouteHandler />} />
            <Route path="/login" element={<div>Tela de Login do CRM</div>} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText("Tela de Login do CRM")).toBeInTheDocument();
      Object.defineProperty(window, "location", {
        writable: true,
        value: originalLocation
      });
    });
  });
});
