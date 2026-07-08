import { Worker } from "bullmq";
import { pgDatabasePool as pool } from "../services/database.js";
import { QUEUE_NAME, getRedisConnection } from "./slackQueue.js";

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

  // Check idempotency
  const checkRes = await pool.query(
    `SELECT id FROM public.slack_channel_map WHERE whatsapp_jid = $1`,
    [jid]
  );
  if (checkRes.rows.length > 0) {
    console.log(`[gd-setup] JID ${jid} já processado. Ignorando.`);
    return { status: "skipped_idempotent", jid };
  }

  if (!SLACK_BOT_TOKEN) {
    throw new Error("SLACK_BOT_TOKEN não configurado.");
  }

  // Nome do canal: cli-{slug}
  const slug = (clientName || "cliente-sem-nome")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 21);
  // Helper para criar canal e retornar ID
  async function createSlackChannel(name) {
    const createRes = await fetch("https://slack.com/api/conversations.create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ name }),
    });
    const createData = await createRes.json();
    
    if (!createData.ok) {
      if (createData.error === "name_taken") {
        const listRes = await fetch("https://slack.com/api/conversations.list?types=public_channel,private_channel", {
          headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
        });
        const listData = await listRes.json();
        const existingChannel = listData.channels?.find(c => c.name === name);
        if (!existingChannel) {
          throw new Error(`Canal ${name} existe mas não foi encontrado na listagem.`);
        }
        return existingChannel.id;
      } else {
        throw new Error(`Erro ao criar canal ${name}: ${createData.error}`);
      }
    }
    return createData.channel.id;
  }

  // Helper para convidar pessoas
  async function inviteToChannel(channelId, userIds) {
    if (!userIds || userIds.length === 0) return;
    const res = await fetch("https://slack.com/api/conversations.invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel: channelId, users: userIds.join(",") }),
    });
    const data = await res.json();
    if (!data.ok && data.error !== "already_in_channel") {
      console.warn(`[gd-setup] Erro ao convidar para o canal ${channelId}:`, data.error);
    }
  }

  const channelName = slackChannelName || `cli-${slug}`;
  const channelId = await createSlackChannel(channelName);
  await inviteToChannel(channelId, slackMembers);

  // Criar canais extras se houver
  for (const extraName of slackExtraChannels) {
    try {
      const extraId = await createSlackChannel(extraName);
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
  return worker;
}
