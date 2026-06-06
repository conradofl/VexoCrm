import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const getEnv = (primary: string, fallback?: string): string | null => {
  const value = Deno.env.get(primary);
  if (value) return value;
  if (!fallback) return null;
  return Deno.env.get(fallback);
};

const getExpectedBearerToken = (): string | null =>
  getEnv("EDGE_FUNCTION_BEARER_TOKEN", "BEARER_TOKEN");

const getBearerTokenFromRequest = (req: Request): string | null => {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
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

const normalizeInteger = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }

  const normalized = normalizeString(value);
  if (!normalized || !/^\d+$/.test(normalized)) return null;

  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) ? parsed : null;
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

const parseJsonBody = async (req: Request): Promise<Record<string, unknown>> => {
  try {
    return await req.json();
  } catch {
    throw new Error("INVALID_JSON_BODY");
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const expectedBearerToken = getExpectedBearerToken();
    if (!expectedBearerToken) {
      return errorResponse(
        500,
        "Missing bearer token",
        "Configure EDGE_FUNCTION_BEARER_TOKEN",
      );
    }

    const token = getBearerTokenFromRequest(req);
    if (token !== expectedBearerToken) {
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

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (req.method === "GET") {
      const url = new URL(req.url);
      const telefone = sanitizePhone(url.searchParams.get("telefone"));

      if (!telefone) {
        return errorResponse(400, "Missing required query param: telefone");
      }

      const { data, error } = await supabase
        .from("lead_conversations")
        .select(
          "id, telefone, conversation_compressed, tamanho_original, unknown_lead, created_at",
        )
        .eq("telefone", telefone)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        console.error("conversation-memory select error:", {
          telefone,
          message: error.message,
          code: error.code ?? null,
        });
        return jsonResponse(
          {
            success: false,
            error: "Failed to load conversation",
            details: error.message,
            code: error.code ?? null,
          },
          500,
        );
      }

      const latest = data?.[0] ?? null;

      return jsonResponse(
        latest
          ? {
              success: true,
              found: true,
              telefone,
              conversation: latest,
              latestConversation: latest,
              id: latest.id,
              conversation_compressed: latest.conversation_compressed,
              tamanho_original: latest.tamanho_original,
              unknown_lead: latest.unknown_lead,
              created_at: latest.created_at,
            }
          : {
              success: true,
              found: false,
              telefone,
              conversation: null,
              latestConversation: null,
            },
      );
    }

    if (req.method !== "POST") {
      return errorResponse(405, "Method not allowed");
    }

    const body = await parseJsonBody(req);
    const telefone = sanitizePhone(body.telefone);
    const conversationCompressed = normalizeString(body.conversation_compressed);
    const tamanhoOriginal = normalizeInteger(body.tamanho_original);
    const timestamp = normalizeString(body.timestamp);

    if (!telefone || !conversationCompressed || tamanhoOriginal === null || !timestamp) {
      return errorResponse(
        400,
        "Missing required fields: telefone, conversation_compressed, tamanho_original, timestamp",
      );
    }

    if (tamanhoOriginal < 0) {
      return errorResponse(
        400,
        "tamanho_original must be an integer greater than or equal to 0",
      );
    }

    const parsedTimestamp = new Date(timestamp);
    if (Number.isNaN(parsedTimestamp.getTime())) {
      return errorResponse(400, "timestamp must be a valid ISO date");
    }

    const { error } = await supabase.from("lead_conversations").insert({
      telefone,
      conversation_compressed: conversationCompressed,
      tamanho_original: tamanhoOriginal,
      created_at: parsedTimestamp.toISOString(),
    });

    if (error) {
      console.error("conversation-memory insert error:", {
        telefone,
        message: error.message,
        code: error.code ?? null,
      });
      return jsonResponse(
        {
          success: false,
          error: "Failed to save conversation",
          details: error.message,
          code: error.code ?? null,
        },
        500,
      );
    }

    return jsonResponse({
      success: true,
      message: "Conversation stored",
      telefone,
      created_at: parsedTimestamp.toISOString(),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON_BODY") {
      return errorResponse(400, "Invalid JSON body");
    }

    console.error("conversation-memory error:", err);
    return errorResponse(500, "Internal server error");
  }
});
