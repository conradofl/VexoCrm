// backend/src/scripts/backfillDispatchLimit.js
//
// SPEC 17 — RODAR ANTES de o código novo subir, NUNCA depois.
//
// O código novo (resolveDispatchLeadLimit) trata lote com limit_per_run NULO como "público inteiro". Até hoje, lote
// sem limite próprio usava o limit_per_run da campanha (o "50" padrão da tela). Se o código novo subir sem este
// script, todo lote que já existe (204 pausados, agendados, rascunhos, interrompidos) passaria a enviar o público
// inteiro, em silêncio. Este script grava no LOTE o limite efetivo de hoje, então o volume dos lotes existentes fica
// exatamente como estava. Lote criado depois do deploy nasce sem limite e envia o público inteiro, como a tela mostra.
//
// NÃO rodar depois do deploy: lote novo com limite nulo é intencional e seria limitado por engano.
//
// O que faz: um único UPDATE (atômico) em campaign_dispatches.limit_per_run = campaigns.limit_per_run, só onde o lote
// tem limite nulo e a campanha tem limite. NÃO toca em status, error_message, target_count, updated_at nem em ocorrência
// de campanha recorrente (essa ignora limite). Idempotente: a segunda execução não encontra nada.
//
// Uso (dentro do contêiner bk-vexo, console do EasyPanel):
//   node src/scripts/backfillDispatchLimit.js            # só conta (padrão), não escreve
//   node src/scripts/backfillDispatchLimit.js --apply    # grava

import pg from "pg";
import { pathToFileURL } from "node:url";

// Lotes que o backfill alcança: limite próprio nulo, campanha com limite, e que não sejam ocorrência recorrente.
export const CANDIDATES_SQL = `
  SELECT d.status, COUNT(*)::int AS lotes
    FROM public.campaign_dispatches d
    JOIN public.campaigns c ON c.id = d.campaign_id
   WHERE d.limit_per_run IS NULL
     AND c.limit_per_run IS NOT NULL
     AND d.recurrence_occurrence_at IS NULL
   GROUP BY d.status
   ORDER BY lotes DESC, d.status`;

export const BACKFILL_SQL = `
  UPDATE public.campaign_dispatches d
     SET limit_per_run = c.limit_per_run
    FROM public.campaigns c
   WHERE c.id = d.campaign_id
     AND d.limit_per_run IS NULL
     AND c.limit_per_run IS NOT NULL
     AND d.recurrence_occurrence_at IS NULL
  RETURNING d.id, d.status`;

function countByStatus(rows) {
  const porStatus = {};
  let total = 0;
  for (const r of rows) {
    porStatus[r.status] = Number(r.lotes);
    total += Number(r.lotes);
  }
  return { porStatus, total };
}

export async function backfillDispatchLimit(pool, { apply = false, log = console.log } = {}) {
  const antes = countByStatus((await pool.query(CANDIDATES_SQL)).rows);
  log(`[backfill-limite] lotes com limite nulo e campanha com limite: ${antes.total} ${JSON.stringify(antes.porStatus)}`);

  if (!apply) {
    log("[backfill-limite] DRY-RUN: nada foi escrito. Para gravar: --apply (ANTES do deploy do código novo).");
    return { applied: false, candidatos: antes.total, porStatus: antes.porStatus };
  }

  const { rows } = await pool.query(BACKFILL_SQL);
  const gravados = countByStatus(rows.map((r) => ({ status: r.status, lotes: 1 })));
  const restantes = countByStatus((await pool.query(CANDIDATES_SQL)).rows);
  log(`[backfill-limite] gravados: ${gravados.total} ${JSON.stringify(gravados.porStatus)}`);
  log(`[backfill-limite] restantes sem limite próprio (deve ser 0): ${restantes.total}`);
  return { applied: true, atualizados: gravados.total, porStatus: gravados.porStatus, restantes: restantes.total };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL não configurada no ambiente.");
    process.exit(1);
  }
  const url = new URL(connectionString);
  // Mesma trava dos outros scripts: toda a produção vive em 72.61.37.181 (banco db-vexo, base vexo).
  const ALLOWED_HOSTS = ["72.61.37.181", "db-vexo", "vexo_db-vexo", "localhost", "127.0.0.1"];
  const dbName = url.pathname.slice(1).toLowerCase();
  if (!ALLOWED_HOSTS.includes(url.hostname.toLowerCase()) || !(dbName === "vexo" || url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    console.error(`Conexão abortada: host '${url.hostname}' ou banco '${dbName}' fora do esperado. Não escrever.`);
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const pool = new pg.Pool({ connectionString });
  backfillDispatchLimit(pool, { apply })
    .then(() => pool.end())
    .catch(async (err) => {
      console.error("Erro no backfill:", err.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
