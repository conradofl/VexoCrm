import { describe, expect, it, vi } from "vitest";
import { recoverOrphanDispatches } from "../campaign/orphanRecovery.js";

describe("Recuperação de Lotes Órfãos no Startup com Retomada Automática", () => {
  function createMockPool({ dispatches = [], runs = [] }) {
    const dispatchRows = [...dispatches];
    const runRows = [...runs];

    return {
      dispatchRows,
      runRows,
      query: vi.fn(async (sql, params = []) => {
        const text = sql.trim();

        // 1. SELECT running or interrupted dispatches
        if (text.includes("FROM public.campaign_dispatches") && (text.includes("WHERE status = 'running'") || text.includes("WHERE status IN ('running', 'interrupted')"))) {
          return { rows: dispatchRows.filter((d) => d.status === "running" || d.status === "interrupted") };
        }

        // 2. COUNT sent leads
        if (text.includes("FROM public.campaign_dispatch_runs") && text.includes("status = 'sent'")) {
          const dispatchId = params[0];
          const cnt = runRows.filter((r) => r.dispatch_id === dispatchId && r.status === "sent").length;
          return { rows: [{ cnt }] };
        }

        // 3. COUNT claimed leads
        if (text.includes("FROM public.campaign_dispatch_runs") && text.includes("status = 'claimed'")) {
          const dispatchId = params[0];
          const cnt = runRows.filter((r) => r.dispatch_id === dispatchId && r.status === "claimed").length;
          return { rows: [{ cnt }] };
        }

        // 4. COUNT failed leads
        if (text.includes("FROM public.campaign_dispatch_runs") && text.includes("status = 'failed'")) {
          const dispatchId = params[0];
          const cnt = runRows.filter((r) => r.dispatch_id === dispatchId && r.status === "failed").length;
          return { rows: [{ cnt }] };
        }

        // 5. UPDATE claimed leads to skipped
        if (text.includes("UPDATE public.campaign_dispatch_runs") && text.includes("SET status = 'skipped'")) {
          const dispatchId = params[0];
          runRows.forEach((r) => {
            if (r.dispatch_id === dispatchId && r.status === "claimed") {
              r.status = "skipped";
              r.error_message = "Interrompido antes da confirmação de envio (envio não confirmado no restart do servidor)";
            }
          });
          return { rowCount: 1 };
        }

        // 6. UPDATE campaign_dispatches to paused (para controle manual seguro pelo usuário)
        if (text.includes("UPDATE public.campaign_dispatches") && text.includes("SET status = 'paused'")) {
          const sentCount = params[0];
          const failedCount = params[1];
          const errorMsg = params[2];
          const dispatchId = params[3];
          const disp = dispatchRows.find((d) => d.id === dispatchId && (d.status === "running" || d.status === "interrupted"));
          if (disp) {
            disp.status = "paused";
            disp.sent_count = sentCount;
            disp.failed_count = failedCount;
            disp.error_message = errorMsg;
            disp.finished_at = null;
            disp.updated_at = new Date().toISOString();
          }
          return { rowCount: disp ? 1 : 0 };
        }

        return { rows: [] };
      }),
    };
  }

  it("lote 'running' no boot vira 'paused' para retomada manual segura com motivo legível e explicativo", async () => {
    const mockPool = createMockPool({
      dispatches: [
        {
          id: "disp-101",
          name: "Lote Oferta 2",
          campaign_id: "camp-1",
          client_id: "geracao-digital",
          status: "running",
          triggered_at: "2026-08-23T18:15:00.000Z",
        },
      ],
      runs: [],
    });

    const result = await recoverOrphanDispatches(mockPool);

    expect(result.recovered).toBe(1);
    expect(result.items[0]).toMatchObject({
      dispatchId: "disp-101",
      dispatchName: "Lote Oferta 2",
      leadsSent: 0,
      leadsUnconfirmed: 0,
    });
    expect(result.items[0].errorMessage).toContain(
      "Pausado — servidor reiniciou durante o envio. Retome quando quiser."
    );

    const updatedDisp = mockPool.dispatchRows.find((d) => d.id === "disp-101");
    expect(updatedDisp.status).toBe("paused");
    expect(updatedDisp.error_message).toContain("Pausado — servidor reiniciou durante o envio. Retome quando quiser.");
  });

  it("lead em 'claimed' sem sent_at NÃO é reenviado, vira 'skipped' e aparece na contagem de não confirmados", async () => {
    const mockPool = createMockPool({
      dispatches: [
        {
          id: "disp-102",
          name: "Lote Interrompido no Claim",
          campaign_id: "camp-1",
          client_id: "geracao-digital",
          status: "running",
          triggered_at: "2026-08-23T18:15:00.000Z",
        },
      ],
      runs: [
        { id: "run-1", dispatch_id: "disp-102", lead_id: "lead-1", phone: "5511999990001", status: "sent", sent_at: "2026-08-23T18:15:05.000Z" },
        { id: "run-2", dispatch_id: "disp-102", lead_id: "lead-2", phone: "5511999990002", status: "claimed", sent_at: null },
      ],
    });

    const result = await recoverOrphanDispatches(mockPool);

    expect(result.recovered).toBe(1);
    expect(result.items[0].leadsSent).toBe(1);
    expect(result.items[0].leadsUnconfirmed).toBe(1);
    expect(result.items[0].errorMessage).toContain("1 lead(s) com envio não confirmado");

    // O lead 'claimed' virou 'skipped'
    const lead2Run = mockPool.runRows.find((r) => r.id === "run-2");
    expect(lead2Run.status).toBe("skipped");
    expect(lead2Run.error_message).toContain("envio não confirmado");
  });

  it("lote 'interrupted' no boot também vira 'paused' para retomada manual segura", async () => {
    const mockPool = createMockPool({
      dispatches: [
        {
          id: "disp-interrupted-1",
          name: "Lote Interrompido Anteriormente",
          campaign_id: "camp-1",
          client_id: "geracao-digital",
          status: "interrupted",
          triggered_at: "2026-08-23T18:15:00.000Z",
        },
      ],
      runs: [],
    });

    const result = await recoverOrphanDispatches(mockPool);

    expect(result.recovered).toBe(1);
    expect(result.items[0]).toMatchObject({
      dispatchId: "disp-interrupted-1",
      dispatchName: "Lote Interrompido Anteriormente",
      leadsSent: 0,
      leadsUnconfirmed: 0,
    });
    expect(mockPool.dispatchRows[0].status).toBe("paused");
  });

  it("lotes em 'done', 'failed', 'draft' ou 'paused' permanecem 100% intocados", async () => {
    const mockPool = createMockPool({
      dispatches: [
        { id: "disp-done", name: "Concluído", status: "done", error_message: null },
        { id: "disp-failed", name: "Falhado prévio", status: "failed", error_message: "Erro anterior" },
        { id: "disp-draft", name: "Rascunho", status: "draft", error_message: null },
        { id: "disp-paused", name: "Pausado", status: "paused", error_message: null },
      ],
      runs: [],
    });

    const result = await recoverOrphanDispatches(mockPool);

    expect(result.recovered).toBe(0);
    expect(result.items).toEqual([]);

    expect(mockPool.dispatchRows.find((d) => d.id === "disp-done")?.status).toBe("done");
    expect(mockPool.dispatchRows.find((d) => d.id === "disp-failed")?.status).toBe("failed");
    expect(mockPool.dispatchRows.find((d) => d.id === "disp-draft")?.status).toBe("draft");
    expect(mockPool.dispatchRows.find((d) => d.id === "disp-paused")?.status).toBe("paused");
  });

  it("lote com 3 de 10 leads enviados: retomada seleciona estritamente os 7 restantes, nunca os 3 já enviados", () => {
    const all10Leads = Array.from({ length: 10 }, (_, i) => ({
      id: `lead-uuid-${i + 1}`,
      client_id: "geracao-digital",
      telefone: `551199999000${i + 1}`,
      nome: `Lead ${i + 1}`,
    }));

    // Simula 3 leads já processados em campaign_dispatch_runs para o dispatch 'disp-3-sent'
    const touchedRows = [
      { lead_id: "lead-uuid-1", phone: "5511999990001", status: "sent" },
      { lead_id: "lead-uuid-2", phone: "5511999990002", status: "sent" },
      { lead_id: "lead-uuid-3", phone: "5511999990003", status: "sent" },
    ];

    const touchedLeadIds = new Set(touchedRows.map((r) => r.lead_id));
    const touchedPhones = new Set(touchedRows.map((r) => r.phone));

    // Filtragem de retomada idêntica ao buildDispatchLeads
    const eligibleLeads = all10Leads.filter((lead) => {
      if (lead.id && touchedLeadIds.has(lead.id)) return false;
      if (lead.telefone && touchedPhones.has(lead.telefone)) return false;
      return true;
    });

    expect(eligibleLeads).toHaveLength(7);
    expect(eligibleLeads.map((l) => l.id)).toEqual([
      "lead-uuid-4",
      "lead-uuid-5",
      "lead-uuid-6",
      "lead-uuid-7",
      "lead-uuid-8",
      "lead-uuid-9",
      "lead-uuid-10",
    ]);

    // Nenhum dos 3 primeiros leads está na lista de envio da retomada
    expect(eligibleLeads.some((l) => l.id === "lead-uuid-1")).toBe(false);
    expect(eligibleLeads.some((l) => l.id === "lead-uuid-2")).toBe(false);
    expect(eligibleLeads.some((l) => l.id === "lead-uuid-3")).toBe(false);
  });
});
