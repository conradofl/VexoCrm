// frontend/src/test/knowledgeBaseRagTab.test.tsx
//
// KnowledgeBaseRagTab.tsx (Etapa 5, Leva 2, Commit 4): reescrita ligada na
// API real, atrás do interruptor VITE_RAG_TAB_LIVE. Cobre:
// 1. Desligada (padrão, sem a env var): badge "Em breve", upload desabilitado,
//    e useRagDocuments chamado com clientId undefined — nunca busca de verdade.
// 2. Ligada: lista documentos reais, mostra "precisa reindexar" com botão de
//    reprocessar, e apagar SEMPRE pede confirmação antes de chamar a mutação
//    (nunca dispara no clique do ícone).
// 3. Busca de teste mostra a similaridade de cada trecho, marcando quem passa
//    o limiar e quem não passa.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, getIdToken: async () => "token-teste" }),
}));
vi.mock("@/hooks/useCrmClient", () => ({
  useOptionalCrmClient: () => ({
    selectedClientId: "geracao-digital",
    selectedClient: { id: "geracao-digital" },
    clients: [],
    isLoading: false,
    error: null,
    setSelectedClientId: () => {},
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("KnowledgeBaseRagTab — 'Em breve' quando a leva não está ligada", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("mostra badge 'Em breve', upload desabilitado, e useRagDocuments chamado com clientId undefined (nunca busca de verdade)", async () => {
    const useRagDocumentsMock = vi.fn(() => ({ data: [], isLoading: false }));
    vi.doMock("@/hooks/useRagDocuments", () => ({
      useRagDocuments: useRagDocumentsMock,
      useUploadRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
      useDeleteRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
      useReprocessRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
      useRagSearchTest: () => ({ mutate: vi.fn(), isPending: false, data: undefined }),
    }));

    const { KnowledgeBaseRagTab } = await import("@/components/agente/KnowledgeBaseRagTab");
    render(<KnowledgeBaseRagTab />);

    expect(screen.getByText("Em breve")).toBeTruthy();
    expect(screen.getByText(/Esta leva ainda não está no ar/i)).toBeTruthy();

    // useRagDocuments é chamado, mas com clientId undefined — o hook (real) não
    // dispara fetch nenhum quando isso acontece (enabled: Boolean(clientId)).
    expect(useRagDocumentsMock).toHaveBeenCalledWith(undefined);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.disabled).toBe(true);

    const searchInput = screen.getByPlaceholderText(/Quais os diferenciais/i) as HTMLInputElement;
    expect(searchInput.disabled).toBe(true);
  });
});

describe("KnowledgeBaseRagTab — ligada (VITE_RAG_TAB_LIVE=true)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_RAG_TAB_LIVE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lista documento real, mostra 'Precisa reindexar' com botão de reprocessar, e apagar exige confirmação antes de chamar a mutação", async () => {
    const deleteMutate = vi.fn();
    const reprocessMutate = vi.fn();
    vi.doMock("@/hooks/useRagDocuments", () => ({
      useRagDocuments: () => ({
        data: [
          {
            id: "doc-1",
            filename: "tabela_precos.pdf",
            mimeType: "application/pdf",
            sizeBytes: 204800,
            status: "ready",
            errorLog: null,
            chunkCount: 12,
            companyId: null,
            createdAt: "2026-09-01T10:00:00Z",
            updatedAt: "2026-09-01T10:00:00Z",
            needsReindex: true,
          },
        ],
        isLoading: false,
      }),
      useUploadRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
      useDeleteRagDocument: () => ({ mutate: deleteMutate, isPending: false }),
      useReprocessRagDocument: () => ({ mutate: reprocessMutate, isPending: false }),
      useRagSearchTest: () => ({ mutate: vi.fn(), isPending: false, data: undefined }),
    }));

    const { KnowledgeBaseRagTab } = await import("@/components/agente/KnowledgeBaseRagTab");
    render(<KnowledgeBaseRagTab />);

    expect(screen.getByText("tabela_precos.pdf")).toBeTruthy();
    expect(screen.getByText("Precisa reindexar")).toBeTruthy();
    expect(screen.getByText(/12 trechos/)).toBeTruthy();

    // Reprocessar: dispara direto (não é destrutivo).
    fireEvent.click(screen.getByTitle("Reprocessar"));
    expect(reprocessMutate).toHaveBeenCalledWith("doc-1", expect.anything());

    // Apagar: clicar no ícone NUNCA chama a mutação direto — só abre a confirmação.
    fireEvent.click(screen.getByTitle("Apagar"));
    expect(deleteMutate).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Apagar "tabela_precos.pdf"\?/)).toBeTruthy();

    // Só ao confirmar DENTRO do diálogo é que a mutação dispara.
    fireEvent.click(within(dialog).getByRole("button", { name: "Apagar" }));
    expect(deleteMutate).toHaveBeenCalledWith("doc-1", expect.anything());
  });

  it("documento 'failed' também mostra o botão de reprocessar (a maquete prometia e não tinha)", async () => {
    vi.doMock("@/hooks/useRagDocuments", () => ({
      useRagDocuments: () => ({
        data: [
          {
            id: "doc-2",
            filename: "manual_tecnico.pdf",
            mimeType: "application/pdf",
            sizeBytes: 102400,
            status: "failed",
            errorLog: "Este PDF parece ser digitalizado (sem texto extraível).",
            chunkCount: 0,
            companyId: null,
            createdAt: "2026-09-01T10:00:00Z",
            updatedAt: "2026-09-01T10:00:00Z",
            needsReindex: false,
          },
        ],
        isLoading: false,
      }),
      useUploadRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
      useDeleteRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
      useReprocessRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
      useRagSearchTest: () => ({ mutate: vi.fn(), isPending: false, data: undefined }),
    }));

    const { KnowledgeBaseRagTab } = await import("@/components/agente/KnowledgeBaseRagTab");
    render(<KnowledgeBaseRagTab />);

    expect(screen.getByText("Falhou")).toBeTruthy();
    expect(screen.getByText(/sem texto extraível/i)).toBeTruthy();
    expect(screen.getByTitle("Reprocessar")).toBeTruthy();
  });

  it("busca de teste mostra a similaridade de cada trecho, marcando quem passa e quem não passa o limiar", async () => {
    const searchMutate = vi.fn((_question: string, opts?: any) => {
      opts?.onSuccess?.();
    });
    vi.doMock("@/hooks/useRagDocuments", () => ({
      useRagDocuments: () => ({ data: [], isLoading: false }),
      useUploadRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
      useDeleteRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
      useReprocessRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
      useRagSearchTest: () => ({
        mutate: searchMutate,
        isPending: false,
        data: {
          applies: true,
          threshold: 0.5,
          chunks: [
            { documentId: "doc-1", filename: "tabela_precos.pdf", content: "Parcelamos em até 12x sem juros.", similarity: 0.91, passesThreshold: true },
            { documentId: "doc-2", filename: "horario.pdf", content: "Atendemos de 9h às 18h.", similarity: 0.12, passesThreshold: false },
          ],
          needsReindexDocumentIds: ["doc-3"],
        },
      }),
    }));

    const { KnowledgeBaseRagTab } = await import("@/components/agente/KnowledgeBaseRagTab");
    render(<KnowledgeBaseRagTab />);

    expect(screen.getByText(/91.0%/)).toBeTruthy();
    expect(screen.getByText(/passa no limiar/)).toBeTruthy();
    expect(screen.getByText(/12.0%/)).toBeTruthy();
    expect(screen.getByText(/abaixo do limiar/)).toBeTruthy();
    expect(screen.getByText(/1 documento\(s\) precisam reindexar/)).toBeTruthy();
  });
});
