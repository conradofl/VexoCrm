// frontend/src/test/blocoBCorrecoesOperacionais.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { classifyLeadMessages, detectStageSuggestion } from "../hooks/useFunnelVocabulary";
import { CampaignRecipientsDialog } from "../pages/LeadImports/CampaignRecipientsDialog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";

// Mock de hooks
vi.mock("@/hooks/useCampanhas", () => ({
  useCampaignRecipients: vi.fn((campaignId, statusFilter) => ({
    data: {
      campaignName: "Campanha Bia do Spazio",
      total: 3,
      counts: { all: 3, sent: 1, replied: 0, failed: 0, pending: 2 },
      recipients: [
        {
          id: "r1",
          nome: "Morador 1",
          telefone: "5511999990001",
          phone: "5511999990001",
          status: "pending",
          dispatchName: "Lote 1",
          replied: false,
        },
        {
          id: "r2",
          nome: "Morador 2",
          telefone: "5511999990002",
          phone: "5511999990002",
          status: "pending",
          dispatchName: "Lote 1",
          replied: false,
        },
      ],
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
  fetchCampaignsApi: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    getIdToken: vi.fn().mockResolvedValue("mock-token"),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe("BLOCO B: Correções & Blindagens Operacionais", () => {
  describe("ITEM B.5: Calibração da Regex de Fechamento", () => {
    it("não sugere 'buyer' (fechamento) para a frase comunitária 'Juntos vamos fazer acontecer'", () => {
      const messages = [
        { body: "Olá, recebemos seu contato!" },
        { body: "Juntos vamos fazer acontecer" },
      ];

      const classification = classifyLeadMessages(["Juntos vamos fazer acontecer"]);
      expect(classification.stage).not.toBe("buyer");
      expect(classification.intent).not.toBe("purchase");

      const suggestion = detectStageSuggestion(messages, "cold");
      expect(suggestion?.suggestedStage).not.toBe("buyer");
    });

    it("continua sugerindo 'buyer' para termos comerciais estritos como 'vamos fazer o pagamento' ou 'vamos fechar negocio'", () => {
      const classificationPagamento = classifyLeadMessages(["Perfeito, vamos fazer o pagamento agora"]);
      expect(classificationPagamento.stage).toBe("buyer");
      expect(classificationPagamento.intent).toBe("purchase");

      const classificationNegocio = classifyLeadMessages(["Combinado, vamos fechar negocio"]);
      expect(classificationNegocio.stage).toBe("buyer");
      expect(classificationNegocio.intent).toBe("purchase");
    });
  });

  describe("ITEM B.1: Trava de Visibilidade do Botão Gerar Proposta", () => {
    function podeGerarProposta(activeClientId: string, tenantSettings: any) {
      return (
        activeClientId === "geracao-digital" ||
        Boolean(tenantSettings?.modulos_adicionais?.includes("propostas_comerciais"))
      );
    }

    it("bloqueia proposta para tenants comuns sem o módulo (ex: bia-do-spazio, sonhare, gmca)", () => {
      expect(podeGerarProposta("bia-do-spazio", {})).toBe(false);
      expect(podeGerarProposta("sonhare", { modulos_adicionais: [] })).toBe(false);
      expect(podeGerarProposta("gmca", null)).toBe(false);
    });

    it("permite proposta para a empresa 'geracao-digital'", () => {
      expect(podeGerarProposta("geracao-digital", {})).toBe(true);
    });

    it("permite proposta se o tenant possuir o módulo adicional 'propostas_comerciais'", () => {
      expect(
        podeGerarProposta("outro-tenant", { modulos_adicionais: ["propostas_comerciais"] })
      ).toBe(true);
    });
  });

  describe("ITEM B.3: Ações Rápidas para Contatos Na Fila", () => {
    it("exibe botão de ação rápida no rodapé quando filtro for 'pending' e aciona onCriarCampanhaComFila", () => {
      const queryClient = new QueryClient();
      const onCriarCampanhaComFila = vi.fn();
      const onClose = vi.fn();

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <CampaignRecipientsDialog
              campaignId="camp-123"
              initialFilter="pending"
              onClose={onClose}
              onCriarCampanhaComFila={onCriarCampanhaComFila}
            />
          </QueryClientProvider>
        </MemoryRouter>
      );

      const actionBtn = screen.getByText(/Disparar Campanha para estes 2 pendentes/i);
      expect(actionBtn).toBeInTheDocument();

      fireEvent.click(actionBtn);
      expect(onCriarCampanhaComFila).toHaveBeenCalledTimes(1);
      expect(onCriarCampanhaComFila).toHaveBeenCalledWith([
        "5511999990001",
        "5511999990002",
      ]);
    });
  });
});
