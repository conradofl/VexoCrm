#!/usr/bin/env node

/**
 * trello-slack-daily-reporter.mjs
 * 
 * Script utilitário CLI para rodar a auditoria operacional do Trello
 * e despachar o resumo matinal (09h00) ou vespertino (18h00) no canal #01-ops-geral do Slack.
 * 
 * Uso:
 *   node backend/src/scripts/trello-slack-daily-reporter.mjs --mode=morning
 *   node backend/src/scripts/trello-slack-daily-reporter.mjs --mode=evening
 *   node backend/src/scripts/trello-slack-daily-reporter.mjs --mode=morning --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTrelloDailyAudit } from "../services/trelloSlackReporter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega .env do backend
function loadEnvFallback() {
  const envCandidates = [
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../.env"),
  ];
  const envPath = envCandidates.find((p) => fs.existsSync(p));
  if (!envPath) return;

  try {
    const raw = fs.readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn("[trello-reporter] Aviso ao ler backend/.env:", err.message);
  }
}

loadEnvFallback();

const args = process.argv.slice(2);
let mode = "morning";
let dryRun = false;

for (const arg of args) {
  if (arg.startsWith("--mode=")) {
    mode = arg.split("=")[1].trim();
  } else if (arg === "--evening") {
    mode = "evening";
  } else if (arg === "--morning") {
    mode = "morning";
  } else if (arg === "--dry-run") {
    dryRun = true;
  }
}

console.log("\n=======================================================");
console.log(`📋 AUDITORIA OPERACIONAL TRELLO ↔ SLACK (${mode.toUpperCase()})`);
console.log("=======================================================\n");

async function main() {
  console.log(`• Modo de Execução: \x1b[36m${mode}\x1b[0m`);
  console.log(`• Dry Run (Apenas Prévia): \x1b[33m${dryRun ? "SIM" : "NÃO"}\x1b[0m\n`);

  try {
    const res = await runTrelloDailyAudit({
      mode,
      dryRun,
      allowMock: true,
      slackChannel: "01-ops-geral",
    });

    console.log("📝 PRÉVIA DO RELATÓRIO GERADO:");
    console.log("-------------------------------------------------------");
    console.log(res.reportText);
    console.log("-------------------------------------------------------");

    if (res.isMock) {
      console.log("\nℹ️  Nota: Dados de exemplo utilizados (defina TRELLO_API_KEY, TRELLO_TOKEN e TRELLO_BOARD_ID para conectar ao quadro real).");
    }

    if (res.dryRun) {
      console.log("✨ Execução em modo Dry Run finalizada com sucesso! (Nenhuma mensagem enviada ao Slack)");
    } else {
      console.log("🚀 Relatório publicado com sucesso no canal #01-ops-geral do Slack!");
    }
    console.log();
  } catch (err) {
    console.error("❌ Falha na auditoria operacional:", err.message);
    process.exit(1);
  }
}

main();
