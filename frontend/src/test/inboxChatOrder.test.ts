import { describe, expect, it } from "vitest";
import { orderChatsForTab } from "@/lib/inbox/chatOrder";

// Ordem em que o servidor devolve "Esperam você": mais parado primeiro.
// O `timestamp` (última mensagem da conversa) está fora de ordem de propósito.
const fromServer = [
  { id: "parada-3-dias", timestamp: 300 },
  { id: "parada-4h", timestamp: 100 },
  { id: "parada-38min", timestamp: 200 },
];

describe("orderChatsForTab", () => {
  it("mantém a ordem do servidor em 'Esperam você' e 'Esfriaram': mais parado primeiro", () => {
    for (const tab of ["esperam", "esfriaram"]) {
      expect(orderChatsForTab(fromServer, tab).map((c) => c.id)).toEqual([
        "parada-3-dias",
        "parada-4h",
        "parada-38min",
      ]);
    }
  });

  it("nas outras abas, a mensagem mais recente sobe para o topo", () => {
    for (const tab of ["com_lead", "robo", "todas", "grupos", "automacao", "arquivadas"]) {
      expect(orderChatsForTab(fromServer, tab).map((c) => c.id)).toEqual([
        "parada-3-dias",
        "parada-38min",
        "parada-4h",
      ]);
    }
  });

  it("não altera a lista recebida", () => {
    const copy = [...fromServer];
    orderChatsForTab(fromServer, "todas");
    expect(fromServer).toEqual(copy);
  });
});
