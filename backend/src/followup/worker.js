// BullMQ Worker — executa cada job de follow-up agendado.
// Regras:
//  - campanha "paused"   → re-adiciona na fila com delay 5 min (sem contar como falha)
//  - campanha "archived" → skipped
//  - schedule "canceled" → skipped
//  - trigger no_reply    → verifica followup_replies; se respondeu → skipped
//  - 3 tentativas com backoff de 30s; após todas: status "failed"
import { Worker } from "bullmq";
import { defaultGroqModel } from "../services/llmModels.js";
import { query, getSupabase } from "./db.js";
import { QUEUE_NAME, getRedisConnection, getFollowupQueue } from "./queue.js";
import Groq from "groq-sdk";
import { ResendProvider } from "../providers/ResendProvider.js";
import { applyMessagePlaceholders } from "../services/messagePlaceholders.js";
import { validateOutboundMessage } from "../services/jsonExtractor.js";

import {
  getLeadClientEvolutionInstances,
  parseEvolutionWebhookEndpoint,
} from "../services/evolution.js";
import { normalizeString } from "../textNormalize.js";
import {
  isWithinSendWindow,
  getNextSendWindowOpening,
  resolveSendWindowConfig,
} from "../services/sendWindow.js";
import { getLeadClientN8nSettings } from "../services/n8nSettings.js";
import { SQL_CANONICAL_PHONE } from "../services/canonicalPhone.js";
import { isWonStage, isLostStage } from "../services/followupExitGuard.js";

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

export async function resolveEvolutionInstanceForFollowup(tenantId, instanceNameOrId) {
  if (!tenantId) {
    throw new Error("tenant_id não informado para resolução da instância de follow-up.");
  }

  const instances = await getLeadClientEvolutionInstances(tenantId);
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
  };
}

function renderMessage(template, { lead_name, meeting_datetime, phone = "" }) {
  return applyMessagePlaceholders(
    template,
    { nome: lead_name, lead_name },
    phone,
    { meeting_datetime }
  );
}

async function sendViaEvolution({ baseUrl, apiKey, instanceSlug, phone, text }) {
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
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: resolvedApiKey,
    },
    body: JSON.stringify({
      number: phone,
      text,
      options: {
        delay: 1200,
        presence: "composing",
        linkPreview: false,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Evolution API ${res.status} (${instanceSlug}): ${body.slice(0, 200)}`);
  }
}

async function processJob(job) {
  if (job.data.isMock) {
    console.log(`[followup/worker] Job processado (mock): ${job.id}`);
    return;
  }

  const { jobId, customMessage } = job.data;

  const { rows: jobRows } = await query(
    `SELECT fj.id, fj.schedule_id, fj.template_id, fj.custom_message, fj.status as job_status,
            fs.lead_name, fs.phone, fs.meeting_datetime, fs.status as schedule_status,
            fs.campaign_id, fs.company_id,
            ft.message, ft.trigger_type,
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
    await getFollowupQueue().add(
      "send-followup",
      { jobId, customMessage: customMessage || row.custom_message },
      { delay: 5 * 60 * 1000, jobId: `fup-pause-${jobId}-${Date.now()}` }
    );
    console.log(log, "campanha pausada — reagendado em 5 min");
    return;
  }

  // Validação da janela de envio permitida do tenant
  if (row.tenant_id) {
    try {
      const tenantSettings = await getLeadClientN8nSettings(row.tenant_id);
      const sendWindowConfig = resolveSendWindowConfig(tenantSettings);
      if (!isWithinSendWindow(new Date(), sendWindowConfig)) {
        const nextOpening = getNextSendWindowOpening(new Date(), sendWindowConfig);
        const delay = Math.max(1000, nextOpening.getTime() - Date.now());

        await query("UPDATE followup_jobs SET scheduled_for=$1 WHERE id=$2", [
          nextOpening.toISOString(),
          jobId,
        ]);

        await getFollowupQueue().add(
          "send-followup",
          { jobId, customMessage: customMessage || row.custom_message },
          { delay, jobId: `fup-window-${jobId}-${nextOpening.getTime()}` }
        );
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

  // 2. Condição de saída: Resposta do lead (trigger no_reply ou exit_on_reply)
  if (row.trigger_type === "no_reply" && row.company_id && row.phone) {
    const { rows: replies } = await query(
      `SELECT id FROM followup_replies
        WHERE company_id = $1
          AND ${SQL_CANONICAL_PHONE("phone")} = ${SQL_CANONICAL_PHONE("$2::text")}
        LIMIT 1`,
      [row.company_id, row.phone]
    );
    if (replies.length) {
      await query("UPDATE followup_jobs SET status='skipped' WHERE id=$1", [jobId]);
      console.log(log, "skipped — lead já respondeu (trigger no_reply)");
      return;
    }
  } else if (row.exit_on_reply !== false && row.company_id && row.phone) {
    const { rows: replies } = await query(
      `SELECT id FROM followup_replies
        WHERE company_id = $1
          AND ${SQL_CANONICAL_PHONE("phone")} = ${SQL_CANONICAL_PHONE("$2::text")}
        LIMIT 1`,
      [row.company_id, row.phone]
    );
    if (replies.length) {
      await query("UPDATE followup_jobs SET status='skipped' WHERE id=$1", [jobId]);
      console.log(log, "skipped — lead já respondeu (exit_on_reply)");
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

  const rawMessage = customMessage || row.custom_message || row.message || "";
  const text = renderMessage(rawMessage, {
    lead_name: row.lead_name,
    meeting_datetime: row.meeting_datetime,
    phone: row.phone,
  });

  // Resolve a instância oficial na tabela central de chips do tenant (lead_client_evolution_instances)
  const evoConfig = await resolveEvolutionInstanceForFollowup(
    row.tenant_id,
    row.evolution_instance
  );

  await sendViaEvolution({
    baseUrl: evoConfig.baseUrl,
    apiKey: evoConfig.apiKey,
    instanceSlug: evoConfig.instanceSlug,
    phone: row.phone,
    text,
  });

  await query(
    "UPDATE followup_jobs SET status='sent', sent_at=NOW() WHERE id=$1",
    [jobId]
  );
  console.log(log, `mensagem enviada via Evolution API (${evoConfig.displayName} -> ${evoConfig.instanceSlug})`);
}

async function processEventJourneyJob(job) {
  const { companyId, leadId, eventName, journeyId, channel, aiPrompt, context } = job.data;
  const log = `[event-journey][${eventName}][${leadId}]`;

  console.log(log, "Processando disparo de jornada...");

  try {
    const supabase = getSupabase();

    // Buscar dados do Lead
    const { data: leadData } = await supabase
      .from('leads_infinie') // Usando tabela base de leads ou a view, vamos puxar da base principal
      .select('name, phone, email, status')
      .eq('id', leadId)
      .maybeSingle();
      
    // Buscar config da empresa
    const { data: companyData } = await supabase
      .from('followup_companies')
      .select('evolution_instance, name, tenant_id')
      .eq('id', companyId)
      .maybeSingle();

    if (!leadData) {
      console.log(log, "Lead não encontrado. Ignorando.");
      return;
    }

    let finalMessage = "";

    // Gerar mensagem com IA se houver prompt
    if (aiPrompt && process.env.GROQ_API_KEY) {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const systemMsg = "Você é um especialista em vendas B2C. Escreva uma mensagem persuasiva baseada na diretriz fornecida. Apenas o texto da mensagem final.";
      let userMsg = `Diretriz: ${aiPrompt}\n\nContexto do Lead:\nNome: ${leadData.name}\nStatus atual: ${leadData.status}`;
      if (context && Object.keys(context).length > 0) {
        userMsg += `\n\nContexto Adicional (Eventos/Pagamentos/Cupons):\n${JSON.stringify(context, null, 2)}`;
      }
      userMsg += `\n\nEscreva a mensagem (sem aspas ou explicações extras):`;
      
      const completion = await groq.chat.completions.create({
        model: defaultGroqModel(),
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
        temperature: 0.5,
        max_tokens: 512,
      });

      finalMessage = completion.choices[0]?.message?.content?.trim() || "";
    } else {
      // Fallback sem IA
      finalMessage = aiPrompt || `Olá ${leadData.name}, estamos passando para checar como as coisas estão.`;
      if (context?.paymentUrl) {
        finalMessage = finalMessage.replace(/\{\{paymentUrl\}\}/gi, context.paymentUrl);
      }
      if (context?.couponCode) {
        finalMessage = finalMessage.replace(/\{\{couponCode\}\}/gi, context.couponCode);
      }
    }

    // Envio pelo Canal
    if (channel === "email" && leadData.email) {
      await ResendProvider.sendEmail(
        leadData.email,
        `Sobre nosso contato na ${companyData?.name || 'Vexo'}`,
        `<div style="font-family: sans-serif; font-size: 14px; white-space: pre-wrap;">${finalMessage}</div>`
      );
      console.log(log, "Email disparado com sucesso via Resend!");
    } else {
      // Fallback pra WhatsApp (Evolution)
      if (companyData && leadData.phone) {
        const evoConfig = await resolveEvolutionInstanceForFollowup(
          companyData.tenant_id,
          companyData.evolution_instance
        );
        await sendViaEvolution({
          baseUrl: evoConfig.baseUrl,
          apiKey: evoConfig.apiKey,
          instanceSlug: evoConfig.instanceSlug,
          phone: leadData.phone,
          text: finalMessage,
        });
        console.log(log, `WhatsApp disparado com sucesso via Evolution (${evoConfig.displayName})!`);
      } else {
        console.log(log, "Faltam dados de instância ou telefone para WhatsApp.");
      }
    }
  } catch (err) {
    console.error(log, "Falha ao processar jornada:", err);
    throw err;
  }
}

export function startFollowupWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      try {
        if (job.name === "process-event-journey") {
          await processEventJourneyJob(job);
        } else {
          await processJob(job);
        }
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
