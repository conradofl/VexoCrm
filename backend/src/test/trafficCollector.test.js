// Coletor da Meta (SPEC-GESTOR-TRAFEGO-FASE1, 5.2).
// Banco real (pglite com a migration de produção). Dublado só o fetch da Graph
// API. Cliente, coletor e upsert são os de produção.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectMetaAccount, resolveCollectionWindow, runTrafficCollection } from "../traffic/collector.js";
import { createMetaAdsClient, mapMetaInsightRow, normalizeMetaAccountId } from "../traffic/metaAdsClient.js";
import { createMetaFetch, createTrafficDb, insertAccount, insightRow, metaHandlerFor, poolFor } from "./helpers/trafficHarness.js";

const TOKEN = "token-de-teste-nao-e-segredo";
const ENV = { META_ADS_ACCESS_TOKEN: TOKEN };
const TENANT_A = "teste-trafego-a";
const TENANT_B = "teste-trafego-b";
// 15/11/2026 10h em São Paulo.
const NOW = new Date("2026-11-15T13:00:00.000Z");
const noSleep = async () => {};

describe("coletor de tráfego da Meta", () => {
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
        `SELECT client_id, external_account_id, ad_id, date::text AS date, spend::text AS spend, impressions::int AS impressions,
                clicks::int AS clicks, leads, messages_started, purchases, purchase_value::text AS purchase_value, effective_status
           FROM traffic_metrics_daily WHERE client_id = $1 ORDER BY ad_id, date`,
        [clientId]
      )
    ).rows;
  const account = async (id) => (await db.query("SELECT * FROM traffic_accounts WHERE id = $1", [id])).rows[0];
  const run = (handler, { now = NOW, env = ENV } = {}) => {
    const meta = createMetaFetch(handler);
    return runTrafficCollection({ pool, now, env, fetchImpl: meta.fetchImpl, sleep: noSleep }).then((summary) => ({
      summary,
      calls: meta.calls,
    }));
  };

  it("primeira carga: lê 30 dias, grava por anúncio e por dia e atualiza a conta", async () => {
    const acc = await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    const { summary, calls } = await run(
      metaHandlerFor({
        111: {
          info: { name: "GD Principal", currency: "BRL", timezone_name: "America/Sao_Paulo" },
          insights: [
            insightRow({
              adId: "ad1",
              date: "2026-11-14",
              spend: "123.45",
              impressions: "5000",
              clicks: "80",
              actions: [
                { action_type: "lead", value: "7" },
                { action_type: "onsite_conversion.lead_grouped", value: "7" },
                { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "12" },
                { action_type: "omni_purchase", value: "2" },
                { action_type: "purchase", value: "2" },
              ],
              actionValues: [{ action_type: "omni_purchase", value: "899.90" }],
            }),
            insightRow({ adId: "ad2", date: "2026-11-14", spend: "0.50" }),
          ],
          ads: [{ id: "ad1", effective_status: "ACTIVE" }, { id: "ad2", effective_status: "PAUSED" }],
        },
      })
    );

    expect(summary.meta).toMatchObject({ connected: true, accounts: 1, ok: 1, failed: 0 });
    expect(await metrics(TENANT_A)).toEqual([
      {
        client_id: TENANT_A, external_account_id: "111", ad_id: "ad1", date: "2026-11-14", spend: "123.45",
        impressions: 5000, clicks: 80, leads: 7, messages_started: 12, purchases: 2, purchase_value: "899.90",
        effective_status: "ACTIVE",
      },
      {
        client_id: TENANT_A, external_account_id: "111", ad_id: "ad2", date: "2026-11-14", spend: "0.50",
        impressions: 1000, clicks: 20, leads: 0, messages_started: 0, purchases: 0, purchase_value: "0.00",
        effective_status: "PAUSED",
      },
    ]);

    const insightsCall = calls.find((c) => c.path === "act_111/insights");
    expect(JSON.parse(insightsCall.params.time_range)).toEqual({ since: "2026-10-17", until: "2026-11-15" });
    expect(insightsCall.params).toMatchObject({ level: "ad", time_increment: "1" });

    const saved = await account(acc.id);
    expect(saved).toMatchObject({ display_name: "GD Principal", currency: "BRL", timezone: "America/Sao_Paulo", last_sync_error: null });
    expect(saved.last_sync_at.toISOString()).toBe(NOW.toISOString());
  });

  it("o token vai no cabeçalho e nunca na URL; toda chamada é GET", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    const { calls } = await run(metaHandlerFor({ 111: {} }));

    expect(calls.length).toBe(3);
    for (const call of calls) {
      expect(call.init.method).toBe("GET");
      expect(call.init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.url).not.toContain(TOKEN);
      expect(call.params.access_token).toBeUndefined();
    }
  });

  it("coletas seguintes releem 7 dias e o número revisado substitui o antigo, sem duplicar", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    await run(metaHandlerFor({ 111: { insights: [insightRow({ adId: "ad1", date: "2026-11-14", spend: "100.00" })] } }));

    const depois = new Date("2026-11-15T19:00:00.000Z");
    const { calls } = await run(
      metaHandlerFor({ 111: { insights: [insightRow({ adId: "ad1", date: "2026-11-14", spend: "104.30" })] } }),
      { now: depois }
    );

    const insightsCall = calls.find((c) => c.path === "act_111/insights");
    expect(JSON.parse(insightsCall.params.time_range)).toEqual({ since: "2026-11-09", until: "2026-11-15" });

    const rows = await metrics(TENANT_A);
    expect(rows.length).toBe(1);
    expect(rows[0].spend).toBe("104.30");
  });

  it("falha de coleta não vira zero: guarda o erro, não avança last_sync_at e mantém o dado anterior", async () => {
    const acc = await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    await run(metaHandlerFor({ 111: { insights: [insightRow({ adId: "ad1", date: "2026-11-14", spend: "100.00" })] } }));

    const depois = new Date("2026-11-15T19:00:00.000Z");
    const { summary } = await run(
      () => ({ status: 400, body: { error: { message: "Error validating access token: Session has expired", code: 190, type: "OAuthException" } } }),
      { now: depois }
    );

    expect(summary.meta).toMatchObject({ ok: 0, failed: 1 });
    const saved = await account(acc.id);
    expect(saved.last_sync_error).toContain("Session has expired");
    expect(saved.last_sync_error).toContain("código 190");
    expect(saved.last_sync_at.toISOString()).toBe(NOW.toISOString());
    expect(saved.last_sync_attempt_at.toISOString()).toBe(depois.toISOString());

    const rows = await metrics(TENANT_A);
    expect(rows.length).toBe(1);
    expect(rows[0].spend).toBe("100.00");
  });

  it("falha no meio da leitura não grava a conta pela metade", async () => {
    const acc = await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    const ok = metaHandlerFor({ 111: { insights: [insightRow({ adId: "ad1", date: "2026-11-14" })] } });
    const { summary } = await run((call) =>
      call.path === "act_111/ads" ? { status: 400, body: { error: { message: "Permissions error", code: 200 } } } : ok(call)
    );

    expect(summary.meta.failed).toBe(1);
    expect(await metrics(TENANT_A)).toEqual([]);
    const saved = await account(acc.id);
    expect(saved.last_sync_at).toBeNull();
    expect(saved.last_sync_error).toContain("Permissions error");
  });

  it("uma conta com falha não impede a seguinte", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "222" });
    const { summary } = await run(metaHandlerFor({ 222: { insights: [insightRow({ adId: "ad9", date: "2026-11-14" })] } }));

    expect(summary.meta).toMatchObject({ accounts: 2, ok: 1, failed: 1 });
    expect((await metrics(TENANT_A)).map((r) => r.ad_id)).toEqual(["ad9"]);
  });

  it("sem token a conta fica não conectada: nenhuma chamada, nenhum erro, nenhum número", async () => {
    const acc = await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    const { summary, calls } = await run(metaHandlerFor({ 111: {} }), { env: {} });

    expect(summary.meta).toEqual({ connected: false, accounts: 0, ok: 0, failed: 0, results: [] });
    expect(calls.length).toBe(0);
    const saved = await account(acc.id);
    expect(saved.last_sync_error).toBeNull();
    expect(saved.last_sync_at).toBeNull();
    expect(saved.last_sync_attempt_at).toBeNull();
    expect(await metrics(TENANT_A)).toEqual([]);
  });

  it("conta pausada e conta do Google ficam fora da coleta da Meta", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111", status: "paused" });
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "333", platform: "google" });
    const { summary, calls } = await run(metaHandlerFor({ 111: {}, 333: {} }));

    expect(summary.meta.accounts).toBe(0);
    expect(calls.length).toBe(0);
  });

  it("isolamento por empresa: cada linha nasce com a empresa da conta, mesmo com o mesmo anúncio", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    await insertAccount(db, { clientId: TENANT_B, externalAccountId: "222" });
    await run(
      metaHandlerFor({
        111: { insights: [insightRow({ adId: "ad1", date: "2026-11-14", spend: "10.00" })] },
        222: { insights: [insightRow({ adId: "ad1", date: "2026-11-14", spend: "99.00" })] },
      })
    );

    const a = await metrics(TENANT_A);
    const b = await metrics(TENANT_B);
    expect(a.map((r) => [r.external_account_id, r.spend])).toEqual([["111", "10.00"]]);
    expect(b.map((r) => [r.external_account_id, r.spend])).toEqual([["222", "99.00"]]);
  });

  it("paginação segue o cursor e não o link pronto da Meta", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    const base = metaHandlerFor({ 111: {} });
    const { calls } = await run((call) => {
      if (call.path !== "act_111/insights") return base(call);
      if (!call.params.after) {
        return {
          body: {
            data: [insightRow({ adId: "ad1", date: "2026-11-13" })],
            paging: { cursors: { after: "CURSOR2" }, next: "https://graph.facebook.com/v26.0/act_111/insights?access_token=VAZOU&after=CURSOR2" },
          },
        };
      }
      return { body: { data: [insightRow({ adId: "ad1", date: "2026-11-14" })], paging: { cursors: { after: "FIM" } } } };
    });

    const pages = calls.filter((c) => c.path === "act_111/insights");
    expect(pages.length).toBe(2);
    expect(pages[1].params.after).toBe("CURSOR2");
    expect(pages[1].url).not.toContain("VAZOU");
    expect((await metrics(TENANT_A)).map((r) => r.date)).toEqual(["2026-11-13", "2026-11-14"]);
  });

  it("limite de requisições: espera e tenta de novo, e desiste depois de 3 tentativas", async () => {
    const acc = await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    const base = metaHandlerFor({ 111: { insights: [insightRow({ adId: "ad1", date: "2026-11-14" })] } });
    const waits = [];
    const sleep = async (ms) => {
      waits.push(ms);
    };
    const throttled = { status: 400, body: { error: { message: "User request limit reached", code: 17 } } };

    // Uma recusa por limite e depois responde: coleta dá certo.
    let recusas = 1;
    let meta = createMetaFetch((call) => (call.path === "act_111" && recusas-- > 0 ? throttled : base(call)));
    let summary = await runTrafficCollection({ pool, now: NOW, env: ENV, fetchImpl: meta.fetchImpl, sleep });
    expect(summary.meta.ok).toBe(1);
    expect(waits).toEqual([2000]);

    // Recusa sempre: 3 tentativas e para.
    waits.length = 0;
    meta = createMetaFetch(() => throttled);
    summary = await runTrafficCollection({ pool, now: NOW, env: ENV, fetchImpl: meta.fetchImpl, sleep });
    expect(summary.meta.failed).toBe(1);
    expect(meta.calls.length).toBe(3);
    expect(waits).toEqual([2000, 8000]);
    expect((await account(acc.id)).last_sync_error).toContain("User request limit reached");
  });

  it("erro que não é passageiro não é repetido", async () => {
    await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    const { calls } = await run(() => ({ status: 400, body: { error: { message: "Invalid OAuth access token", code: 190 } } }));
    expect(calls.length).toBe(1);
  });

  it("falha de rede vira erro registrado, sem vazar o token", async () => {
    const acc = await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    const { summary, calls } = await run(() => {
      throw new Error(`connect ECONNREFUSED com ${TOKEN}`);
    });

    expect(summary.meta.failed).toBe(1);
    expect(calls.length).toBe(3);
    const saved = await account(acc.id);
    expect(saved.last_sync_error).toBe("Meta não respondeu: falha de rede.");
    expect(saved.last_sync_error).not.toContain(TOKEN);
  });

  it("collectMetaAccount devolve o resultado e nunca lança", async () => {
    const acc = await insertAccount(db, { clientId: TENANT_A, externalAccountId: "111" });
    const meta = createMetaFetch(() => ({ status: 500, body: null }));
    const client = createMetaAdsClient({ token: TOKEN, fetchImpl: meta.fetchImpl, sleep: noSleep });
    const result = await collectMetaAccount({ pool, account: acc, client, now: NOW });
    expect(result).toMatchObject({ ok: false, accountId: acc.id, clientId: TENANT_A });
    expect(result.error).toContain("HTTP 500");
  });
});

describe("peças do coletor", () => {
  it("janela de coleta usa o dia no fuso da conta", () => {
    // 02h UTC do dia 15 ainda é dia 14 em São Paulo.
    const now = new Date("2026-11-15T02:00:00.000Z");
    expect(resolveCollectionWindow({ now, timeZone: "America/Sao_Paulo", days: 7 })).toEqual({ since: "2026-11-08", until: "2026-11-14" });
    expect(resolveCollectionWindow({ now, timeZone: "UTC", days: 7 })).toEqual({ since: "2026-11-09", until: "2026-11-15" });
    expect(resolveCollectionWindow({ now, timeZone: "Fuso/Inexistente", days: 1 })).toEqual({ since: "2026-11-14", until: "2026-11-14" });
  });

  it("identificador de conta só aceita dígitos, com ou sem act_", () => {
    expect(normalizeMetaAccountId("act_123")).toBe("123");
    expect(normalizeMetaAccountId(" 123 ")).toBe("123");
    for (const ruim of ["", "act_", "123/ads", "../me", "12a", null]) {
      expect(() => normalizeMetaAccountId(ruim)).toThrow("inválido");
    }
  });

  it("linha sem anúncio ou sem data é descartada, não gravada com chave inventada", () => {
    expect(mapMetaInsightRow({ date_start: "2026-11-14", spend: "5" })).toBeNull();
    expect(mapMetaInsightRow({ ad_id: "ad1", spend: "5" })).toBeNull();
    expect(mapMetaInsightRow(null)).toBeNull();
  });

  it("compra usa omni_purchase e, na falta, purchase, sem somar os dois", () => {
    const soPurchase = mapMetaInsightRow(
      insightRow({ adId: "a", date: "2026-11-14", actions: [{ action_type: "purchase", value: "3" }], actionValues: [{ action_type: "purchase", value: "30" }] })
    );
    expect(soPurchase).toMatchObject({ purchases: 3, purchase_value: 30 });
  });
});
