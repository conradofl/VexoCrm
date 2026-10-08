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
         AND (l.stage IS NULL OR l.stage NOT IN ('fechado', 'buyer', 'perdido', 'descartado', 'lost'))
         AND (NOW() - COALESCE(l.last_message_at, l.last_interaction_at, l.updated_at, l.created_at)) >= ($2 || ' days')::interval
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
            EXTRACT(DAY FROM (NOW() - COALESCE(l.last_message_at, l.last_interaction_at, l.updated_at, l.created_at)))::int AS days_idle
     FROM public.leads l
     WHERE l.client_id = $1
       AND (l.stage IS NULL OR l.stage NOT IN ('fechado', 'buyer', 'perdido', 'descartado', 'lost'))
       AND (NOW() - COALESCE(l.last_message_at, l.last_interaction_at, l.updated_at, l.created_at)) >= ($2 || ' days')::interval
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
