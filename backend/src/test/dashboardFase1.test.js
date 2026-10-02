// backend/src/test/dashboardFase1.test.js
//
// Testes de conformidade e testes de mutação para o Dashboard Fase 1.
//
// Regras validadas:
// 1. Cada número do topo bate com uma consulta direta ao banco no mesmo período
// 2. A comparação usa período anterior de mesma duração, não mês-calendário
// 3. Tenant sem propostas e contratos não vê esses dois números
// 4. Os rankings respeitam o mínimo de volume e não mostram campanha com três envios como melhor
// 5. Motivo de falha soma cem por cento
// 6. Aviso só aparece quando a condição é verdadeira — teste com dado que não a satisfaz e confirme que some
// 7. A tela mostra a hora da última atualização
// 8. Nenhum cálculo pesado acontece na requisição da tela (leitura de cache)

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  calculatePeriodDates,
  calculateDelta,
  normalizePercentages,
  categorizeFailureReason,
  calculateDashboardMetrics,
  getOrComputeDashboardMetrics,
  ensureDashboardMetricsCacheTable,
  _resetDashboardCacheTableEnsuredForTest,
  _getActiveRecalculationsForTest,
  DASHBOARD_CACHE_TTL_MS,
  RESPONSE_RATE_DECLARATION,
} from "../services/dashboardCalculations.js";
import { MESSAGE_EFFECTIVENESS_MIN_SENT } from "../services/messageEffectiveness.js";

function makeMockPool(handlers = {}) {
  const executedQueries = [];
  return {
    executedQueries,
    async query(sql, params = []) {
      executedQueries.push({ sql: String(sql), params });
      if (typeof handlers === "function") {
        return handlers(sql, params);
      }
      for (const [pattern, handler] of Object.entries(handlers)) {
        if (sql.includes(pattern)) {
          return typeof handler === "function" ? handler(sql, params) : handler;
        }
      }
      return { rows: [] };
    },
  };
}

describe("Dashboard Fase 1 — Regras e Especificações", () => {
  // ── Regra 1: Cada número do topo bate com uma consulta direta ao banco no mesmo período ──
  it("Regra 1: cada número do topo bate com uma consulta direta ao banco no mesmo período", async () => {
    const fixedNow = new Date("2026-10-15T12:00:00.000Z");

    const pool = makeMockPool({
      // 1. Sent
      "COUNT(*) FILTER (WHERE sent_at >= $2 AND sent_at < $3)::int AS current_sent": {
        rows: [{ current_sent: 150, previous_sent: 100 }],
      },
      // 2. Replied
      "COUNT(*) FILTER (WHERE replied AND sent_at >= $2 AND sent_at < $3)::int AS current_replied": {
        rows: [{ current_replied: 30, previous_replied: 15 }],
      },
      // 3. Meetings
      "current_meetings": {
        rows: [{ current_meetings: 12, previous_meetings: 8 }],
      },
      // GD Check
      "has_gd": {
        rows: [{ has_gd: true }],
      },
      // 4. Proposals
      "current_proposals": {
        rows: [{ current_proposals: 10, previous_proposals: 5 }],
      },
      // 5. Contracts
      "current_contracts": {
        rows: [{ current_contracts: 4, previous_contracts: 2 }],
      },
      // Rankings e outros vazios neste teste focado no bloco 1
      "HAVING COUNT(*) >= $4": { rows: [] },
      "lead_client_evolution_instances": { rows: [] },
      "regional_runs": { rows: [] },
      "public.leads l": { rows: [{ count: 0 }] },
    });

    const metrics = await calculateDashboardMetrics(pool, "tenant-a", "30d", {
      referenceDate: fixedNow,
    });

    // 1. Enviados bate com o banco
    expect(metrics.summary.sent.current).toBe(150);
    expect(metrics.summary.sent.previous).toBe(100);
    expect(metrics.summary.sent.delta).toBe(50); // (150 - 100)/100 = 50%

    // 2. Responderam bate com o banco e expõe a declaração da regra de 14 dias
    expect(metrics.summary.replied.current).toBe(30);
    expect(metrics.summary.replied.previous).toBe(15);
    expect(metrics.summary.replied.rate).toBe(20.0); // 30 / 150 = 20%
    expect(metrics.summary.replied.ruleDeclaration).toBe(RESPONSE_RATE_DECLARATION);

    // 3. Agendaram reunião bate com o banco
    expect(metrics.summary.meetings.current).toBe(12);
    expect(metrics.summary.meetings.previous).toBe(8);
    expect(metrics.summary.meetings.delta).toBe(50);

    // 4. Propostas criadas bate com o banco
    expect(metrics.summary.proposals.current).toBe(10);
    expect(metrics.summary.proposals.previous).toBe(5);
    expect(metrics.summary.proposals.delta).toBe(100);

    // 5. Contratos fechados bate com o banco
    expect(metrics.summary.contracts.current).toBe(4);
    expect(metrics.summary.contracts.previous).toBe(2);
    expect(metrics.summary.contracts.delta).toBe(100);
  });

  // ── Regra 2: A comparação usa período anterior de mesma duração, não mês-calendário ──
  it("Regra 2: a comparação usa período anterior de mesma duração, não mês-calendário", () => {
    // Exemplo: 15 de Outubro de 2026, 12:00:00 (14 dias e meio decorridos no mês)
    const refDate = new Date("2026-10-15T12:00:00.000Z");
    const dates = calculatePeriodDates("this_month", refDate);

    // Início do mês atual: 2026-10-01T00:00:00 (hora local/dia 1)
    expect(dates.currentStart.getDate()).toBe(1);
    expect(dates.currentStart.getMonth()).toBe(9); // 0-indexed: 9 = Outubro

    // Duração do período atual
    const currentDurationMs = dates.currentEnd.getTime() - dates.currentStart.getTime();

    // Duração do período anterior
    const prevDurationMs = dates.previousEnd.getTime() - dates.previousStart.getTime();

    // Prova matemática: o período anterior tem EXATAMENTE a mesma duração do período atual!
    expect(prevDurationMs).toBe(currentDurationMs);
    // E o fim do período anterior é imediatamente adjacente ao início do período atual
    expect(dates.previousEnd.getTime()).toBe(dates.currentStart.getTime());

    // Se fosse mês-calendário anterior (Setembro inteiro), seriam 30 dias (2.592.000.000 ms).
    // Aqui são apenas os ~14 dias proporcionais:
    const setembroInteiroMs = 30 * 24 * 60 * 60 * 1000;
    expect(prevDurationMs).not.toBe(setembroInteiroMs);
  });

  // ── Regra 3: Tenant sem propostas e contratos não vê esses dois números ──
  it("Regra 3: tenant sem propostas e contratos não vê esses dois números", async () => {
    const pool = makeMockPool({
      "has_gd": { rows: [{ has_gd: false }] },
      "COUNT(*) FILTER (WHERE sent_at >= $2 AND sent_at < $3)::int AS current_sent": {
        rows: [{ current_sent: 50, previous_sent: 50 }],
      },
      "COUNT(*) FILTER (WHERE replied AND sent_at >= $2 AND sent_at < $3)::int AS current_replied": {
        rows: [{ current_replied: 10, previous_replied: 10 }],
      },
      "current_meetings": {
        rows: [{ current_meetings: 2, previous_meetings: 2 }],
      },
      "public.leads l": { rows: [{ count: 0 }] },
    });

    const metrics = await calculateDashboardMetrics(pool, "tenant-sem-gd", "30d");

    expect(metrics.hasProposalsAndContracts).toBe(false);
    expect(metrics.summary.proposals).toBeNull();
    expect(metrics.summary.contracts).toBeNull();

    // As três métricas fundamentais continuam existindo
    expect(metrics.summary.sent.current).toBe(50);
    expect(metrics.summary.replied.current).toBe(10);
    expect(metrics.summary.meetings.current).toBe(2);
  });

  // ── Regra 4: Os rankings respeitam o volume mínimo (não mostram campanha com 3 envios) ──
  it("Regra 4: os rankings respeitam o mínimo de volume e não mostram campanha com três envios como melhor", async () => {
    const pool = makeMockPool({
      "has_gd": { rows: [{ has_gd: false }] },
      "current_sent": { rows: [{ current_sent: 100, previous_sent: 100 }] },
      "current_replied": { rows: [{ current_replied: 20, previous_replied: 20 }] },
      "current_meetings": { rows: [{ current_meetings: 5, previous_meetings: 5 }] },
      "public.leads l": { rows: [{ count: 0 }] },
      "HAVING COUNT(*) >= $4": (sql, params) => {
        // Confirma que a cláusula HAVING passa MESSAGE_EFFECTIVENESS_MIN_SENT (30)
        expect(params[3]).toBe(MESSAGE_EFFECTIVENESS_MIN_SENT);
        expect(MESSAGE_EFFECTIVENESS_MIN_SENT).toBe(30);

        // Se uma campanha tiver apenas 3 envios, ela NUNCA deve ser retornada pela query
        return {
          rows: [
            {
              campaign_id: "c-valida",
              campaign_name: "Campanha Grande",
              message: "Olá lead",
              sent_count: 50,
              replied_count: 20,
              reply_rate: 40.0,
            },
          ],
        };
      },
    });

    const metrics = await calculateDashboardMetrics(pool, "tenant-a", "30d");

    expect(metrics.rankings.messages.length).toBe(1);
    expect(metrics.rankings.messages[0].campaign_id).toBe("c-valida");
    expect(metrics.rankings.messages[0].sent_count).toBeGreaterThanOrEqual(30);
  });

  // ── Regra 5: Motivo de falha soma cem por cento ──
  it("Regra 5: motivo de falha soma cem por cento", () => {
    // Casos com números ímpares / divisões que causariam arredondamentos quebrados
    const cases = [
      [{ count: 1 }, { count: 1 }, { count: 1 }], // 33.333% cada
      [{ count: 7 }, { count: 3 }],               // 70% e 30%
      [{ count: 10 }, { count: 5 }, { count: 1 }], // 62.5%, 31.25%, 6.25%
      [{ count: 1 }],                              // 100%
    ];

    for (const items of cases) {
      const normalized = normalizePercentages(items);
      const totalPct = normalized.reduce((acc, it) => acc + it.percentage, 0);
      expect(totalPct).toBe(100);
    }
  });

  // ── Regra 6: Aviso só aparece quando a condição é verdadeira — desaparece quando falsa ──
  it("Regra 6: aviso só aparece quando a condição é verdadeira — teste com dado que não a satisfaz e confirme que some", async () => {
    // Caso 1: Condições satisfeitas -> Alertas aparecem
    const poolComProblemas = makeMockPool({
      "has_gd": { rows: [{ has_gd: false }] },
      "current_sent": { rows: [{ current_sent: 50, previous_sent: 50 }] },
      "current_replied": { rows: [{ current_replied: 5, previous_replied: 5 }] },
      "current_meetings": { rows: [{ current_meetings: 0, previous_meetings: 0 }] },
      // Falhas com alto percentual de números inexistentes (>15% e >= 3)
      "public.campaign_dispatch_runs": (sql) => {
        if (sql.includes("status IN ('failed', 'invalid_number')")) {
          return {
            rows: [
              { status: "invalid_number", error_message: "400 Bad Request" },
              { status: "invalid_number", error_message: "Número inexistente" },
              { status: "invalid_number", error_message: "sem whatsapp" },
              { status: "failed", error_message: "instância desconectada" },
            ],
          };
        }
        return { rows: [] };
      },
      // Leads que responderam sem responsável atribuído (>0)
      "public.leads l": { rows: [{ count: 7 }] },
      // Chips com chip frio perto do limite (45 de 50 = 90% >= 80%)
      "lead_client_evolution_instances": {
        rows: [
          {
            id: "chip-frio-1",
            name: "Chip Frio SP",
            chip_state: "cold",
            daily_limit_override: null,
            sent_period: 45,
            sent_today: 45,
          },
        ],
      },
    });

    const metricsComAlertas = await calculateDashboardMetrics(poolComProblemas, "tenant-a", "30d");
    expect(metricsComAlertas.alerts.length).toBeGreaterThanOrEqual(2);
    expect(metricsComAlertas.alerts.some((a) => a.id === "alert_orphaned_replies")).toBe(true);
    expect(metricsComAlertas.alerts.some((a) => a.id === "alert_cold_chip_limit")).toBe(true);

    // Caso 2: Dados saudáveis -> Alertas somem completamente
    const poolSaudavel = makeMockPool({
      "has_gd": { rows: [{ has_gd: false }] },
      "current_sent": { rows: [{ current_sent: 200, previous_sent: 200 }] },
      "current_replied": { rows: [{ current_replied: 50, previous_replied: 50 }] },
      "current_meetings": { rows: [{ current_meetings: 10, previous_meetings: 10 }] },
      // Sem falhas
      "public.campaign_dispatch_runs": { rows: [] },
      // Nenhum lead órfão
      "public.leads l": { rows: [{ count: 0 }] },
      // Chip frio usando pouco volume (10 de 50 = 20% < 80%)
      "lead_client_evolution_instances": {
        rows: [
          {
            id: "chip-frio-1",
            name: "Chip Frio SP",
            chip_state: "cold",
            daily_limit_override: null,
            sent_period: 10,
            sent_today: 10,
          },
        ],
      },
    });

    const metricsSaudavel = await calculateDashboardMetrics(poolSaudavel, "tenant-a", "30d");
    // NENHUM alerta inventado aparece quando o dado não justifica
    expect(metricsSaudavel.alerts).toEqual([]);
  });

  // ── Regra 7: A tela mostra a hora da última atualização ──
  it("Regra 7: a tela mostra a hora da última atualização", async () => {
    const fixedTime = new Date(Date.now() - 60000).toISOString();
    const cachedPayload = {
      summary: { sent: { current: 10 } },
      lastUpdatedAt: fixedTime,
      hasProposalsAndContracts: false,
    };

    const pool = makeMockPool({
      "SELECT data, calculated_at, status, last_error FROM public.dashboard_metrics_cache": {
        rows: [
          {
            data: cachedPayload,
            calculated_at: fixedTime,
            status: "fresh",
            last_error: null,
          },
        ],
      },
    });

    const res = await getOrComputeDashboardMetrics(pool, "tenant-a", "30d");
    expect(res.lastUpdatedAt).toBe(fixedTime);
    expect(res.cacheStatus).toBe("fresh");

    // Cenário de erro: quando o refresh falha, preserva a data anterior e expõe stale
    const failingPool = makeMockPool((sql) => {
      if (sql.includes("SELECT data, calculated_at, status, last_error FROM public.dashboard_metrics_cache")) {
        return { rows: [] }; // simula necessidade de calcular
      }
      if (sql.includes("INSERT INTO public.dashboard_metrics_cache")) {
        throw new Error("DB Connection Error");
      }
      if (sql.includes("SELECT data, calculated_at FROM public.dashboard_metrics_cache")) {
        return {
          rows: [{ data: cachedPayload, calculated_at: fixedTime }],
        };
      }
      // Todos os blocos caem. Só quando NADA pôde ser calculado o recálculo falha e o cache
      // anterior é devolvido como stale (um bloco isolado que cai não derruba mais o painel —
      // ver dashboardBlockIsolation.test.js).
      throw new Error("Query timeout during calculation");
    });

    const staleRes = await getOrComputeDashboardMetrics(failingPool, "tenant-a", "30d", { forceRefresh: true });
    expect(staleRes.cacheStatus).toBe("stale");
    expect(staleRes.lastUpdatedAt).toBe(fixedTime); // preserva a data original de quando foi calculado
    expect(staleRes.lastError).toContain("Query timeout");
  });

  // ── Regra 8: Nenhum cálculo pesado acontece na requisição da tela ──
  it("Regra 8: nenhum cálculo pesado acontece na requisição da tela (somente leitura de cache)", async () => {
    const cachedData = {
      summary: { sent: { current: 500, previous: 400, delta: 25 } },
      rankings: { messages: [], chips: [], regions: [], failureReasons: [] },
      alerts: [],
      hasProposalsAndContracts: true,
    };

    const fixedTime = new Date(Date.now() - 60000).toISOString();
    const pool = makeMockPool({
      "SELECT data, calculated_at, status, last_error FROM public.dashboard_metrics_cache": {
        rows: [
          {
            data: cachedData,
            calculated_at: fixedTime,
            status: "fresh",
            last_error: null,
          },
        ],
      },
    });

    // Chamada simulando a requisição HTTP da tela
    const response = await getOrComputeDashboardMetrics(pool, "tenant-x", "30d");

    // Prova: a única consulta executada foi na tabela de cache!
    // Nenhuma query pesada em campaign_dispatch_runs ou lead_messages rodou.
    const executedSqls = pool.executedQueries.map((q) => q.sql);
    expect(executedSqls.some((sql) => sql.includes("public.dashboard_metrics_cache"))).toBe(true);

    expect(executedSqls.some((sql) => sql.includes("public.campaign_dispatch_runs"))).toBe(false);
    expect(executedSqls.some((sql) => sql.includes("public.lead_messages"))).toBe(false);
    expect(executedSqls.some((sql) => sql.includes("public.gd_proposals"))).toBe(false);
    expect(executedSqls.some((sql) => sql.includes("public.gd_contracts"))).toBe(false);
    expect(response.summary.sent.current).toBe(500);
  });

  // ── Integração com Rota HTTP Express /api/dashboard ──
  it("endpoint GET /api/dashboard responde payload com cache e status 200", async () => {
    const { registerInsightsRoutes } = await import("../domains/insights/routes.js");
    const routes = {};
    const fakeApp = {
      get(path, ...middlewares) {
        routes[`GET ${path}`] = middlewares[middlewares.length - 1];
      },
      post(path, ...middlewares) {
        routes[`POST ${path}`] = middlewares[middlewares.length - 1];
      },
      patch(path, ...middlewares) {
        routes[`PATCH ${path}`] = middlewares[middlewares.length - 1];
      },
      put(path, ...middlewares) {
        routes[`PUT ${path}`] = middlewares[middlewares.length - 1];
      },
      delete(path, ...middlewares) {
        routes[`DELETE ${path}`] = middlewares[middlewares.length - 1];
      },
    };

    const cachedData = {
      period: "30d",
      summary: { sent: { current: 100, previous: 80, delta: 25 } },
      rankings: { messages: [], chips: [], regions: [], failureReasons: [] },
      alerts: [],
      hasProposalsAndContracts: false,
    };

    const fixedTime = new Date(Date.now() - 60000).toISOString();
    const pool = makeMockPool({
      "SELECT data, calculated_at, status, last_error FROM public.dashboard_metrics_cache": {
        rows: [
          {
            data: cachedData,
            calculated_at: fixedTime,
            status: "fresh",
            last_error: null,
          },
        ],
      },
    });

    const deps = {
      ensureDb: () => true,
      ensureSharedRoutePageAccess: () => true,
      resolveAuthorizedClientId: (_req, _res, id) => id || "tenant-test",
      requireFirebaseAuth: (_req, _res, next) => (next ? next() : undefined),
      requireInternalPageAccess: () => (_req, _res, next) => (next ? next() : undefined),
      normalizeString: (s) => (typeof s === "string" ? s.trim() : ""),
      sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
      pgDatabasePool: pool,
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "tenant-test", name: "Empresa Teste" }, error: null }),
            }),
          }),
        }),
      },
    };

    registerInsightsRoutes(fakeApp, deps);

    const handler = routes["GET /api/dashboard"];
    expect(handler).toBeDefined();

    const req = {
      query: { clientId: "tenant-test", period: "30d" },
      authAccess: { role: "client", clientId: "tenant-test" },
    };
    let responseBody = null;
    let statusCode = 200;
    const res = {
      status(c) { statusCode = c; return this; },
      json(b) { responseBody = b; return this; },
    };

    await handler(req, res);

    expect(statusCode).toBe(200);
    expect(responseBody.client.name).toBe("Empresa Teste");
    expect(responseBody.summary.sent.current).toBe(100);
    expect(responseBody.cacheStatus).toBe("fresh");
    expect(responseBody.lastUpdatedAt).toBe(fixedTime);
  });

  // ── Ajustes de Cache: Expiração (TTL), Concorrência e Schema Único ──
  describe("Dashboard — Ajustes de Cache, TTL e Concorrência", () => {
    beforeEach(() => {
      _resetDashboardCacheTableEnsuredForTest();
    });

    it("cache dentro do prazo não recalcula", async () => {
      const fixedNow = new Date("2026-10-15T12:00:00.000Z");
      // Cache gravado há 5 minutos (bem dentro dos 15 minutos de TTL)
      const fiveMinutesAgo = new Date(fixedNow.getTime() - 5 * 60 * 1000).toISOString();

      const cachedData = {
        period: "30d",
        summary: { sent: { current: 300, previous: 250, delta: 20 } },
        rankings: { messages: [], chips: [], regions: [], failureReasons: [] },
        alerts: [],
        hasProposalsAndContracts: false,
      };

      const pool = makeMockPool({
        "SELECT data, calculated_at, status, last_error FROM public.dashboard_metrics_cache": {
          rows: [
            {
              data: cachedData,
              calculated_at: fiveMinutesAgo,
              status: "fresh",
              last_error: null,
            },
          ],
        },
      });

      const result = await getOrComputeDashboardMetrics(pool, "tenant-fresh", "30d", {
        now: fixedNow,
      });

      // Retorna o dado do cache com status fresh
      expect(result.summary.sent.current).toBe(300);
      expect(result.cacheStatus).toBe("fresh");
      expect(result.lastUpdatedAt).toBe(fiveMinutesAgo);

      // Nenhuma query pesada de cálculo ou inserção no cache foi executada
      const executed = pool.executedQueries.map((q) => q.sql);
      expect(executed.some((sql) => sql.includes("INSERT INTO public.dashboard_metrics_cache"))).toBe(false);
      expect(executed.some((sql) => sql.includes("FROM public.campaign_dispatch_runs"))).toBe(false);

      // Nenhuma trava de recálculo ativa
      expect(_getActiveRecalculationsForTest().has("tenant-fresh:30d")).toBe(false);
    });

    it("cache vencido é devolvido na hora e dispara recálculo em segundo plano", async () => {
      const fixedNow = new Date("2026-10-15T12:00:00.000Z");
      // Cache gravado há 20 minutos (expirado, pois TTL é 15 minutos)
      const twentyMinutesAgo = new Date(fixedNow.getTime() - 20 * 60 * 1000).toISOString();

      const staleData = {
        period: "30d",
        summary: { sent: { current: 150, previous: 100, delta: 50 } },
        rankings: { messages: [], chips: [], regions: [], failureReasons: [] },
        alerts: [],
        hasProposalsAndContracts: false,
      };

      let backgroundRecalculateFinished = false;

      const pool = makeMockPool({
        "SELECT data, calculated_at, status, last_error FROM public.dashboard_metrics_cache": {
          rows: [
            {
              data: staleData,
              calculated_at: twentyMinutesAgo,
              status: "fresh",
              last_error: null,
            },
          ],
        },
        "INSERT INTO public.dashboard_metrics_cache": () => {
          backgroundRecalculateFinished = true;
          return { rows: [] };
        },
        // Queries do cálculo completo quando o background rodar
        "COUNT(*) FILTER (WHERE sent_at >= $2 AND sent_at < $3)::int AS current_sent": {
          rows: [{ current_sent: 200, previous_sent: 100 }],
        },
        "COUNT(*) FILTER (WHERE replied AND sent_at >= $2 AND sent_at < $3)::int AS current_replied": {
          rows: [{ current_replied: 40, previous_replied: 20 }],
        },
        "current_meetings": { rows: [{ current_meetings: 5, previous_meetings: 2 }] },
        "has_gd": { rows: [{ has_gd: false }] },
        "HAVING COUNT(*) >= $4": { rows: [] },
        "lead_client_evolution_instances": { rows: [] },
        "regional_runs": { rows: [] },
        "public.leads l": { rows: [{ count: 0 }] },
      });

      // Chamada: deve responder imediatamente com o dado velho
      const result = await getOrComputeDashboardMetrics(pool, "tenant-stale", "30d", {
        now: fixedNow,
      });

      // 1. Devolvido na hora com os dados que estavam lá
      expect(result.summary.sent.current).toBe(150);
      expect(result.cacheStatus).toBe("stale");
      expect(result.lastUpdatedAt).toBe(twentyMinutesAgo);

      // 2. Disparou recálculo em segundo plano (promessa ativa na trava)
      const lockKey = "tenant-stale:30d";
      const activePromise = _getActiveRecalculationsForTest().get(lockKey);
      expect(activePromise).toBeDefined();

      // Aguarda a promessa do recálculo de segundo plano terminar
      await activePromise;
      expect(backgroundRecalculateFinished).toBe(true);
      expect(_getActiveRecalculationsForTest().has(lockKey)).toBe(false);
    });

    it("dois acessos simultâneos disparam um recálculo só", async () => {
      const fixedNow = new Date("2026-10-15T12:00:00.000Z");
      // Cache vencido (25 min atrás)
      const oldTime = new Date(fixedNow.getTime() - 25 * 60 * 1000).toISOString();

      let heavyComputationsCount = 0;

      const pool = makeMockPool({
        "SELECT data, calculated_at, status, last_error FROM public.dashboard_metrics_cache": {
          rows: [
            {
              data: { period: "30d", summary: { sent: { current: 50, previous: 50, delta: 0 } }, rankings: { messages: [], chips: [], regions: [], failureReasons: [] }, alerts: [] },
              calculated_at: oldTime,
              status: "fresh",
              last_error: null,
            },
          ],
        },
        "COUNT(*) FILTER (WHERE sent_at >= $2 AND sent_at < $3)::int AS current_sent": () => {
          heavyComputationsCount++;
          return { rows: [{ current_sent: 75, previous_sent: 50 }] };
        },
        "COUNT(*) FILTER (WHERE replied AND sent_at >= $2 AND sent_at < $3)::int AS current_replied": {
          rows: [{ current_replied: 10, previous_replied: 5 }],
        },
        "current_meetings": { rows: [{ current_meetings: 2, previous_meetings: 1 }] },
        "has_gd": { rows: [{ has_gd: false }] },
        "HAVING COUNT(*) >= $4": { rows: [] },
        "lead_client_evolution_instances": { rows: [] },
        "regional_runs": { rows: [] },
        "public.leads l": { rows: [{ count: 0 }] },
      });

      // Dois acessos simultâneos ao mesmo tempo com cache vencido
      const [res1, res2] = await Promise.all([
        getOrComputeDashboardMetrics(pool, "tenant-concorrente", "30d", { now: fixedNow }),
        getOrComputeDashboardMetrics(pool, "tenant-concorrente", "30d", { now: fixedNow }),
      ]);

      // Ambos recebem a resposta imediatamente
      expect(res1.summary.sent.current).toBe(50);
      expect(res2.summary.sent.current).toBe(50);

      // Aguarda a promessa ativa de segundo plano
      const activePromise = _getActiveRecalculationsForTest().get("tenant-concorrente:30d");
      if (activePromise) await activePromise;

      // O cálculo pesado rodou EXATAMENTE 1 vez, e não 2 vezes
      expect(heavyComputationsCount).toBe(1);
    });

    it("a checagem da tabela acontece uma vez em várias requisições", async () => {
      let createTableQueryCount = 0;

      const pool = makeMockPool({
        "CREATE TABLE IF NOT EXISTS public.dashboard_metrics_cache": () => {
          createTableQueryCount++;
          return { rows: [] };
        },
        "SELECT data, calculated_at, status, last_error FROM public.dashboard_metrics_cache": {
          rows: [],
        },
        "COUNT(*) FILTER (WHERE sent_at >= $2 AND sent_at < $3)::int AS current_sent": {
          rows: [{ current_sent: 10, previous_sent: 10 }],
        },
        "COUNT(*) FILTER (WHERE replied AND sent_at >= $2 AND sent_at < $3)::int AS current_replied": {
          rows: [{ current_replied: 2, previous_replied: 2 }],
        },
        "current_meetings": { rows: [{ current_meetings: 0, previous_meetings: 0 }] },
        "has_gd": { rows: [{ has_gd: false }] },
        "HAVING COUNT(*) >= $4": { rows: [] },
        "lead_client_evolution_instances": { rows: [] },
        "regional_runs": { rows: [] },
        "public.leads l": { rows: [{ count: 0 }] },
      });

      // 5 chamadas sucessivas
      for (let i = 0; i < 5; i++) {
        await ensureDashboardMetricsCacheTable(pool);
      }

      // CREATE TABLE deve ter rodado rigorosamente 1 única vez
      expect(createTableQueryCount).toBe(1);
    });
  });
});

