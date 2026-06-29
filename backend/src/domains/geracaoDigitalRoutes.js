import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";

export function registerGeracaoDigitalRoutes(app, pool, requireFirebaseAuth, requireInternalPageAccess) {
  // POST /api/geracao-digital/briefing
  app.post("/api/geracao-digital/briefing", requireFirebaseAuth, async (req, res) => {
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
        [prospectName, whatsappNumber || null, themePreset, JSON.stringify(briefingData || {})]
      );
      const briefingId = result.rows[0].id;

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

      // Helper function to send WhatsApp via Evolution
      const sendEvolution = async (number, text) => {
        if (!evolutionUrl || !evolutionToken || !number) return "not_configured";
        const payload = {
          number,
          options: { delay: 1200, presence: "composing" },
          textMessage: { text }
        };
        const endpoint = evolutionUrl.endsWith("/") ? evolutionUrl.slice(0, -1) : evolutionUrl;
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

      const messageText = `Olá ${prospectName}!\n\nSeu dossiê/briefing da ${agencyName || 'Vexo'} está pronto.`;
      
      // Dispatch WhatsApp Prospect
      if (sendToProspectWhatsapp && whatsappNumber) {
        evolutionStatus = await sendEvolution(whatsappNumber, messageText);
      }

      // Dispatch E-mail Prospect
      if (sendToProspectEmail && prospectEmail && sendEmailFn) {
        try {
          const html = `<h2>Olá ${prospectName}!</h2><p>Seu dossiê/briefing da ${agencyName || 'Vexo'} está pronto e as próximas etapas do cronograma já foram iniciadas.</p><p>Em breve nossa equipe técnica entrará em contato para os próximos passos.</p>`;
          await sendEmailFn(prospectEmail, `Seu Dossiê da ${agencyName || 'Vexo'} está pronto`, html, agencyName || 'Vexo');
          emailStatus = "sent";
        } catch (e) {
          emailStatus = "failed";
        }
      }

      // Dispatch Sectors (WhatsApp + Email)
      if (sendToSectors) {
        let wppStatus = "skipped";
        let emStatus = "skipped";

        if (sectorsWhatsapp) {
          const wppText = `*Novo Briefing Handoff:*\n*Prospect:* ${prospectName}\n*Tel:* ${whatsappNumber || 'N/A'}\nVerifique o CRM para os detalhes completos (Tráfego, Design, Contratos).`;
          wppStatus = await sendEvolution(sectorsWhatsapp, wppText);
        }
        
        if (sectorsEmail && sendEmailFn) {
          try {
            const emHtml = `<h2>Novo Briefing Handoff: ${prospectName}</h2><p><strong>WhatsApp:</strong> ${whatsappNumber || 'N/A'}</p><p>O briefing foi finalizado. Por favor, verifiquem o CRM para acessar as informações detalhadas de Tráfego, Design e Contratos.</p>`;
            await sendEmailFn(sectorsEmail, `Novo Briefing (Handoff) - ${prospectName}`, emHtml, 'Vexo CRM');
            emStatus = "sent";
          } catch (e) {
            emStatus = "failed";
          }
        }
        
        sectorsStatus = `wpp:${wppStatus},email:${emStatus}`;
      }

      // Send to Slack
      const slackWebhook = process.env.SLACK_WEBHOOK_URL_GD;
      let slackStatus = "not_configured";

      if (slackWebhook) {
        try {
          const slackPayload = {
            text: `*Novo Briefing Geração Digital*\n*Prospect:* ${prospectName}\n*WhatsApp:* ${whatsappNumber || 'N/A'}\n*Status Evol:* ${evolutionStatus}\n*Status Email:* ${emailStatus}\n*Status Setores:* ${sectorsStatus}\n\n*_Aguardando automação de pastas..._*`
          };
          const slRes = await fetch(slackWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(slackPayload)
          });
          if (!slRes.ok) slackStatus = `failed_${slRes.status}`;
          else slackStatus = "sent";
        } catch (e) {
          slackStatus = "failed_network";
        }
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
        emailStatus,
        sectorsStatus
      });

    } catch (error) {
      console.error("[GeracaoDigital] Erro ao processar briefing:", error);
      res.status(500).json({ error: "Erro interno no servidor." });
    }
  });
}
