// Testes do Portal do Cliente da GD: página pública e botão de copiar link no CRM.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GeracaoDigitalPortalCliente from "@/pages/GeracaoDigitalPortalCliente";
import GeracaoDigitalClientes from "@/pages/GeracaoDigitalClientes";
import * as apiModule from "@/lib/api";

const toastMock = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: any[]) => toastMock(...args),
}));

vi.mock("@/components/PageShell", () => ({
  PageShell: ({ title, children }: any) => <main><h1>{title}</h1>{children}</main>,
}));

const EQUIPE_GD = {
  uid: "uid-gd",
  role: "internal",
  isAdmin: false,
  clientId: "geracao-digital",
  clientIds: ["geracao-digital"],
  internalPages: ["propostas-gd"],
  granularPermissions: ["geracao_digital.proposals"],
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    getIdToken: async () => "fake-jwt-token",
    accessProfile: EQUIPE_GD,
    isInternalUser: true,
    canAccessInternalPage: () => true,
  }),
}));

const ESTADOS_MOCK = [
  { codigo: "PROPOSTA_ENVIADA", ordem: 10, fase: "comercial", rotulo_portal: "Proposta enviada", terminal: false, acao_do_cliente: false },
  { codigo: "AGUARDANDO_ASSINATURA_CLIENTE", ordem: 50, fase: "comercial", rotulo_portal: "Aguardando sua assinatura", terminal: false, acao_do_cliente: true },
  { codigo: "GRUPOS_CRIADOS", ordem: 70, fase: "entrada", rotulo_portal: "Equipe montada", terminal: false, acao_do_cliente: false },
  { codigo: "ATIVO", ordem: 160, fase: "regime", rotulo_portal: "Contrato ativo", terminal: false, acao_do_cliente: false },
];

const PORTAL_PAYLOAD_MOCK = {
  cliente: {
    nome: "Acme Indústria Solar",
    estado_atual: "AGUARDANDO_ASSINATURA_CLIENTE",
    estado_desde: "2026-11-05T10:00:00.000Z",
    estado_data_estimada: false,
    proposal_id: "prop-123",
    drive_url: "https://drive.google.com/drive/folders/pasta-acme",
    escopo: ["google", "meta"],
  },
  estados: ESTADOS_MOCK,
  eventos: [
    { estado: "PROPOSTA_ENVIADA", ocorrido_em: "2026-11-04T10:00:00.000Z", data_estimada: false },
    { estado: "AGUARDANDO_ASSINATURA_CLIENTE", ocorrido_em: "2026-11-05T10:00:00.000Z", data_estimada: false },
  ],
};

function renderComRouter(elemento: React.ReactElement, rotaInicial = "/acompanhamento/tok-valido-123") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[rotaInicial]}>
        <Routes>
          <Route path="/acompanhamento/:token" element={elemento} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Página Pública do Portal do Cliente (GeracaoDigitalPortalCliente)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastMock.mockClear();
  });

  it("renderiza estado de carregamento suave inicialmente", () => {
    // Retorna uma promise pendente para capturar o loading
    vi.spyOn(apiModule, "fetchApi").mockReturnValue(new Promise(() => {}));

    const { container } = renderComRouter(<GeracaoDigitalPortalCliente />);
    // Skeletons de carregamento presentes
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("exibe tela amigável informando que o link é inválido ou expirou em caso de 404", async () => {
    vi.spyOn(apiModule, "fetchApi").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Link de acompanhamento inválido ou expirado." }),
    } as Response);

    renderComRouter(<GeracaoDigitalPortalCliente />, "/acompanhamento/tok-inexistente");

    await waitFor(() => {
      expect(screen.getByText("Link inválido ou expirado")).toBeInTheDocument();
    });

    expect(screen.getByText(/não está mais ativo ou foi revogado/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /falar com a geração digital/i })).toBeInTheDocument();
  });

  it("renderiza nome da empresa, badges, bloco de ação e régua da trilha com dados válidos", async () => {
    vi.spyOn(apiModule, "fetchApi").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => PORTAL_PAYLOAD_MOCK,
    } as Response);

    renderComRouter(<GeracaoDigitalPortalCliente />, "/acompanhamento/tok-valido-123");

    // Identificação do cliente
    await waitFor(() => {
      expect(screen.getByText("Acme Indústria Solar")).toBeInTheDocument();
    });

    // Badge do estado atual
    expect(screen.getAllByText("Aguardando sua assinatura").length).toBeGreaterThanOrEqual(1);

    // Bloco de Ação: acao_do_cliente === true
    const blocoAcao = screen.getByRole("region", { name: /ação necessária/i });
    expect(blocoAcao).toBeInTheDocument();
    expect(blocoAcao).toHaveTextContent("Sua ação é necessária nesta etapa: Aguardando sua assinatura");

    // Acessos úteis: Proposta e Drive
    expect(screen.getByText("Ver Proposta Comercial")).toBeInTheDocument();
    expect(screen.getByText("Pasta Geral no Drive")).toBeInTheDocument();

    // Régua da Trilha renderizada
    expect(screen.getByRole("region", { name: /trilha do cliente/i })).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === "Agora é com você: Aguardando sua assinatura.")).toBeInTheDocument();
  });

  it("renderiza os 4 documentos-chave com status 'Disponível em breve' quando URLs forem nulas", async () => {
    vi.spyOn(apiModule, "fetchApi").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ...PORTAL_PAYLOAD_MOCK,
        cliente: {
          ...PORTAL_PAYLOAD_MOCK.cliente,
          contrato_url: null,
          briefing_url: null,
          ficha_vexo_url: null,
          planejamento_url: null,
        },
      }),
    } as Response);

    renderComRouter(<GeracaoDigitalPortalCliente />, "/acompanhamento/tok-valido-123");

    await waitFor(() => {
      expect(screen.getByText("Documentos do Projeto")).toBeInTheDocument();
    });

    expect(screen.getByText("Em elaboração / assinatura")).toBeInTheDocument();
    expect(screen.getByText("Aguardando reunião de briefing")).toBeInTheDocument();
    expect(screen.getByText("Em parametrização")).toBeInTheDocument();
    expect(screen.getByText("Em elaboração")).toBeInTheDocument();

    const botoesBreve = screen.getAllByRole("button", { name: /disponível em breve/i });
    expect(botoesBreve.length).toBe(4);
    botoesBreve.forEach((botao) => {
      expect(botao).toBeDisabled();
    });
  });

  it("renderiza os 4 documentos-chave com links ativos e badges concluídos quando URLs existirem", async () => {
    const payloadComDocumentos = {
      ...PORTAL_PAYLOAD_MOCK,
      cliente: {
        ...PORTAL_PAYLOAD_MOCK.cliente,
        contrato_url: "https://documentos.gd.com/contrato-acme.pdf",
        briefing_url: "https://notion.so/briefing-acme",
        ficha_vexo_url: "https://vexo.ia/fichas/acme",
        planejamento_url: "https://trello.com/b/planejamento-acme",
      },
      suporte: {
        whatsapp: "5534999998888",
      },
    };

    vi.spyOn(apiModule, "fetchApi").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payloadComDocumentos,
    } as Response);

    renderComRouter(<GeracaoDigitalPortalCliente />, "/acompanhamento/tok-valido-123");

    await waitFor(() => {
      expect(screen.getByText("Documentos do Projeto")).toBeInTheDocument();
    });

    // Badges de status concluído
    expect(screen.getByText("Assinado")).toBeInTheDocument();
    expect(screen.getByText("Aprovado")).toBeInTheDocument();
    expect(screen.getByText("Configurado")).toBeInTheDocument();
    expect(screen.getByText("Ativo")).toBeInTheDocument();

    // Links ativos
    const linkContrato = screen.getByRole("link", { name: /acessar contrato/i });
    expect(linkContrato).toHaveAttribute("href", "https://documentos.gd.com/contrato-acme.pdf");

    const linkBriefing = screen.getByRole("link", { name: /acessar briefing/i });
    expect(linkBriefing).toHaveAttribute("href", "https://notion.so/briefing-acme");

    const linkFicha = screen.getByRole("link", { name: /acessar ficha técnica/i });
    expect(linkFicha).toHaveAttribute("href", "https://vexo.ia/fichas/acme");

    const linkPlan = screen.getByRole("link", { name: /acessar planejamento/i });
    expect(linkPlan).toHaveAttribute("href", "https://trello.com/b/planejamento-acme");

    // Canal de Suporte oficial no WhatsApp com mensagem contextual
    const linkSuporte = screen.getByRole("link", { name: /falar com nossa equipe/i });
    const href = linkSuporte.getAttribute("href") || "";
    expect(href).toContain("https://wa.me/5534999998888?text=");
    expect(href).toContain(encodeURIComponent("Olá! Sou do projeto Acme Indústria Solar e gostaria de tirar uma dúvida sobre a etapa atual: Aguardando sua assinatura"));
  });
});

describe("Botão Copiar Link do Portal no CRM (GeracaoDigitalClientes)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastMock.mockClear();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("ao clicar em 'Copiar Link do Portal', dispara emissão de token e copia URL completa para o clipboard", async () => {
    const clienteMock = {
      id: "cli-uuid-1",
      nome: "Cliente Teste Copia",
      estado_atual: "PROPOSTA_ACEITA",
      rotulo_interno: "Proposta aceita",
      fase: "entrada",
      ordem: 20,
      estado_desde: "2026-11-04T12:00:00.000Z",
      aproximado: false,
      prazo: null,
      created_at: "2026-11-04T12:00:00.000Z",
      updated_at: "2026-11-04T12:00:00.000Z",
    };

    vi.spyOn(apiModule, "fetchApi").mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/gd/clientes") {
        return { ok: true, status: 200, json: async () => ({ clientes: [clienteMock] }) } as Response;
      }
      if (url === "/api/gd/estados") {
        return { ok: true, status: 200, json: async () => ({ estados: ESTADOS_MOCK }) } as Response;
      }
      if (url === "/api/gd/clientes/cli-uuid-1") {
        return { ok: true, status: 200, json: async () => ({ cliente: clienteMock, eventos: [] }) } as Response;
      }
      if (url === "/api/gd/clientes/cli-uuid-1/portal-token" && init?.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            token: "tok-gerado-abc456",
            url: "/acompanhamento/tok-gerado-abc456",
            criado_em: "2026-11-05T12:00:00.000Z",
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <GeracaoDigitalClientes />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Cliente Teste Copia")).toBeInTheDocument();
    });

    // Abre o detalhe do cliente
    fireEvent.click(screen.getByText("Cliente Teste Copia"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copiar link do portal/i })).toBeInTheDocument();
    });

    // Clica no botão de copiar link
    const botaoCopiar = screen.getByRole("button", { name: /copiar link do portal/i });
    fireEvent.click(botaoCopiar);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/acompanhamento/tok-gerado-abc456`
      );
    });

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Link do portal copiado!",
        description: `${window.location.origin}/acompanhamento/tok-gerado-abc456`,
      })
    );
  });
});
