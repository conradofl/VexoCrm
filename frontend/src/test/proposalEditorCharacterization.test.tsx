// frontend/src/test/proposalEditorCharacterization.test.tsx
//
// Caracterização do EDITOR de proposta (Editar Proposta): trava o corpo exato do PUT que ele envia
// para uma proposta já salva. Existe para provar que a unificação Nova Proposta = Editar Proposta
// não mudou o que a edição grava.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createGdBackend } from "./helpers/gdProposalsBackend";

let backend = createGdBackend();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    getIdToken: async () => "token",
    isAuthenticated: true,
    clientId: "tenant-x",
    accessProfile: { role: "client" },
  }),
}));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useNavigate: () => vi.fn(), useLocation: () => ({ pathname: "/propostas-gd", search: "" }) };
});
vi.mock("@/lib/api", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, fetchApi: (...args: any[]) => (backend.fetchApi as any)(...args) };
});

const SAVED = {
  id: "p1",
  prospect_name: "Clínica Alfa",
  itens: [],
  valor_total: 0,
  condicoes: "Condição legada",
  status: "rascunho",
  created_at: "2026-10-01T10:00:00Z",
  owner_company: "geracao-digital",
  cobrar_setup: true,
  valor_setup_vexo: 3000,
  desconto_setup_pct: 100,
  desconto_mensal_pct: 10,
  descontos_por_periodo: { mensal: 0, trimestral: 10, semestral: 0, anual: 0 },
  periodo_plano: "trimestral",
  package_id: "pk-tri",
  pacotes_ofertados: ["pk-men", "pk-tri"],
  carencia_dias: 15,
  validade_ate: "2026-12-31T23:59:59.000Z",
  payment_link: "https://pay.exemplo/abc",
  esconder_valores: false,
  condicoes_especiais: "Texto especial",
  segment_id: null,
  condicoes_pagamento: {
    ofertadas: [
      { id: "pix_avista", nome: "Pix à vista", tipo: "custom", ativo: true, aplica_a: "setup", config: { meio: "pix", descricao: "Pix à vista" } },
      { id: "cartao_parcelado_periodo", nome: "Parcelado no Cartão em 3x", tipo: "parcelado_cartao", ativo: true, aplica_a: "mensalidade", config: { meio: "cartao", num_parcelas: 3 } },
    ],
    escolhida: null,
  },
};

const PACKAGES = [
  { id: "pk-men", tipo: "gd", ad_hoc: true, periodo: "mensal", nome: "Clínica Alfa · Mensal", valor: 1000, valor_tabela: null, valor_vp: null, produtos_incluidos: [{ product_id: "g1", nome: "Tráfego Pago", origem: "gd" }] },
  { id: "pk-tri", tipo: "gd", ad_hoc: true, periodo: "trimestral", nome: "Clínica Alfa · Trimestral", valor: 2700, valor_tabela: null, valor_vp: null, produtos_incluidos: [{ product_id: "g1", nome: "Tráfego Pago", origem: "gd" }] },
];

// Corpo capturado do editor ANTES da unificação (commit 85b37f0). A validade usa a data local, então
// o instante esperado é calculado do mesmo jeito (não fixo em UTC).
const EDIT_BODY_SEM_ALTERAR = {
  client_id: "tenant-x",
  prospect_name: "Clínica Alfa",
  package_id: "pk-tri",
  pacotes_ofertados: ["pk-men", "pk-tri"],
  package_vexo_id: null,
  itens: [
    { product_id: null, descricao: "Pacote: Clínica Alfa · Trimestral (Recorrência)", categoria: "gd", valor: 900, valor_vp: null, recorrencia: "mensal", periodo: "trimestral", meses: 3, total_periodo: 2700, valor_tabela: null },
    { product_id: "g1", descricao: "Tráfego Pago", categoria: "gd", valor: 0, recorrencia: "mensal" },
  ],
  condicoes: "Condição legada",
  payment_link: "https://pay.exemplo/abc",
  cobrar_setup: true,
  valor_setup_vexo: 3000,
  segment_id: null,
  custom_segment_name: null,
  prospect_logo: null,
  condicoes_pagamento: {
    ofertadas: [
      { id: "pix_avista", nome: "Pix à vista", ativo: true, aplica_a: "setup", tipo: "custom", config: { meio: "pix", descricao: "Pix à vista" } },
      { id: "cartao_parcelado_periodo", nome: "Parcelado no Cartão em 3x", ativo: true, aplica_a: "mensalidade", tipo: "parcelado_cartao", config: { meio: "cartao", num_parcelas: 3 } },
    ],
    escolhida: null,
  },
  periodo_plano: "trimestral",
  validade_ate: new Date("2026-12-31T23:59:59").toISOString(),
  valor_apos_validade: null,
  observacao_validade: null,
  carencia_dias: 15,
  valor_vp: null,
  vp_percent: null,
  condicoes_especiais: "Texto especial",
  esconder_valores: false,
  desconto_setup_pct: 100,
  descontos_por_periodo: { mensal: 0, trimestral: 10, semestral: 0, anual: 0 },
  desconto_mensal_pct: 10,
  vexo_plan: null,
  vexo_price: 0,
  owner_company: "geracao-digital",
};

function renderPage(Page: React.ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  backend = createGdBackend({ proposals: [SAVED], packages: PACKAGES });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Editar Proposta — o que o PUT grava (caracterização)", () => {
  it("salvar sem mexer em nada reenvia exatamente o que a proposta já tinha", async () => {
    const { default: Page } = await import("../pages/GeracaoDigitalProposals");
    renderPage(Page);

    fireEvent.click(await screen.findByRole("button", { name: /Editar Proposta/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Salvar Configuração/ }));

    await waitFor(() => expect(backend.saves()).toHaveLength(1));
    const [save] = backend.saves();
    expect(save.method).toBe("PUT");
    expect(save.url).toBe("/api/gd/proposals/p1");
    expect(save.body).toEqual(EDIT_BODY_SEM_ALTERAR);
  });
});
