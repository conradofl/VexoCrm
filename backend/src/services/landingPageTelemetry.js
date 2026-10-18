// backend/src/services/landingPageTelemetry.js
// Serviço de Telemetria Comportamental e Conformidade LGPD das Páginas de Captação
// Multi-tenant: grava e filtra estritamente por client_id.

export const VALID_TELEMETRY_EVENT_TYPES = new Set([
  "page_view",
  "scroll_depth",
  "section_view",
  "element_click",
  "form_open",
  "field_abandoned",
  "form_submit",
]);

/**
 * Validador puro de conformidade LGPD para ingestão de eventos de telemetria.
 * Regra jurídica inegociável: rastreamento comportamental SÓ é permitido com aceite ativo.
 * @param {object} session
 * @param {boolean} session.consent_given
 * @param {object} event
 * @param {string} event.event_type
 * @returns {{ allowed: boolean, error?: string, message?: string }}
 */
export function validateTelemetryEventIngestion(session, event) {
  if (!session || !session.consent_given) {
    return {
      allowed: false,
      error: "CONSENTIMENTO_LGPD_OBRIGATORIO",
      message: "Rastreamento comportamental não autorizado pelo visitante.",
    };
  }

  if (!event || !event.event_type) {
    return {
      allowed: false,
      error: "EVENT_TYPE_OBRIGATORIO",
      message: "Tipo de evento é obrigatório.",
    };
  }

  if (!VALID_TELEMETRY_EVENT_TYPES.has(event.event_type)) {
    return {
      allowed: false,
      error: "EVENT_TYPE_INVALIDO",
      message: `Tipo de evento '${event.event_type}' não suportado.`,
    };
  }

  return { allowed: true };
}

/**
 * Ingestão de evento de telemetria no banco com validação estrita de consentimento LGPD.
 * @param {import("pg").Pool} pool
 * @param {object} params
 * @param {string} params.clientId
 * @param {string} params.sessionToken
 * @param {object} params.event
 * @returns {Promise<{ recorded: boolean, reason?: string, error?: string, message?: string }>}
 */
export async function ingestTelemetryEvent(pool, { clientId, sessionToken, event }) {
  if (!pool) {
    return { recorded: false, error: "DATABASE_UNAVAILABLE" };
  }

  if (!sessionToken || !clientId) {
    return {
      recorded: false,
      error: "DADOS_SESSAO_INCOMPLETOS",
      message: "session_token e client_id são obrigatórios.",
    };
  }

  // 1. Busca a sessão do visitante no banco
  const { rows } = await pool.query(
    `SELECT id, client_id, session_token, consent_given, lead_id
     FROM public.landing_page_sessions
     WHERE session_token = $1 AND client_id = $2
     LIMIT 1`,
    [sessionToken, clientId]
  ).catch((err) => {
    console.warn("[landingPageTelemetry] Erro ao buscar sessão:", err?.message || err);
    return { rows: [] };
  });

  const session = rows?.[0];
  if (!session) {
    return {
      recorded: false,
      error: "SESSAO_NAO_ENCONTRADA",
      message: "Sessão não encontrada para o tenant informado.",
    };
  }

  // 2. Validação LGPD obrigatória: se consent_given for false, RECUSA imediatamente
  const validation = validateTelemetryEventIngestion(session, event);
  if (!validation.allowed) {
    return {
      recorded: false,
      error: validation.error,
      message: validation.message,
    };
  }

  // 3. Grava o evento na tabela de telemetria
  try {
    await pool.query(
      `INSERT INTO public.landing_page_events (
         session_id, client_id, event_type, element_id, section_name, time_spent_seconds, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        session.id,
        clientId,
        event.event_type,
        event.element_id || null,
        event.section_name || null,
        Number(event.time_spent_seconds || 0),
        JSON.stringify(event.metadata || {}),
      ]
    );

    // Atualiza timestamp da última atividade da sessão
    await pool.query(
      `UPDATE public.landing_page_sessions
       SET last_activity_at = NOW()
       WHERE id = $1`,
      [session.id]
    ).catch(() => {});

    return { recorded: true };
  } catch (insertErr) {
    console.warn("[landingPageTelemetry] Erro ao inserir evento de telemetria:", insertErr?.message || insertErr);
    return { recorded: false, error: "FALHA_GRAVACAO_EVENTO" };
  }
}
