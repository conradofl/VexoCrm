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
// 9. Cada bloco falha sozinho. Bloco que não pôde ser calculado vira `null` no payload e entra em
//    `unavailableBlocks` — indisponível NÃO é zero. Só vira erro quando nenhum bloco foi calculado.

import { SQL_CANONICAL_PHONE } from "./canonicalPhone.js";
import {
  measureLeadClassification,
  measureFirstReplyOnly,
  measureClosings,
  measureTopProfiles,
  measureBaseHealth,
  measureFirstHumanResponse,
} from "./dashboardAnalysis.js";
import { MESSAGE_EFFECTIVENESS_MIN_SENT, MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS } from "./messageEffectiveness.js";
import { resolveChipDailyLimit } from "./chipQuota.js";

// A cota diária do chip é gravada com a data no fuso do tenant (campaigns/routes.js: getDateKey),
// não no fuso do banco. Ler com CURRENT_DATE fazia a cota de "hoje" zerar à noite.
export const DASHBOARD_DEFAULT_TIMEZONE = "America/Sao_Paulo";

export function dateKeyInTimezone(date, timeZone = DASHBOARD_DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
}

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
 * Registra no log do servidor POR QUE um bloco do dashboard não pôde ser calculado:
 * nome do bloco, tenant, período, código e mensagem do Postgres. Sem isso a causa só
 * existia na resposta HTTP e ninguém a via. Schema ausente (tabela/coluna que o tenant
 * não tem) é caso esperado → warn; o resto é falha de verdade → error.
 */
// Tabela inexistente (42P01) é o ÚNICO caso "esperado" — tenant que não usa o módulo. Não usar
// isMissingSchemaError aqui: ele casa qualquer mensagem com "does not exist", inclusive
// "operator does not exist: uuid = text", e aí um bug de tipo vira "tenant não usa GD" em silêncio.
export function isExpectedMissingTable(err) {
  return err?.code === "42P01";
}

function logBlockFailure(blockName, clientId, period, err) {
  const code = err?.code ? ` [${err.code}]` : "";
  const message = String(err?.message || err);
  const line = `[dashboard] bloco "${blockName}" indisponível (client=${clientId}, period=${period})${code}: ${message}`;
  if (isExpectedMissingTable(err)) console.warn(line);
  else console.error(line);
}

/**
 * Cria o executor de blocos: cada bloco roda isolado; se lançar, o erro é registrado,
 * o nome entra em `unavailable` e o valor volta como `null` — nunca como zero.
 */
function createBlockRunner(clientId, period, unavailable, failures = []) {
  return async function runBlock(name, fn) {
    try {
      return { ok: true, value: await fn(), error: null };
    } catch (err) {
      logBlockFailure(name, clientId, period, err);
      unavailable.push(name);
      failures.push({ name, error: err });
      return { ok: false, value: null, error: err };
    }
  };
}

// Blocos que entram na regra "só devolve erro quando nada pôde ser calculado".
// Propostas/contratos ficam de fora: um tenant sem Geração Digital não os calcula nunca.
const CORE_BLOCKS = [
  "summary.sent",
  "summary.replied",
  "summary.meetings",
  "rankings.messages",
  "rankings.chips",
  "rankings.regions",
  "rankings.failureReasons",
];

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

  const unavailableBlocks = [];
  const blockFailures = [];
  const runBlock = createBlockRunner(clientId, normalizedPeriod, unavailableBlocks, blockFailures);

  // ── Bloco 1: Métricas do Topo ───────────────────────────────────────────

  // 1. Enviados (atual e anterior)
  const sentQuery = `
    SELECT
      COUNT(*) FILTER (WHERE sent_at >= $2 AND sent_at < $3)::int AS current_sent,
      COUNT(*) FILTER (WHERE sent_at >= $4 AND sent_at < $5)::int AS previous_sent
    FROM public.campaign_dispatch_runs
    WHERE client_id = $1 AND status = 'sent';
  `;
  const sentBlock = await runBlock("summary.sent", async () => {
    const { rows } = await pool.query(sentQuery, [
      clientId,
      currentStart.toISOString(),
      currentEnd.toISOString(),
      previousStart.toISOString(),
      previousEnd.toISOString(),
    ]);
    return { current: rows[0]?.current_sent || 0, previous: rows[0]?.previous_sent || 0 };
  });
  const sentCurrent = sentBlock.ok ? sentBlock.value.current : null;
  const sentPrevious = sentBlock.ok ? sentBlock.value.previous : null;

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
  const repliedBlock = await runBlock("summary.replied", async () => {
    const { rows } = await pool.query(repliesQuery, [
      clientId,
      currentStart.toISOString(),
      currentEnd.toISOString(),
      previousStart.toISOString(),
      previousEnd.toISOString(),
    ]);
    return { current: rows[0]?.current_replied || 0, previous: rows[0]?.previous_replied || 0 };
  });
  const repliedCurrent = repliedBlock.ok ? repliedBlock.value.current : null;
  const repliedPrevious = repliedBlock.ok ? repliedBlock.value.previous : null;
  // A taxa precisa dos dois números (respostas e envios). Faltando um, a taxa é indisponível — não 0%.
  const bothCountsOk = sentBlock.ok && repliedBlock.ok;
  const responseRateCurrent = !bothCountsOk
    ? null
    : sentCurrent > 0
    ? Number(((repliedCurrent / sentCurrent) * 100).toFixed(1))
    : 0;
  const responseRatePrevious = !bothCountsOk
    ? null
    : sentPrevious > 0
    ? Number(((repliedPrevious / sentPrevious) * 100).toFixed(1))
    : 0;

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
  // followup_schedules + crm_consultant_schedules numa consulta só: se uma das duas faltar o bloco
  // inteiro fica indisponível — somar só uma das tabelas daria um número parcial que parece completo.
  const meetingsBlock = await runBlock("summary.meetings", async () => {
    const { rows } = await pool.query(meetingsQuery, [
      clientId,
      currentStart.toISOString(),
      currentEnd.toISOString(),
      previousStart.toISOString(),
      previousEnd.toISOString(),
    ]);
    return { current: rows[0]?.current_meetings || 0, previous: rows[0]?.previous_meetings || 0 };
  });

  // 4 & 5. Propostas Criadas e Contratos Fechados
  // Verifica se tenant usa esses módulos
  // tenants.id é UUID e gd_*.tenant_id é TEXT (ou UUID, conforme o banco): comparar sempre em ::text.
  const gdUsageQuery = `
    SELECT (
      EXISTS (
        SELECT 1 FROM public.gd_proposals p
        WHERE p.tenant_id::text = $1
           OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id::text = p.tenant_id::text AND t.name ILIKE $1)
        LIMIT 1
      ) OR
      EXISTS (
        SELECT 1 FROM public.gd_contracts c
        WHERE c.tenant_id::text = $1
           OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id::text = c.tenant_id::text AND t.name ILIKE $1)
        LIMIT 1
      )
    ) AS has_gd;
  `;
  // Tabela de GD inexistente (42P01) = tenant que não usa Geração Digital: caso esperado, os dois
  // números ficam escondidos (regra 5) e o painel segue. Qualquer outro erro — inclusive tipo
  // incompatível — significa que não dá para saber se o tenant usa GD: os dois ficam indisponíveis
  // (nem zerados, nem sumidos sem aviso).
  let hasProposalsAndContracts = false;
  try {
    const { rows: gdUsageRows } = await pool.query(gdUsageQuery, [clientId]);
    hasProposalsAndContracts = Boolean(gdUsageRows[0]?.has_gd);
  } catch (err) {
    logBlockFailure("summary.gdUsage", clientId, normalizedPeriod, err);
    if (!isExpectedMissingTable(err)) {
      unavailableBlocks.push("summary.proposals", "summary.contracts");
    }
  }

  let proposalsData = null;
  let contractsData = null;

  if (hasProposalsAndContracts) {
    const proposalsQuery = `
      SELECT
        COUNT(*) FILTER (WHERE p.created_at >= $2 AND p.created_at < $3)::int AS current_proposals,
        COUNT(*) FILTER (WHERE p.created_at >= $4 AND p.created_at < $5)::int AS previous_proposals
      FROM public.gd_proposals p
      WHERE (p.tenant_id::text = $1 OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id::text = p.tenant_id::text AND t.name ILIKE $1));
    `;
    const proposalsBlock = await runBlock("summary.proposals", async () => {
      const { rows } = await pool.query(proposalsQuery, [
      clientId,
      currentStart.toISOString(),
      currentEnd.toISOString(),
      previousStart.toISOString(),
      previousEnd.toISOString(),
    ]);
      const current = rows[0]?.current_proposals || 0;
      const previous = rows[0]?.previous_proposals || 0;
      return { current, previous, delta: calculateDelta(current, previous) };
    });
    proposalsData = proposalsBlock.value;

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
      WHERE (c.tenant_id::text = $1 OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id::text = c.tenant_id::text AND t.name ILIKE $1));
    `;
    const contractsBlock = await runBlock("summary.contracts", async () => {
      const { rows } = await pool.query(contractsQuery, [
      clientId,
      currentStart.toISOString(),
      currentEnd.toISOString(),
      previousStart.toISOString(),
      previousEnd.toISOString(),
    ]);
      const current = rows[0]?.current_contracts || 0;
      const previous = rows[0]?.previous_contracts || 0;
      return { current, previous, delta: calculateDelta(current, previous) };
    });
    contractsData = contractsBlock.value;
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
  const messageRankingBlock = await runBlock("rankings.messages", async () => {
    const { rows } = await pool.query(messageRankingQuery, [
      clientId,
      currentStart.toISOString(),
      currentEnd.toISOString(),
      MESSAGE_EFFECTIVENESS_MIN_SENT,
    ]);
    return rows;
  });
  const messageEffectivenessRows = messageRankingBlock.value;

  let rankingMensagens = messageRankingBlock.ok ? [] : null;
  if (messageEffectivenessRows && messageEffectivenessRows.length > 0) {
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
  // evolution_instance_daily_usage.instance_id é criada como TEXT (chipQuota.js) e como UUID
  // (evolution.js); quem criou primeiro define o tipo em cada banco. Comparar com os DOIS lados
  // em ::text funciona nos dois casos — `uuid = text` estourava e derrubava o painel inteiro.
  const unattributedSentQuery = `
    SELECT COUNT(*)::int AS unattributed_sent
    FROM public.campaign_dispatch_runs r
    JOIN public.campaign_dispatches d ON d.id = r.dispatch_id
    WHERE r.client_id = $1
      AND r.status = 'sent'
      AND r.phone <> ''
      AND r.sent_at IS NOT NULL
      AND r.sent_at >= $2 AND r.sent_at < $3
      AND d.evolution_instance_id IS NULL;
  `;
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
          WHERE instance_id::text = i.id::text AND date = $4::date
          LIMIT 1
        ), 0
      )::int AS sent_today
    FROM public.lead_client_evolution_instances i
    LEFT JOIN public.evolution_instance_daily_usage u
      ON u.instance_id::text = i.id::text
      AND u.date >= $2::date AND u.date <= $3::date
    WHERE i.client_id = $1
    GROUP BY i.id, i.name, i.chip_state, i.daily_limit_override
    ORDER BY sent_period DESC;
  `;
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
  // Envios por chip e respostas por chip são um número só na tela: se uma das consultas cair,
  // o ranking inteiro fica indisponível (respostas desconhecidas não viram "0 respostas").
  //
  // "Envios" do chip = envios de DISPARO atribuídos a ele (campaign_dispatches.evolution_instance_id).
  // Disparo sem chip escolhido usa o chip principal/rodízio na hora do envio e a execução não grava
  // qual chip foi — esses envios não são atribuíveis e aparecem à parte (unattributedSent), em vez de
  // virar "0 envios" no chip. O contador da cota (evolution_instance_daily_usage) é do DIA, outra
  // unidade, e vai separado (sentToday).
  const periodStartKey = dateKeyInTimezone(currentStart, options.timezone);
  const periodEndKey = dateKeyInTimezone(currentEnd, options.timezone);
  const todayKey = dateKeyInTimezone(refDate, options.timezone);
  const chipsBlock = await runBlock("rankings.chips", async () => {
    const { rows: chipRows } = await pool.query(chipQuery, [clientId, periodStartKey, periodEndKey, todayKey]);

    const { rows: instReplyRows } = await pool.query(instanceRepliesQuery, [
      clientId,
      currentStart.toISOString(),
      currentEnd.toISOString(),
    ]);
    const { rows: unattributedRows } = await pool.query(unattributedSentQuery, [
      clientId,
      currentStart.toISOString(),
      currentEnd.toISOString(),
    ]);
    const repliesByInstance = new Map(instReplyRows.map((r) => [String(r.instance_id), r]));

    const list = chipRows
      .map((chip) => {
        const quotaLimit = resolveChipDailyLimit(chip);
        const instStats = repliesByInstance.get(String(chip.instance_id));
        const quotaPct = quotaLimit > 0 ? Math.round((chip.sent_today / quotaLimit) * 100) : 0;

        return {
          instanceId: chip.instance_id,
          name: chip.instance_name || String(chip.instance_id),
          chipState: chip.chip_state || "cold",
          sent: instStats ? instStats.sent_count : 0,
          replies: instStats ? instStats.replied_count : 0,
          sentToday: chip.sent_today,
          quotaLimit,
          quotaConsumedText: `${chip.sent_today} de ${quotaLimit} (${quotaPct}%)`,
          quotaPercentage: quotaPct,
        };
      })
      .sort((x, y) => y.sent - x.sent || y.sentToday - x.sentToday);

    return { list, unattributedSent: unattributedRows[0]?.unattributed_sent || 0 };
  });
  const chipList = chipsBlock.ok ? chipsBlock.value.list : null;

  let rankingChips = chipsBlock.ok ? [] : null;
  if (chipList && chipList.length > 0) {
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
  const regionBlock = await runBlock("rankings.regions", async () => {
    const { rows: regionRows } = await pool.query(regionQuery, [
      clientId,
      currentStart.toISOString(),
      currentEnd.toISOString(),
    ]);

    return regionRows.map((r) => {
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
  });
  const regionList = regionBlock.value;

  let rankingRegiao = regionBlock.ok ? [] : null;
  if (regionList && regionList.length > 0) {
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
      error_message,
      phone
    FROM public.campaign_dispatch_runs
    WHERE client_id = $1
      AND (
        status IN ('failed', 'invalid_number')
        OR (status <> 'sent' AND error_message IS NOT NULL)
      )
      AND created_at >= $2 AND created_at < $3;
  `;
  const failuresBlock = await runBlock("rankings.failureReasons", async () => {
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
    const numbersByCategory = {};
    const allNumbers = new Set();

    for (const row of failedRows) {
      const cat = categorizeFailureReason(row.error_message, row.status);
      countsByCategory[cat] = (countsByCategory[cat] || 0) + 1;
      if (row.phone) {
        (numbersByCategory[cat] ||= new Set()).add(row.phone);
        allNumbers.add(row.phone);
      }
    }

    const rawFailureList = Object.entries(countsByCategory)
      .filter(([_, count]) => count > 0)
      .map(([reason, count]) => ({ reason, count, distinctNumbers: numbersByCategory[reason]?.size || 0 }))
      .sort((a, b) => b.count - a.count);

    // Percentual sobre o TOTAL DE FALHAS (não sobre envios), somando exatamente 100%. Mais de 3
    // motivos: os 2 maiores + "Demais motivos" — nunca cortar o resto e renormalizar só o top 3,
    // que mostraria percentuais que não são os do total.
    const normalizedFailures = normalizePercentages(rawFailureList);
    let ranking = normalizedFailures;
    if (normalizedFailures.length > 3) {
      const [first, second, ...rest] = normalizedFailures;
      const restNumbers = new Set();
      for (const r of rest) numbersByCategory[r.reason]?.forEach((n) => restNumbers.add(n));
      ranking = [
        first,
        second,
        {
          reason: "Demais motivos",
          count: rest.reduce((acc, r) => acc + r.count, 0),
          distinctNumbers: restNumbers.size,
          percentage: rest.reduce((acc, r) => acc + r.percentage, 0),
        },
      ];
    }
    return {
      failedRows,
      countsByCategory,
      ranking,
      totals: { occurrences: failedRows.length, distinctNumbers: allNumbers.size },
    };
  });
  const failedRows = failuresBlock.ok ? failuresBlock.value.failedRows : null;
  const countsByCategory = failuresBlock.ok ? failuresBlock.value.countsByCategory : null;
  const finalRankingMotivoFalha = failuresBlock.ok ? failuresBlock.value.ranking : null;
  const failureTotals = failuresBlock.ok ? failuresBlock.value.totals : null;

  // ── Fase 1.5: medidas com dado que já existe (cada uma isolada) ─────────
  const analysisCtx = { clientId, currentStart, currentEnd, previousStart, previousEnd };
  const closingsBlock = await runBlock("summary.closings", () => measureClosings(pool, analysisCtx));
  const leadClassificationBlock = await runBlock("analysis.leadClassification", () => measureLeadClassification(pool, analysisCtx));
  const firstReplyOnlyBlock = await runBlock("analysis.firstReplyOnly", () => measureFirstReplyOnly(pool, analysisCtx));
  const topProfilesBlock = await runBlock("analysis.topProfiles", () => measureTopProfiles(pool, analysisCtx));
  const baseHealthBlock = await runBlock("analysis.baseHealth", () => measureBaseHealth(pool, analysisCtx));
  const firstHumanResponseBlock = await runBlock("analysis.firstHumanResponse", () => measureFirstHumanResponse(pool, analysisCtx));

  // ── Bloco 3: O que fazer agora (No máximo 3 frases com ação) ────────────
  // Cada aviso só é avaliado quando os números de que depende existem. Número indisponível
  // não dispara nem "apaga" aviso por engano: o aviso fica não avaliado e o bloco `alerts`
  // entra em unavailableBlocks, para a tela dizer que esta lista pode estar incompleta.
  const actionAlerts = [];
  let alertsNotEvaluated = false;

  // Alerta 1: Chip com percentual de inválidos acima do normal
  if (sentBlock.ok && failuresBlock.ok) {
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
  } else {
    alertsNotEvaluated = true;
  }

  // Alerta 2: Campanha com taxa de resposta muito abaixo das outras
  if (messageRankingBlock.ok) {
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
  } else {
    alertsNotEvaluated = true;
  }

  // Alerta 3: Leads que responderam e ainda não têm responsável
  const orphanedBlock = await runBlock("alerts", async () => {
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
    const { rows } = await pool.query(orphanedRepliesQuery, [clientId]);
    return rows[0]?.count || 0;
  });
  if (orphanedBlock.ok && orphanedBlock.value > 0) {
    actionAlerts.push({
      id: "alert_orphaned_replies",
      text: "Leads que responderam e ainda não têm responsável — tem gente esperando.",
      actionLabel: "Distribuir leads",
      actionUrl: "/crm/banco-de-dados",
      severity: "urgent",
    });
  }

  // Alerta 4: Chip frio com volume perto do teto
  if (chipsBlock.ok) {
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
  } else {
    alertsNotEvaluated = true;
  }

  if (alertsNotEvaluated && !unavailableBlocks.includes("alerts")) unavailableBlocks.push("alerts");

  // Limita estritamente a 3 alertas
  const selectedAlerts = actionAlerts.slice(0, 3);

  // ── Só vira erro quando nenhum bloco pôde ser calculado ─────────────────
  const coreCalculated = CORE_BLOCKS.filter((name) => !unavailableBlocks.includes(name)).length;
  if (coreCalculated === 0) {
    const first = blockFailures[0]?.error;
    const error = new Error(
      `Dashboard: nenhum bloco pôde ser calculado (${unavailableBlocks.join(", ")}). ` +
        `Primeira causa: ${String(first?.message || first)}`
    );
    error.code = first?.code;
    error.cause = first;
    error.failures = blockFailures.map(({ name, error: e }) => ({ block: name, message: String(e?.message || e), code: e?.code }));
    throw error;
  }

  // ── Montagem do Payload Final ───────────────────────────────────────────
  // Bloco indisponível = `null` + nome em `unavailableBlocks`. Nunca zero.
  const withDelta = (block) =>
    block.ok ? { current: block.value.current, previous: block.value.previous, delta: calculateDelta(block.value.current, block.value.previous) } : null;

  return {
    period: normalizedPeriod,
    lastUpdatedAt: refDate.toISOString(),
    cacheStatus: "fresh",
    hasProposalsAndContracts,
    unavailableBlocks,
    summary: {
      sent: withDelta(sentBlock),
      replied: repliedBlock.ok
        ? {
            current: repliedCurrent,
            previous: repliedPrevious,
            delta: calculateDelta(repliedCurrent, repliedPrevious),
            rate: responseRateCurrent,
            previousRate: responseRatePrevious,
            ruleDeclaration: RESPONSE_RATE_DECLARATION,
          }
        : null,
      meetings: withDelta(meetingsBlock),
      closings: withDelta(closingsBlock),
      proposals: proposalsData,
      contracts: contractsData,
    },
    rankings: {
      messages: rankingMensagens,
      chips: rankingChips,
      regions: rankingRegiao,
      failureReasons: finalRankingMotivoFalha,
      // Total de falhas (ocorrências e números distintos): é a base dos percentuais de falha.
      failureTotals,
      // Envios de disparo sem chip registrado (usaram o chip principal/rodízio): não atribuíveis a um chip.
      chipsUnattributedSent: chipsBlock.ok ? chipsBlock.value.unattributedSent : null,
    },
    analysis: {
      leadClassification: leadClassificationBlock.value,
      firstReplyOnly: firstReplyOnlyBlock.value,
      topProfiles: topProfilesBlock.value,
      baseHealth: baseHealthBlock.value,
      firstHumanResponse: firstHumanResponseBlock.value,
    },
    alerts: selectedAlerts,
  };
}

// Limite de idade do cache: 15 minutos (constante nomeada obrigatória)
export const DASHBOARD_CACHE_TTL_MS = 15 * 60 * 1000;
// Resultado com bloco indisponível não pode ficar congelado 15 minutos: uma falha passageira
// (timeout, deploy) apagaria números do painel por um quarto de hora. Vence em 2 minutos.
export const DASHBOARD_PARTIAL_CACHE_TTL_MS = 2 * 60 * 1000;

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
      // Gravar o cache é otimização: se a tabela não existir ou a escrita falhar, o número já
      // calculado vai para a tela do mesmo jeito (antes, isso virava 500 e jogava o cálculo fora).
      try {
        await pool.query(
          `
            INSERT INTO public.dashboard_metrics_cache (client_id, period, data, status, calculated_at, last_error)
            VALUES ($1, $2, $3, 'fresh', NOW(), NULL)
            ON CONFLICT (client_id, period)
            DO UPDATE SET data = EXCLUDED.data, status = 'fresh', calculated_at = NOW(), last_error = NULL;
          `,
          [clientId, normalizedPeriod, JSON.stringify(computed)]
        );
      } catch (cacheErr) {
        const code = cacheErr?.code ? ` [${cacheErr.code}]` : "";
        console.error(
          `[dashboard] cache não gravado (client=${clientId}, period=${normalizedPeriod})${code}: ${String(cacheErr?.message || cacheErr)}`
        );
      }
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
        const isPartial = Array.isArray(cached.unavailableBlocks) && cached.unavailableBlocks.length > 0;
        const isExpired = ageMs > (isPartial ? DASHBOARD_PARTIAL_CACHE_TTL_MS : DASHBOARD_CACHE_TTL_MS);

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
