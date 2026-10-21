import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS,
  ensureEvolutionInstanceDailyUsageTable,
  ensureEvolutionInstanceDailyUsableTable,
  ensureTolerant,
  getChipDailyUsage,
  releaseChipDailyQuota,
  reserveChipDailyQuota,
  resetChipQuotaStateForTest,
  resolveChipDailyLimit,
  setChipQuotaDbPool,
} from "../services/chipQuota.js";

const sharedCasesPath = resolve(__dirname, "../../../shared/chipQuotaTestCases.json");
const quotaTestCases = JSON.parse(readFileSync(sharedCasesPath, "utf-8"));

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

  describe("tabela compartilhada de cotas (shared/chipQuotaTestCases.json) — Backend", () => {
    quotaTestCases.forEach(({ description, chip_state, daily_limit_override, expected }) => {
      it(description, () => {
        expect(resolveChipDailyLimit({ chip_state, daily_limit_override })).toBe(expected);
      });
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
        ["inst-123", "2026-09-14", 1] // 1 = uma mensagem (default)
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

    it("releaseChipDailyQuota executa decremento com GREATEST(sent_count - n, 0)", async () => {
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
      expect(executedSql).toContain("GREATEST(sent_count - $3::int, 0)");
      expect(executedParams).toEqual(["inst-123", "2026-09-14", 1]);
    });

    it("devolução que FALHA é registrada (não some em silêncio) e não relança, para não mascarar a causa do chamador", async () => {
      const erro = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockPool = { query: vi.fn(async () => { throw new Error("conexão caiu"); }) };

      await expect(releaseChipDailyQuota("inst-123", "2026-09-14", mockPool, 2)).resolves.toBeUndefined();

      expect(erro).toHaveBeenCalledWith(
        expect.stringContaining("falha ao devolver cota"),
        expect.objectContaining({ instanceId: "inst-123", date: "2026-09-14", count: 2, error: "conexão caiu" })
      );
      erro.mockRestore();
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

    // ------------------------------------------------------------------------
    // BLOCO 1: Blindagem de concorrência no DDL de cota diária
    // ------------------------------------------------------------------------
    it("a) N chamadas CONCORRENTES a ensureEvolutionInstanceDailyUsageTable executam o DDL UMA vez só", async () => {
      let createCount = 0;
      let convergeCount = 0;
      const mockPool = {
        query: vi.fn(async (sql) => {
          // Pequena pausa assíncrona para garantir concorrência real enquanto a promise compartilhada está pendente
          await new Promise((resolve) => setTimeout(resolve, 20));
          if (sql.includes("CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_usage")) {
            createCount += 1;
          }
          if (sql.includes("ALTER TABLE public.evolution_instance_daily_usage ALTER COLUMN instance_id TYPE TEXT")) {
            convergeCount += 1;
          }
          return { rows: [] };
        }),
      };

      const N = 10;
      const results = await Promise.all(
        Array.from({ length: N }, () => ensureEvolutionInstanceDailyUsageTable(mockPool))
      );

      // Todas as N chamadas foram resolvidas com sucesso
      expect(results).toHaveLength(N);
      expect(results.every((r) => r === true)).toBe(true);

      // O DDL foi executado EXATAMENTE UMA VEZ
      expect(createCount).toBe(1);
      expect(convergeCount).toBe(1);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it("b) chamada depois de concluída devolve true sem tocar no banco", async () => {
      const mockPool = {
        query: vi.fn(async () => ({ rows: [] })),
      };

      // Primeira execução realiza o DDL
      const firstResult = await ensureEvolutionInstanceDailyUsageTable(mockPool);
      expect(firstResult).toBe(true);
      expect(mockPool.query).toHaveBeenCalledTimes(2);

      // Segunda chamada (após concluída): devolve true imediatamente sem disparar nenhuma query adicional
      const secondResult = await ensureEvolutionInstanceDailyUsageTable(mockPool);
      expect(secondResult).toBe(true);
      expect(mockPool.query).toHaveBeenCalledTimes(2);

      // Terceira chamada via ensureEvolutionInstanceDailyUsableTable (alias) também respeita a flag
      const thirdResult = await ensureEvolutionInstanceDailyUsableTable(mockPool);
      expect(thirdResult).toBe(true);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it("c) falha no DDL -> ensureTolerant registra o erro, respeita o backoff e NÃO repete a cada chamada", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      let queryCalls = 0;
      const mockPool = {
        query: vi.fn(async (sql) => {
          queryCalls += 1;
          if (sql.includes("CONVERGE") || sql.includes("ALTER TABLE")) {
            throw new Error("lock exclusive timeout on evolution_instance_daily_usage");
          }
          return { rows: [] };
        }),
      };

      // 1ª chamada: falha no DDL
      const res1 = await ensureTolerant(mockPool);
      expect(res1).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[chip-quota] não foi possível garantir/converter a tabela de uso diário; seguindo com o schema atual:"),
        expect.stringContaining("lock exclusive timeout on evolution_instance_daily_usage")
      );
      // Chamou CREATE TABLE e depois CONVERGE (que falhou)
      expect(queryCalls).toBe(2);

      // 2ª e 3ª chamadas logo em seguida: caem no backoff de 60s, retornam false e NÃO executam nenhuma query
      const res2 = await ensureTolerant(mockPool);
      const res3 = await ensureTolerant(mockPool);
      expect(res2).toBe(false);
      expect(res3).toBe(false);
      expect(queryCalls).toBe(2); // Nenhuma query adicional executada!

      // 4ª chamada via reserveChipDailyQuota também respeita o backoff e segue sem redisparar DDL
      mockPool.query.mockImplementation(async (sql) => {
        if (sql.includes("INSERT INTO public.evolution_instance_daily_usage")) {
          return { rows: [{ sent_count: 1 }] };
        }
        return { rows: [] };
      });
      const reserved = await reserveChipDailyQuota("inst-abc", "2026-10-21", mockPool, 1);
      expect(reserved).toBe(1);
      // Não tentou rodar DDL novamente: apenas a query de INSERT foi executada (total de 3 chamadas)
      expect(mockPool.query).toHaveBeenCalledTimes(3);
      expect(mockPool.query.mock.calls[2][0]).toContain("INSERT INTO public.evolution_instance_daily_usage");

      errorSpy.mockRestore();
    });

    it("d) DDL falha; a chamada seguinte feita DIRETO em ensureEvolutionInstanceDailyUsageTable (sem ensureTolerant) devolve false e NÃO executa nenhuma query durante o backoff", async () => {
      let queryCalls = 0;
      const mockPool = {
        query: vi.fn(async (sql) => {
          queryCalls += 1;
          if (sql.includes("CONVERGE") || sql.includes("ALTER TABLE")) {
            throw new Error("lock exclusive timeout on evolution_instance_daily_usage");
          }
          return { rows: [] };
        }),
      };

      // 1ª chamada direta em ensureEvolutionInstanceDailyUsageTable: falha no DDL e propaga exceção
      await expect(ensureEvolutionInstanceDailyUsageTable(mockPool)).rejects.toThrow(
        "lock exclusive timeout on evolution_instance_daily_usage"
      );
      expect(queryCalls).toBe(2); // CREATE TABLE + CONVERGE (que falhou)

      // 2ª chamada DIRETA em ensureEvolutionInstanceDailyUsageTable (sem passar por ensureTolerant):
      // herda a checagem de backoff interna, devolve false e NÃO toca no banco
      const res2 = await ensureEvolutionInstanceDailyUsageTable(mockPool);
      expect(res2).toBe(false);
      expect(queryCalls).toBe(2);

      // 3ª chamada DIRETA também dentro da janela de backoff: devolve false e zero queries adicionais
      const res3 = await ensureEvolutionInstanceDailyUsageTable(mockPool);
      expect(res3).toBe(false);
      expect(queryCalls).toBe(2);
    });

    it("resetChipQuotaStateForTest limpa a flag, a promessa compartilhada e o backoff", async () => {
      const mockPool = {
        query: vi.fn(async () => ({ rows: [] })),
      };

      await ensureEvolutionInstanceDailyUsageTable(mockPool);
      expect(mockPool.query).toHaveBeenCalledTimes(2);

      resetChipQuotaStateForTest();

      // Após reset, deve executar o DDL novamente
      await ensureEvolutionInstanceDailyUsageTable(mockPool);
      expect(mockPool.query).toHaveBeenCalledTimes(4);
    });
  });
});
