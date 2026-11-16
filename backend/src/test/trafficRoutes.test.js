// Rotas do Gestor de Tráfego (tela): acesso, contas, perfil e desempenho.
// Express real, pglite com a migration de produção. Dublado só o token Firebase.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { acessoInterno, startHttp } from "./helpers/audioLibraryHarness.js";
import { createTrafficDb, insertAccount, poolFor } from "./helpers/trafficHarness.js";
import { resolveCollectionWindow } from "../traffic/collector.js";

let db = null;
let pool = null;
vi.mock("../services/database.js", () => ({
  get pgDatabasePool() {
    return pool;
  },
}));
vi.mock("../access/middlewares.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { fakeFirebaseAuth } = await import("./helpers/audioLibraryHarness.js");
  return { ...actual, requireFirebaseAuth: fakeFirebaseAuth };
});

const { registerTrafficRoutes } = await import("../traffic/routes.js");

const A = "teste-trafego-rota-a";
const B = "teste-trafego-rota-b";
const FORA = "teste-trafego-fora-do-piloto";
const USER_A = acessoInterno([A], ["trafego"]);
const USER_B = acessoInterno([B], ["trafego"]);
const SEM_PAGINA = acessoInterno([A], ["dashboard"]);
const ADMIN = { role: "internal", isAdmin: true, scopeMode: "all_clients", clientIds: [], internalPages: [] };
const CLIENTE = { role: "client", isAdmin: false, scopeMode: "assigned_clients", clientIds: [A], clientId: A };
const SEGREDO = "token-que-nao-pode-aparecer-em-resposta";

const hoje = resolveCollectionWindow({ now: new Date(), timeZone: "America/Sao_Paulo", days: 1 }).until;
function diasAtras(n) {
  const [y, m, d] = hoje.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

async function metric(clientId, { adId, date = hoje, spend, leads = 0, campaignId = "c1", adsetId = "s1", accountId = "111", clicks = 0, impressions = 0 }) {
  await db.query(
    `INSERT INTO traffic_metrics_daily
       (client_id, platform, external_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
        effective_status, date, spend, impressions, clicks, leads)
     VALUES ($1, 'meta', $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, $10, $11, $12, $13)`,
    [clientId, accountId, campaignId, `Campanha ${campaignId}`, adsetId, `Conjunto ${adsetId}`, adId, `Anúncio ${adId}`, date, spend, impressions, clicks, leads]
  );
}

const PERFIL_CPL = { kpis: [{ key: "cpl", target: 50 }], primaryKpi: "cpl" };

describe("rotas do Gestor de Tráfego", () => {
  let http;
  const get = (path, access) => http.call("GET", path, { access });

  beforeAll(async () => {
    http = await startHttp((app) => registerTrafficRoutes(app));
  });
  afterAll(async () => {
    await http.close();
  });
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("TRAFFIC_PILOT_TENANTS", `${A},${B}`);
    vi.stubEnv("META_ADS_ACCESS_TOKEN", "");
    vi.stubEnv("TRAFFIC_COLLECTOR_ENABLED", "");
    db = await createTrafficDb();
    pool = poolFor(db);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    pool = null;
    await db.close();
  });

  describe("acesso", () => {
    it("sem credencial é 401", async () => {
      expect((await http.call("GET", `/api/traffic/accounts?clientId=${A}`)).status).toBe(401);
    });

    it("quem tem a página e está no piloto entra; a tela recebe o veredito", async () => {
      const res = await get(`/api/traffic/access?clientId=${A}`, USER_A);
      expect(res.body).toMatchObject({ allowed: true, reason: null });
    });

    it("usuário sem a página trafego não entra, e a tela recebe o motivo", async () => {
      const veredito = await get(`/api/traffic/access?clientId=${A}`, SEM_PAGINA);
      expect(veredito.status).toBe(200);
      expect(veredito.body).toMatchObject({ allowed: false, reason: "TRAFFIC_USER_NOT_ALLOWED" });

      for (const path of ["accounts", "profile", "performance"]) {
        const res = await get(`/api/traffic/${path}?clientId=${A}`, SEM_PAGINA);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("TRAFFIC_USER_NOT_ALLOWED");
      }
    });

    it("usuário do cliente (não interno) não entra", async () => {
      const res = await get(`/api/traffic/accounts?clientId=${A}`, CLIENTE);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("TRAFFIC_ROLE_NOT_ALLOWED");
    });

    it("empresa fora do piloto não entra, nem para admin", async () => {
      const res = await get(`/api/traffic/accounts?clientId=${FORA}`, ADMIN);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("TRAFFIC_TENANT_NOT_IN_PILOT");
      expect((await get(`/api/traffic/accounts?clientId=${A}`, ADMIN)).status).toBe(200);
    });

    it("sem a variável do piloto, só a Geração Digital entra", async () => {
      vi.stubEnv("TRAFFIC_PILOT_TENANTS", "");
      expect((await get(`/api/traffic/accounts?clientId=${A}`, ADMIN)).status).toBe(403);
      expect((await get("/api/traffic/accounts?clientId=geracao-digital", ADMIN)).status).toBe(200);
    });
  });

  describe("isolamento por empresa", () => {
    beforeEach(async () => {
      await insertAccount(db, { clientId: A, externalAccountId: "111" });
      await insertAccount(db, { clientId: B, externalAccountId: "222" });
      await http.call("PUT", "/api/traffic/profile", { access: USER_A, body: { clientId: A, kpis: [{ key: "cpl", target: 50 }], primaryKpi: "cpl" } });
      await http.call("PUT", "/api/traffic/profile", { access: USER_B, body: { clientId: B, kpis: [{ key: "cpc", target: 2 }], primaryKpi: "cpc" } });
      await metric(A, { adId: "ad-a", spend: 100, leads: 5, accountId: "111" });
      await metric(B, { adId: "ad-b", spend: 999, leads: 1, accountId: "222" });
    });

    it("A não lê conta, perfil nem métrica da B pedindo a empresa B", async () => {
      for (const path of ["accounts", "profile", "performance", "access"]) {
        const res = await get(`/api/traffic/${path}?clientId=${B}`, USER_A);
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain("222");
        expect(JSON.stringify(res.body)).not.toContain("ad-b");
      }
    });

    it("o que A lê da própria empresa não traz nada da B", async () => {
      const contas = await get(`/api/traffic/accounts?clientId=${A}`, USER_A);
      expect(contas.body.accounts.map((a) => a.externalAccountId)).toEqual(["111"]);

      const perfil = await get(`/api/traffic/profile?clientId=${A}`, USER_A);
      expect(perfil.body.profile.kpis.map((k) => k.key)).toEqual(["cpl"]);

      const desempenho = await get(`/api/traffic/performance?clientId=${A}&window=7`, USER_A);
      expect(desempenho.body.totals.metrics.spend).toBe(100);
      expect(desempenho.body.adsCount).toBe(1);
      expect(JSON.stringify(desempenho.body)).not.toContain("ad-b");
      expect(JSON.stringify(desempenho.body)).not.toContain("222");
    });

    it("A não escreve na B: nem conta nova, nem perfil, nem pausar conta pelo id", async () => {
      const novaConta = await http.call("POST", "/api/traffic/accounts", { access: USER_A, body: { clientId: B, platform: "meta", externalAccountId: "333" } });
      expect(novaConta.status).toBe(403);

      const perfil = await http.call("PUT", "/api/traffic/profile", { access: USER_A, body: { clientId: B, kpis: [], primaryKpi: null } });
      expect(perfil.status).toBe(403);

      const { rows } = await db.query("SELECT id FROM traffic_accounts WHERE client_id = $1", [B]);
      const pausar = await http.call("PATCH", `/api/traffic/accounts/${rows[0].id}`, { access: USER_A, body: { status: "paused" } });
      expect(pausar.status).toBe(403);

      const depois = await db.query("SELECT external_account_id, status FROM traffic_accounts WHERE client_id = $1", [B]);
      expect(depois.rows).toEqual([{ external_account_id: "222", status: "active" }]);
      const perfilB = await db.query("SELECT primary_kpi FROM traffic_profiles WHERE client_id = $1", [B]);
      expect(perfilB.rows).toEqual([{ primary_kpi: "cpc" }]);
    });
  });

  describe("conexão", () => {
    it("sem token a Meta aparece como não conectada; com token, conectada, e o token nunca sai", async () => {
      let res = await get(`/api/traffic/accounts?clientId=${A}`, USER_A);
      expect(res.body.platforms).toEqual({ meta: { available: true, connected: false }, google: { available: false, connected: false } });
      expect(res.body.collector).toEqual({ enabled: false, hours: ["07:00", "13:00", "19:00"] });

      vi.stubEnv("META_ADS_ACCESS_TOKEN", SEGREDO);
      res = await get(`/api/traffic/accounts?clientId=${A}`, USER_A);
      expect(res.body.platforms.meta.connected).toBe(true);
      expect(res.text).not.toContain(SEGREDO);
    });

    it("cadastra conta da Meta aceitando act_, recusa repetida, Google e número inválido", async () => {
      const criar = (body) => http.call("POST", "/api/traffic/accounts", { access: USER_A, body: { clientId: A, ...body } });

      const ok = await criar({ platform: "meta", externalAccountId: "act_123456", displayName: "  Conta GD  " });
      expect(ok.status).toBe(201);
      expect(ok.body.account).toMatchObject({ platform: "meta", externalAccountId: "123456", displayName: "Conta GD", status: "active", lastSyncAt: null, lastSyncError: null });

      const repetida = await criar({ platform: "meta", externalAccountId: "123456" });
      expect(repetida.status).toBe(409);
      expect(repetida.body.error.code).toBe("ACCOUNT_ALREADY_EXISTS");

      expect((await criar({ platform: "google", externalAccountId: "123" })).body.error.code).toBe("PLATFORM_NOT_AVAILABLE");
      expect((await criar({ platform: "meta", externalAccountId: "123/ads" })).body.error.code).toBe("INVALID_ACCOUNT_ID");
      expect((await db.query("SELECT count(*)::int AS n FROM traffic_accounts")).rows[0].n).toBe(1);
    });

    it("pausa e reativa a conta; erro de coleta aparece na listagem", async () => {
      const acc = await insertAccount(db, { clientId: A, externalAccountId: "111" });
      await db.query("UPDATE traffic_accounts SET last_sync_error = 'Meta recusou a leitura: token vencido (código 190)', last_sync_attempt_at = now() WHERE id = $1", [acc.id]);

      const lista = await get(`/api/traffic/accounts?clientId=${A}`, USER_A);
      expect(lista.body.accounts[0]).toMatchObject({ lastSyncAt: null, lastSyncError: "Meta recusou a leitura: token vencido (código 190)" });

      const pausada = await http.call("PATCH", `/api/traffic/accounts/${acc.id}`, { access: USER_A, body: { status: "paused" } });
      expect(pausada.body.account.status).toBe("paused");
      expect((await http.call("PATCH", `/api/traffic/accounts/${acc.id}`, { access: USER_A, body: { status: "apagada" } })).status).toBe(400);
      expect((await http.call("PATCH", "/api/traffic/accounts/nao-e-uuid", { access: USER_A, body: { status: "paused" } })).status).toBe(404);
    });
  });

  describe("metas e regras", () => {
    const salvar = (body, access = USER_A) => http.call("PUT", "/api/traffic/profile", { access, body: { clientId: A, ...body } });

    it("sem perfil devolve os padrões e diz que não existe", async () => {
      const res = await get(`/api/traffic/profile?clientId=${A}`, USER_A);
      expect(res.body.profile).toMatchObject({ exists: false, kpis: [], primaryKpi: null, windows: [4, 7, 14, 30], minSpendFactor: 1.2, maxIncreasePct: 50, autonomyLevel: "relatorio" });
      expect(res.body.autonomy).toEqual({ levels: ["relatorio", "sugere", "aplica_com_limites"], available: ["relatorio"] });
      expect(res.body.catalog.map((k) => k.key)).toContain("cpl");
    });

    it("salva e relê; o sentido do KPI vem do catálogo, não do que a tela mandou", async () => {
      const res = await salvar({
        objectives: ["Gerar conversas no WhatsApp"],
        kpis: [{ key: "cpl", target: 50, better: "higher", scale_at: 0.3 }, { key: "roas", target: 4, min_spend: 200 }],
        primaryKpi: "cpl",
        windows: [7, 30, 99],
        dailyBudgetCap: 300,
        approvers: [{ name: "Caio", role: "gestor_gd" }, { name: "Dona da loja", role: "cliente" }],
      });
      expect(res.status).toBe(200);

      const lido = (await get(`/api/traffic/profile?clientId=${A}`, USER_A)).body.profile;
      expect(lido).toMatchObject({
        exists: true,
        objectives: ["Gerar conversas no WhatsApp"],
        primaryKpi: "cpl",
        windows: [7, 30],
        dailyBudgetCap: 300,
        monthlyBudgetCap: null,
        autonomyLevel: "relatorio",
        approvers: [{ name: "Caio", role: "gestor_gd" }, { name: "Dona da loja", role: "cliente" }],
      });
      expect(lido.kpis).toEqual([
        { key: "cpl", target: 50, better: "lower", scale_at: 0.3, kill_at: 0.5, min_spend: null },
        { key: "roas", target: 4, better: "higher", scale_at: 0.2, kill_at: 0.5, min_spend: 200 },
      ]);
    });

    it("o servidor só aceita o nível Relatório, e a recusa não grava nada", async () => {
      for (const autonomyLevel of ["sugere", "aplica_com_limites"]) {
        const res = await salvar({ autonomyLevel, kpis: [{ key: "cpl", target: 50 }], primaryKpi: "cpl" });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("AUTONOMY_NOT_AVAILABLE");
      }
      expect((await salvar({ autonomyLevel: "total" })).body.error.code).toBe("INVALID_AUTONOMY");
      expect((await db.query("SELECT count(*)::int AS n FROM traffic_profiles")).rows[0].n).toBe(0);
    });

    it("recusa KPI desconhecido, repetido, meta inválida e KPI principal fora da lista", async () => {
      expect((await salvar({ kpis: [{ key: "inventado", target: 1 }] })).body.error.code).toBe("INVALID_KPI");
      expect((await salvar({ kpis: [{ key: "cpl", target: 1 }, { key: "cpl", target: 2 }] })).body.error.code).toBe("DUPLICATE_KPI");
      expect((await salvar({ kpis: [{ key: "cpl", target: -3 }] })).body.error.code).toBe("INVALID_TARGET");
      expect((await salvar({ kpis: [{ key: "cpl", target: "abc" }] })).body.error.code).toBe("INVALID_TARGET");
      expect((await salvar({ kpis: [{ key: "cpl", target: 50 }], primaryKpi: "roas" })).body.error.code).toBe("INVALID_PRIMARY_KPI");
      expect((await salvar({ approvers: [{ name: "Zé", role: "vizinho" }] })).body.error.code).toBe("INVALID_APPROVER");
    });
  });

  describe("desempenho", () => {
    beforeEach(async () => {
      await insertAccount(db, { clientId: A, externalAccountId: "111" });
    });

    it("soma a janela pedida e deixa de fora o que é mais antigo", async () => {
      await metric(A, { adId: "ad1", date: hoje, spend: 100, leads: 4 });
      await metric(A, { adId: "ad1", date: diasAtras(6), spend: 50, leads: 1 });
      await metric(A, { adId: "ad1", date: diasAtras(7), spend: 1000, leads: 100 });

      const sete = (await get(`/api/traffic/performance?clientId=${A}&window=7`, USER_A)).body;
      expect(sete.window).toMatchObject({ days: 7, since: diasAtras(6), until: hoje });
      expect(sete.totals.metrics).toMatchObject({ spend: 150, leads: 5 });
      expect(sete.totals.kpis.cpl).toBe(30);

      const trinta = (await get(`/api/traffic/performance?clientId=${A}&window=30`, USER_A)).body;
      expect(trinta.totals.metrics).toMatchObject({ spend: 1150, leads: 105 });

      // Janela fora da lista cai em 7 dias.
      expect((await get(`/api/traffic/performance?clientId=${A}&window=999`, USER_A)).body.window.days).toBe(7);
    });

    it("decide por anúncio pelo KPI principal e a campanha herda a pior decisão", async () => {
      await http.call("PUT", "/api/traffic/profile", { access: USER_A, body: { clientId: A, ...PERFIL_CPL } });
      await metric(A, { adId: "bom", spend: 300, leads: 10, campaignId: "c1" }); // CPL 30: escala
      await metric(A, { adId: "ruim", spend: 300, leads: 3, campaignId: "c1" }); // CPL 100: corta
      await metric(A, { adId: "novo", spend: 20, leads: 0, campaignId: "c1" }); // abaixo de 60: sem amostra
      await metric(A, { adId: "meio", spend: 300, leads: 6, campaignId: "c2", adsetId: "s2" }); // CPL 50: mantém

      const body = (await get(`/api/traffic/performance?clientId=${A}&window=7`, USER_A)).body;
      expect(body.primaryKpi).toBe("cpl");
      const campanhas = Object.fromEntries(body.accounts[0].campaigns.map((c) => [c.id, c]));
      const anuncios = Object.fromEntries(
        body.accounts[0].campaigns.flatMap((c) => c.adsets.flatMap((s) => s.ads)).map((ad) => [ad.id, ad])
      );

      expect(anuncios.bom.decision.decisao).toBe("ESCALAR");
      expect(anuncios.ruim.decision.decisao).toBe("MATAR");
      expect(anuncios.ruim.decision.motivo).toBe("Custo por lead em 100, 100% pior que a meta de 50 (corta a partir de 50%).");
      expect(anuncios.novo.decision.decisao).toBe("AMOSTRA_INSUFICIENTE");
      expect(anuncios.meio.decision.decisao).toBe("MANTER");
      expect(campanhas.c1.decision).toBe("MATAR");
      expect(campanhas.c2.decision).toBe("MANTER");

      // KPI de campanha é recalculado sobre a soma, não a média dos anúncios.
      expect(campanhas.c1.metrics).toMatchObject({ spend: 620, leads: 13 });
      expect(campanhas.c1.kpis.cpl).toBe(47.6923);
      expect(body.targets).toEqual([
        { key: "cpl", label: "Custo por lead", unit: "currency", better: "lower", target: 50, value: 48.4211, variacao: 0.0316 },
      ]);
    });

    it("sem perfil mostra as métricas e nenhuma decisão; sem dado, nenhuma conta", async () => {
      const vazio = (await get(`/api/traffic/performance?clientId=${A}&window=7`, USER_A)).body;
      expect(vazio).toMatchObject({ hasProfile: false, primaryKpi: null, accounts: [], adsCount: 0, targets: [] });
      expect(vazio.totals.kpis.cpl).toBeNull();

      await metric(A, { adId: "ad1", spend: 100, leads: 4 });
      const body = (await get(`/api/traffic/performance?clientId=${A}&window=7`, USER_A)).body;
      const ad = body.accounts[0].campaigns[0].adsets[0].ads[0];
      expect(ad.decision).toBeNull();
      expect(ad.kpis.cpl).toBe(25);
      expect(body.accounts[0].campaigns[0].decision).toBeNull();
    });

    it("colunas do Vexo ficam sem número enquanto não há origem do anúncio no lead", async () => {
      const body = (await get(`/api/traffic/performance?clientId=${A}&window=7`, USER_A)).body;
      expect(body.vexo).toEqual({ available: false, reason: "SEM_ORIGEM_DO_ANUNCIO" });
    });
  });
});
