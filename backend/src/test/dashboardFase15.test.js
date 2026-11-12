// backend/src/test/dashboardFase15.test.js
//
// Dashboard Fase 1.5 — o que continua no payload depois da saída do painel anterior: fechamentos,
// propostas e contratos, e três correções do que já estava na tela.
//
// Estes testes usam um pool simulado: provam a LÓGICA (o que cada linha do banco vira no payload) e o
// que o código manda para o banco. O SQL em si foi executado contra um Postgres real (pglite) por
// scratchpad/pglite/validate.mjs, comparando cada medida com uma conta independente em JavaScript.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  calculateDashboardMetrics,
  dateKeyInTimezone,
  isExpectedMissingTable,
} from "../services/dashboardCalculations.js";
import { VALID_CANONICAL_PHONE_REGEX } from "../services/dashboardAnalysis.js";
import { resolveLeadTemperatureBucket } from "../services/leadTemperature.js";
import { toCanonicalPhone } from "../services/canonicalPhone.js";

const REF = new Date("2026-10-16T01:30:00.000Z"); // 22:30 de 15/10 em São Paulo; no UTC já é dia 16

const MARKERS = [
  ["conversionsCheck", "to_regclass"],
  ["gd", "has_gd"],
  ["proposals", "current_proposals"],
  ["contracts", "current_contracts"],
  ["sent", "AS current_sent"],
  ["replied", "AS current_replied"],
  ["messages", "HAVING COUNT(*) >= $4"],
  ["chips", "FROM public.lead_client_evolution_instances i"],
  ["chipReplies", "runs_by_instance"],
  ["unattributed", "unattributed_sent"],
  ["regions", "regional_runs"],
  ["failures", "status IN ('failed', 'invalid_number')"],
  ["closings", "current_closings"],
];

function makePool(responses = {}, { onQuery } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      const text = String(sql);
      queries.push({ sql: text, params });
      for (const [name, marker] of MARKERS) {
        if (text.includes(marker)) {
          onQuery?.(name, params);
          const r = responses[name];
          if (r instanceof Error) throw r;
          return typeof r === "function" ? r(params) : r || { rows: [] };
        }
      }
      return { rows: [] };
    },
  };
}
const compute = (pool, options = {}) => calculateDashboardMetrics(pool, "tenant-a", "30d", { referenceDate: REF, ...options });
const pgError = (message, code) => Object.assign(new Error(message), { code });

let errorSpy;
let warnSpy;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("Temperatura e telefone válido — regras que a Visão geral herda", () => {
  it("[TESTE OBRIGATÓRIO] 'warm' não conta como classificação de temperatura", () => {
    expect(resolveLeadTemperatureBucket(null, "warm")).toBeNull(); // default da coluna, ninguém classificou
    expect(resolveLeadTemperatureBucket("", "warm")).toBeNull();
    expect(resolveLeadTemperatureBucket("MORNO", "warm")).toBe("MORNO"); // lead_temperature é escolha deliberada
    expect(resolveLeadTemperatureBucket(null, "hot")).toBe("QUENTE");
  });

  it("[TESTE OBRIGATÓRIO] número fabricado (5500…) e @lid não são telefone válido", () => {
    const valid = (raw) => new RegExp(VALID_CANONICAL_PHONE_REGEX).test(toCanonicalPhone(raw));
    expect(valid("(11) 98765-4321")).toBe(true);
    expect(valid("1132345678")).toBe(true); // fixo
    expect(valid("5500987654321")).toBe(false); // DDD 00 com formato de celular — o telefone fabricado
    expect(valid("5500123456789")).toBe(false);
    expect(valid("5511912345678@lid")).toBe(false);
    expect(valid("123")).toBe(false);
    expect(valid(null)).toBe(false);
  });
});

describe("Fechamentos, propostas e contratos", () => {
  it("fechamentos com variação sobre o período anterior", async () => {
    const m = await compute(makePool({ closings: { rows: [{ current_closings: 6, previous_closings: 3 }] } }));

    expect(m.summary.closings).toEqual({ current: 6, previous: 3, delta: 100 });
  });

  it("[TESTE OBRIGATÓRIO] tenant com GD mostra propostas e contratos", async () => {
    const m = await compute(
      makePool({
        gd: { rows: [{ has_gd: true }] },
        proposals: { rows: [{ current_proposals: 3, previous_proposals: 1 }] },
        contracts: { rows: [{ current_contracts: 2, previous_contracts: 0 }] },
      })
    );

    expect(m.hasProposalsAndContracts).toBe(true);
    expect(m.summary.proposals).toMatchObject({ current: 3, previous: 1 });
    expect(m.summary.contracts).toMatchObject({ current: 2, previous: 0 });
  });

  it("[TESTE OBRIGATÓRIO] erro de TIPO na verificação de uso NÃO vira 'tenant sem GD': as caixas ficam indisponíveis", async () => {
    // Era a causa das caixas sumidas: tenants.id (UUID) = gd_*.tenant_id (TEXT) estoura com 42883, e o
    // isMissingSchemaError (que casa "does not exist") classificava isso como "tabela ausente".
    const m = await compute(makePool({ gd: pgError("operator does not exist: uuid = text", "42883") }));

    expect(m.unavailableBlocks).toEqual(expect.arrayContaining(["summary.proposals", "summary.contracts"]));
    expect(errorSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("uuid = text");
  });

  it("só tabela inexistente (42P01) é caso esperado", () => {
    expect(isExpectedMissingTable(pgError('relation "gd_proposals" does not exist', "42P01"))).toBe(true);
    expect(isExpectedMissingTable(pgError("operator does not exist: uuid = text", "42883"))).toBe(false);
    expect(isExpectedMissingTable(pgError('column "x" does not exist', "42703"))).toBe(false);
    expect(isExpectedMissingTable(new Error("boom"))).toBe(false);
  });
});

describe("Conversões — UMA verificação decide se Fechamentos se aplica", () => {
  const SEM_TABELA = { conversionsCheck: { rows: [{ available: false }] } };
  const logs = () => ({
    error: errorSpy.mock.calls.map((c) => c.join(" ")).join("\n"),
    warn: warnSpy.mock.calls.map((c) => c.join(" ")).join("\n"),
  });

  it("[TESTE OBRIGATÓRIO] sem a tabela: Fechamentos não se aplica (null, fora de indisponíveis) e a consulta nem roda", async () => {
    const pool = makePool({ ...SEM_TABELA });

    const m = await compute(pool);

    expect(m.summary.closings).toBeNull();
    expect(m.unavailableBlocks).not.toContain("summary.closings");
    const sqls = pool.queries.map((q) => q.sql);
    expect(sqls.filter((q) => q.includes("to_regclass"))).toHaveLength(1);
    expect(sqls.some((q) => q.includes("current_closings"))).toBe(false);
    // nunca foi erro
    expect(logs().error).toBe("");
    expect(logs().warn).toContain("lead_conversions");
    expect(logs().warn).toContain('"summary.closings"');
  });

  it("[TESTE OBRIGATÓRIO] com a tabela: Fechamentos aparece completo, com uma verificação só", async () => {
    const pool = makePool({
      conversionsCheck: { rows: [{ available: true }] },
      closings: { rows: [{ current_closings: 6, previous_closings: 3 }] },
    });

    const m = await compute(pool);

    expect(m.summary.closings).toEqual({ current: 6, previous: 3, delta: 100 });
    expect(m.unavailableBlocks).toEqual([]);
    expect(pool.queries.map((q) => q.sql).filter((q) => q.includes("to_regclass"))).toHaveLength(1);
    expect(logs().warn).toBe("");
  });

  it("[TESTE OBRIGATÓRIO] com coluna faltando: indisponível (e o erro vai ao log)", async () => {
    const colunaFaltando = pgError('column "conversion_status" does not exist', "42703");
    const m = await compute(makePool({ conversionsCheck: { rows: [{ available: true }] }, closings: colunaFaltando }));

    expect(m.summary.closings).toBeNull();
    expect(m.unavailableBlocks).toContain("summary.closings");
    expect(logs().error).toContain('bloco "summary.closings"');
  });

  it("tabela presente e vazia: Fechamentos mostra ZERO (um dado), nem some nem é indisponível", async () => {
    const m = await compute(makePool({ conversionsCheck: { rows: [{ available: true }] }, closings: { rows: [{ current_closings: 0, previous_closings: 0 }] } }));

    expect(m.summary.closings).toEqual({ current: 0, previous: 0, delta: null });
    expect(m.unavailableBlocks).not.toContain("summary.closings");
  });

  it("[TESTE OBRIGATÓRIO] se a PRÓPRIA verificação falhar, não se presume 'não usa': o bloco roda e falha à vista", async () => {
    const m = await compute(
      makePool({
        conversionsCheck: pgError("connection terminated", "08006"),
        closings: pgError("connection terminated", "08006"),
      })
    );

    expect(m.unavailableBlocks).toContain("summary.closings"); // indisponível, não escondido
  });

  it("outros códigos e erro de TIPO continuam sendo indisponível (só 'tabela ausente' esconde)", async () => {
    for (const code of ["08006", "57014", "42883", "42P01", undefined]) {
      const m = await compute(makePool({ conversionsCheck: { rows: [{ available: true }] }, closings: pgError("falha", code) }));

      expect(m.summary.closings, `código ${code}`).toBeNull();
      expect(m.unavailableBlocks, `código ${code}`).toContain("summary.closings");
    }
  });
});

describe("Correção 1 — cota do chip é do DIA, envios são do PERÍODO", () => {
  it("[TESTE OBRIGATÓRIO] 'hoje' é a data no fuso do tenant, não no fuso do banco", async () => {
    let chipParams;
    await compute(makePool({}, { onQuery: (name, params) => name === "chips" && (chipParams = params) }));

    // 16/10 01:30 UTC = 15/10 22:30 em São Paulo: a cota de hoje é a do dia 15
    expect(dateKeyInTimezone(REF, "America/Sao_Paulo")).toBe("2026-10-15");
    expect(chipParams).toEqual(["tenant-a", "2026-10-15"]); // a cota é só de hoje: sem intervalo de período
  });

  it("chip traz envios do período e uso da cota de hoje em campos separados", async () => {
    const m = await compute(
      makePool({
        chips: { rows: [{ instance_id: "i1", instance_name: "Chip A", chip_state: "warm", daily_limit_override: 80, sent_period: 0, sent_today: 7 }] },
        chipReplies: { rows: [{ instance_id: "i1", sent_count: 201, replied_count: 40 }] },
      })
    );

    expect(m.rankings.chips[0]).toMatchObject({ sent: 201, replies: 40, sentToday: 7, quotaLimit: 80 });
  });
});

describe("Correção 2 — motivos de falha somam o total de FALHAS, não o de envios", () => {
  const failRow = (phone, status, error_message) => ({ phone, status, error_message });

  it("[TESTE OBRIGATÓRIO] percentuais e contagens fecham no total de falhas; mais de 3 motivos viram 2 + 'Demais motivos'", async () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => failRow(`5511900000${i}`, "invalid_number", "número não existe no WhatsApp")),
      failRow("55119000000", "invalid_number", "número não existe no WhatsApp"), // mesmo número de novo
      ...Array.from({ length: 3 }, (_, i) => failRow(`5511910000${i}`, "failed", "instância desconectada")),
      ...Array.from({ length: 2 }, (_, i) => failRow(`5511920000${i}`, "failed", "template missing variable")),
      ...Array.from({ length: 2 }, (_, i) => failRow(`5511930000${i}`, "failed", "HTTP 400 bad request")),
      failRow("55119400000", "failed", "xyz"),
    ];

    const m = await compute(
      makePool({ sent: { rows: [{ current_sent: 201, previous_sent: 100 }] }, failures: { rows } })
    );

    const f = m.rankings.failureReasons;
    expect(f.map((x) => x.reason)).toEqual(["Sem WhatsApp", "Chip fora do ar", "Demais motivos"]);
    expect(f.reduce((s, x) => s + x.count, 0)).toBe(14); // total de falhas, não os 201 envios
    expect(f.reduce((s, x) => s + x.percentage, 0)).toBe(100);
    expect(m.rankings.failureTotals).toEqual({ occurrences: 14, distinctNumbers: 13 });
    // "Sem WhatsApp": 6 ocorrências, mas só 5 números — a repetição fica visível
    expect(f[0]).toMatchObject({ count: 6, distinctNumbers: 5 });
  });

  it("até 3 motivos: todos aparecem, sem 'Demais motivos', somando 100%", async () => {
    const rows = [
      failRow("a", "invalid_number", "número não existe no WhatsApp"),
      failRow("b", "invalid_number", "número não existe no WhatsApp"),
      failRow("c", "failed", "instância desconectada"),
    ];

    const m = await compute(makePool({ failures: { rows } }));

    expect(m.rankings.failureReasons.map((x) => x.reason)).toEqual(["Sem WhatsApp", "Chip fora do ar"]);
    expect(m.rankings.failureReasons.reduce((s, x) => s + x.percentage, 0)).toBe(100);
  });
});

describe("Correção 3 — ranking de chips: o cruzamento", () => {
  it("[TESTE OBRIGATÓRIO] envio atribuído vem do disparo, nunca do contador da cota; sem chip registrado aparece à parte", async () => {
    const m = await compute(
      makePool({
        chips: {
          rows: [
            { instance_id: "i1", instance_name: "Chip A", chip_state: "warm", daily_limit_override: null, sent_period: 999, sent_today: 3 },
            { instance_id: "i2", instance_name: "Chip B", chip_state: "cold", daily_limit_override: null, sent_period: 888, sent_today: 0 },
          ],
        },
        chipReplies: { rows: [{ instance_id: "i1", sent_count: 12, replied_count: 4 }] },
        unattributed: { rows: [{ unattributed_sent: 5 }] },
      })
    );

    const a = m.rankings.chips.find((c) => c.name === "Chip A");
    const b = m.rankings.chips.find((c) => c.name === "Chip B");
    expect(a.sent).toBe(12); // não 999 (contador da cota)
    expect(b.sent).toBe(0); // sem disparo atribuído: 0 de disparo — e o contador 888 NÃO aparece como envio
    expect(m.rankings.chipsUnattributedSent).toBe(5);
  });
});
