import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks para followup/db.js e followup/queue.js
vi.mock("../followup/db.js", () => {
  const queryMock = vi.fn();
  const supabaseMock = {
    from: vi.fn(),
  };
  return {
    query: queryMock,
    getSupabase: () => supabaseMock,
  };
});

vi.mock("../followup/queue.js", () => ({
  getFollowupQueue: () => ({
    add: vi.fn().mockResolvedValue({ id: "job-bull-1" }),
  }),
}));

import { query as mockQuery, getSupabase as mockGetSupabase } from "../followup/db.js";
import { registerFollowupRoutes } from "../followup/routes.js";

describe("ETAPA 5 — O Editor de Cadência que foi Desenhado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Commit 1: Editar passo — fiação e retorno de pendingJobsCount", () => {
    it("Editar passo persiste e avisa: PATCH muda mensagem e horário; releitura confirma os dois, e a resposta traz pendingJobsCount com o número real de jobs pendentes daquele template", async () => {
      let followupRouter = null;
      const fakeApp = {
        use: (path, router) => {
          if (path === "/api/followup") {
            followupRouter = router;
          }
        },
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
      };

      const noop = (req, res, next) => next?.();
      registerFollowupRoutes(fakeApp, noop, () => noop, noop);

      expect(followupRouter).toBeDefined();
      const patchLayer = followupRouter.stack.find(
        (l) => l.route && l.route.path === "/templates/:id" && l.route.methods.patch
      );
      expect(patchLayer).toBeDefined();
      const patchHandler = patchLayer.route.stack[patchLayer.route.stack.length - 1].handle;

      // Estado inicial em banco
      let templateInDb = {
        id: "tpl-step-1",
        campaign_id: "camp-alpha",
        name: "Passo Inicial",
        message: "Mensagem antiga do passo",
        trigger_type: "after_enrollment",
        trigger_value: 2,
        trigger_unit: "hours",
        trigger_direction: "after",
        scheduled_time: "10:00",
        anchor_field: null,
        is_active: true,
        order_index: 0,
        media_path: null,
      };

      // Mock de jobs pendentes associados ao template: 3 jobs pendentes
      const pendingJobsInDb = [
        { id: "job-1", template_id: "tpl-step-1", status: "pending" },
        { id: "job-2", template_id: "tpl-step-1", status: "pending" },
        { id: "job-3", template_id: "tpl-step-1", status: "pending" },
        { id: "job-4", template_id: "tpl-step-1", status: "sent" },
        { id: "job-5", template_id: "tpl-step-1", status: "cancelled" },
      ];

      mockQuery.mockImplementation(async (sql, params = []) => {
        if (sql.includes("COUNT(*)::int as count FROM followup_jobs WHERE template_id = $1 AND status = 'pending'")) {
          const [tplId] = params;
          const count = pendingJobsInDb.filter(
            (j) => j.template_id === tplId && j.status === "pending"
          ).length;
          return { rows: [{ count }] };
        }
        return { rows: [] };
      });

      const supabase = mockGetSupabase();
      supabase.from.mockImplementation((table) => {
        if (table === "followup_templates") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col, val) => ({
                maybeSingle: vi.fn().mockImplementation(async () => {
                  if (col === "id" && val === templateInDb.id) {
                    return { data: { ...templateInDb }, error: null };
                  }
                  return { data: null, error: null };
                }),
              })),
            }),
            update: vi.fn().mockImplementation((patch) => ({
              eq: vi.fn().mockImplementation((col, val) => ({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockImplementation(async () => {
                    if (col === "id" && val === templateInDb.id) {
                      templateInDb = { ...templateInDb, ...patch };
                      return { data: { ...templateInDb }, error: null };
                    }
                    return { data: null, error: null };
                  }),
                }),
              })),
            })),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });

      // 1. PATCH com nova mensagem e novo horário fixo
      const req = {
        params: { id: "tpl-step-1" },
        body: {
          message: "Olá {{nome}}, sua reunião foi remarcada!",
          scheduled_time: "15:45",
        },
      };
      const res = {
        statusCode: 200,
        status(s) {
          this.statusCode = s;
          return this;
        },
        json: vi.fn(),
      };

      await patchHandler(req, res);

      // Asserções na resposta
      expect(res.json).toHaveBeenCalledTimes(1);
      const resData = res.json.mock.calls[0][0];

      expect(resData.success).toBe(true);
      expect(resData.template.message).toBe("Olá {{nome}}, sua reunião foi remarcada!");
      expect(resData.template.scheduled_time).toBe("15:45");
      expect(resData.pendingJobsCount).toBe(3); // Apenas os 3 pendentes, excluindo sent e cancelled
      expect(resData.timingChanged).toBe(true);

      // 2. Releitura para confirmar persistência dos dois campos
      const { data: reread } = await supabase
        .from("followup_templates")
        .select("*")
        .eq("id", "tpl-step-1")
        .maybeSingle();

      expect(reread).toBeDefined();
      expect(reread.message).toBe("Olá {{nome}}, sua reunião foi remarcada!");
      expect(reread.scheduled_time).toBe("15:45");
    });
  });
});
