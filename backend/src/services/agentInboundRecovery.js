// Mensagem de lead que o agente de IA não respondeu porque o processo caiu no meio.
//
// Por quê (Container LED, 17/11/2026): o webhook responde 200 "buffering" à Evolution e só depois processa (buffer em
// memória de 3 s + chamada da IA + envio). Restart do contêiner nesse intervalo perdia a mensagem para sempre: a
// Evolution não reenvia. Nesse dia o main teve cerca de dez deploys entre 08:48 e 15:16.
//
// O que este módulo faz:
// - Concessão por mensagem (msg_key = wa_message_id), com dono (o processo) e prazo. Tabela agent_inbound_claims quando
//   ela existe; sem a tabela (runner de migration travado), em memória — o backend é um processo só. Reservar é atômico
//   nos dois casos: INSERT ... ON CONFLICT condicional no banco, conferir-e-gravar síncrono em memória.
// - Desfecho de cada mensagem: 'respondida', 'descartada' (barrada por portão), 'falhou' (IA ou envio).
// - Varredura de órfãs (no boot e a cada minuto): conversa de empresa com agente ligado cuja ÚLTIMA mensagem é do lead,
//   com mais de 60 s e menos de 30 min, sem nenhuma mensagem nossa depois. Ela volta pelo MESMO handler do webhook, em
//   modo reprocessamento, e passa por todos os portões que já existem. Acima de 30 min não responde: a conversa
//   continua aparecendo como esperando resposta.
// - Conversa em andamento no processo (buffer ou IA rodando) nunca é pega pela varredura.

import { randomUUID } from "crypto";

export const BOOT_ID = `boot-${process.pid}-${randomUUID().slice(0, 8)}`;
export const MIN_IDADE_MS = 60 * 1000;
export const MAX_IDADE_MS = 30 * 60 * 1000;
export const PRAZO_MS = 3 * 60 * 1000;
export const MAX_TENTATIVAS = 3;
const SEM_TABELA_POR_MS = 5 * 60 * 1000;

const FINAIS = new Set(["respondida", "descartada"]);

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
const concessoesEmMemoria = new Map(); // `${clientId}|${msgKey}` -> { status, attempts, owner, leaseUntil }
let semTabelaAte = 0;

function isMissingTable(err) {
  return err?.code === "42P01" || /agent_inbound_claims.*does not exist/i.test(String(err?.message || ""));
}
function usarBanco(pool) {
  return Boolean(pool) && Date.now() >= semTabelaAte;
}
function marcarSemTabela(err) {
  if (!semTabelaAte || Date.now() >= semTabelaAte) {
    console.warn("[agente-orfas] tabela agent_inbound_claims ausente: concessão em memória (um processo só)", { erro: err?.message });
  }
  semTabelaAte = Date.now() + SEM_TABELA_POR_MS;
}

function podeReservarEmMemoria(atual, agora) {
  if (!atual) return true;
  if (FINAIS.has(atual.status)) return false;
  if (atual.status === "falhou") return atual.attempts < MAX_TENTATIVAS;
  // processando: só com prazo vencido (o dono, neste mesmo processo, sumiu sem gravar desfecho)
  return atual.leaseUntil < agora;
}

/**
 * O webhook recebeu a mensagem e vai processar: grava 'processando' com este processo como dono.
 * Mensagem já com desfecho (reentrega da Evolution) não é rebaixada. Nunca lança.
 */
export async function registrarEntrada({ pool, clientId, phone, msgKey, recebidaEm = new Date() }) {
  if (!clientId || !msgKey) return;
  const agora = Date.now();
  if (usarBanco(pool)) {
    try {
      await pool.query(
        `INSERT INTO public.agent_inbound_claims (client_id, msg_key, phone, status, origem, attempts, owner, lease_until, received_at)
         VALUES ($1, $2, $3, 'processando', 'webhook', 1, $4, $5::timestamptz, $6::timestamptz)
         ON CONFLICT (client_id, msg_key) DO NOTHING`,
        [clientId, msgKey, phone || null, BOOT_ID, new Date(agora + PRAZO_MS).toISOString(), new Date(recebidaEm).toISOString()]
      );
      return;
    } catch (err) {
      if (!isMissingTable(err)) {
        console.warn("[agente-orfas] falha ao registrar entrada", { clientId, erro: err?.message });
        return;
      }
      marcarSemTabela(err);
    }
  }
  const k = `${clientId}|${msgKey}`;
  if (!concessoesEmMemoria.has(k)) {
    concessoesEmMemoria.set(k, { status: "processando", attempts: 1, owner: BOOT_ID, leaseUntil: agora + PRAZO_MS, criadaEm: agora });
  }
}

/**
 * A varredura quer reprocessar a mensagem. Atômico: devolve true para UMA execução só.
 * Pega: sem linha; 'processando' de outro processo (morto no restart) parada há mais de 60 s ou com prazo vencido;
 * 'falhou' com menos de MAX_TENTATIVAS. Nunca pega desfecho final.
 */
export async function reservarParaVarredura({ pool, clientId, phone, msgKey }) {
  if (!clientId || !msgKey) return false;
  const agora = Date.now();
  if (usarBanco(pool)) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO public.agent_inbound_claims (client_id, msg_key, phone, status, origem, attempts, owner, lease_until)
         VALUES ($1, $2, $3, 'processando', 'varredura', 1, $4, $5::timestamptz)
         ON CONFLICT (client_id, msg_key) DO UPDATE
           SET status = 'processando', origem = 'varredura', attempts = public.agent_inbound_claims.attempts + 1,
               owner = EXCLUDED.owner, lease_until = EXCLUDED.lease_until, updated_at = now(), motivo = NULL
         WHERE (public.agent_inbound_claims.status = 'falhou' AND public.agent_inbound_claims.attempts < $6)
            OR (public.agent_inbound_claims.status = 'processando' AND (
                  public.agent_inbound_claims.lease_until < now()
               OR (public.agent_inbound_claims.owner IS DISTINCT FROM $4 AND public.agent_inbound_claims.updated_at < now() - interval '60 seconds')))
         RETURNING attempts`,
        [clientId, msgKey, phone || null, BOOT_ID, new Date(agora + PRAZO_MS).toISOString(), MAX_TENTATIVAS]
      );
      return rows.length === 1;
    } catch (err) {
      if (!isMissingTable(err)) {
        console.warn("[agente-orfas] falha ao reservar", { clientId, erro: err?.message });
        return false;
      }
      marcarSemTabela(err);
    }
  }
  const k = `${clientId}|${msgKey}`;
  const atual = concessoesEmMemoria.get(k);
  if (!podeReservarEmMemoria(atual, agora)) return false;
  concessoesEmMemoria.set(k, { status: "processando", attempts: (atual?.attempts || 0) + 1, owner: BOOT_ID, leaseUntil: agora + PRAZO_MS, criadaEm: atual?.criadaEm || agora });
  return true;
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
    concessoesEmMemoria.set(k, { ...atual, status, motivo, owner: BOOT_ID, leaseUntil: 0 });
  }
  // Memória limitada: some o que passou do teto de 30 min (a varredura nunca olha além disso).
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
 * Conversas cuja última mensagem é do lead, entre 60 s e 30 min atrás, sem nenhuma mensagem nossa depois.
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

/**
 * Uma passada da varredura. Devolve { candidatas, reprocessadas, puladas }. Nunca lança.
 * handler: o handler do webhook (padrão: o registrado pelas rotas do chatbot).
 */
export async function varrerOrfas({ pool, agora = new Date(), handler = handlerDeEntrada, empresas = null } = {}) {
  const resultado = { candidatas: 0, reprocessadas: 0, puladas: [] };
  if (!pool || typeof handler !== "function") return { ...resultado, motivo: !pool ? "sem_banco" : "sem_handler" };
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
      reservou = await reservarParaVarredura({ pool, clientId: m.client_id, phone: m.phone, msgKey: m.wa_message_id });
    } finally {
      if (!reservou) liberarConversa(m.client_id, m.phone);
    }
    if (!reservou) { pular("ja_concedida"); continue; }
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
          __vexoReprocessamento: { origem: "varredura", msgKey: m.wa_message_id, recebidaEm: new Date(m.at).getTime() },
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
      if (r.reprocessadas > 0 || r.motivo) console.info("[agente-orfas] varredura", r);
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
}
