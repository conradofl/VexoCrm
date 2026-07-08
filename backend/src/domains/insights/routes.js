// backend/src/domains/insights/routes.js
// Movimento puro (extraído de registerAllDomainRoutes.js): health/live, health, helpdesk
// status+chat, dashboard, revenue-ops e as 9 rotas de /api/commercial-intelligence*, mais
// GET /api/reports/evolution-usage. Corpo dos handlers idêntico ao original — só muda de
// onde vêm as dependências (deps em vez de routeDeps destructure inline).

import {
  answerHelpDeskQuestion,
  getHelpDeskAiStatus,
} from "../../helpdesk-ai.js";
import {
  buildCommercialIntelligencePayload,
  getCommercialIntelligenceDefaultSettings,
} from "../../commercial-intelligence.js";

export function registerInsightsRoutes(app, deps) {
  const {
    buildDashboardPayload,
    buildRevenueOpsFallbackPayload,
    buildRevenueOpsPayload,
    ensureDb,
    ensureSharedRoutePageAccess,
    firebaseReady,
    getHealthPostgresPingBudgetMs,
    leadsTableName,
    normalizeBool,
    normalizeString,
    normalizeStringArray,
    optionalQuery,
    parseCommercialIntelligenceFilters,
    pgDatabasePool,
    postgresHealthPing,
    queryWithSchemaFallback,
    requireFirebaseAuth,
    requireInternalPageAccess,
    resolveAuthorizedClientId,
    sanitizePhone,
    sendError,
    supabase,
    useDirectPostgres,
  } = deps;

  // Liveness: só confirma que o processo está vivo e atendendo HTTP. NÃO toca no banco.
  // É o que o HEALTHCHECK do container usa — um banco lento não deve reiniciar a API
  // (reiniciar não conserta o DB e gera crash loop sob carga). Readiness fica no /health.
  app.get("/health/live", (_req, res) => {
    res.json({ ok: true, status: "live", uptimeSeconds: process.uptime() });
  });

  app.get("/health", async (_req, res) => {
    let postgresPing = null;
    /** Short diagnostic when ping fails (no secrets; may include host from PG error text). */
    let postgresPingDetail = null;
    if (useDirectPostgres && pgDatabasePool) {
      try {
        await postgresHealthPing(pgDatabasePool);
        postgresPing = true;
      } catch (err) {
        postgresPing = false;
        const msg = err instanceof Error ? err.message : String(err);
        const code = err && typeof err === "object" && "code" in err ? String(err.code) : undefined;
        postgresPingDetail = {
          code: code || (msg === "health_pg_ping_timeout" ? "HEALTH_PG_PING_TIMEOUT" : "UNKNOWN"),
          message: msg.length > 240 ? `${msg.slice(0, 240)}…` : msg,
          budgetMs: getHealthPostgresPingBudgetMs(),
        };
      }
    }
    const services = {
      databaseClient: !!supabase,
      databaseDriver: useDirectPostgres ? "postgres" : supabase ? "supabase" : "none",
      postgresPing,
      firebaseAuth: firebaseReady,
    };
    if (postgresPingDetail) {
      services.postgresPingDetail = postgresPingDetail;
    }
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
      services,
    });
  });

  app.get("/api/helpdesk/status", requireFirebaseAuth, (_req, res) => {
    res.json(getHelpDeskAiStatus());
  });

  app.post("/api/helpdesk/chat", requireFirebaseAuth, async (req, res) => {
    const message = normalizeString(req.body?.message);

    if (!message) {
      sendError(res, 400, "INVALID_BODY", "Help desk message is required");
      return;
    }

    try {
      const result = await answerHelpDeskQuestion({
        message,
        history: req.body?.history,
        context: {
          pageTitle: normalizeString(req.body?.context?.pageTitle),
          currentPath: normalizeString(req.body?.context?.currentPath),
          selectedClientId: normalizeString(req.body?.context?.selectedClientId),
          selectedClientName: normalizeString(req.body?.context?.selectedClientName),
          access: {
            role: req.authAccess?.role || null,
            preset: req.authAccess?.accessPreset || null,
            scopeMode: req.authAccess?.scopeMode || null,
            internalPages: req.authAccess?.internalPages || [],
            allowedViews: req.authAccess?.allowedViews || [],
            permissions: req.authAccess?.permissions || [],
          },
        },
      });

      res.json({ item: result });
    } catch (error) {
      if (error instanceof Error && error.message === "EMPTY_HELPDESK_MESSAGE") {
        sendError(res, 400, "INVALID_BODY", "Help desk message is required");
        return;
      }

      if (error instanceof Error && error.message === "GROQ_DISABLED") {
        sendError(res, 503, "HELPDESK_AI_DISABLED", "Help desk AI is not configured");
        return;
      }

      console.error("helpdesk chat error:", error);
      sendError(res, 500, "HELPDESK_CHAT_FAILED", "Failed to answer help desk question");
    }
  });

  app.get("/api/dashboard", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    if (!ensureSharedRoutePageAccess(req, res, "dashboard")) return;

    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    try {
      const { data: client, error: clientError } = await supabase
        .from("leads_clients")
        .select("id, name")
        .eq("id", clientId)
        .maybeSingle();

      if (clientError) {
        throw clientError;
      }

      const { data: leads, error } = await supabase
        .from(leadsTableName(clientId))
        .select("id, nome, tipo_cliente, status, qualificacao, data_hora, cidade, created_at")
        .eq("client_id", clientId)
        .order("data_hora", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      let conversions = [];
      try {
        const { data: conversionRows, error: conversionsError } = await supabase
          .from("lead_conversions")
          .select("id, conversion_status, contract_value, revenue_amount, closed_at, created_at")
          .eq("client_id", clientId);

        if (!conversionsError) {
          conversions = conversionRows || [];
        }
      } catch (conversionError) {
        console.warn("dashboard conversions unavailable:", conversionError?.message || conversionError);
      }

      let messages = [];
      try {
        const { data: messageRows, error: messagesError } = await supabase
          .from("lead_messages")
          .select("lead_id, phone, direction, created_at")
          .eq("client_id", clientId);

        if (!messagesError) {
          messages = messageRows || [];
        }
      } catch (msgError) {
        console.warn("dashboard messages unavailable:", msgError?.message || msgError);
      }

      res.json(buildDashboardPayload(client || { id: clientId, name: clientId }, leads || [], conversions, messages));
    } catch (error) {
      console.error("dashboard query error:", error);
      const details =
        error && typeof error === "object" && "message" in error
          ? {
              cause: error.message,
              code: error.code,
              ...(error.details ? { pgDetails: error.details } : {}),
              ...(error.hint ? { hint: error.hint } : {}),
            }
          : { cause: String(error) };
      sendError(res, 500, "DASHBOARD_QUERY_FAILED", "Failed to query dashboard data", details);
    }
  });

  app.get("/api/revenue-ops", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    if (!ensureSharedRoutePageAccess(req, res, "dashboard")) return;

    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    try {
      const { data: client, error: clientError } = await supabase
        .from("leads_clients")
        .select("id, name")
        .eq("id", clientId)
        .maybeSingle();

      if (clientError) {
        throw clientError;
      }

      const { data: leads, error: leadsError } = await supabase
        .from(leadsTableName(clientId))
        .select("id, client_id, telefone, nome, tipo_cliente, faixa_consumo, cidade, estado, status, bot_ativo, historico, data_hora, qualificacao, created_at, updated_at")
        .eq("client_id", clientId)
        .order("data_hora", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (leadsError) {
        throw leadsError;
      }

      const [
        campaignsQuery,
        messagesQuery,
        assignmentsQuery,
        conversionsQuery,
        consultantsQuery,
        rulesQuery,
        insightsQuery,
        importItemsQuery,
      ] = await Promise.all([
        optionalQuery(() =>
          supabase
            .from("campaigns")
            .select("id, name, client_id, import_id, limit_per_run, status, last_triggered_at, created_at")
            .eq("client_id", clientId)
        ),
        optionalQuery(() =>
          supabase
            .from("lead_messages")
            .select("id, lead_id, campaign_id, phone, sender_type, direction, engagement_signal, created_at")
            .eq("client_id", clientId)
        ),
        optionalQuery(() =>
          supabase
            .from("lead_assignments")
            .select("id, lead_id, campaign_id, consultant_id, assignment_status, assigned_at, first_response_at, reassigned_at, closed_at, response_due_at")
            .eq("client_id", clientId)
        ),
        optionalQuery(() =>
          supabase
            .from("lead_conversions")
            .select("id, lead_id, campaign_id, consultant_id, conversion_status, contract_value, revenue_amount, first_contact_at, qualified_at, closed_at, created_at")
            .eq("client_id", clientId)
        ),
        optionalQuery(() =>
          supabase
            .from("crm_consultants")
            .select("id, name, city, state, available, active, daily_capacity, open_lead_limit, assignment_weight, priority_rank")
            .eq("client_id", clientId)
        ),
        optionalQuery(() =>
          supabase
            .from("lead_distribution_rules")
            .select("id, name, distribution_mode, prioritize_region, prioritize_contract_value, prioritize_lead_type, max_open_leads_per_consultant, reassign_after_minutes, fairness_floor, active, config")
            .eq("client_id", clientId)
            .order("updated_at", { ascending: false })
        ),
        optionalQuery(() =>
          supabase
            .from("analytics_insights")
            .select("title, message, severity, insight_scope, generated_at")
            .eq("client_id", clientId)
            .order("generated_at", { ascending: false })
            .limit(8)
        ),
        optionalQuery(() =>
          supabase
            .from("lead_import_items")
            .select("import_id, telefone")
            .eq("client_id", clientId)
            .not("import_id", "is", null)
        ),
      ]);

      const payload = buildRevenueOpsPayload({
        client: client || { id: clientId, name: clientId },
        leads: leads || [],
        campaigns: campaignsQuery.data,
        leadImportItems: importItemsQuery.data,
        conversations: [],
        messages: messagesQuery.data,
        assignments: assignmentsQuery.data,
        conversions: conversionsQuery.data,
        consultants: consultantsQuery.data,
        rules: rulesQuery.data,
        storedInsights: insightsQuery.data,
        availability: {
          campaigns: campaignsQuery.available,
          conversations: false,
          messages: messagesQuery.available,
          assignments: assignmentsQuery.available,
          conversions: conversionsQuery.available,
          consultants: consultantsQuery.available,
          rules: rulesQuery.available,
          insights: insightsQuery.available,
          importItems: importItemsQuery.available,
        },
      });

      res.json(payload);
    } catch (error) {
      console.error("revenue ops query error:", error);
      res.json(buildRevenueOpsFallbackPayload(clientId));
    }
  });

  app.get("/api/commercial-intelligence", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    if (!ensureSharedRoutePageAccess(req, res, "dashboard")) return;

    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const defaultSettings = getCommercialIntelligenceDefaultSettings();
    const filters = parseCommercialIntelligenceFilters(req.query, defaultSettings.defaultPeriod);

    try {
      const { data: client, error: clientError } = await supabase
        .from("leads_clients")
        .select("id, name")
        .eq("id", clientId)
        .maybeSingle();

      if (clientError) throw clientError;

      const [
        leadsQuery,
        campaignsQuery,
        messagesQuery,
        assignmentsQuery,
        conversionsQuery,
        consultantsQuery,
        rulesQuery,
        insightsQuery,
        importItemsQuery,
        settingsQuery,
      ] = await Promise.all([
        queryWithSchemaFallback([
          () =>
            supabase
              .from(leadsTableName(clientId))
              .select("id, client_id, telefone, nome, tipo_cliente, faixa_consumo, cidade, estado, status, bot_ativo, historico, data_hora, qualificacao, created_at, updated_at, source_campaign_id, lead_score, potential_contract_value, first_contact_at, qualified_at, closed_at, lead_temperature, lead_origin, behavior_meta")
              .eq("client_id", clientId)
              .order("data_hora", { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false }),
          () =>
            supabase
              .from(leadsTableName(clientId))
              .select("id, client_id, telefone, nome, tipo_cliente, faixa_consumo, cidade, estado, status, bot_ativo, historico, data_hora, qualificacao, created_at, updated_at, source_campaign_id, lead_score, potential_contract_value, first_contact_at, qualified_at, closed_at")
              .eq("client_id", clientId)
              .order("data_hora", { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false }),
          () =>
            supabase
              .from(leadsTableName(clientId))
              .select("id, client_id, telefone, nome, tipo_cliente, faixa_consumo, cidade, estado, status, bot_ativo, historico, data_hora, qualificacao, created_at, updated_at")
              .eq("client_id", clientId)
              .order("data_hora", { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false }),
        ]),
        optionalQuery(() =>
          supabase
            .from("campaigns")
            .select("id, name, client_id, import_id, limit_per_run, status, scheduled_for, last_triggered_at, created_at, phones")
            .eq("client_id", clientId)
            .is("archived_at", null)
        ),
        optionalQuery(() =>
          supabase
            .from("lead_messages")
            .select("id, client_id, lead_id, campaign_id, phone, sender_type, direction, engagement_signal, message_text, created_at")
            .eq("client_id", clientId)
        ),
        optionalQuery(() =>
          supabase
            .from("lead_assignments")
            .select("id, client_id, lead_id, campaign_id, consultant_id, assignment_mode, assignment_status, assignment_reason, assigned_at, acknowledged_at, first_response_at, reassigned_at, closed_at, response_due_at")
            .eq("client_id", clientId)
        ),
        optionalQuery(() =>
          supabase
            .from("lead_conversions")
            .select("id, client_id, lead_id, campaign_id, consultant_id, conversion_status, contract_value, revenue_amount, first_contact_at, qualified_at, closed_at, created_at")
            .eq("client_id", clientId)
        ),
        optionalQuery(() =>
          supabase
            .from("crm_consultants")
            .select("id, client_id, name, email, phone, city, state, territory_cities, territory_states, lead_types, contract_value_min, contract_value_max, daily_capacity, open_lead_limit, assignment_weight, priority_rank, available, active, performance_meta, created_at, updated_at")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
        ),
        optionalQuery(() =>
          supabase
            .from("lead_distribution_rules")
            .select("id, client_id, name, distribution_mode, prioritize_region, prioritize_contract_value, prioritize_lead_type, max_open_leads_per_consultant, reassign_after_minutes, fairness_floor, active, config, created_at, updated_at")
            .eq("client_id", clientId)
            .order("updated_at", { ascending: false })
        ),
        optionalQuery(() =>
          supabase
            .from("analytics_insights")
            .select("id, related_id, title, message, severity, insight_scope, generated_at, meta")
            .eq("client_id", clientId)
            .order("generated_at", { ascending: false })
        ),
        optionalQuery(() =>
          supabase
            .from("lead_import_items")
            .select("import_id, telefone")
            .eq("client_id", clientId)
            .not("import_id", "is", null)
        ),
        optionalQuery(() =>
          supabase
            .from("commercial_intelligence_settings")
            .select("*")
            .eq("client_id", clientId)
            .maybeSingle(),
          null
        ),
      ]);

      if (leadsQuery.error) throw leadsQuery.error;

      const payload = buildCommercialIntelligencePayload({
        client: client || { id: clientId, name: clientId },
        filters,
        leads: leadsQuery.data || [],
        campaigns: campaignsQuery.data || [],
        leadImportItems: importItemsQuery.data || [],
        conversations: [],
        messages: messagesQuery.data || [],
        assignments: assignmentsQuery.data || [],
        conversions: conversionsQuery.data || [],
        consultants: consultantsQuery.data || [],
        rules: rulesQuery.data || [],
        storedInsights: insightsQuery.data || [],
        settings: settingsQuery.data || null,
      });

      res.json(payload);
    } catch (error) {
      console.error("commercial intelligence query error:", error);
      sendError(res, 500, "COMMERCIAL_INTELLIGENCE_QUERY_FAILED", "Falha ao carregar a inteligencia comercial");
    }
  });

  app.post("/api/commercial-intelligence/consultants", requireFirebaseAuth, requireInternalPageAccess("dashboard"), async (req, res) => {
    if (!ensureDb(res)) return;

    const authorizedClientId = resolveAuthorizedClientId(req, res, normalizeString(req.body?.clientId));
    if (!authorizedClientId) return;

    const name = normalizeString(req.body?.name);
    if (!name) {
      sendError(res, 400, "INVALID_BODY", "Nome do consultor e obrigatorio");
      return;
    }

    const performanceMeta = {
      position: normalizeString(req.body?.position) || "",
      territory_regions: normalizeStringArray(req.body?.territoryRegions || []),
      availableHours: req.body?.availableHours && typeof req.body.availableHours === "object" ? req.body.availableHours : {},
      acceptsAutoAssign: normalizeBool(req.body?.acceptsAutoAssign ?? true),
      notes: normalizeString(req.body?.notes) || "",
    };

    try {
      const { data, error } = await supabase
        .from("crm_consultants")
        .insert({
          client_id: authorizedClientId,
          name,
          email: normalizeString(req.body?.email),
          phone: sanitizePhone(req.body?.phone),
          city: normalizeString(req.body?.city),
          state: normalizeString(req.body?.state),
          territory_cities: normalizeStringArray(req.body?.territoryCities || []),
          territory_states: normalizeStringArray(req.body?.territoryStates || []),
          lead_types: normalizeStringArray(req.body?.leadTypes || []),
          contract_value_min: Number(req.body?.contractValueMin || 0) || null,
          contract_value_max: Number(req.body?.contractValueMax || 0) || null,
          daily_capacity: Math.max(1, Number(req.body?.dailyCapacity || 20)),
          open_lead_limit: Math.max(1, Number(req.body?.openLeadLimit || req.body?.dailyCapacity || 30)),
          assignment_weight: Number(req.body?.assignmentWeight || 1),
          priority_rank: Math.max(1, Number(req.body?.priorityRank || 100)),
          available: normalizeBool(req.body?.available ?? true),
          active: normalizeBool(req.body?.active ?? true),
          performance_meta: performanceMeta,
        })
        .select("id")
        .single();

      if (error) {
        sendError(res, 500, "CONSULTANT_CREATE_FAILED", "Falha ao criar consultor", error.message);
        return;
      }

      res.status(201).json({ success: true, id: data.id });
    } catch (error) {
      console.error("consultant create error:", error);
      sendError(res, 500, "CONSULTANT_CREATE_FAILED", "Falha ao criar consultor");
    }
  });

  app.patch("/api/commercial-intelligence/consultants/:id", requireFirebaseAuth, requireInternalPageAccess("dashboard"), async (req, res) => {
    if (!ensureDb(res)) return;

    const id = normalizeString(req.params?.id);
    if (!id) {
      sendError(res, 400, "INVALID_PARAM", "Consultor invalido");
      return;
    }

    try {
      const { data: current, error: currentError } = await supabase
        .from("crm_consultants")
        .select("id, client_id, performance_meta")
        .eq("id", id)
        .single();

      if (currentError || !current) {
        sendError(res, 404, "CONSULTANT_NOT_FOUND", "Consultor nao encontrado");
        return;
      }

      const authorizedClientId = resolveAuthorizedClientId(req, res, current.client_id);
      if (!authorizedClientId) return;

      const currentMeta = current.performance_meta || {};
      const updates = {
        email: "email" in req.body ? normalizeString(req.body?.email) : undefined,
        phone: "phone" in req.body ? sanitizePhone(req.body?.phone) : undefined,
        city: "city" in req.body ? normalizeString(req.body?.city) : undefined,
        state: "state" in req.body ? normalizeString(req.body?.state) : undefined,
        territory_cities: "territoryCities" in req.body ? normalizeStringArray(req.body?.territoryCities || []) : undefined,
        territory_states: "territoryStates" in req.body ? normalizeStringArray(req.body?.territoryStates || []) : undefined,
        lead_types: "leadTypes" in req.body ? normalizeStringArray(req.body?.leadTypes || []) : undefined,
        contract_value_min: "contractValueMin" in req.body ? (Number(req.body?.contractValueMin || 0) || null) : undefined,
        contract_value_max: "contractValueMax" in req.body ? (Number(req.body?.contractValueMax || 0) || null) : undefined,
        daily_capacity: "dailyCapacity" in req.body ? Math.max(1, Number(req.body?.dailyCapacity || 20)) : undefined,
        open_lead_limit: "openLeadLimit" in req.body ? Math.max(1, Number(req.body?.openLeadLimit || 30)) : undefined,
        assignment_weight: "assignmentWeight" in req.body ? Number(req.body?.assignmentWeight || 1) : undefined,
        priority_rank: "priorityRank" in req.body ? Math.max(1, Number(req.body?.priorityRank || 100)) : undefined,
        available: "available" in req.body ? normalizeBool(req.body?.available) : undefined,
        active: "active" in req.body ? normalizeBool(req.body?.active) : undefined,
        name: "name" in req.body ? normalizeString(req.body?.name) : undefined,
        performance_meta: {
          ...currentMeta,
          ...(req.body?.position !== undefined ? { position: normalizeString(req.body?.position) || "" } : {}),
          ...(req.body?.territoryRegions !== undefined ? { territory_regions: normalizeStringArray(req.body?.territoryRegions || []) } : {}),
          ...(req.body?.availableHours !== undefined && typeof req.body.availableHours === "object" ? { availableHours: req.body.availableHours } : {}),
          ...(req.body?.acceptsAutoAssign !== undefined ? { acceptsAutoAssign: normalizeBool(req.body?.acceptsAutoAssign) } : {}),
          ...(req.body?.notes !== undefined ? { notes: normalizeString(req.body?.notes) || "" } : {}),
        },
      };

      const sanitizedUpdates = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));

      const { error } = await supabase
        .from("crm_consultants")
        .update(sanitizedUpdates)
        .eq("id", id)
        .eq("client_id", authorizedClientId);

      if (error) {
        sendError(res, 500, "CONSULTANT_UPDATE_FAILED", "Falha ao atualizar consultor", error.message);
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("consultant update error:", error);
      sendError(res, 500, "CONSULTANT_UPDATE_FAILED", "Falha ao atualizar consultor");
    }
  });

  app.delete("/api/commercial-intelligence/consultants/:id", requireFirebaseAuth, requireInternalPageAccess("dashboard"), async (req, res) => {
    if (!ensureDb(res)) return;

    const id = normalizeString(req.params?.id);
    if (!id) {
      sendError(res, 400, "INVALID_PARAM", "Consultor invalido");
      return;
    }

    try {
      const { data: current, error: currentError } = await supabase
        .from("crm_consultants")
        .select("id, client_id")
        .eq("id", id)
        .single();

      if (currentError || !current) {
        sendError(res, 404, "CONSULTANT_NOT_FOUND", "Consultor nao encontrado");
        return;
      }

      const authorizedClientId = resolveAuthorizedClientId(req, res, current.client_id);
      if (!authorizedClientId) return;

      const { error } = await supabase
        .from("crm_consultants")
        .delete()
        .eq("id", id)
        .eq("client_id", authorizedClientId);

      if (error) {
        sendError(res, 500, "CONSULTANT_DELETE_FAILED", "Falha ao excluir consultor", error.message);
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("consultant delete error:", error);
      sendError(res, 500, "CONSULTANT_DELETE_FAILED", "Falha ao excluir consultor");
    }
  });

  app.post("/api/commercial-intelligence/distribution-rules", requireFirebaseAuth, requireInternalPageAccess("dashboard"), async (req, res) => {
    if (!ensureDb(res)) return;

    const authorizedClientId = resolveAuthorizedClientId(req, res, normalizeString(req.body?.clientId));
    if (!authorizedClientId) return;

    const name = normalizeString(req.body?.name);
    if (!name) {
      sendError(res, 400, "INVALID_BODY", "Nome da regra e obrigatorio");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("lead_distribution_rules")
        .insert({
          client_id: authorizedClientId,
          name,
          distribution_mode: normalizeString(req.body?.distributionMode) || "round_robin",
          prioritize_region: normalizeBool(req.body?.prioritizeRegion ?? true),
          prioritize_contract_value: normalizeBool(req.body?.prioritizeContractValue ?? true),
          prioritize_lead_type: normalizeBool(req.body?.prioritizeLeadType ?? true),
          max_open_leads_per_consultant: Math.max(1, Number(req.body?.maxOpenLeadsPerConsultant || 30)),
          reassign_after_minutes: Math.max(1, Number(req.body?.reassignAfterMinutes || 30)),
          fairness_floor: Number(req.body?.fairnessFloor || 1),
          active: normalizeBool(req.body?.active ?? true),
          config: req.body?.config && typeof req.body.config === "object" ? req.body.config : {},
        })
        .select("id")
        .single();

      if (error) {
        sendError(res, 500, "RULE_CREATE_FAILED", "Falha ao criar regra de distribuicao", error.message);
        return;
      }

      res.status(201).json({ success: true, id: data.id });
    } catch (error) {
      console.error("distribution rule create error:", error);
      sendError(res, 500, "RULE_CREATE_FAILED", "Falha ao criar regra de distribuicao");
    }
  });

  app.patch("/api/commercial-intelligence/distribution-rules/:id", requireFirebaseAuth, requireInternalPageAccess("dashboard"), async (req, res) => {
    if (!ensureDb(res)) return;

    const id = normalizeString(req.params?.id);
    if (!id) {
      sendError(res, 400, "INVALID_PARAM", "Regra invalida");
      return;
    }

    try {
      const { data: current, error: currentError } = await supabase
        .from("lead_distribution_rules")
        .select("id, client_id, config")
        .eq("id", id)
        .single();

      if (currentError || !current) {
        sendError(res, 404, "RULE_NOT_FOUND", "Regra nao encontrada");
        return;
      }

      const authorizedClientId = resolveAuthorizedClientId(req, res, current.client_id);
      if (!authorizedClientId) return;

      const updates = {
        name: "name" in req.body ? normalizeString(req.body?.name) : undefined,
        distribution_mode: "distributionMode" in req.body ? normalizeString(req.body?.distributionMode) || "round_robin" : undefined,
        prioritize_region: "prioritizeRegion" in req.body ? normalizeBool(req.body?.prioritizeRegion) : undefined,
        prioritize_contract_value: "prioritizeContractValue" in req.body ? normalizeBool(req.body?.prioritizeContractValue) : undefined,
        prioritize_lead_type: "prioritizeLeadType" in req.body ? normalizeBool(req.body?.prioritizeLeadType) : undefined,
        max_open_leads_per_consultant: "maxOpenLeadsPerConsultant" in req.body ? Math.max(1, Number(req.body?.maxOpenLeadsPerConsultant || 30)) : undefined,
        reassign_after_minutes: "reassignAfterMinutes" in req.body ? Math.max(1, Number(req.body?.reassignAfterMinutes || 30)) : undefined,
        fairness_floor: "fairnessFloor" in req.body ? Number(req.body?.fairnessFloor || 1) : undefined,
        active: "active" in req.body ? normalizeBool(req.body?.active) : undefined,
        config: "config" in req.body && typeof req.body.config === "object"
          ? { ...(current.config || {}), ...req.body.config }
          : undefined,
      };

      const sanitizedUpdates = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));

      const { error } = await supabase
        .from("lead_distribution_rules")
        .update(sanitizedUpdates)
        .eq("id", id)
        .eq("client_id", authorizedClientId);

      if (error) {
        sendError(res, 500, "RULE_UPDATE_FAILED", "Falha ao atualizar regra de distribuicao", error.message);
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("distribution rule update error:", error);
      sendError(res, 500, "RULE_UPDATE_FAILED", "Falha ao atualizar regra de distribuicao");
    }
  });

  app.patch("/api/commercial-intelligence/assignments/:id/action", requireFirebaseAuth, requireInternalPageAccess("dashboard"), async (req, res) => {
    if (!ensureDb(res)) return;

    const id = normalizeString(req.params?.id);
    const action = normalizeString(req.body?.action);
    if (!id || !action) {
      sendError(res, 400, "INVALID_BODY", "Atribuicao e acao sao obrigatorias");
      return;
    }

    try {
      const { data: assignment, error: assignmentError } = await supabase
        .from("lead_assignments")
        .select("id, client_id, consultant_id, assignment_reason")
        .eq("id", id)
        .single();

      if (assignmentError || !assignment) {
        sendError(res, 404, "ASSIGNMENT_NOT_FOUND", "Atribuicao nao encontrada");
        return;
      }

      const authorizedClientId = resolveAuthorizedClientId(req, res, assignment.client_id);
      if (!authorizedClientId) return;

      const assignmentReason = assignment.assignment_reason || {};
      const updates = {};

      if (action === "reatribuir") {
        const consultantId = normalizeString(req.body?.consultantId);
        if (!consultantId) {
          sendError(res, 400, "INVALID_BODY", "Novo consultor e obrigatorio para reatribuicao");
          return;
        }
        updates.consultant_id = consultantId;
        updates.assignment_status = "reassigned";
        updates.reassigned_at = new Date().toISOString();
        updates.assignment_reason = {
          ...assignmentReason,
          previousConsultantId: assignment.consultant_id,
          reason: normalizeString(req.body?.reason) || "Reatribuicao manual",
          actor: req.authAccess?.email || "sistema",
        };
      } else if (action === "travar") {
        updates.assignment_status = "locked";
      } else if (action === "liberar") {
        updates.assignment_status = "released";
      } else if (action === "enviar_manual") {
        updates.assignment_status = "manual_sent";
        updates.assignment_reason = {
          ...assignmentReason,
          actor: req.authAccess?.email || "sistema",
          reason: "Envio manual pela operacao",
        };
      } else {
        sendError(res, 400, "INVALID_BODY", "Acao de atribuicao invalida");
        return;
      }

      const { error } = await supabase
        .from("lead_assignments")
        .update(updates)
        .eq("id", id)
        .eq("client_id", authorizedClientId);

      if (error) {
        sendError(res, 500, "ASSIGNMENT_ACTION_FAILED", "Falha ao atualizar atribuicao", error.message);
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("assignment action error:", error);
      sendError(res, 500, "ASSIGNMENT_ACTION_FAILED", "Falha ao atualizar atribuicao");
    }
  });

  app.put("/api/commercial-intelligence/settings", requireFirebaseAuth, requireInternalPageAccess("dashboard"), async (req, res) => {
    if (!ensureDb(res)) return;

    const authorizedClientId = resolveAuthorizedClientId(req, res, normalizeString(req.body?.clientId));
    if (!authorizedClientId) return;

    const defaults = getCommercialIntelligenceDefaultSettings();

    try {
      const payload = {
        client_id: authorizedClientId,
        qualification_threshold: Number(req.body?.qualificationThreshold ?? defaults.qualificationThreshold),
        sla_minutes: Math.max(1, Number(req.body?.slaMinutes ?? defaults.slaMinutes)),
        default_period: normalizeString(req.body?.defaultPeriod) || defaults.defaultPeriod,
        distribution_strategy: normalizeString(req.body?.distributionStrategy) || defaults.distributionStrategy,
        ranking_rules: req.body?.rankingRules && typeof req.body.rankingRules === "object" ? req.body.rankingRules : defaults.rankingRules,
        metric_rules: req.body?.metricRules && typeof req.body.metricRules === "object" ? req.body.metricRules : defaults.metricRules,
        alert_rules: req.body?.alertRules && typeof req.body.alertRules === "object" ? req.body.alertRules : defaults.alertRules,
        permissions: req.body?.permissions && typeof req.body.permissions === "object" ? req.body.permissions : defaults.permissions,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("commercial_intelligence_settings")
        .upsert(payload, { onConflict: "client_id" });

      if (error) {
        sendError(res, 500, "SETTINGS_SAVE_FAILED", "Falha ao salvar configuracoes", error.message);
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("commercial intelligence settings save error:", error);
      sendError(res, 500, "SETTINGS_SAVE_FAILED", "Falha ao salvar configuracoes");
    }
  });

  app.patch("/api/commercial-intelligence/insights/:id/status", requireFirebaseAuth, requireInternalPageAccess("dashboard"), async (req, res) => {
    if (!ensureDb(res)) return;

    const id = normalizeString(req.params?.id);
    const status = normalizeString(req.body?.status);
    if (!id || !status) {
      sendError(res, 400, "INVALID_BODY", "Insight e status sao obrigatorios");
      return;
    }

    try {
      const { data: current, error: currentError } = await supabase
        .from("analytics_insights")
        .select("id, client_id")
        .eq("id", id)
        .single();

      if (currentError || !current) {
        sendError(res, 404, "INSIGHT_NOT_FOUND", "Insight nao encontrado");
        return;
      }

      const authorizedClientId = resolveAuthorizedClientId(req, res, current.client_id);
      if (!authorizedClientId) return;

      const updates = {
        status,
        resolved_at: status === "resolved" ? new Date().toISOString() : null,
      };

      const { error } = await supabase
        .from("analytics_insights")
        .update(updates)
        .eq("id", id)
        .eq("client_id", authorizedClientId);

      if (error) {
        sendError(res, 500, "INSIGHT_UPDATE_FAILED", "Falha ao atualizar insight", error.message);
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("insight update error:", error);
      sendError(res, 500, "INSIGHT_UPDATE_FAILED", "Falha ao atualizar insight");
    }
  });

  // GET /api/reports/evolution-usage — Relatórios v1: envios por dia, por chip.
  // Lê direto de evolution_instance_daily_usage (instance_id, date, sent_count),
  // agregação no SQL. JOIN com lead_client_evolution_instances p/ label humano.
  // Tenant scoping idêntico aos endpoints de dispatch (resolveAuthorizedClientId).
  app.get("/api/reports/evolution-usage", requireFirebaseAuth, requireInternalPageAccess("relatorios"), async (req, res) => {
    if (!ensureDb(res)) return;
    if (!pgDatabasePool) return sendError(res, 503, "DB_UNAVAILABLE", "Database unavailable");
    const requestedClientId = normalizeString(req.query.clientId);
    if (!requestedClientId) return sendError(res, 400, "MISSING_CLIENT_ID", "Missing clientId");
    const authorizedClientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!authorizedClientId) return;

    let days = Number.parseInt(String(req.query.days ?? "14"), 10);
    if (!Number.isInteger(days) || days < 1) days = 14;
    if (days > 31) days = 31;

    try {
      const { rows } = await pgDatabasePool.query(
        `
          SELECT u.date::text                         AS dia,
                 u.instance_id::text                  AS chip_id,
                 COALESCE(i.name, u.instance_id::text) AS chip_label,
                 SUM(u.sent_count)::int               AS enviados
          FROM public.evolution_instance_daily_usage u
          JOIN public.lead_client_evolution_instances i ON i.id = u.instance_id
          WHERE i.client_id = $1
            AND u.date >= (CURRENT_DATE - ($2::int - 1))
          GROUP BY u.date, u.instance_id, i.name
          ORDER BY u.date ASC, chip_label ASC
        `,
        [authorizedClientId, days]
      );
      res.json({ days, items: rows });
    } catch (err) {
      sendError(res, 500, "EVOLUTION_USAGE_REPORT_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });
}
