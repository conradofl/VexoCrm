// BullMQ Worker — executa cada job de follow-up agendado.
// Regras:
//  - campanha "paused"   → re-adiciona na fila com delay 5 min (sem contar como falha)
//  - campanha "archived" → skipped
//  - schedule "canceled" → skipped
//  - trigger no_reply    → verifica followup_replies; se respondeu → skipped
//  - 3 tentativas com backoff de 30s; após todas: status "failed"
import { Worker } from "bullmq";
import { query, getPool } from "./db.js";
import { QUEUE_NAME, getRedisConnection, getFollowupQueue } from "./queue.js";
import { applyMessagePlaceholders } from "../services/messagePlaceholders.js";
import { validateOutboundMessage } from "../services/jsonExtractor.js";
import { sanitizeAgreementForMessage, hasConfirmedAgreement } from "../services/leadAgreement.js";

import {
  getLeadClientEvolutionInstances,
  parseEvolutionWebhookEndpoint,
  sendMediaMessageViaEvolution,
} from "../services/evolution.js";
import { getFollowupMediaBuffer } from "../services/storage.js";
import { normalizeString } from "../textNormalize.js";
import {
  isWithinSendWindow,
  getNextSendWindowOpening,
  resolveSendWindowConfig,
  createDateInTimezone,
  getPartsInTimezone,
} from "../services/sendWindow.js";
import { getLeadClientN8nSettings } from "../services/n8nSettings.js";
import { SQL_CANONICAL_PHONE } from "../services/canonicalPhone.js";
import { isWonStage, isLostStage, hasFollowupReplySince } from "../services/followupExitGuard.js";
import { registerSystemSentFromResponse } from "../services/systemSentMessages.js";
import {
  resolveChipDailyLimit,
  reserveChipDailyQuota,
  releaseChipDailyQuota,
  setChipQuotaDbPool,
} from "../services/chipQuota.js";
import { getDateKey } from "../services/analytics.js";
import { pgDatabasePool } from "../services/database.js";
import { leadsTableName } from "../services/tenant.js";
import { evaluateStepConditions } from "./service.js";
import { getTemplateLibraryAudioId, loadAudioForSend } from "../audioLibrary/service.js";
import { isPhoneOptedOut } from "../services/optOut.js";
import { enviarMensagemWhatsAppComFallback } from "../domains/goclaw/heloisaEngine.js";
import {
  getTrelloCardStatus,
  isCardInApprovalOrDone,
  formatarPrazoAmigavel,
} from "../services/trelloService.js";

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

export function getFollowupWorkerDbPool() {
  try {
    const p = getPool();
    if (p) return p;
  } catch {}
  if (pgDatabasePool) return pgDatabasePool;
  return null;
}

// `preloadedInstances` (Etapa 5 Commit 3): quando o chamador já buscou a lista de
// instâncias do tenant (ex.: resolvendo o chip de N empresas na mesma requisição da
// faixa "Próximos 7 dias"), passa aqui pra pular a query repetida — mesma lógica de
// casamento, sem duplicar a implementação e sem N buscas redundantes ao banco.
export async function resolveEvolutionInstanceForFollowup(tenantId, instanceNameOrId, preloadedInstances = null) {
  if (!tenantId) {
    throw new Error("tenant_id não informado para resolução da instância de follow-up.");
  }

  const instances = preloadedInstances || (await getLeadClientEvolutionInstances(tenantId));
  const activeInstances = Array.isArray(instances) ? instances.filter((i) => i.active !== false) : [];

  if (activeInstances.length === 0) {
    throw new Error(
      `Nenhum WhatsApp/chip ativo conectado para o tenant '${tenantId}'. Conecte um chip em Canais & Chips.`
    );
  }

  const alvo = normalizeString(instanceNameOrId);
  let matched = null;

  if (alvo) {
    matched = activeInstances.find((inst) => {
      const parsed = parseEvolutionWebhookEndpoint(inst.dispatch_webhook_url);
      const urlInstance = parsed?.instance || null;
      return (
        inst.name === alvo ||
        inst.id === alvo ||
        urlInstance === alvo ||
        inst.name.toLowerCase() === alvo.toLowerCase()
      );
    });
  }

  if (!matched) {
    // Se não encontrou o nome exato (ex: renomeado ou slug legado), faz fallback para a instância padrão do tenant
    matched = activeInstances.find((i) => i.is_default === true) || activeInstances[0];
  }

  if (!matched || !matched.dispatch_webhook_url) {
    const available = activeInstances.map((i) => `"${i.name}"`).join(", ");
    throw new Error(
      `Instância WhatsApp '${alvo || 'padrão'}' não encontrada para o tenant '${tenantId}'. Instâncias ativas disponíveis: [${available}].`
    );
  }

  const parsed = parseEvolutionWebhookEndpoint(matched.dispatch_webhook_url);
  const instanceSlug = parsed?.instance || matched.name;
  const baseUrl = parsed?.origin || process.env.EVOLUTION_API_URL;
  const apiKey = matched.dispatch_webhook_token || process.env.EVOLUTION_API_KEY;

  return {
    instanceSlug,
    displayName: matched.name,
    webhookUrl: matched.dispatch_webhook_url,
    apiKey,
    baseUrl,
    rawInstance: matched,
    instanceId: matched.id || instanceSlug,
  };
}

function renderMessage(template, { lead_name, meeting_datetime, phone = "", dados = null }) {
  return applyMessagePlaceholders(
    template,
    { nome: lead_name, lead_name, dados },
    phone,
    { meeting_datetime }
  );
}

export async function sendViaEvolution({ baseUrl, apiKey, instanceSlug, phone, text }) {
  const resolvedBaseUrl = (baseUrl || process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
  const resolvedApiKey = apiKey || process.env.EVOLUTION_API_KEY;

  if (!resolvedBaseUrl || !resolvedApiKey) {
    throw new Error("EVOLUTION_API_URL ou EVOLUTION_API_KEY não configurado no servidor.");
  }

  // Guarda de saída obrigatória
  const guard = validateOutboundMessage(text);
  if (!guard.valid) {
    console.error("[followup/worker] BLOQUEIO DE SEGURANÇA: Mensagem contém variável não substituída ou formato inválido. Envio cancelado!", {
      phone,
      instance: instanceSlug,
      motivo: guard.reason,
      textoCompleto: text,
      origem: "followup_worker",
    });
    const error = new Error(`[BLOQUEIO_GUARDA_SAIDA] Mensagem bloqueada: ${guard.reason}`);
    error.code = "OUTBOUND_GUARD_BLOCKED";
    error.reason = guard.reason;
    throw error;
  }

  const url = `${resolvedBaseUrl}/message/sendText/${encodeURIComponent(instanceSlug)}`;
  const hasUrl = /https?:\/\/[^\s]+/i.test(text);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: resolvedApiKey,
    },
    body: JSON.stringify({
      number: phone,
      text,
      linkPreview: hasUrl,
      generateHighQualityLinkPreview: hasUrl,
      options: {
        delay: 1200,
        presence: "composing",
        linkPreview: hasUrl,
        generateHighQualityLinkPreview: hasUrl,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Evolution API ${res.status} (${instanceSlug}): ${body.slice(0, 200)}`);
  }
  registerSystemSentFromResponse(await res.text().catch(() => ""));
}

export async function processJob(job) {
  const isMock = job?.data?.isMock || job?.isMock;
  if (isMock) {
    console.log(`[followup/worker] Job processado (mock): ${job?.id || job}`);
    return;
  }

  const jobId = typeof job === "string" ? job : (job?.data?.jobId || job?.jobId);
  const customMessage = job?.data?.customMessage || job?.customMessage;

  const { rows: jobRows } = await query(
    `SELECT fj.id, fj.schedule_id, fj.template_id, fj.custom_message, fj.status as job_status,
            fj.media_path as job_media_path, fj.media_type as job_media_type, fj.media_mime as job_media_mime, fj.media_filename as job_media_filename,
            fs.lead_name, fs.phone, fs.meeting_datetime, fs.status as schedule_status,
            fs.campaign_id, fs.company_id, fs.created_at as schedule_created_at,
            ft.message, ft.trigger_type,
            ft.step_type, ft.action_type, ft.action_payload, ft.conditions,
            ft.media_path as template_media_path, ft.media_type as template_media_type, ft.media_mime as template_media_mime, ft.media_filename as template_media_filename,
            fc.status as campaign_status,
            fc.exit_on_reply, fc.exit_on_won, fc.exit_on_lost, fc.exit_on_human_takeover,
            fco.tenant_id,
            fco.evolution_instance,
            fco.evolution_instances
       FROM followup_jobs       fj
       JOIN followup_schedules  fs  ON fs.id = fj.schedule_id
       LEFT JOIN followup_templates  ft  ON ft.id = fj.template_id
       LEFT JOIN followup_campaigns  fc  ON fc.id = fs.campaign_id
       JOIN followup_companies  fco ON fco.id = fs.company_id
      WHERE fj.id = $1`,
    [jobId]
  );

  if (!jobRows.length) {
    console.warn("[followup/worker] job não encontrado no banco:", jobId);
    return;
  }

  const row = jobRows[0];
  const log = `[followup/worker][${row.campaign_id || 'no-campaign'}][${row.lead_name}]`;

  // 1. Guarda: Se o job já não estiver pendente (ex: cancelled, skipped, sent), aborta imediatamente
  if (row.job_status !== "pending") {
    console.log(log, `job já processado ou cancelado (status: ${row.job_status}) — abortando`);
    return;
  }

  if (row.campaign_status === "paused") {
    // Re-adiciona o mesmo payload com delay de 5 min; job atual termina sem erro
    const pauseBullJob = await getFollowupQueue().add(
      "send-followup",
      { jobId, customMessage: customMessage || row.custom_message },
      { delay: 5 * 60 * 1000, jobId: `fup-pause-${jobId}-${Date.now()}` }
    );
    await query("UPDATE followup_jobs SET bull_job_id=$1 WHERE id=$2", [pauseBullJob.id, jobId]).catch(() => {});
    console.log(log, "campanha pausada — reagendado em 5 min");
    return;
  }

  // Validação da janela de envio permitida do tenant
  let sendWindowConfig = null;
  if (row.tenant_id) {
    try {
      const tenantSettings = await getLeadClientN8nSettings(row.tenant_id);
      sendWindowConfig = resolveSendWindowConfig(tenantSettings);
      if (!isWithinSendWindow(new Date(), sendWindowConfig)) {
        const nextOpening = getNextSendWindowOpening(new Date(), sendWindowConfig);
        const delay = Math.max(1000, nextOpening.getTime() - Date.now());

        await query("UPDATE followup_jobs SET scheduled_for=$1 WHERE id=$2", [
          nextOpening.toISOString(),
          jobId,
        ]);

        const windowBullJob = await getFollowupQueue().add(
          "send-followup",
          { jobId, customMessage: customMessage || row.custom_message },
          { delay, jobId: `fup-window-${jobId}-${nextOpening.getTime()}` }
        );
        await query("UPDATE followup_jobs SET bull_job_id=$1 WHERE id=$2", [windowBullJob.id, jobId]).catch(() => {});
        console.log(
          log,
          `fora da janela de envio (${sendWindowConfig.start}–${sendWindowConfig.end}) — reagendado para ${nextOpening.toISOString()}`
        );
        return;
      }
    } catch (wErr) {
      console.warn("[followup/worker] erro ao checar janela de envio:", wErr?.message || wErr);
    }
  }

  if (row.campaign_status === "archived" || row.schedule_status === "cancelled" || row.schedule_status === "canceled") {
    await query("UPDATE followup_jobs SET status='skipped' WHERE id=$1", [jobId]);
    console.log(log, "skipped (archived/cancelled schedule)");
    return;
  }

  // 1b. Opt-out: quem pediu para sair não recebe passo de cadência, venha a inscrição de onde vier (tela, lembrete,
  // sugestão aprovada, webhook). Fonte única em services/optOut.js. Erro de leitura = não envia (nunca libera).
  if (row.tenant_id && row.phone) {
    let optedOut = false;
    let motivo = "Lead pediu para não receber mensagens (opt-out)";
    try {
      optedOut = await isPhoneOptedOut({ query }, { clientId: String(row.tenant_id), phone: row.phone });
    } catch (optErr) {
      optedOut = true;
      motivo = `Falha ao checar opt-out; passo não enviado: ${optErr?.message || optErr}`;
      console.error(log, motivo);
    }
    if (optedOut) {
      await query("UPDATE followup_jobs SET status='skipped', error_log=$1 WHERE id=$2", [motivo, jobId]);
      console.log(log, "skipped — opt-out");
      return;
    }
  }

  // 2. Condição de saída: Resposta do lead (trigger no_reply ou exit_on_reply).
  // Só conta resposta recebida DEPOIS da inscrição (fs.created_at): resposta antiga
  // do mesmo telefone não pode fazer o lead pular a cadência nova.
  const checksReply = row.trigger_type === "no_reply" || row.exit_on_reply !== false;
  if (checksReply && row.phone && (row.tenant_id || row.company_id)) {
    const replied = await hasFollowupReplySince({
      tenantId: row.tenant_id,
      companyId: row.company_id,
      phone: row.phone,
      since: row.schedule_created_at,
      queryFn: query,
    });
    if (replied) {
      await query("UPDATE followup_jobs SET status='skipped' WHERE id=$1", [jobId]);
      console.log(log, `skipped — lead respondeu depois da inscrição (${row.trigger_type === "no_reply" ? "trigger no_reply" : "exit_on_reply"})`);
      return;
    }
  }

  // 3. Condição de saída: Estágio do Lead (exit_on_won / exit_on_lost)
  if ((row.exit_on_won !== false || row.exit_on_lost !== false) && row.tenant_id && row.phone) {
    try {
      const { rows: leads } = await query(
        `SELECT stage, status FROM public.leads
          WHERE client_id = $1
            AND ${SQL_CANONICAL_PHONE("telefone")} = ${SQL_CANONICAL_PHONE("$2::text")}
          LIMIT 1`,
        [row.tenant_id, row.phone]
      );
      if (leads.length) {
        const leadStage = leads[0].stage || leads[0].status;
        if (row.exit_on_won !== false && isWonStage(leadStage)) {
          await query("UPDATE followup_jobs SET status='skipped' WHERE id=$1", [jobId]);
          console.log(log, `skipped — lead já converteu/ganho (${leadStage})`);
          return;
        }
        if (row.exit_on_lost !== false && isLostStage(leadStage)) {
          await query("UPDATE followup_jobs SET status='skipped' WHERE id=$1", [jobId]);
          console.log(log, `skipped — lead descartado/perdido (${leadStage})`);
          return;
        }
      }
    } catch (leadCheckErr) {
      console.warn(log, "aviso ao checar estágio do lead:", leadCheckErr?.message || leadCheckErr);
    }
  }

  // 4. Condição de saída: Atendimento humano assumiu (exit_on_human_takeover)
  if (row.exit_on_human_takeover !== false && row.tenant_id && row.phone) {
    try {
      const { rows: chats } = await query(
        `SELECT attended_at FROM public.whatsapp_chat_states
          WHERE client_id = $1
            AND ${SQL_CANONICAL_PHONE("phone")} = ${SQL_CANONICAL_PHONE("$2::text")}
            AND attended_at IS NOT NULL
          LIMIT 1`,
        [row.tenant_id, row.phone]
      );
      if (chats.length) {
        await query("UPDATE followup_jobs SET status='skipped' WHERE id=$1", [jobId]);
        console.log(log, "skipped — conversa já foi assumida humanamente (takeover)");
        return;
      }
    } catch (takeoverCheckErr) {
      console.warn(log, "aviso ao checar takeover humano:", takeoverCheckErr?.message || takeoverCheckErr);
    }
  }

  // 5. Avaliação de Condições antes do disparo (Passo Condicional)
  if (row.conditions && Array.isArray(row.conditions) && row.conditions.length > 0 && row.tenant_id && row.phone) {
    const table = leadsTableName(row.tenant_id);
    const { rows: leadRows } = await query(
      `SELECT * FROM public."${table}"
        WHERE client_id = $1
          AND ${SQL_CANONICAL_PHONE("telefone")} = ${SQL_CANONICAL_PHONE("$2::text")}
        LIMIT 1`,
      [row.tenant_id, row.phone]
    );
    const leadData = leadRows[0] || {};
    const check = evaluateStepConditions(row.conditions, leadData);
    if (!check.passed) {
      await query("UPDATE followup_jobs SET status='skipped' WHERE id=$1", [jobId]);
      console.log(log, `skipped — condição do passo não atendida: ${check.reason}`);
      return; // Pula somente este passo. Cadência segue viva!
    }
  }

  // 6. Execução de Ação Interna (step_type === 'internal_action')
  if (row.step_type === "internal_action") {
    const payload = row.action_payload || {};
    const table = leadsTableName(row.tenant_id);
    switch (row.action_type) {
      case "create_reminder": {
        const title = payload.title || row.custom_message || row.message || "Lembrete de Follow-up";
        const notes = payload.notes || "";
        const remindAt = payload.remind_at || new Date().toISOString();
        await query(
          `INSERT INTO public.lead_reminders (client_id, phone, lead_name, title, notes, remind_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
          [row.tenant_id, row.phone, row.lead_name, title, notes, remindAt]
        );
        break;
      }
      case "change_stage": {
        if (payload.stage) {
          await query(
            `UPDATE public."${table}"
                SET stage = $1, updated_at = now()
              WHERE client_id = $2
                AND ${SQL_CANONICAL_PHONE("telefone")} = ${SQL_CANONICAL_PHONE("$3::text")}`,
            [payload.stage, row.tenant_id, row.phone]
          );
        }
        break;
      }
      case "assign_operator": {
        if (payload.assigned_to) {
          await query(
            `UPDATE public."${table}"
                SET assigned_to = $1, updated_at = now()
              WHERE client_id = $2
                AND ${SQL_CANONICAL_PHONE("telefone")} = ${SQL_CANONICAL_PHONE("$3::text")}`,
            [payload.assigned_to, row.tenant_id, row.phone]
          );
        }
        break;
      }
      case "add_tag": {
        if (payload.tag) {
          await query(
            `UPDATE public."${table}"
                SET tags = array_append(COALESCE(tags, ARRAY[]::text[]), $1), updated_at = now()
              WHERE client_id = $2
                AND ${SQL_CANONICAL_PHONE("telefone")} = ${SQL_CANONICAL_PHONE("$3::text")}
                AND NOT ($1 = ANY(COALESCE(tags, ARRAY[]::text[])))`,
            [payload.tag, row.tenant_id, row.phone]
          );
        }
        break;
      }
      default:
        console.warn(log, `Ação interna desconhecida: ${row.action_type}`);
        break;
    }
    // Marca o job como executado com sucesso e encerra
    await query("UPDATE followup_jobs SET status='sent', sent_at=now() WHERE id=$1", [jobId]);
    console.log(log, `ação interna executada com sucesso (${row.action_type})`);
    return;
  }

  const rawMessage = customMessage || row.custom_message || row.message || "";
  const usesAcordo = /\{\{\s*(?:acordo|combinado)\s*\}\}/i.test(rawMessage);

  let leadDados = null;
  if ((usesAcordo || row.conditions) && row.tenant_id && row.phone) {
    try {
      const table = leadsTableName(row.tenant_id);
      const { rows: leadRows } = await query(
        `SELECT dados FROM public."${table}"
          WHERE client_id = $1
            AND ${SQL_CANONICAL_PHONE("telefone")} = ${SQL_CANONICAL_PHONE("$2::text")}
          LIMIT 1`,
        [row.tenant_id, row.phone]
      );
      leadDados = leadRows[0]?.dados || null;
    } catch (e) {
      console.warn(log, "aviso ao buscar dados do lead:", e?.message || e);
    }
  }

  // Validação estrita de acordo comercial:
  // Só pode ser citado após confirmação humana explícita. Sem confirmação, não envia.
  // Acordo que excede o limite de tamanho também não é enviado para não truncar frase.
  if (usesAcordo) {
    const isConfirmed = hasConfirmedAgreement({ dados: leadDados });
    if (!isConfirmed) {
      const reasonMsg = "Passo não enviado: lead sem acordo confirmado para variável {{acordo}}";
      await query("UPDATE followup_jobs SET status='skipped', error_log=$1 WHERE id=$2", [reasonMsg, jobId]);
      console.log(log, `skipped — ${reasonMsg}`);
      return;
    }

    const cleanAcordo = sanitizeAgreementForMessage(leadDados?.acordo?.texto);
    if (!cleanAcordo) {
      const reasonMsg = "Passo não enviado: acordo confirmado excede limite de tamanho e não pode ser truncado";
      await query("UPDATE followup_jobs SET status='skipped', error_log=$1 WHERE id=$2", [reasonMsg, jobId]);
      console.log(log, `skipped — ${reasonMsg}`);
      return;
    }
  }

  const text = renderMessage(rawMessage, {
    lead_name: row.lead_name,
    meeting_datetime: row.meeting_datetime,
    phone: row.phone,
    dados: leadDados,
  });

  // Guarda de saída obrigatória (válida tanto para mensagem textual pura quanto para legenda de mídia)
  const guard = validateOutboundMessage(text);
  if (!guard.valid) {
    console.error("[followup/worker] BLOQUEIO DE SEGURANÇA: Mensagem ou legenda contém variável não substituída ou formato inválido.", {
      phone: row.phone,
      instance: row.evolution_instance,
      motivo: guard.reason,
      textoCompleto: text,
      origem: "followup_worker",
    });
    const error = new Error(`[BLOQUEIO_GUARDA_SAIDA] Mensagem bloqueada: ${guard.reason}`);
    error.code = "OUTBOUND_GUARD_BLOCKED";
    error.reason = guard.reason;
    throw error;
  }

  // Resolução de anexo de mídia (job sobrepõe template; ausente falha estrito)
  let effectiveMediaPath = row.job_media_path || row.template_media_path;
  let effectiveMediaType = row.job_media_type || row.template_media_type;
  let effectiveMediaMime = row.job_media_mime || row.template_media_mime;
  let effectiveMediaFilename = row.job_media_filename || row.template_media_filename;

  let mediaData = null;

  // Áudio da Biblioteca de Áudios apontado pelo passo. Anexo trocado no
  // próprio job continua vencendo (é ajuste manual daquele envio). O áudio é
  // carregado pelo tenant DONO DO JOB: se o passo apontar para áudio de outra
  // empresa, arquivado ou sem arquivo, o job falha com o motivo e nada é
  // enviado — nunca cai para o texto do passo, que seria mandar "Áudio: nome"
  // para o lead.
  const libraryAudioId = row.job_media_path
    ? null
    : await getTemplateLibraryAudioId({ query }, row.template_id);
  if (libraryAudioId) {
    const loaded = await loadAudioForSend({ query }, { audioId: libraryAudioId, clientId: row.tenant_id });
    if (!loaded.ok) {
      const libraryErr = `Áudio da biblioteca indisponível (${loaded.reason}); passo não enviado.`;
      console.error(log, libraryErr, { audioId: libraryAudioId });
      await query("UPDATE followup_jobs SET status='failed', error_log=$1 WHERE id=$2", [libraryErr, jobId]);
      const err = new Error(libraryErr);
      err.code = "AUDIO_LIBRARY_UNAVAILABLE";
      throw err;
    }
    mediaData = { buffer: loaded.buffer, contentType: loaded.audio.mime_type };
    effectiveMediaPath = loaded.audio.storage_key;
    effectiveMediaType = "audio";
    effectiveMediaMime = loaded.audio.mime_type;
    effectiveMediaFilename = loaded.audio.name;
  }

  if (effectiveMediaPath && !mediaData) {
    try {
      mediaData = await getFollowupMediaBuffer(effectiveMediaPath);
    } catch (readErr) {
      console.error(log, "falha ao ler mídia do storage:", readErr?.message || readErr);
    }

    if (!mediaData || !mediaData.buffer || mediaData.buffer.length === 0) {
      const missingMediaErr = `Arquivo de mídia não encontrado no storage: ${effectiveMediaPath}`;
      console.error(log, missingMediaErr);
      await query(
        "UPDATE followup_jobs SET status='failed', error_log=$1 WHERE id=$2",
        [missingMediaErr, jobId]
      );
      const err = new Error(missingMediaErr);
      err.code = "MEDIA_NOT_FOUND";
      throw err;
    }
  }

  // Resolve a instância oficial na tabela central de chips do tenant (lead_client_evolution_instances)
  const evoConfig = await resolveEvolutionInstanceForFollowup(
    row.tenant_id,
    row.evolution_instance
  );

  // Anti-ban: reserva de cota diária por chip antes de enviar
  const workerPool = getFollowupWorkerDbPool();
  if (!workerPool) {
    throw new Error("[followup/worker] Pool de banco de dados indisponível para validação de cota.");
  }
  setChipQuotaDbPool(workerPool);

  const chipInstanceId = String(evoConfig.instanceId || evoConfig.rawInstance?.id || evoConfig.instanceSlug);
  const chipLimit = resolveChipDailyLimit(evoConfig.rawInstance);
  if (!sendWindowConfig) {
    sendWindowConfig = resolveSendWindowConfig({});
  }
  const tenantTz = sendWindowConfig.timezone || "America/Sao_Paulo";
  const todayKey = getDateKey(new Date(), tenantTz);

  const reserved = await reserveChipDailyQuota(chipInstanceId, todayKey, workerPool);
  if (reserved === null) {
    throw new Error(`[followup/worker] Falha ao reservar cota para a instância ${chipInstanceId}`);
  }

  if (reserved > chipLimit) {
    // 1. Libera a cota reservada em excesso
    await releaseChipDailyQuota(chipInstanceId, todayKey, workerPool);

    // 2. Calcula próxima abertura de janela do dia seguinte
    let nextOpening = getNextSendWindowOpening(new Date(), sendWindowConfig);
    const nowParts = getPartsInTimezone(new Date(), tenantTz);
    const nextParts = getPartsInTimezone(nextOpening, tenantTz);
    if (nowParts.year === nextParts.year && nowParts.month === nextParts.month && nowParts.day === nextParts.day) {
      const tomorrowMidnight = createDateInTimezone(nowParts.year, nowParts.month, nowParts.day + 1, 0, 1, 0, tenantTz);
      nextOpening = getNextSendWindowOpening(tomorrowMidnight, sendWindowConfig);
    }

    const delay = Math.max(1000, nextOpening.getTime() - Date.now());
    const quotaMsg = `Cota diária do chip atingida (${chipLimit}/${chipLimit}) para a instância ${evoConfig.displayName || chipInstanceId}. Reagendado para a próxima abertura de janela.`;

    console.warn(log, quotaMsg, { nextOpening: nextOpening.toISOString(), limit: chipLimit, reserved });

    // 3. Adia o job: mantém status pending, atualiza scheduled_for e error_log
    await query(
      "UPDATE followup_jobs SET scheduled_for=$1, error_log=$2 WHERE id=$3",
      [nextOpening.toISOString(), quotaMsg, jobId]
    );

    const quotaBullJob = await getFollowupQueue().add(
      "send-followup",
      { jobId, customMessage: customMessage || row.custom_message },
      { delay, jobId: `fup-quota-${jobId}-${nextOpening.getTime()}` }
    );
    await query("UPDATE followup_jobs SET bull_job_id=$1 WHERE id=$2", [
      quotaBullJob.id,
      jobId,
    ]).catch(() => {});

    return;
  }

  try {
    if (effectiveMediaPath && mediaData) {
      await sendMediaMessageViaEvolution({
        instanceName: evoConfig.instanceSlug,
        number: row.phone,
        mediaType: effectiveMediaType || "document",
        base64: mediaData.buffer.toString("base64"),
        mimetype: effectiveMediaMime || mediaData.contentType || "application/octet-stream",
        fileName: effectiveMediaFilename || `${effectiveMediaType || "anexo"}`,
        caption: text,
        webhookToken: evoConfig.apiKey,
        baseUrl: evoConfig.baseUrl,
      });
    } else {
      await sendViaEvolution({
        baseUrl: evoConfig.baseUrl,
        apiKey: evoConfig.apiKey,
        instanceSlug: evoConfig.instanceSlug,
        phone: row.phone,
        text,
      });
    }
  } catch (sendErr) {
    // Falha na Evolution API: libera a cota reservada imediatamente
    await releaseChipDailyQuota(chipInstanceId, todayKey, workerPool);
    throw sendErr;
  }

  await query(
    "UPDATE followup_jobs SET status='sent', sent_at=NOW(), error_log=NULL WHERE id=$1",
    [jobId]
  );
  console.log(log, `mensagem ${effectiveMediaPath ? 'com mídia ' : ''}enviada via Evolution API (${evoConfig.displayName} -> ${evoConfig.instanceSlug})`);
}

export async function processHeloisaScheduledWhatsappJob(job) {
  const { numero, texto, instanceName, tenantId } = job?.data || {};
  const pool = getFollowupWorkerDbPool() || pgDatabasePool;

  console.log(`[followup/worker] ⏰ Disparando lembrete programado da Heloísa para ${numero}: "${texto}"`);
  const res = await enviarMensagemWhatsAppComFallback({
    numero,
    texto,
    instanceName: instanceName || "vexo-adm-vexo-atende",
    tenantId: tenantId || "geracao-digital",
    pool,
  });
  console.log(`[followup/worker] ✅ Lembrete enviado com sucesso para ${numero} via ${res?.instanceName}!`);
  return res;
}

/**
 * Worker de checagem condicional de cards do Trello (D-2, D-1, D-0)
 * REGRA DE OURO: Se o card estiver em aprovação ou concluído, a cobrança é SUPRIMIDA.
 */
export async function processTrelloCardFollowupCheckJob(job, customPool = null) {
  const { cardId, marco = "D-1", monitorId } = job?.data || {};
  if (!cardId) {
    console.warn("[followup/worker] [Trello] Job sem cardId informado. Descartando.");
    return { cobrancaDispensada: true, motivo: "card_id_ausente" };
  }

  const pool = customPool || getFollowupWorkerDbPool() || pgDatabasePool;

  // 1. Busca dados do monitoramento no banco
  let monitor = null;
  if (pool && typeof pool.query === "function") {
    try {
      if (monitorId) {
        const { rows } = await pool.query(
          `SELECT * FROM public.gd_trello_card_monitors WHERE id = $1 OR trello_card_id = $2 LIMIT 1`,
          [monitorId, cardId]
        );
        if (rows && rows.length > 0) monitor = rows[0];
      } else {
        const { rows } = await pool.query(
          `SELECT * FROM public.gd_trello_card_monitors WHERE trello_card_id = $1 LIMIT 1`,
          [cardId]
        );
        if (rows && rows.length > 0) monitor = rows[0];
      }
    } catch (errDb) {
      console.warn("[followup/worker] [Trello] Aviso ao buscar monitor no banco:", errDb.message);
    }
  }

  // 2. Verifica se a cobrança deste marco já foi enviada
  if (monitor) {
    if (marco === "D-2" && monitor.cobranca_d2_enviada) {
      return { cobrancaDispensada: true, cobrancaEnviada: false, jaEnviada: true, marco };
    }
    if (marco === "D-1" && monitor.cobranca_d1_enviada) {
      return { cobrancaDispensada: true, cobrancaEnviada: false, jaEnviada: true, marco };
    }
    if (marco === "D-0" && monitor.cobranca_d0_enviada) {
      return { cobrancaDispensada: true, cobrancaEnviada: false, jaEnviada: true, marco };
    }
  }

  // 3. Consulta status do Trello em tempo real (Wandinha / Síndica)
  let cardStatus = null;
  try {
    cardStatus = await getTrelloCardStatus({ cardId });
  } catch (errTrello) {
    console.error(`[followup/worker] [Trello] Falha ao consultar card ${cardId}:`, errTrello.message);
    return { cobrancaDispensada: true, erro: errTrello.message };
  }

  const listName = cardStatus?.listName || "";
  const dueComplete = Boolean(cardStatus?.dueComplete);

  // 4. REGRA DE OURO (Supressão de Cobrança da Mortícia)
  if (isCardInApprovalOrDone({ listName, dueComplete })) {
    console.log(
      `[Mortícia/Trello] Card ${cardId} já em status '${listName}'. Cobrança dispensada!`
    );

    if (pool && typeof pool.query === "function") {
      try {
        await pool.query(
          `UPDATE public.gd_trello_card_monitors
              SET status_final = $2, updated_at = NOW()
            WHERE trello_card_id = $1`,
          [cardId, listName || "aprovado"]
        );
      } catch (errUp) {
        console.warn("[followup/worker] [Trello] Erro ao atualizar status_final:", errUp.message);
      }
    }

    return {
      cobrancaDispensada: true,
      cobrancaEnviada: false,
      motivo: "card_em_aprovacao_ou_concluido",
      listName,
      marco,
    };
  }

  // 5. Cobrança ativa da Mortícia: formata e dispara mensagem no WhatsApp do colaborador
  const colabNome = monitor?.colaborador_nome || job.data?.colaboradorNome || "Colega";
  const colabTelefone = monitor?.colaborador_telefone || job.data?.colaboradorTelefone;
  const titulo = monitor?.titulo || cardStatus?.name || job.data?.titulo || "Demanda no Trello";
  const dueDate = monitor?.due_date || cardStatus?.due || job.data?.dueDateStr;
  const dataPrazo = formatarPrazoAmigavel(dueDate);

  let mensagemTexto = "";
  if (marco === "D-2") {
    mensagemTexto = `Oi ${colabNome}! Passando para lembrar que faltam 2 dias para o prazo da demanda *${titulo}*. Tudo certo para entrega em ${dataPrazo}?`;
  } else if (marco === "D-1") {
    mensagemTexto = `Atenção ${colabNome}! A demanda *${titulo}* vence amanhã (${dataPrazo}). Se precisar de apoio ou estiver travado, avise aqui!`;
  } else {
    // D-0
    mensagemTexto = `🚨 ${colabNome}, hoje é o dia de entrega da demanda *${titulo}*! Já finalizou ou enviou para aprovação?`;
  }

  if (colabTelefone) {
    try {
      await enviarMensagemWhatsAppComFallback({
        numero: colabTelefone,
        texto: mensagemTexto,
        instanceName: "vexo-adm-vexo-atende",
        tenantId: "geracao-digital",
        pool,
      });
      console.log(`[Mortícia/Trello] ✅ Notificação ${marco} enviada para ${colabNome} (${colabTelefone})`);
    } catch (errSend) {
      console.error(`[Mortícia/Trello] Falha ao enviar WhatsApp para ${colabTelefone}:`, errSend.message);
    }
  }

  // 6. Atualiza flags no banco de dados
  if (pool && typeof pool.query === "function") {
    try {
      await pool.query(
        `UPDATE public.gd_trello_card_monitors
            SET cobranca_d2_enviada = CASE WHEN $2 = 'D-2' THEN true ELSE cobranca_d2_enviada END,
                cobranca_d1_enviada = CASE WHEN $2 = 'D-1' THEN true ELSE cobranca_d1_enviada END,
                cobranca_d0_enviada = CASE WHEN $2 = 'D-0' THEN true ELSE cobranca_d0_enviada END,
                updated_at = NOW()
          WHERE trello_card_id = $1`,
        [cardId, marco]
      );
    } catch (errUp) {
      console.warn("[Mortícia/Trello] Aviso ao registrar cobrança enviada no banco:", errUp.message);
    }
  }

  return {
    cobrancaDispensada: false,
    cobrancaEnviada: true,
    marco,
    colaborador: colabNome,
    telefone: colabTelefone,
    mensagem: mensagemTexto,
  };
}

/**
 * Disjuntor de 4 Dias do Caio (Geração Digital):
 * Verifica após 4 dias se o contrato foi assinado e/ou pagamento foi efetuado.
 * Se ainda pendente, alerta Caio no WhatsApp com opção de pausa manual.
 */
export async function processGdDisjuntorContratoCheckJob(job, customPool = null) {
  const { clienteId, clienteNome, valor } = job.data || {};
  const pool = customPool || getFollowupWorkerDbPool() || pgDatabasePool;

  let cliente = null;
  if (pool && typeof pool.query === "function" && clienteId) {
    try {
      const { rows } = await pool.query(
        `SELECT id, nome, status_pagamento, contrato_assinado, valor FROM public.gd_clientes WHERE id = $1 LIMIT 1`,
        [clienteId]
      );
      if (rows && rows.length > 0) cliente = rows[0];
    } catch (errDb) {
      console.warn("[followup/worker] [Disjuntor] Erro ao buscar gd_clientes:", errDb.message);
    }
  }

  const nomeFinal = cliente?.nome || clienteNome || "Cliente GD";
  const valorFinal = valor || cliente?.valor;
  const valorFormatado = valorFinal
    ? `R$ ${Number(valorFinal).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
    : "A combinar";

  // Se já estiver pago ou contrato assinado, encerra sem disparar alerta
  if (cliente && (cliente.status_pagamento === "pago" || cliente.contrato_assinado === true)) {
    return {
      regularizado: true,
      alertaDisjuntorEnviado: false,
      motivo: "Cliente com pagamento quitado ou contrato assinado.",
      clienteId,
    };
  }

  // Monta mensagem de alerta do disjuntor para Caio
  const caioTelefone = process.env.CAIO_PHONE || "5534997719779";
  const mensagemCaio = `⚡ *Disjuntor de 4 Dias - Geração Digital*\n\nOlá Caio! O cliente *${nomeFinal}* completou o marco de 4 dias do onboarding, porém o contrato ainda não foi assinado e/ou o pagamento inicial consta como pendente.\n\n💰 *Valor:* ${valorFormatado}\n\n⚠️ Deseja pausar o projeto manualmente ou já alinhou com o financeiro do cliente?`;

  try {
    await enviarMensagemWhatsAppComFallback({
      numero: caioTelefone,
      texto: mensagemCaio,
      tenantId: "geracao-digital",
      pool,
    });
  } catch (errZap) {
    console.warn("[followup/worker] [Disjuntor] Falha ao enviar WhatsApp para Caio:", errZap.message);
  }

  return {
    regularizado: false,
    alertaDisjuntorEnviado: true,
    mensagemCaio,
    clienteId,
  };
}

export function startFollowupWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      try {
        if (job.name === "heloisa-scheduled-whatsapp") {
          return await processHeloisaScheduledWhatsappJob(job);
        }
        if (job.name === "trello-card-followup-check") {
          return await processTrelloCardFollowupCheckJob(job);
        }
        if (job.name === "gd-disjuntor-contrato-check") {
          return await processGdDisjuntorContratoCheckJob(job);
        }
        if (job.name === "process-event-journey") {
          // Jornadas por evento foram removidas (nunca tiveram emissor ligado).
          // Job antigo que ainda esteja no Redis é descartado, não reprocessado.
          console.warn("[followup/worker] job de jornada por evento descartado (recurso removido):", job.id);
          return;
        }
        await processJob(job);
      } catch (err) {
        const { jobId } = job.data || {};
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[followup/worker] erro:", msg, { jobId });
        if (jobId) {
          await query(
            "UPDATE followup_jobs SET status='failed', error_log=$2 WHERE id=$1",
            [jobId, msg]
          ).catch(() => {});
        }
        throw err;
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
    }
  );

  worker.on("completed", (job) =>
    console.info("[followup/worker] job concluído:", job.id)
  );
  worker.on("failed", (job, err) =>
    console.error("[followup/worker] job falhou:", job?.id, err.message)
  );
  worker.on("error", (err) =>
    console.error("[followup/worker] worker error:", err.message)
  );

  console.info("[followup/worker] Worker BullMQ iniciado — fila:", QUEUE_NAME);
  _worker = worker;
  return worker;
}

let _worker = null;

export async function pauseFollowupWorker() {
  if (_worker) {
    try {
      await _worker.pause();
      console.info("[followup/worker] Worker pausado (não aceita novos jobs).");
    } catch (err) {
      console.warn("[followup/worker] Erro ao pausar worker:", err.message || err);
    }
  }
}

export async function stopFollowupWorker() {
  if (_worker) {
    try {
      await _worker.close();
      console.info("[followup/worker] Worker encerrado.");
    } catch (err) {
      console.warn("[followup/worker] Erro ao encerrar worker:", err.message || err);
    } finally {
      _worker = null;
    }
  }
}
