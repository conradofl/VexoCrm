import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { gunzipSync } from "zlib";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { runMigrations } from "./migrate.js";
import { parseLeadQualificacaoBoolean } from "./leadQualificacaoBoolean.js";
import {
  normalizeString,
  normalizeLooseText,
  getNormalizedField,
  parseMoneyLikeValue,
} from "./textNormalize.js";
import {
  sendError,
  shouldExposeInternalErrorDetails,
  internalErrorPayloadDetails,
  ensureDb,
  getRequestBearerToken,
  isDuplicateKeyError,
  normalizeBool,
  normalizeIsoDate,
  isValidBase64,
  getN8nWebhookBearerSecret,
  requireN8nWebhookSecret,
  getHealthPostgresPingBudgetMs,
  postgresHealthPing,
} from "./services/httpInfra.js";
import {
  initDatabase,
  shutdownPgPool,
  getDatabaseHostForLogging,
  isLikelyIpv4Host,
  databaseUrl,
  dataSource,
  dbDriverEnv,
  supabaseUrl,
  supabaseServiceRoleKey,
  useDirectPostgres,
  pgDatabasePool,
  supabase,
} from "./services/database.js";
import { initFirebase, getAuth, firebaseConfig, firebaseReady } from "./services/firebase.js";
import {
  canAccessAppView,
  hasAccessPermission,
  hasClientViewAccess,
  hasInternalPageAccess,
} from "./accessGuards.js";
import {
  buildCommercialIntelligencePayload,
  getCommercialIntelligenceDefaultSettings,
} from "./commercial-intelligence.js";
import {
  dispatchCampaignSequence,
  getCampaignStepPlan,
  normalizeCampaignAnalyticsMeta,
  validateCampaignAnalyticsMeta,
} from "./campaign-outbound.js";
import {
  generateCampaignCopySuggestion,
  getGroqCampaignAiStatus,
  rewriteCampaignStep,
  suggestCampaignDelays,
  suggestCampaignSequence,
} from "./campaign-ai.js";
import { resolveRequiredAuthorizedClientId } from "./tenantScope.js";
import {
  canAssignManagedAccess,
  canManageTargetAccess,
  filterVisibleUserRecords,
  hasUserPermission,
} from "./userAccessScope.js";
import { whatsappSessionManager } from "./whatsapp.js";
import { initializeRedisChat, getChatMemory, setSupabaseClient } from "./hardcoded-chatbot.js";
import {
  bufferMessage,
  resolveMessageContent,
  processBatch,
  getChatbotModel,
} from "./chatbot-ai-engine.js";

import { routeDeps } from "./http/routeDeps.js";
import { registerAllDomainRoutes } from "./domains/registerAllDomainRoutes.js";
import { registerEventosRoutes } from "./domains/eventos/routes.js";
import { registerWebhooksRoutes } from "./webhooks/routes.js";
import { startFollowupWorker } from "./followup/worker.js";
import { startAutomationEngine } from "./followup/automationEngine.js";
import {
  getSegmentationCatalog,
  normalizeSegmentationCatalog,
  isFilterShape,
  normalizeFilters,
  leadMatchesSegmentation,
  buildDefaultSegmentationConfig,
  sanitizeSegmentationConfig,
} from "./segmentation.js";
import {
  normalizeTenantKey,
  leadsTableName,
  normalizeHttpUrl,
  getRequestId,
  maskPhoneForLog,
  getClientEnvSuffix,
  parseJsonEnvMap,
} from "./services/tenant.js";
import {
  getZonedDateParts,
  getDateKey,
  getDateLabel,
  humanizeStatus,
  isQualifiedStatus,
  detectTemperature,
  parseLeadReferenceDate,
  buildDashboardPayload,
  leadMatchesCampaignSegmentation,
  isMissingSchemaError,
  optionalQuery,
  queryWithSchemaFallback,
  safePercent,
  average,
  hoursBetween,
  normalizeMetricValue,
  buildMetricDefinition,
  normalizeWonStatus,
  getLeadReferenceDate,
  buildRevenueOpsPayload,
  buildRevenueOpsFallbackPayload,
  parseCommercialIntelligenceFilters,
} from "./services/analytics.js";
import {
  sanitizePhoneLeadWebhookStyle,
  getLeadWebhookBearerSecret,
  sendLeadWebhookEdgeStyle,
  validateLeadWebhookBearer,
  LEADS_OUTLIER_STATUS_CONVERSA,
  LEADS_OUTLIER_TEMPERATURE,
  LEADS_OUTLIER_SPIN_FASE,
  LEADS_OUTLIER_DADOS_KEYS,
  MAX_LEADS_OUTLIER_BATCH,
  sanitizeLeadsOutlierDados,
  sanitizeLeadsOutlierBehaviorMeta,
  parseOptionalFiniteNumber,
  parseOptionalUuid,
  validateLeadsOutlierRecord,
  sanitizePhone,
  buildPhoneLookupVariants,
  normalizePhoneToWhatsAppChatId,
  normalizeWhatsAppChatId,
  getAuthorizedClientWhatsAppChatIds,
  getAuthorizedWhatsAppChatIdsForRequest,
  ensureAuthorizedWhatsAppChat,
  ensureAuthorizedWhatsAppPhone,
  parseCsvLine,
  parseCsvToRows,
  normalizeHeaderKey,
  pickRowValue,
  normalizeImportedLead,
  isImportedLeadEmpty,
  buildImportPreview,
  MAX_CONVERSATION_BYTES,
  validateConversationMemoryPayload,
} from "./services/leadImport.js";
import {
  MANAGED_CLAIM_KEYS,
  CLIENT_VIEW_KEYS,
  DEFAULT_CLIENT_VIEWS,
  INTERNAL_PAGE_KEYS,
  ACCESS_SCOPE_KEYS,
  APPROVAL_LEVEL_KEYS,
  ACCESS_PERMISSION_KEYS,
  ACCESS_PRESET_KEYS,
  ACCESS_PRESET_LABELS,
  FIXED_ADMIN_UIDS,
  FIXED_ADMIN_EMAILS,
  ACCESS_PRESET_DEFAULTS,
  SYSTEM_ACCESS_PROFILES,
  isFixedAdminIdentity,
  getPresetFallbackKey,
  normalizeRole,
  isValidManagedRoleInput,
  isValidManagedPresetInput,
  isValidManagedScopeInput,
  isValidManagedApprovalLevelInput,
  getDefaultPresetForRole,
  normalizeAccessPreset,
  getAccessPresetLabel,
  buildPresetDefaults,
  normalizeStringArray,
  normalizeScopeMode,
  normalizeApprovalLevel,
  normalizePermissions,
  normalizeAllowedViews,
  normalizeInternalPages,
  hasManagedAccessClaims,
  extractManagedAccessClaims,
  buildAccessProfile,
  mergeManagedClaims,
  buildManagedClaims,
  listAllFirebaseUsers,
  mapAdminUserRecord,
  ensureFirebaseUserAccessClaims,
  humanizeAccessProfileKey,
  normalizeAccessProfileRecord,
  buildSystemAccessProfiles,
  isMissingAccessProfilesTable,
  listAccessProfiles,
  findAccessProfileByKey,
  resolveRequestedAccessProfile,
  serializeAccessProfileRecord,
  syncUsersWithAccessProfile,
} from "./access/claims.js";
import {
  requireFirebaseAuth,
  requireInternalAccess,
  requireAdminAccess,
  requireUserManagementAccess,
  requireInternalPageAccess,
  requireAnyInternalPageAccess,
  requireAppViewAccess,
} from "./access/middlewares.js";
import {
  canManageGlobalNotifications,
  normalizeNotificationScopeValues,
  matchesNotificationClientScope,
  matchesNotificationInternalScope,
  isNotificationVisibleToAccess,
  filterNotificationsForAccess,
  getVisibleNotificationIds,
  ensureSharedRoutePageAccess,
} from "./access/notifications.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const app = express();
app.use(express.json({ limit: "15mb" }));
const isProduction = process.env.NODE_ENV === "production";
// MAX_CONVERSATION_BYTES: movido para ./services/httpInfra.js (Onda 3, Run C).
const DEFAULT_CAMPAIGN_RUNNER_INTERVAL_MS = 60 * 1000;
const CAMPAIGN_SCHEDULER_MAX_BATCH = 25;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

/** Trim and strip trailing slashes so env typos still match the browser Origin header. */
function normalizeCorsOrigin(value) {
  if (value == null || typeof value !== "string") return "";
  const t = value.trim();
  if (!t) return "";
  return t.replace(/\/+$/u, "");
}

const rawCorsOrigins = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const hasWildcard = rawCorsOrigins.includes("*");
// Non-production: allow any browser origin (Vite port is 8080 in frontend/vite.config.ts; list in CORS_ORIGINS still applies in production).
const allowAnyCorsOrigin = !isProduction;

// In production, strip wildcard so only explicit origins are accepted.
let corsOrigins = isProduction ? rawCorsOrigins.filter((o) => o !== "*") : [...rawCorsOrigins];

// Single-origin helper for EasyPanel: set FRONTEND_ORIGIN=https://your-app.vercel.app (merged into allowed list).
const frontendOriginExtra = (process.env.FRONTEND_ORIGIN || "").trim();
if (frontendOriginExtra && !corsOrigins.includes(frontendOriginExtra)) {
  corsOrigins.push(frontendOriginExtra);
}

corsOrigins = [...new Set(corsOrigins.map(normalizeCorsOrigin).filter(Boolean))];

// If production ends up with zero origins (e.g. only "*" was set, or env not injected), every browser call would fail CORS.
// Allow any Origin in that case so the API stays usable; log loudly so operators fix CORS_ORIGINS / FRONTEND_ORIGIN.
const corsAllowAnyOriginBecauseListEmpty = isProduction && corsOrigins.length === 0;

if (isProduction && hasWildcard) {
  console.warn(
    "[security] CORS_ORIGINS contains '*' in production. Wildcard will be ignored; only explicit origins are allowed."
  );
}

if (corsAllowAnyOriginBecauseListEmpty) {
  console.error(
    "[cors] Production with no explicit browser origins after parsing CORS_ORIGINS / FRONTEND_ORIGIN. " +
      "Allowing any Origin until you set real SPA URLs (insecure — fix EasyPanel env)."
  );
}

if (isProduction && corsOrigins.length > 0) {
  console.info("[cors] Allowed browser origins:", corsOrigins.join(", "));
}

// sendError: movido para ./services/httpInfra.js (Onda 3, Run A).

/** When true, INTERNAL_ERROR responses include a short `details` payload (for staging / temporary prod debugging). */
// shouldExposeInternalErrorDetails: movido para ./services/httpInfra.js (Onda 3, Run A).

/** Safe diagnostic object for 500 handlers (no stack traces unless non-production). */
// internalErrorPayloadDetails: movido para ./services/httpInfra.js (Onda 3, Run A).

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowAnyCorsOrigin) {
        callback(null, true);
        return;
      }
      if (corsAllowAnyOriginBecauseListEmpty) {
        callback(null, true);
        return;
      }
      const normalized = normalizeCorsOrigin(origin);
      if (corsOrigins.includes(normalized)) {
        callback(null, true);
        return;
      }
      console.warn(
        "[cors] Blocked browser Origin:",
        origin,
        "(normalized:",
        normalized + ")",
        "| Ensure this normalized value is covered by CORS_ORIGINS or FRONTEND_ORIGIN in EasyPanel."
      );
      callback(new Error(`Origin not allowed: ${origin}`));
    },
  })
);

// Inicialização do pool Postgres/cliente Supabase legado (movida para
// ./services/database.js). Chamada aqui, na mesma posição relativa do bloco
// original, para preservar a ordem de inicialização (depois de dotenv.config()).
initDatabase({ isProduction });
let _evolutionInstancesSchemaEnsured = false;
// SIGTERM/SIGINT são tratados por gracefulShutdown (fecha HTTP + pool + exit), definido
// junto ao app.listen — não registrar handlers de sinal aqui para não duplicar.

// Inicialização do Firebase Admin (movida para ./services/firebase.js).
// Chamada aqui, na mesma posição relativa do bloco original.
initFirebase();

// ensureDb: movido para ./services/httpInfra.js (Onda 3, Run A).

// MANAGED_CLAIM_KEYS...SYSTEM_ACCESS_PROFILES, isFixedAdminIdentity, getPresetFallbackKey,
// normalizeRole, isValidManaged*, getDefaultPresetForRole, normalizeAccessPreset,
// getAccessPresetLabel, buildPresetDefaults, normalizeStringArray, normalizeScopeMode,
// normalizeApprovalLevel, normalizePermissions, normalizeAllowedViews, normalizeInternalPages,
// hasManagedAccessClaims, extractManagedAccessClaims, buildAccessProfile foram movidos para
// ./access/claims.js (Onda 3, Run B).
//
// requireFirebaseAuth, requireInternalAccess, requireAdminAccess, requireUserManagementAccess,
// requireInternalPageAccess, requireAnyInternalPageAccess, requireAppViewAccess foram movidos
// para ./access/middlewares.js (Onda 3, Run B).
//
// canManageGlobalNotifications, normalizeNotificationScopeValues, matchesNotificationClientScope,
// matchesNotificationInternalScope, isNotificationVisibleToAccess, filterNotificationsForAccess,
// getVisibleNotificationIds, ensureSharedRoutePageAccess foram movidos para
// ./access/notifications.js (Onda 3, Run B, versões do server — divergem de notificationScope.js).

// normalizeString: ver ./textNormalize.js (Onda 3, Run A).

// normalizeTenantKey, leadsTableName, normalizeHttpUrl, getRequestId, maskPhoneForLog,
// getClientEnvSuffix e parseJsonEnvMap foram movidos para ./services/tenant.js (Onda 3, Run A).

function resolveEnvDispatchWebhookSettings(clientId) {
  const suffix = getClientEnvSuffix(clientId);
  const candidates = [];

  if (suffix) {
    candidates.push({
      source: `env:EVOLUTION_DISPATCH_WEBHOOK_URL_${suffix}`,
      url: process.env[`EVOLUTION_DISPATCH_WEBHOOK_URL_${suffix}`],
      token: process.env[`EVOLUTION_DISPATCH_WEBHOOK_TOKEN_${suffix}`],
    });
    candidates.push({
      source: `env:N8N_DISPATCH_WEBHOOK_URL_${suffix}`,
      url: process.env[`N8N_DISPATCH_WEBHOOK_URL_${suffix}`],
      token: process.env[`N8N_DISPATCH_WEBHOOK_TOKEN_${suffix}`],
    });
  }

  for (const envName of ["EVOLUTION_DISPATCH_WEBHOOKS_JSON", "N8N_DISPATCH_WEBHOOKS_JSON"]) {
    const map = parseJsonEnvMap(envName);
    if (!map) continue;

    const rawConfig =
      map[clientId] ||
      map[normalizeTenantKey(clientId)] ||
      (suffix ? map[suffix] : null);
    if (!rawConfig) continue;

    if (typeof rawConfig === "string") {
      candidates.push({ source: `env:${envName}`, url: rawConfig, token: null });
      continue;
    }

    if (rawConfig && typeof rawConfig === "object") {
      candidates.push({
        source: `env:${envName}`,
        url: rawConfig.url || rawConfig.webhookUrl || rawConfig.dispatchWebhookUrl,
        token: rawConfig.token || rawConfig.webhookToken || rawConfig.dispatchWebhookToken,
      });
    }
  }

  for (const candidate of candidates) {
    const rawUrl = normalizeString(candidate.url);
    if (!rawUrl) continue;

    const webhookUrl = normalizeHttpUrl(rawUrl);
    if (!webhookUrl) {
      return {
        source: candidate.source,
        webhookUrl: null,
        webhookToken: null,
        invalid: true,
      };
    }

    return {
      source: candidate.source,
      webhookUrl,
      webhookToken: normalizeString(candidate.token),
      invalid: false,
    };
  }

  return null;
}

function getSafeDispatchSettingsLog(settingsResult) {
  const endpoint = getSafeEvolutionEndpointLog(settingsResult?.webhookUrl);
  return {
    source: settingsResult?.source || "missing",
    schemaAvailable: settingsResult?.schemaAvailable !== false,
    webhookConfigured: !!settingsResult?.webhookUrl,
    settingsActive: settingsResult?.settings ? settingsResult.settings.active !== false : null,
    hasWebhookToken: !!settingsResult?.webhookToken,
    ...endpoint,
  };
}

function logDirectDispatch(level, event, details = {}) {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger("[campaign-direct-dispatch]", event, details);
}

function logCampaignReplyFlow(level, event, details = {}) {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger("[campaign-reply-flow]", event, details);
}

function logCampaignDispatch(level, event, details = {}) {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger("[campaign-dispatch]", event, details);
}

function resolveEnvCampaignQualificationWebhookSettings(clientId) {
  const suffix = getClientEnvSuffix(clientId);
  const candidates = [];

  if (suffix) {
    candidates.push({
      source: `env:CAMPAIGN_QUALIFICATION_WEBHOOK_URL_${suffix}`,
      url: process.env[`CAMPAIGN_QUALIFICATION_WEBHOOK_URL_${suffix}`],
      token: process.env[`CAMPAIGN_QUALIFICATION_WEBHOOK_TOKEN_${suffix}`],
    });
    candidates.push({
      source: `env:N8N_QUALIFICATION_WEBHOOK_URL_${suffix}`,
      url: process.env[`N8N_QUALIFICATION_WEBHOOK_URL_${suffix}`],
      token: process.env[`N8N_QUALIFICATION_WEBHOOK_TOKEN_${suffix}`],
    });
  }

  for (const envName of ["CAMPAIGN_QUALIFICATION_WEBHOOKS_JSON", "N8N_QUALIFICATION_WEBHOOKS_JSON"]) {
    const map = parseJsonEnvMap(envName);
    if (!map) continue;

    const rawConfig =
      map[clientId] ||
      map[normalizeTenantKey(clientId)] ||
      (suffix ? map[suffix] : null);
    if (!rawConfig) continue;

    if (typeof rawConfig === "string") {
      candidates.push({ source: `env:${envName}`, url: rawConfig, token: null });
      continue;
    }

    if (rawConfig && typeof rawConfig === "object") {
      candidates.push({
        source: `env:${envName}`,
        url: rawConfig.url || rawConfig.webhookUrl || rawConfig.qualificationWebhookUrl,
        token: rawConfig.token || rawConfig.webhookToken || rawConfig.qualificationWebhookToken,
      });
    }
  }

  candidates.push({
    source: "env:CAMPAIGN_QUALIFICATION_WEBHOOK_URL",
    url: process.env.CAMPAIGN_QUALIFICATION_WEBHOOK_URL,
    token: process.env.CAMPAIGN_QUALIFICATION_WEBHOOK_TOKEN,
  });
  candidates.push({
    source: "env:N8N_QUALIFICATION_WEBHOOK_URL",
    url: process.env.N8N_QUALIFICATION_WEBHOOK_URL,
    token: process.env.N8N_QUALIFICATION_WEBHOOK_TOKEN,
  });

  for (const candidate of candidates) {
    const rawUrl = normalizeString(candidate.url);
    if (!rawUrl) continue;

    const webhookUrl = normalizeHttpUrl(rawUrl);
    if (!webhookUrl) {
      return {
        source: candidate.source,
        webhookUrl: null,
        webhookToken: null,
        invalid: true,
      };
    }

    return {
      source: candidate.source,
      webhookUrl,
      webhookToken: normalizeString(candidate.token),
      invalid: false,
    };
  }

  return null;
}

function maskN8nSettings(row) {
  if (!row) {
    return {
      dispatch_webhook_url: null,
      has_dispatch_webhook_token: false,
      has_inbound_bearer_token: false,
      active: false,
      chatbot_enabled: false,
      chatbot_model: "outlier",
      segmentation_config: buildDefaultSegmentationConfig("outlier"),
      sdr_whatsapp_number: null,
      updated_at: null,
    };
  }

  return {
    client_id: row.client_id,
    dispatch_webhook_url: row.dispatch_webhook_url || null,
    has_dispatch_webhook_token: !!row.dispatch_webhook_token,
    has_inbound_bearer_token: !!row.inbound_bearer_token,
    active: row.active !== false,
    chatbot_enabled: row.chatbot_enabled === true,
    chatbot_model: row.chatbot_model || "outlier",
    segmentation_config: sanitizeSegmentationConfig(row.segmentation_config, row.chatbot_model || "outlier"),
    sdr_whatsapp_number: row.sdr_whatsapp_number || null,
    updated_at: row.updated_at || null,
    updated_by_email: row.updated_by_email || null,
    allowed_tabs: Array.isArray(row.allowed_tabs) ? row.allowed_tabs : null,
    // Preserva a lista de instâncias já mascarada por maskEvolutionInstance (server.js:1717).
    // Sem isso a whitelist cortava o campo e a UI mostrava "0 instâncias".
    evolution_instances: Array.isArray(row.evolution_instances) ? row.evolution_instances : [],
  };
}

// buildDefaultSegmentationConfig e sanitizeSegmentationConfig foram movidos
// para ./segmentation.js (Onda 3, Run A) — mata o unico export do server.js.

function maskEvolutionInstance(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_id: row.client_id,
    name: row.name || "Evolution",
    dispatch_webhook_url: row.dispatch_webhook_url || null,
    has_dispatch_webhook_token: !!row.dispatch_webhook_token,
    inbound_bearer_token_label: row.inbound_bearer_token ? "definido" : null,
    active: row.active !== false,
    is_default: row.is_default === true,
    chip_state: row.chip_state === "warm" ? "warm" : "cold",
    daily_limit_override: row.daily_limit_override != null ? Number(row.daily_limit_override) : null,
    sent_count_today: row.sent_count_today != null ? Number(row.sent_count_today) : 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    updated_by_email: row.updated_by_email || null,
  };
}

function mergeEvolutionInstanceIntoSettings(settings, instance) {
  if (!instance) return settings || null;
  return {
    ...(settings || {}),
    client_id: instance.client_id,
    dispatch_webhook_url: instance.dispatch_webhook_url || null,
    dispatch_webhook_token: instance.dispatch_webhook_token || null,
    inbound_bearer_token: instance.inbound_bearer_token || settings?.inbound_bearer_token || null,
    active: instance.active !== false,
    updated_at: instance.updated_at || settings?.updated_at || null,
    updated_by_email: instance.updated_by_email || settings?.updated_by_email || null,
    evolution_instance_id: instance.id,
    evolution_instance_name: instance.name || "Evolution",
  };
}

async function ensureLeadClientEvolutionInstancesTable() {
  if (!pgDatabasePool) return false;
  if (_evolutionInstancesSchemaEnsured) return true;

  await pgDatabasePool.query(`
    CREATE TABLE IF NOT EXISTS public.lead_client_evolution_instances (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Evolution',
      dispatch_webhook_url TEXT NOT NULL,
      dispatch_webhook_token TEXT,
      inbound_bearer_token TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by_uid TEXT,
      updated_by_email TEXT
    )
  `);
  await pgDatabasePool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_client_evolution_default
      ON public.lead_client_evolution_instances (client_id)
      WHERE is_default = true
  `);
  await pgDatabasePool.query(`
    CREATE INDEX IF NOT EXISTS idx_lead_client_evolution_client
      ON public.lead_client_evolution_instances (client_id, active)
  `);

  // Anti-ban: chip_state (cold|warm) + daily_limit_override.
  // ALTER TABLE acquires ACCESS EXCLUSIVE mesmo em no-op no PG — roda só uma vez por processo.
  await pgDatabasePool.query(`
    ALTER TABLE public.lead_client_evolution_instances
    ADD COLUMN IF NOT EXISTS chip_state TEXT NOT NULL DEFAULT 'cold'
  `);
  await pgDatabasePool.query(`
    ALTER TABLE public.lead_client_evolution_instances
    ADD COLUMN IF NOT EXISTS daily_limit_override INTEGER
  `);

  _evolutionInstancesSchemaEnsured = true;
  return true;
}

async function getLeadClientEvolutionInstances(clientId) {
  if (!clientId || !(await ensureLeadClientEvolutionInstancesTable())) return [];

  const { rows } = await pgDatabasePool.query(
    `
      SELECT i.id, i.client_id, i.name, i.dispatch_webhook_url, i.dispatch_webhook_token,
             i.inbound_bearer_token, i.active, i.is_default, i.chip_state, i.daily_limit_override,
             i.created_at, i.updated_at, i.updated_by_email,
             COALESCE(u.sent_count, 0) AS sent_count_today
      FROM public.lead_client_evolution_instances i
      LEFT JOIN public.evolution_instance_daily_usage u
        ON u.instance_id = i.id AND u.date = CURRENT_DATE
      WHERE i.client_id = $1
      ORDER BY i.is_default DESC, i.active DESC, i.created_at ASC
    `,
    [clientId]
  );

  return rows;
}

async function getLeadClientEvolutionInstancesMap(clientIds) {
  if (!clientIds?.length || !(await ensureLeadClientEvolutionInstancesTable())) return {};

  const { rows } = await pgDatabasePool.query(
    `
      SELECT i.id, i.client_id, i.name, i.dispatch_webhook_url, i.dispatch_webhook_token,
             i.inbound_bearer_token, i.active, i.is_default, i.chip_state, i.daily_limit_override,
             i.created_at, i.updated_at, i.updated_by_email,
             COALESCE(u.sent_count, 0) AS sent_count_today
      FROM public.lead_client_evolution_instances i
      LEFT JOIN public.evolution_instance_daily_usage u
        ON u.instance_id = i.id AND u.date = CURRENT_DATE
      WHERE i.client_id = ANY($1::text[])
      ORDER BY i.is_default DESC, i.active DESC, i.created_at ASC
    `,
    [clientIds]
  );

  return rows.reduce((acc, row) => {
    if (!acc[row.client_id]) acc[row.client_id] = [];
    acc[row.client_id].push(row);
    return acc;
  }, {});
}

async function getDefaultLeadClientEvolutionInstance(clientId) {
  const instances = await getLeadClientEvolutionInstances(clientId);
  return instances.find((instance) => instance.active !== false && instance.is_default) ||
    instances.find((instance) => instance.active !== false) ||
    null;
}

function getN8nOnboardingStatus(settings) {
  if (!settings || settings.active === false) return "pendente";
  if (!settings.dispatch_webhook_url) return "sem url evolution";
  if (!settings.inbound_bearer_token) return "sem token inbound legado";
  return "evolution + inbound legado";
}

async function getLeadClientN8nSettingsStatus(clientId) {
  if (!supabase || !clientId) {
    return {
      settings: null,
      schemaAvailable: false,
      source: "database_unavailable",
    };
  }

  const { data, error } = await supabase
    .from("lead_client_n8n_settings")
    .select(
      "client_id, dispatch_webhook_url, dispatch_webhook_token, inbound_bearer_token, active, chatbot_enabled, chatbot_model, segmentation_config, sdr_whatsapp_number, allowed_tabs, updated_at, updated_by_uid, updated_by_email"
    )
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error)) {
      return {
        settings: null,
        schemaAvailable: false,
        source: "schema_missing",
        error,
      };
    }
    throw error;
  }

  const defaultEvolutionInstance = await getDefaultLeadClientEvolutionInstance(clientId);

  return {
    settings: mergeEvolutionInstanceIntoSettings(data || null, defaultEvolutionInstance),
    schemaAvailable: true,
    source: defaultEvolutionInstance ? "evolution_instance_default" : data ? "client_settings" : "missing",
  };
}

async function getLeadClientN8nSettings(clientId) {
  const { settings } = await getLeadClientN8nSettingsStatus(clientId);
  return settings;
}

async function getLeadClientN8nSettingsMap(clientIds) {
  if (!supabase || clientIds.length === 0) return {};

  const { data, error } = await supabase
    .from("lead_client_n8n_settings")
    .select(
      "client_id, dispatch_webhook_url, dispatch_webhook_token, inbound_bearer_token, active, chatbot_enabled, chatbot_model, segmentation_config, sdr_whatsapp_number, allowed_tabs, updated_at, updated_by_email"
    )
    .in("client_id", clientIds);

  if (error) {
    if (isMissingSchemaError(error)) return {};
    throw error;
  }

  const settingsMap = Object.fromEntries((data || []).map((row) => [row.client_id, row]));
  const evolutionInstancesMap = await getLeadClientEvolutionInstancesMap(clientIds);

  for (const clientId of clientIds) {
    const instances = evolutionInstancesMap[clientId] || [];
    const defaultInstance =
      instances.find((instance) => instance.active !== false && instance.is_default) ||
      instances.find((instance) => instance.active !== false) ||
      null;
    const mergedSettings = mergeEvolutionInstanceIntoSettings(settingsMap[clientId] || null, defaultInstance);

    if (mergedSettings || settingsMap[clientId] || instances.length) {
      settingsMap[clientId] = {
        ...(mergedSettings || settingsMap[clientId] || {}),
        evolution_instances: instances.map(maskEvolutionInstance),
      };
    }
  }

  return settingsMap;
}

function buildN8nSettingsPayload(input, authAccess, existing = null) {
  const body = input && typeof input === "object" ? input : {};
  const dispatchWebhookUrlProvided = Object.prototype.hasOwnProperty.call(body, "dispatchWebhookUrl");
  const dispatchWebhookTokenProvided = Object.prototype.hasOwnProperty.call(body, "dispatchWebhookToken");
  const inboundBearerTokenProvided = Object.prototype.hasOwnProperty.call(body, "inboundBearerToken");
  const activeProvided = Object.prototype.hasOwnProperty.call(body, "active");
  const chatbotEnabledProvided = Object.prototype.hasOwnProperty.call(body, "chatbotEnabled");
  const chatbotModelProvided = Object.prototype.hasOwnProperty.call(body, "chatbotModel");
  const segmentationConfigProvided = Object.prototype.hasOwnProperty.call(body, "segmentationConfig");
  const sdrWhatsappNumberProvided = Object.prototype.hasOwnProperty.call(body, "sdrWhatsappNumber");
  const allowedTabsProvided = Object.prototype.hasOwnProperty.call(body, "allowedTabs");

  const payload = {
    active: activeProvided ? body.active !== false : existing?.active ?? true,
    chatbot_enabled: chatbotEnabledProvided ? body.chatbotEnabled === true : existing?.chatbot_enabled ?? false,
    chatbot_model: chatbotModelProvided ? (body.chatbotModel || "outlier") : existing?.chatbot_model ?? "outlier",
    segmentation_config: segmentationConfigProvided
      ? sanitizeSegmentationConfig(body.segmentationConfig, body.chatbotModel || existing?.chatbot_model || "generico")
      : sanitizeSegmentationConfig(existing?.segmentation_config, existing?.chatbot_model || body.chatbotModel || "generico"),
    sdr_whatsapp_number: sdrWhatsappNumberProvided ? (normalizeString(body.sdrWhatsappNumber) || null) : existing?.sdr_whatsapp_number ?? null,
    allowed_tabs: allowedTabsProvided
      ? (Array.isArray(body.allowedTabs) ? body.allowedTabs : null)
      : existing?.allowed_tabs ?? null,
    updated_at: new Date().toISOString(),
    updated_by_uid: authAccess?.uid || null,
    updated_by_email: authAccess?.email || null,
  };

  if (dispatchWebhookUrlProvided) {
    const url = normalizeHttpUrl(body.dispatchWebhookUrl);
    if (body.dispatchWebhookUrl !== null && normalizeString(body.dispatchWebhookUrl) && !url) {
      throw new Error("INVALID_DISPATCH_WEBHOOK_URL");
    }
    payload.dispatch_webhook_url = url;
  } else if (!existing) {
    payload.dispatch_webhook_url = null;
  }

  if (dispatchWebhookTokenProvided) {
    const token = normalizeString(body.dispatchWebhookToken);
    payload.dispatch_webhook_token =
      body.dispatchWebhookToken === null
        ? null
        : isMaskedSecretPlaceholder(token)
          ? existing?.dispatch_webhook_token || null
          : token || existing?.dispatch_webhook_token || null;
  } else if (!existing) {
    payload.dispatch_webhook_token = null;
  }

  if (inboundBearerTokenProvided) {
    const token = normalizeString(body.inboundBearerToken);
    payload.inbound_bearer_token =
      body.inboundBearerToken === null
        ? null
        : isMaskedSecretPlaceholder(token)
          ? existing?.inbound_bearer_token || null
          : token || existing?.inbound_bearer_token || null;
  } else if (!existing) {
    payload.inbound_bearer_token = null;
  }

  return payload;
}

function isMaskedSecretPlaceholder(value) {
  const text = normalizeString(value);
  return Boolean(text) && /^[*•]+$/.test(text);
}

async function upsertLeadClientN8nSettings(clientId, input, authAccess, existing = null) {
  const payload = {
    client_id: clientId,
    ...buildN8nSettingsPayload(input, authAccess, existing),
  };

  const { data, error } = await supabase
    .from("lead_client_n8n_settings")
    .upsert(payload, { onConflict: "client_id" })
    .select(
      "client_id, dispatch_webhook_url, dispatch_webhook_token, inbound_bearer_token, active, chatbot_enabled, chatbot_model, segmentation_config, sdr_whatsapp_number, allowed_tabs, updated_at, updated_by_email"
    )
    .single();

  if (error) throw error;
  return data;
}

async function upsertLeadClientEvolutionInstance(clientId, input, authAccess, existing = null) {
  if (!(await ensureLeadClientEvolutionInstancesTable())) {
    throw new Error("EVOLUTION_INSTANCES_UNAVAILABLE");
  }

  const body = input && typeof input === "object" ? input : {};
  const name = normalizeString(body.name) || existing?.name || "Evolution";
  const rawUrl = Object.prototype.hasOwnProperty.call(body, "dispatchWebhookUrl")
    ? body.dispatchWebhookUrl
    : existing?.dispatch_webhook_url;
  const dispatchWebhookUrl = normalizeHttpUrl(rawUrl);

  if (!dispatchWebhookUrl) {
    throw new Error("INVALID_DISPATCH_WEBHOOK_URL");
  }

  const dispatchTokenInput = normalizeString(body.dispatchWebhookToken);
  const inboundTokenInput = normalizeString(body.inboundBearerToken);
  const isDefault = body.isDefault === true || existing?.is_default === true;
  const active = Object.prototype.hasOwnProperty.call(body, "active")
    ? body.active !== false
    : existing?.active !== false;
  const chipState = Object.prototype.hasOwnProperty.call(body, "chipState")
    ? normalizeString(body.chipState) === "warm" ? "warm" : "cold"
    : existing?.chip_state === "warm" ? "warm" : "cold";
  const rawLimit = Object.prototype.hasOwnProperty.call(body, "dailyLimitOverride")
    ? body.dailyLimitOverride
    : existing?.daily_limit_override ?? null;
  const dailyLimitOverride =
    rawLimit == null ? null : Number.isInteger(Number(rawLimit)) && Number(rawLimit) > 0 ? Number(rawLimit) : null;

  const payload = {
    client_id: clientId,
    name,
    dispatch_webhook_url: dispatchWebhookUrl,
    chip_state: chipState,
    daily_limit_override: dailyLimitOverride,
    dispatch_webhook_token:
      Object.prototype.hasOwnProperty.call(body, "dispatchWebhookToken")
        ? body.dispatchWebhookToken === null
          ? null
          : isMaskedSecretPlaceholder(dispatchTokenInput)
            ? existing?.dispatch_webhook_token || null
            : dispatchTokenInput || existing?.dispatch_webhook_token || null
        : existing?.dispatch_webhook_token || null,
    inbound_bearer_token:
      Object.prototype.hasOwnProperty.call(body, "inboundBearerToken")
        ? body.inboundBearerToken === null
          ? null
          : isMaskedSecretPlaceholder(inboundTokenInput)
            ? existing?.inbound_bearer_token || null
            : inboundTokenInput || existing?.inbound_bearer_token || null
        : existing?.inbound_bearer_token || null,
    active,
    is_default: isDefault,
    updated_by_uid: authAccess?.uid || null,
    updated_by_email: authAccess?.email || null,
  };

  const client = await pgDatabasePool.connect();
  try {
    await client.query("BEGIN");

    if (payload.is_default) {
      await client.query(
        `UPDATE public.lead_client_evolution_instances SET is_default = false, updated_at = now() WHERE client_id = $1`,
        [clientId]
      );
    }

    let result;
    if (existing?.id) {
      result = await client.query(
        `
          UPDATE public.lead_client_evolution_instances
          SET name = $1,
              dispatch_webhook_url = $2,
              dispatch_webhook_token = $3,
              inbound_bearer_token = $4,
              active = $5,
              is_default = $6,
              chip_state = $7,
              daily_limit_override = $8,
              updated_at = now(),
              updated_by_uid = $9,
              updated_by_email = $10
          WHERE id = $11 AND client_id = $12
          RETURNING id, client_id, name, dispatch_webhook_url, dispatch_webhook_token,
                    inbound_bearer_token, active, is_default, chip_state, daily_limit_override,
                    created_at, updated_at, updated_by_email
        `,
        [
          payload.name,
          payload.dispatch_webhook_url,
          payload.dispatch_webhook_token,
          payload.inbound_bearer_token,
          payload.active,
          payload.is_default,
          payload.chip_state,
          payload.daily_limit_override,
          payload.updated_by_uid,
          payload.updated_by_email,
          existing.id,
          clientId,
        ]
      );
    } else {
      const existingInstances = await client.query(
        `SELECT 1 FROM public.lead_client_evolution_instances WHERE client_id = $1 LIMIT 1`,
        [clientId]
      );
      const shouldDefault = payload.is_default || existingInstances.rowCount === 0;

      if (shouldDefault && !payload.is_default) {
        await client.query(
          `UPDATE public.lead_client_evolution_instances SET is_default = false, updated_at = now() WHERE client_id = $1`,
          [clientId]
        );
      }

      result = await client.query(
        `
          INSERT INTO public.lead_client_evolution_instances
            (client_id, name, dispatch_webhook_url, dispatch_webhook_token, inbound_bearer_token,
             active, is_default, chip_state, daily_limit_override, updated_by_uid, updated_by_email)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id, client_id, name, dispatch_webhook_url, dispatch_webhook_token,
                    inbound_bearer_token, active, is_default, chip_state, daily_limit_override,
                    created_at, updated_at, updated_by_email
        `,
        [
          clientId,
          payload.name,
          payload.dispatch_webhook_url,
          payload.dispatch_webhook_token,
          payload.inbound_bearer_token,
          payload.active,
          shouldDefault,
          payload.chip_state,
          payload.daily_limit_override,
          payload.updated_by_uid,
          payload.updated_by_email,
        ]
      );
    }

    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function getEvolutionAdminConfig() {
  const baseUrl = (normalizeString(process.env.EVOLUTION_API_URL) || "").replace(/\/+$/, "");
  const apiKey = normalizeString(process.env.EVOLUTION_API_KEY);

  return {
    baseUrl,
    apiKey,
    configured: Boolean(baseUrl && apiKey),
  };
}

function buildEvolutionManagedInstanceName(clientId, inputName) {
  const source = normalizeString(inputName) || clientId || "vexo";
  const normalized = normalizeTenantKey(source) || normalizeTenantKey(clientId) || `vexo-${randomUUID().slice(0, 8)}`;
  const withClientPrefix = normalized.startsWith(`${clientId}-`) ? normalized : `${clientId}-${normalized}`;
  return withClientPrefix.slice(0, 64).replace(/-+$/g, "");
}

function buildEvolutionDispatchWebhookUrl(baseUrl, instanceName) {
  return `${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`;
}

function maskEvolutionProvisionResponse(data) {
  if (!data || typeof data !== "object") return null;

  const instance = data.instance && typeof data.instance === "object" ? data.instance : {};
  const qrcode = data.qrcode && typeof data.qrcode === "object" ? data.qrcode : null;

  return {
    instanceName:
      normalizeString(data.instanceName) ||
      normalizeString(data.instance?.instanceName) ||
      normalizeString(instance.instanceName) ||
      null,
    status: normalizeString(data.status) || normalizeString(instance.status) || null,
    qrcode: qrcode
      ? {
          code: normalizeString(qrcode.code) || null,
          base64: normalizeString(qrcode.base64) || null,
        }
      : null,
  };
}

async function provisionLeadClientEvolutionInstance(clientId, input, authAccess) {
  const config = getEvolutionAdminConfig();
  if (!config.configured) {
    const error = new Error("EVOLUTION_ADMIN_UNCONFIGURED");
    error.statusCode = 503;
    throw error;
  }

  const body = input && typeof input === "object" ? input : {};
  const displayName = normalizeString(body.name) || "Evolution";
  const instanceName = buildEvolutionManagedInstanceName(clientId, body.instanceName || displayName);
  const instanceToken =
    normalizeString(body.dispatchWebhookToken) ||
    `vexo_${randomUUID().replace(/-/g, "")}`;
  const createPayload = {
    instanceName,
    integration: normalizeString(body.integration) || "WHATSAPP-BAILEYS",
    token: instanceToken,
    qrcode: body.qrcode !== false,
  };

  const response = await fetch(`${config.baseUrl}/instance/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.apiKey,
    },
    body: JSON.stringify(createPayload),
  });

  let responsePayload = null;
  const responseText = await response.text();
  if (responseText) {
    try {
      responsePayload = JSON.parse(responseText);
    } catch {
      responsePayload = { message: responseText.slice(0, 500) };
    }
  }

  if (!response.ok) {
    const error = new Error(
      normalizeString(responsePayload?.message) ||
      normalizeString(responsePayload?.error) ||
      `Evolution API HTTP ${response.status}`
    );
    error.statusCode = response.status;
    error.code = "EVOLUTION_INSTANCE_PROVISION_FAILED";
    throw error;
  }

  const saved = await upsertLeadClientEvolutionInstance(
    clientId,
    {
      name: displayName,
      dispatchWebhookUrl: buildEvolutionDispatchWebhookUrl(config.baseUrl, instanceName),
      dispatchWebhookToken: instanceToken,
      active: body.active !== false,
      isDefault: body.isDefault === true,
    },
    authAccess,
    null
  );

  return {
    instance: saved,
    evolution: {
      ...maskEvolutionProvisionResponse(responsePayload),
      instanceName,
    },
  };
}

async function deleteLeadClientEvolutionInstance(clientId, instanceId) {
  if (!(await ensureLeadClientEvolutionInstancesTable())) return null;

  const client = await pgDatabasePool.connect();
  try {
    const instanceRes = await client.query(
      `SELECT dispatch_webhook_url, name FROM public.lead_client_evolution_instances WHERE id = $1 AND client_id = $2`,
      [instanceId, clientId]
    );
    const instanceRow = instanceRes.rows[0];

    await client.query("BEGIN");
    const removed = await client.query(
      `
        DELETE FROM public.lead_client_evolution_instances
        WHERE id = $1 AND client_id = $2
        RETURNING id, client_id, is_default
      `,
      [instanceId, clientId]
    );

    if (removed.rows[0]?.is_default) {
      await client.query(
        `
          UPDATE public.lead_client_evolution_instances
          SET is_default = true, updated_at = now()
          WHERE id = (
            SELECT id
            FROM public.lead_client_evolution_instances
            WHERE client_id = $1 AND active = true
            ORDER BY created_at ASC
            LIMIT 1
          )
        `,
        [clientId]
      );
    }

    await client.query("COMMIT");

    if (instanceRow?.dispatch_webhook_url) {
      const parts = instanceRow.dispatch_webhook_url.split("/");
      const instanceName = parts[parts.length - 1];
      if (instanceName) {
        const config = getEvolutionAdminConfig();
        if (config.configured) {
          try {
            const response = await fetch(`${config.baseUrl}/instance/delete/${encodeURIComponent(instanceName)}`, {
              method: "DELETE",
              headers: {
                apikey: config.apiKey,
              },
            });
            if (!response.ok) {
              console.warn(`[database] Evolution API returned HTTP ${response.status} when deleting instance ${instanceName}`);
            } else {
              console.info(`[database] Evolution API successfully deleted instance ${instanceName}`);
            }
          } catch (apiErr) {
            console.error(`[database] Failed to delete Evolution instance ${instanceName} on API:`, apiErr?.message || apiErr);
          }
        }
      }
    }

    return removed.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// getRequestBearerToken: movido para ./services/httpInfra.js (Onda 3, Run A).

async function validateN8nInboundBearer(req, res, clientId) {
  const settings = await getLeadClientN8nSettings(clientId);
  const token = getRequestBearerToken(req);

  if (!settings || settings.active === false || !settings.inbound_bearer_token) {
    sendError(res, 401, "UNAUTHORIZED", "n8n inbound token is not configured for this client");
    return null;
  }

  if (!token || token !== settings.inbound_bearer_token) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return null;
  }

  return settings;
}

// sanitizePhoneLeadWebhookStyle, getLeadWebhookBearerSecret, sendLeadWebhookEdgeStyle, validateLeadWebhookBearer,
// LEADS_OUTLIER_* consts, sanitizeLeadsOutlierDados, sanitizeLeadsOutlierBehaviorMeta, parseOptionalFiniteNumber,
// parseOptionalUuid, validateLeadsOutlierRecord: movidos para ./services/leadImport.js (Onda 3, Run C).

async function resolveDispatchWebhookSettings(clientId) {
  const settingsStatus = await getLeadClientN8nSettingsStatus(clientId);
  const settings = settingsStatus.settings;
  const hasActiveClientSettings =
    settings && settings.active !== false && !!settings.dispatch_webhook_url;

  if (hasActiveClientSettings) {
    return {
      settings,
      webhookUrl: settings.dispatch_webhook_url,
      webhookToken: settings.dispatch_webhook_token || null,
      source: "client_settings",
      schemaAvailable: settingsStatus.schemaAvailable,
    };
  }

  const envSettings = resolveEnvDispatchWebhookSettings(clientId);
  if (envSettings?.webhookUrl) {
    return {
      settings,
      webhookUrl: envSettings.webhookUrl,
      webhookToken: envSettings.webhookToken || null,
      source: envSettings.source,
      schemaAvailable: settingsStatus.schemaAvailable,
    };
  }

  if (envSettings?.invalid) {
    return {
      settings,
      webhookUrl: null,
      webhookToken: null,
      source: "env_invalid",
      schemaAvailable: settingsStatus.schemaAvailable,
    };
  }

  const source =
    settingsStatus.source === "schema_missing"
      ? "schema_missing"
      : settings && settings.active === false
        ? "inactive"
        : settings
          ? "missing_url"
          : "missing";

  return {
    settings,
    webhookUrl: null,
    webhookToken: null,
    source,
    schemaAvailable: settingsStatus.schemaAvailable,
  };
}

function parseEvolutionWebhookEndpoint(webhookUrl) {
  const rawUrl = normalizeString(webhookUrl);
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const messageIndex = pathParts.findIndex((part) => part === "message");
    const action = messageIndex >= 0 ? pathParts[messageIndex + 1] : null;
    const instance = messageIndex >= 0 ? decodeURIComponent(pathParts[messageIndex + 2] || "") : "";

    if (!url.origin || !instance || !action) {
      return null;
    }

    return {
      origin: url.origin,
      path: url.pathname,
      action,
      instance,
      healthUrl: `${url.origin}/instance/connectionState/${encodeURIComponent(instance)}`,
    };
  } catch {
    return null;
  }
}

function getSafeEvolutionEndpointLog(webhookUrl) {
  const endpoint = parseEvolutionWebhookEndpoint(webhookUrl);
  if (!endpoint) {
    return {
      endpointOrigin: null,
      endpointPath: null,
      endpointAction: null,
      instance: null,
    };
  }

  return {
    endpointOrigin: endpoint.origin,
    endpointPath: endpoint.path,
    endpointAction: endpoint.action,
    instance: endpoint.instance,
  };
}

function buildEvolutionAuthHeaders(token) {
  const headers = { Accept: "application/json" };
  const normalizedToken = normalizeString(token);
  if (normalizedToken) {
    headers.apikey = normalizedToken;
    headers.Authorization = `Bearer ${normalizedToken}`;
  }
  return headers;
}

function extractEvolutionConnectionState(payload) {
  if (!payload || typeof payload !== "object") return null;

  const candidates = [
    payload.instance?.state,
    payload.instance?.connectionStatus,
    payload.instance?.status,
    payload.state,
    payload.status,
    payload.connectionStatus,
    payload.response?.instance?.state,
    payload.response?.state,
    payload.response?.status,
    payload.response?.connectionStatus,
  ];

  return candidates.map((value) => {
    const normalized = normalizeString(value);
    return normalized ? normalized.toLowerCase() : null;
  }).find(Boolean) || null;
}

function isEvolutionOpenState(state) {
  return ["open", "connected", "online"].includes(normalizeString(state).toLowerCase());
}

async function checkEvolutionInstanceHealth({ webhookUrl, webhookToken, context = {} }) {
  const endpoint = parseEvolutionWebhookEndpoint(webhookUrl);
  if (!endpoint) {
    logCampaignDispatch("warn", "health_check_skipped_invalid_endpoint", {
      ...context,
      ...getSafeEvolutionEndpointLog(webhookUrl),
    });
    const error = new Error(
      "URL Evolution invalida. Configure no formato https://host/message/sendText/NOME_DA_INSTANCIA."
    );
    error.statusCode = 400;
    error.code = "EVOLUTION_ENDPOINT_INVALID";
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint.healthUrl, {
      method: "GET",
      headers: buildEvolutionAuthHeaders(webhookToken),
      signal: controller.signal,
    });
    const responseText = await response.text();
    let payload = null;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      payload = null;
    }
    const state = extractEvolutionConnectionState(payload);

    logCampaignDispatch(response.ok ? "info" : "warn", "evolution_health_checked", {
      ...context,
      ...getSafeEvolutionEndpointLog(webhookUrl),
      status: response.status,
      state: state || "unknown",
    });

    if (!response.ok) {
      const error = new Error(
        responseText
          ? `Falha ao verificar instancia Evolution: HTTP ${response.status}: ${responseText.slice(0, 300)}`
          : `Falha ao verificar instancia Evolution: HTTP ${response.status}`
      );
      error.statusCode = 502;
      error.code = "EVOLUTION_HEALTH_CHECK_FAILED";
      throw error;
    }

    // Some Evolution builds return a very small response body. Do not block a configured instance
    // just because the state field is not present, but do block explicit closed states.
    if (state && !isEvolutionOpenState(state)) {
      const error = new Error(`Instancia Evolution "${endpoint.instance}" nao esta conectada (${state}).`);
      error.statusCode = 409;
      error.code = "EVOLUTION_INSTANCE_NOT_OPEN";
      throw error;
    }

    return { checked: true, state: state || "unknown" };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Timeout ao verificar conexao da instancia Evolution.");
      timeoutError.statusCode = 504;
      timeoutError.code = "EVOLUTION_HEALTH_CHECK_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveCampaignDispatchSettings(clientId, campaign = {}) {
  const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
  const selectedEvolutionInstanceId = normalizeString(analyticsMeta.dispatchOptions?.evolutionInstanceId);

  if (selectedEvolutionInstanceId) {
    const instances = await getLeadClientEvolutionInstances(clientId);
    const selectedInstance = instances.find((instance) => instance.id === selectedEvolutionInstanceId) || null;

    if (!selectedInstance) {
      return {
        webhookUrl: null,
        webhookToken: null,
        source: "evolution_instance_not_found",
        schemaAvailable: true,
        selectedEvolutionInstanceId,
        usingCachedCampaignSettings: false,
        tenantSettingsSource: "evolution_instance_not_found",
      };
    }

    if (selectedInstance.active === false) {
      return {
        webhookUrl: null,
        webhookToken: null,
        source: "evolution_instance_inactive",
        schemaAvailable: true,
        selectedEvolutionInstanceId,
        selectedEvolutionInstanceName: selectedInstance.name || "Evolution",
        usingCachedCampaignSettings: false,
        tenantSettingsSource: "evolution_instance_inactive",
      };
    }

    return {
      webhookUrl: normalizeString(selectedInstance.dispatch_webhook_url),
      webhookToken: normalizeString(selectedInstance.dispatch_webhook_token) || null,
      source: "campaign_evolution_instance",
      schemaAvailable: true,
      selectedEvolutionInstanceId,
      selectedEvolutionInstanceName: selectedInstance.name || "Evolution",
      usingCachedCampaignSettings: false,
      tenantSettingsSource: "campaign_evolution_instance",
    };
  }

  const tenantDispatch = await resolveDispatchWebhookSettings(clientId);
  const tenantWebhookUrl = normalizeString(tenantDispatch.webhookUrl);
  const tenantWebhookToken = normalizeString(tenantDispatch.webhookToken) || null;
  const cachedWebhookUrl = normalizeString(campaign.webhook_url);
  const cachedWebhookToken = normalizeString(campaign.webhook_token) || null;
  const webhookUrl = tenantWebhookUrl || cachedWebhookUrl;
  const webhookToken = tenantWebhookUrl ? tenantWebhookToken : tenantWebhookToken || cachedWebhookToken;

  return {
    ...tenantDispatch,
    webhookUrl,
    webhookToken,
    source: tenantWebhookUrl ? tenantDispatch.source : cachedWebhookUrl ? "campaign_cache" : tenantDispatch.source,
    usingCachedCampaignSettings: !tenantWebhookUrl && !!cachedWebhookUrl,
    tenantSettingsSource: tenantDispatch.source,
  };
}

// isDuplicateKeyError: movido para ./services/httpInfra.js (Onda 3, Run A).

// normalizeBool: movido para ./services/httpInfra.js (Onda 3, Run A).

// normalizeIsoDate: movido para ./services/httpInfra.js (Onda 3, Run A).

// sanitizePhone, buildPhoneLookupVariants, normalizePhoneToWhatsAppChatId, normalizeWhatsAppChatId,
// getAuthorizedClientWhatsAppChatIds, getAuthorizedWhatsAppChatIdsForRequest, ensureAuthorizedWhatsAppChat,
// ensureAuthorizedWhatsAppPhone: movidos para ./services/leadImport.js (Onda 3, Run C).

// isValidBase64: movido para ./services/httpInfra.js (Onda 3, Run A).

/** Global bearer for n8n-facing routes (POST/GET conversation-memory*, POST n8n-error-webhook). Env overrides; default matches legacy Edge. */
// getN8nWebhookBearerSecret: movido para ./services/httpInfra.js (Onda 3, Run A).

// requireN8nWebhookSecret: movido para ./services/httpInfra.js (Onda 3, Run A).

// validateConversationMemoryPayload: movido para ./services/leadImport.js (Onda 3, Run C).

// getZonedDateParts, getDateKey, getDateLabel, humanizeStatus, isQualifiedStatus, detectTemperature,
// parseLeadReferenceDate, buildDashboardPayload, leadMatchesCampaignSegmentation, isMissingSchemaError,
// optionalQuery, queryWithSchemaFallback, safePercent, average, hoursBetween, normalizeMetricValue,
// buildMetricDefinition, normalizeWonStatus, getLeadReferenceDate, buildRevenueOpsPayload,
// buildRevenueOpsFallbackPayload, parseCommercialIntelligenceFilters: movidos para ./services/analytics.js (Onda 3, Run C).

// mergeManagedClaims, buildManagedClaims, listAllFirebaseUsers, mapAdminUserRecord,
// ensureFirebaseUserAccessClaims, humanizeAccessProfileKey, normalizeAccessProfileRecord,
// buildSystemAccessProfiles, isMissingAccessProfilesTable, listAccessProfiles,
// findAccessProfileByKey, resolveRequestedAccessProfile, serializeAccessProfileRecord,
// syncUsersWithAccessProfile foram movidos para ./access/claims.js (Onda 3, Run B).
function resolveAuthorizedClientId(req, res, requestedClientId) {
  const authAccess = req.authAccess || {
    role: "internal",
    scopeMode: "all_clients",
    clientId: null,
    clientIds: [],
  };
  const clientIds = authAccess.clientIds || [];
  const scopeMode =
    authAccess.scopeMode ||
    (authAccess.role === "client" ? "assigned_clients" : "all_clients");

  if (authAccess.role === "client") {
    if (scopeMode === "no_client_access") {
      sendError(res, 403, "NO_CLIENT_ACCESS", "You do not have access to any client");
      return null;
    }

    if (requestedClientId && !clientIds.includes(requestedClientId)) {
      sendError(
        res,
        403,
        "FORBIDDEN_CLIENT_SCOPE",
        "You do not have access to this client"
      );
      return null;
    }

    return requestedClientId || authAccess.clientId || clientIds[0] || null;
  }

  if (authAccess.role === "internal") {
    if (scopeMode === "no_client_access") {
      sendError(res, 403, "NO_CLIENT_ACCESS", "You do not have access to any client");
      return null;
    }

    // Se requestedClientId é especificado, validar se interno tem acesso
    if (requestedClientId) {
      if (authAccess.isAdmin || scopeMode === "all_clients") {
        return requestedClientId;
      }

      if (scopeMode === "assigned_clients") {
        if (clientIds.length === 0) {
          sendError(res, 403, "NO_CLIENT_ACCESS", "You do not have access to any client");
          return null;
        }

        if (!clientIds.includes(requestedClientId)) {
          sendError(res, 403, "FORBIDDEN_CLIENT_SCOPE", "You do not have access to this client");
          return null;
        }
        return requestedClientId;
      }
    }

    if (scopeMode === "assigned_clients" && clientIds.length === 0) {
      sendError(res, 403, "NO_CLIENT_ACCESS", "You do not have access to any client");
      return null;
    }

    return authAccess.clientId || clientIds[0] || null;
  }

  if (authAccess.role === "pending") {
    sendError(
      res,
      403,
      "PENDING_APPROVAL",
      "Your account is waiting for approval"
    );
    return null;
  }

  sendError(res, 403, "FORBIDDEN", "Invalid role");
  return null;
}

// parseCsvLine, parseCsvToRows, normalizeHeaderKey, pickRowValue, normalizeImportedLead,
// isImportedLeadEmpty, buildImportPreview: movidos para ./services/leadImport.js (Onda 3, Run C).

async function getClientName(clientId) {
  if (!supabase) return clientId;

  const { data, error } = await supabase
    .from("leads_clients")
    .select("id, name")
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.name || clientId;
}

// Catálogo de segmentação (fields[] + featuredKpis) do tenant. Leitura leve.
async function getSegmentationCatalogForClient(clientId) {
  const empty = { version: 2, fields: [], featuredKpis: [] };
  if (!supabase || !clientId) return empty;
  const { data, error } = await supabase
    .from("lead_client_n8n_settings")
    .select("segmentation_config")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return empty;
    throw error;
  }
  return getSegmentationCatalog(data?.segmentation_config);
}

async function buildDispatchLeads({ clientId, importId = null, limit = null, offset = null, segmentation = null, excludeDispatchId = null }) {
  if (!supabase) return [];

  // Roteamento de segmentação unificada:
  //  - shape novo { filters:[...] } → catálogo do tenant + matcher genérico.
  //  - shape legado { gender, productType, ... } → matcher hardcoded (compat, não muda campanha antiga).
  let segMatcher;
  if (isFilterShape(segmentation)) {
    const catalog = await getSegmentationCatalogForClient(clientId);
    const filters = normalizeFilters(segmentation, catalog);
    segMatcher = (item) => leadMatchesSegmentation(item, catalog.fields, filters);
  } else {
    segMatcher = (item) => leadMatchesCampaignSegmentation(item, segmentation);
  }

  let query;
  if (importId === "__crm__") {
    query = supabase
      .from("leads")
      .select("id, client_id, telefone, created_at, nome, tipo_cliente, faixa_consumo, qualificacao, cidade, estado, status")
      .eq("client_id", clientId)
      .not("telefone", "is", null)
      .order("created_at", { ascending: false });
  } else {
    query = supabase
      .from("lead_import_items")
      .select("id, import_id, client_id, lead_id, telefone, normalized_data, created_at")
      .eq("client_id", clientId)
      .eq("imported", true)
      .not("telefone", "is", null)
      .order("created_at", { ascending: false });

    if (importId) {
      query = query.eq("import_id", importId);
    }
  }

  if (limit && Number.isInteger(limit) && limit > 0 && !segmentation && !excludeDispatchId && (!offset || offset === 0)) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const leads = Array.from(
    new Map(
      (data || [])
        .map((item) => {
          const isCrm = importId === "__crm__";
          const normalizedData = isCrm
            ? item
            : (item.normalized_data && typeof item.normalized_data === "object" ? item.normalized_data : {});

          return {
            id: item.id,
            import_id: isCrm ? "__crm__" : item.import_id,
            client_id: item.client_id,
            lead_id: isCrm ? item.id : (item.lead_id || null),
            telefone: sanitizePhone(item.telefone),
            normalized_data: normalizedData,
            nome: normalizeString(isCrm ? item.nome : normalizedData.nome),
            tipo_cliente: normalizeString(isCrm ? item.tipo_cliente : normalizedData.tipo_cliente),
            faixa_consumo: normalizeString(isCrm ? item.faixa_consumo : normalizedData.faixa_consumo),
            cidade: normalizeString(isCrm ? item.cidade : normalizedData.cidade),
            estado: normalizeString(isCrm ? item.estado : normalizedData.estado),
            status: normalizeString(isCrm ? item.status : normalizedData.status),
            data_hora: normalizeIsoDate(isCrm ? item.created_at : normalizedData.data_hora),
            qualificacao: normalizeString(isCrm ? item.qualificacao : normalizedData.qualificacao),
            created_at: item.created_at,
          };
        })
        .filter((item) => !!item.telefone)
        .filter((item) => segMatcher(item))
        .map((item) => [item.telefone, item])
    ).values()
  );

  // Defeito A: elegibilidade por disparo. Remove da fila todo lead que JÁ tem registro
  // neste disparo (qualquer status: claimed/sent/failed) → já tocado = fora.
  // Escopo é POR DISPARO (excludeDispatchId), não histórico global do lead.
  let eligibleLeads = leads;
  if (excludeDispatchId) {
    const { data: touchedRows, error: touchedError } = await supabase
      .from("campaign_dispatch_runs")
      .select("lead_id")
      .eq("dispatch_id", excludeDispatchId);
    if (touchedError) {
      throw touchedError;
    }
    const touchedLeadIds = new Set(
      (touchedRows || [])
        .map((row) => row.lead_id)
        .filter((id) => id != null)
    );
    if (touchedLeadIds.size > 0) {
      eligibleLeads = leads.filter((lead) => !touchedLeadIds.has(lead.id));
    }
  }

  if (limit && Number.isInteger(limit) && limit > 0) {
    const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    return eligibleLeads.slice(start, start + limit);
  }

  return eligibleLeads;
}

/**
 * Monta a lista de telefones a gravar em `campaigns.phones` (os usados no disparo Evolution).
 * Prioriza o resumo do dispatch (mesmos valores do payload HTTP) para manter `campaigns.phones`
 * alinhado mesmo que os objetos lead usem nomes de campo alternativos ou normalização diferente.
 */
function resolveCampaignPhonesForRow(leads, dispatchSummary) {
  const fromSummary = Array.isArray(dispatchSummary?.successPhones)
    ? dispatchSummary.successPhones.filter((p) => typeof p === "string" && p.trim())
    : [];
  const fromLeads = Array.isArray(leads)
    ? leads
      .map((lead) => lead?.telefone || lead?.phone || lead?.number)
      .filter((p) => typeof p === "string" && p.trim())
    : [];

  return [...new Set(
    [...fromLeads, ...fromSummary]
      .map(String)
      .filter((p) => /^\+?\d{8,15}$/.test(p.replace(/[\s\-().]/g, "")))
  )];
}

async function startNextCampaignLeadInQueue({ campaign, clientId, repliedAt = null }) {
  if (!supabase || !campaign?.id || !clientId) {
    return { started: false, reason: "missing_context" };
  }

  const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
  const steps = analyticsMeta.sequence.filter((step) => step.enabled);
  if (analyticsMeta.dispatchOptions?.waitForReply !== true || steps.length === 0) {
    return { started: false, reason: "campaign_not_wait_for_reply" };
  }

  const allLeads = await buildDispatchLeads({
    clientId,
    importId: campaign.import_id || null,
    limit: campaign.limit_per_run,
    segmentation: analyticsMeta.segmentation || null,
  });

  const { data: importItems, error: importItemsError } = await supabase
    .from("lead_import_items")
    .select("id, telefone, normalized_data")
    .eq("client_id", clientId)
    .eq("import_id", campaign.import_id || null);

  if (importItemsError) throw importItemsError;
  const itemByPhone = new Map(
    (importItems || [])
      .map((item) => [sanitizePhone(item.telefone), item])
      .filter(([phone]) => Boolean(phone))
  );

  const nextLead = allLeads.find((lead) => {
    const phone = sanitizePhone(lead.telefone);
    const item = itemByPhone.get(phone);
    const progress = extractCampaignProgress(item?.normalized_data || {}, campaign.id);
    return Object.keys(progress).length === 0;
  });

  if (!nextLead) {
    logCampaignReplyFlow("info", "queue_no_next_lead", {
      clientId,
      campaignId: campaign.id,
    });
    return { started: false, reason: "no_next_lead" };
  }

  const dispatchSettings = await resolveCampaignDispatchSettings(clientId, campaign);
  const { webhookUrl, webhookToken } = dispatchSettings;
  logCampaignDispatch("info", "settings_resolved", {
    clientId,
    campaignId: campaign.id,
    mode: "campaign_queue_progression",
    ...getSafeDispatchSettingsLog(dispatchSettings),
    usingCachedCampaignSettings: dispatchSettings.usingCachedCampaignSettings,
    tenantSettingsSource: dispatchSettings.tenantSettingsSource,
  });
  if (!webhookUrl) throw new Error("Configure uma URL ativa de disparo Evolution para esta empresa");
  await checkEvolutionInstanceHealth({
    webhookUrl,
    webhookToken,
    context: {
      clientId,
      campaignId: campaign.id,
      mode: "campaign_queue_progression",
    },
  });

  const firstStep = steps[0];
  const targetItem = itemByPhone.get(sanitizePhone(nextLead.telefone)) || null;
  const clientName = await getClientName(clientId);

  const { summary } = await dispatchCampaignSequence({
    webhookUrl,
    webhookToken,
    leads: [nextLead],
    analyticsMeta: {
      ...analyticsMeta,
      sequence: [firstStep],
      dispatchOptions: {
        ...analyticsMeta.dispatchOptions,
        waitForReply: false,
        leadDelaySeconds: 0,
      },
    },
    context: {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        mode: "campaign_queue_progression",
      },
      client: { id: clientId, name: clientName },
    },
    waitForReplyMode: "block_next_lead",
  });

  if (summary.successCount > 0 && targetItem?.id) {
    logCampaignReplyFlow("info", "queue_next_lead_started", {
      clientId,
      campaignId: campaign.id,
      phone: maskPhoneForLog(nextLead.telefone),
      stepId: firstStep?.id || null,
      stepType: firstStep?.type || null,
    });
    await markCampaignLeadWaitingReply({
      clientId,
      lead: { id: targetItem.id, nome: nextLead.nome },
      phone: sanitizePhone(nextLead.telefone),
      campaign,
      step: firstStep,
      stepIndex: 0,
      totalSteps: steps.length,
      dispatchedAt: new Date().toISOString(),
      userRepliedAt: repliedAt || undefined,
    });
  }

  return {
    started: summary.successCount > 0,
    phone: sanitizePhone(nextLead.telefone),
    summary,
  };
}

function extractCampaignProgress(rawNormalizedData = {}, campaignId = null) {
  const data = rawNormalizedData && typeof rawNormalizedData === "object" ? rawNormalizedData : {};
  const state = data.campaign_progress && typeof data.campaign_progress === "object"
    ? data.campaign_progress
    : {};

  if (!campaignId) return state;
  return state[campaignId] && typeof state[campaignId] === "object" ? state[campaignId] : {};
}

function mergeCampaignProgress(rawNormalizedData = {}, campaignId, progressPatch = {}) {
  const data = rawNormalizedData && typeof rawNormalizedData === "object" ? rawNormalizedData : {};
  const campaignProgress =
    data.campaign_progress && typeof data.campaign_progress === "object"
      ? { ...data.campaign_progress }
      : {};
  const current =
    campaignProgress[campaignId] && typeof campaignProgress[campaignId] === "object"
      ? campaignProgress[campaignId]
      : {};

  campaignProgress[campaignId] = {
    ...current,
    ...progressPatch,
  };

  return {
    ...data,
    campaign_progress: campaignProgress,
  };
}

async function updateLeadImportItemCampaignProgress({
  clientId,
  leadImportItemId,
  campaignId,
  progressPatch = {},
  statusConversa = undefined,
  ultimaInteracaoBot = undefined,
  ultimaInteracaoUsuario = undefined,
}) {
  if (!supabase || !clientId || !leadImportItemId || !campaignId) return null;

  const { data: item, error: fetchError } = await supabase
    .from("lead_import_items")
    .select("id, normalized_data")
    .eq("client_id", clientId)
    .eq("id", leadImportItemId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!item) return null;

  const updatePayload = {
    normalized_data: mergeCampaignProgress(item.normalized_data || {}, campaignId, progressPatch),
  };
  if (statusConversa !== undefined) updatePayload.status_conversa = statusConversa;
  if (ultimaInteracaoBot !== undefined) updatePayload.ultima_interacao_bot = ultimaInteracaoBot;
  if (ultimaInteracaoUsuario !== undefined) updatePayload.ultima_interacao_usuario = ultimaInteracaoUsuario;

  const { data: updated, error: updateError } = await supabase
    .from("lead_import_items")
    .update(updatePayload)
    .eq("client_id", clientId)
    .eq("id", leadImportItemId)
    .select("id, normalized_data, status_conversa, ultima_interacao_bot, ultima_interacao_usuario")
    .maybeSingle();

  if (updateError && isMissingSchemaError(updateError)) {
    logCampaignReplyFlow("warn", "conversation_columns_missing_import_item_fallback", {
      clientId,
      leadImportItemId,
      campaignId,
      error: updateError.message || updateError.code || "missing_schema",
    });
    const fallback = await supabase
      .from("lead_import_items")
      .update({ normalized_data: updatePayload.normalized_data })
      .eq("client_id", clientId)
      .eq("id", leadImportItemId)
      .select("id, normalized_data")
      .maybeSingle();

    if (fallback.error) throw fallback.error;
    return fallback.data
      ? {
          ...fallback.data,
          status_conversa: null,
          ultima_interacao_bot: null,
          ultima_interacao_usuario: null,
        }
      : null;
  }

  if (updateError) throw updateError;
  return updated;
}

async function updateLeadConversationState({
  clientId,
  phone,
  statusConversa,
  ultimaInteracaoBot = undefined,
  ultimaInteracaoUsuario = undefined,
}) {
  if (!supabase || !clientId || !phone || !statusConversa) return;

  const leadUpdatePayload = { status_conversa: statusConversa };
  if (ultimaInteracaoBot !== undefined) leadUpdatePayload.ultima_interacao_bot = ultimaInteracaoBot;
  if (ultimaInteracaoUsuario !== undefined) leadUpdatePayload.ultima_interacao_usuario = ultimaInteracaoUsuario;

  const { error } = await supabase
    .from(leadsTableName(clientId))
    .update(leadUpdatePayload)
    .eq("client_id", clientId)
    .eq("telefone", phone);

  if (error && isMissingSchemaError(error)) {
    logCampaignReplyFlow("warn", "conversation_columns_missing_leads_fallback", {
      clientId,
      phone: maskPhoneForLog(phone),
      statusConversa,
      error: error.message || error.code || "missing_schema",
    });
    return;
  }

  if (error) throw error;
}

/**
 * Coerce campaign timestamps from Postgres (Date) or JSON/API (string) into a stable string
 * for localeCompare-based sorting. Plain Date objects do not implement localeCompare.
 */
function toComparableCampaignTimestamp(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? "" : value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * JSON/Postgres may yield step indexes as strings; Number.isInteger("2") is false and would skip reply continuation.
 */
function normalizeCampaignPendingStepIndex(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return null;
  const intVal = Math.trunc(n);
  return intVal >= 0 ? intVal : null;
}

function resolveMatchedImportItemForCampaign(importItems, campaign) {
  if (!Array.isArray(importItems) || importItems.length === 0) return null;
  const importIdNorm = normalizeString(campaign.import_id);

  if (importIdNorm) {
    const byImport = importItems.filter((item) => normalizeString(item.import_id) === importIdNorm);
    if (byImport.length === 1) return byImport[0];
    if (byImport.length > 1) {
      // Prefer the row that already holds progress for this campaign (multi-row same phone / reimports).
      const withProgress = byImport.find((item) => {
        const p = extractCampaignProgress(item.normalized_data || {}, campaign.id);
        return p && Object.keys(p).length > 0;
      });
      return withProgress || byImport[0];
    }
    return null;
  }

  const withReplyProgress = importItems.find((item) => {
    const p = extractCampaignProgress(item.normalized_data || {}, campaign.id);
    return (
      p &&
      p.waitForReply === true &&
      p.status === "aguardando_usuario"
    );
  });
  return withReplyProgress || importItems[0] || null;
}

async function findCampaignReplyMatches({ clientId, phone }) {
  if (!supabase || !clientId || !phone) {
    return {
      phone,
      importIds: [],
      matches: [],
      waitForReplyMatches: [],
      processingWaitForReplyMatches: [],
      activePeriodCampaign: null,
    };
  }

  const phoneVariants = buildPhoneLookupVariants(phone);
  if (phoneVariants.length === 0) {
    return {
      phone,
      importIds: [],
      matches: [],
      waitForReplyMatches: [],
      processingWaitForReplyMatches: [],
      activePeriodCampaign: null,
    };
  }

  const now = new Date().toISOString();

  let [importItemsResult, campaignsResult] = await Promise.all([
    supabase
      .from("lead_import_items")
      .select("id, import_id, normalized_data, status_conversa, ultima_interacao_bot, ultima_interacao_usuario, created_at")
      .eq("client_id", clientId)
      .in("telefone", phoneVariants)
      .order("created_at", { ascending: false }),
    supabase
      .from("campaigns")
      .select("id, name, client_id, import_id, status, scheduled_for, last_triggered_at, archived_at, phones, analytics_meta, starts_at, ends_at, chatbot_prompt_type, mode, campaign_prompt_id")
      .eq("client_id", clientId)
      .is("archived_at", null),
  ]);

  if (importItemsResult.error && isMissingSchemaError(importItemsResult.error)) {
    logCampaignReplyFlow("warn", "conversation_columns_missing_reply_match_fallback", {
      clientId,
      phone: maskPhoneForLog(phone),
      error: importItemsResult.error.message || importItemsResult.error.code || "missing_schema",
    });
    const fallback = await supabase
      .from("lead_import_items")
      .select("id, import_id, normalized_data, created_at")
      .eq("client_id", clientId)
      .in("telefone", phoneVariants)
      .order("created_at", { ascending: false });

    importItemsResult = {
      ...fallback,
      data: (fallback.data || []).map((item) => ({
        ...item,
        status_conversa: null,
        ultima_interacao_bot: null,
        ultima_interacao_usuario: null,
      })),
    };
  }

  if (importItemsResult.error) throw importItemsResult.error;
  if (campaignsResult.error) throw campaignsResult.error;

  const importIds = Array.from(
    new Set(
      (importItemsResult.data || [])
        .map((item) => normalizeString(item.import_id))
        .filter(Boolean)
    )
  );
  const importItems = importItemsResult.data || [];

  const matches = (campaignsResult.data || [])
    .map((campaign) => {
      const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
      const storedPhones = Array.isArray(campaign.phones)
        ? campaign.phones.map((value) => sanitizePhone(value)).filter(Boolean)
        : [];
      const phoneSet = new Set(storedPhones);
      const matchedByStoredPhones = phoneVariants.some((variant) => phoneSet.has(variant));
      const matchedByImportId =
        Boolean(campaign.import_id) && importIds.includes(normalizeString(campaign.import_id));
      const matchedImportItem = resolveMatchedImportItemForCampaign(importItems, campaign);

      if (!matchedByStoredPhones && !matchedByImportId) {
        return null;
      }

      const progress = extractCampaignProgress(matchedImportItem?.normalized_data || {}, campaign.id);
      const hasPendingProgress =
        progress &&
        progress.waitForReply === true &&
        progress.status === "aguardando_usuario";

      // Verifica se a campanha está no período ativo (starts_at <= now <= ends_at)
      const startsAt = campaign.starts_at ? new Date(campaign.starts_at) : null;
      const endsAt = campaign.ends_at ? new Date(campaign.ends_at) : null;
      const nowDate = new Date(now);
      const isInActivePeriod =
        (!startsAt || nowDate >= startsAt) &&
        (!endsAt || nowDate <= endsAt);

      return {
        id: campaign.id,
        name: campaign.name,
        clientId: campaign.client_id,
        importId: campaign.import_id || null,
        status: campaign.status || null,
        scheduledFor: campaign.scheduled_for || null,
        lastTriggeredAt: campaign.last_triggered_at || null,
        waitForReply: analyticsMeta.dispatchOptions?.waitForReply === true,
        hasPendingProgress,
        analyticsMeta,
        isInActivePeriod,
        mode: campaign.mode || null,
        campaignPromptId: campaign.campaign_prompt_id || null,
        chatbotPromptType: campaign.chatbot_prompt_type || null,
        startsAt: campaign.starts_at || null,
        endsAt: campaign.ends_at || null,
        matchSource: matchedByStoredPhones && matchedByImportId ? "phones_and_import" : matchedByStoredPhones ? "phones" : "import",
        leadImportItem: matchedImportItem
          ? {
            id: matchedImportItem.id,
            importId: matchedImportItem.import_id || null,
            nome: normalizeString(matchedImportItem.normalized_data?.nome) || null,
            statusConversa: matchedImportItem.status_conversa || null,
            ultimaInteracaoBot: matchedImportItem.ultima_interacao_bot || null,
            ultimaInteracaoUsuario: matchedImportItem.ultima_interacao_usuario || null,
            progress,
          }
          : null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      // Campanhas em período ativo têm prioridade
      if (left.isInActivePeriod !== right.isInActivePeriod) return left.isInActivePeriod ? -1 : 1;
      const leftPending = left.hasPendingProgress ? 0 : 1;
      const rightPending = right.hasPendingProgress ? 0 : 1;
      if (leftPending !== rightPending) return leftPending - rightPending;
      const leftScore = left.status === "processing" ? 0 : left.waitForReply ? 1 : 2;
      const rightScore = right.status === "processing" ? 0 : right.waitForReply ? 1 : 2;
      if (leftScore !== rightScore) return leftScore - rightScore;
      const leftDate = toComparableCampaignTimestamp(left.lastTriggeredAt || left.scheduledFor);
      const rightDate = toComparableCampaignTimestamp(right.lastTriggeredAt || right.scheduledFor);
      return rightDate.localeCompare(leftDate);
    });

  const waitForReplyMatches = matches.filter((campaign) => campaign.waitForReply);
  const processingWaitForReplyMatches = waitForReplyMatches.filter((campaign) => campaign.hasPendingProgress === true);

  // Campanha com período ativo que contém este telefone — define qual prompt usar
  const activePeriodCampaign = matches.find((c) => c.isInActivePeriod) || null;

  return {
    phone,
    importIds,
    matches,
    waitForReplyMatches,
    processingWaitForReplyMatches,
    activePeriodCampaign,
  };
}

function buildCampaignWebhookPayload({ campaign, clientName, leads, triggerSource = "manual" }) {
  const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta);
  const message = normalizeString(analyticsMeta.message);
  const image = analyticsMeta.image && typeof analyticsMeta.image === "object" ? analyticsMeta.image : null;

  return {
    source: "vexocrm",
    action: "campaign_dispatch",
    triggerSource,
    campaignId: campaign.id,
    campaignName: campaign.name,
    userId: campaign.created_by_uid || null,
    requestedBy: {
      uid: campaign.created_by_uid || null,
      email: campaign.created_by_email || null,
    },
    requestedAt: new Date().toISOString(),
    scheduledFor: campaign.scheduled_for || null,
    client: { id: campaign.client_id, name: clientName },
    importId: campaign.import_id || null,
    limit: campaign.limit_per_run,
    segmentation: analyticsMeta.segmentation || null,
    message,
    image,
    media: image
      ? {
          kind: "image",
          name: image.name || "campanha",
          mimeType: image.type || "image/jpeg",
          size: image.size || null,
          dataUrl: image.dataUrl || null,
        }
      : null,
    total: leads.length,
    phones: leads.map((lead) => lead.telefone),
    leads: leads.map((lead) => ({
      id: lead.id,
      telefone: lead.telefone,
      nome: lead.nome,
      cidade: lead.cidade,
      estado: lead.estado,
      status: lead.status,
      tipo_cliente: lead.tipo_cliente,
      faixa_consumo: lead.faixa_consumo,
      qualificacao: lead.qualificacao,
      data_hora: lead.data_hora,
      created_at: lead.created_at,
    })),
  };
}

async function insertCampaignDispatchLog({
  campaign,
  status,
  triggerSource,
  message = null,
  payload = null,
  n8nResponse = null,
  error = null,
  totalLeads = null,
  webhookStatus = null,
}) {
  if (!supabase || !campaign?.id) return;

  const { error: insertError } = await supabase.from("campaign_dispatch_logs").insert({
    campaign_id: campaign.id,
    client_id: campaign.client_id,
    status,
    trigger_source: triggerSource,
    message,
    total_leads: totalLeads,
    webhook_status: webhookStatus,
    payload,
    n8n_response: n8nResponse,
    error_message: error,
  });

  if (insertError && !isMissingSchemaError(insertError)) {
    console.error("campaign dispatch log insert error:", insertError);
  }
}

function canCampaignBeDispatched(status) {
  return ["active", "draft", "scheduled", "failed"].includes(normalizeString(status));
}

async function claimCampaignForDispatch(campaign, triggerSource) {
  const now = new Date().toISOString();
  const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta);
  const processingMeta = {
    ...analyticsMeta,
    dispatch: {
      ...normalizeCampaignAnalyticsMeta(analyticsMeta.dispatch),
      status: "processing",
      triggerSource,
      startedAt: now,
      updatedAt: now,
      error: null,
    },
  };

  let { data, error } = await supabase
    .from("campaigns")
    .update({
      status: "processing",
      analytics_meta: processingMeta,
    })
    .eq("id", campaign.id)
    .is("last_triggered_at", null)
    .in("status", ["active", "draft", "scheduled", "failed"])
    .select("id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, analytics_meta")
    .maybeSingle();

  if (error && isMissingSchemaError(error)) {
    const fallback = await supabase
      .from("campaigns")
      .update({ status: "processing" })
      .eq("id", campaign.id)
      .is("last_triggered_at", null)
      .in("status", ["active", "draft", "scheduled", "failed"])
      .select("id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email")
      .maybeSingle();
    data = fallback.data ? { ...fallback.data, analytics_meta: processingMeta } : fallback.data;
    error = fallback.error;
  }

  if (error) {
    throw error;
  }

  if (!data) {
    const lockError = new Error("Campaign is already processing or already sent");
    lockError.statusCode = 409;
    lockError.code = "CAMPAIGN_ALREADY_LOCKED";
    throw lockError;
  }

  await insertCampaignDispatchLog({
    campaign: data,
    status: "processing",
    triggerSource,
    message: "Campanha entrou em processamento.",
  });

  return data;
}

async function markCampaignDispatchFailed(campaign, { triggerSource, error, webhookStatus = null }) {
  const now = new Date().toISOString();
  const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const nextMeta = {
    ...analyticsMeta,
    dispatch: {
      ...normalizeCampaignAnalyticsMeta(analyticsMeta.dispatch),
      status: "failed",
      triggerSource,
      error: errorMessage,
      failedAt: now,
      updatedAt: now,
      webhookStatus,
    },
  };

  let { error: updateError } = await supabase
    .from("campaigns")
    .update({
      status: "failed",
      analytics_meta: nextMeta,
    })
    .eq("id", campaign.id);

  if (updateError && isMissingSchemaError(updateError)) {
    const fallback = await supabase
      .from("campaigns")
      .update({ status: "failed" })
      .eq("id", campaign.id);
    updateError = fallback.error;
  }

  if (updateError) {
    console.error("campaign failed state update error:", updateError);
  }

  await insertCampaignDispatchLog({
    campaign,
    status: "failed",
    triggerSource,
    message: "Falha ao disparar campanha.",
    error: errorMessage,
    webhookStatus,
  });
}

async function executeCampaignDispatch(campaign, { triggerSource = "manual" } = {}) {
  if (!supabase) {
    throw new Error("Database is not configured");
  }

  if (!campaign) {
    const error = new Error("Campaign not found");
    error.statusCode = 404;
    error.code = "CAMPAIGN_NOT_FOUND";
    throw error;
  }

  if (!canCampaignBeDispatched(campaign.status)) {
    const error = new Error(`Campaign cannot be dispatched from status ${campaign.status}`);
    error.statusCode = 400;
    error.code = "CAMPAIGN_NOT_DISPATCHABLE";
    throw error;
  }

  if (campaign.archived_at) {
    const error = new Error("Campaign is archived");
    error.statusCode = 400;
    error.code = "CAMPAIGN_ARCHIVED";
    throw error;
  }

  const claimedCampaign = await claimCampaignForDispatch(campaign, triggerSource);
  const analyticsMeta = normalizeCampaignAnalyticsMeta(claimedCampaign.analytics_meta);
  const leads = await buildDispatchLeads({
    clientId: claimedCampaign.client_id,
    importId: claimedCampaign.import_id || null,
    limit: claimedCampaign.limit_per_run,
    segmentation: analyticsMeta.segmentation || null,
  });

  if (leads.length === 0) {
    const error = new Error("No leads found for this campaign");
    error.statusCode = 404;
    error.code = "NO_DISPATCH_LEADS";
    await markCampaignDispatchFailed(claimedCampaign, { triggerSource, error });
    throw error;
  }

  const clientName = await getClientName(claimedCampaign.client_id);

  // Campaign dispatch uses the same Evolution pipeline as POST /api/campaigns/direct-dispatch:
  // - URL/token from tenant settings (resolveDispatchWebhookSettings), optionally cached on the row.
  // - Per-lead execution via dispatchCampaignSequence: step order, delayAfterSeconds between steps,
  //   leadDelaySeconds between leads, waitForReply / reply timeouts from analytics_meta.dispatchOptions.
  // Always use the same Evolution endpoint as direct dispatch (tenant settings), not the global n8n webhook env.
  const dispatchSettings = await resolveCampaignDispatchSettings(claimedCampaign.client_id, claimedCampaign);
  const { webhookUrl, webhookToken } = dispatchSettings;
  logCampaignDispatch("info", "settings_resolved", {
    clientId: claimedCampaign.client_id,
    campaignId: claimedCampaign.id,
    campaignName: claimedCampaign.name,
    triggerSource,
    mode: "campaign_dispatch",
    ...getSafeDispatchSettingsLog(dispatchSettings),
    usingCachedCampaignSettings: dispatchSettings.usingCachedCampaignSettings,
    tenantSettingsSource: dispatchSettings.tenantSettingsSource,
  });
  if (!webhookUrl) {
    const error = new Error("Configure uma URL ativa de disparo Evolution para esta empresa");
    error.statusCode = 400;
    error.code = "EVOLUTION_SETTINGS_MISSING";
    await markCampaignDispatchFailed(claimedCampaign, { triggerSource, error });
    throw error;
  }

  try {
    await checkEvolutionInstanceHealth({
      webhookUrl,
      webhookToken,
      context: {
        clientId: claimedCampaign.client_id,
        campaignId: claimedCampaign.id,
        campaignName: claimedCampaign.name,
        triggerSource,
        mode: "campaign_dispatch",
      },
    });
  } catch (error) {
    await markCampaignDispatchFailed(claimedCampaign, {
      triggerSource,
      error,
      webhookStatus: error?.statusCode || 502,
    });
    throw error;
  }

  const stepPlan = getCampaignStepPlan(claimedCampaign.analytics_meta);
  const meta = stepPlan.analyticsMeta;
  const waitForReply = stepPlan.shouldUseReplyFlow;
  const keepCampaignProcessing = waitForReply;
  const leadsToDispatch = leads;
  const immediateSteps = waitForReply ? stepPlan.immediateSteps : stepPlan.enabledSteps;
  const firstReplyStepIndex = waitForReply ? (stepPlan.replySteps[0]?.index ?? null) : null;

  if (waitForReply && immediateSteps.length === 0) {
    const error = new Error("Campanhas com resposta avancada precisam de pelo menos um passo imediato antes da resposta.");
    error.statusCode = 400;
    error.code = "CAMPAIGN_REPLY_FLOW_INVALID";
    await markCampaignDispatchFailed(claimedCampaign, { triggerSource, error });
    throw error;
  }

  let dispatchSummary = null;
  let webhookStatus = null;
  try {
    const { summary } = await dispatchCampaignSequence({
      webhookUrl,
      webhookToken,
      leads: leadsToDispatch,
      analyticsMeta: {
        ...meta,
        sequence: immediateSteps,
      },
      context: {
        campaign: {
          id: claimedCampaign.id,
          name: claimedCampaign.name,
          mode: "campaign_dispatch",
          triggerSource,
        },
        client: { id: claimedCampaign.client_id, name: clientName },
      },
      onLeadDispatched: async ({ lead, phone, sentAt, lastStep, lastStepIndex }) => {
        if (waitForReply) {
          await markCampaignLeadWaitingReply({
            clientId: claimedCampaign.client_id,
            lead,
            phone,
            campaign: claimedCampaign,
            step: lastStep,
            stepIndex: Number.isInteger(lastStepIndex) ? lastStepIndex : immediateSteps.length - 1,
            totalSteps: stepPlan.enabledSteps.length,
            dispatchedAt: sentAt || new Date().toISOString(),
            nextStepIndex: firstReplyStepIndex,
            status: "aguardando_usuario",
          });
        } else {
          // Campanha sem resposta: marcar como "em_atendimento" e depois "finalizado"
          await updateLeadConversationState({
            clientId: claimedCampaign.client_id,
            phone,
            statusConversa: "finalizado",
            ultimaInteracaoBot: sentAt || new Date().toISOString(),
          });
          if (lead?.id) {
            const progressPatch = {
              campaignId: claimedCampaign.id,
              campaignName: claimedCampaign.name || null,
              leadName: normalizeString(lead?.nome) || null,
              status: "finalizado",
              leadStatus: "sequencia_concluida",
              currentStepIndex: Number.isInteger(lastStepIndex) ? lastStepIndex : immediateSteps.length - 1,
              nextStepIndex: null,
              totalSteps: stepPlan.enabledSteps.length,
              updatedAt: sentAt || new Date().toISOString(),
              completedAt: sentAt || new Date().toISOString(),
            };
            await updateLeadImportItemCampaignProgress({
              clientId: claimedCampaign.client_id,
              leadImportItemId: lead.id,
              campaignId: claimedCampaign.id,
              progressPatch,
              statusConversa: "finalizado",
              ultimaInteracaoBot: sentAt || new Date().toISOString(),
            });
          }
        }
      },
    });
    dispatchSummary = summary;

    if (summary.successCount <= 0) {
      const firstReason = summary.failures[0]?.reason || "Evolution dispatch returned no successful sends";
      const error = new Error(firstReason);
      error.statusCode = 502;
      error.code = "EVOLUTION_TRIGGER_FAILED";
      await markCampaignDispatchFailed(claimedCampaign, { triggerSource, error, webhookStatus: 502 });
      throw error;
    }
    webhookStatus = 200;
  } catch (error) {
    if (error?.code !== "EVOLUTION_TRIGGER_FAILED") {
      await markCampaignDispatchFailed(claimedCampaign, { triggerSource, error, webhookStatus });
    }
    throw error;
  }

  const auditPayload = buildCampaignWebhookPayload({
    campaign: claimedCampaign,
    clientName,
    leads: leadsToDispatch,
    triggerSource,
  });
  const completedAt = new Date().toISOString();
  const nextAnalyticsMeta = {
    ...analyticsMeta,
    dispatch: {
      ...normalizeCampaignAnalyticsMeta(analyticsMeta.dispatch),
      status: keepCampaignProcessing ? "processing" : "sent",
      triggerSource,
      total: leadsToDispatch.length,
      successCount: dispatchSummary?.successCount ?? null,
      failureCount: dispatchSummary?.failureCount ?? null,
      webhookStatus,
      provider: "evolution",
      evolutionSummary: null,
      n8nResponse: null,
      sentAt: completedAt,
      updatedAt: completedAt,
    },
  };

  const phonesForRow = resolveCampaignPhonesForRow(leadsToDispatch, dispatchSummary);

  let { error: updateError } = await supabase
    .from("campaigns")
    .update({
      status: keepCampaignProcessing ? "processing" : "sent",
      last_triggered_at: completedAt,
      scheduled_for: null,
      phones: phonesForRow,
      analytics_meta: nextAnalyticsMeta,
    })
    .eq("id", campaign.id);

  if (updateError && isMissingSchemaError(updateError)) {
    const fallback = await supabase
      .from("campaigns")
      .update({
        status: keepCampaignProcessing ? "processing" : "sent",
        last_triggered_at: completedAt,
        scheduled_for: null,
        phones: phonesForRow,
      })
      .eq("id", campaign.id);
    updateError = fallback.error;
  }

  if (updateError) {
    throw updateError;
  }

  await insertCampaignDispatchLog({
    campaign: claimedCampaign,
    status: keepCampaignProcessing ? "processing" : "sent",
    triggerSource,
    message: keepCampaignProcessing
      ? "Campanha iniciou o fluxo com espera por resposta do lead."
      : "Campanha enviada via Evolution com sucesso.",
    payload: auditPayload,
    n8nResponse: dispatchSummary && typeof dispatchSummary === "object"
      ? JSON.stringify(dispatchSummary).slice(0, 8000)
      : null,
    totalLeads: leadsToDispatch.length,
    webhookStatus,
  });

  return {
    success: true,
    campaignId: claimedCampaign.id,
    campaignName: claimedCampaign.name,
    webhookUrl,
    total: leadsToDispatch.length,
    phones: auditPayload.phones,
    payload: auditPayload,
    n8nResponse: null,
  };
}

function getCampaignRunnerIntervalMs() {
  const raw = Number.parseInt(String(process.env.CAMPAIGN_RUNNER_INTERVAL_MS || ""), 10);
  if (Number.isFinite(raw) && raw >= 15_000) return raw;
  return DEFAULT_CAMPAIGN_RUNNER_INTERVAL_MS;
}

function shouldStartCampaignScheduler() {
  return String(process.env.CAMPAIGN_SCHEDULER_ENABLED || "true").toLowerCase() !== "false";
}

let campaignSchedulerRunning = false;

async function runDueCampaignDispatches({ limit = 10, triggerSource = "scheduler" } = {}) {
  if (!supabase) {
    return { success: false, processed: 0, sent: 0, failed: 0, items: [], reason: "DATABASE_NOT_CONFIGURED" };
  }

  const now = new Date().toISOString();
  const campaignSelect =
    "id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, analytics_meta";
  const fallbackCampaignSelect =
    "id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email";

  let { data: campaigns, error } = await supabase
    .from("campaigns")
    .select(campaignSelect)
    .in("status", ["active", "scheduled"])
    .is("archived_at", null)
    .is("last_triggered_at", null)
    .not("scheduled_for", "is", null)
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (error && isMissingSchemaError(error)) {
    const fallback = await supabase
      .from("campaigns")
      .select(fallbackCampaignSelect)
      .in("status", ["active", "scheduled"])
      .is("archived_at", null)
      .is("last_triggered_at", null)
      .not("scheduled_for", "is", null)
      .lte("scheduled_for", now)
      .order("scheduled_for", { ascending: true })
      .limit(limit);
    campaigns = fallback.data;
    error = fallback.error;
  }

  if (error) {
    throw error;
  }

  const items = [];
  for (const campaign of campaigns || []) {
    try {
      const result = await executeCampaignDispatch(campaign, { triggerSource });
      items.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        status: "sent",
        total: result.total,
      });
    } catch (error) {
      items.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      console.error("scheduled campaign dispatch error:", campaign.id, error);
    }
  }

  return {
    success: true,
    processed: items.length,
    sent: items.filter((item) => item.status === "sent").length,
    failed: items.filter((item) => item.status === "failed").length,
    items,
  };
}

async function tickCampaignScheduler() {
  if (campaignSchedulerRunning) return;
  campaignSchedulerRunning = true;
  try {
    const result = await runDueCampaignDispatches({ triggerSource: "scheduler" });
    if (result.processed > 0) {
      console.log("[campaign-scheduler] processed due campaigns", result);
    }
  } catch (error) {
    console.error("[campaign-scheduler] failed to process due campaigns:", error);
    const msg = String(error?.message || error || "");
    if (/timeout|terminated|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
      console.warn(
        "[campaign-scheduler] DB connectivity hint: from Docker, DATABASE_URL must reach Postgres (firewall, correct host/IP; avoid 127.0.0.1 for DB on the host unless using host network). Increase PG_CONNECTION_TIMEOUT_MS if the link is slow."
      );
    }
  } finally {
    campaignSchedulerRunning = false;
  }
}

function startCampaignScheduler() {
  if (!shouldStartCampaignScheduler()) {
    console.log("[campaign-scheduler] disabled by CAMPAIGN_SCHEDULER_ENABLED=false");
    return;
  }

  const intervalMs = getCampaignRunnerIntervalMs();
  console.log(`[campaign-scheduler] enabled; checking due campaigns every ${intervalMs}ms`);
  setTimeout(() => {
    void tickCampaignScheduler();
  }, 15_000);
  setInterval(() => {
    void tickCampaignScheduler();
  }, intervalMs);
}

async function markCampaignLeadWaitingReply({
  clientId,
  lead,
  phone,
  campaign,
  step,
  stepIndex,
  totalSteps,
  dispatchedAt,
  nextStepIndex = undefined,
  status = undefined,
  userRepliedAt = undefined,
}) {
  if (!supabase || !clientId || !phone) return;

  const hasNextStep =
    nextStepIndex !== undefined
      ? Number.isInteger(nextStepIndex) && nextStepIndex >= 0
      : Number.isInteger(stepIndex) && Number.isInteger(totalSteps) && stepIndex < totalSteps - 1;
  const normalizedStatus = status || (hasNextStep ? "aguardando_usuario" : "finalizado");
  const statusConversa = normalizedStatus === "finalizado" ? "finalizado" : "aguardando_usuario";
  const storedUserTimestamp = userRepliedAt || undefined;
  const progressPatch = campaign?.id
    ? {
      campaignId: campaign.id,
      campaignName: campaign.name || null,
      leadName: normalizeString(lead?.nome) || null,
      waitForReply: true,
      currentStepIndex: stepIndex,
      currentStepOrder: step?.order ?? stepIndex + 1,
      currentStepId: step?.id || null,
      nextStepIndex: hasNextStep ? (nextStepIndex ?? stepIndex + 1) : null,
      totalSteps,
      status: normalizedStatus,
      leadStatus:
        normalizedStatus === "finalizado"
          ? "sequencia_concluida"
          : "aguardando_resposta",
      updatedAt: dispatchedAt,
      completedAt: normalizedStatus === "finalizado" ? dispatchedAt : null,
      lastReplyAt: userRepliedAt || null,
    }
    : null;

  if (lead?.id && campaign?.id && progressPatch) {
    await updateLeadImportItemCampaignProgress({
      clientId,
      leadImportItemId: lead.id,
      campaignId: campaign.id,
      progressPatch,
      statusConversa,
      ultimaInteracaoBot: dispatchedAt,
      ultimaInteracaoUsuario: storedUserTimestamp,
    });
  } else {
    const updatePayload = {
      status_conversa: statusConversa,
      ultima_interacao_bot: dispatchedAt,
    };
    if (storedUserTimestamp !== undefined) {
      updatePayload.ultima_interacao_usuario = storedUserTimestamp;
    }
    const { error } = await supabase
      .from("lead_import_items")
      .update(updatePayload)
      .eq("client_id", clientId)
      .eq("telefone", phone);
    if (error) throw error;
  }

  await updateLeadConversationState({
    clientId,
    phone,
    statusConversa,
    ultimaInteracaoBot: dispatchedAt,
    ultimaInteracaoUsuario: storedUserTimestamp,
  });
}

function buildCampaignAutomationHeaders(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.apikey = token;
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function callCampaignQualificationWebhook({
  clientId,
  campaign,
  lead,
  phone,
  repliedAt,
  replyPayload = {},
  summary = null,
}) {
  const settings = resolveEnvCampaignQualificationWebhookSettings(clientId);
  if (!settings?.webhookUrl || settings.invalid) {
    logCampaignReplyFlow(settings?.invalid ? "warn" : "info", "n8n_qualification_skipped", {
      clientId,
      campaignId: campaign?.id || null,
      phone: maskPhoneForLog(phone),
      reason: settings?.invalid ? "invalid_webhook_url" : "missing_webhook_url",
      source: settings?.source || "missing",
    });
    return {
      called: false,
      ok: false,
      skipped: true,
      reason: settings?.invalid ? "invalid_webhook_url" : "missing_webhook_url",
      source: settings?.source || "missing",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  const payload = {
    action: "campaign_sequence_completed",
    source: "vexocrm",
    clientId,
    campaign: {
      id: campaign?.id || null,
      name: campaign?.name || null,
      importId: campaign?.import_id || null,
    },
    lead: {
      id: lead?.id || null,
      name: normalizeString(lead?.nome || lead?.name) || null,
      phone,
    },
    reply: {
      repliedAt,
      text:
        normalizeString(replyPayload?.message || replyPayload?.text || replyPayload?.body || replyPayload?.data?.message?.conversation) ||
        null,
      raw: replyPayload || null,
    },
    sequence: {
      status: "sequencia_concluida",
      summary,
    },
  };

  try {
    logCampaignReplyFlow("info", "n8n_qualification_started", {
      clientId,
      campaignId: campaign?.id || null,
      phone: maskPhoneForLog(phone),
      source: settings.source,
    });

    const response = await fetch(settings.webhookUrl, {
      method: "POST",
      headers: buildCampaignAutomationHeaders(settings.webhookToken),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(body ? `HTTP ${response.status}: ${body.slice(0, 500)}` : `HTTP ${response.status}`);
    }

    logCampaignReplyFlow("info", "n8n_qualification_finished", {
      clientId,
      campaignId: campaign?.id || null,
      phone: maskPhoneForLog(phone),
      status: response.status,
    });

    return {
      called: true,
      ok: true,
      skipped: false,
      status: response.status,
      body: body || null,
      source: settings.source,
    };
  } catch (error) {
    const reason =
      error?.name === "AbortError"
        ? "Timeout ao chamar webhook de qualificacao n8n."
        : error instanceof Error
          ? error.message
          : "Falha ao chamar webhook de qualificacao n8n.";
    logCampaignReplyFlow("warn", "n8n_qualification_failed", {
      clientId,
      campaignId: campaign?.id || null,
      phone: maskPhoneForLog(phone),
      reason,
    });
    return {
      called: true,
      ok: false,
      skipped: false,
      reason,
      source: settings.source,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function continueCampaignLeadFromReply({ clientId, phone, repliedAt, campaignMatch, replyPayload = {} }) {
  if (!supabase || !clientId || !phone || !campaignMatch?.id) {
    return { continued: false, reason: "missing_context" };
  }

  let { data: campaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("id, name, client_id, import_id, webhook_url, webhook_token, status, analytics_meta")
    .eq("id", campaignMatch.id)
    .maybeSingle();

  if (fetchError && isMissingSchemaError(fetchError)) {
    const fallback = await supabase
      .from("campaigns")
      .select("id, name, client_id, import_id, webhook_url, webhook_token, status")
      .eq("id", campaignMatch.id)
      .maybeSingle();
    campaign = fallback.data ? { ...fallback.data, analytics_meta: campaignMatch.analyticsMeta || {} } : fallback.data;
    fetchError = fallback.error;
  }

  if (fetchError) throw fetchError;
  if (!campaign) return { continued: false, reason: "campaign_not_found" };

  const stepPlan = getCampaignStepPlan(campaign.analytics_meta || {});
  const analyticsMeta = stepPlan.analyticsMeta;
  const steps = stepPlan.enabledSteps;
  if (!stepPlan.shouldUseReplyFlow) {
    return { continued: false, reason: "campaign_not_waiting_reply" };
  }
  const leadImportItem = campaignMatch.leadImportItem || null;
  const progress = leadImportItem?.progress || {};
  const nextIdxBase = normalizeCampaignPendingStepIndex(progress.nextStepIndex);
  const hasPendingProgress =
    progress &&
    progress.waitForReply === true &&
    progress.status === "aguardando_usuario" &&
    nextIdxBase !== null;

  if (!hasPendingProgress) {
    return { continued: false, reason: "lead_not_waiting_reply" };
  }

  const nextStepIndex = nextIdxBase;

  if (nextStepIndex >= steps.length) {
    if (leadImportItem?.id) {
      await updateLeadImportItemCampaignProgress({
        clientId,
        leadImportItemId: leadImportItem.id,
        campaignId: campaign.id,
        progressPatch: {
          ...progress,
          status: "finalizado",
          nextStepIndex: null,
          updatedAt: repliedAt,
          lastReplyAt: repliedAt,
        },
        statusConversa: "finalizado",
        ultimaInteracaoUsuario: repliedAt,
      });
    }
    await updateLeadConversationState({
      clientId,
      phone,
      statusConversa: "finalizado",
      ultimaInteracaoUsuario: repliedAt,
    });
    return { continued: false, reason: "campaign_already_complete", finalized: true, campaignId: campaign.id };
  }

  const dispatchSettings = await resolveCampaignDispatchSettings(clientId, campaign);
  const { webhookUrl, webhookToken } = dispatchSettings;
  logCampaignDispatch("info", "settings_resolved", {
    clientId,
    campaignId: campaign.id,
    campaignName: campaign.name,
    mode: "campaign_reply_continuation",
    ...getSafeDispatchSettingsLog(dispatchSettings),
    usingCachedCampaignSettings: dispatchSettings.usingCachedCampaignSettings,
    tenantSettingsSource: dispatchSettings.tenantSettingsSource,
  });
  if (!webhookUrl) {
    throw new Error("Configure uma URL ativa de disparo Evolution para esta empresa");
  }
  await checkEvolutionInstanceHealth({
    webhookUrl,
    webhookToken,
    context: {
      clientId,
      campaignId: campaign.id,
      campaignName: campaign.name,
      mode: "campaign_reply_continuation",
    },
  });

  const lead = {
    id: leadImportItem?.id || null,
    telefone: phone,
    nome: normalizeString(progress.leadName) || normalizeString(leadImportItem?.nome) || "cliente",
  };

  const remainingReplyEntries = steps
    .map((step, index) => ({ step, index }))
    .filter((entry) => entry.index >= nextStepIndex);
  const remainingSteps = remainingReplyEntries.map((entry) => entry.step);
  const finalStepEntry = remainingReplyEntries[remainingReplyEntries.length - 1] || null;
  const finalStep = finalStepEntry?.step || null;
  const finalStepIndex = finalStepEntry?.index ?? nextStepIndex;

  if (remainingSteps.length === 0) {
    if (leadImportItem?.id) {
      await updateLeadImportItemCampaignProgress({
        clientId,
        leadImportItemId: leadImportItem.id,
        campaignId: campaign.id,
        progressPatch: {
          ...progress,
          status: "finalizado",
          nextStepIndex: null,
          updatedAt: repliedAt,
          lastReplyAt: repliedAt,
          completedAt: repliedAt,
        },
        statusConversa: "finalizado",
        ultimaInteracaoUsuario: repliedAt,
      });
    }
    await updateLeadConversationState({
      clientId,
      phone,
      statusConversa: "finalizado",
      ultimaInteracaoUsuario: repliedAt,
    });
    const campaignFinalization = await maybeFinalizeCampaignAfterReply({ campaignId: campaign.id, clientId });
    return {
      continued: false,
      finalized: true,
      campaignFinalized: campaignFinalization.finalized === true,
      campaignId: campaign.id,
      campaignName: campaign.name,
      sentStepIndex: null,
      remainingSteps: 0,
      summary: { successCount: 0, failureCount: 0, successPhones: [], failures: [], warnings: [], completedCampaign: true },
    };
  }

  logCampaignReplyFlow("info", "reply_received_advancing_sequence", {
    clientId,
    campaignId: campaign.id,
    phone: maskPhoneForLog(phone),
    nextStepIndex,
    remainingSteps: remainingSteps.map((step) => ({
      id: step.id,
      order: step.order,
      type: step.type,
      triggerMode: step.triggerMode || "immediate",
    })),
  });

  if (leadImportItem?.id) {
    await updateLeadImportItemCampaignProgress({
      clientId,
      leadImportItemId: leadImportItem.id,
      campaignId: campaign.id,
      progressPatch: {
        ...progress,
        status: "enviando_proximas_etapas",
        leadStatus: "enviando_proximas_etapas",
        nextStepIndex,
        updatedAt: repliedAt,
        lastReplyAt: repliedAt,
      },
      statusConversa: "em_atendimento",
      ultimaInteracaoUsuario: repliedAt,
    });
  }

  const { summary } = await dispatchCampaignSequence({
    webhookUrl,
    webhookToken,
    leads: [lead],
    analyticsMeta: {
      ...analyticsMeta,
      sequence: remainingSteps,
      dispatchOptions: {
        ...analyticsMeta.dispatchOptions,
        leadDelaySeconds: 0,
        waitForReply: false,
      },
    },
    context: {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        mode: "campaign_reply_progression",
      },
      client: { id: clientId, name: await getClientName(clientId) },
    },
    onStepDispatched: async ({ step, stepIndex, sentAt }) => {
      const originalStepIndex = nextStepIndex + stepIndex;
      logCampaignReplyFlow("info", "reply_step_sent", {
        clientId,
        campaignId: campaign.id,
        phone: maskPhoneForLog(phone),
        stepId: step.id,
        stepType: step.type,
        originalStepIndex,
      });
      if (leadImportItem?.id) {
        await updateLeadImportItemCampaignProgress({
          clientId,
          leadImportItemId: leadImportItem.id,
          campaignId: campaign.id,
          progressPatch: {
            ...progress,
            status: "enviando_proximas_etapas",
            leadStatus: "enviando_proximas_etapas",
            currentStepIndex: originalStepIndex,
            currentStepOrder: step.order ?? originalStepIndex + 1,
            currentStepId: step.id || null,
            nextStepIndex: originalStepIndex < steps.length - 1 ? originalStepIndex + 1 : null,
            updatedAt: sentAt,
            lastReplyAt: repliedAt,
          },
          statusConversa: "em_atendimento",
          ultimaInteracaoBot: sentAt,
          ultimaInteracaoUsuario: repliedAt,
        });
      }
    },
  });

  let finalizationWarning = null;
  let nextLeadStart = { started: false, reason: "not_attempted" };

  if (summary.failureCount > 0 || summary.successCount <= 0) {
    const firstFailure = summary.failures?.[0] || null;
    const failedStepEntry = firstFailure?.stepId
      ? remainingReplyEntries.find((entry) => entry.step.id === firstFailure.stepId)
      : remainingReplyEntries[0];
    const failedStepIndex = failedStepEntry?.index ?? nextStepIndex;
    const failureReason = firstFailure?.reason || "Falha ao enviar proximas etapas da campanha.";

    logCampaignReplyFlow("warn", "reply_sequence_failed_for_lead", {
      clientId,
      campaignId: campaign.id,
      phone: maskPhoneForLog(phone),
      failedStepIndex,
      reason: failureReason,
    });

    if (leadImportItem?.id) {
      await updateLeadImportItemCampaignProgress({
        clientId,
        leadImportItemId: leadImportItem.id,
        campaignId: campaign.id,
        progressPatch: {
          ...progress,
          status: "erro",
          leadStatus: "erro",
          nextStepIndex: null,
          failedStepIndex,
          updatedAt: new Date().toISOString(),
          lastReplyAt: repliedAt,
          errorMessage: failureReason,
        },
        statusConversa: "em_atendimento",
        ultimaInteracaoUsuario: repliedAt,
      });
    }

    let campaignFinalizationAfterError = { finalized: false };
    try {
      nextLeadStart = await startNextCampaignLeadInQueue({ campaign, clientId, repliedAt });
      if (!nextLeadStart.started) {
        campaignFinalizationAfterError = await maybeFinalizeCampaignAfterReply({ campaignId: campaign.id, clientId });
      }
    } catch (error) {
      finalizationWarning =
        error instanceof Error
          ? error.message
          : "Falha ao iniciar o proximo lead apos erro na sequencia atual.";
    }

    return {
      continued: false,
      finalized: false,
      campaignFinalized: campaignFinalizationAfterError.finalized === true,
      campaignId: campaign.id,
      campaignName: campaign.name,
      sentStepIndex: nextStepIndex,
      remainingSteps: remainingSteps.length,
      nextLeadStart,
      summary: {
        ...summary,
        warnings: finalizationWarning
          ? [
              ...(summary.warnings || []),
              { phone, stepId: failedStepEntry?.step?.id || null, stepType: failedStepEntry?.step?.type || null, reason: finalizationWarning },
            ]
          : summary.warnings,
      },
    };
  }

  if (summary.successCount > 0 && leadImportItem?.id) {
    try {
      await markCampaignLeadWaitingReply({
        clientId,
        lead: { id: leadImportItem.id, nome: lead.nome },
        phone,
        campaign,
        step: finalStep,
        stepIndex: finalStepIndex,
        totalSteps: steps.length,
        dispatchedAt: new Date().toISOString(),
        nextStepIndex: null,
        status: "finalizado",
        userRepliedAt: repliedAt,
      });
    } catch (error) {
      finalizationWarning =
        error instanceof Error
          ? error.message
          : "Falha ao salvar a finalizacao interna da campanha apos envio bem-sucedido.";
    }
  }

  const finalizedCurrentLead = summary.successCount > 0;
  let n8nQualification = { called: false, skipped: true, reason: "lead_not_finalized" };
  if (finalizedCurrentLead) {
    n8nQualification = await callCampaignQualificationWebhook({
      clientId,
      campaign,
      lead,
      phone,
      repliedAt,
      replyPayload,
      summary,
    });

    if (leadImportItem?.id) {
      await updateLeadImportItemCampaignProgress({
        clientId,
        leadImportItemId: leadImportItem.id,
        campaignId: campaign.id,
        progressPatch: {
          status: "finalizado",
          leadStatus: n8nQualification.ok ? "qualificado_em_n8n" : "sequencia_concluida",
          nextStepIndex: null,
          updatedAt: new Date().toISOString(),
          n8nQualification,
        },
        statusConversa: "finalizado",
      });
    }
  }

  let campaignFinalization = { finalized: false };
  if (finalizedCurrentLead) {
    try {
      nextLeadStart = await startNextCampaignLeadInQueue({ campaign, clientId, repliedAt });
      if (!nextLeadStart.started) {
        campaignFinalization = await maybeFinalizeCampaignAfterReply({ campaignId: campaign.id, clientId });
      }
    } catch (error) {
      finalizationWarning =
        error instanceof Error
          ? error.message
          : "Falha ao iniciar o proximo lead ou finalizar a campanha apos envio bem-sucedido.";
    }
  }

  if (finalizationWarning) {
    summary.warnings.push({
      phone,
      stepId: finalStep?.id || null,
      stepType: finalStep?.type || null,
      reason: finalizationWarning,
    });
  }

  return {
    continued: summary.successCount > 0,
    finalized: finalizedCurrentLead,
    campaignFinalized: campaignFinalization.finalized === true,
    campaignId: campaign.id,
    campaignName: campaign.name,
    sentStepIndex: nextStepIndex,
    remainingSteps: Math.max(steps.length - (nextStepIndex + 1), 0),
    nextLeadStart,
    n8nQualification,
    summary,
  };
}

async function maybeFinalizeCampaignAfterReply({ campaignId, clientId, triggerSource = "reply_webhook" }) {
  if (!supabase || !campaignId || !clientId) return { finalized: false, reason: "missing_context" };

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, name, client_id, import_id, status, phones, analytics_meta")
    .eq("id", campaignId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (campaignError) throw campaignError;
  if (!campaign) return { finalized: false, reason: "campaign_not_found" };
  if (campaign.status !== "processing") return { finalized: false, reason: "campaign_not_processing" };

  let query = supabase
    .from("lead_import_items")
    .select("id, telefone, normalized_data")
    .eq("client_id", clientId)
    .not("telefone", "is", null);

  if (campaign.import_id) {
    query = query.eq("import_id", campaign.import_id);
  } else {
    const phones = Array.isArray(campaign.phones)
      ? campaign.phones.map((value) => sanitizePhone(value)).filter(Boolean)
      : [];
    if (phones.length === 0) return { finalized: false, reason: "campaign_without_target_phones" };
    query = query.in("telefone", phones);
  }

  const { data: items, error: itemsError } = await query;
  if (itemsError) throw itemsError;

  const relevantItems = (items || []).filter((item) => {
    const progress = extractCampaignProgress(item.normalized_data || {}, campaign.id);
    return progress && typeof progress === "object" && progress.waitForReply === true;
  });

  if (relevantItems.length === 0) {
    return { finalized: false, reason: "campaign_without_progress_items" };
  }

  const hasPendingItems = relevantItems.some((item) => {
    const progress = extractCampaignProgress(item.normalized_data || {}, campaign.id);
    if (Object.keys(progress).length === 0) return true;
    const terminalStatus = progress.status === "finalizado" || progress.status === "erro";
    return !terminalStatus || progress.nextStepIndex !== null;
  });

  if (hasPendingItems) {
    return { finalized: false, reason: "campaign_has_pending_leads" };
  }

  const completedAt = new Date().toISOString();
  const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
  const nextAnalyticsMeta = {
    ...analyticsMeta,
    dispatch: {
      ...normalizeCampaignAnalyticsMeta(analyticsMeta.dispatch),
      status: "sent",
      triggerSource,
      sentAt: completedAt,
      updatedAt: completedAt,
    },
  };

  let { error: updateError } = await supabase
    .from("campaigns")
    .update({
      status: "sent",
      last_triggered_at: completedAt,
      scheduled_for: null,
      analytics_meta: nextAnalyticsMeta,
    })
    .eq("id", campaign.id)
    .eq("client_id", clientId);

  if (updateError && isMissingSchemaError(updateError)) {
    const fallback = await supabase
      .from("campaigns")
      .update({
        status: "sent",
        last_triggered_at: completedAt,
        scheduled_for: null,
      })
      .eq("id", campaign.id)
      .eq("client_id", clientId);
    updateError = fallback.error;
  }

  if (updateError) throw updateError;

  await insertCampaignDispatchLog({
    campaign,
    status: "sent",
    triggerSource,
    message: "Campanha finalizada apos ultima resposta do lead.",
    totalLeads: relevantItems.length,
  });

  return { finalized: true, campaignId: campaign.id, completedAt };
}

async function hasCampaignLeadReplied({ clientId, lead, phone, dispatchedAt }) {
  if (!supabase || !clientId || !phone) return false;

  const dispatchedDate = new Date(dispatchedAt);
  const repliedStatuses = ["em_atendimento", "finalizado"];
  const queries = [
    supabase
      .from("lead_import_items")
      .select("id, status_conversa, ultima_interacao_usuario")
      .eq("client_id", clientId)
      .eq("telefone", phone)
      .limit(1),
    supabase
      .from(leadsTableName(clientId))
      .select("id, status_conversa, ultima_interacao_usuario")
      .eq("client_id", clientId)
      .eq("telefone", phone)
      .limit(1),
  ];

  if (lead?.id) {
    queries.push(
      supabase
        .from("lead_import_items")
        .select("id, status_conversa, ultima_interacao_usuario")
        .eq("id", lead.id)
        .eq("client_id", clientId)
        .limit(1)
    );
  }

  const results = await Promise.all(queries);
  const error = results.find((result) => result.error)?.error;
  if (error && isMissingSchemaError(error)) {
    logCampaignReplyFlow("warn", "conversation_columns_missing_lead_reply_check_fallback", {
      clientId,
      phone: maskPhoneForLog(phone),
      error: error.message || error.code || "missing_schema",
    });
    return false;
  }
  if (error) throw error;

  const rows = results.flatMap((result) => result.data || []);

  return rows.some((row) => {
    if (repliedStatuses.includes(row.status_conversa)) return true;
    if (!row.ultima_interacao_usuario) return false;

    const userDate = new Date(row.ultima_interacao_usuario);
    return !Number.isNaN(userDate.getTime()) && userDate >= dispatchedDate;
  });
}

/** Keep /health fast so Docker HEALTHCHECK does not kill the container when Postgres is slow or unreachable. */
// getHealthPostgresPingBudgetMs: movido para ./services/httpInfra.js (Onda 3, Run A).

// postgresHealthPing: movido para ./services/httpInfra.js (Onda 3, Run A).


Object.assign(routeDeps, {
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
  MAX_CONVERSATION_BYTES,
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
  canManageGlobalNotifications,
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
  filterNotificationsForAccess,
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
  getLeadClientN8nSettings,
  getLeadClientN8nSettingsMap,
  getLeadClientN8nSettingsStatus,
  getLeadClientEvolutionInstances,
  getLeadReferenceDate,
  getLeadWebhookBearerSecret,
  getN8nOnboardingStatus,
  getN8nWebhookBearerSecret,
  getNormalizedField,
  getPresetFallbackKey,
  getRequestBearerToken,
  getRequestId,
  getSafeDispatchSettingsLog,
  getSafeEvolutionEndpointLog,
  getVisibleNotificationIds,
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
  isNotificationVisibleToAccess,
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
  matchesNotificationClientScope,
  matchesNotificationInternalScope,
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
  normalizeNotificationScopeValues,
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
  requireN8nWebhookSecret,
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
  upsertLeadClientN8nSettings,
  upsertLeadClientEvolutionInstance,
  provisionLeadClientEvolutionInstance,
  deleteLeadClientEvolutionInstance,
  useDirectPostgres,
  validateConversationMemoryPayload,
  validateLeadWebhookBearer,
  validateLeadsOutlierRecord,
  validateN8nInboundBearer,
});
registerAllDomainRoutes(app);
registerWebhooksRoutes(app);

app.use((error, req, res, _next) => {
  if (error?.type === "entity.too.large" || error?.status === 413) {
    sendError(res, 413, "PAYLOAD_TOO_LARGE", "Request payload exceeds 15MB limit");
    return;
  }

  if (error?.message?.startsWith("Origin not allowed:")) {
    sendError(res, 403, "CORS_FORBIDDEN_ORIGIN", "Origin not allowed", error.message);
    return;
  }

  console.error("unhandled express error:", req?.method, req?.originalUrl || req?.url, error);
  sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
});

const port = Number.parseInt(process.env.PORT || "3001", 10);

// Config do retry de bind (porta temporariamente ocupada após restart — janela em que
// o processo anterior ainda está liberando :PORT). Ajustável por env.
const LISTEN_RETRY_MAX = Number.parseInt(process.env.LISTEN_RETRY_MAX || "3", 10);
const LISTEN_RETRY_DELAY_MS = Number.parseInt(process.env.LISTEN_RETRY_DELAY_MS || "3000", 10);
// Tempo máximo para o shutdown gracioso antes de forçar a saída (libera a porta).
const SHUTDOWN_FORCE_MS = Number.parseInt(process.env.SHUTDOWN_FORCE_MS || "10000", 10);

let httpServer = null;

function startBackgroundServices() {
  startCampaignScheduler();
  if (supabase) {
    setSupabaseClient(supabase);
  }
  initializeRedisChat().catch((error) => {
    console.error("hardcoded-chatbot redis init error:", error);
  });
  whatsappSessionManager.restorePersistedSession().catch((error) => {
    console.error("whatsapp startup restore error:", error);
  });
  // BullMQ worker do módulo de follow-up
  if (process.env.REDIS_URL || process.env.REDIS_HOST) {
    startFollowupWorker();
  } else {
    console.warn("[followup/worker] REDIS_URL/REDIS_HOST não configurado — worker não iniciado.");
  }
  // Motor proativo de sugestões (node-cron, a cada 6h)
  startAutomationEngine();
}

// (A) Sobe o HTTP com handler de 'error'. EADDRINUSE → retry curto e limitado (cobre a
// janela transitória do restart em que a instância anterior ainda segura a porta);
// se persistir, exit(1) controlado (deixa o orquestrador reiniciar limpo, sem crash
// não tratado). Qualquer outro erro de listen → loga e exit(1).
function listenWithRetry(attempt = 1) {
  const server = app.listen(port, () => {
    httpServer = server;
    console.log(`VexoApi listening on port ${port}`);
    startBackgroundServices();
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      if (attempt < LISTEN_RETRY_MAX) {
        console.warn(
          `[server] porta ${port} ocupada (EADDRINUSE) — tentativa ${attempt}/${LISTEN_RETRY_MAX}; novo retry em ${LISTEN_RETRY_DELAY_MS}ms`
        );
        setTimeout(() => listenWithRetry(attempt + 1), LISTEN_RETRY_DELAY_MS);
        return;
      }
      console.error(
        `[server] porta ${port} ainda ocupada após ${LISTEN_RETRY_MAX} tentativas — encerrando para o orquestrador reiniciar.`
      );
      process.exit(1);
    }
    console.error("[server] erro fatal no listen:", err);
    process.exit(1);
  });
}

// (B) Shutdown gracioso: fecha o servidor HTTP (libera a porta RÁPIDO), encerra o pool
// pg, e sai com 0. Timeout de força garante que nunca fique pendurado segurando :PORT.
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} recebido — iniciando shutdown gracioso...`);

  const forceTimer = setTimeout(() => {
    console.error(`[server] shutdown excedeu ${SHUTDOWN_FORCE_MS}ms — forçando saída.`);
    process.exit(0);
  }, SHUTDOWN_FORCE_MS);
  forceTimer.unref();

  const finish = () => {
    Promise.resolve(shutdownPgPool())
      .catch(() => {})
      .finally(() => {
        console.log("[server] shutdown concluído.");
        clearTimeout(forceTimer);
        process.exit(0);
      });
  };

  if (httpServer) {
    httpServer.close((err) => {
      if (err) console.error("[server] erro ao fechar HTTP server:", err.message || err);
      else console.log("[server] HTTP server fechado (porta liberada).");
      finish();
    });
  } else {
    finish();
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// (C) Nunca mais ficar cego: loga o erro completo de uncaughtException/unhandledRejection.
// Em uncaughtException, o processo está em estado indefinido → loga e sai (1) para reinício
// limpo (em vez do throw silencioso que matava sem rastro).
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection:", reason instanceof Error ? reason.stack || reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException:", err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});

// Rodar migrations antes de subir o servidor
runMigrations(pgDatabasePool).finally(() => {
  listenWithRetry();
});
