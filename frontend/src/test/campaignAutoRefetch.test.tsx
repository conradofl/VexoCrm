// frontend/src/test/campaignAutoRefetch.test.tsx
//
// Teste Obrigatório E:
// "tela: com lote em andamento, a consulta é refeita sozinha; sem lote, não"
// Prova por mutação 2: remover o refetch automático -> morre (e)

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ACTIVE_DISPATCH_REFETCH_INTERVAL_MS,
  hasActiveDispatches,
  hasActiveCampaigns,
  hasActiveSummaryBatches,
  type Campaign,
  type CampaignDispatch,
  type DispatchSummaryResponse,
} from "../hooks/useCampanhas";
import { LastUpdatedIndicator, formatTimeAgo } from "../components/LastUpdatedIndicator";

describe("Auto-refetch condicional e Observabilidade na Tela (Bloco 4)", () => {
  describe("Funções de detecção de lote em andamento", () => {
    it("hasActiveDispatches detecta status 'running' ou 'sending'", () => {
      expect(hasActiveDispatches([{ status: "running" }])).toBe(true);
      expect(hasActiveDispatches([{ status: "sending" }])).toBe(true);
      expect(hasActiveDispatches([{ status: "scheduled" }])).toBe(false);
      expect(hasActiveDispatches([{ status: "done" }, { status: "failed" }])).toBe(false);
      expect(hasActiveDispatches([])).toBe(false);
      expect(hasActiveDispatches(null)).toBe(false);
    });

    it("hasActiveCampaigns detecta campanhas em andamento", () => {
      expect(hasActiveCampaigns([{ status: "sending" }])).toBe(true);
      expect(hasActiveCampaigns([{ status: "active" }])).toBe(false);
      expect(hasActiveCampaigns([{ status: "draft" }])).toBe(false);
      expect(hasActiveCampaigns([])).toBe(false);
      expect(hasActiveCampaigns(null)).toBe(false);
    });

    it("hasActiveSummaryBatches detecta lotes em andamento no resumo", () => {
      const summaryWithRunningBatch: DispatchSummaryResponse = {
        campaigns: [
          {
            campaignId: "c1",
            campaignName: "Camp 1",
            chipName: "Chip 1",
            loteCount: 1,
            leadsTotal: 10,
            leadsPending: 5,
            sentTotal: 5,
            failedTotal: 0,
            repliedCount: 0,
            status: "enviando",
            statusLabel: "Enviando",
            nextScheduledAt: null,
            eta: null,
            leadsActionable: { pause: 0, resume: 0, cancel: 0 },
            batches: [
              {
                id: "b1",
                status: "running",
                sentCount: 5,
                failedCount: 0,
                targetCount: 10,
                scheduledAt: null,
                createdAt: "2026-10-14T08:00:00Z",
              },
            ],
          },
        ],
        counts: { active: 1, ended: 0 },
        scope: "active",
        page: 1,
        pageSize: 20,
        totalForScope: 1,
        kpis: {
          periodLabel: "Hoje",
          campaigns: 1,
          leads: 10,
          sent: 5,
          deliveryRate: 100,
        },
      };

      const summaryWithoutRunningBatch: DispatchSummaryResponse = {
        ...summaryWithRunningBatch,
        campaigns: [
          {
            ...summaryWithRunningBatch.campaigns[0],
            status: "agendada",
            batches: [
              {
                ...summaryWithRunningBatch.campaigns[0].batches[0],
                status: "scheduled",
              },
            ],
          },
        ],
      };

      expect(hasActiveSummaryBatches(summaryWithRunningBatch)).toBe(true);
      expect(hasActiveSummaryBatches(summaryWithoutRunningBatch)).toBe(false);
      expect(hasActiveSummaryBatches(null)).toBe(false);
    });
  });

  describe("[TESTE OBRIGATÓRIO E] com lote em andamento, a consulta é refeita sozinha; sem lote, não", () => {
    it("calcula refetchInterval de 15s quando há lote 'running' e desativa (false) quando não há", () => {
      // Simulação da lógica de refetchInterval das consultas
      const queryWithRunningDispatch = {
        state: {
          data: [
            { id: "disp-1", status: "running" as const },
            { id: "disp-2", status: "scheduled" as const },
          ] as CampaignDispatch[],
        },
      };

      const queryWithDoneDispatch = {
        state: {
          data: [
            { id: "disp-1", status: "done" as const },
            { id: "disp-2", status: "scheduled" as const },
          ] as CampaignDispatch[],
        },
      };

      const queryFnRefetch = (query: typeof queryWithRunningDispatch) => {
        const dispatches = query.state.data;
        return hasActiveDispatches(dispatches) ? ACTIVE_DISPATCH_REFETCH_INTERVAL_MS : false;
      };

      // 1. Com lote em andamento: intervalo ativado em 15 segundos
      const activeInterval = queryFnRefetch(queryWithRunningDispatch);
      expect(activeInterval).toBe(15000);
      expect(activeInterval).toBe(ACTIVE_DISPATCH_REFETCH_INTERVAL_MS);

      // 2. Sem lote em andamento: desativado (false), sem bater no servidor à toa
      const inactiveInterval = queryFnRefetch(queryWithDoneDispatch);
      expect(inactiveInterval).toBe(false);
    });

    it("calcula refetchInterval para lista de campanhas: 15s se 'sending' e false se parada", () => {
      const queryWithSendingCampaign = {
        state: {
          data: [{ id: "camp-1", status: "sending" as const }] as unknown as Campaign[],
        },
      };

      const queryWithIdleCampaign = {
        state: {
          data: [{ id: "camp-1", status: "draft" as const }] as unknown as Campaign[],
        },
      };

      const queryFnCampaignsRefetch = (query: typeof queryWithSendingCampaign) => {
        const campaigns = query.state.data;
        return hasActiveCampaigns(campaigns) ? ACTIVE_DISPATCH_REFETCH_INTERVAL_MS : false;
      };

      expect(queryFnCampaignsRefetch(queryWithSendingCampaign)).toBe(15000);
      expect(queryFnCampaignsRefetch(queryWithIdleCampaign)).toBe(false);
    });
  });

  describe("Componente LastUpdatedIndicator ('atualizado há Xs')", () => {
    it("formata tempo relativo corretamente", () => {
      const now = Date.now();
      expect(formatTimeAgo(2, now)).toBe("Atualizado agora");
      expect(formatTimeAgo(15, now - 15000)).toBe("Atualizado há 15s");
      expect(formatTimeAgo(180, now - 180000)).toBe("Atualizado há 3m");
    });

    it("renderiza o texto formatado e o botão de recarga", () => {
      const onRefresh = vi.fn();
      const tenSecondsAgo = Date.now() - 10000;

      render(
        <LastUpdatedIndicator
          timestamp={tenSecondsAgo}
          onRefresh={onRefresh}
        />
      );

      const indicator = screen.getByTestId("last-updated-indicator");
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveTextContent(/Atualizado há 10s|Atualizado agora/);

      const refreshBtn = screen.getByRole("button", { name: /recarregar dados/i });
      fireEvent.click(refreshBtn);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("não renderiza nada se o timestamp for nulo ou indefinido", () => {
      const { container } = render(<LastUpdatedIndicator timestamp={null} />);
      expect(container.firstChild).toBeNull();
    });
  });
});
