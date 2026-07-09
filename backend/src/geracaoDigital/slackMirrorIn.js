import fetch from "node-fetch"; // Assumindo node-fetch ou fetch nativo (Node 18+)
import { getGdRedisClient } from "./redisClient.js";

// Função para processar a chegada de mensagem do WhatsApp e mandar para o Slack
export async function processEvolutionMessageToSlack(pool, payload) {
  const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
  if (!SLACK_BOT_TOKEN) {
    console.error("[gd-mirror-in] SLACK_BOT_TOKEN ausente");
    return;
  }

  // Desestruturando o padrão Evolution MESSAGES_UPSERT
  // payload: { instance: "...", data: { key: { remoteJid, fromMe, id }, pushName, message: { conversation, extendedTextMessage... } } }
  const { instance, data } = payload;
  if (!data || !data.key) return;

  const { remoteJid, fromMe, id: messageId } = data.key;

  // 1. Ignorar fromMe (anti-loop)
  if (fromMe) return;

  // 2. Ignorar grupos
  if (remoteJid && remoteJid.endsWith("@g.us")) return;

  // 3. Deduplicação via Redis
  const redis = getGdRedisClient();
  const redisKey = `gd:msg:${messageId}`;
  const isNew = await redis.set(redisKey, "1", "EX", 86400, "NX");
  if (!isNew) {
    console.log(`[gd-mirror-in] Mensagem duplicada ignorada: ${messageId}`);
    return;
  }

  // 4. Extração de texto/mídia
  let text = "";
  let isMedia = false;
  let mediaType = "";

  if (data.message) {
    if (data.message.conversation) {
      text = data.message.conversation;
    } else if (data.message.extendedTextMessage && data.message.extendedTextMessage.text) {
      text = data.message.extendedTextMessage.text;
    } else if (data.message.imageMessage) {
      isMedia = true;
      mediaType = "Imagem";
      text = data.message.imageMessage.caption || "";
    } else if (data.message.videoMessage) {
      isMedia = true;
      mediaType = "Vídeo";
      text = data.message.videoMessage.caption || "";
    } else if (data.message.audioMessage) {
      isMedia = true;
      mediaType = "Áudio";
    } else if (data.message.documentMessage) {
      isMedia = true;
      mediaType = "Documento";
      text = data.message.documentMessage.caption || data.message.documentMessage.title || "";
    } else if (data.message.stickerMessage) {
      isMedia = true;
      mediaType = "Figurinha";
    } else {
      isMedia = true;
      mediaType = "Mídia";
    }
  }

  const pushName = data.pushName || "Lead";
  let slackMsgText = `*${pushName}:*\n${text}`;
  
  if (isMedia) {
    slackMsgText = `*${pushName}:*\n📎 [${mediaType} recebido — ver no telefone]\n${text}`;
  }

  try {
    // 5. Lookup do canal na tabela slack_channel_map
    const resMap = await pool.query(
      `SELECT slack_channel_id FROM public.slack_channel_map WHERE whatsapp_jid = $1 LIMIT 1`,
      [remoteJid]
    );

    let targetChannel = "#triagem-gd";
    if (resMap.rows.length > 0 && resMap.rows[0].slack_channel_id) {
      targetChannel = resMap.rows[0].slack_channel_id;
    } else {
      // Se for pra triagem, adicionar o numero e nome ao log
      slackMsgText = `*Mensagem de Número Desconhecido (${pushName} - ${remoteJid}):*\n${slackMsgText}`;
    }

    // 6. Enviar para o Slack
    const postRes = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${SLACK_BOT_TOKEN}` 
      },
      body: JSON.stringify({
        channel: targetChannel,
        text: slackMsgText
      })
    });

    const postData = await postRes.json();
    if (!postData.ok) {
      console.error(`[gd-mirror-in] Falha ao enviar pro Slack (${targetChannel}):`, postData.error);
      
      // Enviar pro log
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SLACK_BOT_TOKEN}` },
        body: JSON.stringify({
          channel: "#logs-vexo",
          text: `🚨 *Erro no gd-mirror-in*\nNão consegui postar mensagem no canal ${targetChannel}.\nErro: ${postData.error}`
        })
      });
    }

  } catch (error) {
    console.error("[gd-mirror-in] Erro ao processar mensagem do Evolution:", error);
    try {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SLACK_BOT_TOKEN}` },
        body: JSON.stringify({
          channel: "#logs-vexo",
          text: `🚨 *Exceção Crítica no gd-mirror-in*\n\`\`\`${error.message}\`\`\``
        })
      });
    } catch (e) {
      // Falha total, apenas loga
    }
  }
}
