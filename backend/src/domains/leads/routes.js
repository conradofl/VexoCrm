// backend/src/domains/leads/routes.js
// Movimento puro (extraído de registerAllDomainRoutes.js): 17 rotas de leads/lead-clients/
// lead-imports + helpers exclusivos (detectImportColumns, isRowHeader,
// checkLeadClientTableStatus/ensureLeadClientTable, deleteLeadClientRowsFromTable,
// purgeLeadClientOperationalData, deleteLeadClientHandler). Corpo dos handlers idêntico
// ao original — só muda de onde vêm as dependências (deps em vez de routeDeps destructure
// inline). Rotas de n8n-settings e evolution-instances de lead-clients continuam em
// registerAllDomainRoutes.js (domínio integrations).

import {
  checkLeadClientTableStatus as checkDynamicLeadClientTableStatus,
  ensureLeadClientTable as ensureDynamicLeadClientTable,
  ensureLeadIntelligenceColumns,
  ensureLeadsClientsTicketMedioColumn,
  ensureLeadCustomFieldsTable,
} from "../../lead-client-tables.js";
import { hasAccessPermission } from "../../accessGuards.js";
import { requireContractedModulePage } from "../../access/modularGate.js";
import { upsertLeadByPhone, upsertLeadsBatchByPhone } from "../../services/leadUpsert.js";
import { summarizeChatWithAI, temConversaComercial } from "./chatInsight.js";
import { confirmLeadAgreement, saveLeadAgreement } from "../../services/leadAgreement.js";
import {
  getDefaultLeadClientEvolutionInstance,
  getEvolutionAdminConfig,
  getLeadClientEvolutionInstances,
  resolveEvolutionInstanceOwner,
} from "../../services/evolution.js";
import { getLeadClientN8nSettings as getLeadClientN8nSettingsService } from "../../services/n8nSettings.js";

import {
  buildPhoneLookupVariants,
  sanitizePhone,
  normalizeHeaderKey,
  normalizeImportedLead as defaultNormalizeImportedLead,
  isImportedLeadEmpty as defaultIsImportedLeadEmpty,
  buildImportPreview as defaultBuildImportPreview,
} from "../../services/leadImport.js";
import { isManagerOrAdmin } from "../../access/claims.js";
import { randomUUID } from "crypto";
import { registerLeadMassDeleteRoutes } from "./massDeleteRoutes.js";
import { registerLeadOriginFixRoutes } from "./originFixRoutes.js";
import { resolveImportOrigin } from "../../services/importOrigin.js";
import { cancelFollowupCadenceOnStageChange } from "../../services/followupExitGuard.js";
import {
  classifyLeadMessages,
  reclassifyLeadFromMessages,
  getFunnelSettings,
  saveFunnelSettings,
  importClosedSalesBatch,
  DEFAULT_FUNNEL_VOCABULARY,
} from "./funnelService.js";

function sanitizePhoneE164(phoneInput, defaultDdd = null) {
  const s = sanitizePhone(phoneInput, defaultDdd);
  if (!s) return null;
  return s.startsWith("+") ? s : `+${s}`;
}

// Cache em memória de sessões de extração WA com TTL curto (5 minutos).
// Evita refazer findChats e findContacts (custosos) a cada lote paginado.
//
// NOTA DE ARQUITETURA MULTI-RÉPLICA / ESCALABILIDADE:
// Esta sessão vive exclusivamente na memória do processo Node.js atual.
// Hoje o backend opera com réplica única, garantindo integridade e latência zero.
// SE O BACKEND FOR ESCALADO HORIZONTALMENTE COM MÚLTIPLAS RÉPLICAS (ex: Kubernetes, múltiplos containers):
// Requisições subsequentes de lotes (cursor > 0) podem cair em processos diferentes e receber erro 410.
// Caso escale para mais de uma réplica, DEVE-SE adotar uma destas duas soluções:
// 1) Cache compartilhado distribuído (ex: Redis / Memcached com TTL de 5 minutos); OU
// 2) Afinidade de sessão no Load Balancer / Ingress (Sticky Sessions por IP / Cookie de sessão).
export const extractionSessions = new Map();
export const EXTRACTION_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutos

export function clearExtractionSessions() {
  extractionSessions.clear();
}

export function purgeExpiredExtractionSessions() {
  const now = Date.now();
  for (const [key, session] of extractionSessions.entries()) {
    if (now - session.lastAccessAt > EXTRACTION_SESSION_TTL_MS) {
      extractionSessions.delete(key);
    }
  }
}

function classifyChatContent(messages, contactName) {
  const result = classifyLeadMessages(messages);
  const fullText = (messages || []).join(" ").toLowerCase();
  const tagsSet = new Set();

  if (result.stage === "buyer") {
    tagsSet.add("Fechamento");
  } else if (result.stage === "open_budget") {
    tagsSet.add("Orçamento");
  } else if (result.stage === "inquiry") {
    tagsSet.add("Dúvida");
  } else if (result.stage === "lost") {
    tagsSet.add("Não Convertido");
  }

  if (/(óculos|oculos|lente|armação|armacao|solar)/i.test(fullText)) {
    tagsSet.add("Óculos de Sol");
  }
  if (/(prótese|protese|implante|dentário|dentario)/i.test(fullText)) {
    tagsSet.add("Prótese");
  }
  if (/(energia|solar|conta|luz|kw|kwh)/i.test(fullText)) {
    tagsSet.add("Energia Solar");
  }

  if (tagsSet.size === 0) {
    tagsSet.add("WhatsApp WA");
  }

  const summary = messages && messages.length > 0
    ? messages.slice(0, 3).join(" | ").slice(0, 300)
    : "Contato extraído via WhatsApp.";

  return {
    stage: result.stage,
    temperature: result.temperature,
    lost_reason: result.lost_reason,
    tags: Array.from(tagsSet),
    summary,
  };
}

// Membro de grupo classificado, pra decidir o que fazer com ele — nunca um
// telefone inventado. Na Evolution API moderna, cada participante de grupo traz:
// { id: "xxxx@lid", phoneNumber: "5511999999999@s.whatsapp.net", pushName: "Nome" }
// Avalia os campos em ordem de prioridade ([phoneNumber, phone, jid, user, id])
// buscando candidatos sem @lid com dígitos válidos (10 a 15 dígitos numéricos).
// Se nenhum candidato tiver telefone recuperável e algum contiver @lid, é perda irreversível (lid).
export function classifyGroupParticipantObject(participant, ownerDigits) {
  const p = typeof participant === "object" && participant !== null
    ? participant
    : (participant ? { id: String(participant), jid: String(participant) } : {});

  const candidates = [p?.phoneNumber, p?.phone, p?.jid, p?.user, p?.id];

  // 1. Procura entre os candidatos aquele que NÃO contém '@lid' e que possui dígitos válidos (10 a 15)
  for (const c of candidates) {
    if (c === null || c === undefined) continue;
    const cStr = String(c).trim();
    if (!cStr || cStr.includes("@lid")) continue;

    const raw = cStr.includes("@") ? cStr.split("@")[0] : cStr;
    const digits = raw.replace(/\D/g, "");

    if (digits.length >= 10 && digits.length <= 15) {
      if (ownerDigits && digits === ownerDigits) return { kind: "self" };
      const rawName = p?.pushName || p?.name || p?.notify || null;
      return { kind: "valid", digits, name: rawName ? String(rawName).trim() : null };
    }
  }

  // 2. Se nenhum candidato tiver telefone recuperável e algum candidato contiver '@lid'
  const hasLid = candidates.some((c) => {
    if (c === null || c === undefined) return false;
    return String(c).includes("@lid");
  });
  if (hasLid) return { kind: "lid" };

  // 3. Se não for nenhum dos dois, inválido
  return { kind: "invalid" };
}

export function classifyGroupParticipant(participantJid, ownerDigits) {
  return classifyGroupParticipantObject(participantJid, ownerDigits);
}

/**
 * Resolve o limite efetivo de extração de contatos (WhatsApp) no servidor.
 * - Plano Avançado (ou com módulo avulso 'extracao_ilimitada'): teto é Infinity.
 * - Demais planos (Essencial, Modular sem o módulo, etc.): teto é 500 contatos.
 * - O corpo da requisição só pode REDUZIR o limite, NUNCA aumentar além do teto do plano.
 * - Pedir "all", "unlimited" ou valor maior que o teto em plano não avançado resulta no teto do plano (500).
 */
export function resolveServerExtractionLimit({ planTier, modulosAvulsos = [], requestedLimit } = {}) {
  const tier = String(planTier || "").toLowerCase().trim();
  const rawModulos = Array.isArray(modulosAvulsos)
    ? modulosAvulsos
    : typeof modulosAvulsos === "string"
      ? modulosAvulsos.split(",")
      : [];
  const modulos = rawModulos.map((m) => String(m).toLowerCase().trim().replace(/^(mod_|modulo_)/, ""));

  const isAdvancedPlan =
    tier.includes("avancad") ||
    tier.includes("advanced") ||
    tier === "pro" ||
    modulos.includes("extracao_ilimitada");

  const planCeiling = isAdvancedPlan ? Infinity : 500;

  const isRequestedUnlimited =
    requestedLimit === "all" ||
    requestedLimit === "unlimited" ||
    requestedLimit === 0 ||
    requestedLimit === Infinity;

  let requestedValue = Infinity;
  if (!isRequestedUnlimited && requestedLimit !== undefined && requestedLimit !== null && requestedLimit !== "") {
    const parsed = parseInt(requestedLimit, 10);
    if (!isNaN(parsed) && parsed > 0) {
      requestedValue = parsed;
    }
  }

  // O valor que vem no corpo só pode reduzir, nunca aumentar
  return Math.min(planCeiling, requestedValue);
}

// Resolve a instância Evolution (id/nome explícito ou padrão do tenant),
// baseUrl, apiKey e o telefone do próprio chip (ownerDigits) — usado pelas
// três procedências de extração (conversas, agenda, grupos) e pela prévia
// de grupos. Extraído de dentro de POST /api/leads/extract-wa-contacts sem
// mudar nenhum comportamento: mesmas chamadas, mesma ordem, mesmos erros.
async function resolveEvolutionInstanceForExtraction({
  clientId,
  explicitInstanceId,
  explicitInstanceName,
  pgDatabasePool,
  res,
  sendError,
}) {
  let instance = null;
  const allInstances = await getLeadClientEvolutionInstances(clientId, pgDatabasePool);

  if (explicitInstanceId) {
    instance = allInstances.find((i) => i.id === explicitInstanceId) || null;
  } else if (explicitInstanceName) {
    instance = allInstances.find((i) => i.name === explicitInstanceName) || null;
  }

  if (!instance) {
    instance = await getDefaultLeadClientEvolutionInstance(clientId, pgDatabasePool);
  }

  if (!instance || !instance.dispatch_webhook_url) {
    sendError(res, 400, "EVOLUTION_NOT_CONFIGURED", "Nenhuma instância ativa do WhatsApp (Evolution API) configurada para este tenant.");
    return null;
  }

  const urlObj = new URL(instance.dispatch_webhook_url);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
  const parts = urlObj.pathname.split("/");
  const instanceName = explicitInstanceName || parts[parts.length - 1];

  if (!instanceName) {
    sendError(res, 400, "INVALID_INSTANCE", "Instância do WhatsApp inválida.");
    return null;
  }

  const apiKey = instance.dispatch_webhook_token || getEvolutionAdminConfig().apiKey;

  let ownerDigits = "";
  try {
    const instRes = await fetch(`${baseUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`, {
      headers: { apikey: apiKey },
    });
    if (instRes.ok) {
      const iData = await instRes.json();
      const iList = Array.isArray(iData) ? iData : [iData];
      const found = iList.find((i) => (i?.name || i?.instance?.instanceName) === instanceName) || iList[0];
      const owner = found?.ownerJid || found?.owner || found?.instance?.owner || "";
      ownerDigits = String(owner).split("@")[0].replace(/\D/g, "");
    }
  } catch (e) {
    console.warn("[wa-extract] não foi possível obter o número da instância:", e.message);
  }

  return { instance, baseUrl, instanceName, apiKey, ownerDigits };
}

// Fallback column auto-detection based on content and header aliases
function detectImportColumns(rows) {
  const mapping = {
    telefone: null,
    nome: null,
    tipo_cliente: null,
    faixa_consumo: null,
    cidade: null,
    estado: null,
    status: null,
    data_hora: null,
    qualificacao: null,
  };

  if (!Array.isArray(rows) || rows.length === 0) return mapping;

  const firstRow = rows[0];
  if (!firstRow || typeof firstRow !== "object") return mapping;

  const keys = Object.keys(firstRow);

  const aliasesMap = {
    telefone: ["telefone", "telefones", "fone", "fones", "celular", "celulares", "whatsapp", "whatsapps", "phone", "phones", "numero", "numeros", "numero_telefone", "numero_telefones", "telefone_whatsapp", "telefones_whatsapp"],
    nome: ["nome", "name", "cliente", "contato", "lead", "responsavel"],
    tipo_cliente: ["tipo_cliente", "tipo", "perfil", "segmento", "classificacao"],
    faixa_consumo: ["faixa_consumo", "consumo", "consumo_mensal", "valor_conta", "conta_de_energia", "ticket"],
    cidade: ["cidade", "city", "municipio"],
    estado: ["estado", "uf", "state"],
    status: ["status", "etapa", "situacao", "pipeline_status"],
    data_hora: ["data_hora", "data", "created_at", "data_de_cadastro", "timestamp"],
    qualificacao: ["qualificacao", "observacoes", "observacao", "resumo", "anotacoes", "notas", "descricao"],
  };

  // 1. Try mapping by alias matching first
  for (const key of keys) {
    const normalizedKey = key.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    for (const [field, aliases] of Object.entries(aliasesMap)) {
      if (!mapping[field] && aliases.includes(normalizedKey)) {
        mapping[field] = key;
      }
    }
  }

  // 2. Fallback scan by value content for phone and name
  const sampleRows = rows.slice(0, 10);

  if (!mapping.telefone) {
    for (const key of keys) {
      let matches = 0;
      let total = 0;
      for (const row of sampleRows) {
        const val = String(row[key] ?? "").trim().replace(/\D/g, "");
        if (val) {
          total++;
          if (val.length >= 8 && val.length <= 15) {
            matches++;
          }
        }
      }
      if (total > 0 && matches / total >= 0.7) {
        mapping.telefone = key;
        break;
      }
    }
  }

  if (!mapping.nome) {
    for (const key of keys) {
      if (key === mapping.telefone) continue;
      let matches = 0;
      let total = 0;
      for (const row of sampleRows) {
        const val = String(row[key] ?? "").trim();
        if (val) {
          total++;
          const digits = val.replace(/\D/g, "");
          if (digits.length < val.length * 0.5) {
            matches++;
          }
        }
      }
      if (total > 0 && matches / total >= 0.7) {
        mapping.nome = key;
        break;
      }
    }
  }

  // Last resort fallbacks if we still don't have phone/nome mapped
  const unmappedKeys = keys.filter(k => k !== mapping.telefone && k !== mapping.nome);
  if (!mapping.telefone && keys.length > 0) {
    mapping.telefone = keys[0];
  }
  if (!mapping.nome) {
    if (unmappedKeys.length > 0) {
      mapping.nome = unmappedKeys[0];
    } else if (keys.length > 1) {
      mapping.nome = keys[1] === mapping.telefone ? keys[0] : keys[1];
    }
  }

  return mapping;
}

export function registerLeadsRoutes(app, deps) {
  // Banco de Dados virou modulo vendavel avulso. As rotas EXCLUSIVAS da tela
  // (importacao, extracao do WhatsApp, exportacao, criacao e edicao em massa)
  // passam a exigir o modulo contratado. GET /api/leads fica de fora: e a mesma
  // rota que serve a tela Leads, que continua na base universal.
  const requireBancoDeDados = requireContractedModulePage("banco-de-dados");

  const {
    buildDispatchLeads,
    buildImportPreview: inputBuildImportPreview,
    ensureDb,
    ensureSharedRoutePageAccess,
    extractManagedAccessClaims,
    getLeadClientN8nSettingsMap,
    getN8nOnboardingStatus,
    getLeadClientN8nSettings,
    internalErrorPayloadDetails,
    isDuplicateKeyError,
    isImportedLeadEmpty: inputIsImportedLeadEmpty,
    isMissingSchemaError,
    leadsTableName,
    listAllFirebaseUsers,
    maskN8nSettings,
    normalizeImportedLead: inputNormalizeImportedLead,
    normalizeIsoDate,
    normalizeString,
    normalizeTenantKey,
    parseCsvToRows,
    pgDatabasePool,
    requireAppViewAccess,
    requireFirebaseAuth,
    requireInternalPageAccess,
    resolveAuthorizedClientId,
    sanitizePhone,
    sanitizePhoneLeadWebhookStyle,
    sendError,
    sendLeadWebhookEdgeStyle,
    supabase,
    upsertLeadClientN8nSettings,
    validateLeadWebhookBearer,
    validateN8nInboundBearer,
  } = deps;

  const normalizeImportedLead = inputNormalizeImportedLead || defaultNormalizeImportedLead;
  const isImportedLeadEmpty = inputIsImportedLeadEmpty || defaultIsImportedLeadEmpty;
  const buildImportPreview = inputBuildImportPreview || defaultBuildImportPreview;

  // Bootstrap idempotente da tabela lead_custom_fields e coluna column_mapping
  if (pgDatabasePool) {
    ensureLeadCustomFieldsTable(pgDatabasePool).catch((err) => {
      console.warn("[leads-routes] ensureLeadCustomFieldsTable failed:", err?.message || err);
    });
  }

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
      await ensureLeadsClientsTicketMedioColumn(pgDatabasePool);
      let query = supabase.from("leads_clients").select("id, name, ticket_medio, created_at");
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

      let data = [];
      try {
        const resQuery = await query;
        if (!resQuery.error && Array.isArray(resQuery.data)) {
          data = resQuery.data;
        }
      } catch (qErr) {
        console.warn("[lead-clients] Query failed, using fallback:", qErr);
      }

      if (!data.length) {
        data = [{ id: "geracao-digital", name: "Geração Digital", ticket_medio: null, created_at: new Date().toISOString() }];
      }

      const clientIds = (data || []).map((client) => client.id).filter(Boolean);
      let settingsMap = {};
      try {
        settingsMap = await getLeadClientN8nSettingsMap(clientIds);
      } catch (settingsError) {
        console.warn("[lead-clients] Failed to load N8N/Evolution settings; returning base clients only:", settingsError);
      }
      const items = (data || []).map((client) => {
        const settings = settingsMap[client.id] || null;
        return {
          ...client,
          ticket_medio: client.ticket_medio != null ? Number(client.ticket_medio) : null,
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

  app.get("/api/lead-clients/:tenantId", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedTenantId = normalizeTenantKey(req.params.tenantId);
    if (!requestedTenantId) {
      sendError(res, 400, "INVALID_TENANT_ID", "Tenant ID must use lowercase letters, numbers and hyphens");
      return;
    }

    const tenantId = resolveAuthorizedClientId(req, res, requestedTenantId);
    if (!tenantId) return;

    try {
      await ensureLeadsClientsTicketMedioColumn(pgDatabasePool);

      const { data: tenant, error: tenantError } = await supabase
        .from("leads_clients")
        .select("id, name, ticket_medio, created_at")
        .eq("id", tenantId)
        .maybeSingle();

      if (tenantError) throw tenantError;
      if (!tenant) {
        sendError(res, 404, "TENANT_NOT_FOUND", "Tenant not found");
        return;
      }

      res.json({
        item: {
          ...tenant,
          ticket_medio: tenant.ticket_medio != null ? Number(tenant.ticket_medio) : null,
        },
      });
    } catch (error) {
      console.error("lead client query error:", error);
      sendError(res, 500, "LEAD_CLIENT_QUERY_FAILED", "Failed to query tenant");
    }
  });

  app.patch("/api/lead-clients/:tenantId", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedTenantId = normalizeTenantKey(req.params.tenantId);
    if (!requestedTenantId) {
      sendError(res, 400, "INVALID_TENANT_ID", "Tenant ID must use lowercase letters, numbers and hyphens");
      return;
    }

    const tenantId = resolveAuthorizedClientId(req, res, requestedTenantId);
    if (!tenantId) return;

    // Escrita restrita a gestor/admin usando o isManagerOrAdmin unificado de access/claims.js
    if (!isManagerOrAdmin(req.authAccess)) {
      sendError(res, 403, "FORBIDDEN", "Apenas gestores ou administradores podem alterar as configurações da empresa");
      return;
    }

    try {
      await ensureLeadsClientsTicketMedioColumn(pgDatabasePool);

      const { data: tenant, error: tenantError } = await supabase
        .from("leads_clients")
        .select("id, name, ticket_medio")
        .eq("id", tenantId)
        .maybeSingle();

      if (tenantError) throw tenantError;
      if (!tenant) {
        sendError(res, 404, "TENANT_NOT_FOUND", "Tenant not found");
        return;
      }

      const updates = {};
      const hasTicketMedio =
        Object.prototype.hasOwnProperty.call(req.body || {}, "ticket_medio") ||
        Object.prototype.hasOwnProperty.call(req.body || {}, "ticketMedio");

      if (hasTicketMedio) {
        const rawVal = req.body.ticket_medio !== undefined ? req.body.ticket_medio : req.body.ticketMedio;
        if (rawVal === null || rawVal === "" || rawVal === undefined) {
          updates.ticket_medio = null;
        } else {
          const num = Number(rawVal);
          if (isNaN(num) || num < 0) {
            sendError(res, 400, "INVALID_TICKET_MEDIO", "Ticket médio deve ser um número positivo ou nulo");
            return;
          }
          updates.ticket_medio = num;
        }
      }

      if (Object.keys(updates).length === 0) {
        res.json({
          item: {
            ...tenant,
            ticket_medio: tenant.ticket_medio != null ? Number(tenant.ticket_medio) : null,
          },
        });
        return;
      }

      const { data: updated, error: updateError } = await supabase
        .from("leads_clients")
        .update(updates)
        .eq("id", tenantId)
        .select("id, name, ticket_medio, created_at")
        .single();

      if (updateError) throw updateError;

      res.json({
        item: {
          ...updated,
          ticket_medio: updated.ticket_medio != null ? Number(updated.ticket_medio) : null,
        },
      });
    } catch (error) {
      console.error("lead client patch error:", error);
      sendError(res, 500, "LEAD_CLIENT_UPDATE_FAILED", "Failed to update tenant");
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
      const settingsPayload = { ...(n8nSettings || {}), chatbotModel: schemaType, segmentationConfig: req.body?.segmentationConfig };
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

    // Apaga só as linhas deste tenant. NÃO dropar a tabela: `leadsTableName`
    // devolve "leads" para qualquer tenant desde que a tabela virou unificada
    // (migration 20260703000000), então o DROP que existia aqui apagava os leads
    // de TODOS os clientes e derrubava o índice único (client_id, telefone) —
    // que o boot recriava sem, fazendo a extração de contatos retornar 0 em
    // silêncio.
    const leadsTable = leadsTableName(tenantId);
    results.push(await deleteLeadClientRowsFromTable(leadsTable, tenantId));

    return results;
  }

  app.patch(
    "/api/lead-clients/:tenantId/segmentation-config",
    requireFirebaseAuth,
    requireInternalPageAccess("empresas"),
    async (req, res) => {
      if (!ensureDb(res)) return;

      if (!hasAccessPermission(req.authAccess, "tenants.manage")) {
        sendError(res, 403, "FORBIDDEN", "Tenant management permission required");
        return;
      }

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
          { segmentationConfig: req.body?.segmentationConfig },
          req.authAccess,
          existing
        );

        res.json({ item: maskN8nSettings(savedSettings) });
      } catch (error) {
        console.error("lead client segmentation config update error:", error);
        sendError(res, 500, "SEGMENTATION_CONFIG_SAVE_FAILED", "Failed to save segmentation config");
      }
    }
  );

  // Dry-run de segmentação: preview unificado (mesma lógica do disparo).
  // Front usa pra mostrar "X leads casam" antes de disparar — sem duplicar matcher.
  app.post(
    "/api/lead-clients/:tenantId/segmentation/preview",
    requireFirebaseAuth,
    requireInternalPageAccess("planilhas"),
    async (req, res) => {
      if (!ensureDb(res)) return;

      const tenantId = normalizeTenantKey(req.params?.tenantId);
      if (!tenantId) {
        sendError(res, 400, "INVALID_TENANT_ID", "Tenant ID must use lowercase letters, numbers and hyphens");
        return;
      }

      const filters = Array.isArray(req.body?.filters) ? req.body.filters : [];
      const importId = req.body?.importId ? String(req.body.importId) : null;

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

        // buildDispatchLeads já filtra por client_id e aplica o matcher unificado.
        const leads = await buildDispatchLeads({
          clientId: tenantId,
          importId,
          segmentation: { filters },
        });

        const sample = leads.slice(0, 10).map((lead) => ({
          telefone: lead.telefone,
          nome: lead.nome || null,
        }));

        res.json({ matchedCount: leads.length, sample });
      } catch (error) {
        console.error("segmentation preview error:", error);
        sendError(res, 500, "SEGMENTATION_PREVIEW_FAILED", "Failed to preview segmentation");
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

  async function checkLeadClientTableStatus(tenantId) {
    return checkDynamicLeadClientTableStatus(pgDatabasePool, tenantId);
  }

  async function ensureLeadClientTable(tenantId, schemaType) {
    return ensureDynamicLeadClientTable(pgDatabasePool, tenantId, schemaType);
  }

  app.get("/api/leads", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    // "leads" saiu de INTERNAL_PAGE_KEYS no refactor fc4f49e (modulo Leads
    // removido de proposito). Esta rota (GET /api/leads) e consumida por MAIS
    // de uma tela:
    //   BancoDeDados.tsx:444              -> pagina "banco-de-dados"
    //   CommercialIntelligenceContent.tsx -> rota inteligencia-comercial,
    //                                        gateada por "dashboard" no frontend
    //   useLeads.ts (hooks) usado por:
    //     WhatsAppInbox.tsx -> pagina "whatsapp"
    //     SegmentacaoCatalog.tsx (via Relacionamento.tsx, que redireciona para
    //       /crm/livpub?tab=relacionamento) -> pagina "livpub"
    //   (pages/Leads.tsx tambem importa useLeads, mas nao esta roteado em
    //   lugar nenhum — /crm/leads redireciona para banco-de-dados. Nao entra
    //   na lista: adicionar chave para consumidor morto so esconderia o
    //   proximo "cadeado que nao cadeia nada".)
    // Gatear so por uma dessas quebraria as outras tres — mesma familia do bug
    // que acabou de ser consertado, na ponta contraria (rota compartilhada,
    // N consumidores legitimos). hasInternalPageAccess e array-aware, entao
    // ensureSharedRoutePageAccess aceita a lista sem mudanca de assinatura.
    if (!ensureSharedRoutePageAccess(req, res, ["banco-de-dados", "dashboard", "whatsapp", "livpub"])) return;

    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    try {
      await ensureLeadIntelligenceColumns(pgDatabasePool);
    } catch (e) {
      console.warn("[leads-route] Column check warning:", e?.message || e);
    }

    const stage = normalizeString(req.query.stage);
    const temperature = normalizeString(req.query.temperature);
    const tag = normalizeString(req.query.tag);
    const search = normalizeString(req.query.search);
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit || "2000", 10)));

    const isInternalOperator =
      req.authAccess?.role === "internal" &&
      req.authAccess?.accessPreset === "operador";

    let targetAssignedTo = null;
    let operatorIdentifiers = null;

    if (isInternalOperator) {
      const uid = req.authAccess?.uid || req.authUser?.uid;
      const email = req.authAccess?.email || req.authUser?.email;
      operatorIdentifiers = [uid, email].filter(Boolean);
    } else if (req.authAccess?.role !== "client") {
      targetAssignedTo = normalizeString(req.query.assigned_to || req.query.assignedTo || req.query.userId);
    }

    try {
      let data = [];
      let totalCount = 0;

      // 1. Tentar query com filtros e colunas avançadas
      try {
        let query = supabase
          .from('leads')
          .select("*", { count: "exact" })
          .eq("client_id", clientId);

        if (operatorIdentifiers && operatorIdentifiers.length > 0) {
          const orClauses = operatorIdentifiers
            .map((id) => `assigned_to.eq.${id}`)
            .concat("assigned_to.is.null")
            .join(",");
          query = query.or(orClauses);
        } else if (targetAssignedTo) {
          query = query.eq("assigned_to", targetAssignedTo);
        }

        if (stage && stage !== "all") {
          query = query.eq("stage", stage);
        }

        if (temperature && temperature !== "all") {
          query = query.eq("temperature", temperature);
        }

        if (tag) {
          query = query.contains("tags", [tag]);
        }

        if (search) {
          query = query.or(`nome.ilike.%${search}%,telefone.ilike.%${search}%`);
        }

        query = query.order("created_at", { ascending: false });

        if (limit < 2000) {
          const from = (page - 1) * limit;
          const to = from + limit - 1;
          query = query.range(from, to);
        }

        const resQuery = await query;
        if (!resQuery.error && Array.isArray(resQuery.data)) {
          data = resQuery.data;
          totalCount = resQuery.count ?? data.length;
        } else if (resQuery.error) {
          throw resQuery.error;
        }
      } catch (advancedErr) {
        console.warn("[leads] Advanced query failed, using base query fallback:", advancedErr?.message || advancedErr);
        // Fallback para query básica garantida que nunca falha
        let fallbackQ = supabase
          .from('leads')
          .select("*")
          .eq("client_id", clientId);

        if (operatorIdentifiers && operatorIdentifiers.length > 0) {
          const orClauses = operatorIdentifiers
            .map((id) => `assigned_to.eq.${id}`)
            .concat("assigned_to.is.null")
            .join(",");
          fallbackQ = fallbackQ.or(orClauses);
        } else if (targetAssignedTo) {
          fallbackQ = fallbackQ.eq("assigned_to", targetAssignedTo);
        }

        fallbackQ = fallbackQ.order("created_at", { ascending: false }).limit(2000);
        const fallbackRes = await fallbackQ;

        data = fallbackRes.data || [];
        totalCount = data.length;
      }

      // 2. Calcular agregações para métricas da base do tenant (com fallback)
      let allItems = [];
      try {
        let allLeadsQ = supabase
          .from('leads')
          .select("*")
          .eq("client_id", clientId);

        if (operatorIdentifiers && operatorIdentifiers.length > 0) {
          const orClauses = operatorIdentifiers
            .map((id) => `assigned_to.eq.${id}`)
            .concat("assigned_to.is.null")
            .join(",");
          allLeadsQ = allLeadsQ.or(orClauses);
        } else if (targetAssignedTo) {
          allLeadsQ = allLeadsQ.eq("assigned_to", targetAssignedTo);
        }

        const { data: allLeadsData } = await allLeadsQ;
        allItems = allLeadsData || [];
      } catch {
        allItems = data || [];
      }

      const totalLeads = allItems.length;

      // 1. Fora das faixas primeiro: stage === 'buyer' e stage === 'lost'
      const buyersCount = allItems.filter((l) => l.stage === "buyer").length;
      const lostCount = allItems.filter((l) => l.stage === "lost").length;

      const nonExcluded = allItems.filter(
        (l) => l.stage !== "buyer" && l.stage !== "lost"
      );

      // 2. inNegotiationCount — stage === 'open_budget' ou status === 'orcamento'
      const inNegotiation = nonExcluded.filter(
        (l) => l.stage === "open_budget" || l.status === "orcamento"
      );
      const inNegotiationCount = inNegotiation.length;

      // 3. inConversationCount — do que sobrou, os que têm conversa comercial real (não nulo e não começa com 🚫)
      const afterNegotiation = nonExcluded.filter(
        (l) => !(l.stage === "open_budget" || l.status === "orcamento")
      );
      const inConversation = afterNegotiation.filter((l) => temConversaComercial(l));
      const inConversationCount = inConversation.length;

      // 4. neverContactedCount — todo o resto (sem histórico OU conversa pessoal 🚫). Cobre agenda, planilha e formulário
      const neverContacted = afterNegotiation.filter((l) => !temConversaComercial(l));
      const neverContactedCount = neverContacted.length;

      const activeLeadsCount = inNegotiationCount + inConversationCount + neverContactedCount;

      // Validação obrigatória: as três faixas + buyers + lost têm que somar totalLeads
      const checkSum =
        buyersCount + lostCount + inNegotiationCount + inConversationCount + neverContactedCount;
      if (checkSum !== totalLeads) {
        console.error(
          `[leads-summary] Desvio detectado no fechamento das faixas: totalLeads=${totalLeads} vs checkSum=${checkSum} (buyers=${buyersCount}, lost=${lostCount}, inNegotiation=${inNegotiationCount}, inConversation=${inConversationCount}, neverContacted=${neverContactedCount})`
        );
      }

      // estimatedRevenue soma apenas potential_contract_value reais sem fallback inventado
      const openBudgetsSum = inNegotiation.reduce(
        (sum, l) => sum + (Number(l.potential_contract_value) || 0),
        0
      );

      res.json({
        items: data || [],
        total: totalCount,
        page,
        limit,
        summary: {
          totalLeads,
          buyersCount,
          lostCount,
          openBudgetsCount: inNegotiationCount,
          inNegotiationCount,
          inConversationCount,
          neverContactedCount,
          activeLeadsCount,
          estimatedRevenue: openBudgetsSum,
        },
      });
    } catch (error) {
      console.error("leads query error:", error);
      res.json({
        items: [],
        total: 0,
        page: 1,
        limit: 2000,
        summary: {
          totalLeads: 0,
          buyersCount: 0,
          lostCount: 0,
          openBudgetsCount: 0,
          inNegotiationCount: 0,
          inConversationCount: 0,
          neverContactedCount: 0,
          activeLeadsCount: 0,
          estimatedRevenue: 0,
        },
      });
    }
  });

  // Extração automática de contatos e mensagens via WhatsApp (Evolution API)
  app.post("/api/leads/extract-wa-contacts", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.body?.clientId || req.query?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    // Resolução do plano do tenant no servidor (a trava fica no backend)
    const resolveSettingsFn = typeof getLeadClientN8nSettings === "function" ? getLeadClientN8nSettings : getLeadClientN8nSettingsService;
    let tenantSettings = null;
    if (typeof resolveSettingsFn === "function") {
      try {
        tenantSettings = await resolveSettingsFn(clientId);
      } catch (e) {
        console.warn(`[wa-extract] falha ao buscar n8n_settings para ${clientId}:`, e.message);
      }
    }

    if (!tenantSettings && pgDatabasePool) {
      try {
        const settingsRes = await pgDatabasePool.query(
          `SELECT plan_tier, modulos_avulsos FROM public.lead_client_n8n_settings WHERE client_id = $1 LIMIT 1`,
          [clientId]
        );
        if (settingsRes.rows && settingsRes.rows[0]) {
          tenantSettings = settingsRes.rows[0];
        }
      } catch (e) {
        console.warn(`[wa-extract] falha ao buscar n8n_settings via pool para ${clientId}:`, e.message);
      }
    }

    const rawLimit = req.body?.chatLimit ?? req.body?.limit;
    const chatLimit = resolveServerExtractionLimit({
      planTier: tenantSettings?.plan_tier,
      modulosAvulsos: tenantSettings?.modulos_avulsos,
      requestedLimit: rawLimit,
    });
    let remainingBudget = chatLimit;

    const explicitInstanceId = normalizeString(req.body?.instanceId);
    const explicitInstanceName = normalizeString(req.body?.instanceName);

    // sources omitido = comportamento de sempre (conversas + agenda), byte a
    // byte — chamada antiga não muda em nada. "grupos" é opt-in e só roda
    // com groupIds preenchido (a segunda etapa do fluxo de prévia).
    const rawSources = Array.isArray(req.body?.sources) ? req.body.sources.map((s) => String(s)) : null;
    const sources = new Set(rawSources && rawSources.length > 0 ? rawSources : ["conversas", "agenda"]);

    const sessionId = normalizeString(req.body?.sessionId);
    const chatCursor = Math.max(0, parseInt(req.body?.cursor ?? req.body?.chatOffset ?? req.body?.offset ?? 0, 10) || 0);
    const agendaCursor = Math.max(0, parseInt(req.body?.cursor ?? req.body?.agendaOffset ?? req.body?.offset ?? 0, 10) || 0);

    try {
      const resolved = await resolveEvolutionInstanceForExtraction({
        clientId,
        explicitInstanceId,
        explicitInstanceName,
        pgDatabasePool,
        res,
        sendError,
      });
      if (!resolved) return;
      const { instance, baseUrl, instanceName, apiKey, ownerDigits } = resolved;

      purgeExpiredExtractionSessions();
      const effectiveInstanceKey = normalizeString(instanceName || instance?.name || instance?.id) || "default";
      const sessionKey = sessionId ? `${clientId}:${effectiveInstanceKey}:${sessionId}` : null;
      let currentSession = sessionKey ? extractionSessions.get(sessionKey) : null;

      // Se o cursor for maior que zero mas a sessão não existir ou tiver expirado,
      // devolve erro claro (HTTP 410) pedindo para recomeçar, não resultado parcial silencioso.
      if (sources.has("conversas") && chatCursor > 0 && (!currentSession || !Array.isArray(currentSession.validChats))) {
        sendError(
          res,
          410,
          "WA_EXTRACTION_SESSION_EXPIRED",
          "Sessão de extração expirada ou não encontrada. Por favor, reinicie a extração."
        );
        return;
      }

      if (sources.has("agenda") && agendaCursor > 0 && (!currentSession || !Array.isArray(currentSession.addressBook))) {
        sendError(
          res,
          410,
          "WA_EXTRACTION_SESSION_EXPIRED",
          "Sessão de extração expirada ou não encontrada. Por favor, reinicie a extração."
        );
        return;
      }

      if (sessionKey && !currentSession) {
        currentSession = {
          createdAt: Date.now(),
          lastAccessAt: Date.now(),
          clientId,
          instanceName: effectiveInstanceKey,
        };
        extractionSessions.set(sessionKey, currentSession);
      }

      // Bloco 3: Resolve o operador responsável pelo chip de onde as conversas/contatos estão sendo extraídos
      let chipOwnerUid = instance?.owner_uid || null;
      if (!chipOwnerUid && instanceName) {
        chipOwnerUid = await resolveEvolutionInstanceOwner({
          clientId,
          instanceName: instance?.name || instanceName,
          pool: pgDatabasePool,
        });
      }

      // Telefone REAL: em contatos LID o remoteJid é "<lid>@lid" (não é telefone)
      // e o número verdadeiro fica em lastMessage.key.remoteJidAlt (@s.whatsapp.net).
      // O campo `id` é uma string aleatória (ex: cms81bq...) — nunca usar como fone.
      const realPhoneJid = (c) => {
        const alt = c?.lastMessage?.key?.remoteJidAlt || "";
        const rj = c?.remoteJid || "";
        if (alt.includes("@s.whatsapp.net")) return alt;
        if (rj.includes("@s.whatsapp.net")) return rj;
        return "";
      };

      let chats = [];
      let validChats = [];
      if (sources.has("conversas")) {
        if (currentSession && Array.isArray(currentSession.validChats)) {
          // Reutiliza a lista minerada e ordenada deterministicamente na sessão
          validChats = currentSession.validChats;
          chats = currentSession.rawChats || validChats;
        } else {
          // Evolution v2: findChats é POST (com body), não GET. GET dava HTTP 404.
          const chatsRes = await fetch(`${baseUrl}/chat/findChats/${encodeURIComponent(instanceName)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: apiKey },
            signal: AbortSignal.timeout(8000),
            body: JSON.stringify({}),
          });

          if (!chatsRes.ok) {
            const text = await chatsRes.text();
            sendError(res, 502, "WA_FETCH_CHATS_FAILED", `Erro ao buscar conversas no WhatsApp (HTTP ${chatsRes.status}): ${text.slice(0, 200)}`);
            return;
          }

          const rawChats = await chatsRes.json();
          // v2 pode devolver array direto ou paginado ({ records: [...] }).
          chats = Array.isArray(rawChats) ? rawChats : (rawChats?.records || rawChats?.chats || []);
          if (!Array.isArray(chats)) {
            sendError(res, 502, "WA_INVALID_RESPONSE", "Evolution API não retornou uma lista válida de conversas.");
            return;
          }

          validChats = chats.filter(c => {
            const jid = realPhoneJid(c);
            if (!jid || jid.includes("@g.us") || jid.includes("@broadcast") || jid.includes("-group")) return false;
            const digits = jid.split("@")[0].replace(/\D/g, "");
            // Descarta telefone vazio/curto ("0", "WhatsApp Business" etc.), grupos (15+ dígitos) e o
            // próprio número conectado (aparecia como lead com telefone zerado).
            if (!digits || digits.length < 10 || digits.length >= 15) return false;
            if (ownerDigits && digits === ownerDigits) return false;
            return true;
          });

          // Ordenação determinística antes de fatiar: a mesma conversa nunca pula ou repete
          validChats.sort((a, b) => {
            const idA = String(realPhoneJid(a) || a?.remoteJid || a?.id || "");
            const idB = String(realPhoneJid(b) || b?.remoteJid || b?.id || "");
            return idA.localeCompare(idB);
          });

          if (currentSession) {
            currentSession.validChats = validChats;
            currentSession.rawChats = chats;
            currentSession.lastAccessAt = Date.now();
          }
        }
      }

      // NOMES E AGENDA: busca apenas quando a requisição precisa de conversas ou agenda.
      // Requisição exclusiva de grupos ("grupos") NUNCA chama findContacts.
      const contactNames = new Map();
      const addressBook = [];

      if (sources.has("conversas") || sources.has("agenda")) {
        if (currentSession && currentSession.contactNames && Array.isArray(currentSession.addressBook)) {
          for (const [k, v] of currentSession.contactNames.entries()) {
            contactNames.set(k, v);
          }
          addressBook.push(...currentSession.addressBook);
        } else {
          try {
            const contactsRes = await fetch(`${baseUrl}/chat/findContacts/${encodeURIComponent(instanceName)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: apiKey },
              signal: AbortSignal.timeout(8000),
              body: JSON.stringify({}),
            });
            if (contactsRes.ok) {
              const cData = await contactsRes.json();
              const cList = Array.isArray(cData) ? cData : (cData?.records || cData?.contacts || []);
              for (const ct of cList) {
                const jid = String(ct?.remoteJid || ct?.id || "");
                const digits = jid.split("@")[0].replace(/\D/g, "");
                const nm = String(ct?.pushName || ct?.name || ct?.verifiedName || "").trim();
                if (digits && nm && nm.toLowerCase() !== "você" && nm.toLowerCase() !== "voce") {
                  contactNames.set(digits, nm);
                }
                if (jid.endsWith("@s.whatsapp.net") && digits.length >= 10 && digits.length < 15 && digits !== ownerDigits) {
                  addressBook.push({ digits, name: nm });
                }
              }
              // Ordenação determinística da agenda antes de fatiar
              addressBook.sort((a, b) => String(a.digits || "").localeCompare(String(b.digits || "")));
              console.info(`[wa-extract] findContacts: ${contactNames.size} nomes carregados`);
            }
          } catch (e) {
            console.warn("[wa-extract] findContacts indisponível:", e.message);
          }

          if (currentSession) {
            currentSession.contactNames = new Map(contactNames);
            currentSession.addressBook = [...addressBook];
            currentSession.lastAccessAt = Date.now();
          }
        }
      }

      const isRealName = (n) => {
        const s = String(n || "").trim();
        if (!s) return false;
        const low = s.toLowerCase();
        if (low === "você" || low === "voce") return false;
        return !/^\+?\d[\d\s\-()]*$/.test(s); // não é só número
      };

      const seenPhones = new Set();
      let extractedCount = 0;
      let insertErrors = 0;
      let buyers = 0;
      let openBudgets = 0;
      let coldLeads = 0;
      let hotLeads = 0;

      // ── 1. GRUPOS: primeira procedência (executa primeiro: ultra-rápido em lote) ──
      // Nunca lê nem grava mensagem de grupo — só a lista de membros (nome, telefone).
      let groupLeadCount = 0;
      let groupLidCount = 0;
      let groupsProcessed = 0;
      if (sources.has("grupos") && (!isFinite(remainingBudget) || remainingBudget > 0)) {
        const groupIds = Array.isArray(req.body?.groupIds) ? req.body.groupIds.map((g) => String(g)) : [];
        if (groupIds.length > 0) {
          try {
            let selectedGroups = [];
            // 1. Tenta buscar cada grupo especificamente via findGroupInfos (evita carregar participantes de todos os grupos da instância)
            for (const gid of groupIds) {
              try {
                const singleRes = await fetch(`${baseUrl}/group/findGroupInfos/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(gid)}`, {
                  headers: { apikey: apiKey },
                  signal: AbortSignal.timeout(8000),
                });
                if (singleRes.ok) {
                  const gData = await singleRes.json();
                  const groupObj = gData?.group || gData;
                  if (groupObj && (groupObj.id || groupObj.subject || groupObj.name || Array.isArray(groupObj.participants))) {
                    selectedGroups.push(groupObj);
                  }
                }
              } catch {
                // segue para fallback se findGroupInfos falhar
              }
            }

            // 2. Fallback: se nenhum grupo foi obtido via findGroupInfos (instâncias legadas ou mocks sem endpoint individual)
            if (selectedGroups.length === 0) {
              const groupsRes = await fetch(`${baseUrl}/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=true`, {
                headers: { apikey: apiKey },
                signal: AbortSignal.timeout(10000),
              });
              if (groupsRes.ok) {
                const groupsData = await groupsRes.json();
                const groupsList = Array.isArray(groupsData) ? groupsData : (groupsData?.records || groupsData?.groups || []);
                const idSet = new Set(groupIds);
                selectedGroups = (Array.isArray(groupsList) ? groupsList : []).filter((g) => idSet.has(String(g?.id || "")));
              } else {
                const text = await groupsRes.text();
                console.warn(`[wa-extract] fetchAllGroups falhou (HTTP ${groupsRes.status}): ${text.slice(0, 200)}`);
              }
            }

            if (selectedGroups.length > 0) {
              const batchLeads = [];
              for (const group of selectedGroups) {
                const groupName = normalizeString(group?.subject || group?.name) || "Grupo do WhatsApp";
                const participants = Array.isArray(group?.participants) ? group.participants : [];
                for (const p of participants) {
                  if (isFinite(remainingBudget) && batchLeads.length >= remainingBudget) {
                    break;
                  }
                  const classified = classifyGroupParticipantObject(p, ownerDigits);
                  if (classified.kind === "lid") {
                    groupLidCount++;
                    continue;
                  }
                  if (classified.kind !== "valid") continue;
                  const formatted = sanitizePhoneE164(classified.digits);
                  if (!formatted) continue;
                  const telefoneKey = formatted.replace(/^\+/, "");
                  if (seenPhones.has(telefoneKey)) continue;
                  const rawName = p?.pushName || p?.name || p?.notify || contactNames.get(classified.digits);
                  batchLeads.push({
                    telefone: telefoneKey,
                    phone: telefoneKey,
                    nome: isRealName(rawName) ? normalizeString(rawName) : formatted,
                    stage: "cold",
                    stage_source: "auto",
                    temperature: "cold",
                    tags: [groupName],
                    dados: {
                      origem: "WhatsApp Grupo",
                      lead_source_bruto: "WhatsApp Grupo",
                      origem_marketing: "extracao_whatsapp",
                      grupo_nome: groupName,
                    },
                  });
                  seenPhones.add(telefoneKey);
                }
                groupsProcessed++;
                if (isFinite(remainingBudget) && batchLeads.length >= remainingBudget) {
                  break;
                }
              }

              if (batchLeads.length > 0) {
                // upsertLeadsBatchByPhone deduplica por telefone DENTRO do lote
                const batchResult = await upsertLeadsBatchByPhone(pgDatabasePool, clientId, batchLeads);
                groupLeadCount = batchResult.totalCount;
                if (isFinite(remainingBudget)) {
                  remainingBudget = Math.max(0, remainingBudget - groupLeadCount);
                }
              }
              console.info(`[wa-extract] grupos: ${groupLeadCount} leads de ${groupsProcessed} grupo(s) selecionado(s), ${groupLidCount} participante(s) LID sem telefone recuperável`);
            }
          } catch (e) {
            console.warn("[wa-extract] erro ao extrair membros de grupo:", e.message);
          }
        }
      }

      // ── 2. AGENDA: segunda procedência (contatos salvos no chip com atribuição ao chipOwnerUid) ──
      let addressBookCount = 0;
      let paginationCursor = undefined;
      let paginationNextCursor = undefined;
      let paginationHasMore = false;
      let paginationTotalAvailable = undefined;

      if (sources.has("agenda") && (!isFinite(remainingBudget) || remainingBudget > 0)) {
        const allowedAgenda = isFinite(remainingBudget) ? addressBook.slice(0, remainingBudget) : addressBook;
        const agendaCursorProvided = req.body?.cursor !== undefined || req.body?.agendaOffset !== undefined || req.body?.offset !== undefined;
        const agendaCursor = Math.max(0, parseInt(req.body?.cursor ?? req.body?.agendaOffset ?? req.body?.offset ?? 0, 10) || 0);
        const defaultAgendaBatch = 50;
        const agendaBatchSize = Math.max(1, Math.min(parseInt(req.body?.batchSize ?? req.body?.limit ?? defaultAgendaBatch, 10) || defaultAgendaBatch, 100));

        let agendaToProcess;
        if (agendaCursorProvided || req.body?.batchSize !== undefined) {
          agendaToProcess = allowedAgenda.slice(agendaCursor, agendaCursor + agendaBatchSize);
          paginationCursor = agendaCursor;
          paginationNextCursor = agendaCursor + agendaToProcess.length;
          paginationHasMore = paginationNextCursor < allowedAgenda.length && (!isFinite(remainingBudget) || remainingBudget > 0);
          paginationTotalAvailable = allowedAgenda.length;
        } else {
          agendaToProcess = allowedAgenda;
          paginationCursor = 0;
          paginationNextCursor = allowedAgenda.length;
          paginationHasMore = false;
          paginationTotalAvailable = allowedAgenda.length;
        }

        for (const ct of agendaToProcess) {
          if (isFinite(remainingBudget) && addressBookCount >= remainingBudget) {
            break;
          }
          const formatted = sanitizePhoneE164(ct.digits);
          if (!formatted) continue;
          const telefoneKey = formatted.replace(/^\+/, "");
          if (seenPhones.has(telefoneKey)) continue;
          seenPhones.add(telefoneKey);
          try {
            await upsertLeadByPhone(pgDatabasePool, clientId, telefoneKey, {
              phone: telefoneKey,
              nome: isRealName(ct.name) ? normalizeString(ct.name) : formatted,
              stage: "cold",
              stage_source: "auto",
              temperature: "cold",
              tags: ["agenda-whatsapp"],
              extracted_from_wa: true,
              lead_source: "extracao_whatsapp",
              assigned_to: chipOwnerUid || null,
              dados: {
                origem: "WhatsApp Agenda",
                lead_source_bruto: "WhatsApp Agenda",
                origem_marketing: "extracao_whatsapp",
              },
            });
            addressBookCount++;
          } catch (insErr) {
            insertErrors++;
            if (insertErrors <= 3) console.warn(`[wa-extract] upsert agenda falhou p/ ${formatted}: ${insErr.message}`);
          }
        }
        if (isFinite(remainingBudget)) {
          remainingBudget = Math.max(0, remainingBudget - addressBookCount);
        }
        console.info(`[wa-extract] agenda: ${addressBookCount} contatos importados de ${addressBook.length} salvos (lote de ${agendaToProcess.length})`);
      }

      // ── 3. CONVERSAS: terceira procedência (classificação semântica ágil e IA sob demanda) ──
      let aiSummariesCount = 0;
      const allowedChats = isFinite(remainingBudget) ? validChats.slice(0, remainingBudget) : validChats;
      if (sources.has("conversas")) {
        console.info(`[wa-extract] client=${clientId} instancia=${instanceName} chats=${chats.length} validos=${validChats.length} permitidos=${allowedChats.length}`);
      }

      if (sources.has("conversas") && (!isFinite(remainingBudget) || remainingBudget > 0)) {
        const chatCursorProvided = req.body?.cursor !== undefined || req.body?.chatOffset !== undefined || req.body?.offset !== undefined;
        const chatCursor = Math.max(0, parseInt(req.body?.cursor ?? req.body?.chatOffset ?? req.body?.offset ?? 0, 10) || 0);
        const defaultChatBatch = 15;
        const chatBatchSize = Math.max(1, Math.min(parseInt(req.body?.batchSize ?? req.body?.limit ?? defaultChatBatch, 10) || defaultChatBatch, 50));

        let topChats;
        if (chatCursorProvided || req.body?.batchSize !== undefined) {
          topChats = allowedChats.slice(chatCursor, chatCursor + chatBatchSize);
          paginationCursor = chatCursor;
          paginationNextCursor = chatCursor + topChats.length;
          paginationHasMore = paginationNextCursor < allowedChats.length && (!isFinite(remainingBudget) || remainingBudget > 0);
          paginationTotalAvailable = allowedChats.length;
        } else {
          topChats = allowedChats;
          paginationCursor = 0;
          paginationNextCursor = allowedChats.length;
          paginationHasMore = false;
          paginationTotalAvailable = allowedChats.length;
        }

        for (const chat of topChats) {
          if (isFinite(remainingBudget) && extractedCount >= remainingBudget) {
            break;
          }
        const phoneJid = realPhoneJid(chat);
        const rawPhone = phoneJid.split("@")[0] || "";
        const formattedPhone = sanitizePhoneE164(rawPhone);
        if (!formattedPhone) continue;

        // Telefone sem "+" para deduplicar e vincular
        const telefoneKey = formattedPhone.replace(/^\+/, "");
        const digitsOnly = rawPhone.replace(/\D/g, "");
        const lastMsgName = chat?.lastMessage?.key?.fromMe === false ? chat?.lastMessage?.pushName : "";
        const candidates = [chat.pushName, contactNames.get(digitsOnly), lastMsgName, chat.name, chat.verifiedName];
        const name = normalizeString(candidates.find(isRealName) || formattedPhone);
        // findMessages usa o jid REAL da conversa (remoteJid, que pode ser @lid).
        const msgRemoteJid = chat.remoteJid || phoneJid;

        let messagesText = [];
        let lastInteractionAt = null;

        try {
          const msgsRes = await fetch(`${baseUrl}/chat/findMessages/${encodeURIComponent(instanceName)}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: apiKey
            },
            signal: AbortSignal.timeout(3500),
            body: JSON.stringify({
              where: { key: { remoteJid: msgRemoteJid } },
              limit: 15
            })
          });

          if (msgsRes.ok) {
            const msgsData = await msgsRes.json();
            // Evolution v2: findMessages devolve { messages: { records: [...] } }.
            const recordList = Array.isArray(msgsData)
              ? msgsData
              : Array.isArray(msgsData?.messages?.records)
                ? msgsData.messages.records
                : Array.isArray(msgsData?.records)
                  ? msgsData.records
                  : Array.isArray(msgsData?.messages)
                    ? msgsData.messages
                    : [];
            if (Array.isArray(recordList)) {
              for (const m of recordList) {
                const text = m.message?.conversation || m.message?.extendedTextMessage?.text || m.messageText || "";
                if (text) messagesText.push(text);
                if (m.messageTimestamp && !lastInteractionAt) {
                  lastInteractionAt = new Date(m.messageTimestamp * 1000).toISOString();
                }
              }
            }
          }
        } catch (msgErr) {
          console.warn(`[wa-extract] Erro ao buscar mensagens do chat ${msgRemoteJid}:`, msgErr.message);
        }

        const classification = classifyChatContent(messagesText, name);

        // IA Semântica: limitada a no máximo 5 conversas comerciais mais relevantes com
        // timeout estrito de 2500ms para evitar estourar cota Groq ou timeout da Vercel (60s).
        // Todas as demais conversas recebem classificação e resumo heurístico instantâneos.
        if (
          messagesText.length > 0 &&
          aiSummariesCount < 5 &&
          (classification.stage === "open_budget" || classification.temperature === "hot" || classification.stage === "inquiry")
        ) {
          try {
            const aiTimeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout IA")), 2500));
            const insight = await Promise.race([summarizeChatWithAI(messagesText, name), aiTimeoutPromise]);
            if (insight?.summary) {
              classification.summary = insight.summary;
              aiSummariesCount++;
              if (insight.prioridade === "alta" && !classification.tags.includes("Prioridade alta")) {
                classification.tags.push("Prioridade alta");
              }
              if (insight.canalSugerido === "followup" && !classification.tags.includes("Follow-up")) {
                classification.tags.push("Follow-up");
              }
              if (insight.canalSugerido === "campanha" && !classification.tags.includes("Campanha")) {
                classification.tags.push("Campanha");
              }
            }
          } catch { /* mantém o resumo heurístico do classifyChatContent */ }
        }

        if (classification.stage === 'buyer') buyers++;
        if (classification.stage === 'open_budget') openBudgets++;
        if (classification.stage === 'cold') coldLeads++;
        if (classification.temperature === 'hot') hotLeads++;

        // UPSERT via SQL cru
        try {
          // Bloco 3: herda dono do chip de onde a conversa foi extraída (ou busca da mensagem)
          let chatOwnerUid = chipOwnerUid;
          if (!chatOwnerUid) {
            try {
              const msgQuery = await pgDatabasePool.query(
                `SELECT instance_name FROM public.lead_messages 
                 WHERE client_id = $1 AND phone = $2 AND instance_name IS NOT NULL 
                 ORDER BY COALESCE(message_timestamp, delivered_at, created_at) DESC LIMIT 1`,
                [clientId, telefoneKey]
              );
              if (msgQuery.rows[0]?.instance_name) {
                chatOwnerUid = await resolveEvolutionInstanceOwner({
                  clientId,
                  instanceName: msgQuery.rows[0].instance_name,
                  pool: pgDatabasePool,
                });
              }
            } catch {}
          }

          await upsertLeadByPhone(pgDatabasePool, clientId, telefoneKey, {
            phone: telefoneKey,
            nome: name,
            stage: classification.stage,
            stage_source: "auto",
            temperature: classification.temperature,
            tags: Array.isArray(classification.tags) ? classification.tags : [],
            extracted_from_wa: true,
            lead_source: "extracao_whatsapp",
            assigned_to: chatOwnerUid || null,
            dados: {
              origem: "WhatsApp Extração",
              lead_source_bruto: "WhatsApp Extração",
              origem_marketing: "extracao_whatsapp",
            },
            raw_chat_summary: classification.summary,
            last_interaction_at: lastInteractionAt || new Date().toISOString(),
          });
          extractedCount++;
          seenPhones.add(telefoneKey);
        } catch (insErr) {
          insertErrors++;
          if (insertErrors <= 3) console.warn(`[wa-extract] upsert falhou p/ ${formattedPhone}: ${insErr.message}`);
        }
      }
    }

      if (currentSession) {
        currentSession.lastAccessAt = Date.now();
      }

      res.json({
        success: true,
        sessionId: sessionId || undefined,
        extractedCount: extractedCount + addressBookCount + groupLeadCount,
        fromChats: extractedCount,
        fromAddressBook: addressBookCount,
        fromGroups: groupLeadCount,
        groupParticipantsLid: groupLidCount,
        insertErrors,
        totalChatsFound: validChats.length,
        cursor: paginationCursor,
        nextCursor: paginationNextCursor,
        hasMore: paginationHasMore,
        totalAvailable: paginationTotalAvailable,
        summary: {
          buyers,
          openBudgets,
          coldLeads,
          hotLeads,
          estimatedRevenue: openBudgets * 2500
        }
      });
    } catch (err) {
      console.error("[wa-extract] Erro na extração:", err);
      sendError(res, 500, "WA_EXTRACT_FAILED", err.message || "Erro ao extrair contatos do WhatsApp");
    }
  });

  // Primeira etapa da extração de membros de grupo: só leitura, nada é
  // gravado. Por grupo, diz quanto dá pra aproveitar antes do usuário
  // decidir — perder metade de um grupo de 300 é decisão, não detalhe.
  app.post("/api/leads/extract-wa-groups/preview", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.body?.clientId || req.query?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const explicitInstanceId = normalizeString(req.body?.instanceId);
    const explicitInstanceName = normalizeString(req.body?.instanceName);

    try {
      const resolved = await resolveEvolutionInstanceForExtraction({
        clientId,
        explicitInstanceId,
        explicitInstanceName,
        pgDatabasePool,
        res,
        sendError,
      });
      if (!resolved) return;
      const { baseUrl, instanceName, apiKey, ownerDigits } = resolved;

      const groupsRes = await fetch(`${baseUrl}/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=true`, {
        headers: { apikey: apiKey },
      });

      if (!groupsRes.ok) {
        const text = await groupsRes.text();
        sendError(res, 502, "WA_FETCH_GROUPS_FAILED", `Erro ao buscar grupos no WhatsApp (HTTP ${groupsRes.status}): ${text.slice(0, 200)}`);
        return;
      }

      const groupsData = await groupsRes.json();
      const groupsList = Array.isArray(groupsData) ? groupsData : (groupsData?.records || groupsData?.groups || []);
      if (!Array.isArray(groupsList)) {
        sendError(res, 502, "WA_INVALID_RESPONSE", "Evolution API não retornou uma lista válida de grupos.");
        return;
      }

      const groups = groupsList.map((g) => {
        const participants = Array.isArray(g?.participants) ? g.participants : [];
        let usableCount = 0;
        let lidCount = 0;
        for (const p of participants) {
          const classified = classifyGroupParticipantObject(p, ownerDigits);
          if (classified.kind === "lid") lidCount++;
          else if (classified.kind === "valid") usableCount++;
          // "self" (o próprio chip) e "invalid" não entram em nenhum dos
          // dois — não são perda de telefone recuperável, só não contam.
        }
        return {
          id: String(g?.id || ""),
          name: normalizeString(g?.subject || g?.name) || "Grupo do WhatsApp",
          totalMembers: participants.length,
          usableCount,
          lidCount,
        };
      });

      res.json({ success: true, groups });
    } catch (err) {
      console.error("[wa-group-preview] Erro na prévia de grupos:", err);
      sendError(res, 500, "WA_GROUP_PREVIEW_FAILED", err.message || "Erro ao pré-visualizar grupos do WhatsApp");
    }
  });

  // Extração de contatos de exportação do Instagram — o arquivo NUNCA sobe
  // pro servidor. A leitura e o parse acontecem no navegador (mesmo padrão
  // do xlsx em BancoDeDados.tsx); esta rota só recebe o que já foi extraído
  // — nome, telefone (quando achado por regex) e resumo. Conversa de
  // terceiro não trafega e não é armazenada.
  //
  // Sem telefone: não é lead. Não inventa um (o caminho de import-csv:1727
  // faz isso com prefixo 5500 — proibido aqui de propósito, é dado que
  // parece real e não é). Vai pra contacts_without_channel, pra alguém pedir
  // o WhatsApp manualmente depois.
  app.post("/api/leads/import-instagram", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts : null;
    if (!contacts || contacts.length === 0) {
      sendError(res, 400, "INVALID_BODY", "Nenhum contato enviado para importação");
      return;
    }

    let leadsCreated = 0;
    let contactsWithoutChannelCreated = 0;
    let insertErrors = 0;

    for (const raw of contacts) {
      const name = normalizeString(raw?.name || raw?.nome);
      const perfil = normalizeString(raw?.perfil || raw?.profile || name);
      const resumo = typeof raw?.resumo === "string" ? raw.resumo.slice(0, 200) : null;
      if (!name || !perfil) continue;

      // Revalida no servidor com as MESMAS regras — nunca confia só no que
      // o navegador validou. O que não passa aqui também é descartado, não
      // corrigido: nenhum telefone é inventado neste caminho.
      const formattedPhone = sanitizePhoneE164(raw?.phone || raw?.telefone || "");

      if (formattedPhone) {
        const telefoneKey = formattedPhone.replace(/^\+/, "");
        try {
          await upsertLeadByPhone(pgDatabasePool, clientId, telefoneKey, {
            phone: telefoneKey,
            nome: name,
            stage: "cold",
            stage_source: "auto",
            // Coluna deliberada (lead_temperature, QUENTE/MORNO/FRIO — escrita
            // por escolha), não `temperature` (default 'warm', não significa
            // nada). A pessoa já conversou com a empresa: é morno de verdade.
            lead_temperature: "MORNO",
            extracted_from_wa: false,
            lead_source: "instagram_export",
            dados: {
              origem: "Instagram Direct",
              lead_source_bruto: "Instagram Direct",
              origem_marketing: "instagram_export",
            },
            raw_chat_summary: resumo,
          });
          leadsCreated++;
        } catch (insErr) {
          insertErrors++;
          if (insertErrors <= 3) console.warn(`[ig-import] upsert de lead falhou p/ ${perfil}: ${insErr.message}`);
        }
        continue;
      }

      try {
        await pgDatabasePool.query(
          `INSERT INTO public.contacts_without_channel (client_id, nome, perfil, resumo, origem)
           VALUES ($1, $2, $3, $4, 'Instagram Direct')
           ON CONFLICT (client_id, perfil)
           DO UPDATE SET nome = EXCLUDED.nome, resumo = EXCLUDED.resumo, updated_at = now()`,
          [clientId, name, perfil, resumo]
        );
        contactsWithoutChannelCreated++;
      } catch (insErr) {
        insertErrors++;
        if (insertErrors <= 3) console.warn(`[ig-import] upsert de contato sem canal falhou p/ ${perfil}: ${insErr.message}`);
      }
    }

    res.json({ success: true, leadsCreated, contactsWithoutChannelCreated, insertErrors });
  });

  // Lista de trabalho manual: contatos do Instagram sem telefone
  // recuperável. Nunca aparece em seletor de campanha/cadência, nunca entra
  // em contagem de leads — não é a tabela leads.
  app.get("/api/contacts-without-channel", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedClientId = normalizeString(req.query?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    try {
      const { rows } = await pgDatabasePool.query(
        `SELECT id, nome, perfil, resumo, origem, asked_whatsapp_at, became_lead_at, created_at
         FROM public.contacts_without_channel
         WHERE client_id = $1
         ORDER BY created_at DESC`,
        [clientId]
      );
      res.json({
        contacts: rows.map((r) => ({
          id: r.id,
          nome: r.nome,
          perfil: r.perfil,
          resumo: r.resumo,
          origem: r.origem,
          askedWhatsappAt: r.asked_whatsapp_at,
          becameLeadAt: r.became_lead_at,
          createdAt: r.created_at,
        })),
      });
    } catch (err) {
      console.error("[contacts-without-channel] Erro ao listar:", err);
      sendError(res, 500, "CONTACTS_WITHOUT_CHANNEL_LIST_FAILED", err.message || "Erro ao listar contatos sem canal");
    }
  });

  // Marca "pedi o WhatsApp" ou "virou lead", com data — toggle: marcar de
  // novo desmarca.
  app.patch("/api/contacts-without-channel/:id", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const id = normalizeString(req.params?.id);
    const field = req.body?.field;
    const value = req.body?.value !== false;
    if (!id || (field !== "asked_whatsapp" && field !== "became_lead")) {
      sendError(res, 400, "INVALID_BODY", "Campo inválido — use asked_whatsapp ou became_lead");
      return;
    }

    const column = field === "asked_whatsapp" ? "asked_whatsapp_at" : "became_lead_at";
    try {
      const { rowCount } = await pgDatabasePool.query(
        `UPDATE public.contacts_without_channel
         SET ${column} = $1, updated_at = now()
         WHERE id = $2 AND client_id = $3`,
        [value ? new Date().toISOString() : null, id, clientId]
      );
      if (rowCount === 0) {
        sendError(res, 404, "NOT_FOUND", "Contato não encontrado");
        return;
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[contacts-without-channel] Erro ao atualizar:", err);
      sendError(res, 500, "CONTACTS_WITHOUT_CHANNEL_UPDATE_FAILED", err.message || "Erro ao atualizar contato");
    }
  });

  // Importação simplificada via CSV / Excel com Suporte a Tags de Origem
  app.post("/api/leads/import-csv", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const defaultDdd = normalizeString(req.body?.defaultDdd);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) {
      sendError(res, 400, "INVALID_BODY", "Nenhuma linha enviada para importação");
      return;
    }

    // Identificador desta importação, gravado em dados.import_ids de cada lead. A tag continua sendo o
    // vínculo para o que já existe, mas tag é editável e apagável pelo usuário: exclusão em massa não
    // pode depender dela para sempre.
    const importId = randomUUID();

    const rawImportTags = req.body?.importTags || req.body?.tags || [];
    const importTagsArray = Array.isArray(rawImportTags)
      ? rawImportTags.map((t) => String(t).trim()).filter(Boolean)
      : typeof rawImportTags === "string"
      ? rawImportTags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    const rawMapping = req.body?.columnMapping || req.body?.mapping || null;
    const mappingItems = Array.isArray(rawMapping)
      ? rawMapping
      : Array.isArray(rawMapping?.mapping)
      ? rawMapping.mapping
      : null;

    if (mappingItems) {
      const phoneMapping = mappingItems.find((m) => m && m.target === "telefone");
      if (!phoneMapping) {
        sendError(res, 400, "INVALID_MAPPING", "Nenhuma coluna mapeada para telefone. O telefone é obrigatório para importar.");
        return;
      }
      // Registra novos campos customizados no cliente (lead_custom_fields)
      const customItems = mappingItems.filter((m) => m && m.target === "custom");
      if (customItems.length > 0) {
        for (const item of customItems) {
          const key = item.key || normalizeHeaderKey(item.label || item.column);
          const label = item.label || item.column;
          const detectedType = item.type || "text";
          if (!key) continue;

          const { data: existingField } = await supabase
            .from("lead_custom_fields")
            .select("id, client_id, key, label, type")
            .eq("client_id", clientId)
            .eq("key", key)
            .maybeSingle();

          if (!existingField) {
            await supabase.from("lead_custom_fields").insert({
              client_id: clientId,
              key,
              label,
              type: detectedType,
              import_id: null,
            });
          }
        }
      }
    }

    try {
      let importedCount = 0;
      let skippedNoPhoneCount = 0;
      const parsedLeads = [];
      const phoneMapping = mappingItems?.find((m) => m && m.target === "telefone");

      for (const row of rows) {
        let formattedPhone = null;
        let name = null;
        let rawPhone = "";
        let customCampos = {};

        if (mappingItems) {
          const normalized = defaultNormalizeImportedLead(
            row,
            clientId,
            defaultDdd,
            mappingItems
          );
          if (normalized.telefone) {
            formattedPhone = normalized.telefone.startsWith("+")
              ? normalized.telefone
              : `+${normalized.telefone}`;
          }
          name = normalized.nome;
          rawPhone = normalized.dados?.telefone_bruto || (phoneMapping ? row[phoneMapping.column] : "") || "";
          customCampos = normalized.dados?.campos || {};
        } else {
          rawPhone = row.telefone || row.phone || row.celular || row.whatsapp || row.numero || "";
          formattedPhone = sanitizePhoneE164(rawPhone, defaultDdd);
          name = normalizeString(row.nome || row.name || row.cliente || row.contato || formattedPhone || "Lead Social");
          if (row.dados && typeof row.dados.campos === "object" && row.dados.campos) {
            customCampos = { ...row.dados.campos };
          }
        }

        if (!formattedPhone || formattedPhone.replace(/^\+/, "").startsWith("5500")) {
          // Sem telefone válido: não inventa número sintético 5500.
          // Linha é pulada no cadastro de WhatsApp da planilha.
          skippedNoPhoneCount++;
          continue;
        }

        const isClosedSales = Boolean(req.body?.asClosedSales || req.body?.isClosedSales);
        const stageInput = normalizeString(row.stage || row.estagio || row.etapa)?.toLowerCase();
        const validStage = isClosedSales
          ? "buyer"
          : (['buyer', 'open_budget', 'inquiry', 'cold', 'lost'].includes(stageInput) ? stageInput : 'cold');
        
        const tempInput = normalizeString(row.temperature || row.temperatura)?.toLowerCase();
        const validTemp = isClosedSales
          ? "hot"
          : (['hot', 'warm', 'cold'].includes(tempInput) ? tempInput : 'warm');

        const rowTags = row.tags || row.tag || [];
        const parsedRowTags = Array.isArray(rowTags)
          ? rowTags.map((t) => String(t).trim())
          : typeof rowTags === "string"
          ? rowTags.split(",").map((t) => t.trim()).filter(Boolean)
          : [];

        const closedSalesTags = isClosedSales ? ["Venda Fechada", "Cliente Histórico"] : [];
        // Origem: canal informado (tag da importação ou da linha, coluna de origem), vendas fechadas, ou —
        // se ninguém informou nada — a própria importação. Nunca um canal inventado.
        const resolvedOrigin = resolveImportOrigin({
          importTags: importTagsArray,
          rowTags: parsedRowTags,
          rowOrigem: row.origem,
          isClosedSales,
        });
        const originTag = resolvedOrigin.originTag;

        const combinedTags = Array.from(
          new Set([...parsedRowTags, ...importTagsArray, ...closedSalesTags, ...(originTag ? [originTag] : [])])
        );

        const valorVenda = Number(row.valor_venda || row.valor || row.valor_total) || null;

        const dadosPayload = {
          import_ids: [importId],
          origem: resolvedOrigin.origem,
          origem_marketing: resolvedOrigin.origemMarketing,
          lead_source: resolvedOrigin.leadSource,
          resumo_chat: row.interesse || row.resumo_chat || (isClosedSales ? "Cliente histórico importado como venda fechada" : "Interação no Direct"),
          telefone_bruto: rawPhone ? String(rawPhone).trim() : null,
          valor_venda: valorVenda || undefined,
          data_fechamento: row.data_fechamento || undefined,
          produto_comprado: row.produto_comprado || undefined,
        };

        if (Object.keys(customCampos).length > 0) {
          dadosPayload.campos = customCampos;
        }

        parsedLeads.push({
          client_id: clientId,
          telefone: formattedPhone,
          phone: formattedPhone,
          nome: name,
          stage: validStage,
          stage_source: isClosedSales ? "manual" : undefined,
          temperature: validTemp,
          potential_contract_value: valorVenda || undefined,
          tags: combinedTags,
          dados: dadosPayload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      if (parsedLeads.length > 0) {
        try {
          const { insertedCount, updatedCount, totalCount } = await upsertLeadsBatchByPhone(
            pgDatabasePool,
            clientId,
            parsedLeads
          );
          importedCount = totalCount;
        } catch (dbErr) {
          console.error("[leads-import-csv] Erro no upsertLeadsBatchByPhone:", dbErr);
          throw dbErr;
        }
      }

      res.json({
        success: true,
        importId,
        importedCount,
        skippedNoPhoneCount,
        totalRows: rows.length,
      });
    } catch (err) {
      console.error("[leads-csv-import] Erro ao importar CSV:", err);
      sendError(res, 500, "CSV_IMPORT_FAILED", err.message || "Falha ao importar planilha");
    }
  });

  // Importação direta de Vendas Fechadas e Clientes Históricos (Bloco 4A)
  app.post("/api/leads/import-closed-sales", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) {
      sendError(res, 400, "INVALID_BODY", "Nenhum cliente enviado para importação");
      return;
    }

    try {
      const result = await importClosedSalesBatch(pgDatabasePool, clientId, rows);
      res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      console.error("[import-closed-sales] Erro ao importar vendas fechadas:", err);
      sendError(res, 500, "IMPORT_CLOSED_SALES_FAILED", err.message || "Falha ao importar vendas fechadas");
    }
  });

  // Configurações de Vocabulário do Funil por Tenant (Bloco 3)
  app.get("/api/leads/funnel-settings", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedClientId = normalizeString(req.query?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    try {
      const { vocabulary } = await getFunnelSettings(pgDatabasePool, clientId);
      res.json({
        success: true,
        vocabulary,
      });
    } catch (err) {
      console.error("[get-funnel-settings] Erro ao buscar configurações do funil:", err);
      sendError(res, 500, "FUNNEL_SETTINGS_ERROR", err.message || "Erro ao carregar configurações do funil");
    }
  });

  const saveFunnelSettingsHandler = async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const vocabulary = req.body?.vocabulary;
    if (!vocabulary || typeof vocabulary !== "object") {
      sendError(res, 400, "INVALID_BODY", "Vocabulário do funil inválido");
      return;
    }

    try {
      const { vocabulary: updated } = await saveFunnelSettings(pgDatabasePool, clientId, vocabulary);
      res.json({
        success: true,
        vocabulary: updated,
      });
    } catch (err) {
      console.error("[save-funnel-settings] Erro ao salvar configurações do funil:", err);
      sendError(res, 500, "SAVE_FUNNEL_SETTINGS_ERROR", err.message || "Erro ao salvar configurações do funil");
    }
  };

  if (typeof app.put === "function") {
    app.put("/api/leads/funnel-settings", requireFirebaseAuth, requireBancoDeDados, saveFunnelSettingsHandler);
  }
  if (typeof app.post === "function") {
    app.post("/api/leads/funnel-settings", requireFirebaseAuth, requireBancoDeDados, saveFunnelSettingsHandler);
  }

  // Sugestão de avanço de estágio assistida por IA/Heurística no WhatsApp Inbox (Bloco 4B)
  app.get("/api/leads/:id/stage-suggestion", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;

    const { id } = req.params;
    const requestedClientId = normalizeString(req.query?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    try {
      const { rows: leadRows } = await pgDatabasePool.query(
        `SELECT id, stage, stage_source, phone, telefone FROM public.leads WHERE id = $1 AND client_id = $2`,
        [id, clientId]
      );
      if (leadRows.length === 0) {
        sendError(res, 404, "LEAD_NOT_FOUND", "Lead não encontrado");
        return;
      }
      const lead = leadRows[0];
      const leadPhone = lead.phone || lead.telefone;

      const { rows: messageRows } = await pgDatabasePool.query(
        `SELECT message_text, direction, created_at 
         FROM public.lead_messages 
         WHERE client_id = $1 AND (lead_id = $2 OR (phone = $3 AND phone IS NOT NULL))
         ORDER BY COALESCE(message_timestamp, delivered_at, created_at) DESC 
         LIMIT 10`,
        [clientId, lead.id, leadPhone]
      );

      if (messageRows.length === 0) {
        res.json({ success: true, hasSuggestion: false });
        return;
      }

      const messages = messageRows.reverse().map((m) => m.message_text);
      const classification = classifyLeadMessages(messages);

      if (
        classification.stage &&
        classification.stage !== "cold" &&
        classification.stage !== lead.stage
      ) {
        res.json({
          success: true,
          hasSuggestion: true,
          suggestion: {
            currentStage: lead.stage,
            suggestedStage: classification.stage,
            reason: classification.reason,
            matchedTerm: classification.matchedTerm,
            lostReason: classification.lost_reason,
          },
        });
        return;
      }

      res.json({ success: true, hasSuggestion: false });
    } catch (err) {
      console.error("[stage-suggestion] Erro ao analisar sugestão:", err);
      sendError(res, 500, "SUGGESTION_ERROR", err.message || "Erro ao analisar sugestão");
    }
  });

  // Reclassificação de estágio de um lead a partir de mensagens com trava manual (Bloco 2)
  app.post("/api/leads/:id/reclassify", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;

    const { id } = req.params;
    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    try {
      const result = await reclassifyLeadFromMessages({
        pool: pgDatabasePool,
        clientId,
        leadId: id,
        messages,
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      console.error("[reclassify] Erro ao reclassificar lead:", err);
      sendError(res, 500, "RECLASSIFY_ERROR", err.message || "Erro ao reclassificar lead");
    }
  });

  // Confirmação de acordo comercial sugerido pela IA (Trava Humana no Inbox)
  app.post("/api/leads/:id/confirm-agreement", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;

    const { id } = req.params;
    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const confirmedBy = normalizeString(req.body?.confirmedBy || req.user?.name || req.user?.email || "consultor");

    try {
      const table = leadsTableName(clientId);
      const { rows } = await pgDatabasePool.query(
        `SELECT id, dados FROM public."${table}" WHERE id = $1 AND client_id = $2 LIMIT 1`,
        [id, clientId]
      );
      if (!rows.length) {
        return sendError(res, 404, "LEAD_NOT_FOUND", "Lead não encontrado.");
      }

      const updatedDados = confirmLeadAgreement(rows[0].dados || {}, {
        confirmedBy,
        confirmedAt: new Date().toISOString(),
      });

      await pgDatabasePool.query(
        `UPDATE public."${table}" SET dados = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3`,
        [JSON.stringify(updatedDados), id, clientId]
      );

      res.json({
        success: true,
        acordo: updatedDados.acordo,
      });
    } catch (err) {
      console.error("[confirm-agreement] Erro ao confirmar acordo:", err);
      sendError(res, 500, "CONFIRM_AGREEMENT_ERROR", err.message || "Erro ao confirmar acordo.");
    }
  });

  // Exportação filtrada para CSV
  app.get("/api/leads/export", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const stage = normalizeString(req.query.stage);
    const temperature = normalizeString(req.query.temperature);

    try {
      let query = supabase
        .from("leads")
        .select("nome, telefone, stage, temperature, tags, raw_chat_summary, created_at, last_interaction_at, dados")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });

      if (stage && stage !== "all") {
        query = query.eq("stage", stage);
      }
      if (temperature && temperature !== "all") {
        query = query.eq("temperature", temperature);
      }

      const { data, error } = await query.limit(5000);
      if (error) throw error;

      const leads = data || [];

      // Coleta dinâmica de todas as chaves customizadas dos leads
      const allCustomKeys = new Set();
      leads.forEach(l => {
        const campos = l.dados && typeof l.dados === "object" ? l.dados.campos : null;
        if (campos && typeof campos === "object") {
          Object.keys(campos).forEach(k => allCustomKeys.add(k));
        }
      });
      const customKeyList = Array.from(allCustomKeys).sort();

      const baseHeaders = ["Nome", "Telefone", "Estágio", "Temperatura", "Tags", "Última Interação", "Resumo Chat"];
      const allHeaders = [...baseHeaders, ...customKeyList];
      const csvHeader = allHeaders.map(h => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";

      const csvRows = leads.map(l => {
        const nome = `"${(l.nome || '').replace(/"/g, '""')}"`;
        const fone = `"${(l.telefone || '').replace(/"/g, '""')}"`;
        const stg = `"${l.stage || 'cold'}"`;
        const tmp = `"${l.temperature || 'warm'}"`;
        const tgs = `"${(Array.isArray(l.tags) ? l.tags.join("; ") : '').replace(/"/g, '""')}"`;
        const last = `"${l.last_interaction_at ? new Date(l.last_interaction_at).toLocaleString('pt-BR') : ''}"`;
        const sum = `"${(l.raw_chat_summary || '').replace(/"/g, '""')}"`;
        const baseCols = [nome, fone, stg, tmp, tgs, last, sum];

        const campos = (l.dados && typeof l.dados === "object" && l.dados.campos) || {};
        const customCols = customKeyList.map(k => {
          const val = campos[k];
          const strVal = val !== undefined && val !== null ? String(val) : "";
          return `"${strVal.replace(/"/g, '""')}"`;
        });

        return [...baseCols, ...customCols].join(",");
      }).join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="leads_export_${clientId}_${Date.now()}.csv"`);
      res.status(200).send("\uFEFF" + csvHeader + csvRows);
    } catch (err) {
      console.error("[leads-export] Erro ao exportar leads:", err);
      sendError(res, 500, "EXPORT_FAILED", "Falha ao exportar base de leads");
    }
  });

  // Criar lead manual
  app.post("/api/leads/create", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const rawPhone = req.body?.telefone || req.body?.phone;
    const phone = sanitizePhoneE164(rawPhone);
    if (!phone) {
      sendError(res, 400, "INVALID_PHONE", "Telefone inválido ou ausente.");
      return;
    }

    try {
      const rawAssignedTo = req.body?.assigned_to !== undefined ? req.body.assigned_to : req.body?.assignedTo;
      let assignedToVal = undefined;
      if (rawAssignedTo !== undefined) {
        if (!isManagerOrAdmin(req.authAccess)) {
          sendError(res, 403, "FORBIDDEN", "Apenas gestores ou administradores podem definir o operador responsável");
          return;
        }
        assignedToVal = rawAssignedTo ? String(rawAssignedTo).trim() : null;
      }

      const payload = {
        client_id: clientId,
        telefone: phone,
        phone: phone,
        nome: normalizeString(req.body?.nome || req.body?.name || phone),
        stage: normalizeString(req.body?.stage) || 'cold',
        temperature: normalizeString(req.body?.temperature) || 'warm',
        tags: Array.isArray(req.body?.tags) ? req.body.tags : [],
        assigned_to: assignedToVal,
        assigned_at: assignedToVal ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await upsertLeadByPhone(pgDatabasePool, clientId, phone, {
        phone,
        nome: payload.nome,
        stage: payload.stage,
        temperature: payload.temperature,
        tags: payload.tags,
        assigned_to: assignedToVal,
        assigned_at: payload.assigned_at,
      });

      const variants = buildPhoneLookupVariants(phone);
      const orFilter = variants.map((v) => `telefone.eq.${v},phone.eq.${v}`).join(",");
      const { data: item } = await supabase
        .from("leads")
        .select("*")
        .eq("client_id", clientId)
        .or(orFilter || `telefone.eq.${phone},phone.eq.${phone}`)
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      res.status(201).json({ item: item || { ...payload, client_id: clientId } });
    } catch (err) {
      sendError(res, 500, "LEAD_CREATE_FAILED", err.message || "Erro ao criar lead");
    }
  });

  // Atualizar lead
  app.patch("/api/leads/:id", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const { id } = req.params;
    if (!id) return sendError(res, 400, "MISSING_ID", "ID do lead ausente");

    try {
      let tagsArray = undefined;
      if (req.body.tags !== undefined) {
        tagsArray = Array.isArray(req.body.tags)
          ? req.body.tags.map((t) => String(t).trim()).filter(Boolean)
          : typeof req.body.tags === "string"
          ? req.body.tags.split(",").map((t) => t.trim()).filter(Boolean)
          : [];
      }

      const updates = {};
      if (req.body.stage !== undefined) {
        updates.stage = req.body.stage;
        updates.stage_source = req.body.stage_source || "manual";
        if (req.body.stage !== "lost" && req.body.lost_reason === undefined) {
          updates.lost_reason = null;
        }
      } else if (req.body.stage_source !== undefined) {
        updates.stage_source = req.body.stage_source;
      }
      if (req.body.lost_reason !== undefined) {
        updates.lost_reason = req.body.lost_reason ? String(req.body.lost_reason).trim() : null;
      }
      if (req.body.potential_contract_value !== undefined) {
        updates.potential_contract_value = req.body.potential_contract_value !== null && req.body.potential_contract_value !== ""
          ? Number(req.body.potential_contract_value)
          : null;
      }
      if (req.body.temperature !== undefined) updates.temperature = req.body.temperature;
      if (req.body.nome !== undefined) updates.nome = req.body.nome;
      if (req.body.assigned_to !== undefined || req.body.assignedTo !== undefined) {
        if (!isManagerOrAdmin(req.authAccess)) {
          sendError(res, 403, "FORBIDDEN", "Apenas gestores ou administradores podem reatribuir leads");
          return;
        }
        const val = req.body.assigned_to !== undefined ? req.body.assigned_to : req.body.assignedTo;
        updates.assigned_to = val ? String(val).trim() : null;
        updates.assigned_at = val ? new Date().toISOString() : null;
      }
      updates.updated_at = new Date().toISOString();

      if (tagsArray !== undefined && pgDatabasePool) {
        await pgDatabasePool.query(
          `UPDATE public.leads SET tags = $1, updated_at = now() WHERE id = $2`,
          [tagsArray, id]
        );
      }

      const { data, error } = await supabase
        .from("leads")
        .update(updates)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;

      if (updates.stage && data?.telefone && data?.client_id && pgDatabasePool) {
        cancelFollowupCadenceOnStageChange({
          clientId: data.client_id,
          phone: data.telefone,
          newStage: updates.stage,
          queryFn: pgDatabasePool.query.bind(pgDatabasePool),
        }).catch((err) => {
          console.error("[leads/patch] erro ao cancelar cadência on stage change:", err?.message || err);
        });
      }

      res.json({ item: data });
    } catch (err) {
      sendError(res, 500, "LEAD_UPDATE_FAILED", err.message || "Erro ao atualizar lead");
    }
  });

  // Excluir lead
  app.delete("/api/leads/:id", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const { id } = req.params;
    if (!id) return sendError(res, 400, "MISSING_ID", "ID do lead ausente");

    try {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) throw error;
      res.json({ success: true, deletedId: id });
    } catch (err) {
      sendError(res, 500, "LEAD_DELETE_FAILED", err.message || "Erro ao deletar lead");
    }
  });

  // Atualização em lote de leads
  app.post("/api/leads/bulk-update", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
    if (leadIds.length === 0) {
      sendError(res, 400, "INVALID_BODY", "Nenhum lead selecionado.");
      return;
    }

    const { stage, stage_source, lost_reason, potential_contract_value, temperature, addTag, assigned_to, assignedTo } = req.body?.updates || {};
    const targetAssignedTo = assigned_to !== undefined ? assigned_to : assignedTo;
    if (targetAssignedTo !== undefined) {
      if (!isManagerOrAdmin(req.authAccess)) {
        sendError(res, 403, "FORBIDDEN", "Apenas gestores ou administradores podem reatribuir leads");
        return;
      }
    }

    try {
      const updates = { updated_at: new Date().toISOString() };
      if (stage) {
        updates.stage = stage;
        updates.stage_source = stage_source || "manual";
        if (stage !== "lost" && lost_reason === undefined) {
          updates.lost_reason = null;
        }
      } else if (stage_source !== undefined) {
        updates.stage_source = stage_source;
      }
      if (lost_reason !== undefined) {
        updates.lost_reason = lost_reason ? String(lost_reason).trim() : null;
      }
      if (potential_contract_value !== undefined) {
        updates.potential_contract_value = potential_contract_value !== null && potential_contract_value !== ""
          ? Number(potential_contract_value)
          : null;
      }
      if (temperature) updates.temperature = temperature;
      if (targetAssignedTo !== undefined) {
        updates.assigned_to = targetAssignedTo ? String(targetAssignedTo).trim() : null;
      }

      if (Object.keys(updates).length > 1) {
        await supabase
          .from("leads")
          .update(updates)
          .eq("client_id", clientId)
          .in("id", leadIds);
      }

      if (addTag && pgDatabasePool) {
        await pgDatabasePool.query(
          `UPDATE public.leads 
           SET tags = ARRAY(SELECT DISTINCT unnest(array_append(COALESCE(tags, ARRAY[]::text[]), $1))),
               updated_at = now()
           WHERE client_id = $2 AND id = ANY($3::uuid[])`,
          [addTag, clientId, leadIds]
        );
      }

      if (stage && leadIds.length > 0 && pgDatabasePool) {
        try {
          const { rows: leadPhones } = await pgDatabasePool.query(
            `SELECT telefone FROM public.leads WHERE client_id = $1 AND id = ANY($2::uuid[]) AND telefone IS NOT NULL`,
            [clientId, leadIds]
          );
          for (const row of leadPhones) {
            cancelFollowupCadenceOnStageChange({
              clientId,
              phone: row.telefone,
              newStage: stage,
              queryFn: pgDatabasePool.query.bind(pgDatabasePool),
            }).catch(() => {});
          }
        } catch (err) {
          console.error("[leads/bulk-update] erro ao processar saída de cadência:", err?.message || err);
        }
      }

      res.json({ success: true, updatedCount: leadIds.length });
    } catch (err) {
      console.error("[leads-bulk-update] Error:", err);
      sendError(res, 500, "BULK_UPDATE_FAILED", err.message || "Falha na atualização em lote");
    }
  });

  // Exclusão em lote de leads
  app.post("/api/leads/bulk-delete", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
    if (leadIds.length === 0) {
      sendError(res, 400, "INVALID_BODY", "Nenhum lead selecionado.");
      return;
    }

    try {
      const { error } = await supabase
        .from("leads")
        .delete()
        .eq("client_id", clientId)
        .in("id", leadIds);

      if (error) throw error;
      res.json({ success: true, deletedCount: leadIds.length });
    } catch (err) {
      console.error("[leads-bulk-delete] Error:", err);
      sendError(res, 500, "BULK_DELETE_FAILED", err.message || "Falha na exclusão em lote");
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
        .select("id, client_id, source_name, source_type, total_rows, imported_rows, skipped_rows, uploaded_by_uid, uploaded_by_email, created_at, column_mapping")
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

  app.get("/api/lead-custom-fields", requireFirebaseAuth, requireAppViewAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    try {
      const { data, error } = await supabase
        .from("lead_custom_fields")
        .select("id, client_id, key, label, type, import_id, created_at, updated_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: true });

      if (error) {
        throw error;
      }

      res.json({ items: data || [] });
    } catch (error) {
      console.error("lead custom fields query error:", error);
      sendError(res, 500, "LEAD_CUSTOM_FIELDS_QUERY_FAILED", "Failed to query custom fields");
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

    // Parametros do visualizador de planilha salva. Todos OPCIONAIS: omitidos, a rota
    // se comporta exatamente como antes (so importados, sem paginacao), porque o preview
    // de disparo depende desse contrato.
    //   status=imported (default) | skipped | all
    //   search=<termo>  filtra por nome/telefone
    //   limit=<n>       liga a paginacao (sem limit, devolve tudo, como sempre)
    const status = normalizeString(req.query.status) || "imported";
    const search = (normalizeString(req.query.search) || "").toLowerCase();
    const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const paginate = Number.isInteger(rawLimit) && rawLimit > 0;
    const limit = paginate ? Math.min(rawLimit, 500) : 0;
    const rawPage = Number.parseInt(String(req.query.page ?? ""), 10);
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

    try {
      let query;
      if (importId === "__crm__") {
        query = supabase
          .from("leads")
          .select("id, client_id, telefone, nome, tipo_cliente, created_at, cidade, estado, qualificacao, faixa_consumo, status")
          .eq("client_id", clientId)
          .not("telefone", "is", null)
          .order("created_at", { ascending: false });
      } else {
        query = supabase
          .from("lead_import_items")
          .select("id, import_id, client_id, row_number, telefone, normalized_data, raw_data, imported, skip_reason, created_at")
          .eq("client_id", clientId)
          .order("row_number", { ascending: true });

        // Ignorados costumam ser exatamente as linhas SEM telefone, entao o filtro de
        // telefone nao pode valer quando o pedido inclui ignorados.
        if (status === "imported") {
          query = query.eq("imported", true).not("telefone", "is", null);
        } else if (status === "skipped") {
          query = query.eq("imported", false);
        }

        if (importId && importId !== "__all__") {
          if (importId.includes(",")) {
            const ids = importId.split(",").map((id) => id.trim()).filter(Boolean);
            if (ids.length > 0) {
              query = query.in("import_id", ids);
            }
          } else {
            query = query.eq("import_id", importId);
          }
        }
      }

      const { data: items, error } = await query;
      if (error) throw error;

      const allItems = (items || []).map((item, index) => {
        if (importId === "__crm__") {
          return {
            id: item.id,
            import_id: "__crm__",
            client_id: item.client_id,
            row_number: index + 1,
            telefone: item.telefone,
            normalized_data: {
              nome: item.nome,
              tipo_cliente: item.tipo_cliente,
              cidade: item.cidade,
              estado: item.estado,
              qualificacao: item.qualificacao,
              faixa_consumo: item.faixa_consumo,
              status: item.status,
            },
            imported: true,
            skip_reason: null,
            created_at: item.created_at
          };
        }
        return item;
      });

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

      const searched = search
        ? enriched.filter((item) => {
            const nome = String(item.normalized_data?.nome ?? "").toLowerCase();
            const telefone = String(item.telefone ?? "").toLowerCase();
            return nome.includes(search) || telefone.includes(search);
          })
        : enriched;

      const byDispatch =
        dispatched === "false"
          ? searched.filter((i) => !i.dispatched)
          : dispatched === "true"
            ? searched.filter((i) => i.dispatched)
            : searched;

      // `total` segue significando o universo antes do recorte por dispatched, como antes.
      const payload = {
        items: byDispatch,
        total: searched.length,
        pendingCount: searched.filter((i) => !i.dispatched).length,
      };

      if (paginate) {
        const offset = (page - 1) * limit;
        payload.items = byDispatch.slice(offset, offset + limit);
        payload.page = page;
        payload.limit = limit;
        payload.matched = byDispatch.length;
      }

      res.json(payload);
    } catch (error) {
      console.error("lead import items query error:", error);
      sendError(res, 500, "LEAD_IMPORT_ITEMS_QUERY_FAILED", "Failed to query import items");
    }
  });

  const isRowHeader = (row) => {
    if (!row || typeof row !== "object") return false;
    const values = Object.values(row).map(val =>
      String(val ?? "").trim().toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "")
    );
    const hasPhoneHeader = values.some(val =>
      ["telefone", "celular", "phone", "fone", "whatsapp", "number", "numero"].some(alias => val.includes(alias))
    );
    const hasNameHeader = values.some(val =>
      ["nome", "name", "cliente", "contato", "lead", "responsavel"].some(alias => val.includes(alias))
    );
    return hasPhoneHeader && hasNameHeader;
  };

  app.post("/api/lead-imports", requireFirebaseAuth, requireAppViewAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;

    const clientId = normalizeString(req.body?.clientId);
    const sourceName = normalizeString(req.body?.sourceName) || "planilha";
    const sourceType = normalizeString(req.body?.sourceType) || "spreadsheet";
    const defaultDdd = normalizeString(req.body?.defaultDdd);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    const columnMapping = req.body?.columnMapping || req.body?.mapping || null;
    const mappingItems = Array.isArray(columnMapping)
      ? columnMapping
      : Array.isArray(columnMapping?.mapping)
      ? columnMapping.mapping
      : null;

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
      // 1. Processamento e identificação de campos customizados conhecidos
      const typeWarnings = [];
      const fieldsToInsert = [];
      if (Array.isArray(mappingItems)) {
        const customItems = mappingItems.filter((m) => m && m.target === "custom");
        for (const item of customItems) {
          const key = item.key || normalizeHeaderKey(item.label || item.column);
          const label = item.label || item.column;
          const detectedType = item.type || "text";

          const { data: existingField } = await supabase
            .from("lead_custom_fields")
            .select("id, client_id, key, label, type, import_id")
            .eq("client_id", clientId)
            .eq("key", key)
            .maybeSingle();

          if (existingField) {
            // Reaproveita campo existente sem sobrescrever o tipo caso haja divergência
            if (existingField.type !== detectedType) {
              typeWarnings.push({
                column: item.column,
                label,
                key,
                detectedType,
                registeredType: existingField.type,
                message: `A coluna '${item.column}' veio com valores do tipo '${detectedType}', mas o campo '${label}' já está cadastrado como '${existingField.type}'. O tipo original foi mantido.`,
              });
            }
          } else {
            // Novo campo customizado a ser cadastrado com seu import_id correto
            fieldsToInsert.push({
              key,
              label,
              type: detectedType,
            });
          }
        }
      }

      const filteredRows = rows.filter(row => !isRowHeader(row));
      const autoMapping = detectImportColumns(filteredRows);
      const parsedItems = filteredRows.map((row, index) => {
        const enrichedRow = { ...row };
        if (!mappingItems) {
          if (autoMapping.telefone && !enrichedRow.telefone) {
            enrichedRow.telefone = row[autoMapping.telefone];
          }
          if (autoMapping.nome && !enrichedRow.nome) {
            enrichedRow.nome = row[autoMapping.nome];
          }
        }

        const normalized = normalizeImportedLead(
          enrichedRow,
          clientId,
          defaultDdd,
          mappingItems || null
        );
        const imported = !!normalized.telefone;
        const phoneMapping = mappingItems?.find((m) => m.target === "telefone");
        const rawPhone = phoneMapping
          ? String(row[phoneMapping.column] ?? "").trim()
          : String(enrichedRow.telefone ?? "").trim();
        const rawDigits = rawPhone.replace(/\D/g, "");
        const skipReason = imported
          ? null
          : isImportedLeadEmpty(normalized)
            ? "Linha vazia ou sem dados aproveitaveis"
            : (rawDigits.length === 8 || rawDigits.length === 9) && !defaultDdd
              ? "Telefone incompleto (faltou DDD)"
              : rawDigits.length >= 15 || rawPhone.includes("@g.us")
                ? "Identificador de grupo do WhatsApp bloqueado"
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
          column_mapping: columnMapping || null,
          uploaded_by_uid: req.authAccess?.uid || null,
          uploaded_by_email: req.authAccess?.email || null,
        })
        .select("id, client_id, source_name, source_type, total_rows, imported_rows, skipped_rows, uploaded_by_uid, uploaded_by_email, created_at, column_mapping")
        .single();

      if (importError) {
        throw importError;
      }

      if (importRecord?.id && fieldsToInsert.length > 0) {
        const seenKeys = new Set();
        for (const field of fieldsToInsert) {
          if (seenKeys.has(field.key)) continue;
          seenKeys.add(field.key);
          await supabase.from("lead_custom_fields").insert({
            client_id: clientId,
            key: field.key,
            label: field.label,
            type: field.type,
            import_id: importRecord.id,
          });
        }
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
        warnings: typeWarnings,
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
        const phoneVariants = buildPhoneLookupVariants(telefone);
        const { data: existingLead, error: lookupError } = await supabase
          .from(leadsTableName(clientId))
          .select("id, nome")
          .eq("client_id", clientId)
          .in("telefone", phoneVariants.length > 0 ? phoneVariants : [telefone])
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
              .in("telefone", phoneVariants.length > 0 ? phoneVariants : [telefone])
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
            .in("telefone", buildPhoneLookupVariants(phone));
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

  // Exclusão em massa por tag / importação (prévia, exportação e execução com trava de contagem)
  registerLeadMassDeleteRoutes(app, {
    ensureDb,
    normalizeString,
    pgDatabasePool,
    requireBancoDeDados,
    requireFirebaseAuth,
    resolveAuthorizedClientId,
    sendError,
    massDeleteRepo: deps.massDeleteRepo,
  });

  // Correção dos leads marcados "Instagram Direct" pelo padrão fabricado do importador de planilha
  registerLeadOriginFixRoutes(app, {
    ensureDb,
    normalizeString,
    pgDatabasePool,
    requireBancoDeDados,
    requireFirebaseAuth,
    resolveAuthorizedClientId,
    sendError,
    originFixRepo: deps.originFixRepo,
  });
}
