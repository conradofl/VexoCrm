// Fila da etapa de campanha que chegou atrasada (26/11/2026, pedido do Conrado).
//
// O portão de idade (services/inboundAge.js) barra resposta de lead com mais de 30 min de idade REAL (a Evolution
// entregou com atraso — não é o lead que demorou: quem responde dois dias depois chega na hora). Para o AGENTE isso
// continua: nada de "Olá, tudo bem?" seis horas depois. Para a ETAPA DE CAMPANHA, descartar era pior: o lead respondeu e
// fica sem o próximo passo e sem a passagem de bastão (18-19/11, 152 respostas). Agora a etapa entra nesta fila e sai
// aos poucos:
//   - o webhook marca a resposta barrada: lead_messages.meta.etapa_atrasada = "pendente" (sem coluna nova);
//   - um ciclo a cada 3 min manda, só dentro da janela de envio da empresa, no máximo 5 por ciclo e 1 por empresa, pelo
//     mesmo caminho da resposta (continueCampaignLeadFromReply: chip da conversa, cota do chip, trava de etapa já
//     enviada, opt-out), com a campanha escolhida pela mesma regra do webhook (campaign/replyRouting.js);
//   - uma vez por lead: quando o caso se resolve, TODAS as respostas pendentes do lead (qualquer grafia) recebem o
//     resultado em meta.etapa_atrasada; adiamento (cota, resposta em andamento) não marca e tenta no próximo ciclo;
//   - já saiu mensagem para o lead depois da resposta (equipe ou robô): não manda (resolve como "atendida_depois");
//   - resposta com mais de 7 dias na fila sai sem envio ("expirada");
//   - FILA_ETAPA_ATRASADA_DESLIGADA=1 desliga sem deploy.
import { SQL_CANONICAL_PHONE, SQL_CANONICAL_PHONE_SPELLINGS } from "../services/canonicalPhone.js";
import { isPhoneOptedOut } from "../services/optOut.js";
import { getLeadClientN8nSettings as getSettingsReal } from "../services/n8nSettings.js";
import { isWithinSendWindow, resolveSendWindowConfig } from "../services/sendWindow.js";
import { continueCampaignLeadFromReply as continueReal, findCampaignReplyMatches as findMatchesReal } from "./dispatch.js";
import { pickCampaignAwaitingReply } from "./replyRouting.js";

export const FILA_INTERVALO_MS = 3 * 60 * 1000;
export const FILA_MAX_ENVIOS_POR_CICLO = 5;
export const FILA_VALIDADE_DIAS = 7;
const MAX_ANALISES_POR_CICLO = 40;
const ADIAMENTOS = new Set(["chip_quota_exhausted", "concurrent_reply_in_progress", "opt_out_check_failed", "OUTSIDE_SEND_WINDOW", "SEND_SETTINGS_UNREADABLE"]);

/** Chamado pelo webhook quando a resposta atrasada tinha etapa de campanha esperando. Nunca lança. */
export async function enfileirarEtapaAtrasada(pool, { clientId, waMessageId }) {
  if (!pool || !clientId || !waMessageId) return false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE public.lead_messages
          SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('etapa_atrasada', 'pendente', 'etapa_atrasada_em', now())
        WHERE client_id = $1 AND wa_message_id = $2 AND direction = 'inbound'`,
      [clientId, String(waMessageId)]
    );
    return rowCount > 0;
  } catch (err) {
    console.warn("[fila-etapa-atrasada] não foi possível enfileirar", { clientId, erro: err?.message || err });
    return false;
  }
}

// A resposta pendente mais recente de cada lead, e se já saiu mensagem para ele depois dela.
export const SQL_FILA = `
  WITH pendentes AS (
    SELECT DISTINCT ON (client_id, ${SQL_CANONICAL_PHONE("phone")})
           id, client_id, phone, message_timestamp, created_at, ${SQL_CANONICAL_PHONE("phone")} AS canon
      FROM public.lead_messages
     WHERE direction = 'inbound'
       AND meta->>'etapa_atrasada' = 'pendente'
     ORDER BY client_id, ${SQL_CANONICAL_PHONE("phone")}, created_at DESC
  )
  SELECT p.id, p.client_id, p.phone, p.message_timestamp, p.created_at,
         p.created_at < now() - make_interval(days => $1::int) AS expirada,
         EXISTS (
           SELECT 1 FROM public.lead_messages o
            WHERE o.client_id = p.client_id
              AND o.direction = 'outbound'
              AND o.phone = ANY(${SQL_CANONICAL_PHONE_SPELLINGS("p.canon")})
              AND o.created_at > p.created_at
         ) AS atendida_depois
    FROM pendentes p
   ORDER BY p.created_at
`;

async function resolver(pool, linha, resultado) {
  await pool.query(
    `UPDATE public.lead_messages
        SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('etapa_atrasada', $3::text, 'etapa_atrasada_resolvida_em', now())
      WHERE client_id = $1
        AND direction = 'inbound'
        AND meta->>'etapa_atrasada' = 'pendente'
        AND phone = ANY(${SQL_CANONICAL_PHONE_SPELLINGS(SQL_CANONICAL_PHONE("$2::text"))})`,
    [linha.client_id, linha.phone, String(resultado).slice(0, 80)]
  );
}

const estado = { ligado: false, ciclos: 0, enviadas: 0, resolvidasSemEnvio: 0, adiadas: 0, pendentesNoUltimoCiclo: null, ultimoCicloEm: null, ultimoResultado: null };
export function getEtapaAtrasadaFilaStatus() {
  return { ...estado };
}

/** Um ciclo: resolve os casos sem envio que encontrar e faz até FILA_MAX_ENVIOS_POR_CICLO envios, 1 por empresa. */
export async function runEtapaAtrasadaTick({
  pool,
  now = new Date(),
  continueReply = continueReal,
  findCampaignReplyMatches = findMatchesReal,
  optedOut = isPhoneOptedOut,
  getSettings = getSettingsReal,
  env = process.env,
} = {}) {
  if (!pool) return { envios: 0, motivo: "sem_banco" };
  if (env.FILA_ETAPA_ATRASADA_DESLIGADA === "1") return { envios: 0, motivo: "desligada" };
  const linhas = (await pool.query(SQL_FILA, [FILA_VALIDADE_DIAS])).rows;
  estado.pendentesNoUltimoCiclo = linhas.length;
  const empresasComEnvio = new Set();
  const acoes = [];
  let envios = 0;
  let analisadas = 0;
  for (const l of linhas) {
    if (envios >= FILA_MAX_ENVIOS_POR_CICLO || analisadas >= MAX_ANALISES_POR_CICLO) break;
    if (empresasComEnvio.has(l.client_id)) continue; // 1 por empresa por ciclo
    analisadas += 1;
    const semEnvio = async (motivo) => {
      await resolver(pool, l, motivo);
      estado.resolvidasSemEnvio += 1;
      acoes.push({ clientId: l.client_id, acao: motivo });
    };
    if (l.expirada) { await semEnvio("expirada"); continue; }
    if (l.atendida_depois) { await semEnvio("atendida_depois"); continue; }
    if (await optedOut(pool, { clientId: l.client_id, phone: l.phone })) { await semEnvio("opt_out"); continue; }
    let settings = null;
    try {
      settings = await getSettings(l.client_id);
    } catch {
      continue; // configuração ilegível: na dúvida, não envia
    }
    if (!isWithinSendWindow(now, resolveSendWindowConfig(settings || {}))) continue; // fora da janela desta empresa
    const campanha = pickCampaignAwaitingReply(await findCampaignReplyMatches({ clientId: l.client_id, phone: l.phone }));
    if (!campanha) { await semEnvio("sem_etapa_pendente"); continue; }

    empresasComEnvio.add(l.client_id);
    let r;
    try {
      r = await continueReply({ clientId: l.client_id, phone: l.phone, repliedAt: new Date(l.message_timestamp || l.created_at).toISOString(), campaignMatch: campanha, replyPayload: {} });
    } catch (err) {
      await resolver(pool, l, `erro: ${err?.message || err}`);
      acoes.push({ clientId: l.client_id, acao: "erro" });
      continue;
    }
    const motivo = r?.reason || null;
    if (r?.continued) {
      await resolver(pool, l, "enviada");
      estado.enviadas += 1;
      envios += 1;
      acoes.push({ clientId: l.client_id, acao: "enviada", campaignId: campanha.id });
      continue;
    }
    if (r?.held || ADIAMENTOS.has(motivo)) {
      estado.adiadas += 1;
      acoes.push({ clientId: l.client_id, acao: "adiada", motivo });
      continue;
    }
    await resolver(pool, l, motivo || "nao_continuou");
    estado.resolvidasSemEnvio += 1;
    acoes.push({ clientId: l.client_id, acao: "recusada", motivo });
  }
  if (acoes.length) estado.ultimoResultado = acoes.at(-1);
  return { envios, acoes, pendentes: linhas.length };
}

let _timer = null;
export function startEtapaAtrasadaScheduler({ pool, intervalMs = FILA_INTERVALO_MS } = {}) {
  if (_timer || !pool) return;
  estado.ligado = true;
  _timer = setInterval(async () => {
    estado.ciclos += 1;
    estado.ultimoCicloEm = new Date().toISOString();
    try {
      const r = await runEtapaAtrasadaTick({ pool });
      if (r.acoes?.length) console.log("[fila-etapa-atrasada] ciclo", { envios: r.envios, pendentes: r.pendentes, acoes: r.acoes });
    } catch (err) {
      console.error("[fila-etapa-atrasada] ciclo falhou:", err?.message || err);
    }
  }, intervalMs);
  if (_timer?.unref) _timer.unref();
}

export function stopEtapaAtrasadaScheduler() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  estado.ligado = false;
}
