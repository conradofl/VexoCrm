// backend/src/test/dashboardChipInstanceIdType.test.js
//
// evolution_instance_daily_usage.instance_id nasce como TEXT (chipQuota.js) ou como UUID
// (evolution.js) — quem rodar primeiro no banco define o tipo. O ranking de chips do dashboard
// comparava `u.instance_id = i.id::text`: com a coluna UUID isso estoura no Postgres com
// "operator does not exist: uuid = text" e (antes do isolamento por bloco) derrubava o painel.
//
// Este teste monta os DOIS cenários. O pool de teste aplica a regra do operador de igualdade do
// Postgres ao SQL que o código de produção realmente emite: uuid = text é erro; uuid = uuid e
// text = text passam; `::text` converte o lado para text.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { calculateDashboardMetrics } from "../services/dashboardCalculations.js";

// Compara `<alias>.instance_id` / `instance_id` com `i.id` (que é UUID), com ou sem ::text.
const COMPARISON = /(?:\bu\.)?\binstance_id(::text)?\s*=\s*i\.id(::text)?/g;

function assertEqualityOperatorsAreValid(sql, columnType) {
  const comparisons = [...sql.matchAll(COMPARISON)];
  for (const [, leftCast, rightCast] of comparisons) {
    const left = leftCast ? "text" : columnType;
    const right = rightCast ? "text" : "uuid";
    if (left !== right) {
      throw Object.assign(new Error(`operator does not exist: ${left} = ${right}`), { code: "42883" });
    }
  }
  return comparisons.length;
}

function makePool(columnType, seen) {
  return {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM public.lead_client_evolution_instances i") && text.includes("evolution_instance_daily_usage")) {
        seen.comparisons = assertEqualityOperatorsAreValid(text, columnType);
        return {
          rows: [
            { instance_id: "6f1f0a58-0000-4000-8000-000000000001", instance_name: "Chip 1", chip_state: "warm", daily_limit_override: null, sent_period: 80, sent_today: 10 },
          ],
        };
      }
      if (text.includes("runs_by_instance")) {
        return { rows: [{ instance_id: "6f1f0a58-0000-4000-8000-000000000001", sent_count: 80, replied_count: 20 }] };
      }
      if (text.includes("AS current_sent")) return { rows: [{ current_sent: 80, previous_sent: 60 }] };
      return { rows: [] };
    },
  };
}

let errorSpy;
let warnSpy;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const compute = (pool) => calculateDashboardMetrics(pool, "tenant-a", "30d", { referenceDate: new Date("2026-10-15T12:00:00.000Z") });

describe("Dashboard — ranking de chips com instance_id UUID ou TEXT", () => {
  for (const columnType of ["uuid", "text"]) {
    it(`[TESTE OBRIGATÓRIO] coluna instance_id = ${columnType.toUpperCase()}: o ranking de chips é calculado`, async () => {
      const seen = {};

      const metrics = await compute(makePool(columnType, seen));

      const causa = errorSpy.mock.calls.concat(warnSpy.mock.calls).map((c) => c.join(" ")).join(" | ");
      expect(metrics.rankings.chips, `ranking de chips indisponível: ${causa}`).not.toBeNull();
      // a regra do operador foi de fato exercida sobre a comparação real do SQL (1: subconsulta da cota de hoje;
      // o JOIN que somava a cota do período saiu — a cota não atribui envio)
      expect(seen.comparisons).toBe(1);
      expect(metrics.rankings.chips).toHaveLength(1);
      expect(metrics.rankings.chips[0]).toMatchObject({ name: "Chip 1", sent: 80, replies: 20, sentToday: 10 });
      expect(metrics.unavailableBlocks).not.toContain("rankings.chips");
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  }

  it("o emulador do operador é fiel: a comparação antiga (só o lado direito em ::text) falha com a coluna UUID", () => {
    const antigo = "LEFT JOIN public.evolution_instance_daily_usage u ON u.instance_id = i.id::text";

    expect(() => assertEqualityOperatorsAreValid(antigo, "uuid")).toThrow("operator does not exist: uuid = text");
    expect(() => assertEqualityOperatorsAreValid(antigo, "text")).not.toThrow();
  });
});
