// Alerta de chip conectado que recebe com atraso ou ficou mudo (19/11/2026).
//
// Em 19/11 quatro instâncias "open" entregavam mensagens com 8 a 37 h de atraso, em lotes de 50 em 50 min (Baileys rc.9
// sem ack do <status>, consertado no #275). A tela mostrava os chips como conectados e ninguém via o atraso.
//
// - ATRASADO: na última hora chegou pelo webhook ao menos uma mensagem de lead mais de 30 min depois da hora real
//   (created_at = chegada no Vexo; message_timestamp = hora real no WhatsApp).
// - MUDO: o chip não recebe nada há mais de 30 min, num horário em que costuma receber: recebeu nessa mesma hora
//   (fuso de São Paulo) em pelo menos 4 dos 7 dias anteriores. Horário quieto não alerta.
// Só conta mensagem de lead que chegou pelo webhook (meta.source = hardcoded-chat-webhook): a importada pelo
// sincronizar chega "atrasada" por definição. Chip caído ou inativo não entra: já aparece como caído na tela.
// Só leitura. Nada aqui envia mensagem nem muda configuração.

import { isChipConnectedByRecord } from "./inboxReplyChip.js";

export const ALERTA_CHIP_MIN = 30;
const JANELA_ATRASO_MIN = 60;
const DIAS_HISTORICO = 7;
const DIAS_MIN_COM_ENTRADA = 4;
const TZ = "America/Sao_Paulo";

export const SQL_ALERTAS_DE_CHIP = `
  SELECT
    instance_name,
    max(created_at) AS ultima_chegada,
    count(*) FILTER (
      WHERE created_at >= $3::timestamptz - make_interval(mins => $5)
        AND message_timestamp IS NOT NULL
        AND created_at - message_timestamp > make_interval(mins => $4)
    )::int AS atrasadas,
    max(EXTRACT(EPOCH FROM (created_at - message_timestamp))) FILTER (
      WHERE created_at >= $3::timestamptz - make_interval(mins => $5)
        AND message_timestamp IS NOT NULL
    ) AS maior_atraso_s,
    count(DISTINCT (created_at AT TIME ZONE '${TZ}')::date) FILTER (
      WHERE EXTRACT(HOUR FROM created_at AT TIME ZONE '${TZ}') = EXTRACT(HOUR FROM $3::timestamptz AT TIME ZONE '${TZ}')
        AND (created_at AT TIME ZONE '${TZ}')::date < ($3::timestamptz AT TIME ZONE '${TZ}')::date
    )::int AS dias_nesta_hora
  FROM public.lead_messages
  WHERE client_id = $1
    AND instance_name = ANY($2::text[])
    AND direction = 'inbound'
    AND COALESCE(is_group, false) = false
    AND meta->>'source' = 'hardcoded-chat-webhook'
    AND created_at >= $3::timestamptz - make_interval(days => $6)
    AND created_at <= $3::timestamptz
  GROUP BY instance_name
`;

const toIso = (v) => (v ? new Date(v).toISOString() : null);

/**
 * Alertas dos chips conectados de uma empresa.
 * chips: cadastro das instâncias ({ name, active, connection_state }).
 * Devolve { alertas: [{ instancia, tipo: "atrasado" | "mudo", ... }], limiteMin, verificadoEm }.
 */
export async function listarAlertasDeChip(pool, clientId, { chips = [], agora = new Date() } = {}) {
  const verificadoEm = agora.toISOString();
  const nomes = [...new Set((chips || []).filter(isChipConnectedByRecord).map((c) => c?.name).filter(Boolean))];
  if (!pool || !clientId || nomes.length === 0) return { alertas: [], limiteMin: ALERTA_CHIP_MIN, verificadoEm };

  const { rows } = await pool.query(SQL_ALERTAS_DE_CHIP, [
    clientId, nomes, verificadoEm, ALERTA_CHIP_MIN, JANELA_ATRASO_MIN, DIAS_HISTORICO,
  ]);
  const porChip = new Map(rows.map((r) => [r.instance_name, r]));

  const alertas = [];
  for (const instancia of nomes) {
    const r = porChip.get(instancia);
    if (!r || !r.ultima_chegada) continue;
    const ultimaChegada = toIso(r.ultima_chegada);
    if (Number(r.atrasadas) > 0) {
      alertas.push({
        instancia,
        tipo: "atrasado",
        mensagensAtrasadas: Number(r.atrasadas),
        maiorAtrasoMin: Math.round(Number(r.maior_atraso_s || 0) / 60),
        ultimaChegada,
      });
      continue;
    }
    const minutosSemReceber = Math.floor((agora.getTime() - new Date(r.ultima_chegada).getTime()) / 60_000);
    if (minutosSemReceber > ALERTA_CHIP_MIN && Number(r.dias_nesta_hora) >= DIAS_MIN_COM_ENTRADA) {
      alertas.push({
        instancia,
        tipo: "mudo",
        minutosSemReceber,
        diasComEntradaNestaHora: Number(r.dias_nesta_hora),
        ultimaChegada,
      });
    }
  }
  return { alertas, limiteMin: ALERTA_CHIP_MIN, verificadoEm };
}
