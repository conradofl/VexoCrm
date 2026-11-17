// Mensagem de lead que o agente de IA não respondeu porque o processo caiu no meio.
//
// Por quê (Container LED, 17/11/2026): o webhook responde 200 "buffering" à Evolution e só depois processa (buffer em
// memória de 3 s + chamada da IA + envio). Restart do contêiner nesse intervalo perdia a mensagem para sempre: a
// Evolution não reenvia.
//
// Revisão do #269 (17/11/2026), regras que valem agora:
// - Concessão por mensagem (msg_key = wa_message_id) em agent_inbound_claims, com dono (o processo), prazo e tentativas.
//   Estados: processando -> enviando -> respondida | descartada | falhou.
// - Tomada só com PRAZO VENCIDO (PRAZO_MS, maior que o tempo máximo de uma resposta). Antes outro processo tomava em 60 s
//   mesmo com o dono vivo e podia responder em dobro.
// - Teto de MAX_TENTATIVAS por mensagem em qualquer caminho (webhook, reentrega da Evolution, varredura).
// - 'enviando' é gravado ANTES do fetch do envio. Parado em 'enviando' (SIGTERM ou exceção no meio do envio: o lead pode
//   ter recebido) NUNCA é reenviado sozinho: vira 'descartada' com motivo e a conversa vai para "Esperam você".
// - O caminho normal consulta a concessão: mensagem já respondida (ou sendo enviada/processada) não é processada de
//   novo (webhook atrasado depois da varredura, reentrega da Evolution).
// - SEM a tabela (runner de migration travado), a concessão do webhook fica em memória e a VARREDURA NÃO RODA: depois de
//   um restart a memória some, e reprocessar sem saber se houve envio podia dobrar a resposta.
// - Varredura: conversa de empresa com agente ligado cuja ÚLTIMA mensagem é do lead, entre 60 s e 30 min, sem mensagem
//   nossa depois. Volta pelo MESMO handler do webhook (modo reprocessamento) e passa por todos os portões. Envios
//   espaçados; concessões com mais de 7 dias são apagadas.

import { randomUUID } from "crypto";
import { marcarMensagemBarrada } from "./inboundAge.js";

export const BOOT_ID = `boot-${process.pid}-${randomUUID().slice(0, 8)}`;
export const MIN_IDADE_MS = 60 * 1000;
export const MAX_IDADE_MS = 30 * 60 * 1000;
// Tempo máximo de uma resposta: buffer (3 s) + IA (cada modelo da escada tem tempo limite) + envio (20 s de tempo
// limite). Bem abaixo de 2 min; o prazo de 5 min só vence se o dono morreu.
export const PRAZO_MS = 5 * 60 * 1000;
export const MAX_TENTATIVAS = 3;
export const ESPACO_ENTRE_REPROCESSOS_MS = 2000;
export const RETENCAO_DIAS = 7;
const SEM_TABELA_POR_MS = 5 * 60 * 1000;
const LIMPEZA_A_CADA_MS = 60 * 60 * 1000;

/** Conversa = empresa + últimos 8 dígitos do telefone (mesma regra da medição). */
export function chaveConversa(clientId, phone) {
  const d = String(phone ?? "").replace(/\D/g, "");
  return `${clientId}:${d.slice(-8)}`;
}

// ── Conversas em andamento NESTE processo (buffer ou IA rodando) ─────────────────────────────────────────────────────
const conversasEmAndamento = new Map();
export function marcarConversaEmAndamento(clientId, phone, origem = "webhook") {
  conversasEmAndamento.set(chaveConversa(clientId, phone), { desde: Date.now(), origem });
}
export function liberarConversa(clientId, phone) {
  conversasEmAndamento.delete(chaveConversa(clientId, phone));
}
export function conversaEmAndamento(clientId, phone) {
  return conversasEmAndamento.has(chaveConversa(clientId, phone));
}

// ── Concessão em memória (sem a tabela) ──────────────────────────────────────────────────────────────────────────────
const concessoesEmMemoria = new Map(); // `${clientId}|${msgKey}` -> { status, attempts, owner, leaseUntil, criadaEm }
let semTabelaAte = 0;

function isMissingTable(err) {
  return err?.code === "42P01" || /agent_inbound_claims.*does not exist/i.test(String(err?.message || ""));
}
function usarBanco(pool) {
  return Boolean(pool) && Date.now() >= semTabelaAte;
}
function marcarSemTabela(err) {
  if (!semTabelaAte || Date.now() >= semTabelaAte) {
    console.warn("[agente-orfas] tabela agent_inbound_claims ausente: concessão em memória e varredura desligada", { erro: err?.message });
  }
  semTabelaAte = Date.now() + SEM_TABELA_POR_MS;
}

/** Quando o webhook NÃO pode processar: o motivo, pelo estado que a mensagem já tem. */
export function motivoDeRecusa(status, motivo = null) {
  if (status === "respondida") return "ja_respondida";
  if (status === "enviando" || motivo === "enviando") return "envio_em_andamento";
  if (status === "processando") return "em_processamento";
  return "teto_de_tentativas";
}

function podeTomarEmMemoria(atual, agora) {
  if (!atual) return true;
  if (atual.attempts >= MAX_TENTATIVAS) return false;
  if (atual.status === "falhou") return true;
  if (atual.status === "descartada") return atual.motivo !== "envio_sem_confirmacao";
  if (atual.status === "processando") return atual.leaseUntil < agora;
  return false; // respondida, enviando
}

const SQL_PODE_TOMAR = (t) => `(${t}.attempts < $max AND (
      ${t}.status = 'falhou'
   OR (${t}.status = 'descartada' AND ${t}.motivo IS DISTINCT FROM 'envio_sem_confirmacao')
   OR (${t}.status = 'processando' AND ${t}.lease_until < now())))`;

/**
 * O webhook recebeu a mensagem e quer processar. Atômico.
 * Devolve { concedida: true } (linha nova, ou tomada de 'falhou'/'descartada'/'processando' com prazo vencido, dentro do
 * teto) ou { concedida: false, status, attempts } (já respondida, sendo enviada, sendo processada, ou no teto).
 * Erro de banco que não seja tabela ausente: concede (o webhook nunca para por causa do registro) e loga.
 */
export async function registrarEntrada({ pool, clientId, phone, msgKey, recebidaEm = new Date(), owner = BOOT_ID }) {
  if (!clientId || !msgKey) return { concedida: true };
  const agora = Date.now();
  if (usarBanco(pool)) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO public.agent_inbound_claims (client_id, msg_key, phone, status, origem, attempts, owner, lease_until, received_at)
         VALUES ($1, $2, $3, 'processando', 'webhook', 1, $4, $5::timestamptz, $6::timestamptz)
         ON CONFLICT (client_id, msg_key) DO UPDATE
           SET status = 'processando', origem = 'webhook', attempts = public.agent_inbound_claims.attempts + 1,
               owner = EXCLUDED.owner, lease_until = EXCLUDED.lease_until, updated_at = now(), motivo = NULL
         WHERE ${SQL_PODE_TOMAR("public.agent_inbound_claims").replace("$max", "$7")}
         RETURNING attempts`,
        [clientId, msgKey, phone || null, owner, new Date(agora + PRAZO_MS).toISOString(), new Date(recebidaEm).toISOString(), MAX_TENTATIVAS]
      );
      if (rows.length === 1) return { concedida: true, attempts: rows[0].attempts };
      const atual = (await pool.query("SELECT status, motivo, attempts FROM public.agent_inbound_claims WHERE client_id = $1 AND msg_key = $2", [clientId, msgKey])).rows[0];
      return { concedida: false, status: atual?.status || null, motivo: atual?.motivo || null, attempts: atual?.attempts ?? null };
    } catch (err) {
      if (!isMissingTable(err)) {
        console.warn("[agente-orfas] falha ao registrar entrada", { clientId, erro: err?.message });
        return { concedida: true };
      }
      marcarSemTabela(err);
    }
  }
  const k = `${clientId}|${msgKey}`;
  const atual = concessoesEmMemoria.get(k);
  if (!podeTomarEmMemoria(atual, agora)) return { concedida: false, status: atual.status, attempts: atual.attempts };
  concessoesEmMemoria.set(k, { status: "processando", attempts: (atual?.attempts || 0) + 1, owner, leaseUntil: agora + PRAZO_MS, criadaEm: atual?.criadaEm || agora });
  return { concedida: true };
}

/**
 * A varredura quer reprocessar a mensagem. Atômico: devolve true para UMA execução só.
 * Pega: sem linha; 'falhou' abaixo de MAX_TENTATIVAS; 'processando' com prazo vencido (dono morto), abaixo do teto.
 * Nunca 'enviando', 'respondida' nem 'descartada' (desfecho de portão ou envio sem confirmação).
 */
export async function reservarParaVarredura({ pool, clientId, phone, msgKey, owner = BOOT_ID }) {
  if (!clientId || !msgKey || !pool) return false;
  const { rows } = await pool.query(
    `INSERT INTO public.agent_inbound_claims (client_id, msg_key, phone, status, origem, attempts, owner, lease_until)
     VALUES ($1, $2, $3, 'processando', 'varredura', 1, $4, $5::timestamptz)
     ON CONFLICT (client_id, msg_key) DO UPDATE
       SET status = 'processando', origem = 'varredura', attempts = public.agent_inbound_claims.attempts + 1,
           owner = EXCLUDED.owner, lease_until = EXCLUDED.lease_until, updated_at = now(), motivo = NULL
     WHERE public.agent_inbound_claims.attempts < $6
       AND (public.agent_inbound_claims.status = 'falhou'
         OR (public.agent_inbound_claims.status = 'processando' AND public.agent_inbound_claims.lease_until < now()))
     RETURNING attempts`,
    [clientId, msgKey, phone || null, owner, new Date(Date.now() + PRAZO_MS).toISOString(), MAX_TENTATIVAS]
  );
  return rows.length === 1;
}

// Antes da migration 20261118090000 o CHECK de status não aceita 'enviando'. O mesmo significado vai então como
// 'processando' + motivo 'enviando' + prazo que nunca vence (ninguém toma); a varredura lê os dois formatos.
const PRAZO_DISTANTE = "9999-12-31T00:00:00Z";
function isCheckViolation(err) {
  return err?.code === "23514" || /agent_inbound_claims_status_check/.test(String(err?.message || ""));
}

/** Grava 'enviando' ANTES do fetch do envio. Nunca lança. */
export async function marcarEnviando({ pool, clientId, chaves }) {
  const lista = [...new Set((chaves || []).filter(Boolean))];
  if (!clientId || lista.length === 0) return;
  if (usarBanco(pool)) {
    try {
      await pool.query(
        `UPDATE public.agent_inbound_claims SET status = 'enviando', motivo = 'enviando', lease_until = NULL, updated_at = now()
          WHERE client_id = $1 AND msg_key = ANY($2::text[])`,
        [clientId, lista]
      );
      return;
    } catch (err) {
      if (isCheckViolation(err)) {
        try {
          await pool.query(
            `UPDATE public.agent_inbound_claims SET status = 'processando', motivo = 'enviando', lease_until = $3::timestamptz, updated_at = now()
              WHERE client_id = $1 AND msg_key = ANY($2::text[])`,
            [clientId, lista, PRAZO_DISTANTE]
          );
        } catch (err2) {
          console.warn("[agente-orfas] falha ao marcar enviando (formato antigo)", { clientId, erro: err2?.message });
        }
        return;
      }
      if (!isMissingTable(err)) {
        console.warn("[agente-orfas] falha ao marcar enviando", { clientId, erro: err?.message });
        return;
      }
      marcarSemTabela(err);
    }
  }
  for (const msgKey of lista) {
    const k = `${clientId}|${msgKey}`;
    const atual = concessoesEmMemoria.get(k) || { attempts: 1, criadaEm: Date.now() };
    concessoesEmMemoria.set(k, { ...atual, status: "enviando", leaseUntil: 0 });
  }
}

/** Grava o desfecho das mensagens de um lote. status: respondida | descartada | falhou. Nunca lança. */
export async function finalizarEntradas({ pool, clientId, chaves, status, motivo = null, totalMs = null }) {
  const lista = [...new Set((chaves || []).filter(Boolean))];
  if (!clientId || lista.length === 0) return;
  if (usarBanco(pool)) {
    try {
      await pool.query(
        `UPDATE public.agent_inbound_claims
            SET status = $3, motivo = $4, total_ms = $5, finished_at = now(), updated_at = now(), lease_until = NULL
          WHERE client_id = $1 AND msg_key = ANY($2::text[])`,
        [clientId, lista, status, motivo ? String(motivo).slice(0, 200) : null, Number.isFinite(totalMs) ? Math.round(totalMs) : null]
      );
      return;
    } catch (err) {
      if (!isMissingTable(err)) {
        console.warn("[agente-orfas] falha ao gravar desfecho", { clientId, status, erro: err?.message });
        return;
      }
      marcarSemTabela(err);
    }
  }
  for (const msgKey of lista) {
    const k = `${clientId}|${msgKey}`;
    const atual = concessoesEmMemoria.get(k) || { attempts: 1, criadaEm: Date.now() };
    concessoesEmMemoria.set(k, { ...atual, status, motivo, leaseUntil: 0 });
  }
  if (concessoesEmMemoria.size > 5000) {
    const limite = Date.now() - MAX_IDADE_MS - 5 * 60 * 1000;
    for (const [k, v] of concessoesEmMemoria) if ((v.criadaEm || 0) < limite) concessoesEmMemoria.delete(k);
  }
}

// ── Busca das órfãs ──────────────────────────────────────────────────────────────────────────────────────────────────
async function empresasComAgenteLigado(pool) {
  const ids = new Set();
  try {
    const { rows } = await pool.query("SELECT client_id FROM public.lead_client_n8n_settings WHERE chatbot_enabled = true");
    for (const r of rows) ids.add(r.client_id);
  } catch (err) {
    console.warn("[agente-orfas] leitura do agente global falhou", { erro: err?.message });
  }
  try {
    const { rows } = await pool.query("SELECT DISTINCT tenant_id FROM public.followup_companies WHERE inbound_enabled = true AND tenant_id IS NOT NULL");
    for (const r of rows) ids.add(r.tenant_id);
  } catch {
    // tabela/coluna ausente: vale só o agente global
  }
  return [...ids];
}

/**
 * Conversas cuja última mensagem é do lead, entre 60 s e 30 min atrás (hora real), sem nenhuma mensagem nossa depois.
 * Usa o índice (client_id, created_at). Devolve a mensagem mais recente do lead de cada conversa.
 */
export async function listarOrfas({ pool, agora = new Date(), empresas = null }) {
  const lista = empresas || (await empresasComAgenteLigado(pool));
  if (lista.length === 0) return [];
  const { rows } = await pool.query(
    `WITH recentes AS (
       SELECT m.id, m.client_id, m.phone, m.wa_message_id, m.message_text, m.instance_name, m.direction,
              coalesce(m.message_timestamp, m.created_at) AS at,
              right(regexp_replace(coalesce(m.phone, ''), '\\D', '', 'g'), 8) AS conv
         FROM public.lead_messages m
        WHERE m.client_id = ANY($1::text[])
          AND m.created_at > $2::timestamptz - interval '40 minutes'
     ), ultima AS (
       SELECT DISTINCT ON (client_id, conv) * FROM recentes WHERE conv <> '' ORDER BY client_id, conv, at DESC, id DESC
     )
     SELECT id::text AS id, client_id, phone, wa_message_id, message_text, instance_name, at
       FROM ultima
      WHERE direction = 'inbound'
        AND at <= $2::timestamptz - ($3::int * interval '1 millisecond')
        AND at >= $2::timestamptz - ($4::int * interval '1 millisecond')
      ORDER BY at`,
    [lista, agora.toISOString(), MIN_IDADE_MS, MAX_IDADE_MS]
  );
  return rows;
}

/**
 * Envio que ficou parado em 'enviando' (o processo caiu durante o fetch, ou o fetch deu erro/tempo limite: o lead pode
 * ter recebido). Nunca reenvia: marca a mensagem para "Esperam você" e fecha a concessão como 'descartada'.
 */
export async function encerrarEnviosParados({ pool }) {
  const { rows } = await pool.query(
    `UPDATE public.agent_inbound_claims
        SET status = 'descartada', motivo = 'envio_sem_confirmacao', finished_at = now(), updated_at = now()
      WHERE (status = 'enviando' OR (status = 'processando' AND motivo = 'enviando'))
        AND updated_at < now() - ($1::int * interval '1 millisecond')
      RETURNING client_id, msg_key`,
    [PRAZO_MS]
  );
  for (const r of rows) {
    await marcarMensagemBarrada(pool, { clientId: r.client_id, waMessageId: r.msg_key, motivo: "envio_sem_confirmacao" });
    console.warn("[agente-orfas] envio sem confirmação: não reenvia, vai para Esperam você", { clientId: r.client_id });
  }
  return rows.length;
}

/** Concessões antigas (mais de RETENCAO_DIAS): apagadas aos poucos. */
export async function limparConcessoesAntigas({ pool, dias = RETENCAO_DIAS, lote = 5000 }) {
  const { rowCount } = await pool.query(
    `DELETE FROM public.agent_inbound_claims
      WHERE ctid IN (SELECT ctid FROM public.agent_inbound_claims WHERE updated_at < now() - ($1::int * interval '1 day') LIMIT $2)`,
    [dias, lote]
  );
  return rowCount || 0;
}

async function tabelaExiste(pool) {
  try {
    await pool.query("SELECT 1 FROM public.agent_inbound_claims LIMIT 0");
    return true;
  } catch (err) {
    if (isMissingTable(err)) return false;
    throw err;
  }
}

// ── Handler do webhook (registrado pelas rotas do chatbot) ───────────────────────────────────────────────────────────
let handlerDeEntrada = null;
export function registrarHandlerDeEntrada(fn) {
  handlerDeEntrada = typeof fn === "function" ? fn : null;
}

function corpoSintetico(m) {
  const phone = String(m.phone || "");
  const remoteJid = phone.includes("@") ? phone : `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
  return {
    event: "messages.upsert",
    instance: m.instance_name || undefined,
    clientId: m.client_id,
    data: {
      key: { remoteJid, fromMe: false, id: m.wa_message_id },
      message: { conversation: String(m.message_text || "") },
      messageTimestamp: Math.floor(new Date(m.at).getTime() / 1000),
    },
  };
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ultimaLimpeza = 0;

/**
 * Uma passada da varredura. Devolve { candidatas, reprocessadas, puladas, enviosParados }. Nunca lança.
 * handler: o handler do webhook (padrão: o registrado pelas rotas do chatbot).
 */
export async function varrerOrfas({
  pool,
  agora = new Date(),
  handler = handlerDeEntrada,
  empresas = null,
  owner = BOOT_ID,
  espacoMs = ESPACO_ENTRE_REPROCESSOS_MS,
} = {}) {
  const resultado = { candidatas: 0, reprocessadas: 0, puladas: [], enviosParados: 0 };
  if (!pool || typeof handler !== "function") return { ...resultado, motivo: !pool ? "sem_banco" : "sem_handler" };
  try {
    if (!(await tabelaExiste(pool))) return { ...resultado, motivo: "sem_tabela" };
    resultado.enviosParados = await encerrarEnviosParados({ pool });
    if (Date.now() - ultimaLimpeza > LIMPEZA_A_CADA_MS) {
      ultimaLimpeza = Date.now();
      await limparConcessoesAntigas({ pool }).catch((err) => console.warn("[agente-orfas] limpeza falhou", { erro: err?.message }));
    }
  } catch (err) {
    console.warn("[agente-orfas] preparo da varredura falhou", { erro: err?.message });
    return { ...resultado, motivo: "preparo_falhou" };
  }
  let orfas;
  try {
    orfas = await listarOrfas({ pool, agora, empresas });
  } catch (err) {
    console.warn("[agente-orfas] busca de órfãs falhou", { erro: err?.message });
    return { ...resultado, motivo: "busca_falhou" };
  }
  resultado.candidatas = orfas.length;
  for (const m of orfas) {
    const pular = (motivo) => resultado.puladas.push({ id: m.id, motivo });
    if (!m.wa_message_id) { pular("sem_wa_message_id"); continue; }
    if (!String(m.message_text || "").trim()) { pular("sem_texto"); continue; }
    if (agora.getTime() - new Date(m.at).getTime() > MAX_IDADE_MS) { pular("mais_de_30_min"); continue; }
    if (conversaEmAndamento(m.client_id, m.phone)) { pular("em_andamento"); continue; }
    // Marca ANTES de qualquer await: outra passada concorrente no mesmo processo já vê a conversa ocupada.
    marcarConversaEmAndamento(m.client_id, m.phone, "varredura");
    let reservou = false;
    try {
      reservou = await reservarParaVarredura({ pool, clientId: m.client_id, phone: m.phone, msgKey: m.wa_message_id, owner });
    } catch (err) {
      console.warn("[agente-orfas] falha ao reservar", { clientId: m.client_id, erro: err?.message });
    } finally {
      if (!reservou) liberarConversa(m.client_id, m.phone);
    }
    if (!reservou) { pular("ja_concedida"); continue; }
    // Envios espaçados: um lote grande de órfãs (deploy no pico) não sai de rajada pelo mesmo chip.
    if (resultado.reprocessadas > 0 && espacoMs > 0) await esperar(espacoMs);
    console.warn("[agente-orfas] reprocessando mensagem sem resposta", {
      clientId: m.client_id,
      phone: `***${String(m.phone || "").replace(/\D/g, "").slice(-4)}`,
      recebidaEm: new Date(m.at).toISOString(),
      idadeS: Math.round((agora.getTime() - new Date(m.at).getTime()) / 1000),
    });
    try {
      const res = { json() { return res; }, status() { return res; } };
      await handler(
        {
          body: corpoSintetico(m),
          query: { clientId: m.client_id, client_id: m.client_id, instanceName: m.instance_name || undefined },
          headers: {},
          __vexoReprocessamento: { origem: "varredura", msgKey: m.wa_message_id, horaReal: new Date(m.at).getTime() },
        },
        res
      );
      resultado.reprocessadas += 1;
    } catch (err) {
      liberarConversa(m.client_id, m.phone);
      await finalizarEntradas({ pool, clientId: m.client_id, chaves: [m.wa_message_id], status: "falhou", motivo: `varredura: ${err?.message || err}` });
    }
  }
  return resultado;
}

let _timer = null;
let _primeiro = null;
let _emCurso = false;
let _parado = false;
/** Liga a varredura: primeira passada logo depois do boot, depois a cada minuto. Um ciclo nunca empilha no outro. */
export function startAgentRecoverySweeper({ pool, intervalMs = 60_000, primeiraEmMs = 15_000 } = {}) {
  if (_timer || !pool) return null;
  _parado = false;
  const ciclo = async () => {
    if (_emCurso || _parado) return;
    _emCurso = true;
    try {
      const r = await varrerOrfas({ pool });
      if (r.reprocessadas > 0 || r.enviosParados > 0 || (r.motivo && r.motivo !== "sem_tabela")) console.info("[agente-orfas] varredura", r);
    } catch (err) {
      console.warn("[agente-orfas] varredura falhou", { erro: err?.message || err });
    } finally {
      _emCurso = false;
    }
  };
  _primeiro = setTimeout(ciclo, primeiraEmMs);
  _primeiro.unref?.();
  _timer = setInterval(ciclo, intervalMs);
  _timer.unref?.();
  console.info(`[agente-orfas] varredura de mensagens sem resposta ligada (a cada ${Math.round(intervalMs / 1000)} s)`);
  return _timer;
}
export function stopAgentRecoverySweeper() {
  _parado = true;
  if (_primeiro) clearTimeout(_primeiro);
  if (_timer) clearInterval(_timer);
  _timer = null;
  _primeiro = null;
}

/** Só para teste. */
export function _resetAgentRecoveryForTest() {
  conversasEmAndamento.clear();
  concessoesEmMemoria.clear();
  semTabelaAte = 0;
  handlerDeEntrada = null;
  ultimaLimpeza = 0;
}
