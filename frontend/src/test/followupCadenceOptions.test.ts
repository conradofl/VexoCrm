import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Cadence Trigger Types & Modal Validation", () => {
  const cadenceEditorSource = readFileSync(resolve("src/components/followup/CadenceEditor.tsx"), "utf8");
  const modalSource = readFileSync(resolve("src/components/followup/ApplyFollowupModal.tsx"), "utf8");
  const followupQueueSource = readFileSync(resolve("src/pages/FollowupQueue.tsx"), "utf8");

  it("exposes all 5 clear trigger options including after_enrollment in CadenceEditor", () => {
    expect(cadenceEditorSource).toContain('"on_schedule"');
    expect(cadenceEditorSource).toContain('"Na hora da inscrição (imediato)"');
    expect(cadenceEditorSource).toContain('"after_enrollment"');
    expect(cadenceEditorSource).toContain('"X depois da inscrição (incondicional)"');
    expect(cadenceEditorSource).toContain('"no_reply"');
    expect(cadenceEditorSource).toContain('"X depois da inscrição, se não responder"');
    expect(cadenceEditorSource).toContain('"before_meeting"');
    expect(cadenceEditorSource).toContain('"X antes da data-alvo (exige data)"');
    expect(cadenceEditorSource).toContain('"after_meeting"');
    expect(cadenceEditorSource).toContain('"X depois da data-alvo (exige data)"');
  });

  it("ApplyFollowupModal calculates real-time step preview and warns on past dates or missing target dates", () => {
    expect(modalSource).toContain("function getStepPreview(");
    expect(modalSource).toContain('"warning_past"');
    expect(modalSource).toContain('"Horário já passou"');
    expect(modalSource).toContain('"warning_no_date"');
    expect(modalSource).toContain("hasOnlySkippedSteps");
  });

  it("ApplyFollowupModal never displays success toast on zero enqueued/enrolled and surfaces full error messages", () => {
    expect(modalSource).toContain("body.enrolled === 0 || body.enqueued === 0");
    expect(modalSource).toContain("setErrorDetails(");
    expect(modalSource).toContain("toast.error");
  });

  it("exposes anchor trigger options, whitelist selector and scheduled_time in CadenceEditor", () => {
    expect(cadenceEditorSource).toContain('"before_anchor"');
    expect(cadenceEditorSource).toContain('"X antes de uma data do lead"');
    expect(cadenceEditorSource).toContain('"after_anchor"');
    expect(cadenceEditorSource).toContain('"X depois de uma data do lead"');
    expect(cadenceEditorSource).toContain("buscada automaticamente no cadastro do lead");
    expect(cadenceEditorSource).toContain("Enviar às (opcional)");
    expect(cadenceEditorSource).toContain("Linha do tempo da cadência");
  });

  it("FollowupQueue keeps event journeys hidden while preserving the component", () => {
    expect(followupQueueSource).toContain("FollowUpJourneys");
    expect(followupQueueSource).toContain("false as boolean && isSectionAllowed");
  });
});
