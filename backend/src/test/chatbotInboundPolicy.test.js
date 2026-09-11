// Tres defeitos que chegaram no cliente, todos no caminho de entrada do chatbot.
//
// 1. Lead que respondeu a uma CAMPANHA era atendido com o roteiro de quem
//    procurou a empresa, porque o ramo "disparo" usava o prompt padrao.
// 2. Qualquer pessoa que escrevesse para o numero recebia atendimento de robo —
//    a mae do dono conversou com o bot.
// 3. "no SDR number configured" aparecia com o numero salvo na tela, porque
//    transferencia desligada, numero ausente e FALHA DE LEITURA caiam todos na
//    mesma frase.

import { describe, expect, it } from "vitest";
import {
  resolveInboundScope,
  shouldEngageInbound,
  INBOUND_SCOPE_ALL,
  INBOUND_SCOPE_LEADS_ONLY,
} from "../services/inboundEngagementPolicy.js";
import { resolveSdrTarget, SDR_MOTIVOS } from "../services/sdrTarget.js";
import {
  resolveCampaignAgent,
  AGENTE_CAMPANHA,
  AGENTE_ATENDIMENTO,
  AGENTE_NENHUM,
} from "../services/campaignAgentRouting.js";

describe("escopo de inbound: quem o chatbot pode atender", () => {
  it("padrao seguro: sem configuracao, so lead conhecido", () => {
    expect(resolveInboundScope(null)).toBe(INBOUND_SCOPE_LEADS_ONLY);
    expect(resolveInboundScope({})).toBe(INBOUND_SCOPE_LEADS_ONLY);
    expect(resolveInboundScope({ chatbot_inbound_scope: null })).toBe(INBOUND_SCOPE_LEADS_ONLY);
  });

  it("so o literal 'all' abre para todos", () => {
    expect(resolveInboundScope({ chatbot_inbound_scope: "all" })).toBe(INBOUND_SCOPE_ALL);
    expect(resolveInboundScope({ chatbot_inbound_scope: "ALL" })).toBe(INBOUND_SCOPE_ALL);
    // Qualquer lixo cai no restrito, nao no permissivo.
    expect(resolveInboundScope({ chatbot_inbound_scope: "todos" })).toBe(INBOUND_SCOPE_LEADS_ONLY);
    expect(resolveInboundScope({ chatbot_inbound_scope: "tudo" })).toBe(INBOUND_SCOPE_LEADS_ONLY);
  });

  it("numero desconhecido NAO engaja: nem LLM, nem envio", () => {
    const decisao = shouldEngageInbound({
      scope: INBOUND_SCOPE_LEADS_ONLY,
      isKnownLead: false,
      hasCampaignMatch: false,
    });
    expect(decisao.engage).toBe(false);
    expect(decisao.reason).toBe("desconhecido_sem_lead");
  });

  it("lead conhecido engaja", () => {
    expect(
      shouldEngageInbound({ scope: INBOUND_SCOPE_LEADS_ONLY, isKnownLead: true, hasCampaignMatch: false }).engage
    ).toBe(true);
  });

  it("telefone vindo de campanha engaja mesmo sem registro de lead", () => {
    expect(
      shouldEngageInbound({ scope: INBOUND_SCOPE_LEADS_ONLY, isKnownLead: false, hasCampaignMatch: true }).engage
    ).toBe(true);
  });

  it("escopo 'all' engaja desconhecido, por escolha do cliente", () => {
    expect(
      shouldEngageInbound({ scope: INBOUND_SCOPE_ALL, isKnownLead: false, hasCampaignMatch: false }).engage
    ).toBe(true);
  });

  it("numero de SDR NAO engaja mesmo em escopo 'all'", () => {
    const decisao = shouldEngageInbound({
      scope: INBOUND_SCOPE_ALL,
      isKnownLead: true,
      hasCampaignMatch: true,
      isSdrNumber: true,
    });
    expect(decisao.engage).toBe(false);
    expect(decisao.reason).toBe("numero_e_do_sdr");
  });

  it("conversa silenciada (isAgentMuted: true) NAO engaja mesmo em escopo 'all' ou lead conhecido", () => {
    const decisao = shouldEngageInbound({
      scope: INBOUND_SCOPE_ALL,
      isKnownLead: true,
      hasCampaignMatch: true,
      isAgentMuted: true,
    });
    expect(decisao.engage).toBe(false);
    expect(decisao.reason).toBe("conversa_nao_comercial");
  });
});

describe("destino da notificacao de SDR", () => {
  it("transferencia desligada no agente: ninguem, e o motivo NAO e 'sem numero'", () => {
    const alvo = resolveSdrTarget({
      inboundConfig: { sdrTransferEnabled: false, sdrPhone: "5534999990000" },
      tenantSettings: { sdr_whatsapp_number: "5534984085015" },
    });
    expect(alvo.number).toBeNull();
    expect(alvo.reason).toBe(SDR_MOTIVOS.TRANSFERENCIA_DESLIGADA);
  });

  it("numero do agente tem precedencia sobre o do tenant", () => {
    const alvo = resolveSdrTarget({
      inboundConfig: { sdrTransferEnabled: true, sdrPhone: "5534999990000" },
      tenantSettings: { sdr_whatsapp_number: "5534984085015" },
    });
    expect(alvo.number).toBe("5534999990000");
    expect(alvo.reason).toBe(SDR_MOTIVOS.OK);
  });

  it("agente sem numero proprio cai no numero do tenant", () => {
    const alvo = resolveSdrTarget({
      inboundConfig: { sdrTransferEnabled: true, sdrPhone: null },
      tenantSettings: { sdr_whatsapp_number: "5534984085015" },
    });
    expect(alvo.number).toBe("5534984085015");
  });

  it("sem agente inbound usa o numero do tenant", () => {
    const alvo = resolveSdrTarget({
      inboundConfig: null,
      tenantSettings: { sdr_whatsapp_number: "5534984085015" },
    });
    expect(alvo.number).toBe("5534984085015");
    expect(alvo.reason).toBe(SDR_MOTIVOS.OK);
  });

  it("falha de LEITURA nao vira 'nao configurado'", () => {
    // Este era o defeito: settings null por erro de consulta e o log dizia que
    // nao havia numero, com o numero salvo na tela.
    const alvo = resolveSdrTarget({
      inboundConfig: null,
      tenantSettings: null,
      tenantSettingsReadFailed: true,
    });
    expect(alvo.number).toBeNull();
    expect(alvo.reason).toBe(SDR_MOTIVOS.LEITURA_FALHOU);
    expect(alvo.reason).not.toBe(SDR_MOTIVOS.SEM_NUMERO);
  });

  it("numero realmente ausente e reportado como ausente", () => {
    const alvo = resolveSdrTarget({ inboundConfig: null, tenantSettings: {} });
    expect(alvo.number).toBeNull();
    expect(alvo.reason).toBe(SDR_MOTIVOS.SEM_NUMERO);
  });
});

describe("qual agente atende o lead que respondeu", () => {
  it("campanha ativa COM roteiro proprio: agente da campanha", () => {
    const escolha = resolveCampaignAgent({ id: "c1", campaignPromptId: "prompt-1", mode: "disparo" });
    expect(escolha.agente).toBe(AGENTE_CAMPANHA);
    expect(escolha.campaignPromptId).toBe("prompt-1");
  });

  it("o gatilho e o ROTEIRO, nao o mode: campanha 'disparo' com roteiro usa o da campanha", () => {
    // O defeito era exatamente este: mode 'disparo' caia no prompt padrao e o
    // roteiro da campanha ficava inalcancavel.
    const escolha = resolveCampaignAgent({ id: "c2", campaignPromptId: "prompt-2", mode: "disparo" });
    expect(escolha.agente).toBe(AGENTE_CAMPANHA);
  });

  it("campanha SEM roteiro: agente de atendimento, comportamento de hoje preservado", () => {
    const escolha = resolveCampaignAgent({ id: "c3", campaignPromptId: null, mode: "disparo" });
    expect(escolha.agente).toBe(AGENTE_ATENDIMENTO);
    expect(escolha.campaignPromptId).toBeNull();
    expect(escolha.configuracaoIncompleta).toBe(false);
  });

  it("sem campanha ativa: agente de atendimento", () => {
    const escolha = resolveCampaignAgent(null);
    expect(escolha.agente).toBe(AGENTE_ATENDIMENTO);
    expect(escolha.porque).toContain("nenhuma campanha ativa");
  });

  it("marcada como agente e sem roteiro: atende assim mesmo, mas sinaliza", () => {
    const escolha = resolveCampaignAgent({ id: "c4", campaignPromptId: null, mode: "agente" });
    expect(escolha.agente).toBe(AGENTE_ATENDIMENTO);
    expect(escolha.configuracaoIncompleta).toBe(true);
  });

  it("campanha explicitamente 'Sem IA' (replyAgent: passos): bloqueia resposta com AGENTE_NENHUM", () => {
    const escolha = resolveCampaignAgent({
      id: "c-sem-ia",
      campaignPromptId: null,
      mode: "disparo",
      analytics_meta: { dispatchOptions: { replyAgent: "passos" } },
    });
    expect(escolha.agente).toBe(AGENTE_NENHUM);
    expect(escolha.bloqueado).toBe(true);
    expect(escolha.porque).toContain("Sem IA");
  });

  it("campanha explicitamente 'Qualificar com roteiro' (replyAgent: campanha)", () => {
    const escolha = resolveCampaignAgent({
      id: "c-roteiro",
      campaignPromptId: "prompt-xyz",
      analytics_meta: { dispatchOptions: { replyAgent: "campanha" } },
    });
    expect(escolha.agente).toBe(AGENTE_CAMPANHA);
    expect(escolha.campaignPromptId).toBe("prompt-xyz");
  });

  it("campanha explicitamente 'Qualificar com atendimento padrão' (replyAgent: atendimento)", () => {
    const escolha = resolveCampaignAgent({
      id: "c-atendimento",
      campaignPromptId: null,
      analytics_meta: { dispatchOptions: { replyAgent: "atendimento" } },
    });
    expect(escolha.agente).toBe(AGENTE_ATENDIMENTO);
    expect(escolha.campaignPromptId).toBeNull();
  });
});
