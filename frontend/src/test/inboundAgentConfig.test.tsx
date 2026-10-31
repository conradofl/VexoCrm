// frontend/src/test/inboundAgentConfig.test.tsx
//
// "Uma tela, um agente, de cima para baixo" — Passo 1 (Quem é este agente):
// agente sem chip não liga (interruptor desabilitado, motivo escrito), e
// nunca fica ligado sem chip pra servir (autodesliga). Passo 6 (Testar antes
// de soltar): o simulador testa o AGENTE (por id), não o número — dá pra
// criar o agente, escrever o prompt e testar antes de existir qualquer chip.
// Só precisa existir a linha (agente salvo); não precisa de número.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/components/HelpDeskWidget", () => ({
  HelpDeskWidget: () => null,
  default: () => null,
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/agente/AgentInstructionAuditPanel", () => ({
  AgentInstructionAuditPanel: () => null,
}));

vi.mock("@/components/agente/AgentKnowledgeBaseSection", () => ({
  AgentKnowledgeBaseSection: () => <div data-testid="kb-section" />,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: async () => "token" }),
}));

vi.mock("@/hooks/useCrmClient", () => ({
  useOptionalCrmClient: () => ({
    selectedClientId: "sonhare",
    selectedClient: { id: "sonhare" },
    clients: [{ id: "sonhare" }],
    isLoading: false,
  }),
}));

const updateN8nMutateAsync = vi.fn(async (payload: any) => ({ item: payload }));

let currentMockClients = [
  { id: "sonhare", n8n_settings: { chatbot_enabled: true, chatbot_inbound_scope: "all", evolution_instances: [{ id: "chip-1", name: "Chip 1", active: true }] } },
];

vi.mock("@/hooks/useLeadClients", () => ({
  useLeadClients: () => ({
    data: currentMockClients,
  }),
  useUpdateLeadClientN8nSettings: () => ({ mutateAsync: updateN8nMutateAsync, isPending: false }),
  useSdrRotationNext: () => ({ data: { next: null }, isLoading: false }),
}));

vi.mock("@/hooks/useChatbotTemplates", () => ({
  useLlmModels: () => ({ data: { models: [], defaultModel: "openai/gpt-oss-120b", providerStatus: {} } }),
  useChatbotTemplates: () => ({ data: [] }),
}));

vi.mock("@/lib/tenantIsolation", () => ({
  assertTenantMatch: () => {},
}));

const updateMutateAsync = vi.fn(async (body: any) => ({ ...body }));
const archiveMutate = vi.fn((_id: string, opts?: { onSuccess?: () => void }) => {
  opts?.onSuccess?.();
});

function mockCompanies(companies: any[]) {
  vi.doMock("@/hooks/useFollowupAdmin", () => ({
    useFupCompanies: () => ({ data: companies, isLoading: false }),
    useCreateFupCompany: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateFupCompany: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
    useArchiveFupCompany: () => ({ mutate: archiveMutate, isPending: false }),
  }));
}

describe("InboundAgentConfig — Passo 1 (Quem é este agente)", () => {
  beforeEach(() => {
    vi.resetModules();
    updateMutateAsync.mockClear();
    archiveMutate.mockClear();
    mockNavigate.mockClear();
    currentMockClients = [
      { id: "sonhare", n8n_settings: { chatbot_enabled: true, chatbot_inbound_scope: "all", evolution_instances: [{ id: "chip-1", name: "Chip 1", active: true }] } },
    ];
  });

  it("[TESTE OBRIGATÓRIO] agente sem chip: interruptor desabilitado, com o motivo visível", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: false, evolution_instances: [] },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    expect(screen.getByText(/Escolha um número para poder ligar este agente/)).toBeTruthy();
    const switches = screen.getAllByRole("switch");
    const enableSwitch = switches[0];
    expect(enableSwitch).toHaveAttribute("data-disabled");
  });

  it("[TESTE OBRIGATÓRIO] agente com chip: interruptor liga e desliga, refletindo no card da lista", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: false, evolution_instances: ["chip-1"] },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    const enableSwitch = screen.getAllByRole("switch")[0];
    expect(enableSwitch).not.toHaveAttribute("data-disabled");

    fireEvent.click(enableSwitch);

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: "agente-1", inbound_enabled: true }));
    });
  });

  it("[TESTE OBRIGATÓRIO] agente ligado sem chip nunca fica ligado — autodesliga", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: true, evolution_instances: [] },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: "agente-1", inbound_enabled: false }));
    });
    const enableSwitch = screen.getAllByRole("switch")[0];
    expect(enableSwitch).toHaveAttribute("aria-checked", "false");
  });

  it("quando o robô global do tenant está desligado, exibe banner honesto com link para Padrões da Empresa", async () => {
    currentMockClients = [
      {
        id: "sonhare",
        n8n_settings: {
          chatbot_enabled: false, // robô global desligado
          chatbot_inbound_scope: "all",
          evolution_instances: [
            { id: "chip-1", name: "Chip 1", active: true },
            { id: "chip-sem-agente", name: "Chip 2 Sem Agente", active: true },
          ],
        },
      },
    ];

    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: true, evolution_instances: ["chip-1"] },
    ]);

    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    // Banner de aviso visível
    expect(screen.getByText("Atendimento geral da empresa desligado")).toBeTruthy();
    expect(screen.getByText(/O robô geral da empresa está desligado, mas este agente responderá normalmente por ter chip próprio/)).toBeTruthy();

    const linkButton = screen.getByRole("button", { name: "Padrões da Empresa" });
    expect(linkButton).toBeTruthy();
    fireEvent.click(linkButton);
    expect(mockNavigate).toHaveBeenCalledWith("/crm/padroes-da-empresa");
  });
});

describe("InboundAgentConfig — Passo 6 (Testar antes de soltar)", () => {
  beforeEach(() => {
    vi.resetModules();
    updateMutateAsync.mockClear();
    archiveMutate.mockClear();
  });

  it("[TESTE OBRIGATÓRIO] agente ainda não salvo (rascunho): o simulador não aparece — não há id pra testar", async () => {
    mockCompanies([]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    expect(screen.getByText(/Salve este agente para poder testar/)).toBeTruthy();
    expect(screen.queryByPlaceholderText("Digite sua mensagem...")).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] agente salvo SEM chip: o simulador aparece e testa pelo agentId, não pelo número", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: false, evolution_instances: [] },
    ]);

    const fetchApiMock = vi.fn(async (_url: string, _options: RequestInit) => ({
      ok: true,
      json: async () => ({ response: "Olá, tudo bem?", meta: { agente: "inbound" } }),
    }));
    vi.doMock("@/lib/api", () => ({ fetchApi: fetchApiMock }));

    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    const input = screen.getByPlaceholderText("Digite sua mensagem...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "oi" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fetchApiMock).toHaveBeenCalled());
    const options = fetchApiMock.mock.calls[0][1];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.agentId).toBe("agente-1");
    expect(body.instanceName).toBeUndefined();
    expect(body.clientId).toBe("sonhare");
  });

  it("[TESTE OBRIGATÓRIO] com chip vinculado, a mensagem de teste ainda vai pelo agentId DESTE agente", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: true, evolution_instances: ["chip-1"] },
    ]);

    const fetchApiMock = vi.fn(async (_url: string, _options: RequestInit) => ({
      ok: true,
      json: async () => ({ response: "Olá, tudo bem?", meta: { agente: "inbound" } }),
    }));
    vi.doMock("@/lib/api", () => ({ fetchApi: fetchApiMock }));

    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    const input = screen.getByPlaceholderText("Digite sua mensagem...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "oi" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fetchApiMock).toHaveBeenCalled());
    const options = fetchApiMock.mock.calls[0][1];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.agentId).toBe("agente-1");
    expect(body.clientId).toBe("sonhare");
  });
});

describe("InboundAgentConfig — Arquivar agente", () => {
  beforeEach(() => {
    vi.resetModules();
    updateMutateAsync.mockClear();
    archiveMutate.mockClear();
  });

  it("[TESTE OBRIGATÓRIO] agente com chip: confirmação nomeia o chip, e confirmar chama a mutação com o id do agente", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: true, evolution_instances: ["chip-1"] },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    const triggers = screen.getAllByRole("button", { name: /Arquivar agente/i });
    expect(triggers.length).toBe(2);
    fireEvent.click(triggers[triggers.length - 1]);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Chip 1/)).toBeTruthy();
    expect(within(dialog).getByText(/volta a ser atendido pelo chatbot padrão da empresa/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Arquivar" }));
    expect(archiveMutate).toHaveBeenCalledWith("agente-1", expect.any(Object));
  });

  it("[TESTE OBRIGATÓRIO] agente sem chip: confirmação diz que não afeta nenhuma conversa, e confirmar arquiva sem mexer em mais nada", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: false, evolution_instances: [] },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    const trigger = screen.getAllByRole("button", { name: /Arquivar agente/i })[0];
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/não tem nenhum chip vinculado — arquivar não afeta nenhuma conversa/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Arquivar" }));
    expect(archiveMutate).toHaveBeenCalledTimes(1);
    expect(archiveMutate).toHaveBeenCalledWith("agente-1", expect.any(Object));
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it("[TESTE OBRIGATÓRIO] cancelar na confirmação: nada acontece — mutação não é chamada", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: true, evolution_instances: ["chip-1"] },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    const trigger = screen.getAllByRole("button", { name: /Arquivar agente/i })[0];
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(archiveMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("agente ainda não salvo (rascunho): sem botão de arquivar — nada pra arquivar ainda", async () => {
    mockCompanies([]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    expect(screen.queryByRole("button", { name: /Arquivar agente/i })).toBeNull();
  });
});

describe("InboundAgentConfig — Escopo de Atendimento", () => {
  beforeEach(() => {
    vi.resetModules();
    updateMutateAsync.mockClear();
    updateN8nMutateAsync.mockClear();
  });

  it("renderiza os seletores de escopo e permite alternar para 'leads_only'", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: true, evolution_instances: ["chip-1"] },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    const avancadoBtn = screen.getByRole("button", { name: /Avançado/i });
    fireEvent.click(avancadoBtn);

    expect(screen.getByText("Escopo de Atendimento")).toBeTruthy();
    expect(screen.getByText("Atender a todos")).toBeTruthy();
    expect(screen.getByText("Apenas Leads no CRM")).toBeTruthy();

    const leadsOnlyBtn = screen.getByRole("button", { name: /Apenas Leads no CRM/i });
    fireEvent.click(leadsOnlyBtn);

    const saveBtn = screen.getByRole("button", { name: /Salvar Alterações/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateN8nMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "sonhare",
          chatbotInboundScope: "leads_only",
        })
      );
    });
  });

  it("salva com escopo 'all' por padrão", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: true, evolution_instances: ["chip-1"] },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    const saveBtn = screen.getByRole("button", { name: /Salvar Alterações/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateN8nMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "sonhare",
          chatbotInboundScope: "all",
        })
      );
    });
  });
});

describe("InboundAgentConfig — Prazo da pausa de atendimento humano", () => {
  beforeEach(() => {
    vi.resetModules();
    updateMutateAsync.mockClear();
    updateN8nMutateAsync.mockClear();
  });

  it("o prazo digitado vai no mesmo PATCH da chave de pausa", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: true, evolution_instances: ["chip-1"] },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    fireEvent.click(screen.getByRole("button", { name: /Avançado/i }));
    fireEvent.change(screen.getByLabelText(/Reativar o agente sozinho depois de/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar Alterações/i }));

    await waitFor(() => {
      expect(updateN8nMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "sonhare", agentPauseOnDeviceReply: false, agentPauseExpiryDays: 5 })
      );
    });
  });

  it("0 é válido (nunca reativa sozinho) e vai no PATCH", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: true, evolution_instances: ["chip-1"] },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    fireEvent.click(screen.getByRole("button", { name: /Avançado/i }));
    fireEvent.change(screen.getByLabelText(/Reativar o agente sozinho depois de/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar Alterações/i }));

    await waitFor(() => {
      expect(updateN8nMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ agentPauseExpiryDays: 0 }));
    });
  });

  it("campo vazio não manda prazo: o backend mantém o que estava", async () => {
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: true, evolution_instances: ["chip-1"] },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    fireEvent.click(screen.getByRole("button", { name: /Avançado/i }));
    fireEvent.change(screen.getByLabelText(/Reativar o agente sozinho depois de/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar Alterações/i }));

    await waitFor(() => expect(updateN8nMutateAsync).toHaveBeenCalled());
    expect(updateN8nMutateAsync.mock.calls.at(-1)[0]).not.toHaveProperty("agentPauseExpiryDays");
  });
});

describe("InboundAgentConfig — Seletor de Número atendido (Urgente 1)", () => {
  beforeEach(() => {
    vi.resetModules();
    updateMutateAsync.mockClear();
    archiveMutate.mockClear();
    currentMockClients = [
      {
        id: "sonhare",
        n8n_settings: {
          chatbot_enabled: true,
          chatbot_inbound_scope: "all",
          evolution_instances: [
            {
              id: "73c13e19-a9aa-44d3-b321-256c3f44a3e2",
              name: "Chip Eleição 4343",
              dispatch_webhook_url: "https://evo.example.com/message/sendText/bia-do-spazio-4343-eleicao",
              active: true,
            },
          ],
        },
      },
    ];
  });

  it("a) chip salvo por id -> rótulo mostra o NOME do chip, nunca o id", async () => {
    mockCompanies([
      {
        id: "agente-1",
        name: "Bia do Spazio",
        agent_kind: "atendimento",
        inbound_enabled: true,
        evolution_instances: ["73c13e19-a9aa-44d3-b321-256c3f44a3e2"],
      },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    await waitFor(() => {
      expect(screen.getAllByText("Chip Eleição 4343").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("73c13e19-a9aa-44d3-b321-256c3f44a3e2")).toBeNull();
  });

  it("b) chip salvo em formato antigo (id ou display name) -> normaliza para slug técnico e ao salvar grava slug", async () => {
    mockCompanies([
      {
        id: "agente-1",
        name: "Bia do Spazio",
        agent_kind: "atendimento",
        inbound_enabled: true,
        evolution_instances: ["73c13e19-a9aa-44d3-b321-256c3f44a3e2"],
      },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    const saveBtn = screen.getByRole("button", { name: /Salvar Alterações/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "agente-1",
          evolution_instances: ["bia-do-spazio-4343-eleicao"],
        })
      );
    });
  });

  it("c) marcar e desmarcar o mesmo chip -> array volta ao tamanho original, nunca acumula duas entradas", async () => {
    mockCompanies([
      {
        id: "agente-1",
        name: "Bia do Spazio",
        agent_kind: "atendimento",
        inbound_enabled: true,
        evolution_instances: ["bia-do-spazio-4343-eleicao"],
      },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    await waitFor(() => {
      expect(screen.getAllByText("Chip Eleição 4343").length).toBeGreaterThanOrEqual(1);
    });

    const buttons = screen.getAllByRole("button", { name: /Chip Eleição 4343/i });
    const triggerBtn = buttons.find((b) => b.getAttribute("aria-haspopup") === "dialog") || buttons[1] || buttons[0];
    fireEvent.click(triggerBtn);

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    const saveBtn = screen.getByRole("button", { name: /Salvar Alterações/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "agente-1",
          evolution_instances: ["bia-do-spazio-4343-eleicao"],
        })
      );
    });
  });

  it("d) chip salvo que não existe mais na lista -> zero marcados, não entra em numerosVinculados e mostra aviso de vínculo antigo", async () => {
    mockCompanies([
      {
        id: "agente-1",
        name: "Bia do Spazio",
        agent_kind: "atendimento",
        inbound_enabled: true,
        evolution_instances: ["chip-inexistente-ou-deletado-uuid"],
      },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    // Zero marcados: rótulo mostra "Nenhum número — escolha um chip"
    await waitFor(() => {
      expect(screen.getByText("Nenhum número — escolha um chip")).toBeTruthy();
    });

    // Mostra aviso de vínculo antigo não reconhecido
    expect(screen.getByTestId("orphan-chip-warning")).toBeTruthy();
    expect(
      screen.getByText("1 vínculo antigo não reconhecido — será removido ao salvar")
    ).toBeTruthy();
    // O órfão sai do estado e não é exibido como chip selecionado
    expect(screen.queryByText("chip-inexistente-ou-deletado-uuid")).toBeNull();
  });

  it("e) agente com órfão no banco: marcar um chip válido e salvar grava 1, não 2", async () => {
    mockCompanies([
      {
        id: "agente-1",
        name: "Dra. Beatriz - Pessoal 2",
        agent_kind: "atendimento",
        inbound_enabled: false,
        evolution_instances: ["chip-inexistente-ou-deletado-uuid"],
      },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    await waitFor(() => {
      expect(screen.getByText("Nenhum número — escolha um chip")).toBeTruthy();
    });

    // Abrir o popover de seleção
    const triggerBtn = screen.getByRole("button", { name: /Nenhum número — escolha um chip/i });
    fireEvent.click(triggerBtn);

    // Marcar o chip válido "Chip Eleição 4343"
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    // Rótulo atualiza para o chip marcado (1 único número)
    expect(screen.getAllByText("Chip Eleição 4343").length).toBeGreaterThanOrEqual(1);

    // Salvar alterações
    const saveBtn = screen.getByRole("button", { name: /Salvar Alterações/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "agente-1",
          evolution_instances: ["bia-do-spazio-4343-eleicao"],
        })
      );
    });
    // Gravou exatamente 1 chip, sem acumular o órfão
    const lastCall = updateMutateAsync.mock.calls[updateMutateAsync.mock.calls.length - 1][0];
    expect(lastCall.evolution_instances).toHaveLength(1);
    expect(lastCall.evolution_instances).toEqual(["bia-do-spazio-4343-eleicao"]);
  });

  it("f) esvaziar a lista limpa de verdade: desmarcar todos os chips salva evolution_instances: []", async () => {
    mockCompanies([
      {
        id: "agente-1",
        name: "Bia do Spazio",
        agent_kind: "atendimento",
        inbound_enabled: true,
        evolution_instances: ["bia-do-spazio-4343-eleicao"],
      },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    await waitFor(() => {
      expect(screen.getAllByText("Chip Eleição 4343").length).toBeGreaterThanOrEqual(1);
    });

    const buttons = screen.getAllByRole("button", { name: /Chip Eleição 4343/i });
    const triggerBtn = buttons.find((b) => b.getAttribute("aria-haspopup") === "dialog") || buttons[1] || buttons[0];
    fireEvent.click(triggerBtn);

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeChecked();
    // Desmarcar o chip
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    const saveBtn = screen.getByRole("button", { name: /Salvar Alterações/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "agente-1",
          evolution_instances: [],
        })
      );
    });
  });

  it("g) erro 409 CHIP_ALREADY_OWNED: exibe a mensagem de conflito na tela dizendo qual agente já possui o chip", async () => {
    const conflictMessage = 'O chip "4343-ATENDIMENTO" já pertence ao agente "Dra. Beatriz - Pessoal (Padrão)". Escolha outro chip ou remova-o daquele agente primeiro.';
    updateMutateAsync.mockRejectedValueOnce(new Error(conflictMessage));

    mockCompanies([
      {
        id: "agente-2",
        name: "Dra. Beatriz - Pessoal 2",
        agent_kind: "atendimento",
        inbound_enabled: false,
        evolution_instances: [],
      },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    await waitFor(() => {
      expect(screen.getByText("Nenhum número — escolha um chip")).toBeTruthy();
    });

    const triggerBtn = screen.getByRole("button", { name: /Nenhum número — escolha um chip/i });
    fireEvent.click(triggerBtn);

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    const saveBtn = screen.getByRole("button", { name: /Salvar Alterações/i });
    fireEvent.click(saveBtn);

    // Mensagem de conflito 409 deve aparecer na tela para o usuário não achar que o sistema quebrou
    await waitFor(() => {
      expect(screen.getByTestId("agent-save-error")).toBeTruthy();
    });
    expect(screen.getByTestId("agent-chip-conflict-error")).toBeTruthy();
    expect(screen.getAllByText(conflictMessage).length).toBeGreaterThanOrEqual(1);
  });
});

describe("InboundAgentConfig — Extração para o closer no Passo 5 (Urgente 2)", () => {
  beforeEach(() => {
    vi.resetModules();
    updateMutateAsync.mockClear();
    archiveMutate.mockClear();
    currentMockClients = [
      {
        id: "sonhare",
        n8n_settings: {
          chatbot_enabled: true,
          chatbot_inbound_scope: "all",
          evolution_instances: [
            { id: "chip-1", name: "Chip Atendimento", dispatch_webhook_url: "https://evo/atend", active: true },
          ],
        },
      },
    ];
  });

  it("exibe o seletor de extração ligado por padrão e permite editar o prompt customizado de extração", async () => {
    mockCompanies([
      {
        id: "agente-1",
        name: "Agente Closer Test",
        agent_kind: "atendimento",
        inbound_enabled: true,
        evolution_instances: ["atend"],
        sdr_transfer_enabled: true,
        inbound_extraction_enabled: true,
        inbound_extraction_prompt: "Prompt inicial do closer",
      },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    expect(screen.getByText("Extrair qualificação para o closer")).toBeTruthy();
    expect(
      screen.getByText("Ao qualificar, o agente monta um resumo e manda para os números configurados acima.")
    ).toBeTruthy();

    const textarea = screen.getByPlaceholderText(/Deixe em branco para usar o prompt padrão da empresa/i);
    expect((textarea as HTMLTextAreaElement).value).toBe("Prompt inicial do closer");

    fireEvent.change(textarea, { target: { value: "Novo prompt exclusivo do closer" } });

    const saveBtn = screen.getByRole("button", { name: /Salvar Alterações/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "agente-1",
          inbound_extraction_enabled: true,
          inbound_extraction_prompt: "Novo prompt exclusivo do closer",
        })
      );
    });
  });

  it("desligar o seletor desativa o campo de prompt e salva inbound_extraction_enabled: false", async () => {
    mockCompanies([
      {
        id: "agente-1",
        name: "Agente Sem Extracao",
        agent_kind: "atendimento",
        inbound_enabled: true,
        evolution_instances: ["atend"],
        sdr_transfer_enabled: true,
        inbound_extraction_enabled: true,
        inbound_extraction_prompt: "",
      },
    ]);
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);

    const extractionSwitch = screen.getByRole("switch", { name: /Extrair qualificação para o closer/i });
    expect(extractionSwitch).toBeChecked();

    fireEvent.click(extractionSwitch);

    expect(screen.getByText(/Extração desligada: nenhum card é gerado ao qualificar o lead/i)).toBeTruthy();

    const saveBtn = screen.getByRole("button", { name: /Salvar Alterações/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "agente-1",
          inbound_extraction_enabled: false,
        })
      );
    });
  });
});

// Rolagem do simulador: a caixa desce sozinha ao enviar e ao chegar resposta,
// mas só se a pessoa já estava no fim — quem rolou para cima para reler não é
// arrancado de lá. Movimento reduzido no navegador = salto sem animação.
describe("InboundAgentConfig — Passo 6: rolagem do simulador", () => {
  const originalScrollTo = (HTMLElement.prototype as any).scrollTo;
  const originalMatchMedia = window.matchMedia;
  let scrollCalls: Array<{ el: Element; opts: any }>;
  let resolveReply: (value: any) => void;

  beforeEach(() => {
    vi.resetModules();
    scrollCalls = [];
    (HTMLElement.prototype as any).scrollTo = function (opts: any) {
      scrollCalls.push({ el: this, opts });
    };
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: false, evolution_instances: [] },
    ]);
    // Resposta do agente fica pendurada até o teste mandar chegar.
    vi.doMock("@/lib/api", () => ({
      fetchApi: vi.fn(() => new Promise((resolve) => { resolveReply = resolve; })),
    }));
  });

  afterEach(() => {
    (HTMLElement.prototype as any).scrollTo = originalScrollTo;
    window.matchMedia = originalMatchMedia;
  });

  function setReducedMotion(reduce: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion: reduce"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as any;
  }

  async function abrirSimulador() {
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);
    const box = screen.getByTestId("simulador-mensagens");
    // Caixa de 400px com 1000px de conversa; o fim é scrollTop = 600.
    Object.defineProperty(box, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(box, "scrollHeight", { configurable: true, value: 1000 });
    const input = screen.getByPlaceholderText("Digite sua mensagem...") as HTMLInputElement;
    const chamadasNaCaixa = () => scrollCalls.filter((c) => c.el === box).map((c) => c.opts);
    return { box, input, chamadasNaCaixa };
  }

  async function enviar(input: HTMLInputElement, texto: string) {
    fireEvent.change(input, { target: { value: texto } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText(texto);
  }

  async function respostaChega(texto: string) {
    resolveReply({ ok: true, json: async () => ({ response: texto, meta: { agente: "inbound" } }) });
    await screen.findByText(new RegExp(texto));
  }

  function rolarPara(box: HTMLElement, top: number) {
    box.scrollTop = top;
    fireEvent.scroll(box);
  }

  it("[TESTE OBRIGATÓRIO] R1 ao enviar, desce até o fim da caixa", async () => {
    setReducedMotion(false);
    const { input, chamadasNaCaixa } = await abrirSimulador();
    scrollCalls = [];
    await enviar(input, "oi");
    expect(chamadasNaCaixa()).toEqual([{ top: 1000, behavior: "smooth" }]);
  });

  it("[TESTE OBRIGATÓRIO] R2 ao chegar a resposta, desce de novo (quem estava no fim)", async () => {
    setReducedMotion(false);
    const { input, chamadasNaCaixa } = await abrirSimulador();
    await enviar(input, "oi");
    scrollCalls = [];
    await respostaChega("Resposta do agente");
    expect(chamadasNaCaixa()).toEqual([{ top: 1000, behavior: "smooth" }]);
  });

  it("[TESTE OBRIGATÓRIO] R3 rolou para cima para reler: a resposta chega e a caixa NÃO se mexe", async () => {
    setReducedMotion(false);
    const { box, input, chamadasNaCaixa } = await abrirSimulador();
    await enviar(input, "oi");
    rolarPara(box, 600);
    rolarPara(box, 100);
    scrollCalls = [];
    await respostaChega("Resposta do agente");
    expect(chamadasNaCaixa()).toEqual([]);
  });

  it("R4 rolou para cima e depois enviou: enviar é pedido explícito, desce", async () => {
    setReducedMotion(false);
    const { box, input, chamadasNaCaixa } = await abrirSimulador();
    await enviar(input, "oi");
    await respostaChega("Primeira resposta");
    rolarPara(box, 600);
    rolarPara(box, 100);
    scrollCalls = [];
    await enviar(input, "e agora?");
    expect(chamadasNaCaixa()).toEqual([{ top: 1000, behavior: "smooth" }]);
  });

  it("R5 rolagem para BAIXO no meio do caminho (a própria animação) não solta do fim", async () => {
    setReducedMotion(false);
    const { box, input, chamadasNaCaixa } = await abrirSimulador();
    await enviar(input, "oi");
    rolarPara(box, 300);
    scrollCalls = [];
    await respostaChega("Resposta do agente");
    expect(chamadasNaCaixa()).toEqual([{ top: 1000, behavior: "smooth" }]);
  });

  it("R6 voltou sozinho ao fim depois de reler: volta a acompanhar", async () => {
    setReducedMotion(false);
    const { box, input, chamadasNaCaixa } = await abrirSimulador();
    await enviar(input, "oi");
    rolarPara(box, 600);
    rolarPara(box, 100);
    rolarPara(box, 590);
    scrollCalls = [];
    await respostaChega("Resposta do agente");
    expect(chamadasNaCaixa()).toEqual([{ top: 1000, behavior: "smooth" }]);
  });

  it("[TESTE OBRIGATÓRIO] R7 movimento reduzido: salta sem animação, ao enviar e ao chegar resposta", async () => {
    setReducedMotion(true);
    const { input, chamadasNaCaixa } = await abrirSimulador();
    scrollCalls = [];
    await enviar(input, "oi");
    await respostaChega("Resposta do agente");
    expect(chamadasNaCaixa()).toEqual([
      { top: 1000, behavior: "auto" },
      { top: 1000, behavior: "auto" },
    ]);
  });
});

// Memória do teste mora na tela e "Limpar conversa" zera tela E memória.
// A resposta que estava em voo na hora da limpeza é descartada: nada que
// chega depois do clique pode sujar a conversa nova.
describe("InboundAgentConfig — Passo 6: limpar conversa do simulador", () => {
  let pendentes: Array<(texto: string) => void>;
  let quedas: Array<() => void>;
  let corpos: any[];

  beforeEach(() => {
    vi.resetModules();
    pendentes = [];
    quedas = [];
    corpos = [];
    mockCompanies([
      { id: "agente-1", name: "Atendimento GD", agent_kind: "atendimento", inbound_enabled: false, evolution_instances: [] },
    ]);
    // Cada envio fica pendurado até o teste responder; a "memória" devolvida
    // pelo servidor é o histórico recebido mais o turno novo, como o motor faz.
    vi.doMock("@/lib/api", () => ({
      fetchApi: vi.fn((_url: string, options: RequestInit) => {
        const body = JSON.parse(options.body as string);
        corpos.push(body);
        return new Promise((resolve, reject) => {
          quedas.push(() => reject(new TypeError("Failed to fetch")));
          pendentes.push((texto: string) =>
            resolve({
              ok: true,
              json: async () => ({
                response: texto,
                meta: { agente: "inbound" },
                simulacao: {
                  historico: [
                    ...(body.simulacao?.historico || []),
                    { role: "user", content: body.message },
                    { role: "assistant", content: texto },
                  ],
                  dados: { turnos: (body.simulacao?.historico?.length || 0) / 2 + 1 },
                },
              }),
            })
          );
        });
      }),
    }));
  });

  async function abrir() {
    const { default: InboundAgentConfig } = await import("../pages/InboundAgentConfig");
    renderWithProviders(<InboundAgentConfig />);
    const input = screen.getByPlaceholderText("Digite sua mensagem...") as HTMLInputElement;
    const botaoLimpar = () => screen.getByRole("button", { name: /Limpar conversa/ });
    return { input, botaoLimpar };
  }

  async function enviar(input: HTMLInputElement, texto: string) {
    fireEvent.change(input, { target: { value: texto } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText(texto);
  }

  async function responder(texto: string) {
    pendentes.shift()!(texto);
    await screen.findByText(new RegExp(texto));
  }

  async function confirmarLimpeza(botaoLimpar: () => HTMLElement) {
    fireEvent.click(botaoLimpar());
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Limpar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  }

  it("[TESTE OBRIGATÓRIO] L1 conversa vazia (só a saudação): botão desabilitado", async () => {
    const { botaoLimpar } = await abrir();
    expect(botaoLimpar()).toBeDisabled();
  });

  it("[TESTE OBRIGATÓRIO] L2 a memória vai e volta pela tela: 1º envio sai vazio, 2º leva o que o servidor devolveu", async () => {
    const { input } = await abrir();
    await enviar(input, "oi, sou a Ana");
    expect(corpos[0].simulacao).toEqual({ historico: [], dados: {} });
    await responder("Olá Ana");
    await enviar(input, "quero sofá");
    expect(corpos[1].simulacao.historico).toEqual([
      { role: "user", content: "oi, sou a Ana" },
      { role: "assistant", content: "Olá Ana" },
    ]);
    expect(corpos[1].simulacao.dados).toEqual({ turnos: 1 });
  });

  it("[TESTE OBRIGATÓRIO] L3 cancelar na confirmação não apaga nada", async () => {
    const { input, botaoLimpar } = await abrir();
    await enviar(input, "oi, sou a Ana");
    await responder("Olá Ana");
    fireEvent.click(botaoLimpar());
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText("oi, sou a Ana")).toBeTruthy();
    expect(screen.getByText(/Olá Ana/)).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] L4 confirmar limpa a tela E a memória: o envio seguinte sai sem histórico", async () => {
    const { input, botaoLimpar } = await abrir();
    await enviar(input, "oi, sou a Ana");
    await responder("Olá Ana");
    await confirmarLimpeza(botaoLimpar);

    expect(screen.queryByText("oi, sou a Ana")).toBeNull();
    expect(screen.queryByText(/Olá Ana/)).toBeNull();
    expect(botaoLimpar()).toBeDisabled();

    await enviar(input, "assunto novo");
    expect(corpos.at(-1).simulacao).toEqual({ historico: [], dados: {} });
  });

  it("[TESTE OBRIGATÓRIO] L5 resposta em voo na hora da limpeza é descartada e não volta para a memória", async () => {
    const { input, botaoLimpar } = await abrir();
    await enviar(input, "pergunta antiga");
    // A resposta ainda não chegou; limpa no meio do voo.
    await confirmarLimpeza(botaoLimpar);

    // Dá para enviar de novo na hora, sem esperar a resposta antiga.
    await enviar(input, "pergunta nova");
    expect(corpos.at(-1).simulacao).toEqual({ historico: [], dados: {} });

    // A resposta antiga chega DEPOIS do clique: não pode aparecer.
    pendentes.shift()!("RESPOSTA ANTIGA");
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(screen.queryByText(/RESPOSTA ANTIGA/)).toBeNull());

    // A nova chega normalmente, e a memória seguinte não carrega a antiga.
    await responder("resposta nova");
    await enviar(input, "e mais?");
    const historico = corpos.at(-1).simulacao.historico.map((h: any) => h.content);
    expect(historico).toEqual(["pergunta nova", "resposta nova"]);
  });

  it("L6 resposta antiga que chega depois da limpeza não destrava o envio da conversa nova no meio do voo", async () => {
    const { input, botaoLimpar } = await abrir();
    await enviar(input, "pergunta antiga");
    await confirmarLimpeza(botaoLimpar);
    await enviar(input, "pergunta nova");

    pendentes.shift()!("RESPOSTA ANTIGA");
    await new Promise((r) => setTimeout(r, 0));

    // "pergunta nova" ainda está esperando resposta: outro envio é recusado
    // (mesma trava de antes), em vez de sair em paralelo.
    fireEvent.change(input, { target: { value: "atropelo" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 0));
    expect(corpos.map((c) => c.message)).toEqual(["pergunta antiga", "pergunta nova"]);
  });

  it("[TESTE OBRIGATÓRIO] L7 falha de rede da conversa antiga que chega depois da limpeza não aparece na nova", async () => {
    const { input, botaoLimpar } = await abrir();
    await enviar(input, "pergunta antiga");
    await confirmarLimpeza(botaoLimpar);
    await enviar(input, "pergunta nova");
    quedas.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(screen.queryByText(/\[erro\]/)).toBeNull());
  });
});
