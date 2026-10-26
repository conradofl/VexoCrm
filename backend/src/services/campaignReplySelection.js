// backend/src/services/campaignReplySelection.js
//
// SPEC 8: Resolução de campanha na resposta do lead & trava de réguas simultâneas.
//
// 1. resolveActiveWaitCampaign:
//    Substitui a seleção arbitrária [0] pela campanha cuja ÚLTIMA mensagem outbound
//    para aquele telefone é a mais recente em `lead_messages`.
//    Se houver divergência entre a campanha avançada e a última campanha outbound geral
//    do telefone, registra o evento de observabilidade `campaign_reply_mismatch`.
//
// 2. findConflictingPendingCampaignLeads:
//    Impede duas réguas vivas no mesmo telefone ao criar lote: se o lead já tiver
//    progresso pendente (status === 'aguardando_usuario') em outra campanha ativa,
//    informa o conflito com nome da campanha para recusa reversível com aviso.
//
// 3. expireStaleCampaignProgress:
//    Rotina periódica de validade de progresso: qualquer progresso em 'aguardando_usuario'
//    sem interação há mais de N dias (padrão 7) é finalizado.

import { buildPhoneLookupVariants, sanitizePhone } from "./leadImport.js";

export function maskPhoneForLog(phone) {
  if (!phone) return "";
  const s = String(phone).replace(/\D/g, "");
  if (s.length <= 4) return "****";
  return s.slice(0, 4) + "****" + s.slice(-4);
}

export function extractCampaignProgress(rawNormalizedData = {}, campaignId = null) {
  const data = rawNormalizedData && typeof rawNormalizedData === "object" ? rawNormalizedData : {};
  const state = data.campaign_progress && typeof data.campaign_progress === "object"
    ? data.campaign_progress
    : {};

  if (!campaignId) return state;
  return state[campaignId] && typeof state[campaignId] === "object" ? state[campaignId] : {};
}

function toComparableTimestamp(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Resolve qual campanha deve ser avançada pela resposta do lead.
 * Critério: A campanha dentre as candidatas (processingWaitForReplyMatches) cuja
 * ÚLTIMA mensagem outbound para aquele telefone é a mais recente.
 *
 * Se nenhuma mensagem for encontrada em `lead_messages` para as candidatas,
 * realiza fallback ordenando pelo timestamp de progresso mais recente.
 *
 * Registra `campaign_reply_mismatch` se a campanha escolhida for diferente da última
 * que enviou mensagem outbound ao lead.
 */
export async function resolveActiveWaitCampaign({
  pool,
  supabase,
  clientId,
  phone,
  processingWaitForReplyMatches = [],
  logFn = null,
}) {
  if (!Array.isArray(processingWaitForReplyMatches) || processingWaitForReplyMatches.length === 0) {
    return null;
  }

  // Se houver apenas 1 candidata e sem conexão a banco para checar mismatch
  if (processingWaitForReplyMatches.length === 1 && !pool && !supabase) {
    return processingWaitForReplyMatches[0];
  }

  const phoneVariants = Array.from(
    new Set([phone, sanitizePhone(phone), ...buildPhoneLookupVariants(phone)].filter(Boolean))
  );

  const candidateIds = processingWaitForReplyMatches.map((c) => c.id).filter(Boolean);
  let chosenCampaign = null;
  let latestOverallOutboundCampaignId = null;

  // 1. Tenta consultar lead_messages via Pool Postgres
  if (pool && clientId && phoneVariants.length > 0) {
    try {
      // Consulta 1: Candidata com outbound mais recente para o telefone
      if (candidateIds.length > 0) {
        const { rows } = await pool.query(
          `SELECT campaign_id, COALESCE(message_timestamp, delivered_at, created_at) AS last_sent_at
           FROM public.lead_messages
           WHERE client_id = $1
             AND phone = ANY($2)
             AND direction = 'outbound'
             AND campaign_id = ANY($3)
           ORDER BY COALESCE(message_timestamp, delivered_at, created_at) DESC
           LIMIT 1`,
          [clientId, phoneVariants, candidateIds]
        );
        if (rows.length > 0 && rows[0].campaign_id) {
          chosenCampaign = processingWaitForReplyMatches.find((c) => c.id === rows[0].campaign_id) || null;
        }
      }

      // Consulta 2: Última campanha outbound geral para observabilidade (Point 4)
      const { rows: overallRows } = await pool.query(
        `SELECT campaign_id
         FROM public.lead_messages
         WHERE client_id = $1
           AND phone = ANY($2)
           AND direction = 'outbound'
           AND campaign_id IS NOT NULL
         ORDER BY COALESCE(message_timestamp, delivered_at, created_at) DESC
         LIMIT 1`,
        [clientId, phoneVariants]
      );
      if (overallRows.length > 0 && overallRows[0].campaign_id) {
        latestOverallOutboundCampaignId = overallRows[0].campaign_id;
      }
    } catch (err) {
      console.warn("[campaignReplySelection] aviso ao consultar lead_messages via pool:", err?.message || err);
    }
  }

  // 2. Se não resolveu via Pool e temos Supabase disponível, tenta via Supabase
  if (!chosenCampaign && supabase && clientId && phoneVariants.length > 0 && candidateIds.length > 0) {
    try {
      const { data: candidateRows } = await supabase
        .from("lead_messages")
        .select("campaign_id, message_timestamp, delivered_at, created_at")
        .eq("client_id", clientId)
        .in("phone", phoneVariants)
        .eq("direction", "outbound")
        .in("campaign_id", candidateIds)
        .order("created_at", { ascending: false })
        .limit(1);

      if (candidateRows && candidateRows.length > 0 && candidateRows[0].campaign_id) {
        chosenCampaign = processingWaitForReplyMatches.find((c) => c.id === candidateRows[0].campaign_id) || null;
      }

      if (!latestOverallOutboundCampaignId) {
        const { data: overallRows } = await supabase
          .from("lead_messages")
          .select("campaign_id, created_at")
          .eq("client_id", clientId)
          .in("phone", phoneVariants)
          .eq("direction", "outbound")
          .not("campaign_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1);
        if (overallRows && overallRows.length > 0 && overallRows[0].campaign_id) {
          latestOverallOutboundCampaignId = overallRows[0].campaign_id;
        }
      }
    } catch (err) {
      console.warn("[campaignReplySelection] aviso ao consultar lead_messages via supabase:", err?.message || err);
    }
  }

  // 3. Fallback: Se lead_messages não registrou disparo dessas campanhas (ou testes mockados),
  // escolhe a candidata com progresso/trigger mais recente
  if (!chosenCampaign) {
    const sorted = [...processingWaitForReplyMatches].sort((a, b) => {
      const progA = a.leadImportItem?.progress || {};
      const progB = b.leadImportItem?.progress || {};
      const timeA = toComparableTimestamp(progA.updatedAt || progA.updated_at || progA.sentAt || a.lastTriggeredAt || a.scheduledFor);
      const timeB = toComparableTimestamp(progB.updatedAt || progB.updated_at || progB.sentAt || b.lastTriggeredAt || b.scheduledFor);
      return timeB - timeA;
    });
    chosenCampaign = sorted[0] || processingWaitForReplyMatches[0];
  }

  // 4. Observabilidade (SPEC 8 - Item 4): campaign_reply_mismatch
  // Quando uma resposta avançar campanha diferente da última que enviou ao lead, registrar o aviso
  if (
    latestOverallOutboundCampaignId &&
    chosenCampaign &&
    chosenCampaign.id !== latestOverallOutboundCampaignId
  ) {
    const mismatchDetails = {
      clientId,
      phone: maskPhoneForLog(phone),
      advancedCampaignId: chosenCampaign.id,
      advancedCampaignName: chosenCampaign.name || null,
      latestOutboundCampaignId: latestOverallOutboundCampaignId,
    };
    console.warn(
      `[campaign_reply_mismatch] Resposta avançou campanha '${chosenCampaign.id}' (${chosenCampaign.name || "sem nome"}), diferente da última que enviou ao lead ('${latestOverallOutboundCampaignId}').`,
      mismatchDetails
    );
    if (typeof logFn === "function") {
      logFn("warn", "campaign_reply_mismatch", mismatchDetails);
    }
  }

  return chosenCampaign;
}

/**
 * SPEC 8 - Item 2: Impedir duas réguas vivas no mesmo telefone.
 * Verifica se algum dos leads alvo de um novo lote possui progresso pendente
 * ('aguardando_usuario') em OUTRA campanha ativa.
 *
 * Retorna { hasConflict: boolean, conflictingLead: {...}, conflictingCampaign: {...} }
 */
export async function findConflictingPendingCampaignLeads({
  pool,
  supabase,
  clientId,
  campaignId,
  targetLeads = [],
}) {
  if (!Array.isArray(targetLeads) || targetLeads.length === 0) {
    return { hasConflict: false };
  }

  // 1. Verificação em memória dos dados dos leads (normalized_data.campaign_progress)
  for (const lead of targetLeads) {
    const progressMap = extractCampaignProgress(lead.normalized_data || {});
    for (const [cId, prog] of Object.entries(progressMap)) {
      if (cId !== campaignId && prog && prog.status === "aguardando_usuario") {
        // Encontrou conflito em memória
        let campName = prog.campaignName || null;
        if (!campName && pool) {
          try {
            const { rows } = await pool.query(
              `SELECT name FROM public.campaigns WHERE id = $1 AND client_id = $2`,
              [cId, clientId]
            );
            if (rows.length > 0) campName = rows[0].name;
          } catch {}
        }
        if (!campName && supabase) {
          try {
            const { data } = await supabase
              .from("campaigns")
              .select("name")
              .eq("id", cId)
              .eq("client_id", clientId)
              .maybeSingle();
            if (data?.name) campName = data.name;
          } catch {}
        }

        return {
          hasConflict: true,
          conflictingLead: {
            id: lead.id,
            phone: lead.telefone || lead.phone || null,
            nome: lead.nome || lead.normalized_data?.nome || null,
          },
          conflictingCampaign: {
            id: cId,
            name: campName || cId,
          },
        };
      }
    }
  }

  // 2. Verificação no banco de dados via Pool Postgres para o conjunto de telefones dos leads
  if (pool && clientId) {
    const phones = Array.from(
      new Set(
        targetLeads
          .map((l) => sanitizePhone(l.telefone || l.phone))
          .filter(Boolean)
      )
    );

    if (phones.length > 0) {
      try {
        const { rows } = await pool.query(
          `SELECT lii.id, lii.telefone, c.id AS campaign_id, c.name AS campaign_name
           FROM public.lead_import_items lii
           CROSS JOIN LATERAL jsonb_each(lii.normalized_data->'campaign_progress') AS p(key, val)
           JOIN public.campaigns c ON c.id::text = key AND c.client_id = lii.client_id AND c.archived_at IS NULL
           WHERE lii.client_id = $1
             AND lii.telefone = ANY($2)
             AND key <> $3
             AND val->>'status' = 'aguardando_usuario'
           LIMIT 1`,
          [clientId, phones, String(campaignId)]
        );

        if (rows.length > 0) {
          return {
            hasConflict: true,
            conflictingLead: {
              id: rows[0].id,
              phone: rows[0].telefone,
              nome: null,
            },
            conflictingCampaign: {
              id: rows[0].campaign_id,
              name: rows[0].campaign_name || rows[0].campaign_id,
            },
          };
        }
      } catch (err) {
        console.warn("[campaignReplySelection] aviso ao verificar conflitos no pool:", err?.message || err);
      }
    }
  }

  return { hasConflict: false };
}

/**
 * SPEC 8 - Item 3: Prazo de validade do progresso.
 * Transiciona progressos em 'aguardando_usuario' estagnados há mais de `ttlDays` dias
 * (padrão 7 dias) para status 'finalizado'.
 */
export async function expireStaleCampaignProgress(pool, { ttlDays = 7, limit = 200 } = {}) {
  if (!pool) return { expiredCount: 0, items: [] };

  try {
    // Busca itens com progresso em aguardando_usuario mais antigo que ttlDays
    const { rows: staleItems } = await pool.query(
      `SELECT lii.id, lii.client_id, lii.telefone, lii.normalized_data
       FROM public.lead_import_items lii
       CROSS JOIN LATERAL jsonb_each(lii.normalized_data->'campaign_progress') AS p(key, val)
       WHERE val->>'status' = 'aguardando_usuario'
         AND COALESCE(
           NULLIF(val->>'updatedAt', '')::timestamptz,
           NULLIF(val->>'updated_at', '')::timestamptz,
           NULLIF(val->>'lastReplyAt', '')::timestamptz,
           NULLIF(val->>'dispatchedAt', '')::timestamptz,
           lii.ultima_interacao_bot,
           lii.created_at
         ) < NOW() - ($1 || ' days')::interval
       LIMIT $2`,
      [ttlDays, limit]
    );

    if (!staleItems || staleItems.length === 0) {
      return { expiredCount: 0, items: [] };
    }

    const nowIso = new Date().toISOString();
    const expiredDetails = [];

    for (const item of staleItems) {
      const norm = item.normalized_data || {};
      const campProgress = { ...(norm.campaign_progress || {}) };
      let updated = false;

      for (const [cId, prog] of Object.entries(campProgress)) {
        if (prog && prog.status === "aguardando_usuario") {
          const ts = prog.updatedAt || prog.updated_at || prog.lastReplyAt || prog.dispatchedAt;
          const time = ts ? new Date(ts).getTime() : 0;
          const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
          if (time === 0 || time < cutoff) {
            campProgress[cId] = {
              ...prog,
              status: "finalizado",
              leadStatus: "expirado_inatividade_7d",
              completedAt: nowIso,
              expiredReason: "timeout_7d",
              updatedAt: nowIso,
            };
            updated = true;
            expiredDetails.push({
              leadImportItemId: item.id,
              clientId: item.client_id,
              campaignId: cId,
              phone: maskPhoneForLog(item.telefone),
            });
          }
        }
      }

      if (updated) {
        await pool.query(
          `UPDATE public.lead_import_items
           SET normalized_data = $1
           WHERE id = $2 AND client_id = $3`,
          [{ ...norm, campaign_progress: campProgress }, item.id, item.client_id]
        );
      }
    }

    if (expiredDetails.length > 0) {
      console.log(
        `[campaign-progress-ttl] ${expiredDetails.length} progresso(s) de campanha expirado(s) por inatividade (> ${ttlDays} dias):`,
        expiredDetails
      );
    }

    return { expiredCount: expiredDetails.length, items: expiredDetails };
  } catch (err) {
    console.error("[campaign-progress-ttl] erro ao expirar progressos estagnados:", err?.message || err);
    return { expiredCount: 0, error: err?.message || err };
  }
}
