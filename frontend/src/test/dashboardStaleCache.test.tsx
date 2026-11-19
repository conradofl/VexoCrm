// frontend/src/test/dashboardStaleCache.test.tsx
//
// Cálculo velho no cache (mais de 15 min): o servidor devolve o número velho e recalcula por trás.
// A tela tem que perguntar de novo até chegar o número novo, e não pode insistir quando o recálculo falhou.
// Visto em produção em 15/11/2026: a Visão geral abriu com "Contado em 13/11" e ficou assim.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  DASHBOARD_STALE_POLL_MAX,
  DASHBOARD_STALE_POLL_MS,
  dashboardStalePollInterval,
  useDashboard,
} from "../hooks/useDashboard";

const responses: Array<Record<string, unknown>> = [];
const fetchApi = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, getIdToken: async () => "token" }),
}));
vi.mock("@/lib/api", () => ({
  fetchApi: (...args: unknown[]) => {
    fetchApi(...args);
    return Promise.resolve({ ok: true });
  },
  readApiErrorMessage: async () => "",
  readApiJson: async () => responses.shift() ?? { cacheStatus: "fresh", lastError: null, lastUpdatedAt: "2026-11-15T12:10:00.000Z" },
}));

describe("dashboardStalePollInterval", () => {
  it("cálculo velho sem erro: pergunta de novo a cada 10 s", () => {
    expect(dashboardStalePollInterval({ cacheStatus: "stale", lastError: null }, 1)).toBe(DASHBOARD_STALE_POLL_MS);
    expect(DASHBOARD_STALE_POLL_MS).toBe(10_000);
  });

  it("número novo: para de perguntar", () => {
    expect(dashboardStalePollInterval({ cacheStatus: "fresh", lastError: null }, 3)).toBe(false);
    expect(dashboardStalePollInterval(undefined, 0)).toBe(false);
  });

  it("recálculo que falhou: não insiste (cada pergunta dispararia outro cálculo pesado)", () => {
    expect(dashboardStalePollInterval({ cacheStatus: "stale", lastError: "timeout" }, 1)).toBe(false);
  });

  it("tem teto: depois de ~90 s para de perguntar", () => {
    expect(dashboardStalePollInterval({ cacheStatus: "stale", lastError: null }, DASHBOARD_STALE_POLL_MAX)).toBe(DASHBOARD_STALE_POLL_MS);
    expect(dashboardStalePollInterval({ cacheStatus: "stale", lastError: null }, DASHBOARD_STALE_POLL_MAX + 1)).toBe(false);
  });
});

describe("useDashboard com cálculo velho", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    responses.length = 0;
    fetchApi.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function wrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it("abre com o número velho, avisa que está atualizando e troca pelo novo sem recarregar a página", async () => {
    responses.push(
      { cacheStatus: "stale", lastError: null, lastUpdatedAt: "2026-11-13T03:27:00.000Z" },
      { cacheStatus: "stale", lastError: null, lastUpdatedAt: "2026-11-13T03:27:00.000Z" },
      { cacheStatus: "fresh", lastError: null, lastUpdatedAt: "2026-11-15T12:10:00.000Z" },
    );
    const { result } = renderHook(() => useDashboard("c1"), { wrapper: wrapper() });

    await vi.waitFor(() => expect(result.current.data?.lastUpdatedAt).toBe("2026-11-13T03:27:00.000Z"));
    expect(result.current.refreshingInBackground).toBe(true);
    expect(fetchApi).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_STALE_POLL_MS);
    });
    await vi.waitFor(() => expect(fetchApi).toHaveBeenCalledTimes(2));
    expect(result.current.refreshingInBackground).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_STALE_POLL_MS);
    });
    await vi.waitFor(() => expect(result.current.data?.lastUpdatedAt).toBe("2026-11-15T12:10:00.000Z"));
    expect(result.current.refreshingInBackground).toBe(false);

    // Número novo: para de perguntar.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_STALE_POLL_MS * 3);
    });
    expect(fetchApi).toHaveBeenCalledTimes(3);
  });

  it("recálculo que falhou: mostra o velho e não pergunta de novo", async () => {
    responses.push({ cacheStatus: "stale", lastError: "timeout", lastUpdatedAt: "2026-11-13T03:27:00.000Z" });
    const { result } = renderHook(() => useDashboard("c1"), { wrapper: wrapper() });

    await vi.waitFor(() => expect(result.current.data?.lastUpdatedAt).toBe("2026-11-13T03:27:00.000Z"));
    expect(result.current.refreshingInBackground).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_STALE_POLL_MS * 3);
    });
    expect(fetchApi).toHaveBeenCalledTimes(1);
  });
});
