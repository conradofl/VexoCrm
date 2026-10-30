// Passo de campanha com resposta pendente sai pelo caminho 1 do webhook,
// qualquer que seja o estado do agente do chip: ligado, desligado ou Disparo.
//
// Por que existe: a trava "agente de atendimento não liga sem prompt" só pode
// subir se desligar o agente (ou trocar a Função para Disparo) não parar a
// campanha. O dono usava o botão "ligado" como chave de campanha. Este teste é
// a prova antes da trava, e é ele que autoriza a frase "os passos da campanha
// continuam funcionando do mesmo jeito" no texto do cliente.
//
// O que é real aqui: o handler do webhook, a resolução do agente pelo chip
// (resolveInboundAgentConfig, lendo followup_companies) e os portões. O que é
// dublê: só a entrada (findCampaignReplyMatches, que acha a campanha) e a
// saída (continueCampaignLeadFromReply, que envia o passo). Cada cenário tem um
// controle sem campanha que prova que o agente foi resolvido no estado pedido;
// sem o controle, o teste passaria com agente nenhum.
import { describe, expect, it, vi } from "vitest";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";

const CLIENT = "tenant-trava";
const PHONE = "5534996895453";
const CHIP = "chip-a";

function agentRow({ ligado, kind }) {
  return {
    id: "agente-1",
    evolution_instance: CHIP,
    evolution_instances: [CHIP],
    inbound_role: "atendimento",
    inbound_enabled: ligado,
    inbound_model: null,
    inbound_prompt: null,
    inbound_spin_fields: [],
    inbound_webhook_url: null,
    sdr_whatsapp_number: null,
    sdr_transfer_enabled: false,
    instructions_consolidated_at: null,
    agent_kind: kind,
    inbound_extraction_prompt: null,
    inbound_extraction_enabled: true,
  };
}

// Encadeamento estilo supabase-js: todo método devolve o próprio objeto, e o
// await resolve conforme a tabela. followup_companies devolve o agente do
// cenário; a tabela de leads devolve vazio (lead desconhecido).
function makeSupabase({ agents }) {
  return {
    from: vi.fn((table) => {
      const result =
        table === "followup_companies" ? { data: agents, error: null } : { data: [], error: null };
      const chain = {};
      for (const m of ["select", "eq", "in", "is", "gte", "lte", "order", "limit", "insert", "update", "upsert", "delete", "neq", "not", "or"]) {
        chain[m] = vi.fn(() => chain);
      }
      chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      chain.single = vi.fn(async () => ({ data: null, error: null }));
      chain.then = (ok, fail) => Promise.resolve(result).then(ok, fail);
      chain.catch = (fail) => Promise.resolve(result).catch(fail);
      return chain;
    }),
  };
}

function campanhaComPassoPendente() {
  const campanha = {
    id: "camp-1",
    name: "Campanha com passo após resposta",
    analyticsMeta: {
      sequence: [
        { id: "s1", type: "text", order: 1, text: "Oi!", triggerMode: "immediate", enabled: true },
        { id: "s2", type: "text", order: 2, text: "Segundo passo", triggerMode: "after_reply", enabled: true },
      ],
      dispatchOptions: { waitForReply: true },
    },
    leadImportItem: {
      id: "item-1",
      progress: { waitForReply: true, status: "aguardando_usuario", nextStepIndex: 1 },
    },
  };
  return {
    matches: [campanha],
    waitForReplyMatches: [campanha],
    processingWaitForReplyMatches: [campanha],
    activePeriodCampaign: { id: "camp-1", name: campanha.name, mode: "disparo" },
  };
}

function semCampanha() {
  return { matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [], activePeriodCampaign: null };
}

function montar({ agents, campanha }) {
  const continueCampaignLeadFromReply = vi.fn(async () => ({
    continued: true,
    finalized: false,
    campaignFinalized: false,
    reason: "step_sent",
  }));
  const routes = {};
  const app = {};
  for (const verbo of ["post", "get", "delete", "put", "patch"]) {
    app[verbo] = vi.fn((path, ...handlers) => {
      routes[`${verbo.toUpperCase()} ${path}`] = handlers[handlers.length - 1];
    });
  }
  registerChatbotRoutes(app, {
    ensureDb: () => true,
    getLeadClientEvolutionInstances: async () => [],
    // chatbot_enabled=false: sem agente no chip, o descarte seria
    // "chatbot_disabled". Com agente, o portão do agente decide — é o que os
    // controles usam para provar que o agente foi resolvido.
    getLeadClientN8nSettings: vi.fn(async (clientId) => ({
      clientId,
      chatbot_enabled: false,
      chatbot_inbound_scope: "leads_only",
    })),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    leadsTableName: (c) => `leads_${c}`,
    maskPhoneForLog: (p) => p,
    MAX_LEADS_OUTLIER_BATCH: 100,
    continueCampaignLeadFromReply,
    findCampaignReplyMatches: vi.fn(async () => campanha),
    normalizeString: (s) => (s ? String(s).trim() : ""),
    normalizeTenantKey: (k) => k,
    pgDatabasePool: { query: vi.fn(async () => ({ rows: [] })) },
    requireAppViewAccess: () => (_req, _res, next) => next(),
    requireFirebaseAuth: (_req, _res, next) => next(),
    resolveAuthorizedClientId: (_req, _res, cid) => cid || CLIENT,
    resolveDispatchWebhookSettings: async () => ({}),
    resolveInboundDispatchSettings: async () => ({}),
    sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
    sendError: vi.fn(),
    supabase: makeSupabase({ agents }),
    validateLeadsOutlierRecord: () => true,
    validateN8nInboundBearer: () => true,
  });
  return { webhook: routes["POST /api/hardcoded-chat-webhook"], continueCampaignLeadFromReply };
}

async function respostaDoLead(webhook, waId) {
  let resposta = null;
  const res = { json: vi.fn((data) => { resposta = data; }) };
  await webhook(
    {
      body: {
        event: "messages.upsert",
        clientId: CLIENT,
        instance: CHIP,
        phone: PHONE,
        data: {
          key: { remoteJid: `${PHONE}@s.whatsapp.net`, fromMe: false, id: waId },
          message: { conversation: "Tenho interesse, me conta mais" },
          messageTimestamp: 1788212600,
        },
      },
      query: {},
    },
    res
  );
  // O envio do passo roda numa função assíncrona depois do 200.
  await new Promise((r) => setTimeout(r, 20));
  return resposta;
}

const cenarios = [
  { nome: "agente de atendimento LIGADO", agente: { ligado: true, kind: "atendimento" }, controle: "desconhecido_sem_lead" },
  { nome: "agente de atendimento DESLIGADO", agente: { ligado: false, kind: "atendimento" }, controle: "inbound_disabled" },
  { nome: "agente de DISPARO ligado", agente: { ligado: true, kind: "campanha" }, controle: "chip_campanha_sem_atendimento" },
  { nome: "agente de DISPARO desligado", agente: { ligado: false, kind: "campanha" }, controle: "inbound_disabled" },
];

describe("passo de campanha pendente sai pelo caminho 1, qualquer que seja o agente do chip", () => {
  for (const { nome, agente, controle } of cenarios) {
    it(`controle sem campanha: o ${nome} foi resolvido no chip (descarte "${controle}")`, async () => {
      const { webhook, continueCampaignLeadFromReply } = montar({
        agents: [agentRow(agente)],
        campanha: semCampanha(),
      });
      const resposta = await respostaDoLead(webhook, `WA-CTRL-${controle}-${agente.kind}`);
      expect(resposta).toMatchObject({ success: true, ignored: controle });
      expect(continueCampaignLeadFromReply).not.toHaveBeenCalled();
    });

    it(`com ${nome}: a resposta dispara o passo 2 pelo caminho 1`, async () => {
      const { webhook, continueCampaignLeadFromReply } = montar({
        agents: [agentRow(agente)],
        campanha: campanhaComPassoPendente(),
      });
      const resposta = await respostaDoLead(webhook, `WA-CAMP-${agente.ligado}-${agente.kind}`);
      expect(resposta).toMatchObject({ success: true, status: "campaign_step_dispatched" });
      expect(continueCampaignLeadFromReply).toHaveBeenCalledTimes(1);
      expect(continueCampaignLeadFromReply).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: CLIENT,
          phone: PHONE,
          campaignMatch: expect.objectContaining({ id: "camp-1" }),
        })
      );
    });
  }
});
