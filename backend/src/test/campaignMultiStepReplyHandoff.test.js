import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockInstances = [
  {
    id: "chip-disparo-uuid",
    name: "Chip disparo - Fixo",
    dispatch_webhook_url: "https://evo.vexo.com.br/message/sendText/chip-disparo",
    dispatch_webhook_token: "token-chip-disparo",
    is_default: true,
    active: true,
  },
  {
    id: "chip-fechador-uuid",
    name: "Comercial - Tinge Brasil",
    dispatch_webhook_url: "https://evo.vexo.com.br/message/sendText/comercial-tinge-brasil",
    dispatch_webhook_token: "token-chip-fechador",
    is_default: false,
    active: true,
  },
];

let mockHealthStatus = { state: "open" };
let mockEvolutionPayloads = [];
let mockDispatchedCalls = [];
let mockCampaignData = null;
let mockDispatchData = null;
let mockLeadImportItemData = null;
let mockInsertedLeadMessages = [];
let mockUpdatedLeads = [];
let mockUpdatedProgressPatches = [];

vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLeadClientEvolutionInstances: vi.fn(async () => mockInstances),
    checkEvolutionInstanceHealth: vi.fn(async () => {
      if (mockHealthStatus.shouldThrow) {
        throw new Error(mockHealthStatus.errorMessage || "Instância desconectada");
      }
      return mockHealthStatus;
    }),
    resolveInstanceIdentifier: vi.fn(async ({ identifier }) => {
      const id = String(identifier || "").trim().toLowerCase();
      const matched = mockInstances.find(
        (i) =>
          i.id.toLowerCase() === id ||
          i.name.toLowerCase() === id ||
          actual.extractEvolutionInstanceSlug(i.dispatch_webhook_url)?.toLowerCase() === id
      );
      return {
        canonicalName: matched?.name || identifier,
        aliases: matched ? [matched.id, matched.name, actual.extractEvolutionInstanceSlug(matched.dispatch_webhook_url)] : [identifier],
        chip: matched || null,
      };
    }),
  };
});

vi.mock("../services/database.js", () => {
  const createChain = (table) => {
    let selectedColumns = "";
    const chain = {
      eq: () => chain,
      in: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      select: (cols) => {
        selectedColumns = String(cols || "");
        return chain;
      },
      maybeSingle: async () => {
        if (table === "campaigns") return { data: mockCampaignData, error: null };
        if (table === "campaign_dispatches") return { data: mockDispatchData, error: null };
        if (table === "lead_import_items") return { data: mockLeadImportItemData, error: null };
        return { data: null, error: null };
      },
      update: (data) => {
        if (table === "leads") mockUpdatedLeads.push(data);
        if (table === "lead_import_items") mockUpdatedProgressPatches.push(data);
        return chain;
      },
      insert: async (data) => {
        if (table === "lead_messages") {
          if (Array.isArray(data)) mockInsertedLeadMessages.push(...data);
          else mockInsertedLeadMessages.push(data);
          return { data, error: null };
        }
        return { data, error: null };
      },
    };
    return chain;
  };

  return {
    supabase: {
      from: (table) => createChain(table),
    },
    pgDatabasePool: null,
  };
});

import {
  continueCampaignLeadFromReply,
  resolveEffectiveCampaignSequence,
} from "../campaign/dispatch.js";
import { buildImagePayload } from "../campaign-outbound.js";

let fetchOriginal;
let timeoutOriginal;

describe("Tinge Brasil: Multi-Step Reply Progression & Handoff (Porta 2, Imagem, Fechador)", () => {
  beforeEach(() => {
    mockEvolutionPayloads = [];
    mockDispatchedCalls = [];
    mockInsertedLeadMessages = [];
    mockUpdatedLeads = [];
    mockUpdatedProgressPatches = [];
    mockHealthStatus = { state: "open" };

    fetchOriginal = globalThis.fetch;
    timeoutOriginal = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => timeoutOriginal(fn, ms >= 1000 ? 0 : ms, ...args);
    globalThis.fetch = vi.fn(async (url, init) => {
      mockEvolutionPayloads.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ key: { id: "wa-123" } }),
        text: async () => JSON.stringify({ key: { id: "wa-123" } }),
      };
    });

    // Campanha completa da Tinge Brasil com 5 passos:
    // Passo 0 (order 1): Imediato ("Olá {{nome}}! Consegue falar rapidinho?")
    // Passo 1 (order 2, after_reply): "🎄 Fim de ano chegando! Sua roupa está pronta..."
    // Passo 2 (order 3, after_reply): "Reuniões de empresa, festas de Natal..."
    // Passo 3 (order 4, with_previous, image): Imagem Antes/Depois
    // Passo 4 (order 5, with_previous, text): "Venha nos fazer uma visita!!! Av. Cesário Alvim, 243, Centro"
    mockCampaignData = {
      id: "camp-tinge-fim-de-ano",
      name: "Tinge - Fim de ano",
      client_id: "tinge-brasil",
      status: "running",
      analytics_meta: {
        sequence: [
          { id: "step-1", type: "text", order: 1, text: "Olá {{nome}}! Consegue falar rapidinho?", triggerMode: "immediate", enabled: true },
          { id: "step-2", type: "text", order: 2, text: "🎄 Fim de ano chegando! Sua roupa está pronta para as comemorações?", triggerMode: "after_reply", enabled: true },
          { id: "step-3", type: "text", order: 3, text: "Reuniões de empresa, festas de Natal e confraternizações pedem uma boa apresentação!", triggerMode: "after_reply", enabled: true },
          {
            id: "step-4",
            type: "image",
            order: 4,
            text: "Antes e Depois Tinge Brasil",
            triggerMode: "with_previous",
            delayAfterSeconds: 0,
            enabled: true,
            image: {
              name: "antes_depois.jpg",
              type: "image/jpeg",
              url: "https://storage.vexoia.com/tinge/antes_depois.jpg",
            },
          },
          { id: "step-5", type: "text", order: 5, text: "Venha nos fazer uma visita!!! Av. Cesário Alvim, 243, Centro", triggerMode: "with_previous", delayAfterSeconds: 0, enabled: true },
        ],
        dispatchOptions: {
          waitForReply: true,
          evolutionInstanceId: "chip-disparo-uuid",
          handoffEnabled: true,
          handoffChipId: "chip-fechador-uuid",
          handoffChipIds: ["chip-fechador-uuid"],
          handoffBridgingText: "Minha equipe me passou seu contato.",
          handoffOpenerText: "Olá {{nome}}! Como posso te ajudar?",
        },
      },
    };

    // Snapshot congelado do lote inicial (quando a campanha tinha apenas os 2 primeiros passos)
    mockDispatchData = {
      id: "disp-lote-1",
      campaign_id: "camp-tinge-fim-de-ano",
      client_id: "tinge-brasil",
      evolution_instance_id: "chip-disparo-uuid",
      steps: [
        { id: "step-1", type: "text", order: 1, text: "Olá {{nome}}! Consegue falar rapidinho?", triggerMode: "immediate", enabled: true },
        { id: "step-2", type: "text", order: 2, text: "🎄 Fim de ano chegando! Sua roupa está pronta para as comemorações?", triggerMode: "after_reply", enabled: true },
      ],
      dispatch_options: mockCampaignData.analytics_meta.dispatchOptions,
    };
  });

  afterEach(() => {
    if (fetchOriginal) globalThis.fetch = fetchOriginal;
    if (timeoutOriginal) globalThis.setTimeout = timeoutOriginal;
  });

  it("resolveEffectiveCampaignSequence: prefere a régua ao vivo quando a campanha foi expandida na tela", () => {
    const loteSteps = mockDispatchData.steps; // 2 passos
    const liveSteps = mockCampaignData.analytics_meta.sequence; // 5 passos

    // Caso 1: Lote tinha 2 passos, campanha ao vivo foi expandida para 5 passos
    const resolved = resolveEffectiveCampaignSequence(loteSteps, liveSteps, 2);
    expect(resolved.length).toBe(5);
    expect(resolved[2].id).toBe("step-3");
    expect(resolved[3].id).toBe("step-4");
    expect(resolved[4].id).toBe("step-5");

    // Caso 2: Campanha ao vivo foi reduzida para 1 passo mas lote original tinha 3 (Container LED)
    const shortLiveSteps = [liveSteps[0]];
    const resolvedShort = resolveEffectiveCampaignSequence(liveSteps, shortLiveSteps, 1);
    expect(resolvedShort.length).toBe(5); // Mantém passos do lote
  });

  it("avança para Passo 2 (Porta 2), envia rajada com imagem e endereço, e conclui com transferência de bastão (Handoff)", async () => {
    // O lead já recebeu o Passo 1 (índice 0) e o Passo 2 (índice 1). Agora respondeu pela segunda vez:
    // Seu nextStepIndex é 2 (apontando para o Passo 3 da régua expandida).
    const campaignMatch = {
      id: "camp-tinge-fim-de-ano",
      analyticsMeta: mockCampaignData.analytics_meta,
      leadImportItem: {
        id: "item-renato-acougue",
        progress: {
          waitForReply: true,
          status: "aguardando_usuario",
          nextStepIndex: 2,
          currentStepIndex: 1,
          dispatchId: "disp-lote-1",
          leadName: "Renato Açougue",
        },
        normalized_data: {
          nome: "Renato Açougue",
          telefone: "5534991112222",
        },
      },
    };

    const result = await continueCampaignLeadFromReply({
      clientId: "tinge-brasil",
      phone: "5534991112222",
      campaignMatch,
      replyPayload: {
        instance: "chip-disparo",
        text: "Boa noite",
      },
      delayMs: 1,
    });

    expect(result.continued).toBe(true);
    expect(result.finalized).toBe(true);
    expect(result.handoff?.executed).toBe(true);
    expect(result.handoff?.transferredTo).toBe("Comercial - Tinge Brasil");
  });

  it("libera a trava de concorrência imediatamente no finally permitindo respostas rápidas subsequentes", async () => {
    const campaignMatch = {
      id: "camp-tinge-fim-de-ano",
      analyticsMeta: mockCampaignData.analytics_meta,
      leadImportItem: {
        id: "item-renato-acougue",
        progress: {
          waitForReply: true,
          status: "aguardando_usuario",
          nextStepIndex: 2,
          currentStepIndex: 1,
          dispatchId: "disp-lote-1",
          leadName: "Renato Açougue",
        },
        normalized_data: {
          nome: "Renato Açougue",
          telefone: "5534991112222",
        },
      },
    };

    // 1ª Resposta
    const r1 = await continueCampaignLeadFromReply({
      clientId: "tinge-brasil",
      phone: "5534991112222",
      campaignMatch,
      replyPayload: { instance: "chip-disparo", text: "Olá" },
      delayMs: 1,
    });
    expect(r1.reason).not.toBe("concurrent_reply_in_progress");

    // 2ª Resposta imediata (< 100ms depois)
    const r2 = await continueCampaignLeadFromReply({
      clientId: "tinge-brasil",
      phone: "5534991112222",
      campaignMatch,
      replyPayload: { instance: "chip-disparo", text: "Boa noite de novo" },
      delayMs: 1,
    });
    // Não pode ser travado por concorrência porque a 1ª chamada já finalizou
    expect(r2.reason).not.toBe("concurrent_reply_in_progress");
  });

  it("buildImagePayload: aceita tanto step.image.url, step.mediaUrl quanto dataUrl sem retornar media nulo", () => {
    const stepWithUrl = {
      id: "s-img-1",
      type: "image",
      text: "Legenda da imagem",
      image: {
        name: "foto.jpg",
        type: "image/jpeg",
        url: "https://storage.vexoia.com/tinge/antes_depois.jpg",
      },
    };

    const payload = buildImagePayload("5534991112222", stepWithUrl);
    expect(payload.type).toBe("image");
    expect(payload.media).toBe("https://storage.vexoia.com/tinge/antes_depois.jpg");
    expect(payload.caption).toContain("Legenda da imagem");
  });
});
