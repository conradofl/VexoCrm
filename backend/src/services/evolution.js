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
import { upsertLeadByPhone } from "./leadUpsert.js";

/** Timeout padrão para chamadas HTTP de saída (Evolution health-check e webhooks de campanha). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export function logCampaignDispatch(level, event, details = {}) {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger("[campaign-dispatch]", event, details);
}

export function maskEvolutionInstance(row) {
  if (!row) return null;
  const chipState = (row.chip_state || "").toLowerCase() === "warm" ? "warm" : "cold";
  const connState = (row.connection_state || "unknown").toLowerCase();

  return {
    id: row.id,
    client_id: row.client_id,
    name: row.name || "Evolution",
    dispatch_webhook_url: row.dispatch_webhook_url || null,
    has_dispatch_webhook_token: !!row.dispatch_webhook_token,
    inbound_bearer_token_label: row.inbound_bearer_token ? "definido" : null,
    active: row.active !== false,
    is_default: row.is_default === true,
    chip_state: chipState,
    connection_state: connState,
    connectionStatus: ["open", "connected", "online"].includes(connState)
      ? "open"
      : row.active !== false
      ? "active"
      : "disconnected",
    daily_limit_override: row.daily_limit_override != null ? Number(row.daily_limit_override) : null,
    owner_uid: row.owner_uid || null,
    sent_count_today: row.sent_count_today != null ? Number(row.sent_count_today) : 0,
    webhook_enabled: row.webhook_enabled === true,
    // Preenchido quando a configuracao remota do webhook falhou no salvamento.
    webhook_error: row.webhook_error || null,
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

  try {
    await pgDatabasePool.query(`
      CREATE TABLE IF NOT EXISTS public.leads_clients (
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `).catch(() => {});

    await pgDatabasePool.query(`
      CREATE TABLE IF NOT EXISTS public.lead_client_evolution_instances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Evolution',
        dispatch_webhook_url TEXT NOT NULL,
        dispatch_webhook_token TEXT,
        inbound_bearer_token TEXT,
        owner_uid TEXT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        is_default BOOLEAN NOT NULL DEFAULT false,
        webhook_enabled BOOLEAN NOT NULL DEFAULT false,
        chip_state TEXT NOT NULL DEFAULT 'cold',
        connection_state TEXT NOT NULL DEFAULT 'unknown',
        daily_limit_override INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by_uid TEXT,
        updated_by_email TEXT
      )
    `);

    await pgDatabasePool.query(`
      ALTER TABLE public.lead_client_evolution_instances
        ADD COLUMN IF NOT EXISTS connection_state TEXT NOT NULL DEFAULT 'unknown'
    `).catch(() => {});

    await pgDatabasePool.query(`
      ALTER TABLE public.lead_client_evolution_instances
        ADD COLUMN IF NOT EXISTS owner_uid TEXT NULL
    `).catch(() => {});

    await pgDatabasePool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_client_evolution_default
        ON public.lead_client_evolution_instances (client_id)
        WHERE is_default = true
    `).catch(() => {});

    await pgDatabasePool.query(`
      CREATE INDEX IF NOT EXISTS idx_lead_client_evolution_client
        ON public.lead_client_evolution_instances (client_id, active)
    `).catch(() => {});

    await pgDatabasePool.query(`
      CREATE INDEX IF NOT EXISTS idx_lead_client_evolution_owner_uid
        ON public.lead_client_evolution_instances (client_id, owner_uid)
    `).catch(() => {});

    await pgDatabasePool.query(`
      CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        instance_id UUID NOT NULL,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        sent_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(instance_id, date)
      )
    `).catch(() => {});

    _evolutionInstancesSchemaEnsured = true;
    return true;
  } catch (err) {
    console.warn("[evolution-instances] Table initialization warning:", err.message);
    _evolutionInstancesSchemaEnsured = true;
    return true;
  }
}

export function selectDefaultEvolutionInstance(instances = []) {
  if (!Array.isArray(instances)) return null;
  const active = instances.filter((i) => i && i.active !== false);
  if (active.length === 0) return null;
  return active.find((i) => i.is_default === true) || active[0] || null;
}

export async function getLeadClientEvolutionInstances(clientId, pool = null) {
  if (!clientId) return [];
  const db = pool || pgDatabasePool;
  if (!db) return [];
  try {
    if (db === pgDatabasePool) {
      await ensureLeadClientEvolutionInstancesTable();
    }
    const { rows } = await db.query(
      `
        SELECT i.id, i.client_id, i.name, i.dispatch_webhook_url, i.dispatch_webhook_token,
               i.inbound_bearer_token, i.owner_uid, i.active, i.is_default, i.chip_state, i.connection_state, i.daily_limit_override,
               i.webhook_enabled,
               i.created_at, i.updated_at, i.updated_by_email,
               COALESCE(u.sent_count, 0) AS sent_count_today
        FROM public.lead_client_evolution_instances i
        LEFT JOIN public.evolution_instance_daily_usage u
          ON u.instance_id = i.id AND u.date = CURRENT_DATE
        WHERE i.client_id = $1
        ORDER BY i.active DESC, i.is_default DESC, i.created_at ASC
      `,
      [clientId]
    );

    return rows;
  } catch (err) {
    console.error("[evolution-instances] Erro ao buscar instâncias Evolution para client:", {
      clientId,
      error: err?.message || err,
    });
    throw err;
  }
}

export async function getLeadClientEvolutionInstancesMap(clientIds) {
  if (!clientIds?.length) return {};
  if (!pgDatabasePool) return {};
  try {
    await ensureLeadClientEvolutionInstancesTable();

    const { rows } = await pgDatabasePool.query(
      `
        SELECT i.id, i.client_id, i.name, i.dispatch_webhook_url, i.dispatch_webhook_token,
               i.inbound_bearer_token, i.owner_uid, i.active, i.is_default, i.chip_state, i.connection_state, i.daily_limit_override,
               i.webhook_enabled,
               i.created_at, i.updated_at, i.updated_by_email,
               COALESCE(u.sent_count, 0) AS sent_count_today
        FROM public.lead_client_evolution_instances i
        LEFT JOIN public.evolution_instance_daily_usage u
          ON u.instance_id = i.id AND u.date = CURRENT_DATE
        WHERE i.client_id = ANY($1::text[])
        ORDER BY i.active DESC, i.is_default DESC, i.created_at ASC
      `,
      [clientIds]
    );

    return rows.reduce((acc, row) => {
      if (!acc[row.client_id]) acc[row.client_id] = [];
      acc[row.client_id].push(row);
      return acc;
    }, {});
  } catch (err) {
    console.error("[evolution-instances] Erro ao buscar mapa de instâncias Evolution:", {
      clientIds,
      error: err?.message || err,
    });
    throw err;
  }
}

export async function getDefaultLeadClientEvolutionInstance(clientId, pool = null) {
  const instances = await getLeadClientEvolutionInstances(clientId, pool);
  return selectDefaultEvolutionInstance(instances);
}

let syncProgressTableEnsured = false;
export async function ensureSyncProgressTable(pool = null) {
  const db = pool || pgDatabasePool;
  if (!db || syncProgressTableEnsured) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.whatsapp_instance_sync_progress (
        client_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        instance_name TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        total_chats INTEGER NOT NULL DEFAULT 0,
        processed_chats INTEGER NOT NULL DEFAULT 0,
        synced_chats INTEGER NOT NULL DEFAULT 0,
        inserted_messages INTEGER NOT NULL DEFAULT 0,
        last_remote_jid TEXT,
        current_batch INTEGER NOT NULL DEFAULT 0,
        total_batches INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        blocked_by_campaign TEXT,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (client_id, instance_id)
      )
    `);
    syncProgressTableEnsured = true;
  } catch (err) {
    console.warn("[sync-evolution] Erro ao assegurar tabela whatsapp_instance_sync_progress:", err?.message || err);
  }
}

// ATENÇÃO DE ESCALABILIDADE (Multi-Processo / Multi-Container):
// activeSyncsByChip é um Set em memória para este processo/container do Node.js.
// Ele impede cliques duplos e chamadas concorrentes paralelas no mesmo container (caso padrão de hoje).
// Caso a infraestrutura do backend seja escalada horizontalmente para rodar com mais de uma réplica/container,
// este lock em memória não atravessa processos. Quando isso ocorrer, substituir por um lock distribuído
// ou lock transacional a nível de banco de dados (ex: pg_try_advisory_xact_lock no Postgres ou checagem com
// SELECT FOR UPDATE / status='running' com timestamp recente na tabela public.whatsapp_instance_sync_progress)
// para garantir que duas réplicas não sincronizem o mesmo chip simultaneamente contra a Evolution.
const activeSyncsByChip = new Set();

export async function getEvolutionInstanceSyncProgress(clientId, instanceId, pool = null) {
  const db = pool || pgDatabasePool;
  if (!clientId || !instanceId || !db) {
    return {
      status: "idle",
      total_chats: 0,
      processed_chats: 0,
      synced_chats: 0,
      inserted_messages: 0,
      current_batch: 0,
      total_batches: 0,
    };
  }
  await ensureSyncProgressTable(db);
  try {
    const { rows } = await db.query(
      `SELECT * FROM public.whatsapp_instance_sync_progress WHERE client_id = $1 AND instance_id = $2`,
      [clientId, instanceId]
    );
    if (rows[0]) {
      const r = rows[0];
      const lockKey = `${clientId}:${instanceId}`;
      const isActuallyRunning = activeSyncsByChip.has(lockKey);
      const isStale =
        r.status === "running" &&
        !isActuallyRunning &&
        Date.now() - new Date(r.updated_at).getTime() > 5 * 60 * 1000;
      if (isStale) {
        return {
          ...r,
          status: "failed",
          error_message: "Sincronização interrompida",
        };
      }
      return r;
    }
  } catch (err) {
    console.warn("[getEvolutionInstanceSyncProgress] Erro ao consultar progresso:", err?.message || err);
  }
  return {
    status: "idle",
    total_chats: 0,
    processed_chats: 0,
    synced_chats: 0,
    inserted_messages: 0,
    current_batch: 0,
    total_batches: 0,
  };
}

export async function syncEvolutionInstanceChatsAndMessages(
  clientId,
  dispatchWebhookUrl,
  dispatchWebhookToken,
  options = {}
) {
  const db = options.pool || pgDatabasePool;
  const batchSize = Math.max(1, Number(options.batchSize) || 15);
  const batchPauseMs = Math.max(100, Number(options.batchPauseMs) || 1200);

  if (!dispatchWebhookUrl) return { error: "URL do webhook ausente" };

  const urlObj = new URL(dispatchWebhookUrl);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
  const parts = urlObj.pathname.split("/");
  const instanceName = parts[parts.length - 1];

  if (!instanceName) return { error: "Nome da instância ausente na URL" };

  let instanceId = options.instanceId || null;
  if (!instanceId && db) {
    try {
      const { rows } = await db.query(
        `SELECT id FROM public.lead_client_evolution_instances WHERE client_id = $1 AND dispatch_webhook_url = $2 LIMIT 1`,
        [clientId, dispatchWebhookUrl]
      );
      if (rows[0]?.id) instanceId = rows[0].id;
    } catch {}
  }
  const effectiveInstanceId = instanceId || instanceName;
  const lockKey = `${clientId}:${effectiveInstanceId}`;

  // Bloqueio de concorrência por chip: impede disparos sobrepostos no mesmo chip
  if (activeSyncsByChip.has(lockKey)) {
    console.warn(`[sync-evolution] Sincronização já em andamento para ${lockKey}. Ignorando chamada concorrente.`);
    return {
      instanceName,
      running: true,
      message: "Sincronização já em andamento para este chip.",
    };
  }

  // Trava imediata síncrona contra corridas de microtasks/event loop
  activeSyncsByChip.add(lockKey);

  try {
    await ensureSyncProgressTable(db);

    // Proteção de concorrência: se houver disparo em lote 'running' neste tenant, adia o sync
    // e avisa explicitamente com o nome da campanha que está bloqueando.
    if (db) {
      const { rows: runningDispatches } = await db.query(
        `SELECT id, name FROM public.campaign_dispatches WHERE client_id = $1 AND status = 'running' LIMIT 1`,
        [clientId]
      ).catch(() => ({ rows: [] }));

      if (runningDispatches && runningDispatches.length > 0) {
        const campaignName = runningDispatches[0].name || "Disparo ativo";
        console.warn(
          `[sync-evolution] Disparo em lote ativo no tenant (${campaignName}). Sincronização de histórico adiada para evitar sobrecarga no chip.`
        );
        await db.query(
          `INSERT INTO public.whatsapp_instance_sync_progress
             (client_id, instance_id, instance_name, status, blocked_by_campaign, updated_at)
           VALUES ($1, $2, $3, 'deferred', $4, now())
           ON CONFLICT (client_id, instance_id) DO UPDATE SET
             status = 'deferred',
             blocked_by_campaign = EXCLUDED.blocked_by_campaign,
             updated_at = now()`,
          [clientId, effectiveInstanceId, instanceName, campaignName]
        ).catch(() => {});

        return {
          instanceName,
          deferred: true,
          campaignName,
          message: `Sincronização adiada: a campanha "${campaignName}" está em disparo ativo neste tenant.`,
        };
      }
    }
    const apiKey = dispatchWebhookToken || getEvolutionAdminConfig().apiKey;

    // Sync Incremental: descobre a data da mensagem mais recente já gravada para esta instância
    let latestKnownTimestamp = null;
    if (db) {
      try {
        const { rows: tsRows } = await db.query(
          `SELECT MAX(message_timestamp) as latest_ts 
           FROM public.lead_messages 
           WHERE client_id = $1 AND instance_name = $2`,
          [clientId, instanceName]
        );
        if (tsRows[0]?.latest_ts) {
          latestKnownTimestamp = new Date(tsRows[0].latest_ts);
        }
      } catch (e) {
        console.warn("[sync-evolution] Erro ao buscar latestKnownTimestamp:", e.message);
      }
    }

    console.info(
      `[sync-evolution] Starting background sync for instance ${instanceName}...` +
      (latestKnownTimestamp ? ` (incremental a partir de ${latestKnownTimestamp.toISOString()})` : " (completo)")
    );

    // 1. Fetch chats from Evolution API.
    const chatsResponse = await fetch(`${baseUrl}/chat/findChats/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({}),
    });

    if (!chatsResponse.ok) {
      console.warn(`[sync-evolution] Failed to fetch chats for ${instanceName}: HTTP ${chatsResponse.status}`);
      if (db) {
        await db.query(
          `INSERT INTO public.whatsapp_instance_sync_progress
             (client_id, instance_id, instance_name, status, error_message, updated_at)
           VALUES ($1, $2, $3, 'failed', $4, now())
           ON CONFLICT (client_id, instance_id) DO UPDATE SET
             status = 'failed',
             error_message = EXCLUDED.error_message,
             updated_at = now()`,
          [clientId, effectiveInstanceId, instanceName, `HTTP ${chatsResponse.status}`]
        ).catch(() => {});
      }
      return { instanceName, chats: 0, synced: 0, messages: 0, error: `HTTP ${chatsResponse.status}` };
    }

    const rawChats = await chatsResponse.json();
    const chats = Array.isArray(rawChats) ? rawChats : (rawChats?.records || rawChats?.chats || []);
    if (!Array.isArray(chats)) {
      console.warn(`[sync-evolution] Evolution API did not return an array of chats:`, rawChats);
      return { instanceName, chats: 0, synced: 0, messages: 0, error: "resposta inválida da Evolution" };
    }

    // Ordenação determinística estável: evita pular conversas caso a lista retorne em ordem
    // de recência da Evolution e novos chats/mensagens desloquem os índices durante falha e retomada.
    chats.sort((a, b) => {
      const idA = String(a.remoteJid || a.id || "").toLowerCase();
      const idB = String(b.remoteJid || b.id || "").toLowerCase();
      return idA.localeCompare(idB);
    });

    // Checkpoint anterior: se o sync anterior falhou, verifica se dá para retomar a partir do último JID
    let startIndex = 0;
    let syncedChats = 0;
    let insertedMessages = 0;
    if (db) {
      try {
        const { rows: prevRows } = await db.query(
          `SELECT status, last_remote_jid, processed_chats, synced_chats, inserted_messages
           FROM public.whatsapp_instance_sync_progress
           WHERE client_id = $1 AND instance_id = $2`,
          [clientId, effectiveInstanceId]
        );
        const prev = prevRows[0];
        if (prev && prev.status === "failed" && prev.last_remote_jid) {
          const foundIdx = chats.findIndex(
            (c) => (c.remoteJid || c.id) === prev.last_remote_jid
          );
          if (foundIdx >= 0 && foundIdx < chats.length - 1) {
            startIndex = foundIdx + 1;
            syncedChats = prev.synced_chats || 0;
            insertedMessages = prev.inserted_messages || 0;
            console.info(
              `[sync-evolution] Retomando sincronização de ${instanceName} a partir do chat ${startIndex + 1} de ${chats.length} (checkpoint: ${prev.last_remote_jid})`
            );
          }
        }
      } catch (chkErr) {
        console.warn("[sync-evolution] Erro ao checar checkpoint prévio:", chkErr?.message || chkErr);
      }
    }

    const totalBatches = Math.ceil(chats.length / batchSize);

    // Registra início do sync com status 'running' no banco
    if (db) {
      await db.query(
        `INSERT INTO public.whatsapp_instance_sync_progress
           (client_id, instance_id, instance_name, status, total_chats, processed_chats, synced_chats, inserted_messages, total_batches, current_batch, started_at, updated_at)
         VALUES ($1, $2, $3, 'running', $4, $5, $6, $7, $8, $9, now(), now())
         ON CONFLICT (client_id, instance_id) DO UPDATE SET
           status = 'running',
           total_chats = EXCLUDED.total_chats,
           processed_chats = EXCLUDED.processed_chats,
           synced_chats = EXCLUDED.synced_chats,
           inserted_messages = EXCLUDED.inserted_messages,
           total_batches = EXCLUDED.total_batches,
           current_batch = EXCLUDED.current_batch,
           error_message = NULL,
           blocked_by_campaign = NULL,
           started_at = COALESCE(public.whatsapp_instance_sync_progress.started_at, now()),
           updated_at = now()`,
        [clientId, effectiveInstanceId, instanceName, chats.length, startIndex, syncedChats, insertedMessages, totalBatches, Math.floor(startIndex / batchSize) + 1]
      ).catch(() => {});
    }

    console.info(
      `[sync-evolution] Found ${chats.length} chats. Syncing all chats in batches of ${batchSize} with ${batchPauseMs}ms pauses (starting at chat ${startIndex + 1})...`
    );

    // Catálogo de contatos da instância: resolve o NOME e o TELEFONE de contatos LID
    const contactNameByKey = new Map();
    const phoneByLid = new Map();
    try {
      const ctRes = await fetch(`${baseUrl}/chat/findContacts/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({}),
      });
      if (ctRes.ok) {
        const ctData = await ctRes.json();
        const ctList = Array.isArray(ctData) ? ctData : (ctData?.records || ctData?.contacts || []);
        for (const ct of ctList) {
          const jid = String(ct?.remoteJid || ct?.id || "");
          const digits = jid.split("@")[0].replace(/\D/g, "");
          const nm = String(ct?.pushName || ct?.name || ct?.verifiedName || "").trim();
          if (digits && nm && !/^(você|voce)$/i.test(nm)) contactNameByKey.set(digits, nm);
          const alt = String(ct?.remoteJidAlt || ct?.jid || "");
          if (jid.includes("@lid") && alt.includes("@s.whatsapp.net")) {
            phoneByLid.set(digits, alt.split("@")[0].replace(/\D/g, ""));
          }
        }
      }
    } catch (e) {
      console.warn("[sync-evolution] findContacts indisponível:", e.message);
    }

    // Mapa persistente LID -> telefone
    const lidMap = new Map();
    if (db) {
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS public.whatsapp_lid_map (
            lid TEXT PRIMARY KEY,
            phone TEXT,
            contact_name TEXT,
            first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`).catch(() => {});
        await db.query(`ALTER TABLE public.whatsapp_lid_map ALTER COLUMN phone DROP NOT NULL`).catch(() => {});
        await db.query(`ALTER TABLE public.whatsapp_lid_map ADD COLUMN IF NOT EXISTS profile_pic TEXT`).catch(() => {});
        await db.query(`ALTER TABLE public.whatsapp_lid_map ADD COLUMN IF NOT EXISTS description TEXT`).catch(() => {});
        await db.query(`ALTER TABLE public.whatsapp_lid_map ADD COLUMN IF NOT EXISTS website TEXT`).catch(() => {});
        await db.query(`ALTER TABLE public.whatsapp_lid_map ADD COLUMN IF NOT EXISTS profile_checked BOOLEAN DEFAULT false`).catch(() => {});
        const { rows: lidRows } = await db.query(
          "SELECT lid, phone, contact_name, profile_pic, profile_checked FROM public.whatsapp_lid_map"
        );
        for (const r of lidRows) lidMap.set(r.lid, {
          phone: r.phone, name: r.contact_name, pic: r.profile_pic, checked: r.profile_checked === true,
        });
      } catch (e) {
        console.warn("[sync-evolution] lid_map indisponível:", e.message);
      }
    }

    const rememberLid = async (lid, ph, nm) => {
      if (!lid || !ph || !db) return;
      lidMap.set(lid, { phone: ph, name: nm || lidMap.get(lid)?.name || null });
      await db.query(
        `INSERT INTO public.whatsapp_lid_map (lid, phone, contact_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (lid) DO UPDATE SET
           phone = EXCLUDED.phone,
           contact_name = COALESCE(NULLIF(EXCLUDED.contact_name, ''), public.whatsapp_lid_map.contact_name),
           updated_at = now()`,
        [lid, ph, nm || null]
      ).catch(() => {});
    };

    // Processamento de TODOS os chats em lotes de batchSize (padrão 15)
    for (let i = startIndex; i < chats.length; i += batchSize) {
      const batchNumber = Math.floor(i / batchSize) + 1;
      const batchChats = chats.slice(i, i + batchSize);

      for (const chat of batchChats) {
        const remoteJid = chat.remoteJid || chat.id;
        if (!remoteJid || remoteJid.includes("@broadcast")) continue;

        const isGroup = remoteJid.includes("@g.us");
        const jidDigits = remoteJid.split("@")[0].replace(/\D/g, "");

        let phone = "";
        let chatName = "";

        if (!isGroup) {
          const altCandidates = [
            chat?.lastMessage?.key?.remoteJidAlt,
            chat?.lastMessage?.key?.participantAlt,
            chat?.lastMessage?.key?.senderPn,
            remoteJid.includes("@s.whatsapp.net") ? remoteJid : null,
          ];
          for (const c of altCandidates) {
            const v = String(c || "");
            if (v.includes("@s.whatsapp.net")) { phone = v.split("@")[0]; break; }
          }
        }
        {
          const nm = String(chat?.pushName || chat?.name || "").trim();
          if (nm && !/^(você|voce)$/i.test(nm) && !/^\+?\d[\d\s\-()]*$/.test(nm)) chatName = nm;
        }

        let knownEntry = null;
        if (!isGroup) {
          knownEntry = lidMap.get(remoteJid) || lidMap.get(jidDigits) || null;
          if (knownEntry) {
            if (!phone && knownEntry.phone) phone = knownEntry.phone;
            if (!chatName && knownEntry.name) chatName = knownEntry.name;
          }
        }

        if (!isGroup && !chatName && remoteJid.includes("@lid") && !knownEntry?.checked) {
          try {
            const pf = await fetch(`${baseUrl}/chat/fetchProfile/${encodeURIComponent(instanceName)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: apiKey },
              body: JSON.stringify({ number: remoteJid }),
            });
            if (pf.ok) {
              const prof = await pf.json();
              const desc = String(prof?.description || "").trim();
              const site = String(prof?.website || "").trim();
              let derived = desc;
              if (!derived && site) {
                try {
                  const host = new URL(site.startsWith("http") ? site : `https://${site}`).hostname;
                  derived = host.replace(/^www\./, "").split(".")[0];
                } catch {}
              }
              if (derived) chatName = derived;
              if (db) {
                await db.query(
                  `INSERT INTO public.whatsapp_lid_map (lid, contact_name, profile_pic, description, website, profile_checked)
                   VALUES ($1, $2, $3, $4, $5, true)
                   ON CONFLICT (lid) DO UPDATE SET
                     contact_name = COALESCE(NULLIF(public.whatsapp_lid_map.contact_name, ''), EXCLUDED.contact_name),
                     profile_pic = COALESCE(EXCLUDED.profile_pic, public.whatsapp_lid_map.profile_pic),
                     description = COALESCE(EXCLUDED.description, public.whatsapp_lid_map.description),
                     website = COALESCE(EXCLUDED.website, public.whatsapp_lid_map.website),
                     profile_checked = true,
                     updated_at = now()`,
                  [remoteJid, derived || null, prof?.picture || null, desc || null, site || null]
                ).catch(() => {});
              }
              lidMap.set(remoteJid, { ...(knownEntry || {}), name: derived || knownEntry?.name || null, checked: true });
            }
          } catch (e) {}
        }
        if (!isGroup && phone && remoteJid.includes("@lid")) {
          await rememberLid(remoteJid, phone, chatName);
        }

        // 2. Fetch messages for each chat
        try {
          const messageLimit = latestKnownTimestamp ? 25 : 60;
          const msgsResponse = await fetch(`${baseUrl}/chat/findMessages/${encodeURIComponent(instanceName)}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: apiKey,
            },
            body: JSON.stringify({
              where: {
                key: {
                  remoteJid: remoteJid,
                },
              },
              limit: messageLimit,
            }),
          });

          if (!msgsResponse.ok) {
            console.warn(`[sync-evolution] Failed to fetch messages for chat ${remoteJid}: HTTP ${msgsResponse.status}`);
            continue;
          }

          const msgsData = await msgsResponse.json();
          const messages = Array.isArray(msgsData)
            ? msgsData
            : Array.isArray(msgsData?.messages?.records)
              ? msgsData.messages.records
              : Array.isArray(msgsData?.records)
                ? msgsData.records
                : Array.isArray(msgsData?.messages)
                  ? msgsData.messages
                  : [];

          for (const m of messages) {
            if (!phone) {
              const candidates = [
                m?.key?.remoteJidAlt,
                m?.key?.participantAlt,
                m?.key?.senderPn,
                m?.participant,
                m?.key?.participant,
                m?.contextInfo?.participant,
              ];
              for (const c of candidates) {
                const v = String(c || "");
                if (v.includes("@s.whatsapp.net")) { phone = v.split("@")[0]; break; }
              }
            }
            if (!chatName && m?.key?.fromMe === false) {
              const nm = String(m?.pushName || "").trim();
              if (nm && !/^(você|voce)$/i.test(nm) && !/^\+?\d[\d\s\-()]*$/.test(nm)) chatName = nm;
            }
            if (phone && chatName) break;
          }

          if (!phone && !isGroup) phone = phoneByLid.get(jidDigits) || "";
          if (!phone) phone = remoteJid.includes("@s.whatsapp.net") ? remoteJid.split("@")[0] : remoteJid;
          if (!chatName) {
            const cands = [
              String(chat.pushName || "").trim(),
              String(chat.name || "").trim(),
              contactNameByKey.get(jidDigits),
              contactNameByKey.get(String(phone).replace(/\D/g, "")),
            ];
            chatName = cands.find(
              (n) => n && !/^(você|voce)$/i.test(n) && !/^\+?\d[\d\s\-()]*$/.test(n)
            ) || "";
          }
          if (phone && remoteJid.includes("@lid")) {
            await rememberLid(remoteJid, phone, chatName);
          }
          if (!phone) continue;
          if (!Array.isArray(messages)) continue;

          let leadId = null;
          let campaignId = null;
          if (db) {
            const leadRes = await db.query(
              `SELECT id, source_campaign_id 
               FROM public.leads 
               WHERE client_id = $1 AND (telefone = $2 OR telefone = $3 OR telefone = $4)
               ORDER BY created_at DESC 
               LIMIT 1`,
              [
                clientId,
                phone,
                phone.replace(/^55/, ""),
                phone.startsWith("55") ? phone : `55${phone}`,
              ]
            ).catch(() => ({ rows: [] }));
            leadId = leadRes.rows[0]?.id || null;
            campaignId = leadRes.rows[0]?.source_campaign_id || null;
          }

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

            if (latestKnownTimestamp && timestamp <= latestKnownTimestamp) {
              break;
            }

            const waMessageId = msg.key?.id ? String(msg.key.id).trim() : null;

            if (waMessageId && db) {
              try {
                const insertRes = await db.query(
                  `INSERT INTO public.lead_messages 
                     (client_id, lead_id, campaign_id, phone, sender_type, direction, message_text, created_at, delivered_at, message_timestamp, meta, instance_name, contact_name, is_group, wa_message_id)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11, $12, $13, $14)
                   ON CONFLICT (client_id, wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
                   RETURNING id`,
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
                    JSON.stringify({}),
                    instanceName,
                    chatName || null,
                    isGroup,
                    waMessageId,
                  ]
                );
                if (insertRes.rowCount > 0) {
                  insertedMessages++;
                }
              } catch (fkErr) {
                if (fkErr.code === "23503" || String(fkErr.message).includes("foreign key")) {
                  const retryRes = await db.query(
                    `INSERT INTO public.lead_messages 
                       (client_id, lead_id, campaign_id, phone, sender_type, direction, message_text, created_at, delivered_at, message_timestamp, meta, instance_name, contact_name, is_group, wa_message_id)
                     VALUES ($1, $2, NULL, $4, $5, $6, $7, NOW(), $8, $9, $10, $11, $12, $13, $14)
                     ON CONFLICT (client_id, wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
                     RETURNING id`,
                    [
                      clientId,
                      leadId,
                      phone,
                      fromMe ? "user" : "lead",
                      fromMe ? "outbound" : "inbound",
                      messageText,
                      timestamp,
                      timestamp,
                      JSON.stringify({}),
                      instanceName,
                      chatName || null,
                      isGroup,
                      waMessageId,
                    ]
                  ).catch(() => ({ rowCount: 0 }));
                  if (retryRes.rowCount > 0) {
                    insertedMessages++;
                  }
                }
              }
            } else if (db) {
              try {
                const checkRes = await db.query(
                  `SELECT id 
                   FROM public.lead_messages
                   WHERE client_id = $1 AND phone = $2 AND message_text = $3
                     AND (
                       (message_timestamp >= $4 AND message_timestamp <= $5)
                       OR (created_at >= $4 AND created_at <= $5)
                     )
                   LIMIT 1`,
                  [
                    clientId,
                    phone,
                    messageText,
                    new Date(timestamp.getTime() - 5000),
                    new Date(timestamp.getTime() + 5000),
                  ]
                );

                if (checkRes.rowCount === 0) {
                  await db.query(
                    `INSERT INTO public.lead_messages 
                       (client_id, lead_id, campaign_id, phone, sender_type, direction, message_text, created_at, delivered_at, message_timestamp, meta, instance_name, contact_name, is_group)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11, $12, $13)`,
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
                      JSON.stringify({}),
                      instanceName,
                      chatName || null,
                      isGroup,
                    ]
                  ).catch(() => {});
                  insertedMessages++;
                }
              } catch (fallbackErr) {}
            }
          }
          syncedChats++;
          // Micro-throttle de 80ms entre chats dentro do lote para estabilidade do socket Baileys
          await new Promise((r) => setTimeout(r, 80));
        } catch (chatErr) {
          console.error(`[sync-evolution] Error syncing messages for chat ${remoteJid}:`, chatErr.message || chatErr);
        }
      }

      // Checkpoint após término de cada lote de 15 conversas
      const processedCount = Math.min(i + batchChats.length, chats.length);
      const lastChatInBatch = batchChats[batchChats.length - 1];
      const lastRemoteJid = lastChatInBatch ? (lastChatInBatch.remoteJid || lastChatInBatch.id) : null;

      if (db) {
        await db.query(
          `UPDATE public.whatsapp_instance_sync_progress
           SET processed_chats = $1,
               synced_chats = $2,
               inserted_messages = $3,
               current_batch = $4,
               last_remote_jid = $5,
               updated_at = now()
           WHERE client_id = $6 AND instance_id = $7`,
          [processedCount, syncedChats, insertedMessages, batchNumber, lastRemoteJid, clientId, effectiveInstanceId]
        ).catch(() => {});
      }

      // Pausa controlada (padrão 1.2s) entre lotes para não sobrecarregar a Evolution
      if (i + batchSize < chats.length) {
        await new Promise((r) => setTimeout(r, batchPauseMs));
      }
    }

    // Marca conclusão com sucesso
    if (db) {
      await db.query(
        `UPDATE public.whatsapp_instance_sync_progress
         SET status = 'completed',
             processed_chats = total_chats,
             synced_chats = $1,
             inserted_messages = $2,
             finished_at = now(),
             updated_at = now()
         WHERE client_id = $3 AND instance_id = $4`,
        [syncedChats, insertedMessages, clientId, effectiveInstanceId]
      ).catch(() => {});
    }

    console.info(`[sync-evolution] Instance ${instanceName}: ${syncedChats} conversas processadas, ${insertedMessages} mensagens novas.`);
    return { instanceName, chats: chats.length, synced: syncedChats, messages: insertedMessages, error: null };
  } catch (err) {
    console.error(`[sync-evolution] Background sync error:`, err.message || err);
    if (db) {
      await db.query(
        `UPDATE public.whatsapp_instance_sync_progress
         SET status = 'failed',
             error_message = $1,
             updated_at = now()
         WHERE client_id = $2 AND instance_id = $3`,
        [err?.message || "erro no sync", clientId, effectiveInstanceId]
      ).catch(() => {});
    }
    return { instanceName: null, chats: 0, synced: 0, messages: 0, error: err?.message || "erro no sync" };
  } finally {
    activeSyncsByChip.delete(lockKey);
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
    throw new Error("INSTANCE_NAME_NOT_FOUND_IN_URL");
  }

  const apiKey = dispatchWebhookToken || getEvolutionAdminConfig().apiKey;

  const base =
    process.env.WEBHOOK_BASE_URL ||
    process.env.VITE_BACKEND_URL ||
    process.env.BACKEND_URL ||
    null;

  if (!base) {
    throw new Error("WEBHOOK_BASE_URL_UNDEFINED");
  }

  // Previne duplicação de /api/api/... na URL do webhook
  const webhookUrl =
    `${base}/api/hardcoded-chat-webhook` +
    `?token=master_secret_2026&client_id=${encodeURIComponent(clientId)}&clientId=${encodeURIComponent(clientId)}&instanceName=${encodeURIComponent(instanceName)}`;

  // Evolution API v2 exige o payload ANINHADO em { webhook: {...} } e usa
  // webhookByEvents (não byEvents). No formato antigo (plano) a v2 responde
  // HTTP 400: instance requires property "webhook".
  const payload = {
    webhook: {
      enabled: Boolean(enabled),
      url: webhookUrl,
      webhookByEvents: false,
      events: enabled ? ["MESSAGES_UPSERT", "SEND_MESSAGE"] : [],
    },
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

  // Sincronização de histórico desacoplada: NÃO roda como efeito colateral de salvar webhook.
  // O usuário sincroniza explicitamente quando desejar pela tela de Conexões.
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
  const connectionState = Object.prototype.hasOwnProperty.call(body, "connectionState")
    ? normalizeString(body.connectionState) || "unknown"
    : existing?.connection_state || "unknown";
  const rawLimit = Object.prototype.hasOwnProperty.call(body, "dailyLimitOverride")
    ? body.dailyLimitOverride
    : existing?.daily_limit_override ?? null;
  const dailyLimitOverride =
    rawLimit == null ? null : Number.isInteger(Number(rawLimit)) && Number(rawLimit) > 0 ? Number(rawLimit) : null;

  const ownerUid = Object.prototype.hasOwnProperty.call(body, "ownerUid")
    ? (normalizeString(body.ownerUid) || null)
    : Object.prototype.hasOwnProperty.call(body, "owner_uid")
    ? (normalizeString(body.owner_uid) || null)
    : (existing?.owner_uid || null);

  const webhookEnabled = Object.prototype.hasOwnProperty.call(body, "webhookEnabled")
    ? body.webhookEnabled === true
    : existing?.webhook_enabled === true;

  const payload = {
    client_id: clientId,
    name,
    dispatch_webhook_url: dispatchWebhookUrl,
    chip_state: chipState,
    connection_state: connectionState,
    daily_limit_override: dailyLimitOverride,
    owner_uid: ownerUid,
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
              updated_by_email = $11,
              connection_state = $12,
              owner_uid = $13
          WHERE id = $14 AND client_id = $15
          RETURNING id, client_id, name, dispatch_webhook_url, dispatch_webhook_token,
                    inbound_bearer_token, owner_uid, active, is_default, chip_state, connection_state, daily_limit_override,
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
          payload.connection_state,
          payload.owner_uid,
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
             owner_uid, active, is_default, chip_state, connection_state, daily_limit_override, webhook_enabled, updated_by_uid, updated_by_email)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING id, client_id, name, dispatch_webhook_url, dispatch_webhook_token,
                    inbound_bearer_token, owner_uid, active, is_default, chip_state, connection_state, daily_limit_override,
                    webhook_enabled,
                    created_at, updated_at, updated_by_email
        `,
        [
          clientId,
          payload.name,
          payload.dispatch_webhook_url,
          payload.dispatch_webhook_token,
          payload.inbound_bearer_token,
          payload.owner_uid,
          payload.active,
          shouldDefault,
          payload.chip_state,
          payload.connection_state,
          payload.daily_limit_override,
          payload.webhook_enabled,
          payload.updated_by_uid,
          payload.updated_by_email,
        ]
      );
    }

    await client.query("COMMIT");

    // Configure the webhook remotely on Evolution API.
    // A assinatura é (clientId, dispatchWebhookUrl, dispatchWebhookToken, enabled) e a
    // função deriva o instanceName da própria URL. A chamada anterior passava
    // (clientId, instanceName, webhookEnabled) — argumentos trocados: o nome da
    // instância caía no lugar da URL e `new URL("<nome>")` estourava "Invalid URL".
    if (result.rows[0]?.dispatch_webhook_url) {
      const parts = result.rows[0].dispatch_webhook_url.split("/");
      const instanceName = parts[parts.length - 1];
      if (instanceName) {
        // Antes era fire-and-forget com catch que so logava: quando o webhook
        // nao era configurado (ex.: WEBHOOK_BASE_URL ausente), a tela dizia que
        // salvou e o numero ficava sem receber mensagem, sem nenhum aviso.
        // O salvamento do chip continua valendo — o erro vai junto na resposta.
        try {
          await configureEvolutionInstanceWebhook(
            clientId,
            result.rows[0].dispatch_webhook_url,
            result.rows[0].dispatch_webhook_token,
            result.rows[0].webhook_enabled
          );
          result.rows[0].webhook_error = null;
        } catch (err) {
          const message = err?.message || String(err);
          console.error(`[evolution-webhook] Failed to configure remote webhook for ${instanceName}:`, message);
          result.rows[0].webhook_error =
            message === "WEBHOOK_BASE_URL_UNDEFINED"
              ? "WEBHOOK_BASE_URL nao esta configurada no servidor: o numero nao vai receber mensagens."
              : `Nao foi possivel configurar o webhook na Evolution: ${message}`;
        }
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
  const baseUrl = (
    normalizeString(process.env.EVOLUTION_API_URL) ||
    normalizeString(process.env.EVOLUTION_API_ENDPOINT) ||
    "https://vexo-evolution-api.xdvm8y.easypanel.host"
  ).replace(/\/+$/, "");

  const apiKey =
    normalizeString(process.env.EVOLUTION_API_KEY) ||
    normalizeString(process.env.EVOLUTION_GLOBAL_KEY) ||
    "429683C4C977415CAAFCCE10F7D57E11";

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
    const errorMsg =
      normalizeString(responsePayload?.message) ||
      normalizeString(responsePayload?.error) ||
      (Array.isArray(responsePayload?.response?.message) ? responsePayload.response.message.join(", ") : "");

    // Tentar fallback para /instance/connect se a instância já existir ou estiver criada
    try {
      const connectResponse = await fetch(`${config.baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`, {
        method: "GET",
        headers: {
          apikey: config.apiKey,
        },
      });
      if (connectResponse.ok) {
        const connectText = await connectResponse.text();
        if (connectText) {
          const connectPayload = JSON.parse(connectText);
          if (connectPayload && (connectPayload.code || connectPayload.base64 || connectPayload.instance || connectPayload.count != null)) {
            responsePayload = {
              instance: { instanceName, status: connectPayload.status || "connecting" },
              qrcode: connectPayload.base64 || connectPayload.code ? { code: connectPayload.code, base64: connectPayload.base64 } : connectPayload.qrcode || null,
            };
          }
        }
      }
    } catch (fallbackErr) {
      console.warn(`[evolution] Fallback /instance/connect for ${instanceName} failed:`, fallbackErr.message);
    }

    if (!responsePayload || (!responsePayload.qrcode && !responsePayload.instance && !responsePayload.instanceName)) {
      const error = new Error(
        errorMsg || `Evolution API HTTP ${response.status}`
      );
      error.statusCode = response.status;
      error.code = "EVOLUTION_INSTANCE_PROVISION_FAILED";
      throw error;
    }
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

/**
 * Consulta na Evolution API se uma lista de números de telefone existe no WhatsApp.
 * Endpoint: POST /chat/whatsappNumbers/{instance}
 * Retorna array de { number, exists, jid } ou erro se a chamada falhar.
 */
export async function checkWhatsappNumbers({ webhookUrl, webhookToken, numbers = [] }) {
  const endpoint = parseEvolutionWebhookEndpoint(webhookUrl);
  if (!endpoint) {
    return { results: [], error: "URL Evolution invalida" };
  }

  const cleanNumbers = Array.from(
    new Set(
      (numbers || [])
        .map((n) => normalizeString(n).replace(/\D/g, ""))
        .filter(Boolean)
    )
  );

  if (cleanNumbers.length === 0) {
    return { results: [], error: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const url = `${endpoint.origin}/chat/whatsappNumbers/${encodeURIComponent(endpoint.instance)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...buildEvolutionAuthHeaders(webhookToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ numbers: cleanNumbers }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return { results: [], error: `Evolution HTTP ${response.status}: ${errText.slice(0, 200)}` };
    }

    const payload = await response.json().catch(() => []);
    const list = Array.isArray(payload) ? payload : Array.isArray(payload?.response) ? payload.response : [];

    return {
      results: list.map((item) => ({
        number: normalizeString(item.number || item.jid?.split("@")[0] || "").replace(/\D/g, ""),
        exists: Boolean(item.exists),
        jid: item.jid || null,
      })),
      error: null,
    };
  } catch (err) {
    return { results: [], error: err?.message || String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Validação de números com cache de 30 dias no Postgres.
 * Números já validados nos últimos 30 dias não batem na Evolution novamente.
 * Se a API da Evolution falhar (timeout/500), NÃO trava o lote: os números não-verificados
 * são retornados com exists: true e validated: false para permitir continuidade segura.
 */
export async function validateWhatsappNumbersWithCache({ pool, webhookUrl, webhookToken, phones = [] }) {
  const rawList = (phones || [])
    .map((p) => normalizeString(p).replace(/\D/g, ""))
    .filter(Boolean);
  const uniquePhones = [...new Set(rawList)];

  if (uniquePhones.length === 0) {
    return new Map();
  }

  const resultMap = new Map();

  // 1. Consulta cache de 30 dias se pool disponível
  let missingPhones = [...uniquePhones];
  if (pool) {
    try {
      const cached = await pool.query(
        `SELECT phone, exists_whatsapp, validated_at 
         FROM public.whatsapp_number_validations 
         WHERE phone = ANY($1) 
           AND validated_at >= now() - INTERVAL '30 days'`,
        [uniquePhones]
      );
      for (const row of cached.rows || []) {
        const p = normalizeString(row.phone).replace(/\D/g, "");
        resultMap.set(p, { exists: Boolean(row.exists_whatsapp), validated: true, cached: true });
      }
      missingPhones = uniquePhones.filter((p) => !resultMap.has(p));
    } catch (err) {
      console.warn("[whatsapp-validation] aviso ao consultar cache:", err.message || err);
    }
  }

  if (missingPhones.length === 0) {
    return resultMap;
  }

  // 2. Chama Evolution API em lotes de 50 para os não-cacheados
  const BATCH_SIZE = 50;
  for (let i = 0; i < missingPhones.length; i += BATCH_SIZE) {
    const batch = missingPhones.slice(i, i + BATCH_SIZE);
    const { results, error } = await checkWhatsappNumbers({
      webhookUrl,
      webhookToken,
      numbers: batch,
    });

    if (error) {
      console.warn("[whatsapp-validation] Falha na verificação da Evolution (lote continuará sem travar):", error);
      for (const p of batch) {
        if (!resultMap.has(p)) {
          resultMap.set(p, { exists: true, validated: false, unverifiedReason: error });
        }
      }
      continue;
    }

    const validatedBatch = [];
    const returnedSet = new Set();
    for (const res of results || []) {
      const p = normalizeString(res.number).replace(/\D/g, "");
      if (!p) continue;
      returnedSet.add(p);
      resultMap.set(p, { exists: Boolean(res.exists), validated: true, jid: res.jid });
      validatedBatch.push({ phone: p, exists: Boolean(res.exists), jid: res.jid });
    }

    for (const p of batch) {
      if (!returnedSet.has(p) && !resultMap.has(p)) {
        resultMap.set(p, { exists: true, validated: false });
      }
    }

    // 3. Salva no banco de validações (cache)
    if (pool && validatedBatch.length > 0) {
      try {
        for (const item of validatedBatch) {
          await pool.query(
            `INSERT INTO public.whatsapp_number_validations (phone, exists_whatsapp, jid, validated_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (phone) DO UPDATE 
               SET exists_whatsapp = EXCLUDED.exists_whatsapp,
                   jid = EXCLUDED.jid,
                   validated_at = now()`,
            [item.phone, item.exists, item.jid || null]
          );
        }
      } catch (saveErr) {
        console.warn("[whatsapp-validation] aviso ao salvar cache no banco:", saveErr.message || saveErr);
      }
    }
  }

  return resultMap;
}

/**
 * Helper único de resolução de identificador de chip / instância Evolution.
 * Aceita qualquer um dos três formatos:
 * 1. name (amigável, ex: "GD Priscila")
 * 2. id (UUID, ex: "73ba3e2a-d8c6-4502-a83c-6d6cf1e82d21")
 * 3. urlSuffix (último segmento da URL do dispatch_webhook_url, ex: "geracao-digital-gd-priscila")
 * Aceita também múltiplos identificadores separados por vírgula ("Chip 1,Chip 2") para filtros.
 *
 * Devolve:
 * - canonicalName: a forma canônica da instância (urlSuffix da Evolution, ou name)
 * - aliases: lista de todos os formatos conhecidos do chip para uso em WHERE instance_name = ANY($n)
 * - chip: o objeto da instância em lead_client_evolution_instances
 */
const warnedUnmappedChips = new Map();

export async function resolveInstanceIdentifier({ clientId, identifier = null, pool = null, dbPool = null }) {
  const db = pool || dbPool || pgDatabasePool;
  if (!clientId || !db) return { canonicalName: null, aliases: [], chip: null };

  const raw = identifier != null ? String(identifier).trim() : "";
  if (!raw || raw === "all") return { canonicalName: null, aliases: [], chip: null };

  const requested = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (requested.length === 0) return { canonicalName: null, aliases: [], chip: null };

  let instances = [];
  try {
    instances = await getLeadClientEvolutionInstances(clientId, db);
  } catch (err) {
    console.warn("[resolveInstanceIdentifier] Erro ao buscar instâncias:", err?.message || err);
    return { canonicalName: requested[0], aliases: requested, chip: null };
  }

  const aliasesSet = new Set();
  let firstCanonical = null;
  let matchedChip = null;

  for (const wanted of requested) {
    aliasesSet.add(wanted);
    const matched = (instances || []).find((inst) => {
      const urlSuffix = inst.dispatch_webhook_url
        ? inst.dispatch_webhook_url.split("/").filter(Boolean).pop()
        : null;
      return inst.name === wanted || inst.id === wanted || urlSuffix === wanted;
    });

    if (matched) {
      if (!matchedChip) matchedChip = matched;
      const urlSuffix = matched.dispatch_webhook_url
        ? matched.dispatch_webhook_url.split("/").filter(Boolean).pop()
        : null;
      const canonical = urlSuffix || matched.name || matched.id;
      if (!firstCanonical) firstCanonical = canonical;

      if (matched.name) aliasesSet.add(matched.name);
      if (matched.id) aliasesSet.add(matched.id);
      if (urlSuffix) aliasesSet.add(urlSuffix);
    }
  }

  if (requested.length > 0 && !matchedChip) {
    const warnKey = `${clientId}:${raw}`;
    const now = Date.now();
    const lastWarn = warnedUnmappedChips.get(warnKey) || 0;
    // Rate-limit: avisa no máximo 1 vez a cada 10 minutos por combinação tenant:chip
    // para não inundar logs durante syncs massivos de histórico (ex: GMCA)
    if (now - lastWarn > 10 * 60 * 1000) {
      warnedUnmappedChips.set(warnKey, now);
      if (warnedUnmappedChips.size > 500) {
        const oldestKey = warnedUnmappedChips.keys().next().value;
        if (oldestKey) warnedUnmappedChips.delete(oldestKey);
      }
      const knownChips = (instances || []).map((inst) => {
        const urlSuffix = inst.dispatch_webhook_url
          ? inst.dispatch_webhook_url.split("/").filter(Boolean).pop()
          : null;
        return `"${inst.name || "sem-nome"}" (id: ${inst.id}${urlSuffix ? `, urlSuffix: ${urlSuffix}` : ""})`;
      });
      console.warn(
        `[resolveInstanceIdentifier] Identificador de chip "${raw}" não corresponde a nenhum chip cadastrado para o tenant "${clientId}". Chips cadastrados (${instances?.length || 0}):`,
        knownChips.length > 0 ? knownChips.join(", ") : "[nenhum chip cadastrado]"
      );
    }
  }

  return {
    canonicalName: firstCanonical || requested[0],
    aliases: Array.from(aliasesSet),
    chip: matchedChip,
  };
}

/**
 * Resolve o dono (owner_uid) do chip/instância que recebeu uma mensagem inbound.
 * Delega para resolveInstanceIdentifier para garantir regra única de correspondência.
 * Devolve owner_uid (string) ou null.
 */
export async function resolveEvolutionInstanceOwner({ clientId, instanceName = null, pool = null, dbPool = null }) {
  const { chip } = await resolveInstanceIdentifier({ clientId, identifier: instanceName, pool, dbPool });
  return chip?.owner_uid || null;
}

/**
 * Puxa o base64 de uma mensagem de mídia sob demanda da Evolution API.
 * Formatos suportados:
 * 1. Objeto completo recebido no webhook: { message: data, convertToMp4: false } (~43ms)
 * 2. Somente a chave wa_message_id na cascata: { message: { key: { id: waMessageId } }, convertToMp4: false } (~200-300ms)
 */
export async function fetchMediaBase64FromEvolution(instanceName, messagePayload) {
  if (!instanceName || !messagePayload) return null;
  const baseUrl = normalizeHttpUrl(process.env.EVOLUTION_API_URL) || "https://vexo-evolution-api.xdvm8y.easypanel.host";
  const apiKey = process.env.EVOLUTION_API_KEY || process.env.GD_EVOLUTION_API_TOKEN;
  if (!apiKey) {
    console.warn("[evolution] EVOLUTION_API_KEY não configurada para fetchMediaBase64FromEvolution");
    return null;
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`;

  let bodyPayload;
  if (messagePayload && typeof messagePayload === "object" && "message" in messagePayload) {
    bodyPayload = messagePayload;
  } else if (typeof messagePayload === "string") {
    bodyPayload = {
      message: { key: { id: messagePayload } },
      convertToMp4: false,
    };
  } else {
    bodyPayload = {
      message: messagePayload,
      convertToMp4: false,
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildEvolutionAuthHeaders(apiKey),
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[evolution] getBase64FromMediaMessage HTTP ${res.status} para instância "${instanceName}"`);
      return null;
    }

    const data = await res.json();
    if (data?.base64) {
      return {
        base64: data.base64,
        mimetype: data.mimetype || null,
      };
    }
    return null;
  } catch (err) {
    console.warn(`[evolution] Erro ao buscar base64 da mídia para "${instanceName}":`, err.message || err);
    return null;
  }
}

/**
 * Envia mensagem com mídia através da Evolution API.
 * Suporta áudio nativo (sendWhatsAppAudio com encoding: true para PTT/waveform)
 * e outros formatos (sendMedia para imagem, vídeo, documento, figurinha).
 */
export async function sendMediaMessageViaEvolution({
  instanceName,
  number,
  mediaType,
  base64,
  mimetype,
  fileName = null,
  caption = "",
  webhookToken = null,
  baseUrl = null,
}) {
  if (!instanceName || !number || !base64) {
    throw new Error("Parâmetros obrigatórios ausentes (instanceName, number, base64)");
  }

  const effectiveBaseUrl = normalizeHttpUrl(baseUrl) || normalizeHttpUrl(process.env.EVOLUTION_API_URL) || "https://vexo-evolution-api.xdvm8y.easypanel.host";
  const apiKey = webhookToken || process.env.EVOLUTION_API_KEY || process.env.GD_EVOLUTION_API_TOKEN;

  if (!apiKey) {
    throw new Error("Chave de autenticação da Evolution não configurada");
  }

  const headers = {
    "Content-Type": "application/json",
    ...buildEvolutionAuthHeaders(apiKey),
  };

  const isAudio = mediaType === "audio";
  const endpoint = isAudio
    ? `${effectiveBaseUrl.replace(/\/+$/, "")}/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`
    : `${effectiveBaseUrl.replace(/\/+$/, "")}/message/sendMedia/${encodeURIComponent(instanceName)}`;

  let payload;
  if (isAudio) {
    payload = {
      number,
      audio: base64,
      encoding: true,
    };
  } else {
    payload = {
      number,
      mediatype: mediaType,
      mimetype: mimetype || "application/octet-stream",
      media: base64,
      fileName: fileName || `${mediaType}`,
      caption: caption || "",
    };
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const resText = await res.text();
  if (!res.ok) {
    throw new Error(`Evolution HTTP ${res.status}: ${resText}`);
  }

  try {
    const data = JSON.parse(resText);
    const waMessageId = data?.key?.id || data?.id || null;
    return {
      success: true,
      waMessageId,
      raw: data,
    };
  } catch {
    return {
      success: true,
      waMessageId: null,
      raw: resText,
    };
  }
}

/**
 * Apaga mensagem para todos no WhatsApp via Evolution API.
 * Se a janela de exclusão do WhatsApp expirou (~48 horas), a Evolution recusa com HTTP 400.
 */
export async function deleteMessageViaEvolution({
  instanceName,
  waMessageId,
  remoteJid,
  fromMe = true,
  webhookToken = null,
  baseUrl = null,
}) {
  if (!instanceName || !waMessageId || !remoteJid) {
    throw new Error("Parâmetros obrigatórios ausentes (instanceName, waMessageId, remoteJid)");
  }

  const effectiveBaseUrl = normalizeHttpUrl(baseUrl) || normalizeHttpUrl(process.env.EVOLUTION_API_URL) || "https://vexo-evolution-api.xdvm8y.easypanel.host";
  const apiKey = webhookToken || process.env.EVOLUTION_API_KEY || process.env.GD_EVOLUTION_API_TOKEN;

  if (!apiKey) {
    throw new Error("Chave de autenticação da Evolution não configurada");
  }

  const headers = {
    "Content-Type": "application/json",
    ...buildEvolutionAuthHeaders(apiKey),
  };

  const endpoint = `${effectiveBaseUrl.replace(/\/+$/, "")}/chat/deleteMessageForEveryone/${encodeURIComponent(instanceName)}`;
  const payload = {
    id: waMessageId,
    remoteJid,
    fromMe: Boolean(fromMe),
  };

  const res = await fetch(endpoint, {
    method: "DELETE",
    headers,
    body: JSON.stringify(payload),
  });

  const resText = await res.text();
  if (!res.ok) {
    const error = new Error(`Evolution HTTP ${res.status}: ${resText}`);
    error.status = res.status;
    error.responseBody = resText;
    throw error;
  }

  try {
    return { success: true, data: JSON.parse(resText) };
  } catch {
    return { success: true, raw: resText };
  }
}

/**
 * Busca URL da foto de perfil do contato via Evolution API.
 */
export async function fetchProfilePictureUrlViaEvolution({
  instanceName,
  number,
  webhookToken = null,
  baseUrl = null,
}) {
  if (!instanceName || !number) return null;

  const effectiveBaseUrl = normalizeHttpUrl(baseUrl) || normalizeHttpUrl(process.env.EVOLUTION_API_URL) || "https://vexo-evolution-api.xdvm8y.easypanel.host";
  const apiKey = webhookToken || process.env.EVOLUTION_API_KEY || process.env.GD_EVOLUTION_API_TOKEN;
  if (!apiKey) return null;

  const headers = {
    "Content-Type": "application/json",
    ...buildEvolutionAuthHeaders(apiKey),
  };

  const endpoint = `${effectiveBaseUrl.replace(/\/+$/, "")}/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ number }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.profilePictureUrl || data?.picture || null;
  } catch {
    return null;
  }
}

