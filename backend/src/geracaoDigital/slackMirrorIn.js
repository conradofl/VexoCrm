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

  // 2. Trava de Grupos Removida
  // if (remoteJid && remoteJid.endsWith("@g.us")) return;

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
    let uploadedMedia = false;
    
    if (isMedia) {
      try {
        const EVOLUTION_API_TOKEN = process.env.GD_EVOLUTION_API_TOKEN || "429683C4C977415CAAFCCE10F7D57E11";
        const b64Res = await fetch(`https://apps-evolution-api.ymqjmy.easypanel.host/chat/getBase64FromMediaMessage/${instance}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": EVOLUTION_API_TOKEN },
          body: JSON.stringify({ message: data }) 
        });
        
        const b64Data = await b64Res.json();
        if (b64Data && b64Data.base64) {
          const buffer = Buffer.from(b64Data.base64, "base64");
          
          // Trava de 10MB
          if (buffer.length < 10 * 1024 * 1024) {
            let filename = `media_${messageId}`;
            if (mediaType === "Imagem") filename += ".jpeg";
            else if (mediaType === "Áudio") filename += ".ogg";
            else if (mediaType === "Vídeo") filename += ".mp4";
            else filename += ".bin";

            const resUrl = await fetch("https://slack.com/api/files.getUploadURLExternal", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
              body: `filename=${encodeURIComponent(filename)}&length=${buffer.length}`
            });
            const urlData = await resUrl.json();
            
            if (urlData.ok) {
              const uploadRes = await fetch(urlData.upload_url, { method: "POST", body: buffer });
              if (uploadRes.ok) {
                const compRes = await fetch("https://slack.com/api/files.completeUploadExternal", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
                  body: JSON.stringify({ 
                    files: [{ id: urlData.file_id, title: filename }], 
                    channel_id: targetChannel,
                    initial_comment: `*${pushName}* enviou uma mídia:\n${text}`
                  })
                });
                const compData = await compRes.json();
                if (compData.ok) uploadedMedia = true;
              }
            }
          }
        }
      } catch (err) {
        console.error("[gd-mirror-in] Erro ao baixar ou enviar mídia:", err.message);
      }
    }

    let postData = { ok: true }; // se já fez uploadMedia
    if (!uploadedMedia) {
      // Fallback pra texto caso seja texto comum ou caso o upload da mídia falhe
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
      postData = await postRes.json();
    }
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
