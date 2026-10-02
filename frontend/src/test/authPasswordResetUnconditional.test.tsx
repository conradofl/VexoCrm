import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { AuthProvider, useAuth } from "../contexts/AuthContext";
import { fetchApi } from "../lib/api";
import { changePassword as changeFirebasePassword } from "../lib/firebase";

vi.mock("../lib/api", () => ({
  fetchApi: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../lib/firebase", () => {
  return {
    onAuthChange: (callback: (user: any) => void) => {
      callback({
        uid: "user-backend-claim-123",
        email: "operador@vexo.com",
        metadata: {
          creationTime: "2026-01-01T00:00:00Z",
          lastSignInTime: "2026-01-01T00:01:00Z",
        },
        getIdToken: async () => "mock-token-abc",
      });
      return () => {};
    },
    getCurrentIdTokenResult: vi.fn().mockResolvedValue({
      // Estado do navegador ainda NÃO carregou a claim must_change_password
      claims: {},
    }),
    getIdToken: vi.fn().mockResolvedValue("mock-fresh-token-xyz"),
    changePassword: vi.fn().mockResolvedValue(undefined),
    loginWithEmail: vi.fn(),
    logout: vi.fn(),
    registerWithEmail: vi.fn(),
  };
});

function TestConsumerComponent() {
  const { changePassword, mustChangePassword, isAuthenticated } = useAuth();
  return (
    <div>
      <div data-testid="is-auth">{String(isAuthenticated)}</div>
      <div data-testid="must-change">{String(mustChangePassword)}</div>
      <button
        type="button"
        onClick={() => changePassword("senhaAtual123", "novaSenhaSegura456")}
      >
        Executar Troca
      </button>
    </div>
  );
}

describe("Limpeza incondicional da marca de primeiro acesso (AuthContext)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("usuário com a claim de primeiro acesso no backend e o estado local ainda não carregado tem a marca limpa depois de trocar a senha", async () => {
    render(
      <AuthProvider>
        <TestConsumerComponent />
      </AuthProvider>
    );

    // Espera inicializar
    await waitFor(() => {
      expect(screen.getByTestId("is-auth")).toHaveTextContent("true");
    });

    // Confirma que o estado local NÃO refletia mustChangePassword (ainda false)
    expect(screen.getByTestId("must-change")).toHaveTextContent("false");

    // Executa a troca de senha
    fireEvent.click(screen.getByRole("button", { name: /executar troca/i }));

    // Firebase no navegador é chamado diretamente
    await waitFor(() => {
      expect(changeFirebasePassword).toHaveBeenCalledWith("senhaAtual123", "novaSenhaSegura456");
    });

    // Chamada à rota existente de limpeza do backend (/api/access/complete-password-change)
    // acontece incondicionalmente mesmo com o estado local = false
    await waitFor(() => {
      expect(fetchApi).toHaveBeenCalledWith(
        "/api/access/complete-password-change",
        expect.objectContaining({
          method: "POST",
          headers: { Authorization: "Bearer mock-fresh-token-xyz" },
        })
      );
    });

    // Confirma que nenhuma senha vazou no fetchApi
    const fetchApiCalls = vi.mocked(fetchApi).mock.calls;
    for (const [url, init] of fetchApiCalls) {
      expect(url).toBe("/api/access/complete-password-change");
      const serialized = JSON.stringify(init);
      expect(serialized).not.toContain("senhaAtual123");
      expect(serialized).not.toContain("novaSenhaSegura456");
      expect(init?.body).toBeUndefined();
    }

    // Marca local também é gravada no localStorage
    expect(localStorage.getItem("password_reset_done_user-backend-claim-123")).toBe("1");
  });
});
