// frontend/src/test/agentInstructionAuditPanel.test.tsx
//
// AgentInstructionAuditPanel — "Um agente, um dono para cada texto", Commit 1.
// Painel só lê e mostra; testa que o conflito aparece nomeando as duas
// origens, e que sem conflito o painel diz isso com clareza.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

describe("AgentInstructionAuditPanel", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("sem agentId: não renderiza nada", async () => {
    vi.doMock("@/hooks/useAgentInstructionAudit", () => ({
      useAgentInstructionAudit: () => ({ data: undefined, isLoading: false, error: null }),
    }));
    const { AgentInstructionAuditPanel } = await import("@/components/agente/AgentInstructionAuditPanel");
    const { container } = render(<AgentInstructionAuditPanel agentId={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("[TESTE OBRIGATÓRIO] campo em conflito: o painel nomeia as duas origens (agente vs template)", async () => {
    vi.doMock("@/hooks/useAgentInstructionAudit", () => ({
      useAgentInstructionAudit: () => ({
        data: {
          agentId: "agente-1",
          templateKeyEmUso: "generico",
          audit: {
            prompt: { source: "tenant", value: "Prompt do tenant", tenantPromptText: "Prompt do tenant" },
            collection: {
              agentFields: [{ name: "orcamento", required: true }],
              templateFields: [{ name: "telefone", required: false }],
              templateKey: "generico",
              conflicts: [
                { field: "telefone", emAgente: false, emTemplate: true, origemTemplate: "generico", motivo: '"telefone" é pedido pelo template "generico" mas não está na Coleta do agente' },
                { field: "orcamento", emAgente: true, emTemplate: false, origemTemplate: "generico", motivo: '"orcamento" está na Coleta do agente mas não é pedido pelo template "generico"' },
              ],
            },
            model: { source: "padrão do sistema", value: "openai/gpt-oss-120b" },
          },
        },
        isLoading: false,
        error: null,
      }),
    }));

    const { AgentInstructionAuditPanel } = await import("@/components/agente/AgentInstructionAuditPanel");
    render(<AgentInstructionAuditPanel agentId="agente-1" />);

    expect(screen.getByText(/"telefone" é pedido pelo template "generico"/)).toBeTruthy();
    expect(screen.getByText(/está na Coleta do agente mas não é pedido/)).toBeTruthy();
    expect(screen.getByText(/Fonte: prompt padrão do tenant/)).toBeTruthy();

  });

  it("sem conflito: painel diz explicitamente que as listas batem", async () => {
    vi.doMock("@/hooks/useAgentInstructionAudit", () => ({
      useAgentInstructionAudit: () => ({
        data: {
          agentId: "agente-1",
          templateKeyEmUso: "generico",
          audit: {
            prompt: { source: "agente", value: "Prompt próprio", tenantPromptText: null },
            collection: { agentFields: [{ name: "interesse", required: true }], templateFields: [{ name: "interesse", required: true }], templateKey: "generico", conflicts: [] },
            model: { source: "agente", value: "openai/gpt-oss-120b" },
          },
        },
        isLoading: false,
        error: null,
      }),
    }));

    const { AgentInstructionAuditPanel } = await import("@/components/agente/AgentInstructionAuditPanel");
    render(<AgentInstructionAuditPanel agentId="agente-1" />);

    expect(screen.getByText(/Sem conflito/)).toBeTruthy();
    expect(screen.getByText(/Fonte: este agente/)).toBeTruthy();

  });
});
