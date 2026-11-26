// Passo "Link / Página" (26/11/2026, Advocacia Almeida: "não está enviando o link"). O payload sai certo (legenda + URL,
// prévia ligada); a prévia é montada pela Evolution buscando a página, e quando ela RECUSA o envio por causa disso o passo
// inteiro se perdia. Agora: recusa com resposta HTTP -> reenvia UMA vez sem prévia. Timeout/desconectado/token: não.
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCampaignSequence, getRecentOutboundFailures, _resetOutboundFailuresForTesting } from "../campaign-outbound.js";

const LINK = "https://www.instagram.com/reels/Df4Yt0sFOhx/";
const seq = [
  { id: "s1", type: "text", order: 1, enabled: true, triggerMode: "immediate", text: "Olá, tudo bem?" },
  { id: "s2", type: "link", order: 2, enabled: true, triggerMode: "immediate", linkUrl: LINK, text: "PROFESSOR DA REDE ESTADUAL" },
];
const disparar = () =>
  dispatchCampaignSequence({
    webhookUrl: "https://evo.teste/message/sendText/chip",
    webhookToken: "t",
    leads: [{ id: "l1", telefone: "5534991093607", nome: "Ana" }],
    analyticsMeta: { sequence: seq, dispatchOptions: { leadDelaySeconds: 0 } },
    context: { campaign: { id: "c" }, client: { id: "t" } },
  });
const ok = () => ({ ok: true, status: 201, text: async () => '{"key":{"id":"x"}}' });
const erro = (status, corpo) => ({ ok: false, status, text: async () => corpo });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetOutboundFailuresForTesting();
});

function instalar(responder) {
  const chamadas = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    chamadas.push(body);
    return responder(body);
  }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  return chamadas;
}

describe("[OBRIGATÓRIO] passo de link: a prévia que falha não leva o passo junto", () => {
  it("a Evolution recusa com prévia (HTTP 400) -> reenvia sem prévia e o link CHEGA (legenda + URL)", async () => {
    const chamadas = instalar((b) => (b.linkPreview ? erro(400, '{"error":"Bad Request","message":"link preview 5534991093607 failed"}') : ok()));
    const r = await disparar();
    expect(r.summary).toMatchObject({ successCount: 1, failureCount: 0 });
    const doLink = chamadas.filter((c) => c.stepId === "s2");
    expect(doLink).toHaveLength(2);
    expect(doLink[0].linkPreview).toBe(true);
    expect(doLink[1]).toMatchObject({ linkPreview: false, generateHighQualityLinkPreview: false });
    expect(doLink[1].text).toContain(LINK);
    expect(doLink[1].text).toContain("PROFESSOR DA REDE ESTADUAL");
    const f = getRecentOutboundFailures();
    expect(f[0]).toMatchObject({ tipoPasso: "link", comPrevia: true, status: 400 });
    expect(JSON.stringify(f)).not.toMatch(/\d{8,}/); // sem telefone no /health
  });

  it("chip desconectado ou token inválido: NÃO reenvia (não é a prévia)", async () => {
    const chamadas = instalar((b) => (b.stepId === "s2" ? erro(401, "Unauthorized") : ok()));
    await disparar();
    expect(chamadas.filter((c) => c.stepId === "s2")).toHaveLength(1);
  });

  it("passo de texto SEM link nunca é reenviado (a regra é só da prévia)", async () => {
    const chamadas = instalar((b) => (b.stepId === "s1" ? erro(500, "erro") : ok()));
    await disparar();
    expect(chamadas.filter((c) => c.stepId === "s1")).toHaveLength(1);
  });

  it("sem erro: o passo de link sai uma vez, com prévia, legenda e URL", async () => {
    const chamadas = instalar(() => ok());
    await disparar();
    const doLink = chamadas.filter((c) => c.stepId === "s2");
    expect(doLink).toHaveLength(1);
    expect(doLink[0]).toMatchObject({ linkPreview: true, text: `PROFESSOR DA REDE ESTADUAL\n\n${LINK}` });
  });
});
