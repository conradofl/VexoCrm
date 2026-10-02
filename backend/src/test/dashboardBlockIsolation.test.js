// backend/src/test/dashboardBlockIsolation.test.js
//
// O dashboard não pode cair inteiro por causa de um bloco. Em produção deu 500 porque UMA
// consulta (tabela ausente / coluna com outro nome) derrubava a tela toda.
//
// Regras:
//  - cada bloco falha sozinho; os outros continuam aparecendo;
//  - bloco indisponível NÃO é zero: vira `null` + nome em `unavailableBlocks` (zero é um dado e mente);
//  - só devolve erro quando nenhum bloco pôde ser calculado;
//  - tabela ausente (isMissingSchemaError) é caso esperado: não propaga;
//  - a causa vai para o log do servidor com o nome do bloco e a mensagem do Postgres.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  calculateDashboardMetrics,
  getOrComputeDashboardMetrics,
  _resetDashboardCacheTableEnsuredForTest,
  _getActiveRecalculationsForTest,
  DASHBOARD_CACHE_TTL_MS,
  DASHBOARD_PARTIAL_CACHE_TTL_MS,
} from "../services/dashboardCalculations.js";

// Cada bloco → trecho único do SQL dele. Ordem importa: o primeiro que casar responde.
const BLOCK_QUERIES = [
  ["summary.gdUsage", "has_gd"],
  ["summary.proposals", "current_proposals"],
  ["summary.contracts", "current_contracts"],
  ["summary.sent", "AS current_sent"],
  ["summary.replied", "AS current_replied"],
  ["summary.meetings", "current_meetings"],
  ["rankings.messages", "HAVING COUNT(*) >= $4"],
  ["rankings.chips", "FROM public.lead_client_evolution_instances i"],
  ["rankings.chips.replies", "runs_by_instance"],
  ["rankings.regions", "regional_runs"],
  ["rankings.failureReasons", "status IN ('failed', 'invalid_number')"],
  ["alerts", "l.assigned_to IS NULL"],
  // Fase 1.5
  ["summary.closings", "current_closings"],
  ["analysis.leadClassification", "TRIM(l.stage)"],
  ["analysis.firstReplyOnly", "stopped_after_first"],
  ["analysis.topProfiles", "WITH cohort AS"],
  ["analysis.baseHealth", "no_reply_over_days"],
  ["analysis.firstHumanResponse", "median_minutes"],
];

const HEALTHY = {
  "summary.gdUsage": { rows: [{ has_gd: true }] },
  "summary.proposals": { rows: [{ current_proposals: 10, previous_proposals: 5 }] },
  "summary.contracts": { rows: [{ current_contracts: 4, previous_contracts: 2 }] },
  "summary.sent": { rows: [{ current_sent: 150, previous_sent: 100 }] },
  "summary.replied": { rows: [{ current_replied: 30, previous_replied: 15 }] },
  "summary.meetings": { rows: [{ current_meetings: 12, previous_meetings: 8 }] },
  "rankings.messages": {
    rows: [
      { campaign_id: "c1", campaign_name: "Campanha A", message: "oi", sent_count: 60, replied_count: 30, reply_rate: 50 },
      { campaign_id: "c2", campaign_name: "Campanha B", message: "olá", sent_count: 40, replied_count: 12, reply_rate: 30 },
    ],
  },
  "rankings.chips": {
    rows: [
      { instance_id: "chip-1", instance_name: "Chip 1", chip_state: "warm", daily_limit_override: null, sent_period: 80, sent_today: 10 },
    ],
  },
  "rankings.chips.replies": { rows: [{ instance_id: "chip-1", sent_count: 80, replied_count: 20 }] },
  "rankings.regions": { rows: [{ ddd: "11", cidade: "São Paulo", sent: 70, replies: 21, reply_rate: 30 }] },
  "rankings.failureReasons": {
    rows: [
      { status: "failed", error_message: "instância desconectada" },
      { status: "invalid_number", error_message: "Número inexistente" },
    ],
  },
  alerts: { rows: [{ count: 0 }] },
  "summary.closings": { rows: [{ current_closings: 3, previous_closings: 1 }] },
  "analysis.leadClassification": {
    rows: [
      { temperature: "QUENTE", stage: "open_budget", leads: 4 },
      { temperature: "SEM_CLASSIFICACAO", stage: "cold", leads: 20 },
    ],
  },
  "analysis.firstReplyOnly": { rows: [{ replied_first: 12, received_follow_up: 10, stopped_after_first: 7 }] },
  "analysis.topProfiles": { rows: [{ temperature: "QUENTE", origin: "meta_ads", leads: 40, replied: 20, scheduled: 8, closed: 4 }] },
  "analysis.baseHealth": { rows: [{ total: 100, valid_phone: 90, never_approached: 30, no_reply_over_days: 25 }] },
  "analysis.firstHumanResponse": {
    rows: [{ conversations: 10, answered: 8, waiting: 2, waiting_over_threshold: 1, median_minutes: 12, p90_minutes: 95 }],
  },
};

// Erro com a cara de um erro do `pg`.
function pgError(message, code = "57014") {
  return Object.assign(new Error(message), { code });
}

/**
 * Pool de teste: cada consulta responde saudável, exceto as dos blocos em `failing`
 * (nome do bloco → erro a lançar). É o "fazer cada consulta lançar erro" da prova.
 */
function makePool(failing = {}) {
  return {
    async query(sql) {
      const text = String(sql);
      for (const [block, marker] of BLOCK_QUERIES) {
        if (text.includes(marker)) {
          if (failing[block]) throw failing[block];
          return HEALTHY[block];
        }
      }
      return { rows: [] };
    },
  };
}

// Cópia do payload sem os caminhos dados ("summary.sent", "rankings.chips"...).
function without(payload, paths) {
  const copy = JSON.parse(JSON.stringify(payload));
  for (const p of paths) {
    const parts = p.split(".");
    let node = copy;
    for (const part of parts.slice(0, -1)) node = node?.[part];
    if (node) delete node[parts[parts.length - 1]];
  }
  return copy;
}

const REF = { referenceDate: new Date("2026-10-15T12:00:00.000Z") };
const compute = (pool) => calculateDashboardMetrics(pool, "tenant-a", "30d", REF);

let errorSpy;
let warnSpy;
beforeEach(() => {
  _resetDashboardCacheTableEnsuredForTest();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const loggedText = () => [...errorSpy.mock.calls, ...warnSpy.mock.calls].map((c) => c.join(" ")).join("\n");

describe("Dashboard — baseline saudável", () => {
  it("sem falha nenhuma, nada fica indisponível e os números batem", async () => {
    const m = await compute(makePool());

    expect(m.unavailableBlocks).toEqual([]);
    expect(m.summary.sent).toMatchObject({ current: 150, previous: 100 });
    expect(m.summary.replied).toMatchObject({ current: 30, previous: 15, rate: 20 });
    expect(m.summary.meetings).toMatchObject({ current: 12, previous: 8 });
    expect(m.summary.proposals).toMatchObject({ current: 10, previous: 5 });
    expect(m.summary.contracts).toMatchObject({ current: 4, previous: 2 });
    expect(m.rankings.messages.length).toBe(2);
    expect(m.rankings.chips.length).toBe(1);
    expect(m.rankings.regions.length).toBe(1);
    expect(m.rankings.failureReasons.length).toBe(2);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("Dashboard — cada bloco falhando individualmente mantém os outros", () => {
  // [bloco que cai, caminho no payload que fica null, extras que mudam por dependência]
  const CASES = [
    { block: "summary.sent", path: "summary.sent", alsoMarks: ["alerts"], alsoChanges: ["summary.replied.rate", "summary.replied.previousRate", "alerts"] },
    { block: "summary.replied", path: "summary.replied", alsoMarks: [], alsoChanges: [] },
    { block: "summary.meetings", path: "summary.meetings", alsoMarks: [], alsoChanges: [] },
    { block: "summary.proposals", path: "summary.proposals", alsoMarks: [], alsoChanges: [] },
    { block: "summary.contracts", path: "summary.contracts", alsoMarks: [], alsoChanges: [] },
    { block: "rankings.messages", path: "rankings.messages", alsoMarks: ["alerts"], alsoChanges: ["alerts"] },
    { block: "rankings.chips", path: "rankings.chips", alsoMarks: ["alerts"], alsoChanges: ["alerts", "rankings.chipsUnattributedSent"] },
    { block: "rankings.chips.replies", path: "rankings.chips", alsoMarks: ["alerts"], alsoChanges: ["alerts", "rankings.chipsUnattributedSent"], marks: "rankings.chips" },
    { block: "rankings.regions", path: "rankings.regions", alsoMarks: [], alsoChanges: [] },
    { block: "rankings.failureReasons", path: "rankings.failureReasons", alsoMarks: ["alerts"], alsoChanges: ["alerts", "rankings.failureTotals"] },
    { block: "alerts", path: null, alsoMarks: [], alsoChanges: [] },
    { block: "summary.closings", path: "summary.closings", alsoMarks: [], alsoChanges: [] },
    { block: "analysis.leadClassification", path: "analysis.leadClassification", alsoMarks: [], alsoChanges: [] },
    { block: "analysis.firstReplyOnly", path: "analysis.firstReplyOnly", alsoMarks: [], alsoChanges: [] },
    { block: "analysis.topProfiles", path: "analysis.topProfiles", alsoMarks: [], alsoChanges: [] },
    { block: "analysis.baseHealth", path: "analysis.baseHealth", alsoMarks: [], alsoChanges: [] },
    { block: "analysis.firstHumanResponse", path: "analysis.firstHumanResponse", alsoMarks: [], alsoChanges: [] },
  ];

  for (const c of CASES) {
    it(`[prova] consulta de "${c.block}" lança erro → só esse bloco some, o resto da tela continua`, async () => {
      const baseline = await compute(makePool());
      const metrics = await compute(makePool({ [c.block]: pgError(`falha simulada em ${c.block}`) }));

      // 1. o bloco que caiu está marcado como indisponível
      const marked = c.marks || c.block;
      expect(metrics.unavailableBlocks).toContain(marked);
      for (const extra of c.alsoMarks) expect(metrics.unavailableBlocks).toContain(extra);

      // 2. e vale null — NUNCA zero nem lista vazia
      if (c.path) {
        const value = c.path.split(".").reduce((n, k) => n?.[k], metrics);
        expect(value, `${c.path} deveria ser null`).toBeNull();
      }

      // 3. todo o resto é idêntico ao baseline saudável
      const ignore = ["unavailableBlocks", ...(c.path ? [c.path] : []), ...c.alsoChanges];
      expect(without(metrics, ignore)).toEqual(without(baseline, ignore));

      // 4. a tela não recebeu erro
      expect(metrics.period).toBe("30d");
    });
  }
});

describe("Dashboard — indisponível não é zero", () => {
  it("bloco que falhou nunca vira o número 0 nem lista vazia", async () => {
    const m = await compute(
      makePool({
        "summary.sent": pgError("boom"),
        "summary.meetings": pgError("boom"),
        "rankings.messages": pgError("boom"),
        "rankings.chips": pgError("boom"),
        "rankings.regions": pgError("boom"),
      })
    );

    expect(m.summary.sent).toBeNull();
    expect(m.summary.meetings).toBeNull();
    expect(m.rankings.messages).toBeNull();
    expect(m.rankings.chips).toBeNull();
    expect(m.rankings.regions).toBeNull();
    // mas o que foi calculado continua sendo número real
    expect(m.summary.replied.current).toBe(30);
  });

  it("sem os envios, a taxa de resposta é indisponível (null), não 0%", async () => {
    const m = await compute(makePool({ "summary.sent": pgError("boom") }));

    expect(m.summary.replied.current).toBe(30);
    expect(m.summary.replied.rate).toBeNull();
    expect(m.summary.replied.previousRate).toBeNull();
  });

  it("sem as respostas, a taxa também é indisponível, e os envios seguem", async () => {
    const m = await compute(makePool({ "summary.replied": pgError("boom") }));

    expect(m.summary.replied).toBeNull();
    expect(m.summary.sent.current).toBe(150);
  });

  it("zero de verdade continua sendo zero: consulta que funcionou e não achou nada", async () => {
    const pool = makePool();
    const original = pool.query.bind(pool);
    pool.query = async (sql) => {
      if (String(sql).includes("current_meetings")) return { rows: [{ current_meetings: 0, previous_meetings: 0 }] };
      return original(sql);
    };

    const m = await compute(pool);

    expect(m.summary.meetings).toMatchObject({ current: 0, previous: 0 });
    expect(m.unavailableBlocks).toEqual([]);
  });

  it("avisos: bloco de que dependem indisponível → aviso não é avaliado e o painel diz que a lista pode estar incompleta", async () => {
    // chip frio perto do teto: o aviso 4 depende do ranking de chips
    const coldChips = {
      rows: [{ instance_id: "chip-1", instance_name: "Chip", chip_state: "cold", daily_limit_override: null, sent_period: 45, sent_today: 45 }],
    };
    const comChips = makePool();
    const orig = comChips.query.bind(comChips);
    comChips.query = async (sql) => (String(sql).includes("FROM public.lead_client_evolution_instances i") ? coldChips : orig(sql));
    expect((await compute(comChips)).alerts.map((a) => a.id)).toContain("alert_cold_chip_limit");

    const semChips = makePool({ "rankings.chips": pgError("boom") });
    const orig2 = semChips.query.bind(semChips);
    semChips.query = async (sql) => {
      if (String(sql).includes("FROM public.lead_client_evolution_instances i")) throw pgError("boom");
      return orig2(sql);
    };
    const m = await compute(semChips);
    expect(m.alerts.map((a) => a.id)).not.toContain("alert_cold_chip_limit");
    expect(m.unavailableBlocks).toContain("alerts");
  });
});

describe("Dashboard — todos os blocos falhando devolve erro", () => {
  it("nenhum bloco calculado → lança erro com a primeira causa", async () => {
    const all = Object.fromEntries(BLOCK_QUERIES.map(([block]) => [block, pgError(`sem banco (${block})`, "08006")]));

    const error = await compute(makePool(all)).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("nenhum bloco pôde ser calculado");
    expect(error.message).toContain("sem banco (summary.sent)");
    expect(error.code).toBe("08006");
    expect(error.failures.map((f) => f.block)).toContain("rankings.regions");
  });

  it("um único bloco calculado já basta: NÃO é erro", async () => {
    const all = Object.fromEntries(
      BLOCK_QUERIES.filter(([block]) => block !== "rankings.regions").map(([block]) => [block, pgError("boom")])
    );

    const m = await compute(makePool(all));

    expect(m.rankings.regions.length).toBe(1);
    expect(m.summary.sent).toBeNull();
  });

  it("proposta e contrato (só de quem usa GD) não contam como 'calculado': tenant sem GD com tudo caído é erro", async () => {
    const all = Object.fromEntries(
      BLOCK_QUERIES.filter(([block]) => !["summary.gdUsage", "summary.proposals", "summary.contracts"].includes(block)).map(([block]) => [block, pgError("boom")])
    );

    await expect(compute(makePool(all))).rejects.toThrow("nenhum bloco pôde ser calculado");
  });
});

describe("Dashboard — tabela ausente é caso esperado", () => {
  it("tenant sem tabelas de Geração Digital: não propaga, esconde propostas/contratos (regra 5) e o resto segue", async () => {
    const missing = pgError('relation "public.gd_proposals" does not exist', "42P01");

    const m = await compute(makePool({ "summary.gdUsage": missing }));

    expect(m.hasProposalsAndContracts).toBe(false);
    expect(m.summary.proposals).toBeNull();
    expect(m.summary.contracts).toBeNull();
    // não é falha: não entra em indisponíveis e não vira error no log
    expect(m.unavailableBlocks).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("gd_proposals");
    // e o resto do painel é o mesmo do baseline
    expect(m.summary.sent.current).toBe(150);
    expect(m.rankings.chips.length).toBe(1);
  });

  it("erro de GD que NÃO é schema ausente: não dá para saber se usa → propostas e contratos ficam indisponíveis", async () => {
    const m = await compute(makePool({ "summary.gdUsage": pgError("statement timeout", "57014") }));

    expect(m.unavailableBlocks).toEqual(expect.arrayContaining(["summary.proposals", "summary.contracts"]));
    expect(errorSpy).toHaveBeenCalled();
    expect(m.summary.sent.current).toBe(150);
  });

  it("tabela de agendamentos ausente: não propaga; reuniões indisponíveis (não zero) e logado como esperado", async () => {
    const m = await compute(makePool({ "summary.meetings": pgError('relation "followup_schedules" does not exist', "42P01") }));

    expect(m.summary.meetings).toBeNull();
    expect(m.unavailableBlocks).toEqual(["summary.meetings"]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(loggedText()).toContain("followup_schedules");
    expect(m.summary.sent.current).toBe(150);
  });

  it("coluna com nome diferente (42703) também não derruba a tela", async () => {
    const m = await compute(makePool({ "rankings.chips": pgError('column "chip_state" does not exist', "42703") }));

    expect(m.rankings.chips).toBeNull();
    expect(m.rankings.regions.length).toBe(1);
  });
});

describe("Dashboard — a causa aparece no log do servidor", () => {
  it("log traz o nome do bloco, o tenant, o código e a mensagem do Postgres", async () => {
    await compute(makePool({ "rankings.regions": pgError("canceling statement due to statement timeout", "57014") }));

    const log = loggedText();
    expect(log).toContain("rankings.regions");
    expect(log).toContain("tenant-a");
    expect(log).toContain("57014");
    expect(log).toContain("canceling statement due to statement timeout");
  });

  it("cada bloco que cai gera a própria linha, com o próprio nome", async () => {
    await compute(
      makePool({
        "summary.sent": pgError("erro-do-envio"),
        "alerts": pgError("erro-dos-avisos"),
      })
    );

    const lines = errorSpy.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes('"summary.sent"') && l.includes("erro-do-envio"))).toBe(true);
    expect(lines.some((l) => l.includes('"alerts"') && l.includes("erro-dos-avisos"))).toBe(true);
  });

  it("bloco saudável não gera log nenhum", async () => {
    await compute(makePool());
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("Dashboard — cache", () => {
  const cacheRow = (data, ageMs, now) => ({
    rows: [{ data, calculated_at: new Date(now.getTime() - ageMs).toISOString(), status: "fresh", last_error: null }],
  });

  it("falha ao gravar o cache não derruba o painel: o número calculado vai para a tela", async () => {
    const pool = makePool();
    const inner = pool.query.bind(pool);
    pool.query = async (sql, params) => {
      const text = String(sql);
      if (text.includes("SELECT data, calculated_at, status, last_error")) return { rows: [] };
      if (text.includes("INSERT INTO public.dashboard_metrics_cache")) {
        throw pgError('relation "dashboard_metrics_cache" does not exist', "42P01");
      }
      return inner(text, params);
    };

    const m = await getOrComputeDashboardMetrics(pool, "tenant-cache", "30d", { forceRefresh: true });

    expect(m.summary.sent.current).toBe(150);
    expect(errorSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("cache não gravado");
  });

  it("resultado parcial vence em 2 minutos; resultado completo só em 15", async () => {
    expect(DASHBOARD_PARTIAL_CACHE_TTL_MS).toBeLessThan(DASHBOARD_CACHE_TTL_MS);
    const now = new Date("2026-10-15T12:00:00.000Z");
    const threeMin = 3 * 60 * 1000;

    const complete = { period: "30d", summary: { sent: { current: 1 } }, unavailableBlocks: [] };
    const partial = { period: "30d", summary: { sent: null }, unavailableBlocks: ["summary.sent"] };

    const poolComplete = makePool();
    const q1 = poolComplete.query.bind(poolComplete);
    poolComplete.query = async (sql, p) => (String(sql).includes("SELECT data, calculated_at, status, last_error") ? cacheRow(complete, threeMin, now) : q1(sql, p));
    const fresh = await getOrComputeDashboardMetrics(poolComplete, "t-complete", "30d", { now });
    expect(fresh.cacheStatus).toBe("fresh");
    expect(_getActiveRecalculationsForTest().has("t-complete:30d")).toBe(false);

    const poolPartial = makePool();
    const q2 = poolPartial.query.bind(poolPartial);
    poolPartial.query = async (sql, p) => (String(sql).includes("SELECT data, calculated_at, status, last_error") ? cacheRow(partial, threeMin, now) : q2(sql, p));
    const stale = await getOrComputeDashboardMetrics(poolPartial, "t-partial", "30d", { now });
    expect(stale.cacheStatus).toBe("stale");
    const pending = _getActiveRecalculationsForTest().get("t-partial:30d");
    expect(pending).toBeDefined();
    await pending;
  });
});
