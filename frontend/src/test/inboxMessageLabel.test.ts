import { describe, expect, it } from "vitest";
import { describeMessageLabel, isTypeOnlyLabel } from "@/lib/inbox/messageLabel";

describe("rótulo de mensagem sem texto", () => {
  it("o rótulo antigo [Mensagem] nunca aparece cru", () => {
    expect(describeMessageLabel("[Mensagem]")).toBe("Mensagem sem texto (tipo não registrado)");
    expect(describeMessageLabel("  [mensagem] ")).toBe("Mensagem sem texto (tipo não registrado)");
  });

  it.each([
    ["[sticker]", "Figurinha"],
    ["[Sticker]", "Figurinha"],
    ["[reação]", "Reação"],
    ["[Mensagem sem conteúdo]", "Mensagem sem conteúdo"],
    ["[Tipo não reconhecido: stickerPackMessage]", "Tipo de mensagem não reconhecido (stickerPackMessage)"],
  ])("%s vira %s", (body, expected) => {
    expect(describeMessageLabel(body)).toBe(expected);
    expect(isTypeOnlyLabel(body)).toBe(true);
  });

  it("conteúdo de verdade passa intacto", () => {
    expect(describeMessageLabel("[Localização] Padaria Central · Rua A, 10")).toBe("[Localização] Padaria Central · Rua A, 10");
    expect(describeMessageLabel("Quero o orçamento")).toBe("Quero o orçamento");
    expect(isTypeOnlyLabel("Quero o orçamento")).toBe(false);
    expect(describeMessageLabel(null)).toBe("");
  });
});
