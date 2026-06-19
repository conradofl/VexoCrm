import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve("src/App.tsx"), "utf8");
const sidebarSource = readFileSync(resolve("src/components/AppSidebar.tsx"), "utf8");
const protectedRouteSource = readFileSync(resolve("src/components/ProtectedRoute.tsx"), "utf8");
const hookSource = readFileSync(resolve("src/hooks/useVexoSales.ts"), "utf8");
const frontendVercelConfig = readFileSync(resolve("vercel.json"), "utf8");
const rootVercelConfig = readFileSync(resolve("../vercel.json"), "utf8");

describe("Vexo Sales frontend access control", () => {
  it("protects the Evolution Admin route with internal role and admin guard", () => {
    expect(appSource).toContain('path="evolution-admin"');
  });

  it("renders the sidebar item only when the authenticated user is admin", () => {
    expect(sidebarSource).toContain("isAdminUser");
    expect(sidebarSource).toContain('"Evolution Admin"');
    expect(sidebarSource).toContain('/crm/evolution-admin');
  });

  it("redirects direct URL access when requiredAdmin is not satisfied", () => {
    expect(protectedRouteSource).toContain("requiredAdmin");
    expect(protectedRouteSource).toContain("!isAdminUser");
    expect(protectedRouteSource).toContain("Navigate to={defaultRoute}");
  });

  it("does not enable Vexo Sales data fetching for non-admin users", () => {
    expect(hookSource).toContain("enabled: isAuthenticated && isAdminUser");
    expect(hookSource).toContain("/api/vexo-sales/opportunities");
  });

  it("keeps a same-origin API fallback for production fetch failures", () => {
    expect(hookSource).toContain("fetchVexoSales");
    expect(hookSource).toContain("getVexoSalesApiCandidates");
    expect(hookSource).toContain("normalizedPath");
    expect(hookSource).toContain("VEXO_SALES_REQUEST_TIMEOUT_MS");
    expect(hookSource).toContain("[vexo-sales-api]");
    expect(hookSource).toContain("fallback_success");
    expect(hookSource).toContain("request_timeout");
    expect(hookSource).toContain("shouldRetryVexoSalesResponse");
    expect(hookSource).toContain("retryable_response");
    expect(hookSource).toContain("Resposta HTML inesperada da API.");
    expect(hookSource).toContain("preferSameOrigin");
    expect(hookSource).toContain("[normalizedPath, absoluteApiUrl]");
    expect(frontendVercelConfig).toContain('"source": "/api/:path*"');
    expect(frontendVercelConfig).toContain("bks-bk-vexo.ymqjmy.easypanel.host/api/:path*");
    expect(rootVercelConfig).toContain('"source": "/api/:path*"');
    expect(rootVercelConfig).toContain("bks-bk-vexo.ymqjmy.easypanel.host/api/:path*");
  });
});
