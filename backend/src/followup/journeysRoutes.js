import { Router } from "express";
import { getSupabase } from "./db.js";

function sendErr(res, status, code, message) {
  console.error(`[followup/journeys][${code}]`, message);
  return res.status(status).json({ success: false, error: { code, message } });
}

function str(v) {
  return typeof v === "string" ? v.trim() || null : null;
}

export function registerJourneysRoutes(app, requireFirebaseAuth) {
  const router = Router();

  // GET /api/followup/journeys?companyId=
  router.get("/", requireFirebaseAuth, async (req, res) => {
    const companyId = str(req.query.companyId);
    if (!companyId) return sendErr(res, 400, "MISSING_COMPANY_ID", "companyId é obrigatório");

    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("fup_journeys")
        .select("*")
        .eq("company_id", companyId);

      if (error) throw error;

      return res.json({ success: true, journeys: data || [] });
    } catch (err) {
      return sendErr(res, 500, "JOURNEYS_FETCH_FAILED", err.message);
    }
  });

  // POST /api/followup/journeys
  router.post("/", requireFirebaseAuth, async (req, res) => {
    const { company_id, trigger_event, is_active, channel, delay_value, delay_unit, ai_prompt } = req.body;

    if (!str(company_id) || !str(trigger_event)) {
      return sendErr(res, 400, "MISSING_FIELDS", "company_id e trigger_event são obrigatórios");
    }

    try {
      const supabase = getSupabase();
      // Usar upsert para garantir que só haja 1 jornada por evento por empresa
      const { data, error } = await supabase
        .from("fup_journeys")
        .upsert({
          company_id: str(company_id),
          trigger_event: str(trigger_event),
          is_active: Boolean(is_active),
          channel: str(channel) || 'whatsapp',
          delay_value: Number(delay_value) || 0,
          delay_unit: str(delay_unit) || 'minutes',
          ai_prompt: str(ai_prompt) || ''
        }, { onConflict: 'company_id,trigger_event' })
        .select()
        .maybeSingle();

      if (error) throw error;
      return res.json({ success: true, journey: data });
    } catch (err) {
      return sendErr(res, 500, "JOURNEY_UPSERT_FAILED", err.message);
    }
  });

  app.use("/api/followup/journeys", router);
}
