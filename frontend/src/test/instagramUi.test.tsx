// frontend/src/test/instagramUi.test.tsx
//
// Testes de interface para a funcionalidade de importação do Instagram
// e Lista de Trabalho Manual (contacts_without_channel).

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InstagramImportModal } from "@/components/leads/InstagramImportModal";
import { ContactsWithoutChannelSection } from "@/components/leads/ContactsWithoutChannelSection";

// Mock de autenticação
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    getIdToken: async () => "fake-test-token",
  }),
}));

// Mock do Sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithClient(ui: React.ReactElement, client = createTestQueryClient()) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function createMockFile(name: string, path: string, content: string): File {
  const blob = new Blob([content], { type: "application/json" });
  const file = new File([blob], name);
  Object.defineProperty(file, "webkitRelativePath", {
    value: path,
    writable: false,
  });
  file.text = async () => content;
  return file;
}

describe("InstagramImportModal", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes("/api/leads/import-instagram")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            success: true,
            leadsCreated: 1,
            contactsWithoutChannelCreated: 1,
            insertErrors: 0,
          }),
        };
      }
      return {
        ok: false,
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      };
    });
    global.fetch = fetchMock as any;
  });

  it("exibe aviso bloqueante de .zip quando o usuário seleciona um arquivo compactado", async () => {
    renderWithClient(
      <InstagramImportModal open={true} onOpenChange={vi.fn()} clientId="test-client" />
    );

    const zipInput = screen.getByTestId("instagram-zip-input");
    const zipFile = new File(["fake-zip-data"], "instagram_export.zip", { type: "application/zip" });

    fireEvent.change(zipInput, { target: { files: [zipFile] } });

    await waitFor(() => {
      expect(screen.getByText("Arquivo compactado (.zip) selecionado")).toBeInTheDocument();
      expect(
        screen.getByText(/descompacte o arquivo \.zip/i)
      ).toBeInTheDocument();
    });

    // Botão de confirmar importação deve estar desabilitado
    const confirmBtn = screen.getByRole("button", { name: "Confirmar Importação" });
    expect(confirmBtn).toBeDisabled();
  });

  it("exibe aviso informativo de exportação em .html quando não há .json", async () => {
    renderWithClient(
      <InstagramImportModal open={true} onOpenChange={vi.fn()} clientId="test-client" />
    );

    const folderInput = screen.getByTestId("instagram-folder-input");
    const htmlFile = createMockFile(
      "message_1.html",
      "export/messages/inbox/fernanda_123/message_1.html",
      "<html><body>conversa</body></html>"
    );

    fireEvent.change(folderInput, { target: { files: [htmlFile] } });

    await waitFor(() => {
      expect(screen.getByText("Exportação em formato HTML detectada")).toBeInTheDocument();
      expect(
        screen.getByText(/solicitada no Instagram com o/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/formato JSON/i)).toBeInTheDocument();
    });

    const confirmBtn = screen.getByRole("button", { name: "Confirmar Importação" });
    expect(confirmBtn).toBeDisabled();
  });

  it("exibe aviso quando não encontra pasta 'messages/inbox' na pasta selecionada", async () => {
    renderWithClient(
      <InstagramImportModal open={true} onOpenChange={vi.fn()} clientId="test-client" />
    );

    const folderInput = screen.getByTestId("instagram-folder-input");
    const randomFile = createMockFile(
      "foto.jpg",
      "export/photos/foto.jpg",
      "binary"
    );

    fireEvent.change(folderInput, { target: { files: [randomFile] } });

    await waitFor(() => {
      expect(screen.getByText("Nenhuma conversa encontrada")).toBeInTheDocument();
      expect(screen.getByText(/'messages\/inbox'/i)).toBeInTheDocument();
    });
  });

  it("exibe os dois grupos separados a partir do parse (Com WhatsApp e Sem WhatsApp) com explicações e contadores", async () => {
    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();

    renderWithClient(
      <InstagramImportModal
        open={true}
        onOpenChange={onOpenChange}
        clientId="test-client"
        onSuccess={onSuccess}
      />
    );

    const folderInput = screen.getByTestId("instagram-folder-input");

    // Monta 2 conversas: 1 com telefone, 1 sem telefone
    const SELF = "Minha Empresa";
    const fileComPhone = createMockFile(
      "message_1.json",
      "export/messages/inbox/fernanda_123/message_1.json",
      JSON.stringify({
        participants: [{ name: SELF }, { name: "Fernanda" }],
        messages: [
          { sender_name: "Fernanda", content: "Meu whatsapp é (34) 99876-5432", timestamp_ms: 2000 },
          { sender_name: "Fernanda", content: "Oi, vocês entregam em Uberlândia?", timestamp_ms: 1000 },
        ],
      })
    );

    const fileSemPhone = createMockFile(
      "message_1.json",
      "export/messages/inbox/bruno_456/message_1.json",
      JSON.stringify({
        participants: [{ name: SELF }, { name: "Bruno" }],
        messages: [
          { sender_name: "Bruno", content: "Quanto custa o produto azul?", timestamp_ms: 1000 },
        ],
      })
    );

    fireEvent.change(folderInput, { target: { files: [fileComPhone, fileSemPhone] } });

    // 1. Grupo 1: Com WhatsApp
    await waitFor(() => {
      expect(screen.getByTestId("tab-with-phone")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Estes contatos entrarão diretamente no CRM como leads mornos.")
    ).toBeInTheDocument();
    expect(screen.getByText("Fernanda")).toBeInTheDocument();
    expect(screen.getByText("+5534998765432")).toBeInTheDocument();
    expect(screen.getByText('"Oi, vocês entregam em Uberlândia?"')).toBeInTheDocument();

    // 2. Alterna para o Grupo 2: Sem WhatsApp
    fireEvent.click(screen.getByTestId("tab-without-phone"));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Estes contatos irão para a sua Lista de Trabalho Manual para solicitar o WhatsApp via Direct."
        )
      ).toBeInTheDocument();
    });
    expect(screen.getAllByText("Bruno").length).toBeGreaterThan(0);
    expect(screen.getByText('"Quanto custa o produto azul?"')).toBeInTheDocument();

    // 3. Confirmar importação envia os dados e chama callback
    const confirmBtn = screen.getByRole("button", { name: /Confirmar Importação/i });
    expect(confirmBtn).toBeEnabled();

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/leads/import-instagram"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("test-client"),
        })
      );
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("permite selecionar arquivos .json diretamente pelo input de json", async () => {
    renderWithClient(
      <InstagramImportModal
        open={true}
        onOpenChange={vi.fn()}
        clientId="test-client"
      />
    );

    const jsonInput = screen.getByTestId("instagram-json-input");
    const jsonFile = createMockFile(
      "message_1.json",
      "message_1.json",
      JSON.stringify({
        participants: [{ name: "Loja" }, { name: "Cliente Direto" }],
        messages: [
          { sender_name: "Cliente Direto", content: "Qual o valor do produto?", timestamp_ms: 1000 },
        ],
      })
    );

    fireEvent.change(jsonInput, { target: { files: [jsonFile] } });

    await waitFor(() => {
      expect(screen.getAllByText("Cliente Direto").length).toBeGreaterThan(0);
      expect(screen.getByText('"Qual o valor do produto?"')).toBeInTheDocument();
      expect(screen.getAllByText("Possível Cliente").length).toBeGreaterThan(0);
    });
  });

  it("filtra entre Possíveis Clientes e Conversas Pessoais no modal", async () => {
    renderWithClient(
      <InstagramImportModal
        open={true}
        onOpenChange={vi.fn()}
        clientId="test-client"
      />
    );

    const folderInput = screen.getByTestId("instagram-folder-input");
    const leadFile = createMockFile(
      "message_1.json",
      "export/messages/inbox/lead_1/message_1.json",
      JSON.stringify({
        participants: [{ name: "Loja" }, { name: "Interessado" }],
        messages: [
          { sender_name: "Interessado", content: "Vocês têm pronta entrega?", timestamp_ms: 1000 },
        ],
      })
    );

    const personalFile = createMockFile(
      "message_1.json",
      "export/messages/inbox/amigo_1/message_1.json",
      JSON.stringify({
        participants: [{ name: "Loja" }, { name: "Amigo Academia" }],
        messages: [
          { sender_name: "Amigo Academia", content: "tá muito frango, tem q pegar mais peso hahaha", timestamp_ms: 1000 },
        ],
      })
    );

    fireEvent.change(folderInput, { target: { files: [leadFile, personalFile] } });

    await waitFor(() => {
      expect(screen.getAllByText("Interessado").length).toBeGreaterThan(0);
    });

    // Filtra por Conversas Pessoais
    const personalTab = screen.getByRole("button", { name: /Conversas Pessoais/i });
    fireEvent.click(personalTab);

    await waitFor(() => {
      expect(screen.getAllByText("Amigo Academia").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Conversa Pessoal/i).length).toBeGreaterThan(0);
    });
  });
});

describe("ContactsWithoutChannelSection", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const MOCK_CONTACTS = [
    {
      id: "c-1",
      nome: "Fernanda Conceição",
      perfil: "fernanda_ig",
      resumo: "Vocês entregam em Uberlândia?",
      origem: "Instagram Direct",
      askedWhatsappAt: null,
      becameLeadAt: null,
      createdAt: "2026-09-28T12:00:00.000Z",
    },
    {
      id: "c-2",
      nome: "Bruno Silva",
      perfil: "bruno_ig",
      resumo: "Quanto custa o produto?",
      origem: "Instagram Direct",
      askedWhatsappAt: "2026-09-28T14:30:00.000Z",
      becameLeadAt: null,
      createdAt: "2026-09-28T11:00:00.000Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock de clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const urlStr = String(url);

      if (urlStr.includes("/api/contacts-without-channel/") && options?.method === "PATCH") {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ success: true }),
        };
      }

      if (urlStr.includes("/api/contacts-without-channel") && (!options?.method || options.method === "GET")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ contacts: MOCK_CONTACTS }),
        };
      }

      return {
        ok: false,
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      };
    });

    global.fetch = fetchMock as any;
  });

  it("renderiza a lista de contatos com Nome, Perfil, Resumo e Data", async () => {
    renderWithClient(<ContactsWithoutChannelSection clientId="test-client" />);

    await waitFor(() => {
      expect(screen.getByText("Fernanda Conceição")).toBeInTheDocument();
      expect(screen.getByText("fernanda_ig")).toBeInTheDocument();
      expect(screen.getByText('"Vocês entregam em Uberlândia?"')).toBeInTheDocument();

      expect(screen.getByText("Bruno Silva")).toBeInTheDocument();
      expect(screen.getByText("bruno_ig")).toBeInTheDocument();
    });
  });

  it("clique no botão 'Copiar Mensagem' copia o texto contextualizado para o clipboard", async () => {
    renderWithClient(<ContactsWithoutChannelSection clientId="test-client" />);

    await waitFor(() => {
      expect(screen.getByTestId("btn-copy-message-c-1")).toBeInTheDocument();
    });

    const copyBtn = screen.getByTestId("btn-copy-message-c-1");
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "Oi Fernanda Conceição! Vi sua mensagem sobre 'Vocês entregam em Uberlândia?'. Me passa seu WhatsApp por aqui que te explico tudo em detalhes por lá rapidinho!"
      );
    });

    // Botão indica visualmente que foi copiado
    expect(screen.getByText("Copiado!")).toBeInTheDocument();
  });

  it("clique no checkbox 'Pedi o WhatsApp' dispara PATCH com { field: 'asked_whatsapp', value: true }", async () => {
    renderWithClient(<ContactsWithoutChannelSection clientId="test-client" />);

    await waitFor(() => {
      expect(screen.getByTestId("checkbox-asked-c-1")).toBeInTheDocument();
    });

    const checkbox = screen.getByTestId("checkbox-asked-c-1");
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/contacts-without-channel/c-1"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            clientId: "test-client",
            field: "asked_whatsapp",
            value: true,
          }),
        })
      );
    });
  });

  it("clique no checkbox 'Virou Lead' dispara PATCH com { field: 'became_lead', value: true }", async () => {
    const onLeadConverted = vi.fn();
    renderWithClient(
      <ContactsWithoutChannelSection clientId="test-client" onLeadConverted={onLeadConverted} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("checkbox-converted-c-1")).toBeInTheDocument();
    });

    const checkbox = screen.getByTestId("checkbox-converted-c-1");
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/contacts-without-channel/c-1"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            clientId: "test-client",
            field: "became_lead",
            value: true,
          }),
        })
      );
    });

    await waitFor(() => {
      expect(onLeadConverted).toHaveBeenCalled();
    });
  });
});
