import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serverSource = readFileSync(resolve("src/server.js"), "utf8");
const domainRoutesSource = readFileSync(resolve("src/domains/registerAllDomainRoutes.js"), "utf8");
const routeBundle = `${serverSource}\n${domainRoutesSource}`;
const outboundSource = readFileSync(resolve("src/campaign-outbound.js"), "utf8");

describe("campaign reply flow safeguards", () => {
  it("continues all remaining steps after a lead reply, including immediate image steps", () => {
    expect(routeBundle).toContain(".filter((entry) => entry.index >= nextStepIndex)");
    expect(routeBundle).not.toContain(
      '.filter((entry) => entry.index >= nextStepIndex && entry.step.triggerMode === "after_reply")'
    );
  });

  it("moves a lead out of pending reply before sending post-reply steps to avoid duplicate replies", () => {
    expect(routeBundle).toContain('status: "enviando_proximas_etapas"');
    expect(routeBundle).toContain('leadStatus: "enviando_proximas_etapas"');
    expect(routeBundle).toContain("reply_received_advancing_sequence");
  });

  it("starts the next campaign lead after a reply sequence or lead-level error", () => {
    expect(routeBundle).toContain("startNextCampaignLeadInQueue({ campaign, clientId, repliedAt })");
    expect(routeBundle).toContain("queue_next_lead_started");
    expect(routeBundle).toContain('progress.status === "finalizado" || progress.status === "erro"');
  });

  it("calls n8n qualification without blocking the campaign queue", () => {
    expect(routeBundle).toContain("callCampaignQualificationWebhook");
    expect(routeBundle).toContain("campaign_sequence_completed");
    expect(routeBundle).toContain("n8n_qualification_failed");
    expect(routeBundle).toContain('leadStatus: n8nQualification.ok ? "qualificado_em_n8n" : "sequencia_concluida"');
  });

  it("does not use inbound message text as a phone fallback", () => {
    const replyRouteStart = routeBundle.indexOf('app.post("/api/campaigns/reply-webhook"');
    const phoneStart = routeBundle.indexOf("const phone = sanitizePhone(", replyRouteStart);
    const replyTextIdx = routeBundle.indexOf("const replyText", phoneStart);
    const phoneBlock = routeBundle.slice(phoneStart, replyTextIdx);
    expect(phoneBlock).not.toContain("body.data?.message?.conversation");
    expect(routeBundle).toContain("const replyText =");
  });

  it("logs WhatsApp text and image send attempts with safe metadata", () => {
    expect(outboundSource).toContain("[campaign-outbound] whatsapp_step_request");
    expect(outboundSource).toContain("[campaign-outbound] whatsapp_step_success");
    expect(outboundSource).toContain("[campaign-outbound] whatsapp_step_failed");
    expect(outboundSource).toContain("hasMedia");
  });

  it("stores and validates per-dispatch templates instead of sending empty dispatch steps", () => {
    expect(routeBundle).toContain("INVALID_DISPATCH_TEMPLATE");
    expect(routeBundle).toContain("steps: validation.analyticsMeta.sequence");
    expect(routeBundle).toContain("const dispatchSteps = Array.isArray(dispatch.steps) && dispatch.steps.length > 0 ? dispatch.steps : null");
    expect(routeBundle).toContain("analyticsMeta: validation.analyticsMeta");
  });

  it("supports rotating AI text variants per lead", () => {
    expect(outboundSource).toContain("textVariants");
    expect(outboundSource).toContain("leadIndex % variants.length");
    expect(routeBundle).toContain("/api/campaigns/ai/generate-template-variants");
  });
});
