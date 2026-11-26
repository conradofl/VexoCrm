// Retomada das respostas barradas (26/11/2026, decisão do Conrado: "opção 2").
//
// De 15 a 20/11 a Evolution entregou respostas de lead com horas de atraso; o portão de idade (services/inboundAge.js)
// barrou 152 ("Chegou atrasada") e a próxima etapa da campanha nunca saiu — a passagem de bastão não aconteceu
// (Advocacia Almeida, Tinge, Container LED). Desde 21/11 nenhuma resposta chega atrasada (/health inboundDelay).
//
// ESTE MÓDULO, NESTA VERSÃO, NÃO ENVIA NADA: só classifica cada resposta barrada e conta por empresa, para o Conrado
// ver o número antes de liberar o envio (que vem em outro PR, aos poucos e uma vez por lead):
//   - atendidaDepois:  já saiu mensagem para o lead depois da resposta barrada (equipe ou robô): não mexe;
//   - optOut:          pediu para sair;
//   - semEtapaPendente: nenhuma campanha esperando a resposta dele com próximo passo (a MESMA regra do webhook,
//                       campaign/replyRouting.js) — já avançou por outro caminho, terminou, pausou;
//   - elegiveis:       tem etapa pendente e ninguém falou com ele depois.
import { SQL_CANONICAL_PHONE, SQL_CANONICAL_PHONE_SPELLINGS } from "../services/canonicalPhone.js";
import { isPhoneOptedOut } from "../services/optOut.js";
import { findCampaignReplyMatches as findCampaignReplyMatchesReal } from "./dispatch.js";
import { pickCampaignAwaitingReply } from "./replyRouting.js";

export const RETOMADA_DESDE = "2026-11-15T00:00:00-03:00";
export const RETOMADA_ATE = "2026-11-21T00:00:00-03:00";

// A última resposta barrada de cada lead no período, e se já saiu mensagem para ele depois dela.
export const SQL_RESPOSTAS_BARRADAS = `
  WITH barradas AS (
    SELECT DISTINCT ON (client_id, ${SQL_CANONICAL_PHONE("phone")})
           id, client_id, phone, wa_message_id, message_timestamp, created_at,
           ${SQL_CANONICAL_PHONE("phone")} AS canon
      FROM public.lead_messages
     WHERE direction = 'inbound'
       AND meta->>'agente_barrado' = 'mensagem_atrasada'
       AND meta->>'retomada_em' IS NULL
       AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
     ORDER BY client_id, ${SQL_CANONICAL_PHONE("phone")}, created_at DESC
  )
  SELECT b.id, b.client_id, b.phone, b.wa_message_id, b.message_timestamp, b.created_at,
         EXISTS (
           SELECT 1 FROM public.lead_messages o
            WHERE o.client_id = b.client_id
              AND o.direction = 'outbound'
              AND o.phone = ANY(${SQL_CANONICAL_PHONE_SPELLINGS("b.canon")})
              AND o.created_at > b.created_at
         ) AS atendida_depois
    FROM barradas b
   ORDER BY b.client_id, b.created_at
`;

export async function listBarredReplies(pool, { desde = RETOMADA_DESDE, ate = RETOMADA_ATE } = {}) {
  return (await pool.query(SQL_RESPOSTAS_BARRADAS, [desde, ate])).rows;
}

/**
 * Classifica cada resposta barrada. Não envia nada.
 * @returns {{ total, porEmpresa: Record<string, {barradas, atendidaDepois, optOut, semEtapaPendente, elegiveis}>, elegiveis: object[] }}
 */
export async function classifyBarredReplies(pool, { findCampaignReplyMatches = findCampaignReplyMatchesReal, optedOut = isPhoneOptedOut } = {}) {
  const linhas = await listBarredReplies(pool);
  const porEmpresa = {};
  const elegiveis = [];
  for (const l of linhas) {
    const e = (porEmpresa[l.client_id] ||= { barradas: 0, atendidaDepois: 0, optOut: 0, semEtapaPendente: 0, elegiveis: 0 });
    e.barradas += 1;
    if (l.atendida_depois) { e.atendidaDepois += 1; continue; }
    if (await optedOut(pool, { clientId: l.client_id, phone: l.phone })) { e.optOut += 1; continue; }
    const ctx = await findCampaignReplyMatches({ clientId: l.client_id, phone: l.phone });
    const campanha = pickCampaignAwaitingReply(ctx);
    if (!campanha) { e.semEtapaPendente += 1; continue; }
    e.elegiveis += 1;
    elegiveis.push({ messageId: l.id, clientId: l.client_id, phone: l.phone, waMessageId: l.wa_message_id, repliedAt: l.message_timestamp, campaignId: campanha.id });
  }
  return { total: linhas.length, porEmpresa, elegiveis };
}

// /health: a classificação roda uma vez por processo, em segundo plano. Só contagens (o detalhe por lead não sai).
let resultado = null;
let emAndamento = null;

export function getBarredRetakeStatus(pool) {
  if (resultado) return resultado;
  if (!pool) return { medido: false, motivo: "sem banco" };
  if (!emAndamento) {
    emAndamento = classifyBarredReplies(pool)
      .then((r) => { resultado = { medido: true, medidoEm: new Date().toISOString(), modo: "so_contagem", total: r.total, porEmpresa: r.porEmpresa }; })
      .catch((err) => { resultado = { medido: false, erro: String(err?.code || err?.message || err).slice(0, 120) }; });
  }
  return { medido: false, emAndamento: true };
}

export function _resetBarredRetakeStatusForTesting() {
  resultado = null;
  emAndamento = null;
}
