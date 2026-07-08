// backend/src/domains/shared/leadMessaging.js
// Cross-domain helpers extraidos de registerAllDomainRoutes.js (movimento puro):
// isGroupJid (pura, sem deps) + createLeadMessaging factory (appendLeadMessage,
// maskSecretPresence) para os domínios que dependem de leads/whatsapp/campaigns.

/**
 * Detecta JID de GRUPO / broadcast no inbound da Evolution. Resposta de lead legítima
 * vem SEMPRE de número individual (@s.whatsapp.net); grupo (@g.us) nunca é lead.
 * IMPORTANTE: receber o remoteJid CRU (antes de sanitizePhone, que stripa o "@g.us").
 * Regra (conservadora p/ não descartar individual): @g.us | @broadcast | user-part com
 * hífen (formato legado phone-timestamp) | user-part numérico > 15 dígitos (ids de grupo
 * têm 18+; individual BR ≤ 13).
 */
export function isGroupJid(rawJid) {
  const s = String(rawJid ?? "").trim().toLowerCase();
  if (!s) return false;
  if (s.includes("@g.us")) return true;
  if (s.includes("@broadcast")) return true;
  const userPart = s.split("@")[0];
  if (userPart.includes("-")) return true;
  const digits = userPart.replace(/\D/g, "");
  if (digits.length > 15) return true;
  return false;
}

/**
 * Factory: recebe as deps que appendLeadMessage/maskSecretPresence capturavam via
 * closure do destructure de routeDeps dentro de registerAllDomainRoutes (supabase,
 * normalizeString, leadsTableName, isMissingSchemaError) e retorna as duas funções
 * prontas para uso pelos call sites, sem exigir mudança nesses call sites.
 */
export function createLeadMessaging({ supabase, normalizeString, leadsTableName, isMissingSchemaError }) {
  function maskSecretPresence(value) {
    return Boolean(normalizeString(value));
  }

  // Janela de atribuição de resposta → disparo (ajustável). Um inbound é vinculado ao
  // disparo com status='sent' mais recente daquele telefone DENTRO desta janela.
  const DISPATCH_ATTRIBUTION_WINDOW_DAYS = 14;

  async function appendLeadMessage({
    clientId,
    phone,
    senderType,
    direction,
    messageText,
    engagementSignal = null,
    campaignId = null,
    leadId = null,
    deliveredAt = null,
    meta = null,
  }) {
    if (!supabase || !clientId || !phone) return null;

    const normalizedMessage = normalizeString(messageText);
    if (!normalizedMessage) return null;

    // REGRA DE CANONIZAÇÃO: lead_id = SEMPRE o lead do CRM do tenant (leads.id da tabela
    // leadsTableName), nunca lead_import_items.id. campaign_id carrega a atribuição de
    // campanha (inequívoco, é o que o Dashboard usa) e PODE vir do disparo.
    let resolvedLeadId = leadId || null;
    let resolvedCampaignId = campaignId || null;

    if (!resolvedLeadId || !resolvedCampaignId) {
      try {
        const { data: leadRow, error: leadLookupError } = await supabase
          .from(leadsTableName(clientId))
          .select("id, source_campaign_id")
          .eq("client_id", clientId)
          .eq("telefone", phone)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!leadLookupError && leadRow) {
          resolvedLeadId = resolvedLeadId || leadRow.id || null;
          resolvedCampaignId = resolvedCampaignId || leadRow.source_campaign_id || null;
        }
      } catch (error) {
        console.warn("[lead-messages] lead lookup failed:", error?.message || error);
      }
    }

    // Atribuição de CAMPANHA por disparo: para inbound ainda sem campanha, casa pelo
    // disparo (campaign_dispatch_runs status='sent') mais recente daquele telefone,
    // dentro da janela. Preenche SÓ campaign_id — NÃO lead_id (runRow.lead_id é
    // lead_import_items.id, id-space errado). Fallback gracioso: nada casar → NULL.
    if (direction === "inbound" && !resolvedCampaignId) {
      try {
        const windowStartIso = new Date(
          Date.now() - DISPATCH_ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000
        ).toISOString();
        const { data: runRow, error: runError } = await supabase
          .from("campaign_dispatch_runs")
          .select("campaign_id, dispatch_id, sent_at, created_at")
          .eq("client_id", clientId)
          .eq("phone", phone)
          .eq("status", "sent")
          .gte("created_at", windowStartIso)
          .order("sent_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!runError && runRow) {
          resolvedCampaignId = resolvedCampaignId || runRow.campaign_id || null;
        }
      } catch (error) {
        console.warn("[lead-messages] dispatch attribution lookup failed:", error?.message || error);
      }
    }

    const { error } = await supabase.from("lead_messages").insert({
      client_id: clientId,
      lead_id: resolvedLeadId,
      campaign_id: resolvedCampaignId,
      phone,
      sender_type: senderType,
      direction,
      engagement_signal: engagementSignal,
      message_text: normalizedMessage,
      delivered_at: deliveredAt || new Date().toISOString(),
      meta: meta && typeof meta === "object" ? meta : {},
    });

    if (error && !isMissingSchemaError(error)) {
      console.warn("[lead-messages] insert failed:", error.message || error);
    }

    // Marca o lead como "respondeu": grava ultima_interacao_usuario no momento do inbound.
    // Casa por telefone (robusto ao id-space). Best-effort: nunca derruba o webhook.
    if (direction === "inbound") {
      try {
        await supabase
          .from(leadsTableName(clientId))
          .update({ ultima_interacao_usuario: deliveredAt || new Date().toISOString() })
          .eq("client_id", clientId)
          .eq("telefone", phone);
      } catch (updateError) {
        console.warn("[lead-messages] ultima_interacao_usuario update failed:", updateError?.message || updateError);
      }
    }

    return { leadId: resolvedLeadId, campaignId: resolvedCampaignId };
  }

  return { appendLeadMessage, maskSecretPresence };
}
