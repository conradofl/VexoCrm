// Leitura do Gestor de Tráfego para o GoClaw (Fase 2, conselheiro).
//
// Uma rota GET, só leitura, por empresa. Autenticação no padrão do vigia da GD
// (GET /api/gd/clientes/vigia): token de serviço no cabeçalho Authorization:
// Bearer, comparado em tempo constante. Diferenças, de propósito:
//   - token PRÓPRIO do tráfego, um por empresa: TRAFFIC_GOCLAW_TOKENS no
//     formato "empresa=token,empresa2=token2". O token diz a empresa; a rota não
//     aceita escolher outra;
//   - o token do vigia (GOCLAW_READ_TOKEN) e o do gateway (GOCLAW_GATEWAY_TOKEN)
//     NÃO abrem esta rota, nem se alguém repetir o mesmo valor aqui;
//   - token curto (menos de 32 caracteres) é ignorado;
//   - a empresa ainda precisa estar no piloto (TRAFFIC_PILOT_TENANTS).
//
// A resposta nunca leva token de plataforma, DATABASE_URL, credencial, uid ou
// email de quem aprovou: só o que o GoClaw precisa para montar a mensagem.

import crypto from "node:crypto";
import express from "express";
import { pgDatabasePool } from "../services/database.js";
import { getTrafficPilotTenants } from "./access.js";
import { buildPerformance, ALLOWED_WINDOWS } from "./service.js";
import { getTodayPlan, listApplyQueue } from "./plan.js";

export const GOCLAW_TOKENS_ENV = "TRAFFIC_GOCLAW_TOKENS";
export const MIN_TOKEN_LENGTH = 32;
const FOREIGN_TOKEN_ENVS = ["GOCLAW_READ_TOKEN", "GOCLAW_GATEWAY_TOKEN"];

/** Pares empresa -> token válidos do ambiente. Nunca loga o valor. */
export function parseGoclawTokens(env = process.env) {
  const raw = String(env?.[GOCLAW_TOKENS_ENV] || "").trim();
  if (!raw) return [];
  const foreign = new Set(FOREIGN_TOKEN_ENVS.map((name) => String(env?.[name] || "").trim()).filter(Boolean));
  const pairs = [];
  for (const chunk of raw.split(",")) {
    const index = chunk.indexOf("=");
    if (index <= 0) continue;
    const clientId = chunk.slice(0, index).trim();
    const token = chunk.slice(index + 1).trim();
    if (!clientId || token.length < MIN_TOKEN_LENGTH || foreign.has(token)) continue;
    pairs.push({ clientId, token });
  }
  return pairs;
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Empresa do token, ou null. Compara com todos os tokens (sem sair no primeiro) para não vazar tempo. */
export function resolveGoclawTenant(authorization, env = process.env) {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
  const presented = authorization.slice("Bearer ".length).trim();
  if (!presented) return null;
  let found = null;
  for (const pair of parseGoclawTokens(env)) {
    if (safeEqual(presented, pair.token) && !found) found = pair.clientId;
  }
  return found;
}

function deny(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

export function requireGoclawTrafficToken(req, res, next) {
  const clientId = resolveGoclawTenant(req.headers.authorization);
  if (!clientId) return deny(res, 401, "GOCLAW_TOKEN_INVALID", "Token de leitura do tráfego inválido ou não configurado.");
  if (!getTrafficPilotTenants().includes(clientId)) {
    return deny(res, 403, "TRAFFIC_TENANT_NOT_IN_PILOT", "O Gestor de Tráfego ainda não está disponível para esta empresa.");
  }
  const asked = typeof req.query.clientId === "string" ? req.query.clientId.trim() : "";
  if (asked && asked !== clientId) return deny(res, 403, "GOCLAW_TOKEN_OTHER_TENANT", "Este token só lê a própria empresa.");
  req.goclawTrafficTenant = clientId;
  return next();
}

function stamp(value) {
  return value ? { at: value.at } : null;
}

function itemForGoclaw(item) {
  return {
    id: item.id,
    plataforma: item.platform,
    nivel: item.level,
    nome: item.entityName,
    campanha: item.campaignName,
    acao: item.action,
    verbaAtual: item.currentValue,
    verbaProposta: item.proposedValue,
    kpi: item.kpi,
    decisao: item.decision,
    motivo: item.reason,
    estado: item.status,
    venceEm: item.expiresAt,
    aprovacoes: { gestor_gd: stamp(item.approvals.gestor_gd), cliente: stamp(item.approvals.cliente) },
    recusa: item.rejection ? { lado: item.rejection.role, em: item.rejection.at, motivo: item.rejection.reason } : null,
    aplicado: item.applied ? { em: item.applied.at } : null,
  };
}

function campaignsForGoclaw(performance) {
  const out = [];
  for (const account of performance.accounts) {
    for (const campaign of account.campaigns) {
      out.push({
        plataforma: account.platform,
        conta: account.name || account.id,
        moeda: account.currency,
        campanha: campaign.name || campaign.id,
        gasto: campaign.metrics.spend,
        leads: campaign.metrics.leads,
        conversasIniciadas: campaign.metrics.messages_started,
        cliques: campaign.metrics.clicks,
        kpiPrincipal: performance.primaryKpi ? campaign.kpis[performance.primaryKpi] : null,
        decisao: campaign.decision,
      });
    }
  }
  return out;
}

/** O resumo que a rota devolve. Exportado para o teste comparar o contrato. */
export async function buildGoclawSummary(pool, clientId, { windowDays = 7, now = new Date() } = {}) {
  const days = ALLOWED_WINDOWS.includes(Number(windowDays)) ? Number(windowDays) : 7;
  const [performance, today, applyQueue] = await Promise.all([
    buildPerformance(pool, clientId, { windowDays: days, now }),
    getTodayPlan(pool, clientId, { now }),
    listApplyQueue(pool, clientId, { now }),
  ]);
  const { rows: accounts } = await pool.query(
    `SELECT platform, status, last_sync_at, last_sync_error FROM public.traffic_accounts WHERE client_id = $1 ORDER BY platform, created_at`,
    [clientId]
  );

  return {
    empresa: clientId,
    geradoEm: now.toISOString(),
    somenteLeitura: true,
    janela: performance.window,
    coleta: accounts.map((row) => ({
      plataforma: row.platform,
      ativa: row.status === "active",
      ultimaColeta: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null,
      // Só se tem erro, não o texto: a mensagem da plataforma pode citar conta e usuário.
      comErro: Boolean(row.last_sync_error),
    })),
    desempenho: {
      kpiPrincipal: performance.primaryKpi,
      totais: performance.totals,
      metas: performance.targets,
      campanhas: campaignsForGoclaw(performance),
    },
    plano: today
      ? {
          data: today.plan.date,
          janela: today.plan.window,
          coletaUsada: today.plan.dataCollectedAt,
          venceEm: today.plan.expiresAt,
          tetos: today.plan.summary.caps || null,
          itens: today.items.map(itemForGoclaw),
          foraDoPlano: (today.plan.summary.skipped || []).map((s) => ({ plataforma: s.platform, campanha: s.campaignName || s.campaignId, motivo: s.reason })),
        }
      : null,
    aplicarAMao: applyQueue.filter((item) => !item.applied).map(itemForGoclaw),
  };
}

export function registerTrafficGoclawRoutes(app) {
  const router = express.Router();
  router.get("/resumo", requireGoclawTrafficToken, async (req, res) => {
    const pool = pgDatabasePool;
    if (!pool) return deny(res, 503, "DATABASE_UNAVAILABLE", "Banco de dados indisponível.");
    try {
      res.json({ success: true, ...(await buildGoclawSummary(pool, req.goclawTrafficTenant, { windowDays: Number(req.query.window) })) });
    } catch (err) {
      console.error("[traffic/goclaw][resumo]", err?.message || err);
      deny(res, 500, "TRAFFIC_INTERNAL_ERROR", "Não foi possível montar o resumo.");
    }
  });
  app.use("/api/goclaw/trafego", router);
}
