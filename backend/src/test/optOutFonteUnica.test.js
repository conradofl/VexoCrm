// backend/src/test/optOutFonteUnica.test.js
//
// Opt-out com fonte única: public.lead_optouts, por empresa e telefone canônico (services/optOut.js).
//
// Postgres REAL (pglite). Dublê só no que sai do processo: o HTTP da Evolution (fetch) e as claims do token.
// Cobre: a migration (schema velho -> novo, com a marca antiga do lead migrada), o serviço (gravar, revogar sem apagar,
// grafias do telefone, espelho no lead), a leitura com schema velho, o ponto comum de envio de campanha
// (dispatchCampaignSequence) e o interruptor do dossiê (PATCH /api/leads/:id).

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { sendError } from "../services/httpInfra.js";
import { resolveAuthorizedClientId } from "../services/tenant.js";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { dispatchCampaignSequence } from "../campaign-outbound.js";
import { isPhoneOptedOut, registerOptOut, revokeOptOut } from "../services/optOut.js";

const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations", "20261112010000_lead_optouts_fonte_unica.sql");
const T = "empresa-a";
const OUTRA = "empresa-b";
const FONE = "5534991093607"; // canônico
const GRAFIAS = ["5534991093607", "34991093607", "553491093607", "3491093607", "(34) 99109-3607", "+55 34 99109-3607", "5534991093607@s.whatsapp.net"];

// Como produção ANTES da migration: lead_optouts criada fora das migrations, sem default e sem as colunas novas.
const SCHEMA_VELHO = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE public.leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    telefone text NOT NULL,
    nome text,
    stage text DEFAULT 'cold',
    stage_source text DEFAULT 'manual',
    tags text[] DEFAULT ARRAY[]::text[],
    dados jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    opt_out boolean DEFAULT false,
    assigned_to text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.lead_optouts (id uuid, client_id text, phone text, optout_at timestamptz, reason text);
`;

const abertos = [];
afterAll(async () => {
  for (const db of abertos) await db.close();
});

async function banco({ migrar = true } = {}) {
  const db = await createPgliteDb(SCHEMA_VELHO);
  abertos.push(db);
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'A'), ($2, 'B')", [T, OUTRA]);
  const aplicar = async () => db.exec(await readFile(MIGRATION, "utf8"));
  if (migrar) await aplicar();
  const pool = { query: (sql, params) => db.query(sql, params) };
  const linhas = async () => (await db.query("SELECT client_id, phone, source, reason, created_by, wa_message_id, message_text, revoked_at, revoked_by FROM lead_optouts ORDER BY optout_at, phone")).rows;
  const lead = async (clientId, telefone, extra = {}) =>
    (await db.query(
      "INSERT INTO leads (client_id, telefone, nome, opt_out, metadata, dados) VALUES ($1, $2, 'Lead', $3, $4::jsonb, $5::jsonb) RETURNING id",
      [clientId, telefone, extra.opt_out === true, JSON.stringify(extra.metadata || {}), JSON.stringify(extra.dados || {})]
    )).rows[0].id;
  const lerLead = async (id) => (await db.query("SELECT opt_out, metadata FROM leads WHERE id = $1", [id])).rows[0];
  return { db, pool, aplicar, linhas, lead, lerLead };
}

describe("migration 20261112010000: lead_optouts vira a fonte única", () => {
  it("[OBRIGATÓRIO] leva a marca antiga do lead (coluna, metadata e dados) para a tabela, em telefone canônico, e é idempotente", async () => {
    const w = await banco({ migrar: false });
    await w.lead(T, "34991093607", { opt_out: true }); // coluna, sem 55
    await w.lead(T, "553488880001", { metadata: { opt_out: "true" } }); // metadata, sem o 9
    await w.lead(T, "5534977770002", { dados: { opt_out: "true" } }); // dados
    await w.lead(T, "5534991093607", { opt_out: true }); // o MESMO número do primeiro, outra grafia
    await w.lead(T, "5534966660003"); // sem marca
    await w.lead(OUTRA, "5534955550004", { opt_out: true });

    await w.aplicar();
    await w.aplicar(); // segunda vez não duplica nem quebra

    const linhas = await w.linhas();
    expect(linhas.map((l) => `${l.client_id}:${l.phone}`).sort()).toEqual([
      `${T}:5534977770002`,
      `${T}:5534988880001`,
      `${T}:5534991093607`,
      `${OUTRA}:5534955550004`,
    ]);
    expect(linhas.every((l) => l.source === "migracao" && l.revoked_at === null)).toBe(true);
  });

  it("linha que já existia na tabela passa para a grafia canônica; repetida do mesmo número fica com uma só ativa", async () => {
    const w = await banco({ migrar: false });
    await w.db.query(
      "INSERT INTO lead_optouts (id, client_id, phone, optout_at, reason) VALUES (gen_random_uuid(), $1, '+55 34 9109-3607', '2026-10-01', 'antiga'), (gen_random_uuid(), $1, '5534991093607', '2026-10-05', 'repetida')",
      [T]
    );
    await w.aplicar();
    const linhas = await w.linhas();
    expect(linhas.map((l) => l.phone)).toEqual([FONE, FONE]);
    expect(linhas.filter((l) => l.revoked_at === null).map((l) => l.reason)).toEqual(["antiga"]);
    expect(await isPhoneOptedOut(w.pool, { clientId: T, phone: FONE })).toBe(true);
  });
});

describe("services/optOut.js com o schema novo", () => {
  it("[OBRIGATÓRIO] pedido gravado bloqueia o número em qualquer grafia, só na empresa dele", async () => {
    const w = await banco();
    const r = await registerOptOut(w.pool, { clientId: T, phone: "(34) 9109-3607", source: "palavra", reason: "parar", waMessageId: "WA-1", messageText: "parar" });
    expect(r).toMatchObject({ registered: true, alreadyActive: false, phone: FONE });
    for (const grafia of GRAFIAS) {
      expect(await isPhoneOptedOut(w.pool, { clientId: T, phone: grafia }), grafia).toBe(true);
    }
    expect(await isPhoneOptedOut(w.pool, { clientId: OUTRA, phone: FONE })).toBe(false);
    expect(await isPhoneOptedOut(w.pool, { clientId: T, phone: "5534991093608" })).toBe(false);
    expect((await w.linhas())[0]).toMatchObject({ source: "palavra", reason: "parar", wa_message_id: "WA-1", message_text: "parar" });
  });

  it("gravar duas vezes não cria segunda linha ativa", async () => {
    const w = await banco();
    await registerOptOut(w.pool, { clientId: T, phone: FONE, source: "manual" });
    const segunda = await registerOptOut(w.pool, { clientId: T, phone: "34991093607", source: "palavra" });
    expect(segunda).toMatchObject({ registered: false, alreadyActive: true });
    expect(await w.linhas()).toHaveLength(1);
  });

  it("[OBRIGATÓRIO] revogar NÃO apaga: grava a data, libera o número, e um pedido novo depois cria outra linha", async () => {
    const w = await banco();
    await registerOptOut(w.pool, { clientId: T, phone: FONE, source: "sem_interesse" });
    const rev = await revokeOptOut(w.pool, { clientId: T, phone: "3491093607", revokedBy: "u-1" });
    expect(rev.revoked).toBe(1);
    expect(await isPhoneOptedOut(w.pool, { clientId: T, phone: FONE })).toBe(false);
    let linhas = await w.linhas();
    expect(linhas).toHaveLength(1);
    expect(linhas[0].revoked_at).not.toBeNull();
    expect(linhas[0].revoked_by).toBe("u-1");

    await registerOptOut(w.pool, { clientId: T, phone: FONE, source: "palavra" });
    linhas = await w.linhas();
    expect(linhas).toHaveLength(2);
    expect(linhas.filter((l) => l.revoked_at === null)).toHaveLength(1);
    expect(await isPhoneOptedOut(w.pool, { clientId: T, phone: FONE })).toBe(true);
  });

  it("espelha a marca em TODAS as linhas de lead daquele número (grafias só de dígitos), e desfaz ao revogar", async () => {
    const w = await banco();
    const a = await w.lead(T, "5534991093607");
    const b = await w.lead(T, "34991093607");
    const outroNumero = await w.lead(T, "5534966660003");
    const outraEmpresa = await w.lead(OUTRA, "5534991093607");

    await registerOptOut(w.pool, { clientId: T, phone: FONE, source: "manual" });
    expect(await w.lerLead(a)).toMatchObject({ opt_out: true, metadata: { opt_out: "true" } });
    expect(await w.lerLead(b)).toMatchObject({ opt_out: true, metadata: { opt_out: "true" } });
    expect((await w.lerLead(outroNumero)).opt_out).toBe(false);
    expect((await w.lerLead(outraEmpresa)).opt_out).toBe(false);

    await revokeOptOut(w.pool, { clientId: T, phone: FONE });
    expect(await w.lerLead(a)).toMatchObject({ opt_out: false, metadata: { opt_out: "false" } });
    expect(await w.lerLead(b)).toMatchObject({ opt_out: false, metadata: { opt_out: "false" } });
  });

  it("a marca solta no lead NÃO decide mais nada: sem linha na tabela, o número não está em opt-out", async () => {
    const w = await banco();
    await w.lead(T, FONE, { opt_out: true, metadata: { opt_out: "true" } }); // depois da migration
    expect(await isPhoneOptedOut(w.pool, { clientId: T, phone: FONE })).toBe(false);
  });

  it("origem desconhecida é recusada; grupo e @lid não têm opt-out", async () => {
    const w = await banco();
    await expect(registerOptOut(w.pool, { clientId: T, phone: FONE, source: "qualquer" })).rejects.toThrow(/origem inválida/);
    expect((await registerOptOut(w.pool, { clientId: T, phone: "120363028374829@g.us", source: "manual" })).registered).toBe(false);
    expect((await registerOptOut(w.pool, { clientId: T, phone: "12345@lid", source: "manual" })).registered).toBe(false);
    expect(await w.linhas()).toHaveLength(0);
  });

  it("erro que não é de schema SOBE na leitura (quem chama bloqueia, nunca libera)", async () => {
    const pool = { query: async () => { throw new Error("connection terminated unexpectedly"); } };
    await expect(isPhoneOptedOut(pool, { clientId: T, phone: FONE })).rejects.toThrow(/connection terminated/);
  });
});

describe("código novo com schema VELHO (migration ainda não aplicada)", () => {
  it("[OBRIGATÓRIO] a leitura continua valendo o que valia: marca no lead e linha antiga da tabela bloqueiam", async () => {
    const w = await banco({ migrar: false });
    await w.lead(T, "34991093607", { opt_out: true });
    await w.db.query("INSERT INTO lead_optouts (id, client_id, phone, optout_at) VALUES (gen_random_uuid(), $1, '+55 34 98888-0001', now())", [T]);

    expect(await isPhoneOptedOut(w.pool, { clientId: T, phone: FONE })).toBe(true);
    expect(await isPhoneOptedOut(w.pool, { clientId: T, phone: "5534988880001" })).toBe(true);
    expect(await isPhoneOptedOut(w.pool, { clientId: T, phone: "5534966660003" })).toBe(false);
  });

  it("[OBRIGATÓRIO] a escrita falha ALTO: ninguém acha que gravou", async () => {
    const w = await banco({ migrar: false });
    await expect(registerOptOut(w.pool, { clientId: T, phone: FONE, source: "manual" })).rejects.toThrow();
    await expect(revokeOptOut(w.pool, { clientId: T, phone: FONE })).rejects.toThrow();
  });
});

describe("dispatchCampaignSequence: a checagem é do ponto comum de envio, não de quem chama", () => {
  let enviados;
  let fetchOriginal;
  beforeEach(() => {
    enviados = [];
    fetchOriginal = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      if (/sendText/.test(String(url))) enviados.push(String(JSON.parse(init?.body || "{}").number || ""));
      return { ok: true, status: 200, json: async () => ({ key: { id: "wa" } }), text: async () => '{"key":{"id":"wa"}}' };
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    vi.restoreAllMocks();
  });

  const SEQ = [{ id: "s1", type: "text", text: "Oi", order: 1, enabled: true, delayAfterSeconds: 0 }];
  const LIVRE = "5534966660003";
  const enviar = (pool, extra = {}) =>
    dispatchCampaignSequence({
      webhookUrl: "https://evo.teste/message/sendText/chip-1",
      webhookToken: "t",
      leadDelayProvider: () => 0,
      leads: [{ id: "l1", nome: "Ana", telefone: "34991093607" }, { id: "l2", nome: "Bia", telefone: LIVRE }],
      analyticsMeta: { sequence: SEQ },
      context: { client: { id: T, name: "A" } },
      optOutPool: pool,
      ...extra,
    });

  it("[OBRIGATÓRIO] chamador que NÃO passa onLeadCheckOptout também não envia a quem pediu para sair", async () => {
    const w = await banco();
    await registerOptOut(w.pool, { clientId: T, phone: FONE, source: "sem_interesse" });
    const { summary } = await enviar(w.pool);
    expect(enviados).toEqual([LIVRE]);
    expect(summary.failures.map((f) => f.reason)).toEqual(["Lead está na lista de Opt-out."]);
  });

  it("onLeadCheckOptout soma, não substitui: callback que responde 'não' não libera quem está na tabela", async () => {
    const w = await banco();
    await registerOptOut(w.pool, { clientId: T, phone: FONE, source: "palavra" });
    await enviar(w.pool, { onLeadCheckOptout: async () => false });
    expect(enviados).toEqual([LIVRE]);
  });

  it("sem pedido de saída os dois recebem; pedido de outra empresa não bloqueia", async () => {
    const w = await banco();
    await registerOptOut(w.pool, { clientId: OUTRA, phone: FONE, source: "palavra" });
    await enviar(w.pool);
    expect(enviados).toEqual(["34991093607", LIVRE]);
  });

  it("erro ao ler o opt-out nunca libera: ninguém recebe nesta rodada", async () => {
    const pool = { query: async () => { throw new Error("connection terminated unexpectedly"); } };
    await enviar(pool);
    expect(enviados).toEqual([]);
  });

  it("manualSingleSend (envio de teste de um número digitado pelo operador) é a única exceção", async () => {
    const w = await banco();
    await registerOptOut(w.pool, { clientId: T, phone: FONE, source: "palavra" });
    await enviar(w.pool, { manualSingleSend: true });
    expect(enviados).toEqual(["34991093607", LIVRE]);
  });
});

describe("interruptor do dossiê (PATCH /api/leads/:id com opt_out) grava na fonte única", () => {
  let server;
  let baseUrl;
  let w;

  const patch = (id, body) =>
    fetch(`${baseUrl}/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function subir({ migrar = true } = {}) {
    w = await banco({ migrar });
    const app = express();
    app.use(express.json());
    registerLeadsRoutes(app, {
      ensureDb: () => true,
      pgDatabasePool: w.pool,
      supabase: createPgSupabaseClient(w.pool),
      requireFirebaseAuth: (req, _res, next) => {
        req.authAccess = { uid: "operador-1", role: "client", scopeMode: "assigned_clients", clientId: T, clientIds: [T] };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      ensureSharedRoutePageAccess: () => true,
      resolveAuthorizedClientId,
      sanitizePhone: (p) => p,
      sendError,
      normalizeString: (s) => (s ? String(s).trim() : ""),
    });
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    baseUrl = `http://localhost:${server.address().port}`;
  }

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    if (server) await new Promise((r) => server.close(r));
    server = null;
    vi.restoreAllMocks();
  });

  it("[OBRIGATÓRIO] ligar grava linha 'manual' com quem marcou; o número passa a estar em opt-out e a tela vê o espelho", async () => {
    await subir();
    const id = await w.lead(T, "34991093607");
    // a tela manda o metadata inteiro junto, como hoje
    const res = await patch(id, { opt_out: true, metadata: { outra: "coisa", opt_out: "true" } });
    expect(res.status).toBe(200);
    const item = (await res.json()).item;
    expect(item.opt_out).toBe(true);
    expect(item.metadata).toMatchObject({ outra: "coisa", opt_out: "true" });

    const linhas = await w.linhas();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ client_id: T, phone: FONE, source: "manual", created_by: "operador-1", revoked_at: null });
    expect(await isPhoneOptedOut(w.pool, { clientId: T, phone: FONE })).toBe(true);
  });

  it("[OBRIGATÓRIO] desligar desfaz com um clique um pedido capturado por palavra, sem apagar a linha", async () => {
    await subir();
    const id = await w.lead(T, FONE);
    await registerOptOut(w.pool, { clientId: T, phone: FONE, source: "sem_interesse", reason: "não tenho interesse" });
    expect((await w.lerLead(id)).opt_out).toBe(true); // espelho: é o que a tela mostra ligado

    const res = await patch(id, { opt_out: false, metadata: { opt_out: "false" } });
    expect(res.status).toBe(200);
    expect(await isPhoneOptedOut(w.pool, { clientId: T, phone: FONE })).toBe(false);
    const linhas = await w.linhas();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ source: "sem_interesse", revoked_by: "operador-1" });
    expect(linhas[0].revoked_at).not.toBeNull();
    expect(await w.lerLead(id)).toMatchObject({ opt_out: false, metadata: { opt_out: "false" } });
  });

  it("PATCH que não fala de opt-out não toca na tabela", async () => {
    await subir();
    const id = await w.lead(T, FONE);
    expect((await patch(id, { nome: "Outro nome" })).status).toBe(200);
    expect(await w.linhas()).toHaveLength(0);
  });

  it("schema velho: o interruptor responde 500 e NÃO marca o lead (a tela não mostra bloqueado sem ter gravado)", async () => {
    await subir({ migrar: false });
    const id = await w.lead(T, FONE);
    const res = await patch(id, { opt_out: true });
    expect(res.status).toBe(500);
    expect((await w.lerLead(id)).opt_out).toBe(false);
  });
});
