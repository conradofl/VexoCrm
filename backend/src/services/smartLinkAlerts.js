// backend/src/services/smartLinkAlerts.js
// Serviço de Alertas de Cliques em Smart Links para SDR / Vendedores
// Dispara notificações imediatas no WhatsApp quando um lead interage com um link rastreado.

/**
 * Formata a data/hora do clique para o padrão brasileiro de exibição (HH:mm - DD/MM/YYYY).
 * @param {string|Date|null|undefined} timestamp
 * @returns {string}
 */
export function formatClickTime(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (isNaN(date.getTime())) {
    return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Retorna o ícone e rótulo do dispositivo formatado para a mensagem.
 * @param {string} deviceType
 * @returns {string}
 */
export function formatDeviceLabel(deviceType) {
  switch (deviceType) {
    case "desktop":
      return "💻 Desktop";
    case "tablet":
      return "📱 Tablet";
    case "mobile":
      return "📱 Celular";
    default:
      return "🌐 Web";
  }
}

/**
 * Monta o texto cirúrgico da notificação de clique para envio no WhatsApp do SDR.
 * @param {object} params
 * @param {object} params.link - Registro do smart link
 * @param {object} params.click - Registro do clique com telemetria
 * @param {object} [params.lead] - Dados do lead
 * @param {object} [params.campaign] - Dados da campanha
 * @returns {string} Mensagem formatada
 */
export function formatSdrClickAlert({ link, click, lead, campaign }) {
  const leadNome = lead?.nome ? String(lead.nome).trim() : "Lead Sem Nome";
  const leadTelefone = lead?.telefone ? String(lead.telefone).trim() : "Telefone não informado";
  const linkTitle = link?.title ? String(link.title).trim() : "Proposta";
  const campaignName = campaign?.name ? String(campaign.name).trim() : "Disparo Direto";
  const deviceIcon = formatDeviceLabel(click?.device_type);
  const horaFormatada = formatClickTime(click?.clicked_at);

  return [
    "🔔 *Alerta Vexo — Lead Clicou no Link!*",
    "",
    `*Lead:* ${leadNome} (${leadTelefone})`,
    `*Link:* ${linkTitle}`,
    `*Campanha:* ${campaignName}`,
    `*Dispositivo:* ${deviceIcon}`,
    `*Horário:* ${horaFormatada}`,
    "",
    "👉 _Momento de ouro para contato de fechamento!_",
  ].join("\n");
}

/**
 * Notifica o SDR / equipe comercial via WhatsApp quando um smart link é acessado.
 * @param {object} pool - Pool de conexão Postgres
 * @param {object} params
 * @param {object} params.link - Registro do smart link
 * @param {object} params.click - Registro do clique
 * @param {object} [params.lead] - Dados do lead
 * @param {object} [params.campaign] - Dados da campanha
 * @returns {Promise<{ sent: boolean, reason?: string, sentCount?: number, sdrNumbers?: string[], message?: string }>}
 */
export async function notifySdrOnLinkClick(pool, { link, click, lead = null, campaign = null }) {
  if (!pool || typeof pool.query !== "function" || !link || !link.client_id) {
    return { sent: false, reason: "parametros_invalidos" };
  }

  const clientId = link.client_id;

  try {
    // 1. Busca configurações do tenant
    let sdrNumbers = [];
    let webhookUrl = null;
    let webhookToken = null;

    const { rows: n8nRows } = await pool.query(
      `SELECT sdr_whatsapp_number, sdr_whatsapp_numbers, dispatch_webhook_url, dispatch_webhook_token
       FROM public.lead_client_n8n_settings
       WHERE client_id = $1
       LIMIT 1`,
      [clientId]
    ).catch((err) => {
      if (err?.code === "42P01") return { rows: [] };
      throw err;
    });

    const n8nSettings = n8nRows?.[0];
    if (n8nSettings) {
      if (Array.isArray(n8nSettings.sdr_whatsapp_numbers) && n8nSettings.sdr_whatsapp_numbers.length > 0) {
        sdrNumbers = n8nSettings.sdr_whatsapp_numbers;
      } else if (n8nSettings.sdr_whatsapp_number) {
        sdrNumbers = [n8nSettings.sdr_whatsapp_number];
      }
      webhookUrl = n8nSettings.dispatch_webhook_url;
      webhookToken = n8nSettings.dispatch_webhook_token;
    }

    // Normaliza números de SDR válidos (10 a 15 dígitos)
    const validSdrNumbers = Array.from(
      new Set(
        sdrNumbers
          .map((n) => String(n || "").replace(/\D/g, ""))
          .filter((n) => n.length >= 10 && n.length <= 15)
      )
    );

    if (validSdrNumbers.length === 0) {
      return { sent: false, reason: "sem_numero_sdr" };
    }

    // Se webhook não estiver em n8n_settings, busca instância Evolution ativa do tenant
    if (!webhookUrl) {
      const { rows: evoRows } = await pool.query(
        `SELECT dispatch_webhook_url, dispatch_webhook_token
         FROM public.lead_client_evolution_instances
         WHERE client_id = $1 AND active = true
         ORDER BY is_default DESC, created_at ASC
         LIMIT 1`,
        [clientId]
      ).catch((err) => {
        if (err?.code === "42P01") return { rows: [] };
        throw err;
      });
      if (evoRows?.[0]?.dispatch_webhook_url) {
        webhookUrl = evoRows[0].dispatch_webhook_url;
        webhookToken = evoRows[0].dispatch_webhook_token;
      }
    }

    if (!webhookUrl) {
      return { sent: false, reason: "sem_webhook_evolution", sdrNumbers: validSdrNumbers };
    }

    // 2. Busca dados complementares do lead se não fornecidos
    let resolvedLead = lead;
    if (!resolvedLead && link.lead_id) {
      const { rows: leadRows } = await pool.query(
        `SELECT nome, telefone, stage
         FROM public.leads
         WHERE id = $1 AND client_id = $2
         LIMIT 1`,
        [link.lead_id, clientId]
      );
      resolvedLead = leadRows?.[0] || null;
    }

    // 3. Busca dados complementares da campanha se não fornecidos
    let resolvedCampaign = campaign;
    if (!resolvedCampaign && link.campaign_id) {
      const { rows: campRows } = await pool.query(
        `SELECT name
         FROM public.campaigns
         WHERE id = $1 AND client_id = $2
         LIMIT 1`,
        [link.campaign_id, clientId]
      );
      resolvedCampaign = campRows?.[0] || null;
    }

    // 4. Monta a mensagem
    const message = formatSdrClickAlert({
      link,
      click,
      lead: resolvedLead,
      campaign: resolvedCampaign,
    });

    // 5. Dispara para os SDRs cadastrados
    let sentCount = 0;
    const headers = {
      "Content-Type": "application/json",
      ...(webhookToken ? { apikey: webhookToken } : {}),
    };

    for (const sdrPhone of validSdrNumbers) {
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            number: sdrPhone,
            text: message,
            message: message,
          }),
        });
        if (response.ok) {
          sentCount++;
        } else {
          const errText = await response.text().catch(() => "");
          console.warn(`[smartLinkAlerts] Falha HTTP ${response.status} ao enviar para SDR ${sdrPhone}: ${errText.slice(0, 100)}`);
        }
      } catch (sendErr) {
        console.warn(`[smartLinkAlerts] Erro de rede ao enviar para SDR ${sdrPhone}:`, sendErr.message);
      }
    }

    return {
      sent: sentCount > 0,
      sentCount,
      sdrNumbers: validSdrNumbers,
      message,
    };
  } catch (err) {
    console.error("[smartLinkAlerts] Erro geral ao notificar SDR:", err);
    return { sent: false, reason: "erro_execucao", error: err.message };
  }
}
