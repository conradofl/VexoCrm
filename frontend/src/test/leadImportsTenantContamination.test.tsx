// frontend/src/test/leadImportsTenantContamination.test.tsx
//
// A tela real, montada em uma empresa e trocada para outra, nunca pode gravar na chave
// da empresa nova um valor lido da chave da anterior. So o chip e conferido pelo backend:
// atraso, lote e os demais campos vazariam calados de um cliente para outro.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LeadImports from "@/pages/LeadImports";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    clientId: "cliente-teste",
    isInternalUser: true,
    isAuthenticated: true,
    isAdminUser: true,
    canAccessInternalPage: () => true,
    approvalLevel: "admin",
    getIdToken: async () => "mock-token",
  }),
}));

const chip = (id: string, name: string, isDefault = false) => ({
  id,
  name,
  active: true,
  is_default: isDefault,
  dispatch_webhook_url: `https://evolution.test/message/sendText/${name}`,
});

const clientes = {
  "empresa-a": {
    id: "empresa-a",
    name: "Empresa A",
    plan_tier: "avancado",
    modulos_avulsos: ["disparador_campanhas"],
    n8n_settings: { evolution_instances: [chip("chip-da-a", "a-unico", true)] },
  },
  "empresa-b": {
    id: "empresa-b",
    name: "Empresa B",
    plan_tier: "avancado",
    modulos_avulsos: ["disparador_campanhas"],
    n8n_settings: { evolution_instances: [chip("chip-padrao-da-b", "b-padrao", true), chip("chip-dois-da-b", "b-dois")] },
  },
};

let clienteAtivo: keyof typeof clientes = "empresa-a";

vi.mock("@/hooks/useCrmClient", () => {
  const atual = () => ({
    selectedClientId: clienteAtivo,
    selectedClient: clientes[clienteAtivo],
    clients: [clientes[clienteAtivo]],
  });
  return { useCrmClient: atual, useOptionalCrmClient: atual };
});

vi.mock("@/hooks/useLeadImports", () => ({
  ALL_IMPORTS_VALUE: "__all__",
  CRM_BASE_VALUE: "__crm__",
  useCreateLeadImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLeadImports: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useLeadImportItems: () => ({ data: { items: [], total: 0 }, isLoading: false }),
  useLeadCustomFields: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useCampanhas", () => ({
  saveCampaignWithSelfHeal: vi.fn(),
  useCampanhas: () => ({ data: [], isLoading: false }),
  useCampaignAiStatus: () => ({ data: null, isLoading: false }),
  useCreateCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGenerateCampaignTemplateVariants: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCampaignDispatches: () => ({ data: [], isLoading: false }),
  useCreateDispatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDispatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTriggerDispatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDispatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAllDispatches: () => ({ data: [], isLoading: false }),
  useDispatchRecipients: () => ({ data: { items: [], summary: {} }, isLoading: false, refetch: vi.fn() }),
  useCampaignRecipients: () => ({ data: null, isLoading: false }),
  useRetryFailedDispatchLeads: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunPendingDispatchLeads: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useConsultantSchedules", () => ({
  useConsultantSchedules: () => ({ data: [], isLoading: false }),
  useCreateConsultantSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateConsultantSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteConsultantSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useCampaignPrompts", () => ({
  useCampaignPrompts: () => ({ data: [], isLoading: false }),
  useSaveCampaignPrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCampaignPrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDispatchPrompt: () => ({ data: null, isLoading: false }),
  useSaveDispatchPrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function telaDa(empresa: keyof typeof clientes) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LeadImports fixedClientId={empresa} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const lerOpcoes = (empresa: string) =>
  JSON.parse(window.localStorage.getItem(`vexo_campaignDispatchOpts_${empresa}`) || "null");

const OPCOES_DA_A = {
  leadDelaySeconds: 77,
  dailyQuotaPerChip: 777,
  minWaitSeconds: 71,
  maxWaitSeconds: 72,
  maxRepetitionsPerTemplate: 73,
  stopOnStepFailure: false,
  evolutionInstanceId: "chip-da-a",
  dispatchChipIds: ["chip-da-a"],
};

function semearEmpresaA() {
  window.localStorage.setItem("vexo_campaignDispatchOpts_empresa-a", JSON.stringify(OPCOES_DA_A));
  window.localStorage.setItem("vexo_batchSize_empresa-a", JSON.stringify("7777"));
  window.localStorage.setItem("vexo_batchInterval_empresa-a", JSON.stringify("79"));
  window.localStorage.setItem("vexo_batching_empresa-a", JSON.stringify(true));
  window.localStorage.setItem("vexo_campaignName_empresa-a", JSON.stringify("CAMPANHA-SO-DA-A"));
}

async function montarNaATrocarParaB() {
  clienteAtivo = "empresa-a";
  const tela = render(telaDa("empresa-a"));
  await act(async () => {});
  clienteAtivo = "empresa-b";
  tela.rerender(telaDa("empresa-b"));
  await act(async () => {});
  return tela;
}

describe("Troca de empresa nao contamina a configuracao de disparo", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("empresa B sem nada salvo nao recebe chip, atraso, cota nem lote da empresa A", async () => {
    semearEmpresaA();
    const tela = await montarNaATrocarParaB();

    const opcoesDaB = lerOpcoes("empresa-b");
    expect(opcoesDaB?.evolutionInstanceId, "chip da A na chave da B").toBe("chip-padrao-da-b");
    expect(opcoesDaB?.dispatchChipIds ?? [], "lista de chips da A na chave da B").not.toContain("chip-da-a");
    expect(opcoesDaB?.leadDelaySeconds, "atraso da A na chave da B").toBe(2);
    expect(opcoesDaB?.dailyQuotaPerChip, "cota da A na chave da B").toBe(200);
    expect(opcoesDaB?.minWaitSeconds, "espera da A na chave da B").toBe(15);

    // Varredura: qualquer chave da B que carregue marca da A, nao so as que lembrei de citar.
    const chavesDaB = Object.keys(window.localStorage).filter((k) => k.endsWith("_empresa-b"));
    for (const chave of chavesDaB) {
      const valor = window.localStorage.getItem(chave) || "";
      expect(valor, `marca da A em ${chave}`).not.toMatch(/chip-da-a|7777|CAMPANHA-SO-DA-A/);
    }
    expect(window.localStorage.getItem("vexo_batchSize_empresa-b"), "lote da A na chave da B").not.toBe(JSON.stringify("7777"));
    tela.unmount();
  });

  it("empresa B com configuracao propria continua com a dela depois da troca", async () => {
    semearEmpresaA();
    const opcoesProprias = { leadDelaySeconds: 11, dailyQuotaPerChip: 111, evolutionInstanceId: "chip-dois-da-b", dispatchChipIds: ["chip-dois-da-b"] };
    window.localStorage.setItem("vexo_campaignDispatchOpts_empresa-b", JSON.stringify(opcoesProprias));

    const tela = await montarNaATrocarParaB();

    expect(lerOpcoes("empresa-b")).toEqual(opcoesProprias);
    tela.unmount();
  });

  it("cadastro ainda apontando para a A com a tela ja na B nao grava chip da A na chave da B", async () => {
    clienteAtivo = "empresa-a";
    const tela = render(telaDa("empresa-b"));
    await act(async () => {});

    expect(lerOpcoes("empresa-b")?.evolutionInstanceId ?? null).toBeNull();
    tela.unmount();
  });

  it("ida e volta: a empresa A reencontra exatamente o que tinha", async () => {
    semearEmpresaA();
    const tela = await montarNaATrocarParaB();
    clienteAtivo = "empresa-a";
    tela.rerender(telaDa("empresa-a"));
    await act(async () => {});

    expect(lerOpcoes("empresa-a")).toEqual(OPCOES_DA_A);
    expect(lerOpcoes("empresa-b")?.leadDelaySeconds).toBe(2);
    tela.unmount();
  });
});
