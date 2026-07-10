// Evolution API: instâncias por cliente, provisionamento, health-check (movidos de
// server.js — grupo E do mapa, Onda 3 Run D). Movimento puro: corpos idênticos aos
// de server.js na revisão anterior a esta extração.
//
// _evolutionInstancesSchemaEnsured (antes `let` isolado em server.js) vira estado
// privado deste módulo — só ensureLeadClientEvolutionInstancesTable o toca.
//
// logCampaignDispatch: movida para cá (não estava no grupo E do mapa) porque
// checkEvolutionInstanceHealth depende dela e o grafo de imports não permite que
// evolution.js importe de server.js. server.js (grupo D, hub) reimporta esta função
// daqui para os usos que permanecem em resolveCampaignDispatchSettings/dispatch
// (settings_resolved) — consistente com "D importa de E".
//
// isMaskedSecretPlaceholder (usada por upsertLeadClientEvolutionInstance) foi movida
// para ./httpInfra.js em vez de ./n8nSettings.js: n8nSettings.js já importa deste
// módulo (getDefaultLeadClientEvolutionInstance, mergeEvolutionInstanceIntoSettings,
// getLeadClientEvolutionInstancesMap, maskEvolutionInstance) — se isMaskedSecretPlaceholder
// vivesse em n8nSettings.js, este módulo precisaria importar de lá também, fechando um
// ciclo evolution.js <-> n8nSettings.js. Import de httpInfra.js (folha do grafo) evita isso.

import { randomUUID } from "crypto";
import { pgDatabasePool } from "./database.js";
import { normalizeString } from "../textNormalize.js";
import { normalizeTenantKey, normalizeHttpUrl } from "./tenant.js";
import { isMaskedSecretPlaceholder } from "./httpInfra.js";

/** Timeout padrão para chamadas HTTP de saída (Evolution health-check e webhooks de campanha). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export function logCampaignDispatch(level, event, details = {}) {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger("[campaign-dispatch]", event, details);
}

export function maskEvolutionInstance(row) {
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
    webhook_enabled: row.webhook_enabled === true,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    updated_by_email: row.updated_by_email || null,
  };
}

export function mergeEvolutionInstanceIntoSettings(settings, instance) {
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

let _evolutionInstancesSchemaEnsured = false;

export async function ensureLeadClientEvolutionInstancesTable() {
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
      webhook_enabled BOOLEAN NOT NULL DEFAULT false,
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
  await pgDatabasePool.query(`
    ALTER TABLE public.lead_client_evolution_instances
    ADD COLUMN IF NOT EXISTS webhook_enabled BOOLEAN NOT NULL DEFAULT false
  `);

  _evolutionInstancesSchemaEnsured = true;
  return true;
}

export async function getLeadClientEvolutionInstances(clientId) {
  if (!clientId || !(await ensureLeadClientEvolutionInstancesTable())) return [];

  const { rows } = await pgDatabasePool.query(
    `
      SELECT i.id, i.client_id, i.name, i.dispatch_webhook_url, i.dispatch_webhook_token,
             i.inbound_bearer_token, i.active, i.is_default, i.chip_state, i.daily_limit_override,
             i.webhook_enabled,
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

export async function getLeadClientEvolutionInstancesMap(clientIds) {
  if (!clientIds?.length || !(await ensureLeadClientEvolutionInstancesTable())) return {};

  const { rows } = await pgDatabasePool.query(
    `
      SELECT i.id, i.client_id, i.name, i.dispatch_webhook_url, i.dispatch_webhook_token,
             i.inbound_bearer_token, i.active, i.is_default, i.chip_state, i.daily_limit_override,
             i.webhook_enabled,
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

export async function getDefaultLeadClientEvolutionInstance(clientId) {
  const instances = await getLeadClientEvolutionInstances(clientId);
  return instances.find((instance) => instance.active !== false && instance.is_default) ||
    instances.find((instance) => instance.active !== false) ||
    null;
}

export async function syncEvolutionInstanceChatsAndMessages(clientId, dispatchWebhookUrl, dispatchWebhookToken) {
  try {
    if (!dispatchWebhookUrl) return;

    const urlObj = new URL(dispatchWebhookUrl);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    const parts = urlObj.pathname.split("/");
    const instanceName = parts[parts.length - 1];

    if (!instanceName) return;

    const apiKey = dispatchWebhookToken || getEvolutionAdminConfig().apiKey;

    console.info(`[sync-evolution] Starting background sync for instance ${instanceName}...`);

    // 1. Fetch chats from Evolution API
    const chatsResponse = await fetch(`${baseUrl}/chat/findChats/${encodeURIComponent(instanceName)}`, {
      method: "GET",
      headers: { apikey: apiKey }
    });

    if (!chatsResponse.ok) {
      console.warn(`[sync-evolution] Failed to fetch chats for ${instanceName}: HTTP ${chatsResponse.status}`);
      return;
    }

    const chats = await chatsResponse.json();
    if (!Array.isArray(chats)) {
      console.warn(`[sync-evolution] Evolution API did not return an array of chats:`, chats);
      return;
    }

    console.info(`[sync-evolution] Found ${chats.length} chats. Syncing messages for the top 30 chats...`);

    // Only sync the top 30 chats to avoid excessive API requests
    const topChats = chats.slice(0, 30);

    for (const chat of topChats) {
      const remoteJid = chat.id || chat.remoteJid;
      if (!remoteJid || remoteJid.includes("@g.us") || remoteJid.includes("@broadcast")) {
        continue;
      }

      const phone = remoteJid.split("@")[0];
      if (!phone) continue;

      // 2. Fetch last 15 messages for each of the top chats
      try {
        const msgsResponse = await fetch(`${baseUrl}/chat/findMessages/${encodeURIComponent(instanceName)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: apiKey
          },
          body: JSON.stringify({
            where: {
              key: {
                remoteJid: remoteJid
              }
            },
            limit: 15
          })
        });

        if (!msgsResponse.ok) {
          console.warn(`[sync-evolution] Failed to fetch messages for chat ${remoteJid}: HTTP ${msgsResponse.status}`);
          continue;
        }

        const msgsData = await msgsResponse.json();
        const messages = Array.isArray(msgsData) ? msgsData : (msgsData?.records || msgsData?.messages || []);

        if (!Array.isArray(messages)) continue;

        // Resolve lead details once per chat
        const leadRes = await pgDatabasePool.query(
          `
            SELECT id, source_campaign_id 
            FROM public.leads 
            WHERE client_id = $1 AND (telefone = $2 OR telefone = $3 OR telefone = $4)
            ORDER BY created_at DESC 
            LIMIT 1
          `,
          [
            clientId,
            phone,
            phone.replace(/^55/, ""),
            phone.startsWith("55") ? phone : `55${phone}`
          ]
        );
        const leadId = leadRes.rows[0]?.id || null;
        const campaignId = leadRes.rows[0]?.source_campaign_id || null;

        for (const msg of messages) {
          const fromMe = msg.key?.fromMe === true;
          const messageText = 
            msg.message?.conversation || 
            msg.message?.extendedTextMessage?.text || 
            msg.messageText || 
            "";

          if (!messageText) continue;

          const timestamp = msg.messageTimestamp 
            ? new Date(msg.messageTimestamp * 1000) 
            : new Date();

          // Check if message already exists
          const checkRes = await pgDatabasePool.query(
            `
              SELECT id 
              FROM public.lead_messages
              WHERE client_id = $1 AND phone = $2 AND message_text = $3
                AND created_at >= $4 AND created_at <= $5
              LIMIT 1
            `,
            [
              clientId,
              phone,
              messageText,
              new Date(timestamp.getTime() - 5000),
              new Date(timestamp.getTime() + 5000)
            ]
          );

          if (checkRes.rows.length === 0) {
            await pgDatabasePool.query(
              `
                INSERT INTO public.lead_messages 
                  (client_id, lead_id, campaign_id, phone, sender_type, direction, message_text, created_at, delivered_at, meta)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              `,
              [
                clientId,
                leadId,
                campaignId,
                phone,
                fromMe ? "user" : "lead",
                fromMe ? "outbound" : "inbound",
                messageText,
                timestamp,
                timestamp,
                JSON.stringify({})
              ]
            );
          }
        }
      } catch (chatErr) {
        console.error(`[sync-evolution] Error syncing messages for chat ${remoteJid}:`, chatErr.message || chatErr);
      }
    }
    console.info(`[sync-evolution] Background sync for instance ${instanceName} completed!`);
  } catch (err) {
    console.error(`[sync-evolution] Background sync error:`, err.message || err);
  }
}

export async function configureEvolutionInstanceWebhook(clientId, dispatchWebhookUrl, dispatchWebhookToken, enabled) {
  if (!dispatchWebhookUrl) {
    throw new Error("INVALID_DISPATCH_WEBHOOK_URL");
  }

  const urlObj = new URL(dispatchWebhookUrl);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
  const parts = urlObj.pathname.split("/");
  const instanceName = parts[parts.length - 1];

  if (!instanceName) {
    throw new Error("COULD_NOT_PARSE_INSTANCE_NAME");
  }

  const apiKey = dispatchWebhookToken || getEvolutionAdminConfig().apiKey;

  const base =
    process.env.WEBHOOK_BASE_URL ||
    process.env.FRONTEND_ORIGIN?.replace(/\/$/, "") ||
    "";
  
  if (!base) {
    throw new Error("WEBHOOK_BASE_URL_UNDEFINED");
  }

  const webhookUrl = `${base}/api/hardcoded-chat-webhook?clientId=${encodeURIComponent(clientId)}`;

  const payload = {
    enabled: Boolean(enabled),
    url: webhookUrl,
    byEvents: false,
    events: enabled ? ["MESSAGES_UPSERT", "SEND_MESSAGE"] : [],
  };

  const response = await fetch(`${baseUrl}/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Evolution Webhook set returned HTTP ${response.status}: ${text}`);
  }

  // Trigger background sync of chats/messages when webhook is enabled
  if (enabled) {
    syncEvolutionInstanceChatsAndMessages(clientId, dispatchWebhookUrl, dispatchWebhookToken).catch((err) => {
      console.error(`[sync-evolution] Background sync initiation failed:`, err.message);
    });
  }

  return true;
}

export async function upsertLeadClientEvolutionInstance(clientId, input, authAccess, existing = null) {
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

  const webhookEnabled = Object.prototype.hasOwnProperty.call(body, "webhookEnabled")
    ? body.webhookEnabled === true
    : existing?.webhook_enabled === true;

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
    webhook_enabled: webhookEnabled,
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
              webhook_enabled = $9,
              updated_at = now(),
              updated_by_uid = $10,
              updated_by_email = $11
          WHERE id = $12 AND client_id = $13
          RETURNING id, client_id, name, dispatch_webhook_url, dispatch_webhook_token,
                    inbound_bearer_token, active, is_default, chip_state, daily_limit_override,
                    webhook_enabled,
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
          payload.webhook_enabled,
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
             active, is_default, chip_state, daily_limit_override, webhook_enabled, updated_by_uid, updated_by_email)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id, client_id, name, dispatch_webhook_url, dispatch_webhook_token,
                    inbound_bearer_token, active, is_default, chip_state, daily_limit_override,
                    webhook_enabled,
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
          payload.webhook_enabled,
          payload.updated_by_uid,
          payload.updated_by_email,
        ]
      );
    }

    await client.query("COMMIT");

    // Configure the webhook remotely on Evolution API
    if (result.rows[0]?.dispatch_webhook_url) {
      const parts = result.rows[0].dispatch_webhook_url.split("/");
      const instanceName = parts[parts.length - 1];
      if (instanceName) {
        configureEvolutionInstanceWebhook(clientId, instanceName, webhookEnabled).catch((err) => {
          console.error(`[evolution-webhook] Failed to configure remote webhook for ${instanceName}:`, err.message);
        });
      }
    }

    return result.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function getEvolutionAdminConfig() {
  const baseUrl = (normalizeString(process.env.EVOLUTION_API_URL) || "").replace(/\/+$/, "");
  const apiKey = normalizeString(process.env.EVOLUTION_API_KEY);

  return {
    baseUrl,
    apiKey,
    configured: Boolean(baseUrl && apiKey),
  };
}

export function buildEvolutionManagedInstanceName(clientId, inputName) {
  const source = normalizeString(inputName) || clientId || "vexo";
  const normalized = normalizeTenantKey(source) || normalizeTenantKey(clientId) || `vexo-${randomUUID().slice(0, 8)}`;
  const withClientPrefix = normalized.startsWith(`${clientId}-`) ? normalized : `${clientId}-${normalized}`;
  return withClientPrefix.slice(0, 64).replace(/-+$/g, "");
}

export function buildEvolutionDispatchWebhookUrl(baseUrl, instanceName) {
  return `${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`;
}

export function maskEvolutionProvisionResponse(data) {
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

export async function provisionLeadClientEvolutionInstance(clientId, input, authAccess) {
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
      webhookEnabled: body.webhookEnabled !== false,
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

export async function deleteLeadClientEvolutionInstance(clientId, instanceId) {
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

export function parseEvolutionWebhookEndpoint(webhookUrl) {
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

export function getSafeEvolutionEndpointLog(webhookUrl) {
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

export function buildEvolutionAuthHeaders(token) {
  const headers = { Accept: "application/json" };
  const normalizedToken = normalizeString(token);
  if (normalizedToken) {
    headers.apikey = normalizedToken;
    headers.Authorization = `Bearer ${normalizedToken}`;
  }
  return headers;
}

export function extractEvolutionConnectionState(payload) {
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

export function isEvolutionOpenState(state) {
  return ["open", "connected", "online"].includes(normalizeString(state).toLowerCase());
}

export async function checkEvolutionInstanceHealth({ webhookUrl, webhookToken, context = {} }) {
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
