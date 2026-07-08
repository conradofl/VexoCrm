// backend/src/domains/vexoSales/routes.js
// Movimento puro (extraído de registerAllDomainRoutes.js): 6 rotas /api/vexo-sales/*
// + helpers autocontidos (constantes de enum, normalizadores, actor/log, payload
// builder e summary). Corpo dos handlers idêntico ao original — só muda de onde
// vêm as dependências (deps em vez de routeDeps destructure inline).

export function registerVexoSalesRoutes(app, deps) {
  const {
    ensureDb,
    isMissingSchemaError,
    normalizeString,
    requireFirebaseAuth,
    sendError,
    supabase,
  } = deps;

  const VEXO_SALES_STAGES = new Set([
    "Novo lead",
    "Primeiro contato",
    "Qualificação",
    "Diagnóstico",
    "Proposta enviada",
    "Negociação",
    "Fechado ganho",
    "Fechado perdido",
  ]);

  const VEXO_SALES_STATUSES = new Set(["ativo", "pausado", "ganho", "perdido"]);
  const VEXO_SALES_PRIORITIES = new Set(["baixa", "media", "alta"]);
  const VEXO_SALES_INTERACTION_TYPES = new Set(["ligacao", "whatsapp", "reuniao", "email", "observacao"]);

  function normalizeVexoSalesChoice(value, allowedValues, fallback) {
    const normalized = normalizeString(value);
    return normalized && allowedValues.has(normalized) ? normalized : fallback;
  }

  function normalizeVexoSalesNumber(value) {
    if (value === null || value === undefined || value === "") return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function normalizeVexoSalesDate(value) {
    const normalized = normalizeString(value);
    if (!normalized) return null;

    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return null;

    return normalized.slice(0, 10);
  }

  function getVexoSalesActor(req) {
    return {
      email: normalizeString(req.authAccess?.email || req.authUser?.email),
      uid: normalizeString(req.authUser?.uid),
    };
  }

  function logVexoSalesApi(level, event, req, details = {}) {
    const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    logger("[vexo-sales-api]", event, {
      method: req?.method,
      path: req?.originalUrl || req?.url,
      uid: normalizeString(req?.authUser?.uid),
      role: normalizeString(req?.authAccess?.role),
      isAdmin: Boolean(req?.authAccess?.isAdmin),
      ...details,
    });
  }

  function requireVexoSalesAdminAccess(req, res, next) {
    if (req.authAccess?.role !== "internal" || !req.authAccess?.isAdmin) {
      logVexoSalesApi("warn", "access_denied", req);
      sendError(res, 403, "FORBIDDEN", "Admin permission required");
      return;
    }

    next();
  }

  function buildVexoSalesOpportunityPayload(body, req, { partial = false } = {}) {
    const actor = getVexoSalesActor(req);
    const payload = {};

    const hasAnyField = (...fields) => fields.some((field) => Object.prototype.hasOwnProperty.call(body, field));
    const assignString = (field, value, ...aliases) => {
      if (!partial || hasAnyField(field, ...aliases)) {
        payload[field] = normalizeString(value);
      }
    };

    assignString("company_name", body?.company_name ?? body?.companyName, "companyName");
    assignString("contact_name", body?.contact_name ?? body?.contactName, "contactName");
    assignString("contact_phone", body?.contact_phone ?? body?.contactPhone, "contactPhone");
    assignString("contact_email", body?.contact_email ?? body?.contactEmail, "contactEmail");
    assignString("source", body?.source);
    assignString("segment", body?.segment);
    assignString("assigned_to", body?.assigned_to ?? body?.assignedTo, "assignedTo");
    assignString("notes", body?.notes);

    if (!partial || hasAnyField("estimated_value", "estimatedValue")) {
      payload.estimated_value = normalizeVexoSalesNumber(body?.estimated_value ?? body?.estimatedValue);
    }

    if (!partial || Object.prototype.hasOwnProperty.call(body, "stage")) {
      payload.stage = normalizeVexoSalesChoice(body?.stage, VEXO_SALES_STAGES, "Novo lead");
    }

    if (!partial || Object.prototype.hasOwnProperty.call(body, "status")) {
      payload.status = normalizeVexoSalesChoice(body?.status, VEXO_SALES_STATUSES, "ativo");
    }

    if (!partial || Object.prototype.hasOwnProperty.call(body, "priority")) {
      payload.priority = normalizeVexoSalesChoice(body?.priority, VEXO_SALES_PRIORITIES, "media");
    }

    if (!partial || hasAnyField("expected_close_date", "expectedCloseDate")) {
      payload.expected_close_date = normalizeVexoSalesDate(body?.expected_close_date ?? body?.expectedCloseDate);
    }

    if (!partial) {
      payload.owner_company = "vexo";
      payload.internal_module = true;
      payload.created_by = actor.email;
      payload.created_by_uid = actor.uid;
    }

    payload.updated_at = new Date().toISOString();

    return payload;
  }

  function buildVexoSalesSummary(items) {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const total = items.length;
    const won = items.filter((item) => item.status === "ganho");
    const lost = items.filter((item) => item.status === "perdido");
    const open = items.filter((item) => !["ganho", "perdido"].includes(item.status));
    const wonThisMonth = won.filter((item) => {
      const updatedAt = new Date(item.updated_at || item.created_at);
      return updatedAt.getMonth() === month && updatedAt.getFullYear() === year;
    });

    const estimatedNegotiationValue = open.reduce(
      (sum, item) => sum + normalizeVexoSalesNumber(item.estimated_value),
      0
    );
    const closedCount = won.length + lost.length;

    return {
      total,
      open: open.length,
      estimatedNegotiationValue,
      wonThisMonth: wonThisMonth.length,
      conversionRate: closedCount ? Math.round((won.length / closedCount) * 100) : 0,
    };
  }

  app.get("/api/vexo-sales/opportunities", requireFirebaseAuth, requireVexoSalesAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;

    try {
      let query = supabase
        .from("vexo_sales_opportunities")
        .select("*")
        .eq("owner_company", "vexo")
        .eq("internal_module", true)
        .order("updated_at", { ascending: false });

      const stage = normalizeString(req.query?.stage);
      const status = normalizeString(req.query?.status);
      const priority = normalizeString(req.query?.priority);
      const source = normalizeString(req.query?.source);
      const assignedTo = normalizeString(req.query?.assignedTo ?? req.query?.assigned_to);

      if (stage && VEXO_SALES_STAGES.has(stage)) query = query.eq("stage", stage);
      if (status && VEXO_SALES_STATUSES.has(status)) query = query.eq("status", status);
      if (priority && VEXO_SALES_PRIORITIES.has(priority)) query = query.eq("priority", priority);
      if (source) query = query.ilike("source", `%${source}%`);
      if (assignedTo) query = query.ilike("assigned_to", `%${assignedTo}%`);

      const { data, error } = await query;
      if (error) throw error;

      res.json({
        items: data || [],
        summary: buildVexoSalesSummary(data || []),
      });
    } catch (error) {
      logVexoSalesApi("error", "opportunities_query_failed", req, { error: error?.message || String(error) });
      const missingSchema = isMissingSchemaError(error);
      sendError(
        res,
        500,
        missingSchema ? "VEXO_SALES_SCHEMA_MISSING" : "VEXO_SALES_QUERY_FAILED",
        error instanceof Error ? error.message : "Failed to query Vexo sales opportunities"
      );
    }
  });

  app.post("/api/vexo-sales/opportunities", requireFirebaseAuth, requireVexoSalesAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;

    const payload = buildVexoSalesOpportunityPayload(req.body || {}, req);
    if (!payload.company_name) {
      logVexoSalesApi("warn", "opportunity_create_invalid_body", req);
      sendError(res, 400, "INVALID_BODY", "Company name is required");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("vexo_sales_opportunities")
        .insert(payload)
        .select("*")
        .single();

      if (error) throw error;
      logVexoSalesApi("info", "opportunity_created", req, { opportunityId: data?.id });
      res.status(201).json({ item: data });
    } catch (error) {
      logVexoSalesApi("error", "opportunity_create_failed", req, { error: error?.message || String(error) });
      sendError(res, 500, "VEXO_SALES_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create opportunity");
    }
  });

  app.patch("/api/vexo-sales/opportunities/:id", requireFirebaseAuth, requireVexoSalesAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;

    const id = normalizeString(req.params.id);
    if (!id) {
      logVexoSalesApi("warn", "opportunity_update_missing_id", req);
      sendError(res, 400, "INVALID_ID", "Missing opportunity id");
      return;
    }

    const payload = buildVexoSalesOpportunityPayload(req.body || {}, req, { partial: true });
    if (Object.prototype.hasOwnProperty.call(payload, "company_name") && !payload.company_name) {
      logVexoSalesApi("warn", "opportunity_update_invalid_body", req, { opportunityId: id });
      sendError(res, 400, "INVALID_BODY", "Company name is required");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("vexo_sales_opportunities")
        .update(payload)
        .eq("id", id)
        .eq("owner_company", "vexo")
        .eq("internal_module", true)
        .select("*")
        .single();

      if (error) throw error;
      logVexoSalesApi("info", "opportunity_updated", req, { opportunityId: data?.id || id });
      res.json({ item: data });
    } catch (error) {
      logVexoSalesApi("error", "opportunity_update_failed", req, { opportunityId: id, error: error?.message || String(error) });
      sendError(res, 500, "VEXO_SALES_UPDATE_FAILED", error instanceof Error ? error.message : "Failed to update opportunity");
    }
  });

  app.delete("/api/vexo-sales/opportunities/:id", requireFirebaseAuth, requireVexoSalesAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;

    const id = normalizeString(req.params.id);
    if (!id) {
      logVexoSalesApi("warn", "opportunity_delete_missing_id", req);
      sendError(res, 400, "INVALID_ID", "Missing opportunity id");
      return;
    }

    try {
      const { error } = await supabase
        .from("vexo_sales_opportunities")
        .delete()
        .eq("id", id)
        .eq("owner_company", "vexo")
        .eq("internal_module", true);

      if (error) throw error;
      logVexoSalesApi("info", "opportunity_deleted", req, { opportunityId: id });
      res.json({ success: true });
    } catch (error) {
      logVexoSalesApi("error", "opportunity_delete_failed", req, { opportunityId: id, error: error?.message || String(error) });
      sendError(res, 500, "VEXO_SALES_DELETE_FAILED", error instanceof Error ? error.message : "Failed to delete opportunity");
    }
  });

  app.get("/api/vexo-sales/opportunities/:id/interactions", requireFirebaseAuth, requireVexoSalesAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;

    const id = normalizeString(req.params.id);
    if (!id) {
      logVexoSalesApi("warn", "interactions_query_missing_id", req);
      sendError(res, 400, "INVALID_ID", "Missing opportunity id");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("vexo_sales_interactions")
        .select("*")
        .eq("opportunity_id", id)
        .order("interaction_at", { ascending: false });

      if (error) throw error;
      res.json({ items: data || [] });
    } catch (error) {
      logVexoSalesApi("error", "interactions_query_failed", req, { opportunityId: id, error: error?.message || String(error) });
      sendError(res, 500, "VEXO_SALES_INTERACTIONS_QUERY_FAILED", error instanceof Error ? error.message : "Failed to query interactions");
    }
  });

  app.post("/api/vexo-sales/opportunities/:id/interactions", requireFirebaseAuth, requireVexoSalesAdminAccess, async (req, res) => {
    if (!ensureDb(res)) return;

    const opportunityId = normalizeString(req.params.id);
    const type = normalizeVexoSalesChoice(req.body?.type, VEXO_SALES_INTERACTION_TYPES, null);
    const description = normalizeString(req.body?.description);

    if (!opportunityId || !type || !description) {
      logVexoSalesApi("warn", "interaction_create_invalid_body", req, { opportunityId });
      sendError(res, 400, "INVALID_BODY", "Opportunity id, interaction type and description are required");
      return;
    }

    const actor = getVexoSalesActor(req);
    const interactionAt = req.body?.interaction_at || req.body?.interactionAt;
    const payload = {
      opportunity_id: opportunityId,
      type,
      description,
      interaction_at: interactionAt ? new Date(interactionAt).toISOString() : new Date().toISOString(),
      responsible_user: normalizeString(req.body?.responsible_user ?? req.body?.responsibleUser) || actor.email,
      created_by: actor.email,
      created_by_uid: actor.uid,
    };

    if (Number.isNaN(new Date(payload.interaction_at).getTime())) {
      logVexoSalesApi("warn", "interaction_create_invalid_date", req, { opportunityId });
      sendError(res, 400, "INVALID_DATE", "Invalid interaction date");
      return;
    }

    try {
      const { data: opportunity, error: opportunityError } = await supabase
        .from("vexo_sales_opportunities")
        .select("id")
        .eq("id", opportunityId)
        .eq("owner_company", "vexo")
        .eq("internal_module", true)
        .single();

      if (opportunityError || !opportunity) {
        logVexoSalesApi("warn", "interaction_create_opportunity_not_found", req, { opportunityId });
        sendError(res, 404, "OPPORTUNITY_NOT_FOUND", "Opportunity not found");
        return;
      }

      const { data, error } = await supabase
        .from("vexo_sales_interactions")
        .insert(payload)
        .select("*")
        .single();

      if (error) throw error;

      await supabase
        .from("vexo_sales_opportunities")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", opportunityId)
        .eq("owner_company", "vexo")
        .eq("internal_module", true);

      logVexoSalesApi("info", "interaction_created", req, { opportunityId, interactionId: data?.id });
      res.status(201).json({ item: data });
    } catch (error) {
      logVexoSalesApi("error", "interaction_create_failed", req, { opportunityId, error: error?.message || String(error) });
      sendError(res, 500, "VEXO_SALES_INTERACTION_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create interaction");
    }
  });
}
