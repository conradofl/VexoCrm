// Motor de Reativação Automática de Leads Parados (Pilar 2 das Promessas Comerciais)
// Inscreve automaticamente contatos em etapas ativas inativos há X dias em cadências de follow-up,
// respeitando cooldown para não reinserir o mesmo lead em loop e adicionando tag visual #Reativacao-Automatica.

import { enrollLead as defaultEnrollLead } from "../followup/service.js";

export const DEFAULT_REACTIVATION_SETTINGS = {
  reactivation_enabled: false,
  reactivation_stalled_days: 7,
  reactivation_cadence_id: null,
  reactivation_cooldown_days: 30,
};

export const REACTIVATION_TAG = "#Reativacao-Automatica";

// Definição ÚNICA e CANÔNICA de "Lead Parado" (Zero Perdas / Nenhum Lead Esquecido)
// Reusada por todo o sistema: tela de leads parados, dashboard, motor de reativação e notificações.
export const STALLED_EXCLUDED_STAGES = ["fechado", "buyer", "perdido", "descartado", "lost"];
export const SQL_STALLED_EXCLUDED_STAGES = "'fechado', 'buyer', 'perdido', 'descartado', 'lost'";

/** Condição SQL canônica que define estágio ativo (não fechado / não perdido) */
export const sqlStalledStageCondition = (alias = "l") =>
  `(${alias}.stage IS NULL OR lower(${alias}.stage) NOT IN (${SQL_STALLED_EXCLUDED_STAGES}))`;

/** Expressão SQL canônica para timestamp da última interação/mensagem do lead (sem fallback para created_at/updated_at) */
export const sqlIdleTimestamp = (alias = "l") =>
  `COALESCE(${alias}.last_message_at, ${alias}.last_interaction_at)`;

/** Expressão SQL canônica para cálculo de dias parado (days_idle) */
export const sqlDaysIdle = (alias = "l") =>
  `EXTRACT(DAY FROM (NOW() - ${sqlIdleTimestamp(alias)}))::int`;

/** Condição SQL canônica para verificar se o lead está inativo há pelo menos X dias (exige contato prévio e parênteses estritos no OR) */
export const sqlIsStalled = (alias = "l", paramPlaceholder = "$2") =>
  `(${alias}.last_message_at IS NOT NULL OR ${alias}.last_interaction_at IS NOT NULL) AND (NOW() - COALESCE(${alias}.last_message_at, ${alias}.last_interaction_at)) >= (${paramPlaceholder} || ' days')::interval`;

/**
 * Normaliza e sanitiza as configurações de reativação
 */
export function sanitizeReactivationSettings(input = {}, clientId = null) {
  const enabled =
    input.reactivation_enabled === true ||
    input.reactivation_enabled === "true" ||
    input.reactivation_enabled === 1 ||
    input.reactivation_enabled === "1";

  const stalledDaysRaw = Number(input.reactivation_stalled_days);
  const stalledDays = Number.isInteger(stalledDaysRaw) && stalledDaysRaw >= 1 ? stalledDaysRaw : 7;

  const cadenceId =
    input.reactivation_cadence_id && typeof input.reactivation_cadence_id === "string"
      ? input.reactivation_cadence_id.trim()
      : null;

  const cooldownDaysRaw = Number(input.reactivation_cooldown_days);
  const cooldownDays = Number.isInteger(cooldownDaysRaw) && cooldownDaysRaw >= 1 ? cooldownDaysRaw : 30;

  return {
    client_id: clientId || input.client_id || null,
    reactivation_enabled: enabled,
    reactivation_stalled_days: stalledDays,
    reactivation_cadence_id: cadenceId || null,
    reactivation_cooldown_days: cooldownDays,
  };
}

/**
 * Obtém as configurações de reativação do tenant da tabela lead_client_n8n_settings
 */
export async function getReactivationSettings(pool, clientId) {
  if (!pool || !clientId) {
    return { ...DEFAULT_REACTIVATION_SETTINGS, client_id: clientId || null };
  }

  try {
    const { rows } = await pool.query(
      `SELECT client_id, reactivation_enabled, reactivation_stalled_days, reactivation_cadence_id, reactivation_cooldown_days
       FROM public.lead_client_n8n_settings
       WHERE client_id = $1
       LIMIT 1`,
      [clientId]
    );

    if (rows && rows.length > 0) {
      return sanitizeReactivationSettings(rows[0], clientId);
    }
  } catch (err) {
    console.warn(`[reactivation-engine] Aviso ao ler configurações de reativação para ${clientId}:`, err?.message || err);
  }

  return { ...DEFAULT_REACTIVATION_SETTINGS, client_id: clientId };
}

/**
 * Salva ou atualiza as configurações de reativação do tenant
 */
export async function saveReactivationSettings(pool, clientId, settings = {}) {
  if (!pool || !clientId) {
    throw new Error("Pool e clientId são obrigatórios para salvar configurações de reativação.");
  }

  const sanitized = sanitizeReactivationSettings(settings, clientId);

  const { rows } = await pool.query(
    `INSERT INTO public.lead_client_n8n_settings 
       (client_id, reactivation_enabled, reactivation_stalled_days, reactivation_cadence_id, reactivation_cooldown_days, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (client_id) DO UPDATE SET
       reactivation_enabled = EXCLUDED.reactivation_enabled,
       reactivation_stalled_days = EXCLUDED.reactivation_stalled_days,
       reactivation_cadence_id = EXCLUDED.reactivation_cadence_id,
       reactivation_cooldown_days = EXCLUDED.reactivation_cooldown_days,
       updated_at = NOW()
     RETURNING client_id, reactivation_enabled, reactivation_stalled_days, reactivation_cadence_id, reactivation_cooldown_days`,
    [
      clientId,
      sanitized.reactivation_enabled,
      sanitized.reactivation_stalled_days,
      sanitized.reactivation_cadence_id,
      sanitized.reactivation_cooldown_days,
    ]
  );

  return sanitizeReactivationSettings(rows[0], clientId);
}

/**
 * Lista as cadências ativas disponíveis para o tenant
 */
export async function getCadenceOptions(pool, clientId) {
  if (!pool || !clientId) return [];

  try {
    const { rows } = await pool.query(
      `SELECT fc.id, fc.name, fc.status, fc.company_id
       FROM public.followup_campaigns fc
       JOIN public.followup_companies fco ON fco.id = fc.company_id
       WHERE fco.tenant_id = $1 AND fc.status = 'active'
       ORDER BY fc.name ASC`,
      [clientId]
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      company_id: r.company_id,
    }));
  } catch (err) {
    console.warn(`[reactivation-engine] Falha ao listar cadências para ${clientId}:`, err?.message || err);
    return [];
  }
}

/**
 * Conta quantos leads estão elegíveis para reativação neste momento
 */
export async function countEligibleReactivations(pool, { clientId, stalledDays = 7, cadenceId = null, cooldownDays = 30 }) {
  if (!pool || !clientId) return 0;

  const safeStalledDays = Math.max(1, Number(stalledDays) || 7);
  const safeCooldownDays = Math.max(1, Number(cooldownDays) || 30);

  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM public.leads l
       WHERE l.client_id = $1
         AND ${sqlStalledStageCondition("l")}
         AND ${sqlIsStalled("l", "$2")}
         AND NOT EXISTS (
           SELECT 1 FROM public.followup_schedules fs
           WHERE (
             fs.phone = l.telefone 
             OR fs.phone = l.phone
             OR regexp_replace(COALESCE(fs.phone, ''), '\\D', '', 'g') = regexp_replace(COALESCE(l.telefone, l.phone, ''), '\\D', '', 'g')
           )
           AND ($3::uuid IS NULL OR fs.campaign_id = $3::uuid OR fs.origin = 'reativacao_automatica')
           AND fs.created_at >= NOW() - ($4 || ' days')::interval
         )`,
      [clientId, safeStalledDays, cadenceId || null, safeCooldownDays]
    );

    return Number(rows[0]?.count) || 0;
  } catch (err) {
    console.warn(`[reactivation-engine] Falha ao contar leads elegíveis para ${clientId}:`, err?.message || err);
    return 0;
  }
}

/**
 * Conta o impacto: quantos leads foram reativados nos últimos 30 dias
 */
export async function countReactivatedLast30Days(pool, { clientId, cadenceId = null }) {
  if (!pool || !clientId) return 0;

  try {
    const { rows } = await pool.query(
      `SELECT COUNT(DISTINCT fs.phone)::int AS count
       FROM public.followup_schedules fs
       JOIN public.followup_companies fco ON fco.id = fs.company_id
       WHERE fco.tenant_id = $1
         AND (fs.origin = 'reativacao_automatica' OR ($2::uuid IS NOT NULL AND fs.campaign_id = $2::uuid))
         AND fs.created_at >= NOW() - INTERVAL '30 days'`,
      [clientId, cadenceId || null]
    );

    return Number(rows[0]?.count) || 0;
  } catch (err) {
    console.warn(`[reactivation-engine] Falha ao contar reativados últimos 30 dias para ${clientId}:`, err?.message || err);
    return 0;
  }
}

/**
 * Motor de execução da reativação automática:
 * Localiza leads elegíveis e inscreve na cadência configurada
 */
export async function runDueReactivations(
  pool,
  { clientId, manual = false, dryRun = false, enrollLeadFn = null }
) {
  if (!pool || !clientId) {
    return {
      success: false,
      client_id: clientId,
      reactivated_count: 0,
      reason: "missing_client_or_pool",
      message: "Pool ou clientId inválidos.",
    };
  }

  // 1. Obter configurações ativas do tenant
  const settings = await getReactivationSettings(pool, clientId);

  if (!manual && !settings.reactivation_enabled) {
    return {
      success: false,
      client_id: clientId,
      reactivated_count: 0,
      reason: "reactivation_disabled",
      message: "Reativação automática está desativada para este cliente.",
    };
  }

  if (!settings.reactivation_cadence_id) {
    return {
      success: false,
      client_id: clientId,
      reactivated_count: 0,
      reason: "missing_cadence_id",
      message: "Nenhuma cadência de reativação configurada.",
    };
  }

  // 2. Verificar se a cadência existe e está ativa para este tenant
  const { rows: campRows } = await pool.query(
    `SELECT fc.id, fc.name, fc.company_id, fc.status, fc.default_origin, fc.dispatch_jitter_minutes
     FROM public.followup_campaigns fc
     JOIN public.followup_companies fco ON fco.id = fc.company_id
     WHERE fc.id = $1 AND fco.tenant_id = $2
     LIMIT 1`,
    [settings.reactivation_cadence_id, clientId]
  );

  if (!campRows || campRows.length === 0) {
    return {
      success: false,
      client_id: clientId,
      reactivated_count: 0,
      reason: "cadence_not_found",
      message: "A cadência configurada não pertence a este tenant ou não foi encontrada.",
    };
  }

  const campaign = campRows[0];
  if (campaign.status !== "active") {
    return {
      success: false,
      client_id: clientId,
      reactivated_count: 0,
      reason: "cadence_not_active",
      message: `A cadência "${campaign.name}" não está ativa (status: ${campaign.status}).`,
    };
  }

  // 3. Buscar candidatos elegíveis no tenant
  const { rows: candidates } = await pool.query(
    `SELECT l.id, l.nome, l.telefone, l.phone, l.stage, l.tags, l.data_nascimento,
            ${sqlDaysIdle("l")} AS days_idle
     FROM public.leads l
     WHERE l.client_id = $1
       AND ${sqlStalledStageCondition("l")}
       AND ${sqlIsStalled("l", "$2")}
       AND NOT EXISTS (
         SELECT 1 FROM public.followup_schedules fs
         WHERE (
           fs.phone = l.telefone 
           OR fs.phone = l.phone
           OR regexp_replace(COALESCE(fs.phone, ''), '\\D', '', 'g') = regexp_replace(COALESCE(l.telefone, l.phone, ''), '\\D', '', 'g')
         )
         AND (fs.campaign_id = $3::uuid OR fs.origin = 'reativacao_automatica')
         AND fs.created_at >= NOW() - ($4 || ' days')::interval
       )
     ORDER BY days_idle DESC, l.id DESC`,
    [
      clientId,
      settings.reactivation_stalled_days,
      settings.reactivation_cadence_id,
      settings.reactivation_cooldown_days,
    ]
  );

  if (dryRun) {
    return {
      success: true,
      dry_run: true,
      client_id: clientId,
      cadence_id: campaign.id,
      cadence_name: campaign.name,
      eligible_count: candidates.length,
      leads: candidates,
    };
  }

  const enroll = enrollLeadFn || defaultEnrollLead;
  const reactivatedLeads = [];
  let reactivatedCount = 0;

  // 4. Inscrever cada lead elegível
  for (const lead of candidates) {
    const rawPhone = lead.telefone || lead.phone;
    if (!rawPhone || !String(rawPhone).trim()) {
      continue;
    }

    try {
      const enrollResult = await enroll(campaign, {
        lead_name: lead.nome || "Lead",
        phone: rawPhone,
        originOverride: "reativacao_automatica",
        data_nascimento: lead.data_nascimento || null,
        lead,
      });

      // Adiciona a tag visual #Reativacao-Automatica no cadastro do lead
      await pool.query(
        `UPDATE public.leads
         SET tags = ARRAY(SELECT DISTINCT unnest(array_append(COALESCE(tags, ARRAY[]::text[]), $1))),
             updated_at = NOW()
         WHERE id = $2 AND client_id = $3`,
        [REACTIVATION_TAG, lead.id, clientId]
      );

      reactivatedCount++;
      reactivatedLeads.push({
        id: lead.id,
        nome: lead.nome,
        telefone: rawPhone,
        days_idle: lead.days_idle,
        schedule_id: enrollResult?.scheduleId || null,
      });
    } catch (enrollErr) {
      console.error(
        `[reactivation-engine] Erro ao inscrever lead ${lead.id} (${rawPhone}) na cadência ${campaign.id}:`,
        enrollErr?.message || enrollErr
      );
    }
  }

  return {
    success: true,
    client_id: clientId,
    cadence_id: campaign.id,
    cadence_name: campaign.name,
    reactivated_count: reactivatedCount,
    total_eligible: candidates.length,
    leads: reactivatedLeads,
  };
}

/**
 * Consulta canônica de Leads Parados (Pilar 1: Aviso de Lead Parado - Nenhum Lead Esquecido).
 * Retorna contagem e lista de leads em etapas ativas sem contato há pelo menos stalledDays dias.
 * Funciona independentemente de reactivation_enabled estar ligado ou desligado (ver não é agir).
 * Ordenada estritamente por quem está parado há mais tempo (days_idle DESC, l.id DESC).
 */
export async function queryStalledLeadsList(pool, {
  clientId,
  stalledDays = null,
  limit = 50,
  offset = 0,
  stage = null,
  ownerUid = null,
} = {}) {
  if (!pool || !clientId) {
    return { count: 0, minDays: 7, reactivation_enabled: false, reactivation_stalled_days: 7, leads: [] };
  }

  // Se stalledDays não for fornecido explicitamente, lê a configuração do tenant (default 7)
  let safeStalledDays = stalledDays !== null && stalledDays !== undefined ? Number(stalledDays) : null;
  const settings = await getReactivationSettings(pool, clientId);

  if (!Number.isInteger(safeStalledDays) || safeStalledDays < 0) {
    safeStalledDays = settings.reactivation_stalled_days || 7;
  }

  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const params = [clientId, safeStalledDays];
  const conditions = [
    `l.client_id = $1`,
    sqlIsStalled("l", "$2"),
  ];

  if (stage && stage !== "all") {
    params.push(String(stage).toLowerCase().trim());
    conditions.push(`lower(l.stage) = $${params.length}`);
  } else {
    conditions.push(sqlStalledStageCondition("l"));
  }

  if (ownerUid) {
    params.push(String(ownerUid).trim());
    conditions.push(`(l.assigned_to = $${params.length} OR l.dados->>'sdr_rotation_owner' = $${params.length})`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  // Contagem de leads parados (em conversa prévia, inativos há >= minDays dias)
  const countSql = `SELECT COUNT(*)::int AS count FROM public.leads l ${whereClause}`;

  // Contagem de leads nunca abordados (estágio ativo/aberto sem nenhuma mensagem ou interação)
  const neverApproachedParams = [clientId];
  const neverApproachedConditions = [
    `l.client_id = $1`,
    sqlStalledStageCondition("l"),
    `l.last_message_at IS NULL`,
    `l.last_interaction_at IS NULL`,
  ];
  if (stage && stage !== "all") {
    neverApproachedParams.push(String(stage).toLowerCase().trim());
    neverApproachedConditions.push(`lower(l.stage) = $${neverApproachedParams.length}`);
  }
  if (ownerUid) {
    neverApproachedParams.push(String(ownerUid).trim());
    neverApproachedConditions.push(
      `(l.assigned_to = $${neverApproachedParams.length} OR l.dados->>'sdr_rotation_owner' = $${neverApproachedParams.length})`
    );
  }
  const neverApproachedSql = `SELECT COUNT(*)::int AS count FROM public.leads l WHERE ${neverApproachedConditions.join(" AND ")}`;

  // Verifica se a tabela public.lead_messages existe no banco
  let hasMessagesTable = false;
  try {
    const { rows: regRows } = await pool.query(`SELECT to_regclass('public.lead_messages') AS tbl`);
    hasMessagesTable = Boolean(regRows[0]?.tbl);
  } catch {
    hasMessagesTable = false;
  }

  const messageSubquery = hasMessagesTable
    ? `(
        SELECT lm.message_text
        FROM public.lead_messages lm
        WHERE lm.client_id = l.client_id
          AND (
            lm.lead_id = l.id
            OR lm.phone = l.telefone
            OR lm.phone = l.phone
          )
          AND lm.message_text IS NOT NULL
          AND lm.message_text <> ''
        ORDER BY lm.message_timestamp DESC, lm.created_at DESC
        LIMIT 1
      )`
    : `NULL`;

  // Busca dos leads com última mensagem e responsável
  params.push(safeLimit);
  const limitIdx = params.length;
  params.push(safeOffset);
  const offsetIdx = params.length;

  const leadsSql = `
    SELECT
      l.id,
      l.client_id,
      l.nome,
      l.telefone,
      l.phone,
      l.stage,
      l.temperature,
      l.tags,
      l.created_at,
      l.updated_at,
      l.last_interaction_at,
      l.last_message_at,
      ${sqlDaysIdle("l")} AS days_idle,
      COALESCE(l.dados->>'sdr_rotation_owner', l.assigned_to) AS sdr_rotation_owner,
      COALESCE(l.assigned_to, l.dados->>'sdr_rotation_owner') AS assigned_to,
      COALESCE(
        ${messageSubquery},
        l.raw_chat_summary,
        l.dados->>'resumo_chat',
        ''
      ) AS last_message
    FROM public.leads l
    ${whereClause}
    ORDER BY days_idle DESC, l.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const [{ rows: countRows }, { rows: neverApproachedRows }, { rows: leadRows }] = await Promise.all([
    pool.query(countSql, params.slice(0, params.length - 2)),
    pool.query(neverApproachedSql, neverApproachedParams),
    pool.query(leadsSql, params),
  ]);

  const stalledCount = Number(countRows[0]?.count) || 0;
  const neverApproachedCount = Number(neverApproachedRows[0]?.count) || 0;

  return {
    count: stalledCount,
    stalled_count: stalledCount,
    never_approached_count: neverApproachedCount,
    minDays: safeStalledDays,
    reactivation_enabled: settings.reactivation_enabled,
    reactivation_stalled_days: settings.reactivation_stalled_days,
    reactivation_cadence_id: settings.reactivation_cadence_id,
    leads: leadRows,
  };
}

/**
 * Canal B: Sincroniza notificações de Leads Parados para o responsável em public.notifications.
 * Idempotente: não gera duplicatas não-lidas para o mesmo contato no mesmo canal.
 */
export async function syncStalledLeadsNotifications(pool, { clientId, stalledDays = null }) {
  if (!pool || !clientId) return { inserted: 0 };

  let safeStalledDays = stalledDays !== null && stalledDays !== undefined ? Number(stalledDays) : null;
  if (!Number.isInteger(safeStalledDays) || safeStalledDays < 0) {
    const settings = await getReactivationSettings(pool, clientId);
    safeStalledDays = settings.reactivation_stalled_days || 7;
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO public.notifications (client_id, type, title, description, link, read, created_at)
       SELECT
         l.client_id,
         'lead_stalled',
         '⚠️ Lead parado: ' || COALESCE(l.nome, l.telefone, 'Contato'),
         'Lead ' || COALESCE(l.nome, 'Sem nome') || ' (' || COALESCE(l.telefone, l.phone, 'Sem telefone') || ') está sem resposta há ' || ${sqlDaysIdle("l")} || ' dias.',
         '/crm/whatsapp?phone=' || COALESCE(l.telefone, l.phone, ''),
         false,
         NOW()
       FROM public.leads l
       WHERE l.client_id = $1
         AND ${sqlStalledStageCondition("l")}
         AND ${sqlIsStalled("l", "$2")}
         AND COALESCE(l.telefone, l.phone) IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.notifications n
           WHERE n.client_id = l.client_id
             AND n.type = 'lead_stalled'
             AND n.link = ('/crm/whatsapp?phone=' || COALESCE(l.telefone, l.phone, ''))
             AND (n.read = false OR n.created_at >= NOW() - INTERVAL '3 days')
         )
       RETURNING id`,
      [clientId, safeStalledDays]
    );

    // Registra timestamp de sincronização do tenant para controle diário
    try {
      await pool.query(
        `INSERT INTO public.lead_client_n8n_settings (client_id, stalled_notifications_synced_at, updated_at)
         VALUES ($1, NOW(), NOW())
         ON CONFLICT (client_id) DO UPDATE SET
           stalled_notifications_synced_at = NOW(),
           updated_at = NOW()`,
        [clientId]
      );
    } catch {}

    return { inserted: rows.length };
  } catch (err) {
    console.warn(`[reactivation-engine] Falha ao sincronizar notificações de leads parados para ${clientId}:`, err?.message || err);
    return { inserted: 0, error: err?.message };
  }
}

/**
 * Disparo automático de Notificações de Leads Parados para todas as empresas.
 * Reusa o loop central de background do sistema garantindo:
 * 1. Uma vez por dia por empresa (ignora empresas sincronizadas nas últimas 24h).
 * 2. Idempotente: não gera duplicatas não-lidas em public.notifications.
 * 3. Roda mesmo com reactivation_enabled = false (ver/avisar não é agir).
 * 4. Não depende de janela de envio (notificação interna do CRM, não envio ao cliente).
 */
export async function syncDailyStalledNotificationsForAllTenants(pool) {
  if (!pool?.query) return { checkedTenants: 0, totalInserted: 0 };

  try {
    let dueTenants = [];
    try {
      // 1. Tenta consulta padrão usando a coluna stalled_notifications_synced_at
      const { rows } = await pool.query(`
        SELECT c.id AS client_id
        FROM public.leads_clients c
        LEFT JOIN public.lead_client_n8n_settings s ON s.client_id = c.id
        WHERE s.stalled_notifications_synced_at IS NULL
           OR s.stalled_notifications_synced_at < NOW() - INTERVAL '24 hours'
      `);
      dueTenants = rows || [];
    } catch (colErr) {
      // 2. Fallback de dois estados do schema (DIRETRIZES-IA.md, seção 12):
      // Se a coluna ainda não foi migrada/criada no banco, consulta public.notifications
      const { rows } = await pool.query(`
        SELECT c.id AS client_id
        FROM public.leads_clients c
        WHERE NOT EXISTS (
          SELECT 1 FROM public.notifications n
          WHERE n.client_id = c.id
            AND n.type = 'lead_stalled'
            AND n.created_at >= NOW() - INTERVAL '24 hours'
        )
      `);
      dueTenants = rows || [];
    }

    if (!dueTenants || dueTenants.length === 0) {
      return { checkedTenants: 0, totalInserted: 0 };
    }

    let totalInserted = 0;
    for (const tenant of dueTenants) {
      const clientId = tenant.client_id;
      const res = await syncStalledLeadsNotifications(pool, { clientId });
      totalInserted += res.inserted || 0;
    }

    return { checkedTenants: dueTenants.length, totalInserted };
  } catch (err) {
    console.warn("[reactivation-engine] Falha ao sincronizar notificações diárias de todos os tenants:", err?.message || err);
    return { checkedTenants: 0, totalInserted: 0, error: err?.message };
  }
}

