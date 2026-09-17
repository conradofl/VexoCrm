// frontend/src/test/agentKnowledgeBaseSection.test.tsx
//
// AgentKnowledgeBaseSection — "Um agente por chip", Commit 4. Base de
// conhecimento POR AGENTE: documento com companyId só entra na busca daquele
// agente; documento sem companyId vale pro tenant inteiro. A tela precisa
// deixar isso explícito por documento (é o que os testes cobram).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function mockHooks(documents: any[]) {
  vi.doMock("@/hooks/useRagDocuments", () => ({
    useRagDocuments: (_clientId: string | undefined, companyId: string | undefined) => ({
      data: documents,
      isLoading: false,
      __companyId: companyId,
    }),
    useUploadRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
    useReprocessRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
  }));
}

describe("AgentKnowledgeBaseSection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("[TESTE OBRIGATÓRIO] deixa explícito qual documento é só deste agente e qual vale pro tenant inteiro", async () => {
    vi.stubEnv("VITE_RAG_TAB_LIVE", "true");
    mockHooks([
      { id: "doc-1", filename: "tabela_precos.pdf", mimeType: "application/pdf", sizeBytes: 1024, status: "ready", errorLog: null, chunkCount: 5, embeddingProvider: "gemini", embeddingModel: "x", embeddingDim: 768, companyId: "agente-1", createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z", needsReindex: false },
      { id: "doc-2", filename: "politica_geral.pdf", mimeType: "application/pdf", sizeBytes: 2048, status: "ready", errorLog: null, chunkCount: 3, embeddingProvider: "gemini", embeddingModel: "x", embeddingDim: 768, companyId: null, createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z", needsReindex: false },
    ]);

    const { AgentKnowledgeBaseSection } = await import("@/components/agente/AgentKnowledgeBaseSection");
    render(<AgentKnowledgeBaseSection clientId="geracao-digital" companyId="agente-1" />);

    expect(screen.getByText("tabela_precos.pdf")).toBeTruthy();
    expect(screen.getByText("politica_geral.pdf")).toBeTruthy();
    expect(screen.getByText(/só deste agente/)).toBeTruthy();
    expect(screen.getByText(/vale para o tenant inteiro/)).toBeTruthy();

    vi.unstubAllEnvs();
  });

  it("desligado (RAG_LIVE ausente): mostra 'Em breve', upload desabilitado", async () => {
    mockHooks([]);
    const { AgentKnowledgeBaseSection } = await import("@/components/agente/AgentKnowledgeBaseSection");
    render(<AgentKnowledgeBaseSection clientId="geracao-digital" companyId="agente-1" />);

    expect(screen.getByText("Em breve")).toBeTruthy();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.disabled).toBe(true);
  });
});
