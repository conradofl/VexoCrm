import crypto from "crypto";
import { getPool } from "./db.js";
import { getAuth } from "firebase-admin/auth";

function generateSecret() {
  return crypto.randomBytes(24).toString("hex");
}

function generateTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function generateWebhookUrl(campaignId) {
  return `https://api.vexoia.com/webhooks/followup/${campaignId}`;
}

function sendErr(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

function str(v) {
  return typeof v === "string" ? v.trim() || null : null;
}

export function validateOnboardingPayload(body) {
  const errors = [];
  if (!body) return [{ field: "body", message: "Payload ausente" }];

  const { company_name, evolution_instance, campaign_name, templates, user_email } = body;

  if (!str(company_name)) errors.push({ field: "company_name", message: "company_name é obrigatório" });
  if (!str(evolution_instance)) errors.push({ field: "evolution_instance", message: "evolution_instance é obrigatório" });
  if (!str(campaign_name)) errors.push({ field: "campaign_name", message: "campaign_name é obrigatório" });
  if (!Array.isArray(templates)) errors.push({ field: "templates", message: "templates deve ser um array" });
  else if (templates.length === 0) errors.push({ field: "templates", message: "É necessário pelo menos 1 template" });

  if (user_email !== undefined && user_email !== null && user_email !== "") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(user_email).trim())) {
      errors.push({ field: "user_email", message: "user_email inválido" });
    }
  }

  return errors;
}

export function registerOnboardingRoutes(app, requireFirebaseAuth) {
  app.post("/api/onboarding", requireFirebaseAuth, async (req, res) => {
    const body = req.body || {};
    const errors = validateOnboardingPayload(body);
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: errors[0].message, fields: errors },
      });
    }

    const {
      company_name,
      evolution_instance,
      webhook_url,
      panel_access,
      user_email,
      user_name,
      campaign_name,
      campaign_description,
      default_origin,
      templates,
    } = body;

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const companyResult = await client.query(
        `INSERT INTO followup_companies (name, evolution_instance, webhook_url, panel_access)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [str(company_name), str(evolution_instance), str(webhook_url) || null, panel_access === true]
      );
      const companyId = companyResult.rows[0].id;

      const webhookSecret = generateSecret();
      const campaignResult = await client.query(
        `INSERT INTO followup_campaigns (company_id, name, description, default_origin, webhook_secret)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          companyId,
          str(campaign_name),
          str(campaign_description) || null,
          str(default_origin) || null,
          webhookSecret,
        ]
      );
      const campaignId = campaignResult.rows[0].id;

      for (const tpl of templates) {
        await client.query(
          `INSERT INTO followup_templates
             (campaign_id, name, message, trigger_type, trigger_value, trigger_unit, trigger_direction, order_index)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            campaignId,
            str(tpl.name) || `Template ${tpl.order_index + 1}`,
            tpl.message || "",
            tpl.trigger_type || "on_schedule",
            Number(tpl.trigger_value) || 0,
            tpl.trigger_unit || "minutes",
            tpl.trigger_direction || null,
            Number(tpl.order_index) || 0,
          ]
        );
      }

      if (str(user_email)) {
        const tempPassword = generateTempPassword();
        try {
          await getAuth().createUser({
            email: str(user_email),
            displayName: str(user_name) || undefined,
            password: tempPassword,
          });
        } catch (firebaseErr) {
          if (firebaseErr.code !== "auth/email-already-exists") {
            throw firebaseErr;
          }
        }
      }

      await client.query("COMMIT");

      return res.json({
        success: true,
        company_id: companyId,
        campaign_id: campaignId,
        webhook_url: generateWebhookUrl(campaignId),
        webhook_secret: webhookSecret,
        templates_created: templates.length,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[onboarding/POST]", err.message);

      if (err.code === "23505") {
        const detail = err.detail || err.message || "";
        if (detail.includes("evolution_instance")) {
          return sendErr(res, 409, "DUPLICATE_INSTANCE", `A instância '${str(evolution_instance)}' já está em uso`);
        }
        return sendErr(res, 409, "DUPLICATE_ENTRY", `Registro duplicado: ${detail}`);
      }

      return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
    } finally {
      client.release();
    }
  });
}
