// backend/src/scripts/measureAgentChipSelector.js
//
// SÓ LEITURA. Medição diagnóstica do vínculo de chips dos agentes em um ou TODOS os tenants.
// Imprime host, porta e banco de dados no início.
//
// Uso (no ambiente com acesso ao banco, ex: Easypanel ou terminal com DATABASE_URL):
//   DATABASE_URL="postgresql://..." node backend/src/scripts/measureAgentChipSelector.js [tenantId|all]
//
// Exemplos:
//   node backend/src/scripts/measureAgentChipSelector.js all
//   node backend/src/scripts/measureAgentChipSelector.js bia-do-spazio

import pg from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export function checkInstanceMatch(inst, chips) {
  if (!inst) return null;
  const raw = String(inst).trim().toLowerCase();
  return chips.find((c) => {
    if (!c) return false;
    if (c.id && String(c.id).toLowerCase() === raw) return true;
    if (c.name && String(c.name).toLowerCase() === raw) return true;
    const urlParts = (c.dispatch_webhook_url || "").split("/").filter(Boolean);
    const slug = (urlParts.pop() || "").split("?")[0].toLowerCase();
    if (slug && slug === raw) return true;
    return false;
  }) || null;
}

export async function run(connectionString = process.env.DATABASE_URL, targetTenantId = "all", log = console.log) {
  if (!connectionString) {
    throw new Error("DATABASE_URL não configurada no ambiente ou no .env.");
  }

  const isAll = !targetTenantId || targetTenantId === "all" || targetTenantId === "--all";
  const url = new URL(connectionString);

  log(`\n================================================================================`);
  log(`[CONEXÃO DE BANCO DE DADOS - SCRIPT DIAGNÓSTICO]`);
  log(`  HOST:      ${url.hostname}`);
  log(`  PORTA:     ${url.port || 5432}`);
  log(`  BANCO:     ${url.pathname.slice(1)}`);
  log(`  MODO:      ${isAll ? "TODOS OS TENANTS" : `Tenant '${targetTenantId}'`}`);
  log(`  DATA/HORA: ${new Date().toISOString()}`);
  log(`================================================================================\n`);

  // Guarda obrigatória: recusar rodar no servidor morto antigo
  const DEAD_SERVERS = ["187.77.52.167"];
  if (DEAD_SERVERS.includes(url.hostname) || url.pathname.includes("vexo-data")) {
    const errorMsg = `Conexão abortada: O host '${url.hostname}' (ou banco '${url.pathname.slice(1)}') é o servidor antigo DESATIVADO (morto). O banco de produção ativo é 72.61.37.181 (serviço db-vexo, banco vexo). Corrija o DATABASE_URL antes de rodar.`;
    log(`🚨 [FATAL] ${errorMsg}\n`);
    throw new Error(errorMsg);
  }

  const explicitSsl = String(process.env.DATABASE_SSL || process.env.PGSSLMODE || "").toLowerCase();
  const ssl = ["1", "true", "require"].includes(explicitSsl) ? { rejectUnauthorized: false } : false;
  const pool = new pg.Pool({ connectionString, ssl, connectionTimeoutMillis: 10000 });

  try {
    // 1. Agentes cadastrados em followup_companies
    const agentQuery = isAll
      ? `SELECT id, tenant_id, name, evolution_instance, evolution_instances, inbound_role, agent_kind, inbound_enabled, archived_at, created_at, updated_at
           FROM public.followup_companies
          WHERE archived_at IS NULL
          ORDER BY tenant_id ASC, created_at ASC`
      : `SELECT id, tenant_id, name, evolution_instance, evolution_instances, inbound_role, agent_kind, inbound_enabled, archived_at, created_at, updated_at
           FROM public.followup_companies
          WHERE tenant_id = $1 AND archived_at IS NULL
          ORDER BY created_at ASC`;

    const agentParams = isAll ? [] : [targetTenantId];
    const { rows: agents } = await pool.query(agentQuery, agentParams);

    // 2. Chips cadastrados em lead_client_evolution_instances
    const chipQuery = isAll
      ? `SELECT id, client_id, name, dispatch_webhook_url, active, is_default, chip_state, connection_state, created_at
           FROM public.lead_client_evolution_instances
          ORDER BY client_id ASC, created_at ASC`
      : `SELECT id, client_id, name, dispatch_webhook_url, active, is_default, chip_state, connection_state, created_at
           FROM public.lead_client_evolution_instances
          WHERE client_id = $1
          ORDER BY created_at ASC`;

    const chipParams = isAll ? [] : [targetTenantId];
    const { rows: chips } = await pool.query(chipQuery, chipParams);

    log(`Total de agentes ativos no banco: ${agents.length}`);
    log(`Total de chips no banco: ${chips.length}\n`);

    // Agrupar chips por tenant/client_id
    const chipsByTenant = new Map();
    for (const c of chips) {
      const tid = c.client_id;
      if (!chipsByTenant.has(tid)) chipsByTenant.set(tid, []);
      chipsByTenant.get(tid).push(c);
    }

    // 3. Cruzamento e Diagnóstico de Órfãos
    const reportRows = [];
    let totalAgentsWithOrphan = 0;
    let totalAgentsValidOnly = 0;
    let totalAgentsNoChips = 0;

    for (const a of agents) {
      const tid = a.tenant_id;
      const tenantChips = chipsByTenant.get(tid) || [];

      const rawInstances = Array.isArray(a.evolution_instances) && a.evolution_instances.length > 0
        ? a.evolution_instances
        : (a.evolution_instance ? [a.evolution_instance] : []);

      const validList = [];
      const orphanList = [];

      for (const inst of rawInstances) {
        const match = checkInstanceMatch(inst, tenantChips);
        if (match) {
          validList.push({ inst, chipName: match.name, chipId: match.id, active: match.active });
        } else {
          orphanList.push(inst);
        }
      }

      const hasOrphan = orphanList.length > 0;
      if (rawInstances.length === 0) {
        totalAgentsNoChips++;
      } else if (hasOrphan) {
        totalAgentsWithOrphan++;
      } else {
        totalAgentsValidOnly++;
      }

      reportRows.push({
        tenant: tid,
        agentId: a.id,
        agentName: a.name,
        inboundEnabled: a.inbound_enabled,
        totalInstances: rawInstances.length,
        validCount: validList.length,
        orphanCount: orphanList.length,
        orphanValues: orphanList.join(", ") || "-",
        validChips: validList.map((v) => `${v.chipName} (${v.chipId.slice(0, 8)})`).join(", ") || "-",
        status: hasOrphan ? "🚨 TEM ÓRFÃO" : rawInstances.length === 0 ? "SEM CHIP" : "✓ OK",
      });
    }

    // Exibir tabela de agentes com órfãos
    const orphanRows = reportRows.filter((r) => r.orphanCount > 0);
    log("================================================================================");
    log(`AGENTES COM VÍNCULO ÓRFÃO (${orphanRows.length} de ${agents.length}):`);
    log("================================================================================");
    if (orphanRows.length === 0) {
      log("Nenhum agente com vínculo órfão encontrado!");
    } else {
      console.table(
        orphanRows.map((r) => ({
          tenant: r.tenant,
          agent: r.agentName,
          inboundEnabled: r.inboundEnabled,
          total: r.totalInstances,
          valid: r.validCount,
          orphans: r.orphanCount,
          orphanValues: r.orphanValues,
        }))
      );
    }

    // Exibir sumário completo
    log("\n================================================================================");
    log("SUMÁRIO GERAL DA MEDIÇÃO:");
    log("================================================================================");
    const summary = {
      totalTenantsEncontrados: new Set(agents.map((a) => a.tenant_id)).size,
      totalAgentesAtivos: agents.length,
      agentesComVinculoValido: totalAgentsValidOnly,
      agentesSemNenhumChip: totalAgentsNoChips,
      agentesComVinculoOrfao: totalAgentsWithOrphan,
      percentualAfetado: agents.length > 0 ? `${((totalAgentsWithOrphan / agents.length) * 100).toFixed(1)}%` : "0%",
    };
    console.table(summary);

    log(`\n================================================================================\n`);
    return { summary, orphanRows, reportRows };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tenantArg = process.argv[2] || "all";
  run(process.env.DATABASE_URL, tenantArg).catch((err) => {
    console.error("Erro na medição:", err.message);
    process.exit(1);
  });
}
