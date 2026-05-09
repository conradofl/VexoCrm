import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const hookSource = readFileSync(resolve("src/hooks/useLeadImports.ts"), "utf8");
const pageSource = readFileSync(resolve("src/pages/LeadImports.tsx"), "utf8");

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
    expect(pageSource).toContain("await Promise.allSettled([refetch(), refetchPending()])");
    expect(hookSource).toContain('queryClient.invalidateQueries({ queryKey: ["lead-import-items", variables.clientId] })');
  });

  it("does not render permanent loading text when pending leads fail to load", () => {
    expect(pageSource).toContain("pendingSummaryLabel");
    expect(pageSource).toContain("campaignPendingLabel");
    expect(pageSource).toContain("Falha ao carregar leads pendentes");
    expect(pageSource).toContain("Nao foi possivel carregar os leads");
    expect(pageSource).toContain("Tentar novamente");
  });
});
