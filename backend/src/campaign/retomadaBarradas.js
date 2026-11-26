// Retomada das respostas barradas (26/11/2026, decisão do Conrado: "opção 2").
//
// De 15 a 20/11 a Evolution entregou respostas de lead com horas de atraso; o portão de idade (services/inboundAge.js)
// barrou 152 ("Chegou atrasada") e a próxima etapa da campanha nunca saiu — a passagem de bastão não aconteceu
// (Advocacia Almeida, Tinge, Container LED). Desde 21/11 nenhuma resposta chega atrasada (/health inboundDelay).
//
// Duas partes: (1) classificar e contar (/health, sem enviar); (2) o envio, aos poucos e uma vez por lead (fim do arquivo).
// Classificação:
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
  if (resultado) return { ...resultado, envio: getBarredRetakeSendStatus() };
  if (!pool) return { medido: false, motivo: "sem banco" };
  if (!emAndamento) {
    emAndamento = classifyBarredReplies(pool)
      .then((r) => { resultado = { medido: true, medidoEm: new Date().toISOString(), modo: "contagem_no_boot", total: r.total, porEmpresa: r.porEmpresa }; })
      .catch((err) => { resultado = { medido: false, erro: String(err?.code || err?.message || err).slice(0, 120) }; });
  }
  return { medido: false, emAndamento: true };
}

export function _resetBarredRetakeStatusForTesting() {
  resultado = null;
  emAndamento = null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// ENVIO (2ª parte, 26/11/2026): a etapa pendente sai AOS POUCOS e UMA vez por lead.
//   - um lead por ciclo (a cada 3 min), só dentro da janela de envio da empresa (mesmo com o agente liberado para
//     responder fora dela), pelo mesmo caminho de quando o lead responde (continueCampaignLeadFromReply: chip da
//     conversa, cota do chip, trava de etapa já enviada, opt-out);
//   - cada resposta barrada é marcada em lead_messages.meta (retomada_em, retomada_resultado) quando o caso se resolve
//     (enviada, já atendida, opt-out, sem etapa pendente, recusa do motor, erro) e sai da lista. Adiamento (cota do
//     chip, outra resposta em andamento) NÃO marca: tenta de novo no próximo ciclo;
//   - RETOMADA_BARRADAS_DESLIGADA=1 desliga sem deploy.
import { continueCampaignLeadFromReply as continueReal } from "./dispatch.js";
import { getLeadClientN8nSettings as getSettingsReal } from "../services/n8nSettings.js";
import { isWithinSendWindow, resolveSendWindowConfig } from "../services/sendWindow.js";

export const RETOMADA_INTERVALO_MS = 3 * 60 * 1000;
const ADIAMENTOS = new Set(["chip_quota_exhausted", "concurrent_reply_in_progress", "opt_out_check_failed", "OUTSIDE_SEND_WINDOW", "SEND_SETTINGS_UNREADABLE"]);
const MAX_ANALISES_POR_CICLO = 25;

const estadoEnvio = { ligado: false, ciclos: 0, enviadas: 0, resolvidasSemEnvio: 0, adiadas: 0, ultimoCicloEm: null, ultimoResultado: null };
export function getBarredRetakeSendStatus() {
  return { ...estadoEnvio };
}

// Marca TODAS as respostas barradas do mesmo lead (empresa + número em qualquer grafia) no período: sem isso a
// resposta barrada mais antiga do mesmo lead voltava para a fila no ciclo seguinte e o lead recebia de novo.
async function marcar(pool, linha, resultado) {
  await pool.query(
    `UPDATE public.lead_messages
        SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('retomada_em', now(), 'retomada_resultado', $3::text)
      WHERE client_id = $1
        AND direction = 'inbound'
        AND meta->>'agente_barrado' = 'mensagem_atrasada'
        AND meta->>'retomada_em' IS NULL
        AND created_at >= $4::timestamptz AND created_at < $5::timestamptz
        AND phone = ANY(${SQL_CANONICAL_PHONE_SPELLINGS(SQL_CANONICAL_PHONE("$2::text"))})`,
    [linha.client_id, linha.phone, String(resultado).slice(0, 80), RETOMADA_DESDE, RETOMADA_ATE]
  );
}

/** Um ciclo: resolve os casos sem envio que encontrar e tenta UM envio. */
export async function runBarredRetakeTick({
  pool,
  now = new Date(),
  continueReply = continueReal,
  findCampaignReplyMatches = findCampaignReplyMatchesReal,
  optedOut = isPhoneOptedOut,
  getSettings = getSettingsReal,
  env = process.env,
} = {}) {
  if (!pool) return { acao: "sem_banco" };
  if (env.RETOMADA_BARRADAS_DESLIGADA === "1") return { acao: "desligada" };
  const linhas = await listBarredReplies(pool);
  let analisadas = 0;
  for (const l of linhas) {
    if (analisadas >= MAX_ANALISES_POR_CICLO) break;
    analisadas += 1;
    if (l.atendida_depois) { await marcar(pool, l, "atendida_depois"); estadoEnvio.resolvidasSemEnvio += 1; continue; }
    if (await optedOut(pool, { clientId: l.client_id, phone: l.phone })) { await marcar(pool, l, "opt_out"); estadoEnvio.resolvidasSemEnvio += 1; continue; }
    let settings = null;
    try {
      settings = await getSettings(l.client_id);
    } catch {
      continue; // configuração ilegível: na dúvida, não envia (tenta no próximo ciclo)
    }
    if (!isWithinSendWindow(now, resolveSendWindowConfig(settings || {}))) continue; // fora da janela desta empresa
    const campanha = pickCampaignAwaitingReply(await findCampaignReplyMatches({ clientId: l.client_id, phone: l.phone }));
    if (!campanha) { await marcar(pool, l, "sem_etapa_pendente"); estadoEnvio.resolvidasSemEnvio += 1; continue; }

    let r;
    try {
      r = await continueReply({ clientId: l.client_id, phone: l.phone, repliedAt: new Date(l.message_timestamp || l.created_at).toISOString(), campaignMatch: campanha, replyPayload: {} });
    } catch (err) {
      await marcar(pool, l, `erro: ${err?.message || err}`);
      estadoEnvio.ultimoResultado = "erro";
      return { acao: "erro", clientId: l.client_id };
    }
    const motivo = r?.reason || null;
    if (r?.continued) {
      await marcar(pool, l, "enviada");
      estadoEnvio.enviadas += 1;
      estadoEnvio.ultimoResultado = "enviada";
      return { acao: "enviada", clientId: l.client_id, campaignId: campanha.id };
    }
    if (r?.held || ADIAMENTOS.has(motivo)) {
      estadoEnvio.adiadas += 1;
      estadoEnvio.ultimoResultado = `adiada: ${motivo}`;
      return { acao: "adiada", motivo, clientId: l.client_id };
    }
    await marcar(pool, l, motivo || "nao_continuou");
    estadoEnvio.resolvidasSemEnvio += 1;
    estadoEnvio.ultimoResultado = motivo || "nao_continuou";
    return { acao: "resolvida_sem_envio", motivo, clientId: l.client_id };
  }
  return { acao: linhas.length === 0 ? "nada_pendente" : "nada_nesta_janela" };
}

let _timer = null;
export function startBarredRetakeScheduler({ pool, intervalMs = RETOMADA_INTERVALO_MS } = {}) {
  if (_timer || !pool) return;
  estadoEnvio.ligado = true;
  _timer = setInterval(async () => {
    estadoEnvio.ciclos += 1;
    estadoEnvio.ultimoCicloEm = new Date().toISOString();
    try {
      const r = await runBarredRetakeTick({ pool });
      if (r.acao !== "nada_pendente" && r.acao !== "nada_nesta_janela") console.log("[retomada-barradas] ciclo", r);
    } catch (err) {
      console.error("[retomada-barradas] ciclo falhou:", err?.message || err);
    }
  }, intervalMs);
  if (_timer?.unref) _timer.unref();
}

export function stopBarredRetakeScheduler() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  estadoEnvio.ligado = false;
}
