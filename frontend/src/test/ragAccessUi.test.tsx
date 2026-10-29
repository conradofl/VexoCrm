// frontend/src/test/ragAccessUi.test.tsx
//
// SPEC-RAG-GATE-agente-rag (opção A): a tela pergunta GET /api/rag/access e
// esconde o upload de quem o backend recusaria. Antes, o input só olhava
// RAG_LIVE — o gestor do container-led via a área de upload e levava 403.
// O veredito vem do backend (mesma função do gate); aqui só se prova que a
// tela obedece a ele.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, getIdToken: async () => "token-teste" }),
}));
vi.mock("@/hooks/useCrmClient", () => ({
  useOptionalCrmClient: () => ({
    selectedClientId: "container-led",
    selectedClient: { id: "container-led" },
    clients: [],
    isLoading: false,
    error: null,
    setSelectedClientId: () => {},
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NEGADO = {
  data: { allowed: false, reason: "RAG_USER_NOT_ALLOWED", message: "Seu usuário não tem acesso ao Agente IA. Fale com o administrador." },
  isLoading: false,
  isError: false,
};
const LIBERADO = { data: { allowed: true, reason: null, message: null }, isLoading: false, isError: false };
const CARREGANDO = { data: undefined, isLoading: true, isError: false };

function mockHooks(access: unknown, spies: { useRagDocuments?: any; useRagAccess?: any } = {}) {
  const useRagDocuments = spies.useRagDocuments ?? vi.fn(() => ({ data: [], isLoading: false }));
  const useRagAccess = spies.useRagAccess ?? vi.fn(() => access);
  vi.doMock("@/hooks/useRagDocuments", () => ({
    useRagAccess,
    useRagDocuments,
    useUploadRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
    useReprocessRagDocument: () => ({ mutate: vi.fn(), isPending: false }),
    useRagSearchTest: () => ({ mutate: vi.fn(), isPending: false, data: undefined }),
  }));
  return { useRagDocuments, useRagAccess };
}

describe("Aba RAG (KnowledgeBaseRagTab) obedece ao veredito do backend", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_RAG_TAB_LIVE", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("F1 negado: nenhum input de arquivo no DOM, motivo visível, e a lista nem é buscada (não toma 403)", async () => {
    const { useRagDocuments } = mockHooks(NEGADO);
    const { KnowledgeBaseRagTab } = await import("@/components/agente/KnowledgeBaseRagTab");
    render(<KnowledgeBaseRagTab />);

    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByText(/Seu usuário não tem acesso ao Agente IA/)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Quais os diferenciais/i)).toBeNull();
    for (const call of useRagDocuments.mock.calls) expect(call[0]).toBeUndefined();
  });

  it("F2 liberado: input habilitado", async () => {
    mockHooks(LIBERADO);
    const { KnowledgeBaseRagTab } = await import("@/components/agente/KnowledgeBaseRagTab");
    render(<KnowledgeBaseRagTab />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.disabled).toBe(false);
  });

  it("F3 carregando: input desabilitado (nunca habilitado antes da resposta)", async () => {
    mockHooks(CARREGANDO);
    const { KnowledgeBaseRagTab } = await import("@/components/agente/KnowledgeBaseRagTab");
    render(<KnowledgeBaseRagTab />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (input) expect(input.disabled).toBe(true);
  });

  it("F5 pergunta ao backend pelo tenant selecionado", async () => {
    const { useRagAccess } = mockHooks(LIBERADO);
    const { KnowledgeBaseRagTab } = await import("@/components/agente/KnowledgeBaseRagTab");
    render(<KnowledgeBaseRagTab />);

    expect(useRagAccess).toHaveBeenCalledWith("container-led");
  });
});

describe("Seção por agente (AgentKnowledgeBaseSection) obedece ao veredito do backend", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_RAG_TAB_LIVE", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("F4 negado: nenhum input de arquivo no DOM e motivo visível", async () => {
    mockHooks(NEGADO);
    const { AgentKnowledgeBaseSection } = await import("@/components/agente/AgentKnowledgeBaseSection");
    render(<AgentKnowledgeBaseSection clientId="container-led" companyId="agente-1" />);

    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByText(/Seu usuário não tem acesso ao Agente IA/)).toBeTruthy();
  });

  it("F4b liberado: input habilitado", async () => {
    mockHooks(LIBERADO);
    const { AgentKnowledgeBaseSection } = await import("@/components/agente/AgentKnowledgeBaseSection");
    render(<AgentKnowledgeBaseSection clientId="container-led" companyId="agente-1" />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });
});
