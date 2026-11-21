// Marca "envio iniciado" no motor de campanha (21/11/2026).
//
// No boot, um lead 'claimed' sem eco do envio era sempre ambíguo: não havia registro de que a chamada à Evolution
// tinha começado. Agora o motor chama onLeadSendStarting uma vez por lead, ANTES da primeira chamada à Evolution, e
// o lote grava a marca no run. Sem a marca, o lead NÃO é enviado: o claim é desfeito e ele fica pendente. Assim, no
// reinício, "sem marca" prova que a chamada não aconteceu.
//
// Motor real (campaign-outbound.js). Dublê só no HTTP da Evolution (fetch).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchCampaignSequence } from "../campaign-outbound.js";

const ordem = [];
let fetchOriginal;

beforeEach(() => {
  ordem.length = 0;
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url, init) => {
    const corpo = String(init?.body || "");
    const tel = (corpo.match(/55\d{10,11}/) || [""])[0];
    if (!/connectionState|fetchInstances|whatsappNumbers/.test(String(url))) ordem.push(`evolution:${tel}`);
    return { ok: true, status: 200, json: async () => ({ key: { id: "wa-1" } }), text: async () => '{"key":{"id":"wa-1"}}' };
  });
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

const LEADS = [
  { id: "lead-1", nome: "Ana", telefone: "5534999990001" },
  { id: "lead-2", nome: "Bia", telefone: "5534999990002" },
];
const SEQ = {
  sequence: [
    { id: "s1", type: "text", text: "Oi {{nome}}", order: 1, enabled: true, triggerMode: "immediate", delayAfterSeconds: 0 },
    { id: "s2", type: "text", text: "Tudo bem?", order: 2, enabled: true, triggerMode: "with_previous", delayAfterSeconds: 0 },
  ],
};
const enviadosPara = (tel) => ordem.filter((x) => x === `evolution:${tel}`).length;

function disparar(extra = {}) {
  return dispatchCampaignSequence({
    webhookUrl: "https://evolution.teste/message/sendText/chip-1",
    webhookToken: "t",
    leads: LEADS,
    analyticsMeta: SEQ,
    leadDelayProvider: () => 0,
    onLeadClaim: async ({ lead }) => { ordem.push(`claim:${lead.id}`); return true; },
    ...extra,
  });
}

describe("marca de envio iniciado no motor", { timeout: 60_000 }, () => {
  it("a marca é gravada UMA vez por lead, depois do claim e ANTES da primeira chamada à Evolution", async () => {
    const marca = vi.fn(async ({ lead }) => { ordem.push(`marca:${lead.id}`); return true; });
    const { summary } = await disparar({ onLeadSendStarting: marca });
    expect(summary.successCount).toBe(2);
    expect(marca).toHaveBeenCalledTimes(2);
    const i1 = ordem.indexOf("marca:lead-1");
    expect(ordem.indexOf("claim:lead-1")).toBeLessThan(i1);
    expect(i1).toBeLessThan(ordem.indexOf("evolution:5534999990001"));
    expect(enviadosPara("5534999990001")).toBe(2); // os dois passos, uma marca só
  });

  it.each([
    ["devolve false", async ({ lead }) => lead.id !== "lead-1"],
    ["lança erro", async ({ lead }) => { if (lead.id === "lead-1") throw new Error("connection terminated"); return true; }],
  ])("gravar a marca falhou (%s): o lead NÃO é enviado, o claim é desfeito e ele não conta como falha", async (_n, marca) => {
    const rollback = vi.fn(async () => {});
    const falha = vi.fn(async () => {});
    const { summary } = await disparar({ onLeadSendStarting: marca, onLeadClaimRollback: rollback, onLeadFailed: falha });
    expect(enviadosPara("5534999990001")).toBe(0);
    expect(rollback).toHaveBeenCalledWith(expect.objectContaining({ lead: LEADS[0], reason: "send_marker_failed" }));
    expect(falha).not.toHaveBeenCalled();
    // o lead seguinte segue normal
    expect(enviadosPara("5534999990002")).toBe(2);
    expect(summary.successCount).toBe(1);
    expect(summary.successPhones).toEqual(["5534999990002"]);
  });

  it("sem o gancho (outros caminhos do motor): envia como sempre", async () => {
    const { summary } = await disparar();
    expect(summary.successCount).toBe(2);
    expect(enviadosPara("5534999990001")).toBe(2);
  });
});
