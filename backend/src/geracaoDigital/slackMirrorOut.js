import fetch from "node-fetch";

// Processar a mensagem de saída do Slack e enviar para a Evolution API (WhatsApp)
export async function processSlackMessageToEvolution(pool, event) {
  const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
  
  if (!event || event.type !== "message") return;

  // 1. Ignorar bots e mensagens de sistema (exceto file_share)
  if (event.bot_id) return;
  if (event.subtype && event.subtype !== "file_share") return;

  const text = event.text || "";
  const channel = event.channel; // slack_channel_id

  // 2. Ignorar mensagens que começam com "//" (mensagens internas)
  if (text.trim().startsWith("//")) return;

  try {
    // 3. Lookup reverso na tabela slack_channel_map
    const resMap = await pool.query(
      `SELECT whatsapp_jid FROM public.slack_channel_map WHERE slack_channel_id = $1 LIMIT 1`,
      [channel]
    );

    if (resMap.rows.length === 0 || !resMap.rows[0].whatsapp_jid) {
      // Se não achar correspondência, a mensagem pode ser num canal não mapeado. Ignora.
      return;
    }

    const targetJid = resMap.rows[0].whatsapp_jid;
    
    // 4. Integração Evolution API
    const evolutionUrl = process.env.GD_EVOLUTION_URL;
    const evolutionToken = process.env.GD_EVOLUTION_TOKEN;
    const instanceName = process.env.GD_EVOLUTION_INSTANCE || "gd-oficial";

    if (!evolutionUrl || !evolutionToken) {
      throw new Error("Evolution URL ou Token não configurados no ambiente.");
    }

    let baseUrl = evolutionUrl.endsWith("/") ? evolutionUrl.slice(0, -1) : evolutionUrl;
    if (baseUrl.includes("/message/sendText")) {
      baseUrl = baseUrl.split("/message/sendText")[0];
    }
    let endpoint = `${baseUrl}/message/sendText/${instanceName}`;

    // Clean JID to number format if needed (e.g. remove @s.whatsapp.net for Evolution)
    let number = targetJid;
    if (number.includes("@")) {
      number = number.split("@")[0];
    }

    let isMedia = false;
    let base64Media = "";
    let evolutionMediaType = "document";
    let slackMimetype = "application/octet-stream";
    let slackFilename = "arquivo";

    if (event.files && event.files.length > 0) {
      const file = event.files[0];
      if (file.size > 10 * 1024 * 1024) {
        throw new Error("Arquivo excede limite de segurança de 10MB.");
      }
      isMedia = true;
      slackMimetype = file.mimetype || "application/octet-stream";
      slackFilename = file.name || "arquivo";

      if (slackMimetype.startsWith("image/")) evolutionMediaType = "image";
      else if (slackMimetype.startsWith("audio/")) evolutionMediaType = "audio";
      else if (slackMimetype.startsWith("video/")) evolutionMediaType = "video";
      else evolutionMediaType = "document";

      const fileRes = await fetch(file.url_private_download, {
        headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}` }
      });
      if (!fileRes.ok) throw new Error(`Erro ao baixar anexo do Slack: ${fileRes.status}`);
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      base64Media = buffer.toString("base64");
    }

    let payload = {
      number: number,
      options: { delay: 1200, presence: "composing" }
    };

    if (isMedia) {
      endpoint = `${baseUrl}/message/sendMedia/${instanceName}`;
      payload.mediatype = evolutionMediaType;
      payload.mimetype = slackMimetype;
      payload.media = base64Media;
      payload.fileName = slackFilename;
      if (text) payload.caption = text;
    } else {
      payload.textMessage = { text: text };
      payload.text = text; // Propriedade obrigatória
    }

    let attempt = 1;
    const maxAttempts = 3;
    let sent = false;

    // 5. Retry loop
    while (attempt <= maxAttempts && !sent) {
      try {
        const evRes = await fetch(endpoint, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json", 
            "apikey": evolutionToken 
          },
          body: JSON.stringify(payload),
        });

        if (!evRes.ok) {
          const bodyTxt = await evRes.text();
          throw new Error(`Status ${evRes.status}: ${bodyTxt}`);
        }
        sent = true;
      } catch (e) {
        if (attempt === maxAttempts) {
          throw e; // Lança para o catch externo
        }
        // Espera backoff exponencial: 1s, 2s...
        await new Promise(r => setTimeout(r, attempt * 1000));
        attempt++;
      }
    }

  } catch (error) {
    console.error("[gd-mirror-out] Erro ao enviar para Evolution:", error);
    
    if (SLACK_BOT_TOKEN) {
      try {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SLACK_BOT_TOKEN}` },
          body: JSON.stringify({
            channel: "#logs-vexo",
            text: `🚨 *Erro no gd-mirror-out*\nFalha ao enviar mensagem do canal <#${channel}> para o WhatsApp.\n\`\`\`${error.message}\`\`\``
          })
        });
      } catch (e) {
        // Ignora
      }
    }
  }
}
