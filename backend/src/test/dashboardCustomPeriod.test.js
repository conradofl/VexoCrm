// backend/src/test/dashboardCustomPeriod.test.js
//
// Período personalizado do dashboard: o usuário escolhe data inicial e final. Vale para TODOS os
// blocos (inclusive rankings e avisos), tem cache com chave própria por intervalo, e intervalo
// invertido ou no futuro é recusado com mensagem clara.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  calculateDashboardMetrics,
  calculatePeriodDates,
  getOrComputeDashboardMetrics,
  _resetDashboardCacheTableEnsuredForTest,
  _getActiveRecalculationsForTest,
} from "../services/dashboardCalculations.js";
import {
  parseDashboardPeriodRequest,
  normalizeDashboardPeriodKey,
  buildCustomPeriodKey,
  startOfDateKeyInTimezone,
  addDaysToDateKey,
  countDaysInclusive,
  MAX_CUSTOM_PERIOD_DAYS,
} from "../services/dashboardPeriod.js";

const REF = new Date("2026-10-16T01:30:00.000Z"); // 15/10 22:30 em São Paulo
const FROM = "2026-10-01";
const TO = "2026-10-10";
const KEY = buildCustomPeriodKey(FROM, TO);
const SP = "America/Sao_Paulo";

describe("Período personalizado — validação do pedido", () => {
  const parse = (input) => parseDashboardPeriodRequest(input, { now: REF });

  it("[TESTE OBRIGATÓRIO] intervalo invertido é recusado com mensagem clara, citando as duas datas", () => {
    const r = parse({ period: "custom", from: "2026-10-10", to: "2026-10-01" });

    expect(r.ok).toBe(false);
    expect(r.message).toContain("A data inicial (10/10/2026) é depois da data final (01/10/2026)");
    expect(r.message).toContain("Inverta as datas");
  });

  it("[TESTE OBRIGATÓRIO] data final no futuro é recusada, dizendo até quando dá para escolher", () => {
    const r = parse({ period: "custom", from: "2026-10-01", to: "2026-10-20" });

    expect(r.ok).toBe(false);
    expect(r.message).toContain("A data final (20/10/2026) está no futuro");
    expect(r.message).toContain("até hoje (15/10/2026)"); // hoje em São Paulo, não o dia UTC (16)
  });

  it("[TESTE OBRIGATÓRIO] data inicial no futuro é recusada", () => {
    const r = parse({ period: "custom", from: "2026-10-18", to: "2026-10-20" });

    expect(r.ok).toBe(false);
    expect(r.message).toContain("A data inicial (18/10/2026) está no futuro");
  });

  it("hoje é permitido (intervalo que termina hoje)", () => {
    const r = parse({ period: "custom", from: "2026-10-10", to: "2026-10-15" });

    expect(r).toEqual({ ok: true, periodKey: "custom:2026-10-10:2026-10-15" });
  });

  it("um dia só (inicial = final) é válido", () => {
    expect(parse({ period: "custom", from: "2026-10-05", to: "2026-10-05" }).ok).toBe(true);
  });

  it("datas ausentes, mal formadas ou inexistentes no calendário são recusadas", () => {
    expect(parse({ period: "custom" }).message).toContain("Informe a data inicial e a data final");
    expect(parse({ period: "custom", from: "2026-10-01" }).message).toContain("Informe a data inicial e a data final");
    expect(parse({ period: "custom", from: "01/10/2026", to: "10/10/2026" }).message).toContain("Datas inválidas");
    expect(parse({ period: "custom", from: "2026-02-30", to: "2026-03-05" }).message).toContain("Datas inválidas");
  });

  it("intervalo maior que o máximo é recusado", () => {
    const r = parse({ period: "custom", from: "2025-01-01", to: "2026-10-10" });

    expect(r.ok).toBe(false);
    expect(r.message).toContain(`o máximo é ${MAX_CUSTOM_PERIOD_DAYS} dias`);
  });

  it("atalhos continuam como sempre; desconhecido cai em 30 dias", () => {
    expect(parse({ period: "7d" })).toEqual({ ok: true, periodKey: "7d" });
    expect(parse({ period: "this_month" })).toEqual({ ok: true, periodKey: "this_month" });
    expect(parse({ period: "30d" })).toEqual({ ok: true, periodKey: "30d" });
    expect(parse({ period: "xyz" })).toEqual({ ok: true, periodKey: "30d" });
    expect(parse({})).toEqual({ ok: true, periodKey: "30d" });
  });

  it("chave de período mal formada nunca vira chave de cache: cai em 30d", () => {
    expect(normalizeDashboardPeriodKey("custom:garbage")).toBe("30d");
    expect(normalizeDashboardPeriodKey("custom:2026-10-10:2026-10-01")).toBe("30d");
    expect(normalizeDashboardPeriodKey("custom:2026-10-01:2026-10-10:extra")).toBe("30d");
    expect(normalizeDashboardPeriodKey(KEY)).toBe(KEY);
  });
});

describe("Período personalizado — datas e período anterior", () => {
  it("[TESTE OBRIGATÓRIO] o intervalo vai da meia-noite da data inicial até a meia-noite depois da final, no fuso do tenant", () => {
    const p = calculatePeriodDates(KEY, REF, SP);

    expect(p.currentStart.toISOString()).toBe("2026-10-01T03:00:00.000Z"); // 00:00 em São Paulo
    expect(p.currentEnd.toISOString()).toBe("2026-10-11T03:00:00.000Z"); // 00:00 do dia 11 (fim do dia 10 inclusive)
  });

  it("o período anterior tem a MESMA duração, imediatamente antes da data inicial", () => {
    const p = calculatePeriodDates(KEY, REF, SP);

    expect(p.previousEnd.getTime()).toBe(p.currentStart.getTime());
    expect(p.previousEnd.getTime() - p.previousStart.getTime()).toBe(p.currentEnd.getTime() - p.currentStart.getTime());
    expect(p.periodInfo).toMatchObject({
      isCustom: true,
      days: 10,
      current: { from: "2026-10-01", to: "2026-10-10" },
      previous: { from: "2026-09-21", to: "2026-09-30" },
    });
  });

  it("fuso com horário de verão: a meia-noite é a do fuso, não 00:00Z", () => {
    // Nova York em 1/11/2026 ainda está em horário de verão (UTC-4); em 2/11 já voltou (UTC-5)
    expect(startOfDateKeyInTimezone("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(startOfDateKeyInTimezone("2026-11-02", "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("intervalo que termina hoje: asOf é agora, não o fim do dia", () => {
    const p = calculatePeriodDates(buildCustomPeriodKey("2026-10-10", "2026-10-15"), REF, SP);

    expect(p.currentEnd.toISOString()).toBe("2026-10-16T03:00:00.000Z");
    expect(p.asOf.toISOString()).toBe(REF.toISOString());
  });

  it("aritmética de datas: dias contados nas duas pontas", () => {
    expect(countDaysInclusive("2026-10-01", "2026-10-01")).toBe(1);
    expect(countDaysInclusive("2026-10-01", "2026-10-10")).toBe(10);
    expect(addDaysToDateKey("2026-10-01", -1)).toBe("2026-09-30");
  });

  describe("período em andamento (o atual está incompleto e o anterior é inteiro)", () => {
    const inProgress = (key) => calculatePeriodDates(key, REF, SP).periodInfo.inProgress;

    it("[TESTE OBRIGATÓRIO] intervalo que termina HOJE está em andamento", () => {
      expect(inProgress(buildCustomPeriodKey("2026-10-10", "2026-10-15"))).toBe(true);
      expect(inProgress(buildCustomPeriodKey("2026-10-15", "2026-10-15"))).toBe(true); // só hoje
    });

    it("[TESTE OBRIGATÓRIO] intervalo que terminou ONTEM não está em andamento", () => {
      expect(inProgress(buildCustomPeriodKey("2026-10-10", "2026-10-14"))).toBe(false);
      expect(inProgress(buildCustomPeriodKey("2026-10-14", "2026-10-14"))).toBe(false);
      expect(inProgress(KEY)).toBe(false);
    });

    it("[TESTE OBRIGATÓRIO] 'este mês' está em andamento", () => {
      expect(inProgress("this_month")).toBe(true);
    });

    it("[TESTE OBRIGATÓRIO] 7 e 30 dias NÃO: são rolantes nos dois lados", () => {
      expect(inProgress("30d")).toBe(false);
      expect(inProgress("7d")).toBe(false);
    });

    it("o dia de hoje é em SÃO PAULO, não em UTC: às 22:30 do dia 15 (já dia 16 em UTC) o dia 15 ainda é hoje", () => {
      // 16/10 01:30Z = 15/10 22:30 em SP: terminar em 15 está em andamento; terminar em 14 não
      expect(inProgress(buildCustomPeriodKey("2026-10-01", "2026-10-15"))).toBe(true);
      expect(inProgress(buildCustomPeriodKey("2026-10-01", "2026-10-14"))).toBe(false);
    });

    it("o período anterior NÃO é encurtado: continua com N dias inteiros", () => {
      const p = calculatePeriodDates(buildCustomPeriodKey("2026-10-01", "2026-10-15"), REF, SP);

      expect(p.periodInfo.inProgress).toBe(true);
      expect(p.periodInfo.previous).toEqual({ from: "2026-09-16", to: "2026-09-30" }); // 15 dias inteiros
      expect(p.previousEnd.getTime() - p.previousStart.getTime()).toBe(15 * 86400000);
    });
  });

  it("atalhos continuam rolantes e sem alteração", () => {
    const p = calculatePeriodDates("30d", REF, SP);

    expect(p.currentEnd.toISOString()).toBe(REF.toISOString());
    expect(p.currentEnd.getTime() - p.currentStart.getTime()).toBe(30 * 86400000);
    expect(p.periodInfo).toMatchObject({ isCustom: false, days: 30 });
  });
});

// ── pool que anota o que cada consulta recebeu ───────────────────────────
const MARKERS = [
  ["gdUsage", "has_gd"],
  ["proposals", "current_proposals"],
  ["contracts", "current_contracts"],
  ["sent", "AS current_sent"],
  ["replied", "AS current_replied"],
  ["meetings", "current_meetings"],
  ["messages", "HAVING COUNT(*) >= $4"],
  ["chips", "FROM public.lead_client_evolution_instances i"],
  ["chipReplies", "runs_by_instance"],
  ["unattributed", "unattributed_sent"],
  ["regions", "regional_runs"],
  ["failures", "status IN ('failed', 'invalid_number')"],
  ["orphans", "l.assigned_to IS NULL"],
  ["closings", "current_closings"],
  ["classification", "TRIM(l.stage)"],
  ["firstReplyOnly", "stopped_after_first"],
  ["profiles", "WITH cohort AS"],
  ["baseHealth", "no_reply_over_days"],
  ["firstHuman", "median_minutes"],
];

function makePool(responses = {}) {
  const calls = {};
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      for (const [name, marker] of MARKERS) {
        if (text.includes(marker)) {
          calls[name] = params;
          const r = responses[name];
          return typeof r === "function" ? r(params) : r || { rows: [] };
        }
      }
      return { rows: [] };
    },
  };
}

const compute = (pool, key = KEY, options = {}) => calculateDashboardMetrics(pool, "tenant-a", key, { referenceDate: REF, ...options });

let errorSpy;
let warnSpy;
beforeEach(() => {
  _resetDashboardCacheTableEnsuredForTest();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("Período personalizado — vale para todos os blocos", () => {
  const START = "2026-10-01T03:00:00.000Z";
  const END = "2026-10-11T03:00:00.000Z";
  const PREV_START = "2026-09-21T03:00:00.000Z";

  it("[TESTE OBRIGATÓRIO] toda consulta do período recebe as datas do intervalo escolhido — nenhum bloco usa os últimos 30 dias", async () => {
    const periodBound = [
      "sent", "replied", "meetings", "proposals", "contracts", "messages", "chipReplies", "unattributed",
      "regions", "failures", "orphans", "closings", "classification", "firstReplyOnly", "profiles", "firstHuman",
    ];
    // proposals/contracts só rodam se o tenant usa GD
    const pool2 = makePool({ gdUsage: { rows: [{ has_gd: true }] } });
    await compute(pool2);
    for (const name of periodBound) {
      const params = pool2.calls[name];
      expect(params, `consulta "${name}" não rodou`).toBeDefined();
      expect(params, `"${name}" não recebeu o início do intervalo`).toContain(START);
      expect(params, `"${name}" não recebeu o fim do intervalo`).toContain(END);
    }
    // blocos com comparação também recebem o período anterior (mesma duração, antes da data inicial)
    for (const name of ["sent", "replied", "meetings", "proposals", "contracts", "closings"]) {
      expect(pool2.calls[name], `"${name}" sem o período anterior`).toContain(PREV_START);
    }
  });

  it("[TESTE OBRIGATÓRIO] ranking de chips, saúde da base e demais medidas também respeitam o intervalo", async () => {
    const pool = makePool();

    await compute(pool);

    // ledger de cota: dias do intervalo no fuso do tenant (último dia INCLUSIVE) e HOJE à parte
    expect(pool.calls.chips).toEqual(["tenant-a", "2026-10-01", "2026-10-10", "2026-10-15"]);
    // saúde da base: a base até o fim do intervalo, não a de hoje
    expect(pool.calls.baseHealth[1]).toBe(END);
    // espera humana: "agora" real, porque a resposta é buscada sem limite de data
    expect(pool.calls.firstHuman[3]).toBe(REF.toISOString());
  });

  it("o payload diz qual período é: custom, com as datas", async () => {
    const m = await compute(makePool());

    expect(m.period).toBe("custom");
    expect(m.periodInfo).toMatchObject({
      key: KEY,
      isCustom: true,
      days: 10,
      current: { from: FROM, to: TO },
      previous: { from: "2026-09-21", to: "2026-09-30" },
    });
  });

  it("[TESTE OBRIGATÓRIO] avisos: 'responderam sem responsável' conta só respostas DO intervalo", async () => {
    const pool = makePool({ orphans: { rows: [{ count: 3 }] } });

    const m = await compute(pool);

    expect(pool.calls.orphans).toEqual(["tenant-a", START, END]);
    expect(m.alerts.map((a) => a.id)).toContain("alert_orphaned_replies");
  });

  describe("aviso do chip frio perto do teto (é sobre HOJE)", () => {
    const coldChip = {
      rows: [{ instance_id: "i1", instance_name: "Chip", chip_state: "cold", daily_limit_override: null, sent_period: 0, sent_today: 45 }],
    };

    it("[TESTE OBRIGATÓRIO] intervalo que inclui hoje: o aviso aparece", async () => {
      const m = await compute(makePool({ chips: coldChip }), buildCustomPeriodKey("2026-10-10", "2026-10-15"));

      expect(m.alerts.map((a) => a.id)).toContain("alert_cold_chip_limit");
    });

    it("[TESTE OBRIGATÓRIO] intervalo no passado: o aviso de hoje não vale, e isso não conta como 'lista incompleta'", async () => {
      const m = await compute(makePool({ chips: coldChip }));

      expect(m.alerts.map((a) => a.id)).not.toContain("alert_cold_chip_limit");
      expect(m.unavailableBlocks).not.toContain("alerts");
    });
  });
});

// ── cache: tabela simulada, uma linha por (tenant, período) ───────────────
function makeCachePool() {
  const rows = new Map();
  const log = { calculations: 0, inserts: [], selects: [], deletes: [] };
  return {
    rows,
    log,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("CREATE TABLE")) return { rows: [] };
      if (text.includes("SELECT data, calculated_at, status, last_error FROM public.dashboard_metrics_cache")) {
        log.selects.push(params.slice());
        const row = rows.get(`${params[0]}|${params[1]}`);
        return { rows: row ? [row] : [] };
      }
      if (text.includes("INSERT INTO public.dashboard_metrics_cache")) {
        log.inserts.push(params.slice());
        rows.set(`${params[0]}|${params[1]}`, {
          data: JSON.parse(params[2]),
          calculated_at: new Date().toISOString(),
          status: "fresh",
          last_error: null,
        });
        return { rows: [] };
      }
      if (text.includes("DELETE FROM public.dashboard_metrics_cache")) {
        log.deletes.push({ sql: text, params: params.slice() });
        return { rows: [] };
      }
      if (text.includes("AS current_sent")) {
        log.calculations += 1;
        // o número depende do início do intervalo pedido: dá para ver de quem é o resultado
        return { rows: [{ current_sent: Number(String(params[1]).slice(8, 10)), previous_sent: 1 }] };
      }
      return { rows: [] };
    },
  };
}

describe("Período personalizado — cache com chave própria", () => {
  const A = buildCustomPeriodKey("2026-10-01", "2026-10-10");
  const B = buildCustomPeriodKey("2026-10-05", "2026-10-12");

  it("[TESTE OBRIGATÓRIO] intervalos diferentes do mesmo tenant têm linhas diferentes: um usuário nunca vê o resultado do intervalo de outro", async () => {
    const pool = makeCachePool();

    const a = await getOrComputeDashboardMetrics(pool, "tenant-a", A, { referenceDate: REF });
    const b = await getOrComputeDashboardMetrics(pool, "tenant-a", B, { referenceDate: REF });

    expect(pool.log.calculations).toBe(2); // B NÃO foi respondido com o cache de A
    expect(pool.log.inserts.map((p) => p[1])).toEqual([A, B]);
    expect([...pool.rows.keys()].sort()).toEqual([`tenant-a|${A}`, `tenant-a|${B}`]);
    expect(a.periodInfo.current).toEqual({ from: "2026-10-01", to: "2026-10-10" });
    expect(b.periodInfo.current).toEqual({ from: "2026-10-05", to: "2026-10-12" });
    expect(a.summary.sent.current).not.toBe(b.summary.sent.current);
  });

  it("o mesmo intervalo pela segunda vez vem do cache, sem recalcular", async () => {
    const pool = makeCachePool();

    await getOrComputeDashboardMetrics(pool, "tenant-a", A, { referenceDate: REF });
    const again = await getOrComputeDashboardMetrics(pool, "tenant-a", A, { referenceDate: REF, now: new Date() });

    expect(pool.log.calculations).toBe(1);
    expect(again.periodInfo.key).toBe(A);
  });

  it("o mesmo intervalo em outro tenant é outra linha", async () => {
    const pool = makeCachePool();

    await getOrComputeDashboardMetrics(pool, "tenant-a", A, { referenceDate: REF });
    await getOrComputeDashboardMetrics(pool, "tenant-b", A, { referenceDate: REF });

    expect(pool.log.calculations).toBe(2);
    expect([...pool.rows.keys()].sort()).toEqual([`tenant-a|${A}`, `tenant-b|${A}`]);
  });

  it("atalho e intervalo nunca se misturam: 30d não responde por custom", async () => {
    const pool = makeCachePool();

    await getOrComputeDashboardMetrics(pool, "tenant-a", "30d", { referenceDate: REF });
    await getOrComputeDashboardMetrics(pool, "tenant-a", A, { referenceDate: REF });

    expect(pool.log.calculations).toBe(2);
    expect(pool.log.selects.map((p) => p[1])).toEqual(["30d", A]);
  });

  it("chave mal formada cai em 30d no cache (nunca grava lixo como chave)", async () => {
    const pool = makeCachePool();

    await getOrComputeDashboardMetrics(pool, "tenant-a", "custom:lixo", { referenceDate: REF });

    expect(pool.log.inserts.map((p) => p[1])).toEqual(["30d"]);
  });

  it("travas de recálculo também são por intervalo: dois intervalos calculam em paralelo", async () => {
    const pool = makeCachePool();

    await Promise.all([
      getOrComputeDashboardMetrics(pool, "tenant-a", A, { referenceDate: REF }),
      getOrComputeDashboardMetrics(pool, "tenant-a", B, { referenceDate: REF }),
    ]);

    expect(pool.log.calculations).toBe(2);
    expect(_getActiveRecalculationsForTest().size).toBe(0);
  });

  it("intervalos antigos do tenant são limpos do cache (a tabela não cresce sem limite) — só ao gravar intervalo personalizado", async () => {
    const pool = makeCachePool();

    await getOrComputeDashboardMetrics(pool, "tenant-a", "30d", { referenceDate: REF });
    expect(pool.log.deletes).toHaveLength(0);

    await getOrComputeDashboardMetrics(pool, "tenant-a", A, { referenceDate: REF });
    expect(pool.log.deletes).toHaveLength(1);
    expect(pool.log.deletes[0].sql).toContain("period LIKE 'custom:%'");
    expect(pool.log.deletes[0].params).toEqual(["tenant-a"]);
  });
});

// ── rota HTTP ────────────────────────────────────────────────────────────
describe("Período personalizado — rota GET /api/dashboard", () => {
  async function callRoute(query) {
    const { registerInsightsRoutes } = await import("../domains/insights/routes.js");
    const routes = {};
    const fakeApp = new Proxy(
      {},
      { get: (_t, method) => (path, ...mw) => { routes[`${String(method).toUpperCase()} ${path}`] = mw[mw.length - 1]; } }
    );
    const pool = makeCachePool();
    registerInsightsRoutes(fakeApp, {
      ensureDb: () => true,
      ensureSharedRoutePageAccess: () => true,
      resolveAuthorizedClientId: (_req, _res, id) => id || "tenant-test",
      requireFirebaseAuth: (_req, _res, next) => (next ? next() : undefined),
      requireInternalPageAccess: () => (_req, _res, next) => (next ? next() : undefined),
      normalizeString: (s) => (typeof s === "string" ? s.trim() : ""),
      sendError: (res, status, code, message) => res.status(status).json({ error: code, message }),
      pgDatabasePool: pool,
      supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "tenant-test", name: "T" }, error: null }) }) }) }) },
    });
    let body = null;
    let status = 200;
    const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
    await routes["GET /api/dashboard"]({ query: { clientId: "tenant-test", ...query }, authAccess: { role: "client", clientId: "tenant-test" } }, res);
    return { status, body, pool };
  }

  it("[TESTE OBRIGATÓRIO] intervalo invertido: 400 com a mensagem do motivo, sem consultar o banco", async () => {
    const { status, body, pool } = await callRoute({ period: "custom", from: "2026-02-10", to: "2026-02-01" });

    expect(status).toBe(400);
    expect(body.error).toBe("DASHBOARD_INVALID_PERIOD");
    expect(body.message).toContain("A data inicial (10/02/2026) é depois da data final (01/02/2026)");
    expect(pool.log.selects).toHaveLength(0);
    expect(pool.log.calculations).toBe(0);
  });

  it("[TESTE OBRIGATÓRIO] intervalo no futuro: 400 com a mensagem do motivo", async () => {
    const { status, body } = await callRoute({ period: "custom", from: "2026-01-01", to: "2099-01-01" });

    expect(status).toBe(400);
    expect(body.error).toBe("DASHBOARD_INVALID_PERIOD");
    expect(body.message).toContain("A data final (01/01/2099) está no futuro");
  });

  it("sem as datas: 400 pedindo as datas", async () => {
    const { status, body } = await callRoute({ period: "custom" });

    expect(status).toBe(400);
    expect(body.message).toContain("Informe a data inicial e a data final");
  });

  it("intervalo válido: 200, consulta o cache pela chave do intervalo e devolve o período", async () => {
    const { status, body, pool } = await callRoute({ period: "custom", from: "2026-01-01", to: "2026-01-10" });

    expect(status).toBe(200);
    expect(pool.log.selects[0]).toEqual(["tenant-test", "custom:2026-01-01:2026-01-10"]);
    expect(body.period).toBe("custom");
    expect(body.periodInfo.current).toEqual({ from: "2026-01-01", to: "2026-01-10" });
  });

  it("atalho continua funcionando sem datas", async () => {
    const { status, pool } = await callRoute({ period: "7d" });

    expect(status).toBe(200);
    expect(pool.log.selects[0][1]).toBe("7d");
  });
});
