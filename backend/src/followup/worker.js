// BullMQ Worker — executa cada job de follow-up agendado.
// Regras:
//  - campanha "paused"   → re-adiciona na fila com delay 5 min (sem contar como falha)
//  - campanha "archived" → skipped
//  - schedule "canceled" → skipped
//  - trigger no_reply    → verifica followup_replies; se respondeu → skipped
//  - 3 tentativas com backoff de 30s; após todas: status "failed"
import { Worker } from "bullmq";
import { query, getSupabase } from "./db.js";
import { QUEUE_NAME, getRedisConnection, getFollowupQueue } from "./queue.js";
import Groq from "groq-sdk";
import { ResendProvider } from "../providers/ResendProvider.js";

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

function renderMessage(template, { lead_name, meeting_datetime }) {
  let msg = template;
  const d = meeting_datetime ? new Date(meeting_datetime) : null;
  const date = d
    ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";
  const time = d
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "";
  msg = msg.replace(/\{\{lead_name\}\}/gi, lead_name || "");
  msg = msg.replace(/\{\{meeting_date\}\}/gi, date);
  msg = msg.replace(/\{\{meeting_time\}\}/gi, time);
  return msg;
}

async function sendViaEvolution(instance, phone, text) {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    throw new Error("EVOLUTION_API_URL ou EVOLUTION_API_KEY não configurado.");
  }
  const url = `${EVOLUTION_API_URL.replace(/\/$/, "")}/message/sendText/${instance}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: EVOLUTION_API_KEY,
    },
    body: JSON.stringify({ number: phone, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Evolution API ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function processJob(job) {
  const { jobId } = job.data;

  const { rows: jobRows } = await query(
    `SELECT fj.id, fj.schedule_id, fj.template_id, fj.status as job_status,
            fs.lead_name, fs.phone, fs.meeting_datetime, fs.status as schedule_status,
            fs.campaign_id,
            ft.message, ft.trigger_type,
            fc.status as campaign_status, fc.company_id,
            fco.evolution_instance
       FROM followup_jobs       fj
       JOIN followup_schedules  fs  ON fs.id = fj.schedule_id
       JOIN followup_templates  ft  ON ft.id = fj.template_id
       JOIN followup_campaigns  fc  ON fc.id = fs.campaign_id
       JOIN followup_companies  fco ON fco.id = fc.company_id
      WHERE fj.id = $1`,
    [jobId]
  );

  if (!jobRows.length) {
    console.warn("[followup/worker] job não encontrado no banco:", jobId);
    return;
  }

  const row = jobRows[0];
  const log = `[followup/worker][${row.campaign_id}][${row.lead_name}]`;

  if (row.campaign_status === "paused") {
    // Re-adiciona o mesmo payload com delay de 5 min; job atual termina sem erro
    await getFollowupQueue().add(
      "send-followup",
      { jobId },
      { delay: 5 * 60 * 1000, jobId: `fup-pause-${jobId}-${Date.now()}` }
    );
    console.log(log, "campanha pausada — reagendado em 5 min");
    return;
  }

  if (row.campaign_status === "archived" || row.schedule_status === "canceled") {
    await query("UPDATE followup_jobs SET status='skipped' WHERE id=$1", [jobId]);
    console.log(log, "skipped (archived/canceled)");
    return;
  }

  if (row.trigger_type === "no_reply") {
    const { rows: replies } = await query(
      `SELECT id FROM followup_replies WHERE company_id=$1 AND phone=$2 LIMIT 1`,
      [row.company_id, row.phone]
    );
    if (replies.length) {
      await query("UPDATE followup_jobs SET status='skipped' WHERE id=$1", [jobId]);
      console.log(log, "skipped — lead já respondeu");
      return;
    }
  }

  const text = renderMessage(row.message, {
    lead_name: row.lead_name,
    meeting_datetime: row.meeting_datetime,
  });

  await sendViaEvolution(row.evolution_instance, row.phone, text);

  await query(
    "UPDATE followup_jobs SET status='sent', sent_at=NOW() WHERE id=$1",
    [jobId]
  );
  console.log(log, "mensagem enviada via Evolution API");
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
      .select('evolution_instance, name')
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
      const userMsg = `Diretriz: ${aiPrompt}\n\nContexto do Lead:\nNome: ${leadData.name}\nStatus atual: ${leadData.status}\n\nEscreva a mensagem (sem aspas ou explicações extras):`;
      
      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
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
      if (companyData && companyData.evolution_instance && leadData.phone) {
        await sendViaEvolution(companyData.evolution_instance, leadData.phone, finalMessage);
        console.log(log, "WhatsApp disparado com sucesso via Evolution!");
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
  return worker;
}
