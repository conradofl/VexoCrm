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
import { OutlierQualificationBot } from "../../hardcoded-chatbot-outlier.js";
import { getChatMemory } from "../../hardcoded-chatbot.js";
import {
  bufferMessage,
  resolveMessageContent,
  processBatch,
  isFirstCampaignReply,
  extractBriefingWithAI,
} from "../../chatbot-ai-engine.js";
import {
  persistChatbotProgress,
  determineSPINPhase,
  qualifyLead,
  trackInvalidResponse,
} from "../../hardcoded-chatbot-persistence.js";
import { parseStoredHistorico } from "../../leads-outlier-schema.js";

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

    try {
      const search = normalizeString(_req.query.search)?.toLowerCase() || "";
      const rawLimit = Number.parseInt(String(_req.query.limit || "100"), 10);
      const rawOffset = Number.parseInt(String(_req.query.offset || "0"), 10);
      const limit = Number.isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 200);
      const offset = Number.isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);

      const requestedClientId = normalizeString(_req.query.clientId);
      const clientId = resolveAuthorizedClientId(_req, res, requestedClientId);
      if (!clientId) return;

      const leadsTable = leadsTableName(clientId);

      const queryParams = [clientId];
      let searchFilter = "";
      if (search) {
        queryParams.push(`%${search}%`);
        searchFilter = `AND (LOWER(l.nome) LIKE $2 OR m.phone LIKE $2 OR LOWER(m.message_text) LIKE $2)`;
      }

      const countQueryText = `
        WITH latest_messages AS (
          SELECT DISTINCT ON (phone)
            phone
          FROM public.lead_messages
          WHERE client_id = $1
          ORDER BY phone, delivered_at DESC
        )
        SELECT COUNT(*)::integer as total
        FROM latest_messages m
        LEFT JOIN public.${leadsTable} l ON l.telefone = m.phone AND l.client_id = $1
        WHERE 1=1
        ${searchFilter}
      `;

      const countRes = await pgDatabasePool.query(countQueryText, queryParams);
      const total = countRes.rows[0]?.total || 0;

      const queryParamsWithPaging = [...queryParams, limit, offset];
      const queryText = `
        WITH latest_messages AS (
          SELECT DISTINCT ON (phone)
            phone,
            message_text,
            direction,
            delivered_at,
            campaign_id
          FROM public.lead_messages
          WHERE client_id = $1
          ORDER BY phone, delivered_at DESC
        )
        SELECT
          m.phone as phone_number,
          m.message_text,
          m.direction,
          m.delivered_at,
          m.campaign_id,
          l.nome as lead_name,
          l.lead_origin,
          l.source_campaign_id
        FROM latest_messages m
        LEFT JOIN public.${leadsTable} l ON l.telefone = m.phone AND l.client_id = $1
        WHERE 1=1
        ${searchFilter}
        ORDER BY m.delivered_at DESC
        LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
      `;

      const result = await pgDatabasePool.query(queryText, queryParamsWithPaging);

      const items = result.rows.map((row) => {
        const timestampVal = row.delivered_at ? Math.floor(new Date(row.delivered_at).getTime() / 1000) : null;
        return {
          id: row.phone_number,
          name: row.lead_name || row.phone_number,
          isGroup: false,
          unreadCount: 0,
          timestamp: timestampVal,
          archived: false,
          pinned: false,
          muted: false,
          lastMessage: {
            id: null,
            body: row.message_text || "",
            fromMe: row.direction === "outbound",
            timestamp: timestampVal,
            type: "chat",
          },
          leadOrigin: row.lead_origin || null,
          sourceCampaignId: row.source_campaign_id || null,
        };
      });

      res.json({
        items,
        total,
        nextOffset: offset + items.length,
        hasMore: offset + items.length < total,
      });
    } catch (error) {
      console.error("whatsapp database chats query error:", error);
      sendError(res, 500, "WHATSAPP_CHATS_FAILED", error instanceof Error ? error.message : "Failed to fetch chats from database");
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
  app.get("/api/whatsapp/messages", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;

    try {
      const chatId = normalizeString(req.query.chatId);
      const rawLimit = Number.parseInt(String(req.query.limit || "50"), 10);
      const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 200);

      const requestedClientId = normalizeString(req.query.clientId);
      const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
      if (!clientId) return;

      if (!chatId) {
        sendError(res, 400, "INVALID_QUERY", "Missing chatId");
        return;
      }

      const cleanPhone = sanitizePhone(chatId);
      const queryText = `
        SELECT
          id,
          message_text,
          direction,
          delivered_at,
          sender_type
        FROM public.lead_messages
        WHERE client_id = $1 AND phone = $2
        ORDER BY delivered_at DESC
        LIMIT $3
      `;
      const result = await pgDatabasePool.query(queryText, [clientId, cleanPhone, limit]);

      const items = result.rows.map((row) => {
        const timestampVal = row.delivered_at ? Math.floor(new Date(row.delivered_at).getTime() / 1000) : null;
        return {
          id: String(row.id),
          body: row.message_text || "",
          from: row.direction === "inbound" ? cleanPhone : "me",
          to: row.direction === "outbound" ? cleanPhone : "me",
          author: null,
          fromMe: row.direction === "outbound",
          timestamp: timestampVal,
          type: "chat",
          hasMedia: false,
        };
      });

      res.json({ items: items.reverse() });
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
      await appendLeadMessage({
        clientId,
        phone: cleanPhone,
        senderType: "agent",
        direction: "outbound",
        messageText: body,
        deliveredAt: new Date().toISOString(),
        meta: {
          source: "manual-inbox-reply",
          instanceId: activeInstance.id,
          instanceName: activeInstance.name,
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
    if (!type || !["padrao", "extrato"].includes(type)) {
      return sendError(res, 400, "INVALID_QUERY", "type must be padrao or extrato");
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
    if (!type || !["padrao", "extrato"].includes(type)) {
      return sendError(res, 400, "INVALID_BODY", "type must be padrao or extrato");
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
  // GET /api/chatbot-templates/builtins — lista apenas templates built-in (client_id IS NULL)
  app.get("/api/chatbot-templates/builtins", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    try {
      const { data, error } = await supabase
        .from("chatbot_templates")
        .select("template_key, display_name, agent_name")
        .is("client_id", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return res.json({ templates: data || [] });
    } catch (err) {
      sendError(res, 500, "TEMPLATES_FETCH_FAILED", err instanceof Error ? err.message : "Failed");
    }
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
    const body = req.body && typeof req.body === "object" ? req.body : {};

    // Ignorar mensagens enviadas pelo próprio bot (fromMe) para evitar loop
    const fromMe = body.data?.key?.fromMe === true || body.fromMe === true;
    if (fromMe) {
      res.json({ success: true, ignored: "fromMe" });
      return;
    }

    // Descarta mensagem de GRUPO/broadcast antes de qualquer lookup no banco ou chatbot.
    const rawRemoteJid = body.data?.key?.remoteJid ?? body.remoteJid ?? body.senderJid ?? null;
    if (isGroupJid(rawRemoteJid)) {
      res.json({ success: true, ignored: "group" });
      return;
    }

    const clientId = normalizeTenantKey(
      body.clientId ?? body.client_id ?? req.query.clientId ?? req.query.client_id
    ) || "outlier";

    // Verificar se chatbot está habilitado para este tenant
    const tenantSettings = await getLeadClientN8nSettings(clientId).catch(() => null);
    if (tenantSettings && tenantSettings.chatbot_enabled === false) {
      res.json({ success: true, ignored: "chatbot_disabled" });
      return;
    }

    const phone = sanitizePhone(
      body.phone || body.telefone || body.remoteJid ||
      body.data?.key?.remoteJid || body.senderJid
    );

    if (!phone) {
      res.json({ success: false, error: "Missing phone" });
      return;
    }

    // ── Campaign routing ─────────────────────────────────────────────────
    let chatbotPromptTypeOverride = null; // "campanha" | "padrao" | null
    let activeCampaignForLead = null;
    let campaignPromptIdOverride = null;

    try {
      const campaignReplyContext = await findCampaignReplyMatches({ clientId, phone });
      const activeWaitCampaign = campaignReplyContext.processingWaitForReplyMatches[0] || null;
      activeCampaignForLead = campaignReplyContext.activePeriodCampaign;

      if (activeWaitCampaign) {
        // Lead aguardando resposta de disparo com waitForReply → avança sequência, silencia chatbot
        const itemId = activeWaitCampaign.leadImportItem?.id;
        const { isFirst } = await isFirstCampaignReply({ itemId, campaignId: activeWaitCampaign.id, supabase });

        if (isFirst) {
          console.log("[campaign-routing] wait_for_reply_step", {
            clientId, phone: maskPhoneForLog(phone),
            campaignId: activeWaitCampaign.id, campaignName: activeWaitCampaign.name,
          });

          supabase.from(leadsTableName(clientId))
            .update({ lead_origin: "campaign", source_campaign_id: activeWaitCampaign.id, source_campaign_name: activeWaitCampaign.name || null, lead_source: "campanha" })
            .eq("client_id", clientId).eq("telefone", phone)
            .then(({ error }) => { if (error) console.warn("[chatbot-webhook] campaign lead_origin update failed:", error.message); });

          continueCampaignLeadFromReply({
            clientId, phone, repliedAt: new Date().toISOString(),
            campaignMatch: activeWaitCampaign, replyPayload: {},
          }).then((progression) => {
            console.log("[campaign-routing] campaign_progression", {
              clientId, campaignId: activeWaitCampaign.id, phone: maskPhoneForLog(phone),
              continued: progression.continued, finalized: progression.finalized,
              campaignFinalized: progression.campaignFinalized,
            });
          }).catch((err) => { console.warn("[campaign-routing] campaign_progression_failed:", err.message); });
        } else {
          console.log("[campaign-routing] wait_for_reply_step subsequent", {
            clientId, phone: maskPhoneForLog(phone),
            campaignId: activeWaitCampaign.id, campaignName: activeWaitCampaign.name,
          });
        }

        // waitForReply: se a campanha for modo "agente" E tiver período ativo, usa prompt campanha
        // caso contrário silencia o chatbot (comportamento legado / modo "disparo")
        const waitCampaignIsAgente = activeWaitCampaign.mode === "agente";
        if (waitCampaignIsAgente && activeCampaignForLead) {
          campaignPromptIdOverride = activeCampaignForLead.campaignPromptId || null;
          if (!campaignPromptIdOverride) {
            console.error("[campaign-routing] campanha agente sem campaignPromptId — silenciando", {
              clientId, campaignId: activeWaitCampaign.id,
            });
            res.json({ success: true, status: "skipped_no_campaign_prompt" });
            return;
          }
          console.log("[campaign-routing] wait_for_reply_agente_prompt", {
            clientId, phone: maskPhoneForLog(phone),
            campaignId: activeWaitCampaign.id, campaignPromptId: campaignPromptIdOverride,
          });
        } else {
          res.json({ success: true, status: "skipped_disparo_only" });
          return;
        }
      } else if (activeCampaignForLead) {
        // Lead dentro do período de uma campanha ativa
        if (activeCampaignForLead.mode === "agente") {
          campaignPromptIdOverride = activeCampaignForLead.campaignPromptId || null;
          if (!campaignPromptIdOverride) {
            console.error("[campaign-routing] campanha agente sem campaignPromptId — usando prompt padrão", {
              clientId, campaignId: activeCampaignForLead.id,
            });
          }
          console.log("[campaign-routing] active_period_agente", {
            clientId, phone: maskPhoneForLog(phone),
            campaignId: activeCampaignForLead.id,
            campaignName: activeCampaignForLead.name,
            campaignPromptId: campaignPromptIdOverride,
            endsAt: activeCampaignForLead.endsAt,
          });
        } else {
          // Modo disparo → chatbot usa prompt padrão, ignora campanha
          console.log("[campaign-routing] active_period_disparo_only", {
            clientId, phone: maskPhoneForLog(phone),
            campaignId: activeCampaignForLead.id,
          });
        }
      } else {
        // Sem campanha ativa no período → prompt padrão
        console.log("[campaign-routing] no_active_campaign", {
          clientId, phone: maskPhoneForLog(phone),
        });
      }
    } catch (err) {
      console.warn("[chatbot-webhook] campaign routing check failed, continuing normal flow:", err.message);
    }
    // ─────────────────────────────────────────────────────────────────────

    // Responde imediatamente ao Evolution (evita timeout)
    res.json({ success: true, status: "buffering" });

    // Detectar tipo e extrair conteúdo da mensagem (async, sem bloquear resposta)
    resolveMessageContent(body).then((messageData) => {
      if (!messageData.text) {
        console.log("[chatbot-webhook] Empty message, skipping", { type: messageData.type, phone: maskPhoneForLog(phone) });
        return;
      }

      console.log("[chatbot-webhook] Buffering", {
        clientId,
        type: messageData.type,
        phone: maskPhoneForLog(phone),
        preview: messageData.text.slice(0, 60),
      });

      bufferMessage(clientId, phone, messageData, async (messages) => {
        try {
          for (const item of messages) {
            if (item?.text) {
              await appendLeadMessage({
                clientId,
                phone,
                senderType: "lead",
                direction: "inbound",
                messageText: item.text,
                meta: {
                  source: "hardcoded-chat-webhook",
                  messageType: item.type || null,
                  transcribed: item.transcribed === true,
                  described: item.described === true,
                },
              });
            }
          }

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
          });

          if (!aiResponse?.mensagem) return;

          // Enviar resposta via Evolution
          const dispatchSettings = await resolveDispatchWebhookSettings(clientId);
          const { webhookUrl: evolutionUrl, webhookToken: evolutionToken } = dispatchSettings;

          if (!evolutionUrl) {
            console.warn("[chatbot-webhook] No Evolution URL for clientId:", clientId);
            return;
          }

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
            }),
          });

          if (evolutionResponse.ok) {
            console.log("[chatbot-webhook] Sent to WhatsApp", {
              phone: maskPhoneForLog(phone),
              status: aiResponse.status_conversa,
              classificacao: aiResponse.classificacao,
            });

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
              },
            });
          } else {
            const errText = await evolutionResponse.text();
            console.error("[chatbot-webhook] Evolution send failed:", evolutionResponse.status, errText.slice(0, 200));
          }

          const sdrNumber = tenantSettings?.sdr_whatsapp_number;

          // Recontato: lead finalizado voltou a falar — avisa SDR sem gerar novo briefing
          if (aiResponse._recontato) {
            if (sdrNumber && evolutionUrl) {
              try {
                const dados = aiResponse.dados || {};
                const interesse = dados.interesse || "consórcio";
                const horario = dados.melhor_horario ? ` (preferência: ${dados.melhor_horario})` : "";
                const recontatoMsg = [
                  `🔔 *Lead recontato — já qualificado anteriormente*`,
                  `📱 Número: ${phone}`,
                  `🏠 Interesse: ${interesse}`,
                  `🌡️ Temperatura anterior: ${aiResponse.classificacao || "QUENTE"}${horario}`,
                  `\nLead entrou em contato novamente após ter sido qualificado. Mensagem de reconhecimento enviada.`,
                  `Recomendado: entrar em contato ativo agora.`,
                ].join("\n");

                await fetch(evolutionUrl, {
                  method: "POST",
                  headers: evolutionHeaders,
                  body: JSON.stringify({ number: sdrNumber, text: recontatoMsg, message: recontatoMsg }),
                });
                console.log("[chatbot-webhook] SDR recontact alert sent", { sdrNumber, clientId, phone: maskPhoneForLog(phone) });
              } catch (err) {
                console.error("[chatbot-webhook] SDR recontact alert error:", err.message);
              }
            }
          }

          // Finalizado pela primeira vez: gerar briefing completo e notificar SDR
          if (aiResponse.finalizado && !aiResponse._recontato) {
            if (sdrNumber && evolutionUrl) {
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
                  await fetch(evolutionUrl, {
                    method: "POST",
                    headers: evolutionHeaders,
                    body: JSON.stringify({ number: sdrNumber, text: briefingMsg, message: briefingMsg }),
                  });
                  console.log("[chatbot-webhook] SDR briefing sent", { sdrNumber, clientId, source: aiBriefing ? "ai" : "deterministic" });
                }
              } catch (briefErr) {
                console.error("[chatbot-webhook] SDR briefing send error:", briefErr.message);
              }
            } else {
              console.log("[chatbot-webhook] Conversation finalized — no SDR number configured for", clientId);
            }
          }
        } catch (err) {
          console.error("[chatbot-webhook] processBatch error:", err.message);
        }
      });
    }).catch((err) => {
      console.error("[chatbot-webhook] resolveMessageContent error:", err.message);
    });
  });
  /**
   * POST /api/chatbot-test — endpoint síncrono para simulador de conversa no painel
   * Processa a mensagem diretamente (sem buffer, sem Evolution) e retorna a resposta da IA.
   */
  app.post("/api/chatbot-test", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientId = normalizeTenantKey(body.clientId ?? body.client_id);
    const phone = sanitizePhone(body.phone) || "5500000000000";
    const message = normalizeString(body.message);

    if (!clientId) return sendError(res, 400, "MISSING_CLIENT_ID", "clientId obrigatório");
    if (!message) return sendError(res, 400, "MISSING_MESSAGE", "message obrigatório");

    try {
      const tenantSettings = await getLeadClientN8nSettings(clientId).catch(() => null);
      const chatbotModel = tenantSettings?.chatbot_model;

      const aiResponse = await processBatch({
        clientId,
        phone,
        messages: [{ text: message, type: "text" }],
        supabase,
        model: chatbotModel,
        promptType: "padrao",
        campaignPromptId: null,
      });

      if (!aiResponse?.mensagem) {
        return res.json({ success: true, response: null, reason: "Prompt não configurado ou chatbot silenciado para este cliente." });
      }

      res.json({ success: true, response: aiResponse.mensagem, meta: { classificacao: aiResponse.classificacao, spin_fase: aiResponse.spin_fase, finalizado: aiResponse.finalizado } });
    } catch (err) {
      sendError(res, 500, "CHATBOT_TEST_FAILED", err instanceof Error ? err.message : "Erro interno");
    }
  });
  /**
   * GET /api/hardcoded-chat-leads
   * Lista leads do chatbot hardcoded para o Kanban
   * Retorna por status_conversa e step atual
   */
  app.get("/api/hardcoded-chat-leads", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;

    const clientId = normalizeTenantKey(req.query.clientId ?? req.query.client_id);
    const statusFilter = req.query.status || null; // em_atendimento | finalizado | all
    const limitRaw = Number.parseInt(String(req.query.limit || "100"), 10);
    const limit = Math.min(Number.isNaN(limitRaw) ? 100 : limitRaw, 500);

    if (!clientId) {
      sendError(res, 400, "INVALID_QUERY", "Missing clientId");
      return;
    }

    try {
      let query = supabase
        .from(leadsTableName(clientId))
        .select("id, telefone, nome, status_conversa, finalizado, dados, mensagem, lead_temperature, spin_fase, qualificacao, lead_score, created_at, updated_at, lead_origin, source_campaign_id, source_campaign_name, lead_source")
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(limit);

      if (statusFilter && statusFilter !== "all") {
        query = query.eq("status_conversa", statusFilter);
      }

      const { data, error } = await query;

      if (error) {
        console.error("[hardcoded-chat-leads] Query error:", error);
        sendError(res, 500, "DB_ERROR", error.message);
        return;
      }

      const leads = (data || []).map((row) => {
        const dados = row.dados || {};
        const { _currentStepId, ...collectedData } = dados;
        return {
          id: row.id,
          telefone: row.telefone,
          nome: row.nome || null,
          statusConversa: row.status_conversa || "em_atendimento",
          finalizado: row.finalizado || false,
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
      });

      // Agrupar por status para facilitar o Kanban
      const kanban = {
        em_atendimento: leads.filter((l) => l.statusConversa === "em_atendimento"),
        finalizado: leads.filter((l) => l.statusConversa === "finalizado"),
        total: leads.length,
      };

      res.json({ success: true, leads, kanban });
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
      const { data: conversation, error } = await supabase
        .from(leadsTableName(clientId))
        .select("*")
        .eq("client_id", clientId)
        .eq("telefone", phone)
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
