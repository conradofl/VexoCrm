// backend/src/domains/chatbot/routes.js
// Movimento puro (extraído de registerAllDomainRoutes.js): rotas de import de leads
// outlier (n8n), viewer de conversas WhatsApp (chats/messages), prompts customizados,
// chatbot-templates, chatbot hardcoded (Outlier Qualification) e seu webhook/teste/
// kanban/extração de briefing. Corpo dos handlers idêntico ao original — só muda de
// onde vêm as dependências (deps em vez de routeDeps destructure inline).
//
// appendLeadMessage e isGroupJid vêm de createLeadMessaging/shared/leadMessaging.js —
// mesmo mecanismo usado hoje em registerAllDomainRoutes.js (que continua com sua própria
// invocação da factory para as rotas de campaigns que ficam lá) — sem duplicar a função.

import { createLeadMessaging, isGroupJid } from "../shared/leadMessaging.js";
import { summarizeChatWithAI } from "../leads/chatInsight.js";
import { applyCorsHeaders } from "../../services/corsPolicy.js";
import { upsertLeadByPhone, isRealName } from "../../services/leadUpsert.js";
import { buildPhoneLookupVariants } from "../../services/leadImport.js";
import { OutlierQualificationBot } from "../../hardcoded-chatbot-outlier.js";
import { resolveEvolutionInstanceOwner } from "../../services/evolution.js";

const SQL_CANONICAL_PHONE = (col) => `
  CASE
    WHEN ${col} LIKE '%@%' THEN ${col}
    WHEN length(regexp_replace(${col}, '\\D', '', 'g')) = 12 AND regexp_replace(${col}, '\\D', '', 'g') ~ '^55[1-9]{2}[6-9]'
      THEN '55' || substr(regexp_replace(${col}, '\\D', '', 'g'), 3, 2) || '9' || substr(regexp_replace(${col}, '\\D', '', 'g'), 5)
    WHEN length(regexp_replace(${col}, '\\D', '', 'g')) = 10 AND regexp_replace(${col}, '\\D', '', 'g') ~ '^[1-9]{2}[6-9]'
      THEN '55' || substr(regexp_replace(${col}, '\\D', '', 'g'), 1, 2) || '9' || substr(regexp_replace(${col}, '\\D', '', 'g'), 3)
    WHEN length(regexp_replace(${col}, '\\D', '', 'g')) = 10 AND regexp_replace(${col}, '\\D', '', 'g') ~ '^[1-9]{2}[2-5]'
      THEN '55' || regexp_replace(${col}, '\\D', '', 'g')
    WHEN length(regexp_replace(${col}, '\\D', '', 'g')) = 11 AND regexp_replace(${col}, '\\D', '', 'g') ~ '^[1-9]{2}9'
      THEN '55' || regexp_replace(${col}, '\\D', '', 'g')
    ELSE regexp_replace(${col}, '\\D', '', 'g')
  END
`;

const SQL_NUMBER_CHANGE_MATCH = (col) => `(
  ${col} ~* 'estamos\\s+desativando\\s+esse\\s+n[úu]mero|chama\\s+meu\\s+vendedor|nos\\s+chame\\s+no\\s+(contato|n[úu]mero|link)|novo\\s+n[úu]mero|troca\\s+de\\s+n[úu]mero'
)`;

const SQL_AUTOMATION_MATCH = (col) => `(
  ${col} ~* 'digite\\s+(apenas\\s+)?(o\\s+)?(n[úu]mero|\\d)|selecione\\s+(uma\\s+)?(das\\s+)?opç[õo]|escolha\\s+(um\\s+)?(dos\\s+)?n[úu]meros?|escreva\\s+uma\\s+das\\s+opç[õo]es|opç[ãa]o\\s+(desejada|inv[áa]lida)|\\bmenu\\b|atendimento\\s+autom[áa]tico|protocolo\\s+de\\s+atendimento|resposta\\s+autom[áa]tica|\\[mensagem\\s+autom[áa]tica\\]|vou\\s+te\\s+transferir\\s+para\\s+nossa\\s+equipe|agradece\\s+(o\\s+)?seu\\s+contato|agradecemos\\s+(o\\s+)?seu\\s+contato|agradecemos\\s+a\\s+prefer[êe]ncia|seja\\s+(muito\\s+)?bem[- ]vindo\\(a\\)|hor[áa]rios?\\s+de\\s+atendimento|nosso\\s+(showroom|card[áa]pio|cat[áa]logo|site)|finalizarei\\s+nossa\\s+intera[çc][ãa]o|n[ãa]o\\s+consegui\\s+identificar\\s+nenhuma\\s+resposta|vou\\s+encerrar\\s+esse\\s+atendimento|atendimento\\s+foi\\s+finalizado|responder\\s+a\\s+nossa\\s+pesquisa'
)`;

import { classifyConversation } from "../../services/whatsappChatClassifier.js";
import { getChatMemory } from "../../hardcoded-chatbot.js";
import { defaultGroqModel } from "../../services/llmModels.js";
import {
  bufferMessage,
  resolveMessageContent,
  processBatch,
  isFirstCampaignReply,
  extractBriefingWithAI,
  LLM_MODELS,
  getLlmProviderStatus,
} from "../../chatbot-ai-engine.js";
import {
  persistChatbotProgress,
  determineSPINPhase,
  qualifyLead,
  trackInvalidResponse,
} from "../../hardcoded-chatbot-persistence.js";
import { parseStoredHistorico } from "../../leads-outlier-schema.js";
import { resolveInboundAgentConfig, buildSpinInstruction, fireInboundCompletionWebhook } from "../../services/inboundAgent.js";
import {
  shouldIgnoreInboundEvent,
  resolveInboundEventName,
  isFromMe,
  resolveMessageId,
} from "../../services/inboundGuard.js";
import {
  resolveInboundScope,
  shouldEngageInbound,
  INBOUND_SCOPE_ALL,
} from "../../services/inboundEngagementPolicy.js";
import { resolveSdrTarget, resolveTenantSdrNumbers, normalizeSdrNumber } from "../../services/sdrTarget.js";
import { resolveCampaignAgent, AGENTE_CAMPANHA, AGENTE_NENHUM } from "../../services/campaignAgentRouting.js";
import { validateOutboundMessage } from "../../services/jsonExtractor.js";
import { getCampaignStepPlan } from "../../campaign-outbound.js";
import { normalizeCampaignPendingStepIndex } from "../../campaign/dispatch.js";
import {
  isWithinSendWindow,
  resolveSendWindowConfig,
} from "../../services/sendWindow.js";

export function registerChatbotRoutes(app, deps) {
  const {
    ensureDb,
    getLeadClientEvolutionInstances,
    getLeadClientN8nSettings,
    internalErrorPayloadDetails,
    isMissingSchemaError,
    leadsTableName,
    maskPhoneForLog,
    MAX_LEADS_OUTLIER_BATCH,
    continueCampaignLeadFromReply,
    findCampaignReplyMatches,
    normalizeString,
    normalizeTenantKey,
    pgDatabasePool,
    requireAppViewAccess,
    requireFirebaseAuth,
    resolveAuthorizedClientId,
    resolveDispatchWebhookSettings,
    resolveInboundDispatchSettings,
    sanitizePhone,
    sendError,
    supabase,
    validateLeadsOutlierRecord,
    validateN8nInboundBearer,
  } = deps;

  const { appendLeadMessage } = createLeadMessaging({
    supabase,
    normalizeString,
    leadsTableName,
    isMissingSchemaError,
  });

  const lastKanbanDivergenceByTenant = new Map();

  // Aceita um chip ou VÁRIOS separados por vírgula ("Chip A,Chip B") — o inbox
  // permite selecionar mais de um chip ao mesmo tempo. Devolve todos os aliases
  // (nome amigável, id e nome extraído da URL da Evolution) de cada um.
  async function resolveInstanceNameAliases(clientId, rawInstanceName) {
    if (!rawInstanceName || rawInstanceName === "all") return null;

    const requested = String(rawInstanceName)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (requested.length === 0) return null;

    let allInstances;
    try {
      allInstances = await getLeadClientEvolutionInstances(clientId);
    } catch (err) {
      console.error("[chatbot-aliases] falha de leitura no banco ao buscar instâncias Evolution para aliases", {
        clientId,
        rawInstanceName,
        error: err?.message || String(err),
      });
      // Degradação com log: como é rota de listagem/filtro visual de tela (inbox),
      // degrada utilizando os próprios nomes literais requisitados em vez de silenciar ou retornar vazio.
      return requested;
    }
    const aliases = new Set();

    for (const wanted of requested) {
      aliases.add(wanted);
      const matched = allInstances.find((inst) => {
        const urlName = inst.dispatch_webhook_url
          ? inst.dispatch_webhook_url.split("/").filter(Boolean).pop()
          : null;
        return inst.name === wanted || inst.id === wanted || urlName === wanted;
      });
      if (matched) {
        if (matched.name) aliases.add(matched.name);
        if (matched.id) aliases.add(matched.id);
        if (matched.dispatch_webhook_url) {
          const urlName = matched.dispatch_webhook_url.split("/").filter(Boolean).pop();
          if (urlName) aliases.add(urlName);
        }
      }
    }

    return Array.from(aliases);
  }

  /**
   * Esta conversa ja teve briefing enviado?
   *
   * Dedup por CONVERSA, sem TTL. A guarda de mensagem duplicada
   * (services/inboundGuard.js) expira em 10 min e nao segura um ciclo mais
   * lento — foi assim que qualificacoes ANTIGAS voltaram a ser reenviadas.
   *
   * Erro de leitura devolve TRUE: na duvida, NAO reenviar. Alerta repetido em
   * loop custa mais que alerta perdido, e o SDR ainda ve a conversa na tela.
   */
  async function briefingJaEnviado(clientId, phone) {
    if (!supabase || !clientId || !phone) return false;
    try {
      const phoneVariants = buildPhoneLookupVariants(phone);
      const { data, error } = await supabase
        .from(leadsTableName(clientId))
        .select("dados")
        .eq("client_id", clientId)
        .in("telefone", phoneVariants.length > 0 ? phoneVariants : [phone])
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) {
        console.warn("[chatbot-webhook] falha ao checar briefing ja enviado:", error.message);
        return true;
      }
      return Boolean(data?.[0]?.dados?.briefing_enviado_em);
    } catch (err) {
      console.warn("[chatbot-webhook] falha ao checar briefing ja enviado:", err?.message || err);
      return true;
    }
  }

  /** Marca a conversa como notificada, para o proximo evento nao reenviar. */
  async function marcarBriefingEnviado(clientId, phone) {
    if (!supabase || !clientId || !phone) return;
    try {
      const phoneVariants = buildPhoneLookupVariants(phone);
      const { data } = await supabase
        .from(leadsTableName(clientId))
        .select("id, dados")
        .eq("client_id", clientId)
        .in("telefone", phoneVariants.length > 0 ? phoneVariants : [phone])
        .order("created_at", { ascending: false })
        .limit(1);
      const lead = data?.[0];
      if (!lead?.id) return;
      await supabase
        .from(leadsTableName(clientId))
        .update({ dados: { ...(lead.dados || {}), briefing_enviado_em: new Date().toISOString() } })
        .eq("id", lead.id)
        .eq("client_id", clientId);
    } catch (err) {
      console.warn("[chatbot-webhook] falha ao marcar briefing enviado:", err?.message || err);
    }
  }

  /**
   * Manda a mesma mensagem para TODOS os numeros de SDR do tenant.
   *
   * Um numero que falha nao pode levar os outros junto: cada envio tem o proprio
   * try/catch e a falha e logada com o numero MASCARADO. Antes era um numero so
   * e um await solto — bastava a Evolution recusar para ninguem ser avisado.
   */
  async function enviarParaSdrs({ numeros, texto, evolutionUrl, evolutionHeaders, contexto = {} }) {
    const falhas = [];
    let enviados = 0;

    for (const numero of numeros) {
      try {
        const resposta = await fetch(evolutionUrl, {
          method: "POST",
          headers: evolutionHeaders,
          body: JSON.stringify({ number: numero, text: texto, message: texto }),
        });
        if (!resposta.ok) {
          const corpo = await resposta.text().catch(() => "");
          throw new Error(`HTTP ${resposta.status} ${corpo.slice(0, 120)}`);
        }
        enviados += 1;
      } catch (err) {
        falhas.push({ numero: maskPhoneForLog(numero), erro: err?.message || String(err) });
        console.error("[chatbot-webhook] falha ao notificar SDR", {
          ...contexto,
          sdr: maskPhoneForLog(numero),
          erro: err?.message || String(err),
        });
      }
    }

    return { enviados, falhas };
  }

  /**
   * Ja existe registro de lead com este telefone neste tenant?
   *
   * Em caso de erro devolve TRUE de proposito: falha de leitura nao pode
   * silenciar lead legitimo. Errar para o lado permissivo custa uma resposta
   * indevida; para o lado restritivo custa perder cliente que respondeu.
   */
  async function telefoneEhLeadConhecido(clientId, phone) {
    if (!supabase || !clientId || !phone) return false;
    try {
      const phoneVariants = buildPhoneLookupVariants(phone);
      const { data, error } = await supabase
        .from(leadsTableName(clientId))
        .select("id")
        .eq("client_id", clientId)
        .in("telefone", phoneVariants.length > 0 ? phoneVariants : [phone])
        .limit(1);

      if (error) {
        console.warn("[chatbot-webhook] falha ao checar lead conhecido:", error.message);
        return true;
      }
      return Array.isArray(data) && data.length > 0;
    } catch (err) {
      console.warn("[chatbot-webhook] falha ao checar lead conhecido:", err?.message || err);
      return true;
    }
  }

  // n8n / automação: insere leads no formato do chat outlier em `leads_outlier` (Bearer inbound por tenant).
  // O payload espelha colunas de `leads` (exceto tipo_cliente, faixa_consumo, cidade, estado) mais campos do chat.
  // Obrigatório: telefone, mensagem, finalizado, status_conversa. Temperatura: JSON `status` ou `lead_temperature` → BD `lead_temperature`; texto do pipeline CRM → `pipeline_status` → coluna `status`.
  app.post("/api/import-leads-outlier", async (req, res) => {
    if (!ensureDb(res)) return;

    try {
      const body = req.body || {};
      const rawList =
        body.leads ??
        body.records ??
        (body.lead != null ? [body.lead] : null) ??
        (body.record != null ? [body.record] : null);
      const items = Array.isArray(rawList) ? rawList : rawList != null ? [rawList] : [];

      if (items.length === 0) {
        sendError(res, 400, "INVALID_BODY", "Missing leads, records, lead, or record in body");
        return;
      }

      if (items.length > MAX_LEADS_OUTLIER_BATCH) {
        sendError(
          res,
          413,
          "PAYLOAD_TOO_LARGE",
          `Maximum ${MAX_LEADS_OUTLIER_BATCH} records per request`
        );
        return;
      }

      const clientId = normalizeTenantKey(body.client_id ?? body.clientId);
      if (!clientId) {
        sendError(res, 400, "INVALID_BODY", "Missing client_id");
        return;
      }

      if (!(await validateN8nInboundBearer(req, res, clientId))) {
        return;
      }

      const rows = [];
      for (let i = 0; i < items.length; i++) {
        const parsed = validateLeadsOutlierRecord(items[i], `items[${i}]`);
        if (parsed.error) {
          sendError(res, 400, "INVALID_BODY", parsed.error);
          return;
        }
        rows.push({ client_id: clientId, ...parsed.row });
      }

      const { data, error } = await supabase.from(leadsTableName(clientId)).insert(rows).select("id");

      if (error) {
        console.error("leads import insert error:", error);
        sendError(res, 500, "LEADS_OUTLIER_SAVE_FAILED", "Failed to save records", error.message);
        return;
      }

      res.status(201).json({
        success: true,
        count: rows.length,
        ids: data?.map((r) => r.id) || [],
      });
    } catch (error) {
      console.error("import-leads-outlier error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  });
  // Entrada n8n: insert em `leads_outlier` (mesmo Bearer que outros imports; validação em validateLeadsOutlierRecord — ver import-leads-outlier).
  app.post("/api/import-lead-outlier-n8n", async (req, res) => {
    if (!ensureDb(res)) return;

    try {
      const body = req.body || {};
      const leadsRaw = body.leads ?? (body.lead ? [body.lead] : []);
      const leads = Array.isArray(leadsRaw) ? leadsRaw : [leadsRaw];

      if (leads.length === 0) {
        sendError(res, 400, "INVALID_BODY", "Missing lead or leads array in body");
        return;
      }

      if (leads.length > MAX_LEADS_OUTLIER_BATCH) {
        sendError(
          res,
          413,
          "PAYLOAD_TOO_LARGE",
          `Maximum ${MAX_LEADS_OUTLIER_BATCH} records per request`
        );
        return;
      }

      const clientId = normalizeTenantKey(body.client_id ?? body.clientId);
      if (!clientId) {
        sendError(res, 400, "INVALID_BODY", "Missing client_id");
        return;
      }

      if (!(await validateN8nInboundBearer(req, res, clientId))) {
        return;
      }

      const rows = [];
      for (let i = 0; i < leads.length; i++) {
        const parsed = validateLeadsOutlierRecord(leads[i], `leads[${i}]`);
        if (parsed.error) {
          sendError(res, 400, "INVALID_BODY", parsed.error);
          return;
        }
        rows.push({ client_id: clientId, ...parsed.row });
      }

      const { data, error } = await supabase.from(leadsTableName(clientId)).insert(rows).select("id");

      if (error) {
        console.error("leads import n8n insert error:", error);
        sendError(res, 500, "LEADS_OUTLIER_SAVE_FAILED", "Failed to save records", error.message);
        return;
      }

      res.json({ success: true, count: rows.length, ids: data?.map((item) => item.id) || [] });
    } catch (error) {
      console.error("import-lead-outlier-n8n error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  });
  app.get("/api/whatsapp/chats", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (_req, res) => {
    if (!ensureDb(res)) return;
    try { await pgDatabasePool.query("ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS instance_name VARCHAR(150);").catch(() => {}); } catch(e) {}
    // contact_name/is_group: nome exibido e flag de grupo vivem na mensagem para o
    // inbox nao depender da tabela de leads (mostrar nome nao pode criar lead).
    try { await pgDatabasePool.query("ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS contact_name TEXT;").catch(() => {}); } catch(e) {}
    try { await pgDatabasePool.query("ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false;").catch(() => {}); } catch(e) {}
    try { await pgDatabasePool.query("ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS message_timestamp TIMESTAMPTZ;").catch(() => {}); } catch(e) {}

    try {
      await pgDatabasePool.query(`
        CREATE TABLE IF NOT EXISTS public.whatsapp_chat_states (
          client_id TEXT NOT NULL,
          phone TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'ativa',
          reason TEXT,
          source TEXT NOT NULL DEFAULT 'auto',
          changed_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (client_id, phone)
        );
        CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_states_client_state
          ON public.whatsapp_chat_states (client_id, state);
      `).catch(() => {});
    } catch(e) {}

    try {
      const search = normalizeString(_req.query.search)?.toLowerCase() || "";
      const rawTab = normalizeString(_req.query.tab)?.toLowerCase() || "ativa";
      const rawLimit = Number.parseInt(String(_req.query.limit || "100"), 10);
      const rawOffset = Number.parseInt(String(_req.query.offset || "0"), 10);
      const limit = Number.isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 200);
      const offset = Number.isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);

      const requestedClientId = normalizeString(_req.query.clientId);
      const clientId = resolveAuthorizedClientId(_req, res, requestedClientId);
      if (!clientId) return;

      const rawInstanceName = normalizeString(_req.query.instanceName) || null;
      const instanceAliases = await resolveInstanceNameAliases(clientId, rawInstanceName);
      const leadsTable = leadsTableName(clientId);

      const queryParams = [clientId];

      let instanceFilter = "";
      if (instanceAliases && instanceAliases.length > 0) {
        queryParams.push(instanceAliases);
        const idx = queryParams.length;
        instanceFilter = `AND instance_name = ANY($${idx})`;
      }

      let tabCondition = "";
      let searchFilter = "";

      if (search) {
        queryParams.push(`%${search}%`);
        const searchIdx = queryParams.length;
        // Busca ampla por nome, telefone canônico, telefone bruto, texto da mensagem ou pushName
        searchFilter = `AND (
          LOWER(COALESCE(l.nome, '')) LIKE $${searchIdx}
          OR m.phone LIKE $${searchIdx}
          OR m.raw_phone LIKE $${searchIdx}
          OR LOWER(COALESCE(m.message_text, '')) LIKE $${searchIdx}
          OR LOWER(COALESCE(m.contact_name, '')) LIKE $${searchIdx}
          OR LOWER(COALESCE(lm.contact_name, '')) LIKE $${searchIdx}
        ) AND COALESCE(cs.state, 'ativa') != 'lixeira'`;
      } else {
        if (rawTab === "grupos") {
          tabCondition = "AND m.is_group IS TRUE AND COALESCE(cs.state, 'ativa') != 'lixeira'";
        } else if (rawTab === "arquivada" || rawTab === "arquivadas") {
          tabCondition = "AND (m.is_group IS NOT TRUE) AND cs.state = 'arquivada'";
        } else if (rawTab === "automacao" || rawTab === "automacoes") {
          tabCondition = `AND (m.is_group IS NOT TRUE) AND (
            cs.state = 'automacao' OR (cs.state IS NULL AND ${SQL_AUTOMATION_MATCH("m.message_text")})
          ) AND NOT ${SQL_NUMBER_CHANGE_MATCH("m.message_text")}`;
        } else if (rawTab === "aguardando" || rawTab === "espera") {
          tabCondition = `AND (m.is_group IS NOT TRUE) AND (
            COALESCE(cs.state, 'ativa') = 'ativa' OR ${SQL_NUMBER_CHANGE_MATCH("m.message_text")}
          ) AND m.direction = 'inbound' AND (
            cs.attended_at IS NULL OR cs.attended_at < m.effective_timestamp
          ) AND (
            cs.state IS NOT NULL OR NOT ${SQL_AUTOMATION_MATCH("m.message_text")} OR ${SQL_NUMBER_CHANGE_MATCH("m.message_text")}
          )`;
        } else if (rawTab === "minhas") {
          // Filtro de mensagens ativas (podendo filtrar por atendente específico se fornecido)
          tabCondition = `AND (m.is_group IS NOT TRUE) AND (
            COALESCE(cs.state, 'ativa') = 'ativa' OR ${SQL_NUMBER_CHANGE_MATCH("m.message_text")}
          ) AND (
            cs.state IS NOT NULL OR NOT ${SQL_AUTOMATION_MATCH("m.message_text")} OR ${SQL_NUMBER_CHANGE_MATCH("m.message_text")}
          )`;
        } else if (rawTab === "todas" || rawTab === "all") {
          // Aba "Todas": exibe absolutamente tudo (grupos, ativas, automações, arquivadas), exceto lixeira
          tabCondition = "AND COALESCE(cs.state, 'ativa') != 'lixeira'";
        } else {
          // Padrão: "fila" / "ativa" (exclui grupos, automações e arquivadas)
          tabCondition = `AND (m.is_group IS NOT TRUE) AND (
            COALESCE(cs.state, 'ativa') = 'ativa' OR ${SQL_NUMBER_CHANGE_MATCH("m.message_text")}
          ) AND (
            cs.state IS NOT NULL OR NOT ${SQL_AUTOMATION_MATCH("m.message_text")} OR ${SQL_NUMBER_CHANGE_MATCH("m.message_text")}
          )`;
        }
      }

      let total = 0;
      let items = [];
      let counts = { active: 0, awaiting: 0, automations: 0, groups: 0, archived: 0 };

      try {
        // 1. Apura contadores gerais para as abas
        const countsQueryText = `
          WITH pre_canonical AS (
            SELECT
              ${SQL_CANONICAL_PHONE("phone")} as canonical_phone,
              COALESCE(message_timestamp, delivered_at, created_at) as effective_timestamp,
              direction,
              message_text,
              is_group
            FROM public.lead_messages
            WHERE client_id = $1 ${instanceFilter}
          ),
          latest_messages AS (
            SELECT DISTINCT ON (canonical_phone)
              canonical_phone as phone,
              direction,
              message_text,
              is_group,
              effective_timestamp
            FROM pre_canonical
            ORDER BY canonical_phone, effective_timestamp DESC NULLS LAST
          )
          SELECT
            COUNT(*) FILTER (WHERE m.is_group IS TRUE AND COALESCE(cs.state, 'ativa') != 'lixeira')::integer as groups_count,
            COUNT(*) FILTER (WHERE m.is_group IS NOT TRUE AND cs.state = 'arquivada')::integer as archived_count,
            COUNT(*) FILTER (
              WHERE m.is_group IS NOT TRUE
                AND (cs.state = 'automacao' OR (cs.state IS NULL AND ${SQL_AUTOMATION_MATCH("m.message_text")}))
                AND NOT ${SQL_NUMBER_CHANGE_MATCH("m.message_text")}
            )::integer as automations_count,
            COUNT(*) FILTER (
              WHERE m.is_group IS NOT TRUE
                AND (COALESCE(cs.state, 'ativa') = 'ativa' OR ${SQL_NUMBER_CHANGE_MATCH("m.message_text")})
                AND (cs.state IS NOT NULL OR NOT ${SQL_AUTOMATION_MATCH("m.message_text")} OR ${SQL_NUMBER_CHANGE_MATCH("m.message_text")})
            )::integer as active_count,
            COUNT(*) FILTER (
              WHERE m.is_group IS NOT TRUE
                AND (COALESCE(cs.state, 'ativa') = 'ativa' OR ${SQL_NUMBER_CHANGE_MATCH("m.message_text")})
                AND m.direction = 'inbound'
                AND (cs.attended_at IS NULL OR cs.attended_at < m.effective_timestamp)
                AND (cs.state IS NOT NULL OR NOT ${SQL_AUTOMATION_MATCH("m.message_text")} OR ${SQL_NUMBER_CHANGE_MATCH("m.message_text")})
            )::integer as awaiting_count
          FROM latest_messages m
          LEFT JOIN public.whatsapp_chat_states cs ON cs.client_id = $1 AND cs.phone = m.phone;
        `;
        const countsRes = await pgDatabasePool.query(countsQueryText, [clientId]);
        const countsRow = countsRes.rows[0];
        if (countsRow) {
          counts = {
            active: countsRow.active_count || 0,
            awaiting: countsRow.awaiting_count || 0,
            automations: countsRow.automations_count || 0,
            groups: countsRow.groups_count || 0,
            archived: countsRow.archived_count || 0,
          };
        }

        // 2. Count total para a listagem atual
        const countQueryText = `
          WITH pre_canonical AS (
            SELECT
              ${SQL_CANONICAL_PHONE("phone")} as canonical_phone,
              phone as raw_phone,
              message_text,
              direction,
              contact_name,
              is_group,
              COALESCE(message_timestamp, delivered_at, created_at) as effective_timestamp
            FROM public.lead_messages
            WHERE client_id = $1 ${instanceFilter}
          ),
          latest_messages AS (
            SELECT DISTINCT ON (canonical_phone)
              canonical_phone as phone,
              raw_phone,
              message_text,
              direction,
              contact_name,
              is_group,
              effective_timestamp
            FROM pre_canonical
            ORDER BY canonical_phone, effective_timestamp DESC NULLS LAST
          )
          SELECT COUNT(*)::integer as total
          FROM latest_messages m
          LEFT JOIN public."${leadsTable}" l ON ${SQL_CANONICAL_PHONE("l.telefone")} = m.phone AND l.client_id = $1
          LEFT JOIN public.whatsapp_chat_states cs ON cs.client_id = $1 AND cs.phone = m.phone
          LEFT JOIN public.whatsapp_lid_map lm ON lm.lid = m.phone OR lm.lid = m.raw_phone
          WHERE 1=1
          ${tabCondition}
          ${searchFilter}
        `;

        const countRes = await pgDatabasePool.query(countQueryText, queryParams);
        total = countRes.rows[0]?.total || 0;

        // 3. Query paginada de itens
        const queryParamsWithPaging = [...queryParams, limit, offset];
        const limitParamIdx = queryParams.length + 1;
        const offsetParamIdx = queryParams.length + 2;

        const queryText = `
          WITH pre_canonical AS (
            SELECT
              id,
              ${SQL_CANONICAL_PHONE("phone")} as canonical_phone,
              phone as raw_phone,
              message_text,
              direction,
              sender_type,
              delivered_at,
              created_at,
              message_timestamp,
              COALESCE(message_timestamp, delivered_at, created_at) as effective_timestamp,
              campaign_id,
              contact_name,
              is_group
            FROM public.lead_messages
            WHERE client_id = $1 ${instanceFilter}
          ),
          latest_messages AS (
            SELECT DISTINCT ON (canonical_phone)
              id,
              canonical_phone as phone,
              raw_phone,
              message_text,
              direction,
              sender_type,
              delivered_at,
              created_at,
              message_timestamp,
              effective_timestamp,
              campaign_id,
              contact_name,
              is_group
            FROM pre_canonical
            ORDER BY canonical_phone, effective_timestamp DESC NULLS LAST, id DESC
          )
          SELECT
            m.id,
            m.phone as phone_number,
            m.raw_phone,
            m.message_text,
            m.direction,
            m.sender_type,
            m.delivered_at,
            m.created_at,
            m.message_timestamp,
            m.effective_timestamp,
            m.campaign_id,
            m.contact_name,
            m.is_group,
            lm.profile_pic,
            lm.contact_name as profile_name,
            l.nome as lead_name,
            l.lead_origin,
            l.source_campaign_id,
            cs.state as chat_state,
            cs.reason as chat_state_reason,
            cs.source as chat_state_source,
            cs.changed_by as chat_state_changed_by,
            cs.attended_at as chat_attended_at,
            cs.attended_by as chat_attended_by
          FROM latest_messages m
          LEFT JOIN public."${leadsTable}" l ON ${SQL_CANONICAL_PHONE("l.telefone")} = m.phone AND l.client_id = $1
          LEFT JOIN public.whatsapp_chat_states cs ON cs.client_id = $1 AND cs.phone = m.phone
          LEFT JOIN public.whatsapp_lid_map lm ON lm.lid = m.phone OR lm.lid = m.raw_phone
          WHERE 1=1
          ${tabCondition}
          ${searchFilter}
          ORDER BY m.effective_timestamp DESC NULLS LAST, m.id DESC
          LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
        `;

        const result = await pgDatabasePool.query(queryText, queryParamsWithPaging);
        items = result.rows.map((row) => {
          const timestampVal = row.effective_timestamp ? Math.floor(new Date(row.effective_timestamp).getTime() / 1000) : null;
          const hasLead = Boolean(row.lead_name || row.lead_origin || row.source_campaign_id);
          const classified = classifyConversation(row.message_text, { hasLeadInCrm: hasLead, hasHumanReply: false });

          const isGroup = row.is_group === true;
          const isNumberChange = classified.isNumberChange === true;
          const effectiveState = row.chat_state || (isGroup ? "ativa" : classified.state);
          const effectiveReason = row.chat_state_reason || (isNumberChange ? "Mudança de número informada pelo contato" : classified.reason);
          const effectiveSource = row.chat_state_source || (row.chat_state ? "manual" : "auto");

          return {
            id: row.phone_number,
            name: row.contact_name || row.profile_name || row.lead_name || row.phone_number,
            profilePic: row.profile_pic || null,
            isGroup,
            unreadCount: 0,
            timestamp: timestampVal,
            archived: effectiveState === "arquivada",
            state: effectiveState,
            stateReason: effectiveReason,
            stateSource: effectiveSource,
            isNumberChange,
            pinned: false,
            muted: false,
            attendedAt: row.chat_attended_at || null,
            attendedBy: row.chat_attended_by || null,
            lastMessage: {
              id: null,
              body: row.message_text || "",
              fromMe: row.direction === "outbound",
              senderType: row.sender_type || (row.direction === "outbound" ? "agent" : "lead"),
              timestamp: timestampVal,
              type: "chat",
            },
            leadOrigin: row.lead_origin || null,
            sourceCampaignId: row.source_campaign_id || null,
          };
        });
      } catch (pgErr) {
        console.warn("[whatsapp/chats] Postgres query warning/fallback:", pgErr?.message);
      }

      res.json({
        items,
        total: total || items.length,
        counts,
        nextOffset: offset + items.length,
        hasMore: offset + items.length < (total || items.length),
      });
    } catch (error) {
      console.warn("whatsapp chats endpoint warning:", error?.message || error);
      res.json({ items: [], total: 0, counts: { active: 0, awaiting: 0, automations: 0, groups: 0, archived: 0 }, nextOffset: 0, hasMore: false });
    }
  });

  // POST /api/whatsapp/chats/state — altera o estado de uma conversa (ativa, automacao, arquivada, lixeira)
  app.post("/api/whatsapp/chats/state", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = resolveAuthorizedClientId(req, res, req.body?.clientId);
    if (!clientId) return;

    const phone = sanitizePhone(req.body?.phone);
    const state = normalizeString(req.body?.state)?.toLowerCase();
    const reason = normalizeString(req.body?.reason) || null;

    if (!phone || !["ativa", "automacao", "arquivada", "lixeira"].includes(state)) {
      sendError(res, 400, "INVALID_BODY", "Telefone ou estado inválido");
      return;
    }

    try {
      const changedBy = req.user?.email || "user";
      await pgDatabasePool.query(
        `INSERT INTO public.whatsapp_chat_states (client_id, phone, state, reason, source, changed_by, updated_at)
         VALUES ($1, $2, $3, $4, 'manual', $5, now())
         ON CONFLICT (client_id, phone) DO UPDATE SET
           state = EXCLUDED.state,
           reason = EXCLUDED.reason,
           source = 'manual',
           changed_by = EXCLUDED.changed_by,
           updated_at = now()`,
        [clientId, phone, state, reason, changedBy]
      );
      res.json({ success: true, phone, state, reason });
    } catch (err) {
      console.error("[whatsapp/chats/state] erro:", err?.message || err);
      sendError(res, 500, "STATE_UPDATE_ERROR", err?.message || "Erro ao atualizar estado da conversa");
    }
  });

  // POST /api/whatsapp/chats/state/bulk — altera o estado de múltiplas conversas em lote
  app.post("/api/whatsapp/chats/state/bulk", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = resolveAuthorizedClientId(req, res, req.body?.clientId);
    if (!clientId) return;

    const phones = Array.isArray(req.body?.phones) ? req.body.phones.map(sanitizePhone).filter(Boolean) : [];
    const state = normalizeString(req.body?.state)?.toLowerCase();
    const reason = normalizeString(req.body?.reason) || null;

    if (phones.length === 0 || !["ativa", "automacao", "arquivada", "lixeira"].includes(state)) {
      sendError(res, 400, "INVALID_BODY", "Lista de telefones ou estado inválido");
      return;
    }

    try {
      const changedBy = req.user?.email || "user";
      for (const phone of phones) {
        await pgDatabasePool.query(
          `INSERT INTO public.whatsapp_chat_states (client_id, phone, state, reason, source, changed_by, updated_at)
           VALUES ($1, $2, $3, $4, 'manual', $5, now())
           ON CONFLICT (client_id, phone) DO UPDATE SET
             state = EXCLUDED.state,
             reason = EXCLUDED.reason,
             source = 'manual',
             changed_by = EXCLUDED.changed_by,
             updated_at = now()`,
          [clientId, phone, state, reason, changedBy]
        );
      }
      res.json({ success: true, count: phones.length, state });
    } catch (err) {
      console.error("[whatsapp/chats/state/bulk] erro:", err?.message || err);
      sendError(res, 500, "BULK_STATE_UPDATE_ERROR", err?.message || "Erro ao atualizar estados em lote");
    }
  });

  // POST /api/whatsapp/chats/attend — marca conversa como atendida pontual (sai da Espera sem sair da Fila)
  app.post("/api/whatsapp/chats/attend", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = resolveAuthorizedClientId(req, res, req.body?.clientId);
    if (!clientId) return;

    const phone = sanitizePhone(req.body?.phone);
    if (!phone) {
      sendError(res, 400, "INVALID_PHONE", "Telefone é obrigatório");
      return;
    }

    try {
      const attendedBy = req.user?.email || "user";
      await pgDatabasePool.query(
        `INSERT INTO public.whatsapp_chat_states (client_id, phone, state, attended_at, attended_by, source, updated_at)
         VALUES ($1, $2, 'ativa', now(), $3, 'manual', now())
         ON CONFLICT (client_id, phone) DO UPDATE SET
           attended_at = now(),
           attended_by = EXCLUDED.attended_by,
           updated_at = now()`,
        [clientId, phone, attendedBy]
      );
      res.json({ success: true, phone, attended_at: new Date().toISOString(), attended_by: attendedBy });
    } catch (err) {
      console.error("[whatsapp/chats/attend] erro:", err?.message || err);
      sendError(res, 500, "ATTEND_ERROR", err?.message || "Erro ao marcar conversa como atendida");
    }
  });

  // POST /api/whatsapp/chats/create-lead — cadastra contato inbound como lead no CRM
  app.post("/api/whatsapp/chats/create-lead", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = resolveAuthorizedClientId(req, res, req.body?.clientId);
    if (!clientId) return;

    const phone = sanitizePhone(req.body?.phone);
    if (!phone) {
      sendError(res, 400, "INVALID_PHONE", "Telefone é obrigatório");
      return;
    }

    const contactName = isRealName(req.body?.name) ? normalizeString(req.body.name) : null;
    const leadSource = "inbound";

    try {
      // 1. Tentar pegar o nome e instância das mensagens se não veio no body
      let finalName = contactName;
      let msgInstanceName = req.body?.instanceName || null;
      const msgQuery = await pgDatabasePool.query(
        `SELECT contact_name, instance_name FROM public.lead_messages 
         WHERE client_id = $1 AND (${SQL_CANONICAL_PHONE("phone")} = $2 OR phone = $2)
         ORDER BY COALESCE(message_timestamp, delivered_at, created_at) DESC LIMIT 1`,
        [clientId, phone]
      );
      if (!finalName && msgQuery.rows[0]?.contact_name && isRealName(msgQuery.rows[0].contact_name)) {
        finalName = msgQuery.rows[0].contact_name;
      }
      if (!msgInstanceName && msgQuery.rows[0]?.instance_name) {
        msgInstanceName = msgQuery.rows[0].instance_name;
      }

      const assignedOwnerUid = await resolveEvolutionInstanceOwner({
        clientId,
        instanceName: msgInstanceName,
        pool: pgDatabasePool,
      });

      // 2. Upsert do lead na tabela public.leads
      await upsertLeadByPhone(pgDatabasePool, clientId, phone, {
        nome: finalName || null,
        phone: phone,
        lead_origin: leadSource,
        lead_source: leadSource,
        status: "NOVO",
        assigned_to: assignedOwnerUid || null,
        qualificacao: "Lead inbound cadastrado via WhatsApp",
        historico: `Lead cadastrado a partir do WhatsApp Inbox em ${new Date().toLocaleString("pt-BR")}`,
      });

      // 3. Buscar o lead criado para retornar completo
      const leadRes = await pgDatabasePool.query(
        `SELECT * FROM public.leads 
         WHERE client_id = $1 AND (${SQL_CANONICAL_PHONE("telefone")} = $2 OR phone = $2 OR telefone = $2) 
         ORDER BY updated_at DESC LIMIT 1`,
        [clientId, phone]
      );

      const createdLead = leadRes.rows[0];
      if (createdLead?.id) {
        try {
          await pgDatabasePool.query(
            `UPDATE public.lead_messages 
             SET lead_id = $1 
             WHERE client_id = $2 AND (${SQL_CANONICAL_PHONE("phone")} = $3 OR phone = $3)`,
            [createdLead.id, clientId, phone]
          );
        } catch (e) {
          console.warn("[create-lead] lead_messages update lead_id warning:", e?.message);
        }
      }

      res.json({
        ok: true,
        success: true,
        message: "Lead cadastrado com sucesso",
        lead: createdLead || { client_id: clientId, telefone: phone, nome: finalName, lead_source: leadSource, lead_origin: leadSource },
      });
    } catch (err) {
      console.error("[create-lead-from-chat] erro:", err?.message || err);
      sendError(res, 500, "CREATE_LEAD_ERROR", err?.message || "Erro ao cadastrar lead");
    }
  });

  // POST /api/whatsapp/chats/create-leads-bulk — cadastra múltiplos contatos inbound como leads em lote
  app.post("/api/whatsapp/chats/create-leads-bulk", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = resolveAuthorizedClientId(req, res, req.body?.clientId);
    if (!clientId) return;

    const items = Array.isArray(req.body?.items)
      ? req.body.items
      : Array.isArray(req.body?.phones)
      ? req.body.phones.map((p) => ({ phone: p }))
      : [];

    if (items.length === 0) {
      sendError(res, 400, "INVALID_BODY", "Lista de contatos/telefones é obrigatória");
      return;
    }

    try {
      let createdCount = 0;
      const leadSource = "inbound";

      for (const item of items) {
        const phone = sanitizePhone(item.phone || item.id);
        if (!phone) continue;

        let finalName = isRealName(item.name) ? normalizeString(item.name) : null;
        let itemInstanceName = item.instanceName || null;
        const msgQuery = await pgDatabasePool.query(
          `SELECT contact_name, instance_name FROM public.lead_messages 
           WHERE client_id = $1 AND (${SQL_CANONICAL_PHONE("phone")} = $2 OR phone = $2)
           ORDER BY COALESCE(message_timestamp, delivered_at, created_at) DESC LIMIT 1`,
          [clientId, phone]
        );
        if (!finalName && msgQuery.rows[0]?.contact_name && isRealName(msgQuery.rows[0].contact_name)) {
          finalName = msgQuery.rows[0].contact_name;
        }
        if (!itemInstanceName && msgQuery.rows[0]?.instance_name) {
          itemInstanceName = msgQuery.rows[0].instance_name;
        }
        const assignedOwnerUid = await resolveEvolutionInstanceOwner({
          clientId,
          instanceName: itemInstanceName,
          pool: pgDatabasePool,
        });

        await upsertLeadByPhone(pgDatabasePool, clientId, phone, {
          nome: finalName || null,
          phone: phone,
          lead_origin: leadSource,
          lead_source: leadSource,
          status: "NOVO",
          assigned_to: assignedOwnerUid || null,
          qualificacao: "Lead inbound cadastrado via WhatsApp (em lote)",
          historico: `Lead cadastrado em lote a partir do WhatsApp Inbox em ${new Date().toLocaleString("pt-BR")}`,
        });

        // Vincular mensagens ao lead cadastrado
        try {
          const leadRow = await pgDatabasePool.query(
            `SELECT id FROM public.leads 
             WHERE client_id = $1 AND (${SQL_CANONICAL_PHONE("telefone")} = $2 OR phone = $2 OR telefone = $2) 
             ORDER BY updated_at DESC LIMIT 1`,
            [clientId, phone]
          );
          if (leadRow.rows[0]?.id) {
            await pgDatabasePool.query(
              `UPDATE public.lead_messages 
               SET lead_id = $1 
               WHERE client_id = $2 AND (${SQL_CANONICAL_PHONE("phone")} = $3 OR phone = $3)`,
              [leadRow.rows[0].id, clientId, phone]
            );
          }
        } catch (e) {
          console.warn("[create-leads-bulk] lead_messages update lead_id warning:", e?.message);
        }

        createdCount++;
      }

      res.json({
        ok: true,
        success: true,
        count: createdCount,
        message: `${createdCount} leads cadastrados com sucesso`,
      });
    } catch (err) {
      console.error("[create-leads-bulk] erro:", err?.message || err);
      sendError(res, 500, "BULK_CREATE_LEAD_ERROR", err?.message || "Erro ao cadastrar leads em lote");
    }
  });

  app.post("/api/whatsapp/chats/read", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    const chatId = normalizeString(req.body?.chatId);
    if (!chatId) {
      sendError(res, 400, "INVALID_BODY", "Missing chatId");
      return;
    }
    res.json({ success: true, chatId });
  });

  app.post("/api/whatsapp/chats/:chatId/summarize", requireFirebaseAuth, async (req, res) => {
    try {
      const { chatId } = req.params;
      const { messages, contactName, clientId: requestedClientId } = req.body || {};
      const clientId = resolveAuthorizedClientId(req, res, requestedClientId) || requestedClientId;

      let messageTexts = Array.isArray(messages)
        ? messages.map((m) => (typeof m === "string" ? m : m?.body || "")).filter(Boolean)
        : [];

      const cleanPhone = String(chatId).replace(/\D/g, "");

      // Se o payload não tiver mensagens ou tiver poucas, busca as mensagens reais do banco
      if (messageTexts.length < 2 && cleanPhone && clientId && pgDatabasePool) {
        const phoneVariants = [cleanPhone, `+${cleanPhone}`, `${cleanPhone}@s.whatsapp.net`];
        const dbMsgs = await pgDatabasePool
          .query(
            `SELECT direction, message_text, sender_type, delivered_at
             FROM public.lead_messages
             WHERE client_id = $1 AND (phone = ANY($2) OR remote_jid = ANY($2))
             ORDER BY delivered_at ASC
             LIMIT 50`,
            [clientId, phoneVariants]
          )
          .catch(() => ({ rows: [] }));

        if (Array.isArray(dbMsgs?.rows) && dbMsgs.rows.length > 0) {
          const dbTexts = dbMsgs.rows
            .map((r) => {
              const who = r.direction === "outbound" ? "Empresa/Consultor" : (contactName || "Lead");
              const txt = (r.message_text || "").trim();
              return txt ? `${who}: ${txt}` : null;
            })
            .filter(Boolean);
          if (dbTexts.length > messageTexts.length) {
            messageTexts = dbTexts;
          }
        }
      }

      console.log(`[summarize-chat] Resumindo chat ${chatId} (${messageTexts.length} msgs) para client ${clientId}`);
      const insight = await summarizeChatWithAI(messageTexts, contactName || "Contato", {
        clientId,
        supabase,
        pool: pgDatabasePool,
      });

      if (!insight?.summary) {
        const errorReason = insight?.error || "A IA não retornou um resumo válido para o histórico fornecido.";
        const ehCota = /cota de ia|rate.?limit|tokens por minuto|TPM/i.test(String(errorReason));
        console.warn(`[summarize-chat] Falha na IA para o chat ${chatId} (client: ${clientId}): ${errorReason}`);
        // CORS aqui e responsabilidade do middleware cors(), que roda antes de
        // toda rota (server.js:427), com reforco em sendError/applyCorsHeaders.
        // Copia local numa rota so nao escala e refletia origem nao validada.
        applyCorsHeaders(res, req.headers?.origin);
        return res.status(ehCota ? 429 : 502).json({
          success: false,
          ...(ehCota ? { code: "LLM_QUOTA_EXCEEDED" } : {}),
          error: ehCota
            ? "Cota de IA esgotada — o resumo não foi gerado."
            : "Não foi possível gerar o resumo com IA no momento. Tente novamente.",
          reason: errorReason,
        });
      }

      const summaryText = insight.summary;

      // Atualiza no banco de dados SOMENTE quando o resumo REAL da IA foi gerado com sucesso
      if (cleanPhone && clientId && pgDatabasePool) {
        const last8 = cleanPhone.slice(-8);
        const updRes = await pgDatabasePool
          .query(
            `UPDATE public.leads 
             SET dados = jsonb_set(COALESCE(dados, '{}'::jsonb), '{resumo_chat}', to_jsonb($1::text)),
                 raw_chat_summary = $1,
                 updated_at = NOW()
             WHERE client_id = $2 AND (
               telefone = $3 OR phone = $3 OR 
               telefone = $4 OR phone = $4 OR
               telefone LIKE $5 OR phone LIKE $5
             )`,
            [summaryText, clientId, cleanPhone, `+${cleanPhone}`, `%${last8}`]
          )
          .catch((e) => {
            console.warn("[summarize-chat] DB update warning:", e.message);
            return null;
          });

        if (!updRes || updRes.rowCount === 0) {
          await upsertLeadByPhone(pgDatabasePool, clientId, cleanPhone, {
            nome: contactName && contactName !== "não informado" ? contactName : null,
            phone: cleanPhone,
            raw_chat_summary: summaryText,
            extracted_from_wa: true,
          }).catch((e) => console.warn("[summarize-chat] DB upsert warning:", e.message));
        }
      }

      res.json({
        success: true,
        summary: summaryText,
        priority: insight?.prioridade || "media",
        suggestedChannel: insight?.canalSugerido || "followup",
      });
    } catch (error) {
      console.error("[summarize-chat] Erro ao resumir conversa:", error);
      res.status(500).json({ error: "Falha ao gerar resumo com IA.", reason: error?.message });
    }
  });

  app.delete("/api/whatsapp/chats/clear", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;
    try { await pgDatabasePool.query("ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS instance_name VARCHAR(150);").catch(() => {}); } catch(e) {}
    // contact_name/is_group: nome exibido e flag de grupo vivem na mensagem para o
    // inbox nao depender da tabela de leads (mostrar nome nao pode criar lead).
    try { await pgDatabasePool.query("ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS contact_name TEXT;").catch(() => {}); } catch(e) {}
    try { await pgDatabasePool.query("ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false;").catch(() => {}); } catch(e) {}

    try {
      const requestedClientId = normalizeString(req.query.clientId || req.body.clientId);
      const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
      if (!clientId) return;

      const rawInstanceName = normalizeString(req.query.instanceName || req.body.instanceName) || null;
      const instanceAliases = await resolveInstanceNameAliases(clientId, rawInstanceName);

      let queryText = `DELETE FROM public.lead_messages WHERE client_id = $1`;
      let queryParams = [clientId];

      if (instanceAliases && instanceAliases.length > 0) {
        queryText += ` AND instance_name = ANY($2)`;
        queryParams.push(instanceAliases);
      }

      const result = await pgDatabasePool.query(queryText, queryParams);
      res.json({ success: true, deletedCount: result.rowCount });
    } catch (error) {
      console.error("[whatsapp/chats] clear error:", error);
      sendError(res, 500, "CLEAR_FAILED", "Failed to clear chats");
    }
  });
  app.get("/api/whatsapp/messages", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;

    try {
      const chatId = normalizeString(req.query.chatId);
      const rawLimit = Number.parseInt(String(req.query.limit || "50"), 10);
      const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 200);

      const requestedClientId = normalizeString(req.query.clientId);
      const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
      if (!clientId) return;

      const rawInstanceName = normalizeString(req.query.instanceName) || null;
      const instanceAliases = await resolveInstanceNameAliases(clientId, rawInstanceName);

      if (!chatId) {
        sendError(res, 400, "INVALID_QUERY", "Missing chatId");
        return;
      }

      // Conversas de grupo/LID são gravadas com o jid inteiro em phone
      // (ex.: "120363...@g.us"). sanitizePhone removeria o sufixo e a busca não
      // casaria — era por isso que clicar num grupo mostrava "Sem mensagens
      // carregadas". Aceita as duas formas: o chatId como veio e só os dígitos.
      const isJidChat = chatId.includes("@");
      const cleanPhone = isJidChat ? chatId : sanitizePhone(chatId);
      const phoneVariants = isJidChat
        ? [chatId]
        : Array.from(new Set([chatId, cleanPhone, ...buildPhoneLookupVariants(chatId)].filter(Boolean)));
      const queryParams = [clientId, phoneVariants, limit];

      let instanceFilter = "";
      if (instanceAliases && instanceAliases.length > 0) {
        queryParams.push(instanceAliases);
        const idx = queryParams.length;
        instanceFilter = `AND instance_name = ANY($${idx})`;
      }

      const rawBefore = normalizeString(req.query.beforeTimestamp || req.query.before);
      let beforeFilter = "";
      if (rawBefore) {
        let beforeIso = null;
        const num = Number(rawBefore);
        if (!Number.isNaN(num) && num > 0) {
          const ms = num < 10000000000 ? num * 1000 : num;
          beforeIso = new Date(ms).toISOString();
        } else {
          const parsed = new Date(rawBefore);
          if (!Number.isNaN(parsed.getTime())) {
            beforeIso = parsed.toISOString();
          }
        }
        if (beforeIso) {
          queryParams.push(beforeIso);
          const idx = queryParams.length;
          beforeFilter = `AND COALESCE(message_timestamp, delivered_at, created_at) < $${idx}`;
        }
      }

      const rawAfter = normalizeString(req.query.afterTimestamp || req.query.after);
      let afterFilter = "";
      if (rawAfter) {
        let afterIso = null;
        const num = Number(rawAfter);
        if (!Number.isNaN(num) && num > 0) {
          const ms = num < 10000000000 ? num * 1000 : num;
          afterIso = new Date(ms).toISOString();
        } else {
          const parsed = new Date(rawAfter);
          if (!Number.isNaN(parsed.getTime())) {
            afterIso = parsed.toISOString();
          }
        }
        if (afterIso) {
          queryParams.push(afterIso);
          const idx = queryParams.length;
          afterFilter = `AND COALESCE(message_timestamp, delivered_at, created_at) > $${idx}`;
        }
      }

      const queryText = `
        SELECT
          id,
          phone,
          message_text,
          direction,
          delivered_at,
          created_at,
          message_timestamp,
          COALESCE(message_timestamp, delivered_at, created_at) as effective_timestamp,
          wa_message_id,
          sender_type
        FROM public.lead_messages
        WHERE client_id = $1 AND phone = ANY($2) ${instanceFilter} ${beforeFilter} ${afterFilter}
        ORDER BY COALESCE(message_timestamp, delivered_at, created_at) DESC NULLS LAST, id DESC
        LIMIT $3
      `;
      const result = await pgDatabasePool.query(queryText, queryParams);

      // Supressão de duplicatas históricas na leitura (reversível, sem apagar do banco):
      // 1. Linhas com o mesmo wa_message_id
      // 2. Linhas com mesma direção, mesmo texto (trim) e timestamp dentro de uma janela de 10s
      const dedupedRows = [];
      const seenWaIds = new Set();

      for (const row of result.rows) {
        if (row.wa_message_id && typeof row.wa_message_id === "string" && row.wa_message_id.trim()) {
          const waId = row.wa_message_id.trim();
          if (seenWaIds.has(waId)) {
            continue;
          }
          seenWaIds.add(waId);
        }

        const rowTime = new Date(row.effective_timestamp || row.message_timestamp || row.delivered_at || row.created_at || 0).getTime();
        const rowText = (row.message_text || "").trim();
        const rowDirection = row.direction || "";

        const isDuplicate = dedupedRows.some((existing) => {
          if (existing.direction !== rowDirection) return false;
          const existingText = (existing.message_text || "").trim();
          if (existingText !== rowText) return false;
          const existingTime = new Date(existing.effective_timestamp || existing.message_timestamp || existing.delivered_at || existing.created_at || 0).getTime();
          return Math.abs(rowTime - existingTime) <= 10000;
        });

        if (isDuplicate) {
          continue;
        }

        dedupedRows.push(row);
      }

      let items = dedupedRows.map((row) => {
        const timestampVal = row.effective_timestamp
          ? Math.floor(new Date(row.effective_timestamp).getTime() / 1000)
          : (row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null);
        return {
          id: String(row.id),
          body: row.message_text || "",
          from: row.direction === "inbound" ? cleanPhone : "me",
          to: row.direction === "outbound" ? cleanPhone : "me",
          author: null,
          fromMe: row.direction === "outbound",
          timestamp: timestampVal,
          createdAt: row.created_at,
          messageTimestamp: row.message_timestamp,
          waMessageId: row.wa_message_id,
          phone: row.phone,
          direction: row.direction,
          senderType: row.sender_type || (row.direction === "outbound" ? "agent" : "lead"),
          type: "chat",
          hasMedia: false,
        };
      });

      const oldestRow = result.rows[result.rows.length - 1];
      const oldestTimestamp = oldestRow?.effective_timestamp
        ? new Date(oldestRow.effective_timestamp).toISOString()
        : (oldestRow?.created_at ? new Date(oldestRow.created_at).toISOString() : null);

      const newestRow = result.rows[0];
      const newestTimestamp = newestRow?.effective_timestamp
        ? new Date(newestRow.effective_timestamp).toISOString()
        : (newestRow?.created_at ? new Date(newestRow.created_at).toISOString() : null);

      res.json({
        items: items.reverse(),
        hasMore: result.rows.length === limit,
        oldestTimestamp,
        newestTimestamp,
      });
    } catch (error) {
      console.error("whatsapp database messages query error:", error);
      sendError(res, 500, "WHATSAPP_MESSAGES_FAILED", error instanceof Error ? error.message : "Failed to fetch messages from database");
    }
  });
  app.post("/api/whatsapp/messages", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;

    try {
      const chatId = normalizeString(req.body?.chatId);
      const body = normalizeString(req.body?.body);
      const requestedClientId = normalizeString(req.body?.clientId);

      const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
      if (!clientId) return;

      if (!chatId || !body) {
        sendError(res, 400, "INVALID_BODY", "Missing chatId or body");
        return;
      }

      const cleanPhone = sanitizePhone(chatId);

      // Locate active/default Evolution instance for this client
      const instances = await getLeadClientEvolutionInstances(clientId);
      const activeInstance = instances.find(inst => inst.active && inst.is_default) || instances.find(inst => inst.active);

      if (!activeInstance) {
        sendError(res, 400, "NO_ACTIVE_WHATSAPP_CHIP", "Nao ha nenhum chip WhatsApp ativo configurado para esta empresa.");
        return;
      }

      const webhookUrl = activeInstance.dispatch_webhook_url;
      const webhookToken = activeInstance.dispatch_webhook_token;

      // Guarda de saída obrigatória: impede envio de templates com {{...}} ou tags não substituídas
      const guard = validateOutboundMessage(body);
      if (!guard.valid) {
        console.error("[manual-chat] BLOQUEIO DE SEGURANÇA: Mensagem contém variável não substituída ou formato inválido. Envio cancelado!", {
          clientId,
          phone: cleanPhone,
          motivo: guard.reason,
          preview: body.slice(0, 100),
        });
        sendError(res, 400, "OUTBOUND_GUARD_BLOCKED", `Mensagem bloqueada pela guarda de segurança: ${guard.reason}`);
        return;
      }

      // Construct and send message payload to Evolution API
      const payload = {
        source: "vexocrm",
        provider: "evolution",
        type: "text",
        stepType: "text",
        number: cleanPhone,
        text: body,
        message: body,
      };

      const headers = { "Content-Type": "application/json" };
      if (webhookToken) {
        headers.apikey = webhookToken;
        headers.Authorization = `Bearer ${webhookToken}`;
      }

      console.info("[manual-chat] dispatching manual response to Evolution API", {
        phone: cleanPhone,
        webhookUrl,
      });

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(responseText || `HTTP ${response.status}`);
      }

      // Log sent message in the database
      // instanceName must be the Evolution API name (last URL path segment) to match
      // what the sync and webhook store in lead_messages.instance_name.
      const evoInstanceName = webhookUrl
        ? new URL(webhookUrl).pathname.split("/").filter(Boolean).pop() || activeInstance.name
        : activeInstance.name;

      await appendLeadMessage({
        clientId,
        phone: cleanPhone,
        senderType: "agent",
        direction: "outbound",
        messageText: body,
        deliveredAt: new Date().toISOString(),
        messageTimestamp: new Date().toISOString(),
        instanceName: evoInstanceName,
        meta: {
          source: "manual-inbox-reply",
          instanceId: activeInstance.id,
        },
      });

      const timestampVal = Math.floor(Date.now() / 1000);
      res.status(201).json({
        item: {
          id: `msg-${Date.now()}`,
          body,
          from: "me",
          to: cleanPhone,
          author: null,
          fromMe: true,
          timestamp: timestampVal,
          type: "chat",
          hasMedia: false,
        }
      });
    } catch (error) {
      console.error("whatsapp database send message error:", error);
      sendError(res, 500, "WHATSAPP_SEND_FAILED", error instanceof Error ? error.message : "Failed to send message via Evolution API");
    }
  });
  // GET /api/prompts — lê prompt customizado de uma empresa por tipo
  app.get("/api/prompts", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = normalizeTenantKey(req.query?.clientId);
    const type = normalizeString(req.query?.type);
    if (!clientId) return sendError(res, 400, "INVALID_QUERY", "Missing clientId");
    if (!type || !["padrao", "extrato", "resumo"].includes(type)) {
      return sendError(res, 400, "INVALID_QUERY", "type must be padrao, extrato or resumo");
    }
    try {
      const { data, error } = await supabase
        .from("chatbot_prompts")
        .select("client_id, type, content, updated_at, updated_by_email")
        .eq("client_id", clientId)
        .eq("type", type)
        .maybeSingle();
      if (error) {
        if (isMissingSchemaError(error)) return sendError(res, 404, "NOT_FOUND", "Prompt not found");
        throw error;
      }
      if (!data) return res.json({ success: true, item: null });
      return res.json({
        success: true,
        item: {
          clientId: data.client_id,
          type: data.type,
          content: data.content,
          updatedAt: data.updated_at,
          updatedByEmail: data.updated_by_email,
        },
      });
    } catch (err) {
      sendError(res, 500, "PROMPT_FETCH_FAILED", err instanceof Error ? err.message : "Failed to fetch prompt");
    }
  });

  // PUT /api/prompts — salva/atualiza prompt customizado de uma empresa
  app.put("/api/prompts", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientId = normalizeTenantKey(body.clientId);
    const type = normalizeString(body.type);
    const content = typeof body.content === "string" ? body.content.trim() : null;
    if (!clientId) return sendError(res, 400, "INVALID_BODY", "Missing clientId");
    if (!type || !["padrao", "extrato", "resumo"].includes(type)) {
      return sendError(res, 400, "INVALID_BODY", "type must be padrao, extrato or resumo");
    }
    if (!content) return sendError(res, 400, "INVALID_BODY", "Missing content");
    try {
      const userEmail = normalizeString(req.authAccess?.email || req.authUser?.email) || null;
      const { data, error } = await supabase
        .from("chatbot_prompts")
        .upsert(
          { client_id: clientId, type, content, updated_at: new Date().toISOString(), updated_by_email: userEmail },
          { onConflict: "client_id,type" }
        )
        .select("client_id, type, content, updated_at, updated_by_email")
        .maybeSingle();
      if (error) throw error;
      return res.json({
        success: true,
        item: {
          clientId: data.client_id,
          type: data.type,
          content: data.content,
          updatedAt: data.updated_at,
          updatedByEmail: data.updated_by_email,
        },
      });
    } catch (err) {
      sendError(res, 500, "PROMPT_SAVE_FAILED", err instanceof Error ? err.message : "Failed to save prompt");
    }
  });
  // GET /api/chatbot-templates/builtins — templates built-in visíveis ao tenant.
  //
  // Antes filtrava client_id IS NULL e, quando nada voltava, devolvia uma lista
  // ESCRITA NO CÓDIGO com Áureo (Outlier) e Lara (Infinie). Como nenhum template
  // tem client_id nulo — outlier pertence a "outlier", infinie a "infinie" — a
  // consulta voltava vazia sempre e essas duas personas apareciam para todos os
  // tenants, mesmo depois de aqueles clientes saírem da carteira. Nada de
  // fallback fabricado: se não há built-in visível, a lista volta vazia.
  app.get("/api/chatbot-templates/builtins", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = normalizeTenantKey(req.query?.clientId);
    try {
      let query = supabase
        .from("chatbot_templates")
        .select("template_key, display_name, agent_name, client_id")
        .eq("is_builtin", true);

      // Built-in global (sem dono) ou built-in do próprio tenant.
      query = clientId
        ? query.or(`client_id.is.null,client_id.eq.${clientId}`)
        : query.is("client_id", null);

      const { data, error } = await query.order("created_at", { ascending: true });
      if (error) throw error;
      return res.json({ templates: data || [] });
    } catch (err) {
      console.error("[chatbot-templates] falha ao listar built-ins:", err?.message || err);
      return sendError(res, 500, "BUILTINS_FETCH_FAILED", err?.message || "Falha ao listar templates");
    }
  });

  // GET /api/chatbot-llm-models — lista modelos de LLM registrados e status dos provedores (API keys no servidor)
  app.get("/api/chatbot-llm-models", requireFirebaseAuth, async (req, res) => {
    return res.json({
      models: LLM_MODELS,
      defaultModel: defaultGroqModel(),
      providerStatus: getLlmProviderStatus(),
    });
  });

  // GET /api/chatbot-templates — lista templates (built-ins globais + do cliente)
  app.get("/api/chatbot-templates", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = normalizeTenantKey(req.query?.clientId);
    if (!clientId) return sendError(res, 400, "MISSING_CLIENT_ID", "clientId is required");
    try {
      const { data, error } = await supabase
        .from("chatbot_templates")
        .select("*")
        .or(`client_id.is.null,client_id.eq.${clientId}`)
        .order("is_builtin", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return res.json({ templates: data || [] });
    } catch (err) {
      sendError(res, 500, "TEMPLATES_FETCH_FAILED", err instanceof Error ? err.message : "Failed to fetch templates");
    }
  });

  // PUT /api/chatbot-templates — cria ou atualiza template de cliente
  app.put("/api/chatbot-templates", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientId = normalizeTenantKey(body.clientId ?? body.client_id);
    const templateKey = normalizeString(body.templateKey ?? body.template_key);
    const displayName = normalizeString(body.displayName ?? body.display_name);
    const agentName = normalizeString(body.agentName ?? body.agent_name) ?? "";
    const agentRole = normalizeString(body.agentRole ?? body.agent_role) ?? "";
    const dataFields = Array.isArray(body.dataFields ?? body.data_fields) ? (body.dataFields ?? body.data_fields) : [];
    const requiredFields = Array.isArray(body.requiredFields ?? body.required_fields) ? (body.requiredFields ?? body.required_fields) : [];
    const classification = body.classification && typeof body.classification === "object" ? body.classification : { quente: "", morno: "", frio: "" };

    if (!clientId || !templateKey || !displayName) {
      return sendError(res, 400, "INVALID_BODY", "clientId, templateKey and displayName are required");
    }
    try {
      const { data, error } = await supabase
        .from("chatbot_templates")
        .upsert(
          {
            template_key: templateKey,
            client_id: clientId,
            display_name: displayName,
            agent_name: agentName,
            agent_role: agentRole,
            data_fields: dataFields,
            required_fields: requiredFields,
            classification,
            is_builtin: false,
            updated_at: new Date().toISOString(),
            updated_by_email: req.authAccess?.email ?? null,
          },
          { onConflict: "template_key,client_id" }
        )
        .select()
        .single();
      if (error) throw error;
      return res.json({ template: data });
    } catch (err) {
      sendError(res, 500, "TEMPLATE_SAVE_FAILED", err?.message || JSON.stringify(err) || "Failed to save template");
    }
  });

  // DELETE /api/chatbot-templates/:id — remove template (não permite deletar built-ins)
  app.delete("/api/chatbot-templates/:id", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const id = normalizeString(req.params?.id);
    if (!id) return sendError(res, 400, "INVALID_PARAM", "Missing id");
    try {
      const { data: tmpl, error: fetchErr } = await supabase
        .from("chatbot_templates")
        .select("id, is_builtin")
        .eq("id", id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!tmpl) return sendError(res, 404, "NOT_FOUND", "Template not found");
      if (tmpl.is_builtin) return sendError(res, 403, "FORBIDDEN", "Cannot delete built-in templates");
      const { error } = await supabase.from("chatbot_templates").delete().eq("id", id);
      if (error) throw error;
      return res.json({ success: true });
    } catch (err) {
      sendError(res, 500, "TEMPLATE_DELETE_FAILED", err instanceof Error ? err.message : "Failed to delete template");
    }
  });
  /**
   * POST /api/hardcoded-chat
   * Processa mensagens para o chatbot hardcoded (ex: Outlier Qualification)
   * Body: { clientId, phone, message }
   */
  app.post("/api/hardcoded-chat", async (req, res) => {
    if (!ensureDb(res)) return;

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientId = normalizeTenantKey(body.clientId ?? body.client_id);
    const phone = sanitizePhone(body.phone ?? body.telefone ?? body.number);
    const userMessage = normalizeString(body.message ?? body.text) || null;

    console.log("[hardcoded-chat] Request:", { clientId, phone: maskPhoneForLog(phone), hasMessage: !!userMessage });

    if (!clientId || !phone) {
      sendError(res, 400, "INVALID_BODY", "Missing clientId or phone");
      return;
    }

    try {
      console.log("[hardcoded-chat] Initializing chatbot");
      // Instanciar chatbot (atualmente suporta apenas Outlier)
      const chatbot = new OutlierQualificationBot(clientId);

      // Processar mensagem
      let response;
      if (!userMessage) {
        // Iniciar conversa
        console.log("[hardcoded-chat] Initializing conversation");
        response = await chatbot.initializeChat(phone);
      } else {
        // Processar resposta
        console.log("[hardcoded-chat] Processing response");
        response = await chatbot.processResponse(phone, userMessage);
      }

      if (userMessage) {
        await appendLeadMessage({
          clientId,
          phone,
          senderType: "lead",
          direction: "inbound",
          messageText: userMessage,
          messageTimestamp: new Date().toISOString(),
          meta: { source: "hardcoded-chat-api" },
        });
      }

      console.log("[hardcoded-chat] Response status:", response.status);

      // Se houver erro na resposta, rastrear tentativa inválida
      if (response.status === "invalid_response" && userMessage) {
        await trackInvalidResponse({
          supabase,
          clientId,
          phone,
          stepId: response.retryStepId,
          response: userMessage,
          errorMessage: response.message,
        });
      }

      // Salvar progresso incrementalmente se conversa está ativa
      if (response.status !== "failed") {
        console.log("[hardcoded-chat] Getting chat memory");
        const memory = await getChatMemory(phone, clientId);
        console.log("[hardcoded-chat] Memory found:", !!memory);

        if (memory) {
          const spinPhase = determineSPINPhase(memory.currentStepId);
          const qualification = qualifyLead(memory.collectedData);
          const metrics = chatbot.generateMetrics(memory);

          console.log("[hardcoded-chat] Persisting progress");
          const persistResult = await persistChatbotProgress({
            supabase,
            clientId,
            phone,
            telefone: phone,
            currentStepId: memory.currentStepId,
            collectedData: memory.collectedData,
            conversationStatus: memory.status,
            spinFase: spinPhase,
            qualificationStatus: qualification,
            mensagem: response.message,
            isFinalized: response.status === "completed",
          });

          console.log("[hardcoded-chat] Persist result:", persistResult.success);

          if (!persistResult.success) {
            console.warn(
              "[hardcoded-chat] Failed to persist progress:",
              persistResult.error
            );
          }

          // Adicionar métricas à resposta
          response.metrics = metrics;
          response.leadId = persistResult.leadId || null;

          if (response.message) {
            await appendLeadMessage({
              clientId,
              phone,
              senderType: "bot",
              direction: "outbound",
              messageText: response.message,
              leadId: persistResult.leadId || null,
              engagementSignal: qualification,
              messageTimestamp: new Date().toISOString(),
              meta: {
                source: "hardcoded-chat-api",
                conversationStatus: memory.status || null,
                stepId: memory.currentStepId || null,
              },
            });
          }
        }
      }

      console.log("[hardcoded-chat] Sending response");
      res.json({
        success: response.status !== "failed",
        clientId,
        phone: maskPhoneForLog(phone),
        ...response,
      });
    } catch (error) {
      console.error("[hardcoded-chat] Error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  });

  /**
   * POST /api/hardcoded-chat-webhook
   * Webhook para receber mensagens do WhatsApp via Evolution API
   * Integração com chatbot hardcoded
   */
  app.post("/api/hardcoded-chat-webhook", async (req, res) => {
    const startTime = Date.now();
    const body = req.body && typeof req.body === "object" ? req.body : {};

    const responder = (statusPayload, logExtra = {}) => {
      const duracaoMs = Date.now() - startTime;
      console.log(`[chatbot-webhook] HTTP 200 respondido em ${duracaoMs}ms`, {
        ...statusPayload,
        ...logExtra,
      });
      res.json({ success: true, ...statusPayload });
    };

    // Guarda de loop. Roda ANTES de qualquer buffering, chamada de LLM ou envio.
    // Cobre tres casos: mensagem que nos mesmos enviamos (fromMe), eco de evento
    // que nao e mensagem de lead (o webhook e assinado tambem em SEND_MESSAGE) e
    // reprocessamento do mesmo id. Incidente real: o alerta de recontato do SDR
    // voltou como entrada e disparou outro alerta, 8 vezes.
    // Instrumentacao do caminho de entrada. Toda saida daqui para baixo LOGA o
    // motivo: tres rodadas de depuracao se perderam porque a mensagem do lead
    // sumia em silencio e nao dava para saber em qual descarte.
    const descartar = (motivo, extra = {}) => {
      const duracaoMs = Date.now() - startTime;
      console.log(`[chatbot-webhook] descartado (${duracaoMs}ms)`, { motivo, ...extra });
      res.json({ success: true, ignored: motivo });
    };

    const eventoBruto = body?.event ?? body?.Event ?? body?.eventName ?? null;
    const guarda = shouldIgnoreInboundEvent(body);
    console.log("[chatbot-webhook] entrada", {
      evento: eventoBruto,
      eventoNormalizado: resolveInboundEventName(body) || null,
      fromMe: isFromMe(body),
      messageId: resolveMessageId(body) || null,
      passou: !guarda.ignore,
      motivo: guarda.reason,
    });
    if (guarda.ignore) {
      responder({ ignored: guarda.reason });
      return;
    }

    // Descarta mensagem de GRUPO/broadcast antes de qualquer lookup no banco ou chatbot.
    const rawRemoteJid = body.data?.key?.remoteJid ?? body.remoteJid ?? body.senderJid ?? null;
    if (isGroupJid(rawRemoteJid)) {
      descartar("group", { remoteJid: rawRemoteJid });
      return;
    }

    const clientId = normalizeTenantKey(
      body.clientId ?? body.client_id ?? req.query.clientId ?? req.query.client_id
    ) || "outlier";

    const phone = sanitizePhone(
      body.phone || body.telefone || body.remoteJid ||
      body.data?.key?.remoteJid || body.senderJid
    );

    if (!phone) {
      const duracaoMs = Date.now() - startTime;
      console.log(`[chatbot-webhook] descartado (${duracaoMs}ms)`, { motivo: "missing_phone", clientId, remoteJid: rawRemoteJid });
      res.json({ success: false, error: "Missing phone" });
      return;
    }

    const instanceName = body.instance || body.instanceName || req.query.instanceName || req.query.instance || null;

    // Detectar tipo e extrair conteúdo da mensagem
    let messageData = null;
    try {
      messageData = await resolveMessageContent(body);
    } catch (err) {
      console.error("[chatbot-webhook] resolveMessageContent error:", err?.message || err);
    }

    if (!messageData || !messageData.text) {
      descartar("empty_message", { type: messageData?.type, phone: maskPhoneForLog(phone) });
      return;
    }

    const fromMe = isFromMe(body);

    // ── ETAPA 3: GRAVAÇÃO DA MENSAGEM (SEMPRE, INBOUND OU OUTBOUND/FROM_ME) ──
    // Se fromMe = true: gravada como direction "outbound" e senderType "device".
    // Se fromMe = false: gravada como direction "inbound" e senderType "lead".
    // Idempotência garantida via wa_message_id.
    try {
      await appendLeadMessage({
        clientId,
        phone,
        senderType: fromMe ? "device" : "lead",
        direction: fromMe ? "outbound" : "inbound",
        messageText: messageData.text,
        meta: {
          source: fromMe ? "device-whatsapp-webhook" : "hardcoded-chat-webhook",
          messageType: messageData.type || null,
          transcribed: messageData.transcribed === true,
          described: messageData.described === true,
          fromMe,
        },
        instanceName,
        waMessageId: messageData.waMessageId || resolveMessageId(body) || null,
        messageTimestamp: messageData.messageTimestamp || new Date().toISOString(),
      });
    } catch (msgErr) {
      console.warn(`[chatbot-webhook] falha ao gravar mensagem ${fromMe ? "outbound/fromMe" : "inbound"} em lead_messages:`, msgErr?.message || msgErr);
    }

    // Auto-reativação e manutenção de estados:
    // 1. Arquivada + qualquer mensagem nova -> volta para ativa
    // 2. Automação + mensagem que casa com padrão -> PERMANECE em automacao
    // 3. Automação + mensagem livre (não casa) ou resposta no celular (fromMe) -> volta para ativa
    try {
      if (pgDatabasePool && phone) {
        // 1. Desarquiva se estava arquivada
        await pgDatabasePool.query(
          `UPDATE public.whatsapp_chat_states
             SET state = 'ativa',
                 reason = 'Reativada automaticamente por nova mensagem',
                 source = 'auto',
                 updated_at = now()
           WHERE client_id = $1 AND phone = $2 AND state = 'arquivada'`,
          [clientId, phone]
        );

        // 2. Classifica a mensagem para decidir o estado de automação
        const classified = classifyConversation(messageData?.text || "", { hasHumanReply: fromMe });
        if (fromMe || classified.state === "ativa" || classified.isNumberChange) {
          // Mensagem humana livre, resposta no aparelho pelo consultor ou mudança de número: volta para ativa
          await pgDatabasePool.query(
            `UPDATE public.whatsapp_chat_states
               SET state = 'ativa',
                   reason = $3,
                   source = 'auto',
                   updated_at = now()
             WHERE client_id = $1 AND phone = $2 AND state = 'automacao'`,
            [
              clientId,
              phone,
              classified.isNumberChange
                ? "Mudança de número informada pelo contato"
                : fromMe
                ? "Reativada por resposta manual no aparelho"
                : "Reativada por mensagem humana livre",
            ]
          );
        } else {
          // Mensagem recebida ainda é robô/menu/URA: permanece em automação e atualiza motivo
          await pgDatabasePool.query(
            `UPDATE public.whatsapp_chat_states
               SET reason = $3,
                   updated_at = now()
             WHERE client_id = $1 AND phone = $2 AND state = 'automacao'`,
            [clientId, phone, classified.reason || "Automação / Robô detectado"]
          );
        }
      }
    } catch (reactivateErr) {
      console.warn("[chatbot-webhook] erro ao auto-reativar conversa:", reactivateErr?.message || reactivateErr);
    }

    // Se for mensagem fromMe (digitada pelo consultor no celular ou eco de envio),
    // a gravação no Conversas já foi realizada com sucesso — NUNCA aciona IA ou campanha!
    if (fromMe) {
      console.log("[chatbot-webhook] mensagem outbound do aparelho gravada no Conversas (sem acionamento de IA)", {
        clientId,
        phone: maskPhoneForLog(phone),
        waMessageId: messageData.waMessageId || resolveMessageId(body) || null,
      });
      responder({ saved: "outbound_from_me" });
      return;
    }

    // ── ETAPA 4: CAMPAIGN ROUTING (AVANÇA PASSO DE CAMPANHA, SE HOUVER) ──
    // Se o lead respondeu a uma campanha com passo pós-resposta (waitForReply),
    // avança o fluxo da campanha INDEPENDENTEMENTE do agente de IA estar ligado ou desligado.
    let chatbotPromptTypeOverride = null; // "campanha" | "padrao" | null
    let activeCampaignForLead = null;
    let campaignPromptIdOverride = null;
    let temCampanhaParaEsteTelefone = false;
    let activeWaitCampaignToDispatch = null;

    try {
      const campaignReplyContext = await findCampaignReplyMatches({ clientId, phone });
      const activeWaitCampaign = campaignReplyContext.processingWaitForReplyMatches[0] || null;
      activeCampaignForLead = campaignReplyContext.activePeriodCampaign;
      temCampanhaParaEsteTelefone = (campaignReplyContext.matches?.length ?? 0) > 0;

      // Por que este lead caiu (ou nao) no fluxo de resposta.
      const candidato = campaignReplyContext.waitForReplyMatches[0] || campaignReplyContext.matches[0] || null;
      const progressoConsultado = candidato?.leadImportItem?.progress ?? null;
      console.log("[campaign-routing] contexto", {
        clientId,
        phone: maskPhoneForLog(phone),
        campanhasCasadas: campaignReplyContext.matches.length,
        comWaitForReply: campaignReplyContext.waitForReplyMatches.length,
        emProcessamento: campaignReplyContext.processingWaitForReplyMatches.length,
        campanhaCandidata: candidato?.id ?? null,
        matchSource: candidato?.matchSource ?? null,
        leadImportItemId: candidato?.leadImportItem?.id ?? null,
        temProgresso: progressoConsultado !== null,
        progressWaitForReply: progressoConsultado?.waitForReply ?? null,
        progressStatus: progressoConsultado?.status ?? null,
        progressNextStepIndex: progressoConsultado?.nextStepIndex ?? null,
        periodoAtivo: activeCampaignForLead?.id ?? null,
      });

      if (activeWaitCampaign) {
        // Lead aguardando resposta de disparo com waitForReply: avalia se há próximo passo a enviar
        const stepPlan = getCampaignStepPlan(activeWaitCampaign.analyticsMeta || {});
        const steps = stepPlan.enabledSteps || [];
        const progress = activeWaitCampaign.leadImportItem?.progress || {};
        const nextStepIndex = normalizeCampaignPendingStepIndex(progress.nextStepIndex);
        const hasRemainingSteps = nextStepIndex !== null && nextStepIndex < steps.length;

        if (hasRemainingSteps) {
          activeWaitCampaignToDispatch = activeWaitCampaign;
        } else {
          // Se a sequência de disparos acabou e a campanha possui modo "agente", aciona o prompt da campanha
          const waitCampaignIsAgente = activeWaitCampaign.mode === "agente";
          if (waitCampaignIsAgente && activeCampaignForLead) {
            campaignPromptIdOverride = activeCampaignForLead.campaignPromptId || null;
            if (!campaignPromptIdOverride) {
              console.warn("[campaign-routing] campanha agente sem campaignPromptId — usando prompt padrão de atendimento", {
                clientId, campaignId: activeWaitCampaign.id,
              });
              chatbotPromptTypeOverride = "padrao";
            } else {
              chatbotPromptTypeOverride = "campanha";
              console.log("[campaign-routing] wait_for_reply_agente_prompt", {
                clientId, phone: maskPhoneForLog(phone),
                campaignId: activeWaitCampaign.id, campaignPromptId: campaignPromptIdOverride,
              });
            }
          } else {
            responder({ status: "skipped_disparo_only" }, { clientId, phone: maskPhoneForLog(phone) });
            return;
          }
        }
      } else if (activeCampaignForLead) {
        const escolha = resolveCampaignAgent(activeCampaignForLead);
        if (escolha.agente === AGENTE_NENHUM || escolha.bloqueado) {
          console.log("[campaign-routing] campanha configurada como Sem IA (apenas passos) — IA bloqueada:", {
            clientId,
            phone: maskPhoneForLog(phone),
            campaignId: activeCampaignForLead.id,
            campaignName: activeCampaignForLead.name,
            porque: escolha.porque,
          });
          responder({ status: "skipped_disparo_only", motivo: "campanha_sem_ia" }, { clientId, phone: maskPhoneForLog(phone) });
          return;
        }
        campaignPromptIdOverride = escolha.campaignPromptId;
        chatbotPromptTypeOverride = escolha.agente === AGENTE_CAMPANHA && escolha.campaignPromptId ? "campanha" : "padrao";
        if (escolha.configuracaoIncompleta) {
          console.warn("[campaign-routing] campanha marcada como agente SEM roteiro — caindo no atendimento padrão", {
            clientId, campaignId: activeCampaignForLead.id,
          });
        }
        console.log("[campaign-routing] agente escolhido", {
          clientId, phone: maskPhoneForLog(phone),
          agente: escolha.agente,
          porque: escolha.porque,
          campaignId: activeCampaignForLead.id,
          campaignName: activeCampaignForLead.name,
          campaignPromptId: escolha.campaignPromptId,
          mode: activeCampaignForLead.mode || null,
          endsAt: activeCampaignForLead.endsAt,
        });
      } else {
        console.log("[campaign-routing] agente escolhido", {
          clientId, phone: maskPhoneForLog(phone),
          agente: "atendimento",
          porque: "nenhuma campanha ativa para este telefone",
        });
      }
    } catch (err) {
      console.warn("[chatbot-webhook] campaign routing check failed, continuing normal flow:", err.message);
    }

    // ── CAMINHO 1: DISPARO DO PRÓXIMO PASSO DE CAMPANHA (EXCLUSÃO MÚTUA ESTREITA) ──
    if (activeWaitCampaignToDispatch) {
      // 1. Responde 200 IMEDIATAMENTE ao Evolution (evita timeout e retry)
      responder({ status: "campaign_step_dispatched" }, {
        clientId,
        phone: maskPhoneForLog(phone),
        campaignId: activeWaitCampaignToDispatch.id,
      });

      // 2. Executa avanço da campanha e envio do passo de forma assíncrona fora do ciclo HTTP
      (async () => {
        try {
          const itemId = activeWaitCampaignToDispatch.leadImportItem?.id;
          const { isFirst } = await isFirstCampaignReply({
            itemId,
            campaignId: activeWaitCampaignToDispatch.id,
            supabase,
          });

          if (isFirst) {
            console.log("[campaign-routing] wait_for_reply_step_first", {
              clientId, phone: maskPhoneForLog(phone),
              campaignId: activeWaitCampaignToDispatch.id,
              campaignName: activeWaitCampaignToDispatch.name,
            });

            await supabase
              .from(leadsTableName(clientId))
              .update({
                lead_origin: "campaign",
                source_campaign_id: activeWaitCampaignToDispatch.id,
                source_campaign_name: activeWaitCampaignToDispatch.name || null,
                lead_source: "campanha",
              })
              .eq("client_id", clientId)
              .in("telefone", buildPhoneLookupVariants(phone))
              .catch((err) => console.warn("[chatbot-webhook] campaign lead_origin update failed:", err?.message || err));
          } else {
            console.log("[campaign-routing] wait_for_reply_step subsequent", {
              clientId, phone: maskPhoneForLog(phone),
              campaignId: activeWaitCampaignToDispatch.id,
              campaignName: activeWaitCampaignToDispatch.name,
            });
          }

          const progression = await continueCampaignLeadFromReply({
            clientId,
            phone,
            repliedAt: new Date().toISOString(),
            campaignMatch: activeWaitCampaignToDispatch,
            replyPayload: {},
          });

          console.log("[campaign-routing] campaign_progression", {
            clientId,
            campaignId: activeWaitCampaignToDispatch.id,
            phone: maskPhoneForLog(phone),
            continued: progression.continued,
            finalized: progression.finalized,
            campaignFinalized: progression.campaignFinalized,
            reason: progression.reason,
          });
        } catch (err) {
          console.error("[campaign-routing] ERRO CRÍTICO no avanço de passo de campanha:", {
            clientId,
            phone: maskPhoneForLog(phone),
            campaignId: activeWaitCampaignToDispatch.id,
            etapa: "continueCampaignLeadFromReply",
            error: err?.message || err,
            stack: err?.stack,
          });
        }
      })();

      // Retorna para garantir que o buffer e o chatbot IA NUNCA rodem neste turno
      return;
    }

    // ── CAMINHO 2: CHATBOT / AGENTE IA (INBOUND OU AGENTE DE CAMPANHA) ──
    // SÓ AQUI CONSULTA SE O AGENTE DE IA ESTÁ HABILITADO.
    // O toggle "chatbot_enabled" significa estritamente se o robô responde sozinho ou não.
    let tenantSettingsReadFailed = false;
    const tenantSettings = await getLeadClientN8nSettings(clientId).catch((err) => {
      tenantSettingsReadFailed = true;
      console.error("[chatbot-webhook] falha ao ler settings do tenant", {
        clientId,
        error: err?.message || String(err),
      });
      return null;
    });

    if (tenantSettings && tenantSettings.chatbot_enabled === false) {
      descartar("chatbot_disabled", { clientId, phone: maskPhoneForLog(phone) });
      return;
    }

    // Agente inbound configurado na tela "Agente IA → Inbound", por NUMERO.
    const inboundConfig = await resolveInboundAgentConfig({ supabase, clientId, instanceName }).catch((err) => {
      console.warn("[chatbot-webhook] falha ao resolver agente inbound:", err?.message || err);
      return null;
    });

    if (inboundConfig && !inboundConfig.enabled) {
      descartar("inbound_disabled", { clientId, instanceName });
      return;
    }

    // Chips explicitamente vinculados ao chatbot do tenant (aba Configuracoes).
    if (!inboundConfig) {
      const chipsDoChatbot = Array.isArray(tenantSettings?.chatbot_instances)
        ? tenantSettings.chatbot_instances.map((v) => String(v ?? "").trim()).filter(Boolean)
        : [];
      const chipAtual = String(instanceName || "").trim();
      if (chipsDoChatbot.length > 0) {
        const allTenantInstances = (await getLeadClientEvolutionInstances(clientId).catch(() => [])) || [];
        const aliasesDoChip = (await resolveInstanceNameAliases(clientId, chipAtual).catch(() => null)) || [];
        const nomesDoChipAtual = new Set([chipAtual, ...aliasesDoChip].filter(Boolean));

        const nomesMarcadosExpandidos = new Set(chipsDoChatbot);
        for (const inst of allTenantInstances) {
          const urlName = inst.dispatch_webhook_url?.split("/").filter(Boolean).pop();
          if (chipsDoChatbot.includes(inst.id) || chipsDoChatbot.includes(inst.name) || (urlName && chipsDoChatbot.includes(urlName))) {
            if (inst.id) nomesMarcadosExpandidos.add(inst.id);
            if (inst.name) nomesMarcadosExpandidos.add(inst.name);
            if (urlName) nomesMarcadosExpandidos.add(urlName);
          }
        }

        const vinculado = Array.from(nomesDoChipAtual).some((nome) => nomesMarcadosExpandidos.has(nome));
        if (!chipAtual || !vinculado) {
          const hasAnyValidConfiguredChip = allTenantInstances.some((inst) => {
            const urlName = inst.dispatch_webhook_url?.split("/").filter(Boolean).pop();
            return chipsDoChatbot.some((m) => m === inst.id || m === inst.name || (urlName && m === urlName));
          });

          if (!hasAnyValidConfiguredChip && allTenantInstances.length > 0) {
            console.warn("[chatbot-webhook] chips_marcados_orfaos: nenhum chip ativo do tenant casa com a lista marcada. Atendendo pelo chip ativo para evitar descarte de lead:", {
              clientId,
              chipAtual,
              chipsMarcados: chipsDoChatbot,
              instanciasAtivas: allTenantInstances.map((i) => i.name || i.id),
            });
          } else {
            descartar("chip_nao_vinculado", {
              clientId,
              chipAtual: chipAtual || null,
              aliasesDoChipAtual: Array.from(nomesDoChipAtual),
              chipsMarcados: chipsDoChatbot,
            });
            return;
          }
        }
      }
    }

    // Quem o chatbot pode atender. Escopo padrão ('leads_only') só engaja lead conhecido do tenant ou campanha.
    const escopoInbound = resolveInboundScope(tenantSettings);
    const telefoneEhSdr = resolveTenantSdrNumbers(tenantSettings).includes(normalizeSdrNumber(phone));
    if (escopoInbound !== INBOUND_SCOPE_ALL || telefoneEhSdr) {
      const leadConhecido = telefoneEhSdr ? false : await telefoneEhLeadConhecido(clientId, phone);
      const decisao = shouldEngageInbound({
        scope: escopoInbound,
        isKnownLead: leadConhecido,
        hasCampaignMatch: temCampanhaParaEsteTelefone,
        isSdrNumber: telefoneEhSdr,
      });
      if (!decisao.engage) {
        descartar(decisao.reason, { clientId, phone: maskPhoneForLog(phone), escopo: escopoInbound });
        return;
      }
    }

    // Responde imediatamente ao Evolution (evita timeout)
    responder({ status: "buffering" }, { clientId, phone: maskPhoneForLog(phone) });

    console.log("[chatbot-webhook] Buffering", {
      clientId,
      type: messageData.type,
      phone: maskPhoneForLog(phone),
      preview: messageData.text.slice(0, 60),
    });

    bufferMessage(clientId, phone, messageData, async (messages) => {
      try {

          const chatbotModel = body.modelOverride || tenantSettings?.chatbot_model;
          const promptType = chatbotPromptTypeOverride || "padrao";
          const aiResponse = await processBatch({
            clientId,
            phone,
            messages,
            supabase,
            model: chatbotModel,
            promptType,
            campaignPromptId: campaignPromptIdOverride,
            llmModel: inboundConfig?.model || null,
            inboundPrompt: inboundConfig?.prompt || null,
            inboundSpinInstruction: inboundConfig ? buildSpinInstruction(inboundConfig.spinFields) : "",
            instanceName,
          });

          if (!aiResponse?.mensagem || !String(aiResponse.mensagem).trim()) {
            console.warn("[chatbot-webhook] Resposta ausente ou vazia — nenhum envio realizado.", {
              clientId,
              phone: maskPhoneForLog(phone),
            });
            return;
          }

          // GUARDA DE SAÍDA OBRIGATÓRIA: impede vazamento de JSON cru ou chaves internas para o lead
          const outboundGuard = validateOutboundMessage(aiResponse.mensagem);
          if (!outboundGuard.valid) {
            console.error("[chatbot-webhook] BLOQUEIO DE SEGURANÇA: Resposta contém JSON cru ou chave interna vazada. Envio cancelado!", {
              clientId,
              phone: maskPhoneForLog(phone),
              motivo: outboundGuard.reason,
              preview: aiResponse.mensagem.slice(0, 100),
            });
            return;
          }

          // Janela de Horário Permitido: Checa se o tenant desativou o toggle "Agente responde fora da janela"
          const sendWindowConfig = resolveSendWindowConfig(tenantSettings);
          if (!sendWindowConfig.agentRepliesOutsideWindow && !isWithinSendWindow(new Date(), sendWindowConfig)) {
            console.info("[chatbot-webhook] Resposta do agente bloqueada: fora da janela de envio e toggle 'Agente responde fora da janela' está desativado", {
              clientId,
              phone: maskPhoneForLog(phone),
              sendWindowConfig: {
                start: sendWindowConfig.start,
                end: sendWindowConfig.end,
                timezone: sendWindowConfig.timezone,
              },
            });
            return;
          }

          // Enviar resposta via Evolution
          // Resolve pelo chip que RECEBEU a mensagem; sem identificar, cai no default
          // do tenant. Antes usava so o default (resolveDispatchWebhookSettings), que
          // ignora de qual numero veio a conversa — a IA gerava a resposta e o envio
          // abortava, com lead real em silencio.
          const dispatchSettings = await resolveInboundDispatchSettings({ clientId, instanceName });
          const { webhookUrl: evolutionUrl, webhookToken: evolutionToken } = dispatchSettings;

          if (!evolutionUrl) {
            // Nunca falhar em silencio: o log diz QUAIS fontes foram consultadas e o
            // que veio vazio em cada uma.
            console.error("[chatbot-webhook] resposta NAO enviada: sem URL da Evolution", {
              clientId,
              instanceName: instanceName || null,
              phone: maskPhoneForLog(phone),
              source: dispatchSettings.source,
              tentativas: dispatchSettings.tentativas,
            });
            return;
          }

          console.log("[chatbot-webhook] enviando resposta", {
            clientId,
            source: dispatchSettings.source,
            instanceName: dispatchSettings.instanceName || null,
          });

          const evolutionHeaders = { "Content-Type": "application/json" };
          if (evolutionToken) {
            evolutionHeaders.apikey = evolutionToken;
            evolutionHeaders.Authorization = `Bearer ${evolutionToken}`;
          }

          const evolutionResponse = await fetch(evolutionUrl, {
            method: "POST",
            headers: evolutionHeaders,
            body: JSON.stringify({
              number: phone,
              text: aiResponse.mensagem,
              message: aiResponse.mensagem,
              options: {
                delay: 2500,
                presence: "composing",
              },
            }),
          });

          if (evolutionResponse.ok) {
            console.log("[chatbot-webhook] Sent to WhatsApp", {
              phone: maskPhoneForLog(phone),
              status: aiResponse.status_conversa,
              classificacao: aiResponse.classificacao,
            });

            let outboundWaId = null;
            try {
              const evoData = await evolutionResponse.json();
              outboundWaId = evoData?.key?.id || evoData?.data?.key?.id || evoData?.messageId || null;
            } catch {
              // Ignora erro de parsing de json caso resposta seja texto
            }

            await appendLeadMessage({
              clientId,
              phone,
              senderType: "bot",
              direction: "outbound",
              messageText: aiResponse.mensagem,
              engagementSignal: aiResponse.classificacao || null,
              meta: {
                source: "hardcoded-chat-webhook",
                model: chatbotModel,
                conversationStatus: aiResponse.status_conversa || null,
                finalized: aiResponse.finalizado === true,
                recontact: aiResponse._recontato === true,
                classificacao: aiResponse.classificacao || null,
                dados: aiResponse.dados || {},
                spinFase: aiResponse.spin_fase || null,
              },
              instanceName,
              waMessageId: outboundWaId,
              messageTimestamp: new Date().toISOString(),
            });
          } else {
            const errText = await evolutionResponse.text();
            console.error("[chatbot-webhook] Evolution send failed:", evolutionResponse.status, errText.slice(0, 200));
          }

          // PRECEDENCIA DO SDR, documentada porque ja gerou confusao:
          //
          // 1. Agente inbound com "Permitir Transferencia" DESLIGADO -> ninguem
          //    e notificado. E escolha explicita do usuario naquele numero e
          //    vence o padrao do tenant. Nao e falta de configuracao.
          // 2. Agente inbound com transferencia ligada -> numero do proprio
          //    agente; sem ele, cai no numero do tenant.
          // 3. Sem agente inbound -> numero do tenant.
          //
          // O motivo entra no log separado do numero: antes, transferencia
          // desligada e leitura falha apareciam as duas como "no SDR number
          // configured", com o numero salvo na tela.
          // excludeNumbers fecha o ciclo pelo outro lado: o alerta nunca vai
          // para o telefone da propria conversa.
          const sdr = resolveSdrTarget({
            inboundConfig,
            tenantSettings,
            tenantSettingsReadFailed,
            excludeNumbers: [phone],
          });
          if (sdr.excluded?.length > 0) {
            console.warn("[chatbot-webhook] destino de SDR excluido para nao fechar loop", {
              clientId,
              excluidos: sdr.excluded.map(maskPhoneForLog),
            });
          }
          // Lista, nao numero unico: a mesma configuracao do tenant serve aos
          // dois agentes.
          const temSdr = sdr.numbers.length > 0;

          // Recontato: lead finalizado voltou a falar — avisa SDR sem gerar novo briefing
          if (aiResponse._recontato) {
            if (temSdr && evolutionUrl) {
              try {
                const dados = aiResponse.dados || {};
                const interesse = dados.interesse || "Não informado";
                const horario = dados.melhor_horario ? ` (preferência: ${dados.melhor_horario})` : "";
                const recontatoMsg = [
                  `🔔 *Lead recontato — já qualificado anteriormente*`,
                  `📱 Número: ${phone}`,
                  `🏠 Interesse: ${interesse}`,
                  `🌡️ Temperatura: ${aiResponse.classificacao || "não classificada"}${horario}`,
                  `\nLead entrou em contato novamente após ter sido qualificado. Mensagem de reconhecimento enviada.`,
                  `Recomendado: entrar em contato ativo agora.`,
                ].join("\n");

                const entrega = await enviarParaSdrs({
                  numeros: sdr.numbers,
                  texto: recontatoMsg,
                  evolutionUrl,
                  evolutionHeaders,
                  contexto: { clientId, tipo: "recontato" },
                });
                console.log("[chatbot-webhook] alerta de recontato enviado ao SDR", {
                  clientId, phone: maskPhoneForLog(phone),
                  enviados: entrega.enviados, falhas: entrega.falhas.length,
                });
              } catch (err) {
                console.error("[chatbot-webhook] SDR recontact alert error:", err.message);
              }
            }
          }

          // Webhook de finalizacao da tela do Inbound: dispara com os dados
          // coletados quando o atendimento fecha. Era um campo salvo e nunca usado.
          if (aiResponse.finalizado && !aiResponse._recontato && inboundConfig?.webhookUrl) {
            fireInboundCompletionWebhook({
              webhookUrl: inboundConfig.webhookUrl,
              clientId,
              phone,
              instanceName,
              dados: aiResponse.dados || {},
              classificacao: aiResponse.classificacao,
            }).catch(() => {});
          }

          // Finalizado pela primeira vez: gerar briefing completo e notificar SDR
          // Dedup do ALERTA por CONVERSA, nao por id de mensagem: a guarda do
          // inboundGuard tem TTL de 10 min e um loop mais lento que isso passa
          // por baixo dela. A marca fica no lead e nao expira — briefing sai uma
          // vez por qualificacao, e conversa ja notificada nao gera outro.
          if (aiResponse.finalizado && !aiResponse._recontato && !(await briefingJaEnviado(clientId, phone))) {
            if (temSdr && evolutionUrl) {
              try {
                // Tenta briefing via IA com prompt "extrato" do banco; fallback para determinístico
                const aiBriefing = await extractBriefingWithAI({
                  supabase,
                  clientId,
                  phone,
                  history: aiResponse._history || [],
                  collectedData: aiResponse._dados || aiResponse.dados || {},
                  classificacao: aiResponse.classificacao,
                });

                if (!aiBriefing) {
                  console.error("[chatbot-webhook] Briefing IA falhou — prompt 'extrato' não configurado para clientId:", clientId);
                }
                const briefingMsg = aiBriefing;

                if (briefingMsg) {
                  const entrega = await enviarParaSdrs({
                    numeros: sdr.numbers,
                    texto: briefingMsg,
                    evolutionUrl,
                    evolutionHeaders,
                    contexto: { clientId, tipo: "briefing" },
                  });
                  // Marca assim que ao menos um destino recebeu. Marcar mesmo
                  // com falha total esconderia a qualificacao para sempre.
                  if (entrega.enviados > 0) await marcarBriefingEnviado(clientId, phone);
                  console.log("[chatbot-webhook] briefing enviado ao SDR", {
                    clientId,
                    enviados: entrega.enviados,
                    falhas: entrega.falhas.length,
                    source: aiBriefing ? "ai" : "deterministic",
                  });
                }
              } catch (briefErr) {
                console.error("[chatbot-webhook] SDR briefing send error:", briefErr.message);
              }
            } else {
              console.log("[chatbot-webhook] conversa finalizada sem notificar SDR", {
                clientId,
                motivo: sdr.reason,
                // leitura_falhou NAO e "nao configurado": o numero pode existir
                // e a consulta ter falhado. Confundir os dois custou uma
                // investigacao inteira.
                temNumeroNoTenant: Boolean(tenantSettings?.sdr_whatsapp_number),
              });
            }
          }
        } catch (err) {
          console.error("[chatbot-webhook] processBatch error:", err.message);
        }
      });
    });
  /**
   * POST /api/chatbot-test — endpoint síncrono para simulador de conversa no painel
   * Processa a mensagem diretamente (sem buffer, sem Evolution) e retorna a resposta da IA.
   */
  /**
   * POST /api/chatbot-leads/reabrir  { clientId, phone }
   *
   * Destrava um lead preso em "finalizado". Ate aqui nao existia jeito nenhum
   * de reverter pela tela: um lead finalizado num teste ficava com o numero
   * inutilizado, recebendo a mesma frase de recontato para sempre.
   *
   * Escopo de tenant por resolveAuthorizedClientId — um tenant nao reabre lead
   * de outro. O filtro client_id vai TAMBEM no UPDATE, nao so na autorizacao.
   */
  app.post("/api/chatbot-leads/reabrir", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;

    try {
      const requestedClientId = normalizeString(req.body?.clientId);
      const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
      if (!clientId) return;

      const phone = sanitizePhone(req.body?.phone || req.body?.telefone);
      if (!phone) {
        sendError(res, 400, "INVALID_BODY", "Missing phone");
        return;
      }

      const leadsTable = leadsTableName(clientId);
      const phoneVariants = buildPhoneLookupVariants(phone);
      const { data: encontrados, error: readError } = await supabase
        .from(leadsTable)
        .select("id, dados, finalizado")
        .eq("client_id", clientId)
        .in("telefone", phoneVariants.length > 0 ? phoneVariants : [phone])
        .order("created_at", { ascending: false })
        .limit(1);

      if (readError) {
        console.error("[chatbot-leads] reabrir: falha ao ler lead:", readError.message);
        sendError(res, 500, "LEAD_READ_FAILED", "Falha ao ler o lead", readError.message);
        return;
      }

      const lead = encontrados?.[0] || null;
      if (!lead) {
        sendError(res, 404, "LEAD_NOT_FOUND", "Lead nao encontrado neste tenant");
        return;
      }

      const dados = lead.dados || {};
      const { error: updateError } = await supabase
        .from(leadsTable)
        .update({
          finalizado: false,
          status_conversa: "em_atendimento",
          dados: {
            ...dados,
            recontato_avisado_em: null,
            recontato_reaberto_em: new Date().toISOString(),
          },
        })
        .eq("id", lead.id)
        .eq("client_id", clientId);

      if (updateError) {
        console.error("[chatbot-leads] reabrir: falha ao gravar:", updateError.message);
        sendError(res, 500, "LEAD_REOPEN_FAILED", "Falha ao reabrir o lead", updateError.message);
        return;
      }

      console.log("[chatbot-leads] lead reaberto", {
        clientId,
        phone: maskPhoneForLog(phone),
        estavaFinalizado: lead.finalizado === true,
      });

      res.json({ success: true, reopened: true, wasFinalized: lead.finalizado === true });
    } catch (error) {
      console.error("[chatbot-leads] reabrir error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  });

  app.post("/api/chatbot-test", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientId = normalizeTenantKey(body.clientId ?? body.client_id);
    const phone = sanitizePhone(body.phone) || "5500000000000";
    const message = normalizeString(body.message);

    if (!clientId) return sendError(res, 400, "MISSING_CLIENT_ID", "clientId obrigatório");
    if (!message) return sendError(res, 400, "MISSING_MESSAGE", "message obrigatório");

    // instanceName opcional: com ele o simulador testa o AGENTE INBOUND daquele
    // numero (prompt, modelo e SPIN da tela Inbound). Sem ele, testa o chatbot
    // do tenant, como antes.
    const instanceName = normalizeString(body.instanceName ?? body.instance) || null;

    try {
      const tenantSettings = await getLeadClientN8nSettings(clientId).catch(() => null);
      const chatbotModel = tenantSettings?.chatbot_model;

      const inboundConfig = instanceName
        ? await resolveInboundAgentConfig({ supabase, clientId, instanceName }).catch(() => null)
        : null;

      const aiResponse = await processBatch({
        clientId,
        phone,
        messages: [{ text: message, type: "text" }],
        supabase,
        model: chatbotModel,
        promptType: "padrao",
        campaignPromptId: null,
        llmModel: inboundConfig?.model || null,
        inboundPrompt: inboundConfig?.prompt || null,
        inboundSpinInstruction: inboundConfig ? buildSpinInstruction(inboundConfig.spinFields) : "",
        instanceName,
      });

      if (!aiResponse?.mensagem) {
        // Dois motivos MUITO diferentes cabiam nesta mesma frase. Sem separar, o
        // dono lia "prompt nao configurado" quando o prompt estava certo e quem
        // falhou foi o modelo — e ia mexer no lugar errado.
        const motivo = aiResponse?.mensagemAusente
          ? "O modelo respondeu, mas sem texto na chave \"mensagem\". O prompt está configurado; a resposta é que veio fora do contrato."
          : "Prompt não configurado ou chatbot silenciado para este cliente.";
        return res.status(502).json({
          success: false,
          error: "Não foi possível gerar a resposta.",
          reason: motivo,
          code: aiResponse?.mensagemAusente ? "MODEL_EMPTY_MESSAGE" : "CHATBOT_NOT_CONFIGURED",
        });
      }

      // A resposta saiu, mas pode nao ter sido GRAVADA. Sem este aviso, o dono ve
      // uma conversa aparentemente saudavel que reinicia sozinha no turno seguinte.
      const avisos = [];
      if (aiResponse._persistErro) {
        avisos.push(
          `A resposta foi gerada mas NÃO foi salva (${aiResponse._persistErro}). O histórico se perdeu: o próximo turno vai começar sem memória.`
        );
      }
      if (aiResponse._repetiuUltimaFala) {
        avisos.push(
          "Esta resposta é idêntica à anterior — sinal de que o histórico não chegou ao modelo."
        );
      }

      res.json({
        success: true,
        response: aiResponse.mensagem,
        ...(avisos.length > 0 ? { avisos } : {}),
        meta: {
          classificacao: aiResponse.classificacao,
          spin_fase: aiResponse.spin_fase,
          finalizado: aiResponse.finalizado,
          agente: inboundConfig ? "inbound" : "tenant",
          dados: aiResponse.dados || {},
          contratoQuebrado: aiResponse.contratoQuebrado === true,
        },
      });
    } catch (err) {
      console.error("[chatbot-test] Erro no simulador:", {
        clientId,
        phone,
        instanceName,
        error: err?.message || err,
      });
      const detail = err instanceof Error ? err.message : "Erro desconhecido ao simular resposta do modelo";

      // Cota estourada nao e "erro tecnico": e informacao de negocio. O dono
      // precisa saber que a IA parou por limite de plano, com o modelo e o teto,
      // para decidir se paga plano maior. Ate aqui isso chegava na tela como
      // "Failed to fetch" ou "Prompt nao configurado".
      if (err?.code === "LLM_QUOTA_EXCEEDED") {
        return res.status(429).json({
          success: false,
          error: "Cota de IA esgotada",
          reason: detail,
          code: "LLM_QUOTA_EXCEEDED",
          quota: {
            modelo: err.modelo ?? null,
            limiteTpm: err.limiteTpm ?? null,
            usadoTpm: err.usadoTpm ?? null,
            esperarSegundos: err.esperarSegundos ?? null,
          },
        });
      }

      res.status(502).json({
        success: false,
        error: `Falha ao processar resposta do modelo: ${detail}`,
        reason: detail,
        code: "CHATBOT_TEST_FAILED",
      });
    }
  });
  /**
   * GET /api/hardcoded-chat-leads
   * Lista leads do chatbot hardcoded para o Kanban
   * Deriva o status a partir dos FATOS observados em lead_messages:
   * - Finalizados: finalizado = true ou status_conversa = 'finalizado'
   * - Em Atendimento: não finalizado E existe ao menos 1 mensagem do lead (inbound)
   * - Aguardando Resposta: não finalizado E existe mensagem nossa (outbound) E nenhuma do lead
   * - Ignorado (não aparece): nenhuma mensagem em nenhuma direção
   */
  app.get("/api/hardcoded-chat-leads", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;

    const clientId = normalizeTenantKey(req.query.clientId ?? req.query.client_id);
    const statusFilter = req.query.status || null; // em_atendimento | finalizado | aguardando_usuario | all

    if (!clientId) {
      sendError(res, 400, "INVALID_QUERY", "Missing clientId");
      return;
    }

    try {
      const leadsTable = leadsTableName(clientId);
      let rows = [];

      if (pgDatabasePool) {
        const queryText = `
          WITH message_stats AS (
            SELECT
              ${SQL_CANONICAL_PHONE("phone")} as canonical_phone,
              COUNT(*) FILTER (WHERE direction = 'outbound') as outbound_count,
              COUNT(*) FILTER (WHERE direction = 'inbound') as inbound_count,
              MAX(COALESCE(message_timestamp, delivered_at, created_at)) as last_message_at
            FROM public.lead_messages
            WHERE client_id = $1 AND phone NOT LIKE '%@g.us'
            GROUP BY ${SQL_CANONICAL_PHONE("phone")}
          ),
          latest_msg AS (
            SELECT DISTINCT ON (${SQL_CANONICAL_PHONE("phone")})
              ${SQL_CANONICAL_PHONE("phone")} as canonical_phone,
              message_text,
              direction,
              COALESCE(message_timestamp, delivered_at, created_at) as effective_timestamp
            FROM public.lead_messages
            WHERE client_id = $1 AND phone NOT LIKE '%@g.us'
            ORDER BY ${SQL_CANONICAL_PHONE("phone")}, COALESCE(message_timestamp, delivered_at, created_at) DESC NULLS LAST, id DESC
          )
          SELECT
            l.id,
            l.telefone,
            l.nome,
            l.status_conversa,
            l.finalizado,
            l.dados,
            COALESCE(l.mensagem, lm.message_text) as mensagem,
            l.lead_temperature,
            l.spin_fase,
            l.qualificacao,
            l.lead_score,
            l.created_at,
            COALESCE(ms.last_message_at, l.updated_at, l.created_at) as updated_at,
            l.lead_origin,
            l.source_campaign_id,
            l.source_campaign_name,
            l.lead_source,
            COALESCE(ms.outbound_count, 0)::integer as outbound_count,
            COALESCE(ms.inbound_count, 0)::integer as inbound_count
          FROM public."${leadsTable}" l
          LEFT JOIN message_stats ms ON ms.canonical_phone = ${SQL_CANONICAL_PHONE("l.telefone")}
          LEFT JOIN latest_msg lm ON lm.canonical_phone = ${SQL_CANONICAL_PHONE("l.telefone")}
          WHERE l.client_id = $1
            AND l.telefone IS NOT NULL
            AND (
              l.finalizado = true
              OR l.status_conversa = 'finalizado'
              OR COALESCE(ms.outbound_count, 0) > 0
              OR COALESCE(ms.inbound_count, 0) > 0
            )
          ORDER BY COALESCE(ms.last_message_at, l.updated_at, l.created_at) DESC NULLS LAST;
        `;
        const result = await pgDatabasePool.query(queryText, [clientId]);
        rows = result.rows || [];
      } else {
        const { data, error } = await supabase
          .from(leadsTable)
          .select("id, telefone, nome, status_conversa, finalizado, dados, mensagem, lead_temperature, spin_fase, qualificacao, lead_score, created_at, updated_at, lead_origin, source_campaign_id, source_campaign_name, lead_source")
          .eq("client_id", clientId);
        if (error) throw error;
        rows = data || [];
      }

      let divergenceCount = 0;
      const isDebugDivergences = process.env.DEBUG_KANBAN_DIVERGENCES === "true" || process.env.DEBUG_KANBAN_DIVERGENCES === "1";

      const allLeads = rows
        .map((row) => {
          const finalizado = Boolean(row.finalizado || row.status_conversa === "finalizado");
          const outboundCount = Number(row.outbound_count ?? (row.mensagem ? 1 : 0));
          const inboundCount = Number(row.inbound_count ?? 0);

          let derivedStatus = null;
          if (finalizado) {
            derivedStatus = "finalizado";
          } else if (inboundCount > 0) {
            derivedStatus = "em_atendimento";
          } else if (outboundCount > 0) {
            derivedStatus = "aguardando_usuario";
          } else if (row.status_conversa === "aguardando_usuario" || row.status_conversa === "em_atendimento") {
            derivedStatus = row.status_conversa;
          }

          if (!derivedStatus) {
            return null;
          }

          if (row.status_conversa && row.status_conversa !== derivedStatus) {
            divergenceCount++;
            if (isDebugDivergences) {
              console.warn(
                `[chatbot-kanban] Divergência detectada para lead ${row.id || "sem-id"} (${row.telefone}): status_conversa no banco = '${row.status_conversa}', fato derivado = '${derivedStatus}' (outbound=${outboundCount}, inbound=${inboundCount})`
              );
            }
          }

          const dados = typeof row.dados === "object" && row.dados !== null ? row.dados : {};
          const { _currentStepId, ...collectedData } = dados;

          return {
            id: row.id || `msg-${row.telefone}`,
            telefone: row.telefone,
            nome: row.nome || null,
            statusConversa: derivedStatus,
            finalizado,
            currentStepId: _currentStepId || null,
            collectedData,
            mensagem: row.mensagem || null,
            leadTemperature: row.lead_temperature || null,
            spinFase: row.spin_fase || null,
            qualificacao: row.qualificacao || null,
            leadScore: row.lead_score || null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            leadOrigin: row.lead_origin || null,
            sourceCampaignId: row.source_campaign_id || null,
            sourceCampaignName: row.source_campaign_name || null,
            leadSource: row.lead_source || null,
          };
        })
        .filter(Boolean);

      const previousDivergenceCount = lastKanbanDivergenceByTenant.get(clientId);
      if (divergenceCount > 0 && divergenceCount !== previousDivergenceCount) {
        lastKanbanDivergenceByTenant.set(clientId, divergenceCount);
        console.info(`[chatbot-kanban] ${divergenceCount} divergências status_conversa vs fato derivado (${clientId})`);
      } else if (divergenceCount === 0 && previousDivergenceCount !== undefined && previousDivergenceCount !== 0) {
        lastKanbanDivergenceByTenant.set(clientId, 0);
        console.info(`[chatbot-kanban] 0 divergências status_conversa vs fato derivado (${clientId})`);
      }

      const filteredLeads = (statusFilter && statusFilter !== "all")
        ? allLeads.filter((l) => l.statusConversa === statusFilter)
        : allLeads;

      const kanban = {
        aguardando_usuario: allLeads.filter((l) => l.statusConversa === "aguardando_usuario"),
        em_atendimento: allLeads.filter((l) => l.statusConversa === "em_atendimento"),
        finalizado: allLeads.filter((l) => l.statusConversa === "finalizado"),
        total: allLeads.length,
      };

      res.json({ success: true, leads: filteredLeads, kanban });
    } catch (err) {
      console.error("[hardcoded-chat-leads] Error:", err);
      sendError(res, 500, "SERVER_ERROR", err.message);
    }
  });
  /**
   * POST /api/hardcoded-chat-extract
   * Extrai briefing de uma conversa finalizada
   * Útil para recuperar briefing de leads antigos
   */
  app.post("/api/hardcoded-chat-extract", async (req, res) => {
    if (!ensureDb(res)) return;

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientId = normalizeTenantKey(body.clientId ?? body.client_id);
    const phone = sanitizePhone(body.phone ?? body.telefone);

    if (!clientId || !phone) {
      sendError(res, 400, "INVALID_BODY", "Missing clientId or phone");
      return;
    }

    try {
      // Buscar conversa mais recente
      const phoneVariants = buildPhoneLookupVariants(phone);
      const { data: conversation, error } = await supabase
        .from(leadsTableName(clientId))
        .select("*")
        .eq("client_id", clientId)
        .in("telefone", phoneVariants.length > 0 ? phoneVariants : [phone])
        .eq("finalizado", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (error || !conversation) {
        sendError(res, 404, "NOT_FOUND", "No completed conversation found");
        return;
      }

      const parsedHistory = parseStoredHistorico(conversation.historico);
      const aiBriefing = await extractBriefingWithAI({
        supabase,
        clientId,
        phone,
        history: parsedHistory || [],
        collectedData: conversation.dados,
        classificacao: conversation.status,
      });

      if (!aiBriefing) {
        return sendError(res, 500, "BRIEFING_UNAVAILABLE", "Prompt 'extrato' não configurado ou IA indisponível");
      }

      res.json({ success: true, conversationId: conversation.id, briefing: aiBriefing, source: "ai" });
    } catch (error) {
      console.error("[hardcoded-extract] Error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  });
}
