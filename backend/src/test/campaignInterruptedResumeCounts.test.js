import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isCampaignActive,
  aggregateDispatchStatus,
} from "../services/campaignDispatchSummary.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";
import { recoverOrphanDispatches } from "../campaign/orphanRecovery.js";

describe("campaignInterruptedResumeCounts — Contabilização de Lotes Interrompidos e Proteção de Status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. orphanRecovery — Não encerra como 'done' quando há leads pendentes", () => {
    it("mantém lote interrompido como 'paused' com sent_count=36 e NÃO como 'done' quando 17 leads ficaram sem confirmação", async () => {
      const mockQueries = [];
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql, params) => {
          mockQueries.push({ sql, params });

          if (sql.includes("FROM public.campaign_dispatches") && sql.includes("status IN ('running', 'interrupted')")) {
            return {
              rows: [
                {
                  id: "disp-101",
                  name: "Lote 1",
                  campaign_id: "camp-53",
                  client_id: "client-1",
                  target_count: 53,
                  status: "running",
                },
              ],
            };
          }

          // 36 sent
          if (sql.includes("status = 'sent'")) {
            return { rows: [{ cnt: 36 }] };
          }

          // 17 claimed na hora que o servidor reiniciou
          if (sql.includes("status = 'claimed'")) {
            return { rows: [{ cnt: 17 }] };
          }

          // 0 failed
          if (sql.includes("status = 'failed'")) {
            return { rows: [{ cnt: 0 }] };
          }

          // outcomes query
          if (sql.includes("status IN ('sent', 'failed', 'invalid_number')")) {
            return { rows: [{ cnt: 36 }] };
          }

          // UPDATE query
          if (sql.includes("UPDATE public.campaign_dispatches")) {
            return { rowCount: 1 };
          }

          return { rows: [] };
        }),
      };

      const res = await recoverOrphanDispatches(mockPool);
      expect(res).toBeDefined();

      // Encontra a query de update do lote
      const updateDispatchQuery = mockQueries.find(
        (q) => q.sql.includes("UPDATE public.campaign_dispatches") && q.params?.includes("disp-101")
      );
      expect(updateDispatchQuery).toBeDefined();

      // Deve atualizar para 'paused' e NUNCA para 'done'
      expect(updateDispatchQuery.sql).toContain("status = 'paused'");
      expect(updateDispatchQuery.params).toContain(36); // sentCount
      expect(updateDispatchQuery.params[2]).toContain("servidor reiniciou");
    });
  });

  describe("2. buildDispatchLeads com excludeCampaignId — Dedup entre todos os lotes da campanha", () => {
    it("deduplica telefones já enviados em lotes anteriores da campanha, retornando exatamente os 17 pendentes", async () => {
      const candidateLeads = Array.from({ length: 53 }, (_, idx) => ({
        id: `lead-${idx + 1}`,
        import_id: "imp-1",
        client_id: "client-1",
        telefone: `55119999900${String(idx + 1).padStart(2, "0")}`,
        normalized_data: { nome: `Lead ${idx + 1}` },
      }));

      // 36 já enviados na campanha
      const alreadySentRuns = Array.from({ length: 36 }, (_, idx) => ({
        lead_id: `lead-${idx + 1}`,
        phone: `55119999900${String(idx + 1).padStart(2, "0")}`,
      }));

      const mockSupabase = {
        from: (table) => {
          if (table === "lead_import_items") {
            const builder = {
              select: () => builder,
              eq: () => builder,
              in: () => builder,
              not: () => builder,
              order: () => builder,
              limit: () => ({ data: candidateLeads, error: null }),
              range: () => ({ data: candidateLeads, error: null }),
            };
            return builder;
          }
          if (table === "campaign_dispatch_runs") {
            return {
              select: () => ({
                eq: (col, val) => {
                  if (col === "campaign_id" && val === "camp-53") {
                    return {
                      in: (statusCol, statuses) => ({
                        data: alreadySentRuns,
                        error: null,
                      }),
                    };
                  }
                  return { data: [], error: null };
                },
              }),
            };
          }
          return {};
        },
      };

      // Injeta mock global se necessário ou usa função diretamente
      const leads = await buildDispatchLeads({
        clientId: "client-1",
        importId: "imp-1",
        excludeCampaignId: "camp-53",
        supabaseClient: mockSupabase, // ou injetado via closure
      });

      // Total de 53 - 36 já enviados = 17 pendentes
      expect(leads.length).toBe(17);
      expect(leads[0].id).toBe("lead-37");
      expect(leads[16].id).toBe("lead-53");
    });
  });

  describe("3. Proteção Contra Encerramento Indevido (isCampaignActive e aggregateDispatchStatus)", () => {
    it("mantém campanha como ativa (isCampaignActive = true) se houver contatos pendentes, mesmo se lotes forem 'done'", () => {
      // 1 lote finalizado mas com pendências restantes na campanha (53 total - 36 enviados = 17 pendentes)
      const dispatchStatuses = ["done"];
      const active = isCampaignActive(dispatchStatuses, {
        leadsPending: 17,
        leadsTotal: 53,
        sentTotal: 36,
      });

      expect(active).toBe(true);
    });

    it("impede status 'concluida' em aggregateDispatchStatus se ainda houver contatos pendentes na campanha", () => {
      const dispatchStatuses = ["done"];
      const status = aggregateDispatchStatus(dispatchStatuses, {
        leadsPending: 17,
        leadsTotal: 53,
        sentTotal: 36,
      });

      // Deve ser 'aguardando_disparo' ou 'pausada', NUNCA 'concluida'
      expect(status).not.toBe("concluida");
      expect(["aguardando_disparo", "pausada"]).toContain(status);
    });

    it("permite status 'concluida' quando todos os contatos da campanha foram enviados e lotes são 'done'", () => {
      const dispatchStatuses = ["done"];
      const status = aggregateDispatchStatus(dispatchStatuses, {
        leadsPending: 0,
        leadsTotal: 53,
        sentTotal: 53,
      });

      expect(status).toBe("concluida");
    });
  });
});
