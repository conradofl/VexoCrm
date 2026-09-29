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
    it("renderiza a headline principal focada em WhatsApp, vendas e contratos", () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      expect(
        screen.getByText(/Transforme conversas de WhatsApp em vendas fechadas e contratos assinados/i)
      ).toBeInTheDocument();
    });

    it("exibe todos os 4 Pilares Reais do Vexo OS", () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      // Pilar 1
      expect(screen.getByText("Agentes Inteligentes no WhatsApp")).toBeInTheDocument();
      // Pilar 2
      expect(screen.getByText("Ativação de Base & Recuperação")).toBeInTheDocument();
      // Pilar 3
      expect(screen.getByText("Funil com Inviolabilidade Manual")).toBeInTheDocument();
      // Pilar 4
      expect(screen.getByText("Contratos & Fechamento Ágil")).toBeInTheDocument();
    });

    it("exibe as métricas de impacto comercial da operação (24/7, 14 Dias, Zero Furos)", () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      expect(screen.getByText("24/7")).toBeInTheDocument();
      expect(screen.getByText("14 Dias")).toBeInTheDocument();
      expect(screen.getByText("Zero Furos")).toBeInTheDocument();
    });

    it("exibe os botões de CTA primário e secundário (Agendar Demonstração)", () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      // CTA para demonstração no WhatsApp
      const demoLinks = screen.getAllByRole("link", { name: /Agendar Demonstração/i });
      expect(demoLinks.length).toBeGreaterThan(0);
      expect(demoLinks[0]).toHaveAttribute("href", expect.stringContaining("wa.me"));

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

      expect(screen.getByText(/Transforme conversas de WhatsApp/i)).toBeInTheDocument();
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
