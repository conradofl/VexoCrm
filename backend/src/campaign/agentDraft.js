// Porta do agente que monta campanha: cria e edita RASCUNHO, e mais nada.
//
// O dono entrega o material (texto, imagens, público) e recebe a campanha montada e salva como rascunho. Quem
// escolhe o chip e dispara é ele, na tela. Esta porta existe para que essa regra não dependa de combinado:
//
//   - Autenticação por token de serviço, um por empresa: CAMPAIGN_AGENT_TOKENS no formato
//     "empresa=token,empresa2=token2" (mesmo molde do TRAFFIC_GOCLAW_TOKENS). O token diz a empresa; o corpo não
//     consegue escolher outra. Token curto (menos de 32 caracteres) é ignorado, e token que repete o valor de outro
//     segredo de serviço do backend também. Sem a variável, a porta fica fechada para todo mundo.
//   - As rotas daqui são só: importar base, salvar roteiro, criar rascunho, editar rascunho, ler rascunho.
//     Nenhuma rota de lote, agendamento, disparo ou retomada aceita este token: elas continuam atrás do login
//     Firebase, e este módulo não registra nenhuma delas.
//   - Criar: o corpo passa por lista branca e o status é forçado para "draft". Agendar (scheduledFor), repetir
//     (recorrência) ou pedir outro status é recusado com 400, não descartado em silêncio.
//   - Editar: só campanha da própria empresa, que AINDA é rascunho, não repete e não tem nenhum lote. Campanha que o
//     dono já disparou sai do status "draft" (syncMotherCampaignActive) e fica fora do alcance do agente.
//
// A resposta nunca devolve token: o handler de campanha já mascara webhook_token.

import crypto from "node:crypto";

export const CAMPAIGN_AGENT_TOKENS_ENV = "CAMPAIGN_AGENT_TOKENS";
export const MIN_AGENT_TOKEN_LENGTH = 32;
export const CAMPAIGN_AGENT_ACTOR = "agente-campanha";

// Segredos de outros serviços: nenhum deles abre esta porta, nem se alguém repetir o mesmo valor aqui.
const FOREIGN_SECRET_ENVS = ["GOCLAW_READ_TOKEN", "GOCLAW_GATEWAY_TOKEN", "CAMPAIGN_SCHEDULER_TOKEN"];
const FOREIGN_TOKEN_LIST_ENVS = ["TRAFFIC_GOCLAW_TOKENS"];

// O que o agente pode mandar ao criar ou editar a campanha. Todo o resto é descartado.
const ALLOWED_CAMPAIGN_KEYS = [
  "name",
  "importId",
  "importIds",
  "importSource",
  "limitPerRun",
  "mode",
  "campaignPromptId",
  "analyticsMeta",
];

// O que o agente NÃO pode nem tentar: agenda, repetição, arquivar, e chip direto na campanha (escolha do dono).
const FORBIDDEN_CAMPAIGN_KEYS = [
  "scheduledFor",
  "scheduled_for",
  "startsAt",
  "endsAt",
  "isRecurring",
  "is_recurring",
  "archived",
  "triggerType",
  "scheduledAt",
];

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

/** Pares empresa -> token válidos do ambiente. Nunca loga o valor. */
export function parseCampaignAgentTokens(env = process.env) {
  const raw = String(env?.[CAMPAIGN_AGENT_TOKENS_ENV] || "").trim();
  if (!raw) return [];
  const alheios = foreignSecrets(env);
  const pares = [];
  for (const pedaco of raw.split(",")) {
    const corte = pedaco.indexOf("=");
    if (corte <= 0) continue;
    const clientId = pedaco.slice(0, corte).trim();
    const token = pedaco.slice(corte + 1).trim();
    if (!clientId || token.length < MIN_AGENT_TOKEN_LENGTH || alheios.has(token)) continue;
    pares.push({ clientId, token });
  }
  return pares;
}

function safeEqual(a, b) {
  const esquerda = Buffer.from(a);
  const direita = Buffer.from(b);
  return esquerda.length === direita.length && crypto.timingSafeEqual(esquerda, direita);
}

/** Empresa do token, ou null. Compara com todos (sem sair no primeiro) para não vazar tempo. */
export function resolveCampaignAgentTenant(authorization, env = process.env) {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
  const apresentado = authorization.slice("Bearer ".length).trim();
  if (!apresentado) return null;
  let achado = null;
  for (const par of parseCampaignAgentTokens(env)) {
    if (safeEqual(apresentado, par.token) && !achado) achado = par.clientId;
  }
  return achado;
}

function deny(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Autentica pelo token e monta o perfil de acesso mais estreito possível: usuário de cliente preso a UMA empresa.
 * Os handlers reaproveitados chamam resolveAuthorizedClientId com este perfil, então o escopo por empresa é
 * conferido de novo lá dentro, pelo mesmo código que confere o login de pessoa.
 */
export function requireCampaignAgentToken(req, res, next) {
  const clientId = resolveCampaignAgentTenant(req.headers.authorization);
  if (!clientId) {
    return deny(res, 401, "CAMPAIGN_AGENT_TOKEN_INVALID", "Token do agente de campanha inválido ou não configurado.");
  }
  req.campaignAgentTenant = clientId;
  req.authUser = null;
  req.authAccess = {
    role: "client",
    scopeMode: "assigned_clients",
    clientId,
    clientIds: [clientId],
    permissions: [],
    isAdmin: false,
    uid: null,
    email: CAMPAIGN_AGENT_ACTOR,
    isCampaignAgent: true,
  };
  return next();
}

function bodyAsksOtherTenant(body, tenant) {
  const pedido = String(body?.clientId ?? body?.client_id ?? "").trim();
  return Boolean(pedido) && pedido !== tenant;
}

/** Motivo da recusa (string) ou null. Agenda, repetição e status diferente de rascunho não passam. */
export function describeForbiddenCampaignBody(body) {
  if (!isPlainObject(body)) return "Corpo inválido.";
  for (const chave of FORBIDDEN_CAMPAIGN_KEYS) {
    if (chave in body && body[chave] !== null && body[chave] !== false && body[chave] !== "") {
      return `O agente só cria rascunho: o campo ${chave} não é aceito.`;
    }
  }
  for (const chave of Object.keys(body)) {
    if (/^recurrence/i.test(chave) && body[chave] !== null && body[chave] !== false && body[chave] !== "") {
      return `O agente só cria rascunho: campanha recorrente (${chave}) não é aceita.`;
    }
  }
  if ("status" in body && body.status !== "draft") {
    return "O agente só cria rascunho: status diferente de draft não é aceito.";
  }
  return null;
}

/** Corpo que segue para o handler: lista branca, empresa do token e status de rascunho. */
export function buildAgentCampaignBody(body, tenant) {
  const limpo = {};
  for (const chave of ALLOWED_CAMPAIGN_KEYS) {
    if (chave in body) limpo[chave] = body[chave];
  }
  if (isPlainObject(limpo.analyticsMeta)) {
    limpo.analyticsMeta = {
      ...limpo.analyticsMeta,
      createdByAgent: { actor: CAMPAIGN_AGENT_ACTOR, at: new Date().toISOString() },
    };
  }
  limpo.clientId = tenant;
  limpo.status = "draft";
  return limpo;
}

function guardCampaignBody(req, res, next) {
  const tenant = req.campaignAgentTenant;
  if (bodyAsksOtherTenant(req.body, tenant)) {
    return deny(res, 403, "CAMPAIGN_AGENT_OTHER_TENANT", "Este token só mexe na própria empresa.");
  }
  const motivo = describeForbiddenCampaignBody(req.body);
  if (motivo) return deny(res, 400, "CAMPAIGN_AGENT_DRAFT_ONLY", motivo);
  req.body = buildAgentCampaignBody(req.body, tenant);
  return next();
}

function guardTenantBody(req, res, next) {
  const tenant = req.campaignAgentTenant;
  if (!isPlainObject(req.body)) return deny(res, 400, "INVALID_BODY", "Corpo inválido.");
  if (bodyAsksOtherTenant(req.body, tenant)) {
    return deny(res, 403, "CAMPAIGN_AGENT_OTHER_TENANT", "Este token só mexe na própria empresa.");
  }
  const { client_id: _descartado, ...resto } = req.body;
  req.body = { ...resto, clientId: tenant };
  return next();
}

/**
 * Lê a campanha e confere que o agente ainda pode tocar nela. Devolve { campaign } ou { status, code, message }.
 * Campanha de outra empresa responde 404, igual a campanha que não existe: o token não serve para sondar ids.
 */
export async function loadEditableAgentDraft({ supabase, campaignId, tenant }) {
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("id, client_id, name, import_id, status, is_recurring, archived_at, analytics_meta, campaign_prompt_id, mode, created_at")
    .eq("id", campaignId)
    .single();
  if (error || !campaign || campaign.client_id !== tenant) {
    return { status: 404, code: "CAMPAIGN_NOT_FOUND", message: "Campanha não encontrada." };
  }
  if (campaign.status !== "draft" || campaign.is_recurring || campaign.archived_at) {
    return {
      status: 409,
      code: "CAMPAIGN_AGENT_NOT_A_DRAFT",
      message: "Esta campanha não é mais rascunho: o agente não edita campanha agendada, recorrente, arquivada ou já disparada.",
    };
  }
  const { data: lotes, error: lotesError } = await supabase
    .from("campaign_dispatches")
    .select("id")
    .eq("campaign_id", campaignId)
    .limit(1);
  if (lotesError) {
    return { status: 500, code: "CAMPAIGN_AGENT_CHECK_FAILED", message: "Não foi possível conferir os lotes da campanha." };
  }
  if (Array.isArray(lotes) && lotes.length > 0) {
    return {
      status: 409,
      code: "CAMPAIGN_AGENT_HAS_DISPATCHES",
      message: "Esta campanha já tem lote de envio: o agente não edita mais.",
    };
  }
  return { campaign };
}

/**
 * Rotas de campanha do agente. Recebe os MESMOS handlers da tela (criar, editar, salvar roteiro), para o rascunho do
 * agente passar pelas mesmas validações de conteúdo e origem que o rascunho feito à mão.
 */
export function registerCampaignAgentRoutes(app, { supabase, ensureDb, handleCreateCampaign, handleUpdateCampaign, handleSaveCampaignPrompt }) {
  const guardEditableDraft = async (req, res, next) => {
    if (!ensureDb(res)) return;
    try {
      const resultado = await loadEditableAgentDraft({
        supabase,
        campaignId: String(req.params?.id || "").trim(),
        tenant: req.campaignAgentTenant,
      });
      if (!resultado.campaign) return deny(res, resultado.status, resultado.code, resultado.message);
      req.campaignAgentDraft = resultado.campaign;
      return next();
    } catch (error) {
      console.error("[campaign-agent] erro ao conferir rascunho:", error);
      return deny(res, 500, "CAMPAIGN_AGENT_CHECK_FAILED", "Não foi possível conferir a campanha.");
    }
  };

  app.post("/api/campaign-agent/drafts", requireCampaignAgentToken, guardCampaignBody, handleCreateCampaign);

  app.patch("/api/campaign-agent/drafts/:id", requireCampaignAgentToken, guardCampaignBody, guardEditableDraft, handleUpdateCampaign);

  app.get("/api/campaign-agent/drafts/:id", requireCampaignAgentToken, guardEditableDraft, (req, res) => {
    res.json({ item: req.campaignAgentDraft });
  });

  app.put("/api/campaign-agent/prompts", requireCampaignAgentToken, guardTenantBody, handleSaveCampaignPrompt);
}

/** Importação da base de leads pelo agente: o mesmo handler da tela, com a empresa presa à do token. */
export function registerCampaignAgentLeadImportRoute(app, { handleCreateLeadImport }) {
  app.post("/api/campaign-agent/lead-imports", requireCampaignAgentToken, guardTenantBody, handleCreateLeadImport);
}
