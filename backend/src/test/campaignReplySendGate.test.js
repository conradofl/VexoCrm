// PR 10b do untangle: a porta da resposta (próximo passo da campanha depois que o lead respondeu) atravessa o portão.
// Antes: saía sem janela e sem cota. Agora: janela pela escolha do tenant para respostas fora do horário
// (agent_replies_outside_window, a mesma do agente), cota do chip igual ao lote, e "na dúvida, não envia".
// Recusado ou cota esgotada: nada sai e o progresso não vira erro (a próxima mensagem do lead tenta de novo).
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const CHIP = {
  id: "chip-1-uuid", name: "Chip 1", dispatch_webhook_url: "https://evo.teste/message/sendText/chip-1",
  dispatch_webhook_token: "tok", is_default: true, active: true,
};

vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLeadClientEvolutionInstances: vi.fn(async () => [CHIP]),
    checkEvolutionInstanceHealth: vi.fn(async () => ({ state: "open" })),
    resolveInstanceIdentifier: vi.fn(async ({ identifier }) => ({ canonicalName: CHIP.name, aliases: [CHIP.id, CHIP.name, "chip-1", identifier], chip: CHIP })),
  };
});

let settingsAtual = null;
let settingsFalha = false;
vi.mock("../services/n8nSettings.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLeadClientN8nSettings: vi.fn(async () => {
      if (settingsFalha) throw new Error("db fora");
      return settingsAtual;
    }),
  };
});

const escritas = [];
vi.mock("../services/database.js", () => {
  const chain = (table) => {
    const c = {
      eq: () => c, in: () => c, order: () => c, limit: () => c, select: () => c,
      maybeSingle: async () => {
        if (table === "campaigns") return { data: campanha, error: null };
        if (table === "campaign_dispatches") return { data: { evolution_instance_id: CHIP.id }, error: null };
        if (table === "lead_import_items") return { data: { id: "item-1", normalized_data: {} }, error: null };
        return { data: null, error: null };
      },
    };
    return c;
  };
  return {
    supabase: {
      from: (table) => ({
        select: () => chain(table),
        update: (payload) => { escritas.push({ table, payload }); return chain(table); },
        insert: (payload) => { escritas.push({ table, payload }); return chain(table); },
      }),
    },
    pgDatabasePool: {
      query: vi.fn(async (sql, params) => {
        escritas.push({ sql: String(sql), params });
        return { rows: [] };
      }),
    },
  };
});

let resumo = null;
const enviados = [];
vi.mock("../campaign-outbound.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    dispatchCampaignSequence: vi.fn(async (args) => {
      enviados.push(args);
      return { summary: resumo };
    }),
  };
});

const campanha = {
  id: "camp-1", name: "Campanha", client_id: "tenant-1", status: "running",
  analytics_meta: {
    sequence: [
      { id: "s1", type: "text", order: 1, text: "Oi", triggerMode: "immediate", enabled: true },
      { id: "s2", type: "text", order: 2, text: "Segundo passo", triggerMode: "after_reply", enabled: true },
      { id: "s3", type: "text", order: 3, text: "Terceiro passo", triggerMode: "after_reply", enabled: true },
    ],
    dispatchOptions: { waitForReply: true, evolutionInstanceId: CHIP.id },
  },
};

import { continueCampaignLeadFromReply } from "../campaign/dispatch.js";
import { evaluateReplySendGate } from "../campaign/sendGate.js";

// 25/11/2026 é quarta-feira. 21h em São Paulo = fora da janela 08–20.
const QUARTA_21H_SP = "2026-11-26T00:00:00Z";
const QUARTA_15H_SP = "2026-11-25T18:00:00Z";
const JANELA = { send_window_enabled: true, send_window_start: "08:00", send_window_end: "20:00", send_window_days: ["seg", "ter", "qua", "qui", "sex"], send_window_timezone: "America/Sao_Paulo" };

const responder = () =>
  continueCampaignLeadFromReply({
    clientId: "tenant-1",
    phone: "5511999990001",
    repliedAt: new Date().toISOString(),
    campaignMatch: {
      id: "camp-1",
      leadImportItem: { id: "item-1", progress: { waitForReply: true, status: "aguardando_usuario", nextStepIndex: 1, dispatchId: "disp-1" } },
    },
    replyPayload: { instance: "chip-1" },
  });

const escreveuErro = () => escritas.some((e) => JSON.stringify(e.payload ?? e.params ?? "").includes('"status":"erro"'));

beforeEach(() => {
  escritas.length = 0;
  enviados.length = 0;
  settingsAtual = null;
  settingsFalha = false;
  resumo = { successCount: 1, failureCount: 0, successPhones: ["5511999990001"], failures: [], warnings: [] };
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("evaluateReplySendGate", () => {
  it("toggle 'responde fora da janela' ligado (padrão): passa a qualquer hora", () => {
    expect(evaluateReplySendGate({ now: new Date(QUARTA_21H_SP), settings: JANELA }).allowed).toBe(true);
    expect(evaluateReplySendGate({ now: new Date(QUARTA_21H_SP), settings: null }).allowed).toBe(true);
  });
  it("toggle desligado: dentro passa, fora segura", () => {
    const s = { ...JANELA, agent_replies_outside_window: false };
    expect(evaluateReplySendGate({ now: new Date(QUARTA_15H_SP), settings: s }).allowed).toBe(true);
    expect(evaluateReplySendGate({ now: new Date(QUARTA_21H_SP), settings: s })).toMatchObject({ allowed: false, code: "OUTSIDE_SEND_WINDOW" });
  });
  it("configuração ilegível: segura", () => {
    expect(evaluateReplySendGate({ settingsUnreadable: true })).toMatchObject({ allowed: false, code: "SEND_SETTINGS_UNREADABLE" });
  });
});

describe("[OBRIGATÓRIO] continueCampaignLeadFromReply atravessa o portão", () => {
  it("toggle desligado e fora da janela: nada sai e o progresso não vira erro", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(QUARTA_21H_SP));
    settingsAtual = { ...JANELA, agent_replies_outside_window: false };
    const res = await responder();
    expect(res).toMatchObject({ continued: false, held: true, reason: "OUTSIDE_SEND_WINDOW" });
    expect(enviados).toHaveLength(0);
    expect(escreveuErro()).toBe(false);
  });

  it("configuração ilegível: nada sai", async () => {
    settingsFalha = true;
    const res = await responder();
    expect(res).toMatchObject({ continued: false, held: true, reason: "SEND_SETTINGS_UNREADABLE" });
    expect(enviados).toHaveLength(0);
  });

  it("toggle ligado (padrão) fora da janela: o passo sai, com a cota do chip no envio", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(QUARTA_21H_SP));
    settingsAtual = JANELA;
    const res = await responder();
    expect(res.continued).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(typeof enviados[0].quotaGate?.reserve).toBe("function");
  });

  it("cota do chip esgotada: nada saiu, resultado 'segurado', progresso não vira erro", async () => {
    resumo = { successCount: 0, failureCount: 0, successPhones: [], failures: [], warnings: [], allChipsExhausted: true, exhaustedChipName: "Chip 1" };
    const res = await responder();
    expect(res).toMatchObject({ continued: false, held: true, reason: "chip_quota_exhausted" });
    expect(escreveuErro()).toBe(false);
  });
});
