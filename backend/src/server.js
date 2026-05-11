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
    pgDatabasePool.end().catch(() => {});
  }
}
process.once("SIGTERM", shutdownPgPool);
process.once("SIGINT", shutdownPgPool);

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
  "internal_admin",
  "internal_manager",
  "internal_operator",
  "consultor",
  "gerente",
  "sdr",
  "gestor",
  "parceiro",
  "client_manager",
  "client_operator",
  "client_viewer",
  "pending",
];
const ACCESS_PRESET_LABELS = {
  internal_admin: "Admin interno",
  internal_manager: "Gestor interno",
  internal_operator: "Operacao interna",
  consultor: "Consultor",
  gerente: "Gerente",
  sdr: "SDR",
  gestor: "Gestor",
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
  "econradofl@gmail.com",
]);

function isFixedAdminIdentity(identity = {}) {
  const uid = normalizeString(identity.uid);
  const email = normalizeString(identity.email)?.toLowerCase() || null;

  return (uid && FIXED_ADMIN_UIDS.has(uid)) || (email && FIXED_ADMIN_EMAILS.has(email)) || false;
}

const ACCESS_PRESET_DEFAULTS = {
  internal_admin: {
    role: "internal",
    scopeMode: "all_clients",
    approvalLevel: "director",
    permissions: [...ACCESS_PERMISSION_KEYS],
    internalPages: [...INTERNAL_PAGE_KEYS],
    allowedViews: [],
  },
  internal_manager: {
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
    internalPages: [...INTERNAL_PAGE_KEYS],
    allowedViews: [],
  },
  internal_operator: {
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: ["dashboard.view", "leads.view", "imports.manage", "whatsapp.view", "whatsapp.reply"],
    internalPages: ["dashboard", "leads", "planilhas", "whatsapp"],
    allowedViews: [],
  },
  consultor: {
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: ["dashboard.view", "leads.view", "whatsapp.view", "whatsapp.reply"],
    internalPages: ["dashboard", "leads", "whatsapp"],
    allowedViews: [],
  },
  gerente: {
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
    internalPages: ["dashboard", "leads", "planilhas", "whatsapp", "agente", "usuarios", "campanhas"],
    allowedViews: [],
  },
  sdr: {
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: ["dashboard.view", "leads.view", "imports.manage", "whatsapp.view", "whatsapp.reply"],
    internalPages: ["dashboard", "leads", "planilhas", "whatsapp"],
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
      "tenants.manage",
      "users.view",
      "users.manage",
    ],
    internalPages: [...INTERNAL_PAGE_KEYS],
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
    key: "internal_admin",
    label: ACCESS_PRESET_LABELS.internal_admin,
    description: "Acesso total ao CRM e administracao do ambiente.",
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
    key: "internal_manager",
    label: ACCESS_PRESET_LABELS.internal_manager,
    description: "Gestao operacional com acesso ampliado aos modulos internos.",
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "manager",
    permissions: [...ACCESS_PRESET_DEFAULTS.internal_manager.permissions],
    internalPages: [...ACCESS_PRESET_DEFAULTS.internal_manager.internalPages],
    allowedViews: [],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "internal_operator",
    label: ACCESS_PRESET_LABELS.internal_operator,
    description: "Operacao padrao do CRM para times internos.",
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: [...ACCESS_PRESET_DEFAULTS.internal_operator.permissions],
    internalPages: [...ACCESS_PRESET_DEFAULTS.internal_operator.internalPages],
    allowedViews: [],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "consultor",
    label: ACCESS_PRESET_LABELS.consultor,
    description: "Atende leads, acompanha conversas e opera a rotina comercial.",
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: [...ACCESS_PRESET_DEFAULTS.consultor.permissions],
    internalPages: [...ACCESS_PRESET_DEFAULTS.consultor.internalPages],
    allowedViews: [],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "gerente",
    label: ACCESS_PRESET_LABELS.gerente,
    description: "Gerencia operacao, acessos de usuarios e performance comercial.",
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "manager",
    permissions: [...ACCESS_PRESET_DEFAULTS.gerente.permissions],
    internalPages: [...ACCESS_PRESET_DEFAULTS.gerente.internalPages],
    allowedViews: [],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "sdr",
    label: ACCESS_PRESET_LABELS.sdr,
    description: "Qualifica leads, conversa com contatos e alimenta a operacao.",
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: [...ACCESS_PRESET_DEFAULTS.sdr.permissions],
    internalPages: [...ACCESS_PRESET_DEFAULTS.sdr.internalPages],
    allowedViews: [],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "gestor",
    label: ACCESS_PRESET_LABELS.gestor,
    description: "Libera usuarios, organiza empresas e conduz a operacao do CRM.",
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
    key: "parceiro",
    label: ACCESS_PRESET_LABELS.parceiro,
    description: "Acompanha a operacao com leitura e conversa limitada no ambiente do cliente.",
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
    description: "Perfil de cliente com acesso expandido ao portal.",
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
    description: "Perfil de cliente operacional para uso diario.",
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
    description: "Perfil de cliente com acesso de leitura.",
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

  return "internal_operator";
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
  return "internal_operator";
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
    internal_admin: "Admin interno",
    internal_manager: "Gestor interno",
    internal_operator: "Operacao interna",
    consultor: "Consultor",
    gerente: "Gerente",
    sdr: "SDR",
    gestor: "Gestor",
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

function extractManagedAccessClaims(rawClaims = {}, identity = {}) {
  const requestedRole = normalizeRole(
    rawClaims.role ??
      rawClaims.userRole ??
      rawClaims.user_type ??
      rawClaims.userType ??
      rawClaims.tipo_usuario
  );
  const accessPreset = normalizeAccessPreset(rawClaims.accessPreset, requestedRole);
  const isAdmin = requestedRole === "internal" && (
    rawClaims.isAdmin ||
    rawClaims.admin ||
    rawClaims.is_admin ||
    accessPreset === "internal_admin" ||
    isFixedAdminIdentity(identity)
  );
  const role = isAdmin ? "internal" : requestedRole;
  const normalizedPreset = isAdmin ? "internal_admin" : normalizeAccessPreset(accessPreset, role);
  const scopeMode = isAdmin
    ? "all_clients"
    : normalizeScopeMode(rawClaims.scopeMode ?? rawClaims.tenantScope, role);
  const approvalLevel = isAdmin
    ? "director"
    : normalizeApprovalLevel(rawClaims.approvalLevel, role);
  const directClientId = normalizeString(
    rawClaims.clientId ??
      rawClaims.client_id ??
      rawClaims.companyId ??
      rawClaims.empresaId ??
      rawClaims.tenantId
  );
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
    ? [...buildPresetDefaults("internal_admin").permissions]
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
  if (!firebaseReady) {
    sendError(
      res,
      500,
      "FIREBASE_NOT_CONFIGURED",
      "Firebase auth not configured",
      "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in backend env"
    );
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return;
  }

  const token = authHeader.slice("Bearer ".length);

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
      updated_at: null,
    };
  }

  return {
    client_id: row.client_id,
    dispatch_webhook_url: row.dispatch_webhook_url || null,
    has_dispatch_webhook_token: !!row.dispatch_webhook_token,
    has_inbound_bearer_token: !!row.inbound_bearer_token,
    active: row.active !== false,
    updated_at: row.updated_at || null,
    updated_by_email: row.updated_by_email || null,
  };
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
      "client_id, dispatch_webhook_url, dispatch_webhook_token, inbound_bearer_token, active, updated_at, updated_by_uid, updated_by_email"
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

  return {
    settings: data || null,
    schemaAvailable: true,
    source: data ? "client_settings" : "missing",
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
      "client_id, dispatch_webhook_url, dispatch_webhook_token, inbound_bearer_token, active, updated_at, updated_by_email"
    )
    .in("client_id", clientIds);

  if (error) {
    if (isMissingSchemaError(error)) return {};
    throw error;
  }

  return Object.fromEntries((data || []).map((row) => [row.client_id, row]));
}

function buildN8nSettingsPayload(input, authAccess, existing = null) {
  const body = input && typeof input === "object" ? input : {};
  const dispatchWebhookUrlProvided = Object.prototype.hasOwnProperty.call(body, "dispatchWebhookUrl");
  const dispatchWebhookTokenProvided = Object.prototype.hasOwnProperty.call(body, "dispatchWebhookToken");
  const inboundBearerTokenProvided = Object.prototype.hasOwnProperty.call(body, "inboundBearerToken");
  const activeProvided = Object.prototype.hasOwnProperty.call(body, "active");

  const payload = {
    active: activeProvided ? body.active !== false : existing?.active ?? true,
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
      "client_id, dispatch_webhook_url, dispatch_webhook_token, inbound_bearer_token, active, updated_at, updated_by_email"
    )
    .single();

  if (error) throw error;
  return data;
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

  const { data, error } = await supabase
    .from("leads")
    .select("telefone")
    .in("client_id", clientIds);

  if (error) {
    throw error;
  }

  return new Set(
    (data || [])
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

function buildDashboardPayload(client, leads, conversions = []) {
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

  const isAdmin = normalizedPreset === "internal_admin";
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

  const isAdmin = key === "internal_admin";

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

  if (!supabase) {
    return systemProfiles;
  }

  const { data, error } = await supabase
    .from("access_profiles")
    .select("key, label, description, role, scope_mode, approval_level, permissions, internal_pages, allowed_views, is_system, is_locked, created_at, updated_at")
    .order("is_system", { ascending: false })
    .order("label", { ascending: true });

  if (error) {
    if (isMissingAccessProfilesTable(error)) {
      return systemProfiles;
    }

    throw error;
  }

  const mergedProfiles = new Map(systemProfiles.map((profile) => [profile.key, profile]));

  for (const row of data || []) {
    const normalizedRow = normalizeAccessProfileRecord(row);
    mergedProfiles.set(normalizedRow.key, normalizedRow);
  }

  return Array.from(mergedProfiles.values()).sort((left, right) => {
    if (left.isSystem !== right.isSystem) {
      return left.isSystem ? -1 : 1;
    }

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

async function buildDispatchLeads({ clientId, importId = null, limit = null, segmentation = null }) {
  if (!supabase) return [];

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

  if (limit && Number.isInteger(limit) && limit > 0 && !segmentation) {
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
        .filter((item) => leadMatchesCampaignSegmentation(item, segmentation))
        .map((item) => [item.telefone, item])
    ).values()
  );

  if (limit && Number.isInteger(limit) && limit > 0) {
    return leads.slice(0, limit);
  }

  return leads;
}

/**
 * Monta a lista de telefones a gravar em `campaigns.phones` (os usados no disparo Evolution).
 * Prioriza o resumo do dispatch (mesmos valores do payload HTTP) para manter `campaigns.phones`
 * alinhado mesmo que os objetos lead usem nomes de campo alternativos ou normalização diferente.
 */
function resolveCampaignPhonesForRow(leads, dispatchSummary) {
  const fromSummary = Array.isArray(dispatchSummary?.successPhones)
    ? dispatchSummary.successPhones.filter(Boolean)
    : [];
  const fromLeads = Array.isArray(leads)
    ? leads
      .map((lead) => lead?.telefone || lead?.phone || lead?.number)
      .filter(Boolean)
    : [];

  return [...new Set([...fromLeads, ...fromSummary])];
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
    .from("leads")
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
      p.status === "aguardando_usuario" &&
      normalizeCampaignPendingStepIndex(p.nextStepIndex) !== null
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
    };
  }

  let [importItemsResult, campaignsResult] = await Promise.all([
    supabase
      .from("lead_import_items")
      .select("id, import_id, normalized_data, status_conversa, ultima_interacao_bot, ultima_interacao_usuario, created_at")
      .eq("client_id", clientId)
      .in("telefone", phoneVariants)
      .order("created_at", { ascending: false }),
    supabase
      .from("campaigns")
      .select("id, name, client_id, import_id, status, scheduled_for, last_triggered_at, archived_at, phones, analytics_meta")
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
        progress.status === "aguardando_usuario" &&
        normalizeCampaignPendingStepIndex(progress.nextStepIndex) !== null;

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
  // Only this phone's pending reply row qualifies — avoid picking another "processing" campaign
  // where this lead has no progress (multi-campaign / stale rows).
  const processingWaitForReplyMatches = waitForReplyMatches.filter((campaign) => campaign.hasPendingProgress === true);

  return {
    phone,
    importIds,
    matches,
    waitForReplyMatches,
    processingWaitForReplyMatches,
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
  const evolutionAudit =
    dispatchSummary && typeof dispatchSummary === "object"
      ? JSON.stringify(dispatchSummary).slice(0, 8000)
      : null;

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
      evolutionSummary: evolutionAudit,
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
    n8nResponse: evolutionAudit,
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
    n8nResponse: evolutionAudit,
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
      .from("leads")
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

    let savedSettings = null;
    if (n8nSettings) {
      savedSettings = await upsertLeadClientN8nSettings(
        tenantId,
        n8nSettings,
        req.authAccess,
        null
      );
    }

    res.status(201).json({
      item: {
        ...data,
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
  "leads",
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

  try {
    const auth = getAuth();
    const accessProfiles = await listAccessProfiles();
    const selectedProfile = resolveRequestedAccessProfile(accessProfiles, req.body?.accessPreset, role);

    if (req.body?.accessPreset && !findAccessProfileByKey(accessProfiles, req.body?.accessPreset)) {
      sendError(res, 400, "INVALID_ACCESS_PRESET", "Unsupported access preset");
      return;
    }

    const managedClaims = buildManagedClaims({
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
      sendError(res, 409, "EMAIL_ALREADY_EXISTS", "This email is already registered");
      return;
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

    if (supabase) {
      const title = `Novo cadastro de cliente: ${companyName}`.slice(0, 100);
      const description = `${name} (${email}) aguardando associacao de acessos.`.slice(0, 200);
      const { error } = await supabase.from("notifications").insert({
        type: "client_signup",
        title,
        description,
        read: false,
      });

      if (error) {
        console.error("client signup notification insert error:", error);
      }
    }

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
      .from("leads")
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
      .from("leads")
      .select("id, client_id, telefone, nome, tipo_cliente, faixa_consumo, cidade, estado, status, bot_ativo, historico, data_hora, qualificacao, created_at, updated_at")
      .eq("client_id", clientId)
      .order("data_hora", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (leadsError) {
      throw leadsError;
    }

    const leadPhones = Array.from(
      new Set((leads || []).map((lead) => sanitizePhone(lead.telefone)).filter(Boolean))
    );

    const [
      campaignsQuery,
      conversationsQuery,
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
      leadPhones.length
        ? optionalQuery(() =>
            supabase
              .from("lead_conversations")
              .select("telefone, created_at")
              .in("telefone", leadPhones)
          )
        : { data: [], available: true },
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
      conversations: conversationsQuery.data,
      messages: messagesQuery.data,
      assignments: assignmentsQuery.data,
      conversions: conversionsQuery.data,
      consultants: consultantsQuery.data,
      rules: rulesQuery.data,
      storedInsights: insightsQuery.data,
      availability: {
        campaigns: campaignsQuery.available,
        conversations: conversationsQuery.available,
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
      conversationsQuery,
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
            .from("leads")
            .select("id, client_id, telefone, nome, tipo_cliente, faixa_consumo, cidade, estado, status, bot_ativo, historico, data_hora, qualificacao, created_at, updated_at, source_campaign_id, lead_score, potential_contract_value, first_contact_at, qualified_at, closed_at, lead_temperature, lead_origin, behavior_meta")
            .eq("client_id", clientId)
            .order("data_hora", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false }),
        () =>
          supabase
            .from("leads")
            .select("id, client_id, telefone, nome, tipo_cliente, faixa_consumo, cidade, estado, status, bot_ativo, historico, data_hora, qualificacao, created_at, updated_at, source_campaign_id, lead_score, potential_contract_value, first_contact_at, qualified_at, closed_at")
            .eq("client_id", clientId)
            .order("data_hora", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false }),
        () =>
          supabase
            .from("leads")
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
          .from("lead_conversations")
          .select("telefone, created_at")
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
      conversations: conversationsQuery.data || [],
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
      .from("leads")
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

    const { data: dispatches } = await supabase
      .from("campaigns")
      .select("phones")
      .eq("client_id", clientId);

    const dispatchedPhones = new Set();
    for (const d of dispatches || []) {
      if (Array.isArray(d.phones)) {
        for (const phone of d.phones) dispatchedPhones.add(phone);
      }
    }

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

app.get("/api/notifications", requireFirebaseAuth, requireInternalPageAccess("agente"), async (req, res) => {
  if (!ensureDb(res)) return;

  try {
    const parsedLimit = Number.parseInt(String(req.query.limit || "20"), 10);
    const limit = Math.min(Number.isNaN(parsedLimit) ? 20 : parsedLimit, 50);
    const fetchLimit = canManageGlobalNotifications(req.authAccess)
      ? limit
      : Math.min(Math.max(limit * 5, 50), 250);
    const onlyUnread = String(req.query.onlyUnread || "false") === "true";

    let query = supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(fetchLimit);

    if (onlyUnread) {
      query = query.eq("read", false);
    }

    const { data: items, error: listError } = await query;
    if (listError) throw listError;

    const visibleItems = filterNotificationsForAccess(items || [], req.authAccess).slice(0, limit);
    let unreadCount = 0;

    if (canManageGlobalNotifications(req.authAccess)) {
      const { count, error: countError } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("read", false);

      if (countError) throw countError;
      unreadCount = count || 0;
    } else {
      const { data: unreadItems, error: unreadError } = await supabase
        .from("notifications")
        .select("*")
        .eq("read", false)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (unreadError) throw unreadError;
      unreadCount = filterNotificationsForAccess(unreadItems || [], req.authAccess).length;
    }

    res.json({ items: visibleItems, unreadCount });
  } catch (error) {
    console.error("notifications query error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
  }
});

app.patch("/api/notifications", requireFirebaseAuth, requireInternalPageAccess("agente"), async (req, res) => {
  if (!ensureDb(res)) return;

  try {
    const { id, read, markAllRead } = req.body || {};

    if (markAllRead) {
      if (canManageGlobalNotifications(req.authAccess)) {
        const { error } = await supabase.from("notifications").update({ read: true }).eq("read", false);
        if (error) throw error;
        res.json({ success: true });
        return;
      }

      const { data: unreadItems, error: listError } = await supabase
        .from("notifications")
        .select("*")
        .eq("read", false)
        .limit(1000);

      if (listError) throw listError;

      const visibleIds = getVisibleNotificationIds(unreadItems || [], req.authAccess);
      if (visibleIds.length === 0) {
        res.json({ success: true, updated: 0 });
        return;
      }

      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .in("id", visibleIds);
      if (error) throw error;
      res.json({ success: true, updated: visibleIds.length });
      return;
    }

    if (!id) {
      sendError(res, 400, "INVALID_BODY", "Missing id or markAllRead");
      return;
    }

    const { data: notification, error: findError } = await supabase
      .from("notifications")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;

    if (!notification) {
      sendError(res, 404, "NOTIFICATION_NOT_FOUND", "Notification not found");
      return;
    }

    if (!isNotificationVisibleToAccess(notification, req.authAccess)) {
      sendError(res, 403, "FORBIDDEN_NOTIFICATION_SCOPE", "You do not have access to this notification");
      return;
    }

    const { error } = await supabase
      .from("notifications")
      .update({ read: read ?? true })
      .eq("id", id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("notifications update error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
  }
});

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
        .from("leads")
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
        .from("leads")
        .insert(createPayload)
        .select("id")
        .single();

      if (insertError) {
        if (insertError.code === "23505") {
          const { data: duplicateLead, error: duplicateLookupError } = await supabase
            .from("leads")
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
      .from("leads")
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
      .from("leads")
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

    const { data, error } = await supabase.from("leads_outlier").insert(rows).select("id");

    if (error) {
      console.error("leads_outlier insert error:", error);
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

    const { data, error } = await supabase.from("leads_outlier").insert(rows).select("id");

    if (error) {
      console.error("leads_outlier insert error:", error);
      sendError(res, 500, "LEADS_OUTLIER_SAVE_FAILED", "Failed to save records", error.message);
      return;
    }

    res.json({ success: true, count: rows.length, ids: data?.map((item) => item.id) || [] });
  } catch (error) {
    console.error("import-lead-outlier-n8n error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
  }
});

app.post("/api/n8n-error-webhook", async (req, res) => {
  const authHeader = req.headers.authorization;
  const expectedSecret = getN8nWebhookBearerSecret();

  if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return;
  }

  if (!ensureDb(res)) return;

  try {
    const body = req.body || {};

    const workflowName = normalizeString(body.workflow?.name);
    const executionId = normalizeString(body.execution?.id);
    const executionUrl = normalizeString(body.execution?.url);
    const errorMessage = normalizeString(body.error?.message);
    const lastNode = normalizeString(body.error?.lastNodeExecuted);

    if (!workflowName || !executionId || !errorMessage) {
      sendError(
        res,
        400,
        "INVALID_BODY",
        "Missing required fields: workflow.name, execution.id, error.message"
      );
      return;
    }

    const truncatedMessage = errorMessage.slice(0, 1000);
    const truncatedNode = lastNode ? lastNode.slice(0, 200) : null;

    const { error: logError } = await supabase.from("n8n_error_logs").upsert(
      {
        execution_id: executionId,
        workflow_name: workflowName,
        message: truncatedMessage,
        node: truncatedNode,
        execution_url: executionUrl,
      },
      { onConflict: "execution_id" }
    );

    if (logError) {
      console.error("n8n log upsert error:", logError);
      sendError(res, 500, "N8N_LOG_SAVE_FAILED", "Failed to save error log", logError.message);
      return;
    }

    const descriptionText = `[${workflowName}] ${truncatedMessage}`.slice(0, 200);

    const { error: notifError } = await supabase.from("notifications").insert({
      type: "n8n_error",
      title: `Erro no workflow: ${workflowName}`.slice(0, 100),
      description: descriptionText,
      link: executionUrl,
      read: false,
    });

    if (notifError) {
      console.error("notification insert error:", notifError);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("n8n webhook error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
  }
});

app.post(
  "/api/conversation-memory",
  requireN8nWebhookSecret,
  validateConversationMemoryPayload,
  async (req, res) => {
    if (!ensureDb(res)) return;

    const { telefone, conversationCompressed, tamanhoOriginal, timestamp } = req.conversationMemory;

    try {
      const { data: lead, error: leadError } = await supabase
        .from("leads")
        .select("id")
        .eq("telefone", telefone)
        .limit(1)
        .maybeSingle();

      if (leadError) {
        throw leadError;
      }

      const unknownLead = !lead;

      const { error } = await supabase.from("lead_conversations").insert({
        telefone,
        conversation_compressed: conversationCompressed,
        tamanho_original: tamanhoOriginal,
        unknown_lead: unknownLead,
        created_at: timestamp,
      });

      if (error) {
        console.error("conversation memory insert error:", {
          event: "conversation_memory_insert_error",
          telefone,
          unknownLead,
          message: error.message,
          code: error.code,
        });
        sendError(
          res,
          500,
          "CONVERSATION_MEMORY_SAVE_FAILED",
          "Failed to save conversation memory",
          error.message
        );
        return;
      }

      console.info("conversation memory stored:", {
        event: "conversation_memory_stored",
        telefone,
        unknownLead,
        tamanhoOriginal,
        timestamp,
      });

      res.json({
        success: true,
        message: "Conversation stored",
        telefone,
        // Match Edge `conversation-memory` POST success shape for n8n consumers.
        created_at: req.conversationMemory.timestamp,
      });
    } catch (error) {
      console.error("conversation memory route error:", {
        event: "conversation_memory_route_error",
        telefone,
        message: error instanceof Error ? error.message : String(error),
      });
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  }
);

// GET latest compressed conversation + lead qualification flag (replaces Edge `conversation-memory-latest`).
// Auth: same global bearer as POST /api/conversation-memory (N8N_WEBHOOK_SECRET or default @Vexo2026).
app.get("/api/conversation-memory/latest", requireN8nWebhookSecret, async (req, res) => {
  if (!ensureDb(res)) return;

  const telefone = sanitizePhone(req.query?.telefone);
  if (!telefone) {
    return res.status(400).json({
      success: false,
      error: "Missing required query param: telefone",
    });
  }

  try {
    const [leadsResult, convResult] = await Promise.all([
      supabase.from("leads").select("telefone, qualificacao").eq("telefone", telefone).limit(1),
      supabase
        .from("lead_conversations")
        .select("id, telefone, conversation_compressed, tamanho_original, unknown_lead, created_at")
        .eq("telefone", telefone)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    if (leadsResult.error) {
      console.error("conversation-memory-latest leads error:", {
        telefone,
        message: leadsResult.error.message,
        code: leadsResult.error.code ?? null,
      });
      return res.status(500).json({
        success: false,
        error: "Failed to query leads table",
        details: leadsResult.error.message,
        code: leadsResult.error.code ?? null,
      });
    }

    if (convResult.error) {
      console.error("conversation-memory-latest conversation error:", {
        telefone,
        message: convResult.error.message,
        code: convResult.error.code ?? null,
      });
      return res.status(500).json({
        success: false,
        error: "Failed to load conversation",
        details: convResult.error.message,
        code: convResult.error.code ?? null,
      });
    }

    const leadExiste = (leadsResult.data?.length ?? 0) > 0;
    const conversaMaisRecente = convResult.data?.[0] ?? null;
    const leadQualificado = parseLeadQualificacaoBoolean(leadsResult.data?.[0]?.qualificacao);
    const encontrado = leadExiste && conversaMaisRecente !== null;

    if (encontrado) {
      return res.json({
        success: true,
        found: true,
        telefone,
        conversation: conversaMaisRecente,
        latestConversation: conversaMaisRecente,
        id: conversaMaisRecente.id,
        conversation_compressed: conversaMaisRecente.conversation_compressed,
        tamanho_original: conversaMaisRecente.tamanho_original,
        unknown_lead: conversaMaisRecente.unknown_lead,
        created_at: conversaMaisRecente.created_at,
        qualificacao: leadQualificado,
      });
    }

    return res.json({
      success: true,
      found: false,
      telefone,
      conversation: null,
      latestConversation: null,
      qualificacao: leadQualificado,
    });
  } catch (error) {
    console.error("conversation-memory-latest route error:", error);
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
      "id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, created_at, analytics_meta";
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
        .from("leads")
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
  const lifecycleStatus = scheduledFor ? "scheduled" : "draft";
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

    const dispatchSettings = await resolveDispatchWebhookSettings(authorizedClientId);
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

    const validation = validateCampaignAnalyticsMeta(analyticsMeta);
    if (!validation.valid) {
      sendError(res, 400, "INVALID_CAMPAIGN_CONTENT", validation.message);
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
      })
      .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, created_at, analytics_meta")
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
        })
          .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, created_at")
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
    console.error("campaign create error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
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
      .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, scheduled_for, last_triggered_at, archived_at, created_at, analytics_meta")
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
  const replyText =
    normalizeString(body.message || body.text || body.body || body.data?.message?.conversation || body.data?.message?.extendedTextMessage?.text) ||
    null;
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
        .from("leads")
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
      .from("leads")
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
app.listen(port, () => {
  console.log(`VexoApi listening on port ${port}`);
  startCampaignScheduler();

  whatsappSessionManager.restorePersistedSession().catch((error) => {
    console.error("whatsapp startup restore error:", error);
  });
});
