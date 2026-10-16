import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocks antes das importações
const mockInstances = [
  {
    id: "chip-juliani-uuid",
    name: "JULIANI - EVENTO NOUS",
    dispatch_webhook_url: "https://evo.vexo.com.br/message/sendText/juliani-evento-nous",
    dispatch_webhook_token: "token-juliani",
    is_default: true,
    active: true,
  },
  {
    id: "chip-moacir-uuid",
    name: "NOUS - Moacir",
    dispatch_webhook_url: "https://evo.vexo.com.br/message/sendText/nous-gestao-nous-moacir",
    dispatch_webhook_token: "token-moacir",
    is_default: false,
    active: true,
  },
];

vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLeadClientEvolutionInstances: vi.fn(async () => mockInstances),
    checkEvolutionInstanceHealth: vi.fn(async () => ({ state: "open" })),
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

let mockCampaignData = null;
let mockDispatchData = null;
let mockDispatchedCalls = [];

vi.mock("../services/database.js", () => {
  const createChain = (table) => {
    const chain = {
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      select: () => chain,
      maybeSingle: async () => {
        if (table === "campaigns") return { data: mockCampaignData, error: null };
        if (table === "campaign_dispatches") return { data: mockDispatchData, error: null };
        if (table === "lead_import_items") return { data: { id: "item-123", normalized_data: {} }, error: null };
        return { data: null, error: null };
      },
    };
    return chain;
  };

  return {
    supabase: {
      from: (table) => {
        return {
          select: () => createChain(table),
          update: () => createChain(table),
          insert: () => createChain(table),
        };
      },
    },
    pgDatabasePool: {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("FROM public.campaign_dispatch_runs")) {
          const phones = params[1];
          if (Array.isArray(phones) && (phones.includes("5534984400049") || phones.includes("553484400049"))) {
            return { rows: [{ evolution_instance_id: "chip-moacir-uuid" }] };
          }
          return { rows: [] };
        }
        return { rows: [] };
      }),
    },
  };
});

vi.mock("../campaign-outbound.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    dispatchCampaignSequence: vi.fn(async (args) => {
      mockDispatchedCalls.push(args);
      return {
        summary: {
          successCount: 1,
          failureCount: 0,
          successPhones: ["5534984400049"],
          failures: [],
          warnings: [],
        },
      };
    }),
  };
});

import { resolveCampaignDispatchSettings } from "../campaign/settings.js";
import { continueCampaignLeadFromReply } from "../campaign/dispatch.js";

describe("Blindagem Anti-Troca de Chip em Campanhas (Step 2 em diante)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatchedCalls = [];
    mockCampaignData = {
      id: "camp-nous-1",
      name: "Campanha Black Friday NOUS",
      client_id: "tenant-nous",
      status: "running",
      analytics_meta: {
        sequence: [
          { id: "s1", type: "text", order: 1, text: "Olá! Tudo bem?", triggerMode: "immediate", enabled: true },
          { id: "s2", type: "text", order: 2, text: "Gostaria de conhecer nossas condições especiais?", triggerMode: "after_reply", enabled: true },
        ],
        dispatchOptions: {
          waitForReply: true,
          evolutionInstanceId: "chip-moacir-uuid",
        },
      },
    };
    mockDispatchData = {
      evolution_instance_id: "chip-moacir-uuid",
    };
  });

  describe("1. Resolução em resolveCampaignDispatchSettings", () => {
    it("resolve slug da Evolution ('nous-gestao-nous-moacir') exclusivamente para a instância do Moacir, NUNCA para o default da Juliani", async () => {
      const campaignWithSlug = {
        analytics_meta: {
          dispatchOptions: {
            evolutionInstanceId: "nous-gestao-nous-moacir",
          },
        },
      };

      const resolved = await resolveCampaignDispatchSettings("tenant-nous", campaignWithSlug);

      expect(resolved.selectedEvolutionInstanceId).toBe("chip-moacir-uuid");
      expect(resolved.selectedEvolutionInstanceName).toBe("NOUS - Moacir");
      expect(resolved.webhookUrl).toBe("https://evo.vexo.com.br/message/sendText/nous-gestao-nous-moacir");
      expect(resolved.webhookToken).toBe("token-moacir");
      expect(resolved.selectedEvolutionInstanceId).not.toBe("chip-juliani-uuid");
    });

    it("resolve UUID ('chip-moacir-uuid') para a instância do Moacir", async () => {
      const campaignWithId = {
        analytics_meta: {
          dispatchOptions: {
            evolutionInstanceId: "chip-moacir-uuid",
          },
        },
      };

      const resolved = await resolveCampaignDispatchSettings("tenant-nous", campaignWithId);

      expect(resolved.selectedEvolutionInstanceId).toBe("chip-moacir-uuid");
      expect(resolved.selectedEvolutionInstanceName).toBe("NOUS - Moacir");
      expect(resolved.webhookUrl).toBe("https://evo.vexo.com.br/message/sendText/nous-gestao-nous-moacir");
    });
  });

  describe("2. Execução de continueCampaignLeadFromReply", () => {
    it("webhook envia instance como slug ('nous-gestao-nous-moacir') -> disparo do Passo 2 ocorre estritamente pelo Moacir e NUNCA pela Juliani", async () => {
      const campaignMatch = {
        id: "camp-nous-1",
        leadImportItem: {
          id: "item-123",
          progress: {
            waitForReply: true,
            status: "aguardando_usuario",
            nextStepIndex: 1,
            dispatchId: "disp-origin-1",
          },
        },
      };

      const replyPayload = {
        instance: "nous-gestao-nous-moacir",
      };

      const res = await continueCampaignLeadFromReply({
        clientId: "tenant-nous",
        phone: "5534984400049",
        repliedAt: new Date().toISOString(),
        campaignMatch,
        replyPayload,
      });

      expect(res.continued).toBe(true);
      expect(mockDispatchedCalls.length).toBe(1);

      const dispatched = mockDispatchedCalls[0];
      // Webhook utilizado no disparo deve ser exclusivamente o do Moacir
      expect(dispatched.webhookUrl).toBe("https://evo.vexo.com.br/message/sendText/nous-gestao-nous-moacir");
      expect(dispatched.webhookToken).toBe("token-moacir");
      expect(dispatched.webhookUrl).not.toContain("juliani-evento-nous");
    });

    it("recupera o chip correto via histórico (campaign_dispatch_runs) mesmo com divergência no 9º dígito", async () => {
      // Campanha sem chip explicitado no analytics_meta
      mockCampaignData.analytics_meta.dispatchOptions.evolutionInstanceId = null;

      const campaignMatch = {
        id: "camp-nous-1",
        leadImportItem: {
          id: "item-123",
          progress: {
            waitForReply: true,
            status: "aguardando_usuario",
            nextStepIndex: 1,
            // Sem dispatchId para forçar resolução via histórico em campaign_dispatch_runs
            dispatchId: null,
          },
        },
      };

      // Webhook chega sem instance identificada
      const replyPayload = {};

      // Lead responde com número de 12 dígitos (sem o 9º dígito: 553484400049)
      const res = await continueCampaignLeadFromReply({
        clientId: "tenant-nous",
        phone: "553484400049",
        repliedAt: new Date().toISOString(),
        campaignMatch,
        replyPayload,
      });

      expect(res.continued).toBe(true);
      expect(mockDispatchedCalls.length).toBe(1);
      expect(mockDispatchedCalls[0].webhookUrl).toBe("https://evo.vexo.com.br/message/sendText/nous-gestao-nous-moacir");
    });

    it("TRAVA DE SEGURANÇA ESTRITA: aborta com 'ambiguous_chip_recipient' se o chip receptor for nulo e NUNCA dispara pelo chip default", async () => {
      // Remove chip da campanha e do lote
      mockCampaignData.analytics_meta.dispatchOptions.evolutionInstanceId = null;
      mockDispatchData = null;

      const campaignMatch = {
        id: "camp-nous-1",
        leadImportItem: {
          id: "item-123",
          progress: {
            waitForReply: true,
            status: "aguardando_usuario",
            nextStepIndex: 1,
            dispatchId: null,
          },
        },
      };

      // Telefone sem histórico no banco
      const res = await continueCampaignLeadFromReply({
        clientId: "tenant-nous",
        phone: "5511000000000",
        repliedAt: new Date().toISOString(),
        campaignMatch,
        replyPayload: {},
      });

      // Deve abortar e jamais disparar pela Juliani
      expect(res.continued).toBe(false);
      expect(res.reason).toBe("ambiguous_chip_recipient");
      expect(mockDispatchedCalls.length).toBe(0);
    });
  });
});
