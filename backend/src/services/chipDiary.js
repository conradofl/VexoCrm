// Diário do chip: grava cada queda e cada volta de conexão das instâncias Evolution, com o motivo e o que o sistema
// enviou pelo chip antes da queda. Tabela: public.evolution_instance_events (migration 20261117190000).
//
// Por quê (Nous, 17/11/2026): quatro chips caíram e o Vexo não sabia quando nem por quê. O webhook só assina
// MESSAGES_UPSERT e SEND_MESSAGE (configureEvolutionInstanceWebhook), e connection_state só muda quando a tela de chips
// consulta. Mas a Evolution v2 guarda no cadastro da instância a ÚLTIMA queda: disconnectionReasonCode,
// disconnectionAt e disconnectionObject. Leitura de produção em 17/11 14:14Z: os quatro chips caídos tinham 401,
// "conflict / device_removed" (o aparelho saiu de "Aparelhos conectados").
//
// Como funciona: a cada ciclo, UMA chamada GET /instance/fetchInstances (todas as instâncias) com a chave global.
// - Instância com disconnectionAt: grava a queda (o índice único por instância+tipo+hora impede repetir). Na hora de
//   gravar, tira a "foto" do que o chip enviou antes, olhando o banco a partir da hora da queda; por isso funciona
//   também para quedas antigas, que entram no primeiro ciclo.
// - Instância 'open' cujo último evento é uma queda: grava a volta (hora = updatedAt da Evolution, se for depois da
//   queda; senão a hora da leitura, marcada como aproximada).
// Nada aqui envia mensagem nem muda configuração na Evolution. Falha de rede ou de banco só vira log: nunca derruba nada.

import { getEvolutionAdminConfig, parseEvolutionWebhookEndpoint } from "./evolution.js";
import { resolveChipDailyLimit } from "./chipQuota.js";

export const CHIP_DIARY_TABLE = "public.evolution_instance_events";
export const CHIP_DIARY_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
const TZ = "America/Sao_Paulo";

const RAZOES = {
  aparelho_removido: "Aparelho removido do WhatsApp: a conexão do Vexo saiu de \"Aparelhos conectados\". Alguém removeu pelo celular, ou o próprio WhatsApp desconectou.",
  sessao_encerrada: "Sessão encerrada pelo WhatsApp: é preciso ler o QR Code de novo.",
  bloqueio: "Acesso negado pelo WhatsApp: costuma ser bloqueio ou restrição do número. Confira o aplicativo no celular.",
  substituida: "Sessão substituída: o número foi conectado em outro lugar.",
  rede: "Conexão perdida (rede ou instabilidade). Costuma voltar sozinha.",
  reinicio: "O WhatsApp pediu para reiniciar a conexão.",
  sessao_corrompida: "Sessão corrompida: é preciso ler o QR Code de novo.",
  incompativel: "Versão de aparelhos conectados incompatível.",
  indisponivel: "WhatsApp indisponível no momento.",
};

/**
 * Traduz o código e o objeto de erro que a Evolution (Baileys) guarda na queda.
 * Devolve { code, kind, label, tag, type, message }.
 */
export function describeChipDisconnect({ code = null, object = null } = {}) {
  const n = Number.parseInt(String(code ?? ""), 10);
  const c = Number.isInteger(n) ? n : null;
  const dados = object && typeof object === "object" ? object : {};
  const erro = dados.error && typeof dados.error === "object" ? dados.error : dados;
  const tag = erro?.data?.tag ? String(erro.data.tag) : null;
  const type = erro?.data?.attrs?.type ? String(erro.data.attrs.type) : null;
  const message = erro?.output?.payload?.message ? String(erro.output.payload.message).slice(0, 200) : null;

  let kind;
  if (c === 401 && type === "device_removed") kind = "aparelho_removido";
  else if (c === 401) kind = "sessao_encerrada";
  else if (c === 403) kind = "bloqueio";
  else if (c === 440) kind = "substituida";
  else if (c === 408 || c === 428) kind = "rede";
  else if (c === 515) kind = "reinicio";
  else if (c === 500) kind = "sessao_corrompida";
  else if (c === 411) kind = "incompativel";
  else if (c === 503) kind = "indisponivel";
  else kind = "outro";

  const label = kind === "outro"
    ? (c ? `Queda com código ${c}${message ? ` (${message})` : ""}.` : "Queda sem código informado pela Evolution.")
    : `${RAZOES[kind]}${c ? ` (código ${c})` : ""}`;
  return { code: c, kind, label, tag, type, message };
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function stateOf(payload) {
  const s = payload?.connectionStatus ?? payload?.instance?.state ?? payload?.state ?? payload?.status ?? "";
  return String(s || "").trim().toLowerCase() || null;
}

function nameOf(payload) {
  return String(payload?.name ?? payload?.instance?.instanceName ?? payload?.instanceName ?? "").trim() || null;
}

function isMissingTable(err) {
  return err?.code === "42P01" || /evolution_instance_events.*does not exist/i.test(String(err?.message || ""));
}

/** O que o sistema enviou pelo chip antes da queda. Cada número é lido do banco; o que falhar vira null. */
export async function buildDisconnectSnapshot(pool, { instance, at }) {
  const id = String(instance?.id ?? "");
  const snap = { limite_diario: resolveChipDailyLimit(instance) };
  const ler = async (chave, sql, params) => {
    try {
      const { rows } = await pool.query(sql, params);
      snap[chave] = rows[0]?.v ?? null;
    } catch {
      snap[chave] = null;
    }
  };
  await ler(
    "envios_1h",
    `SELECT count(*)::int AS v FROM public.campaign_dispatch_runs
      WHERE evolution_instance_id::text = $1::text AND status = 'sent'
        AND sent_at > $2::timestamptz - interval '1 hour' AND sent_at <= $2::timestamptz`,
    [id, at]
  );
  await ler(
    "envios_24h",
    `SELECT count(*)::int AS v FROM public.campaign_dispatch_runs
      WHERE evolution_instance_id::text = $1::text AND status = 'sent'
        AND sent_at > $2::timestamptz - interval '24 hours' AND sent_at <= $2::timestamptz`,
    [id, at]
  );
  await ler(
    "ultimo_envio",
    `SELECT max(sent_at) AS v FROM public.campaign_dispatch_runs
      WHERE evolution_instance_id::text = $1::text AND status = 'sent' AND sent_at <= $2::timestamptz`,
    [id, at]
  );
  await ler(
    "invalidos_24h",
    `SELECT count(*)::int AS v FROM public.campaign_dispatch_runs
      WHERE evolution_instance_id::text = $1::text AND status = 'invalid_number'
        AND coalesce(sent_at, created_at) > $2::timestamptz - interval '24 hours'
        AND coalesce(sent_at, created_at) <= $2::timestamptz`,
    [id, at]
  );
  await ler(
    "cota_usada_no_dia",
    `SELECT sent_count::int AS v FROM public.evolution_instance_daily_usage
      WHERE instance_id::text = $1::text AND date = ($2::timestamptz AT TIME ZONE '${TZ}')::date`,
    [id, at]
  );
  snap.ultimo_envio = toIso(snap.ultimo_envio);
  snap.segundos_do_ultimo_envio_ate_a_queda = snap.ultimo_envio
    ? Math.round((new Date(at).getTime() - new Date(snap.ultimo_envio).getTime()) / 1000)
    : null;
  return snap;
}

async function fetchEvolutionInstances({ fetchImpl, config }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${config.baseUrl}/instance/fetchInstances`, {
      method: "GET",
      headers: { apikey: config.apiKey, Accept: "application/json" },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`fetchInstances HTTP ${res.status}`);
    const body = await res.json();
    return Array.isArray(body) ? body : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Um ciclo do diário. Devolve { ok, instancias, quedas, voltas, motivo? }.
 * Não lança: erro de rede, de Evolution ou de banco volta como { ok: false, motivo }.
 */
export async function sampleChipConnections({ pool, fetchImpl = globalThis.fetch, config = getEvolutionAdminConfig(), now = new Date() } = {}) {
  if (!pool) return { ok: false, motivo: "sem_banco" };
  let chips;
  try {
    ({ rows: chips } = await pool.query(
      `SELECT id::text AS id, client_id, name, dispatch_webhook_url, chip_state, daily_limit_override
         FROM public.lead_client_evolution_instances`
    ));
  } catch (err) {
    return { ok: false, motivo: `leitura_dos_chips: ${err?.message || err}` };
  }
  const porInstancia = new Map();
  for (const ch of chips) {
    const ep = parseEvolutionWebhookEndpoint(ch.dispatch_webhook_url);
    if (ep?.instance) porInstancia.set(ep.instance, ch);
  }
  if (porInstancia.size === 0) return { ok: true, instancias: 0, quedas: 0, voltas: 0 };

  let lista;
  try {
    lista = await fetchEvolutionInstances({ fetchImpl, config });
  } catch (err) {
    return { ok: false, motivo: `evolution: ${err?.name === "AbortError" ? "timeout" : err?.message || err}` };
  }

  let quedas = 0;
  let voltas = 0;
  try {
    for (const inst of lista) {
      const nome = nameOf(inst);
      const chip = nome ? porInstancia.get(nome) : null;
      if (!chip) continue;

      const quedaEm = toIso(inst.disconnectionAt);
      if (quedaEm) {
        const motivo = describeChipDisconnect({ code: inst.disconnectionReasonCode, object: inst.disconnectionObject });
        const { rows } = await pool.query(
          `INSERT INTO ${CHIP_DIARY_TABLE}
             (client_id, instance_id, instance_name, chip_name, kind, occurred_at, reason_code, reason_kind, reason_label, reason_detail, detected_at)
           VALUES ($1, $2, $3, $4, 'queda', $5::timestamptz, $6, $7, $8, $9::jsonb, $10::timestamptz)
           ON CONFLICT (instance_name, kind, occurred_at) DO NOTHING
           RETURNING id`,
          [chip.client_id, chip.id, nome, chip.name, quedaEm, motivo.code, motivo.kind, motivo.label,
            JSON.stringify({ tag: motivo.tag, type: motivo.type, message: motivo.message }), now.toISOString()]
        );
        if (rows[0]?.id) {
          quedas += 1;
          const snapshot = await buildDisconnectSnapshot(pool, { instance: chip, at: quedaEm });
          await pool.query(`UPDATE ${CHIP_DIARY_TABLE} SET snapshot = $2::jsonb WHERE id = $1`, [rows[0].id, JSON.stringify(snapshot)]);
          console.warn("[chip-diary] queda registrada", { chip: chip.name, instancia: nome, em: quedaEm, motivo: motivo.kind, codigo: motivo.code });
        }
      }

      if (stateOf(inst) === "open") {
        const { rows: ult } = await pool.query(
          `SELECT kind, occurred_at FROM ${CHIP_DIARY_TABLE} WHERE instance_name = $1 ORDER BY occurred_at DESC, detected_at DESC LIMIT 1`,
          [nome]
        );
        if (ult[0]?.kind === "queda") {
          const quedaMs = new Date(ult[0].occurred_at).getTime();
          const atualizado = toIso(inst.updatedAt);
          const exata = atualizado && new Date(atualizado).getTime() > quedaMs;
          const voltaEm = exata ? atualizado : now.toISOString();
          const { rows: ins } = await pool.query(
            `INSERT INTO ${CHIP_DIARY_TABLE}
               (client_id, instance_id, instance_name, chip_name, kind, occurred_at, occurred_at_approx, reason_label, detected_at)
             VALUES ($1, $2, $3, $4, 'conectado', $5::timestamptz, $6, $7, $8::timestamptz)
             ON CONFLICT (instance_name, kind, occurred_at) DO NOTHING
             RETURNING id`,
            [chip.client_id, chip.id, nome, chip.name, voltaEm, exata === false, "Chip conectado de novo.", now.toISOString()]
          );
          if (ins[0]?.id) voltas += 1;
        }
      }
    }
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, motivo: "tabela_ausente" };
    return { ok: false, motivo: `gravacao: ${err?.message || err}`, quedas, voltas };
  }
  return { ok: true, instancias: porInstancia.size, quedas, voltas };
}

/** Eventos da empresa, do mais recente para o mais antigo. { available: false } se a tabela ainda não existe. */
export async function listChipDiary(pool, clientId, { limit = 100 } = {}) {
  const n = Math.min(Math.max(Number.parseInt(String(limit), 10) || 100, 1), 500);
  try {
    const { rows } = await pool.query(
      `SELECT id, instance_id, instance_name, chip_name, kind, occurred_at, occurred_at_approx, detected_at,
              reason_code, reason_kind, reason_label, reason_detail, snapshot
         FROM ${CHIP_DIARY_TABLE}
        WHERE client_id = $1
        ORDER BY occurred_at DESC, detected_at DESC
        LIMIT $2`,
      [clientId, n]
    );
    return { available: true, items: rows };
  } catch (err) {
    if (isMissingTable(err)) return { available: false, items: [] };
    throw err;
  }
}

let _timer = null;
let _emCurso = false;
/** Liga o ciclo periódico (um por processo). Primeiro ciclo 30 s depois do boot. */
export function startChipDiarySampler({ pool, intervalMs = CHIP_DIARY_INTERVAL_MS, fetchImpl = globalThis.fetch } = {}) {
  if (_timer || !pool) return null;
  const ciclo = async () => {
    if (_emCurso) return; // ciclo anterior ainda rodando (Evolution lenta): não empilha
    _emCurso = true;
    try {
      const r = await sampleChipConnections({ pool, fetchImpl });
      if (!r.ok) console.warn("[chip-diary] ciclo sem gravar:", r.motivo);
    } catch (err) {
      console.warn("[chip-diary] ciclo falhou:", err?.message || err);
    } finally {
      _emCurso = false;
    }
  };
  const primeiro = setTimeout(ciclo, 30_000);
  primeiro.unref?.();
  _timer = setInterval(ciclo, intervalMs);
  _timer.unref?.();
  console.info(`[chip-diary] diário do chip ligado (intervalo ${Math.round(intervalMs / 1000)} s)`);
  return _timer;
}
