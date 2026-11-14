// backend/src/services/dashboardAnalysis.js
//
// Dashboard — o que sobrou das medidas da Fase 1.5 depois que o painel anterior saiu (11/11/2026):
// fechamentos (lead_conversions ganhas) e as constantes que a Visão geral e a fila de Conversas usam.
// As medidas que só o painel anterior lia (classificação de leads, só o primeiro passo, perfil que
// converte, saúde da base e a regra antiga de primeira resposta humana) foram removidas com ele.

// "Esperando há muito": o mesmo limite na Visão geral e na fila de Conversas.
export const SLOW_FIRST_RESPONSE_HOURS = 3;
// Mesma lista de normalizeWonStatus (commercial-intelligence.js / analytics.js).
export const WON_CONVERSION_STATUSES = ["won", "closed_won", "convertido", "converted"];

const WON_SQL_LIST = WON_CONVERSION_STATUSES.map((s) => `'${s}'`).join(", ");

// Telefone canônico brasileiro válido: 55 + DDD (sem zero) + celular de 9 dígitos começando em 9
// OU fixo de 8 dígitos começando em 2–5. Número fabricado (DDD 00, "5500…") e LID (@lid) ficam de fora.
export const VALID_CANONICAL_PHONE_REGEX = "^55[1-9]{2}(9[0-9]{8}|[2-5][0-9]{7})$";

const iso = (d) => (d instanceof Date ? d.toISOString() : String(d));

// ── Disponibilidade das conversões (UMA verificação, consultada pelos blocos que dependem dela) ──
// Fechamentos lê lead_conversions. Tabela inexistente = "este cliente não usa o recurso" (não é erro):
// Fechamentos não se aplica. A regra mora AQUI, uma vez; quem decide é `conversionsAvailable` no contexto.
// Se a própria verificação falhar (conexão, permissão), devolve true: o dado é desconhecido, então
// os blocos rodam e falham à vista em vez de esconder o problema como "não usa".
export async function checkConversionsAvailable(pool) {
  try {
    const { rows } = await pool.query("SELECT to_regclass('public.lead_conversions') IS NOT NULL AS available");
    return rows[0]?.available !== false;
  } catch {
    return true;
  }
}

// ── Fechamentos ───────────────────────────────────────────────────────
// Sem a tabela de conversões (cliente não usa): null = "não se aplica" (nem zero, nem indisponível).
export async function measureClosings(pool, { clientId, currentStart, currentEnd, previousStart, previousEnd, conversionsAvailable = true }) {
  if (!conversionsAvailable) return null;
  const { rows } = await pool.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE COALESCE(c.closed_at, c.updated_at) >= $2 AND COALESCE(c.closed_at, c.updated_at) < $3)::int AS current_closings,
        COUNT(*) FILTER (WHERE COALESCE(c.closed_at, c.updated_at) >= $4 AND COALESCE(c.closed_at, c.updated_at) < $5)::int AS previous_closings
      FROM public.lead_conversions c
      WHERE c.client_id = $1
        AND lower(c.conversion_status) IN (${WON_SQL_LIST});
    `,
    [clientId, iso(currentStart), iso(currentEnd), iso(previousStart), iso(previousEnd)]
  );
  return { current: rows[0]?.current_closings || 0, previous: rows[0]?.previous_closings || 0 };
}
