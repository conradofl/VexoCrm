// frontend/src/test/agentInstructionAuditPanel.test.tsx
//
// AgentInstructionAuditPanel — "Uma tela, um agente": o painel virou um
// aviso condicional, não mais um diagnóstico permanente. Sem conflito de
// Coleta (ou já consolidado) → não renderiza nada. Com conflito → mostra a
// origem de cada lado e "Resolver agora" abre a mesma prévia de sempre.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function mockHooks({ data, consolidateMutate = vi.fn() }: { data: any; consolidateMutate?: ReturnType<typeof vi.fn> }) {
  vi.doMock("@/hooks/useAgentInstructionAudit", () => ({
    useAgentInstructionAudit: () => ({ data, isLoading: false, error: null }),
    useConsolidateAgent: () => ({ mutate: consolidateMutate, isPending: false }),
  }));
}

describe("AgentInstructionAuditPanel", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("sem agentId: não renderiza nada", async () => {
    mockHooks({ data: undefined });
    const { AgentInstructionAuditPanel } = await import("@/components/agente/AgentInstructionAuditPanel");
    const { container } = render(<AgentInstructionAuditPanel agentId={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("[TESTE OBRIGATÓRIO] campo em conflito: o painel nomeia as duas origens (agente vs template)", async () => {
    mockHooks({
      data: {
        agentId: "agente-1",
        templateKeyEmUso: "generico",
        consolidated: false,
        consolidatedAt: null,
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
    });

    const { AgentInstructionAuditPanel } = await import("@/components/agente/AgentInstructionAuditPanel");
    render(<AgentInstructionAuditPanel agentId="agente-1" />);

    expect(screen.getByText(/Duas fontes competem neste agente/)).toBeTruthy();
    expect(screen.getByText(/"telefone" é pedido pelo template "generico"/)).toBeTruthy();
    expect(screen.getByText(/está na Coleta do agente mas não é pedido/)).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] sem conflito: não renderiza nada (nem card, nem 'sem conflito')", async () => {
    mockHooks({
      data: {
        agentId: "agente-1",
        templateKeyEmUso: "generico",
        consolidated: false,
        consolidatedAt: null,
        audit: {
          prompt: { source: "agente", value: "Prompt próprio", tenantPromptText: null },
          collection: { agentFields: [{ name: "interesse", required: true }], templateFields: [{ name: "interesse", required: true }], templateKey: "generico", conflicts: [] },
          model: { source: "agente", value: "openai/gpt-oss-120b" },
        },
      },
    });

    const { AgentInstructionAuditPanel } = await import("@/components/agente/AgentInstructionAuditPanel");
    const { container } = render(<AgentInstructionAuditPanel agentId="agente-1" />);

    expect(container.innerHTML).toBe("");
  });

  it("[TESTE OBRIGATÓRIO] agente consolidado: não renderiza nada, mesmo se o audit ainda trouxer conflitos antigos", async () => {
    mockHooks({
      data: {
        agentId: "agente-1",
        templateKeyEmUso: "generico",
        consolidated: true,
        consolidatedAt: "2026-09-17T00:00:00Z",
        audit: {
          prompt: { source: "agente", value: "Prompt do agente", tenantPromptText: null },
          collection: { agentFields: [{ name: "orcamento", required: true }], templateFields: [{ name: "telefone", required: false }], templateKey: "generico", conflicts: [{ field: "telefone", emAgente: false, emTemplate: true, origemTemplate: "generico", motivo: "..." }] },
          model: { source: "agente", value: "openai/gpt-oss-120b" },
        },
      },
    });

    const { AgentInstructionAuditPanel } = await import("@/components/agente/AgentInstructionAuditPanel");
    const { container } = render(<AgentInstructionAuditPanel agentId="agente-1" />);

    expect(container.innerHTML).toBe("");
  });

  it("[TESTE OBRIGATÓRIO] não consolidado, com conflito: 'Resolver agora' abre prévia nomeando o campo que a Coleta vai ganhar, e só chama a mutação ao confirmar", async () => {
    const consolidateMutate = vi.fn();
    mockHooks({
      consolidateMutate,
      data: {
        agentId: "agente-1",
        templateKeyEmUso: "generico",
        consolidated: false,
        consolidatedAt: null,
        audit: {
          prompt: { source: "tenant", value: "Prompt do tenant", tenantPromptText: "Prompt do tenant" },
          collection: {
            agentFields: [{ name: "orcamento", required: true }],
            templateFields: [{ name: "orcamento", required: true }, { name: "telefone", required: false }],
            templateKey: "generico",
            conflicts: [{ field: "telefone", emAgente: false, emTemplate: true, origemTemplate: "generico", motivo: "..." }],
          },
          model: { source: "padrão do sistema", value: "openai/gpt-oss-120b" },
        },
      },
    });

    const { AgentInstructionAuditPanel } = await import("@/components/agente/AgentInstructionAuditPanel");
    render(<AgentInstructionAuditPanel agentId="agente-1" />);

    fireEvent.click(screen.getByText(/Resolver agora/));
    expect(consolidateMutate).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/telefone/)).toBeTruthy();
    expect(within(dialog).getByText(/Não existe desfazer/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Consolidar" }));
    expect(consolidateMutate).toHaveBeenCalledTimes(1);
  });

  it("[TESTE OBRIGATÓRIO] conflito + prompt efetivo vazio: 'Resolver agora' desabilitado, com o porquê escrito na tela, e clicar não abre o diálogo nem consolida", async () => {
    const consolidateMutate = vi.fn();
    mockHooks({
      consolidateMutate,
      data: {
        agentId: "agente-1",
        templateKeyEmUso: "generico",
        consolidated: false,
        consolidatedAt: null,
        audit: {
          prompt: { source: "nenhum", value: null, tenantPromptText: null },
          collection: {
            agentFields: [],
            templateFields: [{ name: "telefone", required: false }],
            templateKey: "generico",
            conflicts: [{ field: "telefone", emAgente: false, emTemplate: true, origemTemplate: "generico", motivo: "..." }],
          },
          model: { source: "padrão do sistema", value: "openai/gpt-oss-120b" },
        },
      },
    });

    const { AgentInstructionAuditPanel } = await import("@/components/agente/AgentInstructionAuditPanel");
    render(<AgentInstructionAuditPanel agentId="agente-1" />);

    expect(screen.getByText(/Escreva o prompt deste agente antes de consolidar/)).toBeTruthy();

    const botao = screen.getByRole("button", { name: /Resolver agora/ }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);

    fireEvent.click(botao);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(consolidateMutate).not.toHaveBeenCalled();
  });
});
