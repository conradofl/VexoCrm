// frontend/src/test/agentInstructionAuditPanel.test.tsx
//
// AgentInstructionAuditPanel — "Uma tela, um agente": o painel virou um
// aviso condicional e transparente. Com conflito -> botão "Tornar agente autônomo",
// modal com prévia do prompt e campos; Consolidado -> card explicativo com
// botão "Voltar ao template da empresa".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function mockHooks({
  data,
  consolidateMutate = vi.fn(),
  unconsolidateMutate = vi.fn(),
}: {
  data: any;
  consolidateMutate?: ReturnType<typeof vi.fn>;
  unconsolidateMutate?: ReturnType<typeof vi.fn>;
}) {
  vi.doMock("@/hooks/useAgentInstructionAudit", () => ({
    useAgentInstructionAudit: () => ({ data, isLoading: false, error: null }),
    useConsolidateAgent: () => ({ mutate: consolidateMutate, isPending: false }),
    useUnconsolidateAgent: () => ({ mutate: unconsolidateMutate, isPending: false }),
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
          prompt: { source: "tenant", value: "Prompt longo do tenant com mais de vinte caracteres para passar no validador", tenantPromptText: "Prompt longo do tenant com mais de vinte caracteres" },
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
    expect(screen.getByText(/Tornar agente autônomo/)).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] sem conflito e não consolidado: não renderiza nada", async () => {
    mockHooks({
      data: {
        agentId: "agente-1",
        templateKeyEmUso: "generico",
        consolidated: false,
        consolidatedAt: null,
        audit: {
          prompt: { source: "agente", value: "Prompt próprio com mais de vinte caracteres", tenantPromptText: null },
          collection: { agentFields: [{ name: "interesse", required: true }], templateFields: [{ name: "interesse", required: true }], templateKey: "generico", conflicts: [] },
          model: { source: "agente", value: "openai/gpt-oss-120b" },
        },
      },
    });

    const { AgentInstructionAuditPanel } = await import("@/components/agente/AgentInstructionAuditPanel");
    const { container } = render(<AgentInstructionAuditPanel agentId="agente-1" />);

    expect(container.innerHTML).toBe("");
  });

  it("[TESTE OBRIGATÓRIO] agente consolidado: exibe card explicativo e botão 'Voltar ao template da empresa'", async () => {
    const unconsolidateMutate = vi.fn();
    mockHooks({
      unconsolidateMutate,
      data: {
        agentId: "agente-1",
        templateKeyEmUso: "generico",
        consolidated: true,
        consolidatedAt: "2026-09-17T00:00:00Z",
        audit: {
          prompt: { source: "agente", value: "Prompt autônomo com mais de vinte caracteres", tenantPromptText: null },
          collection: { agentFields: [{ name: "orcamento", required: true }], templateFields: [{ name: "telefone", required: false }], templateKey: "generico", conflicts: [] },
          model: { source: "agente", value: "openai/gpt-oss-120b" },
        },
      },
    });

    const { AgentInstructionAuditPanel } = await import("@/components/agente/AgentInstructionAuditPanel");
    render(<AgentInstructionAuditPanel agentId="agente-1" />);

    expect(screen.getByText(/Este agente não usa mais o template da empresa/)).toBeTruthy();
    expect(screen.getByText(/O que ele pergunta e como responde vem só do que está escrito aqui/)).toBeTruthy();

    const botaoVoltar = screen.getByRole("button", { name: /Voltar ao template da empresa/ });
    expect(botaoVoltar).toBeTruthy();

    fireEvent.click(botaoVoltar);
    expect(unconsolidateMutate).toHaveBeenCalledTimes(1);
  });

  it("[TESTE OBRIGATÓRIO] não consolidado, com conflito: botão abre modal com prévia do prompt e campos de coleta antes de gravar", async () => {
    const consolidateMutate = vi.fn();
    mockHooks({
      consolidateMutate,
      data: {
        agentId: "agente-1",
        templateKeyEmUso: "generico",
        consolidated: false,
        consolidatedAt: null,
        audit: {
          prompt: { source: "tenant", value: "Prompt longo do tenant com mais de vinte caracteres para teste de prévia", tenantPromptText: "Prompt do tenant" },
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

    fireEvent.click(screen.getByText(/Tornar agente autônomo/));
    expect(consolidateMutate).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Prompt que será gravado:/)).toBeTruthy();
    expect(within(dialog).getByText(/Prompt longo do tenant com mais de vinte caracteres/)).toBeTruthy();
    expect(within(dialog).getByText(/Campos de Coleta que serão gravados:/)).toBeTruthy();
    expect(within(dialog).getByText(/orcamento, telefone/)).toBeTruthy();
    expect(within(dialog).getByText(/Você poderá desfazer e voltar ao template a qualquer momento/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Tornar autônomo" }));
    expect(consolidateMutate).toHaveBeenCalledTimes(1);
  });

  it("[TESTE OBRIGATÓRIO] conflito + prompt efetivo vazio ou < 20 chars: botão desabilitado e aviso na tela", async () => {
    const consolidateMutate = vi.fn();
    mockHooks({
      consolidateMutate,
      data: {
        agentId: "agente-1",
        templateKeyEmUso: "generico",
        consolidated: false,
        consolidatedAt: null,
        audit: {
          prompt: { source: "nenhum", value: "curto", tenantPromptText: null },
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

    expect(screen.getByText(/mínimo de 20 caracteres/)).toBeTruthy();

    const botao = screen.getByRole("button", { name: /Tornar agente autônomo/ }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);

    fireEvent.click(botao);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(consolidateMutate).not.toHaveBeenCalled();
  });
});

