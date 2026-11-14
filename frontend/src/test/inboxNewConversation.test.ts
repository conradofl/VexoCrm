import { describe, expect, it } from "vitest";
import { formatPhoneLabel, looksLikePhone, searchLeads } from "@/lib/inbox/newConversation";

const leads = [
  { id: "1", name: "Jéssica Mendonça", phone: "5534990000001" },
  { id: "2", name: "Gabriel Oliveira", phone: "(34) 99221-0017" },
  { id: "3", name: "Sem Telefone", phone: "" },
];

describe("Nova conversa — número digitado", () => {
  it.each(["(34) 99999-0000", "34999990000", "5534999990000", "3432345678", "+55 34 99999-0000"])("aceita %s", (value) => {
    expect(looksLikePhone(value)).toBe(true);
  });

  it.each(["99999-0000", "3499", "maria", "5534@g.us", ""])("recusa %s", (value) => {
    expect(looksLikePhone(value)).toBe(false);
  });

  it("mostra o número de um jeito legível", () => {
    expect(formatPhoneLabel("5534990000001")).toBe("(34) 99000-0001");
    expect(formatPhoneLabel("3432345678")).toBe("(34) 3234-5678");
  });
});

describe("Nova conversa — busca de lead", () => {
  it("acha pelo nome, sem ligar para acento nem maiúscula", () => {
    expect(searchLeads(leads, "jessica").map((l) => l.id)).toEqual(["1"]);
    expect(searchLeads(leads, "OLIV").map((l) => l.id)).toEqual(["2"]);
  });

  it("acha pelo telefone, com ou sem máscara", () => {
    expect(searchLeads(leads, "99221").map((l) => l.id)).toEqual(["2"]);
    expect(searchLeads(leads, "(34) 9900").map((l) => l.id)).toEqual(["1"]);
  });

  it("não sugere nada com pouco texto, e nunca sugere lead sem telefone", () => {
    expect(searchLeads(leads, "j")).toEqual([]);
    expect(searchLeads(leads, "34")).toEqual([]);
    expect(searchLeads(leads, "sem tel")).toEqual([]);
  });
});
