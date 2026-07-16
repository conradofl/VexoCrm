// Envio do contrato para o setor jurídico.
//
// Fluxo: gera o PDF (mesma fonte do download), sobe no canal do Slack do
// jurídico e avisa no WhatsApp. O jurídico revisa e assina com a ferramenta
// própria dele — o sistema não assina nada.
//
// Config por tenant fica em tenant_modules.config.gd.juridico:
//   { slack_channel_id, whatsapp_number, evolution_instance }
import { pgDatabasePool as db } from "../../services/database.js";
import { resolveTenantUuid } from "./tenantResolver.js";
import { sendError } from "../../services/httpInfra.js";
import { buildContractPdfBuffer } from "./contractHandlers.js";

const SLACK_API = "https://slack.com/api";

async function readGdConfig(tenantId) {
  const { rows } = await db.query("SELECT config FROM public.tenant_modules WHERE tenant_id = $1", [tenantId]);
  const config = rows[0]?.config || {};
  return { config, juridico: config?.gd?.juridico || {} };
}

export async function getJuridicoSettings(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;
    const { juridico } = await readGdConfig(tenantId);
    res.json({
      success: true,
      data: {
        slack_channel_id: juridico.slack_channel_id || "",
        whatsapp_number: juridico.whatsapp_number || "",
        evolution_instance: juridico.evolution_instance || "",
      },
    });
  } catch (error) {
    console.error("[getJuridicoSettings] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Erro ao carregar as configurações do jurídico.");
  }
}

export async function saveJuridicoSettings(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;
    const { slack_channel_id = "", whatsapp_number = "", evolution_instance = "" } = req.body || {};

    const { config } = await readGdConfig(tenantId);
    const novo = {
      ...config,
      gd: {
        ...(config.gd || {}),
        juridico: {
          slack_channel_id: String(slack_channel_id).trim(),
          whatsapp_number: String(whatsapp_number).trim(),
          evolution_instance: String(evolution_instance).trim(),
        },
      },
    };

    await db.query(
      `INSERT INTO public.tenant_modules (tenant_id, config)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET config = $2`,
      [tenantId, JSON.stringify(novo)]
    );

    res.json({ success: true, data: novo.gd.juridico });
  } catch (error) {
    console.error("[saveJuridicoSettings] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Erro ao salvar as configurações do jurídico.");
  }
}

// Instâncias de WhatsApp já conectadas — alimenta o dropdown do painel.
export async function listEvolutionInstances(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;

    let queryStr = "SELECT name, client_id FROM public.lead_client_evolution_instances WHERE active = true ORDER BY is_default DESC, name ASC";
    let params = [];
    const access = req.authAccess || {};
    if (access.role !== "internal" && Array.isArray(access.clientIds) && access.clientIds.length > 0) {
      queryStr = "SELECT name, client_id FROM public.lead_client_evolution_instances WHERE client_id = ANY($1) AND active = true ORDER BY is_default DESC, name ASC";
      params = [access.clientIds];
    }
    const { rows } = await db.query(queryStr, params);
    res.json({ success: true, data: rows.map((r) => ({ name: r.name, client_id: r.client_id })) });
  } catch (error) {
    console.error("[listEvolutionInstances] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Erro ao listar as instâncias de WhatsApp.");
  }
}

// Upload do PDF no Slack (fluxo atual: getUploadURLExternal -> PUT -> complete).
async function uploadPdfToSlack({ token, channelId, filename, buffer, comment }) {
  const urlRes = await fetch(`${SLACK_API}/files.getUploadURLExternal`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ filename, length: String(buffer.length) }),
  });
  const urlData = await urlRes.json();
  if (!urlData.ok) throw new Error(`Slack getUploadURLExternal: ${urlData.error}`);

  const putRes = await fetch(urlData.upload_url, { method: "POST", body: buffer });
  if (!putRes.ok) throw new Error(`Slack upload falhou (HTTP ${putRes.status})`);

  const completeRes = await fetch(`${SLACK_API}/files.completeUploadExternal`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      files: [{ id: urlData.file_id, title: filename }],
      channel_id: channelId,
      initial_comment: comment,
    }),
  });
  const completeData = await completeRes.json();
  if (!completeData.ok) throw new Error(`Slack completeUploadExternal: ${completeData.error}`);
}

function normalizeWhatsapp(num) {
  const clean = String(num || "").replace(/\D/g, "");
  if (clean.length === 10 || clean.length === 11) return "55" + clean;
  return clean;
}

async function sendWhatsapp({ number, text, instance }) {
  const evolutionUrl = process.env.GD_EVOLUTION_URL;
  const evolutionToken = process.env.GD_EVOLUTION_TOKEN;
  if (!evolutionUrl || !evolutionToken || !number) return "not_configured";

  let endpoint = evolutionUrl.endsWith("/") ? evolutionUrl.slice(0, -1) : evolutionUrl;
  if (!endpoint.includes("/message/sendText")) {
    endpoint = `${endpoint}/message/sendText/${instance || process.env.GD_EVOLUTION_INSTANCE || "Teste"}`;
  }

  const payload = {
    number: normalizeWhatsapp(number),
    options: { delay: 1200, presence: "composing" },
    textMessage: { text },
    text,
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: evolutionToken },
    body: JSON.stringify(payload),
  });
  return r.ok ? "sent" : "error";
}

export async function sendContractToJuridico(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;
    const { id } = req.params;

    const { juridico } = await readGdConfig(tenantId);
    const channelId = juridico.slack_channel_id;
    if (!channelId) {
      return sendError(res, 400, "NOT_CONFIGURED", "Configure o canal do Slack do jurídico antes de enviar.");
    }
    if (!process.env.SLACK_BOT_TOKEN) {
      return sendError(res, 503, "NOT_CONFIGURED", "SLACK_BOT_TOKEN não configurado no servidor.");
    }

    let built;
    try {
      built = await buildContractPdfBuffer(tenantId, id);
    } catch (e) {
      if (e.code === "CONTRACT_NOT_FOUND" || e.code === "TEMPLATE_NOT_FOUND") {
        return sendError(res, 404, "NOT_FOUND", e.message);
      }
      throw e;
    }

    const { dados, pdfData } = built;
    const empresa = dados.razao_social || "Cliente";
    const resumo =
      `*Contrato para revisão do jurídico*\n` +
      `• Empresa: ${empresa}\n` +
      `• CNPJ: ${dados.cnpj || "-"}\n` +
      `• Representante: ${dados.representante || "-"}\n` +
      `• Prazo: ${dados.prazo_dias || "-"} dias\n` +
      `Revisar e enviar ao cliente para assinatura.`;

    await uploadPdfToSlack({
      token: process.env.SLACK_BOT_TOKEN,
      channelId,
      filename: `contrato-${empresa.replace(/[^\w\-]+/g, "-").toLowerCase()}.pdf`,
      buffer: pdfData,
      comment: resumo,
    });

    // Aviso no WhatsApp é best-effort: se falhar, o contrato já está no Slack.
    let whatsappStatus = "not_configured";
    if (juridico.whatsapp_number) {
      try {
        whatsappStatus = await sendWhatsapp({
          number: juridico.whatsapp_number,
          instance: juridico.evolution_instance,
          text: `Novo contrato para revisão: *${empresa}*. O PDF está no canal do jurídico no Slack.`,
        });
      } catch (waErr) {
        console.warn("[sendContractToJuridico] WhatsApp falhou:", waErr?.message || waErr);
        whatsappStatus = "error";
      }
    }

    await db.query(
      `UPDATE gd_contracts SET status = 'em_revisao_juridico', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    res.json({ success: true, slack: "sent", whatsapp: whatsappStatus });
  } catch (error) {
    console.error("[sendContractToJuridico] Error:", error);
    if (!res.headersSent) {
      sendError(res, 500, "INTERNAL_ERROR", error.message || "Erro ao enviar o contrato ao jurídico.");
    }
  }
}
