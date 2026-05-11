import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serverSource = readFileSync(resolve("src/server.js"), "utf8");
const outboundSource = readFileSync(resolve("src/campaign-outbound.js"), "utf8");

describe("campaign reply flow safeguards", () => {
  it("continues all remaining steps after a lead reply, including immediate image steps", () => {
    expect(serverSource).toContain(".filter((entry) => entry.index >= nextStepIndex)");
    expect(serverSource).not.toContain(
      '.filter((entry) => entry.index >= nextStepIndex && entry.step.triggerMode === "after_reply")'
    );
  });

  it("moves a lead out of pending reply before sending post-reply steps to avoid duplicate replies", () => {
    expect(serverSource).toContain('status: "enviando_proximas_etapas"');
    expect(serverSource).toContain('leadStatus: "enviando_proximas_etapas"');
    expect(serverSource).toContain("reply_received_advancing_sequence");
  });

  it("starts the next campaign lead after a reply sequence or lead-level error", () => {
    expect(serverSource).toContain("startNextCampaignLeadInQueue({ campaign, clientId, repliedAt })");
    expect(serverSource).toContain("queue_next_lead_started");
    expect(serverSource).toContain('progress.status === "finalizado" || progress.status === "erro"');
  });

  it("calls n8n qualification without blocking the campaign queue", () => {
    expect(serverSource).toContain("callCampaignQualificationWebhook");
    expect(serverSource).toContain("campaign_sequence_completed");
    expect(serverSource).toContain("n8n_qualification_failed");
    expect(serverSource).toContain('leadStatus: n8nQualification.ok ? "qualificado_em_n8n" : "sequencia_concluida"');
  });

  it("does not use inbound message text as a phone fallback", () => {
    const replyRouteStart = serverSource.indexOf('app.post("/api/campaigns/reply-webhook"');
    const phoneStart = serverSource.indexOf("const phone = sanitizePhone(", replyRouteStart);
    const phoneBlock = serverSource.slice(
      phoneStart,
      serverSource.indexOf(");\n  const replyText", phoneStart)
    );
    expect(phoneBlock).not.toContain("body.data?.message?.conversation");
    expect(serverSource).toContain("const replyText =");
  });

  it("logs WhatsApp text and image send attempts with safe metadata", () => {
    expect(outboundSource).toContain("[campaign-outbound] whatsapp_step_request");
    expect(outboundSource).toContain("[campaign-outbound] whatsapp_step_success");
    expect(outboundSource).toContain("[campaign-outbound] whatsapp_step_failed");
    expect(outboundSource).toContain("hasMedia");
  });
});
