// Antibloqueio (27/11/2026): sem consulta de existência ao WhatsApp; limpeza sem consulta, freio por lote e chip
// restrito parando na hora. Valores em campaign/antiBloqueio.js.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  ANTIBLOQUEIO,
  avaliarFreio,
  carregarInexistentesConhecidos,
  classificarFalhaDeEnvio,
  limparLeadsDoLote,
  limparTelefone,
} from "../campaign/antiBloqueio.js";
import { dispatchCampaignSequence } from "../campaign-outbound.js";

const ok = "ok";
const inex = "inexistente";
const falha = "falha";
const repetir = (v, n) => Array.from({ length: n }, () => v);

describe("[OBRIGATÓRIO] freio por lote", () => {
  it("25% de inexistente na janela de 20 (5 de 20) pausa", () => {
    const r = [inex, ok, ok, ok, inex, ok, ok, ok, inex, ok, ok, ok, inex, ok, ok, ok, inex, ok, ok, ok];
    expect(r).toHaveLength(20);
    expect(avaliarFreio(r)).toMatchObject({ tipo: "inexistentes" });
    expect(avaliarFreio(r).motivo).toContain("5 dos últimos 20");
    expect(avaliarFreio(r).motivo).toContain("25%");
  });

  it("24% de inexistente NÃO pausa (6 de 25, com janela de 25)", () => {
    const cfg = { ...ANTIBLOQUEIO.freio, janela: 25 };
    const r = [];
    for (let i = 0; i < 25; i += 1) r.push(i % 4 === 1 && r.filter((x) => x === inex).length < 6 ? inex : ok);
    expect(r.filter((x) => x === inex)).toHaveLength(6);
    expect(avaliarFreio(r, cfg)).toBeNull();
    // um a mais (7 de 25 = 28%) pausa
    r[24] = inex;
    expect(avaliarFreio(r, cfg)).toMatchObject({ tipo: "inexistentes" });
  });

  it("4 de 20 (20%) não pausa com a configuração padrão", () => {
    const r = [inex, ok, ok, ok, ok, inex, ok, ok, ok, ok, inex, ok, ok, ok, ok, inex, ok, ok, ok, ok];
    expect(avaliarFreio(r)).toBeNull();
  });

  it("a janela é dos ÚLTIMOS 20: inexistentes antigos saem da conta", () => {
    const r = [...repetir(inex, 4), ...repetir(ok, 20)];
    expect(avaliarFreio(r)).toBeNull();
  });

  it("abaixo da amostra mínima a taxa não vale (3 de 4 não pausa por taxa)", () => {
    expect(avaliarFreio([inex, ok, inex, inex])).toBeNull();
  });

  it("5 falhas seguidas pausam; 4 não", () => {
    expect(avaliarFreio([...repetir(ok, 10), ...repetir(falha, 4)])).toBeNull();
    const freio = avaliarFreio([...repetir(ok, 10), ...repetir(falha, 5)]);
    expect(freio).toMatchObject({ tipo: "falhas_seguidas" });
    expect(freio.motivo).toContain("5 envios seguidos falharam");
  });

  it("falhas seguidas contam inexistente e falha comum juntas; um sucesso zera", () => {
    expect(avaliarFreio([falha, inex, falha, inex, falha])).toMatchObject({ tipo: "falhas_seguidas" });
    expect(avaliarFreio([falha, inex, falha, inex, ok])).toBeNull();
  });
});

describe("[OBRIGATÓRIO] limpeza sem consulta", () => {
  it.each([
    ["5534991093607", true],
    ["34991093607", true],
    ["(34) 99109-3607", true],
    ["3491093607", true], // celular antigo, sem o 9
    ["5534991093607 ", true],
  ])("aceita celular %s", (tel, okEsperado) => {
    expect(limparTelefone(tel).ok).toBe(okEsperado);
  });

  it.each([
    ["", "sem_telefone"],
    [null, "sem_telefone"],
    ["5500912345678", "inventado_5500"],
    ["550012345678", "inventado_5500"],
    ["553432101234", "fixo"],
    ["3432101234", "fixo"],
    ["5520991093607", "ddd_inexistente"],
    ["10991093607", "ddd_inexistente"],
    ["34891093607", "formato_invalido"], // 11 dígitos sem o 9 na frente
    ["991093607", "formato_invalido"], // sem DDD
    ["5534991093607999", "formato_invalido"],
    ["3401093607", "formato_invalido"],
  ])("tira %s (%s)", (tel, motivo) => {
    expect(limparTelefone(tel)).toEqual({ ok: false, motivo });
  });

  it("tira repetido (com e sem 55) e número que já deu inexistente; mantém a ordem", () => {
    const leads = [
      { id: 1, telefone: "5534991093607" },
      { id: 2, telefone: "34991093607" }, // mesmo número
      { id: 3, telefone: "5534991110000" }, // já deu inexistente
      { id: 4, telefone: "553432101234" }, // fixo
      { id: 5, telefone: "5511987654321" },
    ];
    const { aptos, descartados } = limparLeadsDoLote(leads, { inexistentes: new Set(["34991110000"]) });
    expect(aptos.map((l) => l.id)).toEqual([1, 5]);
    expect(descartados.map((d) => [d.lead.id, d.motivo])).toEqual([
      [2, "repetido"],
      [3, "inexistente_conhecido"],
      [4, "fixo"],
    ]);
    expect(descartados[2].texto).toBe("Limpeza antes do envio: telefone fixo");
  });

  it("inexistentes conhecidos vêm do nosso banco (com e sem 55), sem consultar o WhatsApp", async () => {
    const query = vi.fn(async () => ({ rows: [{ phone: "5534991110000" }] }));
    const r = await carregarInexistentesConhecidos({ query }, ["34991110000", "5511987654321"]);
    expect([...r]).toEqual(["34991110000"]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("whatsapp_number_validations");
    expect(sql).toContain("exists_whatsapp = false");
    expect(sql).not.toContain("validated_at"); // para sempre (inexistenteValidadeDias: null)
    expect(ANTIBLOQUEIO.limpeza.inexistenteValidadeDias).toBeNull();
    expect(params[0]).toEqual(expect.arrayContaining(["34991110000", "5534991110000", "11987654321", "5511987654321"]));
  });

  it("erro de leitura não derruba o lote: segue só pelo formato", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await carregarInexistentesConhecidos({ query: async () => { throw new Error("boom"); } }, ["34991110000"]);
    expect(r.size).toBe(0);
  });
});

describe("classificação da falha de envio", () => {
  it("401/403 e conta restrita = chip restrito", () => {
    expect(classificarFalhaDeEnvio({ statusCode: 401, message: "x" })).toBe("chip_restrito");
    expect(classificarFalhaDeEnvio({ statusCode: 403, message: "x" })).toBe("chip_restrito");
    expect(classificarFalhaDeEnvio({ statusCode: 500, message: "account is restricted" })).toBe("chip_restrito");
  });
  it("400 com exists:false = inexistente", () => {
    expect(classificarFalhaDeEnvio({ statusCode: 400, message: 'HTTP 400: {"response":{"message":[{"exists":false,"number":"1"}]}}' })).toBe("inexistente");
  });
  it("guarda de saída e erro comum = outra", () => {
    expect(classificarFalhaDeEnvio({ code: "OUTBOUND_GUARD_BLOCKED", statusCode: 403, message: "x" })).toBe("outra");
    expect(classificarFalhaDeEnvio({ statusCode: 500, message: "erro interno" })).toBe("outra");
  });
});

describe("[OBRIGATÓRIO] freio e chip restrito no motor de envio (dispatchCampaignSequence)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const seq = [{ id: "s1", type: "text", order: 1, enabled: true, triggerMode: "immediate", text: "Olá" }];
  const lead = (i) => ({ id: `l${i}`, telefone: `55349910${String(10000 + i).slice(-5)}`, nome: "Ana" });
  const resposta = (status, corpo) => ({ ok: status < 400, status, text: async () => corpo });
  const EXISTS_FALSE = '{"status":400,"response":{"message":[{"exists":false,"number":"x"}]}}';

  function instalar(responder) {
    const chamadas = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      chamadas.push(body);
      return responder(body, chamadas.length);
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    return chamadas;
  }

  const disparar = (leads, extra = {}) =>
    dispatchCampaignSequence({
      webhookUrl: "https://evo.teste/message/sendText/chip",
      webhookToken: "t",
      leads,
      analyticsMeta: { sequence: seq, dispatchOptions: { leadDelaySeconds: 0 } },
      context: { campaign: { id: "c", name: "Natal" }, client: { id: "t", name: "Tinge" } },
      optOutPool: null,
      ...extra,
    });

  it("5 envios seguidos falhando: pausa antes do 6º, com motivo e aviso no WhatsApp", async () => {
    const chamadas = instalar(() => resposta(500, "erro interno"));
    const avisarFreio = vi.fn(async () => true);
    const onLeadFailed = vi.fn();
    const r = await disparar(Array.from({ length: 10 }, (_, i) => lead(i)), { avisarFreio, onLeadFailed });
    expect(chamadas).toHaveLength(5);
    expect(r.summary.paused).toBe(true);
    expect(r.summary.freio).toMatchObject({ tipo: "falhas_seguidas" });
    expect(onLeadFailed).toHaveBeenCalledTimes(5);
    expect(avisarFreio).toHaveBeenCalledTimes(1);
    expect(avisarFreio.mock.calls[0][0]).toMatchObject({ campanha: "Natal", empresa: "Tinge" });
    expect(avisarFreio.mock.calls[0][0].motivo).toContain("5 envios seguidos falharam");
  });

  it("25% de inexistente nos 20 primeiros pausa; inexistente é gravado com o texto certo", async () => {
    // um inexistente a cada 4 leads: 5 de 20 = 25% no 20º lead
    const chamadas = instalar((_b, n) => (n % 4 === 1 ? resposta(400, EXISTS_FALSE) : resposta(201, '{"key":{"id":"x"}}')));
    const avisarFreio = vi.fn(async () => true);
    const onLeadFailed = vi.fn();
    const r = await disparar(Array.from({ length: 40 }, (_, i) => lead(i)), { avisarFreio, onLeadFailed });
    expect(chamadas).toHaveLength(20);
    expect(r.summary.freio).toMatchObject({ tipo: "inexistentes" });
    expect(onLeadFailed.mock.calls[0][0].reason).toBe("Número não existe no WhatsApp (recusado no envio)");
    expect(avisarFreio).toHaveBeenCalledTimes(1);
  });

  it("chip restrito (403): para no PRIMEIRO envio, sem nova tentativa, e devolve o lead à fila", async () => {
    const chamadas = instalar(() => resposta(403, "Forbidden"));
    const avisarFreio = vi.fn(async () => true);
    const onLeadClaimRollback = vi.fn();
    const onLeadFailed = vi.fn();
    const r = await disparar(Array.from({ length: 10 }, (_, i) => lead(i)), { avisarFreio, onLeadClaimRollback, onLeadFailed });
    expect(chamadas).toHaveLength(1);
    expect(r.summary).toMatchObject({ paused: true, chipRestrito: true });
    expect(r.summary.freio.tipo).toBe("chip_restrito");
    expect(r.summary.freio.motivo).toContain("HTTP 403");
    expect(onLeadClaimRollback).toHaveBeenCalledWith(expect.objectContaining({ reason: "chip_restricted" }));
    expect(onLeadFailed).not.toHaveBeenCalled();
    expect(avisarFreio).toHaveBeenCalledTimes(1);
  });

  it("número inexistente não recebe os passos seguintes", async () => {
    const chamadas = instalar(() => resposta(400, EXISTS_FALSE));
    await dispatchCampaignSequence({
      webhookUrl: "https://evo.teste/message/sendText/chip",
      leads: [lead(1)],
      analyticsMeta: {
        sequence: [...seq, { id: "s2", type: "text", order: 2, enabled: true, triggerMode: "immediate", text: "Segundo" }],
        dispatchOptions: { leadDelaySeconds: 0 },
      },
      context: { campaign: { id: "c" }, client: { id: "t" } },
      optOutPool: null,
      avisarFreio: async () => true,
    });
    expect(chamadas.map((c) => c.stepId)).toEqual(["s1"]);
  });

  it("limpeza no motor: fixo e 5500 não chegam à Evolution", async () => {
    const chamadas = instalar(() => resposta(201, '{"key":{"id":"x"}}'));
    const onLeadFailed = vi.fn();
    const r = await disparar([{ id: "a", telefone: "553432101234" }, { id: "b", telefone: "5500912345678" }, lead(1)], { onLeadFailed, avisarFreio: async () => true });
    expect(chamadas).toHaveLength(1);
    expect(r.summary.successCount).toBe(1);
    expect(onLeadFailed.mock.calls.map((c) => c[0].reason)).toEqual([
      "Limpeza antes do envio: telefone fixo",
      "Limpeza antes do envio: número inventado (5500)",
    ]);
  });

  it("continuação para quem respondeu não passa pela limpeza (número existe, pode estar como LID)", async () => {
    const chamadas = instalar(() => resposta(201, '{"key":{"id":"x"}}'));
    const r = await dispatchCampaignSequence({
      webhookUrl: "https://evo.teste/message/sendText/chip",
      leads: [{ id: "a", telefone: "123456789012345" }],
      analyticsMeta: { sequence: seq, dispatchOptions: { leadDelaySeconds: 0 } },
      context: { campaign: { id: "c", mode: "campaign_reply_progression" }, client: { id: "t" } },
      optOutPool: null,
      avisarFreio: async () => true,
    });
    expect(chamadas).toHaveLength(1);
    expect(r.summary.successCount).toBe(1);
  });

  it("envio de teste de um número (manualSingleSend) não passa pelo freio nem pela limpeza", async () => {
    const chamadas = instalar(() => resposta(403, "Forbidden"));
    const avisarFreio = vi.fn();
    const r = await disparar([{ id: "a", telefone: "553432101234" }], { manualSingleSend: true, avisarFreio });
    expect(chamadas).toHaveLength(1);
    expect(r.summary.freio).toBeNull();
    expect(avisarFreio).not.toHaveBeenCalled();
  });
});

describe("[OBRIGATÓRIO] nenhuma consulta de existência ao WhatsApp sobrou no backend", () => {
  it("whatsappNumbers / onWhatsApp não aparecem no código de envio nem no Banco", () => {
    for (const f of [
      "src/services/evolution.js",
      "src/campaign/dispatchEngine.js",
      "src/campaign/dispatch.js",
      "src/campaign-outbound.js",
      "src/services/leadBatchSeparation.js",
      "src/domains/campaigns/routes.js",
    ]) {
      const fonte = readFileSync(resolve(f), "utf8");
      expect(fonte, f).not.toMatch(/\/chat\/whatsappNumbers\/\$\{|checkWhatsappNumbers\(|validateWhatsappNumbersWithCache\(|onWhatsApp\(/);
    }
  });
});

// ── PR 2 (27/11/2026, opção A sem migration): lista global de recusados, nota da planilha e envio de prova ──────────
import { createPgliteDb } from "./helpers/pgliteDb.js";
import {
  ehInexistenteConhecido,
  notasDasPlanilhas,
  planilhasDosItens,
  registrarInexistente,
} from "../campaign/antiBloqueio.js";

const SCHEMA_REAL = `
  CREATE TABLE whatsapp_number_validations (
    phone TEXT PRIMARY KEY, exists_whatsapp BOOLEAN NOT NULL DEFAULT false, jid TEXT,
    validated_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE lead_import_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), import_id UUID NOT NULL, telefone TEXT);
  CREATE TABLE campaign_dispatch_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id UUID, lead_import_item_id UUID,
    phone TEXT, status TEXT NOT NULL, error_message TEXT);
`;

describe("[OBRIGATÓRIO] lista global de números recusados (Postgres real)", () => {
  it("só a recusa certa entra; para sempre; com e sem 55", async () => {
    const db = await createPgliteDb(SCHEMA_REAL);
    try {
      // antigo (há 2 anos): continua valendo, a lista é para sempre
      await db.query("INSERT INTO whatsapp_number_validations (phone, exists_whatsapp, validated_at) VALUES ('5534991110000', false, now() - interval '2 years')");
      await db.query("INSERT INTO whatsapp_number_validations (phone, exists_whatsapp) VALUES ('5534991112222', true)");
      expect(await ehInexistenteConhecido(db, "34991110000")).toBe(true);
      expect(await ehInexistenteConhecido(db, "5534991112222")).toBe(false);
      expect(await registrarInexistente(db, "+55 (34) 99111-3333")).toBe(true);
      expect(await ehInexistenteConhecido(db, "34991113333")).toBe(true);
    } finally {
      await db.close();
    }
  });

  it("4xx com exists:false é certeza; 5xx, rede e timeout não são", () => {
    expect(classificarFalhaDeEnvio({ statusCode: 400, message: '{"exists":false}' })).toBe("inexistente");
    expect(classificarFalhaDeEnvio({ statusCode: 500, message: '{"exists":false}' })).toBe("outra");
    expect(classificarFalhaDeEnvio({ message: "não existe no whatsapp" })).toBe("outra");
    expect(classificarFalhaDeEnvio({ name: "AbortError", message: "aborted" })).toBe("outra");
  });
});

describe("[OBRIGATÓRIO] nota da planilha (Postgres real)", () => {
  it("conta tentativas e inexistentes por planilha; a limpeza não conta; ruim a partir de 25% com 20 tentativas", async () => {
    const db = await createPgliteDb(SCHEMA_REAL);
    try {
      const A = "00000000-0000-4000-8000-00000000000a";
      const B = "00000000-0000-4000-8000-00000000000b";
      const item = async (imp) => (await db.query("INSERT INTO lead_import_items (import_id) VALUES ($1) RETURNING id::text AS id", [imp])).rows[0].id;
      const run = (it, status, msg = null) => db.query("INSERT INTO campaign_dispatch_runs (lead_import_item_id, status, error_message) VALUES ($1, $2, $3)", [it, status, msg]);
      // A: 20 tentativas, 5 inexistentes (25%) = ruim; mais 3 tiradas pela limpeza, que não contam
      for (let i = 0; i < 15; i += 1) await run(await item(A), "sent");
      for (let i = 0; i < 5; i += 1) await run(await item(A), "invalid_number", "Número não existe no WhatsApp (recusado no envio)");
      for (let i = 0; i < 3; i += 1) await run(await item(A), "invalid_number", "Limpeza antes do envio: telefone fixo");
      await run(await item(A), "skipped");
      // B: 10 tentativas, 5 inexistentes (50%) mas amostra pequena = não é ruim ainda
      const itB = await item(B);
      for (let i = 0; i < 5; i += 1) await run(await item(B), "sent");
      for (let i = 0; i < 5; i += 1) await run(await item(B), "invalid_number", "Número não existe no WhatsApp");

      const notas = await notasDasPlanilhas(db, [A, B]);
      expect(notas.get(A)).toEqual({ tentativas: 20, inexistentes: 5, taxa: 0.25, ruim: true });
      expect(notas.get(B)).toMatchObject({ tentativas: 10, inexistentes: 5, ruim: false });
      expect(await planilhasDosItens(db, [itB])).toEqual([B]);
      // 24%: 25 tentativas com 6 inexistentes
      const C = "00000000-0000-4000-8000-00000000000c";
      for (let i = 0; i < 19; i += 1) await run(await item(C), "sent");
      for (let i = 0; i < 6; i += 1) await run(await item(C), "invalid_number", "x");
      expect((await notasDasPlanilhas(db, [C])).get(C)).toMatchObject({ tentativas: 25, inexistentes: 6, ruim: false });
    } finally {
      await db.close();
    }
  });
});

describe("[OBRIGATÓRIO] motor: recusado nunca mais é tentado", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const seq = [{ id: "s1", type: "text", order: 1, enabled: true, triggerMode: "immediate", text: "Olá" }];
  const disparar = (pool, leads) =>
    dispatchCampaignSequence({
      webhookUrl: "https://evo.teste/message/sendText/chip",
      leads,
      analyticsMeta: { sequence: seq, dispatchOptions: { leadDelaySeconds: 0 } },
      context: { campaign: { id: "c" }, client: { id: "t" } },
      optOutPool: pool,
      avisarFreio: async () => true,
    });

  it("recusa 400 exists:false grava na lista; o próximo lote pula o número sem chamar a Evolution", async () => {
    const db = await createPgliteDb(SCHEMA_REAL + "CREATE TABLE lead_optouts (client_id TEXT, phone TEXT, revoked_at TIMESTAMPTZ);");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const chamadas = [];
      vi.stubGlobal("fetch", vi.fn(async (_u, init) => {
        chamadas.push(JSON.parse(init.body));
        return { ok: false, status: 400, text: async () => '{"response":{"message":[{"exists":false}]}}' };
      }));
      await disparar(db, [{ id: "a", telefone: "5534991093607" }]);
      expect(chamadas).toHaveLength(1);
      const { rows } = await db.query("SELECT phone, exists_whatsapp FROM whatsapp_number_validations");
      expect(rows).toEqual([{ phone: "5534991093607", exists_whatsapp: false }]);
      const onLeadFailed = vi.fn();
      const r = await dispatchCampaignSequence({
        webhookUrl: "https://evo.teste/message/sendText/chip",
        leads: [{ id: "b", telefone: "34991093607" }],
        analyticsMeta: { sequence: seq, dispatchOptions: { leadDelaySeconds: 0 } },
        context: { campaign: { id: "c" }, client: { id: "t" } },
        optOutPool: db,
        onLeadFailed,
        avisarFreio: async () => true,
      });
      expect(chamadas).toHaveLength(1);
      expect(r.summary.successCount).toBe(0);
      expect(onLeadFailed.mock.calls[0][0].reason).toBe('Limpeza antes do envio: número que já deu "não existe no WhatsApp"');
    } finally {
      await db.close();
    }
  });

  it("erro de rede ou 500 NÃO entra na lista", async () => {
    const db = await createPgliteDb(SCHEMA_REAL + "CREATE TABLE lead_optouts (client_id TEXT, phone TEXT, revoked_at TIMESTAMPTZ);");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let n = 0;
      vi.stubGlobal("fetch", vi.fn(async () => {
        n += 1;
        if (n === 1) throw new TypeError("fetch failed");
        return { ok: false, status: 500, text: async () => '{"exists":false}' };
      }));
      await disparar(db, [{ id: "a", telefone: "5534991093607" }, { id: "b", telefone: "5534991093608" }]);
      expect(n).toBe(2);
      const { rows } = await db.query("SELECT count(*)::int AS n FROM whatsapp_number_validations");
      expect(rows[0].n).toBe(0);
    } finally {
      await db.close();
    }
  });
});
