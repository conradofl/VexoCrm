import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Follow-up Enrollment & after_enrollment Support", () => {
  const serviceSource = readFileSync(resolve("src/followup/service.js"), "utf8");
  const routesSource = readFileSync(resolve("src/followup/routes.js"), "utf8");
  const workerSource = readFileSync(resolve("src/followup/worker.js"), "utf8");

  it("implements after_enrollment in calcScheduledFor", () => {
    expect(serviceSource).toContain('case "after_enrollment":');
    expect(serviceSource).toContain("return new Date(now + delta);");
  });

  it("checks past dates in enrollLead and skips them with descriptive messages", () => {
    expect(serviceSource).toContain("scheduledFor.getTime() <= now.getTime()");
    expect(serviceSource).toContain('reason: "past_date"');
    expect(serviceSource).toContain("skippedPastDate");
  });

  it("checks missing date requirements for before_meeting and after_meeting", () => {
    expect(serviceSource).toContain("skippedNoDate");
    expect(serviceSource).toContain('reason: "no_date"');
  });

  it("passes phone to renderMessage in worker.js", () => {
    expect(workerSource).toContain("phone: row.phone");
  });

  it("checa resposta no no_reply sempre e nos outros passos só com exit_on_reply (comportamento em followupReplyStopsCadence.test.js T12)", () => {
    expect(workerSource).toContain('const checksReply = row.trigger_type === "no_reply" || row.exit_on_reply !== false;');
    expect(workerSource).toContain("since: row.schedule_created_at");
  });

  it("surfaces errors with HTTP 422 when enqueued === 0 in enroll route", () => {
    expect(routesSource).toContain("if (enqueued === 0)");
    expect(routesSource).toContain("res.status(422).json(");
    expect(routesSource).toContain("skippedPastDate");
    expect(routesSource).toContain("skippedSteps");
  });

  it("provides clear CAMPAIGN_NOT_ACTIVE error in Portuguese", () => {
    expect(routesSource).toContain('CAMPAIGN_NOT_ACTIVE');
    expect(routesSource).toContain("está em rascunho ou pausada. Ative-a antes de aplicar");
  });

  it("ensures origin_type manual and updated statuses are permitted in migration constraints", () => {
    const migrationFix = readFileSync(resolve("supabase/migrations/20260827163000_fix_followup_schedules_origin_type_check.sql"), "utf8");
    expect(migrationFix).toContain("followup_schedules_origin_type_check");
    expect(migrationFix).toContain("'manual'");
    expect(migrationFix).toContain("'cancelled'");
    expect(migrationFix).toContain("'converted'");
  });
});
