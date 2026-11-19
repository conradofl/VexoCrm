// Token do webhook da Evolution por cabeçalho, transição com token antigo e novo, reaplicação dos webhooks e máscara de
// segredos no log (18/11/2026: o token ia fixo na URL, no código público, sem ninguém conferir; token e apikey vazaram
// em log colado em chat).
import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { format } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CABECALHO_TOKEN_WEBHOOK,
  exigirTokenDoWebhook,
  verificarTokenDoWebhook,
  _resetWebhookAuthLogForTest,
} from "../services/webhookAuth.js";
import { instalarMascaraDeLog, mascararSegredos } from "../services/logRedaction.js";
import { configureEvolutionInstanceWebhook } from "../services/evolution.js";
import { reaplicarWebhooks } from "../services/webhookReapply.js";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";

const NOVO = "novo-token-de-teste-0123456789abcdef";
const ANTIGO = "antigo-token-de-teste-fedcba9876543210";
const ERRADO = "token-errado-de-teste-5555555555555555";
const APIKEY = "APIKEY0TESTE0GLOBAL0000000000001";
const TOKEN_INSTANCIA = "vexo_tokendainstanciadeteste0001";
const SEGREDOS = [NOVO, ANTIGO, ERRADO, APIKEY, TOKEN_INSTANCIA];

const pedido = ({ cabecalho = null, url = null, auth = null, instancia = "tinge-brasil-comercial" } = {}) => ({
  headers: {
    ...(cabecalho ? { [CABECALHO_TOKEN_WEBHOOK]: cabecalho } : {}),
    ...(auth ? { authorization: `Bearer ${auth}` } : {}),
  },
  query: { ...(url ? { token: url } : {}), instanceName: instancia, clientId: "tinge-brasil" },
  body: { instance: instancia },
  ip: "203.0.113.9",
});

// Tudo que o processo escreveria no log durante o teste.
function capturarConsole() {
  const linhas = [];
  for (const m of ["log", "info", "warn", "error", "debug"]) {
    vi.spyOn(console, m).mockImplementation((...a) => {
      linhas.push(format(...a));
    });
  }
  return linhas;
}
const semSegredo = (linhas) => {
  const texto = linhas.join("\n");
  for (const s of SEGREDOS) expect(texto, `vazou segredo de ${s.length} caracteres`).not.toContain(s);
};

beforeEach(() => {
  _resetWebhookAuthLogForTest();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verificarTokenDoWebhook: quem passa em cada fase", () => {
  it("sem variável nenhuma: aberto, como antes (o deploy não derruba entrega)", () => {
    expect(verificarTokenDoWebhook(pedido(), {})).toEqual({ ok: true, via: "aberto" });
    expect(verificarTokenDoWebhook(pedido({ url: ERRADO }), {})).toEqual({ ok: true, via: "aberto" });
  });

  const transicao = { EVOLUTION_WEBHOOK_TOKEN: NOVO, EVOLUTION_WEBHOOK_TOKEN_ANTERIOR: ANTIGO };
  it.each([
    ["cabeçalho com o novo", { cabecalho: NOVO }, { ok: true, via: "cabecalho" }],
    ["cabeçalho com o antigo", { cabecalho: ANTIGO }, { ok: true, via: "cabecalho" }],
    ["URL com o antigo (instância ainda não reaplicada)", { url: ANTIGO }, { ok: true, via: "url" }],
    ["URL com o novo", { url: NOVO }, { ok: true, via: "url" }],
    ["URL com token errado", { url: ERRADO }, { ok: false, motivo: "url_invalido" }],
    ["cabeçalho errado, mesmo com URL certa", { cabecalho: ERRADO, url: ANTIGO }, { ok: false, motivo: "cabecalho_invalido" }],
    ["sem token", {}, { ok: false, motivo: "sem_token" }],
    ["Authorization Bearer (token do Firebase) não conta", { auth: NOVO }, { ok: false, motivo: "sem_token" }],
  ])("transição (novo + anterior): %s", (_nome, p, esperado) => {
    expect(verificarTokenDoWebhook(pedido(p), transicao)).toEqual(esperado);
  });

  const final = { EVOLUTION_WEBHOOK_TOKEN: NOVO };
  it.each([
    ["cabeçalho com o novo", { cabecalho: NOVO }, { ok: true, via: "cabecalho" }],
    ["cabeçalho com o antigo (variável apagada)", { cabecalho: ANTIGO }, { ok: false, motivo: "cabecalho_invalido" }],
    ["URL com o novo: URL encerrada", { url: NOVO }, { ok: false, motivo: "token_na_url_encerrado" }],
    ["URL com o antigo", { url: ANTIGO }, { ok: false, motivo: "token_na_url_encerrado" }],
    ["sem token", {}, { ok: false, motivo: "sem_token" }],
  ])("depois da troca (só o novo): %s", (_nome, p, esperado) => {
    expect(verificarTokenDoWebhook(pedido(p), final)).toEqual(esperado);
  });
});

describe("rota POST /api/hardcoded-chat-webhook", () => {
  function rotaDoWebhook() {
    const rotas = {};
    const reg = (metodo) => (caminho, ...handlers) => {
      rotas[`${metodo} ${caminho}`] = handlers;
    };
    const app = { post: reg("POST"), get: reg("GET"), delete: reg("DELETE"), put: reg("PUT"), patch: reg("PATCH") };
    registerChatbotRoutes(app, {
      ensureDb: () => true,
      getLeadClientEvolutionInstances: async () => [],
      getLeadClientN8nSettings: async () => null,
      internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false,
      leadsTableName: () => "leads",
      maskPhoneForLog: (p) => p,
      MAX_LEADS_OUTLIER_BATCH: 100,
      continueCampaignLeadFromReply: async () => ({}),
      findCampaignReplyMatches: async () => [],
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeTenantKey: (k) => (k ? String(k).trim() : ""),
      pgDatabasePool: null,
      requireAppViewAccess: () => (_q, _s, n) => n(),
      requireFirebaseAuth: (_q, _s, n) => n(),
      resolveAuthorizedClientId: (_q, _s, c) => c,
      resolveDispatchWebhookSettings: async () => ({}),
      resolveInboundDispatchSettings: async () => ({}),
      sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
      sendError: vi.fn(),
      supabase: null,
      validateLeadsOutlierRecord: () => true,
      validateN8nInboundBearer: () => true,
    });
    return rotas["POST /api/hardcoded-chat-webhook"];
  }
  const resposta = () => ({ status: vi.fn(function () { return this; }), json: vi.fn() });

  it("o token é conferido ANTES do handler", () => {
    const handlers = rotaDoWebhook();
    expect(handlers).toHaveLength(2);
    expect(handlers[0]).toBe(exigirTokenDoWebhook);
  });

  it("token errado: 401, handler não roda, e o log não mostra token nenhum", () => {
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", NOVO);
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN_ANTERIOR", ANTIGO);
    const linhas = capturarConsole();
    const [middleware] = rotaDoWebhook();
    const res = resposta();
    const next = vi.fn();
    middleware(pedido({ cabecalho: ERRADO, url: ANTIGO }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: "WEBHOOK_TOKEN_INVALIDO" });
    expect(linhas.join("\n")).toContain("cabecalho_invalido");
    semSegredo(linhas);
  });

  it("transição: URL antiga passa, avisa qual instância falta reaplicar, sem mostrar o token", () => {
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", NOVO);
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN_ANTERIOR", ANTIGO);
    const linhas = capturarConsole();
    const next = vi.fn();
    exigirTokenDoWebhook(pedido({ url: ANTIGO }), resposta(), next);
    exigirTokenDoWebhook(pedido({ cabecalho: NOVO }), resposta(), next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(linhas.join("\n")).toMatch(/aceito pela URL.*tinge-brasil-comercial/);
    semSegredo(linhas);
  });

  it("recusas em rajada: uma linha por minuto, não uma por pedido", () => {
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", NOVO);
    const linhas = capturarConsole();
    for (let k = 0; k < 50; k += 1) exigirTokenDoWebhook(pedido({ url: ERRADO }), resposta(), vi.fn());
    expect(linhas.filter((l) => l.includes("recusado"))).toHaveLength(1);
  });
});

describe("configureEvolutionInstanceWebhook: o que vai para a Evolution", () => {
  function evolutionFalsa({ status = 200, eco = false } = {}) {
    const chamadas = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      chamadas.push({ url, init, corpo: init?.body ? JSON.parse(init.body) : null });
      const texto = eco ? `{"message":"bad request","echo":${init.body},"headers":{"apikey":"${init.headers.apikey}"}}` : "{}";
      return { ok: status < 400, status, text: async () => texto };
    }));
    return chamadas;
  }
  const URL_DISPARO = "https://evo.teste/message/sendText/tinge-brasil-comercial";

  it("com token: URL sem token e o token no cabeçalho", async () => {
    vi.stubEnv("WEBHOOK_BASE_URL", "https://api.vexo.teste");
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", NOVO);
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN_ANTERIOR", ANTIGO);
    const chamadas = evolutionFalsa();
    await configureEvolutionInstanceWebhook("tinge-brasil", URL_DISPARO, TOKEN_INSTANCIA, true);
    const w = chamadas[0].corpo.webhook;
    expect(chamadas[0].url).toBe("https://evo.teste/webhook/set/tinge-brasil-comercial");
    const u = new URL(w.url);
    expect(u.pathname).toBe("/api/hardcoded-chat-webhook");
    expect(u.searchParams.has("token")).toBe(false);
    expect(u.searchParams.get("instanceName")).toBe("tinge-brasil-comercial");
    expect(w.headers).toEqual({ [CABECALHO_TOKEN_WEBHOOK]: NOVO });
    expect(w.events).toEqual(["MESSAGES_UPSERT", "SEND_MESSAGE"]);
  });

  it("sem token no ambiente (webhook aberto): nem token na URL nem cabeçalho", async () => {
    vi.stubEnv("WEBHOOK_BASE_URL", "https://api.vexo.teste");
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", "");
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN_ANTERIOR", "");
    const chamadas = evolutionFalsa();
    await configureEvolutionInstanceWebhook("tinge-brasil", URL_DISPARO, TOKEN_INSTANCIA, true);
    const w = chamadas[0].corpo.webhook;
    expect(new URL(w.url).searchParams.has("token")).toBe(false);
    expect(w.headers).toBeUndefined();
  });

  it("erro da Evolution que ecoa o pedido: a mensagem (log e tela do chip) sai sem token e sem apikey", async () => {
    vi.stubEnv("WEBHOOK_BASE_URL", "https://api.vexo.teste");
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", NOVO);
    evolutionFalsa({ status: 400, eco: true });
    const erro = await configureEvolutionInstanceWebhook("tinge-brasil", URL_DISPARO, TOKEN_INSTANCIA, true).catch((e) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toContain("HTTP 400");
    for (const s of [NOVO, TOKEN_INSTANCIA]) expect(erro.message).not.toContain(s);
  });
});

describe("máscara de segredos no log", () => {
  const env = { EVOLUTION_API_KEY: APIKEY, EVOLUTION_WEBHOOK_TOKEN: NOVO, EVOLUTION_WEBHOOK_TOKEN_ANTERIOR: ANTIGO };

  it("console embrulhado: nenhuma forma de escrever o segredo passa", () => {
    const saida = [];
    const alvo = {};
    for (const m of ["log", "info", "warn", "error", "debug"]) alvo[m] = (...a) => saida.push(format(...a));
    const desfazer = instalarMascaraDeLog({ alvo, env });
    alvo.log("webhook", `https://api.vexo.teste/api/hardcoded-chat-webhook?token=${ANTIGO}&clientId=tinge`);
    alvo.info({ headers: { apikey: APIKEY, [CABECALHO_TOKEN_WEBHOOK]: NOVO } });
    alvo.warn(JSON.stringify({ event: "messages.upsert", apikey: TOKEN_INSTANCIA, server_url: "https://evo.teste" }));
    alvo.error("falhou %s", `Authorization: Bearer ${NOVO}`);
    alvo.debug(new Error(`Evolution respondeu 401 para apikey=${APIKEY}`));
    alvo.log("texto solto com o segredo no meio:", APIKEY, "e", ANTIGO);
    desfazer();
    expect(saida).toHaveLength(6);
    semSegredo(saida);
    expect(saida[0]).toContain("?token=***&clientId=tinge");
  });

  it("não estraga linha comum", () => {
    const linha = format("[chatbot-webhook] entrada", { evento: "messages.upsert", total_tokens: 123, hasEvolutionApiKey: true, motivo: "authorization failed" });
    expect(mascararSegredos(linha, { env })).toBe(linha);
  });

  it("embrulho mantém a mesma formatação do console (util.format)", () => {
    const saida = [];
    const alvo = { log: (...a) => saida.push(a) };
    const desfazer = instalarMascaraDeLog({ alvo, env });
    alvo.log("a %s %d", "b", 7, { x: 1 });
    desfazer();
    expect(saida[0]).toEqual([format("a %s %d", "b", 7, { x: 1 })]);
  });

  it("segredo curto do ambiente (menos de 8) não vira máscara de texto comum", () => {
    expect(mascararSegredos("status open", { env: { EVOLUTION_WEBHOOK_TOKEN: "open" } })).toBe("status open");
  });
});

describe("reaplicarWebhooks (script de troca)", () => {
  const BASE = "https://evo.teste";
  function cenario({ ignoraCabecalho = false } = {}) {
    const estado = {
      "tinge-brasil-comercial": { enabled: true, url: `https://api.vexo.teste/api/hardcoded-chat-webhook?token=${ANTIGO}&clientId=tinge-brasil&instanceName=tinge-brasil-comercial`, events: ["MESSAGES_UPSERT"] },
      "container-led-chip": { enabled: true, url: "https://api.vexo.teste/api/hardcoded-chat-webhook?clientId=container-led&instanceName=container-led-chip", headers: { [CABECALHO_TOKEN_WEBHOOK]: NOVO } },
      "nous-desligado": { enabled: false, url: "https://api.vexo.teste/api/hardcoded-chat-webhook?token=x" },
      "fora-do-banco": { enabled: true, url: `https://api.vexo.teste/api/hardcoded-chat-webhook?token=${ANTIGO}` },
    };
    const sets = [];
    const fetchFalso = vi.fn(async (url, init = {}) => {
      const u = new URL(url);
      const nome = decodeURIComponent(u.pathname.split("/").pop());
      if (u.pathname === "/instance/fetchInstances") return { ok: true, status: 200, text: async () => JSON.stringify(Object.keys(estado).map((name) => ({ name }))) };
      if (u.pathname.startsWith("/webhook/find/")) return { ok: true, status: 200, text: async () => JSON.stringify(estado[nome] || null) };
      if (u.pathname.startsWith("/webhook/set/")) {
        const w = JSON.parse(init.body).webhook;
        sets.push(nome);
        estado[nome] = { ...w, ...(ignoraCabecalho ? { headers: undefined } : {}) };
        return { ok: true, status: 201, text: async () => "{}" };
      }
      return { ok: false, status: 404, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchFalso);
    vi.stubEnv("EVOLUTION_API_URL", BASE);
    vi.stubEnv("EVOLUTION_API_KEY", APIKEY);
    vi.stubEnv("WEBHOOK_BASE_URL", "https://api.vexo.teste");
    const pool = {
      query: async () => ({
        rows: [
          { client_id: "container-led", name: "Chip", dispatch_webhook_url: `${BASE}/message/sendText/container-led-chip`, dispatch_webhook_token: TOKEN_INSTANCIA, webhook_enabled: true, active: true },
          { client_id: "nous", name: "Nous", dispatch_webhook_url: `${BASE}/message/sendText/nous-desligado`, dispatch_webhook_token: null, webhook_enabled: false, active: true },
          { client_id: "tinge-brasil", name: "Comercial", dispatch_webhook_url: `${BASE}/message/sendText/tinge-brasil-comercial`, dispatch_webhook_token: TOKEN_INSTANCIA, webhook_enabled: true, active: true },
        ],
      }),
    };
    return { estado, sets, fetchFalso, pool };
  }

  it("dry-run: lista o que mudaria e não chama /webhook/set", async () => {
    const { sets, pool, fetchFalso } = cenario();
    const linhas = [];
    const r = await reaplicarWebhooks({ pool, fetchImpl: fetchFalso, env: {}, log: (l) => linhas.push(l) });
    expect(sets).toEqual([]);
    expect(r).toMatchObject({ total: 3, mudariam: 1, aplicadas: 0, falhas: 0, puladas: 1, foraDoBanco: ["fora-do-banco"] });
    const texto = linhas.join("\n");
    expect(texto).toMatch(/tinge-brasil-comercial \| tinge-brasil \| MUDARIA \| hoje: ligado .* params: token,clientId,instanceName/);
    expect(texto).toMatch(/container-led-chip .* já está certo/);
    expect(texto).toMatch(/nous-desligado .* webhook desligado no Vexo: não mexe/);
    semSegredo(linhas);
  });

  it("aplicar sem EVOLUTION_WEBHOOK_TOKEN: aborta sem tocar em nada", async () => {
    const { sets, pool, fetchFalso } = cenario();
    const linhas = [];
    const r = await reaplicarWebhooks({ pool, fetchImpl: fetchFalso, env: {}, aplicar: true, log: (l) => linhas.push(l) });
    expect(sets).toEqual([]);
    expect(r.falhas).toBe(1);
    expect(linhas[0]).toMatch(/ABORTADO/);
  });

  it("aplicar: só a instância que precisa, e confere lendo de volta", async () => {
    const { sets, estado, pool, fetchFalso } = cenario();
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", NOVO);
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN_ANTERIOR", ANTIGO);
    const linhas = [];
    const r = await reaplicarWebhooks({ pool, fetchImpl: fetchFalso, env: process.env, aplicar: true, log: (l) => linhas.push(l) });
    expect(sets).toEqual(["tinge-brasil-comercial"]);
    expect(r).toMatchObject({ aplicadas: 1, conferidas: 1, falhas: 0 });
    expect(new URL(estado["tinge-brasil-comercial"].url).searchParams.has("token")).toBe(false);
    expect(estado["tinge-brasil-comercial"].headers).toEqual({ [CABECALHO_TOKEN_WEBHOOK]: NOVO });
    expect(estado["fora-do-banco"].url).toContain("token="); // fora do banco: só listada, nunca mexida
    semSegredo(linhas);
  });

  it("canário: --instancia limita a uma só", async () => {
    const { sets, pool, fetchFalso } = cenario();
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", NOVO);
    const r = await reaplicarWebhooks({ pool, fetchImpl: fetchFalso, env: process.env, aplicar: true, instancia: "tinge-brasil-comercial", log: () => {} });
    expect(sets).toEqual(["tinge-brasil-comercial"]);
    expect(r.total).toBe(1);
  });

  it("Evolution que aceita o set mas descarta o cabeçalho: FALHOU NA CONFERÊNCIA (não dá para tirar o antigo)", async () => {
    const { pool, fetchFalso } = cenario({ ignoraCabecalho: true });
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", NOVO);
    const linhas = [];
    const r = await reaplicarWebhooks({ pool, fetchImpl: fetchFalso, env: process.env, aplicar: true, log: (l) => linhas.push(l) });
    expect(r.falhas).toBe(1);
    expect(r.conferidas).toBe(0);
    expect(linhas.join("\n")).toMatch(/tinge-brasil-comercial .* FALHOU NA CONFERÊNCIA/);
  });
});

describe("guarda: segredo fixo não volta para o código", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
  function arquivos(dir) {
    const out = [];
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (n === "test" || n === "node_modules") continue;
      if (statSync(p).isDirectory()) out.push(...arquivos(p));
      else if (/\.(m?js|cjs)$/.test(n)) out.push(p);
    }
    return out;
  }
  it("nenhuma chave de 32 hex nem ?token=<valor> escrita em backend/src", () => {
    const achados = [];
    for (const f of arquivos(SRC)) {
      const t = readFileSync(f, "utf8");
      if (/["'`][0-9A-F]{32}["'`]/.test(t)) achados.push(`${f}: chave de 32 hex`);
      if (/[?&]token=[A-Za-z0-9_]/.test(t)) achados.push(`${f}: token fixo na URL`);
    }
    expect(achados).toEqual([]);
  });

  // Repasse interno (fetch para o próprio webhook) sem o cabeçalho vira 401 depois da troca e a mensagem some calada.
  it("todo fetch interno para /api/hardcoded-chat-webhook manda o cabeçalho do token", () => {
    const semCabecalho = [];
    let total = 0;
    for (const f of arquivos(SRC)) {
      const linhas = readFileSync(f, "utf8").split("\n");
      linhas.forEach((l, i) => {
        if (!/fetch\(\s*["'`][^"'`]*\/api\/hardcoded-chat-webhook/.test(l)) return;
        total += 1;
        const bloco = linhas.slice(i, i + 4).join("\n");
        if (!bloco.includes("cabecalhoDoWebhook()")) semCabecalho.push(`${f}:${i + 1}`);
      });
    }
    expect(total).toBeGreaterThan(0);
    expect(semCabecalho).toEqual([]);
  });
});
