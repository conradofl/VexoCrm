import { Worker } from "bullmq";
import { pgDatabasePool as pool } from "../services/database.js";
import { QUEUE_NAME, getRedisConnection } from "./slackQueue.js";
import { buildOnboardingNames } from "../services/onboardingNaming.js";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

const MAX_ATTEMPTS = 3;

async function processSlackJob(job) {
  const { 
    clientName, 
    whatsappNumber, 
    produtosContratados = [], 
    objetivoTrafego, 
    verba, 
    publicoAlvo, 
    driveLink,
    slackChannelName,
    slackExtraChannels = [],
    slackMembers = []
  } = job.data;

  // Normaliza o número
  const normalizeWhatsapp = (num) => {
    let clean = (num || "").replace(/\D/g, "");
    if (clean.length === 10 || clean.length === 11) return "55" + clean;
    return clean;
  };
  const jid = normalizeWhatsapp(whatsappNumber) + "@s.whatsapp.net";

  // Check se já existe mapeamento para log
  const checkRes = await pool.query(
    `SELECT id FROM public.slack_channel_map WHERE whatsapp_jid = $1`,
    [jid]
  );
  if (checkRes.rows.length > 0) {
    console.log(`[gd-setup] JID ${jid} já possui canal mapeado. Criando canais no Slack mesmo assim para fins de teste/dossiê.`);
  }

  if (!SLACK_BOT_TOKEN) {
    throw new Error("SLACK_BOT_TOKEN não configurado.");
  }

  // Nome padronizado único do canal: 02-cli-{slug}
  const onboardingNames = buildOnboardingNames(clientName);
  // Helper para criar canal e retornar ID
  async function createSlackChannel(rawName) {
    const name = (rawName || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    const createRes = await fetch("https://slack.com/api/conversations.create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
      body: JSON.stringify({ name }),
    });
    const createData = await createRes.json();
    if (createData.ok) return createData.channel.id;

    if (createData.error !== "name_taken") {
      throw new Error(`Erro ao criar canal ${name}: ${createData.error}`);
    }

    let cursor = "";
    let achado = null;
    let erroLista = null;
    for (let i = 0; i < 20 && !achado; i++) {
      const url =
        "https://slack.com/api/conversations.list?limit=1000&exclude_archived=false" +
        "&types=public_channel" +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const listRes = await fetch(url, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
      const listData = await listRes.json();
      if (!listData.ok) { erroLista = listData.error; break; }
      achado = (listData.channels || []).find((c) => c.name === name);
      cursor = listData.response_metadata?.next_cursor || "";
      if (!cursor) break;
    }
    if (achado) return achado.id;

    const sufixo = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "");
    const nomeAlt = `${name}-${sufixo}`.slice(0, 80);
    const retryRes = await fetch("https://slack.com/api/conversations.create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
      body: JSON.stringify({ name: nomeAlt }),
    });
    const retryData = await retryRes.json();
    if (retryData.ok) {
      console.warn(`[gd-setup] "${name}" já existia e o bot não o encontrou (${erroLista || "sem escopo de leitura"}). Criado "${nomeAlt}".`);
      return retryData.channel.id;
    }
    throw new Error(
      `O canal "${name}" já existe e o bot não consegue acessá-lo (${erroLista || "falta o escopo channels:read"}). Adicione o escopo ao app do Slack ou use um nome de canal novo.`
    );
  }

  async function joinSlackChannel(channelId) {
    try {
      const res = await fetch("https://slack.com/api/conversations.join", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        body: JSON.stringify({ channel: channelId }),
      });
      const data = await res.json();
      if (!data.ok && data.error !== "already_in_channel") {
        console.warn(`[gd-setup] Aviso ao entrar no canal ${channelId}:`, data.error);
      }
    } catch (err) {
      console.warn(`[gd-setup] Erro ao entrar no canal ${channelId}:`, err.message);
    }
  }

  // Helper para convidar pessoas
  async function inviteToChannel(channelId, userIds) {
    if (!userIds || userIds.length === 0) {
      console.log(`[gd-setup] Nenhum integrante do Slack selecionado para o canal ${channelId}.`);
      return;
    }
    try {
      const res = await fetch("https://slack.com/api/conversations.invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        body: JSON.stringify({ channel: channelId, users: userIds.join(",") }),
      });
      const data = await res.json();
      if (data.ok) {
        console.log(`[gd-setup] ${userIds.length} integrante(s) convidado(s) com sucesso para o canal ${channelId}.`);
      } else if (data.error !== "already_in_channel") {
        console.warn(`[gd-setup] Aviso ao convidar para o canal ${channelId}: ${data.error}.`);
      }
    } catch (err) {
      console.warn(`[gd-setup] Erro ao convidar integrantes:`, err.message);
    }
  }

  const channelName = (slackChannelName && !slackChannelName.startsWith("gd-"))
    ? slackChannelName
    : onboardingNames.slackChannelName;
  const channelId = await createSlackChannel(channelName);
  await joinSlackChannel(channelId);
  await inviteToChannel(channelId, slackMembers);

  // Criar canais extras se houver
  for (const extraName of slackExtraChannels) {
    try {
      const extraId = await createSlackChannel(extraName);
      await joinSlackChannel(extraId);
      await inviteToChannel(extraId, slackMembers);
    } catch (err) {
      console.warn(`[gd-setup] Aviso: Não foi possível criar canal extra ${extraName}`, err);
    }
  }

  // 2. Post message (Dossiê)
  let membersMentions = "";
  if (slackMembers && slackMembers.length > 0) {
    membersMentions = slackMembers.map(id => `<@${id}>`).join(" ");
  }

  const textMsg = `*Novo Dossiê Geração Digital*\n*Cliente:* ${clientName}\n*Whatsapp:* ${whatsappNumber}\n*Produtos:* ${produtosContratados.join(", ")}\n*Objetivo:* ${objetivoTrafego}\n*Verba:* ${verba}\n*Público:* ${publicoAlvo}\n*Drive:* ${driveLink || "Não informado"}`;
  
  const mainFields = [
    { type: "mrkdwn", text: `*Cliente:*\n${clientName}` },
    { type: "mrkdwn", text: `*WhatsApp:*\n${whatsappNumber}` },
    { type: "mrkdwn", text: `*Verba:*\n${verba}` },
    { type: "mrkdwn", text: `*Produtos:*\n${produtosContratados.join(", ")}` }
  ];

  const secondaryFields = [
    { type: "mrkdwn", text: `*Objetivo:*\n${objetivoTrafego}` },
    { type: "mrkdwn", text: `*Público Alvo:*\n${publicoAlvo}` }
  ];

  if (membersMentions) {
    secondaryFields.push({ type: "mrkdwn", text: `*Responsáveis:*\n${membersMentions}` });
  }

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "📄 Dossiê do Cliente (Geração Digital)" }
    },
    {
      type: "section",
      fields: mainFields
    },
    {
      type: "section",
      fields: secondaryFields
    }
  ];

  if (driveLink) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Pasta do Drive:*\n<${driveLink}|Acessar Arquivos>` }
    });
  }

  const postRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      channel: channelId,
      text: textMsg,
      blocks: blocks
    }),
  });
  const postData = await postRes.json();
  if (!postData.ok) {
    throw new Error(`Erro ao postar mensagem: ${postData.error}`);
  }

  const messageTs = postData.ts;

  // 3. Pin message
  const pinRes = await fetch("https://slack.com/api/pins.add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      channel: channelId,
      timestamp: messageTs
    }),
  });
  const pinData = await pinRes.json();
  if (!pinData.ok && pinData.error !== "already_pinned") {
    console.warn(`[gd-setup] Erro ao pinar mensagem (ignorado): ${pinData.error}`);
  }

  // 4. Salvar no banco
  await pool.query(
    `INSERT INTO public.slack_channel_map (client_name, whatsapp_jid, slack_channel_id, drive_folder_id, instance_name, status)
     VALUES ($1, $2, $3, $4, 'gd-oficial', 'active')
     ON CONFLICT (whatsapp_jid) DO NOTHING`,
    [clientName, jid, channelId, driveLink || null]
  );

  return { status: "success", channelId };
}

export function startSlackWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`[gd-setup] Processando job ${job.id} - Cliente: ${job.data.clientName}`);
      return processSlackJob(job);
    },
    {
      connection: getRedisConnection(),
      concurrency: 2,
    }
  );

  worker.on("failed", async (job, err) => {
    console.error(`[gd-setup] Job falhou: ${job?.id} - ${err.message}`);
    // Se esgotar tentativas, logar em #logs-vexo
    if (job && job.attemptsMade >= MAX_ATTEMPTS) {
      if (SLACK_BOT_TOKEN) {
        try {
          await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            },
            body: JSON.stringify({
              channel: "logs-vexo",
              text: `🚨 *Erro crítico no worker gd-setup*\nCliente: ${job.data.clientName}\nErro: ${err.message}`
            }),
          });
        } catch (e) {
          console.error("[gd-setup] Falha ao enviar log para o slack", e);
        }
      }
    }
  });

  worker.on("error", (err) => {
    console.error("[gd-setup] Worker error:", err.message);
  });

  console.info(`[gd-setup] Worker BullMQ iniciado — fila: ${QUEUE_NAME}`);
  _worker = worker;
  return worker;
}

let _worker = null;

export async function pauseSlackWorker() {
  if (_worker) {
    try {
      await _worker.pause();
      console.info("[gd-setup] Worker pausado (não aceita novos jobs).");
    } catch (err) {
      console.warn("[gd-setup] Erro ao pausar worker:", err.message || err);
    }
  }
}

export async function stopSlackWorker() {
  if (_worker) {
    try {
      await _worker.close();
      console.info("[gd-setup] Worker encerrado.");
    } catch (err) {
      console.warn("[gd-setup] Erro ao encerrar worker:", err.message || err);
    } finally {
      _worker = null;
    }
  }
}
