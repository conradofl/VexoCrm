// backend/src/domains/integrations/routes.js
// Movimento puro (extraído de registerAllDomainRoutes.js): 19 rotas de integrações —
// n8n-settings e evolution-instances de lead-clients, admin/evolution-config,
// whatsapp/session (start/reset) e whatsapp/messages/direct — mais os helpers
// exclusivos do inventário administrativo da Evolution API. Corpo dos handlers
// idêntico ao original — só muda de onde vêm as dependências (deps em vez de
// routeDeps destructure inline).
//
// Cache anti-martelo da Evolution (_remoteEvoInventoryCache/_remoteEvoInventoryInflight,
// incidente de produção 15/06): única instância module-level, preservada tal como no
// original — NÃO duplicar em outro módulo (único consumidor: fetchRemoteEvolutionInstances,
// confirmado por grep antes do corte).
//
// maskSecretPresence vem de createLeadMessaging (domains/shared/leadMessaging.js). Este
// módulo invoca a mesma factory (sem duplicar a função) e usa só maskSecretPresence.

import { createLeadMessaging } from "../shared/leadMessaging.js";
import { whatsappSessionManager } from "../../whatsapp.js";

// Trava de backend contra o martelo em /instance/fetchInstances da Evolution (incidente
// 15/06). Cache curto + dedupe de chamadas concorrentes: N requisições na janela viram
// 1 chamada real à Evolution. Persiste no processo (registerAllDomainRoutes roda 1x).
const EVOLUTION_REMOTE_CACHE_TTL_MS = Number(process.env.EVOLUTION_REMOTE_CACHE_TTL_MS || 60_000);
let _remoteEvoInventoryCache = null; // { at: number, value: object }
let _remoteEvoInventoryInflight = null; // Promise | null

export function registerIntegrationsRoutes(app, deps) {
  const {
    deleteLeadClientEvolutionInstance,
    ensureDb,
    getLeadClientEvolutionInstances,
    getLeadClientN8nSettings,
    isMaskedSecretPlaceholder,
    isMissingSchemaError,
    leadsTableName,
    maskEvolutionInstance,
    maskN8nSettings,
    normalizeHttpUrl,
    normalizeString,
    normalizeTenantKey,
    parseEvolutionWebhookEndpoint,
    parseOptionalUuid,
    pgDatabasePool,
    provisionLeadClientEvolutionInstance,
    requireAdminAccess,
    requireAnyInternalPageAccess,
    requireAppViewAccess,
    requireFirebaseAuth,
    sendError,
    supabase,
    upsertLeadClientEvolutionInstance,
    upsertLeadClientN8nSettings,
  } = deps;

  const { maskSecretPresence } = createLeadMessaging({
    supabase,
    normalizeString,
    leadsTableName,
    isMissingSchemaError,
  });

  function buildEvolutionAdminEnvInventory() {
    const fallbackKeys = Object.keys(process.env)
      .filter((key) => /^(EVOLUTION|N8N)_DISPATCH_WEBHOOK_(URL|TOKEN)_[A-Z0-9_]+$/.test(key))
      .sort()
      .map((key) => ({
        key,
        value: key.includes("_TOKEN_") ? null : normalizeString(process.env[key]) || null,
        configured: Boolean(normalizeString(process.env[key])),
        secret: key.includes("_TOKEN_"),
      }));

    return {
      evolutionApiUrl: normalizeString(process.env.EVOLUTION_API_URL) || null,
      hasEvolutionApiKey: maskSecretPresence(process.env.EVOLUTION_API_KEY),
      dispatchJsonFallbacks: ["EVOLUTION_DISPATCH_WEBHOOKS_JSON", "N8N_DISPATCH_WEBHOOKS_JSON"].map((key) => ({
        key,
        configured: Boolean(normalizeString(process.env[key])),
      })),
      tenantFallbacks: fallbackKeys,
    };
  }

  function getEvolutionAdminApiConfig() {
    const baseUrl = (normalizeString(process.env.EVOLUTION_API_URL) || "").replace(/\/+$/, "");
    const apiKey = normalizeString(process.env.EVOLUTION_API_KEY);
    return {
      baseUrl,
      apiKey,
      configured: Boolean(baseUrl && apiKey),
    };
  }

  function buildEvolutionDispatchUrl(instanceName) {
    const { baseUrl } = getEvolutionAdminApiConfig();
    if (!baseUrl) return null;
    return `${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`;
  }

  function getEvolutionInstanceNameFromDispatchUrl(value) {
    const parsed = parseEvolutionWebhookEndpoint(value);
    return parsed?.instance || null;
  }

  function normalizeRemoteEvolutionInstance(row) {
    if (!row || typeof row !== "object") return null;
    const nested = row.instance && typeof row.instance === "object" ? row.instance : {};
    const name =
      normalizeString(row.instanceName) ||
      normalizeString(row.name) ||
      normalizeString(row.instance_name) ||
      normalizeString(nested.instanceName) ||
      normalizeString(nested.name);
    if (!name) return null;

    return {
      name,
      display_name:
        normalizeString(row.profileName) ||
        normalizeString(row.profile?.name) ||
        normalizeString(row.ownerJid) ||
        null,
      status:
        normalizeString(row.connectionStatus) ||
        normalizeString(row.state) ||
        normalizeString(row.status) ||
        normalizeString(nested.state) ||
        normalizeString(nested.status) ||
        null,
      integration: normalizeString(row.integration) || normalizeString(nested.integration) || null,
      owner_jid: normalizeString(row.ownerJid) || normalizeString(nested.ownerJid) || null,
      webhook_url:
        normalizeString(row.webhook?.url) ||
        normalizeString(row.Webhook?.url) ||
        normalizeString(row.webhookUrl) ||
        null,
      updated_at:
        normalizeString(row.updatedAt) ||
        normalizeString(row.updated_at) ||
        normalizeString(nested.updatedAt) ||
        null,
    };
  }

  // Wrapper com cache (TTL) + dedupe de in-flight. É o ÚNICO ponto que chama o fetch real
  // à Evolution. Garante no máximo 1 chamada real por janela, qualquer que seja a origem
  // (aba, monitor, cliente) — a trava de backend que o fix de frontend sozinho não dava.
  async function fetchRemoteEvolutionInstances() {
    const now = Date.now();
    if (_remoteEvoInventoryCache && now - _remoteEvoInventoryCache.at < EVOLUTION_REMOTE_CACHE_TTL_MS) {
      return _remoteEvoInventoryCache.value;
    }
    if (_remoteEvoInventoryInflight) {
      // Já existe uma consulta pesada em andamento — reusa a mesma promise (não abre outra).
      return _remoteEvoInventoryInflight;
    }
    _remoteEvoInventoryInflight = (async () => {
      try {
        const result = await fetchRemoteEvolutionInstancesRaw();
        // Cacheia o resultado (sucesso OU erro): durante instabilidade da Evolution, manter
        // o último resultado por TTL evita reentrar em loop martelando enquanto ela se recupera.
        _remoteEvoInventoryCache = { at: Date.now(), value: result };
        return result;
      } finally {
        _remoteEvoInventoryInflight = null;
      }
    })();
    return _remoteEvoInventoryInflight;
  }

  async function fetchRemoteEvolutionInstancesRaw() {
    const config = getEvolutionAdminApiConfig();
    if (!config.configured) {
      return {
        configured: false,
        error: "EVOLUTION_API_URL ou EVOLUTION_API_KEY ausente",
        items: [],
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${config.baseUrl}/instance/fetchInstances`, {
        method: "GET",
        headers: {
          apikey: config.apiKey,
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }

      if (!response.ok) {
        const message =
          normalizeString(payload?.response?.message) ||
          normalizeString(payload?.message) ||
          normalizeString(payload?.error) ||
          `Evolution API HTTP ${response.status}`;
        return {
          configured: true,
          error: message,
          items: [],
        };
      }

      const rawItems = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.instances)
          ? payload.instances
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
      const seen = new Set();
      const items = rawItems
        .map(normalizeRemoteEvolutionInstance)
        .filter(Boolean)
        .filter((item) => {
          const key = item.name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        configured: true,
        error: null,
        items,
      };
    } catch (error) {
      return {
        configured: true,
        error: error instanceof Error ? error.message : "Falha ao consultar Evolution API",
        items: [],
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function buildEmptyRemoteEvolutionInventory() {
    return {
      configured: getEvolutionAdminApiConfig().configured,
      error: null,
      items: [],
      skipped: true,
    };
  }

  async function fetchAdminEvolutionInventory({ includeRemote = false } = {}) {
    if (!pgDatabasePool) {
      return {
        env: buildEvolutionAdminEnvInventory(),
        instances: [],
        legacySettings: [],
        followupCompanies: [],
        tenants: [],
        remoteInstances: includeRemote ? await fetchRemoteEvolutionInstances() : buildEmptyRemoteEvolutionInventory(),
      };
    }

    const [instancesResult, settingsResult, followupResult, tenantsResult] = await Promise.all([
      pgDatabasePool.query(`
        SELECT i.id, i.client_id, c.name AS client_name, i.name, i.dispatch_webhook_url,
               i.dispatch_webhook_token, i.inbound_bearer_token, i.active, i.is_default,
               i.chip_state, i.daily_limit_override, i.created_at, i.updated_at, i.updated_by_email
        FROM public.lead_client_evolution_instances i
        LEFT JOIN public.leads_clients c ON c.id = i.client_id
        ORDER BY i.client_id, i.is_default DESC, i.active DESC, i.created_at ASC
      `).catch((error) => {
        if (isMissingSchemaError(error) || error?.code === "42P01") return { rows: [] };
        throw error;
      }),
      pgDatabasePool.query(`
        SELECT s.client_id, c.name AS client_name, s.dispatch_webhook_url,
               s.dispatch_webhook_token, s.inbound_bearer_token, s.active,
               s.chatbot_enabled, s.chatbot_model, s.sdr_whatsapp_number,
               s.updated_at, s.updated_by_email
        FROM public.lead_client_n8n_settings s
        LEFT JOIN public.leads_clients c ON c.id = s.client_id
        ORDER BY s.client_id
      `).catch((error) => {
        if (isMissingSchemaError(error) || error?.code === "42P01") return { rows: [] };
        throw error;
      }),
      pgDatabasePool.query(`
        SELECT id, name, evolution_instance, webhook_url, panel_access, created_at, updated_at
        FROM public.followup_companies
        WHERE archived_at IS NULL
        ORDER BY name
      `).catch((error) => {
        if (isMissingSchemaError(error) || error?.code === "42P01" || error?.code === "42703") return { rows: [] };
        throw error;
      }),
      pgDatabasePool.query(`
        SELECT id, name
        FROM public.leads_clients
        ORDER BY name ASC
      `).catch((error) => {
        if (isMissingSchemaError(error) || error?.code === "42P01") return { rows: [] };
        throw error;
      }),
    ]);
    const remoteInstances = includeRemote ? await fetchRemoteEvolutionInstances() : buildEmptyRemoteEvolutionInventory();

    const localInstanceByRemoteName = new Map();
    for (const row of instancesResult.rows) {
      const instanceName = getEvolutionInstanceNameFromDispatchUrl(row.dispatch_webhook_url) || row.name;
      if (!instanceName) continue;
      localInstanceByRemoteName.set(instanceName.toLowerCase(), {
        id: row.id,
        client_id: row.client_id,
        client_name: row.client_name || row.client_id,
      });
    }

    return {
      env: buildEvolutionAdminEnvInventory(),
      tenants: tenantsResult.rows.map((row) => ({
        id: row.id,
        name: row.name || row.id,
      })),
      remoteInstances: {
        ...remoteInstances,
        items: remoteInstances.items.map((item) => {
          const local = localInstanceByRemoteName.get(item.name.toLowerCase()) || null;
          return {
            ...item,
            dispatch_webhook_url: buildEvolutionDispatchUrl(item.name),
            local_instance_id: local?.id || null,
            local_client_id: local?.client_id || null,
            local_client_name: local?.client_name || null,
          };
        }),
      },
      instances: instancesResult.rows.map((row) => ({
        id: row.id,
        client_id: row.client_id,
        client_name: row.client_name || row.client_id,
        name: row.name || "Evolution",
        dispatch_webhook_url: row.dispatch_webhook_url || null,
        has_dispatch_webhook_token: maskSecretPresence(row.dispatch_webhook_token),
        has_inbound_bearer_token: maskSecretPresence(row.inbound_bearer_token),
        active: row.active !== false,
        is_default: row.is_default === true,
        chip_state: row.chip_state === "warm" ? "warm" : "cold",
        daily_limit_override: row.daily_limit_override != null ? Number(row.daily_limit_override) : null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
        updated_by_email: row.updated_by_email || null,
      })),
      legacySettings: settingsResult.rows.map((row) => ({
        client_id: row.client_id,
        client_name: row.client_name || row.client_id,
        dispatch_webhook_url: row.dispatch_webhook_url || null,
        has_dispatch_webhook_token: maskSecretPresence(row.dispatch_webhook_token),
        has_inbound_bearer_token: maskSecretPresence(row.inbound_bearer_token),
        active: row.active !== false,
        chatbot_enabled: row.chatbot_enabled === true,
        chatbot_model: row.chatbot_model || null,
        sdr_whatsapp_number: row.sdr_whatsapp_number || null,
        updated_at: row.updated_at || null,
        updated_by_email: row.updated_by_email || null,
      })),
      followupCompanies: followupResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        evolution_instance: row.evolution_instance || null,
        webhook_url: row.webhook_url || null,
        panel_access: row.panel_access === true,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
      })),
    };
  }

  function parseOptionalAdminSecret(body, key) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) return { provided: false, value: undefined };
    if (body[key] === null) return { provided: true, value: null };
    const value = normalizeString(body[key]);
    if (!value || isMaskedSecretPlaceholder(value)) return { provided: false, value: undefined };
    return { provided: true, value };
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
    requireAnyInternalPageAccess(["conexoes", "empresas"]),
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

  app.get("/api/admin/evolution-config", requireFirebaseAuth, requireAdminAccess, async (req, res) => {
    try {
      const includeRemote = normalizeString(req.query?.remote).toLowerCase() === "true";
      const inventory = await fetchAdminEvolutionInventory({ includeRemote });
      res.json(inventory);
    } catch (error) {
      console.error("admin evolution config query error:", error);
      sendError(res, 500, "EVOLUTION_CONFIG_QUERY_FAILED", error instanceof Error ? error.message : "Failed");
    }
  });

  app.patch("/api/admin/evolution-config/evolution-instances/:instanceId", requireFirebaseAuth, requireAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;

    const instanceId = normalizeString(req.params?.instanceId);
    if (!parseOptionalUuid(instanceId)?.value) {
      sendError(res, 400, "INVALID_INSTANCE_ID", "Invalid Evolution instance id");
      return;
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const updates = [];
    const values = [];
    const addUpdate = (sql, value) => {
      values.push(value);
      updates.push(sql.replace("?", `$${values.length}`));
    };

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      addUpdate("name = ?", normalizeString(body.name) || "Evolution");
    }
    if (Object.prototype.hasOwnProperty.call(body, "dispatchWebhookUrl")) {
      const url = normalizeHttpUrl(body.dispatchWebhookUrl);
      if (!url) {
        sendError(res, 400, "INVALID_DISPATCH_WEBHOOK_URL", "dispatchWebhookUrl must be a valid http or https URL");
        return;
      }
      addUpdate("dispatch_webhook_url = ?", url);
    }
    const dispatchToken = parseOptionalAdminSecret(body, "dispatchWebhookToken");
    if (dispatchToken.provided) addUpdate("dispatch_webhook_token = ?", dispatchToken.value);
    const inboundToken = parseOptionalAdminSecret(body, "inboundBearerToken");
    if (inboundToken.provided) addUpdate("inbound_bearer_token = ?", inboundToken.value);
    if (Object.prototype.hasOwnProperty.call(body, "active")) {
      addUpdate("active = ?", body.active !== false);
    }

    if (updates.length === 0) {
      sendError(res, 400, "NO_UPDATES", "No valid fields to update");
      return;
    }

    values.push(req.authAccess?.uid || null, req.authAccess?.email || null, instanceId);
    try {
      const result = await pgDatabasePool.query(
        `
          UPDATE public.lead_client_evolution_instances
          SET ${updates.join(", ")}, updated_at = now(), updated_by_uid = $${values.length - 2}, updated_by_email = $${values.length - 1}
          WHERE id = $${values.length}
          RETURNING id
        `,
        values
      );
      if (result.rowCount === 0) {
        sendError(res, 404, "EVOLUTION_INSTANCE_NOT_FOUND", "Evolution instance not found");
        return;
      }
      res.json(await fetchAdminEvolutionInventory());
    } catch (error) {
      console.error("admin evolution instance update error:", error);
      sendError(res, 500, "EVOLUTION_INSTANCE_UPDATE_FAILED", error instanceof Error ? error.message : "Failed");
    }
  });

  app.patch("/api/admin/evolution-config/n8n-settings/:clientId", requireFirebaseAuth, requireAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;

    const clientId = normalizeTenantKey(req.params?.clientId);
    if (!clientId) {
      sendError(res, 400, "INVALID_CLIENT_ID", "Invalid client id");
      return;
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const updates = [];
    const values = [];
    const addUpdate = (sql, value) => {
      values.push(value);
      updates.push(sql.replace("?", `$${values.length}`));
    };

    if (Object.prototype.hasOwnProperty.call(body, "dispatchWebhookUrl")) {
      const rawUrl = normalizeString(body.dispatchWebhookUrl);
      const url = rawUrl ? normalizeHttpUrl(rawUrl) : null;
      if (rawUrl && !url) {
        sendError(res, 400, "INVALID_DISPATCH_WEBHOOK_URL", "dispatchWebhookUrl must be a valid http or https URL");
        return;
      }
      addUpdate("dispatch_webhook_url = ?", url);
    }
    const dispatchToken = parseOptionalAdminSecret(body, "dispatchWebhookToken");
    if (dispatchToken.provided) addUpdate("dispatch_webhook_token = ?", dispatchToken.value);
    const inboundToken = parseOptionalAdminSecret(body, "inboundBearerToken");
    if (inboundToken.provided) addUpdate("inbound_bearer_token = ?", inboundToken.value);
    if (Object.prototype.hasOwnProperty.call(body, "active")) {
      addUpdate("active = ?", body.active !== false);
    }

    if (updates.length === 0) {
      sendError(res, 400, "NO_UPDATES", "No valid fields to update");
      return;
    }

    values.push(req.authAccess?.uid || null, req.authAccess?.email || null, clientId);
    try {
      const result = await pgDatabasePool.query(
        `
          UPDATE public.lead_client_n8n_settings
          SET ${updates.join(", ")}, updated_at = now(), updated_by_uid = $${values.length - 2}, updated_by_email = $${values.length - 1}
          WHERE client_id = $${values.length}
          RETURNING client_id
        `,
        values
      );
      if (result.rowCount === 0) {
        sendError(res, 404, "N8N_SETTINGS_NOT_FOUND", "Legacy settings not found");
        return;
      }
      res.json(await fetchAdminEvolutionInventory());
    } catch (error) {
      console.error("admin n8n settings update error:", error);
      sendError(res, 500, "N8N_SETTINGS_UPDATE_FAILED", error instanceof Error ? error.message : "Failed");
    }
  });

  app.patch("/api/admin/evolution-config/followup-companies/:companyId", requireFirebaseAuth, requireAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;

    const companyId = normalizeString(req.params?.companyId);
    if (!parseOptionalUuid(companyId)?.value) {
      sendError(res, 400, "INVALID_COMPANY_ID", "Invalid follow-up company id");
      return;
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const updates = [];
    const values = [];
    const addUpdate = (sql, value) => {
      values.push(value);
      updates.push(sql.replace("?", `$${values.length}`));
    };

    if (Object.prototype.hasOwnProperty.call(body, "evolutionInstance")) {
      const instanceName = normalizeString(body.evolutionInstance);
      if (!instanceName) {
        sendError(res, 400, "INVALID_EVOLUTION_INSTANCE", "evolutionInstance is required");
        return;
      }
      addUpdate("evolution_instance = ?", instanceName);
    }
    if (Object.prototype.hasOwnProperty.call(body, "webhookUrl")) {
      const rawUrl = normalizeString(body.webhookUrl);
      const url = rawUrl ? normalizeHttpUrl(rawUrl) : null;
      if (rawUrl && !url) {
        sendError(res, 400, "INVALID_WEBHOOK_URL", "webhookUrl must be a valid http or https URL");
        return;
      }
      addUpdate("webhook_url = ?", url);
    }

    if (updates.length === 0) {
      sendError(res, 400, "NO_UPDATES", "No valid fields to update");
      return;
    }

    values.push(companyId);
    try {
      const result = await pgDatabasePool.query(
        `
          UPDATE public.followup_companies
          SET ${updates.join(", ")}, updated_at = now()
          WHERE id = $${values.length}
          RETURNING id
        `,
        values
      );
      if (result.rowCount === 0) {
        sendError(res, 404, "FOLLOWUP_COMPANY_NOT_FOUND", "Follow-up company not found");
        return;
      }
      res.json(await fetchAdminEvolutionInventory());
    } catch (error) {
      console.error("admin followup company update error:", error);
      sendError(res, 500, "FOLLOWUP_COMPANY_UPDATE_FAILED", error instanceof Error ? error.message : "Failed");
    }
  });

  app.post("/api/admin/evolution-config/remote-instances/link", requireFirebaseAuth, requireAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;

    const tenantId = normalizeTenantKey(req.body?.tenantId);
    const instanceName = normalizeString(req.body?.instanceName);
    const displayName = normalizeString(req.body?.name) || instanceName || "Evolution";
    if (!tenantId || !instanceName) {
      sendError(res, 400, "INVALID_BODY", "tenantId and instanceName are required");
      return;
    }

    try {
      if (!(await ensureTenantExistsForEvolutionRoute(tenantId, res))) return;
      await upsertLeadClientEvolutionInstance(
        tenantId,
        {
          name: displayName,
          dispatchWebhookUrl: buildEvolutionDispatchUrl(instanceName),
          dispatchWebhookToken: req.body?.dispatchWebhookToken,
          inboundBearerToken: req.body?.inboundBearerToken,
          active: req.body?.active !== false,
          isDefault: req.body?.isDefault === true,
          chipState: req.body?.chipState,
          dailyLimitOverride: req.body?.dailyLimitOverride,
        },
        req.authAccess,
        null
      );
      res.status(201).json(await fetchAdminEvolutionInventory());
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_DISPATCH_WEBHOOK_URL") {
        sendError(res, 400, "INVALID_DISPATCH_WEBHOOK_URL", "Could not build a valid Evolution dispatch URL");
        return;
      }

      console.error("admin remote evolution link error:", error);
      sendError(res, 500, "REMOTE_EVOLUTION_LINK_FAILED", error instanceof Error ? error.message : "Failed");
    }
  });

  app.post("/api/admin/evolution-config/bulk-replace", requireFirebaseAuth, requireAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;

    const oldBaseUrl = normalizeString(req.body?.oldBaseUrl).replace(/\/+$/, "");
    const newBaseUrl = normalizeString(req.body?.newBaseUrl).replace(/\/+$/, "");
    const normalizedNewBaseUrl = normalizeHttpUrl(newBaseUrl);
    if (!oldBaseUrl || !newBaseUrl || !normalizedNewBaseUrl) {
      sendError(res, 400, "INVALID_BODY", "oldBaseUrl and newBaseUrl must be valid base URLs");
      return;
    }

    const dispatchToken = parseOptionalAdminSecret(req.body || {}, "dispatchWebhookToken");
    const updateToken = req.body?.updateDispatchToken === true && dispatchToken.provided;

    const client = await pgDatabasePool.connect();
    try {
      await client.query("BEGIN");
      const instanceValues = updateToken
        ? [oldBaseUrl, normalizedNewBaseUrl, dispatchToken.value, req.authAccess?.uid || null, req.authAccess?.email || null]
        : [oldBaseUrl, normalizedNewBaseUrl, req.authAccess?.uid || null, req.authAccess?.email || null];
      const instanceResult = await client.query(
        updateToken
          ? `
            UPDATE public.lead_client_evolution_instances
            SET dispatch_webhook_url = replace(dispatch_webhook_url, $1, $2),
                dispatch_webhook_token = $3,
                updated_at = now(),
                updated_by_uid = $4,
                updated_by_email = $5
            WHERE dispatch_webhook_url LIKE $1 || '%'
          `
          : `
            UPDATE public.lead_client_evolution_instances
            SET dispatch_webhook_url = replace(dispatch_webhook_url, $1, $2),
                updated_at = now(),
                updated_by_uid = $3,
                updated_by_email = $4
            WHERE dispatch_webhook_url LIKE $1 || '%'
          `,
        instanceValues
      );

      const settingsValues = updateToken
        ? [oldBaseUrl, normalizedNewBaseUrl, dispatchToken.value, req.authAccess?.uid || null, req.authAccess?.email || null]
        : [oldBaseUrl, normalizedNewBaseUrl, req.authAccess?.uid || null, req.authAccess?.email || null];
      const settingsResult = await client.query(
        updateToken
          ? `
            UPDATE public.lead_client_n8n_settings
            SET dispatch_webhook_url = replace(dispatch_webhook_url, $1, $2),
                dispatch_webhook_token = $3,
                updated_at = now(),
                updated_by_uid = $4,
                updated_by_email = $5
            WHERE dispatch_webhook_url LIKE $1 || '%'
          `
          : `
            UPDATE public.lead_client_n8n_settings
            SET dispatch_webhook_url = replace(dispatch_webhook_url, $1, $2),
                updated_at = now(),
                updated_by_uid = $3,
                updated_by_email = $4
            WHERE dispatch_webhook_url LIKE $1 || '%'
          `,
        settingsValues
      );

      await client.query("COMMIT");
      const inventory = await fetchAdminEvolutionInventory();
      res.json({
        ...inventory,
        bulkResult: {
          evolutionInstancesUpdated: instanceResult.rowCount,
          legacySettingsUpdated: settingsResult.rowCount,
          dispatchTokenUpdated: updateToken,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("admin evolution bulk replace error:", error);
      sendError(res, 500, "EVOLUTION_BULK_REPLACE_FAILED", error instanceof Error ? error.message : "Failed");
    } finally {
      client.release();
    }
  });

  app.post(
    "/api/lead-clients/:tenantId/evolution-instances",
    requireFirebaseAuth,
    requireAnyInternalPageAccess(["conexoes", "empresas"]),
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
    requireAnyInternalPageAccess(["conexoes", "empresas"]),
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
    requireAnyInternalPageAccess(["conexoes", "empresas"]),
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
    requireAnyInternalPageAccess(["conexoes", "empresas"]),
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

  app.get(
    "/api/lead-clients/:tenantId/evolution-instances/:instanceId/status",
    requireFirebaseAuth,
    requireAnyInternalPageAccess(["conexoes", "empresas"]),
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

        const { data, error } = await supabase
          .from("lead_client_evolution_instances")
          .select("id, name, dispatch_webhook_url")
          .eq("id", instanceId)
          .eq("client_id", tenantId)
          .single();

        if (error || !data) {
          sendError(res, 404, "EVOLUTION_INSTANCE_NOT_FOUND", "Evolution instance not found");
          return;
        }

        const instanceName = getEvolutionInstanceNameFromDispatchUrl(data.dispatch_webhook_url) || data.name;
        if (!instanceName) {
           res.json({ connected: false });
           return;
        }

        const config = getEvolutionAdminApiConfig();
        if (!config.configured) {
          res.json({ connected: false, error: "EVOLUTION_UNCONFIGURED" });
          return;
        }

        const response = await fetch(`${config.baseUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`, {
          method: "GET",
          headers: { apikey: config.apiKey },
        });

        if (!response.ok) {
           res.json({ connected: false });
           return;
        }
        
        const payloadList = await response.json();
        const payload = Array.isArray(payloadList) ? payloadList[0] : payloadList;
        
        if (!payload) {
           res.json({ connected: false });
           return;
        }

        console.info(`[evolution] status check for ${instanceName}:`, JSON.stringify(payload));
        const st1 = (payload?.connectionStatus || "").toLowerCase();
        const st2 = (payload?.instance?.state || "").toLowerCase();
        const st3 = (payload?.state || "").toLowerCase();
        const st4 = (payload?.instance?.status || "").toLowerCase();
        
        const connected = ["open", "connected"].some(s => [st1, st2, st3, st4].includes(s));
        
        res.json({
          connected,
          profileName: payload?.profileName || payload?.instance?.profileName || null,
          ownerJid: payload?.ownerJid || payload?.instance?.ownerJid || null,
        });
      } catch (error) {
        console.error("Evolution instance status fetch error:", error);
        res.json({ connected: false, error: "FAILED" });
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
}
