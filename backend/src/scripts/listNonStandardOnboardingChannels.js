// backend/src/scripts/listNonStandardOnboardingChannels.js
//
// SÓ LEITURA. Inspeciona os grupos de WhatsApp e canais de Slack criados no onboarding
// automático da Geração Digital e Vexo OS, comparando com o padrão oficial:
//   - WhatsApp: "MÁQUINA DE VENDAS: {EMPRESA EM MAIÚSCULAS}"
//   - Slack:    "02-cli-{slug}"
//
// Nenhuma alteração é feita no banco de dados nem no Slack/WhatsApp (sem transação, sem UPDATE/DELETE).
// O script entrega a lista de grupos e canais fora do padrão para o dono decidir a migração.
//
// Uso:
//   DATABASE_URL=postgres://... node backend/src/scripts/listNonStandardOnboardingChannels.js
//
// O script imprime o host e o banco a que se conectou (mesma disciplina de originFixPreviewAllTenants.js).

import pg from "pg";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOnboardingNames,
  WHATSAPP_GROUP_PREFIX,
  SLACK_CHANNEL_PREFIX,
} from "../services/onboardingNaming.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Avalia se o nome do canal do Slack está em conformidade com o padrão oficial ("02-cli-{slug}").
 * Retorna { isStandard: boolean, reason: string | null }
 */
export function evaluateSlackChannelName(actualChannelName, expectedSlug) {
  if (!actualChannelName) {
    return { isStandard: false, reason: "Canal do Slack ausente / não registrado" };
  }
  const clean = actualChannelName.trim().toLowerCase();
  const expectedChannelName = `${SLACK_CHANNEL_PREFIX}${expectedSlug}`;

  if (clean === expectedChannelName) {
    return { isStandard: true, reason: null };
  }

  if (clean.startsWith("gd-")) {
    return {
      isStandard: false,
      reason: `Utiliza prefixo antigo legatório "gd-" (atual: "${clean}", padrão: "${expectedChannelName}")`,
    };
  }

  if (!clean.startsWith(SLACK_CHANNEL_PREFIX)) {
    return {
      isStandard: false,
      reason: `Não possui o prefixo obrigatório "${SLACK_CHANNEL_PREFIX}" (atual: "${clean}", padrão: "${expectedChannelName}")`,
    };
  }

  return {
    isStandard: false,
    reason: `Slug divergente do padrão (atual: "${clean}", padrão: "${expectedChannelName}")`,
  };
}

/**
 * Avalia se o assunto do grupo WhatsApp está em conformidade com o padrão oficial ("MÁQUINA DE VENDAS: {EMPRESA}").
 * Retorna { isStandard: boolean, reason: string | null }
 */
export function evaluateWhatsAppGroupName(actualSubject, expectedCompanyName) {
  if (!actualSubject) {
    return { isStandard: false, reason: "Grupo de WhatsApp ausente / não informado" };
  }
  const trimmed = actualSubject.trim();
  const expectedSubject = `${WHATSAPP_GROUP_PREFIX}${expectedCompanyName.toUpperCase()}`;

  if (trimmed === expectedSubject) {
    return { isStandard: true, reason: null };
  }

  if (trimmed.startsWith("GD &") || trimmed.startsWith("GD -")) {
    return {
      isStandard: false,
      reason: `Utiliza prefixo antigo "GD &" / "GD -" (atual: "${trimmed}", padrão: "${expectedSubject}")`,
    };
  }

  // Verifica se sofreu o antigo truncamento de 25 caracteres (geracaoDigitalRoutes.js:812 antigo)
  if (trimmed.length <= 25 && expectedSubject.length > 25) {
    return {
      isStandard: false,
      reason: `Possível truncamento antigo de 25 caracteres (atual: "${trimmed}", padrão: "${expectedSubject}")`,
    };
  }

  if (!trimmed.startsWith(WHATSAPP_GROUP_PREFIX)) {
    return {
      isStandard: false,
      reason: `Não possui o prefixo obrigatório "${WHATSAPP_GROUP_PREFIX}" (atual: "${trimmed}", padrão: "${expectedSubject}")`,
    };
  }

  return {
    isStandard: false,
    reason: `Nome divergente do padrão (atual: "${trimmed}", padrão: "${expectedSubject}")`,
  };
}

/**
 * Executa a inspeção de somente leitura em public.slack_channel_map e public.geracao_digital_briefings.
 */
export async function inspectOnboardingChannels(pool, options = {}) {
  const { fetchSlackApi = false, slackBotToken = process.env.SLACK_BOT_TOKEN } = options;

  // 1. Inspeciona public.slack_channel_map
  const mapQuery = `
    SELECT id, client_name, whatsapp_jid, slack_channel_id, instance_name, status, created_at
    FROM public.slack_channel_map
    ORDER BY id ASC;
  `;
  let mapRows = [];
  try {
    const res = await pool.query(mapQuery);
    mapRows = res.rows || [];
  } catch (err) {
    // Tabela pode não existir em ambientes de teste sem migração
    if (err.code !== "42P01") throw err;
  }

  // Se houver token do Slack e solicitado, busca os nomes reais dos canais via API conversations.info
  const slackIdToName = new Map();
  if (fetchSlackApi && slackBotToken && mapRows.length > 0) {
    for (const row of mapRows) {
      if (row.slack_channel_id && !slackIdToName.has(row.slack_channel_id)) {
        try {
          const res = await fetch(`https://slack.com/api/conversations.info?channel=${row.slack_channel_id}`, {
            headers: { Authorization: `Bearer ${slackBotToken}` },
          });
          const data = await res.json();
          if (data.ok && data.channel?.name) {
            slackIdToName.set(row.slack_channel_id, data.channel.name);
          }
        } catch {
          // Ignora falhas de rede no fetch do Slack
        }
      }
    }
  }

  const inspectedMaps = mapRows.map((row) => {
    const expected = buildOnboardingNames(row.client_name);
    const slackName = slackIdToName.get(row.slack_channel_id) || null;
    const slackEval = slackName ? evaluateSlackChannelName(slackName, expected.slug) : null;
    const isGroupJid = typeof row.whatsapp_jid === "string" && row.whatsapp_jid.endsWith("@g.us");

    return {
      id: row.id,
      clientName: row.client_name,
      whatsappJid: row.whatsapp_jid,
      isGroupJid,
      slackChannelId: row.slack_channel_id,
      actualSlackChannelName: slackName,
      expectedSlackChannelName: expected.slackChannelName,
      expectedWhatsAppGroupName: expected.whatsappGroupName,
      slackEvaluation: slackEval,
      status: row.status,
      createdAt: row.created_at,
    };
  });

  // 2. Inspeciona public.geracao_digital_briefings
  const briefingsQuery = `
    SELECT id, prospect_name, whatsapp_number, briefing_data, status, slack_status, created_at
    FROM public.geracao_digital_briefings
    ORDER BY created_at ASC;
  `;
  let briefingRows = [];
  try {
    const res = await pool.query(briefingsQuery);
    briefingRows = res.rows || [];
  } catch (err) {
    if (err.code !== "42P01") throw err;
  }

  const inspectedBriefings = briefingRows.map((row) => {
    const bData = row.briefing_data || {};
    const expected = buildOnboardingNames(row.prospect_name);

    const actualWpp = bData.whatsappGroupName || null;
    const actualSlack = bData.slackChannelName || null;

    const wppEval = actualWpp ? evaluateWhatsAppGroupName(actualWpp, expected.companyName) : null;
    const slackEval = actualSlack ? evaluateSlackChannelName(actualSlack, expected.slug) : null;

    const isNonStandard = (wppEval && !wppEval.isStandard) || (slackEval && !slackEval.isStandard);

    return {
      id: row.id,
      prospectName: row.prospect_name,
      whatsappNumber: row.whatsapp_number,
      actualWhatsAppGroupName: actualWpp,
      expectedWhatsAppGroupName: expected.whatsappGroupName,
      whatsAppEvaluation: wppEval,
      actualSlackChannelName: actualSlack,
      expectedSlackChannelName: expected.slackChannelName,
      slackEvaluation: slackEval,
      isNonStandard,
      status: row.status,
      createdAt: row.created_at,
    };
  });

  // Resumo
  const nonStandardBriefings = inspectedBriefings.filter((b) => b.isNonStandard);
  const nonStandardMaps = inspectedMaps.filter(
    (m) => m.slackEvaluation && !m.slackEvaluation.isStandard
  );

  return {
    maps: inspectedMaps,
    briefings: inspectedBriefings,
    summary: {
      totalMaps: inspectedMaps.length,
      totalBriefings: inspectedBriefings.length,
      nonStandardBriefingsCount: nonStandardBriefings.length,
      nonStandardMapsCount: nonStandardMaps.length,
      nonStandardBriefings,
      nonStandardMaps,
    },
  };
}

/**
 * Função executável via CLI ou módulo.
 */
export async function run(connectionString, log = console.log, options = {}) {
  const url = new URL(connectionString);
  log(`Conectando (SOMENTE LEITURA) a ${url.hostname}:${url.port || 5432}/${url.pathname.slice(1)}`);
  
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 8000 });
  try {
    const report = await inspectOnboardingChannels(pool, options);

    log("\n================================================================================");
    log("📋 RELATÓRIO DE CONFORMIDADE — NOMENCLATURA DE ONBOARDING (WHATSAPP & SLACK)");
    log("================================================================================\n");

    log("--- BRIEFINGS DE ONBOARDING (public.geracao_digital_briefings) ---");
    if (report.briefings.length === 0) {
      log("Nenhum briefing cadastrado no banco.");
    } else {
      log(`Total de briefings analisados: ${report.briefings.length}`);
      log(`Briefings fora do padrão: ${report.summary.nonStandardBriefingsCount}\n`);

      for (const b of report.briefings) {
        log(`• Prospect: "${b.prospectName}" (ID: ${b.id}, Status: ${b.status})`);
        if (b.actualWhatsAppGroupName) {
          const wppStatus = b.whatsAppEvaluation?.isStandard ? "✅ PADRÃO" : `❌ FORA DO PADRÃO: ${b.whatsAppEvaluation?.reason}`;
          log(`  - WhatsApp Atual:    "${b.actualWhatsAppGroupName}" -> ${wppStatus}`);
        } else {
          log(`  - WhatsApp Atual:    [Não registrado no briefing]`);
        }
        log(`  - WhatsApp Esperado: "${b.expectedWhatsAppGroupName}"`);

        if (b.actualSlackChannelName) {
          const slkStatus = b.slackEvaluation?.isStandard ? "✅ PADRÃO" : `❌ FORA DO PADRÃO: ${b.slackEvaluation?.reason}`;
          log(`  - Slack Atual:       "${b.actualSlackChannelName}" -> ${slkStatus}`);
        } else {
          log(`  - Slack Atual:       [Não registrado no briefing]`);
        }
        log(`  - Slack Esperado:    "${b.expectedSlackChannelName}"\n`);
      }
    }

    log("--- MAPEAMENTOS SLACK (public.slack_channel_map) ---");
    if (report.maps.length === 0) {
      log("Nenhum mapeamento na tabela slack_channel_map.");
    } else {
      log(`Total de mapeamentos: ${report.maps.length}`);
      for (const m of report.maps) {
        log(`• Cliente: "${m.clientName}" (JID: ${m.whatsappJid}, Canal ID: ${m.slackChannelId})`);
        log(`  - WhatsApp Esperado: "${m.expectedWhatsAppGroupName}"`);
        log(`  - Slack Esperado:    "${m.expectedSlackChannelName}"`);
        if (m.actualSlackChannelName) {
          const slkStatus = m.slackEvaluation?.isStandard ? "✅ PADRÃO" : `❌ FORA DO PADRÃO: ${m.slackEvaluation?.reason}`;
          log(`  - Slack Resolvido:   "${m.actualSlackChannelName}" -> ${slkStatus}`);
        }
      }
    }

    log("\n================================================================================");
    log(`RESUMO: ${report.summary.nonStandardBriefingsCount} briefing(s) com canais fora do padrão.`);
    log("Nenhuma alteração foi realizada. Esta lista serve de base para decisão manual.");
    log("================================================================================\n");

    return report;
  } finally {
    await pool.end();
  }
}

// Execução direta via CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Carrega .env do backend se DATABASE_URL não estiver no ambiente
  if (!process.env.DATABASE_URL) {
    const envPath = resolve(__dirname, "../../.env");
    if (existsSync(envPath)) {
      try {
        const dotenv = await import("dotenv");
        dotenv.config({ path: envPath });
      } catch {
        // dotenv pode não ser carregável
      }
    }
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Defina DATABASE_URL (ou configure backend/.env) para rodar.");
    process.exit(1);
  }

  run(connectionString).catch((err) => {
    console.error("Falha ao inspecionar canais de onboarding:", err.message);
    process.exit(1);
  });
}
