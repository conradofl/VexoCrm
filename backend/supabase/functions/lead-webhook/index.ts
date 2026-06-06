import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EXPECTED_BEARER_TOKEN = "@Vexo2026";

const getEnv = (primary: string, fallback?: string): string | null => {
  const value = Deno.env.get(primary);
  if (value) return value;
  if (!fallback) return null;
  return Deno.env.get(fallback);
};

const normalizeString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.startsWith("=") ? str.slice(1).trim() : str;
};

const sanitizePhone = (value: unknown): string | null => {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const digits = normalized.replace(/\D/g, "");
  return digits || null;
};

const normalizeDate = (value: unknown): string | null => {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
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

const findLeadByPhone = async (
  supabase: ReturnType<typeof createClient>,
  clientId: string,
  telefone: string,
) =>
  supabase
    .from("leads")
    .select("id, nome")
    .eq("client_id", clientId)
    .eq("telefone", telefone)
    .maybeSingle();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed");
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${EXPECTED_BEARER_TOKEN}`) {
      return errorResponse(401, "Unauthorized");
    }

    const body = await req.json();
    const action = normalizeString(body.action)?.toLowerCase();

    if (action !== "create" && action !== "finalize") {
      return errorResponse(400, "action must be either create or finalize");
    }

    const supabaseUrl = getEnv("SUPABASE_URL", "URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse(
        500,
        "Missing Supabase secrets",
        "Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      );
    }

    const clientId = normalizeString(body.client_id) ?? "infinie";
    const telefone = sanitizePhone(body.telefone);
    const nome = normalizeString(body.nome);
    const now = new Date().toISOString();

    if (!telefone) {
      return errorResponse(400, "Missing required field: telefone");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (action === "create") {
      const { data: existingLead, error: lookupError } = await findLeadByPhone(
        supabase,
        clientId,
        telefone,
      );

      if (lookupError) {
        console.error("lead-webhook create lookup error:", lookupError);
        return errorResponse(500, "Failed to lookup lead", lookupError.message);
      }

      if (existingLead) {
        return jsonResponse({
          success: true,
          status: "ok",
          action,
          operation: "already_exists",
          id: existingLead.id,
          client_id: clientId,
          telefone,
        });
      }

      const createPayload = {
        client_id: clientId,
        telefone,
        nome,
        status: normalizeString(body.status) ?? "novo",
        data_hora: normalizeDate(body.data_hora) ?? now,
        created_at: now,
        updated_at: now,
      };

      const { data: insertedLead, error: insertError } = await supabase
        .from("leads")
        .insert(createPayload)
        .select("id")
        .single();

      if (insertError) {
        if (insertError.code === "23505") {
          const { data: duplicateLead, error: duplicateLookupError } =
            await findLeadByPhone(supabase, clientId, telefone);

          if (duplicateLookupError) {
            console.error(
              "lead-webhook create duplicate lookup error:",
              duplicateLookupError,
            );
            return errorResponse(
              500,
              "Failed to lookup duplicated lead",
              duplicateLookupError.message,
            );
          }

          return jsonResponse({
            success: true,
            status: "ok",
            action,
            operation: "already_exists",
            id: duplicateLead?.id ?? null,
            client_id: clientId,
            telefone,
          });
        }

        console.error("lead-webhook create insert error:", insertError);
        return errorResponse(500, "Failed to create lead", insertError.message);
      }

      return jsonResponse({
        success: true,
        status: "ok",
        action,
        operation: "created",
        id: insertedLead.id,
        client_id: clientId,
        telefone,
      });
    }

    const finalizePayload = {
      client_id: clientId,
      telefone,
      nome,
      tipo_cliente: normalizeString(body.tipo_cliente ?? body.perfil),
      faixa_consumo: normalizeString(body.faixa_consumo ?? body.consumo),
      cidade: normalizeString(body.cidade),
      estado: normalizeString(body.estado),
      status: normalizeString(body.status) ?? "qualificado",
      data_hora: normalizeDate(body.data_hora) ?? now,
      qualificacao: normalizeString(body.qualificacao),
      updated_at: now,
    };

    const { data: finalizedLead, error: finalizeError } = await supabase
      .from("leads")
      .upsert(finalizePayload, {
        onConflict: "client_id,telefone",
        ignoreDuplicates: false,
      })
      .select("id")
      .single();

    if (finalizeError) {
      console.error("lead-webhook finalize error:", finalizeError);
      return errorResponse(500, "Failed to finalize lead", finalizeError.message);
    }

    return jsonResponse({
      success: true,
      status: "ok",
      action,
      operation: "upserted",
      id: finalizedLead.id,
      client_id: clientId,
      telefone,
    });
  } catch (err) {
    console.error("lead-webhook error:", err);
    return errorResponse(500, "Internal server error");
  }
});
