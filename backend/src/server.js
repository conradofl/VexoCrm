import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";
import { calcularCodeHash } from "../scripts/codehash.mjs";
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
import { initializeRedisChat, getChatMemory, setSupabaseClient, closeRedisChat } from "./hardcoded-chatbot.js";
import {
  bufferMessage,
  resolveMessageContent,
  processBatch,
  getChatbotModel,
} from "./chatbot-ai-engine.js";

import { routeDeps } from "./http/routeDeps.js";
import { registerAllDomainRoutes } from "./domains/registerAllDomainRoutes.js";
import { configureCorsPolicy } from "./services/corsPolicy.js";
import { registerEventosRoutes } from "./domains/eventos/routes.js";
import { registerWebhooksRoutes } from "./webhooks/routes.js";
import { startFollowupWorker, pauseFollowupWorker, stopFollowupWorker } from "./followup/worker.js";
import { startRagWorker, pauseRagWorker, stopRagWorker } from "./rag/worker.js";
import { startSlackWorker, pauseSlackWorker, stopSlackWorker } from "./geracaoDigital/slackWorker.js";
import { startAutomationEngine, stopAutomationEngine } from "./followup/automationEngine.js";
import { closeFollowupQueue } from "./followup/queue.js";
import { closeRagQueue } from "./rag/queue.js";
import { closeSlackQueue } from "./geracaoDigital/slackQueue.js";
import { stopDueDispatchScheduler } from "./domains/campaigns/routes.js";
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
  computeRescueCandidates,
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
  requireCampaignDispatchAccess,
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
  resolveInboundDispatchSettings,
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
  stopCampaignScheduler,
} from "./campaign/scheduler.js";
import { recoverOrphanDispatches } from "./campaign/orphanRecovery.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

// Identidade do build. Preenchida por ARG no Dockerfile (docker build --build-arg
// GIT_COMMIT=... BUILD_TIME=...), nunca por git em runtime: o .dockerignore exclui
// .git do contexto de proposito. "desconhecido" significa que a imagem foi
// construida sem passar os args — nesse caso o deploy nao e rastreavel.
// Identidade do que esta rodando.
//
// O carimbo por SHA falhou de tres jeitos: o Easypanel nao passa build-args; o ARG
// do Dockerfile tinha default "desconhecido", entao a env var SEMPRE existia com
// esse valor e vencia a precedencia; e o build-info.json era gerado antes do commit,
// gravando o commit anterior. build-info.json foi REMOVIDO — dois mecanismos
// meia-boca sao piores que um que funciona.
//
// codeHash e a peca que sempre funciona: hash do conteudo de src/, calculado no
// build (scripts/codehash.mjs --write) e reproduzivel na maquina com o mesmo script.
// Responde a pergunta real — "o que roda e igual ao que esta em main?".
//
// commit/builtAt continuam OPCIONAIS: aparecem so quando o painel passar os
// build-args. Valor vazio ou "desconhecido" e tratado como AUSENTE, e o campo some
// do /health em vez de mentir.
function valorPresente(bruto) {
  const valor = String(bruto ?? "").trim();
  if (!valor || valor.toLowerCase() === "desconhecido" || valor.toLowerCase() === "unknown") {
    return null;
  }
  return valor;
}

function lerCodeHash() {
  try {
    return readFileSync(join(__dirname, "..", "code-hash.txt"), "utf8").trim() || null;
  } catch {
    // Fora do container (dev local) o arquivo nao existe: calcular na hora e
    // barato e mantem o /health util em qualquer ambiente.
    try {
      return calcularCodeHash();
    } catch {
      return null;
    }
  }
}

export const BUILD_INFO = {
  codeHash: lerCodeHash(),
  commit: valorPresente(process.env.GIT_COMMIT) || valorPresente(process.env.SOURCE_COMMIT),
  builtAt: valorPresente(process.env.BUILD_TIME),
  startedAt: new Date().toISOString(),
};

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

// A MESMA lista passa a valer para as respostas de erro (sendError, em
// services/httpInfra.js). Antes so o middleware cors() a enxergava.
configureCorsPolicy({
  allowAny: allowAnyCorsOrigin || corsAllowAnyOriginBecauseListEmpty,
  origens: corsOrigins,
});

// sendError: movido para ./services/httpInfra.js (Onda 3, Run A).

/** When true, INTERNAL_ERROR responses include a short `details` payload (for staging / temporary prod debugging). */
// shouldExposeInternalErrorDetails: movido para ./services/httpInfra.js (Onda 3, Run A).

/** Safe diagnostic object for 500 handlers (no stack traces unless non-production). */
// internalErrorPayloadDetails: movido para ./services/httpInfra.js (Onda 3, Run A).

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowAnyCorsOrigin || corsAllowAnyOriginBecauseListEmpty) {
        callback(null, true);
        return;
      }
      // Permitir requisições da extensão Chrome ou redes suportadas pelo Vexo Scout
      if (
        origin.startsWith("chrome-extension://") ||
        origin.includes("instagram.com") ||
        origin.includes("linkedin.com") ||
        origin.includes("facebook.com") ||
        origin.includes("tiktok.com")
      ) {
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
      // callback(null, false) em vez de throw: lancar aqui derruba a requisicao no
      // error handler do Express e devolve um 500 opaco, sem cabecalho de CORS —
      // o navegador mostra so "Failed to fetch" e o operador nunca ve o motivo.
      // Sem os cabecalhos o navegador bloqueia igual, que e o comportamento
      // correto, mas a resposta e limpa e o log acima diz o que fazer.
      callback(null, false);
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
  computeRescueCandidates,
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
  requireCampaignDispatchAccess,
  requireFirebaseAuth,
  requireInternalAccess,
  requireInternalPageAccess,
  requireN8nWebhookSecret,
  requireUserManagementAccess,
  resolveAuthorizedClientId,
  resolveCampaignDispatchSettings,
  resolveCampaignPhonesForRow,
  resolveDispatchWebhookSettings,
  resolveInboundDispatchSettings,
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
    startRagWorker();
    startSlackWorker();
  } else {
    console.warn("[workers] REDIS_URL/REDIS_HOST não configurado — workers não iniciados.");
  }
  // Motor proativo de sugestões DESLIGADO (Decisão do dono: sem interface de moderação no momento)
  // startAutomationEngine();
}

// (A) Sobe o HTTP com handler de 'error'. EADDRINUSE → retry curto e limitado (cobre a
// janela transitória do restart em que a instância anterior ainda segura a porta);
// se persistir, exit(1) controlado (deixa o orquestrador reiniciar limpo, sem crash
// não tratado). Qualquer outro erro de listen → loga e exit(1).
function listenWithRetry(attempt = 1) {
  const server = app.listen(port, () => {
    httpServer = server;
    console.log(`VexoApi listening on port ${port}`);
    // Carimbo do build. codeHash e a impressao digital de src/ — compare com
    // `npm run codehash --prefix backend` para saber se o deploy pegou o codigo
    // atual. Campo nulo nao e impresso: "desconhecido" no log foi o que escondeu
    // um deploy desatualizado por varias rodadas.
    console.log(
      "[build]",
      JSON.stringify(Object.fromEntries(Object.entries(BUILD_INFO).filter(([, v]) => v !== null)))
    );
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

// (B) Shutdown gracioso ordenado:
// 1. Parar de aceitar trabalho novo (schedulers, crons, workers BullMQ pausados)
// 2. Fechar HTTP server + derrubar sockets ociosos (closeIdleConnections)
// 3. Aguardar requisições em voo (com prazo de segurança antes de closeAllConnections)
// 4. Fechar workers BullMQ, filas BullMQ, Redis e pool Postgres
// 5. Sair com código 0
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const shutdownStart = Date.now();
  console.log(`[server] ${signal} recebido — iniciando shutdown gracioso...`);

  const forceTimer = setTimeout(() => {
    const elapsed = Date.now() - shutdownStart;
    console.error(`[server] shutdown excedeu ${SHUTDOWN_FORCE_MS}ms (${elapsed}ms decorridos) — forçando saída.`);
    process.exit(0);
  }, SHUTDOWN_FORCE_MS);
  forceTimer.unref();

  try {
    // ── ETAPA 1: Parar de aceitar trabalho novo ───────────────────────────
    const t1 = Date.now();
    try {
      stopCampaignScheduler();
      stopDueDispatchScheduler();
      stopAutomationEngine();
      await Promise.allSettled([
        pauseFollowupWorker(),
        pauseRagWorker(),
        pauseSlackWorker(),
      ]);
      console.log(`[server] [etapa 1/4] novos trabalhos pausados e schedulers encerrados (${Date.now() - t1}ms).`);
    } catch (err) {
      console.warn(`[server] [etapa 1/4] erro ao pausar novos trabalhos (${Date.now() - t1}ms):`, err?.message || err);
    }

    // ── ETAPA 2 & 3: Fechar HTTP server e aguardar requisições em voo ─────
    const t2 = Date.now();
    if (httpServer) {
      // 2. Derruba sockets keep-alive ociosos imediatamente, mantendo requisições ativas
      if (typeof httpServer.closeIdleConnections === "function") {
        httpServer.closeIdleConnections();
      }

      await new Promise((resolve) => {
        let isDone = false;
        const done = () => {
          if (!isDone) {
            isDone = true;
            console.log(`[server] HTTP server fechado (porta liberada) (${Date.now() - t2}ms).`);
            resolve();
          }
        };

        // 3. Prazo de até 4000ms para requisições em voo antes de forçar o fechamento de sockets restantes
        const inFlightTimeout = setTimeout(() => {
          if (!isDone) {
            console.warn(`[server] [etapa 2/4] prazo de requisições em voo esgotado (${Date.now() - t2}ms) — encerrando sockets restantes.`);
            if (typeof httpServer.closeAllConnections === "function") {
              httpServer.closeAllConnections();
            }
          }
        }, 4000);
        inFlightTimeout.unref();

        httpServer.close((err) => {
          clearTimeout(inFlightTimeout);
          if (err) console.error("[server] erro ao fechar HTTP server:", err.message || err);
          done();
        });
      });
    }

    // ── ETAPA 4: Fechar workers BullMQ, filas BullMQ, conexões Redis e pool Postgres ──
    const t4 = Date.now();
    try {
      // 4a. Workers BullMQ (close)
      const tw = Date.now();
      await Promise.allSettled([
        stopFollowupWorker(),
        stopRagWorker(),
        stopSlackWorker(),
      ]);
      console.log(`[server] [etapa 4a/4] workers BullMQ fechados (${Date.now() - tw}ms).`);

      // 4b. Filas BullMQ (close)
      const tq = Date.now();
      await Promise.allSettled([
        closeFollowupQueue(),
        closeRagQueue(),
        closeSlackQueue(),
      ]);
      console.log(`[server] [etapa 4b/4] filas BullMQ fechadas (${Date.now() - tq}ms).`);

      // 4c. Redis (quit)
      const tr = Date.now();
      await Promise.allSettled([
        closeRedisChat(),
      ]);
      console.log(`[server] [etapa 4c/4] conexões Redis encerradas (${Date.now() - tr}ms).`);

      // 4d. Pool Postgres
      const tp = Date.now();
      await shutdownPgPool();
      console.log(`[server] [etapa 4d/4] pool Postgres encerrado (${Date.now() - tp}ms).`);
    } catch (err) {
      console.warn(`[server] [etapa 4/4] erro durante encerramento de infraestrutura (${Date.now() - t4}ms):`, err?.message || err);
    }

    // ── ETAPA 5: Sair limpo ───────────────────────────────────────────────
    clearTimeout(forceTimer);
    const totalElapsed = Date.now() - shutdownStart;
    console.log(`[server] shutdown concluído em ${totalElapsed}ms.`);
    process.exit(0);
  } catch (fatalErr) {
    console.error("[server] erro fatal durante shutdown gracioso:", fatalErr?.message || fatalErr);
    clearTimeout(forceTimer);
    process.exit(0);
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

// Rodar migrations e recuperação de lotes órfãos antes de subir o servidor
runMigrations(pgDatabasePool)
  .then(() => recoverOrphanDispatches(pgDatabasePool))
  .catch((err) => {
    console.error("[server] erro na inicialização/recuperação de lotes órfãos:", err?.message || err);
  })
  .finally(() => {
    listenWithRetry();
  });
