import { v4 as uuidv4 } from "uuid";
import { getSlackQueue } from "../geracaoDigital/slackQueue.js";

export function registerGeracaoDigitalRoutes(app, pool, requireFirebaseAuth, requireInternalPageAccess) {
  // POST /api/geracao-digital/briefing
  app.post("/api/geracao-digital/briefing", requireFirebaseAuth, async (req, res) => {
    
    async function processSlackJobSync(pool, jobData) {
      const { 
        clientName, whatsappNumber, produtosContratados = [], 
        objetivoTrafego, verba, publicoAlvo, driveLink,
        slackChannelName, slackExtraChannels = [], slackMembers = []
      } = jobData;

      const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
      if (!SLACK_BOT_TOKEN) throw new Error("SLACK_BOT_TOKEN não configurado no servidor.");

      const normalizeWhatsapp = (num) => {
        let clean = (num || "").replace(/\D/g, "");
        if (clean.length === 10 || clean.length === 11) return "55" + clean;
        return clean;
      };
      const jid = normalizeWhatsapp(whatsappNumber) + "@s.whatsapp.net";

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
      if (membersMentions) secondaryFields.push({ type: "mrkdwn", text: `*Responsáveis:*\n${membersMentions}` });

      const blocks = [
        { type: "header", text: { type: "plain_text", text: "📄 Dossiê do Cliente (Geração Digital)" } },
        { type: "section", fields: mainFields },
        { type: "section", fields: secondaryFields }
      ];
      if (driveLink) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Pasta do Drive:*\n<${driveLink}|Acessar Arquivos>` } });

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
        [clientName, jid, channelId, driveLink || null]
      );
    }
    try {
      const { 
        prospectName, 
        whatsappNumber, 
        themePreset, 
        briefingData, 
        agencyName,
        sendToProspectWhatsapp,
        sendToProspectEmail,
        prospectEmail,
        sendToSectors,
        sectorsWhatsapp,
        sectorsEmail
      } = req.body;

      if (!prospectName) {
        return res.status(400).json({ error: "Nome é obrigatório" });
      }

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

      const messageText = `Olá ${prospectName}!\n\nSeu dossiê/briefing da ${agencyName || 'Vexo'} está pronto.${briefingText}`;
      
      // Dispatch WhatsApp Prospect
      if (sendToProspectWhatsapp && whatsappNumber) {
        evolutionStatus = await sendEvolution(whatsappNumber, messageText);
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
          produtosContratados: bData['produtos'] ? String(bData['produtos']).split(',').map(s => s.trim()) : [],
          objetivoTrafego: String(bData['objetivo_trafego'] || ''),
          verba: String(bData['verba'] || ''),
          publicoAlvo: String(bData['publico_alvo'] || ''),
          driveLink: String(bData['logo'] || bData['drive_link'] || ''),
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
        [evolutionStatus, slackStatus, briefingId]
      );

      res.status(200).json({ 
        success: true, 
        briefingId, 
        evolutionStatus, 
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
}
