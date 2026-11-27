// Alerta de atraso da Evolution (26/11/2026, pedido do Conrado).
//
// De 15 a 20/11 a Evolution entregou respostas de lead com horas de atraso e ninguém soube até o cliente reclamar. O
// webhook já calcula a idade real de cada resposta (services/inboundAge.js); aqui ela é contada numa janela móvel e, se
// ATRASO_LIMITE ou mais respostas chegarem com mais de 30 min de atraso dentro de 30 min, sai um aviso no WHATSAPP do
// Conrado (pedido dele em 26/11: o Slack não existe mais), pelo mesmo envio da Wandinha (enviarMensagemWhatsAppComFallback,
// chips da Vexo). Destino: ADMIN_ALERT_PHONE se definida; senão o telefone do Conrado já cadastrado em
// DIRETORES_AUTORIZADOS (goclaw/heloisaEngine.js). No máximo um aviso a cada 2 h. O /health mostra os números.
// Sem banco e sem tabela: memória do processo (um contêiner). Nunca lança.
import { IDADE_MAXIMA_RESPOSTA_MS } from "./inboundAge.js";

export const ATRASO_JANELA_MS = 30 * 60 * 1000;
export const ATRASO_LIMITE = 5;
export const ALERTA_INTERVALO_MS = 2 * 60 * 60 * 1000;

/** Envia o aviso por WhatsApp. Lança se não saiu (o erro vai para o /health). Import tardio: heloisaEngine é pesado. */
export async function enviarAvisoWhatsApp({ texto }) {
  const { enviarMensagemWhatsAppComFallback, DIRETORES_AUTORIZADOS } = await import("../domains/goclaw/heloisaEngine.js");
  const numero = String(process.env.ADMIN_ALERT_PHONE || "").trim() || DIRETORES_AUTORIZADOS?.conrado?.telefone;
  if (!numero) throw new Error("sem número de destino para o alerta");
  await enviarMensagemWhatsAppComFallback({ numero, texto, tenantId: "vexo-adm" });
}

let atrasadas = []; // { em, clientId, idadeMin }
let ultimoAlertaEm = 0;
let alertasEnviados = 0;
let ultimoErroAlerta = null;

function limpar(agora) {
  atrasadas = atrasadas.filter((a) => agora - a.em <= ATRASO_JANELA_MS);
}

/**
 * Registra a idade real de uma resposta que acabou de chegar. idadeMs null (sem hora na mensagem) é ignorado.
 * @returns {Promise<boolean>} true se disparou alerta agora
 */
export async function registrarIdadeDaEntrada({ clientId, idadeMs, agora = Date.now(), enviarAviso = enviarAvisoWhatsApp } = {}) {
  try {
    if (idadeMs === null || idadeMs === undefined || !(idadeMs > IDADE_MAXIMA_RESPOSTA_MS)) return false;
    atrasadas.push({ em: agora, clientId: clientId || null, idadeMin: Math.round(idadeMs / 60000) });
    limpar(agora);
    if (atrasadas.length < ATRASO_LIMITE || agora - ultimoAlertaEm < ALERTA_INTERVALO_MS) return false;
    ultimoAlertaEm = agora;
    const empresas = [...new Set(atrasadas.map((a) => a.clientId).filter(Boolean))];
    const idades = atrasadas.map((a) => a.idadeMin).sort((a, b) => a - b);
    const mediana = idades[Math.floor(idades.length / 2)];
    const texto =
      `⚠️ Vexo: a Evolution está entregando respostas de lead com atraso: ${atrasadas.length} respostas chegaram com mais de 30 min ` +
      `nos últimos 30 min (atraso mediano ${mediana} min). Empresas: ${empresas.join(", ") || "sem identificação"}. ` +
      `O agente não responde mensagem atrasada; a etapa de campanha vai para a fila e sai aos poucos na janela de envio. ` +
      `Vale conferir as instâncias na Evolution.`;
    try {
      await enviarAviso({ texto });
      alertasEnviados += 1;
      ultimoErroAlerta = null;
    } catch (err) {
      ultimoErroAlerta = String(err?.message || err).slice(0, 120);
      console.error("[alerta-atraso-evolution] não foi possível avisar no WhatsApp:", ultimoErroAlerta, { atrasadas: atrasadas.length, empresas });
    }
    return true;
  } catch {
    return false;
  }
}

/** Só contagens e datas, para o /health. */
export function getInboundDelayAlertStatus(agora = Date.now()) {
  limpar(agora);
  return {
    atrasadasUltimos30Min: atrasadas.length,
    limite: ATRASO_LIMITE,
    alertasEnviados,
    ultimoAlertaEm: ultimoAlertaEm ? new Date(ultimoAlertaEm).toISOString() : null,
    ultimoErroAlerta,
  };
}

export function _resetInboundDelayAlertForTesting() {
  atrasadas = [];
  ultimoAlertaEm = 0;
  alertasEnviados = 0;
  ultimoErroAlerta = null;
}
