// Guarda de entrada do webhook do WhatsApp.
//
// Existe por causa de um loop real em producao: o alerta de recontato enviado
// para o SDR voltou como mensagem de ENTRADA e disparou outro alerta, 8 vezes
// seguidas — 8 chamadas de LLM e 8 envios, o bot conversando com ele mesmo.
//
// Sao tres travas independentes de proposito. A de fromMe sozinha ja existia e
// nao segurou: o webhook e assinado tambem em SEND_MESSAGE (services/
// evolution.js), e o eco de uma mensagem enviada nem sempre traz key.fromMe no
// mesmo lugar. Uma trava que depende do formato do payload de terceiro nao pode
// ser a unica.

const processados = new Map();
const TTL_MS = 10 * 60 * 1000;
const MAX_IDS = 5000;

/** Evolution manda "messages.upsert" ou "MESSAGES_UPSERT" conforme a versao. */
export function resolveInboundEventName(body) {
  const bruto = body?.event ?? body?.Event ?? body?.eventName ?? "";
  return String(bruto || "").trim().toLowerCase().replace(/_/g, ".");
}

/**
 * Detecta JID de GRUPO / broadcast no inbound da Evolution. Resposta de lead legítima
 * vem SEMPRE de número individual (@s.whatsapp.net); grupo (@g.us) nunca é lead.
 * IMPORTANTE: receber o remoteJid CRU (antes de sanitizePhone, que stripa o "@g.us").
 * Regra: @g.us | @broadcast | user-part com hífen | user-part numérico > 15 dígitos.
 */
export function isGroupJid(rawJid) {
  const s = String(rawJid ?? "").trim().toLowerCase();
  if (!s) return false;
  if (s.includes("@g.us")) return true;
  if (s.includes("@broadcast")) return true;
  const userPart = s.split("@")[0];
  if (userPart.includes("-")) return true;
  const digits = userPart.replace(/\D/g, "");
  if (digits.length > 15) return true;
  return false;
}

/** Cobre os formatos ja vistos: data.key.key, key solto e o campo plano. */
export function isFromMe(body) {
  return (
    body?.data?.key?.fromMe === true ||
    body?.key?.fromMe === true ||
    body?.data?.fromMe === true ||
    body?.fromMe === true
  );
}

export function resolveMessageId(body) {
  const bruto =
    body?.data?.key?.id ??
    body?.data?.[0]?.key?.id ??
    body?.data?.messages?.[0]?.key?.id ??
    body?.key?.id ??
    body?.waMessageId ??
    body?.messageId ??
    body?.data?.messageId ??
    body?.id ??
    "";
  return String(bruto || "").trim();
}

function registrarId(id, agora) {
  processados.set(id, agora);
  if (processados.size <= MAX_IDS) return;
  // Poda os mais antigos primeiro; Map preserva ordem de insercao.
  const excedente = processados.size - MAX_IDS;
  let removidos = 0;
  for (const chave of processados.keys()) {
    processados.delete(chave);
    if (++removidos >= excedente) break;
  }
}

/**
 * Deve ignorar este evento? Roda ANTES de qualquer buffering, chamada de LLM ou
 * envio. Devolve o motivo para o log — silencio sem motivo esconde loop.
 */
export function shouldIgnoreInboundEvent(body, agora = Date.now()) {

  const isInternalForward =
    body?.isInternalForward === true ||
    body?.source === "campaign-reply-webhook" ||
    body?._internalForward === true;

  const id = resolveMessageId(body);

  // Payload vindo de encaminhamento interno SEM id -> REJEITAR e logar em error. É sempre bug.
  if (isInternalForward && !id) {
    console.error("[inbound-guard] ERRO: encaminhamento interno recebido SEM messageId — rejeitado!", {
      clientId: body?.clientId || body?.client_id,
      phone: body?.phone || body?.telefone,
    });
    return { ignore: true, reason: "internal_forward_missing_id" };
  }

  // Sem event (chamada interna do proprio backend) segue o fluxo. Com event
  // diferente de messages.upsert — SEND_MESSAGE, por exemplo — nao e mensagem
  // de lead: e o eco do que nos mesmos mandamos.
  const evento = resolveInboundEventName(body);
  if (evento && evento !== "messages.upsert") {
    return { ignore: true, reason: `evento_ignorado:${evento}` };
  }

  // Trava independente das duas acima: o MESMO id reprocessado nao gera segundo
  // envio, venha ele por reentrega da Evolution, retry ou caminho novo.
  if (id) {
    const visto = processados.get(id);
    if (visto !== undefined && agora - visto < TTL_MS) {
      return { ignore: true, reason: "duplicado" };
    }
    registrarId(id, agora);
  } else {
    // Payload vindo direto da Evolution sem id: processar, mas logar em warn com o corpo do evento
    console.warn("[inbound-guard] messageId vazio em evento de entrada:", JSON.stringify(body).slice(0, 300));
  }

  return { ignore: false, reason: null };
}

/** Só para teste: zera a memória de deduplicação. */
export function _resetInboundGuard() {
  processados.clear();
}
