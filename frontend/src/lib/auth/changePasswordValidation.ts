export const MIN_PASSWORD_LENGTH = 6;

export interface ChangePasswordFormValues {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export interface ValidationIssue {
  field: "currentPassword" | "newPassword" | "confirmPassword";
  message: string;
}

/**
 * Validação prévia ao envio.
 * Recusa regras locais antes de qualquer chamada ao Firebase.
 */
export function validateChangePasswordForm(values: ChangePasswordFormValues): ValidationIssue | null {
  const current = values.currentPassword ?? "";
  const next = values.newPassword ?? "";
  const confirm = values.confirmPassword ?? "";

  if (!current.trim()) {
    return {
      field: "currentPassword",
      message: "Informe a senha atual.",
    };
  }

  if (!next) {
    return {
      field: "newPassword",
      message: "Informe a nova senha.",
    };
  }

  if (next.length < MIN_PASSWORD_LENGTH) {
    return {
      field: "newPassword",
      message: "A nova senha deve ter no mínimo 6 caracteres.",
    };
  }

  if (next === current) {
    return {
      field: "newPassword",
      message: "A nova senha não pode ser igual à senha atual.",
    };
  }

  if (next !== confirm) {
    return {
      field: "confirmPassword",
      message: "A confirmação da nova senha não confere.",
    };
  }

  return null;
}

/**
 * Retorna aviso em tempo real ao digitar a nova senha.
 * "Mínimo de seis caracteres, que é a regra do Firebase — avise ao digitar, não depois de enviar."
 */
export function getNewPasswordLiveHint(newPassword?: string): string | null {
  if (!newPassword) return null;
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return "A nova senha deve ter no mínimo 6 caracteres.";
  }
  return null;
}

export type ChangePasswordParsedErrorType =
  | "wrong_password"
  | "requires_recent_login"
  | "weak_password"
  | "too_many_requests"
  | "unknown";

export interface ParsedChangePasswordError {
  type: ChangePasswordParsedErrorType;
  message: string;
}

/**
 * Traduz erros do Firebase sem jargão técnico.
 * - "auth/wrong-password" ou "auth/invalid-credential" -> "a senha atual não confere", NUNCA "credencial inválida".
 * - "auth/requires-recent-login" -> aviso amigável para sair e entrar de novo, NUNCA o erro técnico.
 */
export function parseChangePasswordError(error: unknown): ParsedChangePasswordError {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code || "")
      : "";
  const rawMessage =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: string }).message || "")
      : "";

  if (
    code === "auth/wrong-password" ||
    code === "auth/invalid-credential" ||
    code === "auth/invalid-login-credentials" ||
    rawMessage.includes("wrong-password") ||
    rawMessage.includes("invalid-credential") ||
    rawMessage.includes("invalid-login-credentials")
  ) {
    return {
      type: "wrong_password",
      message: "A senha atual não confere.",
    };
  }

  if (
    code === "auth/requires-recent-login" ||
    rawMessage.includes("requires-recent-login") ||
    rawMessage.includes("CREDENTIAL_TOO_OLD_LOGIN_AGAIN")
  ) {
    return {
      type: "requires_recent_login",
      message:
        "Sua sessão expirou para esta operação de segurança. Saia e entre de novo para continuar.",
    };
  }

  if (code === "auth/weak-password" || rawMessage.includes("weak-password")) {
    return {
      type: "weak_password",
      message: "A nova senha deve ter no mínimo 6 caracteres.",
    };
  }

  if (code === "auth/too-many-requests" || rawMessage.includes("too-many-requests")) {
    return {
      type: "too_many_requests",
      message: "Muitas tentativas sem sucesso. Tente novamente em alguns minutos.",
    };
  }

  return {
    type: "unknown",
    message: "Não foi possível alterar sua senha. Tente novamente mais tarde.",
  };
}
