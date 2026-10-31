// frontend/src/test/useSmartLinkAlertsToken.test.tsx
//
// O polling do live-feed saía sem Authorization desde 14c642a6 (08/10/2026). A rota
// exige requireFirebaseAuth, então toda chamada voltava 401 e o alerta de clique nunca
// apareceu. O hook passa a mandar o token, igual aos outros hooks de smart link.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const auth = { isAuthenticated: true, token: "token-de-teste" as string | null };

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: auth.isAuthenticated, getIdToken: async () => auth.token }),
}));
vi.mock("@/hooks/useCrmClient", () => ({
  useOptionalCrmClient: () => ({ selectedClientId: "vexo-adm" }),
}));

import { useSmartLinkAlerts } from "@/hooks/useSmartLinkAlerts";

let chamadas: Array<{ path: string; headers: Record<string, string> }>;
let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  chamadas = [];
  auth.isAuthenticated = true;
  auth.token = "token-de-teste";
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({
      path: new URL(url, "http://localhost").pathname,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    });
    return new Response(JSON.stringify({ clicks: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
});
afterEach(() => {
  qc.clear();
  vi.unstubAllGlobals();
});

describe("useSmartLinkAlerts manda o token no polling do live-feed", () => {
  it("[TESTE OBRIGATÓRIO] a chamada ao live-feed leva Authorization: Bearer <token>", async () => {
    const { result } = renderHook(() => useSmartLinkAlerts(), { wrapper });

    await waitFor(() => expect(chamadas.length).toBeGreaterThan(0));
    expect(chamadas[0].path).toBe("/api/smart-links/live-feed");
    expect(chamadas[0].headers.authorization).toBe("Bearer token-de-teste");
    await waitFor(() => expect(result.current.isError).toBe(false));
  });

  it("sem sessão, não chama a rota (nada de 401 em loop)", async () => {
    auth.isAuthenticated = false;
    renderHook(() => useSmartLinkAlerts(), { wrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(chamadas).toHaveLength(0);
  });
});
