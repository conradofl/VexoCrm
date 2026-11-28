// Porta de leitura da Analista geral (robô da operação do dono, fora do Vexo).
//
// Uma rota só: GET /api/analyst/overview?dias=7. Junta, de todas as empresas, os números que o Painel geral e a
// analista precisam, sem o robô ter login de pessoa. Regras, de propósito:
//   - token de serviço PRÓPRIO. O servidor guarda só o SHA-256 dele (ANALYST_READ_TOKEN_SHA256, 64 hex): o token
//     em si fica só com o robô e não aparece no EasyPanel. Comparação em tempo constante. Hash mal formado, ou igual
//     ao hash de outro segredo de serviço do backend, não abre nada; token apresentado com menos de 32 caracteres
//     também não. Sem a variável, a porta fica fechada para todo mundo (401);
//   - só GET e só leitura: nenhuma consulta daqui escreve, e nenhuma rota de campanha, lote, disparo, verba ou
//     agendamento aceita este token (este módulo não registra nenhuma);
//   - só agregados por empresa: nunca telefone, nome de lead, texto de mensagem, token de plataforma ou e-mail;
//   - o Dashboard entra pelo que já está no cache (dashboard_metrics_cache), sem recalcular: a porta não gera carga
//     nova no banco, e cada empresa vem com a hora do cálculo para o painel mostrar se está velho.
// Planta: PLANTA-ANALISTA-GERAL.md (etapa 2), no Desktop do dono.

import crypto from "node:crypto";
import { pgDatabasePool } from "../services/database.js";
import { SQL_CANONICAL_PHONE } from "../services/canonicalPhone.js";
import { MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS } from "../services/messageEffectiveness.js";

export const ANALYST_TOKEN_HASH_ENV = "ANALYST_READ_TOKEN_SHA256";
export const MIN_ANALYST_TOKEN_LENGTH = 32;
export const MAX_DIAS = 90;
export const MAX_CAMPANHAS_NO_RANKING = 30;

// Segredos de outros serviços: nenhum deles abre esta porta, nem se alguém repetir o mesmo valor aqui.
const FOREIGN_SECRET_ENVS = ["GOCLAW_READ_TOKEN", "GOCLAW_GATEWAY_TOKEN", "CAMPAIGN_SCHEDULER_TOKEN"];
const FOREIGN_TOKEN_LIST_ENVS = ["TRAFFIC_GOCLAW_TOKENS", "CAMPAIGN_AGENT_TOKENS"];

function foreignSecrets(env) {
  const valores = new Set();
  for (const nome of FOREIGN_SECRET_ENVS) {
    const valor = String(env?.[nome] || "").trim();
    if (valor) valores.add(valor);
  }
  for (const nome of FOREIGN_TOKEN_LIST_ENVS) {
    for (const pedaco of String(env?.[nome] || "").split(",")) {
      const corte = pedaco.indexOf("=");
      const valor = corte > 0 ? pedaco.slice(corte + 1).trim() : "";
      if (valor) valores.add(valor);
    }
  }
  return valores;
}

export const sha256Hex = (texto) => crypto.createHash("sha256").update(String(texto), "utf8").digest("hex");

/** Hash válido do ambiente (64 hex, minúsculo), ou null. Nunca loga o valor. */
export function analystTokenHash(env = process.env) {
  const hash = String(env?.[ANALYST_TOKEN_HASH_ENV] || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  for (const alheio of foreignSecrets(env)) if (sha256Hex(alheio) === hash) return null;
  return hash;
}

export function isAnalystAuthorized(authorization, env = process.env) {
  const esperado = analystTokenHash(env);
  if (!esperado || typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const apresentado = authorization.slice("Bearer ".length).trim();
  if (apresentado.length < MIN_ANALYST_TOKEN_LENGTH) return false;
  return crypto.timingSafeEqual(Buffer.from(sha256Hex(apresentado), "hex"), Buffer.from(esperado, "hex"));
}

function deny(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

/** Dias do período: inteiro de 1 a MAX_DIAS; vazio = 7. Outro valor = null (a rota responde 400). */
export function lerDias(bruto) {
  if (bruto === undefined || bruto === null || bruto === "") return 7;
  const n = Number(bruto);
  return Number.isInteger(n) && n >= 1 && n <= MAX_DIAS ? n : null;
}

const num = (v) => (v === null || v === undefined ? 0 : Number(v));

// Campanhas: mesma régua da tela de campanhas e do resumo do agente (services/campaignAgentSummary.js):
// "respondeu" = telefone que recebeu envio ('sent') e mandou mensagem de volta depois dele, dentro da janela.
// Aqui o período é pela data do envio (sent_at) e falha pela data de criação do registro.
async function campanhas(pool, dias) {
  const casa = `(lm.phone = r.phone OR ${SQL_CANONICAL_PHONE("lm.phone")} = ${SQL_CANONICAL_PHONE("r.phone")})`;
  const quando = "COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at)";
  const { rows } = await pool.query(
    `WITH r AS (
       SELECT r.campaign_id, r.client_id, r.phone, r.status, r.sent_at
         FROM public.campaign_dispatch_runs r
        WHERE (r.status = 'sent' AND r.sent_at >= now() - make_interval(days => $1))
           OR (r.status = 'failed' AND r.created_at >= now() - make_interval(days => $1))
     ), resp AS (
       SELECT DISTINCT r.campaign_id, r.client_id, r.phone
         FROM r
        WHERE r.status = 'sent' AND r.sent_at IS NOT NULL AND r.phone <> '' AND EXISTS (
          SELECT 1 FROM public.lead_messages lm
           WHERE lm.client_id = r.client_id AND ${casa}
             AND (lm.direction = 'inbound' OR lm.engagement_signal = 'reply')
             AND ${quando} > r.sent_at
             AND ${quando} <= r.sent_at + interval '${MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS} days')
     )
     SELECT c.id, c.client_id, c.name, c.status,
            COUNT(DISTINCT r.phone) FILTER (WHERE r.status = 'sent')::int AS enviados,
            COUNT(DISTINCT r.phone) FILTER (WHERE r.status = 'failed')::int AS falharam,
            (SELECT COUNT(*)::int FROM resp WHERE resp.campaign_id = c.id) AS responderam
       FROM r
       JOIN public.campaigns c ON c.id = r.campaign_id AND c.client_id = r.client_id
      GROUP BY c.id, c.client_id, c.name, c.status`,
    [dias]
  );
  const porEmpresa = {};
  for (const c of rows) {
    const e = (porEmpresa[c.client_id] ||= { empresa: c.client_id, campanhas: 0, enviados: 0, falharam: 0, responderam: 0 });
    e.campanhas += 1;
    e.enviados += num(c.enviados);
    e.falharam += num(c.falharam);
    e.responderam += num(c.responderam);
  }
  const ranking = rows
    .map((c) => ({ id: c.id, empresa: c.client_id, nome: c.name, status: c.status, enviados: num(c.enviados), falharam: num(c.falharam), responderam: num(c.responderam) }))
    .sort((a, b) => b.enviados - a.enviados || b.responderam - a.responderam)
    .slice(0, MAX_CAMPANHAS_NO_RANKING);
  return {
    regra: `respondeu = recebeu envio no período e mandou mensagem de volta em até ${MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS} dias`,
    porEmpresa: Object.values(porEmpresa).sort((a, b) => b.enviados - a.enviados),
    ranking,
  };
}

// Custo de IA dos clientes: só tokens (o preço é calculado fora, na tabela única de preços do dono).
async function ia(pool, dias) {
  const { rows: porModelo } = await pool.query(
    `SELECT provider, model, COUNT(*)::int AS chamadas,
            COALESCE(SUM(prompt_tokens), 0)::bigint AS entrada, COALESCE(SUM(completion_tokens), 0)::bigint AS saida
       FROM public.llm_usage WHERE created_at >= now() - make_interval(days => $1)
      GROUP BY provider, model ORDER BY chamadas DESC`,
    [dias]
  );
  const { rows: porEmpresa } = await pool.query(
    `SELECT COALESCE(client_id, '(sem empresa)') AS empresa, COUNT(*)::int AS chamadas,
            COALESCE(SUM(prompt_tokens), 0)::bigint AS entrada, COALESCE(SUM(completion_tokens), 0)::bigint AS saida
       FROM public.llm_usage WHERE created_at >= now() - make_interval(days => $1)
      GROUP BY 1 ORDER BY chamadas DESC`,
    [dias]
  );
  const conv = (r) => ({ ...r, entrada: num(r.entrada), saida: num(r.saida) });
  return { porModelo: porModelo.map(conv), porEmpresa: porEmpresa.map(conv) };
}

// Chips: quedas no período e o último evento de cada chip (diário do chip, services/chipDiary.js).
async function chips(pool, dias) {
  const { rows } = await pool.query(
    `SELECT e.client_id, e.instance_name, MAX(e.chip_name) AS chip_name,
            COUNT(*) FILTER (WHERE e.kind = 'queda' AND e.occurred_at >= now() - make_interval(days => $1))::int AS quedas,
            (ARRAY_AGG(e.kind ORDER BY e.occurred_at DESC))[1] AS ultimo_tipo,
            MAX(e.occurred_at) AS ultimo_em,
            (ARRAY_AGG(e.reason_label ORDER BY e.occurred_at DESC))[1] AS ultimo_motivo
       FROM public.evolution_instance_events e
      GROUP BY e.client_id, e.instance_name
      ORDER BY quedas DESC, ultimo_em DESC`,
    [dias]
  );
  return rows.map((r) => ({
    empresa: r.client_id,
    chip: r.chip_name || r.instance_name,
    instancia: r.instance_name,
    quedasNoPeriodo: num(r.quedas),
    ultimoEvento: { tipo: r.ultimo_tipo, em: r.ultimo_em ? new Date(r.ultimo_em).toISOString() : null, motivo: r.ultimo_motivo || null },
  }));
}

// Tráfego dos clientes do Vexo (coletor do Gestor de Tráfego).
async function trafego(pool, dias) {
  const { rows } = await pool.query(
    `SELECT client_id, platform, COALESCE(SUM(spend), 0)::numeric(14,2) AS gasto, COALESCE(SUM(impressions), 0)::bigint AS impressoes,
            COALESCE(SUM(clicks), 0)::bigint AS cliques, COALESCE(SUM(leads), 0)::int AS leads,
            COALESCE(SUM(messages_started), 0)::int AS conversas, MAX(date) AS ultimo_dia
       FROM public.traffic_metrics_daily
      WHERE date >= current_date - $1::int
      GROUP BY client_id, platform ORDER BY gasto DESC`,
    [dias]
  );
  return rows.map((r) => ({
    empresa: r.client_id, plataforma: r.platform, gasto: num(r.gasto), impressoes: num(r.impressoes), cliques: num(r.cliques),
    leads: num(r.leads), conversas: num(r.conversas), ultimoDia: r.ultimo_dia ? new Date(r.ultimo_dia).toISOString().slice(0, 10) : null,
  }));
}

// Dashboard: o que já está calculado no cache (30 dias), só os números. Nada de lista de fila (nome e telefone).
async function dashboard(pool) {
  const { rows } = await pool.query(
    `SELECT client_id, calculated_at, status,
            data->'summary'->'sent' AS enviados, data->'summary'->'replied' AS responderam,
            data->'overview'->'meetings' AS reunioes, data->'overview'->'funnel' AS funil, data->'periodInfo' AS periodo
       FROM public.dashboard_metrics_cache WHERE period = '30d' ORDER BY client_id`
  );
  const so = (o, chaves) => (o && typeof o === "object" ? Object.fromEntries(chaves.filter((k) => k in o).map((k) => [k, o[k]])) : null);
  const kpi = ["current", "previous", "delta", "rate", "reached", "previousRate", "previousReached", "hasRecords"];
  return rows.map((r) => ({
    empresa: r.client_id,
    calculadoEm: r.calculated_at ? new Date(r.calculated_at).toISOString() : null,
    estadoDoCache: r.status || null,
    periodo: so(r.periodo, ["key", "days", "current", "previous", "timeZone"]),
    enviados: so(r.enviados, kpi),
    responderam: so(r.responderam, [...kpi, "ruleDeclaration"]),
    reunioes: so(r.reunioes, kpi),
    funil: r.funil && typeof r.funil === "object"
      ? Object.fromEntries(Object.entries(r.funil).map(([k, v]) => [k, so(v, kpi)]))
      : null,
  }));
}

/** Monta o retrato inteiro. Cada bloco falha sozinho: o resto continua e o bloco volta com o erro. */
export async function buildAnalystOverview(pool, { dias }) {
  const blocos = { campanhas: () => campanhas(pool, dias), ia: () => ia(pool, dias), chips: () => chips(pool, dias), trafego: () => trafego(pool, dias), dashboard: () => dashboard(pool) };
  const saida = { geradoEm: new Date().toISOString(), periodo: { dias }, erros: {} };
  for (const [nome, fn] of Object.entries(blocos)) {
    try {
      saida[nome] = await fn();
    } catch (error) {
      console.error(`[analyst] bloco ${nome} falhou:`, error?.message || error);
      saida[nome] = null;
      saida.erros[nome] = "falha ao ler";
    }
  }
  return saida;
}

export function requireAnalystToken(req, res, next) {
  if (!isAnalystAuthorized(req.headers.authorization)) {
    return deny(res, 401, "ANALYST_TOKEN_INVALID", "Token da analista inválido ou não configurado.");
  }
  next();
}

// pool só no teste; em produção o pool é lido a cada pedido (o binding de database.js é preenchido no boot).
export function registerAnalystRoutes(app, { pool: poolDeTeste } = {}) {
  app.get("/api/analyst/overview", requireAnalystToken, async (req, res) => {
    const pool = poolDeTeste || pgDatabasePool;
    if (!pool) return deny(res, 503, "DATABASE_UNAVAILABLE", "Banco indisponível.");
    const dias = lerDias(req.query?.dias);
    if (!dias) return deny(res, 400, "ANALYST_INVALID_DAYS", `dias deve ser inteiro de 1 a ${MAX_DIAS}.`);
    try {
      res.set("Cache-Control", "no-store");
      res.json(await buildAnalystOverview(pool, { dias }));
    } catch (error) {
      console.error("[analyst] erro no retrato:", error?.message || error);
      deny(res, 500, "ANALYST_OVERVIEW_FAILED", "Falha ao montar o retrato.");
    }
  });
}
