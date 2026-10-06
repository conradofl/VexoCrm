import { sanitizePhone } from "@/lib/phone";

/**
 * Classificação de UM telefone para os totais da importação ("já completo", "completado com DDD/DDI", "sem telefone").
 * É a regra que a tela sempre usou em phoneAuditStats (LeadImports.tsx), extraída para ser testada e para ter paridade
 * com o servidor: backend/src/services/leadImportBatches.js (classifyImportedPhone) lê a MESMA fixture,
 * shared/importPhoneAuditCases.json.
 */
export type PhoneAuditKind = "intact" | "completed" | "incomplete";

export interface PhoneAuditResult {
  kind: PhoneAuditKind;
  original: string;
  sanitized: string | null;
  /** Só quando kind === "incomplete". */
  reason?: string;
}

export function classifyPhoneAudit(rawPhone: unknown, defaultDdd: string | null): PhoneAuditResult {
  const rawTrimmed = String(rawPhone ?? "").trim();
  const rawDigits = rawTrimmed.replace(/\D/g, "");
  const cleanDdd = defaultDdd ? defaultDdd.replace(/\D/g, "").slice(0, 2) : null;
  const sanitized = sanitizePhone(rawTrimmed, cleanDdd);

  if (sanitized) {
    const isAlreadyComplete =
      (rawDigits.length === 12 && rawDigits.startsWith("55") && sanitized === rawDigits) ||
      (rawDigits.length === 13 && rawDigits.startsWith("55") && sanitized === rawDigits) ||
      (rawDigits.length >= 10 && rawDigits.length < 15 && !rawDigits.startsWith("55") && sanitized === rawDigits);
    return { kind: isAlreadyComplete ? "intact" : "completed", original: rawTrimmed, sanitized };
  }

  let reason = "Formato inválido";
  if (rawDigits.length === 8 || rawDigits.length === 9) {
    reason = cleanDdd ? "Telefone incompleto" : "Faltou informar o DDD padrão";
  } else if (rawDigits.length >= 15 || rawTrimmed.includes("@g.us")) {
    reason = "Identificador de grupo do WhatsApp bloqueado";
  } else if (!rawDigits) {
    reason = "Sem telefone";
  }
  return { kind: "incomplete", original: rawTrimmed, sanitized: null, reason };
}
