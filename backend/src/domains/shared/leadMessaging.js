import { buildPhoneLookupVariants, sanitizePhone } from "../../services/leadImport.js";
import { supabase as liveSupabase, pgDatabasePool } from "../../services/database.js";
import { maskPhoneForLog } from "../../services/tenant.js";
import { resolveInstanceIdentifier } from "../../services/evolution.js";

import { isGroupJid } from "../../services/inboundGuard.js";
export { isGroupJid };

/**
 * Factory: recebe as deps que appendLeadMessage/maskSecretPresence capturavam via
 * closure do destructure de routeDeps dentro de registerAllDomainRoutes (supabase,
 * normalizeString, leadsTableName, isMissingSchemaError) e retorna as duas funções
 * prontas para uso pelos call sites, sem exigir mudança nesses call sites.
 *
 * NOTA DE RESILIÊNCIA: Se a factory for chamada no topo de módulo antes do initDatabase(),
 * a closure captura o live-binding liveSupabase dinamicamente na chamada.
 */
export function createLeadMessaging({
  supabase: injectedSupabase,
  pool: injectedPool,
  pgDatabasePool: injectedPgPool,
  normalizeString,
  leadsTableName,
  isMissingSchemaError,
}) {
  function maskSecretPresence(value) {
    return Boolean(normalizeString ? normalizeString(value) : value);
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
    instanceName = null,
    waMessageId = null,
    messageTimestamp = null,
    mediaPath = null,
    mediaUrl = null,
    media_url = null,
    contentType = null,
    content_type = null,
  }) {
    const supabase = injectedSupabase || liveSupabase;
    if (!supabase) {
      console.error("[lead-messages] ERRO CRÍTICO: appendLeadMessage chamado sem cliente Supabase/Postgres ativo", {
        clientId,
        phone: maskPhoneForLog(phone),
        direction,
      });
      throw new Error("[lead-messages] Conexão com banco de dados indisponível no appendLeadMessage");
    }

    if (!clientId || !phone) {
      console.error("[lead-messages] ERRO CRÍTICO: appendLeadMessage chamado sem clientId ou phone obrigatórios", {
        clientId,
        phone: maskPhoneForLog(phone),
      });
      return null;
    }

    const normalizedMessage = normalizeString ? normalizeString(messageText) : String(messageText || "").trim();
    if (!normalizedMessage) return null;

    const isJid = String(phone).includes("@");
    const canonicalPhone = isJid ? phone : (sanitizePhone(phone) || phone);
    const phoneVariants = isJid
      ? [phone]
      : Array.from(new Set([phone, canonicalPhone, ...buildPhoneLookupVariants(phone)].filter(Boolean)));

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
          .in("telefone", phoneVariants)
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
          .in("phone", phoneVariants)
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

    let canonicalInstanceName = instanceName || null;
    if (canonicalInstanceName) {
      try {
        const { canonicalName } = await resolveInstanceIdentifier({
          clientId,
          identifier: canonicalInstanceName,
        });
        if (canonicalName) canonicalInstanceName = canonicalName;
      } catch (err) {
        // Fallback seguro mantendo o identificador recebido se falhar
      }
    }

    const resolvedMediaUrl = mediaUrl || media_url || null;
    const resolvedContentType = contentType || content_type || (resolvedMediaUrl ? "image" : null);

    const payload = {
      client_id: clientId,
      lead_id: resolvedLeadId,
      campaign_id: resolvedCampaignId,
      phone: canonicalPhone,
      sender_type: senderType,
      direction,
      engagement_signal: engagementSignal,
      message_text: normalizedMessage,
      delivered_at: deliveredAt || new Date().toISOString(),
      message_timestamp: messageTimestamp || deliveredAt || new Date().toISOString(),
      meta: {
        ...(meta && typeof meta === "object" ? meta : {}),
        ...(resolvedMediaUrl ? { mediaUrl: resolvedMediaUrl, media_url: resolvedMediaUrl } : {}),
        ...(resolvedContentType ? { contentType: resolvedContentType, content_type: resolvedContentType } : {}),
      },
      instance_name: canonicalInstanceName || instanceName || null,
      wa_message_id: waMessageId || null,
      media_path: mediaPath || null,
      media_url: resolvedMediaUrl,
      content_type: resolvedContentType,
    };

    let { error } = await supabase.from("lead_messages").insert(payload);

    // Se falhar por colunas media_url / content_type inexistentes, tenta sem elas
    if (error && (String(error.message).includes("media_url") || String(error.message).includes("content_type"))) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.media_url;
      delete fallbackPayload.content_type;
      const retryRes = await supabase.from("lead_messages").insert(fallbackPayload);
      error = retryRes.error;
    }

    // Se falhar por coluna media_path inexistente, tenta sem ela
    if (error && String(error.message).includes("media_path")) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.media_path;
      delete fallbackPayload.media_url;
      delete fallbackPayload.content_type;
      const retryRes = await supabase.from("lead_messages").insert(fallbackPayload);
      error = retryRes.error;
    }

    // Se falhar por coluna message_timestamp inexistente, tenta sem ela
    if (error && String(error.message).includes("message_timestamp")) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.message_timestamp;
      delete fallbackPayload.media_path;
      delete fallbackPayload.media_url;
      delete fallbackPayload.content_type;
      const retryRes = await supabase.from("lead_messages").insert(fallbackPayload);
      error = retryRes.error;
    }

    // Se falhar por FK (23503) em campaign_id (ex.: campanha excluída ou id de outra tabela),
    // tenta novamente com campaign_id: null para não perder a gravação da mensagem
    let finalCampaignId = resolvedCampaignId;
    if (error && resolvedCampaignId && (error.code === "23503" || String(error.message).includes("foreign key"))) {
      console.warn(`[lead-messages] campaign_id '${resolvedCampaignId}' violou FK (tabela campaigns); gravando com campaign_id=null.`);
      finalCampaignId = null;
      const retryPayload = { ...payload, campaign_id: null };
      const retryResult = await supabase.from("lead_messages").insert(retryPayload);
      error = retryResult.error;
    }

    // Se for conflito de chave única (23505) em wa_message_id, é duplicata esperada: ignora
    if (error && (error.code === "23505" || String(error.message).includes("idx_lead_messages_wa_message_id"))) {
      console.info(`[lead-messages] wa_message_id '${waMessageId}' duplicado; insert ignorado com sucesso.`);
      error = null;
    }

    const pool = injectedPool || injectedPgPool || pgDatabasePool;

    // Se o cliente Supabase PostgREST falhar, tenta gravação direta no PostgreSQL
    if (error && pool) {
      try {
        await pool.query(
          `INSERT INTO public.lead_messages (
            client_id, lead_id, campaign_id, phone, sender_type, direction,
            engagement_signal, message_text, delivered_at, message_timestamp,
            meta, instance_name, wa_message_id, media_path, media_url, content_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          ON CONFLICT (wa_message_id) DO UPDATE SET
            media_url = COALESCE(EXCLUDED.media_url, public.lead_messages.media_url),
            content_type = COALESCE(EXCLUDED.content_type, public.lead_messages.content_type),
            meta = public.lead_messages.meta || EXCLUDED.meta;`,
          [
            clientId,
            resolvedLeadId,
            finalCampaignId,
            canonicalPhone,
            senderType,
            direction,
            engagementSignal,
            normalizedMessage,
            payload.delivered_at,
            payload.message_timestamp,
            JSON.stringify(payload.meta || {}),
            canonicalInstanceName || instanceName || null,
            waMessageId || null,
            mediaPath || null,
            resolvedMediaUrl,
            resolvedContentType,
          ]
        );
        error = null;
      } catch (directInsertErr) {
        // Segue para logging se ambas tentativas falharem
      }
    }

    // Garante que media_url e content_type estejam diretamente gravados no PostgreSQL caso o PostgREST tenha ignorado ou sofrido atraso de schema cache
    if (pool && resolvedMediaUrl) {
      try {
        if (waMessageId) {
          await pool.query(
            `UPDATE public.lead_messages
             SET media_url = COALESCE(media_url, $1),
                 content_type = COALESCE(content_type, $2),
                 meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('mediaUrl', $1::text, 'media_url', $1::text, 'contentType', $2::text, 'content_type', $2::text)
             WHERE wa_message_id = $3`,
            [resolvedMediaUrl, resolvedContentType, waMessageId]
          );
        } else {
          await pool.query(
            `UPDATE public.lead_messages
             SET media_url = COALESCE(media_url, $1),
                 content_type = COALESCE(content_type, $2),
                 meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('mediaUrl', $1::text, 'media_url', $1::text, 'contentType', $2::text, 'content_type', $2::text)
             WHERE client_id = $3 AND phone = $4 AND direction = $5 AND delivered_at = $6`,
            [resolvedMediaUrl, resolvedContentType, clientId, canonicalPhone, direction, payload.delivered_at]
          );
        }
      } catch {
        // Best effort
      }
    }

    if (error && (!isMissingSchemaError || !isMissingSchemaError(error))) {
      console.error("[lead-messages] ERRO CRÍTICO ao gravar mensagem em lead_messages:", error.message || error, {
        clientId,
        phone: maskPhoneForLog(canonicalPhone),
        direction,
        senderType,
        campaignId: finalCampaignId,
      });
    }

    // Marca o lead como "respondeu": grava ultima_interacao_usuario no momento do inbound.
    // Casa por telefone (robusto ao id-space). Best-effort: nunca derruba o webhook.
    if (direction === "inbound") {
      try {
        await supabase
          .from(leadsTableName(clientId))
          .update({ ultima_interacao_usuario: deliveredAt || new Date().toISOString() })
          .eq("client_id", clientId)
          .in("telefone", phoneVariants);
      } catch (updateError) {
        console.warn("[lead-messages] ultima_interacao_usuario update failed:", updateError?.message || updateError);
      }
    }

    return { leadId: resolvedLeadId, campaignId: finalCampaignId };
  }

  return { appendLeadMessage, maskSecretPresence };
}
