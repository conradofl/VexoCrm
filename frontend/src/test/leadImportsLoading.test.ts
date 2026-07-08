import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const hookSource = readFileSync(resolve("src/hooks/useLeadImports.ts"), "utf8");
const campaignsHookSource = readFileSync(resolve("src/hooks/useCampanhas.ts"), "utf8");

describe("Lead imports loading resilience", () => {
  it("keeps campaign import requests from staying pending forever", () => {
    expect(hookSource).toContain("LEAD_IMPORT_REQUEST_TIMEOUT_MS");
    expect(hookSource).toContain("fetchLeadImports");
    expect(hookSource).toContain("AbortController");
    expect(hookSource).toContain("request_timeout");
    expect(hookSource).toContain("fallback_success");
    expect(hookSource).toContain("Resposta HTML inesperada da API.");
  });

  it("refreshes dependent campaign data after a successful spreadsheet import", () => {
    expect(hookSource).toContain('queryClient.invalidateQueries({ queryKey: ["lead-import-items", variables.clientId] })');
  });

  it("keeps campaign creation from staying pending forever", () => {
    expect(campaignsHookSource).toContain("CAMPAIGN_REQUEST_TIMEOUT_MS");
    expect(campaignsHookSource).toContain("fetchCampaignsApi");
    expect(campaignsHookSource).toContain("AbortController");
    expect(campaignsHookSource).toContain("create_campaign");
    expect(campaignsHookSource).toContain("A API nao retornou a campanha criada.");
  });
});
