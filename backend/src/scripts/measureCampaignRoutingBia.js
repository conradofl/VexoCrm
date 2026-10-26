// backend/src/scripts/measureCampaignRoutingBia.js
//
// SÓ LEITURA. Medição diagnóstica do roteamento de mensagens do teste de campanha de 25/10 e 26/10.
// Consulta as tabelas oficiais (campaigns, campaign_dispatches, lead_messages) sem transação de escrita.
//
// Uso (no Easypanel, dentro do contêiner bk-vexo, ou terminal com DATABASE_URL):
//   node src/scripts/measureCampaignRoutingBia.js [telefone]
//
// Exemplos:
//   node src/scripts/measureCampaignRoutingBia.js
//   node src/scripts/measureCampaignRoutingBia.js 5511999999999

import pg from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export async function run(connectionString = process.env.DATABASE_URL, targetPhone = null, log = console.log) {
  if (!connectionString) {
    throw new Error("DATABASE_URL não configurada no ambiente ou no .env.");
  }

  const url = new URL(connectionString);
  log(`\n================================================================================`);
  log(`[CONEXÃO DE BANCO DE DADOS - MEDIÇÃO SÓ LEITURA]`);
  log(`  HOST:      ${url.hostname}`);
  log(`  PORTA:     ${url.port || 5432}`);
  log(`  BANCO:     ${url.pathname.slice(1)}`);
  log(`  TENANT:    bia-do-spazio`);
  log(`  FILTRO TEL: ${targetPhone || "(todos os números do tenant no intervalo)"}`);
  log(`  DATA/HORA: ${new Date().toISOString()}`);
  log(`================================================================================\n`);

  const ALLOWED_HOSTS = ["72.61.37.181", "db-vexo", "vexo_db-vexo", "localhost", "127.0.0.1"];
  const dbName = url.pathname.slice(1).toLowerCase();
  const isAllowedHost = ALLOWED_HOSTS.includes(url.hostname.toLowerCase());
  const isAllowedDb = dbName === "vexo" || url.hostname === "localhost" || url.hostname === "127.0.0.1";

  if (!isAllowedHost || !isAllowedDb) {
    const errorMsg = `Conexão abortada: Host '${url.hostname}' ou banco '${dbName}' inválido. Toda a produção vive em 72.61.37.181 (EasyPanel, projeto vexo): backend bk-vexo, banco db-vexo (base vexo). Qualquer host ou banco diferente desse é erro — não conectar, não medir, não escrever.`;
    log(`[ERRO DE SEGURANÇA] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });

  try {
    // 1. Consulta em campaigns (compara de658391 e f297eaac)
    log(`--- 1. CONSULTA DE DEFINIÇÃO DE CAMPANHAS (campaigns) ---`);
    const campaignsQuery = `
      SELECT 
        id,
        name,
        status,
        created_at,
        dispatch_options->>'waitForReply' AS wait_for_reply,
        dispatch_options->>'replyAgent' AS reply_agent,
        dispatch_options->>'handoffEnabled' AS handoff_enabled,
        dispatch_options->>'handoffChipId' AS handoff_chip_id,
        jsonb_array_length(CASE WHEN jsonb_typeof(sequence) = 'array' THEN sequence ELSE '[]'::jsonb END) AS total_steps,
        EXISTS (
          SELECT 1 
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(sequence) = 'array' THEN sequence ELSE '[]'::jsonb END) AS elem
          WHERE elem->>'triggerMode' = 'after_reply'
        ) AS has_after_reply_step
      FROM public.campaigns
      WHERE client_id = 'bia-do-spazio'
        AND (
          id LIKE 'de658391%' 
          OR id LIKE 'f297eaac%'
          OR created_at >= '2026-10-24 00:00:00Z'
        )
      ORDER BY created_at DESC
      LIMIT 10;
    `;
    const campRes = await pool.query(campaignsQuery).catch((err) => {
      log(`Aviso ao ler campaigns: ${err.message}`);
      return { rows: [] };
    });
    console.table(campRes.rows);

    // 2. Consulta em campaign_dispatches
    log(`\n--- 2. CONSULTA DE DISPAROS EXECUTADOS (campaign_dispatches) ---`);
    const dispatchesQuery = `
      SELECT 
        id,
        campaign_id,
        status,
        scheduled_at,
        triggered_at,
        finished_at,
        total_leads,
        sent_count,
        failed_count,
        evolution_instance_id
      FROM public.campaign_dispatches
      WHERE client_id = 'bia-do-spazio'
        AND (
          campaign_id LIKE 'de658391%' 
          OR campaign_id LIKE 'f297eaac%'
          OR created_at >= '2026-10-24 00:00:00Z'
        )
      ORDER BY created_at DESC
      LIMIT 10;
    `;
    const dispRes = await pool.query(dispatchesQuery).catch((err) => {
      log(`Aviso ao ler campaign_dispatches: ${err.message}`);
      return { rows: [] };
    });
    console.table(dispRes.rows);

    // 3. Consulta em lead_messages (25/10 entre 20:30 e 21:15)
    log(`\n--- 3. CONSULTA DE MENSAGENS REAIS (lead_messages 25/10 20:30 - 21:15) ---`);
    const phoneFilter = targetPhone ? `AND phone LIKE '%${targetPhone.replace(/\D/g, "")}%'` : "";
    const messagesQuery = `
      SELECT 
        created_at,
        phone,
        direction,
        sender_type,
        COALESCE(meta->>'source', 'sem_source') AS source,
        COALESCE(meta->>'model', '-') AS model,
        dispatch_id,
        campaign_id,
        instance_name,
        LEFT(message_text, 100) AS message_preview,
        message_text
      FROM public.lead_messages
      WHERE client_id = 'bia-do-spazio'
        ${phoneFilter}
        AND created_at >= '2026-10-25 20:30:00-03'
        AND created_at <= '2026-10-25 21:15:00-03'
      ORDER BY created_at ASC;
    `;
    const msgsRes = await pool.query(messagesQuery);

    if (msgsRes.rows.length === 0) {
      log(`\nNenhuma linha encontrada no intervalo estrito de 20:30 a 21:15 (-03).`);
      log(`Buscando últimas mensagens do dia 25/10 e 26/10 para bia-do-spazio...`);
      const fallbackQuery = `
        SELECT 
          created_at,
          phone,
          direction,
          sender_type,
          COALESCE(meta->>'source', 'sem_source') AS source,
          COALESCE(meta->>'model', '-') AS model,
          dispatch_id,
          campaign_id,
          instance_name,
          LEFT(message_text, 80) AS message_preview
        FROM public.lead_messages
        WHERE client_id = 'bia-do-spazio'
          ${phoneFilter}
          AND created_at >= '2026-10-25 00:00:00Z'
          AND created_at <= '2026-10-26 23:59:59Z'
        ORDER BY created_at DESC
        LIMIT 30;
      `;
      const fallbackRes = await pool.query(fallbackQuery);
      log(`Total de mensagens recentes: ${fallbackRes.rows.length}`);
      console.table(fallbackRes.rows.map(r => ({
        created_at: r.created_at,
        phone: r.phone,
        direction: r.direction,
        sender_type: r.sender_type,
        source: r.source,
        model: r.model,
        dispatch_id: r.dispatch_id || "null",
        campaign_id: r.campaign_id || "null",
        instance: r.instance_name,
        text: r.message_preview,
      })));
      return { campaigns: campRes.rows, dispatches: dispRes.rows, messages: fallbackRes.rows };
    }

    log(`\nForam encontradas ${msgsRes.rows.length} mensagens no intervalo do teste:`);
    console.table(msgsRes.rows.map(r => ({
      created_at: r.created_at,
      phone: r.phone,
      direction: r.direction,
      sender_type: r.sender_type,
      source: r.source,
      model: r.model,
      dispatch_id: r.dispatch_id || "null",
      campaign_id: r.campaign_id || "null",
      instance: r.instance_name,
      text: r.message_preview,
    })));

    log(`\n--- SAÍDA BRUTA COMPLETA (JSON) ---`);
    log(JSON.stringify(msgsRes.rows, null, 2));

    return { campaigns: campRes.rows, dispatches: dispRes.rows, messages: msgsRes.rows };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const targetPhone = process.argv[2] || null;
  run(process.env.DATABASE_URL, targetPhone).catch((err) => {
    console.error("Erro na medição:", err.message);
    process.exit(1);
  });
}

