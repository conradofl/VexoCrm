import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const apiSource = readFileSync(resolve("src/lib/api.ts"), "utf8");
const dashboardSource = readFileSync(resolve("src/hooks/useDashboard.ts"), "utf8");
const leadClientsSource = readFileSync(resolve("src/hooks/useLeadClients.ts"), "utf8");
const adminUsersSource = readFileSync(resolve("src/hooks/useAdminUsers.ts"), "utf8");
const agenteSource = readFileSync(resolve("src/pages/Agente.tsx"), "utf8");
const userAccessManagementSource = readFileSync(resolve("src/pages/UserAccessManagement.tsx"), "utf8");

describe("CRM API resilience", () => {
  it("prefers same-origin API with timeout and external fallback in production", () => {
    expect(apiSource).toContain("API_REQUEST_TIMEOUT_MS");
    expect(apiSource).toContain("getApiCandidates");
    expect(apiSource).toContain("preferSameOrigin");
    expect(apiSource).toContain("[normalizedPath, absoluteApiUrl]");
    expect(apiSource).toContain("AbortController");
    expect(apiSource).toContain("request_timeout");
    expect(apiSource).toContain("fallback_success");
    expect(apiSource).toContain("Resposta HTML inesperada da API.");
  });

  it("uses the resilient API wrapper for dashboard and lead clients", () => {
    expect(dashboardSource).toContain('fetchApi(`/api/dashboard?clientId=');
    expect(leadClientsSource).toContain('fetchApi("/api/lead-clients"');
  });

  it("renders a safe notification fallback instead of silent failures", () => {
    expect(agenteSource).toContain("Modulo removido");
    expect(agenteSource).toContain("n8n_error_logs");
  });

  it("uses the resilient API wrapper for user access management", () => {
    expect(adminUsersSource).toContain('fetchApi("/api/admin/users"');
    expect(userAccessManagementSource).toContain("fetchApi(`/api/admin/users/");
    expect(userAccessManagementSource).toContain('fetchApi("/api/admin/users"');
    expect(userAccessManagementSource).toContain("fetchApi(endpoint");
    expect(userAccessManagementSource).not.toContain("API_BASE_URL");
  });

  it("renders a safe user list fallback instead of infinite loading", () => {
    expect(userAccessManagementSource).toContain("Nao foi possivel carregar usuarios");
    expect(userAccessManagementSource).toContain("Tentar novamente");
    expect(userAccessManagementSource).toContain("Nenhum usuario encontrado");
    expect(adminUsersSource).toContain("retry: 1");
    expect(adminUsersSource).toContain("[admin-users] invalid_items_payload");
  });
});
