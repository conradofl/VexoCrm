import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EvolutionInstanceCard } from "@/components/evolutionChips/EvolutionInstanceCard";
import { EvolutionChipsPanel } from "@/components/EvolutionChipsPanel";
import quotaTestCases from "../../../shared/chipQuotaTestCases.json";
import {
  getStableColor,
  getChipColor,
  STABLE_COLOR_PALETTE,
  CHIP_COLOR_PALETTE,
  hashIdentifier,
  hashChipIdentifier,
} from "@/lib/stableColor";
import { resolveChipLimit } from "@/lib/evolutionChips/utils";
import type { LeadClient, LeadClientEvolutionInstance } from "@/hooks/useLeadClients";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

// Mocks dos hooks do useLeadClients
vi.mock("@/hooks/useLeadClients", () => ({
  useEvolutionInstanceSyncStatus: vi.fn(() => ({ data: null })),
  useLeadClientEvolutionInstanceStatus: vi.fn((_tenantId, _instanceId) => ({
    data: { connected: true, ownerJid: "5511999999999@s.whatsapp.net", profileName: "Chip Comercial" },
    isLoading: false,
  })),
  useSaveLeadClientEvolutionInstance: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useProvisionLeadClientEvolutionInstance: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteLeadClientEvolutionInstance: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useSyncLeadClientEvolutionInstance: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

// Mock do hook useAuth
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isAdminUser: true,
    canAccessInternalPage: () => true,
    canAccessView: () => true,
    getIdToken: async () => "mock-token",
  }),
}));

// Mock do hook useAdminUsers
vi.mock("@/hooks/useAdminUsers", () => ({
  useAdminUsers: () => ({
    data: [
      {
        uid: "op-1",
        displayName: "Carlos Operador",
        email: "carlos@vexo.com",
        access: { role: "internal", clientId: "tenant-1" },
      },
      {
        uid: "op-2",
        displayName: "Mariana Vendas",
        email: "mariana@vexo.com",
        access: { role: "internal", clientId: "tenant-1" },
      },
    ],
  }),
}));

const mockInstance1: LeadClientEvolutionInstance = {
  id: "inst-chip-1",
  client_id: "tenant-1",
  name: "WhatsApp Comercial 01",
  active: true,
  is_default: true,
  webhook_enabled: true,
  has_dispatch_webhook_token: true,
  dispatch_webhook_url: "https://webhook.evolution.com/dispatch-1",
  chip_state: "cold",
  daily_limit_override: null,
  sent_count_today: 42,
  owner_uid: "op-1",
};

const mockInstance2: LeadClientEvolutionInstance = {
  id: "inst-chip-2",
  client_id: "tenant-1",
  name: "WhatsApp Suporte 02",
  active: false,
  is_default: false,
  webhook_enabled: false,
  has_dispatch_webhook_token: false,
  dispatch_webhook_url: "https://webhook.evolution.com/dispatch-2",
  chip_state: "warm",
  daily_limit_override: 300,
  sent_count_today: 150,
  owner_uid: "op-2",
};

const mockTenant: LeadClient = {
  id: "tenant-1",
  name: "Empresa Teste",
  n8n_settings: {
    evolution_instances: [mockInstance1, mockInstance2],
  },
} as unknown as LeadClient;

describe("Chips WhatsApp: Cards compactos e cor por chip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regra 1: o mesmo identificador recebe a mesma cor em duas chamadas e depois de recarregar
  it("regra 1: o mesmo identificador recebe a mesma cor em duas chamadas e de forma estável", () => {
    const id = "chip-stable-id-xyz";
    const colorCall1 = getChipColor(id);
    const colorCall2 = getChipColor(id);

    // Mesma referência de objeto e propriedades estritamente idênticas
    expect(colorCall1).toBe(colorCall2);
    expect(colorCall1.key).toBe(colorCall2.key);
    expect(colorCall1.dot).toBe(colorCall2.dot);
    expect(colorCall1.borderLeft).toBe(colorCall2.borderLeft);

    // Simulação de recarregamento (recalculando a partir do hash estável)
    const expectedIndex = hashChipIdentifier(id) % CHIP_COLOR_PALETTE.length;
    expect(colorCall1).toBe(CHIP_COLOR_PALETTE[expectedIndex]);
  });

  // Regra 2: chips diferentes recebem cores diferentes dentro da paleta
  it("regra 2: chips diferentes recebem cores diferentes dentro da paleta", () => {
    const chipIds = ["chip-1", "chip-2", "chip-3", "chip-4", "chip-5"];
    const colors = chipIds.map((id) => getChipColor(id));

    // Todas as cores devem pertencer à paleta pré-definida
    colors.forEach((color) => {
      expect(CHIP_COLOR_PALETTE).toContain(color);
    });

    // Pelo menos 3 cores diferentes devem ser atribuídas aos 5 chips
    const uniqueKeys = new Set(colors.map((c) => c.key));
    expect(uniqueKeys.size).toBeGreaterThanOrEqual(3);
  });

  // Regra 3: a cor não muda quando a ordem da lista muda — teste com a mesma lista embaralhada
  it("regra 3: a cor não muda quando a ordem da lista muda (lista embaralhada)", () => {
    const originalList = [
      { id: "alpha-chip" },
      { id: "beta-chip" },
      { id: "gamma-chip" },
      { id: "delta-chip" },
    ];

    const originalColors = new Map(
      originalList.map((item) => [item.id, getChipColor(item.id)])
    );

    // Embaralha a lista
    const shuffledList = [
      { id: "delta-chip" },
      { id: "alpha-chip" },
      { id: "gamma-chip" },
      { id: "beta-chip" },
    ];

    shuffledList.forEach((item) => {
      const colorInShuffled = getChipColor(item.id);
      const expectedOriginalColor = originalColors.get(item.id);
      expect(colorInShuffled).toBe(expectedOriginalColor);
    });
  });

  // Regra 4: o cartão fechado mostra os quatro campos e esconde o resto
  it("regra 4: o cartão fechado mostra os quatro campos essenciais e esconde o resto", () => {
    render(
      <TooltipProvider>
        <EvolutionInstanceCard
          tenantId="tenant-1"
          instance={mockInstance1}
          draft={{ chipState: "cold", dailyLimitOverride: "" }}
          onChipStateChange={vi.fn()}
          onLimitOverrideChange={vi.fn()}
          onSaveChip={vi.fn()}
          onToggleDefault={vi.fn()}
          onToggleActive={vi.fn()}
          onToggleWebhook={vi.fn()}
          onDelete={vi.fn()}
          canEdit={true}
          canManageOwner={true}
          operatorOptions={[
            { uid: "op-1", displayName: "Carlos Operador", email: "carlos@vexo.com" },
          ]}
          isSavePending={false}
          isDeletePending={false}
          isExpanded={false}
        />
      </TooltipProvider>
    );

    // 1. Nome do chip
    expect(screen.getByText("WhatsApp Comercial 01")).toBeInTheDocument();

    // 2. Estado da conexão
    expect(screen.getByText("Conectado")).toBeInTheDocument();

    // 3. Operador responsável
    expect(screen.getByText("Carlos Operador")).toBeInTheDocument();

    // 4. Cota do dia no formato "enviados de limite" (42 de 50 para chip frio padrão)
    expect(screen.getByText("42 de 50")).toBeInTheDocument();

    // Nada além disso: o restante deve estar escondido quando fechado
    expect(screen.queryByText("Salvar cota")).not.toBeInTheDocument();
    expect(screen.queryByText("Sincronizar Conversas no CRM")).not.toBeInTheDocument();
    expect(screen.queryByText("Sincronizar agora")).not.toBeInTheDocument();
    expect(screen.queryByText("Tornar Padrão")).not.toBeInTheDocument();
    expect(screen.queryByText("Desativar")).not.toBeInTheDocument();
    expect(screen.queryByText("Ativar")).not.toBeInTheDocument();
    expect(screen.queryByText("Remover")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Limite custom")).not.toBeInTheDocument();
    expect(screen.queryByText("https://webhook.evolution.com/dispatch-1")).not.toBeInTheDocument();
  });

  // Regra 5: abrir um cartão fecha o que estava aberto
  it("regra 5: abrir um cartão fecha o que estava aberto (acordeão único)", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <EvolutionChipsPanel tenant={mockTenant} canEdit={true} />
        </TooltipProvider>
      </QueryClientProvider>
    );

    // Inicialmente ambos estão fechados (sem botão 'Salvar cota' em tela)
    expect(screen.queryByText("Salvar cota")).not.toBeInTheDocument();

    // Abre o primeiro cartão (mockInstance1)
    const toggleButtons = screen.getAllByRole("button", { name: /detalhes de whatsapp/i });
    expect(toggleButtons.length).toBe(2);

    fireEvent.click(toggleButtons[0]);

    // Agora o cartão 1 está aberto (tem seu botão 'Salvar cota')
    expect(screen.getByText("Salvar cota")).toBeInTheDocument();
    expect(screen.getByText("https://webhook.evolution.com/dispatch-1")).toBeInTheDocument();
    expect(screen.queryByText("https://webhook.evolution.com/dispatch-2")).not.toBeInTheDocument();

    // Ao clicar para abrir o cartão 2 (mockInstance2)
    fireEvent.click(toggleButtons[1]);

    // O cartão 2 abre e o cartão 1 fecha automaticamente!
    expect(screen.queryByText("https://webhook.evolution.com/dispatch-1")).not.toBeInTheDocument();
    expect(screen.getByText("https://webhook.evolution.com/dispatch-2")).toBeInTheDocument();
  });

  // Regra 6: nenhuma informação que existe hoje desapareceu com o cartão aberto
  it("regra 6: nenhuma informação que existia desapareceu: todas continuam presentes no cartão aberto", () => {
    render(
      <TooltipProvider>
        <EvolutionInstanceCard
          tenantId="tenant-1"
          instance={mockInstance1}
          draft={{ chipState: "cold", dailyLimitOverride: "" }}
          onChipStateChange={vi.fn()}
          onLimitOverrideChange={vi.fn()}
          onSaveChip={vi.fn()}
          onToggleDefault={vi.fn()}
          onToggleActive={vi.fn()}
          onToggleWebhook={vi.fn()}
          onDelete={vi.fn()}
          onSyncNow={vi.fn()}
          canEdit={true}
          canManageOwner={true}
          operatorOptions={[
            { uid: "op-1", displayName: "Carlos Operador", email: "carlos@vexo.com" },
          ]}
          isSavePending={false}
          isDeletePending={false}
          isExpanded={true}
        />
      </TooltipProvider>
    );

    // 1. Nome do chip
    expect(screen.getByText("WhatsApp Comercial 01")).toBeInTheDocument();

    // 2. Badges de estado e flags
    expect(screen.getByText("Conectado")).toBeInTheDocument();
    expect(screen.getByText("padrão")).toBeInTheDocument();
    expect(screen.getByText("ativa")).toBeInTheDocument();
    expect(screen.getByText("api key")).toBeInTheDocument();

    // 3. Webhook URL
    expect(screen.getByText("https://webhook.evolution.com/dispatch-1")).toBeInTheDocument();

    // 4. Seção Cota Diária e controles (42 / 50 para chip frio padrão)
    expect(screen.getByText("Cota Diária de Envios")).toBeInTheDocument();
    expect(screen.getByText("42 / 50")).toBeInTheDocument();
    expect(screen.getByText("Frio (50 msgs/dia)")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Limite custom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /salvar cota/i })).toBeInTheDocument();

    // 5. Seção Sincronizar Conversas no CRM
    expect(screen.getByText("Sincronizar Conversas no CRM")).toBeInTheDocument();
    expect(
      screen.getByText(
        'Espelha em tempo real as mensagens recebidas e enviadas deste chip na aba "Conversas".'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sincronizar agora/i })).toBeInTheDocument();

    // 6. Seção Operador Responsável e seletor
    expect(screen.getAllByText("Operador Responsável").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("Novos leads deste chip serão atribuídos automaticamente a este operador.")
    ).toBeInTheDocument();

    // 7. Botões de ação do cartão
    expect(screen.getByRole("button", { name: /tornar padrão/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /desativar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remover/i })).toBeInTheDocument();
  });

  describe("Ajuste no cabeçalho do cartão de chip (Reorganização em 3 linhas)", () => {
    it("teste 1: o cartão fechado é organizado estritamente em três linhas nesta ordem de prioridade", () => {
      render(
        <TooltipProvider>
          <EvolutionInstanceCard
            tenantId="tenant-1"
            instance={mockInstance1}
            draft={{ chipState: "cold", dailyLimitOverride: "" }}
            onChipStateChange={vi.fn()}
            onLimitOverrideChange={vi.fn()}
            onSaveChip={vi.fn()}
            onToggleDefault={vi.fn()}
            onToggleActive={vi.fn()}
            onToggleWebhook={vi.fn()}
            onDelete={vi.fn()}
            canEdit={true}
            canManageOwner={true}
            operatorOptions={[
              { uid: "op-1", displayName: "Carlos Operador", email: "carlos@vexo.com" },
            ]}
            isSavePending={false}
            isDeletePending={false}
            isExpanded={false}
          />
        </TooltipProvider>
      );

      // Linha 1: o ponto de cor, o nome do chip ocupando o espaço disponível, e a seta de abrir encostada à direita. Mais nada.
      const line1 = screen.getByTestId("card-line-1-inst-chip-1");
      expect(line1).toBeInTheDocument();
      expect(line1).toHaveTextContent("WhatsApp Comercial 01");
      // Não deve ter badges de status, telefone, operador ou cota na linha 1
      expect(line1).not.toHaveTextContent("Conectado");
      expect(line1).not.toHaveTextContent("5511");
      expect(line1).not.toHaveTextContent("Carlos Operador");
      expect(line1).not.toHaveTextContent("42 de 50");
      // A seta de abrir está presente na linha 1
      const chevronBtn = line1.querySelector("button");
      expect(chevronBtn).toBeInTheDocument();

      // Linha 2: o selo de estado da conexão e o telefone, lado a lado. O selo primeiro.
      const line2 = screen.getByTestId("card-line-2-inst-chip-1");
      expect(line2).toBeInTheDocument();
      expect(line2).toHaveTextContent("Conectado");
      expect(line2).toHaveTextContent("+5511999999999");
      // Ordem dos elementos na linha 2: o selo de conexão vem primeiro
      const badgesLine2 = line2.querySelectorAll(".text-\\[10px\\]");
      expect(badgesLine2.length).toBeGreaterThanOrEqual(2);
      expect(badgesLine2[0]).toHaveTextContent("Conectado");
      expect(badgesLine2[1]).toHaveTextContent("+5511999999999");

      // Linha 3: o operador responsável à esquerda e a cota à direita, no formato que já está
      const line3 = screen.getByTestId("card-line-3-inst-chip-1");
      expect(line3).toBeInTheDocument();
      const operatorEl = screen.getByTestId("chip-operator-inst-chip-1");
      const quotaEl = screen.getByTestId("chip-quota-inst-chip-1");
      expect(operatorEl).toHaveTextContent("Carlos Operador");
      expect(quotaEl).toHaveTextContent("42 de 50");
      // Operador possui ícone UserCheck
      expect(operatorEl.querySelector("svg")).toBeInTheDocument();
    });

    it("teste 2: nome longo do chip não é truncado abaixo de um limite razoável enquanto houver espaço", () => {
      const longNameInstance: LeadClientEvolutionInstance = {
        ...mockInstance1,
        id: "inst-long-name",
        name: "WhatsApp Atendimento Central e Vendas Regional Sul Especializado 2026",
      };

      render(
        <TooltipProvider>
          <EvolutionInstanceCard
            tenantId="tenant-1"
            instance={longNameInstance}
            draft={{ chipState: "cold", dailyLimitOverride: "" }}
            onChipStateChange={vi.fn()}
            onLimitOverrideChange={vi.fn()}
            onSaveChip={vi.fn()}
            onToggleDefault={vi.fn()}
            onToggleActive={vi.fn()}
            onToggleWebhook={vi.fn()}
            onDelete={vi.fn()}
            canEdit={true}
            canManageOwner={true}
            operatorOptions={[]}
            isSavePending={false}
            isDeletePending={false}
            isExpanded={false}
          />
        </TooltipProvider>
      );

      const nameEl = screen.getByTestId("chip-name-inst-long-name");
      expect(nameEl).toBeInTheDocument();
      expect(nameEl).toHaveTextContent("WhatsApp Atendimento Central e Vendas Regional Sul Especializado 2026");
      expect(nameEl).toHaveAttribute(
        "title",
        "WhatsApp Atendimento Central e Vendas Regional Sul Especializado 2026"
      );

      // Classes garantem que o nome ocupa todo o espaço livre e tem truncamento fluido com reticências
      expect(nameEl.className).toContain("flex-1");
      expect(nameEl.className).toContain("min-w-0");
      expect(nameEl.className).toContain("truncate");

      // O container da linha 1 não contém elementos concorrentes além do ponto de cor e do botão chevron
      const line1 = screen.getByTestId("card-line-1-inst-long-name");
      expect(line1.children.length).toBe(2); // Bloco do nome (com ponto) + Botão de expandir
    });

    it("teste 3: nenhum elemento sobrepõe outro em largura de celular (1 coluna)", () => {
      const longOperatorInstance: LeadClientEvolutionInstance = {
        ...mockInstance1,
        id: "inst-narrow",
        owner_uid: "op-long",
      };

      render(
        <TooltipProvider>
          <div style={{ width: "280px" }}>
            <EvolutionInstanceCard
              tenantId="tenant-1"
              instance={longOperatorInstance}
              draft={{ chipState: "cold", dailyLimitOverride: "" }}
              onChipStateChange={vi.fn()}
              onLimitOverrideChange={vi.fn()}
              onSaveChip={vi.fn()}
              onToggleDefault={vi.fn()}
              onToggleActive={vi.fn()}
              onToggleWebhook={vi.fn()}
              onDelete={vi.fn()}
              canEdit={true}
              canManageOwner={true}
              operatorOptions={[
                {
                  uid: "op-long",
                  displayName: "Operador Com Nome Extremamente Longo Que Nunca Deve Colidir",
                  email: "long@vexo.com",
                },
              ]}
              isSavePending={false}
              isDeletePending={false}
              isExpanded={false}
            />
          </div>
        </TooltipProvider>
      );

      // Linha 2 tem flex-wrap para nunca transbordar nem colidir em largura ultraestreita
      const line2 = screen.getByTestId("card-line-2-inst-narrow");
      expect(line2.className).toContain("flex-wrap");
      expect(line2.className).toContain("min-w-0");

      // Linha 3 tem justify-between, operador com flex-1 min-w-0 truncate e cota com shrink-0
      const line3 = screen.getByTestId("card-line-3-inst-narrow");
      expect(line3.className).toContain("justify-between");
      expect(line3.className).toContain("min-w-0");

      const operatorEl = screen.getByTestId("chip-operator-inst-narrow");
      expect(operatorEl.className).toContain("min-w-0");
      expect(operatorEl.className).toContain("flex-1");

      const quotaEl = screen.getByTestId("chip-quota-inst-narrow");
      expect(quotaEl.className).toContain("shrink-0");
      expect(quotaEl).toHaveTextContent("42 de 50");
    });

    it("teste 4: sem informação repetida: perfil do WhatsApp não compete na linha 2 do cartão fechado e operador é diferenciado", () => {
      render(
        <TooltipProvider>
          <EvolutionInstanceCard
            tenantId="tenant-1"
            instance={mockInstance1}
            draft={{ chipState: "cold", dailyLimitOverride: "" }}
            onChipStateChange={vi.fn()}
            onLimitOverrideChange={vi.fn()}
            onSaveChip={vi.fn()}
            onToggleDefault={vi.fn()}
            onToggleActive={vi.fn()}
            onToggleWebhook={vi.fn()}
            onDelete={vi.fn()}
            canEdit={true}
            canManageOwner={true}
            operatorOptions={[
              { uid: "op-1", displayName: "Carlos Operador", email: "carlos@vexo.com" },
            ]}
            isSavePending={false}
            isDeletePending={false}
            isExpanded={false}
          />
        </TooltipProvider>
      );

      // Na linha 2, não deve aparecer o profileName ("Chip Comercial") como badge solto
      const line2 = screen.getByTestId("card-line-2-inst-chip-1");
      expect(line2).not.toHaveTextContent("Chip Comercial");

      // O nome do chip está na linha 1
      const line1 = screen.getByTestId("card-line-1-inst-chip-1");
      expect(line1).toHaveTextContent("WhatsApp Comercial 01");

      // O operador está na linha 3 com ícone claro
      const line3 = screen.getByTestId("card-line-3-inst-chip-1");
      expect(line3).toHaveTextContent("Carlos Operador");
      expect(line3.querySelector("svg")).toBeInTheDocument();
    });

    it("teste 5: o cartão aberto continua com tudo que tem hoje, incluindo dados do perfil", () => {
      render(
        <TooltipProvider>
          <EvolutionInstanceCard
            tenantId="tenant-1"
            instance={mockInstance1}
            draft={{ chipState: "cold", dailyLimitOverride: "" }}
            onChipStateChange={vi.fn()}
            onLimitOverrideChange={vi.fn()}
            onSaveChip={vi.fn()}
            onToggleDefault={vi.fn()}
            onToggleActive={vi.fn()}
            onToggleWebhook={vi.fn()}
            onDelete={vi.fn()}
            onSyncNow={vi.fn()}
            canEdit={true}
            canManageOwner={true}
            operatorOptions={[
              { uid: "op-1", displayName: "Carlos Operador", email: "carlos@vexo.com" },
            ]}
            isSavePending={false}
            isDeletePending={false}
            isExpanded={true}
          />
        </TooltipProvider>
      );

      // As 3 linhas do cabeçalho continuam lá
      expect(screen.getByTestId("card-line-1-inst-chip-1")).toBeInTheDocument();
      expect(screen.getByTestId("card-line-2-inst-chip-1")).toBeInTheDocument();
      expect(screen.getByTestId("card-line-3-inst-chip-1")).toBeInTheDocument();

      // No cartão aberto, o perfil do WhatsApp é exibido nos badges de configuração
      expect(screen.getByText("WhatsApp: Chip Comercial")).toBeInTheDocument();

      // Badges de configuração
      expect(screen.getByText("padrão")).toBeInTheDocument();
      expect(screen.getByText("ativa")).toBeInTheDocument();
      expect(screen.getByText("api key")).toBeInTheDocument();

      // Webhook URL
      expect(screen.getByText("https://webhook.evolution.com/dispatch-1")).toBeInTheDocument();

      // Controles de cota
      expect(screen.getByText("Cota Diária de Envios")).toBeInTheDocument();
      expect(screen.getByText("42 / 50")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /salvar cota/i })).toBeInTheDocument();

      // Sincronização
      expect(screen.getByText("Sincronizar Conversas no CRM")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /sincronizar agora/i })).toBeInTheDocument();

      // Operador
      expect(screen.getAllByText("Operador Responsável").length).toBeGreaterThanOrEqual(1);

      // Botões de ação
      expect(screen.getByRole("button", { name: /tornar padrão/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /desativar/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /remover/i })).toBeInTheDocument();
    });
  });

  describe("Tabela compartilhada de cotas (shared/chipQuotaTestCases.json) — Frontend", () => {
    quotaTestCases.forEach(({ description, chip_state, daily_limit_override, expected }) => {
      it(description, () => {
        expect(
          resolveChipLimit(
            chip_state as "cold" | "warm",
            daily_limit_override !== null ? String(daily_limit_override) : undefined
          )
        ).toBe(expected);
      });
    });
  });
});
