// Coletor do Google Ads (SPEC-GESTOR-TRAFEGO-FASE1, 5.2).
// Banco real (pglite com a migration de produção). Dublado só o fetch: o
// servidor de autorização do Google e a API do Google Ads. Cliente, coletor e
// upsert são os de produção.

import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTrafficCollection } from "../traffic/collector.js";
import {
  getGoogleAdsCredentials,
  isGoogleAdsConnected,
  mapGoogleAdsRow,
  normalizeGoogleCustomerId,
  summarizeGoogleConversions,
} from "../traffic/googleAdsClient.js";
import { createTrafficDb, insertAccount, insightRow, poolFor } from "./helpers/trafficHarness.js";

const REFRESH = "refresh-de-teste-nao-e-segredo";
const SECRET = "client-secret-de-teste";
const ACCESS = "access-token-de-teste";
const ENV = { GOOGLE_ADS_CLIENT_ID: "cid.apps", GOOGLE_ADS_CLIENT_SECRET: SECRET, GOOGLE_ADS_REFRESH_TOKEN: REFRESH };
const TENANT_A = "teste-google-a";
const TENANT_B = "teste-google-b";
const NOW = new Date("2026-11-15T13:00:00.000Z");
const noSleep = async () => {};

function googleRow({ adId, date, costMicros = "10000000", impressions = "1000", clicks = "20", status = "ENABLED", campaignId = "900", adGroupId = "800", adName = null }) {
  return {
    campaign: { id: campaignId, name: `Campanha ${campaignId}`, advertisingChannelType: "SEARCH" },
    adGroup: { id: adGroupId, name: `Grupo ${adGroupId}` },
    adGroupAd: { ad: { id: adId, ...(adName ? { name: adName } : {}), type: "RESPONSIVE_SEARCH_AD" }, status },
    segments: { date },
    metrics: { costMicros, impressions, clicks, conversions: 0, conversionsValue: 0 },
  };
}
function conversionRow({ adId, date, category, conversions, value = 0 }) {
  return { adGroupAd: { ad: { id: adId } }, segments: { date, conversionActionCategory: category }, metrics: { conversions, conversionsValue: value } };
}

/**
 * Dublê do fetch: servidor de autorização + googleAds:search.
 * accounts[customerId] = { info, metrics, conversions }.
 */
function createGoogleFetch(accounts, { tokenResponse, onSearch } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, init, body: init?.body };
    calls.push(call);
    const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

    if (url === "https://oauth2.googleapis.com/token") {
      call.kind = "token";
      const t = tokenResponse || { status: 200, body: { access_token: ACCESS, expires_in: 3599, token_type: "Bearer" } };
      return respond(t.status, t.body);
    }

    const match = url.match(/^https:\/\/googleads\.googleapis\.com\/(v\d+)\/customers\/(\d+)\/googleAds:search$/);
    if (!match) return respond(404, { error: { code: 404, message: "not found", status: "NOT_FOUND" } });
    call.kind = "search";
    call.version = match[1];
    call.customerId = match[2];
    call.json = JSON.parse(init.body);
    if (onSearch) {
      const custom = await onSearch(call);
      if (custom) return respond(custom.status ?? 200, custom.body);
    }

    const account = accounts[call.customerId];
    if (!account) {
      return respond(403, { error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" } });
    }
    const query = call.json.query;
    if (query.includes("FROM customer")) {
      return respond(200, { results: [{ customer: account.info || { descriptiveName: "Conta Google", currencyCode: "BRL", timeZone: "America/Sao_Paulo" } }] });
    }
    if (query.includes("conversion_action_category")) return respond(200, { results: account.conversions || [] });
    return respond(200, { results: account.metrics || [], fieldMask: "x" });
  };
  return { fetchImpl, calls };
}

describe("coletor de tráfego do Google Ads", () => {
  let db;
  let pool;

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    db = await createTrafficDb();
    pool = poolFor(db);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  const metrics = async (clientId) =>
    (
      await db.query(
        `SELECT platform, external_account_id, campaign_id, adset_id, adset_name, ad_id, ad_name, objective, effective_status,
                date::text AS date, spend::text AS spend, impressions::int AS impressions, clicks::int AS clicks,
                leads, messages_started, purchases, purchase_value::text AS purchase_value
           FROM traffic_metrics_daily WHERE client_id = $1 ORDER BY platform, ad_id, date`,
        [clientId]
      )
    ).rows;
  const account = async (id) => (await db.query("SELECT * FROM traffic_accounts WHERE id = $1", [id])).rows[0];
  const run = async (google, { env = ENV, now = NOW } = {}) => {
    const summary = await runTrafficCollection({ pool, now, env, fetchImpl: google.fetchImpl, sleep: noSleep });
    return { summary, calls: google.calls };
  };

  it("primeira carga: lê 30 dias por GAQL, converte milionésimos em reais e grava na mesma tabela da Meta", async () => {
    const acc = await insertAccount(db, { clientId: TENANT_A, externalAccountId: "1234567890", platform: "google" });
    const { summary, calls } = await run(
      createGoogleFetch({
        1234567890: {
          info: { descriptiveName: "GD Google", currencyCode: "BRL", timeZone: "America/Sao_Paulo" },
          metrics: [
            googleRow({ adId: "555", date: "2026-11-14", costMicros: "123450000", impressions: "5000", clicks: "80", adName: "Anúncio de pesquisa" }),
            googleRow({ adId: "556", date: "2026-11-14", costMicros: "500000", status: "PAUSED" }),
          ],
          conversions: [
            conversionRow({ adId: "555", date: "2026-11-14", category: "SUBMIT_LEAD_FORM", conversions: 4 }),
            conversionRow({ adId: "555", date: "2026-11-14", category: "PHONE_CALL_LEAD", conversions: 3 }),
            conversionRow({ adId: "555", date: "2026-11-14", category: "PAGE_VIEW", conversions: 250 }),
            conversionRow({ adId: "555", date: "2026-11-14", category: "PURCHASE", conversions: 2, value: 899.9 }),
          ],
        },
      })
    );

    expect(summary.google).toMatchObject({ connected: true, accounts: 1, ok: 1, failed: 0 });
    expect(summary.meta).toMatchObject({ connected: false, accounts: 0 });
    expect(await metrics(TENANT_A)).toEqual([
      {
        platform: "google", external_account_id: "1234567890", campaign_id: "900", adset_id: "800", adset_name: "Grupo 800",
        ad_id: "555", ad_name: "Anúncio de pesquisa", objective: "SEARCH", effective_status: "ACTIVE", date: "2026-11-14",
        spend: "123.45", impressions: 5000, clicks: 80, leads: 7, messages_started: 0, purchases: 2, purchase_value: "899.90",
      },
      {
        platform: "google", external_account_id: "1234567890", campaign_id: "900", adset_id: "800", adset_name: "Grupo 800",
        ad_id: "556", ad_name: null, objective: "SEARCH", effective_status: "PAUSED", date: "2026-11-14",
        spend: "0.50", impressions: 1000, clicks: 20, leads: 0, messages_started: 0, purchases: 0, purchase_value: "0.00",
      },
    ]);

    const search = calls.filter((c) => c.kind === "search");
    expect(search.map((c) => c.version)).toEqual(["v26", "v26", "v26"]);
    const metricsQuery = search.find((c) => c.json.query.includes("metrics.cost_micros")).json.query;
    expect(metricsQuery).toContain("FROM ad_group_ad");
    expect(metricsQuery).toContain("segments.date BETWEEN '2026-10-17' AND '2026-11-15'");

    // Categoria que não é lead nem compra não some: fica guardada na linha bruta.
    const raw = (await db.query("SELECT raw FROM traffic_metrics_daily WHERE ad_id = '555'")).rows[0].raw;
    expect(raw.conversionsByCategory).toEqual({ SUBMIT_LEAD_FORM: 4, PHONE_CALL_LEAD: 3, PAGE_VIEW: 250, PURCHASE: 2 });

    const saved = await account(acc.id);
    expect(saved).toMatchObject({ display_name: "GD Google", currency: "BRL", timezone: "America/Sao_Paulo", last_sync_error: null });
    expect(saved.last_sync_at.toISOString()).toBe(NOW.toISOString());
  });

  it("um token por coleta, no cabeçalho; credencial só vai ao servidor de autorização; sem token de desenvolvedor", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "1234567890", platform: "google" });
    await insertAccount(db, { clientId: TENANT_B, externalAccountId: "2222222222", platform: "google" });
    const { calls } = await run(createGoogleFetch({ 1234567890: {}, 2222222222: {} }), {
      env: { ...ENV, GOOGLE_ADS_LOGIN_CUSTOMER_ID: "999-888-7777" },
    });

    const tokenCalls = calls.filter((c) => c.kind === "token");
    expect(tokenCalls.length).toBe(1);
    expect(Object.fromEntries(new URLSearchParams(tokenCalls[0].body))).toEqual({
      grant_type: "refresh_token", client_id: "cid.apps", client_secret: SECRET, refresh_token: REFRESH,
    });

    const search = calls.filter((c) => c.kind === "search");
    expect(search.length).toBe(6);
    for (const call of search) {
      expect(call.init.headers.Authorization).toBe(`Bearer ${ACCESS}`);
      expect(call.init.headers["login-customer-id"]).toBe("9998887777");
      expect(Object.keys(call.init.headers).map((h) => h.toLowerCase())).not.toContain("developer-token");
      expect(call.url + call.body).not.toContain(REFRESH);
      expect(call.url + call.body).not.toContain(SECRET);
      // A API é só de leitura aqui: nenhum caminho de alteração.
      expect(call.url).toMatch(/googleAds:search$/);
    }
  });

  it("sem conta gerenciadora configurada, não manda login-customer-id", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "1234567890", platform: "google" });
    const { calls } = await run(createGoogleFetch({ 1234567890: {} }));
    for (const call of calls.filter((c) => c.kind === "search")) {
      expect(call.init.headers["login-customer-id"]).toBeUndefined();
    }
  });

  it("conta de serviço: assina o pedido com a chave privada, com o escopo do Google Ads", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "1234567890", platform: "google" });

    const { summary, calls } = await run(createGoogleFetch({ 1234567890: {} }), {
      // Como chega de variável de ambiente: quebras de linha viram \n literal.
      env: { GOOGLE_ADS_SERVICE_ACCOUNT_EMAIL: "coletor@projeto.iam.gserviceaccount.com", GOOGLE_ADS_SERVICE_ACCOUNT_PRIVATE_KEY: pem.replace(/\n/g, "\\n") },
    });
    expect(summary.google.ok).toBe(1);

    const params = new URLSearchParams(calls.find((c) => c.kind === "token").body);
    expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [header, claims, signature] = params.get("assertion").split(".");
    expect(crypto.createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, signature, "base64url")).toBe(true);
    const decoded = JSON.parse(Buffer.from(claims, "base64url").toString());
    expect(decoded).toMatchObject({
      iss: "coletor@projeto.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/adwords",
      aud: "https://oauth2.googleapis.com/token",
      iat: Math.floor(NOW.getTime() / 1000),
    });
    expect(decoded.exp - decoded.iat).toBe(3600);
  });

  it("sem credencial o Google fica não conectado: nenhuma chamada, nenhum erro, nenhum número", async () => {
    const acc = await insertAccount(db, { clientId: TENANT_A, externalAccountId: "1234567890", platform: "google" });
    // Credencial pela metade é como não ter.
    const { summary, calls } = await run(createGoogleFetch({ 1234567890: {} }), {
      env: { GOOGLE_ADS_CLIENT_ID: "cid", GOOGLE_ADS_REFRESH_TOKEN: REFRESH },
    });

    expect(summary.google).toEqual({ connected: false, accounts: 0, ok: 0, failed: 0, results: [] });
    expect(calls.length).toBe(0);
    const saved = await account(acc.id);
    expect(saved).toMatchObject({ last_sync_error: null, last_sync_at: null, last_sync_attempt_at: null });
    expect(await metrics(TENANT_A)).toEqual([]);
  });

  it("credencial recusada vira erro registrado na conta, sem vazar segredo nem o corpo da resposta", async () => {
    const acc = await insertAccount(db, { clientId: TENANT_A, externalAccountId: "1234567890", platform: "google" });
    const { summary } = await run(
      createGoogleFetch({ 1234567890: {} }, { tokenResponse: { status: 400, body: { error: "invalid_grant", error_description: `Token ${REFRESH} has been expired or revoked.` } } })
    );

    expect(summary.google.failed).toBe(1);
    const saved = await account(acc.id);
    expect(saved.last_sync_error).toBe("Google recusou a credencial de acesso (invalid_grant).");
    expect(saved.last_sync_at).toBeNull();
  });

  it("falha de coleta não vira zero: guarda o erro, não avança last_sync_at e mantém o dado anterior", async () => {
    const acc = await insertAccount(db, { clientId: TENANT_A, externalAccountId: "1234567890", platform: "google" });
    await run(createGoogleFetch({ 1234567890: { metrics: [googleRow({ adId: "555", date: "2026-11-14", costMicros: "100000000" })] } }));

    const depois = new Date("2026-11-15T19:00:00.000Z");
    const { summary } = await run(createGoogleFetch({}), { now: depois });

    expect(summary.google).toMatchObject({ ok: 0, failed: 1 });
    const saved = await account(acc.id);
    expect(saved.last_sync_error).toBe("Google Ads recusou a leitura: The caller does not have permission (PERMISSION_DENIED)");
    expect(saved.last_sync_at.toISOString()).toBe(NOW.toISOString());
    expect(saved.last_sync_attempt_at.toISOString()).toBe(depois.toISOString());
    expect((await metrics(TENANT_A)).map((r) => r.spend)).toEqual(["100.00"]);
  });

  it("falha na leitura das conversões não grava a conta pela metade", async () => {
    const acc = await insertAccount(db, { clientId: TENANT_A, externalAccountId: "1234567890", platform: "google" });
    const { summary } = await run(
      createGoogleFetch(
        { 1234567890: { metrics: [googleRow({ adId: "555", date: "2026-11-14" })] } },
        {
          onSearch: (call) =>
            call.json.query.includes("conversion_action_category")
              ? { status: 400, body: { error: { code: 400, message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT" } } }
              : null,
        }
      )
    );

    expect(summary.google.failed).toBe(1);
    expect(await metrics(TENANT_A)).toEqual([]);
    expect((await account(acc.id)).last_sync_at).toBeNull();
  });

  it("coletas seguintes releem 7 dias e o número revisado substitui o antigo", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "1234567890", platform: "google" });
    await run(createGoogleFetch({ 1234567890: { metrics: [googleRow({ adId: "555", date: "2026-11-14", costMicros: "100000000" })] } }));
    const { calls } = await run(
      createGoogleFetch({ 1234567890: { metrics: [googleRow({ adId: "555", date: "2026-11-14", costMicros: "104300000" })] } }),
      { now: new Date("2026-11-15T19:00:00.000Z") }
    );

    expect(calls.find((c) => c.json?.query.includes("metrics.cost_micros")).json.query).toContain("BETWEEN '2026-11-09' AND '2026-11-15'");
    expect((await metrics(TENANT_A)).map((r) => r.spend)).toEqual(["104.30"]);
  });

  it("paginação segue nextPageToken até acabar", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "1234567890", platform: "google" });
    const { calls } = await run(
      createGoogleFetch(
        { 1234567890: {} },
        {
          onSearch: (call) => {
            if (!call.json.query.includes("metrics.cost_micros")) return null;
            return call.json.pageToken === "PAG2"
              ? { body: { results: [googleRow({ adId: "555", date: "2026-11-14" })] } }
              : { body: { results: [googleRow({ adId: "555", date: "2026-11-13" })], nextPageToken: "PAG2" } };
          },
        }
      )
    );

    expect(calls.filter((c) => c.json?.query.includes("metrics.cost_micros")).map((c) => c.json.pageToken)).toEqual([undefined, "PAG2"]);
    expect((await metrics(TENANT_A)).map((r) => r.date)).toEqual(["2026-11-13", "2026-11-14"]);
  });

  it("limite de requisições: espera e tenta de novo, no máximo 3 vezes; erro definitivo não repete", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "1234567890", platform: "google" });
    const waits = [];
    const sleep = async (ms) => {
      waits.push(ms);
    };
    const quota = { status: 429, body: { error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" } } };

    let google = createGoogleFetch({ 1234567890: {} }, { onSearch: () => quota });
    let summary = await runTrafficCollection({ pool, now: NOW, env: ENV, fetchImpl: google.fetchImpl, sleep });
    expect(summary.google.failed).toBe(1);
    expect(google.calls.filter((c) => c.kind === "search").length).toBe(3);
    expect(waits).toEqual([2000, 8000]);

    waits.length = 0;
    google = createGoogleFetch({});
    summary = await runTrafficCollection({ pool, now: NOW, env: ENV, fetchImpl: google.fetchImpl, sleep });
    expect(google.calls.filter((c) => c.kind === "search").length).toBe(1);
    expect(waits).toEqual([]);
  });

  it("Meta e Google na mesma rodada: cada conta pela sua plataforma, cada linha com a sua empresa", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111", platform: "meta" });
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "1234567890", platform: "google" });
    await insertAccount(db, { clientId: TENANT_B, externalAccountId: "2222222222", platform: "google" });

    const google = createGoogleFetch({
      1234567890: { metrics: [googleRow({ adId: "555", date: "2026-11-14", costMicros: "10000000" })] },
      2222222222: { metrics: [googleRow({ adId: "555", date: "2026-11-14", costMicros: "99000000" })] },
    });
    const fetchImpl = async (url, init) => {
      if (!url.startsWith("https://graph.facebook.com/")) return google.fetchImpl(url, init);
      const path = new URL(url).pathname.split("/").slice(2).join("/");
      const body =
        path === "act_111" ? { name: "Meta A", currency: "BRL", timezone_name: "America/Sao_Paulo" }
        : path === "act_111/insights" ? { data: [insightRow({ adId: "555", date: "2026-11-14", spend: "7.00" })] }
        : { data: [] };
      return { ok: true, status: 200, json: async () => body };
    };

    const summary = await runTrafficCollection({
      pool, now: NOW, env: { ...ENV, META_ADS_ACCESS_TOKEN: "t" }, fetchImpl, sleep: noSleep,
    });
    expect(summary.meta).toMatchObject({ connected: true, accounts: 1, ok: 1 });
    expect(summary.google).toMatchObject({ connected: true, accounts: 2, ok: 2 });

    // Mesmo identificador de anúncio nas duas plataformas e nas duas empresas: três linhas distintas.
    expect((await metrics(TENANT_A)).map((r) => [r.platform, r.external_account_id, r.spend])).toEqual([
      ["google", "1234567890", "10.00"],
      ["meta", "111", "7.00"],
    ]);
    expect((await metrics(TENANT_B)).map((r) => [r.platform, r.external_account_id, r.spend])).toEqual([["google", "2222222222", "99.00"]]);
  });
});

describe("peças do cliente do Google Ads", () => {
  it("identificador de conta: 10 dígitos, com ou sem hífens", () => {
    expect(normalizeGoogleCustomerId("123-456-7890")).toBe("1234567890");
    expect(normalizeGoogleCustomerId(" 1234567890 ")).toBe("1234567890");
    for (const ruim of ["", "123456789", "12345678901", "123456789a", "1234567890/x", null]) {
      expect(() => normalizeGoogleCustomerId(ruim)).toThrow("inválido");
    }
  });

  it("credencial só vale completa; conta de serviço tem preferência", () => {
    expect(isGoogleAdsConnected({})).toBe(false);
    expect(isGoogleAdsConnected({ GOOGLE_ADS_CLIENT_ID: "a", GOOGLE_ADS_CLIENT_SECRET: "b" })).toBe(false);
    expect(isGoogleAdsConnected({ GOOGLE_ADS_SERVICE_ACCOUNT_EMAIL: "a@b" })).toBe(false);
    expect(getGoogleAdsCredentials(ENV).type).toBe("refresh_token");
    expect(
      getGoogleAdsCredentials({ ...ENV, GOOGLE_ADS_SERVICE_ACCOUNT_EMAIL: "a@b", GOOGLE_ADS_SERVICE_ACCOUNT_PRIVATE_KEY: "k" }).type
    ).toBe("service_account");
  });

  it("linha sem anúncio ou sem data é descartada", () => {
    expect(mapGoogleAdsRow({ segments: { date: "2026-11-14" }, metrics: {} })).toBeNull();
    expect(mapGoogleAdsRow({ adGroupAd: { ad: { id: "1" } }, metrics: {} })).toBeNull();
    expect(mapGoogleAdsRow(null)).toBeNull();
  });

  it("custo aceita número ou texto; conversão fracionada é arredondada só no total", () => {
    const conversions = summarizeGoogleConversions([
      conversionRow({ adId: "1", date: "2026-11-14", category: "SUBMIT_LEAD_FORM", conversions: 1.4 }),
      conversionRow({ adId: "1", date: "2026-11-14", category: "CONTACT", conversions: 1.4 }),
    ]);
    const row = mapGoogleAdsRow(googleRow({ adId: "1", date: "2026-11-14", costMicros: 2500000 }), conversions);
    expect(row).toMatchObject({ spend: 2.5, leads: 3, messages_started: 0 });
  });
});
