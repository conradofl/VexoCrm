// backend/src/services/agentMuteGuard.js
// Travas de segurança e persistência para silenciamento do agente em conversas não-comerciais.
//
// Regra de ouro: O julgamento da IA (nao_comercial: true) NUNCA passa por cima de:
// 1. Lead em estágio open_budget ou buyer
// 2. Lead com resumo comercial existente (temConversaComercial)
// 3. Lead cujo estágio foi definido manualmente por um humano (stage_source = 'manual')
// 4. Lead originado de disparo de campanha (hasCampaignMatch)
// 5. Freio de emergência contra descalibração de IA (máximo de N silenciamentos por dia)

import { temConversaComercial } from "./conversationInsightHelper.js";

export const DEFAULT_DAILY_MUTE_LIMIT = 20;

/**
 * Avalia as cinco travas de segurança obrigatórias antes de permitir que uma conversa seja silenciada.
 * Retorna { canMute: true } somente se NENHUMA das cinco travas for violada.
 *
 * @param {object} params
 * @param {object|null} params.lead Registro do lead no CRM
 * @param {boolean} params.hasCampaignMatch Verdadeiro se o telefone casa com disparo de campanha
 * @param {number} params.dailyMutedCount Total de conversas já silenciadas pelo tenant no dia
 * @param {number} [params.dailyLimit=DEFAULT_DAILY_MUTE_LIMIT] Teto diário de segurança
 * @returns {{ canMute: boolean, blockedBy: string|null }}
 */
export function evaluateAgentMuteGuards({
  lead = null,
  hasCampaignMatch = false,
  dailyMutedCount = 0,
  dailyLimit = DEFAULT_DAILY_MUTE_LIMIT,
}) {
  // Trava 1: Lead em open_budget ou marcado como buyer
  const stage = String(lead?.stage || "").trim().toLowerCase();
  if (stage === "open_budget" || stage === "buyer") {
    return { canMute: false, blockedBy: "lead_em_estagio_comercial" };
  }

  // Trava 2: Lead com resumo comercial existente
  if (lead && temConversaComercial(lead)) {
    return { canMute: false, blockedBy: "lead_com_resumo_comercial" };
  }

  // Trava 3: Lead com estágio marcado manualmente por pessoa
  const stageSource = String(lead?.stage_source || "").trim().toLowerCase();
  if (stageSource === "manual") {
    return { canMute: false, blockedBy: "estagio_marcado_manualmente" };
  }

  // Trava 4: Telefone originado de campanha (resposta a disparo)
  if (hasCampaignMatch === true) {
    return { canMute: false, blockedBy: "contato_de_campanha" };
  }

  // Trava 5: Freio de emergência (pico diário de silenciamentos)
  if (dailyMutedCount >= dailyLimit) {
    console.error("[agentMuteGuard] ALERTA DE FREIO DE EMERGÊNCIA: tenant atingiu o teto diário de silenciamentos!", {
      dailyMutedCount,
      dailyLimit,
    });
    return { canMute: false, blockedBy: "freio_de_emergencia_diario" };
  }

  return { canMute: true, blockedBy: null };
}

/**
 * Consulta se uma conversa está com o agente silenciado (agent_muted_at preenchido).
 */
export async function isChatAgentMuted(pool, clientId, phone) {
  if (!pool || !clientId || !phone) return false;
  try {
    const res = await pool.query(
      `SELECT agent_muted_at
         FROM public.whatsapp_chat_states
        WHERE client_id = $1 AND phone = $2
        LIMIT 1`,
      [clientId, phone]
    );
    return Boolean(res.rows[0]?.agent_muted_at);
  } catch (err) {
    console.warn("[agentMuteGuard] erro ao consultar isChatAgentMuted:", err?.message || err);
    return false;
  }
}

/**
 * Conta quantas conversas foram silenciadas pelo tenant no dia atual (para o freio de emergência).
 */
export async function countTenantMutedToday(pool, clientId) {
  if (!pool || !clientId) return 0;
  try {
    const res = await pool.query(
      `SELECT COUNT(*)::integer as total
         FROM public.whatsapp_chat_states
        WHERE client_id = $1
          AND agent_muted_at >= date_trunc('day', now())`,
      [clientId]
    );
    return res.rows[0]?.total || 0;
  } catch (err) {
    console.warn("[agentMuteGuard] erro ao contar silenciamentos do dia:", err?.message || err);
    return 0;
  }
}

/**
 * Grava o silenciamento do robô na conversa, preservando o state (continua 'ativa').
 */
export async function recordAgentMute(pool, { clientId, phone, reason }) {
  if (!pool || !clientId || !phone) return;
  const mutedReason = String(reason || "Conversa não-comercial").trim().slice(0, 200);

  await pool.query(
    `INSERT INTO public.whatsapp_chat_states (client_id, phone, state, reason, source, agent_muted_at, agent_muted_reason, updated_at)
     VALUES ($1, $2, 'ativa', NULL, 'auto', now(), $3, now())
     ON CONFLICT (client_id, phone) DO UPDATE SET
       agent_muted_at = now(),
       agent_muted_reason = EXCLUDED.agent_muted_reason,
       updated_at = now()`,
    [clientId, phone, mutedReason]
  );
}

/**
 * Reativa o agente na conversa (limpa agent_muted_at e agent_muted_reason).
 */
export async function clearAgentMute(pool, { clientId, phone }) {
  if (!pool || !clientId || !phone) return;
  await pool.query(
    `UPDATE public.whatsapp_chat_states
        SET agent_muted_at = NULL,
            agent_muted_reason = NULL,
            updated_at = now()
      WHERE client_id = $1 AND phone = $2 AND agent_muted_at IS NOT NULL`,
    [clientId, phone]
  );
}

/**
  * Retorna contadores de conversas silenciadas por motivo no dia atual (para métricas e auditoria).
  */
export async function getTenantMutedStats(pool, clientId) {
  if (!pool || !clientId) return { totalToday: 0, byReason: {} };
  try {
    const res = await pool.query(
      `SELECT COALESCE(agent_muted_reason, 'Não especificado') as reason, COUNT(*)::integer as count
         FROM public.whatsapp_chat_states
        WHERE client_id = $1
          AND agent_muted_at >= date_trunc('day', now())
        GROUP BY COALESCE(agent_muted_reason, 'Não especificado')`,
      [clientId]
    );
    const byReason = {};
    let totalToday = 0;
    for (const row of res.rows) {
      byReason[row.reason] = row.count;
      totalToday += row.count;
    }
    return { totalToday, byReason };
  } catch (err) {
    console.warn("[agentMuteGuard] erro ao buscar estatísticas de silenciamento:", err?.message || err);
    return { totalToday: 0, byReason: {} };
  }
}

