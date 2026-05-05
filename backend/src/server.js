import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { gunzipSync } from "zlib";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { whatsappSessionManager } from "./whatsapp.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const app = express();
app.use(express.json({ limit: "5mb" }));
const isProduction = process.env.NODE_ENV === "production";
const MAX_CONVERSATION_BYTES = 1024 * 1024;

const rawCorsOrigins = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const hasWildcard = rawCorsOrigins.includes("*");
// Non-production: allow any browser origin (Vite port is 8080 in frontend/vite.config.ts; list in CORS_ORIGINS still applies in production).
const allowAnyCorsOrigin = !isProduction;

// In production, strip wildcard so only explicit origins are accepted.
const corsOrigins = isProduction
  ? rawCorsOrigins.filter((o) => o !== "*")
  : rawCorsOrigins;

if (isProduction && hasWildcard) {
  console.warn(
    "[security] CORS_ORIGINS contains '*' in production. Wildcard will be ignored; only explicit origins are allowed."
  );
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

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowAnyCorsOrigin) {
        callback(null, true);
        return;
      }
      if (corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed: ${origin}`));
    },
  })
);

const supabaseUrl = process.env.SUPABASE_URL || process.env.URL;
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

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

function ensureSupabase(res) {
  if (!supabase) {
    sendError(
      res,
      500,
      "SUPABASE_NOT_CONFIGURED",
      "Missing Supabase configuration",
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
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
  "clientId",
  "client_id",
  "companyId",
  "empresaId",
  "clientIds",
  "allowedViews",
  "companyName",
  "internalPages",
];
const CLIENT_VIEW_KEYS = ["dashboard", "leads", "planilhas", "whatsapp"];
const DEFAULT_CLIENT_VIEWS = ["dashboard", "leads"];
const INTERNAL_PAGE_KEYS = ["dashboard", "leads", "planilhas", "whatsapp", "agente", "usuarios"];
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

function normalizeAllowedViews(value, role) {
  const allowed = normalizeStringArray(value)
    .map((item) => item.toLowerCase())
    .filter((item) => CLIENT_VIEW_KEYS.includes(item));

  if (role === "client" && allowed.length === 0) {
    return [...DEFAULT_CLIENT_VIEWS];
  }

  return Array.from(new Set(allowed));
}

function normalizeInternalPages(value, role, isAdmin = false) {
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
    return [...INTERNAL_PAGE_KEYS];
  }

  return Array.from(new Set(pages));
}

function extractManagedAccessClaims(rawClaims = {}, identity = {}) {
  const role = normalizeRole(
    rawClaims.role ??
      rawClaims.userRole ??
      rawClaims.user_type ??
      rawClaims.userType ??
      rawClaims.tipo_usuario
  );
  const isAdmin = role === "internal" && isFixedAdminIdentity(identity);
  const directClientId = normalizeString(
    rawClaims.clientId ??
      rawClaims.client_id ??
      rawClaims.companyId ??
      rawClaims.empresaId
  );
  const clientIds = Array.from(
    new Set([directClientId, ...normalizeStringArray(rawClaims.clientIds)].filter(Boolean))
  );
  const clientId = directClientId || clientIds[0] || null;
  const allowedViews = normalizeAllowedViews(rawClaims.allowedViews, role);
  const internalPages = normalizeInternalPages(rawClaims.internalPages, role, isAdmin);

  return {
    role,
    isAdmin,
    clientId: role === "client" ? clientId : null,
    clientIds: role === "client" ? clientIds : [],
    allowedViews: role === "client" ? allowedViews : [],
    internalPages,
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
    clientId: claims.clientId,
    clientIds: claims.clientIds,
    allowedViews: claims.allowedViews,
    internalPages: claims.internalPages,
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

function requireInternalPageAccess(page) {
  return (req, res, next) => {
    const access = req.authAccess;

    if (access?.role !== "internal") {
      sendError(res, 403, "FORBIDDEN", "Internal access required");
      return;
    }

    if (access.isAdmin || access.internalPages?.includes(page)) {
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

function hasInternalPageAccess(access, page) {
  return access?.role === "internal" && (access.isAdmin || access.internalPages?.includes(page));
}

function hasClientViewAccess(access, view) {
  return access?.role === "client" && access.allowedViews?.includes(view);
}

function canAccessAppView(access, view) {
  return hasInternalPageAccess(access, view) || hasClientViewAccess(access, view);
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
    throw new Error("Supabase is not configured");
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

  if (!ensureSupabase(res)) {
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

function requireN8nWebhookSecret(req, res, next) {
  const authHeader = req.headers.authorization;
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!authHeader || !expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
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
      "Decompressed conversation exceeds 1MB limit"
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
  const source = normalizeString(lead.qualificacao)?.toLowerCase() || "";

  if (source.includes("quente")) return "hot";
  if (source.includes("morno")) return "warm";
  if (source.includes("frio")) return "cold";
  return "unknown";
}

function buildDashboardPayload(client, leads) {
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
    const referenceDate = lead.data_hora ? new Date(lead.data_hora) : new Date(lead.created_at);
    const dateKey = getDateKey(referenceDate, timeZone);
    const statusKey = (normalizeString(lead.status) || "sem_status").toLowerCase();
    const typeKey = normalizeString(lead.tipo_cliente) || "nao_informado";
    const temperatureKey = detectTemperature(lead);
    const cityKey = normalizeString(lead.cidade);

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

    const dayEntry = recentDaysMap.get(dateKey);
    if (dayEntry) {
      dayEntry.leads += 1;
      if (isQualifiedStatus(statusKey)) {
        dayEntry.qualifiedLeads += 1;
      }
    }
  }

  const totalLeads = leads.length;
  const qualificationRate = totalLeads === 0 ? 0 : Math.round((qualifiedLeads / totalLeads) * 100);

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
    },
    leadsByDay: recentDays,
    temperatureBreakdown: [
      { name: "Quente", value: temperatureCounts.hot, color: "hsl(0, 72%, 51%)" },
      { name: "Morno", value: temperatureCounts.warm, color: "hsl(32, 95%, 55%)" },
      { name: "Frio", value: temperatureCounts.cold, color: "hsl(217, 91%, 60%)" },
      { name: "Sem sinal", value: temperatureCounts.unknown, color: "hsl(220, 12%, 60%)" },
    ],
    statusBreakdown: Array.from(statusCounts.entries())
      .map(([status, value]) => ({
        name: humanizeStatus(status),
        value,
      }))
      .sort((a, b) => b.value - a.value),
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
  clientIds = [],
  allowedViews = [],
  companyName = null,
  internalPages = [],
}) {
  const normalizedRole = normalizeRole(role);
  const normalizedClientIds = normalizeStringArray(clientIds);
  const normalizedViews = normalizeAllowedViews(allowedViews, normalizedRole);
  const normalizedCompanyName = normalizeString(companyName);
  const normalizedInternalPages = normalizeInternalPages(internalPages, normalizedRole);

  if (normalizedRole === "client" && normalizedClientIds.length === 0) {
    throw new Error("Client users must have at least one associated client");
  }

  if (normalizedRole === "pending") {
    return {
      role: "pending",
      companyName: normalizedCompanyName,
    };
  }

  if (normalizedRole === "client") {
    return {
      role: "client",
      clientId: normalizedClientIds[0],
      clientIds: normalizedClientIds,
      allowedViews: normalizedViews,
      companyName: normalizedCompanyName,
    };
  }

  return {
    role: "internal",
    internalPages: normalizedInternalPages,
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

function resolveAuthorizedClientId(req, res, requestedClientId) {
  const authAccess = req.authAccess || { role: "internal", clientId: null, clientIds: [] };

  if (authAccess.role === "client") {
    if (requestedClientId && !authAccess.clientIds.includes(requestedClientId)) {
      sendError(
        res,
        403,
        "FORBIDDEN_CLIENT_SCOPE",
        "You do not have access to this client"
      );
      return null;
    }

    return requestedClientId || authAccess.clientId || authAccess.clientIds[0] || null;
  }

  // P0.2 SECURITY FIX: Internal users também precisam validar clientId
  if (authAccess.role === "internal") {
    // Se requestedClientId é especificado, validar se interno tem acesso
    if (requestedClientId) {
      // Opção 1: Admins podem acessar qualquer cliente
      if (authAccess.isAdmin) {
        return requestedClientId;
      }

      // Opção 2: Internos não-admin devem ter clientId na lista
      if (authAccess.clientIds && authAccess.clientIds.length > 0) {
        if (!authAccess.clientIds.includes(requestedClientId)) {
          sendError(res, 403, "FORBIDDEN_CLIENT_SCOPE", "You do not have access to this client");
          return null;
        }
        return requestedClientId;
      }

      // Opção 3: Sem clientIds atribuídos = erro
      sendError(res, 403, "NO_CLIENT_ACCESS", "You do not have access to any client");
      return null;
    }

    // Se nenhum clientId especificado, usar default (se houver)
    return authAccess.clientId || null;
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
      "conta_energia",
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

async function buildDispatchLeads({ clientId, importId = null, limit = null }) {
  if (!supabase) return [];

  let query = supabase
    .from("lead_import_items")
    .select("id, import_id, client_id, telefone, normalized_data, created_at")
    .eq("client_id", clientId)
    .eq("imported", true)
    .not("telefone", "is", null)
    .order("created_at", { ascending: false });

  if (importId) {
    query = query.eq("import_id", importId);
  }

  if (limit && Number.isInteger(limit) && limit > 0) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return Array.from(
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
            telefone: sanitizePhone(item.telefone),
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
        .map((item) => [item.telefone, item])
    ).values()
  );
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    services: {
      supabase: !!supabase,
      firebaseAuth: firebaseReady,
    },
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
  if (!ensureSupabase(res)) return;

  if (req.authAccess?.role === "pending") {
    sendError(res, 403, "PENDING_APPROVAL", "Your account is waiting for approval");
    return;
  }

  try {
    let query = supabase.from("leads_clients").select("id, name, created_at");

    if (req.authAccess?.role === "client") {
      query = query.in("id", req.authAccess.clientIds);
    } else {
      query = query.order("name", { ascending: true });
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    res.json({ items: data || [] });
  } catch (error) {
    console.error("lead clients query error:", error);
    sendError(res, 500, "LEAD_CLIENTS_QUERY_FAILED", "Failed to query lead clients");
  }
});

app.delete("/api/lead-clients/:id", requireFirebaseAuth, requireAdminAccess, async (req, res) => {
  if (!ensureSupabase(res)) return;

  const clientId = normalizeString(req.params.id);
  if (!clientId) {
    sendError(res, 400, "INVALID_PARAMS", "Missing client id");
    return;
  }

  try {
    const { error } = await supabase
      .from("leads_clients")
      .delete()
      .eq("id", clientId);

    if (error) {
      throw error;
    }

    res.json({ success: true });
  } catch (error) {
    console.error("lead client delete error:", error);
    sendError(res, 500, "LEAD_CLIENT_DELETE_FAILED", "Failed to delete lead client");
  }
});

app.get("/api/admin/users", requireFirebaseAuth, requireInternalPageAccess("usuarios"), async (_req, res) => {
  try {
    const users = await listAllFirebaseUsers();

    res.json({
      items: users.map(mapAdminUserRecord),
    });
  } catch (error) {
    console.error("admin users query error:", error);
    sendError(res, 500, "ADMIN_USERS_QUERY_FAILED", "Failed to query users");
  }
});

app.patch("/api/admin/users/:uid/access", requireFirebaseAuth, requireAdminAccess, async (req, res) => {
  const uid = normalizeString(req.params.uid);
  const role = normalizeString(req.body?.role);

  if (!uid || !role) {
    sendError(res, 400, "INVALID_BODY", "Missing uid or role");
    return;
  }

  try {
    const auth = getAuth();
    const user = await auth.getUser(uid);
    const isTargetFixedAdmin = isFixedAdminIdentity({ uid: user.uid, email: user.email });
    const managedClaims = isTargetFixedAdmin
      ? buildManagedClaims({
          role: "internal",
          internalPages: INTERNAL_PAGE_KEYS,
        })
      : buildManagedClaims({
          role,
          clientIds: req.body?.clientIds,
          allowedViews: req.body?.allowedViews,
          companyName: req.body?.companyName,
          internalPages: req.body?.internalPages,
        });

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

app.post("/api/admin/users", requireFirebaseAuth, requireAdminAccess, async (req, res) => {
  const email = normalizeString(req.body?.email)?.toLowerCase();
  const password = normalizeString(req.body?.password);
  const displayName = normalizeString(req.body?.displayName);
  const role = normalizeString(req.body?.role);
  const sendPasswordReset = normalizeBool(req.body?.sendPasswordReset);

  if (!email || !password || !role) {
    sendError(res, 400, "INVALID_BODY", "Missing email, password or role");
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
      displayName: displayName || undefined,
    });
    const managedClaims = buildManagedClaims({
      role,
      clientIds: req.body?.clientIds,
      allowedViews: req.body?.allowedViews,
      companyName: req.body?.companyName,
      internalPages: req.body?.internalPages,
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
  if (!ensureSupabase(res)) return;
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

    res.json(buildDashboardPayload(client || { id: clientId, name: clientId }, leads || []));
  } catch (error) {
    console.error("dashboard query error:", error);
    sendError(res, 500, "DASHBOARD_QUERY_FAILED", "Failed to query dashboard data");
  }
});

app.get("/api/leads", requireFirebaseAuth, async (req, res) => {
  if (!ensureSupabase(res)) return;
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
  if (!ensureSupabase(res)) return;

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
  if (!ensureSupabase(res)) return;

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
  if (!ensureSupabase(res)) return;

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
  if (!ensureSupabase(res)) return;

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

app.post("/api/n8n-dispatches", requireFirebaseAuth, requireAppViewAccess("planilhas"), async (req, res) => {
  if (!ensureSupabase(res)) return;

  const requestedClientId = normalizeString(req.body?.clientId);
  const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
  if (!clientId) return;
  const importId = normalizeString(req.body?.importId);
  const scheduledAt = normalizeString(req.body?.scheduledAt);
  const campaignName = normalizeString(req.body?.campaignName);
  const channel = normalizeString(req.body?.channel);
  const webhookUrl =
    normalizeString(req.body?.webhookUrl) || normalizeString(process.env.N8N_DISPATCH_WEBHOOK_URL);
  const webhookToken =
    normalizeString(req.body?.webhookToken) || normalizeString(process.env.N8N_DISPATCH_WEBHOOK_TOKEN);
  const rawLimit = Number.parseInt(String(req.body?.limit ?? ""), 10);
  const limit = Number.isNaN(rawLimit) ? null : rawLimit;

  if (!webhookUrl) {
    sendError(
      res,
      400,
      "INVALID_BODY",
      "Missing webhookUrl or N8N_DISPATCH_WEBHOOK_URL"
    );
    return;
  }

  try {
    const leads = await buildDispatchLeads({ clientId, importId, limit });

    if (leads.length === 0) {
      sendError(res, 404, "NO_DISPATCH_LEADS", "No leads found for dispatch");
      return;
    }

    const clientName = await getClientName(clientId);
    const payload = {
      source: "vexocrm",
      action: "dispatch_leads",
      requestedAt: new Date().toISOString(),
      requestedBy: {
        uid: req.authAccess?.uid || null,
        email: req.authAccess?.email || null,
      },
      client: {
        id: clientId,
        name: clientName,
      },
      importId,
      campaignName: campaignName || null,
      channel: channel || null,
      scheduledAt: scheduledAt || null,
      dispatchMode: scheduledAt ? "scheduled" : "immediate",
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

    const headers = {
      "Content-Type": "application/json",
    };

    if (webhookToken) {
      headers.Authorization = `Bearer ${webhookToken}`;
    }

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const responseText = await webhookResponse.text();

    if (!webhookResponse.ok) {
      sendError(
        res,
        502,
        "N8N_DISPATCH_FAILED",
        "n8n webhook returned an error",
        responseText.slice(0, 1000)
      );
      return;
    }

    res.json({
      success: true,
      webhookUrl,
      total: leads.length,
      phones: payload.phones,
      n8nResponse: responseText || null,
    });
  } catch (error) {
    console.error("n8n dispatch error:", error);
    sendError(
      res,
      500,
      "N8N_DISPATCH_FAILED",
      error instanceof Error ? error.message : "Failed to send leads to n8n"
    );
  }
  }
);

app.get("/api/notifications", requireFirebaseAuth, requireInternalPageAccess("agente"), async (req, res) => {
  if (!ensureSupabase(res)) return;

  try {
    const limit = Math.min(Number.parseInt(String(req.query.limit || "20"), 10), 50);
    const onlyUnread = String(req.query.onlyUnread || "false") === "true";

    let query = supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(Number.isNaN(limit) ? 20 : limit);

    if (onlyUnread) {
      query = query.eq("read", false);
    }

    const { data: items, error: listError } = await query;
    if (listError) throw listError;

    const { count, error: countError } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("read", false);

    if (countError) throw countError;

    res.json({ items: items || [], unreadCount: count || 0 });
  } catch (error) {
    console.error("notifications query error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

app.patch("/api/notifications", requireFirebaseAuth, requireInternalPageAccess("agente"), async (req, res) => {
  if (!ensureSupabase(res)) return;

  try {
    const { id, read, markAllRead } = req.body || {};

    if (markAllRead) {
      const { error } = await supabase.from("notifications").update({ read: true }).eq("read", false);
      if (error) throw error;
      res.json({ success: true });
      return;
    }

    if (!id) {
      sendError(res, 400, "INVALID_BODY", "Missing id or markAllRead");
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
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

app.post("/api/leads-webhook", async (req, res) => {
  const authHeader = req.headers.authorization;
  const expectedSecret = process.env.LEADS_WEBHOOK_SECRET;

  if (!authHeader || !expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return;
  }

  if (!ensureSupabase(res)) return;

  try {
    const body = req.body || {};
    const leadsRaw = body.leads ?? (body.lead ? [body.lead] : []);
    const leads = Array.isArray(leadsRaw) ? leadsRaw : [leadsRaw];

    if (leads.length === 0) {
      sendError(res, 400, "INVALID_BODY", "Missing lead or leads array in body");
      return;
    }

    const clientId = normalizeString(body.client_id) || "infinie";

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
    console.error("leads webhook error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

app.post("/api/n8n-error-webhook", async (req, res) => {
  const authHeader = req.headers.authorization;
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!authHeader || !expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return;
  }

  if (!ensureSupabase(res)) return;

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
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

app.post(
  "/api/conversation-memory",
  requireN8nWebhookSecret,
  validateConversationMemoryPayload,
  async (req, res) => {
    if (!ensureSupabase(res)) return;

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
      });
    } catch (error) {
      console.error("conversation memory route error:", {
        event: "conversation_memory_route_error",
        telefone,
        message: error instanceof Error ? error.message : String(error),
      });
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
    }
  }
);

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
app.get("/api/campaigns", requireFirebaseAuth, requireInternalPageAccess("campanhas"), async (req, res) => {
  if (!ensureSupabase(res)) return;

  try {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, last_triggered_at, created_by_uid, created_by_email, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      sendError(res, 500, "CAMPAIGNS_FETCH_FAILED", "Failed to fetch campaigns", error.message);
      return;
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
      client_name: clientNameMap[row.client_id] ?? null,
      webhook_token: row.webhook_token ? "***" : null,
    }));

    res.json({ items });
  } catch (error) {
    console.error("campaigns fetch error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

// POST /api/campaigns — cria campanha
app.post("/api/campaigns", requireFirebaseAuth, requireInternalPageAccess("campanhas"), async (req, res) => {
  if (!ensureSupabase(res)) return;

  const name = normalizeString(req.body?.name);
  const clientId = normalizeString(req.body?.clientId);
  const importId = normalizeString(req.body?.importId) || null;
  const rawLimit = Number.parseInt(String(req.body?.limitPerRun ?? "50"), 10);
  const limitPerRun = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 500);
  const webhookUrl = normalizeString(req.body?.webhookUrl);
  const webhookToken = normalizeString(req.body?.webhookToken) || null;

  if (!name) { sendError(res, 400, "INVALID_BODY", "Missing name"); return; }
  if (!clientId) { sendError(res, 400, "INVALID_BODY", "Missing clientId"); return; }
  if (!webhookUrl) { sendError(res, 400, "INVALID_BODY", "Missing webhookUrl"); return; }

  try {
    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        name,
        client_id: clientId,
        import_id: importId,
        limit_per_run: limitPerRun,
        webhook_url: webhookUrl,
        webhook_token: webhookToken,
        status: "active",
        created_by_uid: req.authAccess?.uid || null,
        created_by_email: req.authAccess?.email || null,
      })
      .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, last_triggered_at, created_at")
      .single();

    if (error) {
      sendError(res, 500, "CAMPAIGN_CREATE_FAILED", "Failed to create campaign", error.message);
      return;
    }

    res.status(201).json({ item: { ...data, webhook_token: webhookToken ? "***" : null } });
  } catch (error) {
    console.error("campaign create error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

// PATCH /api/campaigns/:id — atualiza campanha
app.patch("/api/campaigns/:id", requireFirebaseAuth, requireInternalPageAccess("campanhas"), async (req, res) => {
  if (!ensureSupabase(res)) return;

  const id = normalizeString(req.params?.id);
  if (!id) { sendError(res, 400, "INVALID_PARAM", "Missing campaign id"); return; }

  const updates = {};
  if (req.body?.name) updates.name = normalizeString(req.body.name);
  if (req.body?.status === "active" || req.body?.status === "paused") updates.status = req.body.status;
  if (req.body?.limitPerRun) {
    const v = Number.parseInt(String(req.body.limitPerRun), 10);
    if (!Number.isNaN(v) && v > 0) updates.limit_per_run = Math.min(v, 500);
  }
  if (req.body?.webhookUrl) updates.webhook_url = normalizeString(req.body.webhookUrl);
  if ("webhookToken" in req.body) updates.webhook_token = normalizeString(req.body.webhookToken);

  if (Object.keys(updates).length === 0) {
    sendError(res, 400, "INVALID_BODY", "No valid fields to update");
    return;
  }

  try {
    const { data, error } = await supabase
      .from("campaigns")
      .update(updates)
      .eq("id", id)
      .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, last_triggered_at, created_at")
      .single();

    if (error) {
      sendError(res, 500, "CAMPAIGN_UPDATE_FAILED", "Failed to update campaign", error.message);
      return;
    }

    res.json({ item: { ...data, webhook_token: null } });
  } catch (error) {
    console.error("campaign update error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

// DELETE /api/campaigns/:id — exclui campanha
app.delete("/api/campaigns/:id", requireFirebaseAuth, requireInternalPageAccess("campanhas"), async (req, res) => {
  if (!ensureSupabase(res)) return;

  const id = normalizeString(req.params?.id);
  if (!id) { sendError(res, 400, "INVALID_PARAM", "Missing campaign id"); return; }

  try {
    const { error } = await supabase.from("campaigns").delete().eq("id", id);

    if (error) {
      sendError(res, 500, "CAMPAIGN_DELETE_FAILED", "Failed to delete campaign", error.message);
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error("campaign delete error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

// POST /api/campaigns/:id/trigger — dispara campanha (chama webhook n8n)
app.post("/api/campaigns/:id/trigger", requireFirebaseAuth, requireInternalPageAccess("campanhas"), async (req, res) => {
  if (!ensureSupabase(res)) return;

  const id = normalizeString(req.params?.id);
  if (!id) { sendError(res, 400, "INVALID_PARAM", "Missing campaign id"); return; }

  try {
    const { data: campaign, error: fetchError } = await supabase
      .from("campaigns")
      .select("id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status")
      .eq("id", id)
      .single();

    if (fetchError || !campaign) {
      sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
      return;
    }

    if (campaign.status !== "active") {
      sendError(res, 400, "CAMPAIGN_PAUSED", "Campaign is paused");
      return;
    }

    // Buscar leads reais para incluir no payload
    const leads = await buildDispatchLeads({
      clientId: campaign.client_id,
      importId: campaign.import_id || null,
      limit: campaign.limit_per_run,
    });

    if (leads.length === 0) {
      sendError(res, 404, "NO_DISPATCH_LEADS", "No leads found for this campaign");
      return;
    }

    const clientName = await getClientName(campaign.client_id);

    const headers = { "Content-Type": "application/json" };
    if (campaign.webhook_token) {
      headers.Authorization = `Bearer ${campaign.webhook_token}`;
    }

    const payload = {
      source: "vexocrm",
      action: "campaign_dispatch",
      campaignId: campaign.id,
      campaignName: campaign.name,
      requestedAt: new Date().toISOString(),
      client: { id: campaign.client_id, name: clientName },
      importId: campaign.import_id || null,
      limit: campaign.limit_per_run,
      total: leads.length,
      phones: leads.map((l) => l.telefone),
      leads: leads.map((l) => ({
        id: l.id,
        telefone: l.telefone,
        nome: l.nome,
        cidade: l.cidade,
        estado: l.estado,
        status: l.status,
        tipo_cliente: l.tipo_cliente,
        faixa_consumo: l.faixa_consumo,
        qualificacao: l.qualificacao,
        data_hora: l.data_hora,
        created_at: l.created_at,
      })),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let n8nResponse = null;
    try {
      const webhookRes = await fetch(campaign.webhook_url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      n8nResponse = await webhookRes.text();

      if (!webhookRes.ok) {
        sendError(res, 502, "N8N_TRIGGER_FAILED", "n8n webhook returned an error", n8nResponse.slice(0, 500));
        return;
      }
    } finally {
      clearTimeout(timeout);
    }

    await supabase
      .from("campaigns")
      .update({ last_triggered_at: new Date().toISOString() })
      .eq("id", id);

    res.json({
      success: true,
      campaignId: campaign.id,
      campaignName: campaign.name,
      webhookUrl: campaign.webhook_url,
      n8nResponse: n8nResponse || null,
    });
  } catch (error) {
    console.error("campaign trigger error:", error);
    if (error?.name === "AbortError") {
      sendError(res, 504, "N8N_TIMEOUT", "n8n webhook timed out (15s)");
      return;
    }
    sendError(res, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Internal server error");
  }
});

// GET /api/leads-for-dispatch — n8n busca leads pendentes (autenticado por Bearer token)
app.get("/api/leads-for-dispatch", requireN8nWebhookSecret, async (req, res) => {
  if (!ensureSupabase(res)) return;

  const clientId = normalizeString(req.query?.clientId);
  const importId = normalizeString(req.query?.importId) || null;
  const rawLimit = Number.parseInt(String(req.query?.limit ?? "50"), 10);
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 200);

  if (!clientId) {
    sendError(res, 400, "INVALID_QUERY", "Missing clientId");
    return;
  }

  try {
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
    sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large" || error?.status === 413) {
    sendError(res, 413, "PAYLOAD_TOO_LARGE", "Request payload exceeds 1MB limit");
    return;
  }

  if (error?.message?.startsWith("Origin not allowed:")) {
    sendError(res, 403, "CORS_FORBIDDEN_ORIGIN", "Origin not allowed", error.message);
    return;
  }

  console.error("unhandled express error:", error);
  sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
});

const port = Number.parseInt(process.env.PORT || "3001", 10);
app.listen(port, () => {
  console.log(`VexoApi listening on port ${port}`);

  whatsappSessionManager.restorePersistedSession().catch((error) => {
    console.error("whatsapp startup restore error:", error);
  });
});
