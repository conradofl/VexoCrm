// backend/src/test/campaignQueueClaim.test.js
//
// "Próximo da fila" (startNextCampaignLeadInQueue, dívida DT-001) mandava o passo 1 duas vezes para o MESMO lead.
// Flagrado no log de produção (29/10/2026, campanha a1df2aa2): mesmo stepId, mesmo telefone, duas execuções, as duas
// com status 201. A escolha era "primeiro lead sem progresso" e o progresso só era gravado DEPOIS do envio — sem claim,
// duas execuções concorrentes escolhiam o mesmo lead. Cada uma sorteia a variação de texto, por isso chegavam frases
// diferentes. O caminho também não deixava rastro: nem campaign_dispatch_runs nem lead_messages.
//
// Postgres REAL (pglite), envio capturado no fetch. O que se garante:
// - duas chamadas concorrentes nunca enviam ao mesmo lead (a segunda cai no próximo candidato)
// - lead que o lote já reivindicou/enviou (run da campanha) não é pego pela fila
// - envio que não saiu devolve o claim: o lead continua elegível
// - envio feito pela fila fica gravado em lead_messages (meta.source = campaign_queue)

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";

vi.mock("../campaign/settings.js", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveCampaignDispatchSettings: async () => ({
    webhookUrl: "http://evolution.test/message/sendText/chip-teste",
    webhookToken: "token-teste",
    source: "teste",
  }),
}));
vi.mock("../services/evolution.js", async (importOriginal) => ({
  ...(await importOriginal()),
  checkEvolutionInstanceHealth: async () => ({ state: "open" }),
  getLeadClientEvolutionInstances: async () => [],
  resolveInstanceIdentifier: async ({ identifier }) => ({ canonicalName: identifier || null }),
}));

const T = "tenant-fila";
const CAMP = "aaaaaaaa-0000-4000-8000-000000000001";
const IMP = "bbbbbbbb-0000-4000-8000-000000000002";
const DISP = "cccccccc-0000-4000-8000-000000000003";
const ITEM = (n) => `dddddddd-0000-4000-8000-00000000000${n}`;
const FONE = (n) => `553499000000${n}`; // 13 dígitos: já no formato normalizado do envio
const STEP = { id: "passo-1", type: "text", text: "Oi, como vai?", order: 1, enabled: true, delayAfterSeconds: 0 };

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, telefone TEXT, nome TEXT,
    opt_out BOOLEAN DEFAULT false, metadata JSONB DEFAULT '{}'::jsonb, dados JSONB DEFAULT '{}'::jsonb,
    ultima_interacao_bot TIMESTAMPTZ, status_conversa TEXT, ultima_interacao_usuario TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.lead_import_items (
    id UUID PRIMARY KEY, import_id UUID, client_id TEXT NOT NULL, lead_id UUID, telefone TEXT, imported BOOLEAN DEFAULT true,
    normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb, status_conversa TEXT, ultima_interacao_bot TIMESTAMPTZ,
    ultima_interacao_usuario TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaign_dispatch_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id UUID NOT NULL, campaign_id UUID NOT NULL, client_id TEXT NOT NULL,
    phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lead_id UUID, claimed_at TIMESTAMPTZ, lead_import_item_id UUID
  );
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.lead_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, lead_id UUID, campaign_id UUID, phone TEXT,
    sender_type TEXT, direction TEXT, engagement_signal TEXT, message_text TEXT, delivered_at TIMESTAMPTZ,
    message_timestamp TIMESTAMPTZ, meta JSONB DEFAULT '{}'::jsonb, instance_name TEXT, wa_message_id TEXT, media_path TEXT,
    media_url TEXT, content_type TEXT, dispatch_id UUID
  );
`;

// pglite leva dezenas de segundos para subir: um banco por arquivo, tabelas limpas a cada caso.
vi.setConfig({ testTimeout: 180_000 });
let dbCompartilhado;
beforeAll(async () => {
  dbCompartilhado = await createPgliteDb(SCHEMA);
}, 180_000);
let fetchOriginal;
let enviados;
let respostaDoEnvio;
let spies = [];
let timeoutOriginal;

beforeEach(() => {
  enviados = [];
  respostaDoEnvio = () => ({ ok: true, status: 201, text: async () => '{"key":{"id":"wa"}}' });
  fetchOriginal = globalThis.fetch;
  timeoutOriginal = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => timeoutOriginal(fn, ms >= 1000 ? 0 : ms, ...args);
  globalThis.fetch = vi.fn(async (url, init) => {
    if (/sendText/.test(String(url))) {
      enviados.push(String(JSON.parse(init?.body || "{}").number || ""));
      // o envio demora: é a janela em que a segunda execução enxerga o lead ainda "sem progresso"
      await new Promise((r) => timeoutOriginal(r, 25));
      return respostaDoEnvio();
    }
    return { ok: true, status: 200, text: async () => "[]", json: async () => [] };
  });
  spies = ["log", "info", "warn", "error"].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  globalThis.setTimeout = timeoutOriginal;
  spies.forEach((s) => s.mockRestore());
});
afterAll(async () => {
  _setPgDatabasePoolForTesting(null);
  if (dbCompartilhado) await dbCompartilhado.close();
});

async function mundo({ leads = 3 } = {}) {
  const db = dbCompartilhado;
  await db.exec("TRUNCATE public.leads, public.lead_import_items, public.campaign_dispatch_runs, public.lead_messages, public.leads_clients");
  await db.query("INSERT INTO public.leads_clients (id, name) VALUES ($1, 'Fila')", [T]);
  const pool = { query: (sql, params) => db.query(sql, params) };
  _setPgDatabasePoolForTesting(pool);
  for (let n = 1; n <= leads; n += 1) {
    await db.query(
      `INSERT INTO public.lead_import_items (id, import_id, client_id, telefone, created_at)
       VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval)`,
      [ITEM(n), IMP, T, FONE(n), String(n)]
    );
  }
  const { startNextCampaignLeadInQueue } = await import("../campaign/dispatch.js");
  const campaign = {
    id: CAMP,
    name: "Fila",
    client_id: T,
    import_id: IMP,
    limit_per_run: 50,
    analytics_meta: { sequence: [STEP], dispatchOptions: { waitForReply: true }, message: "Oi" },
  };
  const progressoDe = async (n) => {
    const { rows } = await db.query("SELECT normalized_data->'campaign_progress'->$2 AS p FROM public.lead_import_items WHERE id = $1", [ITEM(n), CAMP]);
    return rows[0]?.p ?? null;
  };
  return { db, campaign, startNext: startNextCampaignLeadInQueue, progressoDe };
}

describe("fila de leads por resposta — claim antes de enviar", () => {
  it("duas chamadas concorrentes não enviam ao mesmo lead (a segunda cai no próximo)", async () => {
    const { campaign, startNext } = await mundo();
    const [a, b] = await Promise.all([
      startNext({ campaign, clientId: T, repliedAt: "2026-10-29T14:00:00Z" }),
      startNext({ campaign, clientId: T, repliedAt: "2026-10-29T14:00:00Z" }),
    ]);
    expect(a.started).toBe(true);
    expect(b.started).toBe(true);
    expect(enviados).toHaveLength(2);
    expect(new Set(enviados).size).toBe(2); // telefones distintos: nenhum lead recebeu duas vezes
  });

  it("lead que o lote já enviou (run da campanha) não é pego pela fila", async () => {
    const { db, campaign, startNext } = await mundo();
    await db.query(
      `INSERT INTO public.campaign_dispatch_runs (dispatch_id, campaign_id, client_id, phone, status, lead_import_item_id)
       VALUES ($1, $2, $3, $4, 'claimed', $5)`,
      [DISP, CAMP, T, FONE(1), ITEM(1)]
    );
    const res = await startNext({ campaign, clientId: T });
    expect(res.started).toBe(true);
    expect(enviados).toEqual([FONE(2)]); // pulou o lead 1, que o lote está enviando
  });

  it("envio que não saiu devolve o claim: o lead continua elegível", async () => {
    const { campaign, startNext, progressoDe } = await mundo({ leads: 1 });
    respostaDoEnvio = () => ({ ok: false, status: 500, text: async () => "erro" });
    const falhou = await startNext({ campaign, clientId: T });
    expect(falhou.started).toBe(false);
    expect(await progressoDe(1)).toBeNull();
    respostaDoEnvio = () => ({ ok: true, status: 201, text: async () => "{}" });
    const depois = await startNext({ campaign, clientId: T });
    expect(depois.started).toBe(true);
    expect(enviados).toEqual([FONE(1), FONE(1)]); // 1ª falhou (nada entregue), 2ª entregou
  });

  it("o envio da fila fica gravado em lead_messages com a origem campaign_queue", async () => {
    const { db, campaign, startNext } = await mundo({ leads: 1 });
    await startNext({ campaign, clientId: T });
    const { rows } = await db.query("SELECT message_text, direction, sender_type, meta FROM public.lead_messages WHERE client_id = $1", [T]);
    expect(rows).toHaveLength(1);
    expect(rows[0].message_text).toBe("Oi, como vai?");
    expect(rows[0].direction).toBe("outbound");
    expect(rows[0].meta.source).toBe("campaign_queue");
    expect(rows[0].meta.stepId).toBe("passo-1");
  });
});
