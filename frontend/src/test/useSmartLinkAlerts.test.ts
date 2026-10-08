// frontend/src/test/useSmartLinkAlerts.test.ts
// Testes unitários para o hook de alertas em tempo real useSmartLinkAlerts e formatação de WhatsApp

import { describe, expect, it } from "vitest";
import { formatPhoneForWhatsApp, playSoftChime } from "../hooks/useSmartLinkAlerts";

describe("useSmartLinkAlerts - Helpers e Formatação", () => {
  describe("formatPhoneForWhatsApp", () => {
    it("adiciona DDI 55 para números brasileiros de 10 ou 11 dígitos", () => {
      expect(formatPhoneForWhatsApp("34999998888")).toBe("5534999998888");
      expect(formatPhoneForWhatsApp("(34) 99999-8888")).toBe("5534999998888");
      expect(formatPhoneForWhatsApp("1188887777")).toBe("551188887777");
    });

    it("mantém DDI quando já presente", () => {
      expect(formatPhoneForWhatsApp("5534999998888")).toBe("5534999998888");
      expect(formatPhoneForWhatsApp("+55 34 99999-8888")).toBe("5534999998888");
    });

    it("retorna null para telefones inválidos ou vazios", () => {
      expect(formatPhoneForWhatsApp("")).toBeNull();
      expect(formatPhoneForWhatsApp(null)).toBeNull();
      expect(formatPhoneForWhatsApp(undefined)).toBeNull();
      expect(formatPhoneForWhatsApp("123")).toBeNull();
    });
  });

  describe("playSoftChime", () => {
    it("executa com segurança sem lançar exceções mesmo se AudioContext não estiver disponível", () => {
      expect(() => playSoftChime()).not.toThrow();
    });
  });
});
