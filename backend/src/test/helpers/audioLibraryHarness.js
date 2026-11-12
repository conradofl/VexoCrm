// Bancada dos testes da Biblioteca de Áudios.
//
// - Banco: Postgres real em memória (pglite), com a MIGRATION DE PRODUÇÃO
//   aplicada por cima das tabelas de follow-up que ela referencia. O schema da
//   biblioteca não é reescrito no teste: é o arquivo .sql que vai para o deploy.
// - HTTP: Express de verdade escutando numa porta local, chamado com fetch. O
//   corpo binário passa pelo express.raw da rota, como em produção.
// - Storage: o provedor "local" real do storage.js (NODE_ENV=test), em disco.

import express from "express";
import { readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteDb } from "./pgliteDb.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(__dirname, "../../..");

export const AUDIO_LIBRARY_MIGRATION = readFileSync(
  resolve(BACKEND_ROOT, "supabase/migrations/20261111210000_create_audio_library.sql"),
  "utf8"
);

// Só o que a migration e as consultas da biblioteca tocam no follow-up, com os
// tipos de produção (20260526000001 e seguintes).
export const FOLLOWUP_BASE_SCHEMA = `
  CREATE TABLE public.followup_companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text,
    name text NOT NULL,
    evolution_instance text NOT NULL DEFAULT '',
    evolution_instances jsonb,
    agent_kind text NOT NULL DEFAULT 'atendimento',
    archived_at timestamptz
  );
  CREATE TABLE public.followup_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.followup_companies(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
    default_origin text,
    webhook_trigger_url text,
    webhook_secret text,
    dispatch_jitter_minutes integer NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    exit_on_reply boolean DEFAULT true,
    exit_on_won boolean DEFAULT true,
    exit_on_lost boolean DEFAULT true,
    exit_on_human_takeover boolean DEFAULT true
  );
  CREATE TABLE public.followup_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.followup_campaigns(id) ON DELETE CASCADE,
    name text NOT NULL,
    message text NOT NULL,
    trigger_type text NOT NULL,
    trigger_value integer NOT NULL DEFAULT 0,
    trigger_unit text NOT NULL DEFAULT 'hours',
    trigger_direction text,
    is_active boolean NOT NULL DEFAULT true,
    order_index integer NOT NULL DEFAULT 0,
    scheduled_time text,
    scheduled_date text,
    anchor_field text,
    media_path text,
    media_type text,
    media_mime text,
    media_filename text,
    step_type text NOT NULL DEFAULT 'message',
    action_type text,
    action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
`;

export async function createAudioLibraryDb({ withMigration = true, extraSchema = "" } = {}) {
  const db = await createPgliteDb(FOLLOWUP_BASE_SCHEMA + extraSchema);
  if (withMigration) await db.exec(AUDIO_LIBRARY_MIGRATION);
  return db;
}

/** Objeto com .query(sql, params) e .connect(), no formato que o código de produção espera de um pool. */
export function poolFor(db) {
  const client = { query: (sql, params) => db.query(sql, params), release: () => {} };
  return { query: client.query, connect: async () => client };
}

export function acessoInterno(clientIds, internalPages = ["agente", "planilhas"]) {
  return { role: "internal", isAdmin: false, scopeMode: "assigned_clients", clientIds, internalPages };
}

/**
 * Sobe um Express real com as rotas registradas por `register(app)`.
 * A identidade de cada chamada vai no header x-test-access (JSON) — o dublê de
 * requireFirebaseAuth (único middleware trocado) copia para req.authAccess.
 */
export async function startHttp(register) {
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  register(app);
  const server = await new Promise((ok) => {
    const s = app.listen(0, "127.0.0.1", () => ok(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { access, body, headers = {}, raw = false } = {}) {
    const finalHeaders = { ...headers };
    if (access) finalHeaders["x-test-access"] = JSON.stringify(access);
    let payload = body;
    if (body !== undefined && !Buffer.isBuffer(body)) {
      finalHeaders["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    } else if (Buffer.isBuffer(body) && !finalHeaders["Content-Type"]) {
      finalHeaders["Content-Type"] = "application/octet-stream";
    }
    const res = await fetch(base + path, { method, headers: finalHeaders, body: payload });
    if (raw) {
      return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* corpo não-JSON (ex.: 413 do Express) */
    }
    return { status: res.status, body: json, text };
  }

  return {
    call,
    close: () => new Promise((ok) => server.close(ok)),
  };
}

/** Dublê de requireFirebaseAuth: token Firebase não dá para verificar em teste. */
export function fakeFirebaseAuth(req, res, next) {
  const raw = req.headers["x-test-access"];
  if (!raw) return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "sem credencial" } });
  req.authAccess = JSON.parse(String(raw));
  req.authUser = { uid: "uid-teste" };
  return next();
}

/** Apaga do disco o que os testes gravaram no storage local dos tenants de teste. */
export function limparStorageDeTeste(tenants) {
  for (const tenant of tenants) {
    rmSync(resolve(BACKEND_ROOT, "storage/followup-media", encodeURIComponent(tenant)), { recursive: true, force: true });
  }
}
