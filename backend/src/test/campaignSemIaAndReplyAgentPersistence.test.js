import { describe, expect, it, vi } from "vitest";
import {
  normalizeCampaignAnalyticsMeta,
  validateCampaignAnalyticsMeta,
} from "../campaign-outbound.js";
import {
  resolveCampaignAgent,
  AGENTE_CAMPANHA,
  AGENTE_ATENDIMENTO,
  AGENTE_NENHUM,
} from "../services/campaignAgentRouting.js";
import { createLeadMessaging } from "../domains/shared/leadMessaging.js";

describe("Persistência e Roteamento de replyAgent (Sem IA / Campanha / Atendimento)", () => {
  it("1. normalizeCampaignAnalyticsMeta preserva dispatchOptions.replyAgent ('passos', 'campanha', 'atendimento')", () => {
    const metaPassos = normalizeCampaignAnalyticsMeta({
      message: "Oi",
      sequence: [{ id: "1", type: "text", order: 1, text: "Oi", enabled: true }],
      dispatchOptions: {
        replyAgent: "passos",
        waitForReply: true,
      },
    });
    expect(metaPassos.dispatchOptions.replyAgent).toBe("passos");

    const metaCampanha = normalizeCampaignAnalyticsMeta({
      message: "Oi",
      sequence: [{ id: "1", type: "text", order: 1, text: "Oi", enabled: true }],
      dispatchOptions: {
        replyAgent: "campanha",
        waitForReply: true,
      },
    });
    expect(metaCampanha.dispatchOptions.replyAgent).toBe("campanha");

    const metaAtendimento = normalizeCampaignAnalyticsMeta({
      message: "Oi",
      sequence: [{ id: "1", type: "text", order: 1, text: "Oi", enabled: true }],
      dispatchOptions: {
        replyAgent: "atendimento",
        waitForReply: false,
      },
    });
    expect(metaAtendimento.dispatchOptions.replyAgent).toBe("atendimento");
  });

  it("2. validateCampaignAnalyticsMeta valida com sucesso campanha com replyAgent", () => {
    const val = validateCampaignAnalyticsMeta({
      message: "Oi",
      sequence: [{ id: "1", type: "text", order: 1, text: "Oi", enabled: true }],
      dispatchOptions: {
        replyAgent: "passos",
        waitForReply: true,
      },
    });
    expect(val.valid).toBe(true);
    expect(val.analyticsMeta.dispatchOptions.replyAgent).toBe("passos");
  });

  it("3. resolveCampaignAgent: 'passos' retorna AGENTE_NENHUM com bloqueado: true (Trava Dura)", () => {
    const escolha = resolveCampaignAgent({
      id: "camp-sonhare",
      name: "Campanha Ativação 1",
      analytics_meta: {
        dispatchOptions: {
          replyAgent: "passos",
        },
      },
    });

    expect(escolha.agente).toBe(AGENTE_NENHUM);
    expect(escolha.bloqueado).toBe(true);
    expect(escolha.porque).toContain("Sem IA");
  });

  it("4. resolveCampaignAgent: retrocompatibilidade para campanhas antigas sem replyAgent gravado", () => {
    // Campanha legada com roteiro próprio -> agente da campanha
    const legadaComRoteiro = resolveCampaignAgent({
      id: "camp-antiga-1",
      campaign_prompt_id: "prompt-123",
      analytics_meta: {},
    });
    expect(legadaComRoteiro.agente).toBe(AGENTE_CAMPANHA);
    expect(legadaComRoteiro.campaignPromptId).toBe("prompt-123");

    // Campanha legada sem roteiro -> atendimento padrão (Geração Digital / clientes existentes)
    const legadaSemRoteiro = resolveCampaignAgent({
      id: "camp-antiga-2",
      campaign_prompt_id: null,
      mode: "disparo",
      analytics_meta: {},
    });
    expect(legadaSemRoteiro.agente).toBe(AGENTE_ATENDIMENTO);
    expect(legadaSemRoteiro.campaignPromptId).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO — achado da leva 'Um agente por chip'] replyAgent 'atendimento' COM roteiro: o roteiro NÃO é descartado — 'atendimento' decide quem fala, não se o roteiro entra", () => {
    // Contra o código de antes desta correção: campaignPromptId vinha null
    // aqui, e o roteiro da campanha nunca chegava no prompt enviado ao
    // modelo — mesmo a campanha tendo roteiro salvo.
    const escolha = resolveCampaignAgent({
      id: "camp-atendimento-com-roteiro",
      campaignPromptId: "prompt-oferta-xyz",
      analytics_meta: {
        dispatchOptions: { replyAgent: "atendimento" },
      },
    });

    expect(escolha.agente).toBe(AGENTE_ATENDIMENTO); // quem fala continua sendo o agente do chip
    expect(escolha.campaignPromptId).toBe("prompt-oferta-xyz"); // mas o roteiro NÃO é descartado
  });

  it("replyAgent 'atendimento' SEM roteiro: campaignPromptId continua nulo (não há o que compor)", () => {
    const escolha = resolveCampaignAgent({
      id: "camp-atendimento-sem-roteiro",
      campaignPromptId: null,
      analytics_meta: {
        dispatchOptions: { replyAgent: "atendimento" },
      },
    });

    expect(escolha.agente).toBe(AGENTE_ATENDIMENTO);
    expect(escolha.campaignPromptId).toBeNull();
  });

  it("5. createLeadMessaging: appendLeadMessage falha visivelmente se conexão com banco estiver ausente", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { appendLeadMessage } = createLeadMessaging({
      supabase: null,
      normalizeString: (s) => String(s || "").trim(),
      leadsTableName: () => "leads",
      isMissingSchemaError: () => false,
    });

    // Se liveSupabase também for null, deve lançar erro e logar console.error (sem silêncio!)
    await expect(
      appendLeadMessage({
        clientId: "sonhare",
        phone: "553499999999",
        direction: "outbound",
        senderType: "bot",
        messageText: "Teste",
      })
    ).rejects.toThrow(/Conexão com banco de dados indisponível/);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[lead-messages] ERRO CRÍTICO"),
      expect.anything()
    );

    consoleErrorSpy.mockRestore();
  });
});
