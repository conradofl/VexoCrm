// Separar lotes e conferir WhatsApp (services/leadBatchSeparation.js + domains/leads/batchSeparationRoutes.js).
//
// Postgres real em memória (pglite) com as migrations de produção da importação em lotes e do cache de WhatsApp;
// Express real; resolveAuthorizedClientId de produção. Só a Evolution é dublada (é o que sai do processo).
//
// O que tem de ficar provado:
//   1. a prévia separa celular, fixo e inválido, e conta quem já recebeu, quem já está em lote e quem está disponível;
//   2. separar cria planilhas do tamanho pedido, só com disponíveis, e quem entrou num lote não entra no próximo;
//   3. fixo só entra com WhatsApp confirmado; número sem WhatsApp, opt-out, quem já recebeu e outra empresa nunca entram;
//   4. a conferência grava no cache do disparo, devagar, e para sozinha em falha seguida;
//   5. o agente separa pela porta dele, só na própria empresa.

import express from "express";
import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { resolveAuthorizedClientId } from "../services/tenant.js";
import { resetLeadImportBatchStateForTest } from "../services/leadImportBatches.js";
import {
  __aguardarConferenciaParaTeste,
  __limparConferenciasParaTeste,
  classificarTelefone,
  iniciarConferencia,
  previaSeparacao,
  statusConferencia,
} from "../services/leadBatchSeparation.js";
import { registerLeadBatchSeparationRoutes } from "../domains/leads/batchSeparationRoutes.js";
import { CAMPAIGN_AGENT_TOKENS_ENV, registerCampaignAgentLeadBatchRoutes } from "../campaign/agentDraft.js";
import { createPgMassDeleteRepo, executeMassDelete, normalizeCriterion, previewMassDelete } from "../services/leadMassDelete.js";

const SLOW = 60_000;
const T = "tinge-teste";
const OUTRA = "outra-teste";
const TOKEN_T = "t".repeat(20) + "-token-do-agente-da-tinge-teste-01";
const TOKEN_O = "o".repeat(20) + "-token-do-agente-da-outra-teste-02";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, telefone text, phone text, nome text,
    opt_out boolean, tags text[], stage text, temperature text, dados jsonb, raw_chat_summary text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE lead_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, lead_id uuid, phone text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE lead_imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    source_name text NOT NULL, source_type text NOT NULL DEFAULT 'spreadsheet', total_rows integer NOT NULL DEFAULT 0,
    imported_rows integer NOT NULL DEFAULT 0, skipped_rows integer NOT NULL DEFAULT 0, uploaded_by_uid text, uploaded_by_email text,
    created_at timestamptz NOT NULL DEFAULT now(), column_mapping jsonb);
  CREATE TABLE lead_import_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_id uuid NOT NULL REFERENCES lead_imports(id) ON DELETE CASCADE,
    client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE, row_number integer NOT NULL, telefone text,
    lead_id uuid REFERENCES leads(id) ON DELETE SET NULL, imported boolean NOT NULL DEFAULT false, skip_reason text,
    raw_data jsonb NOT NULL DEFAULT '{}'::jsonb, normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE lead_custom_fields (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, key text NOT NULL, label text NOT NULL,
    type text NOT NULL DEFAULT 'text', import_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT uq_lcf UNIQUE (client_id, key));
  CREATE TABLE campaign_dispatch_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id uuid, campaign_id uuid, client_id text NOT NULL,
    lead_id uuid, phone text, status text NOT NULL, error_message text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE lead_client_evolution_instances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, name text, dispatch_webhook_url text,
    dispatch_webhook_token text, active boolean NOT NULL DEFAULT true, connection_state text,
    created_at timestamptz NOT NULL DEFAULT now());
`;
const MIGRATIONS = [
  "supabase/migrations/20261005120000_add_batch_columns_to_lead_imports.sql",
  "supabase/migrations/20260831180000_add_whatsapp_number_validation_and_invalid_status.sql",
];

let db;
let pool;
let server;
let base;
let chipT;
let chipO;
const envAntes = process.env[CAMPAIGN_AGENT_TOKENS_ENV];

function cel(n) {
  return `553499${String(n).padStart(7, "0")}`;
}

async function lead(clientId, telefone, extra = {}) {
  const { rows } = await db.query(
    "INSERT INTO leads (client_id, telefone, nome, opt_out, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [clientId, telefone, extra.nome ?? "Cliente", extra.optOut ?? false, extra.createdAt ?? new Date("2026-01-01T00:00:00Z")]
  );
  return rows[0].id;
}

async function confirmar(telefone, existe) {
  await db.query(
    "INSERT INTO whatsapp_number_validations (phone, exists_whatsapp, validated_at) VALUES ($1, $2, now()) ON CONFLICT (phone) DO UPDATE SET exists_whatsapp = EXCLUDED.exists_whatsapp",
    [telefone, existe]
  );
}

async function call(method, path, { access, token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (access) headers["x-test-access"] = JSON.stringify(access);
  if (token) headers.authorization = `Bearer ${token}`;
  const resp = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: resp.status, json: await resp.json().catch(() => null) };
}

const DONO_T = { role: "client", scopeMode: "assigned_clients", clientId: T, clientIds: [T], permissions: [], email: "dono@tinge.test" };

beforeAll(async () => {
  db = await createPgliteDb(SCHEMA);
  for (const file of MIGRATIONS) {
    let sql = readFileSync(resolve(file), "utf8");
    if (file.includes("whatsapp_number_validation")) {
      // A parte 2 desta migration mexe na CHECK de campaign_dispatch_runs; aqui a tabela de teste não tem a CHECK antiga.
      sql = sql.split("-- 2.")[0];
    }
    await db.exec(sql);
  }
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Tinge'), ($2, 'Outra')", [T, OUTRA]);
  // Sem parâmetro, o pg de produção usa o protocolo simples (aceita vários comandos num texto, como o CREATE TABLE +
  // CREATE INDEX da auditoria da exclusão em massa); o pglite só aceita isso no exec.
  const consulta = async (text, params) => {
    if (params && params.length) return db.query(text, params);
    const resultados = await db.exec(text);
    const ultimo = resultados[resultados.length - 1] || { rows: [] };
    return { ...ultimo, rowCount: ultimo.affectedRows ?? ultimo.rows?.length ?? 0 };
  };
  pool = {
    query: consulta,
    connect: async () => ({ query: consulta, release: () => {} }),
  };

  const app = express();
  app.use(express.json());
  // Login dublado (o Firebase sai do processo); o escopo por empresa é o de produção.
  const requireFirebaseAuth = (req, res, next) => {
    const raw = req.headers["x-test-access"];
    if (!raw) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    req.authAccess = JSON.parse(raw);
    next();
  };
  registerLeadBatchSeparationRoutes(app, {
    pgDatabasePool: pool,
    requireFirebaseAuth,
    requireBancoDeDados: (req, res, next) => next(),
    resolveAuthorizedClientId,
    sendError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
    normalizeTenantKey: (s) => String(s ?? "").trim(),
  });
  registerCampaignAgentLeadBatchRoutes(app, { pgDatabasePool: pool });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
}, SLOW);

beforeEach(async () => {
  process.env[CAMPAIGN_AGENT_TOKENS_ENV] = `${T}=${TOKEN_T},${OUTRA}=${TOKEN_O}`;
  resetLeadImportBatchStateForTest();
  __limparConferenciasParaTeste();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const ins = await db.query(
    `INSERT INTO lead_client_evolution_instances (client_id, name, dispatch_webhook_url, dispatch_webhook_token, connection_state)
     VALUES ($1, 'Comercial', 'https://evo.test/message/sendText/tinge-comercial', 'segredo-do-chip', 'open'),
            ($2, 'Chip da outra', 'https://evo.test/message/sendText/outra', 'segredo-da-outra', 'open') RETURNING id`,
    [T, OUTRA]
  );
  chipT = ins.rows[0].id;
  chipO = ins.rows[1].id;
});

afterEach(async () => {
  __limparConferenciasParaTeste();
  vi.restoreAllMocks();
  for (const t of ["lead_import_items", "lead_imports", "campaign_dispatch_runs", "whatsapp_number_validations", "lead_messages", "leads", "lead_client_evolution_instances"]) {
    await db.query(`DELETE FROM ${t}`);
  }
});

afterAll(async () => {
  if (envAntes === undefined) delete process.env[CAMPAIGN_AGENT_TOKENS_ENV];
  else process.env[CAMPAIGN_AGENT_TOKENS_ENV] = envAntes;
  if (server) await new Promise((r) => server.close(r));
  await db?.close();
});

describe("classificar telefone", () => {
  it("celular, fixo e inválido no formato brasileiro", () => {
    expect(classificarTelefone("5534996308539")).toBe("celular");
    expect(classificarTelefone("34996308539")).toBe("celular");
    expect(classificarTelefone("553496308539")).toBe("celular"); // formato antigo do WhatsApp, sem o 9
    expect(classificarTelefone("553432145678")).toBe("fixo");
    expect(classificarTelefone("(34) 3214-5678")).toBe("fixo");
    expect(classificarTelefone("5500123456789")).toBe("invalido");
    expect(classificarTelefone("182089718698103")).toBe("invalido");
    expect(classificarTelefone("")).toBe("invalido");
  });
});

describe("prévia e separação", () => {
  async function baseDeTeste() {
    // 6 celulares confirmados, 1 celular sem WhatsApp, 1 celular não conferido, 1 fixo com WhatsApp, 1 fixo sem conferir,
    // 1 inválido, 1 opt-out confirmado, 1 que já recebeu campanha, e 1 lead de outra empresa.
    for (let i = 1; i <= 6; i += 1) {
      await lead(T, cel(i), { createdAt: new Date(Date.UTC(2026, 0, i)) });
      await confirmar(cel(i), true);
    }
    await lead(T, cel(7));
    await confirmar(cel(7), false);
    await lead(T, cel(8));
    await lead(T, "553432145678");
    await confirmar("553432145678", true);
    await lead(T, "553432140000");
    await lead(T, "5500123456789");
    await lead(T, cel(9), { optOut: true });
    await confirmar(cel(9), true);
    const recebeu = await lead(T, cel(10));
    await confirmar(cel(10), true);
    await db.query("INSERT INTO campaign_dispatch_runs (client_id, lead_id, phone, status) VALUES ($1, $2, $3, 'sent')", [T, recebeu, cel(10)]);
    await lead(OUTRA, cel(11));
    await confirmar(cel(11), true);
  }

  it("a prévia conta cada grupo da empresa e ignora outra empresa", async () => {
    await baseDeTeste();
    const p = await previaSeparacao(pool, { clientId: T });
    expect(p).toMatchObject({
      total: 13,
      celular: 10,
      fixo: 2,
      invalido: 1,
      whatsapp_confirmado: 9,
      sem_whatsapp: 1,
      nao_conferido: 2,
      opt_out: 1,
      ja_recebeu: 1,
      ja_separado: 0,
      // 6 celulares confirmados + 1 fixo com WhatsApp
      disponivel_confirmado: 7,
      // mais o celular ainda não conferido (o fixo sem conferir nunca entra)
      disponivel_sem_conferir: 8,
    });
  }, SLOW);

  it("separa em planilhas do tamanho pedido; quem entrou num lote não entra no próximo", async () => {
    await baseDeTeste();
    const r1 = await call("POST", "/api/leads/lotes", { access: DONO_T, body: { clientId: T, tamanho: 3, quantidade: 2, nomeBase: "Natal" } });
    expect(r1.status).toBe(201);
    expect(r1.json.planilhas.map((p) => p.leads)).toEqual([3, 3]);
    expect(r1.json.planilhas[0].nome).toBe("Natal · Lote 01 · 3 leads");
    expect(r1.json.disponiveisRestantes).toBe(1);

    const r2 = await call("POST", "/api/leads/lotes", { access: DONO_T, body: { clientId: T, tamanho: 3, quantidade: 5, nomeBase: "Natal" } });
    expect(r2.status).toBe(201);
    expect(r2.json.planilhas).toHaveLength(1);
    expect(r2.json.planilhas[0]).toMatchObject({ numero: 3, leads: 1 });
    expect(r2.json.disponiveisRestantes).toBe(0);

    const { rows: itens } = await db.query(
      `SELECT regexp_replace(i.telefone, '\\D', '', 'g') t, count(*)::int n FROM lead_import_items i
        JOIN lead_imports im ON im.id = i.import_id WHERE im.client_id = $1 GROUP BY 1`,
      [T]
    );
    expect(itens.every((x) => x.n === 1)).toBe(true);
    const telefones = itens.map((x) => x.t).sort();
    expect(telefones).toEqual([cel(1), cel(2), cel(3), cel(4), cel(5), cel(6), "553432145678"].sort());
    // nunca entram: sem WhatsApp, não conferido, fixo sem conferir, inválido, opt-out, quem já recebeu, outra empresa
    for (const fora of [cel(7), cel(8), "553432140000", "5500123456789", cel(9), cel(10), cel(11)]) {
      expect(telefones).not.toContain(fora);
    }

    const { rows: planilhas } = await db.query(
      "SELECT source_type, status, imported_rows, import_params, uploaded_by_email FROM lead_imports WHERE client_id = $1 ORDER BY created_at",
      [T]
    );
    expect(planilhas.every((p) => p.source_type === "lote_separado" && p.status === "completed")).toBe(true);
    expect(planilhas.every((p) => p.import_params.loteSeparado && p.uploaded_by_email === "dono@tinge.test")).toBe(true);

    const p = await previaSeparacao(pool, { clientId: T });
    expect(p.ja_separado).toBe(7);
    expect(p.disponivel_confirmado).toBe(0);
  }, SLOW);

  it("sem exigir WhatsApp entra o celular não conferido, mas nunca o fixo sem conferir nem o sem WhatsApp", async () => {
    await baseDeTeste();
    const r = await call("POST", "/api/leads/lotes", { access: DONO_T, body: { clientId: T, tamanho: 50, quantidade: 1, exigirWhatsapp: false } });
    expect(r.status).toBe(201);
    expect(r.json.separados).toBe(8);
    const { rows } = await db.query("SELECT regexp_replace(telefone, '\\D', '', 'g') t FROM lead_import_items WHERE client_id = $1", [T]);
    const t = rows.map((x) => x.t);
    expect(t).toContain(cel(8));
    expect(t).not.toContain("553432140000");
    expect(t).not.toContain(cel(7));
  }, SLOW);

  it("planilha montada antes pelo agente conta como lote separado", async () => {
    await baseDeTeste();
    const { rows } = await db.query(
      "INSERT INTO lead_imports (client_id, source_name, uploaded_by_email) VALUES ($1, 'Lote do agente', 'agente-campanha') RETURNING id",
      [T]
    );
    await db.query("INSERT INTO lead_import_items (import_id, client_id, row_number, telefone, imported) VALUES ($1, $2, 2, $3, true)", [rows[0].id, T, cel(1)]);
    const p = await previaSeparacao(pool, { clientId: T });
    expect(p.ja_separado).toBe(1);
    expect(p.disponivel_confirmado).toBe(6);
  }, SLOW);

  it("pedido inválido, outra empresa e sem login são recusados sem criar nada", async () => {
    await baseDeTeste();
    for (const body of [
      { clientId: T, tamanho: 0, quantidade: 1 },
      { clientId: T, tamanho: 501, quantidade: 1 },
      { clientId: T, tamanho: 10, quantidade: 51 },
      { clientId: T, tamanho: "dez", quantidade: 1 },
    ]) {
      const r = await call("POST", "/api/leads/lotes", { access: DONO_T, body });
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await call("POST", "/api/leads/lotes", { access: DONO_T, body: { clientId: OUTRA, tamanho: 5, quantidade: 1 } })).status).toBe(403);
    expect((await call("POST", "/api/leads/lotes", { body: { clientId: T, tamanho: 5, quantidade: 1 } })).status).toBe(401);
    expect((await call("GET", `/api/leads/lotes/previa?clientId=${OUTRA}`, { access: DONO_T })).status).toBe(403);
    const { rows } = await db.query("SELECT count(*)::int n FROM lead_imports");
    expect(rows[0].n).toBe(0);
  }, SLOW);

  it("a prévia pela rota devolve os números e o estado da conferência", async () => {
    await baseDeTeste();
    const r = await call("GET", `/api/leads/lotes/previa?clientId=${T}`, { access: DONO_T });
    expect(r.status).toBe(200);
    expect(r.json.previa.disponivel_confirmado).toBe(7);
    expect(r.json.conferencia).toEqual({ rodando: false });
  }, SLOW);
});

describe("lote de um grupo: tag, planilha ou filtro da tela (24/11/2026)", () => {
  // Caso da Tinge: 685 com a tag de clientes, e o Conrado quer 100 deles para uma campanha, sem exportar para o Excel.
  const TAG = 'LEADS - "clientes" - TINGE BRASIL';
  async function baseComTag() {
    // 1..5 clientes (tag) com WhatsApp; 6 cliente que já recebeu; 7..9 fora da tag; 12 cliente de outra empresa.
    const ids = {};
    for (let i = 1; i <= 9; i += 1) {
      const cliente = i <= 6;
      ids[i] = await lead(T, cel(i), { nome: cliente ? `Cliente ${i}` : `Contato ${i}`, createdAt: new Date(Date.UTC(2026, 0, i)) });
      await confirmar(cel(i), true);
      if (cliente) await db.query("UPDATE leads SET tags = ARRAY[$1, 'agenda-whatsapp'] WHERE id = $2", [TAG, ids[i]]);
      else await db.query("UPDATE leads SET tags = ARRAY['agenda-whatsapp'] WHERE id = $1", [ids[i]]);
    }
    await db.query("INSERT INTO campaign_dispatch_runs (client_id, lead_id, phone, status) VALUES ($1, $2, $3, 'sent')", [T, ids[6], cel(6)]);
    const outra = await lead(OUTRA, cel(12), { nome: "Cliente da outra" });
    await confirmar(cel(12), true);
    await db.query("UPDATE leads SET tags = ARRAY[$1] WHERE id = $2", [TAG, outra]);
    return ids;
  }
  const telefonesDaPlanilha = async (importId) =>
    (await db.query("SELECT regexp_replace(telefone, '\\D', '', 'g') t FROM lead_import_items WHERE import_id = $1 ORDER BY row_number", [importId])).rows.map((r) => r.t);

  it("prévia da tag conta só os leads dela; quem já recebeu fica de fora do disponível", async () => {
    await baseComTag();
    const origem = encodeURIComponent(JSON.stringify({ tipo: "tag", tag: TAG }));
    const r = await call("GET", `/api/leads/lotes/previa?clientId=${T}&origem=${origem}`, { access: DONO_T });
    expect(r.status).toBe(200);
    expect(r.json.previa).toMatchObject({ total: 6, ja_recebeu: 1, disponivel_confirmado: 5 });
    expect(r.json.origem).toMatchObject({ tipo: "tag", grupo: 6, rotulo: `Tag: ${TAG}` });
    // controle: sem origem conta a empresa inteira
    const todo = await call("GET", `/api/leads/lotes/previa?clientId=${T}`, { access: DONO_T });
    expect(todo.json.previa.total).toBe(9);
  }, SLOW);

  it("separa 3 da tag: só clientes, nunca quem já recebeu, fora da tag ou de outra empresa; o próximo lote não repete", async () => {
    await baseComTag();
    const body = { clientId: T, tamanho: 3, quantidade: 1, nomeBase: "Clientes", origem: { tipo: "tag", tag: TAG } };
    const r1 = await call("POST", "/api/leads/lotes", { access: DONO_T, body });
    expect(r1.status).toBe(201);
    expect(r1.json.planilhas[0]).toMatchObject({ leads: 3 });
    expect(r1.json.disponiveisRestantes).toBe(2);
    expect(await telefonesDaPlanilha(r1.json.planilhas[0].id)).toEqual([cel(1), cel(2), cel(3)]);

    const r2 = await call("POST", "/api/leads/lotes", { access: DONO_T, body });
    expect(await telefonesDaPlanilha(r2.json.planilhas[0].id)).toEqual([cel(4), cel(5)]);
    expect(r2.json.disponiveisRestantes).toBe(0);

    const { rows } = await db.query("SELECT import_params FROM lead_imports WHERE id = $1", [r1.json.planilhas[0].id]);
    expect(rows[0].import_params.loteSeparado.origem).toMatchObject({ tipo: "tag", grupo: 6 });
  }, SLOW);

  it("filtro da tela (busca 'Cliente') vale como origem, igual à tabela do Banco", async () => {
    await baseComTag();
    const r = await call("POST", "/api/leads/lotes", {
      access: DONO_T,
      body: { clientId: T, tamanho: 10, quantidade: 1, nomeBase: "Busca", origem: { tipo: "filtro", filtro: { search: "Cliente" } } },
    });
    expect(r.status).toBe(201);
    expect(await telefonesDaPlanilha(r.json.planilhas[0].id)).toEqual([cel(1), cel(2), cel(3), cel(4), cel(5)]);
  }, SLOW);

  it("origem inválida é recusada sem criar planilha; tag vazia dá zero", async () => {
    await baseComTag();
    for (const origem of [{ tipo: "xyz" }, { tipo: "tag" }, { tipo: "planilha" }, { tipo: "filtro" }, "{nao e json"]) {
      const r = await call("POST", "/api/leads/lotes", { access: DONO_T, body: { clientId: T, tamanho: 3, quantidade: 1, origem } });
      expect(r.status, JSON.stringify(origem)).toBe(400);
    }
    const vazia = await call("POST", "/api/leads/lotes", { access: DONO_T, body: { clientId: T, tamanho: 3, quantidade: 1, origem: { tipo: "tag", tag: "nao-existe" } } });
    expect(vazia.status).toBe(201);
    expect(vazia.json.planilhas).toEqual([]);
    const { rows } = await db.query("SELECT count(*)::int n FROM lead_imports");
    expect(rows[0].n).toBe(0);
  }, SLOW);
});

describe("conferir WhatsApp", () => {
  it("confere só o que falta, pelo chip da empresa, e grava no cache do disparo", async () => {
    await lead(T, cel(1));
    await lead(T, cel(2));
    await lead(T, cel(3));
    await lead(T, "5500123456789"); // inválido: nunca é perguntado
    await lead(T, cel(4));
    await confirmar(cel(4), true); // já conferido: não é perguntado de novo
    const perguntas = [];
    const checkNumbers = vi.fn(async ({ webhookUrl, webhookToken, numbers }) => {
      perguntas.push({ webhookUrl, webhookToken, numbers });
      return { results: numbers.map((n) => ({ number: n, exists: n !== cel(2), jid: `${n}@s.whatsapp.net` })), error: null };
    });
    const inicio = await iniciarConferencia(pool, { clientId: T, chipId: chipT }, { checkNumbers, pausaMs: 0, lote: 2 });
    expect(inicio).toMatchObject({ rodando: true, totalNaFila: 3, chipNome: "Comercial" });
    expect(inicio).not.toHaveProperty("controle");
    await __aguardarConferenciaParaTeste(T);

    expect(perguntas.map((p) => p.numbers)).toEqual([[cel(1), cel(2)], [cel(3)]]);
    expect(perguntas.every((p) => p.webhookToken === "segredo-do-chip" && p.webhookUrl.includes("tinge-comercial"))).toBe(true);
    const { rows } = await db.query("SELECT phone, exists_whatsapp FROM whatsapp_number_validations ORDER BY phone");
    expect(rows).toEqual([
      { phone: cel(1), exists_whatsapp: true },
      { phone: cel(2), exists_whatsapp: false },
      { phone: cel(3), exists_whatsapp: true },
      { phone: cel(4), exists_whatsapp: true },
    ]);
    expect(statusConferencia(T)).toMatchObject({ rodando: false, conferidos: 3, comWhatsapp: 2, semWhatsapp: 1, motivoFim: "concluida" });
    expect(JSON.stringify(statusConferencia(T))).not.toContain("segredo");
  }, SLOW);

  it("para sozinha depois de duas falhas seguidas e não inventa resultado", async () => {
    for (let i = 1; i <= 6; i += 1) await lead(T, cel(i));
    const checkNumbers = vi.fn(async () => ({ results: [], error: "Evolution HTTP 500" }));
    await iniciarConferencia(pool, { clientId: T, chipId: chipT }, { checkNumbers, pausaMs: 0, lote: 2 });
    await __aguardarConferenciaParaTeste(T);
    expect(checkNumbers).toHaveBeenCalledTimes(2);
    expect(statusConferencia(T)).toMatchObject({ rodando: false, motivoFim: "falhas_seguidas", conferidos: 0 });
    const { rows } = await db.query("SELECT count(*)::int n FROM whatsapp_number_validations");
    expect(rows[0].n).toBe(0);
  }, SLOW);

  it("chip de outra empresa, desconectado ou inexistente é recusado pela rota", async () => {
    await lead(T, cel(1));
    expect((await call("POST", "/api/leads/conferencia-whatsapp", { access: DONO_T, body: { clientId: T, chipId: chipO } })).status).toBe(404);
    expect((await call("POST", "/api/leads/conferencia-whatsapp", { access: DONO_T, body: { clientId: T, chipId: "00000000-0000-4000-8000-000000000000" } })).status).toBe(404);
    await db.query("UPDATE lead_client_evolution_instances SET connection_state = 'close' WHERE id = $1", [chipT]);
    const r = await call("POST", "/api/leads/conferencia-whatsapp", { access: DONO_T, body: { clientId: T, chipId: chipT } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("CHIP_DISCONNECTED");
    expect((await call("POST", "/api/leads/conferencia-whatsapp", { access: DONO_T, body: { clientId: OUTRA, chipId: chipO } })).status).toBe(403);
  }, SLOW);

  it("parar interrompe a conferência em andamento", async () => {
    for (let i = 1; i <= 6; i += 1) await lead(T, cel(i));
    const checkNumbers = vi.fn(async ({ numbers }) => ({ results: numbers.map((n) => ({ number: n, exists: true })), error: null }));
    await iniciarConferencia(pool, { clientId: T, chipId: chipT }, { checkNumbers, pausaMs: 60_000, lote: 2 });
    await vi.waitFor(() => expect(statusConferencia(T).conferidos).toBe(2));
    const parada = await call("DELETE", `/api/leads/conferencia-whatsapp?clientId=${T}`, { access: DONO_T });
    expect(parada.json.conferencia).toMatchObject({ rodando: false, motivoFim: "parada_pelo_usuario" });
    await __aguardarConferenciaParaTeste(T);
    expect(checkNumbers).toHaveBeenCalledTimes(1);
  }, SLOW);
});

describe("agente separa lotes pela porta dele", () => {
  it("separa só na empresa do token e recusa outra empresa e token inválido", async () => {
    for (let i = 1; i <= 4; i += 1) {
      await lead(T, cel(i));
      await confirmar(cel(i), true);
    }
    await lead(OUTRA, cel(20));
    await confirmar(cel(20), true);

    const previa = await call("GET", "/api/campaign-agent/lead-batches/preview", { token: TOKEN_T });
    expect(previa.status).toBe(200);
    expect(previa.json.previa.disponivel_confirmado).toBe(4);

    expect((await call("POST", "/api/campaign-agent/lead-batches", { token: TOKEN_T, body: { clientId: OUTRA, tamanho: 2, quantidade: 1 } })).status).toBe(403);
    expect((await call("GET", `/api/campaign-agent/lead-batches/preview?clientId=${OUTRA}`, { token: TOKEN_T })).status).toBe(403);
    expect((await call("POST", "/api/campaign-agent/lead-batches", { token: "x".repeat(60), body: { tamanho: 2, quantidade: 1 } })).status).toBe(401);

    const r = await call("POST", "/api/campaign-agent/lead-batches", { token: TOKEN_T, body: { tamanho: 2, quantidade: 2, nomeBase: "Tinge" } });
    expect(r.status).toBe(201);
    expect(r.json.planilhas.map((p) => p.leads)).toEqual([2, 2]);
    const { rows } = await db.query("SELECT DISTINCT client_id, uploaded_by_email FROM lead_imports");
    expect(rows).toEqual([{ client_id: T, uploaded_by_email: "agente-campanha" }]);
  }, SLOW);
});

describe("limpar números que não servem (critério 'inutilizaveis' da exclusão em massa)", () => {
  it("apaga sem WhatsApp, fixo não conferido e inválido; mantém fixo com WhatsApp, opt-out, quem conversou e outra empresa", async () => {
    const repo = createPgMassDeleteRepo();
    await lead(T, cel(1)); await confirmar(cel(1), true); // celular com WhatsApp: fica
    await lead(T, cel(2)); await confirmar(cel(2), false); // sem WhatsApp: sai
    const conversou = await lead(T, cel(3)); await confirmar(cel(3), false); // sem WhatsApp, mas já conversou: fica
    await db.query("INSERT INTO lead_messages (client_id, lead_id, phone) VALUES ($1, $2, $3)", [T, conversou, cel(3)]);
    await lead(T, "553432145678"); await confirmar("553432145678", true); // fixo com WhatsApp: fica
    await lead(T, "553432140000"); // fixo não conferido: sai
    await lead(T, "5500123456789"); // inválido: sai
    await lead(T, cel(4)); // celular ainda não conferido: fica
    await lead(T, cel(5), { optOut: true }); await confirmar(cel(5), false); // opt-out: fica sempre
    await lead(OUTRA, cel(6)); await confirmar(cel(6), false); // outra empresa: nunca

    const previa = await previaSeparacao(pool, { clientId: T });
    expect(previa).toMatchObject({ inutil_sem_whatsapp: 2, inutil_fixo_nao_conferido: 1, inutil_invalido: 1 });

    const criterio = normalizeCriterion({ type: "inutilizaveis" });
    expect(criterio.ok).toBe(true);
    const vista = await previewMassDelete(repo, pool, { clientId: T, criterion: criterio.criterion, options: {} });
    expect(vista).toMatchObject({ matched: 4, willDelete: 3, kept: 1, keptReasons: { withMessages: 1 } });

    // Contagem diferente da vista: recusa e não apaga nada.
    const errada = await executeMassDelete(repo, pool, { clientId: T, criterion: criterio.criterion, options: {}, expectedCount: 2, actor: { email: "dono@tinge.test" } });
    expect(errada.ok).toBe(false);

    const feita = await executeMassDelete(repo, pool, { clientId: T, criterion: criterio.criterion, options: {}, expectedCount: 3, actor: { email: "dono@tinge.test" } });
    expect(feita.ok).toBe(true);
    expect(feita.report.deleted).toBe(3);

    const { rows } = await db.query("SELECT client_id, regexp_replace(telefone, '\\D', '', 'g') t FROM leads ORDER BY 2");
    const restantes = rows.map((r) => `${r.client_id}:${r.t}`);
    for (const fica of [`${T}:${cel(1)}`, `${T}:${cel(3)}`, `${T}:553432145678`, `${T}:${cel(4)}`, `${T}:${cel(5)}`, `${OUTRA}:${cel(6)}`]) {
      expect(restantes).toContain(fica);
    }
    for (const sai of [`${T}:${cel(2)}`, `${T}:553432140000`, `${T}:5500123456789`]) {
      expect(restantes).not.toContain(sai);
    }
    const auditoria = await db.query("SELECT client_id, user_email, deleted, criterion->>'type' tipo FROM lead_mass_delete_audit");
    expect(auditoria.rows).toEqual([{ client_id: T, user_email: "dono@tinge.test", deleted: 3, tipo: "inutilizaveis" }]);
  }, SLOW);
});
