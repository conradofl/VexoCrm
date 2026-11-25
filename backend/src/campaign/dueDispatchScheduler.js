// Agendador dos lotes (campaign_dispatches) — saiu de domains/campaigns/routes.js no untangle (25/11/2026).
//
// Antes: runDueIndependentDispatches morava dentro de registerCampaignsRoutes e o setInterval de 30 s nascia como efeito
// colateral do registro das rotas (server.js importava a rota só para pará-lo). Agora:
//   - createDueDispatchRunner(deps): fábrica; o corpo de runDueIndependentDispatches é o MESMO, byte a byte. O que era
//     variável do registro de rotas entra por injeção (as funções locais das rotas: motor, trava de chip, ocorrências).
//   - startDueDispatchScheduler / stopDueDispatchScheduler: o server.js liga e desliga, explícito.
// Movimento puro: nenhuma regra de quando ou como um lote roda mudou.
import { getPartsInTimezone, resolveSendWindowConfig, getNextSendWindowOpening, isWithinSendWindow } from "../services/sendWindow.js";
import { QUOTA_PAUSE_MARKER } from "../services/campaignQuotaGate.js";
import { PAUSE_REASON, pauseReasonOf, isAutoResumablePause } from "../services/pauseReason.js";
import { resumeDeferredQueues } from "./queueResume.js";
import { resolveEvolutionInstanceDailyLimit, getEvolutionInstanceDailyUsage } from "../services/chipQuota.js";
import { normalizeCampaignAnalyticsMeta, getCampaignStepPlan, countBurstSteps } from "../campaign-outbound.js";
import { getDateKey } from "../services/analytics.js";
import { findConcurrentRunningDispatch } from "../services/campaignRecurrenceOccurrences.js";
import { describeChipBusyForScheduler } from "./chipDispatchLock.js";
import { syncDailyStalledNotificationsForAllTenants } from "../services/leadReactivationEngine.js";

let _dueDispatchTimerStarted = false;
let _dueDispatchInterval = null;
let _lastEmptyHeartbeatAt = 0;
// Prova no /health de que o tick está vivo (o momento em que ele liga mudou nesta extração).
let _ligadoEm = null;
let _ultimoTickEm = null;
let _ticks = 0;

/** Só datas e contagem: { ligado, ligadoEm, ultimoTickEm, ticks }. */
export function getDueDispatchSchedulerStatus() {
  return { ligado: Boolean(_dueDispatchInterval), ligadoEm: _ligadoEm, ultimoTickEm: _ultimoTickEm, ticks: _ticks };
}

export function resetSchedulerHeartbeatForTest() {
  _lastEmptyHeartbeatAt = 0;
}

export function stopDueDispatchScheduler() {
  if (_dueDispatchInterval) {
    clearInterval(_dueDispatchInterval);
    _dueDispatchInterval = null;
    _dueDispatchTimerStarted = false;
    _lastEmptyHeartbeatAt = 0;
    _ligadoEm = null;
    console.log("[campaign-dispatch-scheduler] scheduler de disparos avulsos parado.");
  }
}

/**
 * @param deps { supabase, pgDatabasePool, getLeadClientN8nSettings, runCampaignDispatch, resolveSendingInstance,
 *               reservarChipDoLote, liberarChipDoLote, materializeRecurringOccurrences }
 * @returns runDueIndependentDispatches({ limit })
 */
export function createDueDispatchRunner(deps) {
  const {
    supabase,
    pgDatabasePool,
    getLeadClientN8nSettings,
    runCampaignDispatch,
    resolveSendingInstance,
    reservarChipDoLote,
    liberarChipDoLote,
    materializeRecurringOccurrences,
  } = deps;

  async function runDueIndependentDispatches({ limit = 50 } = {}) {
    if (!supabase) return { success: false, processed: 0, reason: "DATABASE_NOT_CONFIGURED" };

    let recurrence = null;
    try {
      recurrence = await materializeRecurringOccurrences();
    } catch (err) {
      console.error("[campaign-recurrence] falha ao materializar ocorrencias:", err);
    }

    // Filas de resposta adiadas por um freio (janela fechada, cota do chip esgotada): retoma as que já podem tentar de novo.
    // Falha aqui nunca derruba o agendador de lotes.
    try {
      await resumeDeferredQueues({ pool: pgDatabasePool });
    } catch (err) {
      console.error("[campaign-queue] falha ao retomar filas adiadas:", err);
    }

    const now = new Date().toISOString();

    try {
      // 1. Prioriza lotes com status = 'scheduled' (evita Head-of-Line Blocking causado por lotes paused antigos)
      const { data: scheduledDispatches, error: scheduledErr } = await supabase
        .from("campaign_dispatches")
        .select("id, campaign_id, client_id, name, steps, trigger_type, scheduled_at, status, evolution_instance_id, limit_per_run, offset, target_count, error_message")
        .eq("status", "scheduled")
        .lte("scheduled_at", now)
        .order("scheduled_at", { ascending: true })
        .limit(limit);

      if (scheduledErr) throw scheduledErr;

      let dispatches = Array.isArray(scheduledDispatches) ? [...scheduledDispatches] : [];

      // 2. Se ainda houver vagas até o limite do tick (50), busca lotes 'paused' que sejam retomáveis automaticamente
      const remainingLimit = limit - dispatches.length;
      if (remainingLimit > 0) {
        let pausedQuery = supabase
          .from("campaign_dispatches")
          .select("id, campaign_id, client_id, name, steps, trigger_type, scheduled_at, status, evolution_instance_id, limit_per_run, offset, target_count, error_message")
          .eq("status", "paused")
          .lte("scheduled_at", now)
          .order("scheduled_at", { ascending: true });

        // Pré-filtro no banco pelo texto: equivale a pause_reason (coluna gerada desse texto, migration
        // 20261125030000). A decisão de retomar é de isAutoResumablePause, logo abaixo.
        if (typeof pausedQuery.or === "function") {
          pausedQuery = pausedQuery.or(`error_message.ilike.%fora da janela de envio%,error_message.ilike.%${QUOTA_PAUSE_MARKER}%`);
        }

        const { data: pausedDispatches, error: pausedErr } = await pausedQuery.limit(limit);

        if (pausedErr) throw pausedErr;

        if (Array.isArray(pausedDispatches) && pausedDispatches.length > 0) {
          // Filtra em memória para garantir exclusão de lotes pausados manualmente ou não-retomáveis
          const resumablePaused = pausedDispatches.filter((d) => isAutoResumablePause(d));
          dispatches.push(...resumablePaused.slice(0, remainingLimit));
        }
      }

      const dueCount = dispatches ? dispatches.length : 0;
      if (dueCount === 0) {
        const nowMs = Date.now();
        // Não poluir: no máximo uma linha a cada 10 minutos quando não houver nada vencido
        if (nowMs - _lastEmptyHeartbeatAt >= 10 * 60 * 1000) {
          _lastEmptyHeartbeatAt = nowMs;
          console.log(`[campaign-dispatch-scheduler] heartbeat (pid=${process.pid}): 0 lotes vencidos encontrados, 0 processados`);
        }
        return { success: true, processed: 0, items: [], skipped: [], recurrence };
      }

      const results = [];
      const skipped = [];
      const campaignCache = new Map();

      for (const dispatch of dispatches) {
        try {
          // Obtém dados da campanha mãe (com cache no tick para evitar queries repetidas)
          let campaign = campaignCache.get(dispatch.campaign_id);
          if (!campaign) {
            const { data: campData, error: campErr } = await supabase
              .from("campaigns")
              .select("id, name, client_id, import_id, limit_per_run, analytics_meta, webhook_url, webhook_token, status, archived_at")
              .eq("id", dispatch.campaign_id)
              .single();

            if (campErr || !campData) {
              throw new Error(campErr?.message || "Campaign not found");
            }
            campaign = campData;
            campaignCache.set(dispatch.campaign_id, campaign);
          }

          // Lotes de campanhas cujo status mãe seja paused, cancelled ou arquivada devem ser desconsiderados
          const campStatus = String(campaign.status || "").toLowerCase().trim();
          const isMotherCampaignInactive =
            Boolean(campaign.archived_at) ||
            ["paused", "pausada", "cancelled", "cancelada", "archived", "arquivada"].includes(campStatus);

          if (isMotherCampaignInactive) {
            const reason = `Campanha mãe está inativa (${campaign.archived_at ? "arquivada" : campStatus})`;
            console.log(`[campaign-dispatch-scheduler] pulando lote ${dispatch.id} (${dispatch.name || "sem nome"}): ${reason}`);
            skipped.push({
              id: dispatch.id,
              campaignId: dispatch.campaign_id,
              name: dispatch.name,
              status: dispatch.status,
              reason,
              code: "CAMPAIGN_INACTIVE",
            });
            continue;
          }

          let resumingFromQuota = false;
          if (dispatch.status === "paused") {
            const motivoPausa = pauseReasonOf(dispatch);
            const isSendWindowPause = motivoPausa === PAUSE_REASON.FORA_DA_JANELA;
            const isQuotaPause = motivoPausa === PAUSE_REASON.COTA_CHIP;

            if (!isSendWindowPause && !isQuotaPause) {
              const reason = `Lote pausado por motivo não retomável automaticamente: ${dispatch.error_message || "sem mensagem de erro"}`;
              console.log(`[campaign-dispatch-scheduler] pulando lote ${dispatch.id} (${dispatch.name || "sem nome"}): ${reason}`);
              skipped.push({
                id: dispatch.id,
                campaignId: dispatch.campaign_id,
                name: dispatch.name,
                status: dispatch.status,
                reason,
                code: "PAUSED_NON_RESUMABLE",
              });
              continue;
            }

            const tenantSettings = await getLeadClientN8nSettings(dispatch.client_id);
            const sendWindowConfig = resolveSendWindowConfig(tenantSettings);

            // Verifica se está dentro da janela de envio permitida do tenant
            if (!isWithinSendWindow(new Date(), sendWindowConfig)) {
              const localParts = getPartsInTimezone(new Date(), sendWindowConfig.timezone);
              const nextOpeningDate = getNextSendWindowOpening(new Date(), sendWindowConfig);
              const nextOpeningParts = getPartsInTimezone(nextOpeningDate, sendWindowConfig.timezone);
              const nextOpeningStr = `${nextOpeningParts.timeString} (${nextOpeningParts.day}/${nextOpeningParts.month})`;
              const daysStr = sendWindowConfig.days.join(",");
              const windowStr = `${sendWindowConfig.start}–${sendWindowConfig.end} [${daysStr}] (${sendWindowConfig.timezone})`;
              const reason = `Fora da janela de envio: horário local ${localParts.timeString}, janela ${windowStr}, próxima abertura prevista para ${nextOpeningStr}`;
              console.log(`[campaign-dispatch-scheduler] pulando lote ${dispatch.id} (${dispatch.name || "sem nome"}): ${reason}`);

              const dbReason = `Pausado — fora da janela de envio (${sendWindowConfig.start}–${sendWindowConfig.end}). Retomará na próxima janela (abre ${nextOpeningStr}).`;
              const nextOpeningIso = nextOpeningDate.toISOString();
              if (dispatch.error_message !== dbReason || dispatch.scheduled_at !== nextOpeningIso) {
                await supabase
                  .from("campaign_dispatches")
                  .update({
                    error_message: dbReason,
                    scheduled_at: nextOpeningIso,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", dispatch.id);
                dispatch.error_message = dbReason;
                dispatch.scheduled_at = nextOpeningIso;
              }

              skipped.push({
                id: dispatch.id,
                campaignId: dispatch.campaign_id,
                name: dispatch.name,
                status: dispatch.status,
                reason,
                code: "OUTSIDE_SEND_WINDOW",
                localTime: localParts.timeString,
                sendWindow: windowStr,
                nextOpening: nextOpeningDate.toISOString(),
              });
              continue;
            }

            resumingFromQuota = isQuotaPause;
          } else {
            const tenantSettings = await getLeadClientN8nSettings(dispatch.client_id);
            const sendWindowConfig = resolveSendWindowConfig(tenantSettings);

            // Verifica se está dentro da janela de envio permitida do tenant
            if (!isWithinSendWindow(new Date(), sendWindowConfig)) {
              const localParts = getPartsInTimezone(new Date(), sendWindowConfig.timezone);
              const nextOpeningDate = getNextSendWindowOpening(new Date(), sendWindowConfig);
              const nextOpeningParts = getPartsInTimezone(nextOpeningDate, sendWindowConfig.timezone);
              const nextOpeningStr = `${nextOpeningParts.timeString} (${nextOpeningParts.day}/${nextOpeningParts.month})`;
              const daysStr = sendWindowConfig.days.join(",");
              const windowStr = `${sendWindowConfig.start}–${sendWindowConfig.end} [${daysStr}] (${sendWindowConfig.timezone})`;
              const reason = `Fora da janela de envio: horário local ${localParts.timeString}, janela ${windowStr}, próxima abertura prevista para ${nextOpeningStr}`;
              console.log(`[campaign-dispatch-scheduler] pulando lote ${dispatch.id} (${dispatch.name || "sem nome"}): ${reason}`);

              const dbReason = `Aguardando janela de envio (${sendWindowConfig.start}–${sendWindowConfig.end}, abre ${nextOpeningStr})`;
              const nextOpeningIso = nextOpeningDate.toISOString();
              if (dispatch.error_message !== dbReason || dispatch.scheduled_at !== nextOpeningIso) {
                await supabase
                  .from("campaign_dispatches")
                  .update({
                    error_message: dbReason,
                    scheduled_at: nextOpeningIso,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", dispatch.id);
                dispatch.error_message = dbReason;
                dispatch.scheduled_at = nextOpeningIso;
              }

              skipped.push({
                id: dispatch.id,
                campaignId: dispatch.campaign_id,
                name: dispatch.name,
                status: dispatch.status,
                reason,
                code: "OUTSIDE_SEND_WINDOW",
                localTime: localParts.timeString,
                sendWindow: windowStr,
                nextOpening: nextOpeningDate.toISOString(),
              });
              continue;
            }
          }

          // Lote pausado por cota: só retoma quando o chip que ENVIA (o dono do webhook deste lote, o mesmo que o
          // runCampaignDispatch usa) tem cota hoje para o próximo lead inteiro (todas as mensagens dele). Sem isso o
          // lote voltaria a rodar e pausaria de novo no mesmo dia, a cada tick de 30s.
          if (resumingFromQuota) {
            const sendingInstance = await resolveSendingInstance({ clientId: dispatch.client_id, campaign, dispatch });
            if (sendingInstance) {
              const tenantSettings = await getLeadClientN8nSettings(dispatch.client_id);
              const sendWindowConfig = resolveSendWindowConfig(tenantSettings);
              const tenantTimezone = sendWindowConfig.timezone || "America/Sao_Paulo";
              const limit = resolveEvolutionInstanceDailyLimit(sendingInstance);
              const currentUsage = await getEvolutionInstanceDailyUsage(sendingInstance.id, getDateKey(new Date(), tenantTimezone));
              // as mesmas mensagens que o runCampaignDispatch enviaria por lead (mesma regra de plano de passos)
              const campaignMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
              const plan = getCampaignStepPlan({
                ...campaignMeta,
                sequence: Array.isArray(dispatch.steps) && dispatch.steps.length > 0 ? dispatch.steps : campaignMeta.sequence,
              });
              const passos = plan.shouldUseReplyFlow && plan.immediateSteps.length > 0 ? plan.immediateSteps : plan.enabledSteps;
              const needed = Math.max(countBurstSteps(passos), 1);
              if (currentUsage + needed > limit) {
                const reason = `Cota do chip insuficiente: cota diária ${limit}, uso atual ${currentUsage}, necessário para o próximo lead ${needed} (faltam ${(currentUsage + needed) - limit})`;
                console.log(`[campaign-dispatch-scheduler] pulando lote ${dispatch.id} (${dispatch.name || "sem nome"}): ${reason}`);

                const nextOpeningDate = getNextSendWindowOpening(new Date(), sendWindowConfig);
                const nextOpeningIso = nextOpeningDate.toISOString();
                const dbReason = `Pausado — cota diária do chip atingida (${currentUsage}/${limit} msgs hoje, necessário ${needed} para próximo lead). Retomará amanhã. ${QUOTA_PAUSE_MARKER}`;
                if (dispatch.error_message !== dbReason || dispatch.scheduled_at !== nextOpeningIso) {
                  await supabase
                    .from("campaign_dispatches")
                    .update({
                      error_message: dbReason,
                      scheduled_at: nextOpeningIso,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", dispatch.id);
                  dispatch.error_message = dbReason;
                  dispatch.scheduled_at = nextOpeningIso;
                }

                skipped.push({
                  id: dispatch.id,
                  campaignId: dispatch.campaign_id,
                  name: dispatch.name,
                  status: dispatch.status,
                  reason,
                  code: "INSUFFICIENT_QUOTA",
                  limit,
                  currentUsage,
                  needed,
                });
                continue;
              }
            }
          }

          // TRAVA POR CAMPANHA: o claim abaixo protege a LINHA; isto protege a campanha. Ocorrencia recorrente nunca
          // roda junto com outro lote da mesma campanha (mesmo publico = mensagem dobrada para o mesmo cliente).
          // Fica 'scheduled' e tenta de novo no proximo tick. O indice unico parcial e a ultima barreira (abaixo).
          const concorrente = pgDatabasePool ? await findConcurrentRunningDispatch(pgDatabasePool, dispatch.id) : null;
          if (concorrente) {
            const reason = `Outro lote da mesma campanha em andamento (lote bloqueador: ${concorrente.id})`;
            console.log(`[campaign-dispatch-scheduler] pulando lote ${dispatch.id} (${dispatch.name || "sem nome"}): ${reason}`);
            const dbReason = `Aguardando conclusão de outro lote da mesma campanha (${concorrente.name || concorrente.id})`;
            if (dispatch.error_message !== dbReason) {
              await supabase
                .from("campaign_dispatches")
                .update({ error_message: dbReason, updated_at: new Date().toISOString() })
                .eq("id", dispatch.id);
            }
            results.push({ id: dispatch.id, campaignId: dispatch.campaign_id, status: "blocked_same_campaign", blockingDispatchId: concorrente.id });
            skipped.push({
              id: dispatch.id,
              campaignId: dispatch.campaign_id,
              name: dispatch.name,
              status: dispatch.status,
              reason,
              code: "BLOCKED_SAME_CAMPAIGN",
              blockingDispatchId: concorrente.id,
            });
            continue;
          }

          // TRAVA POR CHIP: com outro lote enviando pelo mesmo chip (deste agendador, de um tick concorrente ou de um
          // botão), este espera e tenta no próximo tick. Só grava o motivo em lote 'scheduled': o 'paused' que chegou
          // aqui é retomável justamente pelo texto do error_message (janela/cota), e sobrescrever tiraria isso dele.
          const reservaDeChip = await reservarChipDoLote(campaign, dispatch);
          if (!reservaDeChip.ok) {
            const bloqueador = reservaDeChip.bloqueadoPor;
            const reason = `Chip ocupado por outro lote (lote bloqueador: ${bloqueador.dispatchId})`;
            console.log(`[campaign-dispatch-scheduler] pulando lote ${dispatch.id} (${dispatch.name || "sem nome"}): ${reason}`);
            const dbReason = describeChipBusyForScheduler(bloqueador.nome);
            if (!reservaDeChip.mesmoLote && dispatch.status === "scheduled" && dispatch.error_message !== dbReason) {
              await supabase
                .from("campaign_dispatches")
                .update({ error_message: dbReason, updated_at: new Date().toISOString() })
                .eq("id", dispatch.id)
                .eq("status", "scheduled");
            }
            results.push({ id: dispatch.id, campaignId: dispatch.campaign_id, status: "blocked_same_chip", blockingDispatchId: bloqueador.dispatchId });
            skipped.push({
              id: dispatch.id,
              campaignId: dispatch.campaign_id,
              name: dispatch.name,
              status: dispatch.status,
              reason,
              code: "BLOCKED_SAME_CHIP",
              blockingDispatchId: bloqueador.dispatchId,
            });
            continue;
          }

          try {
            // CLAIM ATOMICO DO DISPARO
            const { data: claimed, error: claimErr } = await supabase
              .from("campaign_dispatches")
              .update({
                status: "running",
                error_message: null,
                triggered_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq("id", dispatch.id)
              .in("status", ["scheduled", "paused"])
              .select("id");

            // 23505 = uq_campaign_dispatches_one_running_occurrence: outra ocorrencia da campanha ganhou a corrida entre a
            // checagem acima e este UPDATE. Nao e falha do lote: continua 'scheduled' e tenta no proximo tick.
            if (claimErr && String(claimErr.code) === "23505") {
              const reason = "Outra ocorrência da campanha ganhou a corrida no claim (uq_campaign_dispatches_one_running_occurrence)";
              console.log(`[campaign-dispatch-scheduler] pulando lote ${dispatch.id} (${dispatch.name || "sem nome"}): ${reason}`);
              results.push({ id: dispatch.id, campaignId: dispatch.campaign_id, status: "blocked_same_campaign" });
              skipped.push({ id: dispatch.id, campaignId: dispatch.campaign_id, name: dispatch.name, status: dispatch.status, reason, code: "RACE_CONDITION_CLAIM" });
              continue;
            }
            if (claimErr) throw claimErr;
            if (!claimed || claimed.length === 0) {
              const reason = "Disparo já reivindicado por outro ciclo ou processo";
              console.log(`[campaign-dispatch-scheduler] pulando lote ${dispatch.id} (${dispatch.name || "sem nome"}): ${reason}`);
              results.push({ id: dispatch.id, campaignId: dispatch.campaign_id, status: "already_claimed" });
              skipped.push({ id: dispatch.id, campaignId: dispatch.campaign_id, name: dispatch.name, status: dispatch.status, reason, code: "ALREADY_CLAIMED" });
              continue;
            }

            await runCampaignDispatch({ dispatch, campaign, supabase });

            results.push({ id: dispatch.id, campaignId: campaign.id, status: "success" });
          } finally {
            liberarChipDoLote(dispatch.id);
          }
        } catch (err) {
          console.error(`[campaign-dispatch-scheduler] failed to run dispatch ${dispatch.id}:`, err);
          const isDisconnected = Boolean(err?.isConnectionClosed || err?.code === "EVOLUTION_INSTANCE_NOT_OPEN");
          const targetStatus = isDisconnected ? "paused" : "failed";
          const userFriendlyError = isDisconnected
            ? `Pausado — chip desconectado (${err.instanceName || "WhatsApp"}). Reconecte em Conexões para retomar.`
            : (err?.userMessage || err?.message || "Falha técnica no processamento do lote.");

          await supabase
            .from("campaign_dispatches")
            .update({
              status: targetStatus,
              error_message: userFriendlyError,
              finished_at: targetStatus === "failed" ? new Date().toISOString() : null,
              updated_at: new Date().toISOString()
            })
            .eq("id", dispatch.id);

          results.push({ id: dispatch.id, status: targetStatus, error: userFriendlyError });
        }
      }

      const processedCount = results.filter((r) => r.status === "success").length;
      console.log(`[campaign-dispatch-scheduler] tick (pid=${process.pid}): ${dueCount} lote(s) vencido(s) encontrado(s), processados: ${processedCount}, pulados: ${skipped.length}`);

      return { success: true, processed: processedCount, items: results, skipped, recurrence };
    } catch (err) {
      console.error("[campaign-dispatch-scheduler] global check failed:", err);
      return { success: false, error: err.message };
    }
  }

  return runDueIndependentDispatches;
}

/** Liga o tick de 30 s (uma vez por processo). Chamado pelo server.js depois do listen. */
export function startDueDispatchScheduler({ runDueIndependentDispatches, pgDatabasePool }) {
  // Native interval scheduler for scheduled independent dispatches
  if (!_dueDispatchTimerStarted) {
    _dueDispatchTimerStarted = true;
    console.log(`[campaign-dispatch-scheduler] agendador iniciado (pid=${process.pid}, interval=30000ms)`);
    _ligadoEm = new Date().toISOString();
    _dueDispatchInterval = setInterval(async () => {
      _ultimoTickEm = new Date().toISOString();
      _ticks += 1;
      try {
        await runDueIndependentDispatches({ limit: 50 });
      } catch (err) {
        console.error("[campaign-dispatch-scheduler] background tick failed:", err);
      }
      try {
        if (pgDatabasePool) {
          await syncDailyStalledNotificationsForAllTenants(pgDatabasePool);
        }
      } catch (err) {
        console.error("[stalled-notifications-scheduler] background sync failed:", err);
      }
    }, 30000); // ticks every 30 seconds
    if (_dueDispatchInterval?.unref) _dueDispatchInterval.unref();
  }
}
