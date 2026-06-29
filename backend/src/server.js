import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { gunzipSync } from "zlib";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { createDatabasePool, createPgSupabaseClient } from "./pgSupabaseCompat.js";
import { runMigrations } from "./migrate.js";
import { parseLeadQualificacaoBoolean } from "./leadQualificacaoBoolean.js";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
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
} from "./segmentation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const app = express();
app.use(express.json({ limit: "15mb" }));
const isProduction = process.env.NODE_ENV === "production";
/** Max decompressed conversation size for POST /api/conversation-memory (after gzip decode). */
const MAX_CONVERSATION_BYTES = 5 * 1024 * 1024;
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

function sendError(res, status, code, message, details) {
  const body = {
    error: {
      code,
      message,
    },
  };
  if (details) {
    body.error.details = details;
  }
  res.status(status).json(body);
}

/** When true, INTERNAL_ERROR responses include a short `details` payload (for staging / temporary prod debugging). */
function shouldExposeInternalErrorDetails() {
  const raw = String(process.env.EXPOSE_INTERNAL_ERROR_DETAILS || "").toLowerCase();
  return process.env.NODE_ENV !== "production" || raw === "1" || raw === "true" || raw === "yes";
}

/** Safe diagnostic object for 500 handlers (no stack traces unless non-production). */
function internalErrorPayloadDetails(err) {
  if (!shouldExposeInternalErrorDetails()) return undefined;
  if (err instanceof Error) {
    const out = { cause: err.message, name: err.name };
    if (process.env.NODE_ENV !== "production" && err.stack) {
      out.stack = err.stack.split("\n").slice(0, 8).join("\n");
    }
    return out;
  }
  if (err && typeof err === "object") {
    const out = {};
    if ("message" in err) out.cause = String(err.message);
    if ("code" in err) out.code = String(err.code);
    if ("details" in err && err.details != null) out.pgDetails = err.details;
    if ("hint" in err && err.hint != null) out.hint = err.hint;
    if (Object.keys(out).length) return out;
  }
  return { cause: String(err) };
}

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

const databaseUrl = (process.env.DATABASE_URL || "").trim();
const dataSource = (process.env.DATA_SOURCE || "").trim().toLowerCase();
const dbDriverEnv = (process.env.DB_DRIVER || "").trim().toLowerCase();
const supabaseUrl = process.env.SUPABASE_URL || process.env.URL;
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

function getDatabaseHostForLogging(connectionString) {
  if (!connectionString) return null;
  try {
    return new URL(connectionString).hostname || null;
  } catch {
    return null;
  }
}

function isLikelyIpv4Host(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(String(hostname || ""));
}

/**
 * postgres: pg pool + query shim (VPS or any Postgres).
 * supabase: official Supabase JS client (PostgREST).
 * Legacy: DATABASE_URL without DATA_SOURCE=supabase still selects postgres unless DB_DRIVER=supabase.
 */
const useDirectPostgres =
  dbDriverEnv === "postgres" ||
  (dbDriverEnv !== "supabase" && Boolean(databaseUrl) && dataSource !== "supabase");

let pgDatabasePool = null;
let supabase = null;
let _evolutionInstancesSchemaEnsured = false;

if (useDirectPostgres) {
  if (!databaseUrl) {
    console.error("[database] Postgres selected but DATABASE_URL is empty (set DB_DRIVER=supabase to use Supabase only)");
    process.exit(1);
  }
  const databaseHost = getDatabaseHostForLogging(databaseUrl);
  pgDatabasePool = createDatabasePool(databaseUrl);
  pgDatabasePool.on("error", (err) => {
    console.error("[database] pg pool error (idle client):", err?.message || err);
  });
  supabase = createPgSupabaseClient(pgDatabasePool);
  console.info("[database] Using direct PostgreSQL (pg)", dbDriverEnv ? `(DB_DRIVER=${dbDriverEnv})` : "(DATABASE_URL)");
  if (isProduction && isLikelyIpv4Host(databaseHost)) {
    console.warn(
      `[database] DATABASE_URL is using public host ${databaseHost}. ` +
        "If API and Postgres run on the same EasyPanel/VPS, prefer the internal service host " +
        "(for example apps_db-vexo:5432) to avoid NAT/firewall latency and intermittent timeouts."
    );
  }
} else if (supabaseUrl && supabaseServiceRoleKey) {
  supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  console.info("[database] Using Supabase JS client");
} else {
  console.warn(
    "[database] No database client configured. Set DATABASE_URL for VPS Postgres, or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for Supabase."
  );
}

function shutdownPgPool() {
  if (pgDatabasePool) {
    return pgDatabasePool.end().catch(() => {});
  }
  return Promise.resolve();
}
// SIGTERM/SIGINT são tratados por gracefulShutdown (fecha HTTP + pool + exit), definido
// junto ao app.listen — não registrar handlers de sinal aqui para não duplicar.

// Firebase: prefer env vars; fallback to service account JSON in backend dir
let firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined,
};

if (!firebaseConfig.projectId || !firebaseConfig.clientEmail || !firebaseConfig.privateKey) {
  const backendDir = join(__dirname, "..");
  const candidates = readdirSync(backendDir).filter(
    (f) => f.includes("firebase-adminsdk") && f.endsWith(".json")
  );
  const jsonPath = candidates[0] ? join(backendDir, candidates[0]) : null;
  if (jsonPath && existsSync(jsonPath)) {
    const sa = JSON.parse(readFileSync(jsonPath, "utf8"));
    firebaseConfig = {
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    };
  }
}

const firebaseReady =
  !!firebaseConfig.projectId && !!firebaseConfig.clientEmail && !!firebaseConfig.privateKey;

if (firebaseReady && getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: firebaseConfig.projectId,
      clientEmail: firebaseConfig.clientEmail,
      privateKey: firebaseConfig.privateKey,
    }),
  });
}

function ensureDb(res) {
  if (!supabase) {
    sendError(
      res,
      500,
      "DATABASE_NOT_CONFIGURED",
      "Missing database configuration",
      useDirectPostgres
        ? "Set DATABASE_URL for Postgres (DB_DRIVER=postgres or unset DATA_SOURCE=supabase)"
        : "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or use DATABASE_URL with DB_DRIVER=postgres"
    );
    return false;
  }
  return true;
}

const MANAGED_CLAIM_KEYS = [
  "role",
  "userRole",
  "user_type",
  "userType",
  "tipo_usuario",
  "isAdmin",
  "admin",
  "is_admin",
  "accessPreset",
  "scopeMode",
  "tenantScope",
  "approvalLevel",
  "permissions",
  "clientId",
  "client_id",
  "companyId",
  "empresaId",
  "tenantId",
  "clientIds",
  "tenantIds",
  "allowedViews",
  "companyName",
  "internalPages",
];
const CLIENT_VIEW_KEYS = ["dashboard", "leads", "planilhas", "whatsapp"];
const DEFAULT_CLIENT_VIEWS = ["dashboard", "leads"];
const INTERNAL_PAGE_KEYS = [
  "dashboard",
  "leads",
  "planilhas",
  "whatsapp",
  "agente",
  "usuarios",
  "empresas",
  "campanhas",
  "inteligencia-comercial",
  "chatbot-kanban",
  "chatbot-config",
  "followup",
  "fila-de-followup",
  "followup-empresas",
  "followup-campanhas",
  "followup-analytics",
  "followup-sugestoes",
  "chatbot-docs",
  "onboarding-wizard",
  "onboarding-agent",
  "conexoes",
  "disparos",
  "aquecimento",
  "relatorios",
  "apresentacao",
  "apresentacao-gd",
  "briefings-gd",
  "integracoes",
  "eventos",
  "relacionamento",
  "livpub",
];
const ACCESS_SCOPE_KEYS = ["all_clients", "assigned_clients", "no_client_access"];
const APPROVAL_LEVEL_KEYS = ["none", "operator", "supervisor", "manager", "director"];
const ACCESS_PERMISSION_KEYS = [
  "dashboard.view",
  "leads.view",
  "leads.export",
  "imports.manage",
  "whatsapp.view",
  "whatsapp.reply",
  "campaigns.manage",
  "agente.view",
  "tenants.manage",
  "users.view",
  "users.manage",
];
const ACCESS_PRESET_KEYS = [
  "admin_vexo",
  "gestor",
  "operador",
  "parceiro",
  "client_manager",
  "client_operator",
  "client_viewer",
  "pending",
];
const ACCESS_PRESET_LABELS = {
  admin_vexo: "Admin Vexo",
  gestor: "Gestor",
  operador: "Operador",
  parceiro: "Parceiro",
  client_manager: "Gestor do cliente",
  client_operator: "Operador do cliente",
  client_viewer: "Leitura do cliente",
  pending: "Aguardando aprovacao",
};
const FIXED_ADMIN_UIDS = new Set([
  "IozfnQTmWHQAxopr3FyNb1SdYs52",
  "pKpOKg3Fttf6AnYsTzZD7xjJLaN2",
]);
const FIXED_ADMIN_EMAILS = new Set([
  "luizz.felipe.santos17@gmail.com",
  "conradofl@gmail.com",
  "mrkgeracaodigital@gmail.com",
]);

function isFixedAdminIdentity(identity = {}) {
  const uid = normalizeString(identity.uid);
  const email = normalizeString(identity.email)?.toLowerCase() || null;

  return (uid && FIXED_ADMIN_UIDS.has(uid)) || (email && FIXED_ADMIN_EMAILS.has(email)) || false;
}

const ACCESS_PRESET_DEFAULTS = {
  admin_vexo: {
    role: "internal",
    scopeMode: "all_clients",
    approvalLevel: "director",
    permissions: [...ACCESS_PERMISSION_KEYS],
    internalPages: [...INTERNAL_PAGE_KEYS],
    allowedViews: [],
  },
  gestor: {
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "manager",
    permissions: [
      "dashboard.view",
      "leads.view",
      "leads.export",
      "imports.manage",
      "whatsapp.view",
      "whatsapp.reply",
      "campaigns.manage",
      "agente.view",
      "users.view",
      "users.manage",
    ],
    internalPages: INTERNAL_PAGE_KEYS.filter((p) => p !== "empresas"),
    allowedViews: [],
  },
  operador: {
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: ["dashboard.view", "leads.view", "imports.manage", "whatsapp.view", "whatsapp.reply"],
    internalPages: ["dashboard", "leads", "whatsapp"],
    allowedViews: [],
  },
  parceiro: {
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "supervisor",
    permissions: ["dashboard.view", "leads.view", "whatsapp.view"],
    internalPages: [],
    allowedViews: ["dashboard", "leads", "whatsapp"],
  },
  client_manager: {
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "manager",
    permissions: [
      "dashboard.view",
      "leads.view",
      "leads.export",
      "imports.manage",
      "whatsapp.view",
      "whatsapp.reply",
    ],
    internalPages: [],
    allowedViews: [...CLIENT_VIEW_KEYS],
  },
  client_operator: {
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: ["dashboard.view", "leads.view", "whatsapp.view", "whatsapp.reply"],
    internalPages: [],
    allowedViews: ["dashboard", "leads", "whatsapp"],
  },
  client_viewer: {
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "none",
    permissions: ["dashboard.view", "leads.view"],
    internalPages: [],
    allowedViews: ["dashboard", "leads"],
  },
  pending: {
    role: "pending",
    scopeMode: "no_client_access",
    approvalLevel: "none",
    permissions: [],
    internalPages: [],
    allowedViews: [],
  },
};

const SYSTEM_ACCESS_PROFILES = [
  {
    key: "admin_vexo",
    label: ACCESS_PRESET_LABELS.admin_vexo,
    description: "Acesso total ao CRM (Você e a equipe técnica).",
    role: "internal",
    scopeMode: "all_clients",
    approvalLevel: "director",
    permissions: [...ACCESS_PERMISSION_KEYS],
    internalPages: [...INTERNAL_PAGE_KEYS],
    allowedViews: [],
    isSystem: true,
    isLocked: true,
  },
  {
    key: "gestor",
    label: ACCESS_PRESET_LABELS.gestor,
    description: "Time comercial (interno). Pode ver vários clientes, mas não pode alterar configs sensíveis do sistema.",
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "manager",
    permissions: [...ACCESS_PRESET_DEFAULTS.gestor.permissions],
    internalPages: [...ACCESS_PRESET_DEFAULTS.gestor.internalPages],
    allowedViews: [],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "operador",
    label: ACCESS_PRESET_LABELS.operador,
    description: "Time comercial (interno). Pode ver vários clientes, mas não pode deletar o sistema.",
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: [...ACCESS_PRESET_DEFAULTS.operador.permissions],
    internalPages: [...ACCESS_PRESET_DEFAULTS.operador.internalPages],
    allowedViews: [],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "parceiro",
    label: ACCESS_PRESET_LABELS.parceiro,
    description: "Acompanha a operacao com leitura e conversa limitada.",
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "supervisor",
    permissions: [...ACCESS_PRESET_DEFAULTS.parceiro.permissions],
    internalPages: [],
    allowedViews: [...ACCESS_PRESET_DEFAULTS.parceiro.allowedViews],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "client_manager",
    label: ACCESS_PRESET_LABELS.client_manager,
    description: "Pode ver os leads da empresa dele, integrar WhatsApp e gerar API keys.",
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "manager",
    permissions: [...ACCESS_PRESET_DEFAULTS.client_manager.permissions],
    internalPages: [],
    allowedViews: [...ACCESS_PRESET_DEFAULTS.client_manager.allowedViews],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "client_operator",
    label: ACCESS_PRESET_LABELS.client_operator,
    description: "Um vendedor do cliente. Pode apenas falar com os leads (não pode deletar nada, nem ver configs).",
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: [...ACCESS_PRESET_DEFAULTS.client_operator.permissions],
    internalPages: [],
    allowedViews: [...ACCESS_PRESET_DEFAULTS.client_operator.allowedViews],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "client_viewer",
    label: ACCESS_PRESET_LABELS.client_viewer,
    description: "Acesso apenas de leitura para o cliente.",
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "none",
    permissions: [...ACCESS_PRESET_DEFAULTS.client_viewer.permissions],
    internalPages: [],
    allowedViews: [...ACCESS_PRESET_DEFAULTS.client_viewer.allowedViews],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "pending",
    label: ACCESS_PRESET_LABELS.pending,
    description: "Conta ainda sem liberacao operacional.",
    role: "pending",
    scopeMode: "no_client_access",
    approvalLevel: "none",
    permissions: [],
    internalPages: [],
    allowedViews: [],
    isSystem: true,
    isLocked: false,
  },
];

function getPresetFallbackKey(preset) {
  const normalized = normalizeString(preset)?.toLowerCase() || "";

  if (normalized === "pending" || normalized.startsWith("pending")) {
    return "pending";
  }

  if (normalized.startsWith("client")) {
    return "client_operator";
  }

  return "operador";
}

function normalizeRole(value) {
  const normalized = normalizeString(value)?.toLowerCase();

  if (!normalized) return "internal";

  if (["client", "cliente", "customer"].includes(normalized)) {
    return "client";
  }

  if (["pending", "pendente", "pending_client", "cliente_pendente"].includes(normalized)) {
    return "pending";
  }

  return "internal";
}

function isValidManagedRoleInput(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  return Boolean(
    normalized &&
      [
        "internal",
        "client",
        "pending",
        "cliente",
        "customer",
        "pendente",
        "pending_client",
        "cliente_pendente",
      ].includes(normalized)
  );
}

function isValidManagedPresetInput(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  return !normalized || /^[a-z0-9_-]+$/.test(normalized);
}

function isValidManagedScopeInput(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return true;

  return (
    ACCESS_SCOPE_KEYS.includes(normalized) ||
    ["all", "global", "all_tenants", "assigned", "restricted", "assigned_tenants", "none", "no_access", "sem_escopo"].includes(normalized)
  );
}

function isValidManagedApprovalLevelInput(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  return !normalized || APPROVAL_LEVEL_KEYS.includes(normalized);
}

function getDefaultPresetForRole(role) {
  if (role === "client") return "client_operator";
  if (role === "pending") return "pending";
  return "operador";
}

function normalizeAccessPreset(value, role = "internal") {
  const normalized = normalizeString(value)?.toLowerCase();

  if (normalized && ACCESS_PRESET_KEYS.includes(normalized)) {
    const preset = normalized;
    return ACCESS_PRESET_DEFAULTS[preset].role === role ? preset : getDefaultPresetForRole(role);
  }

  if (normalized) {
    return normalized;
  }

  return getDefaultPresetForRole(role);
}

function getAccessPresetLabel(preset) {
  const normalized = normalizeString(preset)?.toLowerCase() || "";
  if (!normalized) return "Tipo sem nome";

  const labels = {
    admin_vexo: "Admin Vexo",
    gestor: "Gestor",
    operador: "Operador",
    parceiro: "Parceiro",
    client_manager: "Gestor do cliente",
    client_operator: "Operador do cliente",
    client_viewer: "Leitura do cliente",
    pending: "Aguardando aprovacao",
  };

  return (
    labels[normalized] ||
    normalized
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

function buildPresetDefaults(preset) {
  const defaults = ACCESS_PRESET_DEFAULTS[preset] || ACCESS_PRESET_DEFAULTS[getPresetFallbackKey(preset)];

  return {
    role: defaults.role,
    scopeMode: defaults.scopeMode,
    approvalLevel: defaults.approvalLevel,
    permissions: [...defaults.permissions],
    internalPages: [...defaults.internalPages],
    allowedViews: [...defaults.allowedViews],
  };
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(value.map((item) => normalizeString(item)).filter(Boolean))
    );
  }

  const normalized = normalizeString(value);
  if (!normalized) return [];

  return Array.from(
    new Set(
      normalized
        .split(",")
        .map((item) => normalizeString(item))
        .filter(Boolean)
    )
  );
}

function normalizeScopeMode(value, role) {
  if (role === "pending") {
    return "no_client_access";
  }

  if (role === "client") {
    return "assigned_clients";
  }

  const normalized = normalizeString(value)?.toLowerCase();

  if (normalized && ACCESS_SCOPE_KEYS.includes(normalized)) {
    return normalized;
  }

  if (normalized === "all" || normalized === "global" || normalized === "all_tenants") {
    return "all_clients";
  }

  if (normalized === "assigned" || normalized === "restricted" || normalized === "assigned_tenants") {
    return "assigned_clients";
  }

  if (normalized === "none" || normalized === "no_access" || normalized === "sem_escopo") {
    return "no_client_access";
  }

  return role === "internal" ? "all_clients" : "assigned_clients";
}

function normalizeApprovalLevel(value, role) {
  if (role === "pending") {
    return "none";
  }

  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized && APPROVAL_LEVEL_KEYS.includes(normalized)) {
    return normalized;
  }

  return buildPresetDefaults(getDefaultPresetForRole(role)).approvalLevel;
}

function normalizePermissions(value, role, preset = getDefaultPresetForRole(role)) {
  if (role === "pending") {
    return [];
  }

  const selected = normalizeStringArray(value)
    .map((item) => item.toLowerCase())
    .filter((item) => ACCESS_PERMISSION_KEYS.includes(item));

  if (selected.length > 0) {
    return Array.from(new Set(selected));
  }

  return buildPresetDefaults(preset).permissions;
}

function normalizeAllowedViews(value, role, preset = getDefaultPresetForRole(role)) {
  const allowed = normalizeStringArray(value)
    .map((item) => item.toLowerCase())
    .filter((item) => CLIENT_VIEW_KEYS.includes(item));

  if (role === "client" && allowed.length === 0) {
    const defaults = buildPresetDefaults(preset).allowedViews;
    return defaults.length ? defaults : [...DEFAULT_CLIENT_VIEWS];
  }

  return Array.from(new Set(allowed));
}

function normalizeInternalPages(value, role, isAdmin = false, preset = "internal_operator") {
  if (role !== "internal") {
    return [];
  }

  if (isAdmin) {
    return [...INTERNAL_PAGE_KEYS];
  }

  const pages = normalizeStringArray(value)
    .map((item) => item.toLowerCase())
    .filter((item) => INTERNAL_PAGE_KEYS.includes(item));

  if (pages.length === 0) {
    return buildPresetDefaults(preset).internalPages;
  }

  return Array.from(new Set(pages));
}

function hasManagedAccessClaims(rawClaims = {}) {
  if (!rawClaims || typeof rawClaims !== "object") {
    return false;
  }

  return MANAGED_CLAIM_KEYS.some((key) => Object.prototype.hasOwnProperty.call(rawClaims, key));
}

function extractManagedAccessClaims(rawClaims = {}, identity = {}) {
  if (!hasManagedAccessClaims(rawClaims) && !isFixedAdminIdentity(identity)) {
    return {
      role: "pending",
      isAdmin: false,
      accessPreset: "pending",
      scopeMode: "no_client_access",
      approvalLevel: "none",
      clientId: null,
      clientIds: [],
      tenantId: null,
      tenantIds: [],
      allowedViews: [],
      internalPages: [],
      permissions: [],
      companyName: normalizeString(rawClaims.companyName),
    };
  }

  const requestedRole = normalizeRole(
    rawClaims.role ??
      rawClaims.userRole ??
      rawClaims.user_type ??
      rawClaims.userType ??
      rawClaims.tipo_usuario
  );
  const directClientId = normalizeString(
    rawClaims.clientId ??
      rawClaims.client_id ??
      rawClaims.companyId ??
      rawClaims.empresaId ??
      rawClaims.tenantId
  );
  const isVexoUser = directClientId === "vexo" || isFixedAdminIdentity(identity);
  const isAdmin = isVexoUser;
  const role = isAdmin ? "internal" : requestedRole;
  const accessPreset = normalizeAccessPreset(rawClaims.accessPreset, role);
  const normalizedPreset = isAdmin ? "admin_vexo" : normalizeAccessPreset(accessPreset, role);
  const scopeMode = isAdmin
    ? "all_clients"
    : normalizeScopeMode(rawClaims.scopeMode ?? rawClaims.tenantScope, role);
  const approvalLevel = isAdmin
    ? "director"
    : normalizeApprovalLevel(rawClaims.approvalLevel, role);
  const clientIds = Array.from(
    new Set([
      directClientId,
      ...normalizeStringArray(rawClaims.clientIds),
      ...normalizeStringArray(rawClaims.tenantIds),
    ].filter(Boolean))
  );
  const preserveClientAssignments = role === "pending";
  const clientId = preserveClientAssignments
    ? directClientId || clientIds[0] || null
    : scopeMode === "no_client_access"
      ? null
      : directClientId || clientIds[0] || null;
  const allowedViews = role === "client"
    ? normalizeAllowedViews(rawClaims.allowedViews, role, normalizedPreset)
    : [];
  const internalPages = role === "internal"
    ? normalizeInternalPages(rawClaims.internalPages, role, isAdmin, normalizedPreset)
    : [];
  const permissions = isAdmin
    ? [...buildPresetDefaults("admin_vexo").permissions]
    : normalizePermissions(rawClaims.permissions, role, normalizedPreset);

  return {
    role,
    isAdmin,
    accessPreset: normalizedPreset,
    scopeMode,
    approvalLevel,
    clientId,
    clientIds: preserveClientAssignments || scopeMode !== "no_client_access" ? clientIds : [],
    tenantId: clientId,
    tenantIds: preserveClientAssignments || scopeMode !== "no_client_access" ? clientIds : [],
    allowedViews,
    internalPages,
    permissions,
    companyName: normalizeString(rawClaims.companyName),
  };
}

function buildAccessProfile(decodedToken) {
  const claims = extractManagedAccessClaims(decodedToken, decodedToken);

  return {
    uid: decodedToken.uid,
    email: normalizeString(decodedToken.email),
    role: claims.role,
    isAdmin: claims.isAdmin,
    accessPreset: claims.accessPreset,
    scopeMode: claims.scopeMode,
    approvalLevel: claims.approvalLevel,
    clientId: claims.clientId,
    clientIds: claims.clientIds,
    tenantId: claims.tenantId,
    tenantIds: claims.tenantIds,
    allowedViews: claims.allowedViews,
    internalPages: claims.internalPages,
    permissions: claims.permissions,
    companyName: claims.companyName,
  };
}

async function requireFirebaseAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return;
  }

  const token = authHeader.slice("Bearer ".length);

  if (!firebaseReady) {
    // Em modo de desenvolvimento local, podemos decodificar o payload do JWT do Firebase
    // sem validar a assinatura, permitindo testes locais funcionais sem serviceAccountKey configurado.
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payloadBuf = Buffer.from(parts[1], 'base64');
        const decoded = JSON.parse(payloadBuf.toString('utf8'));
        const accessProfile = buildAccessProfile(decoded);

        if (accessProfile.role === "client" && accessProfile.clientIds.length === 0) {
          sendError(
            res,
            403,
            "INVALID_CLIENT_SCOPE",
            "Client user is missing client scope",
            "Set the Firebase custom claim clientIds for this user"
          );
          return;
        }

        req.authUser = decoded;
        req.authAccess = accessProfile;
        next();
        return;
      }
    } catch (decodeError) {
      console.error("Local dev Firebase token decode failed:", decodeError);
    }

    sendError(
      res,
      500,
      "FIREBASE_NOT_CONFIGURED",
      "Firebase auth not configured",
      "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in backend env"
    );
    return;
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    const accessProfile = buildAccessProfile(decoded);

    if (accessProfile.role === "client" && accessProfile.clientIds.length === 0) {
      sendError(
        res,
        403,
        "INVALID_CLIENT_SCOPE",
        "Client user is missing client scope",
        "Set the Firebase custom claim clientIds for this user"
      );
      return;
    }

    req.authUser = decoded;
    req.authAccess = accessProfile;
    next();
  } catch (error) {
    console.error("Firebase token validation failed:", error);
    sendError(res, 401, "INVALID_TOKEN", "Invalid token");
  }
}

function requireInternalAccess(req, res, next) {
  if (req.authAccess?.role !== "internal") {
    sendError(res, 403, "FORBIDDEN", "Forbidden");
    return;
  }

  next();
}

function requireAdminAccess(req, res, next) {
  if (req.authAccess?.role !== "internal" || !req.authAccess?.isAdmin) {
    sendError(res, 403, "FORBIDDEN", "Admin permission required");
    return;
  }

  next();
}

function requireUserManagementAccess(req, res, next) {
  if (req.authAccess?.role !== "internal") {
    sendError(res, 403, "FORBIDDEN", "Internal access required");
    return;
  }

  if (hasUserPermission(req.authAccess, "users.manage")) {
    next();
    return;
  }

  sendError(res, 403, "FORBIDDEN", "User management permission required");
}

function requireInternalPageAccess(page) {
  return (req, res, next) => {
    const access = req.authAccess;

    if (access?.role !== "internal") {
      sendError(res, 403, "FORBIDDEN", "Internal access required");
      return;
    }

    if (hasInternalPageAccess(access, page)) {
      next();
      return;
    }

    sendError(res, 403, "FORBIDDEN", `Missing permission for page ${page}`);
  };
}

function requireAnyInternalPageAccess(pages) {
  const normalizedPages = Array.isArray(pages) ? pages.filter(Boolean) : [];

  return (req, res, next) => {
    const access = req.authAccess;

    if (access?.role !== "internal") {
      sendError(res, 403, "FORBIDDEN", "Internal access required");
      return;
    }

    if (access.isAdmin || normalizedPages.some((page) => access.internalPages?.includes(page))) {
      next();
      return;
    }

    sendError(
      res,
      403,
      "FORBIDDEN",
      `Missing permission for pages ${normalizedPages.join(", ")}`
    );
  };
}

function requireAppViewAccess(view) {
  return (req, res, next) => {
    const access = req.authAccess;

    if (!access || access.role === "pending") {
      sendError(res, 403, "PENDING_APPROVAL", "Your account is waiting for approval");
      return;
    }

    if (canAccessAppView(access, view)) {
      next();
      return;
    }

    sendError(res, 403, "FORBIDDEN", `Missing permission for view ${view}`);
  };
}

function canManageGlobalNotifications(access) {
  if (access?.role !== "internal") {
    return false;
  }

  return (
    access.isAdmin ||
    hasAccessPermission(access, "users.manage") ||
    hasAccessPermission(access, "tenants.manage")
  );
}

function normalizeNotificationScopeValues(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }

  const singleValue = normalizeString(value);
  return singleValue ? [singleValue] : [];
}

function matchesNotificationClientScope(notification, access) {
  const notificationClientIds = Array.from(
    new Set([
      ...normalizeNotificationScopeValues(notification?.client_id),
      ...normalizeNotificationScopeValues(notification?.clientId),
      ...normalizeNotificationScopeValues(notification?.tenant_id),
      ...normalizeNotificationScopeValues(notification?.tenantId),
      ...normalizeNotificationScopeValues(notification?.client_ids),
      ...normalizeNotificationScopeValues(notification?.clientIds),
      ...normalizeNotificationScopeValues(notification?.tenant_ids),
      ...normalizeNotificationScopeValues(notification?.tenantIds),
    ])
  );

  if (notificationClientIds.length === 0) {
    return true;
  }

  if (access?.role !== "internal") {
    return false;
  }

  if (access.isAdmin || access.scopeMode === "all_clients") {
    return true;
  }

  const accessClientIds = new Set(normalizeStringArray(access.clientIds || access.tenantIds || []));
  if (accessClientIds.size === 0) {
    return false;
  }

  return notificationClientIds.some((clientId) => accessClientIds.has(clientId));
}

function matchesNotificationInternalScope(notification, access) {
  const requiredPages = Array.from(
    new Set([
      ...normalizeNotificationScopeValues(notification?.internal_page),
      ...normalizeNotificationScopeValues(notification?.internalPage),
      ...normalizeNotificationScopeValues(notification?.internal_pages),
      ...normalizeNotificationScopeValues(notification?.internalPages),
      ...normalizeNotificationScopeValues(notification?.target_page),
      ...normalizeNotificationScopeValues(notification?.targetPage),
      ...normalizeNotificationScopeValues(notification?.target_pages),
      ...normalizeNotificationScopeValues(notification?.targetPages),
    ])
  );
  const requiredPermissions = Array.from(
    new Set([
      ...normalizeNotificationScopeValues(notification?.permission),
      ...normalizeNotificationScopeValues(notification?.permissions),
      ...normalizeNotificationScopeValues(notification?.target_permission),
      ...normalizeNotificationScopeValues(notification?.targetPermission),
      ...normalizeNotificationScopeValues(notification?.target_permissions),
      ...normalizeNotificationScopeValues(notification?.targetPermissions),
    ])
  );

  if (requiredPages.length === 0 && requiredPermissions.length === 0) {
    return true;
  }

  if (access?.role !== "internal") {
    return false;
  }

  if (access.isAdmin) {
    return true;
  }

  if (requiredPages.some((page) => hasInternalPageAccess(access, page))) {
    return true;
  }

  if (requiredPermissions.some((permission) => hasAccessPermission(access, permission))) {
    return true;
  }

  return false;
}

function isNotificationVisibleToAccess(notification, access) {
  if (!notification || access?.role !== "internal") {
    return false;
  }

  return (
    matchesNotificationClientScope(notification, access) &&
    matchesNotificationInternalScope(notification, access)
  );
}

function filterNotificationsForAccess(items, access) {
  return (Array.isArray(items) ? items : []).filter((item) =>
    isNotificationVisibleToAccess(item, access)
  );
}

function getVisibleNotificationIds(items, access) {
  return filterNotificationsForAccess(items, access)
    .map((item) => item?.id)
    .filter(Boolean);
}

function ensureSharedRoutePageAccess(req, res, page) {
  const access = req.authAccess;

  if (access?.role === "pending") {
    sendError(res, 403, "PENDING_APPROVAL", "Your account is waiting for approval");
    return false;
  }

  if (canAccessAppView(access, page)) {
    return true;
  }

  sendError(res, 403, "FORBIDDEN", `Missing permission for view ${page}`);
  return false;
}

function normalizeString(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.startsWith("=") ? str.slice(1).trim() : str;
}

function normalizeTenantKey(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const tenantKey = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 50);

  if (!tenantKey || tenantKey.length < 3) {
    return null;
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantKey)) {
    return null;
  }

  return tenantKey;
}

/**
 * Retorna o nome da tabela de leads para um clientId.
 * Padrão: leads_{clientId} com underscores (ex: leads_infinie, leads_outlier, leads_teste).
 * Valida estritamente para evitar SQL injection.
 */
function leadsTableName(clientId) {
  const safe = String(clientId || "").toLowerCase().replace(/-/g, "_").replace(/[^a-z0-9_]/g, "");
  if (!safe || safe.length < 2) throw new Error(`Invalid clientId for leads table: "${clientId}"`);
  return `leads_${safe}`;
}

function normalizeHttpUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function getRequestId(req) {
  return (
    normalizeString(req.headers["x-request-id"]) ||
    normalizeString(req.headers["x-correlation-id"]) ||
    randomUUID()
  );
}

function maskPhoneForLog(phone) {
  const normalized = normalizeString(phone);
  if (!normalized) return null;
  const lastDigits = normalized.slice(-4);
  return `${"*".repeat(Math.max(normalized.length - 4, 0))}${lastDigits}`;
}

function getClientEnvSuffix(clientId) {
  const normalized = normalizeString(clientId);
  if (!normalized) return null;
  return normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseJsonEnvMap(name) {
  const raw = normalizeString(process.env[name]);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    console.warn("[campaign-direct-dispatch] invalid json env map", {
      env: name,
      error: error instanceof Error ? error.message : "invalid json",
    });
    return null;
  }
}

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

export function buildDefaultSegmentationConfig(model = "generico") {
  const normalizedModel = normalizeTenantKey(model) || "generico";
  const defaults = {
    outlier: [
      { id: "objetivo", label: "Objetivo", field: "objetivo_compra", type: "category", enabled: true },
      { id: "credito", label: "Credito", field: "valor_credito", type: "money", enabled: true },
      { id: "entrada", label: "Entrada/FGTS", field: "fgts_entrada", type: "money", enabled: true },
    ],
    infinie: [
      { id: "consumo", label: "Conta de luz", field: "faixa_consumo", type: "money", enabled: true },
      { id: "cidade", label: "Cidade", field: "cidade", type: "category", enabled: true },
      { id: "prazo", label: "Prazo", field: "prazo_instalacao", type: "category", enabled: true },
    ],
    livpub: [
      { id: "perfil", label: "Perfil Musical", field: "perfil_musical", type: "category", enabled: true },
      { id: "visita", label: "Última Visita", field: "ultima_visita", type: "date", enabled: true },
      { id: "nascimento", label: "Nascimento", field: "data_nascimento", type: "date", enabled: true }
    ],
    generico: [
      { id: "origem", label: "Origem", field: "origem", type: "category", enabled: true },
      { id: "interesse", label: "Interesse", field: "interesse", type: "category", enabled: true },
      { id: "valor", label: "Valor", field: "valor", type: "money", enabled: true },
    ],
  };

  return {
    version: 1,
    kpis: defaults[normalizedModel] || defaults.generico,
  };
}

function sanitizeSegmentationConfig(input, model = "generico") {
  // Catálogo unificado v2 (fields[] sem cap + featuredKpis cap 6). Compat: lê v1 (kpis[]).
  const hasContent =
    input && typeof input === "object" && (Array.isArray(input.fields) || Array.isArray(input.kpis));
  const source = hasContent ? input : buildDefaultSegmentationConfig(model);
  const catalog = normalizeSegmentationCatalog(source);

  // Espelho legado kpis[] derivado de featuredKpis — mantém leitores antigos do front
  // funcionando durante a transição (removível quando o front migrar 100%).
  const fieldsByName = new Map(catalog.fields.map((f) => [f.field, f]));
  const kpis = catalog.featuredKpis.map((field) => {
    const f = fieldsByName.get(field);
    return { id: field, label: f?.label || field, field, type: f?.type || "category", enabled: true };
  });

  return { ...catalog, kpis };
}

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

function getRequestBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
}

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

// ---------------------------------------------------------------------------
// Webhook estilo Edge `lead-webhook` + validação de import do chat outlier
// ---------------------------------------------------------------------------
// - sanitizePhoneLeadWebhookStyle / Bearer: paridade com a Edge (telefone só dígitos; sem expandir +55).
// - validateLeadsOutlierRecord: monta uma linha para INSERT em `public.leads_outlier` a partir do JSON do outro chat.
// ---------------------------------------------------------------------------

/** Telefone só com dígitos — alinhado à Edge `lead-webhook` (sem normalização BR tipo +55). */
function sanitizePhoneLeadWebhookStyle(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, "");
  return digits || null;
}

/** Segredo Bearer do POST /api/lead-webhook (paridade Edge). Em produção, sobrescrever com LEAD_WEBHOOK_BEARER_TOKEN. */
function getLeadWebhookBearerSecret() {
  return normalizeString(process.env.LEAD_WEBHOOK_BEARER_TOKEN) || "@Vexo2026";
}

/** Resposta JSON no mesmo estilo da Edge (sem cache no browser/proxy). */
function sendLeadWebhookEdgeStyle(res, status, payload) {
  res.set("Cache-Control", "no-store");
  res.status(status).json(payload);
}

/** Confere Authorization: Bearer contra o segredo fixo do lead-webhook. */
function validateLeadWebhookBearer(req, res) {
  const token = getRequestBearerToken(req);
  const expected = getLeadWebhookBearerSecret();
  if (!token || token !== expected) {
    sendLeadWebhookEdgeStyle(res, 401, { success: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

/** Valores permitidos de `status_conversa` para `leads_outlier` (import do chat outlier). */
const LEADS_OUTLIER_STATUS_CONVERSA = new Set(["aguardando_usuario", "em_atendimento", "finalizado"]);
/** Temperatura do lead (nullable). O JSON pode enviar em `status` ou `lead_temperature`. */
const LEADS_OUTLIER_TEMPERATURE = new Set(["QUENTE", "MORNO", "FRIO"]);
/** Fases SPIN permitidas (nullable). */
const LEADS_OUTLIER_SPIN_FASE = new Set(["situacao", "problema", "implicacao", "necessidade"]);
/** Chaves opcionais conhecidas em `dados` (string, number ou null). */
const LEADS_OUTLIER_DADOS_KEYS = new Set([
  "nome",
  "cidade",
  "estado",
  "interesse",
  "objetivo",
  "credito",
  "parcela",
  "prazo",
  "lance_entrada_fgts",
  "experiencia_consorcio",
  "motivacao",
  "decisor",
  "melhor_horario",
]);

/** Limite máximo de registos por pedido nos endpoints de import outlier. */
const MAX_LEADS_OUTLIER_BATCH = 2000;

/** Garante que `dados` é um objeto só com chaves permitidas e valores string | number | null. */
function sanitizeLeadsOutlierDados(raw) {
  if (raw === undefined || raw === null) {
    return { value: {} };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "dados tem de ser um objeto simples" };
  }
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!LEADS_OUTLIER_DADOS_KEYS.has(key)) {
      return { error: `dados tem chave desconhecida: ${key}` };
    }
    const v = raw[key];
    if (v === null || v === undefined) {
      out[key] = null;
      continue;
    }
    if (typeof v === "string") {
      out[key] = v;
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = v;
      continue;
    }
    return { error: `dados.${key} tem de ser string, número ou null` };
  }
  return { value: out };
}

/** Metadados opcionais de comportamento do bot (objeto livre, sem validação de chaves). */
function sanitizeLeadsOutlierBehaviorMeta(raw) {
  if (raw === undefined || raw === null) {
    return { value: undefined };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "behavior_meta tem de ser um objeto simples" };
  }
  return { value: raw };
}

/** Número finito opcional; vazio vira null. `fieldLabel` entra na mensagem de erro. */
function parseOptionalFiniteNumber(value, fieldLabel) {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n)) {
    return { error: `${fieldLabel} tem de ser um número finito` };
  }
  return { value: n };
}

/** UUID em string opcional; vazio vira null. */
function parseOptionalUuid(value, fieldLabel) {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }
  const s = normalizeString(value);
  if (!s || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return { error: `${fieldLabel} tem de ser uma string UUID válida` };
  }
  return { value: s.toLowerCase() };
}

/**
 * Valida um item do payload do chat outlier. Devolve `{ row }` para insert na BD ou `{ error }`.
 * Espelha colunas de `public.leads` quando aplicável; estado do pipeline em `pipeline_status` → coluna `status`.
 * Temperatura do bot: JSON `status` ou `lead_temperature` → coluna `lead_temperature`.
 * @param {unknown} record objeto de um lead (outlier)
 * @param {string} indexLabel rótulo para erros, ex.: `items[3]`
 */
function validateLeadsOutlierRecord(record, indexLabel = "") {
  const prefix = indexLabel ? `${indexLabel}: ` : "";
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { error: `${prefix}cada item tem de ser um objeto simples` };
  }

  const telefone = sanitizePhone(record.telefone ?? record.Telefone);
  if (!telefone) {
    return { error: `${prefix}telefone é obrigatório e tem de ser um número de telefone válido` };
  }

  if (typeof record.mensagem !== "string") {
    return { error: `${prefix}mensagem tem de ser uma string` };
  }
  if (typeof record.finalizado !== "boolean") {
    return { error: `${prefix}finalizado tem de ser um booleano` };
  }
  if (
    typeof record.status_conversa !== "string" ||
    !LEADS_OUTLIER_STATUS_CONVERSA.has(record.status_conversa)
  ) {
    return {
      error: `${prefix}status_conversa tem de ser aguardando_usuario, em_atendimento ou finalizado`,
    };
  }

  let leadTemperature = null;
  const legacyTemp = record.status;
  if (Object.prototype.hasOwnProperty.call(record, "lead_temperature")) {
    const explicitTemp = record.lead_temperature;
    if (explicitTemp === null || explicitTemp === undefined) {
      leadTemperature = null;
    } else if (typeof explicitTemp === "string" && LEADS_OUTLIER_TEMPERATURE.has(explicitTemp)) {
      leadTemperature = explicitTemp;
    } else {
      return { error: `${prefix}lead_temperature tem de ser null, QUENTE, MORNO ou FRIO` };
    }
  } else if (legacyTemp !== undefined && legacyTemp !== null) {
    if (typeof legacyTemp !== "string" || !LEADS_OUTLIER_TEMPERATURE.has(legacyTemp)) {
      return {
        error: `${prefix}status tem de ser null, QUENTE, MORNO ou FRIO (temperatura do lead), ou use pipeline_status para o estado do pipeline no CRM`,
      };
    }
    leadTemperature = legacyTemp;
  }

  if (record.spin_fase !== undefined && record.spin_fase !== null) {
    if (typeof record.spin_fase !== "string" || !LEADS_OUTLIER_SPIN_FASE.has(record.spin_fase)) {
      return {
        error: `${prefix}spin_fase tem de ser null ou situacao, problema, implicacao, necessidade`,
      };
    }
  }

  const dadosResult = sanitizeLeadsOutlierDados(record.dados);
  if (dadosResult.error) {
    return { error: `${prefix}${dadosResult.error}` };
  }

  const behaviorResult = sanitizeLeadsOutlierBehaviorMeta(record.behavior_meta);
  if (behaviorResult.error) {
    return { error: `${prefix}${behaviorResult.error}` };
  }

  const nomeFromRecord = normalizeString(record.nome ?? record.Nome);
  const nomeFromDados =
    dadosResult.value && typeof dadosResult.value.nome === "string"
      ? normalizeString(dadosResult.value.nome)
      : null;
  const nome = nomeFromRecord ?? nomeFromDados;

  const pipelineStatus = normalizeString(
    record.pipeline_status ?? record.pipelineStatus ?? record.lead_status
  );

  const leadScoreParsed = parseOptionalFiniteNumber(record.lead_score, `${prefix}lead_score`);
  if (leadScoreParsed.error) {
    return { error: leadScoreParsed.error };
  }
  const potentialParsed = parseOptionalFiniteNumber(
    record.potential_contract_value,
    `${prefix}potential_contract_value`
  );
  if (potentialParsed.error) {
    return { error: potentialParsed.error };
  }

  const uuidResult = parseOptionalUuid(record.source_campaign_id, `${prefix}source_campaign_id`);
  if (uuidResult.error) {
    return { error: uuidResult.error };
  }

  // Linha normalizada para INSERT em `leads_outlier` (campos alinhados à tabela).
  /** @type {Record<string, unknown>} */
  const row = {
    telefone,
    mensagem: record.mensagem,
    finalizado: record.finalizado,
    status_conversa: record.status_conversa,
    lead_temperature: leadTemperature,
    status: pipelineStatus,
    spin_fase:
      record.spin_fase === undefined || record.spin_fase === null ? null : record.spin_fase,
    dados: dadosResult.value,
    nome,
    bot_ativo: record.bot_ativo !== undefined ? normalizeBool(record.bot_ativo) : false,
    historico: normalizeString(record.historico),
    data_hora: normalizeIsoDate(record.data_hora ?? record["Data e Hora"]),
    qualificacao: normalizeString(
      record.qualificacao ?? record.Qualificacao ?? record.resumo ?? record.Resumo
    ),
    ultima_interacao_bot: normalizeIsoDate(record.ultima_interacao_bot),
    ultima_interacao_usuario: normalizeIsoDate(record.ultima_interacao_usuario),
    lead_score: leadScoreParsed.value,
    potential_contract_value: potentialParsed.value,
    first_contact_at: normalizeIsoDate(record.first_contact_at),
    qualified_at: normalizeIsoDate(record.qualified_at),
    closed_at: normalizeIsoDate(record.closed_at),
    lead_origin: normalizeString(record.lead_origin),
    source_campaign_id: uuidResult.value,
  };

  if (behaviorResult.value !== undefined) {
    row.behavior_meta = behaviorResult.value;
  }

  return { row };
}

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

function isDuplicateKeyError(error) {
  const code = normalizeString(error?.code);
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();

  return code === "23505" || message.includes("duplicate key");
}

function normalizeBool(value) {
  return value === true || value === "true" || value === "TRUE" || value === "1";
}

function normalizeIsoDate(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function sanitizePhone(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  let digits = normalized.replace(/\D/g, "");
  if (!digits) return null;

  // Remove common Brazilian long-distance prefix if present.
  if (digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
  }

  // Local/national BR numbers from spreadsheets usually arrive with 10 or 11 digits.
  // Persist them in E.164-like format using country code 55.
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("55")) {
    const national = digits.slice(2);
    if (national.length === 10) {
      return `55${national}`;
    }
  }

  if (digits.length === 13 && digits.startsWith("55")) {
    return digits;
  }

  return digits;
}

function buildPhoneLookupVariants(value) {
  const phone = sanitizePhone(value);
  if (!phone) return [];

  const variants = new Set([phone]);

  if (phone.startsWith("55")) {
    const national = phone.slice(2);
    if (national.length === 10) {
      variants.add(`55${national.slice(0, 2)}9${national.slice(2)}`);
    }
    if (national.length === 11 && national[2] === "9") {
      variants.add(`55${national.slice(0, 2)}${national.slice(3)}`);
    }
  }

  return [...variants];
}

function normalizePhoneToWhatsAppChatId(value) {
  const phone = sanitizePhone(value);
  return phone ? `${phone}@c.us` : null;
}

function normalizeWhatsAppChatId(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  if (normalized.includes("@")) {
    const [base] = normalized.split("@");
    const digits = base.replace(/\D/g, "");
    return digits ? `${digits}@c.us` : normalized;
  }

  return normalizePhoneToWhatsAppChatId(normalized);
}

async function getAuthorizedClientWhatsAppChatIds(clientIds = []) {
  if (!supabase) {
    throw new Error("Database is not configured");
  }

  if (!clientIds.length) {
    return new Set();
  }

  const results = await Promise.all(
    clientIds.map(async (id) => {
      try {
        const { data } = await supabase.from(leadsTableName(id)).select("telefone");
        return data || [];
      } catch {
        return [];
      }
    })
  );

  return new Set(
    results.flat()
      .map((item) => normalizePhoneToWhatsAppChatId(item.telefone))
      .filter(Boolean)
  );
}

async function getAuthorizedWhatsAppChatIdsForRequest(req, res) {
  if (req.authAccess?.role !== "client") {
    return null;
  }

  if (!ensureDb(res)) {
    return null;
  }

  try {
    return await getAuthorizedClientWhatsAppChatIds(req.authAccess.clientIds || []);
  } catch (error) {
    console.error("authorized whatsapp chats query error:", error);
    sendError(
      res,
      500,
      "WHATSAPP_SCOPE_QUERY_FAILED",
      error instanceof Error ? error.message : "Failed to resolve WhatsApp scope"
    );
    return null;
  }
}

async function ensureAuthorizedWhatsAppChat(req, res, chatId) {
  if (req.authAccess?.role !== "client") {
    return true;
  }

  const authorizedChatIds = await getAuthorizedWhatsAppChatIdsForRequest(req, res);
  if (!authorizedChatIds) {
    return false;
  }

  const normalizedChatId = normalizeWhatsAppChatId(chatId);
  if (normalizedChatId && authorizedChatIds.has(normalizedChatId)) {
    return true;
  }

  sendError(res, 403, "FORBIDDEN_CLIENT_SCOPE", "You do not have access to this WhatsApp chat");
  return false;
}

async function ensureAuthorizedWhatsAppPhone(req, res, phone) {
  if (req.authAccess?.role !== "client") {
    return true;
  }

  const authorizedChatIds = await getAuthorizedWhatsAppChatIdsForRequest(req, res);
  if (!authorizedChatIds) {
    return false;
  }

  const normalizedChatId = normalizePhoneToWhatsAppChatId(phone);
  if (normalizedChatId && authorizedChatIds.has(normalizedChatId)) {
    return true;
  }

  sendError(res, 403, "FORBIDDEN_CLIENT_SCOPE", "You do not have access to this WhatsApp contact");
  return false;
}

function isValidBase64(value) {
  if (!value || typeof value !== "string") return false;
  if (value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(value);
}

/** Global bearer for n8n-facing routes (POST/GET conversation-memory*, POST n8n-error-webhook). Env overrides; default matches legacy Edge. */
function getN8nWebhookBearerSecret() {
  return normalizeString(process.env.N8N_WEBHOOK_SECRET) || "@Vexo2026";
}

function requireN8nWebhookSecret(req, res, next) {
  const authHeader = req.headers.authorization;
  const expectedSecret = getN8nWebhookBearerSecret();

  if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return;
  }

  next();
}

function validateConversationMemoryPayload(req, res, next) {
  const body = req.body || {};
  const telefone = sanitizePhone(body.telefone);
  const conversationCompressed = normalizeString(body.conversation_compressed);
  const tamanhoOriginal = body.tamanho_original;
  const timestamp = normalizeString(body.timestamp);

  if (!telefone || !conversationCompressed || tamanhoOriginal === undefined || !timestamp) {
    sendError(
      res,
      400,
      "INVALID_BODY",
      "Missing required fields: telefone, conversation_compressed, tamanho_original, timestamp"
    );
    return;
  }

  if (!Number.isInteger(tamanhoOriginal) || tamanhoOriginal <= 0) {
    sendError(res, 400, "INVALID_BODY", "tamanho_original must be a positive integer");
    return;
  }

  if (!isValidBase64(conversationCompressed)) {
    sendError(res, 400, "INVALID_BODY", "conversation_compressed must be valid base64");
    return;
  }

  const parsedTimestamp = new Date(timestamp);
  if (Number.isNaN(parsedTimestamp.getTime())) {
    sendError(res, 400, "INVALID_BODY", "timestamp must be a valid ISO date");
    return;
  }

  let compressedBuffer;
  let decompressedBuffer;

  try {
    compressedBuffer = Buffer.from(conversationCompressed, "base64");
    if (compressedBuffer.length === 0) {
      sendError(res, 400, "INVALID_BODY", "conversation_compressed must decode to non-empty bytes");
      return;
    }
    decompressedBuffer = gunzipSync(compressedBuffer);
  } catch (error) {
    console.error("conversation memory validation failed:", {
      event: "conversation_memory_validation_failed",
      reason: "invalid_gzip_or_base64",
      message: error instanceof Error ? error.message : String(error),
    });
    sendError(res, 400, "INVALID_BODY", "conversation_compressed must be valid gzip+base64");
    return;
  }

  if (decompressedBuffer.length > MAX_CONVERSATION_BYTES) {
    sendError(
      res,
      413,
      "PAYLOAD_TOO_LARGE",
      "Decompressed conversation exceeds 5MB limit"
    );
    return;
  }

  if (decompressedBuffer.length !== tamanhoOriginal) {
    sendError(
      res,
      400,
      "INVALID_BODY",
      "tamanho_original does not match decompressed conversation size"
    );
    return;
  }

  req.conversationMemory = {
    telefone,
    conversationCompressed,
    tamanhoOriginal,
    timestamp: parsedTimestamp.toISOString(),
  };

  next();
}

function getZonedDateParts(date, timeZone = "America/Sao_Paulo") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

function getDateKey(date, timeZone = "America/Sao_Paulo") {
  const parts = getZonedDateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getDateLabel(date, timeZone = "America/Sao_Paulo") {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function humanizeStatus(value) {
  const normalized = normalizeString(value);
  if (!normalized) return "Sem status";

  const map = {
    em_qualificacao: "Em qualificacao",
    qualificado: "Qualificado",
    qualificados: "Qualificados",
    contatado: "Contatado",
    contatados: "Contatados",
    convertido: "Convertido",
    convertidos: "Convertidos",
    filtrado: "Filtrado",
    filtrados: "Filtrados",
    recebido: "Recebido",
    recebidos: "Recebidos",
    aguardando_sdr: "Aguardando SDR",
  };

  return map[normalized] || normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function isQualifiedStatus(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  return normalized === "qualificado" || normalized === "qualificados" || normalized === "em_qualificacao";
}

function detectTemperature(lead) {
  try {
    const raw = lead?.qualificacao;
    const source =
      raw != null && typeof raw === "object"
        ? JSON.stringify(raw).toLowerCase()
        : normalizeString(raw)?.toLowerCase() || "";

    if (source.includes("quente")) return "hot";
    if (source.includes("morno")) return "warm";
    if (source.includes("frio")) return "cold";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** Safe date for bucketing; invalid spreadsheet values must not crash Intl formatting. */
function parseLeadReferenceDate(lead) {
  const tryParse = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return tryParse(lead?.data_hora) ?? tryParse(lead?.created_at);
}

function buildDashboardPayload(client, leads, conversions = [], messages = []) {
  const now = new Date();
  const timeZone = "America/Sao_Paulo";
  const todayKey = getDateKey(now, timeZone);
  const recentDays = Array.from({ length: 10 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (9 - index));
    const key = getDateKey(date, timeZone);
    return {
      key,
      day: getDateLabel(date, timeZone),
      leads: 0,
      qualifiedLeads: 0,
      respostas: 0,
    };
  });

  const recentDaysMap = new Map(recentDays.map((item) => [item.key, item]));
  const statusCounts = new Map();
  const typeCounts = new Map();
  const temperatureCounts = {
    hot: 0,
    warm: 0,
    cold: 0,
    unknown: 0,
  };

  let leadsToday = 0;
  let qualifiedLeads = 0;
  const cities = new Set();

  for (const lead of leads) {
    const statusKey = (normalizeString(lead.status) || "sem_status").toLowerCase();
    const typeKey = normalizeString(lead.tipo_cliente) || "nao_informado";
    const temperatureKey = detectTemperature(lead);
    const cityKey = normalizeString(lead.cidade);

    const referenceDate = parseLeadReferenceDate(lead);
    let dateKey = null;
    if (referenceDate) {
      try {
        dateKey = getDateKey(referenceDate, timeZone);
      } catch {
        console.warn("[dashboard] invalid date for lead bucketing", lead?.id);
      }
    }

    if (dateKey === todayKey) {
      leadsToday += 1;
    }

    if (isQualifiedStatus(statusKey)) {
      qualifiedLeads += 1;
    }

    temperatureCounts[temperatureKey] += 1;
    statusCounts.set(statusKey, (statusCounts.get(statusKey) || 0) + 1);
    typeCounts.set(typeKey, (typeCounts.get(typeKey) || 0) + 1);
    if (cityKey) {
      cities.add(cityKey.toLowerCase());
    }

    const dayEntry = dateKey ? recentDaysMap.get(dateKey) : null;
    if (dayEntry) {
      dayEntry.leads += 1;
      if (isQualifiedStatus(statusKey)) {
        dayEntry.qualifiedLeads += 1;
      }
    }
  }

  // Populate daily replies (respostas) based on inbound messages
  for (const m of messages) {
    if (m.direction !== "inbound") continue;
    const msgDate = new Date(m.created_at || now);
    let dateKey = null;
    try {
      dateKey = getDateKey(msgDate, timeZone);
    } catch {
      continue;
    }
    const dayEntry = dateKey ? recentDaysMap.get(dateKey) : null;
    if (dayEntry) {
      dayEntry.respostas = (dayEntry.respostas || 0) + 1;
    }
  }

  // ── Calculate metrics: responseRate, noContact3d, contactedLeads ───────────
  const outboundPhones = new Set();
  const inboundPhones = new Set();
  const outboundLeads = new Set();
  const inboundLeads = new Set();

  for (const m of messages) {
    const phone = m.phone;
    const leadId = m.lead_id;
    if (m.direction === "outbound") {
      if (leadId) outboundLeads.add(leadId);
      if (phone) outboundPhones.add(phone);
    } else if (m.direction === "inbound") {
      if (leadId) inboundLeads.add(leadId);
      if (phone) inboundPhones.add(phone);
    }
  }

  const totalMessaged = leads.filter((lead) => {
    return (lead.id && outboundLeads.has(lead.id)) || (lead.telefone && outboundPhones.has(lead.telefone));
  }).length;

  const totalResponded = leads.filter((lead) => {
    const sent = (lead.id && outboundLeads.has(lead.id)) || (lead.telefone && outboundPhones.has(lead.telefone));
    const replied = (lead.id && inboundLeads.has(lead.id)) || (lead.telefone && inboundPhones.has(lead.telefone));
    return sent && replied;
  }).length;

  const responseRate = totalMessaged === 0 ? 0 : Math.round((totalResponded / totalMessaged) * 100);

  // Sem contato +3 dias
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const lastContactByLead = new Map();
  const lastContactByPhone = new Map();

  for (const m of messages) {
    const msgDate = new Date(m.created_at || now);
    if (Number.isNaN(msgDate.getTime())) continue;

    if (m.lead_id) {
      const current = lastContactByLead.get(m.lead_id);
      if (!current || msgDate > current) {
        lastContactByLead.set(m.lead_id, msgDate);
      }
    }
    if (m.phone) {
      const current = lastContactByPhone.get(m.phone);
      if (!current || msgDate > current) {
        lastContactByPhone.set(m.phone, msgDate);
      }
    }
  }

  let noContact3d = 0;
  let contactedLeads = 0;

  for (const lead of leads) {
    const statusKey = (normalizeString(lead.status) || "sem_status").toLowerCase();
    const isClosedOrQualified = isQualifiedStatus(statusKey) || normalizeWonStatus(statusKey) || statusKey === "perdido" || statusKey === "arquivado";
    if (isClosedOrQualified) continue;

    // Last contact calculation for noContact3d
    let lastDate = null;
    if (lead.id && lastContactByLead.has(lead.id)) {
      lastDate = lastContactByLead.get(lead.id);
    } else if (lead.telefone && lastContactByPhone.has(lead.telefone)) {
      lastDate = lastContactByPhone.get(lead.telefone);
    } else {
      lastDate = parseLeadReferenceDate(lead);
    }

    if (lastDate && lastDate < threeDaysAgo) {
      noContact3d++;
    }

    // ContactedLeads (Em contato) calculation
    const hasMessages = (lead.id && (outboundLeads.has(lead.id) || inboundLeads.has(lead.id))) ||
                        (lead.telefone && (outboundPhones.has(lead.telefone) || inboundPhones.has(lead.telefone)));
    const isExplicitlyEmContato = statusKey === "em_contato" || statusKey === "em contato" || statusKey === "conversando" || statusKey === "atendimento";

    if (isExplicitlyEmContato || hasMessages) {
      contactedLeads++;
    }
  }

  const totalLeads = leads.length;
  const qualificationRate = totalLeads === 0 ? 0 : Math.round((qualifiedLeads / totalLeads) * 100);
  const closedConversions = (conversions || []).filter((conversion) => {
    const status = normalizeLooseText(conversion.conversion_status || conversion.status);
    return status.includes("won") || status.includes("ganho") || status.includes("fechado") || status.includes("convertido");
  });
  const conversionsCount = closedConversions.length;
  const revenueGenerated = Math.round(
    closedConversions.reduce((sum, conversion) => {
      const value = Number(conversion.revenue_amount ?? conversion.contract_value ?? 0);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0)
  );
  const conversionRate = totalLeads === 0 ? 0 : Math.round((conversionsCount / totalLeads) * 100);
  const averageTicket = conversionsCount === 0 ? 0 : Math.round(revenueGenerated / conversionsCount);
  const performanceScore = Math.round(
    (qualificationRate * 0.45) +
      (conversionRate * 0.45) +
      (totalLeads === 0 ? 0 : Math.min(100, Math.round((temperatureCounts.hot / totalLeads) * 100)) * 0.1)
  );
  const funnelCoverage = totalLeads === 0 ? 0 : Math.round(((qualifiedLeads + conversionsCount) / Math.max(totalLeads * 2, 1)) * 100);

  return {
    client,
    summary: {
      totalLeads,
      leadsToday,
      qualifiedLeads,
      qualificationRate,
      activeCities: cities.size,
      hotLeads: temperatureCounts.hot,
      warmLeads: temperatureCounts.warm,
      coldLeads: temperatureCounts.cold,
      noSignalLeads: temperatureCounts.unknown,
      conversions: conversionsCount,
      conversionRate,
      revenueGenerated,
      averageTicket,
      performanceScore,
      funnelCoverage,
      responseRate,
      noContact3d,
      contactedLeads,
    },
    leadsByDay: recentDays,
    temperatureBreakdown: [
      { name: "Quente", value: temperatureCounts.hot, color: "hsl(0, 72%, 51%)" },
      { name: "Morno", value: temperatureCounts.warm, color: "hsl(32, 95%, 55%)" },
      { name: "Frio", value: temperatureCounts.cold, color: "hsl(217, 91%, 60%)" },
      { name: "Sem sinal", value: temperatureCounts.unknown, color: "hsl(220, 12%, 60%)" },
    ],
    statusBreakdown: [
      ...Array.from(statusCounts.entries())
      .map(([status, value]) => ({
        name: humanizeStatus(status),
        value,
      }))
      .sort((a, b) => b.value - a.value),
      ...(conversionsCount > 0 ? [{ name: "Fechamentos", value: conversionsCount }] : []),
    ],
    typeBreakdown: Array.from(typeCounts.entries())
      .map(([type, value]) => ({
        name: type === "nao_informado" ? "Nao informado" : humanizeStatus(type),
        value,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6),
    recentLeads: leads.slice(0, 5).map((lead) => ({
      id: lead.id,
      nome: lead.nome || "Lead sem nome",
      tipo_cliente: lead.tipo_cliente,
      cidade: lead.cidade,
      status: humanizeStatus(lead.status),
      temperature: detectTemperature(lead),
      data_hora: lead.data_hora || lead.created_at,
    })),
  };
}

function normalizeLooseText(value) {
  return normalizeString(value)
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim() || "";
}

function getNormalizedField(data = {}, keys = []) {
  for (const key of keys) {
    const directValue = data[key];
    if (directValue !== undefined && directValue !== null && normalizeString(directValue)) {
      return normalizeString(directValue);
    }
  }

  const entries = Object.entries(data || {});
  for (const [key, value] of entries) {
    const normalizedKey = normalizeLooseText(key).replace(/[^a-z0-9]/g, "");
    if (keys.some((candidate) => normalizeLooseText(candidate).replace(/[^a-z0-9]/g, "") === normalizedKey)) {
      return normalizeString(value);
    }
  }

  return "";
}

function parseMoneyLikeValue(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const cleaned = normalized
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function leadMatchesCampaignSegmentation(lead, segmentation = {}) {
  const normalizedData = lead.normalized_data && typeof lead.normalized_data === "object"
    ? lead.normalized_data
    : lead;
  const filters = segmentation && typeof segmentation === "object" ? segmentation : {};

  const gender = normalizeLooseText(filters.gender);
  if (gender && gender !== "todos") {
    const leadGender = normalizeLooseText(getNormalizedField(normalizedData, ["genero", "gênero", "sexo"]));
    if (!leadGender.includes(gender)) return false;
  }

  const productType = normalizeLooseText(filters.productType);
  if (productType && productType !== "todos") {
    const leadProduct = normalizeLooseText(
      getNormalizedField(normalizedData, ["tipo_produto", "tipo de produto", "produto", "tipo_cliente", "perfil"])
    );
    if (!leadProduct.includes(productType)) return false;
  }

  const ticket = normalizeLooseText(filters.ticket);
  const ticketThreshold = Number(filters.ticketThreshold || 0);
  if (ticket && ticket !== "todos") {
    const rawValue =
      getNormalizedField(normalizedData, ["valor", "ticket", "valor_contrato", "contrato", "renda", "faixa_consumo", "consumo"]) ||
      "";
    const leadValue = parseMoneyLikeValue(rawValue);
    const textValue = normalizeLooseText(rawValue);

    if (leadValue !== null && ticketThreshold > 0) {
      if (ticket === "alto" && leadValue < ticketThreshold) return false;
      if (ticket === "baixo" && leadValue >= ticketThreshold) return false;
    } else if (!textValue.includes(ticket)) {
      return false;
    }
  }

  const interest = normalizeLooseText(filters.interest);
  if (interest) {
    const leadInterest = normalizeLooseText(
      [
        getNormalizedField(normalizedData, ["interesse", "categoria", "segmento", "produto", "tipo_cliente"]),
        getNormalizedField(normalizedData, ["observacao", "observações", "descricao", "descrição"]),
      ].filter(Boolean).join(" ")
    );
    if (!leadInterest.includes(interest)) return false;
  }

  const campaignTag = normalizeLooseText(filters.campaignTag);
  if (campaignTag) {
    const source = normalizeLooseText(
      [
        getNormalizedField(normalizedData, ["campanha", "origem", "source", "utm_campaign"]),
        lead.import_id,
      ].filter(Boolean).join(" ")
    );
    if (!source.includes(campaignTag)) return false;
  }

  return true;
}

function isMissingSchemaError(error) {
  const code = normalizeString(error?.code);
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "PGRST100" ||
    code === "42704" ||
    message.includes("schema cache") ||
    message.includes("could not find the") ||
    message.includes("relation") && message.includes("does not exist") ||
    message.includes("does not exist") ||
    message.includes("column") && message.includes("does not exist") ||
    message.includes("table") && message.includes("does not exist")
  );
}

async function optionalQuery(factory, fallback = []) {
  const { data, error } = await factory();
  if (error) {
    if (isMissingSchemaError(error)) {
      return { data: fallback, available: false };
    }
    throw error;
  }
  return { data: data || fallback, available: true };
}

async function queryWithSchemaFallback(factories, fallback = []) {
  let lastError = null;

  for (const factory of factories) {
    const { data, error } = await factory();
    if (!error) {
      return { data: data || fallback, available: true };
    }

    if (isMissingSchemaError(error)) {
      lastError = error;
      continue;
    }

    throw error;
  }

  if (lastError) {
    return { data: fallback, available: false };
  }

  return { data: fallback, available: false };
}

function safePercent(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function average(values) {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function hoursBetween(start, end) {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  return (endDate.getTime() - startDate.getTime()) / 36e5;
}

function normalizeMetricValue(value, kind = "number") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return {
      raw: null,
      displayValue: "Aguardando dados",
    };
  }

  if (kind === "percent") {
    return {
      raw: value,
      displayValue: `${Number(value).toFixed(1)}%`,
    };
  }

  if (kind === "currency") {
    return {
      raw: value,
      displayValue: new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      }).format(Number(value)),
    };
  }

  if (kind === "duration_hours") {
    return {
      raw: value,
      displayValue: `${Number(value).toFixed(1)}h`,
    };
  }

  if (kind === "ratio") {
    return {
      raw: value,
      displayValue: Number(value).toFixed(2),
    };
  }

  return {
    raw: value,
    displayValue: String(value),
  };
}

function buildMetricDefinition({
  key,
  name,
  formula,
  source,
  frequency,
  display,
  kind = "number",
  value = null,
  availability = "ready",
  note = null,
}) {
  return {
    key,
    name,
    formula,
    source,
    frequency,
    display,
    kind,
    availability,
    note,
    ...normalizeMetricValue(value, kind),
  };
}

function normalizeWonStatus(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  return normalized === "won" || normalized === "closed_won" || normalized === "convertido" || normalized === "converted";
}

function getLeadReferenceDate(lead) {
  return lead.data_hora || lead.updated_at || lead.created_at || null;
}

function buildRevenueOpsPayload({
  client,
  leads,
  campaigns,
  leadImportItems,
  conversations,
  messages,
  assignments,
  conversions,
  consultants,
  rules,
  storedInsights,
  availability,
}) {
  const sanitizedLeads = (leads || []).map((lead) => ({
    ...lead,
    telefone: sanitizePhone(lead.telefone),
  }));

  const leadById = new Map(sanitizedLeads.map((lead) => [lead.id, lead]));
  const leadByPhone = new Map(
    sanitizedLeads
      .filter((lead) => lead.telefone)
      .map((lead) => [lead.telefone, lead])
  );

  const conversationCounts = new Map();
  for (const item of conversations || []) {
    const phone = sanitizePhone(item.telefone);
    if (!phone) continue;
    conversationCounts.set(phone, (conversationCounts.get(phone) || 0) + 1);
  }

  const messageStatsByPhone = new Map();
  for (const item of messages || []) {
    const phone = sanitizePhone(item.phone) || leadById.get(item.lead_id)?.telefone || null;
    if (!phone) continue;

    const current = messageStatsByPhone.get(phone) || {
      total: 0,
      inbound: 0,
      outbound: 0,
      engaged: 0,
      firstOutboundAt: null,
      lastInboundAt: null,
    };

    current.total += 1;
    if (item.direction === "inbound" || item.sender_type === "lead") {
      current.inbound += 1;
      if (!current.lastInboundAt || new Date(item.created_at) > new Date(current.lastInboundAt)) {
        current.lastInboundAt = item.created_at;
      }
    } else {
      current.outbound += 1;
      if (!current.firstOutboundAt || new Date(item.created_at) < new Date(current.firstOutboundAt)) {
        current.firstOutboundAt = item.created_at;
      }
    }

    if (item.engagement_signal === "reply" || item.engagement_signal === "clicked" || item.direction === "inbound") {
      current.engaged += 1;
    }

    messageStatsByPhone.set(phone, current);
  }

  const addressedLeads = sanitizedLeads.filter((lead) => {
    const phone = lead.telefone;
    return Boolean(
      lead.bot_ativo ||
      normalizeString(lead.status) ||
      normalizeString(lead.historico) ||
      (phone && conversationCounts.has(phone)) ||
      (phone && messageStatsByPhone.has(phone))
    );
  });

  const qualifiedLeads = sanitizedLeads.filter((lead) =>
    isQualifiedStatus(lead.status) || (normalizeString(lead.qualificacao)?.toLowerCase() || "").includes("qualific")
  );

  const wonConversions = (conversions || []).filter((item) => normalizeWonStatus(item.conversion_status));
  const closedLeadIds = new Set(
    wonConversions.map((item) => item.lead_id).filter(Boolean)
  );
  sanitizedLeads.forEach((lead) => {
    if (normalizeWonStatus(lead.status)) {
      closedLeadIds.add(lead.id);
    }
  });

  const respondedPhones = new Set(
    [...messageStatsByPhone.entries()]
      .filter(([, stats]) => stats.inbound > 0 || stats.engaged > 0)
      .map(([phone]) => phone)
  );
  if (!availability.messages) {
    for (const phone of conversationCounts.keys()) {
      respondedPhones.add(phone);
    }
  }

  const qualifiedLeadIds = new Set(qualifiedLeads.map((lead) => lead.id));
  const totalInteractions = availability.messages
    ? (messages || []).length
    : (conversations || []).length;

  const qualificationDurations = sanitizedLeads
    .filter((lead) => qualifiedLeadIds.has(lead.id))
    .map((lead) => hoursBetween(lead.first_contact_at || getLeadReferenceDate(lead), lead.qualified_at || lead.updated_at))
    .filter((value) => typeof value === "number" && value >= 0);

  const closingDurations = sanitizedLeads
    .filter((lead) => closedLeadIds.has(lead.id))
    .map((lead) => {
      const conversion = wonConversions.find((item) => item.lead_id === lead.id) || null;
      return hoursBetween(
        conversion?.first_contact_at || lead.first_contact_at || getLeadReferenceDate(lead),
        conversion?.closed_at || lead.closed_at || lead.updated_at
      );
    })
    .filter((value) => typeof value === "number" && value >= 0);

  const totalWon = closedLeadIds.size;
  const responseRate = safePercent(
    addressedLeads.filter((lead) => lead.telefone && respondedPhones.has(lead.telefone)).length,
    addressedLeads.length
  );
  const abandonmentRate = safePercent(
    addressedLeads.filter((lead) => !lead.telefone || !respondedPhones.has(lead.telefone)).length,
    addressedLeads.length
  );
  const engagementPerMessage = availability.messages
    ? safePercent(
        (messages || []).filter((item) => item.engagement_signal === "reply" || item.engagement_signal === "clicked").length,
        (messages || []).filter((item) => item.direction !== "inbound").length
      )
    : null;

  const reactivatedLeadCount = availability.messages
    ? Array.from(messageStatsByPhone.values()).filter((stats) => stats.outbound > 1 && stats.inbound > 0).length
    : null;

  const essentialMetrics = [
    buildMetricDefinition({
      key: "qualification_rate",
      name: "Taxa de Qualificacao",
      formula: "leads qualificados / leads abordados",
      source: "public.leads.status, public.leads.qualificacao, public.lead_messages.direction ou public.lead_conversations.telefone",
      frequency: "Tempo real",
      display: "Card principal + tendencia diaria",
      kind: "percent",
      value: safePercent(qualifiedLeads.length, addressedLeads.length),
    }),
    buildMetricDefinition({
      key: "qualification_cost",
      name: "Custo de Qualificacao",
      formula: "custo da campanha / leads qualificados",
      source: "public.campaigns.budget_amount, public.lead_conversions, public.leads",
      frequency: "Diario",
      display: "Card financeiro por campanha",
      kind: "currency",
      value: null,
      availability: "future",
      note: "Aguardando custo real de campanha em budget_amount e fechamento da atribuicao de origem por lead.",
    }),
    buildMetricDefinition({
      key: "interactions_per_qualified_lead",
      name: "Conversas por Lead Qualificado",
      formula: "total de interacoes / leads qualificados",
      source: availability.messages
        ? "public.lead_messages"
        : "public.lead_conversations (proxy parcial)",
      frequency: "Tempo real",
      display: "Card operacional + comparativo por campanha",
      kind: "ratio",
      value: qualifiedLeads.length ? totalInteractions / qualifiedLeads.length : null,
      availability: availability.messages ? "ready" : "partial",
      note: availability.messages ? null : "Sem tabela de mensagens populada, usando snapshots de conversa como aproximacao.",
    }),
    buildMetricDefinition({
      key: "interactions_per_closing",
      name: "Conversas por Fechamento",
      formula: "total de interacoes / vendas fechadas",
      source: "public.lead_messages, public.lead_conversions",
      frequency: "Tempo real",
      display: "Card operacional + ranking de consultores",
      kind: "ratio",
      value: totalWon ? totalInteractions / totalWon : null,
      availability: availability.messages && availability.conversions ? "ready" : "partial",
      note: availability.conversions ? null : "Usando status convertido em leads como proxy de venda fechada.",
    }),
    buildMetricDefinition({
      key: "final_conversion_rate",
      name: "Taxa de Conversao Final",
      formula: "vendas / leads totais",
      source: "public.lead_conversions.conversion_status ou public.leads.status",
      frequency: "Tempo real",
      display: "Card executivo + funil final",
      kind: "percent",
      value: safePercent(totalWon, sanitizedLeads.length),
      availability: availability.conversions ? "ready" : "partial",
      note: availability.conversions ? null : "Enquanto a tabela de conversoes nao estiver populada, o CRM usa status convertido como proxy.",
    }),
    buildMetricDefinition({
      key: "avg_time_to_qualification",
      name: "Tempo Medio ate Qualificacao",
      formula: "media(qualified_at - primeiro_contato)",
      source: "public.leads.first_contact_at, public.leads.qualified_at, public.lead_messages.created_at",
      frequency: "Tempo real",
      display: "Card de velocidade + histograma",
      kind: "duration_hours",
      value: average(qualificationDurations),
      availability: qualificationDurations.length ? "ready" : "partial",
      note: qualificationDurations.length ? null : "Sem timestamps dedicados de contato/qualificacao suficientes para fechar a media.",
    }),
    buildMetricDefinition({
      key: "avg_time_to_closing",
      name: "Tempo Medio ate Fechamento",
      formula: "media(closed_at - primeiro_contato)",
      source: "public.lead_conversions.closed_at, public.lead_conversions.first_contact_at, public.leads.closed_at",
      frequency: "Tempo real",
      display: "Card executivo + ranking de consultores",
      kind: "duration_hours",
      value: average(closingDurations),
      availability: closingDurations.length ? "ready" : "partial",
      note: closingDurations.length ? null : "Sem eventos de fechamento suficientes para consolidar essa media.",
    }),
  ];

  const advancedMetrics = [
    buildMetricDefinition({
      key: "lead_response_rate",
      name: "Taxa de resposta do lead",
      formula: "leads que responderam / leads abordados",
      source: availability.messages
        ? "public.lead_messages.direction, public.lead_messages.sender_type"
        : "public.lead_conversations",
      frequency: "Tempo real",
      display: "Card + heatmap por campanha",
      kind: "percent",
      value: responseRate,
      availability: availability.messages ? "ready" : "partial",
    }),
    buildMetricDefinition({
      key: "engagement_per_message",
      name: "Taxa de engajamento por mensagem",
      formula: "mensagens com resposta ou clique / mensagens enviadas",
      source: "public.lead_messages.engagement_signal, public.lead_messages.direction",
      frequency: "Tempo real",
      display: "Card + serie temporal",
      kind: "percent",
      value: engagementPerMessage,
      availability: availability.messages ? "ready" : "future",
      note: availability.messages ? null : "Requer instrumentacao da tabela lead_messages pelo n8n ou WhatsApp.",
    }),
    buildMetricDefinition({
      key: "conversation_abandonment_rate",
      name: "Taxa de abandono da conversa",
      formula: "leads abordados sem resposta / leads abordados",
      source: "public.lead_messages, public.lead_conversations",
      frequency: "Tempo real",
      display: "Card de risco + alerta automatico",
      kind: "percent",
      value: abandonmentRate,
      availability: "ready",
    }),
    buildMetricDefinition({
      key: "base_quality_rate",
      name: "Qualidade da base",
      formula: "leads que respondem / leads abordados",
      source: "public.lead_messages, public.lead_conversations, public.leads",
      frequency: "Tempo real",
      display: "Card + ranking por campanha",
      kind: "percent",
      value: responseRate,
      availability: "ready",
    }),
    buildMetricDefinition({
      key: "agent_campaign_performance",
      name: "Performance do agente por campanha",
      formula: "taxa de qualificacao e resposta por campanha",
      source: "public.campaigns, public.leads, public.lead_messages",
      frequency: "Horario",
      display: "Ranking Top 5 / Bottom 5",
      kind: "percent",
      value: null,
      availability: campaigns.length ? "ready" : "partial",
      note: campaigns.length ? null : "Sem campanhas suficientes para consolidar comparativo.",
    }),
    buildMetricDefinition({
      key: "agent_city_performance",
      name: "Performance do agente por cidade",
      formula: "taxa de qualificacao e conversao por cidade",
      source: "public.leads.cidade, public.leads.status, public.lead_conversions",
      frequency: "Diario",
      display: "Ranking Top 5 / Bottom 5",
      kind: "percent",
      value: null,
      availability: "ready",
    }),
    buildMetricDefinition({
      key: "dynamic_lead_score",
      name: "Lead Score dinamico",
      formula: "peso de temperatura + resposta + recencia + potencial de contrato",
      source: "public.leads.qualificacao, public.leads.lead_score, public.lead_messages, public.lead_conversions",
      frequency: "Tempo real",
      display: "Badge por lead + media da carteira",
      kind: "number",
      value: average(
        sanitizedLeads.map((lead) => {
          const baseScore = Number(lead.lead_score || 0);
          const temp = detectTemperature(lead);
          const responseBoost = lead.telefone && respondedPhones.has(lead.telefone) ? 12 : 0;
          const temperatureBoost = temp === "hot" ? 35 : temp === "warm" ? 18 : temp === "cold" ? 8 : 0;
          return baseScore || temperatureBoost + responseBoost + (isQualifiedStatus(lead.status) ? 20 : 0);
        })
      ),
      availability: "ready",
    }),
    buildMetricDefinition({
      key: "reactivation_rate",
      name: "Taxa de reativacao",
      formula: "leads que voltaram a responder / leads em reengajamento",
      source: "public.lead_messages",
      frequency: "Diario",
      display: "Card + coorte",
      kind: "percent",
      value: availability.messages && addressedLeads.length
        ? safePercent(reactivatedLeadCount || 0, addressedLeads.length)
        : null,
      availability: availability.messages ? "partial" : "future",
      note: availability.messages
        ? "A implementacao atual considera reativacao quando o lead volta a responder apos mais de um contato."
        : "Requer historico de mensagens inbound/outbound por lead.",
    }),
  ];

  const buildTrend = (currentValue, previousValue) => {
    if (previousValue === null || previousValue === undefined) return "estavel";
    if (currentValue > previousValue) return "subindo";
    if (currentValue < previousValue) return "caindo";
    return "estavel";
  };

  const now = new Date();
  const currentWindowStart = new Date(now);
  currentWindowStart.setDate(now.getDate() - 6);
  const previousWindowStart = new Date(now);
  previousWindowStart.setDate(now.getDate() - 13);
  const previousWindowEnd = new Date(now);
  previousWindowEnd.setDate(now.getDate() - 7);

  const cityRows = Array.from(
    sanitizedLeads.reduce((acc, lead) => {
      const key = normalizeString(lead.cidade) || "Sem cidade";
      const current = acc.get(key) || {
        name: key,
        total: 0,
        qualified: 0,
        converted: 0,
        closeHours: [],
        currentWindowQualified: 0,
        previousWindowQualified: 0,
      };
      current.total += 1;
      if (isQualifiedStatus(lead.status)) current.qualified += 1;
      if (closedLeadIds.has(lead.id)) current.converted += 1;

      const closeHours = hoursBetween(lead.first_contact_at || getLeadReferenceDate(lead), lead.closed_at || lead.updated_at);
      if (closedLeadIds.has(lead.id) && typeof closeHours === "number" && closeHours >= 0) {
        current.closeHours.push(closeHours);
      }

      const leadDate = new Date(lead.created_at || lead.updated_at || lead.data_hora || now);
      if (leadDate >= currentWindowStart) {
        if (isQualifiedStatus(lead.status)) current.currentWindowQualified += 1;
      } else if (leadDate >= previousWindowStart && leadDate <= previousWindowEnd) {
        if (isQualifiedStatus(lead.status)) current.previousWindowQualified += 1;
      }

      acc.set(key, current);
      return acc;
    }, new Map()).values()
  ).map((item) => {
    const qualificationRate = safePercent(item.qualified, item.total);
    const conversionRate = safePercent(item.converted, item.total);
    const avgCloseHours = average(item.closeHours) || 999;
    const score = Number((qualificationRate * 0.45 + conversionRate * 0.45 + (avgCloseHours ? 100 / avgCloseHours : 0) * 0.1).toFixed(2));
    return {
      name: item.name,
      qualificationRate,
      conversionRate,
      avgCloseHours: avgCloseHours === 999 ? null : avgCloseHours,
      score,
      trend: buildTrend(item.currentWindowQualified, item.previousWindowQualified),
    };
  }).sort((a, b) => b.score - a.score);

  const importPhonesByImportId = new Map();
  for (const item of leadImportItems || []) {
    if (!item.import_id) continue;
    const current = importPhonesByImportId.get(item.import_id) || [];
    const phone = sanitizePhone(item.telefone);
    if (phone) current.push(phone);
    importPhonesByImportId.set(item.import_id, current);
  }

  const campaignRows = (campaigns || []).map((campaign) => {
    const storedPhones = Array.isArray(campaign.phones) ? campaign.phones.map((phone) => sanitizePhone(phone)).filter(Boolean) : [];
    const importPhones = campaign.import_id ? importPhonesByImportId.get(campaign.import_id) || [] : [];
    const phones = Array.from(new Set([...storedPhones, ...importPhones]));
    const relatedLeads = phones.length
      ? phones.map((phone) => leadByPhone.get(phone)).filter(Boolean)
      : [];
    const approached = relatedLeads.filter((lead) => lead.bot_ativo || lead.status || (lead.telefone && respondedPhones.has(lead.telefone)));
    const qualified = relatedLeads.filter((lead) => isQualifiedStatus(lead.status));
    const converted = relatedLeads.filter((lead) => closedLeadIds.has(lead.id));
    const currentWindowQualified = qualified.filter((lead) => new Date(lead.created_at || lead.updated_at || now) >= currentWindowStart).length;
    const previousWindowQualified = qualified.filter((lead) => {
      const createdAt = new Date(lead.created_at || lead.updated_at || now);
      return createdAt >= previousWindowStart && createdAt <= previousWindowEnd;
    }).length;

    return {
      id: campaign.id,
      name: campaign.name,
      qualifiedLeads: qualified.length,
      responseRate: safePercent(
        approached.filter((lead) => lead.telefone && respondedPhones.has(lead.telefone)).length,
        approached.length
      ),
      potentialRoi: converted.reduce((sum, lead) => sum + Number(lead.potential_contract_value || 0), 0),
      score: Number((qualified.length * 0.5 + converted.length * 0.3 + safePercent(
        approached.filter((lead) => lead.telefone && respondedPhones.has(lead.telefone)).length,
        approached.length
      ) * 0.2).toFixed(2)),
      trend: buildTrend(currentWindowQualified, previousWindowQualified),
    };
  }).sort((a, b) => b.score - a.score);

  const consultantRows = (consultants || []).map((consultant) => {
    const consultantAssignments = (assignments || []).filter((item) => item.consultant_id === consultant.id);
    const consultantConversions = (conversions || []).filter((item) => item.consultant_id === consultant.id);
    const received = consultantAssignments.length;
    const won = consultantConversions.filter((item) => normalizeWonStatus(item.conversion_status)).length;
    const responseHours = consultantAssignments
      .map((item) => hoursBetween(item.assigned_at, item.first_response_at))
      .filter((value) => typeof value === "number" && value >= 0);
    const currentWindowWon = consultantConversions.filter((item) => item.closed_at && new Date(item.closed_at) >= currentWindowStart && normalizeWonStatus(item.conversion_status)).length;
    const previousWindowWon = consultantConversions.filter((item) => item.closed_at && new Date(item.closed_at) >= previousWindowStart && new Date(item.closed_at) <= previousWindowEnd && normalizeWonStatus(item.conversion_status)).length;
    return {
      id: consultant.id,
      name: consultant.name,
      conversionRate: safePercent(won, received),
      responseTimeHours: average(responseHours),
      conversionPerLead: safePercent(won, received),
      score: Number((safePercent(won, received) * 0.7 + (responseHours.length ? (100 / average(responseHours)) : 0) * 0.3).toFixed(2)),
      trend: buildTrend(currentWindowWon, previousWindowWon),
    };
  }).sort((a, b) => b.score - a.score);

  const generatedInsights = [];
  const weakCampaign = campaignRows.find((item) => item.qualifiedLeads >= 5 && item.responseRate < 15);
  if (weakCampaign) {
    generatedInsights.push({
      title: `Campanha ${weakCampaign.name} com baixa resposta`,
      message: `A campanha ${weakCampaign.name} esta com taxa de resposta em ${weakCampaign.responseRate.toFixed(1)}%. Vale revisar lista, copy do agente e origem da base.`,
      severity: "warning",
      scope: "campaign",
    });
  }

  const hiddenOpportunityCity = cityRows.find((item) => item.qualificationRate >= 35 && item.conversionRate < 10);
  if (hiddenOpportunityCity) {
    generatedInsights.push({
      title: `Cidade ${hiddenOpportunityCity.name} qualifica mas converte pouco`,
      message: `${hiddenOpportunityCity.name} qualificou ${hiddenOpportunityCity.qualificationRate.toFixed(1)}% dos leads, mas converteu apenas ${hiddenOpportunityCity.conversionRate.toFixed(1)}%. O gargalo parece comercial.`,
      severity: "warning",
      scope: "city",
    });
  }

  const avgQualificationHours = average(qualificationDurations);
  if (avgQualificationHours !== null && avgQualificationHours > 24) {
    generatedInsights.push({
      title: "Agente esta demorando para qualificar",
      message: `O tempo medio ate qualificacao subiu para ${avgQualificationHours.toFixed(1)}h. Revise prompts, roteiros e velocidade de follow-up.`,
      severity: "warning",
      scope: "agent",
    });
  }

  if (consultantRows.length > 0) {
    const consultantAverage = average(consultantRows.map((item) => item.conversionRate)) || 0;
    const belowAverageConsultant = consultantRows.find((item) => item.conversionRate < consultantAverage * 0.7);
    if (belowAverageConsultant) {
      generatedInsights.push({
        title: `Consultor ${belowAverageConsultant.name} abaixo da media`,
        message: `${belowAverageConsultant.name} esta com ${belowAverageConsultant.conversionRate.toFixed(1)}% de fechamento por lead recebido, abaixo da media da carteira.`,
        severity: "critical",
        scope: "consultant",
      });
    }
  }

  const mergedInsights = [
    ...generatedInsights,
    ...(storedInsights || []).map((item) => ({
      title: item.title,
      message: item.message,
      severity: item.severity || "info",
      scope: item.insight_scope || "dashboard",
    })),
  ].slice(0, 8);

  const distributionModels = [
    {
      key: "round_robin",
      name: "Round-robin",
      description: "Distribui em rodizio simples respeitando disponibilidade e limite de carga.",
      rules: [
        "Mantem fila circular por consultor ativo.",
        "Ignora consultor indisponivel ou acima do limite de leads abertos.",
        "Reatribui automaticamente quando response_due_at expira.",
      ],
    },
    {
      key: "performance_weighted",
      name: "Peso por performance",
      description: "Quem converte mais e responde mais rapido recebe mais oportunidades.",
      rules: [
        "Peso base em assignment_weight do consultor.",
        "Boost adicional por taxa de fechamento e tempo medio de resposta.",
        "Aplicar fairness_floor para evitar concentracao excessiva.",
      ],
    },
    {
      key: "regional_priority",
      name: "Prioridade por regiao",
      description: "Entrega primeiro para consultor aderente a cidade e estado do lead.",
      rules: [
        "Match por cidade/estado antes de abrir fallback nacional.",
        "Contrato potencial alto prioriza especialistas ou faixa de contrato.",
        "Tipo de lead pode acionar fila dedicada por residencial/empresa.",
      ],
    },
  ];

  const activeRules = (rules || []).filter((item) => item.active);
  const consultantLoadSummary = {
    totalConsultants: consultants.length,
    availableConsultants: consultants.filter((item) => item.available && item.active).length,
    overloadedConsultants: consultants.filter((consultant) => {
      const openAssignments = assignments.filter(
        (item) => item.consultant_id === consultant.id && item.assignment_status !== "closed"
      ).length;
      return openAssignments >= consultant.open_lead_limit;
    }).length,
  };

  return {
    client,
    generatedAt: new Date().toISOString(),
    essentialMetrics,
    advancedMetrics,
    rankings: {
      cities: {
        top5: cityRows.slice(0, 5),
        bottom5: cityRows.slice(-5).reverse(),
      },
      campaigns: {
        top5: campaignRows.slice(0, 5),
        bottom5: campaignRows.slice(-5).reverse(),
      },
      consultants: {
        top5: consultantRows.slice(0, 5),
        bottom5: consultantRows.slice(-5).reverse(),
        availability: consultants.length ? "ready" : "future",
      },
    },
    distribution: {
      criteria: [
        "Regiao (cidade e estado)",
        "Valor potencial do contrato",
        "Tipo do lead (residencial, empresa, rural, etc.)",
        "Disponibilidade e carga atual do consultor",
      ],
      models: distributionModels,
      activeRules,
      consultantLoadSummary,
      operationalRules: [
        "Evitar sobrecarga usando open_lead_limit e daily_capacity.",
        "Garantir distribuicao justa com fairness_floor e assignment_weight.",
        "Reatribuir automaticamente quando o consultor nao responder dentro de response_due_at.",
      ],
    },
    dataModel: {
      tables: [
        {
          name: "leads",
          purpose: "Base central do lead com origem, score, timestamps operacionais e status de conversao.",
          fields: ["client_id", "telefone", "status", "qualificacao", "source_campaign_id", "lead_score", "first_contact_at", "qualified_at", "closed_at", "potential_contract_value"],
        },
        {
          name: "lead_conversations",
          purpose: "Memoria comprimida da conversa para auditoria e replay do agente.",
          fields: ["telefone", "conversation_compressed", "created_at"],
        },
        {
          name: "lead_messages",
          purpose: "Granularidade por mensagem para medir resposta, engajamento, abandono e reativacao.",
          fields: ["lead_id", "campaign_id", "sender_type", "direction", "engagement_signal", "created_at"],
        },
        {
          name: "campaigns",
          purpose: "Origem comercial da demanda, com configuracao de limite, canal e futuro custo.",
          fields: ["client_id", "name", "import_id", "limit_per_run", "status", "budget_amount", "channel"],
        },
        {
          name: "crm_consultants",
          purpose: "Carteira de consultores com capacidade, disponibilidade, territorio e peso.",
          fields: ["client_id", "name", "territory_cities", "territory_states", "daily_capacity", "open_lead_limit", "assignment_weight", "available"],
        },
        {
          name: "lead_assignments",
          purpose: "Historico de distribuicao do lead, SLA de resposta e reatribuicoes.",
          fields: ["lead_id", "consultant_id", "campaign_id", "assignment_mode", "assigned_at", "first_response_at", "response_due_at", "reassign_count"],
        },
        {
          name: "lead_conversions",
          purpose: "Eventos comerciais finais para medicao de fechamento, receita e ROI.",
          fields: ["lead_id", "campaign_id", "consultant_id", "conversion_status", "contract_value", "revenue_amount", "first_contact_at", "qualified_at", "closed_at"],
        },
      ],
    },
    dashboardBlueprint: {
      cards: [
        "Taxa de qualificacao",
        "Taxa de conversao final",
        "Tempo medio ate qualificacao",
        "Tempo medio ate fechamento",
        "Conversas por lead qualificado",
        "Taxa de resposta do lead",
      ],
      charts: [
        "Linha de qualificacao e conversao por dia",
        "Funil por etapa do agente ao fechamento",
        "Barra por campanha e cidade",
        "Radar de distribuicao por consultor",
      ],
      alerts: [
        "Queda de conversao",
        "Aumento de abandono",
        "Campanha com baixa resposta",
        "Consultor abaixo da media",
      ],
      filters: ["Empresa", "Campanha", "Periodo", "Cidade", "Consultor", "Status", "Origem"],
    },
    insights: mergedInsights,
  };
}

function buildRevenueOpsFallbackPayload(clientId) {
  const timestamp = new Date().toISOString();

  return {
    client: {
      id: clientId,
      name: clientId,
    },
    generatedAt: timestamp,
    essentialMetrics: [],
    advancedMetrics: [],
    rankings: {
      cities: { top5: [], bottom5: [] },
      campaigns: { top5: [], bottom5: [] },
      consultants: { top5: [], bottom5: [], availability: "future" },
    },
    distribution: {
      criteria: [
        "Regiao (cidade e estado)",
        "Valor potencial do contrato",
        "Tipo de lead",
        "Disponibilidade do consultor",
      ],
      models: [
        {
          key: "round_robin",
          name: "Round-robin",
          description: "Rodizio simples para manter a distribuicao equilibrada.",
          rules: [
            "Distribuir em sequencia entre consultores ativos",
            "Pular consultores indisponiveis",
            "Respeitar limite de leads simultaneos",
          ],
        },
        {
          key: "weighted_performance",
          name: "Peso por performance",
          description: "Quem converte melhor recebe mais leads sem gerar sobrecarga.",
          rules: [
            "Usar taxa de fechamento como peso principal",
            "Aplicar piso de justica para todos receberem oportunidades",
            "Reduzir distribuicao quando o consultor atingir o limite de carga",
          ],
        },
        {
          key: "regional_priority",
          name: "Prioridade por regiao",
          description: "Encaminhar leads para consultores mais aderentes a cidade ou estado.",
          rules: [
            "Priorizar cobertura geografica local",
            "Reencaminhar automaticamente se nao houver resposta no SLA",
            "Manter fila de fallback para operacao geral",
          ],
        },
      ],
      activeRules: [],
      consultantLoadSummary: {
        totalConsultants: 0,
        availableConsultants: 0,
        overloadedConsultants: 0,
      },
      operationalRules: [
        "Evitar sobrecarga por limite de leads abertos",
        "Garantir distribuicao justa entre consultores ativos",
        "Permitir reatribuicao automatica quando o SLA expirar",
      ],
    },
    dataModel: {
      tables: [
        {
          name: "leads",
          purpose: "Base principal de leads e status operacionais.",
          fields: ["id", "client_id", "telefone", "nome", "cidade", "estado", "qualificacao", "campaign_id", "created_at", "updated_at"],
        },
        {
          name: "conversations",
          purpose: "Sessao de conversa do lead com o agente.",
          fields: ["id", "client_id", "lead_id", "campaign_id", "started_at", "qualified_at", "closed_at"],
        },
        {
          name: "messages",
          purpose: "Historico completo das mensagens.",
          fields: ["id", "client_id", "lead_id", "campaign_id", "direction", "sender_type", "engagement_signal", "created_at"],
        },
        {
          name: "campaigns",
          purpose: "Origem, custo e performance das campanhas.",
          fields: ["id", "client_id", "name", "status", "cost_amount", "created_at"],
        },
        {
          name: "consultants",
          purpose: "Capacidade e disponibilidade comercial.",
          fields: ["id", "client_id", "name", "city", "state", "available", "daily_capacity", "assignment_weight"],
        },
        {
          name: "assignments",
          purpose: "Distribuicao e SLA dos leads para consultores.",
          fields: ["id", "client_id", "lead_id", "consultant_id", "assigned_at", "first_response_at", "closed_at"],
        },
        {
          name: "conversions",
          purpose: "Fechamentos e receita gerada.",
          fields: ["id", "client_id", "lead_id", "campaign_id", "consultant_id", "revenue_amount", "closed_at"],
        },
      ],
    },
    dashboardBlueprint: {
      cards: [
        "Taxa de qualificacao",
        "Conversas por lead qualificado",
        "Conversas por fechamento",
        "Tempo medio ate qualificacao",
        "Tempo medio ate fechamento",
        "Taxa de conversao final",
      ],
      charts: [
        "Linha de qualificacao por periodo",
        "Funil de conversao por campanha",
        "Barras de performance por cidade",
        "Radar de eficiencia por consultor",
      ],
      alerts: [
        "Queda de conversao por campanha",
        "Aumento no tempo medio ate qualificacao",
        "Consultor abaixo da media operacional",
      ],
      filters: ["Empresa", "Campanha", "Periodo", "Cidade"],
    },
    insights: [
      {
        title: "Base analitica em preparacao",
        message: "A inteligencia comercial continua disponivel, mas esta instancia ainda esta consolidando algumas fontes analiticas.",
        severity: "warning",
        scope: "dashboard",
      },
    ],
  };
}

function parseCommercialIntelligenceFilters(query = {}, defaultPeriod = "30d") {
  return {
    period: normalizeString(query.period) || defaultPeriod,
    campaignId: normalizeString(query.campaignId) || "",
    city: normalizeString(query.city) || "",
    consultantId: normalizeString(query.consultantId) || "",
    status: normalizeString(query.status) || "",
  };
}

function mergeManagedClaims(existingClaims = {}, managedClaims = {}) {
  const preserved = { ...existingClaims };

  for (const key of MANAGED_CLAIM_KEYS) {
    delete preserved[key];
  }

  return {
    ...preserved,
    ...managedClaims,
  };
}

function buildManagedClaims({
  role,
  accessPreset,
  scopeMode,
  approvalLevel,
  permissions = [],
  clientIds = [],
  tenantIds = [],
  clientId,
  tenantId,
  allowedViews = [],
  companyName = null,
  internalPages = [],
}) {
  const normalizedRole = normalizeRole(role);
  const normalizedPreset = normalizeAccessPreset(accessPreset, normalizedRole);
  const normalizedCompanyName = normalizeString(companyName);
  const normalizedClientIds = Array.from(
    new Set(
      [
        ...normalizeStringArray(clientIds),
        ...normalizeStringArray(tenantIds),
        normalizeString(clientId),
        normalizeString(tenantId),
      ].filter(Boolean)
    )
  );
  const normalizedApprovalLevel =
    normalizedRole === "pending"
      ? "none"
      : normalizeApprovalLevel(approvalLevel, normalizedRole);

  if (normalizedRole === "pending") {
    return {
      role: "pending",
      isAdmin: false,
      accessPreset: "pending",
      scopeMode: "no_client_access",
      approvalLevel: "none",
      permissions: [],
      clientId: normalizedClientIds[0] || null,
      clientIds: normalizedClientIds,
      tenantId: normalizedClientIds[0] || null,
      tenantIds: normalizedClientIds,
      allowedViews: [],
      internalPages: [],
      companyName: normalizedCompanyName,
    };
  }

  if (normalizedRole === "client") {
    if (normalizedClientIds.length === 0) {
      throw new Error("Client users must have at least one associated tenant");
    }

    const normalizedAllowedViews = normalizeAllowedViews(allowedViews, normalizedRole, normalizedPreset);

    return {
      role: "client",
      isAdmin: false,
      accessPreset: normalizedPreset,
      scopeMode: "assigned_clients",
      approvalLevel: normalizedApprovalLevel,
      clientId: normalizedClientIds[0],
      clientIds: normalizedClientIds,
      tenantId: normalizedClientIds[0],
      tenantIds: normalizedClientIds,
      allowedViews: normalizedAllowedViews,
      internalPages: [],
      permissions: normalizePermissions(permissions, normalizedRole, normalizedPreset),
      companyName: normalizedCompanyName,
    };
  }

  const isAdmin = normalizedPreset === "admin_vexo";
  const resolvedScopeMode = isAdmin ? "all_clients" : normalizeScopeMode(scopeMode, normalizedRole);
  const normalizedPermissions = isAdmin
    ? [...ACCESS_PERMISSION_KEYS]
    : normalizePermissions(permissions, normalizedRole, normalizedPreset);
  const normalizedInternalPages = isAdmin
    ? [...INTERNAL_PAGE_KEYS]
    : normalizeInternalPages(internalPages, normalizedRole, false, normalizedPreset);
  const effectiveClientIds =
    resolvedScopeMode === "no_client_access" ? [] : normalizedClientIds;

  return {
    role: "internal",
    isAdmin,
    accessPreset: normalizedPreset,
    scopeMode: resolvedScopeMode,
    approvalLevel: isAdmin ? "director" : normalizedApprovalLevel,
    clientId: effectiveClientIds[0] || null,
    clientIds: effectiveClientIds,
    tenantId: effectiveClientIds[0] || null,
    tenantIds: effectiveClientIds,
    allowedViews: [],
    internalPages: normalizedInternalPages,
    permissions: normalizedPermissions,
    companyName: normalizedCompanyName,
  };
}

async function listAllFirebaseUsers() {
  const auth = getAuth();
  let pageToken;
  const users = [];

  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);

  return users;
}

function mapAdminUserRecord(user) {
  const access = extractManagedAccessClaims(user.customClaims || {}, {
    uid: user.uid,
    email: user.email,
  });

  return {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    disabled: user.disabled,
    createdAt: user.metadata.creationTime || null,
    lastSignInAt: user.metadata.lastSignInTime || null,
    access,
  };
}

async function ensureFirebaseUserAccessClaims(user) {
  const auth = getAuth();
  const existingClaims = user.customClaims || {};

  if (hasManagedAccessClaims(existingClaims)) {
    return {
      user,
      synced: false,
      reason: "already_managed",
    };
  }

  const managedClaims = isFixedAdminIdentity({ uid: user.uid, email: user.email })
    ? buildManagedClaims({
        role: "internal",
        accessPreset: "admin_vexo",
        scopeMode: "all_clients",
        approvalLevel: "director",
        permissions: ACCESS_PERMISSION_KEYS,
        internalPages: INTERNAL_PAGE_KEYS,
      })
    : buildManagedClaims({
        role: "pending",
        companyName: existingClaims.companyName,
      });

  await auth.setCustomUserClaims(user.uid, mergeManagedClaims(existingClaims, managedClaims));

  return {
    user: await auth.getUser(user.uid),
    synced: true,
    reason: managedClaims.accessPreset,
  };
}

function humanizeAccessProfileKey(value) {
  const normalized = normalizeString(value)?.toLowerCase();

  if (!normalized) {
    return "Tipo sem nome";
  }

  return (
    ACCESS_PRESET_LABELS[normalized] ||
    normalized
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

function normalizeAccessProfileRecord(input = {}) {
  const role = normalizeRole(input.role);
  const key = normalizeAccessPreset(input.key ?? input.accessPreset, role);
  const label = normalizeString(input.label) || humanizeAccessProfileKey(key);
  const description = normalizeString(input.description);

  if (role === "pending") {
    return {
      key,
      label,
      description,
      role: "pending",
      scopeMode: "no_client_access",
      approvalLevel: "none",
      permissions: [],
      internalPages: [],
      allowedViews: [],
      isSystem: Boolean(input.isSystem ?? input.is_system),
      isLocked: Boolean(input.isLocked ?? input.is_locked),
      createdAt: input.createdAt ?? input.created_at ?? null,
      updatedAt: input.updatedAt ?? input.updated_at ?? null,
    };
  }

  if (role === "client") {
    return {
      key,
      label,
      description,
      role: "client",
      scopeMode: "assigned_clients",
      approvalLevel: normalizeApprovalLevel(input.approvalLevel ?? input.approval_level, role),
      permissions: normalizePermissions(input.permissions, role, key),
      internalPages: [],
      allowedViews: normalizeAllowedViews(input.allowedViews ?? input.allowed_views, role, key),
      isSystem: Boolean(input.isSystem ?? input.is_system),
      isLocked: Boolean(input.isLocked ?? input.is_locked),
      createdAt: input.createdAt ?? input.created_at ?? null,
      updatedAt: input.updatedAt ?? input.updated_at ?? null,
    };
  }

  const isAdmin = key === "admin_vexo";

  return {
    key,
    label,
    description,
    role: "internal",
    scopeMode: isAdmin
      ? "all_clients"
      : normalizeScopeMode(input.scopeMode ?? input.scope_mode, role),
    approvalLevel: isAdmin
      ? "director"
      : normalizeApprovalLevel(input.approvalLevel ?? input.approval_level, role),
    permissions: isAdmin
      ? [...ACCESS_PERMISSION_KEYS]
      : normalizePermissions(input.permissions, role, key),
    internalPages: isAdmin
      ? [...INTERNAL_PAGE_KEYS]
      : normalizeInternalPages(input.internalPages ?? input.internal_pages, role, false, key),
    allowedViews: [],
    isSystem: Boolean(input.isSystem ?? input.is_system),
    isLocked: Boolean(input.isLocked ?? input.is_locked),
    createdAt: input.createdAt ?? input.created_at ?? null,
    updatedAt: input.updatedAt ?? input.updated_at ?? null,
  };
}

function buildSystemAccessProfiles() {
  return SYSTEM_ACCESS_PROFILES.map((profile) => normalizeAccessProfileRecord(profile));
}

function isMissingAccessProfilesTable(error) {
  const code = normalizeString(error?.code);
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();

  return code === "42P01" || (message.includes("access_profiles") && message.includes("does not exist"));
}

async function listAccessProfiles() {
  const systemProfiles = buildSystemAccessProfiles();

  // O usuário solicitou que houvesse apenas UMA fonte de verdade para os perfis.
  // Como não há UI para gerenciar a tabela access_profiles, usaremos apenas os perfis nativos blindados (hardcoded).
  return systemProfiles.sort((left, right) => {
    return left.label.localeCompare(right.label, "pt-BR");
  });
}

function findAccessProfileByKey(profiles, key) {
  const normalizedKey = normalizeString(key)?.toLowerCase();
  if (!normalizedKey) return null;

  return profiles.find((profile) => profile.key === normalizedKey) || null;
}

function resolveRequestedAccessProfile(profiles, key, role) {
  const explicitProfile = findAccessProfileByKey(profiles, key);
  if (explicitProfile) {
    return explicitProfile;
  }

  return findAccessProfileByKey(profiles, getDefaultPresetForRole(role));
}

function serializeAccessProfileRecord(profile) {
  return {
    key: profile.key,
    label: profile.label,
    description: profile.description,
    role: profile.role,
    scope_mode: profile.scopeMode,
    approval_level: profile.approvalLevel,
    permissions: profile.permissions,
    internal_pages: profile.internalPages,
    allowed_views: profile.allowedViews,
    is_system: profile.isSystem,
    is_locked: profile.isLocked,
    updated_at: new Date().toISOString(),
  };
}

async function syncUsersWithAccessProfile(profile) {
  const auth = getAuth();
  const users = await listAllFirebaseUsers();
  let updatedUsers = 0;
  let skippedUsers = 0;

  for (const user of users) {
    const currentAccess = extractManagedAccessClaims(user.customClaims || {}, {
      uid: user.uid,
      email: user.email,
    });

    if (currentAccess.accessPreset !== profile.key) {
      continue;
    }

    if (isFixedAdminIdentity({ uid: user.uid, email: user.email })) {
      skippedUsers += 1;
      continue;
    }

    try {
      const nextClaims = buildManagedClaims({
        role: profile.role,
        accessPreset: profile.key,
        scopeMode: profile.scopeMode,
        approvalLevel: profile.approvalLevel,
        permissions: profile.permissions,
        clientIds: currentAccess.clientIds,
        tenantIds: currentAccess.tenantIds,
        clientId: currentAccess.clientId,
        tenantId: currentAccess.tenantId,
        allowedViews: profile.allowedViews,
        companyName: currentAccess.companyName,
        internalPages: profile.internalPages,
      });

      await auth.setCustomUserClaims(
        user.uid,
        mergeManagedClaims(user.customClaims || {}, nextClaims)
      );
      updatedUsers += 1;
    } catch (error) {
      skippedUsers += 1;
      console.error("access profile sync error:", {
        key: profile.key,
        uid: user.uid,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { updatedUsers, skippedUsers };
}
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

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      const isEscapedQuote = inQuotes && line[i + 1] === '"';
      if (isEscapedQuote) {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && c === ",") {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }

  result.push(current.trim());
  return result;
}

function parseCsvToRows(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function normalizeHeaderKey(value) {
  const normalized = normalizeString(value);
  if (!normalized) return "";

  return normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function pickRowValue(row, aliases) {
  if (!row || typeof row !== "object") return null;

  const entries = Object.entries(row);
  for (const [key, value] of entries) {
    const normalizedKey = normalizeHeaderKey(key);
    if (aliases.includes(normalizedKey)) {
      return value;
    }
  }

  return null;
}

function normalizeImportedLead(row, clientId) {
  const telefone = sanitizePhone(
    pickRowValue(row, [
      "telefone",
      "telefones",
      "fone",
      "fones",
      "celular",
      "celulares",
      "whatsapp",
      "whatsapps",
      "phone",
      "phones",
      "numero",
      "numeros",
      "numero_telefone",
      "numero_telefones",
      "telefone_whatsapp",
      "telefones_whatsapp",
    ])
  );

  const nome = normalizeString(
    pickRowValue(row, ["nome", "name", "cliente", "contato", "lead", "responsavel"])
  );
  const tipoCliente = normalizeString(
    pickRowValue(row, ["tipo_cliente", "tipo", "perfil", "segmento", "classificacao"])
  );
  const faixaConsumo = normalizeString(
    pickRowValue(row, [
      "faixa_consumo",
      "consumo",
      "consumo_mensal",
      "valor_conta",
      "conta_de_energia",
      "ticket",
    ])
  );
  const cidade = normalizeString(pickRowValue(row, ["cidade", "city", "municipio"]));
  const estado = normalizeString(pickRowValue(row, ["estado", "uf", "state"]));
  const status = normalizeString(
    pickRowValue(row, ["status", "etapa", "situacao", "pipeline_status"])
  );
  const dataHora = normalizeIsoDate(
    pickRowValue(row, ["data_hora", "data", "created_at", "data_de_cadastro", "timestamp"])
  );
  const qualificacao = normalizeString(
    pickRowValue(row, [
      "qualificacao",
      "observacoes",
      "observacao",
      "resumo",
      "anotacoes",
      "notas",
      "descricao",
    ])
  );

  return {
    client_id: clientId,
    telefone,
    nome,
    tipo_cliente: tipoCliente,
    faixa_consumo: faixaConsumo,
    cidade,
    estado,
    status,
    data_hora: dataHora,
    qualificacao,
  };
}

function isImportedLeadEmpty(lead) {
  return !lead.telefone && !lead.nome && !lead.cidade && !lead.qualificacao;
}

function buildImportPreview(items) {
  return items.slice(0, 10).map((item) => ({
    rowNumber: item.rowNumber,
    telefone: item.normalized.telefone,
    nome: item.normalized.nome,
    cidade: item.normalized.cidade,
    status: item.normalized.status,
    imported: item.imported,
    skipReason: item.skipReason,
  }));
}

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

  let query = supabase
    .from("lead_import_items")
    .select("id, import_id, client_id, lead_id, telefone, normalized_data, created_at")
    .eq("client_id", clientId)
    .eq("imported", true)
    .not("telefone", "is", null)
    .order("created_at", { ascending: false });

  if (importId) {
    query = query.eq("import_id", importId);
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
          const normalizedData =
            item.normalized_data && typeof item.normalized_data === "object"
              ? item.normalized_data
              : {};

          return {
            id: item.id,
            import_id: item.import_id,
            client_id: item.client_id,
            lead_id: item.lead_id || null,
            telefone: sanitizePhone(item.telefone),
            normalized_data: normalizedData,
            nome: normalizeString(normalizedData.nome),
            tipo_cliente: normalizeString(normalizedData.tipo_cliente),
            faixa_consumo: normalizeString(normalizedData.faixa_consumo),
            cidade: normalizeString(normalizedData.cidade),
            estado: normalizeString(normalizedData.estado),
            status: normalizeString(normalizedData.status),
            data_hora: normalizeIsoDate(normalizedData.data_hora),
            qualificacao: normalizeString(normalizedData.qualificacao),
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
function getHealthPostgresPingBudgetMs() {
  const raw = Number.parseInt(String(process.env.HEALTH_PG_PING_TIMEOUT_MS || ""), 10);
  if (Number.isFinite(raw) && raw >= 500 && raw <= 20_000) return raw;
  return 12_000;
}

async function postgresHealthPing(pool) {
  const budgetMs = getHealthPostgresPingBudgetMs();
  return await Promise.race([
    pool.query("select 1 as ok"),
    new Promise((_, reject) => {
      const id = setTimeout(() => reject(new Error("health_pg_ping_timeout")), budgetMs);
      if (typeof id.unref === "function") id.unref();
    }),
  ]);
}


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
