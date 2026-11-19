// Leitura do Gestor de Tráfego para o GoClaw (Fase 2, PR C).
// Express real, pglite com as migrations de produção. Nenhum dublê no código
// sob teste: o token vem do ambiente, a empresa vem do token.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startHttp } from "./helpers/audioLibraryHarness.js";
import { createTrafficDb, insertAccount, poolFor } from "./helpers/trafficHarness.js";
import { dateKeyInTimeZone } from "../traffic/collector.js";
import { saveProfile } from "../traffic/service.js";
import { generatePlan, approveItem, markItemApplied } from "../traffic/plan.js";

let db = null;
let pool = null;
vi.mock("../services/database.js", () => ({
  get pgDatabasePool() {
    return pool;
  },
}));

const { registerTrafficGoclawRoutes, parseGoclawTokens, resolveGoclawTenant } = await import("../traffic/goclawRead.js");

const A = "teste-goclaw-a";
const B = "teste-goclaw-b";
const TOKEN_A = "a".repeat(20) + "-token-de-leitura-da-empresa-a-0001";
const TOKEN_B = "b".repeat(20) + "-token-de-leitura-da-empresa-b-0002";
const VIGIA = "v".repeat(20) + "-token-do-vigia-da-gd-que-nao-abre-0003";
const SEGREDO_META = "EAAG-token-da-meta-que-nunca-sai-do-servidor";
const BANCO = "postgres://usuario:senha-secreta@host:5432/vexo";

const ontem = (() => {
  const [y, m, d] = dateKeyInTimeZone(new Date(), "America/Sao_Paulo").split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
})();

async function empresaComPlano(clientId) {
  await saveProfile(pool, clientId, {
    kpis: [{ key: "cpl", target: 50 }],
    primaryKpi: "cpl",
    autonomyLevel: "sugere",
    approvers: [
      { name: "Caio", role: "gestor_gd", email: `caio@${clientId}.test` },
      { name: "Dona", role: "cliente", email: `dona@${clientId}.test` },
    ],
  });
  const account = await insertAccount(db, { clientId, externalAccountId: clientId === A ? "111" : "222" });
  const sync = new Date(Date.now() - 3600 * 1000);
  await db.query("UPDATE traffic_accounts SET last_sync_at = $2, last_sync_error = $3 WHERE id = $1", [account.id, sync, `erro citando ${SEGREDO_META}`]);
  await db.query(
    `INSERT INTO traffic_metrics_daily (client_id, platform, external_account_id, campaign_id, campaign_name, adset_id, ad_id, ad_name, date, spend, leads, collected_at, raw)
     VALUES ($1, 'meta', $2, 'c1', $3, 's1', 'ad1', 'Anúncio 1', $4, 300, 10, $5, $6::jsonb)`,
    [clientId, clientId === A ? "111" : "222", `Campanha da ${clientId}`, ontem, sync, JSON.stringify({ access_token: SEGREDO_META })]
  );
  await db.query(
    `INSERT INTO traffic_budgets (client_id, platform, external_account_id, level, entity_id, campaign_id, daily_budget, collected_at)
     VALUES ($1, 'meta', $2, 'campaign', 'c1', 'c1', 100, $3)`,
    [clientId, clientId === A ? "111" : "222", sync]
  );
  return generatePlan(pool, clientId, { generatedBy: "teste" });
}

describe("rota de leitura do GoClaw", () => {
  let http;
  const ler = (token, query = "") =>
    http.call("GET", `/api/goclaw/trafego/resumo${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  beforeAll(async () => {
    http = await startHttp((app) => registerTrafficGoclawRoutes(app));
  });
  afterAll(async () => {
    await http.close();
  });
  beforeEach(async () => {
    db = await createTrafficDb();
    pool = poolFor(db);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TRAFFIC_PILOT_TENANTS", `${A},${B}`);
    vi.stubEnv("TRAFFIC_GOCLAW_TOKENS", `${A}=${TOKEN_A},${B}=${TOKEN_B}`);
    vi.stubEnv("GOCLAW_READ_TOKEN", VIGIA);
    vi.stubEnv("META_ADS_ACCESS_TOKEN", SEGREDO_META);
    vi.stubEnv("DATABASE_URL", BANCO);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await db.close();
  });

  it("token da empresa A lê só a A: desempenho, plano do dia e lista de aplicar", async () => {
    const { items } = await empresaComPlano(A);
    await empresaComPlano(B);
    await approveItem(pool, { clientId: A, itemId: items[0].id, role: "gestor_gd", identity: { uid: "u1", email: `caio@${A}.test` } });

    const res = await ler(TOKEN_A);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, empresa: A, somenteLeitura: true });
    expect(res.body.desempenho.campanhas.map((c) => c.campanha)).toEqual([`Campanha da ${A}`]);
    expect(res.body.plano.itens).toHaveLength(1);
    expect(res.body.plano.itens[0]).toMatchObject({
      acao: "aumentar_verba",
      verbaAtual: 100,
      verbaProposta: 150,
      estado: "aprovado_gd",
      aprovacoes: { gestor_gd: { at: expect.any(String) }, cliente: null },
    });
    expect(res.body.coleta).toEqual([{ plataforma: "meta", ativa: true, ultimaColeta: expect.any(String), comErro: true }]);
    expect(JSON.stringify(res.body)).not.toContain(B);
  });

  it("a resposta não leva token de plataforma, endereço do banco, uid nem email de quem aprovou", async () => {
    const { items } = await empresaComPlano(A);
    await approveItem(pool, { clientId: A, itemId: items[0].id, role: "gestor_gd", identity: { uid: "uid-secreto-caio", email: `caio@${A}.test` } });
    const texto = JSON.stringify((await ler(TOKEN_A)).body);
    for (const proibido of [SEGREDO_META, BANCO, "senha-secreta", TOKEN_A, VIGIA, "uid-secreto-caio", `caio@${A}.test`, "access_token"]) {
      expect(texto).not.toContain(proibido);
    }
  });

  it("sem token, token errado ou token do vigia: 401 e nada lido", async () => {
    await empresaComPlano(A);
    expect((await ler(null)).status).toBe(401);
    expect((await ler("x".repeat(40))).status).toBe(401);
    const vigia = await ler(VIGIA);
    expect(vigia.status).toBe(401);
    expect(vigia.body.error.code).toBe("GOCLAW_TOKEN_INVALID");
  });

  it("token da A pedindo a B: 403", async () => {
    await empresaComPlano(A);
    const res = await ler(TOKEN_A, `?clientId=${B}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("GOCLAW_TOKEN_OTHER_TENANT");
  });

  it("empresa fora do piloto: 403 mesmo com token válido", async () => {
    vi.stubEnv("TRAFFIC_PILOT_TENANTS", A);
    expect((await ler(TOKEN_B)).status).toBe(403);
  });

  it("só GET: POST, PUT e DELETE não existem", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await http.call(method, "/api/goclaw/trafego/resumo", { headers: { Authorization: `Bearer ${TOKEN_A}` }, body: {} });
      expect(res.status, method).toBe(404);
    }
  });

  it("token curto, repetido do vigia ou do gateway não vale", () => {
    const env = {
      TRAFFIC_GOCLAW_TOKENS: `curta=abc,${A}=${VIGIA},${B}=${TOKEN_B},semigual,=${TOKEN_A}`,
      GOCLAW_READ_TOKEN: VIGIA,
    };
    expect(parseGoclawTokens(env)).toEqual([{ clientId: B, token: TOKEN_B }]);
    expect(resolveGoclawTenant(`Bearer ${VIGIA}`, env)).toBeNull();
    expect(resolveGoclawTenant(`Bearer ${TOKEN_B}`, env)).toBe(B);
    expect(resolveGoclawTenant(TOKEN_B, env)).toBeNull();
    expect(parseGoclawTokens({ TRAFFIC_GOCLAW_TOKENS: `${A}=${TOKEN_A}`, GOCLAW_GATEWAY_TOKEN: TOKEN_A })).toEqual([]);
  });

  it("aplicarAMao traz só o aprovado pelos dois e ainda não feito", async () => {
    const { items } = await empresaComPlano(A);
    const gd = { uid: "u1", email: `caio@${A}.test` };
    const cli = { uid: "u2", email: `dona@${A}.test` };
    await approveItem(pool, { clientId: A, itemId: items[0].id, role: "gestor_gd", identity: gd });
    await approveItem(pool, { clientId: A, itemId: items[0].id, role: "cliente", identity: cli });
    expect((await ler(TOKEN_A)).body.aplicarAMao.map((i) => i.id)).toEqual([items[0].id]);

    await markItemApplied(pool, { clientId: A, itemId: items[0].id, identity: gd });
    const depois = await ler(TOKEN_A);
    expect(depois.body.aplicarAMao).toEqual([]);
    expect(depois.body.plano.itens[0].aplicado).toEqual({ em: expect.any(String) });
  });

  it("empresa sem plano hoje: plano null, desempenho presente", async () => {
    await saveProfile(pool, A, { kpis: [{ key: "cpl", target: 50 }], primaryKpi: "cpl" });
    const res = await ler(TOKEN_A);
    expect(res.status).toBe(200);
    expect(res.body.plano).toBeNull();
    expect(res.body.desempenho.campanhas).toEqual([]);
    expect(res.body.aplicarAMao).toEqual([]);
  });
});
