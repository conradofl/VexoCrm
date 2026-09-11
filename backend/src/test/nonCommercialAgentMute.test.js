// backend/src/test/nonCommercialAgentMute.test.js
// Testes para a feature de silenciamento de conversas sem intenção comercial.
//
// Cobre:
// 1. Conversa pessoal evidente → silencia, grava motivo, próxima mensagem descartada sem chamar o LLM
// 2. Conversa ambígua / comercial → não silencia ("na dúvida, false")
// 3. Cada uma das cinco travas de segurança (bloqueia silenciamento mesmo com a IA pedindo):
//    - Trava 1: open_budget ou buyer
//    - Trava 2: lead com resumo comercial prévio (temConversaComercial)
//    - Trava 3: stage_source = 'manual'
//    - Trava 4: hasCampaignMatch = true (resposta a disparo)
//    - Trava 5: freio de emergência diário (>= dailyLimit)
// 4. Humano responde (fromMe) → silenciamento se desfaz
// 5. "Reativar agente" (unmute) volta o estado e a próxima mensagem é respondida
// 6. Conversa silenciada continua ativa nas abas da tela Conversas (sem estado novo)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { shouldEngageInbound, INBOUND_SCOPE_LEADS_ONLY, INBOUND_SCOPE_ALL } from "../services/inboundEngagementPolicy.js";
import {
  evaluateAgentMuteGuards,
  recordAgentMute,
  clearAgentMute,
  isChatAgentMuted,
  countTenantMutedToday,
  getTenantMutedStats,
} from "../services/agentMuteGuard.js";
import { temConversaComercial } from "../services/conversationInsightHelper.js";
import { parseAIResponse } from "../chatbot-ai-engine.js";

describe("Detecção de conversa não-comercial (parseAIResponse)", () => {
  it("conversa pessoal evidente marca nao_comercial: true e extrai o motivo", () => {
    const raw = JSON.stringify({
      mensagem: "Desculpe, acho que você se enganou de número.",
      classificacao: "desconhecido",
      finalizado: false,
      nao_comercial: true,
      motivo_nao_comercial: "Pedido de lanche pessoal (Monster, pão de queijo)",
    });

    const parsed = parseAIResponse(raw);
    expect(parsed.nao_comercial).toBe(true);
    expect(parsed.motivo_nao_comercial).toContain("Pedido de lanche");
  });

  it("conversa ambígua ou comercial mantém nao_comercial: false (regra: na dúvida, false)", () => {
    // Exemplo 1: JSON sem os campos
    const semCampos = JSON.stringify({
      mensagem: "Olá! Como posso te ajudar com os nossos produtos?",
      classificacao: "novo",
      finalizado: false,
    });
    const parsed1 = parseAIResponse(semCampos);
    expect(parsed1.nao_comercial).toBe(false);
    expect(parsed1.motivo_nao_comercial).toBeNull();

    // Exemplo 2: Explicitamente falso
    const falso = JSON.stringify({
      mensagem: "Perfeito, vou preparar a sua proposta.",
      classificacao: "qualificado",
      finalizado: false,
      nao_comercial: false,
      motivo_nao_comercial: null,
    });
    const parsed2 = parseAIResponse(falso);
    expect(parsed2.nao_comercial).toBe(false);
    expect(parsed2.motivo_nao_comercial).toBeNull();
  });
});

describe("Portão Único: shouldEngageInbound com isAgentMuted", () => {
  it("conversa silenciada (isAgentMuted=true) é descartada antes de chamar o LLM", () => {
    const res = shouldEngageInbound({
      scope: INBOUND_SCOPE_LEADS_ONLY,
      isKnownLead: true,
      hasCampaignMatch: false,
      isAgentMuted: true,
    });

    expect(res.engage).toBe(false);
    expect(res.reason).toBe("conversa_nao_comercial");
  });

  it("trava de isAgentMuted vale mesmo com scope 'all'", () => {
    const res = shouldEngageInbound({
      scope: INBOUND_SCOPE_ALL,
      isKnownLead: false,
      hasCampaignMatch: false,
      isAgentMuted: true,
    });

    expect(res.engage).toBe(false);
    expect(res.reason).toBe("conversa_nao_comercial");
  });

  it("quando não está silenciada (isAgentMuted=false), segue fluxo normal de engajamento", () => {
    const res = shouldEngageInbound({
      scope: INBOUND_SCOPE_LEADS_ONLY,
      isKnownLead: true,
      hasCampaignMatch: false,
      isAgentMuted: false,
    });

    expect(res.engage).toBe(true);
    expect(res.reason).toBeNull();
  });
});

describe("Cinco travas de segurança de código (evaluateAgentMuteGuards)", () => {
  const baseParams = {
    lead: { stage: "novo", stage_source: "auto" },
    hasCampaignMatch: false,
    dailyMutedCount: 0,
    dailyLimit: 20,
  };

  it("permite silenciamento quando nenhuma trava for violada", () => {
    const decision = evaluateAgentMuteGuards(baseParams);
    expect(decision.canMute).toBe(true);
    expect(decision.blockedBy).toBeNull();
  });

  it("Trava 1: bloqueia se lead estiver em open_budget", () => {
    const decision = evaluateAgentMuteGuards({
      ...baseParams,
      lead: { stage: "open_budget", stage_source: "auto" },
    });
    expect(decision.canMute).toBe(false);
    expect(decision.blockedBy).toBe("lead_em_estagio_comercial");
  });

  it("Trava 1: bloqueia se lead for marcado como buyer", () => {
    const decisionStage = evaluateAgentMuteGuards({
      ...baseParams,
      lead: { stage: "buyer" },
    });
    expect(decisionStage.canMute).toBe(false);
    expect(decisionStage.blockedBy).toBe("lead_em_estagio_comercial");
  });

  it("Trava 2: bloqueia se lead já possuir histórico/resumo comercial (temConversaComercial)", () => {
    const leadComResumo = {
      stage: "novo",
      chat_summary: "Cliente interessado em kit de placas solares com 8 módulos",
    };
    expect(temConversaComercial(leadComResumo)).toBe(true);

    const decision = evaluateAgentMuteGuards({
      ...baseParams,
      lead: leadComResumo,
    });
    expect(decision.canMute).toBe(false);
    expect(decision.blockedBy).toBe("lead_com_resumo_comercial");
  });

  it("Trava 3: bloqueia se lead teve estágio marcado manualmente por pessoa (stage_source = 'manual')", () => {
    const decision = evaluateAgentMuteGuards({
      ...baseParams,
      lead: { stage: "contatado", stage_source: "manual" },
    });
    expect(decision.canMute).toBe(false);
    expect(decision.blockedBy).toBe("estagio_marcado_manualmente");
  });

  it("Trava 4: bloqueia se contato respondeu a disparo de campanha (hasCampaignMatch = true)", () => {
    const decision = evaluateAgentMuteGuards({
      ...baseParams,
      hasCampaignMatch: true,
    });
    expect(decision.canMute).toBe(false);
    expect(decision.blockedBy).toBe("contato_de_campanha");
  });

  it("Trava 5: freio de emergência diário bloqueia e alerta se atingir o limite (dailyMutedCount >= dailyLimit)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const decision = evaluateAgentMuteGuards({
      ...baseParams,
      dailyMutedCount: 20,
      dailyLimit: 20,
    });
    expect(decision.canMute).toBe(false);
    expect(decision.blockedBy).toBe("freio_de_emergencia_diario");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ALERTA DE FREIO DE EMERGÊNCIA"),
      expect.anything()
    );

    errorSpy.mockRestore();
  });
});

describe("Persistência e Reversibilidade no Banco (whatsapp_chat_states)", () => {
  let mockRows = [];
  let mockPool;

  beforeEach(() => {
    mockRows = [];
    mockPool = {
      query: vi.fn(async (sql, params) => {
        const text = String(sql);
        if (text.includes("INSERT INTO public.whatsapp_chat_states")) {
          // params: [clientId, phone, mutedReason]
          const existing = mockRows.find(
            (r) => r.client_id === params[0] && r.phone === params[1]
          );
          if (existing) {
            existing.agent_muted_at = new Date().toISOString();
            existing.agent_muted_reason = params[2];
            existing.updated_at = new Date().toISOString();
          } else {
            mockRows.push({
              client_id: params[0],
              phone: params[1],
              state: "ativa",
              reason: null,
              source: "auto",
              agent_muted_at: new Date().toISOString(),
              agent_muted_reason: params[2],
              updated_at: new Date().toISOString(),
            });
          }
          return { rows: [] };
        }

        if (text.includes("SELECT agent_muted_at")) {
          const row = mockRows.find(
            (r) => r.client_id === params[0] && r.phone === params[1]
          );
          return { rows: row ? [{ agent_muted_at: row.agent_muted_at }] : [] };
        }

        if (text.includes("UPDATE public.whatsapp_chat_states") && text.includes("agent_muted_at = NULL")) {
          const row = mockRows.find(
            (r) => r.client_id === params[0] && r.phone === params[1]
          );
          if (row) {
            row.agent_muted_at = null;
            row.agent_muted_reason = null;
            row.updated_at = new Date().toISOString();
          }
          return { rows: [] };
        }

        if (text.includes("COUNT(*)::integer as total") && text.includes("agent_muted_at >=")) {
          const todayCount = mockRows.filter(
            (r) => r.client_id === params[0] && r.agent_muted_at !== null
          ).length;
          return { rows: [{ total: todayCount }] };
        }

        if (text.includes("GROUP BY COALESCE(agent_muted_reason")) {
          const grouped = {};
          for (const r of mockRows) {
            if (r.client_id === params[0] && r.agent_muted_at) {
              const reason = r.agent_muted_reason || "Não especificado";
              grouped[reason] = (grouped[reason] || 0) + 1;
            }
          }
          return {
            rows: Object.entries(grouped).map(([reason, count]) => ({ reason, count })),
          };
        }

        return { rows: [] };
      }),
    };
  });

  it("grava silenciamento mantendo o state como 'ativa' (não some das abas)", async () => {
    await recordAgentMute(mockPool, {
      clientId: "geracao-digital",
      phone: "5534992896464",
      reason: "Pedido de lanche pessoal",
    });

    expect(mockRows).toHaveLength(1);
    expect(mockRows[0].state).toBe("ativa"); // Não cria estado novo!
    expect(mockRows[0].agent_muted_at).toBeTruthy();
    expect(mockRows[0].agent_muted_reason).toBe("Pedido de lanche pessoal");

    const isMuted = await isChatAgentMuted(mockPool, "geracao-digital", "5534992896464");
    expect(isMuted).toBe(true);
  });

  it("humano responde no celular ou clica 'Reativar agente' → silenciamento se desfaz (clearAgentMute)", async () => {
    // 1. Silencia
    await recordAgentMute(mockPool, {
      clientId: "geracao-digital",
      phone: "5534992896464",
      reason: "Conversa pessoal",
    });
    expect(await isChatAgentMuted(mockPool, "geracao-digital", "5534992896464")).toBe(true);

    // 2. Humano responde (fromMe) ou clica Reativar
    await clearAgentMute(mockPool, {
      clientId: "geracao-digital",
      phone: "5534992896464",
    });

    expect(await isChatAgentMuted(mockPool, "geracao-digital", "5534992896464")).toBe(false);
    expect(mockRows[0].agent_muted_at).toBeNull();
    expect(mockRows[0].agent_muted_reason).toBeNull();

    // 3. Próxima mensagem pode engajar normalmente
    const decisao = shouldEngageInbound({
      scope: INBOUND_SCOPE_LEADS_ONLY,
      isKnownLead: true,
      hasCampaignMatch: false,
      isAgentMuted: false,
    });
    expect(decisao.engage).toBe(true);
  });

  it("contabiliza silenciamentos por tenant e por motivo para freio de emergência", async () => {
    await recordAgentMute(mockPool, {
      clientId: "tenant-a",
      phone: "5511999990001",
      reason: "Conversa pessoal",
    });
    await recordAgentMute(mockPool, {
      clientId: "tenant-a",
      phone: "5511999990002",
      reason: "Conversa pessoal",
    });
    await recordAgentMute(mockPool, {
      clientId: "tenant-a",
      phone: "5511999990003",
      reason: "Engano / número trocado",
    });

    const countToday = await countTenantMutedToday(mockPool, "tenant-a");
    expect(countToday).toBe(3);

    const stats = await getTenantMutedStats(mockPool, "tenant-a");
    expect(stats.totalToday).toBe(3);
    expect(stats.byReason["Conversa pessoal"]).toBe(2);
    expect(stats.byReason["Engano / número trocado"]).toBe(1);
  });
});
