// Motor de automação proativo do Follow-up.
// Roda a cada 6h via node-cron.
// NÃO envia mensagens — apenas cria sugestões para aprovação do operador.

import cron from "node-cron";
import Groq from "groq-sdk";
import { query } from "./db.js";
import { buildDefaultSegmentationConfig } from "../segmentation.js";

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

export async function findLivPubCandidates(companyId, inactiveMonths = 6) {
  const config = buildDefaultSegmentationConfig("livpub");
  const hasVisita = config.kpis.some(k => k.field === 'ultima_visita' && k.enabled);
  const hasNascimento = config.kpis.some(k => k.field === 'data_nascimento' && k.enabled);

  if (!hasVisita && !hasNascimento) return [];

  const { rows: companyRows } = await query("SELECT tenant_id FROM followup_companies WHERE id = $1", [companyId]);
  if (!companyRows.length) return [];
  const tenantId = companyRows[0].tenant_id;
  if (!tenantId) return [];

  let candidates = [];
  try {
    if (hasNascimento) {
      const bday = await fetchLeadsInBatches(
        'leads',
        `client_id = '${tenantId}'
           AND data_nascimento IS NOT NULL
           AND EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM CURRENT_DATE)
           AND EXTRACT(DAY FROM data_nascimento) = EXTRACT(DAY FROM CURRENT_DATE)`,
        "livpub_aniversario"
      );
      candidates.push(...bday);
    }

    if (hasVisita) {
      const months = Number(inactiveMonths) || 6;
      const inativos = await fetchLeadsInBatches(
        'leads',
        `client_id = '${tenantId}'
           AND ultima_visita IS NOT NULL
           AND ultima_visita < NOW() - INTERVAL '${months} months'`,
        "livpub_inativo"
      );
      candidates.push(...inativos);
    }
  } catch (e) {
    console.error("[followup/engine] Erro ao consultar tabela base unificada de leads:", e.message);
  }
  return candidates;
}

async function findCandidates(companyId, campaignId, neverContactedHours = 2, noReplyHours = 48) {
  // 1. Leads que entraram na campanha mas NUNCA receberam nenhum job
  const neverHours = Number(neverContactedHours) || 2;
  const { rows: neverContacted } = await query(
    `SELECT fs.id, fs.lead_name, fs.phone, fs.origin, fs.meeting_datetime
       FROM followup_schedules fs
      WHERE fs.campaign_id = $1
        AND fs.company_id  = $2
        AND fs.status      = 'active'
        AND fs.created_at  < NOW() - INTERVAL '${neverHours} hours'
        AND NOT EXISTS (
          SELECT 1 FROM followup_jobs fj WHERE fj.schedule_id = fs.id
        )`,
    [campaignId, companyId]
  );

  // 2. Todos os jobs enviados há mais de X horas, sem resposta, sem job pendente
  const staleHours = Number(noReplyHours) || 48;
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
     HAVING MAX(fj.sent_at) < NOW() - INTERVAL '${staleHours} hours'`,
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
          SELECT 1 FROM followup_jobs fj WHERE fj.status = 'failed' AND fj.schedule_id = fs.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM followup_jobs fj WHERE fj.status = 'pending' AND fj.schedule_id = fs.id
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

export async function generateSuggestion(lead, templates, reasonType, company = null) {
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

  let customPrompt = "";
  if (reasonType === "livpub_aniversario" && company?.livpub_aniversario_prompt) {
    customPrompt = `\n\nDiretrizes da Empresa (Siga estritamente): ${company.livpub_aniversario_prompt}\n`;
  } else if (reasonType === "livpub_inativo" && company?.livpub_inativo_prompt) {
    customPrompt = `\n\nDiretrizes da Empresa (Siga estritamente): ${company.livpub_inativo_prompt}\n`;
  } else {
    // Fallbacks
    if (reasonType === "livpub_aniversario") {
      customPrompt = "\n\nInstruções específicas: escreva como um convite de aniversário. Ofereça cortesia/mesa VIP " +
        "para o aniversariante e desconto para os convidados que forem junto. Adapte o tom da mensagem " +
        (lead.perfil_musical
          ? `ao perfil musical do cliente (${lead.perfil_musical}) — referencie o estilo sem exagero.`
          : "ao clima de uma casa de shows, de forma calorosa e animada.");
    }
  }

  const userPrompt =
    `Lead: ${lead.lead_name || "sem nome"}, telefone: ${lead.phone}` +
    `${lead.origin ? `, origem: ${lead.origin}` : ""}${meetingStr}${perfilStr}.\n\n` +
    `Situação: ${REASON_CONTEXT[reasonType]}${customPrompt}\n\n` +
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
            "Escolha o template mais adequado e personalize a mensagem para o lead de acordo com as diretrizes. " +
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

async function runAutomationEngine(isManual = false) {
  console.info("[followup/engine] iniciando varredura proativa...");
  let created = 0;
  let skipped = 0;

  try {
    // 0. Carregar configurações de todas as empresas
    const { rows: companiesList } = await query(
      `SELECT id, engine_scan_interval_hours, never_contacted_delay_hours, 
              no_reply_delay_hours, livpub_inactive_delay_months, last_engine_run_at,
              livpub_aniversario_prompt, livpub_inativo_prompt
         FROM followup_companies
        WHERE archived_at IS NULL`
    );

    const companyMap = new Map();
    for (const c of companiesList) {
      companyMap.set(c.id, c);
    }

    const shouldProcessCompany = (companyId) => {
      if (isManual) return true;
      const comp = companyMap.get(companyId);
      if (!comp) return false;
      if (!comp.last_engine_run_at) return true;
      const hoursSinceLastRun = (new Date() - new Date(comp.last_engine_run_at)) / (1000 * 60 * 60);
      const interval = comp.engine_scan_interval_hours ?? 6;
      return hoursSinceLastRun >= interval;
    };

    const markCompanyProcessed = async (companyId) => {
      try {
        await query(
          `UPDATE followup_companies 
              SET last_engine_run_at = NOW() 
            WHERE id = $1`,
          [companyId]
        );
        const comp = companyMap.get(companyId);
        if (comp) comp.last_engine_run_at = new Date().toISOString();
      } catch (err) {
        console.warn(`[followup/engine] falha ao atualizar last_engine_run_at para ${companyId}:`, err.message);
      }
    };

    // 1. Esteiras 1 e 2: Lógica para empresas com campanhas ativas (Follow-up normal)
    const { rows: pairs } = await query(`
      SELECT DISTINCT fco.id AS company_id, fc.id AS campaign_id
        FROM followup_companies fco
        JOIN followup_campaigns fc ON fc.company_id = fco.id
       WHERE fc.status = 'active'
         AND fco.archived_at IS NULL
    `);

    // Processar campanhas
    const processedCompanies = new Set();

    for (const { company_id, campaign_id } of pairs) {
      if (!shouldProcessCompany(company_id)) {
        console.info(`[followup/engine] pulando campanha ${campaign_id} (intervalo da empresa ${company_id} não atingido)`);
        continue;
      }
      if (created >= ENGINE_MAX_SUGGESTIONS_PER_RUN) {
        console.info(`[followup/engine] limite de ${ENGINE_MAX_SUGGESTIONS_PER_RUN} sugestões por varredura atingido — demais leads ficam para a próxima execução`);
        break;
      }
      try {
        const company = companyMap.get(company_id);
        const neverContactedHours = company?.never_contacted_delay_hours ?? 2;
        const noReplyHours = company?.no_reply_delay_hours ?? 48;

        // Templates ativos da campanha
        const { rows: templates } = await query(
          `SELECT id, name, message
             FROM followup_templates
            WHERE campaign_id = $1 AND is_active = true
            ORDER BY order_index ASC`,
          [campaign_id]
        );
        if (!templates.length) continue;

        const candidates = await findCandidates(company_id, campaign_id, neverContactedHours, noReplyHours);

        for (const lead of candidates) {
          if (created >= ENGINE_MAX_SUGGESTIONS_PER_RUN) break;

          // Deduplicação normal (24h)
          const existing = (await query(
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

        processedCompanies.add(company_id);
      } catch (campaignErr) {
        console.error(`[followup/engine] erro na campanha ${campaign_id}:`, campaignErr.message);
      }
    }

    // 2. Esteiras 3 e 4: Lógica para LivPub (Aniversariantes e Inativos) - Independente de campanha
    const defaultLivPubTemplates = [
      { id: null, name: "Template Padrão", message: "Olá, temos uma condição especial para você!" }
    ];

    for (const company of companiesList) {
      const company_id = company.id;
      if (!shouldProcessCompany(company_id)) {
        console.info(`[followup/engine] pulando LivPub para empresa ${company_id} (intervalo não atingido)`);
        continue;
      }
      if (created >= ENGINE_MAX_SUGGESTIONS_PER_RUN) break;
      try {
        const inactiveMonths = company.livpub_inactive_delay_months ?? 6;
        const livpubCandidates = await findLivPubCandidates(company_id, inactiveMonths);
        
        for (const lead of livpubCandidates) {
          if (created >= ENGINE_MAX_SUGGESTIONS_PER_RUN) break;

          // Deduplicação: aniversário é anual, inativo é 24h pendente
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

          const { template, message } = await generateSuggestion(lead, defaultLivPubTemplates, lead.reasonType, company);

          await query(
            `INSERT INTO followup_suggestions
               (company_id, campaign_id, lead_name, phone, lead_source, reason,
                suggested_template_id, suggested_message)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              company_id,
              null,
              lead.lead_name,
              lead.phone,
              lead.origin ?? null,
              REASON_LABELS[lead.reasonType],
              null,
              message,
            ]
          );
          created++;
          console.info(`[followup/engine] sugestão criada — ${lead.phone} (${lead.reasonType})`);
        }

        processedCompanies.add(company_id);
      } catch (compErr) {
        console.error(`[followup/engine] erro na empresa ${company_id} para LivPub:`, compErr.message);
      }
    }

    // Atualizar last_engine_run_at para todas as empresas processadas
    for (const companyId of processedCompanies) {
      await markCompanyProcessed(companyId);
    }

    console.info(`[followup/engine] varredura concluída — criadas: ${created}, ignoradas: ${skipped}`);
  } catch (err) {
    console.error("[followup/engine] erro geral:", err.message);
  }
}

// ─── Export público ───────────────────────────────────────────────────────────

let engineRunning = false;

export function triggerAutomationRun() {
  if (engineRunning) return { started: false, alreadyRunning: true };
  engineRunning = true;
  console.info("[followup/engine] disparo manual recebido — iniciando varredura");
  runAutomationEngine(true)
    .catch((err) => console.error("[followup/engine] erro no disparo manual:", err.message))
    .finally(() => { engineRunning = false; });
  return { started: true };
}

export function startAutomationEngine() {
  // Executar a cada hora
  cron.schedule("0 * * * *", () => {
    if (engineRunning) return;
    engineRunning = true;
    runAutomationEngine(false)
      .catch((err) => console.error("[followup/engine] erro no cron de varredura:", err.message))
      .finally(() => { engineRunning = false; });
  });
  console.info("[followup/engine] Motor proativo agendado (a cada 1h)");
  return { runNow: triggerAutomationRun };
}
