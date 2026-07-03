// Motor de automação proativo do Follow-up.
// Roda a cada 6h via node-cron.
// NÃO envia mensagens — apenas cria sugestões para aprovação do operador.

import cron from "node-cron";
import Groq from "groq-sdk";
import { query } from "./db.js";
import { buildDefaultSegmentationConfig } from "../server.js";

// ─── Groq client (lazy — só instanciado se GROQ_API_KEY existir) ──────────────

let _groq = null;
function getGroq() {
  if (!_groq && process.env.GROQ_API_KEY) {
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

// ─── Busca candidatos por empresa/campanha ────────────────────────────────────

// Base LivPub tem ~21k contatos: varrer em lotes para não segurar o banco
// com uma única query gigante, e limitar sugestões por varredura (cada
// sugestão gera uma chamada Groq).
const ENGINE_BATCH_SIZE = Math.max(50, Number(process.env.FOLLOWUP_ENGINE_BATCH_SIZE) || 500);
const ENGINE_MAX_SUGGESTIONS_PER_RUN = Math.max(1, Number(process.env.FOLLOWUP_ENGINE_MAX_SUGGESTIONS) || 100);

async function fetchLeadsInBatches(tablename, whereSql, reasonType) {
  const results = [];
  let offset = 0;
  let batch = 0;
  for (;;) {
    const { rows } = await query(`
      SELECT id, nome AS lead_name, telefone AS phone, lead_source AS origin, NULL AS meeting_datetime,
             perfil_musical
        FROM ${tablename}
       WHERE ${whereSql}
       ORDER BY id
       LIMIT ${ENGINE_BATCH_SIZE} OFFSET ${offset}
    `);
    if (!rows.length) break;
    batch++;
    console.info(`[followup/engine] ${tablename} (${reasonType}) — lote ${batch}: ${rows.length} leads`);
    results.push(...rows.map(r => ({ ...r, reasonType })));
    if (rows.length < ENGINE_BATCH_SIZE) break;
    offset += ENGINE_BATCH_SIZE;
  }
  return results;
}

export async function findLivPubCandidates(companyId) {
  const config = buildDefaultSegmentationConfig("livpub");
  const hasVisita = config.kpis.some(k => k.field === 'ultima_visita' && k.enabled);
  const hasNascimento = config.kpis.some(k => k.field === 'data_nascimento' && k.enabled);

  if (!hasVisita && !hasNascimento) return [];

  const { rows: tables } = await query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'leads_%'`);

  let candidates = [];
  for (const { tablename } of tables) {
    try {
      if (hasNascimento) {
        const bday = await fetchLeadsInBatches(
          tablename,
          `data_nascimento IS NOT NULL
             AND EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM CURRENT_DATE)
             AND EXTRACT(DAY FROM data_nascimento) = EXTRACT(DAY FROM CURRENT_DATE)`,
          "livpub_aniversario"
        );
        candidates.push(...bday);
      }

      if (hasVisita) {
        const inativos = await fetchLeadsInBatches(
          tablename,
          `ultima_visita IS NOT NULL
             AND ultima_visita < NOW() - INTERVAL '6 months'`,
          "livpub_inativo"
        );
        candidates.push(...inativos);
      }
    } catch (e) {
      // Ignora erro caso a tabela ainda não tenha as colunas migrada
    }
  }
  return candidates;
}

async function findCandidates(companyId, campaignId) {
  // 1. Leads que entraram na campanha mas NUNCA receberam nenhum job
  const { rows: neverContacted } = await query(
    `SELECT fs.id, fs.lead_name, fs.phone, fs.origin, fs.meeting_datetime
       FROM followup_schedules fs
      WHERE fs.campaign_id = $1
        AND fs.company_id  = $2
        AND fs.status      = 'active'
        AND fs.created_at  < NOW() - INTERVAL '2 hours'
        AND NOT EXISTS (
          SELECT 1 FROM followup_jobs fj WHERE fj.schedule_id = fs.id
        )`,
    [campaignId, companyId]
  );

  // 2. Todos os jobs enviados há mais de 48h, sem resposta, sem job pendente
  const { rows: stale } = await query(
    `SELECT fs.id, fs.lead_name, fs.phone, fs.origin, fs.meeting_datetime,
            MAX(fj.sent_at) AS last_sent
       FROM followup_schedules fs
       JOIN followup_jobs fj ON fj.schedule_id = fs.id AND fj.status = 'sent'
      WHERE fs.campaign_id = $1
        AND fs.company_id  = $2
        AND fs.status      = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM followup_replies r
           WHERE r.company_id = $2 AND r.phone = fs.phone
        )
        AND NOT EXISTS (
          SELECT 1 FROM followup_jobs fj2
           WHERE fj2.schedule_id = fs.id AND fj2.status = 'pending'
        )
      GROUP BY fs.id
     HAVING MAX(fj.sent_at) < NOW() - INTERVAL '48 hours'`,
    [campaignId, companyId]
  );

  // 3. Jobs com status 'failed', sem pendentes, sem resposta
  const { rows: failed } = await query(
    `SELECT fs.id, fs.lead_name, fs.phone, fs.origin, fs.meeting_datetime
       FROM followup_schedules fs
      WHERE fs.campaign_id = $1
        AND fs.company_id  = $2
        AND fs.status      = 'active'
        AND EXISTS (
          SELECT 1 FROM followup_jobs fj WHERE fj.schedule_id = fs.id AND fj.status = 'failed'
        )
        AND NOT EXISTS (
          SELECT 1 FROM followup_jobs fj WHERE fj.schedule_id = fs.id AND fj.status = 'pending'
        )
        AND NOT EXISTS (
          SELECT 1 FROM followup_replies r WHERE r.company_id = $2 AND r.phone = fs.phone
        )`,
    [campaignId, companyId]
  );

  return [
    ...neverContacted.map((r) => ({ ...r, reasonType: "never_contacted" })),
    ...stale.map((r)          => ({ ...r, reasonType: "no_reply_48h" })),
    ...failed.map((r)         => ({ ...r, reasonType: "jobs_failed" })),
  ];
}

// ─── Geração de mensagem via Groq ─────────────────────────────────────────────

const REASON_LABELS = {
  never_contacted: "Lead sem contato inicial desde a entrada na campanha",
  no_reply_48h:    "Sem resposta há mais de 48h após os envios",
  jobs_failed:     "Envios anteriores falharam — reabordagem sugerida",
  livpub_aniversario: "Esteira 3: Aniversariante do dia",
  livpub_inativo:     "Esteira 4: Cliente inativo (> 6 meses)",
};

const REASON_CONTEXT = {
  never_contacted: "Este lead entrou na campanha mas ainda não recebeu nenhuma mensagem.",
  no_reply_48h:    "Este lead recebeu mensagens há mais de 48 horas e não respondeu.",
  jobs_failed:     "As tentativas de envio anteriores falharam para este lead.",
  livpub_aniversario: "Este cliente faz aniversário hoje. Ofereça uma condição especial: cortesia/mesa VIP para o aniversariante e desconto para os convidados que forem junto.",
  livpub_inativo:     "Este cliente não frequenta os eventos há mais de 6 meses. Tente reativá-lo.",
};

export async function generateSuggestion(lead, templates, reasonType) {
  const groq = getGroq();
  if (!groq) {
    // Sem GROQ_API_KEY: retorna primeiro template ativo sem personalização
    return { template: templates[0] ?? null, message: null };
  }

  const templateList = templates
    .map((t, i) => `${i + 1}. [${t.name}] "${t.message.slice(0, 120)}${t.message.length > 120 ? "..." : ""}"`)
    .join("\n");

  const meetingStr = lead.meeting_datetime
    ? `, reunião agendada: ${new Date(lead.meeting_datetime).toLocaleDateString("pt-BR")}`
    : "";
  const perfilStr = lead.perfil_musical ? `, perfil musical: ${lead.perfil_musical}` : "";

  const aniversarioInstruction = reasonType === "livpub_aniversario"
    ? "\n\nInstruções específicas: escreva como um convite de aniversário. Ofereça cortesia/mesa VIP " +
      "para o aniversariante e desconto para os convidados que forem junto. Adapte o tom da mensagem " +
      (lead.perfil_musical
        ? `ao perfil musical do cliente (${lead.perfil_musical}) — referencie o estilo sem exagero.`
        : "ao clima de uma casa de shows, de forma calorosa e animada.")
    : "";

  const userPrompt =
    `Lead: ${lead.lead_name || "sem nome"}, telefone: ${lead.phone}` +
    `${lead.origin ? `, origem: ${lead.origin}` : ""}${meetingStr}${perfilStr}.\n\n` +
    `Situação: ${REASON_CONTEXT[reasonType]}${aniversarioInstruction}\n\n` +
    `Templates disponíveis:\n${templateList}\n\n` +
    `Escolha o melhor template (1-${templates.length}) e personalize a mensagem. ` +
    `Responda APENAS com JSON válido: {"template_index": N, "message": "..."}`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content:
            "Você é um assistente de vendas B2C em português do Brasil. " +
            "Escolha o template mais adequado e personalize a mensagem para o lead. " +
            "Responda APENAS com JSON válido no formato: {\"template_index\": N, \"message\": \"texto personalizado\"}",
        },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 512,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    const tplIdx = Math.max(0, Math.min(templates.length - 1, (Number(parsed.template_index) || 1) - 1));

    return {
      template: templates[tplIdx] ?? templates[0] ?? null,
      message: typeof parsed.message === "string" && parsed.message.trim() ? parsed.message.trim() : null,
    };
  } catch (err) {
    console.warn("[followup/engine] groq error:", err.message);
    return { template: templates[0] ?? null, message: null };
  }
}

// ─── Engine principal ─────────────────────────────────────────────────────────

async function runAutomationEngine() {
  console.info("[followup/engine] iniciando varredura proativa...");
  let created = 0;
  let skipped = 0;

  try {
    // Empresas com campanhas ativas
    const { rows: pairs } = await query(`
      SELECT DISTINCT fco.id AS company_id, fc.id AS campaign_id
        FROM followup_companies fco
        JOIN followup_campaigns fc ON fc.company_id = fco.id
       WHERE fc.status = 'active'
    `);

    for (const { company_id, campaign_id } of pairs) {
      if (created >= ENGINE_MAX_SUGGESTIONS_PER_RUN) {
        console.info(`[followup/engine] limite de ${ENGINE_MAX_SUGGESTIONS_PER_RUN} sugestões por varredura atingido — demais leads ficam para a próxima execução`);
        break;
      }
      try {
        // Templates ativos da campanha
        const { rows: templates } = await query(
          `SELECT id, name, message
             FROM followup_templates
            WHERE campaign_id = $1 AND is_active = true
            ORDER BY order_index ASC`,
          [campaign_id]
        );
        if (!templates.length) continue;

        const candidates = await findCandidates(company_id, campaign_id);
        const livpubCandidates = await findLivPubCandidates(company_id);
        const allCandidates = [...candidates, ...livpubCandidates];

        for (const lead of allCandidates) {
          if (created >= ENGINE_MAX_SUGGESTIONS_PER_RUN) break;

          // Deduplicação: aniversário é anual — não repetir para o mesmo lead
          // dentro do mesmo ano civil, independente do status da sugestão anterior
          // (aprovada, rejeitada ou ainda pendente).
          const existing = lead.reasonType === "livpub_aniversario"
            ? (await query(
                `SELECT id FROM followup_suggestions
                  WHERE company_id = $1
                    AND phone      = $2
                    AND reason     = $3
                    AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)`,
                [company_id, lead.phone, REASON_LABELS.livpub_aniversario]
              )).rows
            : (await query(
                `SELECT id FROM followup_suggestions
                  WHERE company_id = $1
                    AND phone      = $2
                    AND status     = 'pending'
                    AND created_at > NOW() - INTERVAL '24 hours'`,
                [company_id, lead.phone]
              )).rows;
          if (existing.length) { skipped++; continue; }

          const { template, message } = await generateSuggestion(lead, templates, lead.reasonType);

          await query(
            `INSERT INTO followup_suggestions
               (company_id, campaign_id, lead_name, phone, lead_source, reason,
                suggested_template_id, suggested_message)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              company_id,
              campaign_id,
              lead.lead_name,
              lead.phone,
              lead.origin ?? null,
              REASON_LABELS[lead.reasonType],
              template?.id ?? null,
              message,
            ]
          );
          created++;
          console.info(`[followup/engine] sugestão criada — ${lead.phone} (${lead.reasonType})`);
        }
      } catch (campaignErr) {
        // Falha isolada por campanha: log e continua
        console.error(`[followup/engine] erro na campanha ${campaign_id}:`, campaignErr.message);
      }
    }

    console.info(`[followup/engine] varredura concluída — criadas: ${created}, ignoradas: ${skipped}`);
  } catch (err) {
    console.error("[followup/engine] erro geral:", err.message);
  }
}

// ─── Export público ───────────────────────────────────────────────────────────

// Disparo manual (botão "Ativar Esteira 4" no frontend). Roda em background:
// a rota responde 202 e o processamento segue nos logs. Guard evita execuções
// concorrentes (cron + manual ao mesmo tempo).
let engineRunning = false;

export function triggerAutomationRun() {
  if (engineRunning) return { started: false, alreadyRunning: true };
  engineRunning = true;
  console.info("[followup/engine] disparo manual recebido — iniciando varredura");
  runAutomationEngine()
    .catch((err) => console.error("[followup/engine] erro no disparo manual:", err.message))
    .finally(() => { engineRunning = false; });
  return { started: true };
}

export function startAutomationEngine() {
  // A cada 6 horas: minuto 0, a cada 6h
  cron.schedule("0 */6 * * *", () => { triggerAutomationRun(); });
  console.info("[followup/engine] Motor proativo agendado (a cada 6h)");
  return { runNow: triggerAutomationRun };
}
