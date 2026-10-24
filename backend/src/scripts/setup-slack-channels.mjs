#!/usr/bin/env node

/**
 * setup-slack-channels.mjs
 * 
 * Script utilitário para provisionamento automatizado dos canais oficiais do Slack
 * na reestruturação operacional da Geração Digital & Vexo OS.
 * 
 * Uso:
 *   SLACK_BOT_TOKEN="xoxb-seu-token" node backend/src/scripts/setup-slack-channels.mjs
 *   ou simplesmente:
 *   node backend/src/scripts/setup-slack-channels.mjs (lê SLACK_BOT_TOKEN do backend/.env)
 *   node backend/src/scripts/setup-slack-channels.mjs --dry-run (só mostra o que faria; nenhuma chamada ao Slack)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega .env do backend caso SLACK_BOT_TOKEN não esteja no ambiente
function loadEnvFallback() {
  if (process.env.SLACK_BOT_TOKEN) return;
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
    console.warn("[setup-slack] Aviso: Não foi possível ler backend/.env:", err.message);
  }
}

loadEnvFallback();

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const dryRun = process.argv.slice(2).includes("--dry-run");

const OFFICIAL_CHANNELS = [
  {
    name: "00-comunicados",
    topic: "📢 Avisos de diretoria, comunicados oficiais e decisões estratégicas",
    purpose: "Canal oficial para anúncios de alta relevância da Geração Digital & Vexo OS."
  },
  {
    name: "01-ops-geral",
    topic: "☀️ Daily de alinhamento operacional, check-in 09h e check-out 18h",
    purpose: "Alinhamento operacional geral diário entre equipes e sócios."
  },
  {
    name: "01-ops-trafego",
    topic: "📊 Métricas diárias, otimizações de campanhas e contas de anúncios",
    purpose: "Operação, acompanhamento de ROI e inteligência de tráfego pago."
  },
  {
    name: "01-ops-criativos",
    topic: "🎨 Aprovações visuais, copys, criativos e esteira de design",
    purpose: "Produção e aprovação ágil de peças publicitárias, copys e vídeos."
  },
  {
    name: "01-ops-comercial",
    topic: "🤝 Novos contratos fechados, entradas de clientes e onboarding",
    purpose: "Comunicação comercial e transição rápida de vendas para operações."
  },
  {
    name: "99-resenha",
    topic: "☕ Descontração, memes e conversas informais da equipe",
    purpose: "Espaço livre de descontração para fortalecer a cultura e integração do time."
  }
];

async function slackApi(method, body = null) {
  const url = `https://slack.com/api/${method}`;
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  return await res.json();
}

async function findChannelIdByName(channelName) {
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const query = new URLSearchParams({
      types: "public_channel",
      limit: "1000",
      exclude_archived: "false",
    });
    if (cursor) query.set("cursor", cursor);

    const res = await fetch(`https://slack.com/api/conversations.list?${query.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn(`[setup-slack] Aviso ao listar canais: ${data.error}`);
      return null;
    }

    const found = (data.channels || []).find((c) => c.name === channelName);
    if (found) return found.id;

    cursor = data.response_metadata?.next_cursor || "";
    if (!cursor) break;
  }
  return null;
}

async function run() {
  console.log("\n=======================================================");
  console.log("🚀 SETUP DE CANAIS OFICIAIS DO SLACK · GERAÇÃO DIGITAL");
  console.log("=======================================================\n");
  console.log(`• Dry Run (Apenas Prévia): \x1b[33m${dryRun ? "SIM" : "NÃO"}\x1b[0m\n`);

  // Para antes de qualquer chamada de rede: nem auth.test. Com backend/.env presente o token real é carregado, e
  // sem esta parada rodar o script (ou o teste dele) cria os canais de verdade.
  if (dryRun) {
    console.log(`🔐 SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN ? "presente" : "não informado"}`);
    console.log("📋 Canais que seriam criados ou atualizados (tópico e descrição):");
    for (const item of OFFICIAL_CHANNELS) {
      console.log(`   • #${item.name} — ${item.topic}`);
    }
    console.log("\n✨ Execução em modo Dry Run finalizada! (Nenhuma chamada ao Slack)\n");
    return;
  }

  if (!SLACK_BOT_TOKEN) {
    console.error("❌ ERRO FATAL: SLACK_BOT_TOKEN não informado.");
    console.error("Defina a variável no ambiente ou no arquivo backend/.env:");
    console.error("  SLACK_BOT_TOKEN=\"xoxb-...\" node backend/src/scripts/setup-slack-channels.mjs\n");
    process.exit(1);
  }

  // 1. Testa autenticação
  process.stdout.write("🔐 Verificando autenticação do bot no Slack... ");
  const authTest = await slackApi("auth.test");
  if (!authTest.ok) {
    console.log("FALHOU!");
    console.error(`❌ Erro de autenticação: ${authTest.error}`);
    process.exit(1);
  }
  console.log("OK!");
  console.log(`   • Workspace: \x1b[36m${authTest.team}\x1b[0m (ID: ${authTest.team_id})`);
  console.log(`   • Bot:       \x1b[32m@${authTest.user}\x1b[0m (ID: ${authTest.user_id})\n`);

  const results = [];

  // 2. Itera e provisiona cada canal
  for (const item of OFFICIAL_CHANNELS) {
    process.stdout.write(`⚙️  Processando #${item.name}... `);

    let channelId = null;
    let status = "desconhecido";

    // Tenta criar o canal
    const createRes = await slackApi("conversations.create", {
      name: item.name,
      is_private: false,
    });

    if (createRes.ok) {
      channelId = createRes.channel.id;
      status = "CRIADO";
      process.stdout.write("\x1b[32mCRIADO COM SUCESSO\x1b[0m\n");
    } else if (createRes.error === "name_taken") {
      process.stdout.write("\x1b[33mJÁ EXISTE\x1b[0m (buscando ID)... ");
      channelId = await findChannelIdByName(item.name);
      if (channelId) {
        status = "JÁ EXISTENTE";
        process.stdout.write(`[${channelId}]\n`);
      } else {
        status = "ERRO_BUSCA";
        process.stdout.write("\x1b[31mNão encontrado na listagem\x1b[0m\n");
      }
    } else {
      status = `ERRO: ${createRes.error}`;
      process.stdout.write(`\x1b[31mFALHA (${createRes.error})\x1b[0m\n`);
    }

    if (channelId) {
      // Bot entra no canal (garante presença para envio de mensagens/auditorias)
      try {
        await slackApi("conversations.join", { channel: channelId });
      } catch (_) {}

      // Configura Tópico
      if (item.topic) {
        try {
          await slackApi("conversations.setTopic", {
            channel: channelId,
            topic: item.topic,
          });
        } catch (e) {
          // Ignora se não houver permissão de alterar tópico
        }
      }

      // Configura Purpose (descrição)
      if (item.purpose) {
        try {
          await slackApi("conversations.setPurpose", {
            channel: channelId,
            purpose: item.purpose,
          });
        } catch (e) {
          // Ignora se não houver permissão
        }
      }
    }

    results.push({
      channel: `#${item.name}`,
      id: channelId || "N/A",
      status,
      topic: item.topic,
    });
  }

  // 3. Tabela de Resumo Final
  console.log("\n📋 RESUMO FINAL DO PROVISIONAMENTO:");
  console.log("-----------------------------------------------------------------------------------------");
  console.log(
    "Canal".padEnd(20) +
    "ID".padEnd(16) +
    "Status".padEnd(18) +
    "Tópico"
  );
  console.log("-----------------------------------------------------------------------------------------");
  for (const r of results) {
    console.log(
      r.channel.padEnd(20) +
      r.id.padEnd(16) +
      r.status.padEnd(18) +
      (r.topic || "").slice(0, 35) + "..."
    );
  }
  console.log("-----------------------------------------------------------------------------------------\n");
  console.log("✨ Provisionamento de canais concluído!\n");
}

run().catch((err) => {
  console.error("❌ Erro inesperado na execução:", err);
  process.exit(1);
});
