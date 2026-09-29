// backend/src/scripts/measure5500Leads.js
// Script de medição diagnóstica de telefones fabricados com prefixo 5500.
// Suporta conexão direta ao PostgreSQL (quando rede interna/tunnel ativa)
// e fallback automático via API de Produção autenticada com Firebase Admin.

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const { Pool } = pg;
const BASE_URL = process.env.VEXO_API_URL || "https://vexo-backend.xdvm8y.easypanel.host";
const FIREBASE_API_KEY = "AIzaSyDOkCjNyAF9Y51RbocNg0UOaJlwpjVr-Qs";
const CONRADO_UID = "sL8d9hr2mXZ5QHeT2ORMQsDEyAi1";

async function getAdminIdToken() {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }

  const customToken = await admin.auth().createCustomToken(CONRADO_UID);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!data.idToken) {
    throw new Error(`Falha ao obter ID token do Firebase: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

async function measureViaDirectPostgres() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) throw new Error("DATABASE_URL não configurado");

  const pool = new Pool({
    connectionString: connStr,
    connectionTimeoutMillis: 4000,
    ssl: false,
  });

  const client = await pool.connect();
  try {
    console.log("   [Postgres] Conexão TCP direta estabelecida com sucesso!");

    // 1. Leads com 5500 em public.leads por tenant
    const { rows: leadsByTenant } = await client.query(`
      SELECT client_id, COUNT(*)::int as total_5500,
             COUNT(*) FILTER (WHERE stage = 'buyer')::int as buyers,
             COUNT(*) FILTER (WHERE stage = 'lost')::int as lost
        FROM public.leads
       WHERE telefone LIKE '5500%' OR phone LIKE '5500%'
       GROUP BY client_id
       ORDER BY total_5500 DESC;
    `);

    // 2. Disparos de campanhas envolvendo 5500
    const { rows: campaignDispatches } = await client.query(`
      SELECT cdr.status, COUNT(*)::int as count
        FROM public.campaign_dispatch_runs cdr
       WHERE cdr.phone LIKE '5500%'
          OR EXISTS (
            SELECT 1 FROM public.leads l
             WHERE l.id = cdr.lead_id AND (l.telefone LIKE '5500%' OR l.phone LIKE '5500%')
          )
       GROUP BY cdr.status;
    `);

    // 3. Jobs de follow-up envolvendo 5500
    const { rows: followupJobs } = await client.query(`
      SELECT fj.status, COUNT(*)::int as count
        FROM public.followup_jobs fj
        JOIN public.followup_schedules fs ON fs.id = fj.schedule_id
       WHERE fs.phone LIKE '5500%'
       GROUP BY fj.status;
    `);

    // 4. Mensagens trafegadas para 5500
    const { rows: leadMessages } = await client.query(`
      SELECT direction, COUNT(*)::int as count
        FROM public.lead_messages
       WHERE phone LIKE '5500%'
       GROUP BY direction;
    `);

    // 5. Tabelas dinâmicas
    const { rows: tenantTables } = await client.query(`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'leads_%'
         AND table_name NOT IN ('leads_clients', 'leads_metrics', 'leads_import_batches', 'leads_tags');
    `);
    const dynamicTableCounts = [];
    for (const t of tenantTables) {
      try {
        const { rows } = await client.query(`SELECT COUNT(*)::int as count FROM public."${t.table_name}" WHERE telefone LIKE '5500%'`);
        if (rows[0]?.count > 0) {
          dynamicTableCounts.push({ table: t.table_name, count: rows[0].count });
        }
      } catch {}
    }

    // 6. Origens
    const { rows: sourcesBreakdown } = await client.query(`
      SELECT COALESCE(lead_source, dados->>'origem', dados->>'origem_marketing', 'Não informado') as source,
             COUNT(*)::int as count
        FROM public.leads
       WHERE telefone LIKE '5500%' OR phone LIKE '5500%'
       GROUP BY 1
       ORDER BY count DESC
       LIMIT 10;
    `);

    return {
      leadsByTenant,
      campaignDispatches,
      followupJobs,
      leadMessages,
      dynamicTableCounts,
      sourcesBreakdown,
      method: "direct_postgres",
    };
  } finally {
    client.release();
    await pool.end();
  }
}

async function measureViaLiveApi() {
  console.log("   [Live API] Conectando via backend de produção (HTTPS)...");
  const token = await getAdminIdToken();

  // 1. Obter tenants
  const clientsRes = await fetch(`${BASE_URL}/api/lead-clients`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const clientsData = await clientsRes.json();
  const tenants = (clientsData?.items || []).map((c) => c.id);

  console.log(`   [Live API] Auditando base de leads através de ${tenants.length} tenants...`);

  const leadsByTenant = [];
  const all5500Leads = [];

  for (const tenant of tenants) {
    const leadsMap = new Map();
    let page = 1;

    while (true) {
      const res = await fetch(`${BASE_URL}/api/leads?clientId=${tenant}&page=${page}&limit=1000`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) break;
      const data = await res.json();
      const items = data.items || [];
      if (items.length === 0) break;
      for (const item of items) {
        leadsMap.set(item.id, item);
      }
      if (items.length < 1000) break;
      page++;
    }

    const tenant5500 = [];
    for (const lead of leadsMap.values()) {
      const p = String(lead.telefone || lead.phone || "");
      if (p.startsWith("5500") || p.startsWith("+5500")) {
        tenant5500.push(lead);
        all5500Leads.push({ ...lead, client_id: tenant });
      }
    }

    leadsByTenant.push({
      client_id: tenant,
      total_leads: leadsMap.size,
      total_5500: tenant5500.length,
      buyers: tenant5500.filter((l) => l.stage === "buyer").length,
      lost: tenant5500.filter((l) => l.stage === "lost").length,
    });
  }

  // 2. Disparos em campanhas
  console.log("   [Live API] Verificando campanhas e disparos...");
  const campaignDispatches = [];
  for (const tenant of tenants) {
    const campRes = await fetch(`${BASE_URL}/api/campaigns?clientId=${tenant}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!campRes.ok) continue;
    const camps = (await campRes.json()) || [];
    const campList = Array.isArray(camps) ? camps : camps?.campaigns || camps?.items || [];
    for (const c of campList) {
      const leadsRes = await fetch(`${BASE_URL}/api/campaigns/${c.id}/leads?clientId=${tenant}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!leadsRes.ok) continue;
      const leadsData = await leadsRes.json();
      const cLeads = Array.isArray(leadsData) ? leadsData : leadsData?.leads || leadsData?.items || [];
      const c5500 = cLeads.filter((l) => String(l.telefone || l.phone || "").startsWith("5500"));
      if (c5500.length > 0) {
        campaignDispatches.push({ campaign: c.name, tenant, total_5500: c5500.length });
      }
    }
  }

  // 3. Follow-up
  console.log("   [Live API] Verificando cadências de follow-up...");
  const followupJobs = [];
  for (const tenant of tenants) {
    const fupRes = await fetch(`${BASE_URL}/api/followup/schedules?clientId=${tenant}&limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!fupRes.ok) continue;
    const fupData = await fupRes.json();
    const items = fupData?.items || [];
    const fup5500 = items.filter((s) => String(s.phone || "").startsWith("5500"));
    if (fup5500.length > 0) {
      followupJobs.push({ tenant, count: fup5500.length });
    }
  }

  // 4. Mensagens trafegadas para 5500
  console.log("   [Live API] Verificando mensagens em conversas WhatsApp...");
  const leadMessages = [];
  for (const tenant of tenants) {
    const chatRes = await fetch(`${BASE_URL}/api/whatsapp/chats?clientId=${tenant}&tab=todas&search=5500`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!chatRes.ok) continue;
    const chatData = await chatRes.json();
    const items = chatData?.items || [];
    for (const chat of items) {
      const ph = String(chat.id || chat.phone || "");
      if (ph.startsWith("5500")) {
        leadMessages.push({
          tenant,
          phone: ph,
          direction: chat.lastMessage?.fromMe ? "outbound" : "inbound",
          last_message: chat.lastMessage?.body || null,
          timestamp: chat.lastMessage?.timestamp || null,
        });
      }
    }
  }

  // 5. Origens dos leads 5500
  const sourcesMap = new Map();
  for (const l of all5500Leads) {
    const s = l.lead_source || l.dados?.origem || l.dados?.origem_marketing || "Não informado";
    sourcesMap.set(s, (sourcesMap.get(s) || 0) + 1);
  }
  const sourcesBreakdown = Array.from(sourcesMap.entries()).map(([source, count]) => ({ source, count }));

  return {
    leadsByTenant,
    campaignDispatches,
    followupJobs,
    leadMessages,
    dynamicTableCounts: [],
    sourcesBreakdown,
    all5500Leads,
    method: "live_api",
  };
}

async function runMeasurement() {
  console.log("===============================================================");
  console.log("=== INICIANDO MEDIÇÃO DE TELEFONES FABRICADOS (PREFIXO 5500) ===");
  console.log("===============================================================\n");

  let results;
  try {
    console.log("Tentativa 1: Conexão direta TCP com banco PostgreSQL...");
    results = await measureViaDirectPostgres();
  } catch (err) {
    console.warn(`\n[Aviso] Conexão TCP direta com PostgreSQL falhou (${err.message}).`);
    console.log("Acionando medição diagnóstica via API de Produção (com Firebase Admin)...");
    results = await measureViaLiveApi();
  }

  console.log("\n===============================================================");
  console.log(`=== RELATÓRIO CONSOLIDADO: TELEFONES FABRICADOS 5500 (${results.method}) ===`);
  console.log("===============================================================\n");

  console.log("1. Total de Leads por Tenant (Volume Geral & Prefixo 5500):");
  console.table(results.leadsByTenant);

  console.log("\n2. Disparos em Campanhas Envolvendo 5500:");
  if (results.campaignDispatches.length === 0) {
    console.log("   [LIMPO] Nenhum disparo de campanha registrado para números com prefixo 5500.");
  } else {
    console.table(results.campaignDispatches);
  }

  console.log("\n3. Jobs de Follow-up Envolvendo 5500:");
  if (results.followupJobs.length === 0) {
    console.log("   [LIMPO] Nenhum job de follow-up registrado para números com prefixo 5500.");
  } else {
    console.table(results.followupJobs);
  }

  console.log("\n4. Mensagens Trafegadas com 5500 (lead_messages / chats):");
  if (results.leadMessages.length === 0) {
    console.log("   [LIMPO] Nenhuma mensagem registrada para números com prefixo 5500.");
  } else {
    console.table(results.leadMessages);
  }

  console.log("\n5. Origens dos Leads com Prefixo 5500:");
  if (results.sourcesBreakdown.length === 0) {
    console.log("   Nenhuma origem registrada.");
  } else {
    console.table(results.sourcesBreakdown);
  }

  if (results.all5500Leads && results.all5500Leads.length > 0) {
    console.log("\n6. Detalhamento dos Registros Localizados:");
    console.table(
      results.all5500Leads.map((l) => ({
        id: l.id,
        tenant: l.client_id,
        nome: l.nome,
        telefone: l.telefone,
        stage: l.stage,
        origem: l.lead_source || l.dados?.origem,
        created_at: l.created_at,
      }))
    );
  }

  console.log("\n=== FIM DA MEDIÇÃO ===");
  process.exit(0);
}

runMeasurement().catch((err) => {
  console.error("Erro fatal na medição:", err);
  process.exit(1);
});
