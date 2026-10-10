// frontend/src/test/inboundAgentConfig.test.tsx
//
// "Uma tela, um agente, de cima para baixo" — Passo 1 (Quem é este agente):
// agente sem chip não liga (interruptor desabilitado, motivo escrito), e
// nunca fica ligado sem chip pra servir (autodesliga). Passo 6 (Testar antes
// de soltar): o simulador testa o AGENTE (por id), não o número — dá pra
// criar o agente, escrever o prompt e testar antes de existir qualquer chip.
// Só precisa existir a linha (agente salvo); não precisa de número.

import { describe, it, expect, vi, beforeEach } from "vitest";
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
