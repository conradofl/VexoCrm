// backend/src/scripts/originFixPreviewAllTenants.js
//
// SÓ LEITURA. Mede, em todos os tenants, quantos leads têm a origem "Instagram Direct" fabricada pelo importador
// de planilha antigo — os mesmos três grupos da prévia da tela (com identificador / só tag / indeterminável) e os
// do importador de Instagram de verdade (não tocados). Roda só SELECT: nenhuma transação, nenhuma escrita.
//
// Uso (no ambiente que alcança o banco de PRODUÇÃO):
//   DATABASE_URL=postgres://... node backend/src/scripts/originFixPreviewAllTenants.js
//
// O script imprime o host e o banco a que se conectou, para ninguém medir o banco errado sem perceber.

import pg from "pg";
import { pathToFileURL } from "node:url";
import { createPgOriginFixRepo, previewOriginFixForTenants } from "../services/leadOriginFix.js";

export async function run(connectionString, log = console.log) {
  const url = new URL(connectionString);
  log(`Conectando (SOMENTE LEITURA) a ${url.hostname}:${url.port || 5432}/${url.pathname.slice(1)}`);
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 8000 });
  try {
    const repo = createPgOriginFixRepo();
    const clientIds = await repo.listTenantsWithFabricatedOrigin(pool);
    const { tenants, totals } = await previewOriginFixForTenants(repo, pool, clientIds);

    if (tenants.length === 0) {
      log("Nenhum tenant tem lead com origem 'Instagram Direct'. A correção não tem o que fazer.");
      return { tenants, totals };
    }
    log("\ntenant | total | com identificador | só tag | indeterminável | corrigíveis | Instagram (não tocado)");
    for (const t of tenants) {
      log(`${t.clientId} | ${t.total} | ${t.withImportId} | ${t.onlyImportTag} | ${t.undeterminable} | ${t.correctable} | ${t.instagramImporterUntouched}`);
    }
    log(`\nTOTAL | ${totals.total} | ${totals.withImportId} | ${totals.onlyImportTag} | ${totals.undeterminable} | ${totals.correctable} | ${totals.instagramImporterUntouched}`);
    log(totals.correctable === 0 ? "\nZero corrigíveis em todos os tenants." : `\nHá ${totals.correctable} lead(s) corrigíveis — veja a tabela acima antes de executar qualquer coisa.`);
    return { tenants, totals };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Defina DATABASE_URL (banco de produção) para rodar.");
    process.exit(1);
  }
  run(connectionString).catch((err) => {
    console.error("Falhou:", err.message);
    process.exit(1);
  });
}
