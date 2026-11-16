// Gestor de Tráfego, PR 4a: origem do anúncio no lead do formulário do site.
//
// Banco: Postgres real em memória (pglite) com a MIGRATION DE PRODUÇÃO de
// lead_ad_origins. public.leads é a parte da tabela de produção que o upsert
// toca, com os tipos e a CHECK de lead_source copiados de lead-client-tables.js.
// Nada do caminho do lead é dublado: validateCapturePayload, saveCaptureLead,
// upsertLeadByPhone e recordLeadAdOrigin rodam de verdade.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { parseAdAttribution, leadSourceForAdOrigin } from "../traffic/adOrigin.js";
import { resetCaptureRateLimit, saveCaptureLead, validateCapturePayload } from "../services/leadCapture.js";
import { resetLeadsColumnsCache } from "../services/leadUpsert.js";
import { registerLeadCaptureRoutes } from "../domains/leads/captureRoutes.js";
import * as evolutionModule from "../services/evolution.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261116120000_create_lead_ad_origins.sql"),
  "utf8"
);

const LEADS_TABLE = `
  CREATE TABLE public.leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    telefone text,
    phone text,
    nome text,
    tags text[],
    dados jsonb DEFAULT '{}'::jsonb,
    status text,
    stage text,
    stage_source text,
    lost_reason text,
    lead_source text CHECK (lead_source IS NULL OR lead_source IN ('campanha', 'organico', 'trafego_pago', 'whatsapp_ads', 'indicacao', 'outro', 'extracao_whatsapp')),
    lead_origin text,
    assigned_to text,
    assigned_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
  );
  CREATE TABLE public.notifications (
    id bigserial PRIMARY KEY, client_id text, type text, title text, description text, link text
  );
`;

const TENANT = "vexo-adm";
const PHONE = "5534991112222";

const META_PAID = {
  utm_source: "fb",
  utm_medium: "paid_social",
  utm_campaign: "Diagnostico Novembro",
  campaign_id: "120210000000000001",
  adset_id: "120210000000000002",
  ad_id: "120210000000000003",
  fbclid: "IwAR0abcDEF_123-x",
  landing_path: "/diagnostico?nome=Joao&tel=34991112222#form",
  referrer: "https://l.facebook.com/l.php?u=https%3A%2F%2Fvexoia.com&h=AT0",
};

function asPool(db) {
  return { query: (sql, params) => db.query(sql, params) };
}

const answers = { company: "Empresa Teste" };

async function capture(db, attribution) {
  const validation = validateCapturePayload({
    fullName: "Joao Teste",
    phone: PHONE,
    email: "joao@teste.com",
    client_id: TENANT,
    attribution,
  });
  expect(validation.valid).toBe(true);
  const { clientId, phone, fullName, email, adOrigin } = validation.data;
  return saveCaptureLead(asPool(db), { clientId, phone, fullName, email, answers, adOrigin });
}

const leadRow = async (db) =>
  (await db.query("SELECT id, lead_source, lead_origin FROM public.leads WHERE client_id = $1", [TENANT])).rows;
const originRows = async (db) =>
  (
    await db.query(
      `SELECT client_id, lead_id, phone, channel, platform, paid, campaign_id, adset_id, ad_id,
              click_id, click_id_type, utm_source, utm_medium, utm_campaign, landing_path, referrer_host, raw
         FROM public.lead_ad_origins ORDER BY id`
    )
  ).rows;

describe("parseAdAttribution: o que conta como origem de anúncio", () => {
  it("sem parâmetro de campanha não há origem (lead fica sem registro)", () => {
    expect(parseAdAttribution(undefined)).toBeNull();
    expect(parseAdAttribution(null)).toBeNull();
    expect(parseAdAttribution([])).toBeNull();
    expect(parseAdAttribution("utm_source=fb")).toBeNull();
    expect(parseAdAttribution({})).toBeNull();
    // Página e referência sozinhas não provam anúncio.
    expect(parseAdAttribution({ landing_path: "/", referrer: "https://www.google.com/" })).toBeNull();
    expect(parseAdAttribution({ utm_source: "   ", ad_id: "" })).toBeNull();
  });

  it("anúncio da Meta com identificadores: pago, plataforma meta, ids guardados", () => {
    const origin = parseAdAttribution(META_PAID);
    expect(origin).toMatchObject({
      platform: "meta",
      paid: true,
      campaign_id: "120210000000000001",
      adset_id: "120210000000000002",
      ad_id: "120210000000000003",
      click_id: "IwAR0abcDEF_123-x",
      click_id_type: "fbclid",
      utm_source: "fb",
      utm_medium: "paid_social",
    });
    expect(leadSourceForAdOrigin(origin)).toBe("trafego_pago");
  });

  it("fbclid sozinho NÃO prova anúncio pago (o Facebook põe fbclid em post orgânico)", () => {
    const origin = parseAdAttribution({ fbclid: "IwAR0xyz" });
    expect(origin).toMatchObject({ platform: "meta", paid: false, click_id_type: "fbclid" });
    expect(leadSourceForAdOrigin(origin)).toBeUndefined();
  });

  it("utm de rede social sem mídia paga não é anúncio pago", () => {
    const origin = parseAdAttribution({ utm_source: "instagram", utm_medium: "bio" });
    expect(origin).toMatchObject({ platform: "meta", paid: false });
  });

  it("gclid prova anúncio do Google e vence o fbclid", () => {
    expect(parseAdAttribution({ gclid: "Cj0KCQiA_abc-123" })).toMatchObject({
      platform: "google",
      paid: true,
      click_id_type: "gclid",
    });
    expect(parseAdAttribution({ fbclid: "IwAR0x", gbraid: "0AAAAAp" })).toMatchObject({
      platform: "google",
      click_id_type: "gbraid",
      click_id: "0AAAAAp",
    });
  });

  it("utm_source do Google com cpc: pago, plataforma google", () => {
    expect(parseAdAttribution({ utm_source: "google", utm_medium: "cpc" })).toMatchObject({ platform: "google", paid: true });
    expect(parseAdAttribution({ utm_source: "newsletter", utm_medium: "email" })).toMatchObject({ platform: null, paid: false });
  });

  it("identificador que não é número não entra na coluna nem vira prova de anúncio", () => {
    const origin = parseAdAttribution({ utm_source: "fb", ad_id: "Anuncio Verao", campaign_id: "{{campaign.id}}" });
    expect(origin).toMatchObject({ ad_id: null, campaign_id: null, paid: false });
    expect(origin.raw).toEqual({ utm_source: "fb" });
  });

  it("guarda só o caminho e o domínio: consulta da URL e referência completa ficam de fora", () => {
    const origin = parseAdAttribution(META_PAID);
    expect(origin.landing_path).toBe("/diagnostico");
    expect(origin.referrer_host).toBe("l.facebook.com");
    expect(parseAdAttribution({ utm_source: "fb", referrer: "javascript:alert(1)" }).referrer_host).toBeNull();
    expect(parseAdAttribution({ utm_source: "fb", landing_path: "diagnostico" }).landing_path).toBeNull();
  });

  it("limpa caractere de controle, corta texto longo e ignora chave fora da lista", () => {
    const origin = parseAdAttribution({
      utm_campaign: `Black\u0000Friday\n${"x".repeat(500)}`,
      email: "vazamento@teste.com",
      gclid: "abc<script>",
    });
    expect(origin.utm_campaign.startsWith("BlackFriday")).toBe(true);
    expect(origin.utm_campaign.length).toBe(200);
    expect(origin.click_id).toBeNull();
    expect(Object.keys(origin.raw)).toEqual(["utm_campaign"]);
  });
});

describe("formulário do site grava a origem do anúncio (Postgres real)", () => {
  let db;
  beforeEach(async () => {
    resetLeadsColumnsCache();
    db = await createPgliteDb(LEADS_TABLE);
    await db.exec(MIGRATION);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  it("anúncio pago: lead nasce trafego_pago e a origem fica ligada ao lead", async () => {
    const result = await capture(db, META_PAID);
    expect(result).toEqual({ action: "inserted", adOriginRecorded: true });

    const leads = await leadRow(db);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ lead_source: "trafego_pago", lead_origin: "diagnostico-site" });

    expect(await originRows(db)).toEqual([
      {
        client_id: TENANT,
        lead_id: leads[0].id,
        phone: PHONE,
        channel: "site",
        platform: "meta",
        paid: true,
        campaign_id: "120210000000000001",
        adset_id: "120210000000000002",
        ad_id: "120210000000000003",
        click_id: "IwAR0abcDEF_123-x",
        click_id_type: "fbclid",
        utm_source: "fb",
        utm_medium: "paid_social",
        utm_campaign: "Diagnostico Novembro",
        landing_path: "/diagnostico",
        referrer_host: "l.facebook.com",
        raw: {
          utm_source: "fb",
          utm_medium: "paid_social",
          utm_campaign: "Diagnostico Novembro",
          campaign_id: "120210000000000001",
          adset_id: "120210000000000002",
          ad_id: "120210000000000003",
          fbclid: "IwAR0abcDEF_123-x",
        },
      },
    ]);
  });

  it("sem parâmetro de campanha: lead sem origem (nada de 'organico' inventado) e nenhuma linha de origem", async () => {
    const result = await capture(db, undefined);
    expect(result).toEqual({ action: "inserted", adOriginRecorded: false });
    expect((await leadRow(db))[0].lead_source).toBeNull();
    expect(await originRows(db)).toEqual([]);
  });

  it("fbclid orgânico: origem registrada como não paga e lead_source intocado", async () => {
    await capture(db, { fbclid: "IwAR0organico" });
    expect((await leadRow(db))[0].lead_source).toBeNull();
    expect(await originRows(db)).toMatchObject([{ platform: "meta", paid: false, click_id_type: "fbclid" }]);
  });

  it("lead que já existia mantém a origem dele quando o formulário chega sem anúncio", async () => {
    await db.query(
      `INSERT INTO public.leads (client_id, telefone, phone, nome, lead_source) VALUES ($1, $2, $2, 'Joao Antigo', 'campanha')`,
      [TENANT, PHONE]
    );
    const result = await capture(db, undefined);
    expect(result.action).toBe("updated");
    expect(await leadRow(db)).toMatchObject([{ lead_source: "campanha" }]);
  });

  it("apagar o lead apaga a origem dele (LGPD)", async () => {
    await capture(db, META_PAID);
    await db.query("DELETE FROM public.leads WHERE client_id = $1", [TENANT]);
    expect(await originRows(db)).toEqual([]);
  });

  it("CHECK do banco recusa canal e plataforma fora da lista", async () => {
    await expect(
      db.query(`INSERT INTO public.lead_ad_origins (client_id, phone, channel) VALUES ('x', '1', 'email')`)
    ).rejects.toThrow(/lead_ad_origins_channel_check/);
    await expect(
      db.query(`INSERT INTO public.lead_ad_origins (client_id, phone, channel, platform) VALUES ('x', '1', 'site', 'tiktok')`)
    ).rejects.toThrow(/lead_ad_origins_platform_check/);
  });
});

describe("rota pública POST /api/public/leads/capture leva a origem até o banco", () => {
  let db;
  beforeEach(async () => {
    resetLeadsColumnsCache();
    resetCaptureRateLimit();
    db = await createPgliteDb(LEADS_TABLE);
    await db.exec(MIGRATION);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  it("corpo com attribution vira linha de origem ligada ao lead", async () => {
    // Dublado só o que sai do processo: o envio pelo WhatsApp.
    vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockResolvedValue({ ok: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const routes = {};
    registerLeadCaptureRoutes(
      { post: (path, ...handlers) => (routes[path] = handlers[handlers.length - 1]) },
      {
        pgDatabasePool: asPool(db),
        sendError: (res, status, code, message) => res.status(status).json({ error: code, message }),
      }
    );
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    await routes["/api/public/leads/capture"](
      {
        headers: { "x-forwarded-for": "10.9.9.9" },
        body: { fullName: "Maria Rota", phone: PHONE, email: "maria@teste.com", client_id: TENANT, attribution: META_PAID },
      },
      res
    );
    // Auto-resposta e alerta ao dono correm em segundo plano; espera assentarem antes de fechar o banco.
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));

    expect(res.statusCode).toBe(200);
    const leads = await leadRow(db);
    expect(leads).toMatchObject([{ lead_source: "trafego_pago" }]);
    expect(await originRows(db)).toMatchObject([{ lead_id: leads[0].id, ad_id: "120210000000000003", paid: true }]);
  });
});

describe("código novo com banco antigo (deploy antes da migration)", () => {
  let db;
  beforeEach(async () => {
    resetLeadsColumnsCache();
    db = await createPgliteDb(LEADS_TABLE); // sem a migration
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  it("o lead é salvo mesmo assim; a origem perdida fica no log, sem derrubar a captura", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await capture(db, META_PAID);
    expect(result).toEqual({ action: "inserted", adOriginRecorded: false });
    expect(await leadRow(db)).toMatchObject([{ lead_source: "trafego_pago" }]);
    expect(warn.mock.calls.some((call) => String(call[0]).includes("[leadCapture] origem do anúncio não gravada"))).toBe(true);
  });
});
