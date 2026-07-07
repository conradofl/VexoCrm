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
} from "../../lead-client-tables.js";
import { hasAccessPermission } from "../../accessGuards.js";

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

      const { data, error } = await query;

      if (error) {
        throw error;
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

    // Limpar tabela de leads específica do tenant e dropar a tabela física com CASCADE
    const leadsTable = leadsTableName(tenantId);
    results.push(await deleteLeadClientRowsFromTable(leadsTable, tenantId));

    try {
      await pgDatabasePool.query(`DROP TABLE IF EXISTS public."${leadsTable}" CASCADE`);
      results.push({ table: leadsTable, deleted: 1, dropped: true });
    } catch (err) {
      console.error(`Failed to drop leads table ${leadsTable} for tenant ${tenantId}:`, err);
      results.push({ table: leadsTable, deleted: 0, dropped: false, error: err.message });
    }

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
    if (!ensureSharedRoutePageAccess(req, res, "leads")) return;

    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    try {
      const { data, error } = await supabase
        .from('leads')
        .select("*")
        .eq("client_id", clientId)
        .order("data_hora", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(2000);

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

        const normalized = normalizeImportedLead(enrichedRow, clientId);
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
}
