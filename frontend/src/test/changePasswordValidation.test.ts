import { describe, expect, it } from "vitest";
import {
  getNewPasswordLiveHint,
  parseChangePasswordError,
  validateChangePasswordForm,
} from "../lib/auth/changePasswordValidation";

describe("changePasswordValidation", () => {
  describe("validateChangePasswordForm", () => {
    it("recusa quando a senha atual não for informada", () => {
      const result = validateChangePasswordForm({
        currentPassword: "",
        newPassword: "novasenha123",
        confirmPassword: "novasenha123",
      });
      expect(result).not.toBeNull();
      expect(result?.field).toBe("currentPassword");
      expect(result?.message).toBe("Informe a senha atual.");
    });

    it("recusa quando a nova senha não for informada", () => {
      const result = validateChangePasswordForm({
        currentPassword: "senhaatual123",
        newPassword: "",
        confirmPassword: "",
      });
      expect(result).not.toBeNull();
      expect(result?.field).toBe("newPassword");
      expect(result?.message).toBe("Informe a nova senha.");
    });

    it("menos de seis caracteres é recusado antes do envio", () => {
      const result = validateChangePasswordForm({
        currentPassword: "senhaatual123",
        newPassword: "12345",
        confirmPassword: "12345",
      });
      expect(result).not.toBeNull();
      expect(result?.field).toBe("newPassword");
      expect(result?.message).toBe("A nova senha deve ter no mínimo 6 caracteres.");
    });

    it("nova igual à atual é recusada antes de chamar o Firebase", () => {
      const result = validateChangePasswordForm({
        currentPassword: "mesmasenha123",
        newPassword: "mesmasenha123",
        confirmPassword: "mesmasenha123",
      });
      expect(result).not.toBeNull();
      expect(result?.field).toBe("newPassword");
      expect(result?.message).toBe("A nova senha não pode ser igual à senha atual.");
    });

    it("confirmação diferente é recusada antes de chamar o Firebase", () => {
      const result = validateChangePasswordForm({
        currentPassword: "senhaatual123",
        newPassword: "novasenha123",
        confirmPassword: "outrasenha123",
      });
      expect(result).not.toBeNull();
      expect(result?.field).toBe("confirmPassword");
      expect(result?.message).toBe("A confirmação da nova senha não confere.");
    });

    it("aceita quando todos os campos estão válidos e coerentes", () => {
      const result = validateChangePasswordForm({
        currentPassword: "senhaatual123",
        newPassword: "novasenha123",
        confirmPassword: "novasenha123",
      });
      expect(result).toBeNull();
    });
  });

  describe("getNewPasswordLiveHint", () => {
    it("não exibe aviso se o campo estiver vazio", () => {
      expect(getNewPasswordLiveHint("")).toBeNull();
      expect(getNewPasswordLiveHint(undefined)).toBeNull();
    });

    it("avisa ao digitar menos de 6 caracteres", () => {
      expect(getNewPasswordLiveHint("1")).toBe("A nova senha deve ter no mínimo 6 caracteres.");
      expect(getNewPasswordLiveHint("12345")).toBe("A nova senha deve ter no mínimo 6 caracteres.");
    });

    it("remove o aviso a partir de 6 caracteres", () => {
      expect(getNewPasswordLiveHint("123456")).toBeNull();
      expect(getNewPasswordLiveHint("minhasenhasupersegura")).toBeNull();
    });
  });

  describe("parseChangePasswordError", () => {
    it("senha atual errada (auth/wrong-password) traduz para mensagem clara sem jargão", () => {
      const err = { code: "auth/wrong-password" };
      const parsed = parseChangePasswordError(err);
      expect(parsed.type).toBe("wrong_password");
      expect(parsed.message).toBe("A senha atual não confere.");
      expect(parsed.message).not.toContain("credencial inválida");
    });

    it("senha atual errada (auth/invalid-credential) traduz para 'A senha atual não confere.' e não para 'credencial inválida'", () => {
      const err = { code: "auth/invalid-credential" };
      const parsed = parseChangePasswordError(err);
      expect(parsed.type).toBe("wrong_password");
      expect(parsed.message).toBe("A senha atual não confere.");
      expect(parsed.message).not.toContain("credencial inválida");
    });

    it("senha atual errada (auth/invalid-login-credentials) traduz para 'A senha atual não confere.'", () => {
      const err = { code: "auth/invalid-login-credentials" };
      const parsed = parseChangePasswordError(err);
      expect(parsed.type).toBe("wrong_password");
      expect(parsed.message).toBe("A senha atual não confere.");
    });

    it("sessão velha (auth/requires-recent-login) orienta a sair e entrar de novo sem expor o erro técnico", () => {
      const err = { code: "auth/requires-recent-login" };
      const parsed = parseChangePasswordError(err);
      expect(parsed.type).toBe("requires_recent_login");
      expect(parsed.message).toContain("Saia e entre de novo");
      expect(parsed.message).not.toContain("auth/requires-recent-login");
    });

    it("sessão velha identificada por mensagem de texto", () => {
      const err = new Error("Firebase: Error (auth/requires-recent-login).");
      const parsed = parseChangePasswordError(err);
      expect(parsed.type).toBe("requires_recent_login");
      expect(parsed.message).toContain("Saia e entre de novo");
      expect(parsed.message).not.toContain("auth/requires-recent-login");
    });

    it("demais erros retornam mensagem genérica segura sem expor internals", () => {
      const err = new Error("Unexpected network socket failure");
      const parsed = parseChangePasswordError(err);
      expect(parsed.type).toBe("unknown");
      expect(parsed.message).toBe("Não foi possível alterar sua senha. Tente novamente mais tarde.");
      expect(parsed.message).not.toContain("socket");
    });
  });
});
