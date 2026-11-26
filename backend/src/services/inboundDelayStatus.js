// Medição (26/11/2026): o lead responde à campanha, a Evolution entrega a resposta com horas de atraso, o portão de
// idade (services/inboundAge.js, 17/11) barra ("Chegou atrasada") e a próxima etapa nunca sai — a passagem de bastão não
// acontece. Antes de mexer na regra, o /health diz se o atraso da Evolution ainda existe, por dia e por empresa:
//   recebidas, atrasadas (chegada − hora real > 30 min), barradas (meta.agente_barrado = mensagem_atrasada) e o atraso
//   mediano em minutos. Só contagens. Calculado uma vez por processo, em segundo plano (READ ONLY, limite de 60 s).
export const SQL_ATRASO_ENTRADA = `
  SELECT client_id,
         to_char(date_trunc('day', created_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS dia,
         count(*)::int AS recebidas,
         count(*) FILTER (WHERE message_timestamp IS NOT NULL AND created_at - message_timestamp > interval '30 minutes')::int AS atrasadas,
         count(*) FILTER (WHERE meta->>'agente_barrado' = 'mensagem_atrasada')::int AS barradas,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (created_at - message_timestamp)) / 60))::numeric, 1)::float AS atraso_mediano_min
    FROM public.lead_messages
   WHERE direction = 'inbound'
     AND created_at >= $1::timestamptz
     AND message_timestamp IS NOT NULL
   GROUP BY 1, 2
   ORDER BY 2, 1
`;

async function rodarComLimite(pool, sql, params) {
  if (typeof pool.connect === "function") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = 60000");
      const r = await client.query(sql, params);
      await client.query("COMMIT");
      return r.rows;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  return (await pool.query(sql, params)).rows;
}

export async function measureInboundDelay(pool, desde = "2026-11-15T00:00:00-03:00") {
  const rows = await rodarComLimite(pool, SQL_ATRASO_ENTRADA, [desde]);
  const porDia = {};
  for (const r of rows) {
    const d = (porDia[r.dia] ||= { recebidas: 0, atrasadas: 0, barradas: 0, empresasComAtraso: {} });
    d.recebidas += r.recebidas;
    d.atrasadas += r.atrasadas;
    d.barradas += r.barradas;
    if (r.atrasadas > 0 || r.barradas > 0) {
      d.empresasComAtraso[r.client_id] = { recebidas: r.recebidas, atrasadas: r.atrasadas, barradas: r.barradas, atrasoMedianoMin: r.atraso_mediano_min };
    }
  }
  return { medido: true, medidoEm: new Date().toISOString(), desde, porDia };
}

let resultado = null;
let emAndamento = null;

export function getInboundDelayStatus(pool) {
  if (resultado) return resultado;
  if (!pool) return { medido: false, motivo: "sem banco" };
  if (!emAndamento) {
    emAndamento = measureInboundDelay(pool)
      .then((r) => { resultado = r; })
      .catch((err) => { resultado = { medido: false, erro: String(err?.code || err?.message || err).slice(0, 120) }; });
  }
  return { medido: false, emAndamento: true };
}

export function _resetInboundDelayStatusForTesting() {
  resultado = null;
  emAndamento = null;
}
