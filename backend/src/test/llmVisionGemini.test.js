// A leitura de imagem do WhatsApp roda no Gemini, pela escada do motor.
//
// Antes: describeImage postava direto na Groq com
// meta-llama/llama-4-scout-17b-16e-instruct como padrao. O modelo morreu e
// GROQ_VISION_MODEL nunca foi setada (medido em 30/10/2026): imagem quebrada
// desde 22/10, sem aviso.
//
// Dubles so no que sai do processo: fetch para os provedores e a gravacao de
// custo no banco.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../services/llmUsage.js", async (importOriginal) => ({
  ...(await importOriginal()),
  gravarUsoLlm: vi.fn(async () => {}),
}));

const { gravarUsoLlm } = await import("../services/llmUsage.js");
const { describeImage, resolveMessageContent, IMAGE_DESCRIPTION_TIMEOUT_MS } = await import("../chatbot-ai-engine.js");

const CHAVES_DE_AMBIENTE = [
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "LLM_MODEL_LADDER",
  "LLM_VISION_MODEL",
  "GROQ_VISION_MODEL",
];
const IMAGEM = Buffer.from("png-falso").toString("base64");

let ambienteSalvo;
let fetchSpy;
let chamadas;

function google(resposta) {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    chamadas.push({ url: String(url), body: JSON.parse(init.body), signal: init.signal });
    return typeof resposta === "function" ? resposta() : resposta;
  });
}
const ok = (content) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 260, completion_tokens: 12, total_tokens: 272 } }),
});

beforeEach(() => {
  ambienteSalvo = Object.fromEntries(CHAVES_DE_AMBIENTE.map((k) => [k, process.env[k]]));
  for (const k of CHAVES_DE_AMBIENTE) delete process.env[k];
  process.env.GROQ_API_KEY = "gsk_chave_de_teste";
  process.env.GEMINI_API_KEY = "gemini_chave_de_teste";
  chamadas = [];
  gravarUsoLlm.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (fetchSpy) fetchSpy.mockRestore();
  fetchSpy = null;
  vi.restoreAllMocks();
  for (const k of CHAVES_DE_AMBIENTE) {
    if (ambienteSalvo[k] === undefined) delete process.env[k];
    else process.env[k] = ambienteSalvo[k];
  }
});

describe("a visao vai para o Gemini", () => {
  it("chama o Google com o apelido padrao e a imagem como data URL", async () => {
    google(ok("Foto de um container de 20 pés"));

    const res = await describeImage(IMAGEM, "image/png", "quanto custa?");

    expect(res).toBe("Foto de um container de 20 pés");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toContain("generativelanguage.googleapis.com");
    expect(chamadas[0].body.model).toBe("gemini-flash-latest");
    const conteudo = chamadas[0].body.messages[0].content;
    expect(conteudo[0].image_url.url).toBe(`data:image/png;base64,${IMAGEM}`);
    expect(conteudo[1].text).toContain("quanto custa?");
  });

  it("nunca vai para a Groq — nem com GROQ_VISION_MODEL setada, que deixou de existir", async () => {
    process.env.GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
    google(ok("descricao"));
    await describeImage(IMAGEM);
    expect(chamadas.some((c) => c.url.includes("api.groq.com"))).toBe(false);
  });

  it("LLM_VISION_MODEL troca o modelo sem deploy", async () => {
    process.env.LLM_VISION_MODEL = "gemini-pro-latest";
    google(ok("descricao"));
    await describeImage(IMAGEM);
    expect(chamadas[0].body.model).toBe("gemini-pro-latest");
  });

  it("usa o timeout proprio da imagem, nao o de 20s da conversa", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    google(ok("descricao"));
    await describeImage(IMAGEM);
    expect(timeoutSpy).toHaveBeenCalledWith(IMAGE_DESCRIPTION_TIMEOUT_MS);
  });
});

describe("falha na leitura nao derruba a mensagem", () => {
  it("503 do Google: devolve null, uma chamada so (a escada de conversa nao le imagem)", async () => {
    google({ ok: false, status: 503, text: async () => "overloaded" });
    await expect(describeImage(IMAGEM)).resolves.toBeNull();
    expect(chamadas).toHaveLength(1);
  });

  it("timeout: devolve null", async () => {
    google(() => Promise.reject(new DOMException("timeout", "TimeoutError")));
    await expect(describeImage(IMAGEM)).resolves.toBeNull();
  });

  it("sem chave do Gemini: devolve null sem chamar ninguem", async () => {
    delete process.env.GEMINI_API_KEY;
    google(ok("nao deveria"));
    await expect(describeImage(IMAGEM)).resolves.toBeNull();
    expect(chamadas).toHaveLength(0);
  });
});

describe("custo da visao e medido", () => {
  it("grava em llm_usage com origem visao e o tenant da mensagem", async () => {
    google(ok("descricao"));
    const payload = {
      data: {
        key: { remoteJid: "5534999991234@s.whatsapp.net", fromMe: false },
        message: { imageMessage: { base64: IMAGEM, mimetype: "image/jpeg", caption: "olha" } },
      },
    };

    const res = await resolveMessageContent(payload, { clientId: "container-led" });

    expect(res.described).toBe(true);
    expect(gravarUsoLlm).toHaveBeenCalledTimes(1);
    expect(gravarUsoLlm.mock.calls[0][0]).toMatchObject({
      clientId: "container-led",
      origem: "visao",
      provider: "gemini",
      model: "gemini-flash-latest",
      totalTokens: 272,
    });
  });
});
