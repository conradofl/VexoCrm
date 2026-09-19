// backend/src/test/sdrRotation.test.js
//
// Rodízio de avisos de SDR — "o rodízio decide por lead, não por mensagem".
// A regra central: uma vez escolhido o consultor de um lead, TODO aviso
// daquele lead vai para ele, mesmo que a volta tenha andado no meio por
// causa de outros leads. Girar por mensagem é o erro clássico que torna
// rodízio inútil (dois consultores ligando pra mesma pessoa).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveSdrTarget, SDR_MOTIVOS } from "../services/sdrTarget.js";
import { resetSdrRotationStateForTest } from "../services/sdrRotationState.js";

/**
 * Mock de pool + supabase que se comporta como o banco de verdade se
 * comportaria: cursor por client_id persistido num Map (não em memória do
 * processo — o teste de "sobrevive a reinício" limpa só o flag de
 * ensure-table, não este Map, exatamente pra provar que quem persiste é a
 * tabela, não o processo).
 */
function makeRotationBackend() {
  const cursorByClient = new Map();
  const leadsById = new Map(); // id -> { client_id, dados }

  // pg real aceita (sql, params) — o mock usa os params pra achar o client_id certo.
  const pool = {
    query: vi.fn(async (sql, params) => {
      if (sql.includes("CREATE TABLE")) return { rows: [] };
      if (sql.includes("INSERT INTO public.sdr_rotation_state")) {
        const clientId = params[0];
        const current = cursorByClient.get(clientId);
        const next = current === undefined ? 0 : current + 1;
        cursorByClient.set(clientId, next);
        return { rows: [{ cursor: next }] };
      }
      return { rows: [] };
    }),
  };

  const supabase = {
    from: (table) => {
      if (table !== "leads") throw new Error(`tabela inesperada: ${table}`);
      return {
        select: () => ({
          eq: (_col1, leadId) => ({
            eq: () => ({
              maybeSingle: async () => ({ data: leadsById.get(leadId) || null }),
            }),
          }),
        }),
        update: (patch) => ({
          eq: (_col1, leadId) => ({
            eq: async () => {
              const existing = leadsById.get(leadId) || {};
              leadsById.set(leadId, { ...existing, ...patch });
              return { data: null, error: null };
            },
          }),
        }),
      };
    },
  };

  return { pool, supabase, cursorByClient, leadsById, seedLead: (id, dados = {}) => leadsById.set(id, { dados }) };
}

const tenantSettings = { sdr_whatsapp_numbers: ["5534910000001", "5534910000002", "5534910000003"] };

describe("resolveSdrTarget — mode: rodizio", () => {
  beforeEach(() => {
    resetSdrRotationStateForTest();
  });

  it("[TESTE OBRIGATÓRIO — central] o mesmo lead sempre volta pro mesmo consultor, mesmo com a volta avançando no meio por outros leads", async () => {
    const { pool, supabase, seedLead } = makeRotationBackend();
    seedLead("lead-A");

    const primeiro = await resolveSdrTarget({
      inboundConfig: null, tenantSettings, mode: "rodizio",
      leadId: "lead-A", clientId: "tenant-1", supabase, pool,
    });
    expect(primeiro.number).toBe("5534910000001");

    // outro lead consome um giro da volta no meio
    await resolveSdrTarget({
      inboundConfig: null, tenantSettings, mode: "rodizio",
      leadId: "lead-outro", clientId: "tenant-1", supabase, pool,
    });

    // três avisos SEGUINTES do lead-A — sempre o mesmo número
    for (let i = 0; i < 3; i++) {
      const aviso = await resolveSdrTarget({
        inboundConfig: null, tenantSettings, mode: "rodizio",
        leadId: "lead-A", clientId: "tenant-1", supabase, pool,
      });
      expect(aviso.number).toBe("5534910000001");
      expect(aviso.reason).toBe(SDR_MOTIVOS.OK);
    }
  });

  it("[TESTE OBRIGATÓRIO] leads diferentes giram: 4 leads novos com 3 consultores → 1, 2, 3, 1", async () => {
    const { pool, supabase, seedLead } = makeRotationBackend();
    ["lead-1", "lead-2", "lead-3", "lead-4"].forEach((id) => seedLead(id));

    const resultados = [];
    for (const leadId of ["lead-1", "lead-2", "lead-3", "lead-4"]) {
      const alvo = await resolveSdrTarget({
        inboundConfig: null, tenantSettings, mode: "rodizio",
        leadId, clientId: "tenant-1", supabase, pool,
      });
      resultados.push(alvo.number);
    }

    expect(resultados).toEqual([
      "5534910000001",
      "5534910000002",
      "5534910000003",
      "5534910000001",
    ]);
  });

  it("[TESTE OBRIGATÓRIO] a volta sobrevive ao reinício: cursor persistido, não em memória do processo", async () => {
    const { pool, supabase, seedLead } = makeRotationBackend();
    seedLead("lead-1");
    seedLead("lead-2");
    seedLead("lead-3");

    await resolveSdrTarget({ inboundConfig: null, tenantSettings, mode: "rodizio", leadId: "lead-1", clientId: "tenant-1", supabase, pool });
    await resolveSdrTarget({ inboundConfig: null, tenantSettings, mode: "rodizio", leadId: "lead-2", clientId: "tenant-1", supabase, pool });

    // "reinício do servidor": limpa só o flag de ensure-table (estado em
    // memória do processo) — o cursor persistido no Map (== a tabela) continua.
    resetSdrRotationStateForTest();

    const depoisDoReinicio = await resolveSdrTarget({
      inboundConfig: null, tenantSettings, mode: "rodizio",
      leadId: "lead-3", clientId: "tenant-1", supabase, pool,
    });

    // não volta pro primeiro (5534910000001) — continua de onde parou.
    expect(depoisDoReinicio.number).toBe("5534910000003");
  });

  it("[TESTE OBRIGATÓRIO] mode 'todos' não muda nada — byte a byte o comportamento de hoje", async () => {
    const { pool, supabase } = makeRotationBackend();

    const semMode = await resolveSdrTarget({ inboundConfig: null, tenantSettings });
    const comModeTodos = await resolveSdrTarget({
      inboundConfig: null, tenantSettings, mode: "todos",
      leadId: "lead-x", clientId: "tenant-1", supabase, pool,
    });

    expect(semMode).toEqual({
      numbers: ["5534910000001", "5534910000002", "5534910000003"],
      number: "5534910000001",
      reason: SDR_MOTIVOS.OK,
      excluded: [],
    });
    expect(comModeTodos).toEqual(semMode);
    // nenhuma chamada ao banco aconteceu — "todos" nem olha pra tabela de rodízio.
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("[TESTE OBRIGATÓRIO] transferência desligada vence o rodízio — com ou sem rodízio, ninguém é avisado", async () => {
    const { pool, supabase } = makeRotationBackend();
    const alvo = await resolveSdrTarget({
      inboundConfig: { sdrTransferEnabled: false },
      tenantSettings, mode: "rodizio",
      leadId: "lead-x", clientId: "tenant-1", supabase, pool,
    });
    expect(alvo.numbers).toEqual([]);
    expect(alvo.reason).toBe(SDR_MOTIVOS.TRANSFERENCIA_DESLIGADA);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("[TESTE OBRIGATÓRIO] consultor removido da lista: lead cujo dono saiu cai pro próximo da volta, nunca fica sem aviso", async () => {
    const { pool, supabase, seedLead } = makeRotationBackend();
    // lead-A já tem dono gravado, mas esse número NÃO está mais na lista do tenant
    seedLead("lead-A", { sdr_rotation_owner: "5534999998888" });

    const alvo = await resolveSdrTarget({
      inboundConfig: null, tenantSettings, mode: "rodizio",
      leadId: "lead-A", clientId: "tenant-1", supabase, pool,
    });

    expect(alvo.numbers.length).toBe(1);
    expect(tenantSettings.sdr_whatsapp_numbers).toContain(alvo.number);
    expect(alvo.number).not.toBe("5534999998888");
    expect(alvo.reason).toBe(SDR_MOTIVOS.OK);
  });

  it("lista vazia cai no comportamento de hoje mesmo em modo rodízio", async () => {
    const { pool, supabase } = makeRotationBackend();
    const alvo = await resolveSdrTarget({
      inboundConfig: null, tenantSettings: { sdr_whatsapp_numbers: [] }, mode: "rodizio",
      leadId: "lead-x", clientId: "tenant-1", supabase, pool,
    });
    expect(alvo.numbers).toEqual([]);
    expect(alvo.reason).toBe(SDR_MOTIVOS.SEM_NUMERO);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("número da própria conversa continua nunca entrando, mesmo em rodízio", async () => {
    const { pool, supabase, seedLead } = makeRotationBackend();
    seedLead("lead-A");
    const alvo = await resolveSdrTarget({
      inboundConfig: null,
      tenantSettings: { sdr_whatsapp_numbers: ["5534910000001"] },
      mode: "rodizio",
      excludeNumbers: ["5534910000001"],
      leadId: "lead-A", clientId: "tenant-1", supabase, pool,
    });
    expect(alvo.numbers).toEqual([]);
    expect(alvo.reason).toBe(SDR_MOTIVOS.TODOS_EXCLUIDOS);
  });

  it("agente com número próprio (override) não gira — rodízio só vale sobre a lista do tenant", async () => {
    const { pool, supabase } = makeRotationBackend();
    const alvo = await resolveSdrTarget({
      inboundConfig: { sdrTransferEnabled: true, sdrPhone: "5534977776666" },
      tenantSettings, mode: "rodizio",
      leadId: "lead-x", clientId: "tenant-1", supabase, pool,
    });
    expect(alvo.number).toBe("5534977776666");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("faltando leadId/clientId/supabase/pool, rodízio cai pra 'todos' (mais seguro que girar sem conseguir fixar dono)", async () => {
    const alvo = await resolveSdrTarget({ inboundConfig: null, tenantSettings, mode: "rodizio" });
    expect(alvo.numbers).toEqual(["5534910000001", "5534910000002", "5534910000003"]);
  });
});
