import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

import BancoDeDados from "@/pages/BancoDeDados";

const mockTenant = {
  id: "sonhare",
  name: "Sonhare",
  plan_tier: "avancado",
  ticket_medio: 1000,
  modulos_avulsos: [],
  n8n_settings: {
    chatbot_enabled: true,
    chatbot_model: "generico",
    chatbot_llm_model: "openai/gpt-oss-120b",
    evolution_instances: [{ name: "Instancia-1", active: true, id: "inst-1" }],
  },
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    clientId: "sonhare",
    isInternalUser: true,
    isAuthenticated: true,
    isAdminUser: true,
    canAccessInternalPage: () => true,
    canAccessView: () => true,
    getIdToken: async () => "mock-token",
  }),
}));

const mockCrmClient = {
  selectedClientId: "sonhare",
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


// a tela inteira monta (muitos hooks) e, com a suíte toda rodando junto, passa de 5 s: não é falha da lista
vi.setConfig({ testTimeout: 30_000 });

const TOTAL = 25_000;
const PAGE = 50;
const leadRow = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({
  id, client_id: "sonhare", nome, stage: "cold", telefone: `55119${id.replace(/\D/g, "").padStart(8, "0")}`, phone: null,
  raw_chat_summary: null, created_at: "2026-01-01T00:00:00.000Z", dados: {}, ...extra,
});

interface FakeServer { pageUrls: string[]; otherUrls: string[]; audienceBodies: any[]; behavior: { degraded: boolean; lookupHit: boolean; audienceRulesError: boolean; failedPart: string | null } }
const server: FakeServer = { pageUrls: [], otherUrls: [], audienceBodies: [], behavior: { degraded: false, lookupHit: true, audienceRulesError: false, failedPart: null } };
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as any;

function installFakeServer() {
  server.pageUrls = [];
  server.otherUrls = [];
  server.audienceBodies = [];
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url), "http://x");
    if (u.pathname === "/api/leads/facets") {
      const full: Record<string, unknown> = {
        summary: { totalLeads: TOTAL, buyersCount: 100, lostCount: 50, openBudgetsCount: 200, inNegotiationCount: 200, inConversationCount: 5000, neverContactedCount: 19650, activeLeadsCount: 24850, estimatedRevenue: 0 },
        channels: { google: 12000, instagram: 8000, nao_identificada: 5000 },
        sources: [{ source: "Google Ads", count: 12000 }, { source: "Instagram Direct", count: 8000 }, { source: "Não informado", count: 5000 }],
        tags: [
          { tag: "vip", count: 4000, kind: "minhas" },
          { tag: "#Imp-feira_abril", count: 900, kind: "planilha" },
          { tag: "VP Ofertas", count: 1011, kind: "origem" },
          { tag: "agenda-whatsapp", count: 5050, kind: "origem" },
          { tag: "Follow-up", count: 152, kind: "ia" },
        ],
      };
      const out: Record<string, unknown> = {
        ...full,
        baseTotal: TOTAL,
        stagesExact: { buyer: 100, open_budget: 200, inquiry: 300, cold: 24000, lost: 50, other: 350 },
        failedParts: {},
      };
      const bad = server.behavior.failedPart;
      if (bad) {
        out[bad] = null;
        if (bad === "summary") { out.baseTotal = null; out.stagesExact = null; }
        out.failedParts = { [bad]: { message: `falha simulada em ${bad}`, code: "42703" } };
      }
      return json(out);
    }
    if (u.pathname === "/api/leads/lookup") {
      server.otherUrls.push(String(url));
      return json({ item: server.behavior.lookupHit ? leadRow("999", "Lead Distante Da Pagina") : null });
    }
    if (u.pathname === "/api/leads/ids") {
      server.otherUrls.push(String(url));
      const n = 1234;
      return json({ ids: Array.from({ length: n }, (_, i) => `id-${i}`), total: n, truncated: false, contacts: Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, nome: `N${i}`, telefone: `5511${i}` })) });
    }
    if (u.pathname === "/api/leads/import-sources") {
      return json({
        items: [
          { id: "11111111-1111-1111-1111-111111111111", source_name: "clientes-junho.xlsx", created_at: "2026-06-01T12:00:00.000Z", total_rows: 1530, status: "completed" },
          { id: "22222222-2222-2222-2222-222222222222", source_name: "Importação reconstruída — #Imp-clientes_2026 (≈ 31/12/2025)", created_at: "2025-12-31T00:00:00.000Z", total_rows: 17843, status: "completed", reconstructed: true },
        ],
      });
    }
    if (u.pathname === "/api/leads/import-origin") {
      server.otherUrls.push(String(url));
      if (u.searchParams.get("importId") === "22222222-2222-2222-2222-222222222222") {
        return json({ found: true, importId: "22222222-2222-2222-2222-222222222222", sourceName: "Importação reconstruída — #Imp-clientes_2026 (≈ 31/12/2025)", reconstructed: true, totalIsFloor: true, approximateDate: true, totalRows: 17843, createdAt: "2025-12-31T00:00:00.000Z", born: null, existed: null, total: 17843, reason: "Importação reconstruída depois do fato: não existe a hora de abertura para separar quem nasceu nela de quem já existia." });
      }
      return json({ found: true, importId: u.searchParams.get("importId"), sourceName: "clientes-junho.xlsx", totalRows: 1530, createdAt: "2026-06-01T12:00:00.000Z", born: 1200, existed: 300, total: 1500 });
    }
    if (u.pathname === "/api/leads/audience") {
      server.otherUrls.push(String(url));
      server.audienceBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      if (server.behavior.audienceRulesError) {
        return json({ error: { code: "UNSUPPORTED_RULES", message: 'A coluna "dados" não pode ser usada como regra' }, problems: [] }, 400);
      }
      const items = Array.from({ length: 300 }, (_, i) => leadRow(String(i + 1), `Publico ${i + 1}`));
      return json({ items, total: 300, truncated: false });
    }
    if (u.pathname === "/api/leads") {
      server.pageUrls.push(String(url));
      const page = Number(u.searchParams.get("page") || "1");
      const limit = Number(u.searchParams.get("limit") || String(PAGE));
      const stage = u.searchParams.get("stage");
      const total = stage === "buyer" ? 100 : TOTAL;
      const items = Array.from({ length: limit }, (_, i) => leadRow(String((page - 1) * limit + i + 1), `Lead P${page} L${i + 1}`));
      return json({
        items, total, page, limit, totalPages: Math.ceil(total / limit),
        // abas do servidor (dentro do filtro): propositalmente diferentes dos totais da base (facets) para provar de onde vêm
        tabs: server.behavior.degraded ? null : { all: TOTAL, buyer: 101, open_budget: 199, cold: 24650, lost: 50 },
        degraded: server.behavior.degraded,
        ...(server.behavior.degraded ? { degradedReason: "FILTERS_UNAVAILABLE", degradedCause: { message: 'column "x" does not exist', code: "42703" } } : {}),
      });
    }
    if (u.pathname.includes("/evolution-instances")) return json({ items: [] });
    return json({ items: [] });
  }) as any;
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/crm/banco-de-dados"]}>{ui}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const lastPageParams = () => new URL(server.pageUrls[server.pageUrls.length - 1], "http://x").searchParams;

describe("Banco de Dados — lista paginada no servidor (base de 25.000)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/crm/banco-de-dados");
    server.behavior = { degraded: false, lookupHit: true, audienceRulesError: false, failedPart: null };
    installFakeServer();
  });

  it("pede UMA página (page/limit) e mostra o total real do servidor, não o tamanho da página", async () => {
    renderWithProviders(<BancoDeDados />);
    expect(await screen.findByText("Lead P1 L1")).toBeInTheDocument();
    expect(screen.getAllByText(/^Lead P1 L\d+$/)).toHaveLength(PAGE);
    expect(screen.getByText(/25\.000/, { selector: "span.font-semibold" })).toBeInTheDocument(); // "de 25.000 leads" no rodapé
    const p = lastPageParams();
    expect(p.get("page")).toBe("1");
    expect(p.get("limit")).toBe("50");
    // nunca mais a base inteira de uma vez: todo pedido de lista é paginado
    expect(server.pageUrls.every((u) => new URL(u, "http://x").searchParams.has("page"))).toBe(true);
  });

  it("as abas mostram a contagem do banco", async () => {
    renderWithProviders(<BancoDeDados />);
    await screen.findByText("Lead P1 L1");
    expect(screen.getByRole("button", { name: /Todas\s*\(25000\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Compradores\s*\(101\)/ })).toBeInTheDocument(); // contagem da ABA (servidor), não a da base (100)
    expect(screen.getByRole("button", { name: /Orçamentos Abertos\s*\(199\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Leads Frios\s*\(24650\)/ })).toBeInTheDocument();
  });

  it("os cartões de origem são a base inteira vinda do banco", async () => {
    renderWithProviders(<BancoDeDados />);
    await screen.findByText("Lead P1 L1");
    await waitFor(() => expect(screen.getByTitle(/Google Ads: 12000 leads \(48%\)/)).toBeInTheDocument());
    expect(screen.getByTitle(/Instagram: 8000 leads \(32%\)/)).toBeInTheDocument();
  });

  it("'Próxima' pede a página 2 ao servidor", async () => {
    renderWithProviders(<BancoDeDados />);
    await screen.findByText("Lead P1 L1");
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText("Lead P2 L1")).toBeInTheDocument();
    expect(lastPageParams().get("page")).toBe("2");
    expect(screen.queryByText("Lead P1 L1")).not.toBeInTheDocument();
  });

  it("trocar de aba volta à página 1 e manda o estágio ao servidor numa chamada só", async () => {
    renderWithProviders(<BancoDeDados />);
    await screen.findByText("Lead P1 L1");
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByText("Lead P2 L1");
    const before = server.pageUrls.length;
    fireEvent.click(screen.getByRole("button", { name: /Compradores/ }));
    await waitFor(() => expect(lastPageParams().get("stage")).toBe("buyer"));
    expect(lastPageParams().get("page")).toBe("1");
    expect(server.pageUrls.slice(before).every((u) => new URL(u, "http://x").searchParams.get("page") === "1")).toBe(true);
  });

  it("a busca vai ao servidor (depois de uma pausa na digitação)", async () => {
    renderWithProviders(<BancoDeDados />);
    await screen.findByText("Lead P1 L1");
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nome/), { target: { value: "ana" } });
    await waitFor(() => expect(lastPageParams().get("search")).toBe("ana"), { timeout: 3000 });
  });

  it("ordenar pelo cabeçalho pede a ordem ao servidor", async () => {
    renderWithProviders(<BancoDeDados />);
    await screen.findByText("Lead P1 L1");
    fireEvent.click(screen.getByText("Contato", { selector: "th *, th" }));
    await waitFor(() => expect(lastPageParams().get("sort")).toBe("contato"));
    expect(lastPageParams().get("dir")).toBe("asc");
  });

  it("servidor degradado: a tela AVISA que os filtros não foram aplicados e não finge as abas", async () => {
    server.behavior.degraded = true;
    renderWithProviders(<BancoDeDados />);
    expect(await screen.findByTestId("leads-degraded-banner")).toHaveTextContent(/filtros não puderam ser aplicados/i);
    expect(await screen.findByTestId("leads-degraded-cause")).toHaveTextContent(/column "x" does not exist \[42703\]/);
  });

  it("sem degradação não há aviso", async () => {
    renderWithProviders(<BancoDeDados />);
    await screen.findByText("Lead P1 L1");
    expect(screen.queryByTestId("leads-degraded-banner")).not.toBeInTheDocument();
  });

  it("lead da URL (?leadId=) fora da página carregada é localizado no servidor e abre a gaveta", async () => {
    window.history.pushState({}, "", "/crm/banco-de-dados?leadId=lead-999");
    renderWithProviders(<BancoDeDados />);
    await screen.findByText("Lead P1 L1");
    await waitFor(() => expect(server.otherUrls.some((u) => u.includes("/api/leads/lookup") && u.includes("leadId=lead-999"))).toBe(true));
    expect(await screen.findAllByText("Lead Distante Da Pagina")).not.toHaveLength(0);
  });

  it("lead da URL que está na página NÃO consulta o servidor", async () => {
    window.history.pushState({}, "", "/crm/banco-de-dados?leadId=3");
    renderWithProviders(<BancoDeDados />);
    await screen.findByText("Lead P1 L3");
    await waitFor(() => expect(screen.getAllByText("Lead P1 L3").length).toBeGreaterThan(1)); // linha + gaveta
    expect(server.otherUrls.some((u) => u.includes("/api/leads/lookup"))).toBe(false);
  });

  it("'Selecionar todos desta faixa' seleciona TODOS os leads do filtro (ids do servidor), não só os 50 da página", async () => {
    renderWithProviders(<BancoDeDados />);
    await screen.findByText("Lead P1 L1");
    await waitFor(() => expect(screen.getByText(/Nunca abordados · 19\.?650/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Nunca abordados · 19\.?650/i).closest("div.cursor-pointer")!);
    const botao = await screen.findByRole("button", { name: /Selecionar todos desta faixa/i });
    fireEvent.click(botao);
    expect(await screen.findByText(/1234 selecionados/)).toBeInTheDocument();
    await waitFor(() => expect(server.otherUrls.some((u) => u.includes("/api/leads/ids") && u.includes("segment=never_contacted"))).toBe(true));
  });

  it("assistente de campanha: o público vem do servidor (estágios e tag), e a lista longa mostra só 200 linhas", async () => {
    renderWithProviders(<BancoDeDados />);
    await screen.findByText("Lead P1 L1");
    fireEvent.click(await screen.findByTestId("btn-create-campaign"));
    await waitFor(() => expect(server.otherUrls.some((u) => u.includes("/api/leads/audience"))).toBe(true));
    expect(await screen.findByText(/Mostrando 200 de 300/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Publico \d+$/)).toHaveLength(200); // 300 no filtro, 200 desenhadas
    expect(screen.queryByTestId("campaign-audience-error")).not.toBeInTheDocument();
  });

  it("assistente de campanha: regra em campo não suportado MOSTRA o motivo (não um '0 leads' calado)", async () => {
    server.behavior.audienceRulesError = true;
    renderWithProviders(<BancoDeDados />);
    await screen.findByText("Lead P1 L1");
    fireEvent.click(await screen.findByTestId("btn-create-campaign"));
    expect(await screen.findByTestId("campaign-audience-error")).toHaveTextContent(/coluna "dados" não pode ser usada como regra/);
  });

  describe("totais da base degradam POR PARTE (a lista de tags não pode sumir por causa de outra conta)", () => {
    const checks = {
      summary: () => expect(screen.getByText(/faixas do Potencial e totais por estágio/)).toBeInTheDocument(),
      channels: () => expect(screen.getByText(/cartões de origem/)).toBeInTheDocument(),
      sources: () => expect(screen.getByText(/lista de origens/)).toBeInTheDocument(),
      tags: () => expect(screen.getByText(/lista de tags/)).toBeInTheDocument(),
    };

    it.each(["summary", "channels", "sources", "tags"] as const)("parte '%s' falha: as outras três chegam à tela e o aviso fala só dela", async (parte) => {
      server.behavior.failedPart = parte;
      renderWithProviders(<BancoDeDados />);
      await screen.findByText("Lead P1 L1");
      const aviso = await screen.findByTestId("leads-facets-partial");
      checks[parte]();
      expect(aviso).toHaveTextContent(new RegExp(`${parte}: falha simulada em ${parte} \\[42703\\]`));
      for (const outra of ["summary", "channels", "sources", "tags"].filter((p) => p !== parte)) {
        expect(aviso).not.toHaveTextContent(new RegExp(`${outra}: falha simulada`));
      }
      // a lista de tags (escolher tag para montar a campanha) continua funcionando quando a falha NÃO é a das tags
      if (parte !== "tags") expect(await screen.findByRole("option", { name: "vip" })).toBeInTheDocument();
      else expect(screen.queryByRole("option", { name: "vip" })).not.toBeInTheDocument();
      // cartões de origem: valor real quando chegaram; "—" (e não 0) quando falharam
      if (parte === "channels") expect(screen.queryByTitle(/Google Ads: \d+ leads/)).not.toBeInTheDocument();
      else expect(await screen.findByTitle(/Google Ads: 12000 leads/)).toBeInTheDocument();
      // a lista de leads, a paginação e as abas seguem normais
      expect(screen.getAllByText(/^Lead P1 L\d+$/)).toHaveLength(PAGE);
    });

    it("com channels falhando os cartões mostram '—', nunca 0", async () => {
      server.behavior.failedPart = "channels";
      renderWithProviders(<BancoDeDados />);
      await screen.findByTestId("leads-facets-partial");
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });

    it("sem falha não há aviso de parte", async () => {
      renderWithProviders(<BancoDeDados />);
      await screen.findByText("Lead P1 L1");
      expect(screen.queryByTestId("leads-facets-partial")).not.toBeInTheDocument();
    });
  });

  describe("tags agrupadas por tipo e campanha por planilha", () => {
    it("o seletor de tags vem agrupado (Planilhas, Grupos e origem, Rótulos da IA, Minhas), sem perder nenhuma tag", async () => {
      renderWithProviders(<BancoDeDados />);
      await screen.findByText("Lead P1 L1");
      const select = await screen.findByTestId("tag-select");
      await waitFor(() => expect(select.querySelectorAll("optgroup").length).toBe(4));
      expect(Array.from(select.querySelectorAll("optgroup")).map((g) => g.getAttribute("label"))).toEqual(["Planilhas", "Grupos e origem", "Rótulos da IA", "Minhas"]);
      const opcoes = Array.from(select.querySelectorAll("option")).map((o) => o.textContent).filter((t) => t && t !== "Todas as Tags").sort();
      expect(opcoes).toEqual(["#Imp-feira_abril", "Follow-up", "VP Ofertas", "agenda-whatsapp", "vip"].sort());
      expect(select.querySelector('optgroup[label="Planilhas"] option')?.textContent).toBe("#Imp-feira_abril");
    });

    it("campanha por planilha: escolhe a planilha registrada, vê os dois números, e o público pedido leva a planilha e o recorte", async () => {
      renderWithProviders(<BancoDeDados />);
      await screen.findByText("Lead P1 L1");
      fireEvent.click(await screen.findByTestId("btn-create-campaign"));
      const picker = await screen.findByTestId("campaign-import-select");
      await waitFor(() => expect(picker.querySelectorAll("option").length).toBe(3)); // "qualquer origem" + a planilha + a reconstruída
      // antes de escolher: sem planilha no pedido (a escolha por tag continua existindo)
      await waitFor(() => expect(server.audienceBodies.length).toBeGreaterThan(0));
      expect(server.audienceBodies[server.audienceBodies.length - 1].importId).toBeUndefined();
      fireEvent.change(picker, { target: { value: "11111111-1111-1111-1111-111111111111" } });
      const numeros = await screen.findByTestId("campaign-import-numbers");
      expect(numeros).toHaveTextContent(/1\.?200.*nasceram nesta importação/);
      expect(numeros).toHaveTextContent(/300.*já existiam e foram atualizados por ela/);
      // padrão = todos
      await waitFor(() => {
        const b = server.audienceBodies[server.audienceBodies.length - 1];
        expect(b).toMatchObject({ importId: "11111111-1111-1111-1111-111111111111", importScope: "all" });
      });
      fireEvent.click(screen.getByTestId("campaign-import-scope-born"));
      await waitFor(() => expect(server.audienceBodies[server.audienceBodies.length - 1].importScope).toBe("born"));
      fireEvent.click(screen.getByTestId("campaign-import-scope-existed"));
      await waitFor(() => expect(server.audienceBodies[server.audienceBodies.length - 1].importScope).toBe("existed"));
      // voltar a "qualquer origem" tira a planilha do pedido
      fireEvent.change(picker, { target: { value: "" } });
      await waitFor(() => expect(server.audienceBodies[server.audienceBodies.length - 1].importId).toBeUndefined());
    });

    it("importação RECONSTRUÍDA: só o total (no mínimo) e o porquê; sem 'nasceram / já existiam' e sem os recortes; o rótulo da lista diz que o total é piso", async () => {
      renderWithProviders(<BancoDeDados />);
      await screen.findByText("Lead P1 L1");
      fireEvent.click(await screen.findByTestId("btn-create-campaign"));
      const picker = await screen.findByTestId("campaign-import-select");
      await waitFor(() => expect(picker.querySelectorAll("option").length).toBe(3));
      const rotulo = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent).find((t) => t?.includes("reconstruída"));
      expect(rotulo).toMatch(/no mínimo 17\.?843 leads \(total é piso, data aproximada\)/);
      fireEvent.change(picker, { target: { value: "22222222-2222-2222-2222-222222222222" } });
      const numeros = await screen.findByTestId("campaign-import-numbers");
      expect(numeros).toHaveTextContent(/No mínimo 17\.?843 leads encontrados/);
      expect(numeros).not.toHaveTextContent(/nasceram nesta importação ·/);
      expect(await screen.findByTestId("campaign-import-reason")).toHaveTextContent(/não existe a hora de abertura/);
      expect(screen.getByTestId("campaign-import-scope-all")).toBeInTheDocument();
      expect(screen.queryByTestId("campaign-import-scope-born")).not.toBeInTheDocument();
      expect(screen.queryByTestId("campaign-import-scope-existed")).not.toBeInTheDocument();
      await waitFor(() => expect(server.audienceBodies[server.audienceBodies.length - 1]).toMatchObject({ importId: "22222222-2222-2222-2222-222222222222", importScope: "all" }));
    });
  });
});
