// Qual chip enviou cada mensagem de um disparo.
//
// A coluna campaign_dispatch_runs.evolution_instance_id guarda o ID (uuid de lead_client_evolution_instances)
// do chip que de fato enviou — o que o laço de envio tinha na mão naquele instante (rodízio ou chip padrão).
// Nunca o nome, nunca o chip configurado na campanha: se o envio não soube qual chip usou, a coluna fica NULL.
// Quem lê (dashboard) trata NULL como "sem chip registrado", separado dos chips.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O id do chip que enviou, ou null. Só aceita o `instanceId` do chip entregue pelo rodízio/chip padrão e só se
 * for um uuid: nome ou id malformado não é "o chip" — fica NULL em vez de chute (e não derruba o UPDATE).
 */
export function chipIdFromActiveChip(activeChip) {
  const id = typeof activeChip?.instanceId === "string" ? activeChip.instanceId.trim() : "";
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

// Fontes de resolveCampaignDispatchSettings em que o webhook de envio É o de uma instância cadastrada
// (a escolhida na campanha, ou a principal do tenant). Nas demais (config do tenant / URL em cache) o
// webhook não pertence a uma instância conhecida: o chip é desconhecido.
const SETTINGS_SOURCES_WITH_INSTANCE = new Set(["campaign_evolution_instance", "auto_primary_evolution_instance"]);

/**
 * O id da instância dona do webhook com que o disparo envia, ou null. É o chip que de fato envia (o laço usa
 * essa URL), não o "chip configurado" da campanha: se a URL veio de config do tenant, devolve null.
 */
export function chipIdFromDispatchSettings(dispatchSettings) {
  if (!SETTINGS_SOURCES_WITH_INSTANCE.has(dispatchSettings?.source)) return null;
  return chipIdFromActiveChip({ instanceId: dispatchSettings?.selectedEvolutionInstanceId });
}

/**
 * Lembra, por lead, qual chip enviou o último passo. O disparo grava o envio no fim do lead
 * (onLeadDispatched), mas o chip só é conhecido a cada passo (onStepDispatched): este mapa liga os dois.
 *
 * Quem enviou, em ordem: o chip entregue pelo rodízio (`activeChip`), quando o laço tem um; sem rodízio, o
 * chip dono do webhook de envio (`settingsChipId`, de chipIdFromDispatchSettings). Se houve `activeChip` mas
 * sem id válido, NÃO cai no chip das configurações — o `activeChip` é que enviou. Nada disso conhecido → null.
 */
export function createRunChipTracker({ settingsChipId = null } = {}) {
  const byLead = new Map();
  return {
    record(leadId, activeChip) {
      if (!leadId) return;
      byLead.set(String(leadId), activeChip ? chipIdFromActiveChip(activeChip) : settingsChipId);
    },
    /** devolve e esquece; lead que nunca registrou chip devolve null */
    take(leadId) {
      if (!leadId) return null;
      const key = String(leadId);
      const chipId = byLead.get(key) ?? null;
      byLead.delete(key);
      return chipId;
    },
  };
}

// O MESMO UPDATE que marca como enviado grava o chip: um único comando, sem janela entre "enviado" e "por qual chip".
export const FINALIZE_RUN_SENT_SQL = `UPDATE public.campaign_dispatch_runs SET status = 'sent', sent_at = $1, evolution_instance_id = $4::uuid WHERE dispatch_id = $2 AND lead_id = $3`;

export const FINALIZE_RUN_SENT_BY_PHONE_SQL = `UPDATE public.campaign_dispatch_runs SET status = 'sent', sent_at = $1, evolution_instance_id = $4::uuid WHERE dispatch_id = $2 AND regexp_replace(phone, '\\D', '', 'g') = $3`;

export const UPDATE_LEAD_LAST_MESSAGE_SQL = `UPDATE public.leads
   SET last_message_at = $1,
       last_interaction_at = COALESCE(last_interaction_at, $1),
       updated_at = now()
   WHERE client_id = $2
     AND (
       ($3::uuid IS NOT NULL AND id = $3::uuid)
       OR ($4 <> '' AND regexp_replace(COALESCE(telefone, phone), '\\D', '', 'g') = $4)
     )`;

export async function finalizeRunSent(pool, { clientId = null, dispatchId, leadId = null, phone = null, sentAt, chipId = null }) {
  const safeSentAt = sentAt || new Date().toISOString();
  const safeChipId = typeof chipId === "string" && chipId.trim() !== "" ? chipId.trim() : null;

  let result = { rowCount: 0, rows: [] };

  if (leadId) {
    result = await pool.query(FINALIZE_RUN_SENT_SQL, [safeSentAt, dispatchId, leadId, safeChipId]);
  }

  const cleanPhone = typeof phone === "string" ? phone.replace(/\D/g, "") : (phone ? String(phone).replace(/\D/g, "") : "");
  if ((!result || result.rowCount === 0) && cleanPhone) {
    result = await pool.query(FINALIZE_RUN_SENT_BY_PHONE_SQL, [safeSentAt, dispatchId, cleanPhone, safeChipId]);
  }

  const effectiveSentAt = safeSentAt;
  const rawLeadId = (leadId && leadId !== "__crm__") ? String(leadId).trim() : null;
  const effectiveLeadId = rawLeadId && UUID_RE.test(rawLeadId) ? rawLeadId : null;

  if (clientId && (effectiveLeadId || cleanPhone)) {
    await pool.query(
      UPDATE_LEAD_LAST_MESSAGE_SQL,
      [effectiveSentAt, clientId, effectiveLeadId, cleanPhone]
    ).catch((err) => {
      console.warn("[campaign-dispatch] lead stamp failed:", { dispatchId, leadId, phone: cleanPhone, err: err?.message || err });
    });
  }

  return {
    rowCount: result?.rowCount ?? 0,
    rows: result?.rows ?? [],
  };
}
