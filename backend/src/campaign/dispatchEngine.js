// Motor do lote de campanha (PR 8 do untangle, 25/11/2026).
//
// runCampaignDispatchSemRegistro morava dentro de registerCampaignsRoutes (domains/campaigns/routes.js), numa
// closure: não dava para usar nem testar sem registrar as rotas. Movimento puro: o corpo é o MESMO, byte a byte.
// O que ele usava de fora vem por import (o que já era import em routes.js) ou por `deps` (o que é da rota:
// pgDatabasePool, appendLeadMessage, ajudantes do arquivo de rotas), com os mesmos nomes.
import { dispatchCampaignSequence, getCampaignStepPlan, normalizeCampaignAnalyticsMeta, validateCampaignAnalyticsMeta } from "../campaign-outbound.js";
import { getDateKey } from "../services/analytics.js";
import { createChipQuotaGate } from "../services/campaignQuotaGate.js";
import { readOccurrenceInfo } from "../services/campaignRecurrenceOccurrences.js";
import { releaseEvolutionInstanceDailyQuota, reserveEvolutionInstanceDailyQuota, resolveEvolutionInstanceDailyLimit } from "../services/chipQuota.js";
import { chipIdFromDispatchSettings, createRunChipTracker, finalizeRunSent } from "../services/dispatchRunChip.js";
import { isEvolutionOpenState, resolveInstanceIdentifier, validateWhatsappNumbersWithCache } from "../services/evolution.js";
import { markRunSendStarted, markRunSequenceCut } from "../services/runSendMarker.js";
import { isWithinSendWindow, resolveSendWindowConfig } from "../services/sendWindow.js";
import { extractCampaignProgress, findLeadsAlreadyReachedInCycle, isLeadBlockedByActiveCycleProgress, markCampaignLeadWaitingReply, resolveCampaignImportSelection, resolveCampaignImportSelectionStrict, resolveDispatchLeadLimit, resolveEffectiveCampaignSequence } from "./dispatch.js";
import { isPhoneOptedOut } from "./queueOptOut.js";
import { phoneSpellingsOf } from "../services/canonicalPhone.js";

export function createCampaignDispatchEngine(deps) {
  const {
    CAMPAIGN_WITHOUT_SOURCE_MESSAGE,
    appendLeadMessage,
    buildChipHealthPauseMessage,
    buildDispatchCampaignMeta,
    buildDispatchLeads,
    checkEvolutionInstanceHealth,
    describeChipHealthFailure,
    describeInterruptedPending,
    ensureDispatchRunsClaimSchema,
    getClientName,
    getDispatchRunCounts,
    getLeadClientEvolutionInstances,
    getLeadClientN8nSettings,
    importItemIdOf,
    markDispatchCountUnavailable,
    maskPhoneForLog,
    normalizeDispatchPhone,
    normalizeString,
    pgDatabasePool,
    resolveCampaignDispatchSettings,
  } = deps;

  async function runCampaignDispatchSemRegistro({ dispatch, campaign, supabase: db, ignoreSendWindow = false }) {
    const dispatchId = dispatch.id;
    const clientId = campaign.client_id;
    const dispatchSteps = Array.isArray(dispatch.steps) && dispatch.steps.length > 0 ? dispatch.steps : null;
    const campaignMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
    const dispatchEvolutionInstanceId = normalizeString(dispatch.evolution_instance_id);
    const dispatchCampaignMeta = buildDispatchCampaignMeta(campaign, dispatch);
    // Lote com cópia própria dos passos: vale a estrutura dela, com o conteúdo editado na campanha (mesma regra da
    // continuação por resposta, resolveEffectiveCampaignSequence).
    const steps = dispatchSteps ? resolveEffectiveCampaignSequence(dispatchSteps, campaignMeta.sequence, null) : campaignMeta.sequence;

    // Este e o caminho de envio REALMENTE em uso (fila de campaign_dispatches, acionada
    // pelo scheduler) — e ele NAO passa por getCampaignStepPlan, entao nunca produziu
    // step_plan nem gravou progresso via markCampaignLeadWaitingReply. Foi por isso que
    // a instrumentacao do runCampaignDispatch de campaign/dispatch.js nunca apareceu no
    // log: o codigo estava no ar, o caminho e que era outro.
    // Fluxo de resposta no caminho da fila. Ate aqui este runCampaignDispatch mandava
    // TODOS os passos de uma vez, inclusive os after_reply, e nunca gravava progresso
    // pendente — por isso o passo 2 saia na rajada inicial (ou nao saia) e
    // continueCampaignLeadFromReply nunca era alcancado.
    //
    // Reaproveita getCampaignStepPlan e markCampaignLeadWaitingReply, as mesmas do
    // outro caminho. Nao existe segunda implementacao da regra: ter duas foi o que
    // custou as ultimas rodadas.
    const stepPlan = getCampaignStepPlan({ ...campaignMeta, sequence: steps });
    const usaFluxoDeResposta = stepPlan.shouldUseReplyFlow && stepPlan.immediateSteps.length > 0;
    const passosDoEnvio = usaFluxoDeResposta ? stepPlan.immediateSteps : stepPlan.enabledSteps;
    const primeiroPassoAposResposta = usaFluxoDeResposta
      ? (stepPlan.replySteps[0]?.index ?? null)
      : null;

    console.info("[campaign-dispatch] plano", {
      dispatchId,
      campaignId: campaign.id,
      clientId,
      origemDosPassos: dispatchSteps ? "dispatch.steps" : "campaign.analytics_meta.sequence",
      totalPassos: Array.isArray(steps) ? steps.length : 0,
      passosAposResposta: stepPlan.replySteps.length,
      waitForReplyDoMeta: stepPlan.analyticsMeta.dispatchOptions?.waitForReply ?? null,
      usaFluxoDeResposta,
      passosNesteEnvio: passosDoEnvio.length,
      primeiroPassoAposResposta,
    });

    const validation = validateCampaignAnalyticsMeta({
      ...campaignMeta,
      sequence: steps,
    });
    if (!validation.valid) {
      throw new Error(validation.message || "Disparo sem template valido.");
    }
    const dispatchSettings = await resolveCampaignDispatchSettings(clientId, {
      ...campaign,
      analytics_meta: dispatchCampaignMeta,
    });
    const { webhookUrl, webhookToken } = dispatchSettings;
    if (!webhookUrl) {
      throw new Error("Configure uma URL ativa de disparo Evolution para esta empresa");
    }

    // Sem origem, nenhum envio sai: buildDispatchLeads devolveria a base inteira (ver resolveCampaignImportSelectionStrict).
    if (!resolveCampaignImportSelectionStrict(campaign)) {
      console.error("[campaigns] lote recusado: campanha_sem_origem", { campaignId: campaign.id, clientId, dispatchId });
      const semOrigem = new Error(CAMPAIGN_WITHOUT_SOURCE_MESSAGE);
      semOrigem.code = "CAMPAIGN_WITHOUT_SOURCE";
      semOrigem.userMessage = CAMPAIGN_WITHOUT_SOURCE_MESSAGE;
      throw semOrigem;
    }

    // Defeito A: garante o schema de claim (idempotência por disparo) antes de montar a fila.
    await ensureDispatchRunsClaimSchema();

    // Obtém lista de leads da campanha via lead_import_items.
    // excludeDispatchId remove da fila todo lead que JÁ tem registro neste disparo
    // (claimed/sent/failed) → segunda execução do mesmo disparo traz 0 leads.
    // Ocorrencia de campanha recorrente: publico inteiro (sem limit_per_run, nem o da campanha) e outra variacao do
    // texto para o mesmo lead a cada ocorrencia. A cota do chip e o freio.
    // Lote sem fatia (limit_per_run nulo) tambem cobre o publico inteiro: ver resolveDispatchLeadLimit.
    const occurrence = pgDatabasePool
      ? await readOccurrenceInfo(pgDatabasePool, dispatchId)
      : { isOccurrence: false, variantOffset: null };

    const leads = await buildDispatchLeads({
      clientId,
      importId: resolveCampaignImportSelection(campaign),
      limit: resolveDispatchLeadLimit(dispatch, { isOccurrence: occurrence.isOccurrence }),
      offset: occurrence.isOccurrence ? 0 : dispatch.offset ?? 0,
      segmentation: validation.analyticsMeta.segmentation || null,
      excludeDispatchId: dispatchId,
    });

    // Exclusão por ciclo: quem já recebeu em OUTRO lote desta campanha, neste ciclo, não recebe de novo aqui
    // (ver findLeadsAlreadyReachedInCycle). Fica registrado como 'skipped' com o motivo — conta como processado e
    // aparece nos destinatários, em vez de sumir ou deixar o lote "interrompido com pendentes".
    const jaNoCiclo = pgDatabasePool
      ? await findLeadsAlreadyReachedInCycle(pgDatabasePool, { campaignId: campaign.id, dispatchId, occurrence })
      : { phones: new Set(), leadIds: new Set() };
    const leadsDoCiclo = [];
    for (const l of leads) {
      const digits = normalizeString(l.telefone).replace(/\D/g, "");
      const ddiDigits = digits.startsWith("55") ? digits : `55${digits}`;
      const nonDdiDigits = digits.startsWith("55") ? digits.slice(2) : digits;
      const jaRecebeu =
        (digits && (jaNoCiclo.phones.has(digits) || jaNoCiclo.phones.has(ddiDigits) || jaNoCiclo.phones.has(nonDdiDigits))) ||
        (l.id && jaNoCiclo.leadIds.has(String(l.id))) ||
        (l.lead_id && jaNoCiclo.leadIds.has(String(l.lead_id)));
      if (!jaRecebeu) {
        leadsDoCiclo.push(l);
        continue;
      }
      console.log("[campaign-dispatch] lead pulado: ja recebeu em outro lote deste ciclo da campanha", {
        dispatchId,
        campaignId: campaign.id,
        leadId: l.id,
        phone: maskPhoneForLog(l.telefone),
      });
      await pgDatabasePool.query(
        `INSERT INTO public.campaign_dispatch_runs
           (dispatch_id, campaign_id, client_id, lead_id, phone, status, error_message, created_at, lead_import_item_id)
         VALUES ($1, $2, $3, $4, $5, 'skipped', 'Já recebeu em outro lote deste ciclo da campanha', now(), $6)
         ON CONFLICT (dispatch_id, lead_id) DO NOTHING`,
        [dispatchId, campaign.id, clientId, l.id || null, digits, importItemIdOf(l)]
      ).catch((err) => {
        console.warn("[campaign-dispatch] falha ao registrar lead pulado por ciclo:", err?.message || err);
      });
    }

    // Trava por ciclo: o lead não repete o passo 1 dentro da MESMA sequência em andamento.
    // Para ocorrência recorrente: cada ocorrência é um ciclo NOVO; progresso de ocorrência anterior não bloqueia.
    const cycleLeads = [];
    for (const l of leadsDoCiclo) {
      const progress = extractCampaignProgress(l.normalized_data || {}, campaign.id);
      if (isLeadBlockedByActiveCycleProgress({ progress, occurrence, campaignId: campaign.id, dispatchId })) {
        console.log("[campaign-dispatch] lead pulado: sequencia ja em andamento neste ciclo", {
          dispatchId,
          campaignId: campaign.id,
          leadId: l.id,
          phone: maskPhoneForLog(l.telefone),
          status: progress.status,
        });
        continue;
      }
      cycleLeads.push(l);
    }

    if (cycleLeads.length === 0) {
      const counts = await getDispatchRunCounts(pgDatabasePool, dispatchId);
      if (!counts) {
        console.error(`[campaign-dispatch] contagem de runs falhou para lote ${dispatchId}. Contadores NÃO são gravados para evitar fabricação de dados.`);
        // Até 16/11/2026 o lote ficava 'running' até o próximo boot (todo botão devolvia 409, a tela mostrava "em
        // execução"). Agora sai como 'failed' com o motivo; os contadores ficam como estavam.
        await markDispatchCountUnavailable(db, dispatchId);
        return;
      }
      const totalSent = counts.sent;
      const totalFailed = counts.failed;
      const totalInvalid = counts.invalid;
      const totalSkipped = counts.skipped;
      const totalProcessed = totalSent + totalFailed + totalInvalid + totalSkipped;
      const targetCount = Number(dispatch.target_count || 0) || totalProcessed;

      if (targetCount > 0 && totalProcessed < targetCount) {
        const pendingCount = targetCount - totalProcessed;
        const finalMsg = describeInterruptedPending({ pendingCount, claimedCount: counts.claimed });
        await db.from("campaign_dispatches").update({
          status: "interrupted",
          sent_count: totalSent,
          failed_count: totalFailed,
          error_message: finalMsg,
          updated_at: new Date().toISOString(),
        }).eq("id", dispatchId);
      } else {
        await db.from("campaign_dispatches").update({
          status: "done",
          sent_count: totalSent,
          failed_count: totalFailed,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_message: null,
        }).eq("id", dispatchId);
      }
      return;
    }

    // ── Item 2: Validação prévia de números via Evolution API com cache ─────────
    let validLeads = cycleLeads;
    if (cycleLeads.length > 0) {
      try {
        const candidatePhones = cycleLeads
          .map((l) => normalizeString(l.telefone).replace(/\D/g, ""))
          .filter(Boolean);

        const validationMap = await validateWhatsappNumbersWithCache({
          pool: pgDatabasePool,
          webhookUrl,
          webhookToken,
          phones: candidatePhones,
        });

        const invalidLeads = [];
        validLeads = [];

        for (const l of cycleLeads) {
          const cleanPhone = normalizeString(l.telefone).replace(/\D/g, "");
          const validation = cleanPhone ? validationMap.get(cleanPhone) : null;

          if (validation && validation.exists === false) {
            invalidLeads.push(l);
          } else {
            validLeads.push(l);
          }
        }

        if (invalidLeads.length > 0) {
          console.warn(
            `[campaign-dispatch] ${invalidLeads.length} número(s) INEXISTENTE(S) no WhatsApp detectado(s) na pré-validação — envio cancelado para eles:`,
            {
              dispatchId,
              campaignId: campaign.id,
              invalidCount: invalidLeads.length,
            }
          );

          if (pgDatabasePool) {
            // O chip que fez a pré-validação (dono do webhook do lote). Sem ele, o diário do chip não conta quantos
            // números inexistentes passaram por cada chip antes de uma queda. null = não identificado, como no 'sent'.
            const chipDaValidacao = chipIdFromDispatchSettings(dispatchSettings);
            for (const invLead of invalidLeads) {
              const cleanPhone = normalizeString(invLead.telefone).replace(/\D/g, "");
              if (invLead.id) {
                await pgDatabasePool.query(
                  `INSERT INTO public.campaign_dispatch_runs
                     (dispatch_id, campaign_id, client_id, lead_id, phone, status, error_message, created_at, lead_import_item_id, evolution_instance_id)
                   VALUES ($1, $2, $3, $4, $5, 'invalid_number', 'Número não existe no WhatsApp', now(), $6, $7)
                   ON CONFLICT (dispatch_id, lead_id) DO UPDATE
                     SET status = 'invalid_number',
                         error_message = 'Número não existe no WhatsApp',
                         evolution_instance_id = COALESCE(EXCLUDED.evolution_instance_id, public.campaign_dispatch_runs.evolution_instance_id)`,
                  [dispatchId, campaign.id, clientId, invLead.id, cleanPhone, importItemIdOf(invLead), chipDaValidacao]
                ).catch((err) => {
                  console.warn("[campaign-dispatch] falha ao registrar lead inválido:", err?.message || err);
                });
              } else if (cleanPhone) {
                await pgDatabasePool.query(
                  `INSERT INTO public.campaign_dispatch_runs
                     (dispatch_id, campaign_id, client_id, lead_id, phone, status, error_message, created_at, evolution_instance_id)
                   VALUES ($1, $2, $3, NULL, $4, 'invalid_number', 'Número não existe no WhatsApp', now(), $5)`,
                  [dispatchId, campaign.id, clientId, cleanPhone, chipDaValidacao]
                ).catch((err) => {
                  console.warn("[campaign-dispatch] falha ao registrar lead inválido por fone:", err?.message || err);
                });
              }
            }
          }
        }
      } catch (valErr) {
        console.warn("[campaign-dispatch] erro na pré-validação de números (disparo continuará sem travar):", valErr?.message || valErr);
        // Era validLeads = leads: a lista ANTES da exclusão por ciclo e da trava de sequência em andamento. Uma falha na
        // pré-validação devolvia ao envio quem já tinha recebido em outro lote deste ciclo.
        validLeads = cycleLeads;
      }
    }

    if (validLeads.length === 0) {
      const counts = await getDispatchRunCounts(pgDatabasePool, dispatchId);
      if (!counts) {
        console.error(`[campaign-dispatch] contagem de runs falhou para lote ${dispatchId}. Contadores NÃO são gravados para evitar fabricação de dados.`);
        // Até 16/11/2026 o lote ficava 'running' até o próximo boot (todo botão devolvia 409, a tela mostrava "em
        // execução"). Agora sai como 'failed' com o motivo; os contadores ficam como estavam.
        await markDispatchCountUnavailable(db, dispatchId);
        return;
      }
      const totalSent = counts.sent;
      const totalFailed = counts.failed;
      const totalInvalid = counts.invalid;
      const totalSkipped = counts.skipped;
      const totalProcessed = totalSent + totalFailed + totalInvalid + totalSkipped;
      const targetCount = Number(dispatch.target_count || 0) || totalProcessed;

      if (targetCount > 0 && totalProcessed < targetCount) {
        const pendingCount = targetCount - totalProcessed;
        await db.from("campaign_dispatches").update({
          status: "interrupted",
          sent_count: totalSent,
          failed_count: totalFailed,
          error_message: describeInterruptedPending({ pendingCount, claimedCount: counts.claimed }),
          updated_at: new Date().toISOString(),
        }).eq("id", dispatchId);
      } else {
        await db.from("campaign_dispatches").update({
          status: "done",
          sent_count: totalSent,
          failed_count: totalFailed,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_message: null,
        }).eq("id", dispatchId);
      }
      return;
    }

    // Apply database Round-Robin scheduling links to leads if they don't have one
    const sequenceRequiresSchedulingLink = (steps || []).some((s) => {
      const texts = [s.text, ...(Array.isArray(s.textVariants) ? s.textVariants : [])].filter(Boolean);
      return texts.some((t) => /\{\{\s*scheduling_link\s*\}\}/i.test(t));
    });

    let activeConsultantLinks = [];
    try {
      if (pgDatabasePool) {
        const consultantRes = await pgDatabasePool.query(
          "SELECT scheduling_link FROM public.crm_consultant_schedules WHERE client_id = $1 AND active = true ORDER BY name ASC",
          [clientId]
        );
        activeConsultantLinks = (consultantRes?.rows || [])
          .map((r) => r.scheduling_link)
          .filter((link) => Boolean(normalizeString(link)));
      }

      if (activeConsultantLinks.length > 0) {
        validLeads.forEach((lead, idx) => {
          if (!lead.normalized_data) {
            lead.normalized_data = {};
          }
          if (!lead.normalized_data.scheduling_link) {
            lead.normalized_data.scheduling_link = activeConsultantLinks[idx % activeConsultantLinks.length];
          }
        });
      }
    } catch (dbErr) {
      console.error("[campaign-dispatch] failed to apply consultant schedules to leads:", {
        clientId,
        error: dbErr?.message || dbErr,
      });
      if (sequenceRequiresSchedulingLink) {
        throw new Error(
          `Disparo interrompido: falha no banco de dados ao buscar agenda de consultores ({{scheduling_link}}): ${dbErr?.message || dbErr}`
        );
      }
    }

    // Se a campanha usa {{scheduling_link}}, nenhum lead pode ser disparado com a variável crua
    if (sequenceRequiresSchedulingLink) {
      const leadsSemLink = validLeads.filter((lead) => !normalizeString(lead.normalized_data?.scheduling_link));
      if (leadsSemLink.length > 0) {
        const motivo = activeConsultantLinks.length === 0
          ? "Nenhum consultor ativo com link de agendamento cadastrado para preencher {{scheduling_link}}."
          : `Link de agendamento ausente para ${leadsSemLink.length} de ${validLeads.length} lead(s).`;
        console.error("[campaign-dispatch] Disparo bloqueado por link de agendamento ausente:", {
          clientId,
          leadsSemLink: leadsSemLink.length,
          totalLeads: validLeads.length,
          motivo,
        });
        throw new Error(`Disparo interrompido: ${motivo}`);
      }
    }

    // Constrói analyticsMeta compatível com dispatchCampaignSequence
    const analyticsMeta = validation.analyticsMeta;

    // Anti-ban: pool de chips para rotação round-robin com cota diária.
    const tenantInstances = await getLeadClientEvolutionInstances(clientId);
    const activeInstances = tenantInstances.filter(
      (inst) => inst.active !== false && normalizeString(inst.dispatch_webhook_url)
    );
    let targetInstances = [];
    let chipMismatchWarning = null;

    const configuredChipIds = (
      Array.isArray(dispatchCampaignMeta.dispatchOptions?.dispatchChipIds) && dispatchCampaignMeta.dispatchOptions.dispatchChipIds.length > 0
        ? dispatchCampaignMeta.dispatchOptions.dispatchChipIds
        : (Array.isArray(dispatch.dispatch_options?.dispatchChipIds) && dispatch.dispatch_options.dispatchChipIds.length > 0
            ? dispatch.dispatch_options.dispatchChipIds
            : [])
    ).filter(Boolean);

    const attemptChipAutoHealing = async (configuredIds) => {
      if (!Array.isArray(activeInstances) || activeInstances.length === 0) {
        return null;
      }

      const configuredIdsSet = new Set((configuredIds || []).map(String));
      const candidateNames = [
        ...tenantInstances
          .filter((inst) => configuredIdsSet.has(String(inst.id)) || String(inst.id) === String(dispatchEvolutionInstanceId))
          .map((inst) => inst.name),
        ...(Array.isArray(dispatchCampaignMeta.dispatchOptions?.dispatchChipNames)
          ? dispatchCampaignMeta.dispatchOptions.dispatchChipNames
          : []),
        dispatchCampaignMeta.dispatchOptions?.chipName,
        dispatchCampaignMeta.dispatchOptions?.chip_name,
        dispatchCampaignMeta.dispatchOptions?.evolutionInstanceName,
        dispatchCampaignMeta.dispatchOptions?.evolution_instance_name,
        ...(Array.isArray(dispatch.dispatch_options?.dispatchChipNames)
          ? dispatch.dispatch_options.dispatchChipNames
          : []),
        dispatch.dispatch_options?.chipName,
        dispatch.dispatch_options?.chip_name,
        dispatch.dispatch_options?.evolutionInstanceName,
        dispatch.dispatch_options?.evolution_instance_name,
        dispatch.evolution_instance_name,
        campaign.evolution_instance_name,
      ]
        .filter(Boolean)
        .map((n) => String(n).trim());

      let recoveredInstance = null;
      // Passo A (Casamento por Nome): Busque nas instâncias ativas se alguma possui o mesmo name amigável
      if (candidateNames.length > 0) {
        recoveredInstance = activeInstances.find(
          (inst) =>
            inst.name &&
            candidateNames.some(
              (cName) => cName.toLowerCase() === String(inst.name).trim().toLowerCase()
            )
        );
      }

      // Passo B (Fallback para Chip Padrão): Se não encontrar por nome, seleciona o chip padrão ou primeiro ativo conectado
      if (!recoveredInstance) {
        const openInstances = activeInstances.filter(
          (inst) => (inst.connection_state || "").toLowerCase() === "open"
        );
        if (openInstances.length > 0) {
          recoveredInstance = openInstances.find((inst) => inst.is_default === true) || openInstances[0];
        } else if (activeInstances.length > 0) {
          recoveredInstance = activeInstances.find((inst) => inst.is_default === true) || activeInstances[0];
        }
      }

      if (!recoveredInstance) {
        return null;
      }

      console.log(`[campaign-dispatch] AUTO-HEALING: Chip remapeado com sucesso para "${recoveredInstance.name}" (${recoveredInstance.id})`);

      const updatedDispatchOptions = {
        ...(dispatch.dispatch_options || {}),
        dispatchChipIds: [recoveredInstance.id],
      };
      const updatedCampaignMeta = {
        ...(campaign.analytics_meta || {}),
      };
      updatedCampaignMeta.dispatchOptions = {
        ...(updatedCampaignMeta.dispatchOptions || {}),
        dispatchChipIds: [recoveredInstance.id],
      };

      dispatch.evolution_instance_id = recoveredInstance.id;
      dispatch.dispatch_options = updatedDispatchOptions;
      campaign.analytics_meta = updatedCampaignMeta;
      if (dispatchCampaignMeta?.dispatchOptions) {
        dispatchCampaignMeta.dispatchOptions.dispatchChipIds = [recoveredInstance.id];
        dispatchCampaignMeta.dispatchOptions.evolutionInstanceId = recoveredInstance.id;
      }

      try {
        if (pgDatabasePool) {
          await pgDatabasePool.query(
            `UPDATE public.campaign_dispatches
             SET evolution_instance_id = $1,
                 dispatch_options = $2::jsonb,
                 updated_at = now()
             WHERE id = $3`,
            [recoveredInstance.id, JSON.stringify(updatedDispatchOptions), dispatchId]
          );
          await pgDatabasePool.query(
            `UPDATE public.campaigns
             SET analytics_meta = $1::jsonb,
                 updated_at = now()
             WHERE id = $2`,
            [JSON.stringify(updatedCampaignMeta), campaign.id]
          );
        }
        if (db) {
          await db
            .from("campaign_dispatches")
            .update({
              evolution_instance_id: recoveredInstance.id,
              dispatch_options: updatedDispatchOptions,
              updated_at: new Date().toISOString(),
            })
            .eq("id", dispatchId);
          await db
            .from("campaigns")
            .update({
              analytics_meta: updatedCampaignMeta,
              updated_at: new Date().toISOString(),
            })
            .eq("id", campaign.id);
        }
      } catch (persistErr) {
        console.error("[campaign-dispatch] AUTO-HEALING: Erro ao persistir remapeamento no banco:", persistErr);
      }

      return recoveredInstance;
    };

    if (configuredChipIds.length > 0) {
      const matched = configuredChipIds
        .map((id) =>
          activeInstances.find(
            (inst) =>
              inst.id === id ||
              inst.name === id ||
              normalizeString(inst.dispatch_webhook_url) === normalizeString(id)
          )
        )
        .filter(Boolean);

      if (matched.length > 0) {
        targetInstances = matched;
      } else {
        const recovered = await attemptChipAutoHealing(configuredChipIds);
        if (recovered) {
          targetInstances = [recovered];
        } else {
          const pauseMsg = "Pausado — nenhum dos chips configurados para disparo está conectado. Reconecte os chips em Conexões para retomar.";
          console.warn("[campaign-dispatch] Nenhum chip configurado ativo para este cliente:", {
            clientId,
            dispatchId,
            configuredChipIds,
          });
          await db.from("campaign_dispatches").update({
            status: "paused",
            error_message: pauseMsg,
            updated_at: new Date().toISOString(),
          }).eq("id", dispatchId);
          return;
        }
      }
    } else if (dispatchEvolutionInstanceId) {
      const matched = activeInstances.filter(
        (inst) =>
          inst.id === dispatchEvolutionInstanceId ||
          inst.name === dispatchEvolutionInstanceId ||
          normalizeString(inst.dispatch_webhook_url) === normalizeString(dispatchEvolutionInstanceId)
      );

      if (matched.length > 0) {
        targetInstances = matched;
      } else {
        const recovered = await attemptChipAutoHealing([dispatchEvolutionInstanceId]);
        if (recovered) {
          targetInstances = [recovered];
        } else {
          // ID configurado não encontrado nas instâncias ativas do tenant
          if (activeInstances.length === 0) {
            const pauseMsg = "Pausado — nenhum chip conectado para este cliente. Conecte um chip em Conexões para retomar.";
            console.warn("[campaign-dispatch] Nenhum chip conectado para este cliente:", {
              clientId,
              dispatchId,
              configuredInstanceId: dispatchEvolutionInstanceId,
            });
            await db.from("campaign_dispatches").update({
              status: "paused",
              error_message: pauseMsg,
              updated_at: new Date().toISOString(),
            }).eq("id", dispatchId);
            return;
          }

          if (activeInstances.length > 1) {
            // Mais de um chip ativo: NÃO escolhe sozinho! Pausa o lote e pede a escolha ao usuário.
            const pauseMsg = `Pausado — chip configurado não encontrado e existem múltiplos chips ativos (${activeInstances.length}). Selecione o chip desejado na campanha para retomar.`;
            console.warn("[campaign-dispatch] AVISO: Chip configurado não encontrado e existem múltiplos chips ativos. Pausando lote:", {
              clientId,
              dispatchId,
              configuredInstanceId: dispatchEvolutionInstanceId,
              activeChips: activeInstances.map((i) => ({ id: i.id, name: i.name })),
            });
            await db.from("campaign_dispatches").update({
              status: "paused",
              error_message: pauseMsg,
              updated_at: new Date().toISOString(),
            }).eq("id", dispatchId);
            return;
          }

          // Exatamente 1 chip ativo: fallback com log explícito e aviso visível na tela
          const singleChip = activeInstances[0];
          const singleChipName = singleChip.name || singleChip.id;
          chipMismatchWarning = `Chip configurado não encontrado. Enviando por ${singleChipName}.`;
          console.warn("[campaign-dispatch] AVISO: Chip configurado não encontrado, utilizando o único chip ativo do tenant:", {
            clientId,
            dispatchId,
            configuredInstanceId: dispatchEvolutionInstanceId,
            usedInstanceId: singleChip.id,
            usedInstanceName: singleChipName,
          });
          targetInstances = [singleChip];
        }
      }
    } else {
      targetInstances = activeInstances;
    }

    const rotationPool = targetInstances;

    if (rotationPool.length > 0) {
      let anyOpen = false;
      const falhasDeChip = [];
      for (const inst of rotationPool) {
        try {
          const health = await checkEvolutionInstanceHealth({
            webhookUrl: inst.dispatch_webhook_url,
            webhookToken: inst.dispatch_webhook_token,
            context: { clientId, dispatchId, campaignId: campaign.id },
          });
          if (health?.state && isEvolutionOpenState(health.state)) {
            anyOpen = true;
          } else {
            falhasDeChip.push(describeChipHealthFailure({ chipName: inst.name || inst.id, state: health?.state }));
          }
        } catch (healthErr) {
          const falha = describeChipHealthFailure({ chipName: inst.name || inst.id, error: healthErr });
          falhasDeChip.push(falha);
          console.warn("[campaign-dispatch] chip health check falhou:", {
            chip: inst.name,
            motivo: falha.kind,
            error: healthErr?.message || healthErr,
          });
        }
      }

      if (!anyOpen) {
        const errorMsg = buildChipHealthPauseMessage(falhasDeChip);
        console.warn("[campaign-dispatch] Nenhum chip conectado para este disparo. Pausando lote imediatamente:", {
          dispatchId,
          campaignId: campaign.id,
          errorMsg,
        });
        await db.from("campaign_dispatches").update({
          status: "paused",
          error_message: errorMsg,
          updated_at: new Date().toISOString(),
        }).eq("id", dispatchId);
        return;
      }
    }

    const tenantSettings = await getLeadClientN8nSettings(clientId);
    const sendWindowConfig = resolveSendWindowConfig(tenantSettings);
    const tenantTimezone = sendWindowConfig.timezone || "America/Sao_Paulo";
    const todayDateKey = getDateKey(new Date(), tenantTimezone);

    // SPEC 10: rodízio multi-chip ligado! Round-robin por lead, respeitando a cota diária de cada chip.
    // Ativa quando dispatchChipIds for configurado na campanha/disparo.
    // Chip que bate a cota sai do rodízio no meio do lote, sem derrubar o lote.
    const isMultiChip = configuredChipIds.length > 0;
    let rotationCursor = 0;
    let quotaUnavailableWarned = false;
    const chipProvider =
      isMultiChip && rotationPool.length > 0
        ? async ({ leadIndex, burst = 1 } = {}) => {
            const count = Number.isInteger(burst) && burst > 0 ? burst : 1;
            let lastExhausted = null;
            for (let attempt = 0; attempt < rotationPool.length; attempt += 1) {
              const inst = rotationPool[(rotationCursor + attempt) % rotationPool.length];
              const limit = resolveEvolutionInstanceDailyLimit(inst);
              let reserved;
              try {
                reserved = await reserveEvolutionInstanceDailyQuota(inst.id, todayDateKey, pgDatabasePool, count);
                if (reserved === null) throw new Error("contador de cota indisponível");
              } catch (err) {
                if (!quotaUnavailableWarned) {
                  quotaUnavailableWarned = true;
                  console.error("[campaign-quota] cota indisponível no rodízio: o envio segue sem cota para os chips deste lote:", err?.message || err);
                }
                rotationCursor = (rotationCursor + attempt + 1) % rotationPool.length;
                return {
                  webhookUrl: normalizeString(inst.dispatch_webhook_url),
                  webhookToken: normalizeString(inst.dispatch_webhook_token) || null,
                  instanceId: inst.id,
                  instanceName: inst.name || inst.id,
                  sequence: null,
                  release: () => {},
                  limitQuota: limit,
                  usedQuota: 0,
                };
              }

              if (reserved > limit) {
                try {
                  await releaseEvolutionInstanceDailyQuota(inst.id, todayDateKey, pgDatabasePool, count);
                } catch {
                  /* best-effort */
                }
                lastExhausted = {
                  exhausted: true,
                  chipName: inst.name || inst.id,
                  limitQuota: limit,
                  usedQuota: Math.min(Math.max(reserved - count, 0), limit),
                  exhaustedQuotaMessage: `Pausado — cota diária do chip atingida (${limit}/${limit}). Retoma amanhã.`,
                };
                continue;
              }

              rotationCursor = (rotationCursor + attempt + 1) % rotationPool.length;
              return {
                webhookUrl: normalizeString(inst.dispatch_webhook_url),
                webhookToken: normalizeString(inst.dispatch_webhook_token) || null,
                instanceId: inst.id,
                instanceName: inst.name || inst.id,
                sequence: reserved,
                release: (unused) =>
                  releaseEvolutionInstanceDailyQuota(
                    inst.id,
                    todayDateKey,
                    pgDatabasePool,
                    Number.isInteger(unused) && unused > 0 ? unused : count
                  ).catch(() => {}),
                limitQuota: limit,
                usedQuota: reserved,
              };
            }
            return lastExhausted || {
              exhausted: true,
              chipName: rotationPool[0]?.name || "WhatsApp",
              limitQuota: resolveEvolutionInstanceDailyLimit(rotationPool[0]),
              usedQuota: resolveEvolutionInstanceDailyLimit(rotationPool[0]),
              exhaustedQuotaMessage: `Pausado — cota diária do chip atingida (${resolveEvolutionInstanceDailyLimit(rotationPool[0])}/${resolveEvolutionInstanceDailyLimit(rotationPool[0])}). Retoma amanhã.`,
            };
          }
        : null;

    // Opt-out do lote. ATÉ 29/10/2026 esta função existia, lia lead_optouts e NUNCA foi passada ao envio (onLeadCheckOptout):
    // quem digitava "parar" entrava na tabela e continuava recebendo campanha. Agora é ligada, lendo as duas fontes pelo mesmo
    // helper da fila (queueOptOut.js). O lead pulado fica como 'skipped' para contar como processado (o lote fecha 'done').
    // Erro de leitura = pula (nunca libera); sem registro, para o lead poder ser retomado em "executar pendentes".
    const checkOptout = async ({ lead, phone }) => {
      if (!pgDatabasePool || !phone) return false;
      let optOut;
      try {
        optOut = await isPhoneOptedOut(pgDatabasePool, { clientId, phone });
      } catch (err) {
        console.error("[campaign-dispatch] falha ao checar opt-out; lead pulado nesta rodada:", err?.message || err);
        return true;
      }
      if (!optOut) return false;
      await pgDatabasePool
        .query(
          `INSERT INTO public.campaign_dispatch_runs
             (dispatch_id, campaign_id, client_id, lead_id, phone, status, error_message, created_at, lead_import_item_id)
           VALUES ($1, $2, $3, $4, $5, 'skipped', 'Lead está na lista de Opt-out', now(), $6)
           ON CONFLICT (dispatch_id, lead_id) DO NOTHING`,
          [dispatchId, campaign.id, clientId, lead?.id || null, normalizeString(phone).replace(/\D/g, ""), importItemIdOf(lead)]
        )
        .catch((err) => {
          console.warn("[campaign-dispatch] falha ao registrar lead pulado por opt-out:", err?.message || err);
        });
      return true;
    };

    // ── GARANTIA DURA INEGOCIÁVEL (Item 1a): ──────────────────────────────────
    // Nenhum caminho pode enviar para um destinatário que já está 'sent' ou 'invalid_number' neste lote.
    const claimLead = async ({ lead, phone }) => {
      if (!pgDatabasePool) return true;

      const cleanPhone = normalizeDispatchPhone(phone, lead);

      // 1. Checagem dura incondicional no banco de dados
      try {
        const existingRun = await pgDatabasePool.query(
          `SELECT id, status FROM public.campaign_dispatch_runs
           WHERE dispatch_id = $1 AND (
             ($2::uuid IS NOT NULL AND lead_id = $2) OR
             (regexp_replace(phone, '\\D', '', 'g') = $3)
           ) AND status IN ('sent', 'invalid_number')
           LIMIT 1`,
          [dispatchId, lead?.id || null, cleanPhone]
        );
        if (existingRun.rows.length > 0) {
          console.warn(
            `[campaign-dispatch] 🚨 BLOQUEIO DURO DE SEGURANÇA: Destinatário (${cleanPhone}) já possui status '${existingRun.rows[0].status}' neste lote. Envio abortado imediatamente!`,
            { dispatchId, leadId: lead?.id, phone: cleanPhone }
          );
          return false;
        }
      } catch (checkErr) {
        console.warn("[campaign-dispatch] aviso ao checar duplicidade de envio:", checkErr?.message || checkErr);
      }

      // 2. Trava por ciclo REAVALIADA NA HORA DO CLAIM (29/10/2026, campanha 0423a574). A mesma regra da montagem da lista
      // (isLeadBlockedByActiveCycleProgress), que roda uma vez, no começo do lote. Entre a montagem e o envio a fila
      // (startNextCampaignLeadInQueue) pode ter iniciado este lead: ela não cria run, só grava o progresso, então a checagem
      // de runs acima não a enxerga e o lead recebia o passo 1 duas vezes, com variações diferentes. Registra 'skipped' para
      // o lead contar como processado (o lote fecha 'done' em vez de "interrompido com pendentes").
      const itemId = importItemIdOf(lead);
      if (itemId) {
        try {
          const { rows: itemRows } = await pgDatabasePool.query(
            `SELECT normalized_data FROM public.lead_import_items WHERE id = $1 AND client_id = $2`,
            [itemId, clientId]
          );
          const progressoAtual = extractCampaignProgress(itemRows[0]?.normalized_data || {}, campaign.id);
          if (isLeadBlockedByActiveCycleProgress({ progress: progressoAtual, occurrence, campaignId: campaign.id, dispatchId })) {
            console.warn("[campaign-dispatch] lead pulado no claim: sequência já em andamento neste ciclo (iniciada fora deste lote)", {
              dispatchId,
              campaignId: campaign.id,
              leadId: lead.id,
              phone: maskPhoneForLog(lead.telefone || phone),
              status: progressoAtual.status,
            });
            await pgDatabasePool
              .query(
                `INSERT INTO public.campaign_dispatch_runs
                   (dispatch_id, campaign_id, client_id, lead_id, phone, status, error_message, created_at, lead_import_item_id)
                 VALUES ($1, $2, $3, $4, $5, 'skipped', 'Sequência já em andamento neste ciclo (iniciada fora deste lote)', now(), $6)
                 ON CONFLICT (dispatch_id, lead_id) DO NOTHING`,
                [dispatchId, campaign.id, clientId, lead.id, cleanPhone || normalizeString(phone), itemId]
              )
              .catch((err) => {
                console.warn("[campaign-dispatch] falha ao registrar lead pulado no claim:", err?.message || err);
              });
            return false;
          }
        } catch (cycleErr) {
          // Como a checagem de runs acima: falha de leitura não derruba o envio.
          console.warn("[campaign-dispatch] aviso ao reavaliar a trava por ciclo no claim:", cycleErr?.message || cycleErr);
        }
      }

      if (!lead?.id) {
        const alvo = cleanPhone || normalizeString(phone);
        if (!alvo) return true;
        const { rows } = await pgDatabasePool.query(
          `SELECT 1 FROM public.campaign_dispatch_runs
             WHERE dispatch_id = $1 AND phone = $2 LIMIT 1`,
          [dispatchId, alvo]
        );
        if (rows.length > 0) {
          console.warn("[campaign-dispatch] reenvio bloqueado: telefone ja tocado neste disparo", {
            dispatchId,
            campaignId: campaign.id,
          });
          return false;
        }
        await pgDatabasePool
          .query(
            `INSERT INTO public.campaign_dispatch_runs
               (dispatch_id, campaign_id, client_id, lead_id, phone, status, claimed_at, created_at)
             VALUES ($1, $2, $3, NULL, $4, 'claimed', now(), now())`,
            [dispatchId, campaign.id, clientId, alvo]
          )
          .catch((err) => {
            console.warn("[campaign-dispatch] claim por telefone falhou:", err?.message || err);
          });
        return true;
      }

      const { rows } = await pgDatabasePool.query(
        `
          INSERT INTO public.campaign_dispatch_runs
            (dispatch_id, campaign_id, client_id, lead_id, phone, status, claimed_at, created_at, lead_import_item_id)
          VALUES ($1, $2, $3, $4, $5, 'claimed', now(), now(), $6)
          ON CONFLICT (dispatch_id, lead_id) DO NOTHING
          RETURNING id
        `,
        [dispatchId, campaign.id, clientId, lead.id, phone || "", importItemIdOf(lead)]
      );
      if (rows.length === 0) {
        console.warn("[campaign-dispatch] reenvio bloqueado: lead ja tocado neste disparo", {
          dispatchId,
          campaignId: campaign.id,
          leadId: lead.id,
        });
      }
      return rows.length > 0;
    };

    // Chip que de fato enviou cada lead, para gravar junto do 'sent': o do rodízio (activeChip) quando houver; senão o
    // dono do webhook de envio (dispatchSettings). Desconhecido fica NULL — nunca o chip configurado da campanha.
    const runChipTracker = createRunChipTracker({ settingsChipId: chipIdFromDispatchSettings(dispatchSettings) });
    const finalizeLeadSent = async ({ lead, phone, sentAt }) => {
      if (!pgDatabasePool) return;
      const targetLead = lead || {};
      const leadId = targetLead.id || null;
      const cleanPhone = normalizeDispatchPhone(phone, targetLead);
      if (!leadId && !cleanPhone) return;

      try {
        const result = await finalizeRunSent(pgDatabasePool, {
          clientId,
          dispatchId,
          leadId,
          phone: cleanPhone,
          sentAt,
          chipId: runChipTracker.take(targetLead.id), // chipId: runChipTracker.take(lead.id)
        });

        if (result?.rowCount === 0) {
          console.error(
            `[campaign-dispatch] finalize_sent_zero_rows: mensagem enviada mas nenhuma linha atualizada em campaign_dispatch_runs`,
            { dispatchId, leadId, phone: cleanPhone }
          );
        }
      } catch (err) {
        const errorMsg = `[finalize_sent_failed] ${err?.message || err}`;
        console.error("[campaign-dispatch] finalize_sent_failed:", err?.message || err, {
          dispatchId,
          leadId,
          phone: cleanPhone,
        });
        if (db) {
          await db
            .from("campaign_dispatches")
            .update({ error_message: errorMsg, updated_at: new Date().toISOString() })
            .eq("id", dispatchId)
            .catch(() => {});
        } else if (pgDatabasePool) {
          await pgDatabasePool
            .query(
              `UPDATE public.campaign_dispatches SET error_message = $1, updated_at = now() WHERE id = $2`,
              [errorMsg, dispatchId]
            )
            .catch(() => {});
        }
      }
    };

    const finalizeLeadFailed = async ({ lead, phone, reason }) => {
      if (!pgDatabasePool) return;
      const isInvalidNumber = Boolean(
        reason && (
          /não existe no whatsapp/i.test(reason) ||
          /invalid_number/i.test(reason) ||
          /number does not exist/i.test(reason) ||
          /não está no whatsapp/i.test(reason) ||
          /not on whatsapp/i.test(reason)
        )
      );
      const newStatus = isInvalidNumber ? "invalid_number" : "failed";
      const cleanPhone = normalizeString(phone || lead?.telefone).replace(/\D/g, "");

      if (lead?.id) {
        await pgDatabasePool
          .query(
            `UPDATE public.campaign_dispatch_runs SET status = $1, error_message = $2 WHERE dispatch_id = $3 AND lead_id = $4`,
            [newStatus, reason || null, dispatchId, lead.id]
          )
          .catch((err) => {
            console.warn("[campaign-dispatch] finalize_failed_failed:", err?.message || err);
          });
      } else if (cleanPhone) {
        await pgDatabasePool
          .query(
            `UPDATE public.campaign_dispatch_runs SET status = $1, error_message = $2 WHERE dispatch_id = $3 AND regexp_replace(phone, '\\D', '', 'g') = $4`,
            [newStatus, reason || null, dispatchId, cleanPhone]
          )
          .catch((err) => {
            console.warn("[campaign-dispatch] finalize_failed_failed by phone:", err?.message || err);
          });
      }

      if (isInvalidNumber && cleanPhone) {
        await pgDatabasePool.query(
          `INSERT INTO public.whatsapp_number_validations (phone, exists_whatsapp, validated_at)
           VALUES ($1, false, now())
           ON CONFLICT (phone) DO UPDATE SET exists_whatsapp = false, validated_at = now()`,
          [cleanPhone]
        ).catch(() => {});
      }
    };

    const rollbackClaimLead = async ({ lead, phone }) => {
      if (!pgDatabasePool) return;
      if (lead?.id) {
        await pgDatabasePool.query(
          `DELETE FROM public.campaign_dispatch_runs WHERE dispatch_id = $1 AND lead_id = $2 AND status = 'claimed'`,
          [dispatchId, lead.id]
        ).catch(() => {});
      } else if (phone) {
        await pgDatabasePool.query(
          `DELETE FROM public.campaign_dispatch_runs WHERE dispatch_id = $1 AND phone = $2 AND status = 'claimed'`,
          [dispatchId, normalizeString(phone)]
        ).catch(() => {});
      }
    };

    let sentCount = 0;
    let failedCount = 0;
    let lastPauseCheckAt = 0;
    let customPauseReason = null;

    const isDispatchStillRunning = async () => {
      const now = Date.now();
      if (now - lastPauseCheckAt < 1000) return true;
      lastPauseCheckAt = now;

      const { data: current, error: currentError } = await db
        .from("campaign_dispatches")
        .select("status")
        .eq("id", dispatchId)
        .maybeSingle();

      if (currentError) {
        console.warn("[campaign-dispatch] pause status check failed:", currentError.message || currentError);
        return true;
      }

      if (current?.status !== "running") {
        return false;
      }

      // Checa se a janela de envio permitida do tenant fechou durante o processamento do lote
      if (!ignoreSendWindow) {
        try {
          const tenantSettings = await getLeadClientN8nSettings(clientId);
          const sendWindowConfig = resolveSendWindowConfig(tenantSettings);
          if (!isWithinSendWindow(new Date(), sendWindowConfig)) {
            const pauseMsg = `Pausado — fora da janela de envio (${sendWindowConfig.start}–${sendWindowConfig.end}). Retomará automaticamente na próxima janela.`;
            customPauseReason = pauseMsg;
            console.info("[campaign-dispatch] Janela de envio fechou durante a execução do lote. Pausando lote:", {
              dispatchId,
              campaignId: campaign.id,
              clientId,
              pauseMsg,
            });
            await db
              .from("campaign_dispatches")
              .update({
                status: "paused",
                error_message: pauseMsg,
                updated_at: new Date().toISOString(),
              })
              .eq("id", dispatchId);
            return false;
          }
        } catch (err) {
          console.warn("[campaign-dispatch] erro ao verificar janela de envio durante lote:", err?.message || err);
        }
      }

      return true;
    };

    // Cota diária no chip que de fato envia (o dono do webhook de envio). Reserva 1 unidade por mensagem, antes de enviar.
    // Webhook que não é de instância cadastrada → chip desconhecido: segue sem cota e o fato é registrado abaixo.
    const sendingChipId = chipIdFromDispatchSettings(dispatchSettings);
    const sendingChip = sendingChipId ? tenantInstances.find((i) => String(i.id).toLowerCase() === sendingChipId) || null : null;
    const quotaGate = createChipQuotaGate({ chip: sendingChip, timezone: tenantTimezone, pool: pgDatabasePool });

    const result = await dispatchCampaignSequence({
      webhookUrl,
      webhookToken,
      chipProvider,
      quotaGate,
      leads: validLeads,
      analyticsMeta: usaFluxoDeResposta
        ? {
            ...analyticsMeta,
            sequence: passosDoEnvio,
            dispatchOptions: { ...analyticsMeta.dispatchOptions, waitForReply: false },
          }
        : analyticsMeta,
      context: {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          mode: "campaign_dispatch_template",
          dispatchId,
          dispatchName: dispatch.name,
        },
        client: { id: clientId, name: await getClientName(clientId) },
        recurrence: occurrence.variantOffset != null ? { variantOffset: occurrence.variantOffset } : null,
      },
      onLeadClaim: claimLead,
      onLeadClaimRollback: rollbackClaimLead,
      // Marca "envio iniciado" no run antes da primeira chamada à Evolution (runSendMarker.js). false = não envia.
      onLeadSendStarting: async ({ lead, phone }) => {
        if (!pgDatabasePool) return true;
        return markRunSendStarted(pgDatabasePool, {
          dispatchId,
          leadId: lead?.id || null,
          phone: normalizeDispatchPhone(phone, lead),
        });
      },
      // Sequência cortada pelo desligamento: nota interna no run, contada no /health (restartBlockers).
      onLeadSequenceCut: async ({ lead, phone, passosEnviados, totalPassos }) => {
        if (!pgDatabasePool) return;
        await markRunSequenceCut(pgDatabasePool, {
          dispatchId,
          leadId: lead?.id || null,
          phone: normalizeDispatchPhone(phone, lead),
          passosEnviados,
          totalPassos,
        });
      },
      onLeadCheckOptout: checkOptout,
      onStepDispatched: async ({ lead, phone, step, sentAt, instanceName, activeChip }) => {
        runChipTracker.record(lead?.id, activeChip);
        try {
          const rawChip = activeChip?.instanceId || activeChip?.instanceName || instanceName || dispatch?.evolution_instance_id || campaign?.evolution_instance_id || null;
          const { canonicalName } = await resolveInstanceIdentifier({ clientId, identifier: rawChip });
          const chipName = canonicalName || rawChip;
          const mediaUrl = step.mediaUrl || step.media_url || step.image?.url || step.image?.dataUrl || null;
          const isImageStep = step.type === "image" || Boolean(mediaUrl);
          const contentType = isImageStep ? "image" : (step.contentType || step.content_type || "text");
          const stepCaption = step.caption || step.image?.caption || "";
          const messageText = step.message || step.text || stepCaption || (isImageStep ? (step.image?.name ? `[Imagem: ${step.image.name}]` : "[Imagem da Campanha]") : "");

          await appendLeadMessage({
            clientId,
            campaignId: campaign.id,
            leadId: null,
            phone,
            senderType: "bot",
            direction: "outbound",
            messageText,
            media_url: mediaUrl,
            mediaUrl,
            content_type: contentType,
            contentType,
            deliveredAt: sentAt || new Date().toISOString(),
            messageTimestamp: sentAt || new Date().toISOString(),
            instanceName: chipName,
            meta: {
              source: "campaign_dispatch",
              dispatchId,
              stepId: step.id,
              stepType: step.type,
              stepOrder: step.order,
              mediaUrl,
              media_url: mediaUrl,
              contentType,
              content_type: contentType,
            },
          });
        } catch (err) {
          console.warn("[campaign-dispatch] falha ao gravar lead_messages do passo:", err?.message || err);
        }
      },
      onLeadFailed: async ({ lead, phone, reason }) => {
        failedCount += 1;
        await finalizeLeadFailed({ lead, phone, reason });
      },
      onLeadDispatched: async ({ lead, phone, sentAt, lastStep, lastStepIndex }) => {
        sentCount += 1;
        await finalizeLeadSent({ lead, phone, sentAt });

        if (usaFluxoDeResposta) {
          await markCampaignLeadWaitingReply({
            clientId,
            lead,
            phone,
            campaign,
            step: lastStep,
            stepIndex: Number.isInteger(lastStepIndex) ? lastStepIndex : passosDoEnvio.length - 1,
            totalSteps: stepPlan.enabledSteps.length,
            dispatchedAt: sentAt || new Date().toISOString(),
            nextStepIndex: primeiroPassoAposResposta,
            status: "aguardando_usuario",
            dispatchId,
            occurrenceAt: occurrence?.occurrenceAt || null,
          }).catch((err) => {
            console.warn("[campaign-dispatch] falha ao gravar progresso de espera", {
              dispatchId,
              campaignId: campaign.id,
              error: err?.message || err,
            });
          });
        }
        const leadPatch = {
          status_conversa: "aguardando_usuario",
          ultima_interacao_bot: sentAt || new Date().toISOString(),
          followup_status: "pending",
          followup_scheduled_at: null,
        };
        const leadUpdate = lead?.id
          ? db
            .from("lead_import_items")
            .update(leadPatch)
            .eq("id", lead.id)
            .eq("client_id", clientId)
          : db
            .from("lead_import_items")
            .update(leadPatch)
            .eq("client_id", clientId)
            .in("telefone", phoneSpellingsOf(phone));
        const { error: leadUpdateError } = await leadUpdate;
        if (leadUpdateError) {
          console.warn("[campaign-dispatch] followup queue marker failed:", leadUpdateError.message || leadUpdateError);
        }
      },
      shouldContinue: isDispatchStillRunning,
      leadDelayProvider: Number.isFinite(dispatch.dispatch_options?.leadDelaySeconds)
        ? () => Math.max(Number(dispatch.dispatch_options.leadDelaySeconds), 0) * 1000
        : () => 30_000 + Math.floor(Math.random() * 60_001),
    });

    // Desligamento (SIGTERM, 21/11/2026): o motor parou no fim do passo atual. O lote fica 'running' como está, sem
    // nenhuma consulta a mais: o boot o pausa e a conferência decide os claimed (orphanRecovery.js, claimedConference.js).
    if (result?.summary?.shutdown) {
      console.warn("[campaign-dispatch] desligamento: lote parado no fim do passo atual; o boot retoma o controle", {
        dispatchId,
        clientId,
        enviadosNesteCiclo: sentCount,
      });
      return;
    }

    let totalSent = sentCount;
    let totalFailed = failedCount;
    let totalInvalid = 0;
    let totalSkipped = 0;
    const counts = await getDispatchRunCounts(pgDatabasePool, dispatchId);
    if (counts) {
      totalSent = Number(counts.sent ?? sentCount);
      totalFailed = Number(counts.failed ?? failedCount);
      totalInvalid = Number(counts.invalid ?? 0);
      totalSkipped = Number(counts.skipped ?? 0);
    } else {
      console.error(`[campaign-dispatch] contagem pós-envio falhou para lote ${dispatchId}. Status do lote NÃO será marcado como interrupted.`);
    }
    const totalProcessed = totalSent + totalFailed + totalInvalid + totalSkipped;
    // Mesma regra dos outros dois fechamentos (lote sem fila): sem alvo gravado, o alvo é o que foi processado.
    // Somar leads.length (o que acabou de sair) ao processado contava esses leads duas vezes: o agendador e o
    // run-pending liam o lote sem target_count e todo lote que enviava fechava "Interrompido: N pendentes" com N = o
    // que enviou (18 de 19 lotes 'interrupted' em produção estavam completos, 27/10/2026).
    const targetCount = Number(dispatch.target_count || 0) || totalProcessed;

    if (quotaGate.unidentifiedMessages > 0) {
      console.warn("[campaign-quota] mensagens enviadas sem cota (chip não identificado):", {
        dispatchId,
        clientId,
        mensagens: quotaGate.unidentifiedMessages,
        origemDoWebhook: dispatchSettings.source || null,
      });
    }

    if (quotaGate.unavailableMessages > 0) {
      console.error("[campaign-quota] mensagens enviadas sem cota (cota indisponível — erro de infraestrutura):", {
        dispatchId,
        clientId,
        mensagens: quotaGate.unavailableMessages,
      });
    }

    if (result?.summary?.chipDisconnected) {
      const chipDesc = result.summary.disconnectedChipName || "WhatsApp";
      await db.from("campaign_dispatches").update({
        status: "paused",
        sent_count: totalSent,
        failed_count: totalFailed,
        error_message: `Pausado — chip desconectado (${chipDesc}). Reconecte o chip em Conexões para retomar.`,
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      return;
    }

    if (result?.summary?.allChipsExhausted) {
      const quotaMsg = result.summary.exhaustedQuotaMessage || "Pausado — cota diária do chip atingida. Retoma amanhã.";
      await db.from("campaign_dispatches").update({
        status: "paused",
        sent_count: totalSent,
        failed_count: totalFailed,
        error_message: quotaMsg,
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      return;
    }

    if (result?.summary?.paused) {
      await db.from("campaign_dispatches").update({
        status: "paused",
        sent_count: totalSent,
        failed_count: totalFailed,
        error_message: customPauseReason || "Disparo pausado manualmente.",
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      return;
    }

    // REGRA RÍGIDA: Lote só pode ser 'done' quando TODO lead tiver um desfecho registrado.
    // Mas se a contagem do banco falhou, NUNCA marca 'interrupted' por falta de dados.
    if (counts && targetCount > 0 && totalProcessed < targetCount) {
      const pendingCount = targetCount - totalProcessed;
      const finalMsg = describeInterruptedPending({ pendingCount, claimedCount: counts.claimed });
      await db.from("campaign_dispatches").update({
        status: "interrupted",
        sent_count: totalSent,
        failed_count: totalFailed,
        error_message: finalMsg,
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      return;
    }

    // Contagem falhou nas duas tentativas: grava só os números deste envio (o que o motor viu) e sai de 'running' com o
    // motivo. Até 16/11/2026 o lote ficava 'running' até o próximo boot.
    if (!counts) {
      await db.from("campaign_dispatches").update({
        sent_count: totalSent,
        failed_count: totalFailed,
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      await markDispatchCountUnavailable(db, dispatchId);
      return;
    }

    await db.from("campaign_dispatches").update({
      status: "done",
      sent_count: totalSent,
      failed_count: totalFailed,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: chipMismatchWarning || null,
    }).eq("id", dispatchId);
  }

  return { runCampaignDispatchSemRegistro };
}
