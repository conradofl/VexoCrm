// Bloco 1 do follow-up, parte 1: a saída por resposta casa pelo tenant e só conta
// resposta recebida DEPOIS da inscrição.
//
// Postgres real (pglite) com o esquema das migrations do follow-up. Dublê só no que
// sai do processo: fila (Redis), HTTP da Evolution, configurações do tenant e lista
// de chips. Nada aqui dubla cancelFollowupCadenceOnReply, hasFollowupReplySince nem
// o worker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_A, COMPANY_A2, COMPANY_B, LEAD_PHONE,
  asPool, tolerantPool, getDb, setupFollowupReplyDb, closeFollowupReplyDb,
  createCadence, enroll, statusOf, addReply,
} from "./helpers/followupReplyDb.js";

vi.mock("../followup/db.js", async () => {
  const h = await import("./helpers/followupReplyDb.js");
  return { getPool: () => h.asPool(), query: (sql, params) => h.asPool().query(sql, params), getSupabase: () => ({}) };
});

const queueAdds = [];
vi.mock("../followup/queue.js", () => ({
  QUEUE_NAME: "followup-messages",
  getRedisConnection: () => ({}),
  getFollowupQueue: () => ({
    add: vi.fn(async (name, data, opts) => {
      queueAdds.push({ name, data, opts });
      return { id: `bull-${queueAdds.length}` };
    }),
  }),
}));

vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLeadClientEvolutionInstances: vi.fn(async () => [
      {
        id: "chip-1",
        name: "Chip 1",
        active: true,
        is_default: true,
        daily_limit_override: 500,
        dispatch_webhook_url: "https://evo.test/message/sendText/chip-1",
        dispatch_webhook_token: "tok-teste",
      },
    ]),
  };
});

vi.mock("../services/n8nSettings.js", () => ({
  getLeadClientN8nSettings: vi.fn(async () => ({ send_window_enabled: false })),
}));

import { cancelFollowupCadenceOnReply, hasFollowupReplySince } from "../services/followupExitGuard.js";
import { processJob } from "../followup/worker.js";

let evolutionCalls = [];
beforeEach(async () => {
  queueAdds.length = 0;
  evolutionCalls = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    evolutionCalls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  });
  await setupFollowupReplyDb();
});

afterEach(async () => {
  await closeFollowupReplyDb();
});

describe("cancelFollowupCadenceOnReply — casa pelo tenant", () => {
  it("T1: cancela a inscrição ativa e os jobs pendentes do tenant", async () => {
    const cad = await createCadence({ steps: [{ trigger_type: "after_enrollment" }, { trigger_type: "after_enrollment" }] });
    const { scheduleId, jobs } = await enroll(cad);

    const res = await cancelFollowupCadenceOnReply({ tenantId: "t-a", phone: LEAD_PHONE, queryFn: asPool().query });

    expect(res).toMatchObject({ cancelledSchedules: 1, cancelledJobs: 2 });
    expect(res.error).toBeUndefined();
    expect(await statusOf("followup_schedules", scheduleId)).toBe("cancelled");
    expect(await statusOf("followup_jobs", jobs[0])).toBe("cancelled");
    expect(await statusOf("followup_jobs", jobs[1])).toBe("cancelled");
  });

  it("T2: o mesmo telefone em outro tenant fica intocado", async () => {
    const cadB = await createCadence({ companyId: COMPANY_B });
    const b = await enroll({ ...cadB, companyId: COMPANY_B });

    const res = await cancelFollowupCadenceOnReply({ tenantId: "t-a", phone: LEAD_PHONE, queryFn: asPool().query });

    expect(res.cancelledSchedules).toBe(0);
    expect(await statusOf("followup_schedules", b.scheduleId)).toBe("active");
    expect(await statusOf("followup_jobs", b.jobs[0])).toBe("pending");
  });

  it("T2b: casa qualquer agente do tenant, não só o dono do chip", async () => {
    const cad = await createCadence({ companyId: COMPANY_A2 });
    const { scheduleId } = await enroll({ ...cad, companyId: COMPANY_A2 });

    await cancelFollowupCadenceOnReply({ tenantId: "t-a", phone: LEAD_PHONE, queryFn: asPool().query });

    expect(await statusOf("followup_schedules", scheduleId)).toBe("cancelled");
  });

  it("T3: cadência com exit_on_reply = false não é cancelada", async () => {
    const cad = await createCadence({ exitOnReply: false });
    const { scheduleId, jobs } = await enroll(cad);

    const res = await cancelFollowupCadenceOnReply({ tenantId: "t-a", phone: LEAD_PHONE, queryFn: asPool().query });

    expect(res.cancelledSchedules).toBe(0);
    expect(await statusOf("followup_schedules", scheduleId)).toBe("active");
    expect(await statusOf("followup_jobs", jobs[0])).toBe("pending");
  });

  it("T4: casa com e sem 9º dígito e com +55", async () => {
    const cad = await createCadence();
    const { scheduleId } = await enroll({ ...cad, phone: "+553491093607" }); // sem o 9

    await cancelFollowupCadenceOnReply({ tenantId: "t-a", phone: "5534991093607", queryFn: asPool().query });

    expect(await statusOf("followup_schedules", scheduleId)).toBe("cancelled");
  });

  it("T13: a consulta antiga (fs.company_id = slug) quebra com erro de tipo no Postgres real", async () => {
    // Registro do defeito que este bloco conserta: comparar uuid com o slug do tenant.
    await expect(
      getDb().query(`SELECT fs.id FROM followup_schedules fs WHERE fs.company_id = $1`, ["t-a"])
    ).rejects.toThrow(/uuid/i);
  });
});

describe("hasFollowupReplySince + worker — janela de tempo", () => {
  it("T10: resposta depois da inscrição pula o passo e não chama a Evolution", async () => {
    const cad = await createCadence();
    const { jobs } = await enroll({ ...cad, createdAt: "2026-10-01T12:00:00Z" });
    await addReply({ at: "2026-10-02T12:00:00Z" });

    await processJob({ data: { jobId: jobs[0] } });

    expect(await statusOf("followup_jobs", jobs[0])).toBe("skipped");
    expect(evolutionCalls).toHaveLength(0);
  });

  it("T11: resposta ANTES da inscrição não pula nada — o passo sai", async () => {
    const cad = await createCadence();
    const { jobs } = await enroll({ ...cad, createdAt: "2026-10-01T12:00:00Z" });
    await addReply({ at: "2026-09-01T12:00:00Z" });

    await processJob({ data: { jobId: jobs[0] } });

    expect(await statusOf("followup_jobs", jobs[0])).toBe("sent");
    expect(evolutionCalls).toHaveLength(1);
    expect(evolutionCalls[0].url).toContain("/message/sendText/chip-1");
  });

  it("T11b: resposta registrada por outro agente do mesmo tenant conta", async () => {
    expect(
      await (async () => {
        await addReply({ companyId: COMPANY_A2, at: "2026-10-02T12:00:00Z" });
        return hasFollowupReplySince({ tenantId: "t-a", phone: LEAD_PHONE, since: "2026-10-01T12:00:00Z", queryFn: asPool().query });
      })()
    ).toBe(true);
    expect(
      await hasFollowupReplySince({ tenantId: "t-b", phone: LEAD_PHONE, since: "2026-10-01T12:00:00Z", queryFn: asPool().query })
    ).toBe(false);
  });

  it("T12: exit_on_reply = false — passo no_reply é pulado, passo after_enrollment sai", async () => {
    const cad = await createCadence({
      exitOnReply: false,
      steps: [{ trigger_type: "no_reply" }, { trigger_type: "after_enrollment" }],
    });
    const { jobs } = await enroll({ ...cad, createdAt: "2026-10-01T12:00:00Z" });
    await addReply({ at: "2026-10-02T12:00:00Z" });

    await processJob({ data: { jobId: jobs[0] } });
    await processJob({ data: { jobId: jobs[1] } });

    expect(await statusOf("followup_jobs", jobs[0])).toBe("skipped");
    expect(await statusOf("followup_jobs", jobs[1])).toBe("sent");
    expect(evolutionCalls).toHaveLength(1);
  });
});
