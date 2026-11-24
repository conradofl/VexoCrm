import { describe, expect, it, vi } from "vitest";

let mockFromImpl = () => {
  const c = {
    select: () => c,
    eq: () => c,
    in: () => c,
    is: () => c,
    not: () => c,
    order: () => c,
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return c;
};

vi.mock("../services/database.js", () => ({
  supabase: {
    from: (table) => mockFromImpl(table),
  },
  pgDatabasePool: null,
}));

import { resolvePendingCampaignRunForPhone } from "../domains/chatbot/routes.js";
import {
  resolveMatchedImportItemForCampaign,
  findCampaignReplyMatches,
} from "../campaign/dispatch.js";

const INSTAGRAM_META = {
  sequence: [
    { id: "s1", order: 1, type: "text", text: "Oi Jheyson, tudo bem?", triggerMode: "immediate", enabled: true },
    {
      id: "s2",
      order: 2,
      type: "text",
      text: "Caio Almeida aqui. Estamos em um novo momento da Agência Geração Digital...",
      triggerMode: "after_reply",
      enabled: true,
    },
    {
      id: "s3",
      order: 3,
      type: "text",
      text: "Essa é a nossa página https://www.instagram.com/geracao.digital.mkt",
      triggerMode: "with_previous",
      enabled: true,
    },
  ],
  dispatchOptions: { waitForReply: true },
};

function chainFor(data) {
  const c = {
    select: () => c,
    eq: () => c,
    in: () => c,
    is: () => c,
    not: () => c,
    order: () => c,
    then: (resolve) => resolve({ data, error: null }),
  };
  return c;
}

describe("Anti-repetição de campanha ao responder (Bug Jheyson / Geração Digital)", () => {
  it("resolvePendingCampaignRunForPhone NÃO ressuscita nextStepIndex=1 quando progresso já está finalizado (null ?? 1)", async () => {
    const res = await resolvePendingCampaignRunForPhone({
      clientId: "geracao-digital",
      phone: "5534999991111",
      campaignReplyContext: {
        waitForReplyMatches: [
          {
            id: "camp-ig-1",
            name: "Instagram GD",
            analyticsMeta: INSTAGRAM_META,
            leadImportItem: {
              id: "item-1",
              progress: {
                waitForReply: true,
                status: "finalizado",
                nextStepIndex: null,
                completedAt: "2026-11-24T20:10:05.000Z",
              },
            },
          },
        ],
      },
      pgDatabasePool: null,
      supabase: null,
    });

    expect(res).toBeNull();
  });

  it("resolvePendingCampaignRunForPhone bloqueia re-disparo se lead_messages já registrou campaign_reply_progression", async () => {
    const mockPool = {
      query: vi.fn(async (sql) => {
        const q = String(sql);
        if (q.includes("FROM public.campaign_dispatch_runs")) {
          return {
            rows: [
              {
                run_id: "run-1",
                dispatch_id: "disp-1",
                campaign_id: "camp-ig-1",
                phone: "5534999991111",
                lead_id: null,
                lead_import_item_id: null,
                status: "sent",
                camp_id: "camp-ig-1",
                camp_name: "Instagram GD",
                client_id: "geracao-digital",
                analytics_meta: INSTAGRAM_META,
                camp_status: "sent",
                camp_mode: "disparo",
                archived_at: null,
              },
            ],
          };
        }
        if (q.includes("FROM public.lead_messages")) {
          return { rows: [{ "?column?": 1 }] };
        }
        return { rows: [] };
      }),
    };

    const res = await resolvePendingCampaignRunForPhone({
      clientId: "geracao-digital",
      phone: "5534999991111",
      campaignReplyContext: { waitForReplyMatches: [] },
      pgDatabasePool: mockPool,
      supabase: null,
    });

    expect(res).toBeNull();
  });

  it("resolvePendingCampaignRunForPhone ignora campanhas arquivadas ou pausadas", async () => {
    const mockPool = {
      query: vi.fn(async (sql) => {
        if (String(sql).includes("FROM public.campaign_dispatch_runs")) {
          return {
            rows: [
              {
                run_id: "run-arch",
                dispatch_id: "disp-arch",
                campaign_id: "camp-arch",
                phone: "5534999991111",
                status: "sent",
                camp_id: "camp-arch",
                camp_name: "Campanha Arquivada",
                client_id: "geracao-digital",
                analytics_meta: INSTAGRAM_META,
                camp_status: "sent",
                archived_at: "2026-11-24T18:00:00.000Z",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const res = await resolvePendingCampaignRunForPhone({
      clientId: "geracao-digital",
      phone: "5534999991111",
      campaignReplyContext: { waitForReplyMatches: [] },
      pgDatabasePool: mockPool,
      supabase: null,
    });

    expect(res).toBeNull();
  });

  it("resolveMatchedImportItemForCampaign prioriza linha já finalizada sobre duplicatas órfãs do mesmo telefone", () => {
    const campaign = { id: "camp-dup" };
    const importItems = [
      {
        id: "dup-orphan-row",
        normalized_data: {
          campaign_progress: {
            "camp-dup": {
              dispatchId: "disp-1",
              waitForReply: true,
              status: "aguardando_usuario",
              nextStepIndex: 1,
              updatedAt: "2026-11-24T19:00:00.000Z",
            },
          },
        },
      },
      {
        id: "completed-row",
        normalized_data: {
          campaign_progress: {
            "camp-dup": {
              dispatchId: "disp-1",
              waitForReply: true,
              status: "finalizado",
              nextStepIndex: null,
              completedAt: "2026-11-24T20:10:00.000Z",
              updatedAt: "2026-11-24T20:10:00.000Z",
            },
          },
        },
      },
    ];

    const matched = resolveMatchedImportItemForCampaign(importItems, campaign);
    expect(matched.id).toBe("completed-row");
  });

  it("findCampaignReplyMatches supera 9 campanhas antigas em aguardando_usuario quando a 10ª mais recente já concluiu", async () => {
    const progressMap = {};
    const campaignsRows = [];

    for (let i = 1; i <= 9; i++) {
      const cid = `camp-old-${i}`;
      const ts = `2026-11-${String(10 + i).padStart(2, "0")}T12:00:00.000Z`;
      progressMap[cid] = {
        waitForReply: true,
        status: "aguardando_usuario",
        nextStepIndex: 1,
        updatedAt: ts,
      };
      campaignsRows.push({
        id: cid,
        name: `Campanha Teste ${i}`,
        client_id: "geracao-digital",
        status: "processing",
        last_triggered_at: ts,
        archived_at: null,
        phones: ["5534999991111"],
        analytics_meta: INSTAGRAM_META,
      });
    }

    progressMap["camp-10"] = {
      waitForReply: true,
      status: "finalizado",
      nextStepIndex: null,
      completedAt: "2026-11-24T20:10:00.000Z",
      updatedAt: "2026-11-24T20:10:00.000Z",
    };
    campaignsRows.push({
      id: "camp-10",
      name: "Campanha Teste 10",
      client_id: "geracao-digital",
      status: "processing",
      last_triggered_at: "2026-11-24T20:00:00.000Z",
      archived_at: null,
      phones: ["5534999991111"],
      analytics_meta: INSTAGRAM_META,
    });

    mockFromImpl = (table) => {
      if (table === "lead_import_items") {
        return chainFor([
          {
            id: "item-jheyson",
            import_id: "imp-1",
            normalized_data: { nome: "Jheyson", campaign_progress: progressMap },
            created_at: "2026-11-24T20:00:00.000Z",
          },
        ]);
      }
      if (table === "campaigns") return chainFor(campaignsRows);
      return chainFor([]);
    };

    const ctx = await findCampaignReplyMatches({
      clientId: "geracao-digital",
      phone: "5534999991111",
    });

    expect(ctx.processingWaitForReplyMatches).toHaveLength(0);
    expect(ctx.waitForReplyMatches.every((m) => !m.hasPendingProgress)).toBe(true);
  });

  it("permite normalmente uma 11ª campanha NOVA disparada DEPOIS da conclusão da 10ª", async () => {
    const progressMap = {
      "camp-10": {
        waitForReply: true,
        status: "finalizado",
        nextStepIndex: null,
        completedAt: "2026-11-24T20:10:00.000Z",
        updatedAt: "2026-11-24T20:10:00.000Z",
      },
      "camp-11-new": {
        waitForReply: true,
        status: "aguardando_usuario",
        nextStepIndex: 1,
        startedAt: "2026-11-25T10:00:00.000Z",
        updatedAt: "2026-11-25T10:00:00.000Z",
      },
    };

    mockFromImpl = (table) => {
      if (table === "lead_import_items") {
        return chainFor([
          {
            id: "item-jheyson",
            import_id: "imp-1",
            normalized_data: { nome: "Jheyson", campaign_progress: progressMap },
            created_at: "2026-11-24T20:00:00.000Z",
          },
        ]);
      }
      if (table === "campaigns") {
        return chainFor([
          {
            id: "camp-10",
            name: "Campanha 10",
            client_id: "geracao-digital",
            status: "sent",
            last_triggered_at: "2026-11-24T20:00:00.000Z",
            archived_at: null,
            phones: ["5534999991111"],
            analytics_meta: INSTAGRAM_META,
          },
          {
            id: "camp-11-new",
            name: "Campanha 11 Nova",
            client_id: "geracao-digital",
            status: "processing",
            last_triggered_at: "2026-11-25T10:00:00.000Z",
            archived_at: null,
            phones: ["5534999991111"],
            analytics_meta: INSTAGRAM_META,
          },
        ]);
      }
      return chainFor([]);
    };

    const ctx = await findCampaignReplyMatches({
      clientId: "geracao-digital",
      phone: "5534999991111",
    });

    expect(ctx.processingWaitForReplyMatches).toHaveLength(1);
    expect(ctx.processingWaitForReplyMatches[0].id).toBe("camp-11-new");
  });
});
