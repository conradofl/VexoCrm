import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.30.0";

const cabecalhosCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TOKEN_BEARER_ESPERADO = "@Vexo2026";

const obterEnv = (principal: string, alternativa?: string): string | null => {
  const valor = Deno.env.get(principal);
  if (valor) return valor;
  if (!alternativa) return null;
  return Deno.env.get(alternativa) ?? null;
};

const normalizarTexto = (valor: unknown): string | null => {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  if (!texto) return null;
  return texto.startsWith("=") ? texto.slice(1).trim() : texto;
};

const sanitizarTelefone = (valor: unknown): string | null => {
  const telefoneNormalizado = normalizarTexto(valor);
  if (!telefoneNormalizado) return null;

  const somenteDigitos = telefoneNormalizado.replace(/\D/g, "");
  return somenteDigitos || null;
};

const obterQualificacaoComoBooleano = (valor: unknown): boolean => {
  if (typeof valor === "boolean") return valor;

  const textoNormalizado = normalizarTexto(valor)?.toLowerCase();
  return textoNormalizado === "true";
};

const respostaJson = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...cabecalhosCors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });

const respostaErro = (status: number, erro: string, detalhes?: string) =>
  respostaJson(
    detalhes ? { success: false, error: erro, details: detalhes } : {
      success: false,
      error: erro,
    },
    status,
  );

console.info("conversation-memory-latest started");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cabecalhosCors });
  }

  if (req.method !== "GET") {
    return respostaErro(405, "Method not allowed");
  }

  try {
    const headerAutorizacao =
      req.headers.get("authorization") ?? req.headers.get("Authorization");

    if (headerAutorizacao !== `Bearer ${TOKEN_BEARER_ESPERADO}`) {
      return respostaErro(401, "Unauthorized");
    }

    const url = new URL(req.url);
    const telefone = sanitizarTelefone(url.searchParams.get("telefone"));

    if (!telefone) {
      return respostaErro(400, "Missing required query param: telefone");
    }

    const supabaseUrl = obterEnv("SUPABASE_URL", "URL");
    const serviceRoleKey = obterEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      "SERVICE_ROLE_KEY",
    );

    if (!supabaseUrl || !serviceRoleKey) {
      return respostaErro(
        500,
        "Missing Supabase secrets",
        "Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
      global: { headers: { "x-upsert": "true" } },
    });

    const [resultadoLeads, resultadoConversa] = await Promise.all([
      supabase
        .from("leads")
        .select("telefone, qualificacao")
        .eq("telefone", telefone)
        .limit(1),
      supabase
        .from("lead_conversations")
        .select(
          "id, telefone, conversation_compressed, tamanho_original, unknown_lead, created_at",
        )
        .eq("telefone", telefone)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    if (resultadoLeads.error) {
      console.error("conversation-memory-latest leads error:", {
        telefone,
        message: resultadoLeads.error.message,
        code: (resultadoLeads.error as { code?: string }).code ?? null,
      });

      return respostaJson(
        {
          success: false,
          error: "Failed to query leads table",
          details: resultadoLeads.error.message,
          code: (resultadoLeads.error as { code?: string }).code ?? null,
        },
        500,
      );
    }

    if (resultadoConversa.error) {
      console.error("conversation-memory-latest conversation error:", {
        telefone,
        message: resultadoConversa.error.message,
        code: (resultadoConversa.error as { code?: string }).code ?? null,
      });

      return respostaJson(
        {
          success: false,
          error: "Failed to load conversation",
          details: resultadoConversa.error.message,
          code: (resultadoConversa.error as { code?: string }).code ?? null,
        },
        500,
      );
    }

    const leadExiste = (resultadoLeads.data?.length ?? 0) > 0;

    const conversaMaisRecente = resultadoConversa.data?.[0] ?? null;

    const leadQualificado = obterQualificacaoComoBooleano(
      resultadoLeads.data?.[0]?.qualificacao,
    );

    const encontrado = leadExiste && conversaMaisRecente !== null;

    return respostaJson(
      encontrado
        ? {
            success: true,
            found: true,
            telefone,
            conversation: conversaMaisRecente,
            latestConversation: conversaMaisRecente,
            id: conversaMaisRecente.id,
            conversation_compressed:
              conversaMaisRecente.conversation_compressed,
            tamanho_original: conversaMaisRecente.tamanho_original,
            unknown_lead: conversaMaisRecente.unknown_lead,
            created_at: conversaMaisRecente.created_at,
            qualificacao: leadQualificado,
          }
        : {
            success: true,
            found: false,
            telefone,
            conversation: null,
            latestConversation: null,
            qualificacao: leadQualificado,
          },
    );
  } catch (erro) {
    console.error("conversation-memory-latest error:", erro);
    return respostaErro(500, "Internal server error");
  }
});
