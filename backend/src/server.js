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
  isMaskedSecretPlaceholder,
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
// dispatchCampaignSequence, getCampaignStepPlan, normalizeCampaignAnalyticsMeta,
// validateCampaignAnalyticsMeta ficaram sem consumidor em server.js apos a extracao do
// grupo D (Onda 3, Run E) -- import de ./campaign-outbound.js removido; a logica que os usava
// agora importa diretamente em ./campaign/dispatch.js e ./campaign/settings.js.
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
import { startSlackWorker } from "./geracaoDigital/slackWorker.js";
import { startAutomationEngine } from "./followup/automationEngine.js";
// getSegmentationCatalog, normalizeSegmentationCatalog, isFilterShape, normalizeFilters,
// leadMatchesSegmentation, buildDefaultSegmentationConfig, sanitizeSegmentationConfig ficaram
// sem consumidor em server.js apos a extracao do grupo D (Onda 3, Run E) -- import de
// ./segmentation.js removido; ./campaign/dispatch.js importa o que precisa diretamente.
import {
  normalizeTenantKey,
  leadsTableName,
  normalizeHttpUrl,
  getRequestId,
  maskPhoneForLog,
  getClientEnvSuffix,
  parseJsonEnvMap,
  resolveAuthorizedClientId,
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
  DEFAULT_REQUEST_TIMEOUT_MS,
  logCampaignDispatch,
  maskEvolutionInstance,
  getLeadClientEvolutionInstances,
  upsertLeadClientEvolutionInstance,
  provisionLeadClientEvolutionInstance,
  deleteLeadClientEvolutionInstance,
  parseEvolutionWebhookEndpoint,
  getSafeEvolutionEndpointLog,
  buildEvolutionAuthHeaders,
  extractEvolutionConnectionState,
  isEvolutionOpenState,
  checkEvolutionInstanceHealth,
} from "./services/evolution.js";
import {
  maskN8nSettings,
  getN8nOnboardingStatus,
  getLeadClientN8nSettingsStatus,
  getLeadClientN8nSettings,
  getLeadClientN8nSettingsMap,
  buildN8nSettingsPayload,
  upsertLeadClientN8nSettings,
  validateN8nInboundBearer,
} from "./services/n8nSettings.js";
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
import {
  resolveEnvDispatchWebhookSettings,
  getSafeDispatchSettingsLog,
  logDirectDispatch,
  logCampaignReplyFlow,
  resolveEnvCampaignQualificationWebhookSettings,
  resolveDispatchWebhookSettings,
  resolveCampaignDispatchSettings,
} from "./campaign/settings.js";
import {
  getClientName,
  getSegmentationCatalogForClient,
  buildDispatchLeads,
  resolveCampaignPhonesForRow,
  buildCampaignWebhookPayload,
  insertCampaignDispatchLog,
  canCampaignBeDispatched,
  claimCampaignForDispatch,
  markCampaignDispatchFailed,
  executeCampaignDispatch,
  startNextCampaignLeadInQueue,
  extractCampaignProgress,
  mergeCampaignProgress,
  updateLeadImportItemCampaignProgress,
  updateLeadConversationState,
  toComparableCampaignTimestamp,
  normalizeCampaignPendingStepIndex,
  resolveMatchedImportItemForCampaign,
  findCampaignReplyMatches,
  markCampaignLeadWaitingReply,
  buildCampaignAutomationHeaders,
  callCampaignQualificationWebhook,
  continueCampaignLeadFromReply,
  maybeFinalizeCampaignAfterReply,
  hasCampaignLeadReplied,
} from "./campaign/dispatch.js";
import {
  DEFAULT_CAMPAIGN_RUNNER_INTERVAL_MS,
  CAMPAIGN_SCHEDULER_MAX_BATCH,
  getCampaignRunnerIntervalMs,
  shouldStartCampaignScheduler,
  runDueCampaignDispatches,
  tickCampaignScheduler,
  startCampaignScheduler,
} from "./campaign/scheduler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const app = express();
app.use(express.json({ limit: "15mb" }));
const isProduction = process.env.NODE_ENV === "production";
// MAX_CONVERSATION_BYTES: movido para ./services/httpInfra.js (Onda 3, Run C).
// DEFAULT_CAMPAIGN_RUNNER_INTERVAL_MS e CAMPAIGN_SCHEDULER_MAX_BATCH: movidos para
// ./campaign/scheduler.js (Onda 3, Run E) e reimportados acima.
// DEFAULT_REQUEST_TIMEOUT_MS: movido para ./services/evolution.js (Onda 3, Run D) e reimportado
// por ./campaign/dispatch.js (usado por callCampaignQualificationWebhook).

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
// _evolutionInstancesSchemaEnsured: virou estado privado de ./services/evolution.js (Onda 3, Run D).
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

// Grupo D (campaign engine) foi extraido para src/campaign/{settings,dispatch,scheduler}.js
// (Onda 3, Run E) e reimportado no topo deste arquivo:
//   - resolveEnvDispatchWebhookSettings, getSafeDispatchSettingsLog, logDirectDispatch,
//     logCampaignReplyFlow, resolveEnvCampaignQualificationWebhookSettings,
//     resolveDispatchWebhookSettings, resolveCampaignDispatchSettings -> ./campaign/settings.js
//   - getClientName, getSegmentationCatalogForClient, buildDispatchLeads,
//     resolveCampaignPhonesForRow, buildCampaignWebhookPayload, insertCampaignDispatchLog,
//     canCampaignBeDispatched, claimCampaignForDispatch, markCampaignDispatchFailed,
//     executeCampaignDispatch, startNextCampaignLeadInQueue, extractCampaignProgress,
//     mergeCampaignProgress, updateLeadImportItemCampaignProgress, updateLeadConversationState,
//     toComparableCampaignTimestamp, normalizeCampaignPendingStepIndex,
//     resolveMatchedImportItemForCampaign, findCampaignReplyMatches, markCampaignLeadWaitingReply,
//     buildCampaignAutomationHeaders, callCampaignQualificationWebhook,
//     continueCampaignLeadFromReply, maybeFinalizeCampaignAfterReply, hasCampaignLeadReplied
//     -> ./campaign/dispatch.js (dispatch.js fundiu os grupos dispatch+reply do mapa original:
//        ha ciclo real de chamadas entre os dois, ver nota no topo do arquivo)
//   - getCampaignRunnerIntervalMs, shouldStartCampaignScheduler, runDueCampaignDispatches,
//     tickCampaignScheduler, startCampaignScheduler, DEFAULT_CAMPAIGN_RUNNER_INTERVAL_MS,
//     CAMPAIGN_SCHEDULER_MAX_BATCH -> ./campaign/scheduler.js (campaignSchedulerRunning virou
//     estado privado do modulo -- removido do routeDeps bag, zero consumidores confirmados)
//
// resolveAuthorizedClientId (fisicamente no meio deste bloco na revisao 0ae005a) foi movido
// para ./services/tenant.js (Onda 3, Run E) e reimportado no topo deste arquivo.

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
  // BullMQ worker do módulo de follow-up e gd-slack
  if (process.env.REDIS_URL || process.env.REDIS_HOST) {
    startFollowupWorker();
    startSlackWorker();
  } else {
    console.warn("[workers] REDIS_URL/REDIS_HOST não configurado — workers não iniciados.");
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
