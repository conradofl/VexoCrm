import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { gunzipSync } from "zlib";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { createDatabasePool, createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { runMigrations } from "../migrate.js";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  canAccessAppView,
  hasAccessPermission,
  hasClientViewAccess,
  hasInternalPageAccess,
} from "../accessGuards.js";
import {
  buildCommercialIntelligencePayload,
  getCommercialIntelligenceDefaultSettings,
} from "../commercial-intelligence.js";
import {
  dispatchCampaignSequence,
  getCampaignStepPlan,
  normalizeCampaignAnalyticsMeta,
  validateCampaignAnalyticsMeta,
} from "../campaign-outbound.js";
import {
  generateCampaignCopySuggestion,
  generateCampaignTemplateVariants,
  getGroqCampaignAiStatus,
  rewriteCampaignStep,
  suggestCampaignDelays,
  suggestCampaignSequence,
} from "../campaign-ai.js";
import {
  answerHelpDeskQuestion,
  getHelpDeskAiStatus,
} from "../helpdesk-ai.js";
import {
  checkLeadClientTableStatus as checkDynamicLeadClientTableStatus,
  ensureLeadClientTable as ensureDynamicLeadClientTable,
} from "../lead-client-tables.js";
import { resolveRequiredAuthorizedClientId } from "../tenantScope.js";
import {
  canAssignManagedAccess,
  canManageTargetAccess,
  filterVisibleUserRecords,
  hasUserPermission,
} from "../userAccessScope.js";
import { whatsappSessionManager } from "../whatsapp.js";
import { initializeRedisChat, getChatMemory, setSupabaseClient } from "../hardcoded-chatbot.js";
import { parseStoredHistorico } from "../leads-outlier-schema.js";
import {
  bufferMessage,
  resolveMessageContent,
  extractTextFromBody,
  processBatch,
  getChatbotModel,
  isFirstCampaignReply,
  extractBriefingWithAI,
} from "../chatbot-ai-engine.js";
import { OutlierQualificationBot } from "../hardcoded-chatbot-outlier.js";
import {
  persistChatbotProgress,
  determineSPINPhase,
  qualifyLead,
  generateConversationSummary,
  trackInvalidResponse,
} from "../hardcoded-chatbot-persistence.js";


import { routeDeps } from "../http/routeDeps.js";
import { registerFollowupRoutes } from "../followup/routes.js";
import { registerOnboardingRoutes } from "../onboarding/routes.js";
import { query as fupQuery } from "../followup/db.js";
import { getFollowupQueue } from "../followup/queue.js";

let _evolutionDailyUsageSchemaEnsured = false;

/**
 * Registers all HTTP routes (extracted from legacy server.js).
 * routeDeps must be populated in server.js before this runs.
 */
export function registerAllDomainRoutes(app) {
  const {
    ACCESS_PERMISSION_KEYS,
    ACCESS_PRESET_DEFAULTS,
    ACCESS_PRESET_KEYS,
    ACCESS_PRESET_LABELS,
    ACCESS_SCOPE_KEYS,
    APPROVAL_LEVEL_KEYS,
    CAMPAIGN_SCHEDULER_MAX_BATCH,
    CLIENT_VIEW_KEYS,
    DEFAULT_CAMPAIGN_RUNNER_INTERVAL_MS,
    DEFAULT_CLIENT_VIEWS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    FIXED_ADMIN_EMAILS,
    FIXED_ADMIN_UIDS,
    INTERNAL_PAGE_KEYS,
    LEADS_OUTLIER_DADOS_KEYS,
    LEADS_OUTLIER_SPIN_FASE,
    LEADS_OUTLIER_STATUS_CONVERSA,
    LEADS_OUTLIER_TEMPERATURE,
    MANAGED_CLAIM_KEYS,
    MAX_LEADS_OUTLIER_BATCH,
    SYSTEM_ACCESS_PROFILES,
    __dirname,
    allowAnyCorsOrigin,
    average,
    buildAccessProfile,
    buildCampaignAutomationHeaders,
    buildCampaignWebhookPayload,
    buildDashboardPayload,
    buildDispatchLeads,
    buildEvolutionAuthHeaders,
    buildImportPreview,
    buildManagedClaims,
    buildMetricDefinition,
    buildN8nSettingsPayload,
    buildPhoneLookupVariants,
    buildPresetDefaults,
    buildRevenueOpsFallbackPayload,
    buildRevenueOpsPayload,
    buildSystemAccessProfiles,
    callCampaignQualificationWebhook,
    campaignSchedulerRunning,
    canCampaignBeDispatched,
    checkEvolutionInstanceHealth,
    claimCampaignForDispatch,
    continueCampaignLeadFromReply,
    corsAllowAnyOriginBecauseListEmpty,
    corsOrigins,
    dataSource,
    databaseUrl,
    dbDriverEnv,
    detectTemperature,
    ensureAuthorizedWhatsAppChat,
    ensureAuthorizedWhatsAppPhone,
    ensureDb,
    ensureFirebaseUserAccessClaims,
    ensureSharedRoutePageAccess,
    executeCampaignDispatch,
    extractCampaignProgress,
    extractEvolutionConnectionState,
    extractManagedAccessClaims,
    findAccessProfileByKey,
    findCampaignReplyMatches,
    firebaseConfig,
    firebaseReady,
    frontendOriginExtra,
    getAccessPresetLabel,
    getAuthorizedClientWhatsAppChatIds,
    getAuthorizedWhatsAppChatIdsForRequest,
    getCampaignRunnerIntervalMs,
    getClientEnvSuffix,
    getClientName,
    getDatabaseHostForLogging,
    getDateKey,
    getDateLabel,
    getDefaultPresetForRole,
    getHealthPostgresPingBudgetMs,
    getLeadClientEvolutionInstances,
    getLeadClientN8nSettings,
    getLeadClientN8nSettingsMap,
    getLeadClientN8nSettingsStatus,
    getLeadReferenceDate,
    getLeadWebhookBearerSecret,
    getN8nOnboardingStatus,
    getNormalizedField,
    getPresetFallbackKey,
    getRequestBearerToken,
    getRequestId,
    getSafeDispatchSettingsLog,
    getSafeEvolutionEndpointLog,
    getZonedDateParts,
    hasCampaignLeadReplied,
    hasManagedAccessClaims,
    hasWildcard,
    hoursBetween,
    humanizeAccessProfileKey,
    humanizeStatus,
    insertCampaignDispatchLog,
    internalErrorPayloadDetails,
    isDuplicateKeyError,
    isEvolutionOpenState,
    isFixedAdminIdentity,
    isImportedLeadEmpty,
    isLikelyIpv4Host,
    isMaskedSecretPlaceholder,
    isMissingAccessProfilesTable,
    isMissingSchemaError,
    isProduction,
    isQualifiedStatus,
    isValidBase64,
    isValidManagedApprovalLevelInput,
    isValidManagedPresetInput,
    isValidManagedRoleInput,
    isValidManagedScopeInput,
    leadMatchesCampaignSegmentation,
    listAccessProfiles,
    listAllFirebaseUsers,
    logCampaignDispatch,
    logCampaignReplyFlow,
    logDirectDispatch,
    mapAdminUserRecord,
    markCampaignDispatchFailed,
    markCampaignLeadWaitingReply,
    maskN8nSettings,
    maskEvolutionInstance,
    maskPhoneForLog,
    maybeFinalizeCampaignAfterReply,
    mergeCampaignProgress,
    mergeManagedClaims,
    normalizeAccessPreset,
    normalizeAccessProfileRecord,
    normalizeAllowedViews,
    normalizeApprovalLevel,
    normalizeBool,
    normalizeCampaignPendingStepIndex,
    normalizeCorsOrigin,
    normalizeHeaderKey,
    normalizeHttpUrl,
    normalizeImportedLead,
    normalizeInternalPages,
    normalizeIsoDate,
    normalizeLooseText,
    normalizeMetricValue,
    normalizePermissions,
    normalizePhoneToWhatsAppChatId,
    normalizeRole,
    normalizeScopeMode,
    leadsTableName,
    normalizeString,
    normalizeStringArray,
    normalizeTenantKey,
    normalizeWhatsAppChatId,
    normalizeWonStatus,
    optionalQuery,
    parseCommercialIntelligenceFilters,
    parseCsvLine,
    parseCsvToRows,
    parseEvolutionWebhookEndpoint,
    parseJsonEnvMap,
    parseLeadReferenceDate,
    parseMoneyLikeValue,
    parseOptionalFiniteNumber,
    parseOptionalUuid,
    pgDatabasePool,
    pickRowValue,
    postgresHealthPing,
    queryWithSchemaFallback,
    rawCorsOrigins,
    requireAdminAccess,
    requireAnyInternalPageAccess,
    requireAppViewAccess,
    requireFirebaseAuth,
    requireInternalAccess,
    requireInternalPageAccess,
    requireUserManagementAccess,
    resolveAuthorizedClientId,
    resolveCampaignDispatchSettings,
    resolveCampaignPhonesForRow,
    resolveDispatchWebhookSettings,
    resolveEnvCampaignQualificationWebhookSettings,
    resolveEnvDispatchWebhookSettings,
    resolveMatchedImportItemForCampaign,
    resolveRequestedAccessProfile,
    runDueCampaignDispatches,
    safePercent,
    sanitizeLeadsOutlierBehaviorMeta,
    sanitizeLeadsOutlierDados,
    sanitizePhone,
    sanitizePhoneLeadWebhookStyle,
    sendError,
    sendLeadWebhookEdgeStyle,
    serializeAccessProfileRecord,
    shouldExposeInternalErrorDetails,
    shouldStartCampaignScheduler,
    shutdownPgPool,
    startCampaignScheduler,
    startNextCampaignLeadInQueue,
    supabase,
    supabaseServiceRoleKey,
    supabaseUrl,
    syncUsersWithAccessProfile,
    tickCampaignScheduler,
    toComparableCampaignTimestamp,
    updateLeadConversationState,
    updateLeadImportItemCampaignProgress,
    upsertLeadClientEvolutionInstance,
    provisionLeadClientEvolutionInstance,
    upsertLeadClientN8nSettings,
    deleteLeadClientEvolutionInstance,
    useDirectPostgres,
    validateLeadWebhookBearer,
    validateLeadsOutlierRecord,
    validateN8nInboundBearer,
  } = routeDeps;

  async function checkLeadClientTableStatus(tenantId) {
    return checkDynamicLeadClientTableStatus(pgDatabasePool, tenantId);
  }

  async function ensureLeadClientTable(tenantId, schemaType) {
    return ensureDynamicLeadClientTable(pgDatabasePool, tenantId, schemaType);
  }

  async function appendLeadMessage({
    clientId,
    phone,
    senderType,
    direction,
    messageText,
    engagementSignal = null,
    campaignId = null,
    leadId = null,
    deliveredAt = null,
    meta = null,
  }) {
    if (!supabase || !clientId || !phone) return null;

    const normalizedMessage = normalizeString(messageText);
    if (!normalizedMessage) return null;

    let resolvedLeadId = leadId || null;
    let resolvedCampaignId = campaignId || null;

    if (!resolvedLeadId || !resolvedCampaignId) {
      try {
        const { data: leadRow, error: leadLookupError } = await supabase
          .from(leadsTableName(clientId))
          .select("id, source_campaign_id")
          .eq("client_id", clientId)
          .eq("telefone", phone)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!leadLookupError && leadRow) {
          resolvedLeadId = resolvedLeadId || leadRow.id || null;
          resolvedCampaignId = resolvedCampaignId || leadRow.source_campaign_id || null;
        }
      } catch (error) {
        console.warn("[lead-messages] lead lookup failed:", error?.message || error);
      }
    }

    const { error } = await supabase.from("lead_messages").insert({
      client_id: clientId,
      lead_id: resolvedLeadId,
      campaign_id: resolvedCampaignId,
      phone,
      sender_type: senderType,
      direction,
      engagement_signal: engagementSignal,
      message_text: normalizedMessage,
      delivered_at: deliveredAt || new Date().toISOString(),
      meta: meta && typeof meta === "object" ? meta : {},
    });

    if (error && !isMissingSchemaError(error)) {
      console.warn("[lead-messages] insert failed:", error.message || error);
    }

    return { leadId: resolvedLeadId, campaignId: resolvedCampaignId };
  }

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
  
  // P0.1 SECURITY FIX: SSRF in /api/sheets - Add authentication, validation, and timeout
  const VALID_GOOGLE_SHEETS_REGEX = /^[a-zA-Z0-9-_]{44}$/; // UUID do Google Sheets
  
  app.get("/api/sheets", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const sheetId = normalizeString(req.query?.sheetId);
    const gid = normalizeString(req.query?.gid);
  
    // Validação de formato
    if (!sheetId || !VALID_GOOGLE_SHEETS_REGEX.test(sheetId)) {
      sendError(res, 400, "INVALID_SHEET_ID", "Invalid Google Sheets ID");
      return;
    }
  
    if (gid && !/^\d+$/.test(gid)) {
      sendError(res, 400, "INVALID_GID", "Invalid sheet GID");
      return;
    }
  
    try {
      const exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
        sheetId
      )}/export?format=csv&gid=${encodeURIComponent(gid || "0")}`;
  
      const sheetResponse = await fetch(exportUrl, {
        timeout: 10000, // Timeout de 10 segundos
        headers: { "User-Agent": "VexoCRM/1.0" }
      });
  
      if (!sheetResponse.ok) {
        sendError(
          res,
          502,
          "SHEETS_FETCH_FAILED",
          "Failed to fetch sheet. Ensure it is 'Published to web' (File > Share > Publish to web).",
          `status=${sheetResponse.status}`
        );
        return;
      }
  
      const csv = await sheetResponse.text();
      if (csv.trim().toLowerCase().startsWith("<!") || csv.includes("Sign in")) {
        sendError(
          res,
          403,
          "SHEET_NOT_PUBLIC",
          "Sheet is not publicly accessible. Publish it: File > Share > Publish to web > Link > CSV."
        );
        return;
      }
  
      res.json({ rows: parseCsvToRows(csv) });
    } catch (error) {
      console.error("[SECURITY] Sheets fetch error:", error.message);
      sendError(res, 502, "SHEETS_FETCH_FAILED", "Failed to fetch spreadsheet");
    }
  });
  
  app.get("/api/lead-clients", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
  
    if (req.authAccess?.role === "pending") {
      sendError(res, 403, "PENDING_APPROVAL", "Your account is waiting for approval");
      return;
    }
  
    try {
      let query = supabase.from("leads_clients").select("id, name, created_at");
      const scopeMode =
        req.authAccess?.scopeMode || (req.authAccess?.role === "client" ? "assigned_clients" : "all_clients");
  
      if (req.authAccess?.role === "client") {
        if (scopeMode === "no_client_access" || !req.authAccess.clientIds?.length) {
          res.json({ items: [] });
          return;
        }
  
        query = query.in("id", req.authAccess.clientIds).order("name", { ascending: true });
      } else if (scopeMode === "assigned_clients") {
        if (!req.authAccess.clientIds?.length) {
          res.json({ items: [] });
          return;
        }
  
        query = query.in("id", req.authAccess.clientIds).order("name", { ascending: true });
      } else {
        query = query.order("name", { ascending: true });
      }
  
      const { data, error } = await query;
  
      if (error) {
        throw error;
      }
  
      const clientIds = (data || []).map((client) => client.id).filter(Boolean);
      const settingsMap = await getLeadClientN8nSettingsMap(clientIds);
      const items = (data || []).map((client) => {
        const settings = settingsMap[client.id] || null;
        return {
          ...client,
          n8n_settings: maskN8nSettings(settings),
          n8n_onboarding_status: getN8nOnboardingStatus(settings),
        };
      });
  
      res.json({ items });
    } catch (error) {
      console.error("lead clients query error:", error);
      sendError(res, 500, "LEAD_CLIENTS_QUERY_FAILED", "Failed to query lead clients");
    }
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

  app.get("/api/lead-clients/:tenantId/table-status", requireFirebaseAuth, requireInternalPageAccess("empresas"), async (req, res) => {
    if (!ensureDb(res)) return;

    const tenantId = normalizeTenantKey(req.params.tenantId);
    if (!tenantId) {
      sendError(res, 400, "INVALID_TENANT_ID", "Tenant ID must use lowercase letters, numbers and hyphens");
      return;
    }

    try {
      const { data: tenant, error: tenantError } = await supabase
        .from("leads_clients")
        .select("id, name")
        .eq("id", tenantId)
        .maybeSingle();

      if (tenantError) throw tenantError;
      if (!tenant) {
        sendError(res, 404, "TENANT_NOT_FOUND", "Tenant not found");
        return;
      }

      const tableStatus = await checkLeadClientTableStatus(tenantId);
      res.json({
        item: {
          tenant,
          table: tableStatus,
        },
      });
    } catch (error) {
      console.error("lead client table status error:", error);
      sendError(res, 500, "LEAD_CLIENT_TABLE_STATUS_FAILED", "Failed to verify tenant leads table");
    }
  });
  
  app.post("/api/lead-clients", requireFirebaseAuth, requireInternalPageAccess("empresas"), async (req, res) => {
    if (!ensureDb(res)) return;
  
    if (!hasAccessPermission(req.authAccess, "tenants.manage")) {
      sendError(res, 403, "FORBIDDEN", "Tenant management permission required");
      return;
    }
  
    const name = normalizeString(req.body?.name);
    const tenantId = normalizeTenantKey(
      req.body?.id ?? req.body?.tenantId ?? req.body?.clientId ?? name
    );
    const n8nSettings = req.body?.n8nSettings;
    const schemaType = normalizeTenantKey(req.body?.chatbotModel) || "generico";
  
    if (!name || name.length < 3) {
      sendError(res, 400, "INVALID_BODY", "Tenant name must have at least 3 characters");
      return;
    }
  
    if (!tenantId) {
      sendError(
        res,
        400,
        "INVALID_BODY",
        "Tenant ID must use lowercase letters, numbers and hyphens"
      );
      return;
    }
  
    if (n8nSettings && !req.authAccess?.isAdmin) {
      sendError(res, 403, "FORBIDDEN", "Admin permission required to configure n8n webhooks");
      return;
    }
  
    try {
      const { data: existingTenant, error: existingTenantError } = await supabase
        .from("leads_clients")
        .select("id")
        .eq("id", tenantId)
        .maybeSingle();
  
      if (existingTenantError) {
        throw existingTenantError;
      }
  
      if (existingTenant) {
        sendError(res, 409, "TENANT_ALREADY_EXISTS", "A tenant with this ID already exists");
        return;
      }
  
      const { data, error } = await supabase
        .from("leads_clients")
        .insert({
          id: tenantId,
          name,
        })
        .select("id, name, created_at")
        .single();
  
      if (error) {
        throw error;
      }

      let tableStatus;
      try {
        tableStatus = await ensureLeadClientTable(tenantId, schemaType);
        console.info(`[tenant-create] Created leads table: ${tableStatus.tableName} (schema: ${schemaType})`);
      } catch (ddlErr) {
        await supabase.from("leads_clients").delete().eq("id", tenantId);
        console.error(`[tenant-create] Failed to create leads table for ${tenantId}:`, ddlErr);
        throw ddlErr;
      }

      let savedSettings = null;
      const settingsPayload = { ...(n8nSettings || {}), chatbotModel: schemaType };
      savedSettings = await upsertLeadClientN8nSettings(
        tenantId,
        settingsPayload,
        req.authAccess,
        null
      );

      res.status(201).json({
        item: {
          ...data,
          leads_table: tableStatus,
          n8n_settings: maskN8nSettings(savedSettings),
          n8n_onboarding_status: getN8nOnboardingStatus(savedSettings),
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_DISPATCH_WEBHOOK_URL") {
        sendError(res, 400, "INVALID_BODY", "dispatchWebhookUrl must be a valid http or https URL");
        return;
      }
  
      if (isDuplicateKeyError(error)) {
        sendError(res, 409, "TENANT_ALREADY_EXISTS", "A tenant with this ID already exists");
        return;
      }
  
      console.error("lead client create error:", error);
      sendError(res, 500, "LEAD_CLIENT_CREATE_FAILED", "Failed to create tenant");
    }
  });
  
  const LEAD_CLIENT_OPERATIONAL_TABLES = [
    "analytics_insights",
    "metric_snapshots",
    "lead_distribution_rules",
    "lead_conversions",
    "lead_assignments",
    "lead_messages",
    "commercial_intelligence_settings",
    "crm_consultants",
    "campaigns",
    "lead_import_items",
    "lead_imports",
    "leads_outlier",
  ];

  async function deleteLeadClientRowsFromTable(tableName, tenantId) {
    const { count, error } = await supabase
      .from(tableName)
      .delete({ count: "exact" })
      .eq("client_id", tenantId);

    if (error) {
      if (isMissingSchemaError(error)) {
        return {
          table: tableName,
          deleted: 0,
          skipped: true,
        };
      }

      throw error;
    }

    return {
      table: tableName,
      deleted: count ?? 0,
      skipped: false,
    };
  }

  async function purgeLeadClientOperationalData(tenantId) {
    const results = [];

    for (const tableName of LEAD_CLIENT_OPERATIONAL_TABLES) {
      results.push(await deleteLeadClientRowsFromTable(tableName, tenantId));
    }

    // Limpar tabela de leads específica do tenant (leads_{clientId})
    results.push(await deleteLeadClientRowsFromTable(leadsTableName(tenantId), tenantId));

    return results;
  }
  
  app.get(
    "/api/lead-clients/:tenantId/n8n-settings",
    requireFirebaseAuth,
    requireAdminAccess,
    async (req, res) => {
      if (!ensureDb(res)) return;
  
      const tenantId = normalizeTenantKey(req.params?.tenantId);
      if (!tenantId) {
        sendError(res, 400, "INVALID_TENANT_ID", "Tenant ID must use lowercase letters, numbers and hyphens");
        return;
      }
  
      try {
        const settings = await getLeadClientN8nSettings(tenantId);
        res.json({ item: maskN8nSettings(settings) });
      } catch (error) {
        console.error("lead client n8n settings query error:", error);
        sendError(res, 500, "N8N_SETTINGS_QUERY_FAILED", "Failed to query n8n settings");
      }
    }
  );
  
  app.patch(
    "/api/lead-clients/:tenantId/n8n-settings",
    requireFirebaseAuth,
    requireAdminAccess,
    async (req, res) => {
      if (!ensureDb(res)) return;
  
      const tenantId = normalizeTenantKey(req.params?.tenantId);
      if (!tenantId) {
        sendError(res, 400, "INVALID_TENANT_ID", "Tenant ID must use lowercase letters, numbers and hyphens");
        return;
      }
  
      try {
        const { data: tenant, error: tenantError } = await supabase
          .from("leads_clients")
          .select("id")
          .eq("id", tenantId)
          .maybeSingle();
  
        if (tenantError) throw tenantError;
        if (!tenant) {
          sendError(res, 404, "TENANT_NOT_FOUND", "Tenant not found");
          return;
        }
  
        const existing = await getLeadClientN8nSettings(tenantId);
        const savedSettings = await upsertLeadClientN8nSettings(
          tenantId,
          req.body || {},
          req.authAccess,
          existing
        );
  
        res.json({ item: maskN8nSettings(savedSettings) });
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_DISPATCH_WEBHOOK_URL") {
          sendError(res, 400, "INVALID_BODY", "dispatchWebhookUrl must be a valid http or https URL");
          return;
        }
  
        console.error("lead client n8n settings update error:", error);
        sendError(res, 500, "N8N_SETTINGS_SAVE_FAILED", "Failed to save n8n settings");
      }
    }
  );

  async function ensureTenantExistsForEvolutionRoute(tenantId, res) {
    const { data: tenant, error: tenantError } = await supabase
      .from("leads_clients")
      .select("id")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenantError) throw tenantError;
    if (!tenant) {
      sendError(res, 404, "TENANT_NOT_FOUND", "Tenant not found");
      return false;
    }

    return true;
  }

  app.get(
    "/api/lead-clients/:tenantId/evolution-instances",
    requireFirebaseAuth,
    requireAdminAccess,
    async (req, res) => {
      if (!ensureDb(res)) return;

      const tenantId = normalizeTenantKey(req.params?.tenantId);
      if (!tenantId) {
        sendError(res, 400, "INVALID_TENANT_ID", "Tenant ID must use lowercase letters, numbers and hyphens");
        return;
      }

      try {
        if (!(await ensureTenantExistsForEvolutionRoute(tenantId, res))) return;
        const instances = await getLeadClientEvolutionInstances(tenantId);
        res.json({ items: instances.map(maskEvolutionInstance) });
      } catch (error) {
        console.error("lead client evolution instances query error:", error);
        sendError(res, 500, "EVOLUTION_INSTANCES_QUERY_FAILED", "Failed to query Evolution instances");
      }
    }
  );

  app.post(
    "/api/lead-clients/:tenantId/evolution-instances",
    requireFirebaseAuth,
    requireAdminAccess,
    async (req, res) => {
      if (!ensureDb(res)) return;

      const tenantId = normalizeTenantKey(req.params?.tenantId);
      if (!tenantId) {
        sendError(res, 400, "INVALID_TENANT_ID", "Tenant ID must use lowercase letters, numbers and hyphens");
        return;
      }

      try {
        if (!(await ensureTenantExistsForEvolutionRoute(tenantId, res))) return;
        const saved = await upsertLeadClientEvolutionInstance(tenantId, req.body || {}, req.authAccess, null);
        res.status(201).json({ item: maskEvolutionInstance(saved) });
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_DISPATCH_WEBHOOK_URL") {
          sendError(res, 400, "INVALID_BODY", "dispatchWebhookUrl must be a valid http or https URL");
          return;
        }

        console.error("lead client evolution instance create error:", error);
        sendError(res, 500, "EVOLUTION_INSTANCE_SAVE_FAILED", "Failed to save Evolution instance");
      }
    }
  );

  app.post(
    "/api/lead-clients/:tenantId/evolution-instances/provision",
    requireFirebaseAuth,
    requireAdminAccess,
    async (req, res) => {
      if (!ensureDb(res)) return;

      const tenantId = normalizeTenantKey(req.params?.tenantId);
      if (!tenantId) {
        sendError(res, 400, "INVALID_TENANT_ID", "Tenant ID must use lowercase letters, numbers and hyphens");
        return;
      }

      try {
        if (!(await ensureTenantExistsForEvolutionRoute(tenantId, res))) return;
        const provisioned = await provisionLeadClientEvolutionInstance(tenantId, req.body || {}, req.authAccess);
        res.status(201).json({
          item: maskEvolutionInstance(provisioned.instance),
          evolution: provisioned.evolution,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "EVOLUTION_ADMIN_UNCONFIGURED") {
          sendError(
            res,
            503,
            "EVOLUTION_ADMIN_UNCONFIGURED",
            "EVOLUTION_API_URL e EVOLUTION_API_KEY precisam estar configurados no backend"
          );
          return;
        }

        console.error("lead client evolution instance provision error:", error);
        sendError(
          res,
          error?.statusCode || 500,
          error?.code || "EVOLUTION_INSTANCE_PROVISION_FAILED",
          error instanceof Error ? error.message : "Failed to provision Evolution instance"
        );
      }
    }
  );

  app.patch(
    "/api/lead-clients/:tenantId/evolution-instances/:instanceId",
    requireFirebaseAuth,
    requireAdminAccess,
    async (req, res) => {
      if (!ensureDb(res)) return;

      const tenantId = normalizeTenantKey(req.params?.tenantId);
      const instanceId = normalizeString(req.params?.instanceId);
      if (!tenantId || !parseOptionalUuid(instanceId)) {
        sendError(res, 400, "INVALID_BODY", "Invalid tenant or Evolution instance id");
        return;
      }

      try {
        if (!(await ensureTenantExistsForEvolutionRoute(tenantId, res))) return;
        const instances = await getLeadClientEvolutionInstances(tenantId);
        const existing = instances.find((instance) => instance.id === instanceId);
        if (!existing) {
          sendError(res, 404, "EVOLUTION_INSTANCE_NOT_FOUND", "Evolution instance not found");
          return;
        }

        const saved = await upsertLeadClientEvolutionInstance(tenantId, req.body || {}, req.authAccess, existing);
        res.json({ item: maskEvolutionInstance(saved) });
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_DISPATCH_WEBHOOK_URL") {
          sendError(res, 400, "INVALID_BODY", "dispatchWebhookUrl must be a valid http or https URL");
          return;
        }

        console.error("lead client evolution instance update error:", error);
        sendError(res, 500, "EVOLUTION_INSTANCE_SAVE_FAILED", "Failed to save Evolution instance");
      }
    }
  );

  app.delete(
    "/api/lead-clients/:tenantId/evolution-instances/:instanceId",
    requireFirebaseAuth,
    requireAdminAccess,
    async (req, res) => {
      if (!ensureDb(res)) return;

      const tenantId = normalizeTenantKey(req.params?.tenantId);
      const instanceId = normalizeString(req.params?.instanceId);
      if (!tenantId || !parseOptionalUuid(instanceId)) {
        sendError(res, 400, "INVALID_BODY", "Invalid tenant or Evolution instance id");
        return;
      }

      try {
        if (!(await ensureTenantExistsForEvolutionRoute(tenantId, res))) return;
        const removed = await deleteLeadClientEvolutionInstance(tenantId, instanceId);
        if (!removed) {
          sendError(res, 404, "EVOLUTION_INSTANCE_NOT_FOUND", "Evolution instance not found");
          return;
        }

        res.json({ item: removed });
      } catch (error) {
        console.error("lead client evolution instance delete error:", error);
        sendError(res, 500, "EVOLUTION_INSTANCE_DELETE_FAILED", "Failed to delete Evolution instance");
      }
    }
  );
  
  async function deleteLeadClientHandler(req, res, explicitTenantId) {
    if (!ensureDb(res)) return;
  
    if (!hasAccessPermission(req.authAccess, "tenants.manage")) {
      sendError(res, 403, "FORBIDDEN", "Tenant management permission required");
      return;
    }
  
    const tenantId = normalizeTenantKey(
      explicitTenantId ??
        req.params?.tenantId ??
        req.body?.tenantId ??
        req.body?.id ??
        req.body?.clientId
    );
  
    if (!tenantId) {
      sendError(
        res,
        400,
        "INVALID_TENANT_ID",
        "Tenant ID must use lowercase letters, numbers and hyphens"
      );
      return;
    }
  
    try {
      const { data: tenant, error: tenantError } = await supabase
        .from("leads_clients")
        .select("id, name")
        .eq("id", tenantId)
        .maybeSingle();
  
      if (tenantError) {
        throw tenantError;
      }
  
      if (!tenant) {
        sendError(res, 404, "TENANT_NOT_FOUND", "Tenant not found");
        return;
      }
  
      const users = await listAllFirebaseUsers();
      const linkedUsers = users.filter((user) => {
        const access = extractManagedAccessClaims(user.customClaims || {}, {
          uid: user.uid,
          email: user.email,
        });
  
        return (
          access.clientId === tenantId ||
          access.tenantId === tenantId ||
          access.clientIds?.includes(tenantId) ||
          access.tenantIds?.includes(tenantId)
        );
      });
  
      if (linkedUsers.length > 0) {
        sendError(
          res,
          409,
          "TENANT_HAS_LINKED_USERS",
          "Existem usuarios vinculados a esta empresa. Remova ou altere esses acessos antes de excluir."
        );
        return;
      }
  
      const purge = await purgeLeadClientOperationalData(tenantId);
  
      const { error: deleteError } = await supabase
        .from("leads_clients")
        .delete()
        .eq("id", tenantId);
  
      if (deleteError) {
        throw deleteError;
      }
  
      res.json({
        success: true,
        item: {
          id: tenant.id,
          name: tenant.name,
          purge,
        },
      });
    } catch (error) {
      console.error("lead client delete error:", error);
      sendError(res, 500, "LEAD_CLIENT_DELETE_FAILED", "Failed to delete tenant");
    }
  }
  
  app.delete("/api/lead-clients/:tenantId", requireFirebaseAuth, requireInternalPageAccess("empresas"), async (req, res) => {
    await deleteLeadClientHandler(req, res);
  });
  
  app.post("/api/lead-clients/delete", requireFirebaseAuth, requireInternalPageAccess("empresas"), async (req, res) => {
    await deleteLeadClientHandler(req, res);
  });
  
  app.post("/api/lead-clients/:tenantId/delete", requireFirebaseAuth, requireInternalPageAccess("empresas"), async (req, res) => {
    await deleteLeadClientHandler(req, res);
  });
  
  app.delete("/api/lead-clients", requireFirebaseAuth, requireInternalPageAccess("empresas"), async (req, res) => {
    await deleteLeadClientHandler(req, res, req.query?.tenantId ?? req.query?.id ?? req.query?.clientId);
  });
  
  app.get("/api/admin/users", requireFirebaseAuth, requireInternalPageAccess("usuarios"), async (req, res) => {
    if (!hasUserPermission(req.authAccess, "users.view")) {
      sendError(res, 403, "FORBIDDEN", "User view permission required");
      return;
    }
  
    try {
      const users = await listAllFirebaseUsers();
      const mappedUsers = users.map(mapAdminUserRecord);
  
      res.json({
        items: filterVisibleUserRecords(mappedUsers, req.authAccess),
      });
    } catch (error) {
      console.error("admin users query error:", error);
      sendError(res, 500, "ADMIN_USERS_QUERY_FAILED", "Failed to query users");
    }
  });

  app.post("/api/admin/users/sync", requireFirebaseAuth, requireUserManagementAccess, async (req, res) => {
    try {
      const users = await listAllFirebaseUsers();
      const synced = [];
      const skipped = [];

      for (const user of users) {
        try {
          const result = await ensureFirebaseUserAccessClaims(user);
          if (result.synced) {
            synced.push(mapAdminUserRecord(result.user));
          } else {
            skipped.push(user.uid);
          }
        } catch (error) {
          skipped.push(user.uid);
          console.error("admin user sync item error:", {
            uid: user.uid,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const refreshedUsers = await listAllFirebaseUsers();
      const mappedUsers = refreshedUsers.map(mapAdminUserRecord);

      res.json({
        success: true,
        syncedCount: synced.length,
        skippedCount: skipped.length,
        synced,
        items: filterVisibleUserRecords(mappedUsers, req.authAccess),
      });
    } catch (error) {
      console.error("admin users sync error:", error);
      sendError(
        res,
        500,
        "ADMIN_USERS_SYNC_FAILED",
        error instanceof Error ? error.message : "Failed to sync Firebase users"
      );
    }
  });
  
  app.get("/api/admin/access-profiles", requireFirebaseAuth, requireInternalPageAccess("usuarios"), async (req, res) => {
    if (!hasUserPermission(req.authAccess, "users.view")) {
      sendError(res, 403, "FORBIDDEN", "User view permission required");
      return;
    }
  
    try {
      const items = await listAccessProfiles();
      res.json({ items });
    } catch (error) {
      console.error("access profiles query error:", error);
      sendError(
        res,
        500,
        "ACCESS_PROFILES_QUERY_FAILED",
        error instanceof Error ? error.message : "Failed to query access profiles"
      );
    }
  });
  
  app.patch("/api/admin/users/:uid/access", requireFirebaseAuth, requireUserManagementAccess, async (req, res) => {
    const uid = normalizeString(req.params.uid);
    const rawRole = normalizeString(req.body?.role);
    const role = normalizeRole(rawRole);
  
    if (!uid || !rawRole) {
      sendError(res, 400, "INVALID_BODY", "Missing uid or role");
      return;
    }
  
    if (!isValidManagedRoleInput(rawRole)) {
      sendError(res, 400, "INVALID_ROLE", "Unsupported role");
      return;
    }
  
    if (!isValidManagedScopeInput(req.body?.scopeMode ?? req.body?.tenantScope)) {
      sendError(res, 400, "INVALID_SCOPE_MODE", "Unsupported scope mode");
      return;
    }
  
    if (!isValidManagedApprovalLevelInput(req.body?.approvalLevel)) {
      sendError(res, 400, "INVALID_APPROVAL_LEVEL", "Unsupported approval level");
      return;
    }
  
    try {
      const auth = getAuth();
      const accessProfiles = await listAccessProfiles();
      const selectedProfile = resolveRequestedAccessProfile(accessProfiles, req.body?.accessPreset, role);
  
      if (req.body?.accessPreset && !findAccessProfileByKey(accessProfiles, req.body?.accessPreset)) {
        sendError(res, 400, "INVALID_ACCESS_PRESET", "Unsupported access preset");
        return;
      }
  
      const user = await auth.getUser(uid);
      const isTargetFixedAdmin = isFixedAdminIdentity({ uid: user.uid, email: user.email });
      const currentTargetAccess = extractManagedAccessClaims(user.customClaims || {}, {
        uid: user.uid,
        email: user.email,
      });
  
      if (!canManageTargetAccess(req.authAccess, currentTargetAccess)) {
        sendError(res, 403, "FORBIDDEN_USER_SCOPE", "You do not have permission to manage this user");
        return;
      }
  
      const managedClaims = isTargetFixedAdmin
        ? buildManagedClaims({
            role: "internal",
            accessPreset: "internal_admin",
            scopeMode: "all_clients",
            approvalLevel: "director",
            permissions: ACCESS_PERMISSION_KEYS,
            clientIds: req.body?.clientIds,
            tenantIds: req.body?.tenantIds,
            clientId: req.body?.clientId,
            tenantId: req.body?.tenantId,
            allowedViews: req.body?.allowedViews,
            companyName: req.body?.companyName,
            internalPages: INTERNAL_PAGE_KEYS,
          })
        : buildManagedClaims({
            role: selectedProfile?.role || role,
            accessPreset: selectedProfile?.key || req.body?.accessPreset,
            scopeMode: req.body?.scopeMode ?? req.body?.tenantScope ?? selectedProfile?.scopeMode,
            approvalLevel: req.body?.approvalLevel ?? selectedProfile?.approvalLevel,
            permissions: req.body?.permissions ?? selectedProfile?.permissions,
            clientIds: req.body?.clientIds,
            tenantIds: req.body?.tenantIds,
            clientId: req.body?.clientId,
            tenantId: req.body?.tenantId,
            allowedViews: req.body?.allowedViews ?? selectedProfile?.allowedViews,
            companyName: req.body?.companyName,
            internalPages: req.body?.internalPages ?? selectedProfile?.internalPages,
          });
  
      if (!canAssignManagedAccess(req.authAccess, managedClaims)) {
        sendError(res, 403, "FORBIDDEN_USER_SCOPE", "You cannot assign this user access scope");
        return;
      }
  
      if (isTargetFixedAdmin && typeof req.body?.disabled === "boolean" && req.body.disabled) {
        sendError(res, 400, "INVALID_BODY", "Fixed admin accounts cannot be disabled");
        return;
      }
  
      const mergedClaims = mergeManagedClaims(user.customClaims || {}, managedClaims);
  
      await auth.setCustomUserClaims(uid, mergedClaims);
  
      if (!isTargetFixedAdmin && typeof req.body?.disabled === "boolean") {
        await auth.updateUser(uid, { disabled: req.body.disabled });
      }
  
      const updatedUser = await auth.getUser(uid);
  
      res.json({
        item: mapAdminUserRecord(updatedUser),
      });
    } catch (error) {
      console.error("admin user access update error:", error);
      sendError(
        res,
        500,
        "ADMIN_USER_ACCESS_UPDATE_FAILED",
        error instanceof Error ? error.message : "Failed to update user access"
      );
    }
  });
  
  app.post("/api/admin/users", requireFirebaseAuth, requireUserManagementAccess, async (req, res) => {
    const email = normalizeString(req.body?.email)?.toLowerCase();
    const password = normalizeString(req.body?.password);
    const displayName = normalizeString(req.body?.displayName);
    const rawRole = normalizeString(req.body?.role);
    const role = normalizeRole(rawRole);
    const sendPasswordReset = normalizeBool(req.body?.sendPasswordReset);
  
    if (!email || !password || !rawRole) {
      sendError(res, 400, "INVALID_BODY", "Missing email, password or role");
      return;
    }
  
    if (!isValidManagedRoleInput(rawRole)) {
      sendError(res, 400, "INVALID_ROLE", "Unsupported role");
      return;
    }
  
    if (!isValidManagedScopeInput(req.body?.scopeMode ?? req.body?.tenantScope)) {
      sendError(res, 400, "INVALID_SCOPE_MODE", "Unsupported scope mode");
      return;
    }
  
    if (!isValidManagedApprovalLevelInput(req.body?.approvalLevel)) {
      sendError(res, 400, "INVALID_APPROVAL_LEVEL", "Unsupported approval level");
      return;
    }
  
    if (password.length < 8) {
      sendError(res, 400, "WEAK_PASSWORD", "Password must have at least 8 characters");
      return;
    }

    let managedClaims = null;
  
    try {
      const auth = getAuth();
      const accessProfiles = await listAccessProfiles();
      const selectedProfile = resolveRequestedAccessProfile(accessProfiles, req.body?.accessPreset, role);
  
      if (req.body?.accessPreset && !findAccessProfileByKey(accessProfiles, req.body?.accessPreset)) {
        sendError(res, 400, "INVALID_ACCESS_PRESET", "Unsupported access preset");
        return;
      }
  
      managedClaims = buildManagedClaims({
        role: selectedProfile?.role || role,
        accessPreset: selectedProfile?.key || req.body?.accessPreset,
        scopeMode: req.body?.scopeMode ?? req.body?.tenantScope ?? selectedProfile?.scopeMode,
        approvalLevel: req.body?.approvalLevel ?? selectedProfile?.approvalLevel,
        permissions: req.body?.permissions ?? selectedProfile?.permissions,
        clientIds: req.body?.clientIds,
        tenantIds: req.body?.tenantIds,
        clientId: req.body?.clientId,
        tenantId: req.body?.tenantId,
        allowedViews: req.body?.allowedViews ?? selectedProfile?.allowedViews,
        companyName: req.body?.companyName,
        internalPages: req.body?.internalPages ?? selectedProfile?.internalPages,
      });
  
      if (!canAssignManagedAccess(req.authAccess, managedClaims)) {
        sendError(res, 403, "FORBIDDEN_USER_SCOPE", "You cannot assign this user access scope");
        return;
      }
  
      const user = await auth.createUser({
        email,
        password,
        displayName: displayName || undefined,
      });
  
      await auth.setCustomUserClaims(user.uid, mergeManagedClaims({}, managedClaims));
  
      let passwordResetLink = null;
      if (sendPasswordReset) {
        passwordResetLink = await auth.generatePasswordResetLink(email);
      }
  
      const createdUser = await auth.getUser(user.uid);
  
      res.status(201).json({
        item: mapAdminUserRecord(createdUser),
        passwordResetLink,
      });
    } catch (error) {
      console.error("admin user create error:", error);
      const code = error?.code || "";
  
      if (code === "auth/email-already-exists") {
        try {
          const auth = getAuth();
          const existingUser = await auth.getUserByEmail(email);
          const existingAccess = extractManagedAccessClaims(existingUser.customClaims || {}, {
            uid: existingUser.uid,
            email: existingUser.email,
          });

          if (!canManageTargetAccess(req.authAccess, existingAccess) && hasManagedAccessClaims(existingUser.customClaims || {})) {
            sendError(res, 409, "EMAIL_ALREADY_EXISTS", "This email is already registered");
            return;
          }

          await auth.updateUser(existingUser.uid, {
            displayName: displayName || existingUser.displayName || undefined,
            disabled: normalizeBool(req.body?.disabled),
          });
          await auth.setCustomUserClaims(
            existingUser.uid,
            mergeManagedClaims(existingUser.customClaims || {}, managedClaims)
          );

          let passwordResetLink = null;
          if (sendPasswordReset) {
            passwordResetLink = await auth.generatePasswordResetLink(email);
          }

          const syncedUser = await auth.getUser(existingUser.uid);

          res.status(200).json({
            item: mapAdminUserRecord(syncedUser),
            passwordResetLink,
            syncedExisting: true,
          });
          return;
        } catch (syncError) {
          console.error("admin existing user sync error:", syncError);
          sendError(
            res,
            500,
            "ADMIN_USER_EXISTING_SYNC_FAILED",
            syncError instanceof Error ? syncError.message : "Failed to sync existing Firebase user"
          );
          return;
        }
      }
  
      sendError(
        res,
        500,
        "ADMIN_USER_CREATE_FAILED",
        error instanceof Error ? error.message : "Failed to create user"
      );
    }
  });
  
  app.delete("/api/admin/users/:uid", requireFirebaseAuth, requireUserManagementAccess, async (req, res) => {
    const uid = normalizeString(req.params?.uid);
  
    if (!uid) {
      sendError(res, 400, "INVALID_PARAM", "Missing user uid");
      return;
    }
  
    if (uid === req.authAccess?.uid) {
      sendError(res, 400, "SELF_DELETE_NOT_ALLOWED", "You cannot delete your own account");
      return;
    }
  
    try {
      const auth = getAuth();
      const user = await auth.getUser(uid);
      const targetAccess = extractManagedAccessClaims(user.customClaims || {}, {
        uid: user.uid,
        email: user.email,
      });
  
      if (!canManageTargetAccess(req.authAccess, targetAccess)) {
        sendError(res, 403, "FORBIDDEN_USER_SCOPE", "You do not have permission to delete this user");
        return;
      }
  
      if (isFixedAdminIdentity({ uid: user.uid, email: user.email })) {
        sendError(res, 400, "FIXED_ADMIN_DELETE_BLOCKED", "Fixed admin accounts cannot be deleted");
        return;
      }
  
      await auth.deleteUser(uid);
  
      res.json({
        success: true,
        uid,
      });
    } catch (error) {
      console.error("admin user delete error:", error);
      const code = error?.code || "";
  
      if (code === "auth/user-not-found") {
        sendError(res, 404, "USER_NOT_FOUND", "User not found");
        return;
      }
      sendError(
        res,
        500,
        "ADMIN_USER_DELETE_FAILED",
        error instanceof Error ? error.message : "Failed to delete user"
      );
    }
  });
  
  const VEXO_SALES_STAGES = new Set([
    "Novo lead",
    "Primeiro contato",
    "Qualificação",
    "Diagnóstico",
    "Proposta enviada",
    "Negociação",
    "Fechado ganho",
    "Fechado perdido",
  ]);
  
  const VEXO_SALES_STATUSES = new Set(["ativo", "pausado", "ganho", "perdido"]);
  const VEXO_SALES_PRIORITIES = new Set(["baixa", "media", "alta"]);
  const VEXO_SALES_INTERACTION_TYPES = new Set(["ligacao", "whatsapp", "reuniao", "email", "observacao"]);
  
  function normalizeVexoSalesChoice(value, allowedValues, fallback) {
    const normalized = normalizeString(value);
    return normalized && allowedValues.has(normalized) ? normalized : fallback;
  }
  
  function normalizeVexoSalesNumber(value) {
    if (value === null || value === undefined || value === "") return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  
  function normalizeVexoSalesDate(value) {
    const normalized = normalizeString(value);
    if (!normalized) return null;
  
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return null;
  
    return normalized.slice(0, 10);
  }
  
  function getVexoSalesActor(req) {
    return {
      email: normalizeString(req.authAccess?.email || req.authUser?.email),
      uid: normalizeString(req.authUser?.uid),
    };
  }
  
  function logVexoSalesApi(level, event, req, details = {}) {
    const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    logger("[vexo-sales-api]", event, {
      method: req?.method,
      path: req?.originalUrl || req?.url,
      uid: normalizeString(req?.authUser?.uid),
      role: normalizeString(req?.authAccess?.role),
      isAdmin: Boolean(req?.authAccess?.isAdmin),
      ...details,
    });
  }
  
  function requireVexoSalesAdminAccess(req, res, next) {
    if (req.authAccess?.role !== "internal" || !req.authAccess?.isAdmin) {
      logVexoSalesApi("warn", "access_denied", req);
      sendError(res, 403, "FORBIDDEN", "Admin permission required");
      return;
    }
  
    next();
  }
  
  function buildVexoSalesOpportunityPayload(body, req, { partial = false } = {}) {
    const actor = getVexoSalesActor(req);
    const payload = {};
  
    const hasAnyField = (...fields) => fields.some((field) => Object.prototype.hasOwnProperty.call(body, field));
    const assignString = (field, value, ...aliases) => {
      if (!partial || hasAnyField(field, ...aliases)) {
        payload[field] = normalizeString(value);
      }
    };
  
    assignString("company_name", body?.company_name ?? body?.companyName, "companyName");
    assignString("contact_name", body?.contact_name ?? body?.contactName, "contactName");
    assignString("contact_phone", body?.contact_phone ?? body?.contactPhone, "contactPhone");
    assignString("contact_email", body?.contact_email ?? body?.contactEmail, "contactEmail");
    assignString("source", body?.source);
    assignString("segment", body?.segment);
    assignString("assigned_to", body?.assigned_to ?? body?.assignedTo, "assignedTo");
    assignString("notes", body?.notes);
  
    if (!partial || hasAnyField("estimated_value", "estimatedValue")) {
      payload.estimated_value = normalizeVexoSalesNumber(body?.estimated_value ?? body?.estimatedValue);
    }
  
    if (!partial || Object.prototype.hasOwnProperty.call(body, "stage")) {
      payload.stage = normalizeVexoSalesChoice(body?.stage, VEXO_SALES_STAGES, "Novo lead");
    }
  
    if (!partial || Object.prototype.hasOwnProperty.call(body, "status")) {
      payload.status = normalizeVexoSalesChoice(body?.status, VEXO_SALES_STATUSES, "ativo");
    }
  
    if (!partial || Object.prototype.hasOwnProperty.call(body, "priority")) {
      payload.priority = normalizeVexoSalesChoice(body?.priority, VEXO_SALES_PRIORITIES, "media");
    }
  
    if (!partial || hasAnyField("expected_close_date", "expectedCloseDate")) {
      payload.expected_close_date = normalizeVexoSalesDate(body?.expected_close_date ?? body?.expectedCloseDate);
    }
  
    if (!partial) {
      payload.owner_company = "vexo";
      payload.internal_module = true;
      payload.created_by = actor.email;
      payload.created_by_uid = actor.uid;
    }
  
    payload.updated_at = new Date().toISOString();
  
    return payload;
  }
  
  function buildVexoSalesSummary(items) {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const total = items.length;
    const won = items.filter((item) => item.status === "ganho");
    const lost = items.filter((item) => item.status === "perdido");
    const open = items.filter((item) => !["ganho", "perdido"].includes(item.status));
    const wonThisMonth = won.filter((item) => {
      const updatedAt = new Date(item.updated_at || item.created_at);
      return updatedAt.getMonth() === month && updatedAt.getFullYear() === year;
    });
  
    const estimatedNegotiationValue = open.reduce(
      (sum, item) => sum + normalizeVexoSalesNumber(item.estimated_value),
      0
    );
    const closedCount = won.length + lost.length;
  
    return {
      total,
      open: open.length,
      estimatedNegotiationValue,
      wonThisMonth: wonThisMonth.length,
      conversionRate: closedCount ? Math.round((won.length / closedCount) * 100) : 0,
    };
  }
  
  app.get("/api/vexo-sales/opportunities", requireFirebaseAuth, requireVexoSalesAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;
  
    try {
      let query = supabase
        .from("vexo_sales_opportunities")
        .select("*")
        .eq("owner_company", "vexo")
        .eq("internal_module", true)
        .order("updated_at", { ascending: false });
  
      const stage = normalizeString(req.query?.stage);
      const status = normalizeString(req.query?.status);
      const priority = normalizeString(req.query?.priority);
      const source = normalizeString(req.query?.source);
      const assignedTo = normalizeString(req.query?.assignedTo ?? req.query?.assigned_to);
  
      if (stage && VEXO_SALES_STAGES.has(stage)) query = query.eq("stage", stage);
      if (status && VEXO_SALES_STATUSES.has(status)) query = query.eq("status", status);
      if (priority && VEXO_SALES_PRIORITIES.has(priority)) query = query.eq("priority", priority);
      if (source) query = query.ilike("source", `%${source}%`);
      if (assignedTo) query = query.ilike("assigned_to", `%${assignedTo}%`);
  
      const { data, error } = await query;
      if (error) throw error;
  
      res.json({
        items: data || [],
        summary: buildVexoSalesSummary(data || []),
      });
    } catch (error) {
      logVexoSalesApi("error", "opportunities_query_failed", req, { error: error?.message || String(error) });
      const missingSchema = isMissingSchemaError(error);
      sendError(
        res,
        500,
        missingSchema ? "VEXO_SALES_SCHEMA_MISSING" : "VEXO_SALES_QUERY_FAILED",
        error instanceof Error ? error.message : "Failed to query Vexo sales opportunities"
      );
    }
  });
  
  app.post("/api/vexo-sales/opportunities", requireFirebaseAuth, requireVexoSalesAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;
  
    const payload = buildVexoSalesOpportunityPayload(req.body || {}, req);
    if (!payload.company_name) {
      logVexoSalesApi("warn", "opportunity_create_invalid_body", req);
      sendError(res, 400, "INVALID_BODY", "Company name is required");
      return;
    }
  
    try {
      const { data, error } = await supabase
        .from("vexo_sales_opportunities")
        .insert(payload)
        .select("*")
        .single();
  
      if (error) throw error;
      logVexoSalesApi("info", "opportunity_created", req, { opportunityId: data?.id });
      res.status(201).json({ item: data });
    } catch (error) {
      logVexoSalesApi("error", "opportunity_create_failed", req, { error: error?.message || String(error) });
      sendError(res, 500, "VEXO_SALES_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create opportunity");
    }
  });
  
  app.patch("/api/vexo-sales/opportunities/:id", requireFirebaseAuth, requireVexoSalesAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;
  
    const id = normalizeString(req.params.id);
    if (!id) {
      logVexoSalesApi("warn", "opportunity_update_missing_id", req);
      sendError(res, 400, "INVALID_ID", "Missing opportunity id");
      return;
    }
  
    const payload = buildVexoSalesOpportunityPayload(req.body || {}, req, { partial: true });
    if (Object.prototype.hasOwnProperty.call(payload, "company_name") && !payload.company_name) {
      logVexoSalesApi("warn", "opportunity_update_invalid_body", req, { opportunityId: id });
      sendError(res, 400, "INVALID_BODY", "Company name is required");
      return;
    }
  
    try {
      const { data, error } = await supabase
        .from("vexo_sales_opportunities")
        .update(payload)
        .eq("id", id)
        .eq("owner_company", "vexo")
        .eq("internal_module", true)
        .select("*")
        .single();
  
      if (error) throw error;
      logVexoSalesApi("info", "opportunity_updated", req, { opportunityId: data?.id || id });
      res.json({ item: data });
    } catch (error) {
      logVexoSalesApi("error", "opportunity_update_failed", req, { opportunityId: id, error: error?.message || String(error) });
      sendError(res, 500, "VEXO_SALES_UPDATE_FAILED", error instanceof Error ? error.message : "Failed to update opportunity");
    }
  });
  
  app.delete("/api/vexo-sales/opportunities/:id", requireFirebaseAuth, requireVexoSalesAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;
  
    const id = normalizeString(req.params.id);
    if (!id) {
      logVexoSalesApi("warn", "opportunity_delete_missing_id", req);
      sendError(res, 400, "INVALID_ID", "Missing opportunity id");
      return;
    }
  
    try {
      const { error } = await supabase
        .from("vexo_sales_opportunities")
        .delete()
        .eq("id", id)
        .eq("owner_company", "vexo")
        .eq("internal_module", true);
  
      if (error) throw error;
      logVexoSalesApi("info", "opportunity_deleted", req, { opportunityId: id });
      res.json({ success: true });
    } catch (error) {
      logVexoSalesApi("error", "opportunity_delete_failed", req, { opportunityId: id, error: error?.message || String(error) });
      sendError(res, 500, "VEXO_SALES_DELETE_FAILED", error instanceof Error ? error.message : "Failed to delete opportunity");
    }
  });
  
  app.get("/api/vexo-sales/opportunities/:id/interactions", requireFirebaseAuth, requireVexoSalesAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;
  
    const id = normalizeString(req.params.id);
    if (!id) {
      logVexoSalesApi("warn", "interactions_query_missing_id", req);
      sendError(res, 400, "INVALID_ID", "Missing opportunity id");
      return;
    }
  
    try {
      const { data, error } = await supabase
        .from("vexo_sales_interactions")
        .select("*")
        .eq("opportunity_id", id)
        .order("interaction_at", { ascending: false });
  
      if (error) throw error;
      res.json({ items: data || [] });
    } catch (error) {
      logVexoSalesApi("error", "interactions_query_failed", req, { opportunityId: id, error: error?.message || String(error) });
      sendError(res, 500, "VEXO_SALES_INTERACTIONS_QUERY_FAILED", error instanceof Error ? error.message : "Failed to query interactions");
    }
  });
  
  app.post("/api/vexo-sales/opportunities/:id/interactions", requireFirebaseAuth, requireVexoSalesAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;
  
    const opportunityId = normalizeString(req.params.id);
    const type = normalizeVexoSalesChoice(req.body?.type, VEXO_SALES_INTERACTION_TYPES, null);
    const description = normalizeString(req.body?.description);
  
    if (!opportunityId || !type || !description) {
      logVexoSalesApi("warn", "interaction_create_invalid_body", req, { opportunityId });
      sendError(res, 400, "INVALID_BODY", "Opportunity id, interaction type and description are required");
      return;
    }
  
    const actor = getVexoSalesActor(req);
    const interactionAt = req.body?.interaction_at || req.body?.interactionAt;
    const payload = {
      opportunity_id: opportunityId,
      type,
      description,
      interaction_at: interactionAt ? new Date(interactionAt).toISOString() : new Date().toISOString(),
      responsible_user: normalizeString(req.body?.responsible_user ?? req.body?.responsibleUser) || actor.email,
      created_by: actor.email,
      created_by_uid: actor.uid,
    };
  
    if (Number.isNaN(new Date(payload.interaction_at).getTime())) {
      logVexoSalesApi("warn", "interaction_create_invalid_date", req, { opportunityId });
      sendError(res, 400, "INVALID_DATE", "Invalid interaction date");
      return;
    }
  
    try {
      const { data: opportunity, error: opportunityError } = await supabase
        .from("vexo_sales_opportunities")
        .select("id")
        .eq("id", opportunityId)
        .eq("owner_company", "vexo")
        .eq("internal_module", true)
        .single();
  
      if (opportunityError || !opportunity) {
        logVexoSalesApi("warn", "interaction_create_opportunity_not_found", req, { opportunityId });
        sendError(res, 404, "OPPORTUNITY_NOT_FOUND", "Opportunity not found");
        return;
      }
  
      const { data, error } = await supabase
        .from("vexo_sales_interactions")
        .insert(payload)
        .select("*")
        .single();
  
      if (error) throw error;
  
      await supabase
        .from("vexo_sales_opportunities")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", opportunityId)
        .eq("owner_company", "vexo")
        .eq("internal_module", true);
  
      logVexoSalesApi("info", "interaction_created", req, { opportunityId, interactionId: data?.id });
      res.status(201).json({ item: data });
    } catch (error) {
      logVexoSalesApi("error", "interaction_create_failed", req, { opportunityId, error: error?.message || String(error) });
      sendError(res, 500, "VEXO_SALES_INTERACTION_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create interaction");
    }
  });
  
  app.post("/api/client-signup", async (req, res) => {
    if (!firebaseReady) {
      sendError(
        res,
        500,
        "FIREBASE_NOT_CONFIGURED",
        "Firebase auth not configured"
      );
      return;
    }
  
    const name = normalizeString(req.body?.name);
    const companyName = normalizeString(req.body?.companyName);
    const email = normalizeString(req.body?.email)?.toLowerCase();
    const password = normalizeString(req.body?.password);
  
    if (!name || !companyName || !email || !password) {
      sendError(res, 400, "INVALID_BODY", "Missing name, companyName, email or password");
      return;
    }
  
    if (password.length < 8) {
      sendError(res, 400, "WEAK_PASSWORD", "Password must have at least 8 characters");
      return;
    }
  
    try {
      const auth = getAuth();
      const user = await auth.createUser({
        email,
        password,
        displayName: `${name} - ${companyName}`.slice(0, 100),
      });
  
      const managedClaims = buildManagedClaims({
        role: "pending",
        companyName,
      });
  
      await auth.setCustomUserClaims(user.uid, mergeManagedClaims({}, managedClaims));
  
      res.status(201).json({
        success: true,
        message: "Conta criada. Aguarde a liberacao do acesso pela equipe Vexo.",
      });
    } catch (error) {
      console.error("client signup error:", error);
      const code = error?.code || "";
      if (code === "auth/email-already-exists") {
        sendError(res, 409, "EMAIL_ALREADY_EXISTS", "This email is already registered");
        return;
      }
  
      sendError(res, 500, "CLIENT_SIGNUP_FAILED", "Failed to create client account");
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
  
      res.json(buildDashboardPayload(client || { id: clientId, name: clientId }, leads || [], conversions));
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
  
  app.get("/api/leads", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    if (!ensureSharedRoutePageAccess(req, res, "leads")) return;
  
    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;
  
    try {
      const { data, error } = await supabase
        .from(leadsTableName(clientId))
        .select("*")
        .eq("client_id", clientId)
        .order("data_hora", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
  
      if (error) {
        throw error;
      }
  
      res.json({ items: data || [] });
    } catch (error) {
      console.error("leads query error:", error);
      sendError(res, 500, "LEADS_QUERY_FAILED", "Failed to query leads");
    }
  });
  
  app.get("/api/lead-imports", requireFirebaseAuth, requireAppViewAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
  
    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;
  
    try {
      const { data, error } = await supabase
        .from("lead_imports")
        .select("id, client_id, source_name, source_type, total_rows, imported_rows, skipped_rows, uploaded_by_uid, uploaded_by_email, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(20);
  
      if (error) {
        throw error;
      }
  
      res.json({ items: data || [] });
    } catch (error) {
      console.error("lead imports query error:", error);
      sendError(res, 500, "LEAD_IMPORTS_QUERY_FAILED", "Failed to query imported spreadsheets");
    }
  });
  
  app.delete("/api/lead-imports/:importId", requireFirebaseAuth, requireAppViewAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
  
    const importId = normalizeString(req.params.importId);
    if (!importId) {
      sendError(res, 400, "INVALID_PARAMS", "Missing importId");
      return;
    }
  
    try {
      const { data: record, error: fetchError } = await supabase
        .from("lead_imports")
        .select("id, client_id")
        .eq("id", importId)
        .maybeSingle();
  
      if (fetchError) throw fetchError;
      if (!record) {
        sendError(res, 404, "NOT_FOUND", "Import not found");
        return;
      }
  
      const clientId = resolveAuthorizedClientId(req, res, record.client_id);
      if (!clientId) return;
  
      const { error: itemsDeleteError } = await supabase
        .from("lead_import_items")
        .delete()
        .eq("import_id", importId);
      if (itemsDeleteError) throw itemsDeleteError;
  
      const { error: importDeleteError } = await supabase
        .from("lead_imports")
        .delete()
        .eq("id", importId);
      if (importDeleteError) throw importDeleteError;
  
      res.json({ success: true, deletedId: importId });
    } catch (error) {
      console.error("lead import delete error:", error);
      sendError(res, 500, "LEAD_IMPORT_DELETE_FAILED", "Failed to delete import");
    }
  });
  
  app.get("/api/lead-import-items", requireFirebaseAuth, requireAppViewAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
  
    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;
  
    const importId = normalizeString(req.query.importId);
    const dispatched = req.query.dispatched;
  
    try {
      let query = supabase
        .from("lead_import_items")
        .select("id, import_id, client_id, row_number, telefone, normalized_data, imported, skip_reason, created_at")
        .eq("client_id", clientId)
        .eq("imported", true)
        .not("telefone", "is", null)
        .order("row_number", { ascending: true });
  
      if (importId) {
        query = query.eq("import_id", importId);
      }
  
      const { data: items, error } = await query;
      if (error) throw error;
  
      const allItems = items || [];
  
      const { data: dispatchRuns } = await supabase
        .from("campaign_dispatch_runs")
        .select("phone")
        .eq("client_id", clientId)
        .eq("status", "sent");

      const dispatchedPhones = new Set((dispatchRuns || []).map((r) => r.phone).filter(Boolean));
  
      const enriched = allItems.map((item) => ({
        ...item,
        dispatched: dispatchedPhones.has(item.telefone),
      }));
  
      if (dispatched === "false") {
        res.json({ items: enriched.filter((i) => !i.dispatched), total: enriched.length, pendingCount: enriched.filter((i) => !i.dispatched).length });
      } else if (dispatched === "true") {
        res.json({ items: enriched.filter((i) => i.dispatched), total: enriched.length, pendingCount: enriched.filter((i) => !i.dispatched).length });
      } else {
        res.json({ items: enriched, total: enriched.length, pendingCount: enriched.filter((i) => !i.dispatched).length });
      }
    } catch (error) {
      console.error("lead import items query error:", error);
      sendError(res, 500, "LEAD_IMPORT_ITEMS_QUERY_FAILED", "Failed to query import items");
    }
  });
  
  app.post("/api/lead-imports", requireFirebaseAuth, requireAppViewAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
  
    const clientId = normalizeString(req.body?.clientId);
    const sourceName = normalizeString(req.body?.sourceName) || "planilha";
    const sourceType = normalizeString(req.body?.sourceType) || "spreadsheet";
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  
    if (!clientId || !rows) {
      sendError(res, 400, "INVALID_BODY", "Missing clientId or rows");
      return;
    }
  
    if (rows.length === 0) {
      sendError(res, 400, "INVALID_BODY", "rows must contain at least one item");
      return;
    }
  
    if (rows.length > 5000) {
      sendError(res, 413, "PAYLOAD_TOO_LARGE", "Maximum 5000 rows per import");
      return;
    }
  
    try {
      const parsedItems = rows.map((row, index) => {
        const normalized = normalizeImportedLead(row, clientId);
        const imported = !!normalized.telefone;
        const skipReason = imported
          ? null
          : isImportedLeadEmpty(normalized)
            ? "Linha vazia ou sem dados aproveitaveis"
            : "Telefone ausente ou invalido";
  
        return {
          rowNumber: index + 2,
          rawData: row,
          normalized,
          imported,
          skipReason,
        };
      });
  
      const validRowsMap = new Map();
      for (const item of parsedItems) {
        if (!item.imported) continue;
        validRowsMap.set(item.normalized.telefone, item.normalized);
      }
  
      const validRows = Array.from(validRowsMap.values());
      const skippedRows = parsedItems.length - validRows.length;
  
      const { data: importRecord, error: importError } = await supabase
        .from("lead_imports")
        .insert({
          client_id: clientId,
          source_name: sourceName,
          source_type: sourceType,
          total_rows: parsedItems.length,
          imported_rows: validRows.length,
          skipped_rows: skippedRows,
          uploaded_by_uid: req.authAccess?.uid || null,
          uploaded_by_email: req.authAccess?.email || null,
        })
        .select("id, client_id, source_name, source_type, total_rows, imported_rows, skipped_rows, uploaded_by_uid, uploaded_by_email, created_at")
        .single();
  
      if (importError) {
        throw importError;
      }
  
      const importItems = parsedItems.map((item) => ({
        import_id: importRecord.id,
        client_id: clientId,
        row_number: item.rowNumber,
        telefone: item.normalized.telefone,
        lead_id: null,
        imported: item.imported,
        skip_reason: item.skipReason,
        raw_data: item.rawData,
        normalized_data: item.normalized,
      }));
  
      const { error: itemsError } = await supabase.from("lead_import_items").insert(importItems);
      if (itemsError) {
        throw itemsError;
      }
  
      res.status(201).json({
        item: importRecord,
        preview: buildImportPreview(parsedItems),
      });
    } catch (error) {
      console.error("lead import create error:", error);
      sendError(
        res,
        500,
        "LEAD_IMPORT_CREATE_FAILED",
        error instanceof Error ? error.message : "Failed to import spreadsheet"
      );
    }
  });
  
  app.post(
    "/api/n8n-dispatches",
    requireFirebaseAuth,
    requireAppViewAccess("planilhas"),
    async (req, res) => {
    if (!ensureDb(res)) return;
  
    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;
    const importId = normalizeString(req.body?.importId);
    const scheduledAt = normalizeString(req.body?.scheduledAt);
    const campaignName = normalizeString(req.body?.campaignName);
    const channel = normalizeString(req.body?.channel);
    const rawLimit = Number.parseInt(String(req.body?.limit ?? ""), 10);
    const limit = Number.isNaN(rawLimit) ? null : rawLimit;
    const validation = validateCampaignAnalyticsMeta(
      req.body?.analyticsMeta ||
        {
          message: req.body?.message,
          image: req.body?.image,
          sequence: req.body?.sequence,
          dispatchOptions: req.body?.dispatchOptions,
        }
    );
  
    try {
      const dispatchSettings = await resolveDispatchWebhookSettings(clientId);
      const { webhookUrl, webhookToken } = dispatchSettings;
      if (!webhookUrl) {
        sendError(
          res,
          400,
          "EVOLUTION_SETTINGS_MISSING",
          "Configure uma URL ativa de disparo Evolution para esta empresa"
        );
        return;
      }
      await checkEvolutionInstanceHealth({
        webhookUrl,
        webhookToken,
        context: {
          clientId,
          mode: "legacy_manual_dispatch",
          campaignName: campaignName || null,
        },
      });
  
      if (!validation.valid) {
        sendError(res, 400, "INVALID_CAMPAIGN_CONTENT", validation.message);
        return;
      }
  
      const leads = await buildDispatchLeads({
        clientId,
        importId,
        limit,
        segmentation: validation.analyticsMeta.segmentation || null,
      });
  
      if (leads.length === 0) {
        sendError(res, 404, "NO_DISPATCH_LEADS", "No leads found for dispatch");
        return;
      }
  
      const clientName = await getClientName(clientId);
      const { summary } = await dispatchCampaignSequence({
        webhookUrl,
        webhookToken,
        leads,
        analyticsMeta: validation.analyticsMeta,
        context: {
          campaign: {
            id: null,
            name: campaignName || null,
            importId,
            scheduledAt: scheduledAt || null,
            channel: channel || null,
            requestedBy: {
              uid: req.authAccess?.uid || null,
              email: req.authAccess?.email || null,
            },
          },
          client: {
            id: clientId,
            name: clientName,
          },
        },
      });
  
      res.json({
        success: true,
        provider: "evolution",
        campaignName: campaignName || null,
        total: leads.length,
        successCount: summary.successCount,
        failureCount: summary.failureCount,
        successPhones: summary.successPhones,
        failures: summary.failures,
        completedCampaign: summary.completedCampaign,
      });
    } catch (error) {
      console.error("legacy manual evolution dispatch error:", error);
      sendError(
        res,
        500,
        "EVOLUTION_DISPATCH_FAILED",
        error instanceof Error ? error.message : "Failed to send leads through Evolution"
      );
    }
    }
  );
  
  // Supabase Edge `lead-webhook` parity: POST only, action create | finalize, same JSON bodies and responses.
  // Authorization: Bearer LEAD_WEBHOOK_BEARER_TOKEN or legacy default @Vexo2026 (matches Edge constant).
  app.post("/api/lead-webhook", async (req, res) => {
    if (!ensureDb(res)) return;
  
    if (!validateLeadWebhookBearer(req, res)) return;
  
    try {
      const body = req.body || {};
      const action = normalizeString(body.action)?.toLowerCase();
  
      if (action !== "create" && action !== "finalize") {
        sendLeadWebhookEdgeStyle(res, 400, {
          success: false,
          error: "action must be either create or finalize",
        });
        return;
      }
  
      const clientId = normalizeString(body.client_id) ?? "infinie";
      const telefone = sanitizePhoneLeadWebhookStyle(body.telefone);
      const nome = normalizeString(body.nome);
      const now = new Date().toISOString();
  
      if (!telefone) {
        sendLeadWebhookEdgeStyle(res, 400, {
          success: false,
          error: "Missing required field: telefone",
        });
        return;
      }
  
      if (action === "create") {
        const { data: existingLead, error: lookupError } = await supabase
          .from(leadsTableName(clientId))
          .select("id, nome")
          .eq("client_id", clientId)
          .eq("telefone", telefone)
          .maybeSingle();
  
        if (lookupError) {
          console.error("lead-webhook create lookup error:", lookupError);
          sendLeadWebhookEdgeStyle(res, 500, {
            success: false,
            error: "Failed to lookup lead",
            details: lookupError.message,
          });
          return;
        }
  
        if (existingLead) {
          sendLeadWebhookEdgeStyle(res, 200, {
            success: true,
            status: "ok",
            action,
            operation: "already_exists",
            id: existingLead.id,
            client_id: clientId,
            telefone,
          });
          return;
        }
  
        const createPayload = {
          client_id: clientId,
          telefone,
          nome,
          status: normalizeString(body.status) ?? "novo",
          data_hora: normalizeIsoDate(body.data_hora) ?? now,
          created_at: now,
          updated_at: now,
        };
  
        const { data: insertedLead, error: insertError } = await supabase
          .from(leadsTableName(clientId))
          .insert(createPayload)
          .select("id")
          .single();

        if (insertError) {
          if (insertError.code === "23505") {
            const { data: duplicateLead, error: duplicateLookupError } = await supabase
              .from(leadsTableName(clientId))
              .select("id, nome")
              .eq("client_id", clientId)
              .eq("telefone", telefone)
              .maybeSingle();
  
            if (duplicateLookupError) {
              console.error("lead-webhook create duplicate lookup error:", duplicateLookupError);
              sendLeadWebhookEdgeStyle(res, 500, {
                success: false,
                error: "Failed to lookup duplicated lead",
                details: duplicateLookupError.message,
              });
              return;
            }
  
            sendLeadWebhookEdgeStyle(res, 200, {
              success: true,
              status: "ok",
              action,
              operation: "already_exists",
              id: duplicateLead?.id ?? null,
              client_id: clientId,
              telefone,
            });
            return;
          }
  
          console.error("lead-webhook create insert error:", insertError);
          sendLeadWebhookEdgeStyle(res, 500, {
            success: false,
            error: "Failed to create lead",
            details: insertError.message,
          });
          return;
        }
  
        sendLeadWebhookEdgeStyle(res, 200, {
          success: true,
          status: "ok",
          action,
          operation: "created",
          id: insertedLead.id,
          client_id: clientId,
          telefone,
        });
        return;
      }
  
      const finalizePayload = {
        client_id: clientId,
        telefone,
        nome,
        tipo_cliente: normalizeString(body.tipo_cliente ?? body.perfil),
        faixa_consumo: normalizeString(body.faixa_consumo ?? body.consumo),
        cidade: normalizeString(body.cidade),
        estado: normalizeString(body.estado),
        status: normalizeString(body.status) ?? "qualificado",
        data_hora: normalizeIsoDate(body.data_hora) ?? now,
        qualificacao: normalizeString(body.qualificacao),
        updated_at: now,
      };
  
      const { data: finalizedLead, error: finalizeError } = await supabase
        .from(leadsTableName(clientId))
        .upsert(finalizePayload, {
          onConflict: "client_id,telefone",
          ignoreDuplicates: false,
        })
        .select("id")
        .single();
  
      if (finalizeError) {
        console.error("lead-webhook finalize error:", finalizeError);
        sendLeadWebhookEdgeStyle(res, 500, {
          success: false,
          error: "Failed to finalize lead",
          details: finalizeError.message,
        });
        return;
      }
  
      sendLeadWebhookEdgeStyle(res, 200, {
        success: true,
        status: "ok",
        action,
        operation: "upserted",
        id: finalizedLead.id,
        client_id: clientId,
        telefone,
      });
    } catch (err) {
      console.error("lead-webhook error:", err);
      sendLeadWebhookEdgeStyle(res, 500, { success: false, error: "Internal server error" });
    }
  });
  
  // Entrada n8n: upsert em `leads` (Bearer por tenant em lead_client_n8n_settings).
  // Caminho antigo: POST /api/leads-webhook — atualizar URLs no n8n após o rename.
  app.post("/api/import-lead-infinie-n8n", async (req, res) => {
    if (!ensureDb(res)) return;
  
    try {
      const body = req.body || {};
      const leadsRaw = body.leads ?? (body.lead ? [body.lead] : []);
      const leads = Array.isArray(leadsRaw) ? leadsRaw : [leadsRaw];
  
      if (leads.length === 0) {
        sendError(res, 400, "INVALID_BODY", "Missing lead or leads array in body");
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
  
      const rows = leads
        .map((lead) => {
          const telefone = sanitizePhone(lead.telefone ?? lead.Telefone);
          if (!telefone) return null;
  
          const dataHora = normalizeIsoDate(lead.data_hora ?? lead["Data e Hora"]);
          return {
            client_id: clientId,
            telefone,
            nome: normalizeString(lead.nome ?? lead.Nome),
            tipo_cliente: normalizeString(lead.tipo_cliente ?? lead["Tipo de Cliente"]),
            faixa_consumo: normalizeString(lead.faixa_consumo ?? lead["Faixa de Consumo"]),
            cidade: normalizeString(lead.cidade ?? lead.Cidade),
            estado: normalizeString(lead.estado ?? lead.Estado),
            status: normalizeString(lead.status ?? lead.Status),
            data_hora: dataHora,
            qualificacao: normalizeString(
              lead.qualificacao ?? lead.Qualificacao ?? lead.resumo ?? lead.Resumo
            ),
          };
        })
        .filter(Boolean);
  
      const { data, error } = await supabase
        .from(leadsTableName(clientId))
        .upsert(rows, {
          onConflict: "client_id,telefone",
          ignoreDuplicates: false,
        })
        .select("id");
  
      if (error) {
        console.error("leads upsert error:", error);
        sendError(res, 500, "LEADS_SAVE_FAILED", "Failed to save leads", error.message);
        return;
      }
  
      res.json({ success: true, count: rows.length, ids: data?.map((item) => item.id) || [] });
    } catch (error) {
      console.error("import-lead-infinie-n8n error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
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
  
  app.get("/api/whatsapp/session", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (_req, res) => {
    if (whatsappSessionManager.getState().hasPersistedSession) {
      whatsappSessionManager.restorePersistedSession().catch((error) => {
        console.error("whatsapp persisted session restore error:", error);
      });
    }
  
    res.json(whatsappSessionManager.getState());
  });
  
  app.post("/api/whatsapp/session/start", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (_req, res) => {
    try {
      const state = await whatsappSessionManager.start();
      res.json(state);
    } catch (error) {
      console.error("whatsapp session start error:", error);
      sendError(
        res,
        500,
        "WHATSAPP_SESSION_START_FAILED",
        error instanceof Error ? error.message : "Failed to start WhatsApp session"
      );
    }
  });
  
  app.post("/api/whatsapp/session/reset", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (_req, res) => {
    try {
      const state = await whatsappSessionManager.reset();
      res.json(state);
    } catch (error) {
      console.error("whatsapp session reset error:", error);
      sendError(
        res,
        500,
        "WHATSAPP_SESSION_RESET_FAILED",
        error instanceof Error ? error.message : "Failed to reset WhatsApp session"
      );
    }
  });
  
  app.get("/api/whatsapp/chats", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (_req, res) => {
    try {
      const search = normalizeString(_req.query.search)?.toLowerCase() || "";
      const rawLimit = Number.parseInt(String(_req.query.limit || "100"), 10);
      const rawOffset = Number.parseInt(String(_req.query.offset || "0"), 10);
      const limit = Number.isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 200);
      const offset = Number.isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);
  
      if (_req.authAccess?.role === "client") {
        const authorizedChatIds = await getAuthorizedWhatsAppChatIdsForRequest(_req, res);
        if (!authorizedChatIds) {
          return;
        }
  
        const matchesSearch = (chat) => {
          if (!search) return true;
  
          const haystack = [
            chat.name,
            chat.id,
            chat.lastMessage?.body,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
  
          return haystack.includes(search);
        };
  
        const items = (await whatsappSessionManager.getChats())
          .filter((chat) => authorizedChatIds.has(normalizeWhatsAppChatId(chat.id)))
          .filter(matchesSearch);
        const pageItems = items.slice(offset, offset + limit);
  
        res.json({
          items: pageItems,
          total: items.length,
          nextOffset: offset + pageItems.length,
          hasMore: offset + pageItems.length < items.length,
        });
        return;
      }
  
      const payload = await whatsappSessionManager.getChatsPage({ search, limit, offset });
  
      res.json(payload);
    } catch (error) {
      console.error("whatsapp chats error:", error);
      sendError(
        res,
        409,
        "WHATSAPP_NOT_READY",
        error instanceof Error ? error.message : "WhatsApp session is not connected"
      );
    }
  });
  
  app.post("/api/whatsapp/chats/read", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    const chatId = normalizeString(req.body?.chatId);
  
    if (!chatId) {
      sendError(res, 400, "INVALID_BODY", "Missing chatId");
      return;
    }
  
    if (!(await ensureAuthorizedWhatsAppChat(req, res, chatId))) {
      return;
    }
  
    try {
      const result = await whatsappSessionManager.markChatAsSeen(chatId);
      res.json(result);
    } catch (error) {
      console.error("whatsapp mark read error:", error);
      sendError(
        res,
        409,
        "WHATSAPP_MARK_READ_FAILED",
        error instanceof Error ? error.message : "Failed to mark WhatsApp chat as seen"
      );
    }
  });
  
  app.get("/api/whatsapp/messages", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    const chatId = normalizeString(req.query.chatId);
    const rawLimit = Number.parseInt(String(req.query.limit || "20"), 10);
    const limit = Number.isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 50);
  
    if (!chatId) {
      sendError(res, 400, "INVALID_QUERY", "Missing chatId");
      return;
    }
  
    if (!(await ensureAuthorizedWhatsAppChat(req, res, chatId))) {
      return;
    }
  
    try {
      const items = await whatsappSessionManager.getMessages(chatId, limit);
      res.json({ items });
    } catch (error) {
      console.error("whatsapp messages error:", error);
      sendError(
        res,
        409,
        "WHATSAPP_MESSAGES_FAILED",
        error instanceof Error ? error.message : "Failed to fetch WhatsApp messages"
      );
    }
  });
  
  app.post("/api/whatsapp/messages", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    const chatId = normalizeString(req.body?.chatId);
    const body = normalizeString(req.body?.body);
  
    if (!chatId || !body) {
      sendError(res, 400, "INVALID_BODY", "Missing chatId or body");
      return;
    }
  
    if (!(await ensureAuthorizedWhatsAppChat(req, res, chatId))) {
      return;
    }
  
    try {
      const item = await whatsappSessionManager.sendMessage(chatId, body);
      res.status(201).json({ item });
    } catch (error) {
      console.error("whatsapp send message error:", error);
      sendError(
        res,
        409,
        "WHATSAPP_SEND_FAILED",
        error instanceof Error ? error.message : "Failed to send WhatsApp message"
      );
    }
  });
  
  app.post("/api/whatsapp/messages/direct", requireFirebaseAuth, requireAdminAccess, async (req, res) => {
    const phone = normalizeString(req.body?.phone);
    const body = normalizeString(req.body?.body);
  
    // ✅ Validação de phone (10-13 dígitos)
    if (!phone || !/^\d{10,13}$/.test(phone.replace(/\D/g, ""))) {
      sendError(res, 400, "INVALID_PHONE", "Invalid phone number (must be 10-13 digits)");
      return;
    }
  
    // ✅ Validação de mensagem (não vazio, máximo 4096 caracteres)
    if (!body || body.length > 4096) {
      sendError(res, 400, "INVALID_MESSAGE", "Message too long or empty (max 4096 characters)");
      return;
    }
  
    try {
      // ✅ Auditoria log com UID + phone
      console.log(
        `[AUDIT] WhatsApp direct message sent by admin ${req.authAccess?.uid} to phone ${phone}`
      );
  
      const result = await whatsappSessionManager.sendDirectMessage(phone, body);
      res.status(201).json(result);
    } catch (error) {
      console.error("[SECURITY] WhatsApp direct send error:", error);
      sendError(
        res,
        409,
        "WHATSAPP_DIRECT_SEND_FAILED",
        error instanceof Error ? error.message : "Failed to send direct WhatsApp message"
      );
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // CAMPANHAS — CRUD + TRIGGER + LEADS-FOR-DISPATCH
  // ─────────────────────────────────────────────────────────────
  
  // GET /api/campaigns — lista campanhas do usuário
  app.get("/api/campaigns/ai/status", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (_req, res) => {
    res.json(getGroqCampaignAiStatus());
  });
  
  app.post("/api/campaigns/ai/generate-copy", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    try {
      if (!getGroqCampaignAiStatus().enabled) {
        sendError(res, 404, "GROQ_DISABLED", "Groq assistivo nao esta configurado neste ambiente");
        return;
      }
  
      const item = await generateCampaignCopySuggestion({
        campaignName: req.body?.campaignName,
        goal: req.body?.goal,
        style: req.body?.style,
        segmentation: req.body?.segmentation,
      });
  
      res.json({ item });
    } catch (error) {
      console.error("campaign ai generate copy error:", error);
      sendError(res, 502, "GROQ_REQUEST_FAILED", error instanceof Error ? error.message : "Falha ao consultar a Groq");
    }
  });
  
  app.post("/api/campaigns/ai/suggest-sequence", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    try {
      if (!getGroqCampaignAiStatus().enabled) {
        sendError(res, 404, "GROQ_DISABLED", "Groq assistivo nao esta configurado neste ambiente");
        return;
      }
  
      const suggestion = await suggestCampaignSequence({
        campaignName: req.body?.campaignName,
        goal: req.body?.goal,
        style: req.body?.style,
        segmentation: req.body?.segmentation,
        sequence: req.body?.sequence,
      });
      const analyticsMeta = normalizeCampaignAnalyticsMeta({
        sequence: suggestion.sequence,
        dispatchOptions: {
          leadDelaySeconds: suggestion.leadDelaySeconds,
          stopOnStepFailure: true,
          aiAssisted: true,
        },
      });
  
      res.json({
        item: {
          sequence: analyticsMeta.sequence,
          dispatchOptions: analyticsMeta.dispatchOptions,
          rationale: suggestion.rationale,
        },
      });
    } catch (error) {
      console.error("campaign ai suggest sequence error:", error);
      sendError(res, 502, "GROQ_REQUEST_FAILED", error instanceof Error ? error.message : "Falha ao consultar a Groq");
    }
  });

  app.post("/api/campaigns/ai/generate-template-variants", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    try {
      if (!getGroqCampaignAiStatus().enabled) {
        sendError(res, 404, "GROQ_DISABLED", "Groq assistivo nao esta configurado neste ambiente");
        return;
      }

      const suggestion = await generateCampaignTemplateVariants({
        campaignName: req.body?.campaignName,
        goal: req.body?.goal,
        style: req.body?.style,
        baseText: req.body?.baseText,
        count: req.body?.count,
        segmentation: req.body?.segmentation,
        sequence: req.body?.sequence,
      });

      res.json({ item: suggestion });
    } catch (error) {
      console.error("campaign ai generate template variants error:", error);
      sendError(res, 502, "GROQ_REQUEST_FAILED", error instanceof Error ? error.message : "Falha ao consultar a Groq");
    }
  });

  app.post("/api/campaigns/ai/suggest-delays", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    try {
      if (!getGroqCampaignAiStatus().enabled) {
        sendError(res, 404, "GROQ_DISABLED", "Groq assistivo nao esta configurado neste ambiente");
        return;
      }
  
      const normalizedMeta = normalizeCampaignAnalyticsMeta({
        sequence: req.body?.sequence,
        dispatchOptions: req.body?.dispatchOptions,
      });
      const suggestion = await suggestCampaignDelays({
        campaignName: req.body?.campaignName,
        goal: req.body?.goal,
        style: req.body?.style,
        segmentation: req.body?.segmentation,
        sequence: normalizedMeta.sequence,
      });
      const suggestedDelays = new Map(
        (suggestion.sequence || []).map((step) => [normalizeString(step.id), Number(step.delayAfterSeconds) || 0])
      );
      const analyticsMeta = normalizeCampaignAnalyticsMeta({
        ...normalizedMeta,
        sequence: normalizedMeta.sequence.map((step) => ({
          ...step,
          delayAfterSeconds: suggestedDelays.has(step.id)
            ? suggestedDelays.get(step.id)
            : step.delayAfterSeconds,
        })),
        dispatchOptions: {
          ...normalizedMeta.dispatchOptions,
          leadDelaySeconds: suggestion.leadDelaySeconds,
          aiAssisted: true,
        },
      });
  
      res.json({
        item: {
          sequence: analyticsMeta.sequence,
          dispatchOptions: analyticsMeta.dispatchOptions,
          rationale: suggestion.rationale,
        },
      });
    } catch (error) {
      console.error("campaign ai suggest delays error:", error);
      sendError(res, 502, "GROQ_REQUEST_FAILED", error instanceof Error ? error.message : "Falha ao consultar a Groq");
    }
  });
  
  app.post("/api/campaigns/ai/rewrite-step", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    try {
      if (!getGroqCampaignAiStatus().enabled) {
        sendError(res, 404, "GROQ_DISABLED", "Groq assistivo nao esta configurado neste ambiente");
        return;
      }
  
      const step = req.body?.step && typeof req.body.step === "object" ? req.body.step : {};
      const suggestion = await rewriteCampaignStep({
        campaignName: req.body?.campaignName,
        goal: req.body?.goal,
        style: req.body?.style,
        segmentation: req.body?.segmentation,
        step,
      });
  
      res.json({
        item: {
          step: {
            ...step,
            text: suggestion.text,
          },
          rationale: suggestion.rationale,
        },
      });
    } catch (error) {
      console.error("campaign ai rewrite step error:", error);
      sendError(res, 502, "GROQ_REQUEST_FAILED", error instanceof Error ? error.message : "Falha ao consultar a Groq");
    }
  });
  
  app.post("/api/campaigns/direct-dispatch", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
  
    const requestId = getRequestId(req);
    res.setHeader("X-Request-Id", requestId);
  
    const requestedClientId = normalizeString(req.body?.clientId);
    const phone = sanitizePhone(req.body?.phone ?? req.body?.telefone ?? req.body?.number);
    const text = normalizeString(req.body?.text ?? req.body?.message ?? req.body?.txt);
    const imageCaption = normalizeString(req.body?.imageCaption ?? req.body?.caption);
    const imageFirst = req.body?.imageFirst === true || req.body?.imageFirst === "true";
    const image = req.body?.image && typeof req.body.image === "object" ? req.body.image : null;
  
    if (!requestedClientId) {
      sendError(res, 400, "INVALID_BODY", "Missing clientId", { requestId });
      return;
    }
  
    if (!phone) {
      sendError(res, 400, "INVALID_BODY", "Missing valid phone", { requestId });
      return;
    }
  
    if (!text && !image) {
      sendError(res, 400, "INVALID_BODY", "Missing message text or image", { requestId });
      return;
    }
  
    try {
      logDirectDispatch("info", "request_received", {
        requestId,
        requestedClientId,
        hasText: !!text,
        hasImage: !!image,
        imageFirst,
        phone: maskPhoneForLog(phone),
        userUid: req.authAccess?.uid || null,
      });
  
      const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
      if (!clientId) return;
  
      const dispatchSettings = await resolveDispatchWebhookSettings(clientId);
      const { webhookUrl, webhookToken } = dispatchSettings;
  
      logDirectDispatch("info", "tenant_resolved", {
        requestId,
        requestedClientId,
        resolvedClientId: clientId,
        ...getSafeDispatchSettingsLog(dispatchSettings),
      });
  
      if (!webhookUrl) {
        const details = {
          requestId,
          clientId,
          settingsSource: dispatchSettings.source,
          schemaAvailable: dispatchSettings.schemaAvailable !== false,
        };
  
        if (dispatchSettings.source === "schema_missing") {
          logDirectDispatch("error", "settings_schema_missing", details);
          sendError(
            res,
            503,
            "EVOLUTION_SETTINGS_SCHEMA_MISSING",
            "A tabela de configuracao de disparo por empresa nao esta aplicada neste ambiente.",
            details
          );
          return;
        }
  
        if (dispatchSettings.source === "env_invalid") {
          logDirectDispatch("error", "settings_env_invalid", details);
          sendError(
            res,
            500,
            "EVOLUTION_SETTINGS_INVALID",
            "A URL de disparo configurada para esta empresa e invalida.",
            details
          );
          return;
        }
  
        logDirectDispatch("warn", "settings_missing", details);
        sendError(
          res,
          400,
          "EVOLUTION_SETTINGS_MISSING",
          "Configure uma URL ativa de disparo Evolution para esta empresa",
          details
        );
        return;
      }
  
      const clientName = await getClientName(clientId);
      const textStep = text
        ? {
          id: "direct-text",
          type: "text",
          order: 1,
          text,
          enabled: true,
          delayAfterSeconds: image ? 1 : 0,
        }
        : null;
      const imageStep = image
        ? {
          id: "direct-image",
          type: "image",
          order: 1,
          text: imageCaption,
          image,
          enabled: true,
          delayAfterSeconds: 0,
        }
        : null;
      const sequence = imageFirst
        ? [imageStep, textStep].filter(Boolean).map((step, index) => ({ ...step, order: index + 1 }))
        : [textStep, imageStep].filter(Boolean).map((step, index) => ({ ...step, order: index + 1 }));
  
      await checkEvolutionInstanceHealth({
        webhookUrl,
        webhookToken,
        context: {
          requestId,
          clientId,
          mode: "direct_dispatch",
        },
      });
  
      logDirectDispatch("info", "dispatch_started", {
        requestId,
        clientId,
        steps: sequence.map((step) => ({ id: step.id, type: step.type, order: step.order })),
        settingsSource: dispatchSettings.source,
      });
  
      const { summary } = await dispatchCampaignSequence({
        webhookUrl,
        webhookToken,
        leads: [{ telefone: phone }],
        analyticsMeta: {
          sequence,
          dispatchOptions: {
            leadDelaySeconds: 0,
            stopOnStepFailure: true,
            aiAssisted: false,
          },
        },
        context: {
          campaign: {
            id: null,
            name: "Disparo direto",
            mode: "direct_dispatch",
            requestId,
            requestedAt: new Date().toISOString(),
            requestedBy: {
              uid: req.authAccess?.uid || null,
              email: req.authAccess?.email || null,
            },
          },
          client: { id: clientId, name: clientName },
        },
      });
  
      logDirectDispatch(summary.successCount > 0 ? "info" : "warn", "dispatch_finished", {
        requestId,
        clientId,
        successCount: summary.successCount,
        failureCount: summary.failureCount,
        completedCampaign: summary.completedCampaign,
        firstFailure: summary.failures[0]
          ? {
            stepType: summary.failures[0].stepType,
            reason: summary.failures[0].reason,
          }
          : null,
      });
  
      if (summary.successCount <= 0) {
        const firstReason = summary.failures[0]?.reason;
        sendError(
          res,
          502,
          "EVOLUTION_DISPATCH_NO_SUCCESS",
          firstReason ? `Falha no envio Evolution: ${firstReason}` : "Nenhuma mensagem foi aceita pelo provedor de disparo.",
          {
            requestId,
            failureCount: summary.failureCount,
            failures: summary.failures,
            settingsSource: dispatchSettings.source,
          }
        );
        return;
      }
  
      res.json({
        success: summary.successCount > 0,
        provider: "evolution",
        phone,
        requestId,
        settingsSource: dispatchSettings.source,
        successCount: summary.successCount,
        failureCount: summary.failureCount,
        successPhones: summary.successPhones,
        failures: summary.failures,
        completedCampaign: summary.completedCampaign,
      });
    } catch (error) {
      logDirectDispatch("error", "unexpected_error", {
        requestId,
        error: error instanceof Error ? error.message : "unknown error",
        stack: isProduction ? undefined : error?.stack,
      });
      sendError(
        res,
        500,
        "EVOLUTION_DIRECT_DISPATCH_FAILED",
        error instanceof Error ? error.message : "Falha no disparo direto",
        { requestId }
      );
    }
  });
  
  app.get("/api/campaigns", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveRequiredAuthorizedClientId({
      req,
      res,
      requestedClientId,
      resolveAuthorizedClientId,
      sendError,
    });
    if (!clientId) return;
  
    try {
      const campaignSelect =
        "id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, starts_at, ends_at, chatbot_prompt_type, mode, campaign_prompt_id, last_triggered_at, archived_at, created_by_uid, created_by_email, created_at, analytics_meta";
      const fallbackCampaignSelect =
        "id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, created_at";
      let query = supabase
        .from("campaigns")
        .select(campaignSelect)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
  
      if (clientId) {
        query = query.eq("client_id", clientId);
      }
  
      let { data, error } = await query;
  
      if (error) {
        let fallbackQuery = supabase
          .from("campaigns")
          .select(fallbackCampaignSelect)
          .is("archived_at", null)
          .order("created_at", { ascending: false });
        if (clientId) {
          fallbackQuery = fallbackQuery.eq("client_id", clientId);
        }
        const fallback = await fallbackQuery;
        data = fallback.data;
        error = fallback.error;
        if (error) {
          sendError(res, 500, "CAMPAIGNS_FETCH_FAILED", "Failed to fetch campaigns", error.message);
          return;
        }
      }
  
      // Fetch client names separately (no FK declared in schema cache)
      const clientIds = [...new Set((data || []).map((r) => r.client_id).filter(Boolean))];
      let clientNameMap = {};
      if (clientIds.length > 0) {
        const { data: clients } = await supabase
          .from("leads_clients")
          .select("id, name")
          .in("id", clientIds);
        (clients || []).forEach((c) => { clientNameMap[c.id] = c.name; });
      }
  
      const items = (data || []).map((row) => ({
        ...row,
        analytics_meta: normalizeCampaignAnalyticsMeta(row.analytics_meta || {}),
        client_name: clientNameMap[row.client_id] ?? null,
        webhook_token: row.webhook_token ? "***" : null,
      }));
  
      res.json({ items });
    } catch (error) {
      console.error("campaigns fetch error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  });
  
  app.get("/api/campaigns/:id/leads", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
  
    const id = normalizeString(req.params?.id);
    if (!id) {
      sendError(res, 400, "INVALID_PARAM", "Missing campaign id");
      return;
    }
  
    try {
      let { data: campaign, error: fetchError } = await supabase
        .from("campaigns")
        .select("id, client_id, import_id, limit_per_run, phones, analytics_meta")
        .eq("id", id)
        .single();
  
      if (fetchError && isMissingSchemaError(fetchError)) {
        const fallback = await supabase
          .from("campaigns")
          .select("id, client_id, import_id, limit_per_run, phones")
          .eq("id", id)
          .single();
        campaign = fallback.data;
        fetchError = fallback.error;
      }
  
      if (fetchError || !campaign) {
        sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return;
      }
  
      const authorizedClientId = resolveAuthorizedClientId(req, res, campaign.client_id);
      if (!authorizedClientId) return;
  
      let items = [];
      const storedPhones = Array.isArray(campaign.phones)
        ? campaign.phones.filter((phone) => typeof phone === "string" && phone.trim())
        : [];
  
      if (storedPhones.length > 0) {
        const { data: leads, error: leadsError } = await supabase
          .from(leadsTableName(authorizedClientId))
          .select("*")
          .eq("client_id", authorizedClientId)
          .in("telefone", storedPhones)
          .order("data_hora", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });
  
        if (leadsError) throw leadsError;
        items = leads || [];
      } else {
        items = await buildDispatchLeads({
          clientId: authorizedClientId,
          importId: campaign.import_id || null,
          limit: campaign.limit_per_run,
          segmentation: campaign.analytics_meta?.segmentation || null,
        });
      }
  
      res.json({ items });
    } catch (error) {
      console.error("campaign leads error:", error);
      sendError(res, 500, "CAMPAIGN_LEADS_FAILED", "Failed to load campaign leads");
    }
  });
  
  // POST /api/campaigns — cria campanha
  app.post("/api/campaigns", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
  
    const name = normalizeString(req.body?.name);
    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveRequiredAuthorizedClientId({
      req,
      res,
      requestedClientId,
      resolveAuthorizedClientId,
      sendError,
    });
    if (!clientId) return;
    const importId = normalizeString(req.body?.importId) || null;
    const rawLimit = Number.parseInt(String(req.body?.limitPerRun ?? "50"), 10);
    const limitPerRun = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 500);
    const scheduledFor = normalizeString(req.body?.scheduledFor) || null;
    const analyticsMeta =
      req.body?.analyticsMeta && typeof req.body.analyticsMeta === "object"
        ? req.body.analyticsMeta
        : {};
    const campaignMessage = normalizeString(analyticsMeta.message);
    const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
    const lifecycleStatus = scheduledFor ? "scheduled" : "active";
    const campaignPromptId = normalizeString(req.body?.campaignPromptId) || null;
    if (!["disparo", "agente"].includes(req.body?.mode)) {
      return sendError(res, 400, "INVALID_BODY", "mode é obrigatório e deve ser 'disparo' ou 'agente'");
    }
    const campaignMode = req.body.mode;
    const analyticsMetaWithDispatch = {
      ...analyticsMeta,
      message: campaignMessage,
      dispatch: {
        ...normalizeCampaignAnalyticsMeta(analyticsMeta.dispatch),
        status: lifecycleStatus,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  
    if (!name) {
      sendError(res, 400, "INVALID_BODY", "Missing name");
      return;
    }
  
    try {
      const authorizedClientId = resolveAuthorizedClientId(req, res, clientId);
      if (!authorizedClientId) return;
  
      const validation = validateCampaignAnalyticsMeta(analyticsMeta);
      if (!validation.valid) {
        sendError(res, 400, "INVALID_CAMPAIGN_CONTENT", validation.message);
        return;
      }

      const dispatchSettings = await resolveCampaignDispatchSettings(authorizedClientId, {
        analytics_meta: validation.analyticsMeta,
      });
      const { webhookUrl, webhookToken } = dispatchSettings;
      if (!webhookUrl) {
        sendError(
          res,
          400,
          "EVOLUTION_SETTINGS_MISSING",
          "Configure uma URL ativa de disparo Evolution para esta empresa antes de criar campanhas"
        );
        return;
      }
  
      await checkEvolutionInstanceHealth({
        webhookUrl,
        webhookToken,
        context: {
          clientId: authorizedClientId,
          campaignName: name,
          mode: "campaign_create",
          ...getSafeDispatchSettingsLog(dispatchSettings),
        },
      });
  
      let { data, error } = await supabase
        .from("campaigns")
        .insert({
          name,
          client_id: authorizedClientId,
          import_id: importId,
          limit_per_run: limitPerRun,
          scheduled_for: scheduledFor,
          webhook_url: webhookUrl,
          webhook_token: webhookToken,
          status: lifecycleStatus,
          created_by_uid: req.authAccess?.uid || null,
          created_by_email: req.authAccess?.email || null,
          analytics_meta: analyticsMetaWithDispatch,
          campaign_prompt_id: campaignPromptId,
          mode: campaignMode,
        })
        .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, created_at, analytics_meta, campaign_prompt_id, mode")
        .single();
  
      if (error) {
        const fallback = await supabase
          .from("campaigns")
          .insert({
            name,
            client_id: authorizedClientId,
            import_id: importId,
            limit_per_run: limitPerRun,
            scheduled_for: scheduledFor,
            webhook_url: webhookUrl,
            webhook_token: webhookToken,
            status: lifecycleStatus,
            created_by_uid: req.authAccess?.uid || null,
            created_by_email: req.authAccess?.email || null,
            mode: campaignMode,
          })
            .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, created_at, mode")
          .single();
        data = fallback.data;
        error = fallback.error;
        if (error) {
          sendError(res, 500, "CAMPAIGN_CREATE_FAILED", "Failed to create campaign", error.message);
          return;
        }
      }
  
      res.status(201).json({
        item: {
          ...data,
          analytics_meta: normalizeCampaignAnalyticsMeta(data.analytics_meta || analyticsMetaWithDispatch),
          webhook_token: webhookToken ? "***" : null,
        },
      });
    } catch (error) {
      console.error("[campaigns] Erro ao criar campanha:", error);
      // Erros de checkEvolutionInstanceHealth carregam statusCode e code customizados
      const httpStatus = typeof error?.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;
      const errorCode = error?.code || "INTERNAL_ERROR";
      const errorMessage = httpStatus < 500 ? error.message : "Internal server error";
      sendError(res, httpStatus, errorCode, errorMessage, internalErrorPayloadDetails(error));
    }
  });

  // PATCH /api/campaigns/:id — atualiza campanha
  app.patch("/api/campaigns/:id", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
  
    const id = normalizeString(req.params?.id);
    if (!id) { sendError(res, 400, "INVALID_PARAM", "Missing campaign id"); return; }
  
    const updates = {};
    if (req.body?.name) updates.name = normalizeString(req.body.name);
    if (["active", "paused", "draft", "scheduled", "processing", "sent", "failed", "cancelled"].includes(req.body?.status)) {
      updates.status = req.body.status;
    }
    if (req.body?.limitPerRun) {
      const v = Number.parseInt(String(req.body.limitPerRun), 10);
      if (!Number.isNaN(v) && v > 0) updates.limit_per_run = Math.min(v, 500);
    }
    if ("scheduledFor" in req.body) updates.scheduled_for = normalizeString(req.body?.scheduledFor) || null;
    if ("startsAt" in req.body) updates.starts_at = normalizeString(req.body?.startsAt) || null;
    if ("endsAt" in req.body) updates.ends_at = normalizeString(req.body?.endsAt) || null;
    if (req.body?.chatbotPromptType) updates.chatbot_prompt_type = normalizeString(req.body.chatbotPromptType);
    if ("campaignPromptId" in req.body) updates.campaign_prompt_id = normalizeString(req.body.campaignPromptId) || null;
    if (["disparo", "agente"].includes(req.body?.mode)) updates.mode = req.body.mode;
    if (req.body?.archived === true) updates.archived_at = new Date().toISOString();
    if (req.body?.archived === false) updates.archived_at = null;
    if (req.body?.analyticsMeta && typeof req.body.analyticsMeta === "object") {
      const validation = validateCampaignAnalyticsMeta(req.body.analyticsMeta);
      if (!validation.valid) {
        sendError(res, 400, "INVALID_CAMPAIGN_CONTENT", validation.message);
        return;
      }
      updates.analytics_meta = validation.analyticsMeta;
    }
  
    if (Object.keys(updates).length === 0) {
      sendError(res, 400, "INVALID_BODY", "No valid fields to update");
      return;
    }
  
    try {
      const { data: current, error: currentError } = await supabase
        .from("campaigns")
        .select("id, client_id")
        .eq("id", id)
        .single();
  
      if (currentError || !current) {
        sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return;
      }
  
      const authorizedClientId = resolveAuthorizedClientId(req, res, current.client_id);
      if (!authorizedClientId) return;
  
      let { data, error } = await supabase
        .from("campaigns")
        .update(updates)
        .eq("id", id)
        .eq("client_id", authorizedClientId)
        .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, scheduled_for, starts_at, ends_at, chatbot_prompt_type, mode, last_triggered_at, archived_at, created_at, analytics_meta")
        .single();
  
      if (error && updates.analytics_meta && isMissingSchemaError(error)) {
        const fallbackUpdates = { ...updates };
        delete fallbackUpdates.analytics_meta;
        const fallback = await supabase
          .from("campaigns")
          .update(fallbackUpdates)
          .eq("id", id)
          .eq("client_id", authorizedClientId)
          .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, scheduled_for, last_triggered_at, archived_at, created_at")
          .single();
        data = fallback.data ? { ...fallback.data, analytics_meta: updates.analytics_meta } : fallback.data;
        error = fallback.error;
      }
  
      if (error) {
        sendError(res, 500, "CAMPAIGN_UPDATE_FAILED", "Failed to update campaign", error.message);
        return;
      }
  
      res.json({
        item: {
          ...data,
          analytics_meta: normalizeCampaignAnalyticsMeta(data.analytics_meta || updates.analytics_meta || {}),
          webhook_token: null,
        },
      });
    } catch (error) {
      console.error("campaign update error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  });
  
  // DELETE /api/campaigns/:id — exclui campanha
  app.delete("/api/campaigns/:id", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
  
    const id = normalizeString(req.params?.id);
    if (!id) { sendError(res, 400, "INVALID_PARAM", "Missing campaign id"); return; }
  
    try {
      const { data: campaign, error: fetchError } = await supabase
        .from("campaigns")
        .select("id, client_id")
        .eq("id", id)
        .single();
  
      if (fetchError || !campaign) {
        sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return;
      }
  
      const authorizedClientId = resolveAuthorizedClientId(req, res, campaign.client_id);
      if (!authorizedClientId) return;
  
      const { error } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", id)
        .eq("client_id", authorizedClientId);
  
      if (error) {
        sendError(res, 500, "CAMPAIGN_DELETE_FAILED", "Failed to delete campaign", error.message);
        return;
      }
  
      res.json({ success: true });
    } catch (error) {
      console.error("campaign delete error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  });
  
  function requireCampaignRunnerSecret(req, res, next) {
    const configuredSecret = normalizeString(process.env.CAMPAIGN_SCHEDULER_TOKEN);
  
    if (!configuredSecret) {
      sendError(
        res,
        500,
        "CAMPAIGN_SCHEDULER_TOKEN_MISSING",
        "Configure CAMPAIGN_SCHEDULER_TOKEN"
      );
      return;
    }
  
    const authorization = normalizeString(req.headers.authorization);
    const providedSecret =
      authorization.toLowerCase().startsWith("bearer ")
        ? authorization.slice(7).trim()
        : normalizeString(req.headers["x-campaign-runner-secret"] || req.query?.secret);
  
    if (providedSecret !== configuredSecret) {
      sendError(res, 401, "UNAUTHORIZED", "Invalid campaign runner secret");
      return;
    }
  
    next();
  }
  
  // POST /api/campaigns/run-due is used by cron/n8n to execute due scheduled campaigns.
  app.post("/api/campaigns/run-due", requireCampaignRunnerSecret, async (req, res) => {
    if (!ensureDb(res)) return;
  
    const rawLimit = Number.parseInt(String(req.body?.limit ?? req.query?.limit ?? ""), 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), CAMPAIGN_SCHEDULER_MAX_BATCH)
      : CAMPAIGN_SCHEDULER_MAX_BATCH;
  
    try {
      const result = await runDueCampaignDispatches({ limit, triggerSource: "external_runner" });
      res.json(result);
    } catch (error) {
      console.error("campaign run-due error:", error);
      sendError(
        res,
        500,
        "CAMPAIGN_RUN_DUE_FAILED",
        error instanceof Error ? error.message : "Failed to run due campaigns"
      );
    }
  });
  
  // POST /api/campaigns/:id/trigger — dispara campanha (chama webhook n8n)
  app.post("/api/campaigns/:id/trigger", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
  
    const id = normalizeString(req.params?.id);
    if (!id) { sendError(res, 400, "INVALID_PARAM", "Missing campaign id"); return; }
  
    try {
      let { data: campaign, error: fetchError } = await supabase
        .from("campaigns")
        .select("id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, archived_at, created_by_uid, created_by_email, analytics_meta")
        .eq("id", id)
        .single();
  
      if (fetchError && isMissingSchemaError(fetchError)) {
        const fallback = await supabase
          .from("campaigns")
          .select("id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, archived_at, created_by_uid, created_by_email")
          .eq("id", id)
          .single();
        campaign = fallback.data;
        fetchError = fallback.error;
      }
  
      if (fetchError || !campaign) {
        sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return;
      }
  
      const authorizedClientId = resolveAuthorizedClientId(req, res, campaign.client_id);
      if (!authorizedClientId) return;
  
      if (!canCampaignBeDispatched(campaign.status)) {
        sendError(res, 400, "CAMPAIGN_NOT_DISPATCHABLE", `Campaign cannot be dispatched from status ${campaign.status}`);
        return;
      }
      if (campaign.archived_at) {
        sendError(res, 400, "CAMPAIGN_ARCHIVED", "Campaign is archived");
        return;
      }
  
      const result = await executeCampaignDispatch({ ...campaign, client_id: authorizedClientId }, { triggerSource: "manual" });
      res.json(result);
    } catch (error) {
      console.error("campaign trigger error:", error);
      if (error?.name === "AbortError") {
        sendError(res, 504, "N8N_TIMEOUT", "n8n webhook timed out (20s)");
        return;
      }
      sendError(
        res,
        error?.statusCode || 500,
        error?.code || "INTERNAL_ERROR",
        error instanceof Error ? error.message : "Internal server error"
      );
    }
  });
  
  // ── Campaign Dispatches ──────────────────────────────────────────────────────

  async function ensureCampaignDispatchPausedStatusAllowed() {
    if (!pgDatabasePool) return;

    await pgDatabasePool.query(`
      ALTER TABLE public.campaign_dispatches
      DROP CONSTRAINT IF EXISTS campaign_dispatches_status_check
    `);
    await pgDatabasePool.query(`
      ALTER TABLE public.campaign_dispatches
      ADD CONSTRAINT campaign_dispatches_status_check
      CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'done', 'failed', 'cancelled'))
    `);
  }

  async function ensureCampaignDispatchEvolutionInstanceColumn() {
    if (!pgDatabasePool) return;

    await pgDatabasePool.query(`
      ALTER TABLE public.campaign_dispatches
      ADD COLUMN IF NOT EXISTS evolution_instance_id UUID
    `);
  }

  async function validateCampaignDispatchEvolutionInstance(clientId, instanceId, res) {
    if (!instanceId) return true;

    const instances = await getLeadClientEvolutionInstances(clientId);
    const instance = instances.find((item) => item.id === instanceId);
    if (!instance) {
      sendError(res, 400, "EVOLUTION_INSTANCE_NOT_FOUND", "Evolution instance not found for this tenant");
      return false;
    }
    if (instance.active === false) {
      sendError(res, 400, "EVOLUTION_INSTANCE_INACTIVE", "Evolution instance is inactive");
      return false;
    }

    return true;
  }

  // ── Anti-ban (Fatia 3a): cota diária por chip ───────────────────────────────
  const EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS = { cold: 100, warm: 500 };

  async function ensureEvolutionInstanceDailyUsageTable() {
    if (!pgDatabasePool) return false;
    if (_evolutionDailyUsageSchemaEnsured) return true;
    await pgDatabasePool.query(`
      CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_usage (
        instance_id UUID NOT NULL REFERENCES public.lead_client_evolution_instances(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        sent_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (instance_id, date)
      )
    `);
    _evolutionDailyUsageSchemaEnsured = true;
    return true;
  }

  function resolveEvolutionInstanceDailyLimit(instance) {
    const override = Number.parseInt(String(instance?.daily_limit_override ?? ""), 10);
    if (Number.isInteger(override) && override > 0) return override;
    const state = normalizeString(instance?.chip_state) === "warm" ? "warm" : "cold";
    return EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS[state];
  }

  async function reserveEvolutionInstanceDailyQuota(instanceId) {
    if (!instanceId || !(await ensureEvolutionInstanceDailyUsageTable())) return null;
    const { rows } = await pgDatabasePool.query(
      `
        INSERT INTO public.evolution_instance_daily_usage (instance_id, date, sent_count)
        VALUES ($1, CURRENT_DATE, 1)
        ON CONFLICT (instance_id, date)
        DO UPDATE SET sent_count = public.evolution_instance_daily_usage.sent_count + 1
        RETURNING sent_count
      `,
      [instanceId]
    );
    return rows[0]?.sent_count ?? null;
  }

  async function releaseEvolutionInstanceDailyQuota(instanceId) {
    if (!instanceId || !pgDatabasePool) return;
    await pgDatabasePool
      .query(
        `
          UPDATE public.evolution_instance_daily_usage
          SET sent_count = GREATEST(sent_count - 1, 0)
          WHERE instance_id = $1 AND date = CURRENT_DATE
        `,
        [instanceId]
      )
      .catch(() => {});
  }
  // ────────────────────────────────────────────────────────────────────────────

  async function runCampaignDispatch({ dispatch, campaign, supabase: db }) {
    const dispatchId = dispatch.id;
    const clientId = campaign.client_id;
    const dispatchSteps = Array.isArray(dispatch.steps) && dispatch.steps.length > 0 ? dispatch.steps : null;
    const campaignMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
    const dispatchEvolutionInstanceId = normalizeString(dispatch.evolution_instance_id);
    const dispatchCampaignMeta = dispatchEvolutionInstanceId
      ? {
          ...campaignMeta,
          dispatchOptions: {
            ...campaignMeta.dispatchOptions,
            evolutionInstanceId: dispatchEvolutionInstanceId,
          },
        }
      : campaignMeta;
    const steps = dispatchSteps ?? campaignMeta.sequence;
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

    // Obtém lista de leads da campanha via lead_import_items
    const leads = await buildDispatchLeads({
      clientId,
      importId: campaign.import_id || null,
      limit: campaign.limit_per_run,
      segmentation: validation.analyticsMeta.segmentation || null,
    });

    if (leads.length === 0) {
      await db.from("campaign_dispatches").update({ status: "done", finished_at: new Date().toISOString(), updated_at: new Date().toISOString(), error_message: "Nenhum lead encontrado para o disparo." }).eq("id", dispatchId);
      return;
    }

    // Constrói analyticsMeta compatível com dispatchCampaignSequence
    const analyticsMeta = validation.analyticsMeta;

    // Anti-ban: pool de chips para rotação round-robin com cota diária.
    const tenantInstances = await getLeadClientEvolutionInstances(clientId);
    const activeInstances = tenantInstances.filter(
      (inst) => inst.active !== false && normalizeString(inst.dispatch_webhook_url)
    );
    const rotationPool = dispatchEvolutionInstanceId
      ? activeInstances.filter((inst) => inst.id === dispatchEvolutionInstanceId)
      : activeInstances;

    let rotationCursor = 0;
    const chipProvider =
      rotationPool.length > 0
        ? async () => {
            for (let attempt = 0; attempt < rotationPool.length; attempt += 1) {
              const inst = rotationPool[(rotationCursor + attempt) % rotationPool.length];
              const limit = resolveEvolutionInstanceDailyLimit(inst);
              const reserved = await reserveEvolutionInstanceDailyQuota(inst.id);

              if (reserved === null) {
                rotationCursor = (rotationCursor + attempt + 1) % rotationPool.length;
                return {
                  webhookUrl: normalizeString(inst.dispatch_webhook_url),
                  webhookToken: normalizeString(inst.dispatch_webhook_token) || null,
                  instanceId: inst.id,
                  release: null,
                };
              }

              if (reserved > limit) {
                await releaseEvolutionInstanceDailyQuota(inst.id);
                continue;
              }

              rotationCursor = (rotationCursor + attempt + 1) % rotationPool.length;
              return {
                webhookUrl: normalizeString(inst.dispatch_webhook_url),
                webhookToken: normalizeString(inst.dispatch_webhook_token) || null,
                instanceId: inst.id,
                release: () => releaseEvolutionInstanceDailyQuota(inst.id),
              };
            }
            return null;
          }
        : null;

    let sentCount = 0;
    let lastPauseCheckAt = 0;

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

      return current?.status === "running";
    };

    const result = await dispatchCampaignSequence({
      webhookUrl,
      webhookToken,
      leads,
      analyticsMeta,
      context: {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          mode: "campaign_dispatch_template",
          dispatchId,
          dispatchName: dispatch.name,
        },
        client: { id: clientId, name: await getClientName(clientId) },
      },
      onLeadDispatched: async ({ lead, phone, sentAt }) => {
        sentCount += 1;
        await db.from("campaign_dispatch_runs").insert({
          dispatch_id: dispatchId,
          campaign_id: campaign.id,
          client_id: clientId,
          phone,
          status: "sent",
          sent_at: sentAt,
        }).catch(() => {});
        const leadPatch = {
          status_conversa: "campanha_enviada",
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
            .eq("telefone", phone);
        const { error: leadUpdateError } = await leadUpdate;
        if (leadUpdateError) {
          console.warn("[campaign-dispatch] followup queue marker failed:", leadUpdateError.message || leadUpdateError);
        }
        await db.from("campaign_dispatches").update({ sent_count: sentCount, updated_at: new Date().toISOString() }).eq("id", dispatchId).catch(() => {});
      },
      shouldContinue: isDispatchStillRunning,
      chipProvider,
      leadDelayProvider: () => 30_000 + Math.floor(Math.random() * 60_001),
    });

    // Registra falhas por lead
    const failures = result?.summary?.failures || [];
    for (const f of failures) {
      if (f.phone) {
        await db.from("campaign_dispatch_runs").insert({
          dispatch_id: dispatchId,
          campaign_id: campaign.id,
          client_id: clientId,
          phone: f.phone,
          status: "failed",
          error_message: f.reason || null,
        }).catch(() => {});
      }
    }

    const failedCount = result?.summary?.failureCount ?? (leads.length - sentCount);

    if (result?.summary?.allChipsExhausted) {
      await db.from("campaign_dispatches").update({
        status: "paused",
        sent_count: sentCount,
        failed_count: failedCount,
        error_message: "Cota diaria atingida em todos os chips ativos.",
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      return;
    }

    if (result?.summary?.paused) {
      await db.from("campaign_dispatches").update({
        status: "paused",
        sent_count: sentCount,
        failed_count: failedCount,
        error_message: "Disparo pausado manualmente.",
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      return;
    }

    await db.from("campaign_dispatches").update({
      status: "done",
      sent_count: sentCount,
      failed_count: failedCount,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", dispatchId);
  }

  // ── Campaign Dispatches CRUD ─────────────────────────────────────────────────

  // GET /api/campaigns/:id/dispatches — lista disparos de uma campanha
  app.get("/api/campaigns/:id/dispatches", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const campaignId = normalizeString(req.params.id);
    if (!campaignId) return sendError(res, 400, "MISSING_ID", "Missing campaign id");
    try {
      await ensureCampaignDispatchEvolutionInstanceColumn();
      const { data: campaign, error: campaignErr } = await supabase
        .from("campaigns")
        .select("id, client_id")
        .eq("id", campaignId)
        .single();
      if (campaignErr || !campaign) return sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
      const authorizedClientId = resolveAuthorizedClientId(req, res, campaign.client_id);
      if (!authorizedClientId) return;

      const { data, error } = await supabase
        .from("campaign_dispatches")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("client_id", authorizedClientId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      res.json({ dispatches: data || [] });
    } catch (err) {
      sendError(res, 500, "DISPATCHES_FETCH_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // POST /api/campaigns/:id/dispatches — cria disparo
  app.post("/api/campaigns/:id/dispatches", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const campaignId = normalizeString(req.params.id);
    if (!campaignId) return sendError(res, 400, "MISSING_ID", "Missing campaign id");

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const name = normalizeString(body.name) || "Disparo";
    const requestedSteps = Array.isArray(body.steps) ? body.steps : [];
    const triggerType = body.triggerType === "scheduled" ? "scheduled" : "manual";
    const scheduledAt = triggerType === "scheduled" ? (normalizeString(body.scheduledAt) || null) : null;
    const parsedEvolutionInstanceId = parseOptionalUuid(body.evolutionInstanceId);
    if (parsedEvolutionInstanceId.error) {
      return sendError(res, 400, "INVALID_EVOLUTION_INSTANCE_ID", parsedEvolutionInstanceId.error);
    }
    const requestedEvolutionInstanceId = parsedEvolutionInstanceId.value || null;

    try {
      await ensureCampaignDispatchEvolutionInstanceColumn();
      // Verifica que a campanha pertence ao cliente autorizado
      const { data: campaign, error: campaignErr } = await supabase
        .from("campaigns")
        .select("id, client_id, analytics_meta")
        .eq("id", campaignId)
        .single();
      if (campaignErr || !campaign) return sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

      const authorizedClientId = resolveAuthorizedClientId(req, res, campaign.client_id);
      if (!authorizedClientId) return;
      if (!(await validateCampaignDispatchEvolutionInstance(authorizedClientId, requestedEvolutionInstanceId, res))) return;

      const campaignMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
      const steps = requestedSteps.length > 0 ? requestedSteps : campaignMeta.sequence;
      const validation = validateCampaignAnalyticsMeta({
        ...campaignMeta,
        sequence: steps,
      });
      if (!validation.valid) {
        return sendError(res, 400, "INVALID_DISPATCH_TEMPLATE", validation.message);
      }

      const { data, error } = await supabase
        .from("campaign_dispatches")
        .insert({
          campaign_id: campaignId,
          client_id: authorizedClientId,
          name,
          steps: validation.analyticsMeta.sequence,
          trigger_type: triggerType,
          scheduled_at: scheduledAt,
          evolution_instance_id: requestedEvolutionInstanceId,
          status: triggerType === "scheduled" && scheduledAt ? "scheduled" : "draft",
        })
        .select("*")
        .single();
      if (error) throw error;
      res.status(201).json({ dispatch: data });
    } catch (err) {
      sendError(res, 500, "DISPATCH_CREATE_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // PATCH /api/campaigns/dispatches/:dispatchId — atualiza disparo
  app.patch("/api/campaigns/dispatches/:dispatchId", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const patch = {};
    if (body.name != null) patch.name = normalizeString(body.name) || "Disparo";
    if (body.triggerType != null) patch.trigger_type = body.triggerType === "scheduled" ? "scheduled" : "manual";
    if (body.scheduledAt != null) patch.scheduled_at = normalizeString(body.scheduledAt) || null;
    if (Object.prototype.hasOwnProperty.call(body, "evolutionInstanceId")) {
      const parsedEvInstanceId = parseOptionalUuid(body.evolutionInstanceId);
      if (parsedEvInstanceId.error) {
        return sendError(res, 400, "INVALID_EVOLUTION_INSTANCE_ID", parsedEvInstanceId.error);
      }
      patch.evolution_instance_id = parsedEvInstanceId.value || null;
    }
    if (body.status != null && ["draft","scheduled","paused","cancelled"].includes(body.status)) patch.status = body.status;
    patch.updated_at = new Date().toISOString();

    try {
      await ensureCampaignDispatchEvolutionInstanceColumn();
      const { data: existing, error: existingErr } = await supabase
        .from("campaign_dispatches")
        .select("id, campaign_id, client_id, status")
        .eq("id", dispatchId)
        .single();
      if (existingErr || !existing) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");
      const authorizedClientId = resolveAuthorizedClientId(req, res, existing.client_id);
      if (!authorizedClientId) return;
      if (
        Object.prototype.hasOwnProperty.call(patch, "evolution_instance_id") &&
        !(await validateCampaignDispatchEvolutionInstance(authorizedClientId, patch.evolution_instance_id, res))
      ) {
        return;
      }

      const isPauseRequest = existing.status === "running" && patch.status === "paused" && Object.keys(patch).length === 2;
      if (existing.status === "running" && !isPauseRequest) {
        return sendError(res, 409, "DISPATCH_RUNNING", "Cannot update a running dispatch");
      }
      if (patch.status === "paused") {
        await ensureCampaignDispatchPausedStatusAllowed();
      }

      if (Array.isArray(body.steps)) {
        const { data: campaign, error: campaignErr } = await supabase
          .from("campaigns")
          .select("id, analytics_meta")
          .eq("id", existing.campaign_id)
          .single();
        if (campaignErr || !campaign) return sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        const campaignMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
        const validation = validateCampaignAnalyticsMeta({
          ...campaignMeta,
          sequence: body.steps,
        });
        if (!validation.valid) {
          return sendError(res, 400, "INVALID_DISPATCH_TEMPLATE", validation.message);
        }
        patch.steps = validation.analyticsMeta.sequence;
      }

      const { data, error } = await supabase
        .from("campaign_dispatches")
        .update(patch)
        .eq("id", dispatchId)
        .eq("client_id", authorizedClientId)
        .select("*")
        .single();
      if (error) throw error;
      if (!data) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");
      res.json({ dispatch: data });
    } catch (err) {
      sendError(res, 500, "DISPATCH_UPDATE_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // DELETE /api/campaigns/dispatches/:dispatchId — remove disparo (só draft)
  app.delete("/api/campaigns/dispatches/:dispatchId", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");
    try {
      await ensureCampaignDispatchEvolutionInstanceColumn();
      const { data: existing } = await supabase.from("campaign_dispatches").select("status, client_id").eq("id", dispatchId).single();
      if (!existing) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");
      const authorizedClientId = resolveAuthorizedClientId(req, res, existing.client_id);
      if (!authorizedClientId) return;
      if (existing.status === "running") return sendError(res, 409, "DISPATCH_RUNNING", "Cannot delete a running dispatch");
      const { error } = await supabase.from("campaign_dispatches").delete().eq("id", dispatchId).eq("client_id", authorizedClientId);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      sendError(res, 500, "DISPATCH_DELETE_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // POST /api/campaigns/dispatches/:dispatchId/trigger — executa disparo manualmente
  app.post("/api/campaigns/dispatches/:dispatchId/trigger", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");
    try {
      await ensureCampaignDispatchEvolutionInstanceColumn();
      const { data: dispatch, error: fetchErr } = await supabase
        .from("campaign_dispatches")
        .select("*")
        .eq("id", dispatchId)
        .single();
      if (fetchErr || !dispatch) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");
      if (dispatch.status === "running") return sendError(res, 409, "DISPATCH_RUNNING", "Dispatch is already running");
      if (!["draft","scheduled","failed"].includes(dispatch.status)) {
        return sendError(res, 409, "DISPATCH_DONE", "Dispatch already completed");
      }

      const { data: campaign, error: campErr } = await supabase
        .from("campaigns")
        .select("id, name, client_id, import_id, limit_per_run, analytics_meta, webhook_url, webhook_token")
        .eq("id", dispatch.campaign_id)
        .single();
      if (campErr || !campaign) return sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

      const authorizedClientId = resolveAuthorizedClientId(req, res, campaign.client_id);
      if (!authorizedClientId) return;

      // Marca como running
      await supabase.from("campaign_dispatches").update({ status: "running", triggered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", dispatchId);

      res.json({ success: true, status: "running", dispatchId });

      // Executa o disparo em background (fire-and-forget da resposta HTTP)
      runCampaignDispatch({ dispatch, campaign, supabase }).catch((err) => {
        console.error("[campaign-dispatch] dispatch_run_failed", { dispatchId, error: err.message });
        supabase.from("campaign_dispatches").update({ status: "failed", error_message: err.message, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", dispatchId);
      });
    } catch (err) {
      sendError(res, 500, "DISPATCH_TRIGGER_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────

  app.post("/api/campaigns/reply-webhook", async (req, res) => {
    if (!ensureDb(res)) return;
  
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientId = normalizeTenantKey(body.clientId ?? body.client_id ?? body.client?.id);
    const phone = sanitizePhone(
      body.phone ??
      body.telefone ??
      body.number ??
      body.remoteJid ??
      body.data?.key?.remoteJid
    );
    const replyText = normalizeString(extractTextFromBody(body)) || null;
    const repliedAt =
      normalizeIsoDate(body.repliedAt ?? body.timestamp ?? body.created_at ?? body.data?.messageTimestamp) ||
      new Date().toISOString();
  
    if (!clientId) {
      sendError(res, 400, "INVALID_BODY", "Missing clientId");
      return;
    }
  
    if (!phone) {
      sendError(res, 400, "INVALID_BODY", "Missing valid phone");
      return;
    }
  
    try {
      if (!(await validateN8nInboundBearer(req, res, clientId))) {
        return;
      }
  
      const campaignReplyContext = await findCampaignReplyMatches({ clientId, phone });
      const activeWaitCampaign = campaignReplyContext.processingWaitForReplyMatches[0] || null;
  
      logCampaignReplyFlow("info", "webhook_received", {
        clientId,
        phone: maskPhoneForLog(phone),
        hasReplyText: Boolean(replyText),
        matchedCampaignCount: campaignReplyContext.matches.length,
        waitForReplyCampaignCount: campaignReplyContext.waitForReplyMatches.length,
        processingWaitForReplyCampaignCount: campaignReplyContext.processingWaitForReplyMatches.length,
      });
  
      if (activeWaitCampaign) {
        const progression = await continueCampaignLeadFromReply({
          clientId,
          phone,
          repliedAt,
          campaignMatch: activeWaitCampaign,
          replyPayload: {
            ...body,
            message: replyText,
          },
        });

        // Campaign wait-for-reply already advances the sequence via Evolution (continueCampaignLeadFromReply).
        // Do NOT forward the same inbound message to hardcoded-chat-webhook by default — that produced a
        // second concurrent agent reply (e.g. qualification bot) alongside campaign media at the same timestamp.
        // Opt back in: CAMPAIGN_REPLY_FORWARD_TO_CHATBOT=true (hybrid / ENABLE_CAMPAIGN_ROUTING experiments).
        const forwardCampaignReplyToChatbot = process.env.CAMPAIGN_REPLY_FORWARD_TO_CHATBOT === "true";
        if (replyText && forwardCampaignReplyToChatbot) {
          const campaignRoutingEnabled = process.env.ENABLE_CAMPAIGN_ROUTING === "true";
          if (campaignRoutingEnabled) {
            const tenantSettingsForRouting = await getLeadClientN8nSettings(clientId).catch(() => null);
            const baseModel = tenantSettingsForRouting?.chatbot_model;
            const itemId = activeWaitCampaign.leadImportItem?.id;
            const { isFirst } = await isFirstCampaignReply({ itemId, campaignId: activeWaitCampaign.id, supabase });
            const modelOverride = isFirst && baseModel ? `campanha_${baseModel}` : undefined;
            if (isFirst) {
              await supabase
                .from(leadsTableName(clientId))
                .update({ lead_origin: "campaign", source_campaign_id: activeWaitCampaign.id, source_campaign_name: activeWaitCampaign.name || null, lead_source: "campanha" })
                .eq("client_id", clientId)
                .eq("telefone", phone);
            }
            fetch("http://localhost:3001/api/hardcoded-chat-webhook", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ clientId, phone, message: replyText, ...(modelOverride ? { modelOverride } : {}) }),
            }).catch((err) => console.warn("[reply-webhook] chatbot_route_failed:", err.message));
          } else {
            fetch("http://localhost:3001/api/hardcoded-chat-webhook", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ clientId, phone, message: replyText }),
            }).catch((err) => console.warn("[reply-webhook] chatbot_route_failed:", err.message));
          }
        }

        // Tag campaign attribution on first reply even when chatbot forwarding is off (no duplicate agent).
        if (replyText && !forwardCampaignReplyToChatbot && process.env.ENABLE_CAMPAIGN_ROUTING === "true") {
          const itemId = activeWaitCampaign.leadImportItem?.id;
          const { isFirst } = await isFirstCampaignReply({ itemId, campaignId: activeWaitCampaign.id, supabase });
          if (isFirst) {
            await supabase
              .from(leadsTableName(clientId))
              .update({
                lead_origin: "campaign",
                source_campaign_id: activeWaitCampaign.id,
                source_campaign_name: activeWaitCampaign.name || null,
                lead_source: "campanha",
              })
              .eq("client_id", clientId)
              .eq("telefone", phone);
          }
        }

        if (replyText) {
          await appendLeadMessage({
            clientId,
            phone,
            senderType: "lead",
            direction: "inbound",
            messageText: replyText,
            campaignId: activeWaitCampaign.id,
            deliveredAt: repliedAt,
            meta: {
              source: "campaign-reply-webhook",
              campaignName: activeWaitCampaign.name || null,
              mode: "wait_for_reply",
            },
          });
        }

        res.json({
          success: true,
          clientId,
          phone,
          repliedAt,
          progression,
          campaignContext: {
            isCampaignLead: true,
            matchedCampaignCount: campaignReplyContext.matches.length,
            waitForReplyCampaignCount: campaignReplyContext.waitForReplyMatches.length,
            processingWaitForReplyCampaignCount: campaignReplyContext.processingWaitForReplyMatches.length,
            shouldReturnLeadToCampaignFlow: progression.continued === true || progression.finalized === true,
            signal: progression.campaignFinalized
              ? "campaign_completed"
              : progression.finalized
                ? "campaign_last_step_sent"
                : "campaign_step_sent_waiting_next_reply",
            importIds: campaignReplyContext.importIds,
            matchedCampaigns: campaignReplyContext.matches,
          },
        });
        return;
      }

      // Rotear para chatbot — inbound (nova sessão ou sessão ativa) — fire and forget
      if (replyText) {
        fetch("http://localhost:3001/api/hardcoded-chat-webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, phone, message: replyText }),
        }).catch((err) => console.warn("[reply-webhook] chatbot_route_failed:", err.message));
      }

      const importItemsUpdatePayload = {
        status_conversa: "em_atendimento",
        ultima_interacao_usuario: repliedAt,
      };
      const leadsUpdatePayload = {
        status_conversa: "em_atendimento",
      };
      const [importItemsResult, leadsResult] = await Promise.all([
        supabase
          .from("lead_import_items")
          .update(importItemsUpdatePayload)
          .eq("client_id", clientId)
          .eq("telefone", phone)
          .select("id"),
        supabase
          .from(leadsTableName(clientId))
          .update(leadsUpdatePayload)
          .eq("client_id", clientId)
          .eq("telefone", phone)
          .select("id"),
      ]);
  
      if (importItemsResult.error && !isMissingSchemaError(importItemsResult.error)) throw importItemsResult.error;
      if (leadsResult.error && !isMissingSchemaError(leadsResult.error)) throw leadsResult.error;
      if (importItemsResult.error && isMissingSchemaError(importItemsResult.error)) {
        logCampaignReplyFlow("warn", "conversation_columns_missing_import_reply_update_fallback", {
          clientId,
          phone: maskPhoneForLog(phone),
          error: importItemsResult.error.message || importItemsResult.error.code || "missing_schema",
        });
      }
      if (leadsResult.error && isMissingSchemaError(leadsResult.error)) {
        logCampaignReplyFlow("warn", "conversation_columns_missing_lead_reply_update_fallback", {
          clientId,
          phone: maskPhoneForLog(phone),
          error: leadsResult.error.message || leadsResult.error.code || "missing_schema",
        });
      }

      if (replyText) {
        await appendLeadMessage({
          clientId,
          phone,
          senderType: "lead",
          direction: "inbound",
          messageText: replyText,
          campaignId: activeWaitCampaign?.id || campaignReplyContext.matches[0]?.id || null,
          deliveredAt: repliedAt,
          meta: {
            source: "campaign-reply-webhook",
            matchedCampaignCount: campaignReplyContext.matches.length,
          },
        });
      }
  
      res.json({
        success: true,
        clientId,
        phone,
        repliedAt,
        updatedImportItems: importItemsResult.error ? 0 : importItemsResult.data?.length || 0,
        updatedLeads: leadsResult.error ? 0 : leadsResult.data?.length || 0,
        campaignContext: {
          isCampaignLead: campaignReplyContext.matches.length > 0,
          matchedCampaignCount: campaignReplyContext.matches.length,
          waitForReplyCampaignCount: campaignReplyContext.waitForReplyMatches.length,
          processingWaitForReplyCampaignCount: campaignReplyContext.processingWaitForReplyMatches.length,
          shouldReturnLeadToCampaignFlow: false,
          signal:
            campaignReplyContext.waitForReplyMatches.length > 0
              ? "lead_in_wait_for_reply_campaign"
              : campaignReplyContext.matches.length > 0
                ? "lead_in_campaign"
                  : "lead_not_in_campaign",
          importIds: campaignReplyContext.importIds,
          matchedCampaigns: campaignReplyContext.matches,
        },
      });
    } catch (error) {
      console.error("campaign reply webhook error:", error);
      sendError(res, 500, "CAMPAIGN_REPLY_WEBHOOK_FAILED", error instanceof Error ? error.message : "Failed to register reply");
    }
  });
  
  // GET /api/leads-for-dispatch — n8n busca leads pendentes (autenticado por Bearer token)
  app.get("/api/leads-for-dispatch", async (req, res) => {
    if (!ensureDb(res)) return;
  
    const clientId = normalizeTenantKey(req.query?.clientId ?? req.query?.client_id);
    const importId = normalizeString(req.query?.importId) || null;
    const rawLimit = Number.parseInt(String(req.query?.limit ?? "50"), 10);
    const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 200);
  
    if (!clientId) {
      sendError(res, 400, "INVALID_QUERY", "Missing clientId");
      return;
    }
  
    try {
      if (!(await validateN8nInboundBearer(req, res, clientId))) {
        return;
      }
  
      let query = supabase
        .from(leadsTableName(clientId))
        .select("id, telefone, nome, cidade, estado, status, tipo_cliente, faixa_consumo, qualificacao, created_at")
        .eq("client_id", clientId)
        .not("telefone", "is", null)
        .neq("status", "dispatched")
        .order("created_at", { ascending: true })
        .limit(limit);
  
      if (importId) {
        const { data: importItems } = await supabase
          .from("lead_import_items")
          .select("telefone")
          .eq("import_id", importId)
          .eq("client_id", clientId)
          .eq("imported", true);
  
        const phones = (importItems || []).map((i) => i.telefone).filter(Boolean);
        if (phones.length === 0) {
          return res.json({ success: true, total: 0, leads: [] });
        }
        query = query.in("telefone", phones);
      }
  
      const { data, error } = await query;
  
      if (error) {
        sendError(res, 500, "LEADS_FETCH_FAILED", "Failed to fetch leads", error.message);
        return;
      }
  
      const leads = (data || []).map((lead) => ({
        id: lead.id,
        telefone: lead.telefone,
        nome: lead.nome,
        cidade: lead.cidade,
        estado: lead.estado,
        status: lead.status,
        tipo_cliente: lead.tipo_cliente,
        faixa_consumo: lead.faixa_consumo,
        qualificacao: lead.qualificacao,
        created_at: lead.created_at,
      }));
  
      res.json({ success: true, total: leads.length, leads });
    } catch (error) {
      console.error("leads-for-dispatch error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
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

  // ── Campaign Prompts ──────────────────────────────────────────────────────
  // GET /api/campaign-prompts — lista prompts de campanha do cliente
  app.get("/api/campaign-prompts", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = resolveAuthorizedClientId(req, res, normalizeString(req.query?.clientId));
    if (!clientId) return;
    try {
      const { data, error } = await supabase
        .from("campaign_prompts")
        .select("id, client_id, name, content, updated_at, updated_by_email")
        .eq("client_id", clientId)
        .order("name", { ascending: true });
      if (error) throw error;
      res.json({ prompts: data || [] });
    } catch (err) {
      sendError(res, 500, "CAMPAIGN_PROMPTS_FETCH_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // PUT /api/campaign-prompts — cria ou atualiza prompt de campanha por nome
  app.put("/api/campaign-prompts", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientId = resolveAuthorizedClientId(req, res, normalizeTenantKey(body.clientId ?? body.client_id));
    if (!clientId) return;
    const name = normalizeString(body.name);
    const content = typeof body.content === "string" ? body.content : "";
    if (!name) return sendError(res, 400, "INVALID_BODY", "name is required");
    try {
      const { data, error } = await supabase
        .from("campaign_prompts")
        .upsert({ client_id: clientId, name, content, updated_at: new Date().toISOString(), updated_by_email: req.authAccess?.email ?? null }, { onConflict: "client_id,name" })
        .select("id, client_id, name, content, updated_at, updated_by_email")
        .single();
      if (error) throw error;
      res.json({ prompt: data });
    } catch (err) {
      sendError(res, 500, "CAMPAIGN_PROMPT_SAVE_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // DELETE /api/campaign-prompts/:id — remove prompt de campanha
  app.delete("/api/campaign-prompts/:id", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const id = normalizeString(req.params.id);
    if (!id) return sendError(res, 400, "MISSING_ID", "Missing prompt id");
    try {
      const { error } = await supabase.from("campaign_prompts").delete().eq("id", id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      sendError(res, 500, "CAMPAIGN_PROMPT_DELETE_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // POST /api/leads/hydrate — consolida lead_import_items → leads_{clientId}
  // Garante que TODO lead que recebeu mensagem de campanha exista na tabela de leads do CRM,
  // mesmo que nunca tenha respondido. Idempotente — pode rodar múltiplas vezes sem duplicar.
  app.post("/api/leads/hydrate", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientId = normalizeTenantKey(body.clientId ?? req.query?.clientId);
    if (!clientId) return sendError(res, 400, "INVALID_BODY", "Missing clientId");

    try {
      const leadsTable = leadsTableName(clientId);

      // 1. Busca todos os itens de campanha que receberam mensagem do bot
      const { data: items, error: itemsErr } = await supabase
        .from("lead_import_items")
        .select("id, import_id, telefone, nome, normalized_data, ultima_interacao_bot, ultima_interacao_usuario, created_at")
        .eq("client_id", clientId)
        .not("ultima_interacao_bot", "is", null)
        .not("telefone", "is", null);

      if (itemsErr) throw itemsErr;
      if (!items || items.length === 0) return res.json({ success: true, created: 0, updated: 0, skipped: 0 });

      // 2. Busca campanhas para mapear import_id → campanha
      const importIds = [...new Set(items.map((i) => i.import_id).filter(Boolean))];
      let campaignByImport = {};
      if (importIds.length > 0) {
        const { data: campaigns } = await supabase
          .from("campaigns")
          .select("id, name, import_id")
          .in("import_id", importIds)
          .eq("client_id", clientId);
        for (const c of campaigns || []) {
          if (c.import_id) campaignByImport[c.import_id] = c;
        }
      }

      // 3. Busca leads existentes (por telefone) para evitar duplicatas
      const phones = [...new Set(items.map((i) => i.telefone).filter(Boolean))];
      const { data: existingLeads } = await supabase
        .from(leadsTable)
        .select("id, telefone, lead_source, source_campaign_id")
        .eq("client_id", clientId)
        .in("telefone", phones);

      const existingByPhone = {};
      for (const l of existingLeads || []) existingByPhone[l.telefone] = l;

      let created = 0, updated = 0, skipped = 0;

      for (const item of items) {
        const phone = item.telefone;
        const campaign = campaignByImport[item.import_id] || null;
        const normalized = item.normalized_data || {};
        const nome = normalizeString(item.nome || normalized.nome || normalized.name) || null;
        const existing = existingByPhone[phone];

        if (!existing) {
          // Cria placeholder — lead que recebeu campanha mas ainda não respondeu
          const { error: insErr } = await supabase.from(leadsTable).insert({
            client_id: clientId,
            telefone: phone,
            nome,
            status_conversa: item.ultima_interacao_usuario ? "em_atendimento" : "aguardando_usuario",
            lead_origin: "campaign",
            source_campaign_id: campaign?.id || null,
            source_campaign_name: campaign?.name || null,
            lead_source: "campanha",
            finalizado: false,
            dados: {},
            created_at: item.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          if (!insErr) created++;
          else if (insErr.code !== "23505") console.warn("[hydrate] insert failed:", phone, insErr.message);
          else skipped++; // conflict — já existe
        } else if (!existing.lead_source && campaign) {
          // Atualiza origem se ainda não estava preenchida
          await supabase
            .from(leadsTable)
            .update({ lead_source: "campanha", source_campaign_id: existing.source_campaign_id || campaign.id, source_campaign_name: campaign.name })
            .eq("client_id", clientId)
            .eq("telefone", phone);
          updated++;
        } else {
          skipped++;
        }
      }

      console.log("[hydrate] done", { clientId, created, updated, skipped, total: items.length });
      return res.json({ success: true, created, updated, skipped, total: items.length });
    } catch (err) {
      sendError(res, 500, "HYDRATE_FAILED", err instanceof Error ? err.message : "Failed to hydrate leads");
    }
  });

  // ── Followup Queue (novo módulo) ─────────────────────────────────────────────

  // GET /api/followup-queue — lê followup_schedules + joins + status derivado
  app.get("/api/followup-queue", requireFirebaseAuth, async (req, res) => {
    const companyId = normalizeString(req.query?.companyId) || null;
    const campaignId = normalizeString(req.query?.campaignId) || null;
    const status = normalizeString(req.query?.status) || null;
    const dateFrom = normalizeString(req.query?.dateFrom) || null;
    const dateTo = normalizeString(req.query?.dateTo) || null;
    const rawPage = Number.parseInt(String(req.query?.page ?? "1"), 10);
    const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const rawLimit = Number.parseInt(String(req.query?.limit ?? "50"), 10);
    const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 200);

    const validStatuses = ["active", "awaiting_reply", "replied", "failed", "cancelled", "converted"];
    if (status && !validStatuses.includes(status)) {
      return sendError(res, 400, "INVALID_QUERY", `status must be one of: ${validStatuses.join(", ")}`);
    }

    try {
      const params = [];
      const filters = [];
      let idx = 1;
      if (companyId) { params.push(companyId); filters.push(`fco.id = $${idx++}`); }
      if (campaignId) { params.push(campaignId); filters.push(`fc.id = $${idx++}`); }
      if (dateFrom)   { params.push(dateFrom);   filters.push(`fs.created_at >= $${idx++}`); }
      if (dateTo)     { params.push(dateTo);     filters.push(`fs.created_at <= $${idx++}`); }
      const baseWhere = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

      let statusWhere = "";
      if (status) { params.push(status); statusWhere = `WHERE derived_status = $${idx++}`; }

      params.push(limit, (page - 1) * limit);
      const limitIdx = idx++, offsetIdx = idx++;

      const sql = `
        WITH base AS (
          SELECT
            fs.id,
            fs.lead_name,
            fs.phone,
            fs.origin,
            fs.meeting_datetime,
            fs.created_at,
            fs.campaign_id,
            fc.name       AS campaign_name,
            fc.company_id,
            fco.name      AS company_name,
            COUNT(fj.id) FILTER (WHERE fj.status = 'sent')    AS jobs_sent,
            COUNT(fj.id) FILTER (WHERE fj.status = 'failed')  AS jobs_failed,
            COUNT(fj.id) FILTER (WHERE fj.status = 'pending') AS jobs_pending,
            MAX(fj.sent_at)                                    AS last_sent_at,
            CASE
              WHEN fs.status = 'cancelled' THEN 'cancelled'
              WHEN fs.status = 'converted' THEN 'converted'
              WHEN EXISTS (
                SELECT 1 FROM followup_replies r
                WHERE r.company_id = fc.company_id AND r.phone = fs.phone
              ) THEN 'replied'
              WHEN COUNT(fj.id) FILTER (WHERE fj.status = 'failed') > 0
               AND COUNT(fj.id) FILTER (WHERE fj.status = 'pending') = 0 THEN 'failed'
              WHEN COUNT(fj.id) FILTER (WHERE fj.status = 'sent') > 0
               AND COUNT(fj.id) FILTER (WHERE fj.status = 'pending') = 0 THEN 'awaiting_reply'
              ELSE 'active'
            END AS derived_status
          FROM followup_schedules fs
          JOIN followup_campaigns fc  ON fc.id  = fs.campaign_id
          JOIN followup_companies fco ON fco.id = fc.company_id
          LEFT JOIN followup_jobs fj  ON fj.schedule_id = fs.id
          ${baseWhere}
          GROUP BY fs.id, fc.id, fco.id, fc.name, fco.name
        )
        SELECT *, COUNT(*) OVER() AS total_count
        FROM base
        ${statusWhere}
        ORDER BY created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;

      const { rows } = await fupQuery(sql, params);
      let total = rows.length > 0 ? Number(rows[0].total_count) : 0;

      const items = rows.map((r) => ({
        id:              r.id,
        leadName:        r.lead_name,
        phone:           r.phone,
        origin:          r.origin,
        companyId:       r.company_id,
        companyName:     r.company_name,
        campaignId:      r.campaign_id,
        campaignName:    r.campaign_name,
        status:          r.derived_status,
        jobsSent:        Number(r.jobs_sent),
        jobsFailed:      Number(r.jobs_failed),
        jobsPending:     Number(r.jobs_pending),
        lastSentAt:      r.last_sent_at || null,
        meetingDatetime: r.meeting_datetime || null,
        createdAt:       r.created_at,
      }));

      if (!companyId) {
        const { data: crmRows, error: crmRowsError } = await supabase
          .from("lead_import_items")
          .select("id, import_id, client_id, telefone, nome, normalized_data, ultima_interacao_bot, created_at")
          .not("ultima_interacao_bot", "is", null)
          .is("ultima_interacao_usuario", null)
          .or("followup_status.is.null,followup_status.eq.pending")
          .order("ultima_interacao_bot", { ascending: false })
          .limit(limit);

        if (crmRowsError) {
          console.warn("[followup-queue] crm campaign dispatch lookup failed:", crmRowsError.message || crmRowsError);
        } else if (crmRows?.length) {
          const clientIds = [...new Set(crmRows.map((row) => row.client_id).filter(Boolean))];
          const importIds = [...new Set(crmRows.map((row) => row.import_id).filter(Boolean))];

          const [{ data: crmClients }, { data: crmCampaigns }] = await Promise.all([
            clientIds.length
              ? supabase.from("leads_clients").select("id, name").in("id", clientIds)
              : Promise.resolve({ data: [] }),
            importIds.length
              ? supabase.from("campaigns").select("id, name, import_id, client_id").in("import_id", importIds)
              : Promise.resolve({ data: [] }),
          ]);

          const clientNameById = {};
          for (const client of crmClients || []) {
            if (client?.id) clientNameById[client.id] = client.name || client.id;
          }

          const campaignByImport = {};
          for (const campaign of crmCampaigns || []) {
            if (campaign?.import_id && campaign?.client_id) {
              campaignByImport[`${campaign.client_id}:${campaign.import_id}`] = campaign;
            }
          }

          const existingPhones = new Set(items.map((item) => `${item.companyId}:${item.phone}`));
          for (const row of crmRows) {
            const phone = normalizeString(row.telefone);
            const client = normalizeString(row.client_id);
            if (!phone || !client || existingPhones.has(`${client}:${phone}`)) continue;

            const campaign = campaignByImport[`${client}:${row.import_id}`] || null;
            const normalized = row.normalized_data && typeof row.normalized_data === "object" ? row.normalized_data : {};

            items.push({
              id: `crm_campaign_dispatch_${row.id}`,
              leadName: normalizeString(row.nome || normalized.nome || normalized.name) || null,
              phone,
              origin: "crm_campaign",
              companyId: client,
              companyName: clientNameById[client] || client,
              campaignId: campaign?.id || null,
              campaignName: campaign?.name || "Campanha CRM",
              status: "awaiting_reply",
              jobsSent: 1,
              jobsFailed: 0,
              jobsPending: 0,
              lastSentAt: row.ultima_interacao_bot || null,
              meetingDatetime: null,
              createdAt: row.created_at,
            });
            existingPhones.add(`${client}:${phone}`);
          }

          total += crmRows.length;
        }
      }

      return res.json({ success: true, items, total });
    } catch (err) {
      sendError(res, 500, "FOLLOWUP_QUEUE_FETCH_FAILED", err instanceof Error ? err.message : "Failed to fetch followup queue");
    }
  });

  // PATCH /api/followup-queue/:scheduleId/reschedule — cria novo job BullMQ com delay
  app.patch("/api/followup-queue/:scheduleId/reschedule", requireFirebaseAuth, async (req, res) => {
    const scheduleId = normalizeString(req.params?.scheduleId);
    if (!scheduleId) return sendError(res, 400, "INVALID_PARAM", "Missing scheduleId");

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const delayMinutes = Number(body.delayMinutes);
    const templateId = normalizeString(body.templateId) || null;

    if (!Number.isFinite(delayMinutes) || delayMinutes < 0) {
      return sendError(res, 400, "INVALID_BODY", "delayMinutes must be a non-negative number");
    }

    try {
      const { rows: schedRows } = await fupQuery(
        `SELECT fs.id, fs.campaign_id FROM followup_schedules fs WHERE fs.id = $1`,
        [scheduleId]
      );
      if (!schedRows.length) return sendError(res, 404, "NOT_FOUND", "Schedule not found");

      const { campaign_id } = schedRows[0];

      let resolvedTemplateId = templateId;
      if (!resolvedTemplateId) {
        const { rows: tplRows } = await fupQuery(
          `SELECT id FROM followup_templates WHERE campaign_id = $1 AND is_active = true ORDER BY order_index ASC LIMIT 1`,
          [campaign_id]
        );
        if (!tplRows.length) return sendError(res, 400, "NO_TEMPLATE", "No active template found for this campaign");
        resolvedTemplateId = tplRows[0].id;
      }

      const { rows: jobRows } = await fupQuery(
        `INSERT INTO followup_jobs (schedule_id, template_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
        [scheduleId, resolvedTemplateId]
      );
      const newJobId = jobRows[0].id;

      await getFollowupQueue().add(
        "send-followup",
        { jobId: newJobId },
        { delay: delayMinutes * 60 * 1000, jobId: `fup-reschedule-${newJobId}` }
      );

      return res.json({ success: true, jobId: newJobId, delayMinutes });
    } catch (err) {
      sendError(res, 500, "RESCHEDULE_FAILED", err instanceof Error ? err.message : "Failed to reschedule");
    }
  });

  // PATCH /api/followup-queue/:scheduleId/discard — cancela schedule e jobs pendentes
  app.patch("/api/followup-queue/:scheduleId/discard", requireFirebaseAuth, async (req, res) => {
    const scheduleId = normalizeString(req.params?.scheduleId);
    if (!scheduleId) return sendError(res, 400, "INVALID_PARAM", "Missing scheduleId");

    try {
      const { rows } = await fupQuery(
        `UPDATE followup_schedules SET status = 'cancelled' WHERE id = $1 RETURNING id`,
        [scheduleId]
      );
      if (!rows.length) return sendError(res, 404, "NOT_FOUND", "Schedule not found");

      await fupQuery(
        `UPDATE followup_jobs SET status = 'cancelled' WHERE schedule_id = $1 AND status = 'pending'`,
        [scheduleId]
      );

      return res.json({ success: true, id: scheduleId });
    } catch (err) {
      sendError(res, 500, "DISCARD_FAILED", err instanceof Error ? err.message : "Failed to discard schedule");
    }
  });

  // POST /api/followup-queue/:scheduleId/convert — converte para inbound e dispara webhook
  app.post("/api/followup-queue/:scheduleId/convert", requireFirebaseAuth, async (req, res) => {
    const scheduleId = normalizeString(req.params?.scheduleId);
    if (!scheduleId) return sendError(res, 400, "INVALID_PARAM", "Missing scheduleId");

    try {
      const { rows } = await fupQuery(
        `UPDATE followup_schedules SET status = 'converted' WHERE id = $1 RETURNING id`,
        [scheduleId]
      );
      if (!rows.length) return sendError(res, 404, "NOT_FOUND", "Schedule not found");

      const { rows: infoRows } = await fupQuery(
        `SELECT fs.lead_name, fs.phone, fs.origin,
                fc.name AS campaign_name,
                fco.name AS company_name, fco.webhook_url
           FROM followup_schedules fs
           JOIN followup_campaigns fc  ON fc.id  = fs.campaign_id
           JOIN followup_companies fco ON fco.id = fc.company_id
          WHERE fs.id = $1`,
        [scheduleId]
      );

      if (infoRows.length && infoRows[0].webhook_url) {
        const info = infoRows[0];
        fetch(info.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lead_name:     info.lead_name,
            phone:         info.phone,
            origin:        info.origin,
            campaign_name: info.campaign_name,
            company_name:  info.company_name,
          }),
        }).catch((e) => console.error("[followup-queue/convert] webhook error:", e.message));
      }

      return res.json({ success: true, id: scheduleId });
    } catch (err) {
      sendError(res, 500, "CONVERT_FAILED", err instanceof Error ? err.message : "Failed to convert schedule");
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

  // ─── Módulo de Follow-up (BullMQ + campanhas independentes) ───────────────
  registerFollowupRoutes(app, requireFirebaseAuth);

  // ─── Módulo de Onboarding (criação transacional de empresa + campanha + templates) ───
  registerOnboardingRoutes(app, requireFirebaseAuth);
}
