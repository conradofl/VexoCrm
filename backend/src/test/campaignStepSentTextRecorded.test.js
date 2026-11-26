// A conversa grava o texto que SAIU (26/11/2026, Advocacia Almeida). O passo "Link / Página" saía com a URL, mas a
// gravação usava step.text: com legenda, a conversa mostrava só a legenda; sem legenda, o passo nem aparecia (texto
// vazio não é gravado). Parecia que o link não tinha ido. Agora onStepDispatched recebe sentText = texto do payload.
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCampaignSequence } from "../campaign-outbound.js";

const LINK = "https://www.instagram.com/reels/Df4Yt0sFOhx/";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function disparar(sequence) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 201, text: async () => '{"key":{"id":"x"}}' })));
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const gravados = [];
  await dispatchCampaignSequence({
    webhookUrl: "https://evo.teste/message/sendText/chip",
    webhookToken: "t",
    leads: [{ id: "l1", telefone: "5534991093607", nome: "Ana" }],
    analyticsMeta: { sequence, dispatchOptions: { leadDelaySeconds: 0 } },
    context: { campaign: { id: "c" }, client: { id: "t" } },
    onStepDispatched: async ({ step, sentText }) => gravados.push({ stepId: step.id, sentText }),
  });
  return gravados;
}

describe("conversa grava o texto que saiu", () => {
  it("passo de link SEM legenda: sentText é a URL (antes não gravava nada)", async () => {
    const g = await disparar([
      { id: "s1", type: "text", order: 1, enabled: true, triggerMode: "immediate", text: "Oi, tudo bem?" },
      { id: "s2", type: "link", order: 2, enabled: true, triggerMode: "immediate", text: "", linkUrl: LINK },
    ]);
    expect(g.find((x) => x.stepId === "s2").sentText).toBe(LINK);
  });

  it("passo de link COM legenda: sentText tem legenda e URL (antes só a legenda)", async () => {
    const g = await disparar([
      { id: "s2", type: "link", order: 1, enabled: true, triggerMode: "immediate", text: "PROFESSOR DA REDE ESTADUAL", linkUrl: LINK },
    ]);
    const t = g[0].sentText;
    expect(t).toContain("PROFESSOR DA REDE ESTADUAL");
    expect(t).toContain(LINK);
  });

  it("passo de texto com variável: sentText já vem com o nome trocado", async () => {
    const g = await disparar([{ id: "s1", type: "text", order: 1, enabled: true, triggerMode: "immediate", text: "Oi {{nome}}" }]);
    expect(g[0].sentText).toBe("Oi Ana");
  });
});
