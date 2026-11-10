// Portal do cliente trancado até a Fase 3 (decisão do dono, 01/11/2026). O painel Vox2You é protótipo com
// dados inventados e estava numa rota pública. Em produção, sem backend do portal, o hook devolve null
// (a página diz "ainda não configurado"); o protótipo só aparece em DEV. O fetch é o único dublê.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useClientPortal } from "@/hooks/useClientPortal";

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, headers: new Headers(), json: async () => ({}), text: async () => "" })));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("useClientPortal sem backend do portal", () => {
  it("produção: devolve null, nunca o protótipo, nem com estado antigo no localStorage", async () => {
    vi.stubEnv("DEV", false);
    localStorage.setItem("vexo_client_portal_vox2you", JSON.stringify({ companyName: "Vox2you Uberlândia Lídice" }));
    const { result } = renderHook(() => useClientPortal("vox2you"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("DEV: o protótipo continua abrindo como modelo", async () => {
    vi.stubEnv("DEV", true);
    const { result } = renderHook(() => useClientPortal("vox2you"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.companyName).toBe("Vox2you Uberlândia Lídice");
  });
});

describe("rota /portal/:slug", () => {
  // Desde 09/11/2026 /portal/:slug é o portal do cliente GD e abre sem login. O que protege o dado não é mais a
  // rota da tela: o servidor só responde a slug com sufixo secreto (backend: portalSlug.js e gdClientesRoutes.test.js).
  it("abre o portal do cliente GD, e o protótipo antigo não está em rota pública", () => {
    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(app).toMatch(/path="\/portal\/:slug"\s*element=\{\s*<GeracaoDigitalPortalCliente \/>/);
    expect(app).not.toMatch(/path="\/portal\/:slug"\s*element=\{\s*<ClientPortal \/>/);
  });

  it("o hook não importa o protótipo de forma estática (senão ele volta para o bundle)", () => {
    const hook = readFileSync(resolve(process.cwd(), "src/hooks/useClientPortal.ts"), "utf8");
    expect(hook).not.toMatch(/^import .*clientPortalPrototype/m);
    expect(hook).not.toMatch(/Vox2you Uberlândia/);
  });
});
