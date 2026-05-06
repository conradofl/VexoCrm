import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const getEnv = (primary: string, fallback?: string): string | null => {
  const value = Deno.env.get(primary);
  if (value) return value;
  if (!fallback) return null;
  return Deno.env.get(fallback) ?? null;
};

const getBearerTokenFromRequest = (req: Request): string | null => {
  const authHeader =
    req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
};

const normalizeClientId = (value: unknown): string | null => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : null;
};

const normalizeString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.startsWith("=") ? str.slice(1).trim() : str;
};

const normalizeIsoDate = (value: unknown): string | null => {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
};

const sanitizePhone = (value: unknown): string | null => {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const digits = normalized.replace(/\D/g, "");
  return digits || null;
};

const allowedConversationStatuses = new Set([
  "aguardando_usuario",
  "em_atendimento",
  "finalizado",
]);

const normalizeConversationStatus = (value: unknown): string | null => {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return allowedConversationStatuses.has(normalized) ? normalized : "__invalid__";
};

const normalizeKey = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const pickRowValue = (
  row: Record<string, unknown>,
  keys: string[],
): unknown => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }

  const wanted = new Set(keys.map(normalizeKey));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(normalizeKey(key))) return value;
  }

  return null;
};

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const errorResponse = (status: number, error: string, details?: string) =>
  jsonResponse(
    details ? { success: false, error, details } : { success: false, error },
    status,
  );

const normalizeImportedLead = (
  row: Record<string, unknown>,
  clientId: string,
) => {
  const telefone = sanitizePhone(
    pickRowValue(row, [
      "telefone",
      "telefones",
      "fone",
      "fones",
      "celular",
      "celulares",
      "whatsapp",
      "whatsapps",
      "phone",
      "phones",
      "numero",
      "numeros",
      "number",
      "numbers",
      "numero_telefone",
      "telefone_whatsapp",
    ]),
  );

  return {
    client_id: clientId,
    telefone,
    nome: normalizeString(
      pickRowValue(row, ["nome", "name", "cliente", "contato", "lead"]),
    ),
    tipo_cliente: normalizeString(
      pickRowValue(row, ["tipo_cliente", "tipo", "perfil", "segmento"]),
    ),
    faixa_consumo: normalizeString(
      pickRowValue(row, [
        "faixa_consumo",
        "consumo",
        "consumo_mensal",
        "valor_conta",
        "conta_energia",
        "ticket",
      ]),
    ),
    cidade: normalizeString(pickRowValue(row, ["cidade", "city", "municipio"])),
    estado: normalizeString(pickRowValue(row, ["estado", "uf", "state"])),
    status: normalizeString(
      pickRowValue(row, ["status", "etapa", "situacao", "pipeline_status"]),
    ),
    data_hora: normalizeIsoDate(
      pickRowValue(row, ["data_hora", "data", "created_at", "timestamp"]),
    ),
    qualificacao: normalizeString(
      pickRowValue(row, [
        "qualificacao",
        "observacoes",
        "observacao",
        "resumo",
        "anotacoes",
        "notas",
        "descricao",
      ]),
    ),
    status_conversa: normalizeConversationStatus(
      pickRowValue(row, [
        "status_conversa",
        "statusConversa",
        "conversation_status",
        "status_da_conversa",
      ]),
    ),
    ultima_interacao_bot: normalizeIsoDate(
      pickRowValue(row, [
        "ultima_interacao_bot",
        "ultimaInteracaoBot",
        "last_bot_interaction",
        "bot_timestamp",
      ]),
    ),
    ultima_interacao_usuario: normalizeIsoDate(
      pickRowValue(row, [
        "ultima_interacao_usuario",
        "ultimaInteracaoUsuario",
        "last_user_interaction",
        "user_timestamp",
      ]),
    ),
  };
};

const isImportedLeadEmpty = (lead: ReturnType<typeof normalizeImportedLead>) =>
  !lead.telefone && !lead.nome && !lead.cidade && !lead.qualificacao;

const getRowsFromBody = (body: Record<string, unknown>) => {
  const rows = body.rows ?? body.leads ?? body.items;
  if (Array.isArray(rows)) {
    return rows
      .filter((row): row is Record<string, unknown> =>
        row !== null && typeof row === "object" && !Array.isArray(row)
      )
      .map((row) => ({ ...row }));
  }

  const nested = body.row ?? body.lead ?? body.data ?? body.dados;
  if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
    return [{ ...(nested as Record<string, unknown>) }];
  }

  return [{ ...body }];
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed");
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const url = new URL(req.url);
    const clientId = normalizeClientId(
      body.client_id ?? body.clientId ?? url.searchParams.get("client_id") ??
        url.searchParams.get("clientId"),
    );

    if (!clientId) {
      return errorResponse(400, "Missing required field: client_id");
    }

    const supabaseUrl = getEnv("SUPABASE_URL", "URL");
    const serviceRoleKey = getEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      "SERVICE_ROLE_KEY",
    );

    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse(
        500,
        "Missing Supabase secrets",
        "Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: settings, error: settingsError } = await supabase
      .from("lead_client_n8n_settings")
      .select("inbound_bearer_token, active")
      .eq("client_id", clientId)
      .maybeSingle();

    if (settingsError) {
      return errorResponse(
        500,
        "Failed to load n8n settings",
        settingsError.message,
      );
    }

    const token = getBearerTokenFromRequest(req);
    if (
      !settings?.active ||
      !settings.inbound_bearer_token ||
      token !== settings.inbound_bearer_token
    ) {
      return errorResponse(401, "Unauthorized");
    }

    const rows = getRowsFromBody(body);

    if (rows.length === 0) {
      return errorResponse(400, "rows must contain at least one item");
    }

    if (rows.length > 5000) {
      return errorResponse(413, "Maximum 5000 rows per request");
    }

    const parsedItems = rows.map((row, index) => {
      const rowWithPhone = {
        ...row,
        telefone: row.telefone ?? row.numero ?? body.telefone ?? body.numero,
        status_conversa: row.status_conversa ?? row.statusConversa ??
          body.status_conversa ?? body.statusConversa,
        ultima_interacao_bot: row.ultima_interacao_bot ??
          row.ultimaInteracaoBot ?? body.ultima_interacao_bot ??
          body.ultimaInteracaoBot,
        ultima_interacao_usuario: row.ultima_interacao_usuario ??
          row.ultimaInteracaoUsuario ?? body.ultima_interacao_usuario ??
          body.ultimaInteracaoUsuario,
      };
      const normalized = normalizeImportedLead(rowWithPhone, clientId);
      const imported = !!normalized.telefone;
      const skipReason = imported
        ? null
        : isImportedLeadEmpty(normalized)
        ? "Linha vazia ou sem dados aproveitaveis"
        : "Telefone ausente ou invalido";

      return {
        rowNumber: index + 2,
        rawData: rowWithPhone,
        normalized,
        imported,
        skipReason,
      };
    });

    const invalidStatus = parsedItems.find((item) =>
      item.normalized.status_conversa === "__invalid__"
    );
    if (invalidStatus) {
      return errorResponse(
        400,
        "Invalid status_conversa",
        "Use aguardando_usuario, em_atendimento or finalizado",
      );
    }

    const validPhones = new Set<string>();
    const normalizedByPhone = new Map<
      string,
      ReturnType<typeof normalizeImportedLead>
    >();
    for (const item of parsedItems) {
      if (item.normalized.telefone) {
        validPhones.add(item.normalized.telefone);
        normalizedByPhone.set(item.normalized.telefone, item.normalized);
      }
    }

    const validPhoneList = Array.from(validPhones);
    let existingItems: Array<{
      id: string;
      import_id: string;
      telefone: string | null;
      normalized_data: Record<string, unknown> | null;
    }> = [];

    if (validPhoneList.length > 0) {
      const { data: matchedItems, error: existingItemsError } = await supabase
        .from("lead_import_items")
        .select("id, import_id, telefone, normalized_data")
        .eq("client_id", clientId)
        .in("telefone", validPhoneList);

      if (existingItemsError) {
        return errorResponse(
          500,
          "Failed to find matching spreadsheet rows",
          existingItemsError.message,
        );
      }

      existingItems = matchedItems ?? [];
    }

    const now = new Date().toISOString();
    const leadPayloads = Array.from(
      new Map(
        parsedItems
          .filter((item) => item.imported && item.normalized.telefone)
          .map((item) => {
            const normalized = item.normalized;
            const payload: Record<string, unknown> = {
              client_id: clientId,
              telefone: normalized.telefone,
              updated_at: now,
            };

            for (
              const key of [
                "nome",
                "tipo_cliente",
                "faixa_consumo",
                "cidade",
                "estado",
                "status",
                "data_hora",
                "qualificacao",
                "status_conversa",
                "ultima_interacao_bot",
                "ultima_interacao_usuario",
              ]
            ) {
              const value = normalized[key as keyof typeof normalized];
              if (value !== null && value !== undefined && value !== "") {
                payload[key] = value;
              }
            }

            return [normalized.telefone, payload] as const;
          }),
      ).values(),
    );

    const leadIdsByPhone = new Map<string, string>();
    if (leadPayloads.length > 0) {
      const { data: upsertedLeads, error: leadsError } = await supabase
        .from("leads")
        .upsert(leadPayloads, {
          onConflict: "client_id,telefone",
          ignoreDuplicates: false,
        })
        .select("id, telefone");

      if (leadsError) {
        return errorResponse(
          500,
          "Failed to save leads",
          leadsError.message,
        );
      }

      for (const lead of upsertedLeads ?? []) {
        if (lead.telefone && lead.id) {
          leadIdsByPhone.set(lead.telefone, lead.id);
        }
      }
    }

    const spreadsheetItems: Array<Record<string, unknown>> = [];
    if (existingItems.length > 0) {
      const updateResults = await Promise.all(
        existingItems.map((item) => {
          const telefone = sanitizePhone(item.telefone);
          const normalized = telefone ? normalizedByPhone.get(telefone) : null;
          const currentData =
            item.normalized_data && typeof item.normalized_data === "object"
              ? item.normalized_data
              : {};
          const updatePayload: Record<string, unknown> = {
            telefone,
            lead_id: telefone ? leadIdsByPhone.get(telefone) ?? null : null,
            imported: !!telefone,
            skip_reason: telefone ? null : "Telefone ausente ou invalido",
            normalized_data: normalized
              ? { ...currentData, ...normalized, telefone }
              : currentData,
          };

          if (normalized?.status_conversa) {
            updatePayload.status_conversa = normalized.status_conversa;
          }
          if (normalized?.ultima_interacao_bot) {
            updatePayload.ultima_interacao_bot =
              normalized.ultima_interacao_bot;
          }
          if (normalized?.ultima_interacao_usuario) {
            updatePayload.ultima_interacao_usuario =
              normalized.ultima_interacao_usuario;
          }

          return supabase
            .from("lead_import_items")
            .update(updatePayload)
            .eq("id", item.id)
            .select(
              "id, row_number, telefone, imported, skip_reason, status_conversa, ultima_interacao_bot, ultima_interacao_usuario",
            )
            .single();
        }),
      );

      const failedUpdate = updateResults.find((result) => result.error);
      if (failedUpdate?.error) {
        return errorResponse(
          500,
          "Failed to update matching spreadsheet rows",
          failedUpdate.error.message,
        );
      }

      for (const result of updateResults) {
        if (result.data) spreadsheetItems.push(result.data);
      }
    }

    return jsonResponse(
      {
        success: true,
        client_id: clientId,
        total_rows: parsedItems.length,
        valid_phones: validPhones.size,
        skipped_rows: parsedItems.length - validPhones.size,
        leads_saved: leadIdsByPhone.size,
        matched_spreadsheet_rows: spreadsheetItems.length,
        phones: validPhoneList,
        items: spreadsheetItems,
      },
      200,
    );
  } catch (error) {
    console.error("n8n-planilha-webhook error:", error);
    return errorResponse(500, "Internal server error");
  }
});
