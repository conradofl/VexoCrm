// PR 4a do untangle: GD e jurídico mandam texto pelo cliente único da Evolution
// (sendTextViaEvolutionUrl -> sendTextMessageViaEvolution), não por fetch cru copiado.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendTextViaEvolutionUrl } from "../services/evolution.js";

let chamadas;

beforeEach(() => {
  chamadas = [];
  process.env.ALLOW_LIVE_WHATSAPP = "true";
  vi.stubGlobal("fetch", async (url, init) => {
    chamadas.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ key: { id: "wa-1" } }), { status: 200 });
  });
});

afterEach(() => {
  delete process.env.ALLOW_LIVE_WHATSAPP;
  vi.unstubAllGlobals();
});

describe("sendTextViaEvolutionUrl", () => {
  it("URL só com host: usa a instância informada e põe 55 no número", async () => {
    const r = await sendTextViaEvolutionUrl({ url: "https://evo.exemplo/", apiKey: "k1", instance: "gd-chip", number: "(34) 99109-3607", text: "oi" });
    expect(r).toBe("sent");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe("https://evo.exemplo/message/sendText/gd-chip");
    expect(chamadas[0].body.number).toBe("5534991093607");
    expect(chamadas[0].body.text).toBe("oi");
    expect(chamadas[0].headers.apikey).toBe("k1");
  });

  it("URL completa com /message/sendText/<instância>: a instância da URL vence, como antes", async () => {
    await sendTextViaEvolutionUrl({ url: "https://evo.exemplo/message/sendText/da-url", apiKey: "k1", instance: "ignorada", number: "34991093607", text: "oi" });
    expect(chamadas[0].url).toBe("https://evo.exemplo/message/sendText/da-url");
  });

  it("JID de grupo vai como veio (antes perdia o @g.us e o dossiê não chegava ao grupo)", async () => {
    await sendTextViaEvolutionUrl({ url: "https://evo.exemplo", apiKey: "k1", instance: "gd", number: "120363000000000000@g.us", text: "dossiê" });
    expect(chamadas[0].body.number).toBe("120363000000000000@g.us");
  });

  it("sem URL, chave ou número: not_configured, sem chamar a Evolution", async () => {
    expect(await sendTextViaEvolutionUrl({ url: "", apiKey: "k", instance: "x", number: "1", text: "t" })).toBe("not_configured");
    expect(await sendTextViaEvolutionUrl({ url: "https://e", apiKey: "", instance: "x", number: "1", text: "t" })).toBe("not_configured");
    expect(await sendTextViaEvolutionUrl({ url: "https://e", apiKey: "k", instance: "x", number: "", text: "t" })).toBe("not_configured");
    expect(chamadas).toHaveLength(0);
  });

  it("erro HTTP vira failed_<status>, rede vira failed_network (nunca lança)", async () => {
    vi.stubGlobal("fetch", async () => new Response("ruim", { status: 500 }));
    expect(await sendTextViaEvolutionUrl({ url: "https://e", apiKey: "k", instance: "x", number: "34991093607", text: "t" })).toBe("failed_500");
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNRESET");
    });
    expect(await sendTextViaEvolutionUrl({ url: "https://e", apiKey: "k", instance: "x", number: "34991093607", text: "t" })).toBe("failed_network");
  });

  it("em teste sem ALLOW_LIVE_WHATSAPP não chama a Evolution (guarda do cliente)", async () => {
    delete process.env.ALLOW_LIVE_WHATSAPP;
    expect(await sendTextViaEvolutionUrl({ url: "https://e", apiKey: "k", instance: "x", number: "34991093607", text: "t" })).toBe("sent");
    expect(chamadas).toHaveLength(0);
  });
});

describe("fonte: GD e jurídico", () => {
  const gd = readFileSync(resolve(__dirname, "../domains/geracaoDigitalRoutes.js"), "utf8");
  const juridico = readFileSync(resolve(__dirname, "../domains/geracaoDigitalContracts/juridicoHandlers.js"), "utf8");

  it("não fazem mais POST cru em /message/sendText", () => {
    expect(gd).not.toMatch(/\/message\/sendText\/\$\{instanceName\}/);
    expect(juridico).not.toMatch(/\/message\/sendText\/\$\{/);
  });

  it("busca de chip do briefing não cai em chip de outra empresa", () => {
    const consultas = gd.match(/FROM public\.lead_client_evolution_instances WHERE[^`]*/g) || [];
    const semFiltro = consultas.filter((q) => !/client_id\s*=/.test(q));
    expect(semFiltro).toEqual([]);
  });
});
