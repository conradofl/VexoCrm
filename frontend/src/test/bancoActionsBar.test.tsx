// src/test/bancoActionsBar.test.tsx
//
// Barra de ações do Banco de Dados: agrupada por função (traz dado → leva dado → age sobre a base → exclusão),
// "Extrair" como um menu único com as três formas de trazer contato de fora, e a exclusão por tag como o
// último elemento, afastada e discreta. Saíram "Corrigir origem Instagram Direct" e "Ticket Médio".

import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import BancoDeDados from "@/pages/BancoDeDados";
import { BancoActionsBar } from "@/components/leads/BancoActionsBar";
import bancoSrc from "../pages/BancoDeDados.tsx?raw";

let currentPlanTier = "essencial";

const mockTenant = {
  id: "tenant-essencial",
  name: "Tenant Teste",
  get plan_tier() {
    return currentPlanTier;
  },
  ticket_medio: 1000,
  modulos_avulsos: ["banco-de-dados"],
  n8n_settings: {
    chatbot_enabled: true,
    evolution_instances: [
      { name: "Chip 1", active: true, id: "inst-1" },
      { name: "Chip 2", active: true, id: "inst-2" },
    ],
  },
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    clientId: "tenant-essencial",
    isInternalUser: true,
    isAuthenticated: true,
    isAdminUser: true,
    canAccessInternalPage: () => true,
    canAccessView: () => true,
    getIdToken: async () => "mock-token",
  }),
}));

const mockCrmClient = {
  selectedClientId: "tenant-essencial",
  selectedClient: mockTenant,
  clients: [mockTenant],
  isLoading: false,
  setSelectedClientId: vi.fn(),
};

vi.mock("@/hooks/useCrmClient", () => ({
  useCrmClient: () => mockCrmClient,
  useOptionalCrmClient: () => mockCrmClient,
}));

vi.mock("@/hooks/useLeadClients", () => ({
  useLeadClients: () => ({ data: [mockTenant], isLoading: false }),
  useUpdateLeadClientN8nSettings: () => ({ mutateAsync: vi.fn() }),
  useUpdateLeadClientTicketMedio: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSdrRotationNext: () => ({ data: { next: null }, isLoading: false }),
}));

vi.mock("@/hooks/useAdminUsers", () => ({
  useAdminUsers: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useContactsWithoutChannel", () => ({
  useContactsWithoutChannel: () => ({ count: 0, isLoading: false }),
  useImportInstagram: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter>
          <BancoDeDados />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

// "Extrair" é um menu com as três formas de trazer contato de fora; aqui abrimos a do WhatsApp
async function openExtractOption(testId: string) {
  fireEvent.keyDown(await screen.findByTestId("btn-extract-menu"), { key: "Enter" });
  fireEvent.click(await screen.findByTestId(testId));
}

const SELECTED_STYLE_FILL = /bg-(rose|red|emerald|amber|indigo|purple)-[5-7]00/;

// ── a barra, isolada, com os callbacks espiados ─────────────────────────────────────────────────────
function makeProps(over: Partial<React.ComponentProps<typeof BancoActionsBar>> = {}) {
  return {
    loading: false,
    onRefresh: vi.fn(),
    onExtractWhatsApp: vi.fn(),
    onImportInstagram: vi.fn(),
    onPasteText: vi.fn(),
    onImportSpreadsheet: vi.fn(),
    onExportXLSX: vi.fn(),
    onExportCSV: vi.fn(),
    onCreateCampaign: vi.fn(),
    onNewLead: vi.fn(),
    selectedCount: 0,
    onApplyFollowup: vi.fn(),
    onSingleReminder: vi.fn(),
    clientId: "A",
    canManageBulk: true,
    ...over,
  };
}
function renderBar(over: Partial<React.ComponentProps<typeof BancoActionsBar>> = {}) {
  const props = makeProps(over);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BancoActionsBar {...props} />
    </QueryClientProvider>
  );
  return props;
}
const bar = () => screen.getByTestId("banco-actions-bar");
const groups = () => [...bar().querySelectorAll("[data-group]")].map((g) => g.getAttribute("data-group"));
const abrirMenu = (testId: string) => fireEvent.keyDown(screen.getByTestId(testId), { key: "Enter" });

describe("barra de ações: a ordem dos grupos", () => {
  it("[TESTE OBRIGATÓRIO] traz dado → leva dado → age sobre a base → exclusão, nesta ordem; 'Atualizar' continua no começo", () => {
    renderBar();

    expect(groups()).toEqual(["traz", "leva", "age", "exclui"]);
    const botoes = within(bar()).getAllByRole("button");
    expect(botoes[0].textContent).toContain("Atualizar");
    // dentro de cada grupo: Extrair e Importar planilha juntos; Exportar; Criar campanha e Novo lead
    const doGrupo = (g: string) => [...bar().querySelector(`[data-group="${g}"]`)!.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
    expect(doGrupo("traz")).toEqual(["Extrair", "Importar planilha"]);
    expect(doGrupo("leva")).toEqual(["Exportar leads"]);
    expect(doGrupo("age")).toEqual(["Criar campanha", "Novo lead"]);
    expect(doGrupo("exclui")).toEqual(["Excluir leads por tag…"]);
  });

  it("[TESTE OBRIGATÓRIO] a exclusão por tag é o ÚLTIMO elemento da barra", () => {
    renderBar();

    const botoes = within(bar()).getAllByRole("button");
    expect(botoes[botoes.length - 1].getAttribute("data-testid")).toBe("btn-mass-delete-by-tag");
    // e nada vem depois dele, nem outro grupo
    const grupos = [...bar().children];
    expect(grupos[grupos.length - 1].getAttribute("data-group")).toBe("exclui");
  });

  it("[TESTE OBRIGATÓRIO] a exclusão por tag não é adjacente a 'Criar campanha' nem a 'Novo lead': grupo próprio, com separador no meio", () => {
    renderBar();
    const excluir = screen.getByTestId("btn-mass-delete-by-tag");
    const criar = screen.getByTestId("btn-create-campaign");
    const novo = screen.getByTestId("btn-new-lead");

    expect(excluir.parentElement).not.toBe(criar.parentElement);
    expect(excluir.parentElement).not.toBe(novo.parentElement);
    const grupoExclusao = bar().querySelector('[data-group="exclui"]')!;
    expect(grupoExclusao.previousElementSibling?.getAttribute("role")).toBe("separator"); // o separador fica entre os dois grupos
    expect(grupoExclusao.previousElementSibling).not.toBe(bar().querySelector('[data-group="age"]'));
    expect(bar().querySelector('[data-group="age"]')!.contains(excluir)).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] a exclusão é visualmente mais discreta: contorno tracejado e cor neutra, sem preenchimento — os outros botões de criar são preenchidos", () => {
    renderBar();
    const excluir = screen.getByTestId("btn-mass-delete-by-tag");

    expect(excluir.className).toContain("border-dashed");
    expect(excluir.className).toContain("text-muted-foreground");
    expect(excluir.className).not.toMatch(SELECTED_STYLE_FILL);
    for (const id of ["btn-create-campaign", "btn-new-lead"]) expect(screen.getByTestId(id).className, id).toMatch(SELECTED_STYLE_FILL);
  });

  it("[TESTE OBRIGATÓRIO] sem permissão de gestor/admin não há exclusão nem separador", () => {
    renderBar({ canManageBulk: false });

    expect(screen.queryByTestId("btn-mass-delete-by-tag")).toBeNull();
    expect(groups()).toEqual(["traz", "leva", "age"]);
    expect(within(bar()).queryByRole("separator")).toBeNull();
  });

  it("com leads selecionados, follow-up e lembrete entram no grupo que age sobre a base, antes de 'Novo lead'", () => {
    const props = renderBar({ selectedCount: 3 });
    const age = [...bar().querySelector('[data-group="age"]')!.querySelectorAll("button")].map((b) => (b.textContent || "").trim());

    expect(age).toEqual(["Criar campanha", "Aplicar Follow-up (3)", "Lembrete avulso", "Novo lead"]);
    fireEvent.click(screen.getByRole("button", { name: /Aplicar Follow-up/ }));
    fireEvent.click(screen.getByRole("button", { name: /Lembrete avulso/ }));
    expect(props.onApplyFollowup).toHaveBeenCalledTimes(1);
    expect(props.onSingleReminder).toHaveBeenCalledTimes(1);
  });
});

describe("barra de ações: Extrair é um menu só", () => {
  it("[TESTE OBRIGATÓRIO] o menu abre as três opções, e cada uma chama o que chamava antes", async () => {
    const props = renderBar();
    expect(screen.queryByTestId("extract-whatsapp")).toBeNull(); // fechado: nenhuma opção solta na barra

    abrirMenu("btn-extract-menu");
    expect(await screen.findByTestId("extract-whatsapp")).toBeTruthy();
    expect(screen.getByTestId("extract-instagram")).toBeTruthy();
    expect(screen.getByTestId("extract-text")).toBeTruthy();
    expect(screen.getByText("Extrair do WhatsApp (QR Code)")).toBeTruthy();
    expect(screen.getByText("Importar do Instagram")).toBeTruthy();
    expect(screen.getByText(/Colar texto avulso/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("extract-whatsapp"));
    expect(props.onExtractWhatsApp).toHaveBeenCalledTimes(1);
    expect(props.onImportInstagram).not.toHaveBeenCalled();
    expect(props.onPasteText).not.toHaveBeenCalled();

    abrirMenu("btn-extract-menu");
    fireEvent.click(await screen.findByTestId("extract-instagram"));
    expect(props.onImportInstagram).toHaveBeenCalledTimes(1);

    abrirMenu("btn-extract-menu");
    fireEvent.click(await screen.findByTestId("extract-text"));
    expect(props.onPasteText).toHaveBeenCalledTimes(1);
  });

  it("as três formas não aparecem mais como botões soltos na barra", () => {
    renderBar();
    for (const nome of [/Extrair do WhatsApp/, /Importar do Instagram/, /Colar Texto Avulso/i]) expect(screen.queryByRole("button", { name: nome }), String(nome)).toBeNull();
  });

  it("importar planilha, exportar (Excel e CSV), criar campanha e novo lead chamam o que chamavam", async () => {
    const props = renderBar();

    fireEvent.click(screen.getByTestId("btn-import-spreadsheet"));
    fireEvent.click(screen.getByTestId("btn-create-campaign"));
    fireEvent.click(screen.getByTestId("btn-new-lead"));
    fireEvent.click(screen.getByRole("button", { name: /Atualizar/ }));
    abrirMenu("btn-export-menu");
    fireEvent.click(await screen.findByText("Exportar Excel (.xlsx)"));
    abrirMenu("btn-export-menu");
    fireEvent.click(await screen.findByText("Exportar CSV (.csv)"));

    expect(props.onImportSpreadsheet).toHaveBeenCalledTimes(1);
    expect(props.onCreateCampaign).toHaveBeenCalledTimes(1);
    expect(props.onNewLead).toHaveBeenCalledTimes(1);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(props.onExportXLSX).toHaveBeenCalledTimes(1);
    expect(props.onExportCSV).toHaveBeenCalledTimes(1);
  });

  it("'Atualizar' fica desabilitado enquanto carrega", () => {
    renderBar({ loading: true });
    expect((screen.getByRole("button", { name: /Atualizar/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── a página inteira ───────────────────────────────────────────────────────────────────────────────
describe("Banco de Dados: a barra na página", () => {
  beforeEach(() => {
    currentPlanTier = "avancado";
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("/api/leads/summary")) return { ok: true, json: async () => ({ totalLeads: 0, buyersCount: 0, lostCount: 0, neverContactedCount: 0, inConversationCount: 0, inNegotiationCount: 0, activeLeadsCount: 0 }) };
      if (String(url).includes("/api/leads?")) return { ok: true, json: async () => ({ leads: [], totalCount: 0 }) };
      return { ok: true, json: async () => ({}) };
    }) as any;
  });

  it("[TESTE OBRIGATÓRIO] os dois botões removidos não aparecem mais: 'Corrigir origem' e 'Ticket Médio'", async () => {
    renderPage();
    await screen.findByTestId("banco-actions-bar");

    expect(screen.queryByTestId("btn-origin-fix")).toBeNull();
    expect(screen.queryByRole("button", { name: /Corrigir origem/i })).toBeNull();
    expect(within(screen.getByTestId("banco-actions-bar")).queryByRole("button", { name: /Ticket M[eé]dio/i })).toBeNull();
  });

  it("o controle de Ticket Médio continua existindo, dentro do bloco de potencial da base, e abre o diálogo de configuração", async () => {
    renderPage();
    const barra = await screen.findByTestId("banco-actions-bar");

    // fora da barra, no bloco Potencial: com ticket configurado diz "Ticket R$ ...", sem ele "Configurar ticket"
    const doPotencial = await screen.findByRole("button", { name: /^(Ticket R\$|Configurar ticket)/ });
    expect(barra.contains(doPotencial)).toBe(false);
    fireEvent.click(doPotencial);
    expect(await screen.findByText("Configurar Ticket Médio")).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] o menu Extrair abre, na página, cada uma das três janelas que os botões abriam", async () => {
    renderPage();
    await screen.findByTestId("banco-actions-bar");

    abrirMenu("btn-extract-menu");
    fireEvent.click(await screen.findByTestId("extract-whatsapp"));
    expect(await screen.findByText("Mineração Semântica via WhatsApp")).toBeTruthy();
  });

  it("Extrair → Importar do Instagram abre a janela do Instagram", async () => {
    renderPage();
    await screen.findByTestId("banco-actions-bar");

    abrirMenu("btn-extract-menu");
    fireEvent.click(await screen.findByTestId("extract-instagram"));
    expect(await screen.findByText("Importar Conversas do Instagram")).toBeTruthy();
  });

  it("Extrair → Colar texto avulso abre o importador com IA", async () => {
    renderPage();
    await screen.findByTestId("banco-actions-bar");

    abrirMenu("btn-extract-menu");
    fireEvent.click(await screen.findByTestId("extract-text"));
    expect(await screen.findByText("Importador Inteligente com IA")).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] na página, a exclusão por tag é o último botão da barra e abre o diálogo de exclusão", async () => {
    renderPage();
    const barra = await screen.findByTestId("banco-actions-bar");

    const botoes = within(barra).getAllByRole("button");
    expect(botoes[botoes.length - 1].getAttribute("data-testid")).toBe("btn-mass-delete-by-tag");
    fireEvent.click(botoes[botoes.length - 1]);
    await waitFor(() => expect(screen.getByTestId("mass-delete-dialog")).toBeTruthy());
  });

  it("[TESTE OBRIGATÓRIO] o diálogo, o hook, a lib e o teste da correção de origem foram removidos do frontend", () => {
    const existentes = {
      ...import.meta.glob("../components/leads/OriginFixDialog.tsx"),
      ...import.meta.glob("../hooks/useLeadOriginFix.ts"),
      ...import.meta.glob("../lib/leadOriginFix.ts"),
      ...import.meta.glob("./leadOriginFix.test.tsx"),
    };
    expect(Object.keys(existentes)).toEqual([]);
    expect(bancoSrc).not.toMatch(/OriginFix|Corrigir origem|origin-fix/);
  });
});
