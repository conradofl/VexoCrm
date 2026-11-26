// pickCampaignAwaitingReply: regra extraída do webhook de entrada (ETAPA 4), sem mudança.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pickCampaignAwaitingReply } from "../campaign/replyRouting.js";

const SEQ = { sequence: [
  { id: "s1", type: "text", text: "Oi", order: 1, enabled: true },
  { id: "s2", type: "text", text: "Passo 2", order: 2, enabled: true, triggerMode: "after_reply" },
] };
const esperando = (id = "camp-1") => ({ id, status: "ativa", analyticsMeta: SEQ, leadImportItem: { id: "it", progress: { status: "aguardando_usuario", nextStepIndex: 1, waitForReply: true } } });
const ctx = (camps, processing = []) => ({ matches: camps, waitForReplyMatches: camps, processingWaitForReplyMatches: processing, activePeriodCampaign: null });

describe("pickCampaignAwaitingReply", () => {
  it("pega a campanha com progresso pendente e próximo passo; ignora pausada, finalizada, com erro e sem passo", () => {
    const pausada = { ...esperando("p"), status: "pausada" };
    const finalizada = { ...esperando("f"), leadImportItem: { progress: { status: "finalizado", nextStepIndex: 1 } } };
    const erro = { ...esperando("e"), leadImportItem: { progress: { status: "erro", nextStepIndex: 1 } } };
    const semPasso = { ...esperando("s"), leadImportItem: { progress: { status: "aguardando_usuario", nextStepIndex: 5 } } };
    expect(pickCampaignAwaitingReply(ctx([pausada, finalizada, erro, semPasso, esperando("ok")]))?.id).toBe("ok");
    expect(pickCampaignAwaitingReply(ctx([pausada, finalizada]))).toBeNull();
  });

  it("sem candidata com passo: cai na 1ª em processamento, se não estiver pausada nem superada", () => {
    const proc = { id: "proc", status: "ativa" };
    expect(pickCampaignAwaitingReply(ctx([], [proc]))?.id).toBe("proc");
    expect(pickCampaignAwaitingReply(ctx([], [{ ...proc, status: "pausada" }]))).toBeNull();
    expect(pickCampaignAwaitingReply(ctx([], [{ ...proc, supersededByCompletedCampaign: true }]))).toBeNull();
  });

  it("o webhook usa a função extraída", () => {
    const src = readFileSync(resolve("src/domains/chatbot/routes.js"), "utf8");
    expect(src).toContain("let activeWaitCampaign = pickCampaignAwaitingReply(campaignReplyContext);");
  });
});
