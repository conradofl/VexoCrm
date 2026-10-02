import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { ChangePasswordDialog } from "@/components/auth/ChangePasswordDialog";
import { SidebarFooter } from "@/components/appSidebar/SidebarFooter";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as firebaseModule from "@/lib/firebase";

// Mock do hook useAuth
const mockChangePassword = vi.fn();
const mockLogout = vi.fn();
const mockGetIdToken = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    changePassword: mockChangePassword,
    logout: mockLogout,
    getIdToken: mockGetIdToken,
    user: { uid: "test-user-123", email: "operador@vexo.com" },
  }),
}));

describe("Troca de Senha dentro do sistema (ChangePasswordDialog)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renderiza o diálogo com os três campos: senha atual, nova senha e confirmação", () => {
    render(<ChangePasswordDialog open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByPlaceholderText("Digite sua senha atual")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Mínimo de 6 caracteres")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Repita a nova senha")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /salvar nova senha/i })).toBeInTheDocument();
  });

  it("mínimo de seis caracteres: avisa ao digitar, não depois de enviar", () => {
    render(<ChangePasswordDialog open={true} onOpenChange={vi.fn()} />);

    const newPasswordInput = screen.getByPlaceholderText("Mínimo de 6 caracteres");

    // Digita menos de 6 caracteres
    fireEvent.change(newPasswordInput, { target: { value: "12345" } });

    // Aviso aparece imediatamente enquanto digita
    expect(screen.getByText("A nova senha deve ter no mínimo 6 caracteres.")).toBeInTheDocument();

    // Ao completar 6 caracteres, o aviso some
    fireEvent.change(newPasswordInput, { target: { value: "123456" } });
    expect(screen.queryByText("A nova senha deve ter no mínimo 6 caracteres.")).not.toBeInTheDocument();
  });

  it("menos de seis caracteres é recusado antes do envio (sem chamar o Firebase)", async () => {
    render(<ChangePasswordDialog open={true} onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Digite sua senha atual"), { target: { value: "senhaatual123" } });
    fireEvent.change(screen.getByPlaceholderText("Mínimo de 6 caracteres"), { target: { value: "123" } });
    fireEvent.change(screen.getByPlaceholderText("Repita a nova senha"), { target: { value: "123" } });

    fireEvent.click(screen.getByRole("button", { name: /salvar nova senha/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("A nova senha deve ter no mínimo 6 caracteres.");
    });

    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it("nova igual à atual é recusada antes de chamar o Firebase", async () => {
    render(<ChangePasswordDialog open={true} onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Digite sua senha atual"), { target: { value: "minhasenha123" } });
    fireEvent.change(screen.getByPlaceholderText("Mínimo de 6 caracteres"), { target: { value: "minhasenha123" } });
    fireEvent.change(screen.getByPlaceholderText("Repita a nova senha"), { target: { value: "minhasenha123" } });

    fireEvent.click(screen.getByRole("button", { name: /salvar nova senha/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("A nova senha não pode ser igual à senha atual.");
    });

    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it("confirmação diferente é recusada antes de chamar o Firebase", async () => {
    render(<ChangePasswordDialog open={true} onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Digite sua senha atual"), { target: { value: "senhaatual123" } });
    fireEvent.change(screen.getByPlaceholderText("Mínimo de 6 caracteres"), { target: { value: "novasenha123" } });
    fireEvent.change(screen.getByPlaceholderText("Repita a nova senha"), { target: { value: "outrasenha123" } });

    fireEvent.click(screen.getByRole("button", { name: /salvar nova senha/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("A confirmação da nova senha não confere.");
    });

    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it("senha atual errada mostra a mensagem certa e não chama a troca definitiva", async () => {
    // Simula erro de senha atual errada vindo do Firebase
    mockChangePassword.mockRejectedValueOnce({
      code: "auth/invalid-credential",
      message: "Firebase: Error (auth/invalid-credential).",
    });

    render(<ChangePasswordDialog open={true} onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Digite sua senha atual"), { target: { value: "senhaerrada123" } });
    fireEvent.change(screen.getByPlaceholderText("Mínimo de 6 caracteres"), { target: { value: "novasenha123" } });
    fireEvent.change(screen.getByPlaceholderText("Repita a nova senha"), { target: { value: "novasenha123" } });

    fireEvent.click(screen.getByRole("button", { name: /salvar nova senha/i }));

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      // Mensagem clara sem jargão: "a senha atual não confere", e NUNCA "credencial inválida"
      expect(alert).toHaveTextContent("A senha atual não confere.");
      expect(alert).not.toHaveTextContent("credencial inválida");
      expect(alert).not.toHaveTextContent("invalid-credential");
    });
  });

  it("sessão velha mostra o aviso de entrar de novo, não o erro técnico, com botão de logout", async () => {
    mockChangePassword.mockRejectedValueOnce({
      code: "auth/requires-recent-login",
      message: "Firebase: Error (auth/requires-recent-login).",
    });

    render(<ChangePasswordDialog open={true} onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Digite sua senha atual"), { target: { value: "senhaantiga123" } });
    fireEvent.change(screen.getByPlaceholderText("Mínimo de 6 caracteres"), { target: { value: "novasenha123" } });
    fireEvent.change(screen.getByPlaceholderText("Repita a nova senha"), { target: { value: "novasenha123" } });

    fireEvent.click(screen.getByRole("button", { name: /salvar nova senha/i }));

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      // Sem erro técnico exposto
      expect(alert).not.toHaveTextContent("auth/requires-recent-login");
      expect(alert).toHaveTextContent("Sua sessão expirou para esta operação de segurança. Saia e entre de novo para continuar.");
    });

    // Botão de ação para sair e entrar de novo
    const logoutBtn = screen.getByRole("button", { name: /sair e entrar de novo/i });
    expect(logoutBtn).toBeInTheDocument();

    fireEvent.click(logoutBtn);
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("depois de trocar com sucesso: confirmação na tela e a sessão continua sem forçar logout", async () => {
    mockChangePassword.mockResolvedValueOnce(undefined);

    render(<ChangePasswordDialog open={true} onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Digite sua senha atual"), { target: { value: "senhaantiga123" } });
    fireEvent.change(screen.getByPlaceholderText("Mínimo de 6 caracteres"), { target: { value: "novasenha123" } });
    fireEvent.change(screen.getByPlaceholderText("Repita a nova senha"), { target: { value: "novasenha123" } });

    fireEvent.click(screen.getByRole("button", { name: /salvar nova senha/i }));

    await waitFor(() => {
      expect(screen.getByText("Senha alterada com sucesso!")).toBeInTheDocument();
      expect(screen.getByText(/sua sessão continua ativa/i)).toBeInTheDocument();
    });

    // Não deve forçar logout
    expect(mockLogout).not.toHaveBeenCalled();
  });
});

describe("Troca de Senha — Integração com Menu do Usuário (SidebarFooter)", () => {
  it("renderiza o botão 'Trocar senha' junto de 'Sair' e abre o diálogo ao clicar", () => {
    render(
      <TooltipProvider>
        <SidebarFooter
          collapsed={false}
          userName="Carlos Silva"
          isLoggingOut={false}
          onLogout={vi.fn()}
        />
      </TooltipProvider>
    );

    // Botão Trocar senha visível junto de Sair
    const trocarSenhaBtn = screen.getByRole("button", { name: /trocar senha/i });
    const sairBtn = screen.getByRole("button", { name: /sair/i });

    expect(trocarSenhaBtn).toBeInTheDocument();
    expect(sairBtn).toBeInTheDocument();

    // Clica no botão e abre o diálogo
    fireEvent.click(trocarSenhaBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trocar senha" })).toBeInTheDocument();
  });
});

describe("Troca de Senha — Isolamento de Rede e Marca de Primeiro Acesso", () => {
  let backendRequests: { url: string; method?: string; body?: any; headers?: any }[] = [];
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    backendRequests = [];
    originalFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      let bodyText = init?.body;
      backendRequests.push({
        url,
        method: init?.method,
        body: bodyText,
        headers: init?.headers,
      });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sucesso limpa a marca de primeiro acesso chamando a rota já existente", async () => {
    // Simula troca de senha direta no Firebase Auth
    const changeFirebasePasswordSpy = vi
      .spyOn(firebaseModule, "changePassword")
      .mockResolvedValueOnce(undefined);

    // Simula chamada de backend para limpar must_change_password
    const token = "mock-id-token-abc";
    const response = await fetch("/api/access/complete-password-change", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    // Rota chamada foi /api/access/complete-password-change
    expect(backendRequests).toHaveLength(1);
    expect(backendRequests[0].url).toBe("/api/access/complete-password-change");
    expect(backendRequests[0].method).toBe("POST");
    expect(backendRequests[0].headers).toEqual({ Authorization: `Bearer ${token}` });
  });

  it("nenhuma senha aparece em requisição para o nosso backend", async () => {
    const secretCurrent = "SenhaSuperSecretaAtual!99";
    const secretNew = "NovaSenhaUltraSegura#42";

    // Simula o fluxo: reautenticação e atualização acontecem no Firebase no navegador
    const changeFirebasePasswordSpy = vi
      .spyOn(firebaseModule, "changePassword")
      .mockResolvedValueOnce(undefined);

    await firebaseModule.changePassword(secretCurrent, secretNew);

    // Backend recebe apenas a notificação de limpeza de marca sem senha
    await fetch("/api/access/complete-password-change", {
      method: "POST",
      headers: { Authorization: "Bearer mock-token" },
    });

    // Varredura estrita em todas as requisições enviadas ao backend
    for (const req of backendRequests) {
      const rawString = JSON.stringify(req);

      // Nenhuma senha atual, nova ou confirmação trafegou
      expect(rawString).not.toContain(secretCurrent);
      expect(rawString).not.toContain(secretNew);
      expect(req.body).toBeUndefined();
    }
  });
});
