// src/test/attributionPanel.test.tsx
//
// O painel de atribuição de verdade (Raia 1 da Inteligência Comercial), com leads vindos do servidor: o lead
// da planilha sem canal aparece na linha "Importação de planilha", não em "Origem desconhecida".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: async () => "tok", isAdminUser: true, isInternalUser: true, canAccessInternalPage: () => true, hasPermission: () => true }),
}));
vi.mock("@/hooks/useCrmClient", () => ({ useOptionalCrmClient: () => null, useCrmClient: () => ({}) }));
vi.mock("@/hooks/useCommercialIntelligence", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useCommercialIntelligence: () => ({ data: { client: { name: "Cliente" }, generatedAt: "2026-10-03T12:00:00Z", metrics: { items: [] }, overview: { kpis: [] } }, isLoading: false, error: null, refetch: vi.fn(), isFetching: false }),
  };
});

// As abas pesadas não fazem parte do que se prova aqui: só a Raia 1 (atribuição) importa.
vi.mock("@/components/commercialIntelligence/PerformanceTab", () => ({ PerformanceTab: () => null }));

import { CommercialIntelligenceContent } from "@/components/CommercialIntelligenceContent";

const LEADS = [
  { id: "1", stage: "buyer", temperature: "hot", dados: { origem: "Importação de planilha", origem_marketing: "importacao_planilha", lead_source: "importacao_planilha" } },
  { id: "2", stage: "cold", temperature: "cold", dados: { origem_marketing: "importacao_planilha" } },
  { id: "3", stage: "cold", temperature: "cold", dados: { origem_marketing: "campanha" } },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: LEADS }), headers: { get: () => null } }))
  );
});
afterEach(() => vi.unstubAllGlobals());

const cardOf = (label: string) => screen.getByText(label).closest("div")!.parentElement as HTMLElement;

describe("Painel de atribuição (Raia 1)", () => {
  it("[TESTE OBRIGATÓRIO] lead com a origem nova aparece na linha própria, não em desconhecida — no painel renderizado", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CommercialIntelligenceContent clientId="A" />
      </QueryClientProvider>
    );

    await waitFor(() => expect(within(cardOf("📥 Importação de planilha")).getByText("leads").parentElement!.textContent).toContain("2"));
    expect(within(cardOf("Origem desconhecida")).getByText("leads").parentElement!.textContent).toContain("0");
    expect(within(cardOf("📢 Campanha")).getByText("leads").parentElement!.textContent).toContain("1");
  });
});
