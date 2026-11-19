// Autenticação do webhook da Evolution (POST /api/hardcoded-chat-webhook).
//
// Até 18/11/2026 o webhook não conferia token nenhum: a URL levava um token fixo, escrito no código (repositório
// público), que ninguém validava. Qualquer um podia mandar mensagem falsa em nome de qualquer empresa.
//
// Agora o token vem de variável de ambiente e é conferido aqui:
//   EVOLUTION_WEBHOOK_TOKEN           token atual. A Evolution manda no cabeçalho x-vexo-webhook-token.
//   EVOLUTION_WEBHOOK_TOKEN_ANTERIOR  token da transição. Enquanto existir, vale também, e o token na URL (?token=)
//                                     continua aceito. Apagar a variável encerra a transição: só cabeçalho.
// Sem nenhuma das duas, o webhook segue aberto como sempre foi (o deploy não derruba entrega), com aviso no log.
//
// Nunca loga o valor de token nenhum, nem o recebido.
import { createHash, timingSafeEqual } from "node:crypto";

export const CABECALHO_TOKEN_WEBHOOK = "x-vexo-webhook-token";

function limpo(valor) {
  const s = String(valor ?? "").trim();
  return s || null;
}

export function tokensDoWebhook(env = process.env) {
  return {
    novo: limpo(env.EVOLUTION_WEBHOOK_TOKEN),
    anterior: limpo(env.EVOLUTION_WEBHOOK_TOKEN_ANTERIOR),
  };
}

/** Token que o Vexo manda para a Evolution e nos repasses internos: o novo; na falta dele, o anterior. */
export function tokenParaEnviar(env = process.env) {
  const { novo, anterior } = tokensDoWebhook(env);
  return novo || anterior || null;
}

/** Cabeçalho para os repasses internos (fetch para o próprio webhook). Vazio quando o webhook está aberto. */
export function cabecalhoDoWebhook(env = process.env) {
  const t = tokenParaEnviar(env);
  return t ? { [CABECALHO_TOKEN_WEBHOOK]: t } : {};
}

// Comparação em tempo constante: compara os hashes, que têm sempre o mesmo tamanho.
function igual(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

// Só o cabeçalho próprio. Authorization fica de fora: a tela manda ali o token do Firebase, que não é token de webhook.
function tokenDoCabecalho(req) {
  const h = req?.headers || {};
  return limpo(Array.isArray(h[CABECALHO_TOKEN_WEBHOOK]) ? h[CABECALHO_TOKEN_WEBHOOK][0] : h[CABECALHO_TOKEN_WEBHOOK]);
}

function tokenDaUrl(req) {
  const q = req?.query || {};
  return limpo(Array.isArray(q.token) ? q.token[0] : q.token);
}

/**
 * { ok: true, via: "cabecalho" | "url" | "aberto" } ou { ok: false, motivo }.
 * Cabeçalho presente e errado é recusado, mesmo com token certo na URL.
 */
export function verificarTokenDoWebhook(req, env = process.env) {
  const { novo, anterior } = tokensDoWebhook(env);
  if (!novo && !anterior) return { ok: true, via: "aberto" };
  const validos = [novo, anterior].filter(Boolean);
  const confere = (t) => validos.some((v) => igual(t, v));

  const doCabecalho = tokenDoCabecalho(req);
  if (doCabecalho) return confere(doCabecalho) ? { ok: true, via: "cabecalho" } : { ok: false, motivo: "cabecalho_invalido" };

  const daUrl = tokenDaUrl(req);
  if (daUrl) {
    if (!anterior) return { ok: false, motivo: "token_na_url_encerrado" };
    return confere(daUrl) ? { ok: true, via: "url" } : { ok: false, motivo: "url_invalido" };
  }
  return { ok: false, motivo: "sem_token" };
}

// Log com freio: no máximo uma linha por chave a cada intervalo, com a contagem do que foi calado.
const ultimoLog = new Map();
function logComFreio(chave, intervaloMs, fn) {
  const agora = Date.now();
  const r = ultimoLog.get(chave);
  if (r && agora - r.em < intervaloMs) {
    r.calados += 1;
    return;
  }
  fn(r?.calados || 0);
  ultimoLog.set(chave, { em: agora, calados: 0 });
}
export function _resetWebhookAuthLogForTest() {
  ultimoLog.clear();
}

function instanciaDoPedido(req) {
  const b = req?.body && typeof req.body === "object" ? req.body : {};
  return limpo(req?.query?.instanceName) || limpo(req?.query?.instance) || limpo(b.instance) || limpo(b.instanceName) || null;
}

/** Middleware do POST /api/hardcoded-chat-webhook. */
export function exigirTokenDoWebhook(req, res, next) {
  const r = verificarTokenDoWebhook(req);
  const instancia = instanciaDoPedido(req);
  if (r.ok) {
    if (r.via === "aberto") {
      logComFreio("aberto", 60 * 60 * 1000, (calados) =>
        console.warn("[webhook-token] webhook ABERTO: EVOLUTION_WEBHOOK_TOKEN não configurado", { aceitosSemConferir: calados + 1 })
      );
    } else if (r.via === "url") {
      // Transição: mostra quais instâncias ainda mandam pela URL (as que faltam reaplicar).
      logComFreio(`url:${instancia}`, 10 * 60 * 1000, (calados) =>
        console.log("[webhook-token] aceito pela URL (transição)", { instancia, desdeUltimoAviso: calados + 1 })
      );
    }
    return next();
  }
  logComFreio(`recusa:${r.motivo}:${instancia}`, 60 * 1000, (calados) =>
    console.warn("[webhook-token] recusado", { motivo: r.motivo, instancia, ip: req?.ip || null, recusadosCalados: calados })
  );
  return res.status(401).json({ success: false, error: "WEBHOOK_TOKEN_INVALIDO" });
}
