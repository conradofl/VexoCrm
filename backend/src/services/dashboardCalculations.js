// backend/src/services/dashboardCalculations.js
//
// Dashboard, Fase 1: Respostas diretas ao dono utilizando exclusivamente dados existentes:
// campaign_dispatch_runs, lead_messages, leads, evolution_instance_daily_usage,
// followup_schedules, crm_consultant_schedules, gd_proposals e gd_contracts.
//
// Regras obrigatórias:
// 1. Zero cálculo pesado na requisição da tela (leitura de cache pré-calculado).
// 2. Data da última atualização exposta com clareza (lastUpdatedAt).
// 3. Taxa de resposta declara explicitamente sua regra ao lado do número (janela 14d, "conversou depois do envio").
// 4. Comparação sempre usa período anterior de mesma duração (inclusive em "este mês", não mês-calendário).
// 5. Tenant sem propostas/contratos não vê esses dois números (hasProposalsAndContracts = false).
// 6. Rankings respeitam volume mínimo (mínimo de 30 envios em mensagens).
// 7. Motivos de falha agrupados somam exatamente 100%.
// 8. Avisos de ação derivados estritamente dos números (máximo 3, só aparecem quando a condição for verdadeira).

import { SQL_CANONICAL_PHONE } from "./canonicalPhone.js";
import { MESSAGE_EFFECTIVENESS_MIN_SENT, MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS } from "./messageEffectiveness.js";
import { resolveChipDailyLimit } from "./chipQuota.js";

export const RESPONSE_RATE_DECLARATION = "conversou depois do envio (janela de 14 dias)";

/**
 * Calcula os intervalos [currentStart, currentEnd] e [previousStart, previousEnd]
 * garantindo que o período anterior tenha EXATAMENTE a mesma duração do período atual.
 *
 * Em "this_month", se estamos no dia D do mês (duração D), o período anterior
 * corresponde aos D dias imediatamente anteriores ao início do mês atual (não o mês calendário anterior completo).
 */
export function calculatePeriodDates(periodKey = "30d", referenceDate = new Date()) {
  const now = new Date(referenceDate);
  const normalizedKey = periodKey === "7d" || periodKey === "this_month" ? periodKey : "30d";

  let currentStart;
  let currentEnd = new Date(now);
  let previousStart;
  let previousEnd;

  if (normalizedKey === "7d") {
    const durationMs = 7 * 24 * 60 * 60 * 1000;
    currentStart = new Date(now.getTime() - durationMs);
    previousEnd = new Date(currentStart);
    previousStart = new Date(currentStart.getTime() - durationMs);
  } else if (normalizedKey === "this_month") {
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const durationMs = currentEnd.getTime() - currentStart.getTime();
    previousEnd = new Date(currentStart);
    previousStart = new Date(currentStart.getTime() - durationMs);
  } else {
    // Padrão: 30d
    const durationMs = 30 * 24 * 60 * 60 * 1000;
    currentStart = new Date(now.getTime() - durationMs);
    previousEnd = new Date(currentStart);
    previousStart = new Date(currentStart.getTime() - durationMs);
  }

  const durationMs = currentEnd.getTime() - currentStart.getTime();

  return {
    periodKey: normalizedKey,
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
    durationMs,
  };
}

/**
 * Calcula variação percentual inteira entre período atual e anterior.
 */
export function calculateDelta(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (p === 0) {
    return c > 0 ? 100 : 0;
  }
  return Math.round(((c - p) / p) * 100);
}

/**
 * Normaliza os percentuais de motivos de falha para garantir soma EXATA de 100%.
 */
export function normalizePercentages(items) {
  const total = items.reduce((acc, it) => acc + (it.count || 0), 0);
  if (total === 0) {
    return items.map((it) => ({ ...it, percentage: 0 }));
  }

  let runningSum = 0;
  const result = items.map((it) => {
    const pct = Math.round(((it.count || 0) / total) * 100);
    runningSum += pct;
    return { ...it, percentage: pct };
  });

  if (result.length > 0 && runningSum !== 100) {
    let maxIdx = 0;
    for (let i = 1; i < result.length; i++) {
      if (result[i].count > result[maxIdx].count) maxIdx = i;
    }
    result[maxIdx].percentage += (100 - runningSum);
  }

  return result;
}

/**
 * Classifica a mensagem bruta de erro em uma das 5 categorias padrão:
 * - Número inexistente
 * - Sem WhatsApp
 * - Chip fora do ar
 * - Variável sem valor
 * - Outros
 */
export function categorizeFailureReason(rawError, status) {
  const s = String(rawError || "").toLowerCase();
  const st = String(status || "").toLowerCase();

  if (st === "invalid_number") {
    if (s.includes("whatsapp") || s.includes("exists") || s.includes("jid")) {
      return "Sem WhatsApp";
    }
    return "Número inexistente";
  }

  if (
    s.includes("não existe no whatsapp") ||
    s.includes("nao existe no whatsapp") ||
    s.includes('"exists":false') ||
    s.includes('"exists": false') ||
    s.includes("number does not exist") ||
    s.includes("not on whatsapp") ||
    s.includes("sem whatsapp")
  ) {
    return "Sem WhatsApp";
  }

  if (
    s.includes("inexistente") ||
    s.includes("número inválido") ||
    s.includes("numero invalido") ||
    s.includes("invalid_number") ||
    s.includes("bad request") ||
    s.includes("http 400") ||
    s.includes("rejeitado pelo whatsapp")
  ) {
    return "Número inexistente";
  }

  if (
    s.includes("desconectad") ||
    s.includes("fora do ar") ||
    s.includes("instance not found") ||
    s.includes("http 404") ||
    s.includes("timeout") ||
    s.includes("aborterror") ||
    s.includes("tempo limite") ||
    s.includes("offline")
  ) {
    return "Chip fora do ar";
  }

  if (
    s.includes("variável") ||
    s.includes("variavel") ||
    s.includes("sem valor") ||
    s.includes("template") ||
    s.includes("placeholder") ||
    s.includes("missing variable")
  ) {
    return "Variável sem valor";
  }

  return "Outros";
}

// Marcador no módulo para garantir que a tabela seja checada no máximo UMA vez por processo
let _dashboardMetricsCacheTableEnsured = false;

export function _resetDashboardCacheTableEnsuredForTest() {
  _dashboardMetricsCacheTableEnsured = false;
}

/**
 * Garante a existência da tabela de cache no banco. Executa apenas uma vez por processo.
 */
export async function ensureDashboardMetricsCacheTable(pool) {
  if (_dashboardMetricsCacheTableEnsured) return true;
  if (!pool) return false;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.dashboard_metrics_cache (
        client_id TEXT NOT NULL,
        period TEXT NOT NULL,
        data JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'fresh',
        calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_error TEXT,
        PRIMARY KEY (client_id, period)
      );
      CREATE INDEX IF NOT EXISTS idx_dashboard_metrics_cache_lookup
        ON public.dashboard_metrics_cache (client_id, period);
    `);
    _dashboardMetricsCacheTableEnsured = true;
    return true;
  } catch (err) {
    console.warn("[dashboard] warn ensuring cache table:", err?.message || err);
    return false;
  }
}

/**
 * Executa o cálculo analítico completo para um tenant e período.
 * Esta função deve ser chamada apenas na pré-computação ou atualização em background,
 * nunca diretamente no ciclo de renderização síncrona da tela se o dado já estiver em cache.
 */
export async function calculateDashboardMetrics(pool, clientId, periodKey = "30d", options = {}) {
  const refDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
  const { currentStart, currentEnd, previousStart, previousEnd, periodKey: normalizedPeriod } =
    calculatePeriodDates(periodKey, refDate);

  const lmTimestamp = "COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at)";
  const rawOrCanonicalPhone = `lm.phone = r.phone OR ${SQL_CANONICAL_PHONE("lm.phone")} = ${SQL_CANONICAL_PHONE("r.phone")}`;

  // ── Bloco 1: Métricas do Topo ───────────────────────────────────────────

  // 1. Enviados (atual e anterior)
  const sentQuery = `
    SELECT
      COUNT(*) FILTER (WHERE sent_at >= $2 AND sent_at < $3)::int AS current_sent,
      COUNT(*) FILTER (WHERE sent_at >= $4 AND sent_at < $5)::int AS previous_sent
    FROM public.campaign_dispatch_runs
    WHERE client_id = $1 AND status = 'sent';
  `;
  const { rows: sentRows } = await pool.query(sentQuery, [
    clientId,
    currentStart.toISOString(),
    currentEnd.toISOString(),
    previousStart.toISOString(),
    previousEnd.toISOString(),
  ]);
  const sentCurrent = sentRows[0]?.current_sent || 0;
  const sentPrevious = sentRows[0]?.previous_sent || 0;

  // 2. Responderam (cruzamento provado por telefone canônico com janela de 14 dias)
  const repliesQuery = `
    WITH valid_runs AS (
      SELECT
        r.sent_at,
        EXISTS (
          SELECT 1
          FROM public.lead_messages lm
          WHERE lm.client_id = r.client_id
            AND (${rawOrCanonicalPhone})
            AND (lm.direction = 'inbound' OR lm.engagement_signal = 'reply')
            AND ${lmTimestamp} > r.sent_at
            AND ${lmTimestamp} <= r.sent_at + interval '${MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS} days'
        ) AS replied
      FROM public.campaign_dispatch_runs r
      WHERE r.client_id = $1
        AND r.status = 'sent'
        AND r.phone <> ''
        AND r.sent_at IS NOT NULL
        AND (
          (r.sent_at >= $2 AND r.sent_at < $3)
          OR (r.sent_at >= $4 AND r.sent_at < $5)
        )
    )
    SELECT
      COUNT(*) FILTER (WHERE replied AND sent_at >= $2 AND sent_at < $3)::int AS current_replied,
      COUNT(*) FILTER (WHERE replied AND sent_at >= $4 AND sent_at < $5)::int AS previous_replied
    FROM valid_runs;
  `;
  const { rows: replyRows } = await pool.query(repliesQuery, [
    clientId,
    currentStart.toISOString(),
    currentEnd.toISOString(),
    previousStart.toISOString(),
    previousEnd.toISOString(),
  ]);
  const repliedCurrent = replyRows[0]?.current_replied || 0;
  const repliedPrevious = replyRows[0]?.previous_replied || 0;
  const responseRateCurrent = sentCurrent > 0 ? Number(((repliedCurrent / sentCurrent) * 100).toFixed(1)) : 0;
  const responseRatePrevious = sentPrevious > 0 ? Number(((repliedPrevious / sentPrevious) * 100).toFixed(1)) : 0;

  // 3. Agendaram Reunião (followup_schedules + crm_consultant_schedules)
  const meetingsQuery = `
    SELECT
      (
        COALESCE((
          SELECT COUNT(*)::int
          FROM public.followup_schedules fs
          JOIN public.followup_companies fc ON fc.id = fs.company_id
          WHERE fc.tenant_id = $1
            AND fs.created_at >= $2 AND fs.created_at < $3
        ), 0) +
        COALESCE((
          SELECT COUNT(*)::int
          FROM public.crm_consultant_schedules cs
          WHERE cs.client_id = $1
            AND cs.created_at >= $2 AND cs.created_at < $3
        ), 0)
      )::int AS current_meetings,
      (
        COALESCE((
          SELECT COUNT(*)::int
          FROM public.followup_schedules fs
          JOIN public.followup_companies fc ON fc.id = fs.company_id
          WHERE fc.tenant_id = $1
            AND fs.created_at >= $4 AND fs.created_at < $5
        ), 0) +
        COALESCE((
          SELECT COUNT(*)::int
          FROM public.crm_consultant_schedules cs
          WHERE cs.client_id = $1
            AND cs.created_at >= $4 AND cs.created_at < $5
        ), 0)
      )::int AS previous_meetings;
  `;
  const { rows: meetingRows } = await pool.query(meetingsQuery, [
    clientId,
    currentStart.toISOString(),
    currentEnd.toISOString(),
    previousStart.toISOString(),
    previousEnd.toISOString(),
  ]);
  const meetingsCurrent = meetingRows[0]?.current_meetings || 0;
  const meetingsPrevious = meetingRows[0]?.previous_meetings || 0;

  // 4 & 5. Propostas Criadas e Contratos Fechados
  // Verifica se tenant usa esses módulos
  const gdUsageQuery = `
    SELECT (
      EXISTS (
        SELECT 1 FROM public.gd_proposals p
        WHERE p.tenant_id::text = $1
           OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p.tenant_id AND t.name ILIKE $1)
        LIMIT 1
      ) OR
      EXISTS (
        SELECT 1 FROM public.gd_contracts c
        WHERE c.tenant_id::text = $1
           OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = c.tenant_id AND t.name ILIKE $1)
        LIMIT 1
      )
    ) AS has_gd;
  `;
  const { rows: gdUsageRows } = await pool.query(gdUsageQuery, [clientId]);
  const hasProposalsAndContracts = Boolean(gdUsageRows[0]?.has_gd);

  let proposalsData = null;
  let contractsData = null;

  if (hasProposalsAndContracts) {
    const proposalsQuery = `
      SELECT
        COUNT(*) FILTER (WHERE p.created_at >= $2 AND p.created_at < $3)::int AS current_proposals,
        COUNT(*) FILTER (WHERE p.created_at >= $4 AND p.created_at < $5)::int AS previous_proposals
      FROM public.gd_proposals p
      WHERE (p.tenant_id::text = $1 OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p.tenant_id AND t.name ILIKE $1));
    `;
    const { rows: proposalRows } = await pool.query(proposalsQuery, [
      clientId,
      currentStart.toISOString(),
      currentEnd.toISOString(),
      previousStart.toISOString(),
      previousEnd.toISOString(),
    ]);
    const proposalsCurrent = proposalRows[0]?.current_proposals || 0;
    const proposalsPrevious = proposalRows[0]?.previous_proposals || 0;
    proposalsData = {
      current: proposalsCurrent,
      previous: proposalsPrevious,
      delta: calculateDelta(proposalsCurrent, proposalsPrevious),
    };

    const contractsQuery = `
      SELECT
        COUNT(*) FILTER (
          WHERE c.status IN ('assinado', 'fechado', 'signed')
            AND (
              (c.updated_at >= $2 AND c.updated_at < $3)
              OR (c.created_at >= $2 AND c.created_at < $3)
            )
        )::int AS current_contracts,
        COUNT(*) FILTER (
          WHERE c.status IN ('assinado', 'fechado', 'signed')
            AND (
              (c.updated_at >= $4 AND c.updated_at < $5)
              OR (c.created_at >= $4 AND c.created_at < $5)
            )
        )::int AS previous_contracts
      FROM public.gd_contracts c
      WHERE (c.tenant_id::text = $1 OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = c.tenant_id AND t.name ILIKE $1));
    `;
    const { rows: contractRows } = await pool.query(contractsQuery, [
      clientId,
      currentStart.toISOString(),
      currentEnd.toISOString(),
      previousStart.toISOString(),
      previousEnd.toISOString(),
    ]);
    const contractsCurrent = contractRows[0]?.current_contracts || 0;
    const contractsPrevious = contractRows[0]?.previous_contracts || 0;
    contractsData = {
      current: contractsCurrent,
      previous: contractsPrevious,
      delta: calculateDelta(contractsCurrent, contractsPrevious),
    };
  }

  // ── Bloco 2: Quatro Rankings Curtos (3 linhas cada, melhor e pior) ──────

  // 1. Mensagem — relatório de eficácia com mínimo de envios (MESSAGE_EFFECTIVENESS_MIN_SENT)
  const messageRankingQuery = `
    WITH runs AS (
      SELECT
        r.campaign_id,
        r.phone,
        EXISTS (
          SELECT 1
          FROM public.lead_messages lm
          WHERE lm.client_id = r.client_id
            AND (${rawOrCanonicalPhone})
            AND (lm.direction = 'inbound' OR lm.engagement_signal = 'reply')
            AND ${lmTimestamp} > r.sent_at
            AND ${lmTimestamp} <= r.sent_at + interval '${MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS} days'
        ) AS replied
      FROM public.campaign_dispatch_runs r
      WHERE r.client_id = $1
        AND r.status = 'sent'
        AND r.phone <> ''
        AND r.sent_at IS NOT NULL
        AND r.sent_at >= $2 AND r.sent_at < $3
    )
    SELECT
      c.id AS campaign_id,
      c.name AS campaign_name,
      c.analytics_meta->>'message' AS message,
      COUNT(*)::int AS sent_count,
      COUNT(*) FILTER (WHERE runs.replied)::int AS replied_count,
      ROUND(((COUNT(*) FILTER (WHERE runs.replied))::numeric / COUNT(*)) * 100, 1)::float AS reply_rate
    FROM runs
    JOIN public.campaigns c ON c.id = runs.campaign_id
    WHERE c.client_id = $1
    GROUP BY c.id, c.name, c.analytics_meta
    HAVING COUNT(*) >= $4
    ORDER BY reply_rate DESC;
  `;
  const { rows: messageEffectivenessRows } = await pool.query(messageRankingQuery, [
    clientId,
    currentStart.toISOString(),
    currentEnd.toISOString(),
    MESSAGE_EFFECTIVENESS_MIN_SENT,
  ]);

  let rankingMensagens = [];
  if (messageEffectivenessRows.length > 0) {
    if (messageEffectivenessRows.length <= 3) {
      rankingMensagens = messageEffectivenessRows;
    } else {
      // Mostra o melhor (2 primeiros) e o pior (último)
      rankingMensagens = [
        messageEffectivenessRows[0],
        messageEffectivenessRows[1],
        messageEffectivenessRows[messageEffectivenessRows.length - 1],
      ];
    }
  }

  // 2. Chip — envios, respostas e cota consumida por instância
  const chipQuery = `
    SELECT
      i.id AS instance_id,
      i.name AS instance_name,
      i.chip_state,
      i.daily_limit_override,
      COALESCE(SUM(u.sent_count), 0)::int AS sent_period,
      COALESCE(
        (
          SELECT sent_count
          FROM public.evolution_instance_daily_usage
          WHERE instance_id = i.id::text AND date = CURRENT_DATE
          LIMIT 1
        ), 0
      )::int AS sent_today
    FROM public.lead_client_evolution_instances i
    LEFT JOIN public.evolution_instance_daily_usage u
      ON u.instance_id = i.id::text
      AND u.date >= $2::date AND u.date <= $3::date
    WHERE i.client_id = $1
    GROUP BY i.id, i.name, i.chip_state, i.daily_limit_override
    ORDER BY sent_period DESC;
  `;
  const { rows: chipRows } = await pool.query(chipQuery, [
    clientId,
    currentStart.toISOString().slice(0, 10),
    currentEnd.toISOString().slice(0, 10),
  ]);

  // Respostas associadas a cada instância através de campaign_dispatches
  const instanceRepliesQuery = `
    WITH runs_by_instance AS (
      SELECT
        d.evolution_instance_id,
        r.phone,
        r.sent_at,
        EXISTS (
          SELECT 1
          FROM public.lead_messages lm
          WHERE lm.client_id = r.client_id
            AND (${rawOrCanonicalPhone})
            AND (lm.direction = 'inbound' OR lm.engagement_signal = 'reply')
            AND ${lmTimestamp} > r.sent_at
            AND ${lmTimestamp} <= r.sent_at + interval '${MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS} days'
        ) AS replied
      FROM public.campaign_dispatch_runs r
      JOIN public.campaign_dispatches d ON d.id = r.dispatch_id
      WHERE r.client_id = $1
        AND r.status = 'sent'
        AND r.phone <> ''
        AND r.sent_at IS NOT NULL
        AND r.sent_at >= $2 AND r.sent_at < $3
        AND d.evolution_instance_id IS NOT NULL
    )
    SELECT
      evolution_instance_id::text AS instance_id,
      COUNT(*)::int AS sent_count,
      COUNT(*) FILTER (WHERE replied)::int AS replied_count
    FROM runs_by_instance
    GROUP BY evolution_instance_id;
  `;
  const { rows: instReplyRows } = await pool.query(instanceRepliesQuery, [
    clientId,
    currentStart.toISOString(),
    currentEnd.toISOString(),
  ]);
  const repliesByInstance = new Map(instReplyRows.map((r) => [String(r.instance_id), r]));

  const chipList = chipRows.map((chip) => {
    const quotaLimit = resolveChipDailyLimit(chip);
    const instStats = repliesByInstance.get(String(chip.instance_id));
    const enviados = instStats ? instStats.sent_count : chip.sent_period;
    const respostas = instStats ? instStats.replied_count : 0;
    const quotaPct = quotaLimit > 0 ? Math.round((chip.sent_today / quotaLimit) * 100) : 0;

    return {
      instanceId: chip.instance_id,
      name: chip.instance_name || String(chip.instance_id),
      chipState: chip.chip_state || "cold",
      sent: enviados,
      replies: respostas,
      sentToday: chip.sent_today,
      quotaLimit,
      quotaConsumedText: `${chip.sent_today} de ${quotaLimit} (${quotaPct}%)`,
      quotaPercentage: quotaPct,
    };
  });

  let rankingChips = [];
  if (chipList.length > 0) {
    if (chipList.length <= 3) {
      rankingChips = chipList;
    } else {
      rankingChips = [chipList[0], chipList[1], chipList[chipList.length - 1]];
    }
  }

  // 3. Região — por DDD e Cidade (quando existir no lead)
  const regionQuery = `
    WITH regional_runs AS (
      SELECT
        r.phone,
        -- Extrai os 2 dígitos de DDD (após DDI 55 ou início de telefone brasileiro de 10/11 dígitos)
        COALESCE(
          NULLIF(substring(regexp_replace(r.phone, '\\D', '', 'g') from '^55([1-9][0-9])'), ''),
          NULLIF(substring(regexp_replace(r.phone, '\\D', '', 'g') from '^([1-9][0-9])[0-9]{8,9}$'), ''),
          'Outro'
        ) AS ddd,
        NULLIF(TRIM(l.cidade), '') AS cidade,
        EXISTS (
          SELECT 1
          FROM public.lead_messages lm
          WHERE lm.client_id = r.client_id
            AND (${rawOrCanonicalPhone})
            AND (lm.direction = 'inbound' OR lm.engagement_signal = 'reply')
            AND ${lmTimestamp} > r.sent_at
            AND ${lmTimestamp} <= r.sent_at + interval '${MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS} days'
        ) AS replied
      FROM public.campaign_dispatch_runs r
      LEFT JOIN public.leads l ON l.id = r.lead_id
      WHERE r.client_id = $1
        AND r.status = 'sent'
        AND r.phone <> ''
        AND r.sent_at IS NOT NULL
        AND r.sent_at >= $2 AND r.sent_at < $3
    )
    SELECT
      ddd,
      cidade,
      COUNT(*)::int AS sent,
      COUNT(*) FILTER (WHERE replied)::int AS replies,
      ROUND(((COUNT(*) FILTER (WHERE replied))::numeric / COUNT(*)) * 100, 1)::float AS reply_rate
    FROM regional_runs
    GROUP BY ddd, cidade
    ORDER BY sent DESC;
  `;
  const { rows: regionRows } = await pool.query(regionQuery, [
    clientId,
    currentStart.toISOString(),
    currentEnd.toISOString(),
  ]);

  const regionList = regionRows.map((r) => {
    const label = r.cidade ? `${r.cidade} (DDD ${r.ddd})` : `DDD ${r.ddd}`;
    return {
      label,
      ddd: r.ddd,
      cidade: r.cidade || null,
      sent: r.sent,
      replies: r.replies,
      replyRate: r.reply_rate,
    };
  });

  let rankingRegiao = [];
  if (regionList.length > 0) {
    if (regionList.length <= 3) {
      rankingRegiao = regionList;
    } else {
      rankingRegiao = [regionList[0], regionList[1], regionList[regionList.length - 1]];
    }
  }

  // 4. Motivo de falha — agrupado e com percentual somando 100%
  const failureQuery = `
    SELECT
      status,
      error_message
    FROM public.campaign_dispatch_runs
    WHERE client_id = $1
      AND (
        status IN ('failed', 'invalid_number')
        OR (status <> 'sent' AND error_message IS NOT NULL)
      )
      AND created_at >= $2 AND created_at < $3;
  `;
  const { rows: failedRows } = await pool.query(failureQuery, [
    clientId,
    currentStart.toISOString(),
    currentEnd.toISOString(),
  ]);

  const countsByCategory = {
    "Número inexistente": 0,
    "Sem WhatsApp": 0,
    "Chip fora do ar": 0,
    "Variável sem valor": 0,
    Outros: 0,
  };

  for (const row of failedRows) {
    const cat = categorizeFailureReason(row.error_message, row.status);
    countsByCategory[cat] = (countsByCategory[cat] || 0) + 1;
  }

  const rawFailureList = Object.entries(countsByCategory)
    .filter(([_, count]) => count > 0)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const normalizedFailures = normalizePercentages(rawFailureList);
  // Mantém no máximo 3 linhas
  const rankingMotivoFalha = normalizedFailures.slice(0, 3);
  // Re-normaliza se foram selecionadas <= 3 linhas de mais opções
  const finalRankingMotivoFalha = normalizePercentages(rankingMotivoFalha);

  // ── Bloco 3: O que fazer agora (No máximo 3 frases com ação) ────────────
  const actionAlerts = [];

  // Alerta 1: Chip com percentual de inválidos acima do normal
  const totalFailedCount = failedRows.length;
  const invalidCount = (countsByCategory["Número inexistente"] || 0) + (countsByCategory["Sem WhatsApp"] || 0);
  const totalRunsPeriod = sentCurrent + totalFailedCount;
  const invalidPercentage = totalRunsPeriod > 0 ? (invalidCount / totalRunsPeriod) * 100 : 0;

  if (invalidCount >= 3 && invalidPercentage > 15) {
    actionAlerts.push({
      id: "alert_invalid_numbers",
      text: "Chip com percentual de inválidos acima do normal — limpe a lista antes do próximo disparo.",
      actionLabel: "Limpar lista",
      actionUrl: "/crm/campanhas",
      severity: "warning",
    });
  }

  // Alerta 2: Campanha com taxa de resposta muito abaixo das outras
  if (messageEffectivenessRows.length >= 2) {
    const avgReplyRate =
      messageEffectivenessRows.reduce((s, r) => s + r.reply_rate, 0) / messageEffectivenessRows.length;
    const worstCampaign = messageEffectivenessRows[messageEffectivenessRows.length - 1];
    if (worstCampaign && worstCampaign.reply_rate < avgReplyRate * 0.5 && worstCampaign.reply_rate <= 10) {
      actionAlerts.push({
        id: "alert_underperforming_campaign",
        text: `Campanha com taxa de resposta muito abaixo das outras — a mensagem não está funcionando.`,
        actionLabel: "Revisar mensagens",
        actionUrl: "/crm/campanhas",
        severity: "warning",
      });
    }
  }

  // Alerta 3: Leads que responderam e ainda não têm responsável
  const orphanedRepliesQuery = `
    SELECT COUNT(*)::int AS count
    FROM public.leads l
    WHERE l.client_id = $1
      AND l.assigned_to IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.lead_messages lm
        WHERE lm.client_id = l.client_id
          AND (${SQL_CANONICAL_PHONE("lm.phone")} = ${SQL_CANONICAL_PHONE("COALESCE(l.telefone, l.phone)")})
          AND (lm.direction = 'inbound' OR lm.engagement_signal = 'reply')
      );
  `;
  const { rows: orphanedRows } = await pool.query(orphanedRepliesQuery, [clientId]);
  const orphanedCount = orphanedRows[0]?.count || 0;
  if (orphanedCount > 0) {
    actionAlerts.push({
      id: "alert_orphaned_replies",
      text: "Leads que responderam e ainda não têm responsável — tem gente esperando.",
      actionLabel: "Distribuir leads",
      actionUrl: "/crm/banco-de-dados",
      severity: "urgent",
    });
  }

  // Alerta 4: Chip frio com volume perto do teto
  const nearLimitColdChip = chipList.find(
    (chip) => chip.chipState === "cold" && chip.quotaPercentage >= 80
  );
  if (nearLimitColdChip && actionAlerts.length < 3) {
    actionAlerts.push({
      id: "alert_cold_chip_limit",
      text: "Chip frio com volume perto do teto — risco de bloqueio.",
      actionLabel: "Ver chips",
      actionUrl: "/crm/chips-whatsapp",
      severity: "urgent",
    });
  }

  // Limita estritamente a 3 alertas
  const selectedAlerts = actionAlerts.slice(0, 3);

  // ── Montagem do Payload Final ───────────────────────────────────────────
  return {
    period: normalizedPeriod,
    lastUpdatedAt: refDate.toISOString(),
    cacheStatus: "fresh",
    hasProposalsAndContracts,
    summary: {
      sent: {
        current: sentCurrent,
        previous: sentPrevious,
        delta: calculateDelta(sentCurrent, sentPrevious),
      },
      replied: {
        current: repliedCurrent,
        previous: repliedPrevious,
        delta: calculateDelta(repliedCurrent, repliedPrevious),
        rate: responseRateCurrent,
        previousRate: responseRatePrevious,
        ruleDeclaration: RESPONSE_RATE_DECLARATION,
      },
      meetings: {
        current: meetingsCurrent,
        previous: meetingsPrevious,
        delta: calculateDelta(meetingsCurrent, meetingsPrevious),
      },
      proposals: proposalsData,
      contracts: contractsData,
    },
    rankings: {
      messages: rankingMensagens,
      chips: rankingChips,
      regions: rankingRegiao,
      failureReasons: finalRankingMotivoFalha,
    },
    alerts: selectedAlerts,
  };
}

// Limite de idade do cache: 15 minutos (constante nomeada obrigatória)
export const DASHBOARD_CACHE_TTL_MS = 15 * 60 * 1000;

// Trava de concorrência por tenant e período
const _activeRecalculations = new Map();

export function _getActiveRecalculationsForTest() {
  return _activeRecalculations;
}

/**
 * Executa o cálculo analítico pesado e persiste no cache.
 * Trava concorrência por tenant e período para evitar cálculos duplicados simultâneos.
 */
export async function recalculateAndCacheDashboardMetrics(pool, clientId, normalizedPeriod, options = {}) {
  const lockKey = `${clientId}:${normalizedPeriod}`;
  if (_activeRecalculations.has(lockKey)) {
    return _activeRecalculations.get(lockKey);
  }

  const computePromise = (async () => {
    try {
      const computed = await calculateDashboardMetrics(pool, clientId, normalizedPeriod, options);
      await pool.query(
        `
          INSERT INTO public.dashboard_metrics_cache (client_id, period, data, status, calculated_at, last_error)
          VALUES ($1, $2, $3, 'fresh', NOW(), NULL)
          ON CONFLICT (client_id, period)
          DO UPDATE SET data = EXCLUDED.data, status = 'fresh', calculated_at = NOW(), last_error = NULL;
        `,
        [clientId, normalizedPeriod, JSON.stringify(computed)]
      );
      return computed;
    } catch (err) {
      console.error("[dashboard] computation failed:", err);
      // Se a atualização falhou mas já havia dado anterior no cache, atualiza status para stale
      const { rows: staleRows } = await pool.query(
        `SELECT data, calculated_at FROM public.dashboard_metrics_cache WHERE client_id = $1 AND period = $2`,
        [clientId, normalizedPeriod]
      ).catch(() => ({ rows: [] }));

      if (staleRows.length > 0 && staleRows[0].data) {
        await pool.query(
          `UPDATE public.dashboard_metrics_cache SET status = 'stale', last_error = $3 WHERE client_id = $1 AND period = $2`,
          [clientId, normalizedPeriod, String(err?.message || err)]
        ).catch(() => {});

        return {
          ...staleRows[0].data,
          lastUpdatedAt: staleRows[0].calculated_at ? new Date(staleRows[0].calculated_at).toISOString() : null,
          cacheStatus: "stale",
          lastError: String(err?.message || err),
        };
      }
      throw err;
    } finally {
      _activeRecalculations.delete(lockKey);
    }
  })();

  _activeRecalculations.set(lockKey, computePromise);
  return computePromise;
}

/**
 * Dispara recálculo em segundo plano sem travar a requisição atual.
 * Se já houver um recálculo ativo para o mesmo tenant/período, não dispara outro.
 */
export function triggerBackgroundRecalculation(pool, clientId, normalizedPeriod, options = {}) {
  const lockKey = `${clientId}:${normalizedPeriod}`;
  if (_activeRecalculations.has(lockKey)) {
    return _activeRecalculations.get(lockKey);
  }
  const promise = recalculateAndCacheDashboardMetrics(pool, clientId, normalizedPeriod, options).catch((err) => {
    console.warn("[dashboard] background recalculation failed:", err?.message || err);
  });
  return promise;
}

/**
 * Lê do cache pré-calculado ou gera sob demanda se inexistente.
 * Se o cache estiver mais velho que DASHBOARD_CACHE_TTL_MS (15 min):
 * devolve o dado existente imediatamente e dispara recálculo em segundo plano.
 * A checagem da tabela ocorre uma única vez por processo.
 */
export async function getOrComputeDashboardMetrics(pool, clientId, periodKey = "30d", options = {}) {
  const normalizedPeriod = periodKey === "7d" || periodKey === "this_month" ? periodKey : "30d";

  await ensureDashboardMetricsCacheTable(pool);

  // 1. Tenta recuperar do cache
  if (!options.forceRefresh) {
    try {
      const { rows } = await pool.query(
        `SELECT data, calculated_at, status, last_error FROM public.dashboard_metrics_cache WHERE client_id = $1 AND period = $2`,
        [clientId, normalizedPeriod]
      );
      if (rows.length > 0 && rows[0].data) {
        const cached = rows[0].data;
        const calculatedAtDate = rows[0].calculated_at ? new Date(rows[0].calculated_at) : null;
        const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
        const ageMs = calculatedAtDate ? nowMs - calculatedAtDate.getTime() : Infinity;
        const isExpired = ageMs > DASHBOARD_CACHE_TTL_MS;

        if (isExpired) {
          // Cache expirado (> 15 min): devolve imediatamente e recalcula em background
          triggerBackgroundRecalculation(pool, clientId, normalizedPeriod, options);
          return {
            ...cached,
            lastUpdatedAt: calculatedAtDate ? calculatedAtDate.toISOString() : cached.lastUpdatedAt,
            cacheStatus: "stale",
            lastError: rows[0].last_error || null,
          };
        }

        // Cache válido (fresco): devolve imediatamente sem recálculo
        return {
          ...cached,
          lastUpdatedAt: calculatedAtDate ? calculatedAtDate.toISOString() : cached.lastUpdatedAt,
          cacheStatus: rows[0].status || "fresh",
          lastError: rows[0].last_error || null,
        };
      }
    } catch (err) {
      console.warn("[dashboard] cache read error:", err?.message || err);
    }
  }

  // 2. Não encontrado ou forceRefresh: calcula utilizando a trava de concorrência
  return recalculateAndCacheDashboardMetrics(pool, clientId, normalizedPeriod, options);
}
