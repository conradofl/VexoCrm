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
} from "../../lead-client-tables.js";
import { hasAccessPermission } from "../../accessGuards.js";
import { requireContractedModulePage } from "../../access/modularGate.js";
import { upsertLeadByPhone, upsertLeadsBatchByPhone } from "../../services/leadUpsert.js";
import { summarizeChatWithAI } from "./chatInsight.js";
import {
  getDefaultLeadClientEvolutionInstance,
  getEvolutionAdminConfig,
  getLeadClientEvolutionInstances,
  resolveEvolutionInstanceOwner,
} from "../../services/evolution.js";

import { buildPhoneLookupVariants, sanitizePhone } from "../../services/leadImport.js";
import { isManagerOrAdmin } from "../../access/claims.js";

function sanitizePhoneE164(phoneInput, defaultDdd = null) {
  const s = sanitizePhone(phoneInput, defaultDdd);
  if (!s) return null;
  return s.startsWith("+") ? s : `+${s}`;
}

function classifyChatContent(messages, contactName) {
  const fullText = (messages || []).join(" ").toLowerCase();

  let stage = "cold";
  let temperature = "warm";
  const tagsSet = new Set();

  if (/(comprei|paguei|fechado|comprovante|pix feito|pedido confirmado|boleto pago|adquirido|assinado|sou cliente)/i.test(fullText)) {
    stage = "buyer";
    temperature = "hot";
    tagsSet.add("Cliente");
  } else if (/(orçamento|orcamento|cotacao|cotação|valor|quanto custa|preço|preco|desconto|proposta|tabela|enviar valor)/i.test(fullText)) {
    stage = "open_budget";
    temperature = "hot";
    tagsSet.add("Orçamento");
  } else if (/(duvida|dúvida|funciona|endereço|horário|informação|informacao|catalogo|catálogo|como faz)/i.test(fullText)) {
    stage = "inquiry";
    temperature = "warm";
    tagsSet.add("Dúvida");
  } else if (/(cancelar|não tenho interesse|nao tenho interesse|muito caro|desisti|não quero|nao quero|remover)/i.test(fullText)) {
    stage = "lost";
    temperature = "cold";
    tagsSet.add("Perdido");
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
    stage,
    temperature,
    tags: Array.from(tagsSet),
    summary
  };
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
    buildImportPreview,
    ensureDb,
    ensureSharedRoutePageAccess,
    extractManagedAccessClaims,
    getLeadClientN8nSettingsMap,
    getN8nOnboardingStatus,
    getLeadClientN8nSettings,
    internalErrorPayloadDetails,
    isDuplicateKeyError,
    isImportedLeadEmpty,
    isMissingSchemaError,
    leadsTableName,
    listAllFirebaseUsers,
    maskN8nSettings,
    normalizeImportedLead,
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
        data = [{ id: "geracao-digital", name: "Geração Digital", created_at: new Date().toISOString() }];
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
      const buyersCount = allItems.filter(l => l.stage === 'buyer' || l.status === 'cliente' || l.status === 'qualificado').length;
      const openBudgetsCount = allItems.filter(l => l.stage === 'open_budget' || l.status === 'orcamento').length;

      const openBudgetsSum = allItems
        .filter(l => l.stage === 'open_budget' || l.status === 'orcamento')
        .reduce((sum, l) => sum + (Number(l.potential_contract_value) || 2500), 0);

      res.json({
        items: data || [],
        total: totalCount,
        page,
        limit,
        summary: {
          totalLeads,
          buyersCount,
          openBudgetsCount,
          estimatedRevenue: openBudgetsSum
        }
      });
    } catch (error) {
      console.error("leads query error:", error);
      res.json({
        items: [],
        total: 0,
        page: 1,
        limit: 2000,
        summary: { totalLeads: 0, buyersCount: 0, openBudgetsCount: 0, estimatedRevenue: 0 }
      });
    }
  });

  // Extração automática de contatos e mensagens via WhatsApp (Evolution API)
  app.post("/api/leads/extract-wa-contacts", requireFirebaseAuth, requireBancoDeDados, async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.body?.clientId || req.query?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const rawLimit = req.body?.chatLimit || req.body?.limit;
    const isUnlimited = rawLimit === "all" || rawLimit === "unlimited" || rawLimit === 0;
    const chatLimit = isUnlimited ? Infinity : Math.max(10, parseInt(rawLimit || "100", 10));

    const explicitInstanceId = normalizeString(req.body?.instanceId);
    const explicitInstanceName = normalizeString(req.body?.instanceName);

    try {
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
        return;
      }

      const urlObj = new URL(instance.dispatch_webhook_url);
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      const parts = urlObj.pathname.split("/");
      const instanceName = explicitInstanceName || parts[parts.length - 1];

      if (!instanceName) {
        sendError(res, 400, "INVALID_INSTANCE", "Instância do WhatsApp inválida.");
        return;
      }

      const apiKey = instance.dispatch_webhook_token || getEvolutionAdminConfig().apiKey;

      // Bloco 3: Resolve o operador responsável pelo chip de onde as conversas/contatos estão sendo extraídos
      let chipOwnerUid = instance?.owner_uid || null;
      if (!chipOwnerUid && instanceName) {
        chipOwnerUid = await resolveEvolutionInstanceOwner({
          clientId,
          instanceName: instance?.name || instanceName,
          pool: pgDatabasePool,
        });
      }

      // Evolution v2: findChats é POST (com body), não GET. GET dava HTTP 404.
      const chatsRes = await fetch(`${baseUrl}/chat/findChats/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({}),
      });

      if (!chatsRes.ok) {
        const text = await chatsRes.text();
        sendError(res, 502, "WA_FETCH_CHATS_FAILED", `Erro ao buscar conversas no WhatsApp (HTTP ${chatsRes.status}): ${text.slice(0, 200)}`);
        return;
      }

      const rawChats = await chatsRes.json();
      // v2 pode devolver array direto ou paginado ({ records: [...] }).
      const chats = Array.isArray(rawChats) ? rawChats : (rawChats?.records || rawChats?.chats || []);
      if (!Array.isArray(chats)) {
        sendError(res, 502, "WA_INVALID_RESPONSE", "Evolution API não retornou uma lista válida de conversas.");
        return;
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
      // Número da própria instância (o WhatsApp conectado) — não é lead. A
      // tabela não guarda o ownerJid, então consulta a Evolution.
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

      const validChats = chats.filter(c => {
        const jid = realPhoneJid(c);
        if (!jid || jid.includes("@g.us") || jid.includes("@broadcast") || jid.includes("-group")) return false;
        const digits = jid.split("@")[0].replace(/\D/g, "");
        // Descarta telefone vazio/curto ("0", "WhatsApp Business" etc.), grupos (15+ dígitos) e o
        // próprio número conectado (aparecia como lead com telefone zerado).
        if (!digits || digits.length < 10 || digits.length >= 15) return false;
        if (ownerDigits && digits === ownerDigits) return false;
        return true;
      });

      // NOMES: o "~nome" que aparece no WhatsApp de quem não está salvo nos
      // contatos é o pushName que a pessoa configurou no aparelho dela. Vem no
      // chat, mas quando a última mensagem é nossa o pushName é "Você"; então
      // buscamos também /chat/findContacts, que traz pushName por contato.
      const contactNames = new Map();
      // Agenda completa do chip: contatos salvos com telefone real. Muitos nunca
      // trocaram mensagem (ou a conversa foi apagada), então não aparecem em
      // findChats — mas são exatamente os leads que o Banco de Dados quer.
      const addressBook = [];
      try {
        const contactsRes = await fetch(`${baseUrl}/chat/findContacts/${encodeURIComponent(instanceName)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: apiKey },
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
          console.info(`[wa-extract] findContacts: ${contactNames.size} nomes carregados`);
        }
      } catch (e) {
        console.warn("[wa-extract] findContacts indisponível:", e.message);
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

      const topChats = isFinite(chatLimit) ? validChats.slice(0, chatLimit) : validChats;
      console.info(`[wa-extract] client=${clientId} instancia=${instanceName} chats=${chats.length} validos=${validChats.length} processando=${topChats.length}`);

      for (const chat of topChats) {
        const phoneJid = realPhoneJid(chat);
        const rawPhone = phoneJid.split("@")[0] || "";
        const formattedPhone = sanitizePhoneE164(rawPhone);
        if (!formattedPhone) continue;

        // Ordem: pushName do chat > nome do findContacts > pushName da última
        // mensagem recebida (nunca a enviada, que vem como "Você") > telefone.
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
          console.warn(`[wa-extract] Erro ao buscar mensagens do chat ${remoteJid}:`, msgErr.message);
        }

        const classification = classifyChatContent(messagesText, name);
        // Resumo inteligente (pontos-chave + diagnóstico + próxima ação). Se a
        // IA não estiver disponível, mantém o resumo heurístico.
        try {
          const insight = await summarizeChatWithAI(messagesText, name);
          if (insight?.summary) {
            classification.summary = insight.summary;
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
        } catch { /* mantém o resumo heurístico */ }
        if (classification.stage === 'buyer') buyers++;
        if (classification.stage === 'open_budget') openBudgets++;
        if (classification.stage === 'cold') coldLeads++;
        if (classification.temperature === 'hot') hotLeads++;

        // UPSERT via SQL cru (o shim supabase engolia o erro em silêncio, e a
        // extração retornava 0 sem pista). ON CONFLICT (client_id, telefone)
        // deduplica: rodar a extração várias vezes atualiza em vez de duplicar.
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

          // telefone sem "+" para casar com lead_messages.phone (sync) e
          // deduplicar entre extração e sincronização (mesma chave).
          const telefoneKey = formattedPhone.replace(/^\+/, "");
          await upsertLeadByPhone(pgDatabasePool, clientId, telefoneKey, {
            phone: telefoneKey,
            nome: name,
            stage: classification.stage,
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

      // AGENDA: importa os contatos salvos que não vieram por conversa. Sem
      // histórico não dá para classificar estágio/temperatura, então entram
      // como lead frio marcado pela origem — o telefone e o nome, que é o que
      // faltava, ficam disponíveis para trabalhar depois.
      let addressBookCount = 0;
      for (const ct of addressBook) {
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
      console.info(`[wa-extract] agenda: ${addressBookCount} contatos importados de ${addressBook.length} salvos`);

      res.json({
        success: true,
        extractedCount: extractedCount + addressBookCount,
        fromChats: extractedCount,
        fromAddressBook: addressBookCount,
        insertErrors,
        totalChatsFound: validChats.length,
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

    const rawImportTags = req.body?.importTags || req.body?.tags || [];
    const importTagsArray = Array.isArray(rawImportTags)
      ? rawImportTags.map((t) => String(t).trim()).filter(Boolean)
      : typeof rawImportTags === "string"
      ? rawImportTags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    try {
      let importedCount = 0;
      const parsedLeads = [];

      for (const row of rows) {
        const rawPhone = row.telefone || row.phone || row.celular || row.whatsapp || row.numero || "";
        let formattedPhone = sanitizePhoneE164(rawPhone, defaultDdd);
        const name = normalizeString(row.nome || row.name || row.cliente || row.contato || formattedPhone || "Lead Social");

        if (!formattedPhone) {
          // Gera número E.164 com prefixo 5500 (13 dígitos exatos: 5500 + 9 dígitos)
          const randomSuffix = Math.floor(100000000 + Math.random() * 900000000);
          formattedPhone = `5500${randomSuffix}`;
        }

        const stageInput = normalizeString(row.stage || row.estagio || row.etapa)?.toLowerCase();
        const validStage = ['buyer', 'open_budget', 'inquiry', 'cold', 'lost'].includes(stageInput) ? stageInput : 'cold';
        
        const tempInput = normalizeString(row.temperature || row.temperatura)?.toLowerCase();
        const validTemp = ['hot', 'warm', 'cold'].includes(tempInput) ? tempInput : 'warm';

        const rowTags = row.tags || row.tag || [];
        const parsedRowTags = Array.isArray(rowTags)
          ? rowTags.map((t) => String(t).trim())
          : typeof rowTags === "string"
          ? rowTags.split(",").map((t) => t.trim()).filter(Boolean)
          : [];

        const originTag =
          importTagsArray.find((t) => /instagram|facebook|linkedin|tiktok|direct|messenger/i.test(t)) ||
          parsedRowTags.find((t) => /instagram|facebook|linkedin|tiktok|direct|messenger/i.test(t)) ||
          row.origem ||
          "Instagram Direct";

        const combinedTags = Array.from(new Set([...parsedRowTags, ...importTagsArray, originTag]));

        parsedLeads.push({
          client_id: clientId,
          telefone: formattedPhone,
          phone: formattedPhone,
          nome: name,
          stage: validStage,
          temperature: validTemp,
          tags: combinedTags,
          dados: {
            origem: originTag,
            origem_marketing: originTag,
            lead_source: originTag,
            resumo_chat: row.interesse || row.resumo_chat || "Interação no Direct",
            telefone_bruto: rawPhone ? String(rawPhone).trim() : null,
          },
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

      res.json({ success: true, importedCount, totalRows: rows.length });
    } catch (err) {
      console.error("[leads-csv-import] Erro ao importar CSV:", err);
      sendError(res, 500, "CSV_IMPORT_FAILED", err.message || "Falha ao importar planilha");
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
        .select("nome, telefone, stage, temperature, tags, raw_chat_summary, created_at, last_interaction_at")
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
      const csvHeader = "Nome,Telefone,Estágio,Temperatura,Tags,Última Interação,Resumo Chat\n";
      const csvRows = leads.map(l => {
        const nome = `"${(l.nome || '').replace(/"/g, '""')}"`;
        const fone = `"${(l.telefone || '').replace(/"/g, '""')}"`;
        const stg = `"${l.stage || 'cold'}"`;
        const tmp = `"${l.temperature || 'warm'}"`;
        const tgs = `"${(Array.isArray(l.tags) ? l.tags.join("; ") : '').replace(/"/g, '""')}"`;
        const last = `"${l.last_interaction_at ? new Date(l.last_interaction_at).toLocaleString('pt-BR') : ''}"`;
        const sum = `"${(l.raw_chat_summary || '').replace(/"/g, '""')}"`;
        return `${nome},${fone},${stg},${tmp},${tgs},${last},${sum}`;
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
      if (req.body.stage !== undefined) updates.stage = req.body.stage;
      if (req.body.temperature !== undefined) updates.temperature = req.body.temperature;
      if (req.body.nome !== undefined) updates.nome = req.body.nome;
      if (req.body.assigned_to !== undefined || req.body.assignedTo !== undefined) {
        if (!isManagerOrAdmin(req.authAccess)) {
          sendError(res, 403, "FORBIDDEN", "Apenas gestores ou administradores podem reatribuir leads");
          return;
        }
        const val = req.body.assigned_to !== undefined ? req.body.assigned_to : req.body.assignedTo;
        updates.assigned_to = val ? String(val).trim() : null;
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

    const { stage, temperature, addTag, assigned_to, assignedTo } = req.body?.updates || {};
    const targetAssignedTo = assigned_to !== undefined ? assigned_to : assignedTo;
    if (targetAssignedTo !== undefined) {
      if (!isManagerOrAdmin(req.authAccess)) {
        sendError(res, 403, "FORBIDDEN", "Apenas gestores ou administradores podem reatribuir leads");
        return;
      }
    }

    try {
      const updates = { updated_at: new Date().toISOString() };
      if (stage) updates.stage = stage;
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
      const filteredRows = rows.filter(row => !isRowHeader(row));
      const mapping = detectImportColumns(filteredRows);
      const parsedItems = filteredRows.map((row, index) => {
        const enrichedRow = { ...row };
        if (mapping.telefone && !enrichedRow.telefone) {
          enrichedRow.telefone = row[mapping.telefone];
        }
        if (mapping.nome && !enrichedRow.nome) {
          enrichedRow.nome = row[mapping.nome];
        }

        const normalized = normalizeImportedLead(enrichedRow, clientId, defaultDdd);
        const imported = !!normalized.telefone;
        const rawPhone = String(enrichedRow.telefone ?? "").trim();
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
}
