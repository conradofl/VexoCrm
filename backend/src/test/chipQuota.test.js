import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS,
  ensureEvolutionInstanceDailyUsageTable,
  getChipDailyUsage,
  releaseChipDailyQuota,
  reserveChipDailyQuota,
  resetChipQuotaStateForTest,
  resolveChipDailyLimit,
  setChipQuotaDbPool,
} from "../services/chipQuota.js";

describe("chipQuota service", () => {
  beforeEach(() => {
    resetChipQuotaStateForTest();
  });

  describe("resolveChipDailyLimit", () => {
    it("usa fallback de 50 para chip cold", () => {
      expect(resolveChipDailyLimit({ chip_state: "cold" })).toBe(50);
      expect(resolveChipDailyLimit({})).toBe(50);
      expect(resolveChipDailyLimit(null)).toBe(50);
    });

    it("usa fallback de 500 para chip warm", () => {
      expect(resolveChipDailyLimit({ chip_state: "warm" })).toBe(500);
      expect(resolveChipDailyLimit({ chip_state: "WARM" })).toBe(500);
    });

    it("prioriza daily_limit_override quando for inteiro positivo", () => {
      expect(resolveChipDailyLimit({ chip_state: "cold", daily_limit_override: 120 })).toBe(120);
      expect(resolveChipDailyLimit({ chip_state: "warm", daily_limit_override: "350" })).toBe(350);
    });

    it("ignora daily_limit_override invalido ou <= 0 e recai no chip_state", () => {
      expect(resolveChipDailyLimit({ chip_state: "warm", daily_limit_override: 0 })).toBe(500);
      expect(resolveChipDailyLimit({ chip_state: "warm", daily_limit_override: -10 })).toBe(500);
      expect(resolveChipDailyLimit({ chip_state: "warm", daily_limit_override: "invalido" })).toBe(500);
      expect(resolveChipDailyLimit({ chip_state: "cold", daily_limit_override: null })).toBe(50);
    });
  });

  describe("database operations (reserve, usage, release)", () => {
    it("garante criacao de tabela evolution_instance_daily_usage", async () => {
      const queries = [];
      const mockPool = {
        query: vi.fn(async (sql, params) => {
          queries.push({ sql, params });
          return { rows: [] };
        }),
      };

      const result = await ensureEvolutionInstanceDailyUsageTable(mockPool);
      expect(result).toBe(true);
      expect(queries.some((q) => q.sql.includes("CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_usage"))).toBe(true);
    });

    it("reserveChipDailyQuota incrementa sent_count e retorna valor atualizado", async () => {
      const mockPool = {
        query: vi.fn(async (sql, params) => {
          if (sql.includes("INSERT INTO public.evolution_instance_daily_usage")) {
            return { rows: [{ sent_count: 7 }] };
          }
          return { rows: [] };
        }),
      };

      const count = await reserveChipDailyQuota("inst-123", "2026-09-14", mockPool);
      expect(count).toBe(7);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO public.evolution_instance_daily_usage"),
        ["inst-123", "2026-09-14"]
      );
    });

    it("getChipDailyUsage retorna contagem atual ou 0", async () => {
      const mockPool = {
        query: vi.fn(async (sql, params) => {
          if (sql.includes("SELECT sent_count FROM public.evolution_instance_daily_usage")) {
            return { rows: [{ sent_count: 15 }] };
          }
          return { rows: [] };
        }),
      };

      const usage = await getChipDailyUsage("inst-123", "2026-09-14", mockPool);
      expect(usage).toBe(15);
    });

    it("releaseChipDailyQuota executa decremento com GREATEST(sent_count - 1, 0)", async () => {
      let executedSql = "";
      let executedParams = [];
      const mockPool = {
        query: vi.fn(async (sql, params) => {
          executedSql = sql;
          executedParams = params;
          return { rows: [] };
        }),
      };

      await releaseChipDailyQuota("inst-123", "2026-09-14", mockPool);
      expect(executedSql).toContain("GREATEST(sent_count - 1, 0)");
      expect(executedParams).toEqual(["inst-123", "2026-09-14"]);
    });

    it("usa pool configurado via setChipQuotaDbPool quando nao passado explicitamente", async () => {
      const mockPool = {
        query: vi.fn(async (sql, params) => {
          if (sql.includes("SELECT sent_count FROM public.evolution_instance_daily_usage")) {
            return { rows: [{ sent_count: 42 }] };
          }
          return { rows: [] };
        }),
      };

      setChipQuotaDbPool(mockPool);
      const usage = await getChipDailyUsage("inst-999", "2026-09-14");
      expect(usage).toBe(42);
    });
  });
});
