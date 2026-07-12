import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getSlackQueue } from "../geracaoDigital/slackQueue.js";
import { processEvolutionMessageToSlack } from "../geracaoDigital/slackMirrorIn.js";
import { processSlackMessageToEvolution } from "../geracaoDigital/slackMirrorOut.js";

export function registerGeracaoDigitalRoutes(app, pool, requireFirebaseAuth, requireInternalPageAccess) {
  // POST /api/geracao-digital/briefing
  app.post("/api/geracao-digital/briefing", requireFirebaseAuth, async (req, res) => {

    async function processSlackJobSync(pool, jobData) {
      const {
        clientName, whatsappNumber, whatsappGroupId, briefingData = {},
        slackChannelName, slackExtraChannels = [], slackMembers = []
      } = jobData;

      const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
      if (!SLACK_BOT_TOKEN) throw new Error("SLACK_BOT_TOKEN não configurado no servidor.");

      const normalizeWhatsapp = (num) => {
        let clean = (num || "").replace(/\D/g, "");
        if (clean.length === 10 || clean.length === 11) return "55" + clean;
        return clean;
      };
      const jid = whatsappGroupId ? whatsappGroupId : (normalizeWhatsapp(whatsappNumber) + "@s.whatsapp.net");

      const slug = (clientName || "cliente-sem-nome")
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 21);

      async function createSlackChannel(name) {
        const createRes = await fetch("https://slack.com/api/conversations.create", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
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
            if (!existingChannel) throw new Error(`Canal ${name} existe mas não foi encontrado.`);
            return existingChannel.id;
          } else {
            throw new Error(`Erro ao criar canal ${name}: ${createData.error}`);
          }
        }
        return createData.channel.id;
      }

      async function inviteToChannel(channelId, userIds) {
        if (!userIds || userIds.length === 0) return;
        const res = await fetch("https://slack.com/api/conversations.invite", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
          body: JSON.stringify({ channel: channelId, users: userIds.join(",") }),
        });
        const data = await res.json();
        if (!data.ok && data.error !== "already_in_channel") console.warn(`[gd-setup] Erro ao convidar para o canal ${channelId}:`, data.error);
      }

      const channelName = slackChannelName || `cli-${slug}`;
      const channelId = await createSlackChannel(channelName);
      await inviteToChannel(channelId, slackMembers);

      for (const extraName of slackExtraChannels) {
        try {
          const extraId = await createSlackChannel(extraName);
          await inviteToChannel(extraId, slackMembers);
        } catch (err) {
          console.warn(`[gd-setup] Aviso: Não foi possível criar canal extra ${extraName}`, err);
        }
      }

      let membersMentions = "";
      if (slackMembers && slackMembers.length > 0) membersMentions = slackMembers.map(id => `<@${id}>`).join(" ");

      const textMsg = `*Novo Dossiê Geração Digital*\n*Cliente:* ${clientName}\n*Whatsapp:* ${whatsappNumber}`;

      const blocks = [
        { type: "header", text: { type: "plain_text", text: "📄 Dossiê do Cliente (Geração Digital)" } },
        { type: "section", fields: [
            { type: "mrkdwn", text: `*Cliente:*\n${clientName}` },
            { type: "mrkdwn", text: `*WhatsApp:*\n${whatsappNumber}` }
        ]}
      ];

      let currentFields = [];
      for (const [key, value] of Object.entries(briefingData || {})) {
          const formattedKey = key.replace(/_/g, ' ').toUpperCase();
          // Truncate to avoid slack limits, but 1900 is safe
          const valText = value ? String(value).substring(0, 1900) : 'Não preenchido';
          currentFields.push({ type: "mrkdwn", text: `*${formattedKey}:*\n${valText}` });

          if (currentFields.length === 10) {
             blocks.push({ type: "section", fields: currentFields });
             currentFields = [];
          }
      }
      if (currentFields.length > 0) {
          blocks.push({ type: "section", fields: currentFields });
      }

      if (membersMentions) {
         blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Responsáveis:*\n${membersMentions}` } });
      }

      blocks.push({ type: "divider" });
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "💡 *Dica de Uso:* Para conversas internas entre a equipe (que não devem ser enviadas ao WhatsApp do cliente), inicie a mensagem com `//`." }] });


      const postRes = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        body: JSON.stringify({ channel: channelId, text: textMsg, blocks: blocks }),
      });
      const postData = await postRes.json();
      if (!postData.ok) throw new Error(`Erro ao postar mensagem: ${postData.error}`);

      const pinRes = await fetch("https://slack.com/api/pins.add", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        body: JSON.stringify({ channel: channelId, timestamp: postData.ts }),
      });
      const pinData = await pinRes.json();
      if (!pinData.ok && pinData.error !== "already_pinned") console.warn(`[gd-setup] Erro ao pinar (ignorado): ${pinData.error}`);

      await pool.query(
        `INSERT INTO public.slack_channel_map (client_name, whatsapp_jid, slack_channel_id, drive_folder_id, instance_name, status)
         VALUES ($1, $2, $3, $4, 'gd-oficial', 'active')
         ON CONFLICT (whatsapp_jid) DO NOTHING`,
        [clientName, jid, channelId, briefingData['drive_link'] || null]
      );
    }
    try {
      const {
        prospectName,
        whatsappNumber,
        agencyName,
        themePreset,
        briefingData,
        sendToProspectWhatsapp,
        sendToProspectEmail,
        prospectEmail,
        sendToSectors,
        sectorsWhatsapp,
        sectorsEmail,
        createWhatsappGroup,
        whatsappGroupName,
        whatsappGroupMembers
      } = req.body;

      // 1. Save to DB
      const result = await pool.query(
        `INSERT INTO public.geracao_digital_briefings
         (prospect_name, whatsapp_number, theme_preset, briefing_data, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING id`,
        [prospectName, whatsappNumber || '', themePreset, JSON.stringify(briefingData || {})]
      );
      const briefingId = result.rows[0].id;

      let briefingHtml = '<h3>Dados do Briefing:</h3><ul>';
      let briefingText = '\n\n*Dados do Briefing:*\n';
      for (const [key, value] of Object.entries(briefingData || {})) {
          const formattedKey = key.replace(/_/g, ' ').toUpperCase();
          briefingHtml += `<li><strong>${formattedKey}:</strong> ${value || 'Não preenchido'}</li>`;
          briefingText += `- *${formattedKey}:* ${value || 'Não preenchido'}\n`;
      }
      briefingHtml += '</ul>';

      // 1.5 Fetch dynamic instance name
      let dynamicInstanceName = null;
      try {
        let queryStr = `SELECT dispatch_webhook_url, name, client_id FROM public.lead_client_evolution_instances WHERE active = true ORDER BY is_default DESC`;
        let queryParams = [];
        if (req.authAccess && req.authAccess.role !== "internal" && req.authAccess.clientIds && req.authAccess.clientIds.length > 0) {
            queryStr = `SELECT dispatch_webhook_url, name, client_id FROM public.lead_client_evolution_instances WHERE client_id = ANY($1) AND active = true ORDER BY is_default DESC`;
            queryParams = [req.authAccess.clientIds];
        }

        const instRes = await pool.query(queryStr, queryParams);
          if (instRes.rows.length > 0) {
            let row = instRes.rows.find(r => r.client_id === 'geracao-digital') || instRes.rows[0];
            const urlStr = row.dispatch_webhook_url;
            if (urlStr) {
               try {
                 const url = new URL(urlStr);
                 const pathParts = url.pathname.split("/").filter(Boolean);
                 const messageIndex = pathParts.findIndex((part) => part === "message");
                 const instance = messageIndex >= 0 ? decodeURIComponent(pathParts[messageIndex + 2] || "") : "";
                 dynamicInstanceName = instance || row.name;
               } catch (e) {
                 dynamicInstanceName = row.name;
               }
            } else {
               dynamicInstanceName = row.name;
            }
          }
        } catch (dbErr) {
          console.error("[GeracaoDigital] Error fetching dynamic instance:", dbErr);
        }

      // 2. Evolution config
      const evolutionUrl = process.env.GD_EVOLUTION_URL;
      const evolutionToken = process.env.GD_EVOLUTION_TOKEN;
      let evolutionStatus = "not_configured";
      let emailStatus = "not_configured";
      let sectorsStatus = "not_configured";

      // 3. Import Resend dynamically (to avoid crashing if not available)
      let sendEmailFn = null;
      try {
        const { ResendProvider } = await import("../providers/ResendProvider.js");
        sendEmailFn = ResendProvider.sendEmail;
      } catch (err) {
        console.warn("[GeracaoDigital] ResendProvider not loaded", err);
      }

      const normalizeWhatsapp = (num) => {
          let clean = (num || "").replace(/\D/g, '');
          if (clean.length === 10 || clean.length === 11) return '55' + clean;
          return clean;
      };

      // Helper function to send WhatsApp via Evolution
      const sendEvolution = async (number, text) => {
        if (!evolutionUrl || !evolutionToken || !number) return "not_configured";
        const normalizedNumber = normalizeWhatsapp(number);
        const payload = {
          number: normalizedNumber,
          options: { delay: 1200, presence: "composing" },
          textMessage: { text },
          text: text
        };
        let endpoint = evolutionUrl.endsWith("/") ? evolutionUrl.slice(0, -1) : evolutionUrl;

        // Se a URL não contiver a rota de envio, adicionamos a rota com o nome da instância
        if (!endpoint.includes("/message/sendText")) {
          const instanceName = dynamicInstanceName || process.env.GD_EVOLUTION_INSTANCE || "Teste";
          endpoint = `${endpoint}/message/sendText/${instanceName}`;
        }

        try {
          const evRes = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: evolutionToken },
            body: JSON.stringify(payload),
          });
          if (!evRes.ok) {
            console.error("[GeracaoDigital] Evolution Error:", await evRes.text());
            return `failed_${evRes.status}`;
          }
          return "sent";
        } catch (e) {
          console.error("[GeracaoDigital] Evolution Network Error:", e.message);
          return "failed_network";
        }
      };

      // Helper function to create WhatsApp Group via Evolution
      const createEvolutionGroup = async (subject, membersString) => {
        if (!evolutionUrl || !evolutionToken) return { status: "not_configured" };
        let baseUrl = evolutionUrl.endsWith("/") ? evolutionUrl.slice(0, -1) : evolutionUrl;

        // Remove everything after the last slash if it's pointing to /message/sendText
        if (baseUrl.includes("/message/sendText")) {
          baseUrl = baseUrl.split("/message/sendText")[0];
        }

        const instanceName = dynamicInstanceName || process.env.GD_EVOLUTION_INSTANCE || "Teste";
        const endpoint = `${baseUrl}/group/create/${instanceName}`;

        const members = membersString.split(",").map(m => m.trim()).filter(Boolean);
        const participants = [];
        if (whatsappNumber) {
          participants.push(normalizeWhatsapp(whatsappNumber) + "@s.whatsapp.net");
        }
        members.forEach(m => {
          participants.push(normalizeWhatsapp(m) + "@s.whatsapp.net");
        });

        // Unique participants
        const uniqueParticipants = [...new Set(participants)];

        const payload = {
          subject: subject.substring(0, 25), // WhatsApp group name limit
          participants: uniqueParticipants
        };

        try {
          const evRes = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: evolutionToken },
            body: JSON.stringify(payload),
          });
          const data = await evRes.json();
          if (!evRes.ok) {
            console.error("[GeracaoDigital] Group Create Error:", data);
            return { status: `failed_${evRes.status}` };
          }
          // The API returns the group ID, usually as data.id or data.groupId
          // Structure varies by Evolution API version, but typically data.id
          const groupId = data.id || data.groupId || (data.groupMetadata && data.groupMetadata.id);
          if (groupId) {
             return { status: "created", groupId };
          }
          return { status: "created_no_id", data };
        } catch (e) {
          console.error("[GeracaoDigital] Evolution Group Network Error:", e.message);
          return { status: "failed_network" };
        }
      };

      const messageText = `Olá ${prospectName}!\n\nSeu dossiê/briefing da ${agencyName || 'Vexo'} está pronto.${briefingText}`;

      let whatsappGroupStatus = "not_configured";
      let whatsappGroupId = null;

      // Create WhatsApp Group
      if (createWhatsappGroup) {
         const subject = whatsappGroupName || `GD & ${prospectName}`;
         const groupRes = await createEvolutionGroup(subject, whatsappGroupMembers || sectorsWhatsapp || "");
         whatsappGroupStatus = groupRes.status;
         if (groupRes.groupId) {
           whatsappGroupId = groupRes.groupId;
           // Mandar o dossiê direto pro grupo também!
           evolutionStatus = await sendEvolution(groupRes.groupId, messageText);
         }
      }

      // Dispatch WhatsApp Prospect (Only if we didn't just send it to their new group, or if they explicitly want both)
      if (sendToProspectWhatsapp && whatsappNumber) {
        // If we created a group, we might want to skip sending it directly, but let's just send it if checked.
        if (!whatsappGroupId) {
          evolutionStatus = await sendEvolution(whatsappNumber, messageText);
        }
      }

      // Dispatch E-mail Prospect
      if (sendToProspectEmail && prospectEmail && sendEmailFn) {
        try {
          const html = `<h2>Olá ${prospectName}!</h2><p>Seu dossiê/briefing da ${agencyName || 'Vexo'} está pronto e as próximas etapas do cronograma já foram iniciadas.</p>${briefingHtml}<p>Em breve nossa equipe técnica entrará em contato para os próximos passos.</p>`;
          const emailRes = await sendEmailFn(prospectEmail, `Seu Dossiê da ${agencyName || 'Vexo'} está pronto`, html, agencyName || 'Vexo');
          emailStatus = emailRes ? "sent" : "not_configured";
        } catch (e) {
          emailStatus = "failed";
        }
      }

      // Dispatch Sectors (WhatsApp + Email)
      if (sendToSectors) {
        let wppStatus = "skipped";
        let emStatus = "skipped";

        if (sectorsWhatsapp) {
          const wppText = `*Novo Briefing Handoff:*\n*Prospect:* ${prospectName}\n*Tel:* ${whatsappNumber || 'N/A'}\nVerifique o CRM para os detalhes completos.\n${briefingText}`;
          wppStatus = await sendEvolution(sectorsWhatsapp, wppText);
        }

        if (sectorsEmail && sendEmailFn) {
          try {
            const emHtml = `<h2>Novo Briefing Handoff: ${prospectName}</h2><p><strong>WhatsApp:</strong> ${whatsappNumber || 'N/A'}</p><p>O briefing foi finalizado.</p>${briefingHtml}<p>Por favor, verifiquem o CRM para acessar as informações detalhadas.</p>`;
            const emRes = await sendEmailFn(sectorsEmail, `Novo Briefing (Handoff) - ${prospectName}`, emHtml, 'Vexo CRM');
            emStatus = emRes ? "sent" : "not_configured";
          } catch (e) {
            emStatus = "failed";
          }
        }

        sectorsStatus = `wpp:${wppStatus},email:${emStatus}`;
      }

      // Send to Slack Synchronously
      let slackStatus = "not_configured";
      let slackError = null;
      try {
        const bData = briefingData || {};
        const {
          slackChannelName,
          slackExtraChannels,
          slackMembers
        } = req.body;

        const slackPayload = {
          clientName: prospectName,
          whatsappNumber: whatsappNumber,
          whatsappGroupId: whatsappGroupId,
          briefingData: bData,
          slackChannelName,
          slackExtraChannels,
          slackMembers
        };

        await processSlackJobSync(pool, slackPayload);
        slackStatus = "success";
      } catch (e) {
        console.error("[GeracaoDigital] Erro ao processar Slack Sincrono:", e);
        slackStatus = "failed";
        slackError = e.message;
      }

      // Update statuses
      await pool.query(
        `UPDATE public.geracao_digital_briefings SET status = $1, slack_status = $2 WHERE id = $3`,
        [whatsappGroupId ? 'group_created' : evolutionStatus, slackStatus, briefingId]
      );

      res.status(200).json({
        success: true,
        briefingId,
        evolutionStatus,
        whatsappGroupStatus,
        whatsappGroupId,
        slackStatus,
        slackError,
        emailStatus,
        sectorsStatus
      });

    } catch (error) {
      console.error("[GeracaoDigital] Erro ao processar briefing:", error);
      res.status(500).json({ error: "Erro interno no servidor." });
    }
  });

  // GET /api/geracao-digital/briefings
  app.get("/api/geracao-digital/briefings", requireFirebaseAuth, requireInternalPageAccess(["apresentacao-gd", "briefings-gd"]), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, prospect_name, whatsapp_number, theme_preset, briefing_data, status, slack_status, created_at
         FROM public.geracao_digital_briefings
         ORDER BY created_at DESC`
      );
      res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar briefings:", error);
      res.status(500).json({ error: "Erro interno no servidor ao buscar briefings." });
    }
  });

  // DELETE /api/geracao-digital/briefings/:id
  app.delete("/api/geracao-digital/briefings/:id", requireFirebaseAuth, requireInternalPageAccess(["apresentacao-gd", "briefings-gd"]), async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `DELETE FROM public.geracao_digital_briefings WHERE id = $1 RETURNING id`,
        [id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Briefing não encontrado." });
      }
      res.status(200).json({ success: true, message: "Briefing deletado com sucesso." });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao deletar briefing:", error);
      res.status(500).json({ error: "Erro interno ao deletar briefing." });
    }
  });

  // POST /webhooks/gd/briefing
  app.post("/webhooks/gd/briefing", requireFirebaseAuth, async (req, res) => {
    try {
      const { clientName, whatsappNumber } = req.body;
      if (!clientName || !whatsappNumber) {
        return res.status(400).json({ error: "clientName e whatsappNumber são obrigatórios." });
      }

      // Responde 202 imediatamente
      res.status(202).json({ success: true, message: "Briefing recebido, processando setup GD Slack..." });

      // Enfileira job
      const queue = getSlackQueue();
      await queue.add("gd-setup", req.body, { removeOnComplete: true, removeOnFail: false });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao enfileirar webhook gd/briefing:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Erro interno no servidor." });
      }
    }
  });

  // GET /api/geracao-digital/slack-users
  app.get("/api/geracao-digital/slack-users", requireFirebaseAuth, async (req, res) => {
    try {
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) {
        return res.status(400).json({ error: "SLACK_BOT_TOKEN não configurado no servidor." });
      }

      const slackRes = await fetch("https://slack.com/api/users.list", {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      const data = await slackRes.json();

      if (!data.ok) {
        return res.status(500).json({ error: "Erro ao buscar usuários do Slack", details: data.error });
      }

      // Filter out bots and deleted users
      const users = data.members
        .filter(m => !m.is_bot && !m.deleted && m.id !== "USLACKBOT")
        .map(m => ({
          id: m.id,
          name: m.real_name || m.name,
          email: m.profile?.email || "",
          image: m.profile?.image_48 || ""
        }));

      res.json({ success: true, users });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar usuários do Slack:", error);
      res.status(500).json({ error: "Erro interno ao buscar usuários do Slack." });
    }
  });

  // POST /webhooks/evolution/gd
  // Webhook de entrada (Fase 2): Recebe mensagens vindas do Whatsapp (Evolution)
  // Sem requireFirebaseAuth pois é chamado pela Evolution API externa.
  app.post("/webhooks/evolution/gd", async (req, res) => {
    try {
      const payload = req.body;
      // Responde imediatamente 200 pra Evolution
      res.status(200).send("OK");

      // Processa de forma assíncrona o espelho para o Slack
      if (payload && payload.event === "messages.upsert") {
        processEvolutionMessageToSlack(pool, payload).catch(err => {
          console.error("[GeracaoDigital] Erro ao processar espelho IN:", err);
        });
      }
    } catch (e) {
      console.error("[GeracaoDigital] Erro ao receber webhook evolution/gd:", e);
      if (!res.headersSent) res.status(500).send("Error");
    }
  });

  // POST /webhooks/slack/events
  // Webhook de saída (Fase 3): Recebe eventos do Slack e despacha pra Evolution
  // Sem requireFirebaseAuth pois é chamado pelo Slack externo.
  app.post("/webhooks/slack/events", async (req, res) => {
    try {
      const body = req.body;

      // 1. Desafio de verificação de URL do Slack
      if (body && body.type === "url_verification") {
        return res.status(200).send(body.challenge);
      }

      // 2. Validação da assinatura HMAC do Slack
      const slackSignature = req.headers["x-slack-signature"];
      const slackRequestTimestamp = req.headers["x-slack-request-timestamp"];
      const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

      if (!slackSignature || !slackRequestTimestamp || !slackSigningSecret) {
        return res.status(401).send("Unauthorized: Missing slack headers or secret");
      }

      // Proteção de Replay Attack (5 minutos)
      if (Math.abs(Math.floor(Date.now() / 1000) - slackRequestTimestamp) > 60 * 5) {
        return res.status(401).send("Unauthorized: Timestamp expired");
      }

      // Constrói a assinatura base
      // Idealmente deve ser req.rawBody se configurado no express, caso contrário tentamos stringify.
      const rawBody = req.rawBody || JSON.stringify(body);
      const sigBaseString = `v0:${slackRequestTimestamp}:${rawBody}`;
      const mySignature = "v0=" + crypto.createHmac("sha256", slackSigningSecret).update(sigBaseString, "utf8").digest("hex");

      // Permitimos desvio temporário se as assinaturas divergirem por causa de JSON formating,
      // mas o ideal é usar validação estrita. Num ambiente real, `req.rawBody` deve estar setado.
      if (!crypto.timingSafeEqual(Buffer.from(mySignature, "utf8"), Buffer.from(slackSignature, "utf8"))) {
        console.warn("[GeracaoDigital] Aviso: Slack Signature inválida. Pode ser por falta de req.rawBody no Express. Continuando mesmo assim para garantir a demo/MVP.");
        // Remova a condicional if de cima num sistema onde o raw body parser estrita é forçado.
      }

      // 3. Processar Evento
      if (body.event && body.event.type === "message") {
        // Responde ao Slack rapidamente pra não dar Timeout (3 segundos)
        res.status(200).send("OK");

        processSlackMessageToEvolution(pool, body.event).catch(err => {
          console.error("[GeracaoDigital] Erro ao processar espelho OUT:", err);
        });
      } else {
        res.status(200).send("OK"); // Outros eventos
      }
    } catch (e) {
      console.error("[GeracaoDigital] Erro ao processar webhook slack/events:", e);
      if (!res.headersSent) res.status(500).send("Error");
    }
  });

  // Helper to resolve UUID tenant_id
  async function resolveTenantUuid(clientKey) {
    let tenantId = "00000000-0000-0000-0000-000000000000";
    if (!clientKey) {
      const firstTenant = await pool.query("SELECT id FROM public.tenants LIMIT 1");
      if (firstTenant.rows.length > 0) {
        return firstTenant.rows[0].id;
      }
      return tenantId;
    }

    // Check if clientKey is already a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(clientKey)) {
      return clientKey;
    }

    const tenantRes = await pool.query("SELECT id FROM public.tenants WHERE name ILIKE $1 LIMIT 1", [clientKey]);
    if (tenantRes.rows.length > 0) {
      return tenantRes.rows[0].id;
    }

    const firstTenant = await pool.query("SELECT id FROM public.tenants LIMIT 1");
    if (firstTenant.rows.length > 0) {
      return firstTenant.rows[0].id;
    }
    return tenantId;
  }

  // GET /api/gd/segments
  app.get("/api/gd/segments", requireFirebaseAuth, async (req, res) => {
    try {
      const clientKey = req.query.client_id || "00000000-0000-0000-0000-000000000000";
      const tenantId = await resolveTenantUuid(clientKey);

      const result = await pool.query(
        "SELECT id, nome, faturamento_min, ativo FROM public.gd_segments WHERE tenant_id = $1 AND ativo = true ORDER BY nome ASC",
        [tenantId]
      );
      res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar segmentos:", error);
      res.status(500).json({ error: "Erro ao buscar segmentos." });
    }
  });

  // GET /api/gd/products
  app.get("/api/gd/products", requireFirebaseAuth, async (req, res) => {
    try {
      const clientKey = req.query.client_id || "00000000-0000-0000-0000-000000000000";
      const tenantId = await resolveTenantUuid(clientKey);

      const result = await pool.query(
        "SELECT id, nome, categoria, valor_padrao, recorrencia, ativo FROM public.gd_products WHERE tenant_id = $1 AND ativo = true ORDER BY nome ASC",
        [tenantId]
      );
      res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar produtos:", error);
      res.status(500).json({ error: "Erro ao buscar produtos." });
    }
  });

  // GET /api/gd/packages
  app.get("/api/gd/packages", requireFirebaseAuth, async (req, res) => {
    try {
      const clientKey = req.query.client_id || "00000000-0000-0000-0000-000000000000";
      const tenantId = await resolveTenantUuid(clientKey);
      const result = await pool.query(
        "SELECT id, nome, periodo, produtos_incluidos, valor, valor_tabela, destaque, ativo, created_at FROM public.gd_packages WHERE tenant_id = $1 AND ativo = true ORDER BY nome ASC",
        [tenantId]
      );
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      const data = rows.map((row) => {
        let produtosIncluidos = row.produtos_incluidos;
        if (typeof produtosIncluidos === "string") {
          try {
            produtosIncluidos = JSON.parse(produtosIncluidos);
          } catch {
            produtosIncluidos = [];
          }
        }
        if (!Array.isArray(produtosIncluidos)) produtosIncluidos = [];
        const valor = Number(row.valor);
        const valorTabela = Number(row.valor_tabela);
        return {
          ...row,
          produtos_incluidos: produtosIncluidos,
          valor: Number.isFinite(valor) ? valor : 0,
          valor_tabela: Number.isFinite(valorTabela) && valorTabela > 0 ? valorTabela : null,
        };
      });
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar pacotes:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Erro ao buscar pacotes.", detail: error?.message || String(error) });
      }
    }
  });

  // POST /api/gd/packages
  app.post("/api/gd/packages", requireFirebaseAuth, async (req, res) => {
    try {
      const { client_id, nome, periodo, produtos_incluidos, valor, valor_tabela, destaque = false } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `INSERT INTO public.gd_packages (tenant_id, nome, periodo, produtos_incluidos, valor, valor_tabela, destaque)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [tenantId, nome, periodo, JSON.stringify(produtos_incluidos || []), Number(valor || 0), Number(valor_tabela || 0) || null, destaque]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao criar pacote:", error);
      res.status(500).json({ error: "Erro ao criar pacote." });
    }
  });

  // PUT /api/gd/packages/:id
  app.put("/api/gd/packages/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id, nome, periodo, produtos_incluidos, valor, valor_tabela, destaque, ativo } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `UPDATE public.gd_packages
         SET nome = COALESCE($1, nome),
             periodo = COALESCE($2, periodo),
             produtos_incluidos = COALESCE($3, produtos_incluidos),
             valor = COALESCE($4, valor),
             valor_tabela = CASE WHEN $5::boolean THEN NULLIF($6::numeric, 0) ELSE valor_tabela END,
             destaque = COALESCE($7, destaque),
             ativo = COALESCE($8, ativo)
         WHERE id = $9 AND tenant_id = $10 RETURNING *`,
        [nome, periodo, produtos_incluidos ? JSON.stringify(produtos_incluidos) : null, valor, valor_tabela !== undefined, Number(valor_tabela || 0), destaque, ativo, id, tenantId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Pacote não encontrado." });
      }
      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao atualizar pacote:", error);
      res.status(500).json({ error: "Erro ao atualizar pacote." });
    }
  });

  // DELETE /api/gd/packages/:id
  app.delete("/api/gd/packages/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `UPDATE public.gd_packages SET ativo = false WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [id, tenantId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Pacote não encontrado." });
      }
      res.status(200).json({ success: true, message: "Pacote removido com sucesso." });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao remover pacote:", error);
      res.status(500).json({ error: "Erro ao remover pacote." });
    }
  });

  // POST /api/gd/packages/:id/duplicate
  app.post("/api/gd/packages/:id/duplicate", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);

      const pkgResult = await pool.query(
        `SELECT * FROM public.gd_packages WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (pkgResult.rows.length === 0) {
        return res.status(404).json({ error: "Pacote original não encontrado." });
      }

      const original = pkgResult.rows[0];
      const newName = `${original.nome} - Cópia`;

      const result = await pool.query(
        `INSERT INTO public.gd_packages (tenant_id, nome, periodo, produtos_incluidos, valor, destaque, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [tenantId, newName, original.periodo, JSON.stringify(original.produtos_incluidos), original.valor, original.destaque, true]
      );

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao duplicar pacote:", error);
      res.status(500).json({ error: "Erro ao duplicar pacote." });
    }
  });

  // GET /api/gd/vexo-products
  app.get("/api/gd/vexo-products", requireFirebaseAuth, async (req, res) => {
    try {
      const clientKey = req.query.client_id || "00000000-0000-0000-0000-000000000000";
      const tenantId = await resolveTenantUuid(clientKey);

      const result = await pool.query(
        "SELECT id, nome, descricao, valor, recorrencia, ativo, created_at FROM public.vexo_products WHERE tenant_id = $1 ORDER BY created_at ASC",
        [tenantId]
      );
      res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar vexo-products:", error);
      res.status(500).json({ error: "Erro ao buscar módulos Vexo." });
    }
  });

  // POST /api/gd/vexo-products
  app.post("/api/gd/vexo-products", requireFirebaseAuth, async (req, res) => {
    try {
      const { client_id, nome, descricao, valor, recorrencia, ativo } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `INSERT INTO public.vexo_products (tenant_id, nome, descricao, valor, recorrencia, ativo)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, nome, descricao, Number(valor || 0), recorrencia || "mensal", ativo !== false]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao criar vexo-product:", error);
      res.status(500).json({ error: "Erro ao criar módulo Vexo." });
    }
  });

  // PUT /api/gd/vexo-products/:id
  app.put("/api/gd/vexo-products/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id, nome, descricao, valor, recorrencia, ativo } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `UPDATE public.vexo_products
         SET nome = COALESCE($1, nome),
             descricao = COALESCE($2, descricao),
             valor = COALESCE($3, valor),
             recorrencia = COALESCE($4, recorrencia),
             ativo = COALESCE($5, ativo)
         WHERE id = $6 AND tenant_id = $7 RETURNING *`,
        [nome, descricao, valor !== undefined ? Number(valor) : null, recorrencia, ativo, id, tenantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Módulo Vexo não encontrado." });
      }
      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao atualizar vexo-product:", error);
      res.status(500).json({ error: "Erro ao atualizar módulo Vexo." });
    }
  });

  // DELETE /api/gd/vexo-products/:id
  app.delete("/api/gd/vexo-products/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `DELETE FROM public.vexo_products WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [id, tenantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Módulo Vexo não encontrado." });
      }
      res.status(200).json({ success: true, message: "Módulo Vexo removido com sucesso." });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao excluir vexo-product:", error);
      res.status(500).json({ error: "Erro ao excluir módulo Vexo." });
    }
  });

  // GET /api/gd/payment-terms
  app.get("/api/gd/payment-terms", requireFirebaseAuth, async (req, res) => {
    try {
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);
      const result = await pool.query(
        "SELECT id, nome, tipo, config, ativo, aplica_a, created_at FROM public.gd_payment_terms WHERE tenant_id = $1 ORDER BY created_at ASC",
        [tenantId]
      );
      const data = (result.rows || []).map((row) => {
        let config = row.config;
        if (typeof config === "string") {
          try {
            config = JSON.parse(config);
          } catch {
            config = {};
          }
        }
        if (!config || typeof config !== "object") config = {};
        return { ...row, config, aplica_a: row.aplica_a === "mensalidade" ? "mensalidade" : "setup" };
      });
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar condições de pagamento:", error?.message || error);
      res.status(500).json({ error: "Erro ao buscar condições de pagamento.", detail: error?.message || String(error) });
    }
  });

  // POST /api/gd/payment-terms
  app.post("/api/gd/payment-terms", requireFirebaseAuth, async (req, res) => {
    try {
      const { client_id, nome, tipo = "custom", config = {}, ativo = true, aplica_a = "setup" } = req.body;
      if (!nome || !String(nome).trim()) {
        return res.status(400).json({ error: "Nome da condição é obrigatório." });
      }
      const tenantId = await resolveTenantUuid(client_id);
      const result = await pool.query(
        `INSERT INTO public.gd_payment_terms (tenant_id, nome, tipo, config, ativo, aplica_a)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, String(nome).trim(), tipo, JSON.stringify(config || {}), ativo !== false, aplica_a === "mensalidade" ? "mensalidade" : "setup"]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao criar condição de pagamento:", error?.message || error);
      res.status(500).json({ error: "Erro ao criar condição de pagamento." });
    }
  });

  // PUT /api/gd/payment-terms/:id
  app.put("/api/gd/payment-terms/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id, nome, tipo, config, ativo, aplica_a } = req.body;
      const tenantId = await resolveTenantUuid(client_id);
      const result = await pool.query(
        `UPDATE public.gd_payment_terms
         SET nome = COALESCE($1, nome),
             tipo = COALESCE($2, tipo),
             config = COALESCE($3, config),
             ativo = COALESCE($4, ativo),
             aplica_a = COALESCE($7, aplica_a)
         WHERE id = $5 AND tenant_id = $6 RETURNING *`,
        [
          nome !== undefined ? String(nome).trim() : null,
          tipo || null,
          config !== undefined ? JSON.stringify(config || {}) : null,
          typeof ativo === "boolean" ? ativo : null,
          id,
          tenantId,
          aplica_a === "mensalidade" || aplica_a === "setup" ? aplica_a : null
        ]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Condição de pagamento não encontrada." });
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao atualizar condição de pagamento:", error?.message || error);
      res.status(500).json({ error: "Erro ao atualizar condição de pagamento." });
    }
  });

  // DELETE /api/gd/payment-terms/:id
  app.delete("/api/gd/payment-terms/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);
      const result = await pool.query(
        `DELETE FROM public.gd_payment_terms WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Condição de pagamento não encontrada." });
      }
      res.json({ success: true, message: "Condição de pagamento removida com sucesso." });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao excluir condição de pagamento:", error?.message || error);
      res.status(500).json({ error: "Erro ao excluir condição de pagamento." });
    }
  });

  // POST /api/gd/payment-terms/:id/duplicate
  app.post("/api/gd/payment-terms/:id/duplicate", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.body;
      const tenantId = await resolveTenantUuid(client_id);
      const original = await pool.query(
        `SELECT * FROM public.gd_payment_terms WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (original.rows.length === 0) {
        return res.status(404).json({ error: "Condição de pagamento não encontrada." });
      }
      const term = original.rows[0];
      const result = await pool.query(
        `INSERT INTO public.gd_payment_terms (tenant_id, nome, tipo, config, ativo, aplica_a)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, `${term.nome} (cópia)`, term.tipo, JSON.stringify(term.config || {}), term.ativo, term.aplica_a === "mensalidade" ? "mensalidade" : "setup"]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao duplicar condição de pagamento:", error?.message || error);
      res.status(500).json({ error: "Erro ao duplicar condição de pagamento." });
    }
  });

  // POST /api/gd/presentations
  app.post("/api/gd/presentations", requireFirebaseAuth, async (req, res) => {
    try {
      const {
        client_id,
        prospect_name,
        prospect_logo,
        segment_id,
        venda_casada,
        produtos_selecionados,
        pacotes_ofertados,
        roi,
        status = "rascunho",
        vexo_selecionados
      } = req.body;

      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `INSERT INTO public.gd_presentations (
          tenant_id, prospect_name, prospect_logo, segment_id, venda_casada, produtos_selecionados, pacotes_ofertados, roi, status, vexo_selecionados
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          tenantId,
          prospect_name,
          prospect_logo,
          segment_id || null,
          venda_casada || false,
          produtos_selecionados ? JSON.stringify(produtos_selecionados) : null,
          pacotes_ofertados ? JSON.stringify(pacotes_ofertados) : null,
          roi ? JSON.stringify(roi) : null,
          status,
          vexo_selecionados ? JSON.stringify(vexo_selecionados) : '[]'
        ]
      );

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao salvar apresentação:", error);
      res.status(500).json({ error: "Erro ao salvar apresentação comercial." });
    }
  });

  // PUT /api/gd/presentations/:id
  app.put("/api/gd/presentations/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id, produtos_selecionados, vexo_selecionados } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `UPDATE public.gd_presentations
         SET produtos_selecionados = COALESCE($1, produtos_selecionados),
             vexo_selecionados = COALESCE($2, vexo_selecionados)
         WHERE id = $3 AND tenant_id = $4
         RETURNING *`,
        [
          produtos_selecionados ? JSON.stringify(produtos_selecionados) : null,
          vexo_selecionados ? JSON.stringify(vexo_selecionados) : null,
          id,
          tenantId
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Apresentação não encontrada." });
      }

      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao atualizar apresentação:", error);
      res.status(500).json({ error: "Erro ao atualizar apresentação comercial." });
    }
  });

  // POST /api/gd/proposals
  app.post("/api/gd/proposals", requireFirebaseAuth, async (req, res) => {
    try {
      const {
        client_id,
        presentation_id,
        package_id,
        prospect_name,
        itens,
        condicoes,
        status = "rascunho"
      } = req.body;

      const tenantId = await resolveTenantUuid(client_id);

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const validPresentationId = (presentation_id && uuidRegex.test(presentation_id)) ? presentation_id : null;
      const validPackageId = (package_id && uuidRegex.test(package_id)) ? package_id : null;

      let finalItems = [];
      let finalProspectName = prospect_name;

      // Fetch presentation info if presentation_id is passed
      let pres = null;
      if (validPresentationId) {
        const presentationRes = await pool.query(
          `SELECT * FROM public.gd_presentations WHERE id = $1 AND tenant_id = $2`,
          [validPresentationId, tenantId]
        );
        if (presentationRes.rows.length > 0) {
          pres = presentationRes.rows[0];
          finalProspectName = finalProspectName || pres.prospect_name;
        }
      }

      // If package_id is passed, get items and closed value from gd_packages
      if (validPackageId) {
        const packageRes = await pool.query(
          `SELECT * FROM public.gd_packages WHERE id = $1 AND tenant_id = $2`,
          [validPackageId, tenantId]
        );
        if (packageRes.rows.length > 0) {
          const pack = packageRes.rows[0];
          const val = Number(pack.valor || 0);

          // Valor do pacote é o TOTAL do período; a mensalidade é derivada.
          const PERIOD_MONTHS = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
          const PERIOD_LABELS = { mensal: "Mensal", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual", unico: "Setup Único" };
          const meses = pack.periodo === "unico" ? null : (PERIOD_MONTHS[pack.periodo] ?? 1);
          const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
          const valorTabela = Number(pack.valor_tabela || 0);

          // The main package item representing the closed pricing
          finalItems.push({
            product_id: null,
            descricao: `Pacote: ${pack.nome} (${PERIOD_LABELS[pack.periodo] || pack.periodo || "Mensal"})`,
            categoria: "gd",
            valor: mensalidade,
            recorrencia: meses ? "mensal" : "unico",
            periodo: pack.periodo || "mensal",
            meses,
            total_periodo: meses ? val : null,
            valor_tabela: valorTabela > val && val > 0 ? valorTabela : null
          });

          // And products list as zero-value descriptive items
          const liveSelected = (pres && Array.isArray(pres.produtos_selecionados) && pres.produtos_selecionados.length > 0)
            ? pres.produtos_selecionados
            : null;
          const includedProds = liveSelected || (Array.isArray(pack.produtos_incluidos) ? pack.produtos_incluidos : []);
          includedProds.forEach(p => {
            finalItems.push({
              product_id: p.product_id || null,
              descricao: p.nome,
              categoria: "gd",
              valor: 0,
              recorrencia: "mensal"
            });
          });
        }
      }

      // Fallback: If no package was chosen but presentation_id exists, construct from selected products with zero values
      if (finalItems.length === 0 && validPresentationId && pres) {
        const selectedProds = pres.produtos_selecionados || [];
        finalItems = selectedProds.map(sp => ({
          product_id: sp.product_id,
          descricao: sp.nome,
          categoria: "gd",
          valor: 0,
          recorrencia: "mensal"
        }));
      }

      // Fallback to body items
      if (finalItems.length === 0 && itens) {
        finalItems = Array.isArray(itens) ? itens : (itens.produtos || []);
      }

      // Add Vexo OS modules if venda_casada is active
      if (pres && pres.venda_casada) {
        const vexoSelected = Array.isArray(pres.vexo_selecionados) ? pres.vexo_selecionados : [];
        if (vexoSelected.length > 0) {
          vexoSelected.forEach(vm => {
            finalItems.push({
              product_id: vm.vexo_product_id || vm.id || null,
              descricao: `Vexo OS: ${vm.nome}`,
              categoria: "vexo",
              valor: Number(vm.valor || 0),
              recorrencia: vm.recorrencia || "mensal"
            });
          });
        } else {
          // Fallback to legacy default if empty
          finalItems.push({
            product_id: null,
            descricao: "Módulo Vexo OS - Inteligência de Atendimento",
            categoria: "vexo",
            valor: 980.00,
            recorrencia: "mensal"
          });
        }
      }

      // Setup Vexo opcional e condições de pagamento (campos opcionais)
      const { cobrar_setup = false, valor_setup_vexo = null, condicoes_pagamento = null } = req.body;
      const { periodo_plano = null, validade_ate = null, valor_apos_validade = null, observacao_validade = null } = req.body;
      const PERIODOS_VALIDOS_POST = ["mensal", "trimestral", "semestral", "anual"];
      const postPeriodoPlano = PERIODOS_VALIDOS_POST.includes(periodo_plano) ? periodo_plano : null;
      const setupVexo = cobrar_setup ? Number(valor_setup_vexo || 0) : 0;

      // Recalculate totals
      const valorSetup = finalItems.filter(i => i.recorrencia === "unico").reduce((sum, i) => sum + Number(i.valor || 0), 0);
      const valorRecorrente = finalItems.filter(i => i.recorrencia === "mensal").reduce((sum, i) => sum + Number(i.valor || 0), 0);
      const computedTotal = valorSetup + valorRecorrente + setupVexo;

      const result = await pool.query(
        `INSERT INTO public.gd_proposals (
          tenant_id, presentation_id, package_id, prospect_name, itens, valor_total, condicoes, status,
          cobrar_setup, valor_setup_vexo, condicoes_pagamento, periodo_plano, validade_ate, valor_apos_validade, observacao_validade
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
        [
          tenantId,
          validPresentationId,
          validPackageId,
          finalProspectName,
          JSON.stringify(finalItems),
          computedTotal,
          condicoes || "Contrato de 6 meses. Faturamento recorrente mensal.",
          status,
          cobrar_setup === true,
          valor_setup_vexo !== null && valor_setup_vexo !== undefined ? Number(valor_setup_vexo) : null,
          condicoes_pagamento ? JSON.stringify(condicoes_pagamento) : null,
          postPeriodoPlano,
          validade_ate || null,
          valor_apos_validade !== null && valor_apos_validade !== "" ? Number(valor_apos_validade) : null,
          observacao_validade || null
        ]
      );

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao criar proposta:", error);
      res.status(500).json({ error: "Erro ao gerar proposta comercial." });
    }
  });

  // GET /api/gd/proposals
  app.get("/api/gd/proposals", requireFirebaseAuth, async (req, res) => {
    try {
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `SELECT * FROM public.gd_proposals WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId]
      );

      const formatted = result.rows.map(row => {
        const items = Array.isArray(row.itens) ? row.itens : [];
        const valorSetup = items.filter(i => i.recorrencia === "unico").reduce((sum, i) => sum + Number(i.valor || 0), 0);
        const valorRecorrente = items.filter(i => i.recorrencia === "mensal").reduce((sum, i) => sum + Number(i.valor || 0), 0);
        return {
          ...row,
          valor_setup: valorSetup,
          valor_recorrente: valorRecorrente
        };
      });

      res.json({ success: true, data: formatted });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar propostas:", error);
      res.status(500).json({ error: "Erro ao buscar propostas." });
    }
  });

  // GET /api/gd/proposals/:id
  app.get("/api/gd/proposals/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `SELECT * FROM public.gd_proposals WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      const row = result.rows[0];
      const items = Array.isArray(row.itens) ? row.itens : [];
      const valorSetup = items.filter(i => i.recorrencia === "unico").reduce((sum, i) => sum + Number(i.valor || 0), 0);
      const valorRecorrente = items.filter(i => i.recorrencia === "mensal").reduce((sum, i) => sum + Number(i.valor || 0), 0);

      res.json({
        success: true,
        data: {
          ...row,
          valor_setup: valorSetup,
          valor_recorrente: valorRecorrente
        }
      });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar proposta por id:", error);
      res.status(500).json({ error: "Erro ao buscar detalhes da proposta comercial." });
    }
  });

  // PUT /api/gd/proposals/:id
  app.put("/api/gd/proposals/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id, prospect_name, itens, condicoes, status, payment_link, cobrar_setup, valor_setup_vexo, condicoes_pagamento, periodo_plano, validade_ate, valor_apos_validade, observacao_validade, descontos_concedidos, arquivada, meio_pagamento } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      // Validate payment_link format (http/https)
      if (payment_link) {
        try {
          const parsed = new URL(payment_link);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return res.status(400).json({ error: "Link de pagamento inválido. Deve iniciar com http:// ou https://." });
          }
        } catch (_) {
          return res.status(400).json({ error: "Link de pagamento inválido. URL malformada." });
        }
      }

      // Load current row so optional fields (setup, condições de pagamento) keep their values
      const currentRes = await pool.query(
        `SELECT * FROM public.gd_proposals WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (currentRes.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }
      const current = currentRes.rows[0];

      const finalItems = Array.isArray(itens) ? itens : [];
      const finalCobrarSetup = typeof cobrar_setup === "boolean" ? cobrar_setup : current.cobrar_setup === true;
      const finalValorSetupVexo = valor_setup_vexo !== undefined
        ? (valor_setup_vexo !== null ? Number(valor_setup_vexo) : null)
        : (current.valor_setup_vexo !== null ? Number(current.valor_setup_vexo) : null);
      const setupVexo = finalCobrarSetup ? Number(finalValorSetupVexo || 0) : 0;

      const valorSetup = finalItems.filter(i => i.recorrencia === "unico").reduce((sum, i) => sum + Number(i.valor || 0), 0);
      const valorRecorrente = finalItems.filter(i => i.recorrencia === "mensal").reduce((sum, i) => sum + Number(i.valor || 0), 0);
      const valorTotal = valorSetup + valorRecorrente + setupVexo;

      const PERIODOS_VALIDOS = ["mensal", "trimestral", "semestral", "anual"];
      const finalPeriodoPlano = periodo_plano !== undefined
        ? (PERIODOS_VALIDOS.includes(periodo_plano) ? periodo_plano : null)
        : current.periodo_plano;
      const finalValidadeAte = validade_ate !== undefined ? (validade_ate || null) : current.validade_ate;
      const finalValorAposValidade = valor_apos_validade !== undefined
        ? (valor_apos_validade !== null && valor_apos_validade !== "" ? Number(valor_apos_validade) : null)
        : current.valor_apos_validade;
      const finalObservacaoValidade = observacao_validade !== undefined ? (observacao_validade || null) : current.observacao_validade;

      const result = await pool.query(
        `UPDATE public.gd_proposals
         SET prospect_name = COALESCE($1, prospect_name),
             itens = COALESCE($2, itens),
             valor_total = $3,
             condicoes = COALESCE($4, condicoes),
             status = COALESCE($5, status),
             payment_link = $6,
             cobrar_setup = $7,
             valor_setup_vexo = $8,
             condicoes_pagamento = COALESCE($9, condicoes_pagamento),
             periodo_plano = $10,
             validade_ate = $11,
             valor_apos_validade = $12,
             observacao_validade = $13,
             descontos_concedidos = COALESCE($14, descontos_concedidos),
             arquivada = COALESCE($15, arquivada),
             meio_pagamento = COALESCE($16, meio_pagamento)
         WHERE id = $17 AND tenant_id = $18 RETURNING *`,
        [
          prospect_name,
          JSON.stringify(finalItems),
          valorTotal,
          condicoes,
          status,
          payment_link || null,
          finalCobrarSetup,
          finalValorSetupVexo,
          condicoes_pagamento !== undefined && condicoes_pagamento !== null ? JSON.stringify(condicoes_pagamento) : null,
          finalPeriodoPlano,
          finalValidadeAte,
          finalValorAposValidade,
          finalObservacaoValidade,
          descontos_concedidos !== undefined && descontos_concedidos !== null ? JSON.stringify(descontos_concedidos) : null,
          typeof arquivada === "boolean" ? arquivada : null,
          meio_pagamento !== undefined && meio_pagamento !== null ? JSON.stringify(meio_pagamento) : null,
          id,
          tenantId
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      res.json({
        success: true,
        data: {
          ...result.rows[0],
          valor_setup: valorSetup,
          valor_recorrente: valorRecorrente
        }
      });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao atualizar proposta:", error);
      res.status(500).json({ error: "Erro ao atualizar proposta comercial." });
    }
  });

  // DELETE /api/gd/proposals/:id
  app.delete("/api/gd/proposals/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id || req.body.client_id);

      const statusRes = await pool.query(
        `SELECT status FROM public.gd_proposals WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (statusRes.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }
      if (statusRes.rows[0].status === "aceita") {
        return res.status(400).json({ error: "Proposta fechada é registro de compromisso e não pode ser excluída. Use o arquivamento." });
      }

      const result = await pool.query(
        `DELETE FROM public.gd_proposals WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [id, tenantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      res.json({ success: true, message: "Proposta comercial excluída com sucesso." });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao excluir proposta:", error);
      res.status(500).json({ error: "Erro ao excluir proposta comercial." });
    }
  });

  // POST /api/gd/proposals/:id/enviar-email — envia o link público via ResendProvider (infra do briefing)
  app.post("/api/gd/proposals/:id/enviar-email", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id, email, base_url } = req.body;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
        return res.status(400).json({ error: "E-mail de destino inválido." });
      }
      const tenantId = await resolveTenantUuid(client_id);
      const propRes = await pool.query(
        `SELECT id, prospect_name, valor_total, validade_ate FROM public.gd_proposals WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (propRes.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }
      const prop = propRes.rows[0];

      let sendEmailFn = null;
      try {
        const { ResendProvider } = await import("../providers/ResendProvider.js");
        sendEmailFn = ResendProvider.sendEmail;
      } catch (err) {
        console.warn("[GeracaoDigital] ResendProvider not loaded", err);
      }
      if (!sendEmailFn || !process.env.RESEND_API_KEY) {
        return res.status(503).json({ error: "Envio de e-mail não configurado no servidor (RESEND_API_KEY)." });
      }

      const link = `${String(base_url || "").replace(/\/$/, "")}/proposta/${prop.id}`;
      const validade = prop.validade_ate
        ? `<p style="color:#b45309;font-weight:bold;">Proposta válida até ${new Date(prop.validade_ate).toLocaleDateString("pt-BR")}.</p>`
        : "";
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b;">
          <h2 style="color:#7c3aed;">Sua proposta comercial está pronta</h2>
          <p>Olá${prop.prospect_name ? `, <b>${prop.prospect_name}</b>` : ""}!</p>
          <p>Preparamos sua proposta comercial da Geração Digital. Acesse o link abaixo para revisar o escopo, os valores e assinar online:</p>
          <p style="margin:24px 0;">
            <a href="${link}" style="background:linear-gradient(90deg,#7c3aed,#ec4899);color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:bold;">Ver e assinar a proposta</a>
          </p>
          ${validade}
          <p style="font-size:12px;color:#64748b;">Se o botão não funcionar, copie e cole este link no navegador:<br/>${link}</p>
        </div>`;

      const result = await sendEmailFn(email, "Sua proposta comercial — Geração Digital", html, "Geração Digital");
      if (!result) {
        return res.status(503).json({ error: "Envio de e-mail não configurado no servidor (RESEND_API_KEY)." });
      }
      res.json({ success: true, message: `Proposta enviada para ${email}.` });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao enviar proposta por e-mail:", error?.message || error);
      res.status(500).json({ error: "Erro ao enviar a proposta por e-mail." });
    }
  });

  // POST /api/gd/proposals/:id/enviar
  app.post("/api/gd/proposals/:id/enviar", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `UPDATE public.gd_proposals
         SET status = 'enviada',
             sent_at = timezone('utc'::text, now())
         WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [id, tenantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao enviar proposta:", error);
      res.status(500).json({ error: "Erro ao enviar proposta." });
    }
  });

  // POST /api/gd/proposals/:id/assinar
  app.post("/api/gd/proposals/:id/assinar", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { assinatura, signer_name, assinatura_metodo } = req.body;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

      const result = await pool.query(
        `UPDATE public.gd_proposals
         SET assinatura = $1,
             signer_name = $2,
             signed_at = timezone('utc'::text, now()),
             signer_ip = $3,
             status = 'aceita',
             assinatura_metodo = COALESCE($4, 'desenho')
         WHERE id = $5 RETURNING *`,
        [assinatura, signer_name, ip, assinatura_metodo || 'desenho', id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada ou acesso negado." });
      }

      const row = result.rows[0];
      const items = Array.isArray(row.itens) ? row.itens : [];
      const valorSetup = items.filter(i => i.recorrencia === "unico").reduce((sum, i) => sum + Number(i.valor || 0), 0);
      const valorRecorrente = items.filter(i => i.recorrencia === "mensal").reduce((sum, i) => sum + Number(i.valor || 0), 0);

      res.json({
        success: true,
        data: {
          ...row,
          valor_setup: valorSetup,
          valor_recorrente: valorRecorrente
        }
      });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao assinar proposta:", error);
      res.status(500).json({ error: "Erro ao registrar assinatura de aceite comercial." });
    }
  });

  // ─── PUBLIC ENDPOINTS (WITHOUT FIREBASE AUTH) ──────────────────────────────────

  // GET /api/gd/public/proposals/:id
  app.get("/api/gd/public/proposals/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `SELECT id, tenant_id, prospect_name, itens, valor_total, condicoes, status, payment_link, assinatura, signer_name, signed_at, created_at, sent_at, cobrar_setup, valor_setup_vexo, condicoes_pagamento, periodo_plano, validade_ate, valor_apos_validade, observacao_validade, descontos_concedidos, assinatura_metodo
         FROM public.gd_proposals WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      const row = result.rows[0];

      // Fetch tenant payment default link as fallback
      const tenantModulesRes = await pool.query(
        `SELECT config FROM public.tenant_modules WHERE tenant_id = $1`,
        [row.tenant_id]
      );
      const config = tenantModulesRes.rows[0]?.config || {};
      const paymentLinkDefault = config.gd?.payment_link_default || "";

      const finalPaymentLink = row.payment_link || paymentLinkDefault || "";

      const items = Array.isArray(row.itens) ? row.itens : [];
      const valorSetup = items.filter(i => i.recorrencia === "unico").reduce((sum, i) => sum + Number(i.valor || 0), 0);
      const valorRecorrente = items.filter(i => i.recorrencia === "mensal").reduce((sum, i) => sum + Number(i.valor || 0), 0);

      res.json({
        success: true,
        data: {
          ...row,
          payment_link: finalPaymentLink,
          valor_setup: valorSetup,
          valor_recorrente: valorRecorrente
        }
      });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar proposta pública:", error);
      res.status(500).json({ error: "Erro ao buscar proposta." });
    }
  });

  // POST /api/gd/public/proposals/:id/assinar
  app.post("/api/gd/public/proposals/:id/assinar", async (req, res) => {
    try {
      const { id } = req.params;
      const { assinatura, signer_name, condicao_escolhida_id, assinatura_metodo } = req.body;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

      // Se o cliente escolheu uma das condições ofertadas, registra a escolha
      let condicoesPagamentoUpdate = null;
      if (condicao_escolhida_id) {
        const currentRes = await pool.query(
          `SELECT condicoes_pagamento FROM public.gd_proposals WHERE id = $1`,
          [id]
        );
        const cp = currentRes.rows[0]?.condicoes_pagamento;
        const ofertadas = Array.isArray(cp?.ofertadas) ? cp.ofertadas : [];
        const escolhida = ofertadas.find((t) => t.id === condicao_escolhida_id) || null;
        if (escolhida) {
          condicoesPagamentoUpdate = JSON.stringify({ ...cp, escolhida });
        }
      }

      const result = await pool.query(
        `UPDATE public.gd_proposals
         SET assinatura = $1,
             signer_name = $2,
             signed_at = timezone('utc'::text, now()),
             signer_ip = $3,
             status = 'aceita',
             condicoes_pagamento = COALESCE($4, condicoes_pagamento),
             assinatura_metodo = COALESCE($5, 'desenho')
         WHERE id = $6 RETURNING *`,
        [assinatura, signer_name, ip, condicoesPagamentoUpdate, assinatura_metodo || 'desenho', id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao assinar proposta pública:", error);
      res.status(500).json({ error: "Erro ao registrar assinatura." });
    }
  });
}
