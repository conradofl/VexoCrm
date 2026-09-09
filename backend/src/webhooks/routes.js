import { routeDeps } from "../http/routeDeps.js";
import { randomBytes } from "crypto";
import { upsertLeadByPhone } from "../services/leadUpsert.js";

/**
 * Registra rotas públicas de webhooks para Inbound Leads e Conversões (Sales).
 * @param {import("express").Express} app 
 */
export function registerWebhooksRoutes(app) {
  const { pgDatabasePool, sanitizePhone, requireFirebaseAuth } = routeDeps;

  // --- Auth endpoints para Frontend ---
  app.get("/api/lead-clients/:tenant_id/webhooks", requireFirebaseAuth, async (req, res) => {
    try {
      const { tenant_id } = req.params;
      const settingsQuery = await pgDatabasePool.query(
        `SELECT inbound_token, conversion_token FROM public.webhook_settings WHERE client_id = $1`,
        [tenant_id]
      );
      
      if (settingsQuery.rowCount === 0) {
        return res.status(200).json({ item: null });
      }
      return res.status(200).json({ item: settingsQuery.rows[0] });
    } catch (err) {
      console.error("Error fetching webhooks settings:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.post("/api/lead-clients/:tenant_id/webhooks/generate", requireFirebaseAuth, async (req, res) => {
    try {
      const { tenant_id } = req.params;
      const inboundToken = randomBytes(32).toString("hex");
      const conversionToken = randomBytes(32).toString("hex");

      const insertQuery = await pgDatabasePool.query(`
        INSERT INTO public.webhook_settings (client_id, inbound_token, conversion_token)
        VALUES ($1, $2, $3)
        ON CONFLICT (client_id) DO UPDATE SET
          inbound_token = EXCLUDED.inbound_token,
          conversion_token = EXCLUDED.conversion_token,
          updated_at = now()
        RETURNING inbound_token, conversion_token
      `, [tenant_id, inboundToken, conversionToken]);

      return res.status(200).json({ item: insertQuery.rows[0] });
    } catch (err) {
      console.error("Error generating webhooks settings:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Inbound Leads (Formulários, Meta Ads, Typeform, etc)
  app.post("/api/webhooks/inbound/:tenant_id", async (req, res) => {
    try {
      const { tenant_id } = req.params;
      const { token } = req.query;
      
      if (!tenant_id || !token) {
        return res.status(401).json({ error: "Missing tenant_id or token" });
      }

      // Valida o token
      const settingsQuery = await pgDatabasePool.query(
        `SELECT inbound_token FROM public.webhook_settings WHERE client_id = $1`,
        [tenant_id]
      );
      
      if (settingsQuery.rowCount === 0 || settingsQuery.rows[0].inbound_token !== token) {
        return res.status(403).json({ error: "Invalid token or tenant not found" });
      }

      const payload = req.body || {};
      const rawPhone = payload.phone || payload.telefone || payload.whatsapp || "";
      const phone = sanitizePhone(String(rawPhone));
      const name = payload.name || payload.nome || payload.cliente || "";
      const source = payload.source || payload.origem || "webhook";
      const campaign = payload.campaign || payload.campanha || "";

      if (!phone) {
        return res.status(400).json({ error: "Missing phone number in payload" });
      }

      // Insere ou atualiza o lead via rotina unificada sem depender de constraint única
      await upsertLeadByPhone(pgDatabasePool, tenant_id, phone, {
        phone,
        nome: name || null,
        status: "NOVO",
        qualificacao: `Source: ${source} | Campaign: ${campaign}`,
        historico: `Lead entrou via Webhook em ${new Date().toISOString()}`,
      });

      return res.status(200).json({ success: true, message: "Lead registered via webhook" });
    } catch (err) {
      console.error("Error processing inbound webhook:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Conversões (Pagamentos, ERPs, CRM Sync)
  app.post("/api/webhooks/conversion/:tenant_id", async (req, res) => {
    try {
      const { tenant_id } = req.params;
      const { token } = req.query;
      
      if (!tenant_id || !token) {
        return res.status(401).json({ error: "Missing tenant_id or token" });
      }

      const settingsQuery = await pgDatabasePool.query(
        `SELECT conversion_token FROM public.webhook_settings WHERE client_id = $1`,
        [tenant_id]
      );
      
      if (settingsQuery.rowCount === 0 || settingsQuery.rows[0].conversion_token !== token) {
        return res.status(403).json({ error: "Invalid token or tenant not found" });
      }

      const payload = req.body || {};
      const rawPhone = payload.phone || payload.telefone || payload.whatsapp || "";
      const phone = sanitizePhone(String(rawPhone));
      const value = parseFloat(payload.value || payload.valor || 0);

      if (!phone) {
        return res.status(400).json({ error: "Missing phone number to match conversion" });
      }

      // Atualiza status e estágio para buyer com stage_source='integration'
      const updateQuery = await pgDatabasePool.query(`
        UPDATE public.leads 
        SET status = 'WON', 
            stage = 'buyer',
            stage_source = 'integration',
            potential_contract_value = CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE potential_contract_value END,
            updated_at = now(),
            historico = CONCAT(COALESCE(historico, ''), '\n[Conversão] Fechamento via Webhook: R$ ', $3::text)
        WHERE client_id = $1 AND (telefone = $2 OR phone = $2)
        RETURNING id
      `, [tenant_id, phone, value]);

      if (updateQuery.rowCount === 0) {
        return res.status(404).json({ error: "Lead not found to attach conversion" });
      }

      // Se houver tabela de revenue ops, poderíamos atualizar `contract_value` também.
      // Opcional: pausar jornadas de follow up.

      return res.status(200).json({ success: true, message: "Conversion logged" });
    } catch (err) {
      console.error("Error processing conversion webhook:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });
}
