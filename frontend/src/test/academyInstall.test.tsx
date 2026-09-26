// frontend/src/test/academyInstall.test.tsx
//
// Instalar usa os endpoints que já existem, com três regras: nunca liga
// nada sozinho (cria como rascunho, nenhum job entra na fila), nunca
// sobrescreve (nome repetido ganha sufixo, a cadência antiga não é tocada),
// pede o que falta (sem agente configurado, não instala — e diz por quê).

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ACADEMY_RECIPES } from "@/data/academyRecipes";

const getIdTokenMock = async () => "token";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: getIdTokenMock }),
}));

vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
  };
}

const recipe = ACADEMY_RECIPES[0]; // recipe-recuperar-lead-frio — 3 mensagens

// jsdom não implementa scrollIntoView/pointer capture — o Radix Select usa
// os dois ao abrir a lista, e sem isso a árvore inteira quebra no unmount.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});

describe("AcademyInstallDialog — instalar de verdade", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = undefined as any;
  });

  it("[TESTE OBRIGATÓRIO] receita que exige agente não instala sem agente — diz o que falta", async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/followup/companies")) {
        return jsonResponse({ companies: [] }); // nenhum agente configurado
      }
      return jsonResponse({});
    });
    global.fetch = fetchMock as any;

    const { AcademyInstallDialog } = await import("@/components/academy/AcademyInstallDialog");
    renderWithProviders(
      <AcademyInstallDialog recipe={recipe} clientId="sonhare" open={true} onOpenChange={vi.fn()} />
    );

    expect(await screen.findByText(/Nenhum agente configurado/)).toBeTruthy();
    const instalarButton = screen.getByRole("button", { name: /^Instalar$/ });
    expect(instalarButton).toHaveProperty("disabled", true);

    // nenhuma chamada de criação de cadência aconteceu
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/followup/campaigns"))).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] instala como rascunho — nenhum job é enfileirado, nenhuma ativação é chamada", async () => {
    fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/followup/companies")) {
        return jsonResponse({ companies: [{ id: "company-1", name: "Agente Um" }] });
      }
      if (u.includes("/api/followup/campaigns") && (!options || options.method === undefined)) {
        return jsonResponse({ campaigns: [] }); // nenhuma cadência existente ainda
      }
      if (u.includes("/api/followup/campaigns") && options?.method === "POST") {
        return jsonResponse({ campaign: { id: "campaign-1", name: JSON.parse(options.body as string).name } }, 201);
      }
      if (u.includes("/api/followup/templates") && options?.method === "POST") {
        return jsonResponse({ template: { id: "tpl-x" } }, 201);
      }
      if (u.includes("/api/academy/recipe-usage")) {
        return jsonResponse({ success: true }, 201);
      }
      return jsonResponse({});
    });
    global.fetch = fetchMock as any;

    const { AcademyInstallDialog } = await import("@/components/academy/AcademyInstallDialog");
    renderWithProviders(
      <AcademyInstallDialog recipe={recipe} clientId="sonhare" open={true} onOpenChange={vi.fn()} />
    );

    const trigger = await screen.findByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText("Agente Um"));
    fireEvent.click(screen.getByRole("button", { name: /^Instalar$/ }));

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(
        ([u, o]: [string, RequestInit?]) => String(u).includes("/api/followup/campaigns") && o?.method === "POST"
      );
      expect(createCall).toBeTruthy();
    });

    const createCall = fetchMock.mock.calls.find(
      ([u, o]: [string, RequestInit?]) => String(u).includes("/api/followup/campaigns") && o?.method === "POST"
    )!;
    const createdBody = JSON.parse((createCall[1] as RequestInit).body as string);
    // nunca liga nada sozinho: não manda status, não pede pra ativar — quem
    // decide isso é o backend (grava "draft" incondicionalmente)
    expect(createdBody.status).toBeUndefined();
    expect(createdBody.company_id).toBe("company-1");

    // as 3 mensagens da receita viraram 3 templates
    await waitFor(() => {
      const templateCalls = fetchMock.mock.calls.filter(
        ([u, o]: [string, RequestInit?]) => String(u).includes("/api/followup/templates") && o?.method === "POST"
      );
      expect(templateCalls).toHaveLength(recipe.templates.length);
    });

    // nenhuma chamada de ativação/enfileiramento de job em lugar nenhum —
    // nem enroll, nem PATCH de status, nem dispatch
    const suspiciousCalls = fetchMock.mock.calls.filter(([u]: [string]) => /enroll|dispatch|activate/.test(String(u)));
    expect(suspiciousCalls).toEqual([]);
    const patchCalls = fetchMock.mock.calls.filter(([, o]: [string, RequestInit?]) => o?.method === "PATCH");
    expect(patchCalls).toEqual([]);
  });

  it("[TESTE OBRIGATÓRIO] instalar duas vezes gera duas cadências — a segunda com sufixo, a primeira intacta", async () => {
    // simula que a primeira instalação já rodou: já existe uma cadência com
    // o nome-base da receita
    fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/followup/companies")) {
        return jsonResponse({ companies: [{ id: "company-1", name: "Agente Um" }] });
      }
      if (u.includes("/api/followup/campaigns") && (!options || options.method === undefined)) {
        return jsonResponse({ campaigns: [{ id: "campaign-existente", name: recipe.cadenceName }] });
      }
      if (u.includes("/api/followup/campaigns") && options?.method === "POST") {
        return jsonResponse({ campaign: { id: "campaign-2", name: JSON.parse(options.body as string).name } }, 201);
      }
      if (u.includes("/api/followup/templates") && options?.method === "POST") {
        return jsonResponse({ template: { id: "tpl-x" } }, 201);
      }
      if (u.includes("/api/academy/recipe-usage")) {
        return jsonResponse({ success: true }, 201);
      }
      return jsonResponse({});
    });
    global.fetch = fetchMock as any;

    const { AcademyInstallDialog } = await import("@/components/academy/AcademyInstallDialog");
    renderWithProviders(
      <AcademyInstallDialog recipe={recipe} clientId="sonhare" open={true} onOpenChange={vi.fn()} />
    );

    fireEvent.click(await screen.findByRole("combobox"));
    fireEvent.click(await screen.findByText("Agente Um"));
    fireEvent.click(screen.getByRole("button", { name: /^Instalar$/ }));

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(
        ([u, o]: [string, RequestInit?]) => String(u).includes("/api/followup/campaigns") && o?.method === "POST"
      );
      expect(createCall).toBeTruthy();
    });

    const createCall = fetchMock.mock.calls.find(
      ([u, o]: [string, RequestInit?]) => String(u).includes("/api/followup/campaigns") && o?.method === "POST"
    )!;
    const createdBody = JSON.parse((createCall[1] as RequestInit).body as string);

    // a segunda ganhou sufixo — não é o mesmo nome da primeira
    expect(createdBody.name).toBe(`${recipe.cadenceName} (2)`);
    expect(createdBody.name).not.toBe(recipe.cadenceName);

    // a cadência existente nunca foi tocada — nenhum PATCH, nenhum POST
    // endereçado a ela
    const touchedExisting = fetchMock.mock.calls.some(([u]: [string]) => String(u).includes("campaign-existente"));
    expect(touchedExisting).toBe(false);
    const patchCalls = fetchMock.mock.calls.filter(([, o]: [string, RequestInit?]) => o?.method === "PATCH");
    expect(patchCalls).toEqual([]);
  });
});
