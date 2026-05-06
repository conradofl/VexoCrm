import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EXPECTED_BEARER_TOKEN = "@Vexo2026";
const SKIP_REASON = "disparo_realizado";

const getEnv = (primary: string, fallback?: string): string | null => {
  const value = Deno.env.get(primary);
  if (value) return value;
  if (!fallback) return null;
  return Deno.env.get(fallback);
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed");
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (token !== EXPECTED_BEARER_TOKEN) {
    return errorResponse(401, "Unauthorized");
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

  try {
    const body = await req.json();
    const telefone = String(body.telefone || "").replace(/\D/g, "");

    if (!telefone) {
      return errorResponse(400, "Missing required field: telefone");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error: updateError } = await supabase
      .from("lead_import_items")
      .update({ skip_reason: SKIP_REASON })
      .eq("telefone", telefone)
      .is("skip_reason", null)
      .select("id")
      .single();

    if (updateError) {
      console.error("mark-lead-dispatched update error:", updateError);
      return errorResponse(500, "Failed to mark lead as dispatched", updateError.message);
    }

    return jsonResponse({
      success: true,
      operation: "marked_dispatched",
      id: data.id,
      telefone,
      skip_reason: SKIP_REASON,
    });
  } catch (err) {
    console.error("mark-lead-dispatched error:", err);
    return errorResponse(500, "Internal server error");
  }
});
