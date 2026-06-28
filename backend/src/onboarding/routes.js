import crypto from "crypto";
import Groq from "groq-sdk";
import { getAuth } from "firebase-admin/auth";
import { getPool } from "./db.js";
import {
  ensureLeadClientTable,
  normalizeTenantKey,
} from "../lead-client-tables.js";

const INTERPRET_SYSTEM_PROMPT =
  'Voce e um assistente de onboarding do Vexo OS. Analise a descricao do usuario e extraia as informacoes necessarias para criar um cliente no sistema. Retorne APENAS um JSON valido sem texto adicional, sem markdown, sem blocos de codigo. Estrutura exata: { "company_name": string, "evolution_instance": string, "webhook_url": string ou null, "campaign_name": string, "campaign_description": string ou null, "default_origin": string ou null, "templates": [ { "name": string, "message": string, "trigger_type": "on_schedule" | "before_meeting" | "after_meeting" | "no_reply", "trigger_value": number, "trigger_unit": "minutes" | "hours" | "days", "trigger_direction": string ou null, "order_index": number } ] }. Nas mensagens use {{lead_name}}, {{meeting_date}}, {{meeting_time}} onde apropriado. Campos obrigatorios: company_name, evolution_instance, campaign_name, templates (minimo 1).';

const REQUIRED_INTERPRET_FIELDS = ["company_name", "evolution_instance", "campaign_name", "templates"];

let _groq = null;
function getGroq() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

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

function buildOperationalClientId(companyName, evolutionInstance) {
  return normalizeTenantKey(evolutionInstance) || normalizeTenantKey(companyName);
}

export function parseInterpretResponse(rawText) {
  try {
    const data = JSON.parse(rawText.trim());
    return { success: true, data };
  } catch {
    return { success: false, error: "parse_error", raw: rawText };
  }
}

export function checkInterpretFields(parsed) {
  return REQUIRED_INTERPRET_FIELDS.filter((f) => {
    if (f === "templates") return !Array.isArray(parsed.templates) || parsed.templates.length === 0;
    return !parsed[f];
  });
}

export function validateOnboardingPayload(body) {
  const errors = [];
  if (!body) return [{ field: "body", message: "Payload ausente" }];

  const { company_name, evolution_instance, campaign_name, templates, user_email } = body;

  if (!str(company_name)) errors.push({ field: "company_name", message: "company_name e obrigatorio" });
  if (!str(evolution_instance)) errors.push({ field: "evolution_instance", message: "evolution_instance e obrigatorio" });
  if (!str(campaign_name)) errors.push({ field: "campaign_name", message: "campaign_name e obrigatorio" });
  if (!Array.isArray(templates)) errors.push({ field: "templates", message: "templates deve ser um array" });
  else if (templates.length === 0) errors.push({ field: "templates", message: "E necessario pelo menos 1 template" });

  if (user_email !== undefined && user_email !== null && user_email !== "") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(user_email).trim())) {
      errors.push({ field: "user_email", message: "user_email invalido" });
    }
  }

  return errors;
}

export function registerOnboardingRoutes(app, requireFirebaseAuth, requireInternalAccess) {
  app.post("/api/onboarding/interpret", requireFirebaseAuth, requireInternalAccess, async (req, res) => {
    const { prompt } = req.body || {};
    if (!str(prompt)) {
      return sendErr(res, 400, "MISSING_PROMPT", "prompt nao pode estar vazio");
    }

    if (!process.env.GROQ_API_KEY) {
      return sendErr(res, 503, "GROQ_DISABLED", "Groq nao configurado no servidor");
    }

    try {
      const model = process.env.GROQ_CAMPAIGN_AI_MODEL || "llama-3.1-8b-instant";
      const completion = await getGroq().chat.completions.create({
        model,
        messages: [
          { role: "system", content: INTERPRET_SYSTEM_PROMPT },
          { role: "user", content: str(prompt) },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      });

      const rawText = completion.choices?.[0]?.message?.content || "";
      const parsed = parseInterpretResponse(rawText);

      if (!parsed.success) {
        return res.status(422).json({ success: false, error: "parse_error", raw: parsed.raw });
      }

      const missing = checkInterpretFields(parsed.data);
      if (missing.length > 0) {
        return res.status(422).json({ success: false, error: "missing_fields", fields: missing, data: parsed.data });
      }

      return res.json({ success: true, data: parsed.data });
    } catch (err) {
      console.error("[onboarding/interpret]", err.message);
      return sendErr(res, 500, "GROQ_ERROR", err.message);
    }
  });

  app.post("/api/onboarding", requireFirebaseAuth, requireInternalAccess, async (req, res) => {
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

    const operationalClientId = buildOperationalClientId(company_name, evolution_instance);
    if (!operationalClientId) {
      return sendErr(res, 400, "INVALID_CLIENT_ID", "Nao foi possivel gerar um clientId valido para o cliente");
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const leadClientResult = await client.query(
        `INSERT INTO leads_clients (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, name, created_at`,
        [operationalClientId, str(company_name)]
      );
      const leadClient = leadClientResult.rows[0];
      const leadsTable = await ensureLeadClientTable(client, operationalClientId, "generico");

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
            str(tpl.name) || `Template ${Number(tpl.order_index) + 1}`,
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
        client_id: leadClient.id,
        client_name: leadClient.name,
        leads_table: leadsTable,
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
          return sendErr(res, 409, "DUPLICATE_INSTANCE", `A instancia '${str(evolution_instance)}' ja esta em uso`);
        }
        return sendErr(res, 409, "DUPLICATE_ENTRY", `Registro duplicado: ${detail}`);
      }

      return sendErr(res, 500, "INTERNAL_ERROR", err.message);
    } finally {
      client.release();
    }
  });
}
