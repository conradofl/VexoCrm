import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractBriefingWithAI } from "../chatbot-ai-engine.js";
import { resolveInboundAgentConfig } from "../services/inboundAgent.js";

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || "chave-de-teste";

describe("Urgente 2 — Extração de briefing com IA para o closer", () => {
  let fetchSpy;
  let chamadas = [];

  beforeEach(() => {
    chamadas = [];
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.body) {
        chamadas.push(JSON.parse(init.body));
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "Card de qualificação gerado pela IA com sucesso" } }],
        }),
        text: async () => "Card de qualificação gerado pela IA com sucesso",
      };
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("1. extractionEnabled: false explicitamente -> retorna null e NÃO chama LLM (economiza cota e não gera card)", async () => {
    const res = await extractBriefingWithAI({
      supabase: {},
      clientId: "tenant-1",
      phone: "5511999999999",
      history: [{ role: "user", content: "Olá" }],
      collectedData: { nome: "João" },
      classificacao: "quente",
      extractionEnabled: false,
    });

    expect(res).toBeNull();
    expect(chamadas).toHaveLength(0);
  });

  it("2. agentConfig.extractionEnabled === false -> retorna null e NÃO chama LLM", async () => {
    const res = await extractBriefingWithAI({
      supabase: {},
      clientId: "tenant-1",
      phone: "5511999999999",
      history: [{ role: "user", content: "Olá" }],
      collectedData: { nome: "João" },
      classificacao: "quente",
      agentConfig: {
        extractionEnabled: false,
        extractionPrompt: "Instruções do agente",
      },
    });

    expect(res).toBeNull();
    expect(chamadas).toHaveLength(0);
  });

  it("3. agentConfig com prompt próprio de extração -> usa o prompt do agente como system prompt", async () => {
    const res = await extractBriefingWithAI({
      supabase: {},
      clientId: "tenant-1",
      phone: "5511999999999",
      history: [{ role: "user", content: "Quero agendar" }],
      collectedData: { nome: "Maria" },
      classificacao: "quente",
      agentConfig: {
        extractionEnabled: true,
        extractionPrompt: "Prompt exclusivo do agente para montar card do closer.",
      },
    });

    expect(res).toBe("Card de qualificação gerado pela IA com sucesso");
    expect(chamadas).toHaveLength(1);
    const systemMsg = chamadas[0].messages.find((m) => m.role === "system");
    expect(systemMsg?.content).toBe("Prompt exclusivo do agente para montar card do closer.");
  });

  it("4. agentConfig sem prompt próprio -> herda do banco ('extrato' do tenant)", async () => {
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { content: "Prompt padrão 'extrato' do tenant" },
                error: null,
              }),
            }),
          }),
        }),
      }),
    };

    const res = await extractBriefingWithAI({
      supabase: mockSupabase,
      clientId: "tenant-1",
      phone: "5511999999999",
      history: [{ role: "user", content: "Quero comprar" }],
      collectedData: { nome: "Carlos" },
      classificacao: "morno",
      agentConfig: {
        extractionEnabled: true,
        extractionPrompt: null,
      },
    });

    expect(res).toBe("Card de qualificação gerado pela IA com sucesso");
    expect(chamadas).toHaveLength(1);
    const systemMsg = chamadas[0].messages.find((m) => m.role === "system");
    expect(systemMsg?.content).toBe("Prompt padrão 'extrato' do tenant");
  });

  it("5. resolveInboundAgentConfig mapeia inbound_extraction_prompt e inbound_extraction_enabled", async () => {
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "agent-123",
                    evolution_instance: "chip-slug",
                    evolution_instances: ["chip-slug"],
                    inbound_role: "atendimento",
                    inbound_enabled: true,
                    inbound_model: "openai/gpt-4o",
                    inbound_prompt: "Prompt do bot",
                    inbound_extraction_prompt: "Prompt customizado de extração",
                    inbound_extraction_enabled: true,
                    agent_kind: "atendimento",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    };

    const config = await resolveInboundAgentConfig({
      supabase: mockSupabase,
      clientId: "tenant-1",
      agentId: "agent-123",
    });

    expect(config).not.toBeNull();
    expect(config?.extractionPrompt).toBe("Prompt customizado de extração");
    expect(config?.extractionEnabled).toBe(true);
  });
});
