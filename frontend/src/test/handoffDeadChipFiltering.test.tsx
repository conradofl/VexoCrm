import { describe, it, expect, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SchedulingStep } from "@/pages/LeadImports/SchedulingStep";
import type { CampaignDispatchOptions } from "@/hooks/useCampanhas";

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    getIdToken: async () => "token",
    isAuthenticated: true,
    clientId: "bia-do-spazio",
    accessProfile: { role: "client" },
  }),
}));

vi.mock("@/hooks/useCrmClient", () => ({
  useOptionalCrmClient: () => ({
    selectedClient: { id: "bia-do-spazio", name: "Bia do Spazio", n8n_settings: {} },
    selectedClientId: "bia-do-spazio",
  }),
}));

describe("SPEC 1 — Filtragem e Alerta de Chips de Handoff Mortos / Excluídos", () => {
  it("descarta uuid de chip morto antes de entrar na seleção e exibe alerta de chips removidos", async () => {
    const deadChipUuid = "f7d66677-71e4-4a32-8644-857eb8d95d53";
    const liveChipUuid = "19f36f2c-0000-0000-0000-000000000000";

    const evolutionInstanceOptions = [
      { id: "chip-origem-1", name: "Chip Batedor 1", isDefault: true },
      { id: liveChipUuid, name: "Chip 4343 Vivo" },
    ];

    let currentDispatchOptionsState: CampaignDispatchOptions = {
      handoffEnabled: true,
      handoffChipIds: [deadChipUuid, liveChipUuid],
      evolutionInstanceId: "chip-origem-1",
      leadDelaySeconds: 5,
      stopOnStepFailure: false,
      aiAssisted: false,
    };

    function TestHarness() {
      const [dispatchOpts, setDispatchOpts] = useState<CampaignDispatchOptions>(currentDispatchOptionsState);
      const [batching, setBatching] = useState(false);
      const [batchSize, setBatchSize] = useState("100");
      const [batchInterval, setBatchInterval] = useState("1");
      const [replyAgent, setReplyAgent] = useState<"passos" | "campanha" | "atendimento">("campanha");
      const [prompt, setPrompt] = useState("");
      const [multiAgenda, setMultiAgenda] = useState(false);
      const [cName, setCName] = useState("");
      const [cLink, setCLink] = useState("");

      const handleSetDispatchOpts = (updater: any) => {
        setDispatchOpts((prev) => {
          const next = typeof updater === "function" ? updater(prev) : updater;
          currentDispatchOptionsState = next;
          return next;
        });
      };

      return (
        <SchedulingStep
          {...({
            dispatchOptions: dispatchOpts,
            setDispatchOptions: handleSetDispatchOpts,
            evolutionInstanceOptions: evolutionInstanceOptions,
            totalLeads: 10,
            batchingEnabled: batching,
            setBatchingEnabled: setBatching,
            batchSize: batchSize,
            setBatchSize: setBatchSize,
            batchIntervalHours: batchInterval,
            setBatchIntervalHours: setBatchInterval,
            replyAgent: replyAgent,
            setReplyAgent: setReplyAgent,
            campaignAgentPrompt: prompt,
            setCampaignAgentPrompt: setPrompt,
            passosAposResposta: 1,
            multiAgendaEnabled: multiAgenda,
            setMultiAgendaEnabled: setMultiAgenda,
            consultants: [],
            consultantsError: null,
            loadingConsultants: false,
            onRetryConsultants: () => {},
            updateConsultant: { mutateAsync: async () => {} } as any,
            deleteConsultant: { mutateAsync: async () => {} } as any,
            activeClientId: "bia-do-spazio",
            newConsultantName: cName,
            setNewConsultantName: setCName,
            newConsultantLink: cLink,
            onCreateConsultant: () => {},
            createConsultant: { mutateAsync: async () => {} } as any,
            editingCampaignId: null,
          } as any)}
        />
      );
    }

    renderWithProviders(<TestHarness />);

    // 1. O banner de aviso de chip excluído/removido deve estar visível na tela
    const warningBanner = await screen.findByTestId("handoff-dropped-chips-warning");
    expect(warningBanner).toBeInTheDocument();
    expect(warningBanner.textContent).toContain("1 chip excluído foi removido da seleção");

    // 2. Apenas o chip vivo (19f36f2c...) deve constar selecionado (1 chip selecionado)
    // (o seletor de chips de envio da SPEC 10 mostra um contador com o mesmo texto: lê o da troca de chip)
    expect(screen.getByTestId("handoff-chip-count").textContent).toBe("1 chip selecionado");

    // 3. O estado sincronizado deve ter expurgado o deadChipUuid
    await waitFor(() => {
      expect(currentDispatchOptionsState.handoffChipIds).toEqual([liveChipUuid]);
      expect(currentDispatchOptionsState.handoffChipIds).not.toContain(deadChipUuid);
    });
  });
});
