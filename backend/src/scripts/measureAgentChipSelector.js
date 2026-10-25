// backend/src/scripts/measureAgentChipSelector.js
//
// SÓ LEITURA. Medição diagnóstica do vínculo de chips dos agentes no tenant 'bia-do-spazio'.
// Imprime host, porta e banco de dados no início.
//
// Uso (no ambiente com acesso ao banco, ex: Easypanel ou terminal local com DATABASE_URL):
//   DATABASE_URL="postgresql://..." node backend/src/scripts/measureAgentChipSelector.js [tenantId]

import pg from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export async function run(connectionString = process.env.DATABASE_URL, targetTenantId = "bia-do-spazio", log = console.log) {
  if (!connectionString) {
    throw new Error("DATABASE_URL não configurada no ambiente ou no .env.");
  }

  const url = new URL(connectionString);
  log(`\n================================================================================`);
  log(`Conectando (SOMENTE LEITURA) a: ${url.hostname}:${url.port || 5432}/${url.pathname.slice(1)}`);
  log(`Tenant alvo: '${targetTenantId}'`);
  log(`Timestamp da execução: ${new Date().toISOString()}`);
  log(`================================================================================\n`);

  const explicitSsl = String(process.env.DATABASE_SSL || process.env.PGSSLMODE || "").toLowerCase();
  const ssl = ["1", "true", "require"].includes(explicitSsl) ? { rejectUnauthorized: false } : false;
  const pool = new pg.Pool({ connectionString, ssl, connectionTimeoutMillis: 10000 });

  try {
    // 1. Agentes cadastrados em followup_companies
    log("1. CONSULTA: public.followup_companies");
    log(`Query: SELECT id, name, evolution_instance, evolution_instances, inbound_role, agent_kind, inbound_enabled, archived_at, created_at, updated_at FROM public.followup_companies WHERE tenant_id = '${targetTenantId}' ORDER BY created_at ASC;`);
    const { rows: agents } = await pool.query(
      `SELECT id, name, evolution_instance, evolution_instances, inbound_role, agent_kind, inbound_enabled, archived_at, created_at, updated_at
         FROM public.followup_companies
        WHERE tenant_id = $1
        ORDER BY created_at ASC`,
      [targetTenantId]
    );

    if (agents.length === 0) {
      log(`Nenhum agente encontrado em followup_companies para o tenant '${targetTenantId}'.`);
    } else {
      console.table(
        agents.map((a) => ({
          id: a.id,
          name: a.name,
          evolution_instance: a.evolution_instance,
          evolution_instances: JSON.stringify(a.evolution_instances),
          inbound_enabled: a.inbound_enabled,
          archived: !!a.archived_at,
          created_at: a.created_at?.toISOString?.() || a.created_at,
        }))
      );
    }

    // 2. Chips cadastrados em lead_client_evolution_instances
    log("\n2. CONSULTA: public.lead_client_evolution_instances");
    log(`Query: SELECT id, client_id, name, dispatch_webhook_url, active, is_default, chip_state, connection_state, created_at FROM public.lead_client_evolution_instances WHERE client_id = '${targetTenantId}' ORDER BY created_at ASC;`);
    const { rows: chips } = await pool.query(
      `SELECT id, client_id, name, dispatch_webhook_url, active, is_default, chip_state, connection_state, created_at
         FROM public.lead_client_evolution_instances
        WHERE client_id = $1
        ORDER BY created_at ASC`,
      [targetTenantId]
    );

    if (chips.length === 0) {
      log(`Nenhum chip encontrado em lead_client_evolution_instances para o tenant '${targetTenantId}'.`);
    } else {
      console.table(
        chips.map((c) => {
          const urlParts = (c.dispatch_webhook_url || "").split("/").filter(Boolean);
          const urlSlug = urlParts.pop() || "";
          return {
            id: c.id,
            name: c.name,
            urlSlug: urlSlug.includes("?") ? urlSlug.split("?")[0] : urlSlug,
            active: c.active,
            is_default: c.is_default,
            connection_state: c.connection_state,
          };
        })
      );
    }

    // 3. Cruzamento e Diagnóstico de Órfãos / Vínculos
    log("\n3. DIAGNÓSTICO DE VÍNCULOS E ÓRFÃOS");
    for (const a of agents) {
      log(`\nAgente: "${a.name}" (ID: ${a.id})`);
      const instances = Array.isArray(a.evolution_instances) && a.evolution_instances.length > 0
        ? a.evolution_instances
        : (a.evolution_instance ? [a.evolution_instance] : []);
      log(` - Instâncias gravadas no agente (${instances.length}): ${JSON.stringify(instances)}`);

      for (const inst of instances) {
        // Tenta casar por id, slug da url ou name
        const match = chips.find((c) => {
          const urlParts = (c.dispatch_webhook_url || "").split("/").filter(Boolean);
          const slug = (urlParts.pop() || "").split("?")[0];
          return c.id === inst || slug === inst || c.name === inst;
        });

        if (match) {
          log(`   ✓ Vínculo VÁLIDO: '${inst}' -> Chip '${match.name}' (UUID: ${match.id})`);
        } else {
          log(`   🚨 Vínculo ÓRFÃO: '${inst}' NÃO EXISTE em lead_client_evolution_instances!`);
        }
      }
    }

    log(`\n================================================================================\n`);
    return { agents, chips };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tenantArg = process.argv[2] || "bia-do-spazio";
  run(process.env.DATABASE_URL, tenantArg).catch((err) => {
    console.error("Erro na medição:", err.message);
    process.exit(1);
  });
}
