import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

  if (req.method !== "GET") {
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
    return errorResponse(500, "Missing Supabase secrets",
      "Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  const url = new URL(req.url);
  const clientId   = url.searchParams.get("clientId")  || null;
  const importId   = url.searchParams.get("importId")  || null;
  const campaignId = url.searchParams.get("campaignId") || null;
  const rawLimit   = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit      = !isNaN(rawLimit) && rawLimit > 0 ? rawLimit : null;

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let query = supabase
      .from("lead_import_items")
      .select("id, import_id, client_id, telefone, normalized_data, created_at")
      .eq("imported", true)
      .not("telefone", "is", null)
      .order("created_at", { ascending: false });

    if (clientId) query = query.eq("client_id", clientId);
    if (importId) query = query.eq("import_id", importId);
    if (limit)    query = query.limit(limit);

    const { data, error: selectError } = await query;

    if (selectError) {
      console.error("get-leads-disparo select error:", selectError);
      return errorResponse(500, "Failed to fetch leads", selectError.message);
    }

    if (!data || data.length === 0) {
      return jsonResponse({ success: true, total: 0, leads: [], campaignId });
    }

    const seen = new Set<string>();
    const leads: unknown[] = [];

    for (const item of data) {
      const nd = item.normalized_data && typeof item.normalized_data === "object"
        ? item.normalized_data as Record<string, unknown>
        : {};

      const telefone = item.telefone?.toString().replace(/\D/g, "") ?? null;
      if (!telefone || seen.has(telefone)) continue;
      seen.add(telefone);

      leads.push({
        id: item.id,
        import_id: item.import_id,
        client_id: item.client_id,
        telefone,
        nome:          nd.nome          ?? null,
        cidade:        nd.cidade        ?? null,
        estado:        nd.estado        ?? null,
        status:        nd.status        ?? null,
        tipo_cliente:  nd.tipo_cliente  ?? null,
        faixa_consumo: nd.faixa_consumo ?? null,
        qualificacao:  nd.qualificacao  ?? null,
        created_at: item.created_at,
      });
    }

    return jsonResponse({ success: true, total: leads.length, leads, campaignId });
  } catch (err) {
    console.error("get-leads-disparo error:", err);
    return errorResponse(500, "Internal server error");
  }
});
